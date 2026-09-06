import { Actor } from 'apify';

// A NAMED key-value store (not the run's default one, which is isolated per
// run) is what makes "only new since last run" possible at all - the
// default KV store would not survive between scheduled runs.
const STATE_STORE_NAME = 'florida-tenders-monitor-delta-state';
const MAX_SEEN_IDS = 3000;

export interface DeltaState {
    seenIds: string[];
    lastRunAt: string | null;
}

export async function loadState(): Promise<DeltaState> {
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    const state = await store.getValue<DeltaState>('state');
    return state ?? { seenIds: [], lastRunAt: null };
}

// Keeps every id seen THIS run (so a delta run that filtered most of them
// out of the dataset still remembers them next time), then backfills with
// ids from the previous state that weren't seen again this run, until the
// cap is reached. Note this is a "most-recently-observed-first" cap, not a
// "newest-first" one: unlike some actors in this portfolio, MFMP's listing
// order is not verified stable/newest-first (see AGENTS.md), so there is no
// source ordering to preserve here - only recency of observation.
export async function saveState(state: DeltaState, idsSeenThisRun: string[], runAt: string): Promise<DeltaState> {
    const merged = [...idsSeenThisRun, ...state.seenIds.filter((id) => !idsSeenThisRun.includes(id))];
    const next: DeltaState = { seenIds: merged.slice(0, MAX_SEEN_IDS), lastRunAt: runAt };
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    await store.setValue('state', next);
    return next;
}
