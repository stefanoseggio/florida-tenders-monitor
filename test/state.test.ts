import { describe, expect, it, vi } from 'vitest';

vi.mock('apify', () => ({
    log: { info: () => {}, warning: () => {}, debug: () => {} },
    Actor: { openKeyValueStore: async () => ({ getValue: async () => null, setValue: async () => {} }) },
}));

const { emptyState, isColdState, markSeen, pruneState, recordWalkCoverage, stateStoreName, loadState } =
    await import('../src/state.js');

describe('delta state', () => {
    it('names one store per delta-state name, sanitised', () => {
        expect(stateStoreName('auto-1a2b3c4d')).toBe('florida-tenders-monitor-state-auto-1a2b3c4d');
        expect(stateStoreName('My Watch!')).toBe('florida-tenders-monitor-state-my-watch');
        expect(stateStoreName('')).toBe('florida-tenders-monitor-state-default');
    });

    it('starts cold and never inherits the v1 store', async () => {
        const state = await loadState('florida-tenders-monitor-state-x', 'sig', false);
        expect(isColdState(state)).toBe(true);
        expect(state.seen).toEqual({});
        markSeen(state, 16672, { version: 1, status: 'OPEN', updatedAt: null });
        expect(isColdState(state)).toBe(false);
        expect(state.seen['16672']).toEqual({ version: 1, status: 'OPEN', updatedAt: null });
    });

    it('records the two floors with the documented semantics', () => {
        const state = emptyState('sig');
        recordWalkCoverage(state, true, true, '2026-09-01T00:00:00.000Z');
        expect(state.baselineFloor).toBe('2026-09-01T00:00:00.000Z');
        recordWalkCoverage(state, false, true, '2026-09-03T00:00:00.000Z');
        expect(state.backlogFloor).toBe('2026-09-03T00:00:00.000Z');
        recordWalkCoverage(state, false, true, '2026-09-05T00:00:00.000Z'); // a later, shallower cut keeps the deeper floor
        expect(state.backlogFloor).toBe('2026-09-03T00:00:00.000Z');
        recordWalkCoverage(state, false, false, null);
        expect(state.backlogFloor).toBeNull();
        expect(state.baselineFloor).toBe('2026-09-01T00:00:00.000Z'); // only resetState clears it
        const untruncatedCold = emptyState('sig');
        recordWalkCoverage(untruncatedCold, true, false, '2026-09-01T00:00:00.000Z');
        expect(untruncatedCold.baselineFloor).toBeNull();
    });

    it('prunes the lowest advertisementIds first', () => {
        const state = emptyState('sig');
        for (const id of [5, 300, 17, 9999, 42]) markSeen(state, id, { version: 1, status: 'CLOSED', updatedAt: null });
        pruneState(state, 3);
        expect(Object.keys(state.seen).sort()).toEqual(['300', '42', '9999']);
    });
});
