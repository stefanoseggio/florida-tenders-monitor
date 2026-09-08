/* eslint-disable no-param-reassign -- the delta state is an in-place mutable accumulator by design */
import { Actor, log } from 'apify';

import type { AdStatus } from './types.js';

// Delta state lives in a NAMED key-value store (the run's default store is
// isolated per run and would not survive between scheduled runs). One store
// per delta-state name, so two schedules with different filters never poison
// each other's memory - the name defaults to a hash of the filter set (see
// input.ts) and can be pinned explicitly with the `deltaStateName` input.
const STORE_PREFIX = 'florida-tenders-monitor-state';
const STATE_KEY = 'state';

// The whole register is ~13,600 advertisements; 50,000 entries (~3 MB of
// JSON) is years of headroom. Pruning drops the lowest advertisementIds
// (the oldest postings) first.
export const MAX_SEEN_ENTRIES = 50_000;

/** What was known about an advertisement when it was last delivered or deliberately skipped. */
export interface SeenEntry {
    /** Listing `version` (amendment counter); null when unknown. */
    version: number | null;
    status: AdStatus;
    /** Detail `lastUpdateDate` (UTC ISO) when detail was fetched; null otherwise. */
    updatedAt: string | null;
}

export interface DeltaState {
    version: 2;
    /** advertisementId -> change key of the last delivery / skip. */
    seen: Record<string, SeenEntry>;
    lastRunAt: string | null;
    /**
     * Set once, by the FIRST (cold) delta run when maxItems cut its delivery
     * short: the publishDate (UTC ISO) of the oldest advertisement it
     * delivered. Unseen rows published at or before it are history - never
     * delivered by later runs (they are marked seen instead, so a later
     * amendment still surfaces as UPDATED).
     */
    baselineFloor: string | null;
    /**
     * Set when a NON-cold delta run was cut short by maxItems: the
     * publishDate of the oldest new advertisement it delivered. Rows below it
     * are still undelivered. Because every run re-walks every listing page
     * (MFMP has no timestamp sort, hence no early-stop), the next run finds
     * them again on its own; the floor is kept so logs and the run summary
     * can say a backlog exists, and is cleared by a complete delivery.
     */
    backlogFloor: string | null;
    filtersSignature: string | null;
}

export function emptyState(filtersSignature: string | null): DeltaState {
    return {
        version: 2,
        seen: {},
        lastRunAt: null,
        baselineFloor: null,
        backlogFloor: null,
        filtersSignature,
    };
}

/** A store that has never completed a run - the next delta run establishes the baseline. */
export function isColdState(state: DeltaState): boolean {
    return state.lastRunAt === null && Object.keys(state.seen).length === 0;
}

export function stateStoreName(deltaStateName: string): string {
    const safe = deltaStateName
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30);
    return `${STORE_PREFIX}-${safe || 'default'}`;
}

export async function loadState(
    storeName: string,
    filtersSignature: string | null,
    reset: boolean,
): Promise<DeltaState> {
    if (reset) {
        log.info(`resetState=true - starting from an empty memory in store "${storeName}".`);
        return emptyState(filtersSignature);
    }
    const store = await Actor.openKeyValueStore(storeName);
    const stored = await store.getValue<DeltaState>(STATE_KEY);
    if (stored && stored.version === 2 && stored.seen && typeof stored.seen === 'object') {
        stored.baselineFloor ??= null;
        stored.backlogFloor ??= null;
        if (stored.filtersSignature && filtersSignature && stored.filtersSignature !== filtersSignature) {
            log.warning(
                `Delta store "${storeName}" was built with a different filter set - records matching the new filters but already seen under the old ones will not be re-delivered. Use resetState=true to re-baseline.`,
            );
        }
        return stored;
    }
    // Every delta-state name starts from an empty memory. The v1 store
    // (`florida-tenders-monitor-delta-state`, a bare id list written
    // regardless of filters and capped at 3,000 ids) is deliberately NOT
    // adopted: it carries no version/status, so nothing in it could drive
    // UPDATED / STATUS_CHANGE events, and inheriting it would suppress
    // records for a new filter set.
    return emptyState(filtersSignature);
}

/** Record that an advertisement was delivered (or intentionally skipped) at the given version/status. */
export function markSeen(state: DeltaState, advertisementId: number | string, entry: SeenEntry): void {
    state.seen[String(advertisementId)] = entry;
}

/**
 * After a delta walk: a COLD run cut short by maxItems defines the baseline;
 * a NON-cold run cut short records a backlog floor; a complete delivery
 * clears the backlog.
 */
export function recordWalkCoverage(
    state: DeltaState,
    cold: boolean,
    truncated: boolean,
    oldestDeliveredPublishUtc: string | null,
): void {
    if (cold) {
        state.baselineFloor = truncated ? oldestDeliveredPublishUtc : null;
        state.backlogFloor = null;
        return;
    }
    if (!truncated) {
        state.backlogFloor = null;
        return;
    }
    if (!oldestDeliveredPublishUtc) return; // nothing usable to anchor on - keep whatever floor exists
    state.backlogFloor =
        state.backlogFloor && state.backlogFloor < oldestDeliveredPublishUtc
            ? state.backlogFloor
            : oldestDeliveredPublishUtc;
}

/** Keep the map bounded: drop the lowest advertisementIds (oldest postings) first. */
export function pruneState(state: DeltaState, max = MAX_SEEN_ENTRIES): void {
    const ids = Object.keys(state.seen);
    if (ids.length <= max) return;
    ids.sort((a, b) => Number(a) - Number(b));
    const drop = ids.length - max;
    for (let i = 0; i < drop; i++) delete state.seen[ids[i]];
    log.info(`Pruned ${drop} oldest entries from the delta state (cap ${max}).`);
}

export async function saveState(storeName: string, state: DeltaState, runAt: string): Promise<void> {
    state.lastRunAt = runAt;
    pruneState(state);
    const store = await Actor.openKeyValueStore(storeName);
    await store.setValue(STATE_KEY, state);
}
