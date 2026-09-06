import { log } from 'apify';

import type { DateRangePreset } from './dateFilter.js';
import { isWithinDateRange, parseIsoDate } from './dateFilter.js';
import { apiGet, apiPost } from './http.js';
import { buildTenderRecord } from './parsers/record.js';
import type { AdStatus, DetailData, ListingItem, TenderRecord } from './types.js';

const SEARCH_PATH = '/mfmp/pub/search/bids';
const DETAIL_PATH = '/mfmp/pub/search/bids/detail';

// Verified live 2026-09-04 that the API accepts pageSize far above the
// portal UI's own default of 25 (tested 50 and 100, both returned exactly
// that many real items) - using 100 to minimize request count.
const PAGE_SIZE = 100;

function buildSearchPayload(statuses: AdStatus[], page: number) {
    return {
        pageSize: PAGE_SIZE,
        type: [],
        status: statuses,
        agency: [],
        adNumber: '',
        agencyAdvertisementNumber: '',
        title: '',
        publishedDate: '',
        openDate: '',
        endDate: '',
        commodityCodes: [],
        intendsToParticipate: '',
        assignee: '',
        page,
    };
}

async function fetchDetail(advertisementId: number): Promise<DetailData | null> {
    try {
        const response = await apiGet(`${DETAIL_PATH}?id=${advertisementId}`);
        return (await response.json()) as DetailData;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warning(`Fallo el detalle de advertisementId=${advertisementId} tras reintentos: ${message}`);
        return null;
    }
}

export interface FetchTendersResult {
    results: TenderRecord[];
    // Every advertisementId encountered in the listing walk this run, as a
    // string - NOT just the ones that made it into `results` after the
    // onlyNew/dateRange filters. The caller persists this so the delta
    // state reflects everything actually seen, even when most of it was
    // filtered out of the dataset.
    allIdsThisRun: string[];
}

// DELTA ENGINE DESIGN NOTE - read before "optimizing" this into early-stop
// pagination:
//
// `onlyNew` is implemented here as a SAFE POST-FILTER, not early-stop
// pagination. Live capture against the real MFMP listing endpoint on
// 2026-09-06 (two identical POSTs, one page apart) showed the response is
// byte-identical run-to-run (stable), but NOT sorted newest-first by either
// advertisementId or publishDate - a 100-item page came back with both
// fields jumping up and down repeatedly, and there was zero advertisementId
// overlap between page 1 and page 2 of the same request (see AGENTS.md for
// the raw evidence). That rules out "stop after N consecutive pages with no
// unseen ids": on this source, a newly-published record can land anywhere
// in the page order, including near the end, so stopping early on the
// assumption that new items surface near the front would silently miss
// them - exactly backwards from what a delta monitor is supposed to
// guarantee. This actor's own pre-existing dedup/stall-guard logic below
// (`seenInThisRun`, "no aporto items nuevos") already existed BEFORE this
// retrofit specifically because live government data can shift between
// requests - a second hint pointing the same direction.
//
// So: this function walks pages exactly as it did before the delta
// retrofit (up to `maxItems` listing items, same stall guard, no early
// termination tied to `onlyNew`), and only after that full walk are
// already-seen records dropped from `results`. This means a delta run with
// `onlyNew: true` still costs the same number of requests as a normal run
// for the same `maxItems` - it does not resolve faster - but it cannot miss
// a genuinely new record the way a wrong early-stop could. A known
// consequence of this honest tradeoff: if `maxItems` truncates the listing
// walk before every unseen record has been reached, this run will return
// fewer new records than actually exist (documented in the README).
export async function fetchTenders(
    statuses: AdStatus[],
    shouldFetchDetail: boolean,
    maxItems: number,
    seenIds: ReadonlySet<string>,
    onlyNew: boolean,
    dateRange: DateRangePreset | undefined,
    now: Date,
): Promise<FetchTendersResult> {
    const results: TenderRecord[] = [];
    const allIdsThisRun: string[] = [];
    const seenInThisRun = new Set<number>();
    const scrapedAt = now.toISOString();

    for (let page = 1; results.length < maxItems; page++) {
        const payload = buildSearchPayload(statuses, page);
        const response = await apiPost(SEARCH_PATH, payload);
        const items = (await response.json()) as ListingItem[];

        if (items.length === 0) {
            log.info(`Pagina ${page}: 0 resultados - fin de resultados.`);
            break;
        }

        let newInPage = 0;
        for (const item of items) {
            if (results.length >= maxItems) break;
            if (seenInThisRun.has(item.advertisementId)) continue;
            seenInThisRun.add(item.advertisementId);
            newInPage += 1;

            const recordId = String(item.advertisementId);
            allIdsThisRun.push(recordId);
            const isNew = !seenIds.has(recordId);

            const detail = shouldFetchDetail ? await fetchDetail(item.advertisementId) : null;
            results.push(buildTenderRecord(item, detail, scrapedAt, isNew));
        }

        log.info(`Pagina ${page}: ${items.length} items (${newInPage} nuevos, acumulado: ${results.length})`);

        // Dedup-driven stall guard, same defensive pattern as
        // cordoba-compras-monitor and salta-compras-monitor: this is live
        // government data that can shift between requests as new
        // solicitations are published mid-crawl. No overlap was observed
        // during live testing, but the cost of guarding against it is
        // negligible.
        if (newInPage === 0) {
            log.warning(`Pagina ${page} no aporto items nuevos - fin de resultados.`);
            break;
        }
        if (items.length < PAGE_SIZE) break;
    }

    let filtered = results;
    if (onlyNew) {
        filtered = filtered.filter((record) => record.is_new);
    }
    if (dateRange) {
        filtered = filtered.filter((record) => isWithinDateRange(parseIsoDate(record.publishDate), dateRange, now));
    }

    return { results: filtered, allIdsThisRun };
}
