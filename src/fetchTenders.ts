import { log } from 'apify';

import { describeFilters, fetchDetail, fetchListingCount, fetchListingPage, PAGE_SIZE } from './api.js';
import { mapWithConcurrency } from './http.js';
import { toUtcIso, utcCalendarDay } from './normalize.js';
import type { DetailResult } from './parsers/record.js';
import { buildRecord } from './parsers/record.js';
import type { SeenEntry } from './state.js';
import type { EventType, ListingItem, SearchFilters, TenderRecord } from './types.js';

export type ExclusionReason = 'unchanged' | 'baseline' | 'agency' | 'eventType' | 'dateWindow';

export interface Candidate {
    item: ListingItem;
    eventType: EventType;
    isNew: boolean;
    /** true when the row must be delivered in delta mode (new, version rose or status flipped). */
    changed: boolean;
    previous: SeenEntry | null;
    /** publishDate as a canonical UTC ISO string - the ordering key of this register. */
    publishDateUtc: string | null;
    excludedBy: ExclusionReason | null;
}

export interface WalkOptions {
    filters: SearchFilters;
    maxItems: number;
    onlyNew: boolean;
    seen: Readonly<Record<string, SeenEntry>>;
    /**
     * publishDateUtc of the oldest advertisement the FIRST (cold) delta run
     * delivered when maxItems cut it short. Unseen rows published at or
     * before it are history and are excluded ('baseline') on later runs.
     */
    baselineFloor?: string | null;
    /** publishDateUtc of the oldest row a previous truncated non-cold run delivered (informational - see state.ts). */
    backlogFloor?: string | null;
    agencyNameContains: string | null;
    eventTypes: ReadonlySet<EventType>;
    /** Client-side inclusive window on the UTC publish day. */
    dateFrom?: string | null;
    dateTo?: string | null;
    /** Parallel listing-page requests (the page count is known up front from /count). */
    maxConcurrency: number;
}

export type StopReason = 'end-of-results' | 'max-items';

export interface WalkResult {
    /** Deliverable candidates in priority order: changes to known ads first, then new ads newest-published first. */
    candidates: Candidate[];
    /** Walked but intentionally not delivered (unchanged in delta mode, history below the baseline, or filtered client-side). */
    excluded: Candidate[];
    /** Deliverable candidates beyond maxItems - NOT marked seen; the next run finds them again. */
    overflow: number;
    /** Exact total for the filter set from MFMP's /count endpoint. */
    totalMatching: number;
    pagesWalked: number;
    rowsWalked: number;
    stopReason: StopReason;
    /** true when more deliverable records matched than maxItems allowed. */
    truncatedByMaxItems: boolean;
}

// Runaway guard only: 13,027 CLOSED ads are 131 pages; 2,000 pages = 200,000 rows.
const PAGE_CAP = 2_000;

export function classify(
    item: ListingItem,
    previous: SeenEntry | undefined,
): { eventType: EventType; isNew: boolean; changed: boolean } {
    if (previous === undefined) return { eventType: 'NEW_LISTING', isNew: true, changed: true };
    if (previous.status !== item.status) return { eventType: 'STATUS_CHANGE', isNew: false, changed: true };
    if (previous.version !== null && typeof item.version === 'number' && item.version > previous.version) {
        return { eventType: 'UPDATED', isNew: false, changed: true };
    }
    return { eventType: 'NEW_LISTING', isNew: false, changed: false };
}

/**
 * Fetch every listing page for the filter set. MFMP has no sort parameter
 * (rows come back by type name, then advertisementId ascending, so new
 * postings sit at the END of each type group and amendments anywhere) -
 * there is no page-level early-stop; instead the exact total from /count
 * lets the pages be fetched in parallel. The end marker is an empty array.
 */
async function fetchAllPages(
    filters: SearchFilters,
    maxConcurrency: number,
): Promise<{ rows: ListingItem[]; pagesWalked: number; totalMatching: number }> {
    const totalMatching = await fetchListingCount(filters);
    const expectedPages = Math.max(1, Math.ceil(totalMatching / PAGE_SIZE));
    const pageNumbers = Array.from({ length: Math.min(expectedPages, PAGE_CAP) }, (_, i) => i + 1);
    const pages = await mapWithConcurrency(pageNumbers, maxConcurrency, async (page) =>
        fetchListingPage(filters, page),
    );
    let pagesWalked = pages.length;
    // The listing may have grown between /count and the page fetches: keep
    // paging sequentially while pages come back full, until the empty page.
    let last = pages.at(-1) ?? [];
    while (last.length === PAGE_SIZE && pagesWalked < PAGE_CAP) {
        const page = pagesWalked + 1;
        last = await fetchListingPage(filters, page);
        pagesWalked += 1;
        pages.push(last);
        if (last.length === 0) log.info(`Page ${page}: empty - end of results.`);
    }
    if (pagesWalked >= PAGE_CAP) log.warning(`Page cap (${PAGE_CAP}) reached - stopping the walk.`);
    return { rows: pages.flat(), pagesWalked, totalMatching };
}

/** Priority for delivery/truncation: changes to known ads first, then new ads newest-published first. */
function priorityKey(c: Candidate): string {
    const activity = c.isNew ? (c.publishDateUtc ?? '0000') : '9999';
    return `${activity}|${String(c.item.advertisementId).padStart(12, '0')}`;
}

/**
 * Walk the whole listing for the filter set and decide, per row, whether it
 * must be delivered. Never fetches detail.
 */
export async function walkListing(options: WalkOptions): Promise<WalkResult> {
    const { filters, maxItems, onlyNew, seen, agencyNameContains, eventTypes, maxConcurrency } = options;
    const baselineFloor = onlyNew ? (options.baselineFloor ?? null) : null;
    const backlogFloor = onlyNew ? (options.backlogFloor ?? null) : null;
    const dateFrom = options.dateFrom ?? null;
    const dateTo = options.dateTo ?? null;
    const agencyNeedle = agencyNameContains?.trim().toLowerCase() || null;
    if (backlogFloor) {
        log.info(
            `Previous delta run was cut short by maxItems (backlog below ${backlogFloor}) - every page is walked again, so the undelivered rows are picked up now.`,
        );
    }

    const { rows, pagesWalked, totalMatching } = await fetchAllPages(filters, maxConcurrency);
    if (rows.length < totalMatching) {
        log.warning(
            `MFMP reported ${totalMatching} matching advertisements but ${rows.length} rows were returned - the listing shifted during the walk; the missing rows will be seen by the next run.`,
        );
    }

    const walkedIds = new Set<number>();
    const deliverable: Candidate[] = [];
    const excluded: Candidate[] = [];
    let duplicates = 0;
    for (const item of rows) {
        if (walkedIds.has(item.advertisementId)) {
            duplicates += 1;
            continue;
        }
        walkedIds.add(item.advertisementId);

        const previous = seen[String(item.advertisementId)];
        const { eventType, isNew, changed } = classify(item, previous);
        const publishDateUtc = toUtcIso(item.publishDate);
        const publishDay = utcCalendarDay(item.publishDate);
        // Unseen rows published at or before the baseline are history, not news.
        const belowBaseline =
            isNew && baselineFloor !== null && publishDateUtc !== null && publishDateUtc <= baselineFloor;

        const candidate: Candidate = {
            item,
            eventType,
            isNew,
            changed: changed && !belowBaseline,
            previous: previous ?? null,
            publishDateUtc,
            excludedBy: null,
        };
        const agencyText = `${item.agency ?? ''} ${item.organization?.shortName ?? ''}`.toLowerCase();
        if (onlyNew && !changed) candidate.excludedBy = 'unchanged';
        else if (belowBaseline) candidate.excludedBy = 'baseline';
        else if (agencyNeedle && !agencyText.includes(agencyNeedle)) candidate.excludedBy = 'agency';
        else if (!eventTypes.has(eventType)) candidate.excludedBy = 'eventType';
        else if (
            (dateFrom && (!publishDay || publishDay < dateFrom)) ||
            (dateTo && (!publishDay || publishDay > dateTo))
        )
            candidate.excludedBy = 'dateWindow';

        if (candidate.excludedBy) excluded.push(candidate);
        else deliverable.push(candidate);
    }
    if (duplicates > 0) log.warning(`${duplicates} duplicate row(s) across pages were skipped (listing shifted).`);

    deliverable.sort((a, b) => priorityKey(b).localeCompare(priorityKey(a)));
    const truncatedByMaxItems = deliverable.length > maxItems;
    const candidates = truncatedByMaxItems ? deliverable.slice(0, maxItems) : deliverable;
    const overflow = deliverable.length - candidates.length;
    if (truncatedByMaxItems) {
        log.warning(
            `maxItems=${maxItems} reached - ${overflow} more matching record(s) were NOT delivered this run. In delta mode they stay unseen and the next run delivers them; raise maxItems to catch up faster.`,
        );
    }
    log.info(
        `Walk finished: ${rows.length} rows on ${pagesWalked} page(s) [${describeFilters(filters)}], ${totalMatching} matching on MFMP, ${candidates.length} to deliver, ${excluded.length} excluded, ${overflow} beyond maxItems.`,
    );
    return {
        candidates,
        excluded,
        overflow,
        totalMatching,
        pagesWalked,
        rowsWalked: rows.length,
        stopReason: truncatedByMaxItems ? 'max-items' : 'end-of-results',
        truncatedByMaxItems,
    };
}

/** Fetch one advertisement's detail; an unknown/withdrawn id or a failed request degrades to a summary record instead of failing the run. */
export async function fetchDetailFor(item: ListingItem): Promise<DetailResult> {
    try {
        const detail = await fetchDetail(item.advertisementId);
        if (detail === null) return { detail: null, error: 'NOT_FOUND' };
        return { detail, error: null };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warning(`Detail fetch failed for ${item.uniqueName}: ${message}`);
        return { detail: null, error: message };
    }
}

export interface EnrichOptions {
    fetchDetail: boolean;
    maxConcurrency: number;
    now: Date;
}

/** Build final records for a batch of candidates, fetching detail with bounded concurrency. Order is preserved. */
export async function enrichBatch(candidates: readonly Candidate[], options: EnrichOptions): Promise<TenderRecord[]> {
    const scrapedAt = options.now.toISOString();
    const context = (c: Candidate) => ({ eventType: c.eventType, isNew: c.isNew, previous: c.previous });
    if (!options.fetchDetail)
        return candidates.map((c) => buildRecord(c.item, null, context(c), options.now, scrapedAt));
    const details = await mapWithConcurrency(candidates, options.maxConcurrency, async (c) => fetchDetailFor(c.item));
    return candidates.map((c, i) => buildRecord(c.item, details[i], context(c), options.now, scrapedAt));
}

export interface FetchTendersOptions extends WalkOptions, EnrichOptions {}

/**
 * Convenience one-shot: walk + enrich everything. main.ts streams in batches
 * instead (so state is persisted only for delivered records); this is the
 * simpler entry point used by the live integration tests.
 */
export async function fetchTenders(
    options: FetchTendersOptions,
): Promise<{ records: TenderRecord[]; walk: WalkResult }> {
    const walk = await walkListing(options);
    const records = await enrichBatch(walk.candidates, options);
    return { records, walk };
}
