import { describe, expect, it } from 'vitest';

import { fetchDetail, fetchListingCount } from '../src/api.js';
import { fetchTenders } from '../src/fetchTenders.js';
import { resolveInput } from '../src/input.js';
import type { ActorInput } from '../src/types.js';

// Live checks against the real MFMP portal. Opt-in (`npm run test:live`, LIVE=1)
// so a developer's routine `npm test` and CI never depend on an external host.
const NOW = new Date();

function run(input: ActorInput) {
    const { filters, options } = resolveInput(input, NOW);
    return fetchTenders({
        filters,
        maxItems: options.maxItems,
        onlyNew: options.onlyNew,
        seen: {},
        agencyNameContains: options.agencyNameContains,
        eventTypes: options.eventTypes,
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        maxConcurrency: options.maxConcurrency,
        fetchDetail: options.fetchDetail,
        now: NOW,
    });
}

describe.skipIf(!process.env.LIVE)('live MyFloridaMarketPlace integration', () => {
    it('fetches OPEN advertisements with full detail and the exact total from /count', async () => {
        const { records, walk } = await run({ maxItems: 5 });
        expect(records).toHaveLength(5);
        expect(walk.totalMatching).toBeGreaterThan(50);
        expect(walk.rowsWalked).toBe(walk.totalMatching);
        for (const r of records) {
            expect(r.advertisementId).toBeGreaterThan(0);
            expect(r.status).toBe('OPEN');
            expect(r.publishDateUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(r.closeDateLocal).toMatch(/E[SD]T$/);
            expect(r.version).toBeGreaterThanOrEqual(0);
            expect(r.detailFetched).toBe(true);
            expect(r.organizationId).toBeGreaterThan(0);
        }
        expect(records.some((r) => r.descriptionText)).toBe(true);
        expect(records.some((r) => r.documents.length > 0)).toBe(true);
    }, 90_000);

    it('server-side type + agency filters narrow the result and the count matches the rows', async () => {
        const { records, walk } = await run({ types: ['4', '6'], agencyIds: ['30000021'], fetchDetail: false });
        expect(walk.totalMatching).toBe(walk.rowsWalked);
        expect(records.every((r) => ['4', '6'].includes(r.typeId) && r.organizationId === 30000021)).toBe(true);
    }, 60_000);

    it('paginates the CLOSED register concurrently without duplicates (count-driven walk)', async () => {
        const { filters, options } = resolveInput({ statuses: ['CLOSED'], types: ['1'], fetchDetail: false }, NOW);
        const total = await fetchListingCount(filters);
        expect(total).toBeGreaterThan(100); // several pages
        const { records, walk } = await fetchTenders({
            filters,
            maxItems: 50_000,
            onlyNew: false,
            seen: {},
            agencyNameContains: null,
            eventTypes: options.eventTypes,
            maxConcurrency: 5,
            fetchDetail: false,
            now: NOW,
        });
        expect(walk.pagesWalked).toBe(Math.ceil(total / 100));
        expect(new Set(records.map((r) => r.advertisementId)).size).toBe(records.length);
        expect(records.length).toBe(total);
    }, 120_000);

    it('a one-day publish window is pushed server-side and every row is on that UTC day', async () => {
        const { records, walk } = await run({ dateFrom: '2026-09-02', dateTo: '2026-09-02', fetchDetail: false });
        expect(walk.totalMatching).toBe(records.length);
        expect(records.every((r) => r.publishDay === '2026-09-02')).toBe(true);
    }, 60_000);

    it('an unknown advertisement id answers HTTP 200 all-null and is reported as unavailable, not shipped', async () => {
        await expect(fetchDetail(99_999_999)).resolves.toBeNull();
    }, 30_000);

    it('a zero-result query ends cleanly instead of being mistaken for a block', async () => {
        const { records, walk } = await run({ adNumber: '999999999', fetchDetail: false });
        expect(records).toEqual([]);
        expect(walk.totalMatching).toBe(0);
        expect(walk.stopReason).toBe('end-of-results');
    }, 30_000);
});
