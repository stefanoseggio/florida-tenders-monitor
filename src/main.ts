import { Actor, log } from 'apify';

import { buildSearchPayload, describeFilters } from './api.js';
import type { Candidate, WalkResult } from './fetchTenders.js';
import { enrichBatch, walkListing } from './fetchTenders.js';
import { BASE_URL } from './http.js';
import { resolveInput } from './input.js';
import type { DeltaState, SeenEntry } from './state.js';
import { isColdState, loadState, markSeen, recordWalkCoverage, saveState, stateStoreName } from './state.js';
import type { TenderRecord } from './types.js';

// Pay-per-event names. Both must exist in the actor's pricing configuration
// on the platform (see README "Pricing"): a detail-enriched record is charged
// as `result`, a listing-only record (fetchDetail=false, or a detail that
// could not be fetched) as the cheaper `result-summary`.
const EVENT_DETAIL = 'result';
const EVENT_SUMMARY = 'result-summary';

const DELIVERY_BATCH_SIZE = 20;
const PERSIST_EVERY_N_DELIVERED = 50;

await Actor.init();
try {
    await run();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.exception(error instanceof Error ? error : new Error(message), 'Run failed');
    await Actor.setValue('LAST_ERROR', { message, at: new Date().toISOString() });
    await Actor.fail(`MyFloridaMarketPlace extraction failed: ${message}`);
}
await Actor.exit();

function seenEntryOf(record: TenderRecord): SeenEntry {
    return { version: record.version, status: record.status, updatedAt: record.lastUpdateDateUtc };
}

function seenEntryOfCandidate(c: Candidate): SeenEntry {
    return { version: c.item.version, status: c.item.status, updatedAt: c.previous?.updatedAt ?? null };
}

async function run(): Promise<void> {
    const now = new Date();
    const runAt = now.toISOString();
    const resolved = resolveInput((await Actor.getInput()) ?? {}, now);
    const { filters, options } = resolved;

    log.info(`Query: ${describeFilters(filters)}`);
    log.info(
        `Mode: ${options.onlyNew ? 'delta (only new/updated/status changes)' : 'full'} | maxItems=${options.maxItems} | fetchDetail=${options.fetchDetail} | concurrency=${options.maxConcurrency}${options.dateFrom || options.dateTo ? ` | publish window ${options.dateFrom ?? '...'}..${options.dateTo ?? '...'}` : ''}`,
    );

    const storeName = stateStoreName(options.deltaStateName);
    const state = await loadState(storeName, resolved.filtersSignature, options.resetState);
    const cold = isColdState(state);
    log.info(
        `Delta state store: ${storeName} (${cold ? 'cold - this run sets the baseline' : `${Object.keys(state.seen).length} known ids`}, baseline floor ${state.baselineFloor ?? 'none'}, backlog floor ${state.backlogFloor ?? 'none'})`,
    );

    const walk = await walkListing({
        filters,
        maxItems: options.maxItems,
        onlyNew: options.onlyNew,
        seen: state.seen,
        baselineFloor: options.onlyNew ? state.baselineFloor : null,
        backlogFloor: options.onlyNew ? state.backlogFloor : null,
        agencyNameContains: options.agencyNameContains,
        eventTypes: options.eventTypes,
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        maxConcurrency: options.maxConcurrency,
    });
    if (options.onlyNew) {
        // Candidates are in priority order (newest-published last among the
        // new ones); the oldest NEW row delivered is the floor below which
        // everything else is unexplored.
        const oldestNew = [...walk.candidates].reverse().find((c) => c.isNew)?.publishDateUtc ?? null;
        recordWalkCoverage(state, cold, walk.truncatedByMaxItems, oldestNew);
        if (walk.truncatedByMaxItems && cold) {
            log.info(
                `Baseline set at ${state.baselineFloor ?? 'n/a'}: this first run delivers the ${walk.candidates.length} most recently published advertisements; older ones are history and later runs return only what is new, amended or changed status after it.`,
            );
        } else if (walk.truncatedByMaxItems) {
            log.warning(
                `Backlog floor set to ${state.backlogFloor ?? 'n/a'} - ${walk.overflow} record(s) remain undelivered and will be delivered by the next run.`,
            );
        }
    }
    await Actor.setStatusMessage(
        walk.candidates.length === 0
            ? `Nothing new to deliver (${walk.totalMatching} match your filters on MFMP, all already known).`
            : `Found ${walk.candidates.length} record(s) to deliver (${walk.totalMatching} match your filters on MFMP). ${options.fetchDetail ? 'Fetching detail...' : 'Delivering...'}`,
    );

    const delivery = await deliver(walk, state, storeName, runAt, options, now);

    // Records that were walked but intentionally not delivered (unchanged in
    // delta mode, history below the baseline, or filtered client-side) become
    // "seen" only once the run completed normally - never on a crash.
    for (const c of walk.excluded) markSeen(state, c.item.advertisementId, seenEntryOfCandidate(c));
    await saveState(storeName, state, runAt);

    const byType = countBy(delivery.records, (r) => r.event_type);
    const summary = {
        delivered: delivery.records.length,
        byEventType: byType,
        detailFetched: delivery.records.filter((r) => r.detailFetched).length,
        detailFailed: delivery.records.filter((r) => options.fetchDetail && !r.detailFetched).length,
        totalMatchingOnMfmp: walk.totalMatching,
        pagesWalked: walk.pagesWalked,
        rowsWalked: walk.rowsWalked,
        stopReason: walk.stopReason,
        truncatedByMaxItems: walk.truncatedByMaxItems,
        undeliveredBeyondMaxItems: walk.overflow,
        chargeLimitReached: delivery.chargeLimitReached,
        excluded: countBy(walk.excluded, (c) => c.excludedBy ?? 'none'),
        mode: options.onlyNew ? 'delta' : 'full',
        deltaStateStore: storeName,
        knownIdsAfterRun: Object.keys(state.seen).length,
        baselineFloor: state.baselineFloor,
        backlogFloor: state.backlogFloor,
        listingUrl: `${BASE_URL}/search/bids`,
        searchRequest: buildSearchPayload(filters, 1),
        publishWindow: options.dateFrom || options.dateTo ? { from: options.dateFrom, to: options.dateTo } : null,
        runAt,
    };
    await Actor.setValue('OUTPUT', summary);

    const parts = [`${summary.delivered} delivered`];
    if (byType.NEW_LISTING) parts.push(`${byType.NEW_LISTING} new`);
    if (byType.UPDATED) parts.push(`${byType.UPDATED} updated`);
    if (byType.STATUS_CHANGE) parts.push(`${byType.STATUS_CHANGE} status changes`);
    if (summary.detailFailed) parts.push(`${summary.detailFailed} without detail`);
    if (walk.truncatedByMaxItems) parts.push(`maxItems reached - ${walk.overflow} more available`);
    if (delivery.chargeLimitReached) parts.push('spending limit reached');
    await Actor.setStatusMessage(`${parts.join(' · ')} · ${walk.totalMatching} matching on MFMP`, {
        isStatusMessageTerminal: true,
    });
    log.info(`Done: ${parts.join(', ')}.`);
}

interface DeliveryResult {
    records: TenderRecord[];
    chargeLimitReached: boolean;
}

/**
 * Delivers candidates lowest-priority-first (oldest-published new ads first,
 * changes to known ads last) in small batches, persisting the seen-map only
 * for records actually stored (and charged). If a run dies half-way, the
 * undelivered candidates are the ones the next walk ranks highest - so
 * nothing is ever skipped. The dataset views display newest-first.
 */
async function deliver(
    walk: WalkResult,
    state: DeltaState,
    storeName: string,
    runAt: string,
    options: ReturnType<typeof resolveInput>['options'],
    now: Date,
): Promise<DeliveryResult> {
    const queue: Candidate[] = [...walk.candidates].reverse();
    const records: TenderRecord[] = [];
    const { isPayPerEvent } = Actor.getChargingManager().getPricingInfo();
    let sinceLastPersist = 0;
    let chargeLimitReached = false;
    let dirty = false;

    const persist = async (): Promise<void> => {
        if (!dirty) return;
        await saveState(storeName, state, runAt);
        dirty = false;
        sinceLastPersist = 0;
    };
    const onPlatformEvent = (): void => {
        void persist();
    };
    Actor.on('migrating', onPlatformEvent);
    Actor.on('aborting', onPlatformEvent);

    try {
        for (let offset = 0; offset < queue.length && !chargeLimitReached; offset += DELIVERY_BATCH_SIZE) {
            const batch = queue.slice(offset, offset + DELIVERY_BATCH_SIZE);
            const built = await enrichBatch(batch, {
                fetchDetail: options.fetchDetail,
                maxConcurrency: options.maxConcurrency,
                now,
            });

            // Charge the enriched price only for records that really carry detail.
            const groups: { eventName: string; items: TenderRecord[] }[] = [
                { eventName: EVENT_DETAIL, items: [] },
                { eventName: EVENT_SUMMARY, items: [] },
            ];
            for (const record of built) groups[record.detailFetched ? 0 : 1].items.push(record);

            for (const group of groups) {
                if (group.items.length === 0 || chargeLimitReached) continue;
                const result = await Actor.pushData(group.items, group.eventName);
                // In pay-per-event mode the SDK stores only as many items as the
                // customer's spending limit allows and reports that count; outside
                // PPE (local runs, tests) everything is stored and nothing charged.
                const stored = isPayPerEvent ? result.chargedCount : group.items.length;
                for (const record of group.items.slice(0, stored)) {
                    records.push(record);
                    markSeen(state, record.advertisementId, seenEntryOf(record));
                    dirty = true;
                    sinceLastPersist += 1;
                }
                if (result.eventChargeLimitReached) {
                    chargeLimitReached = true;
                    log.warning(
                        `Spending limit reached after ${records.length} record(s) - stopping. Undelivered records will be picked up by the next run.`,
                    );
                }
            }
            if (sinceLastPersist >= PERSIST_EVERY_N_DELIVERED) await persist();
            log.info(`Delivered ${records.length}/${queue.length}.`);
        }
    } finally {
        await persist();
        Actor.off('migrating', onPlatformEvent);
        Actor.off('aborting', onPlatformEvent);
    }
    return { records, chargeLimitReached };
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
    return out;
}
