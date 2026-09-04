import { describe, expect, it } from 'vitest';

import { fetchTenders } from '../src/fetchTenders.js';

// Live checks against the real MFMP portal - skipped in CI (same lesson as
// every other actor in this portfolio: don't make CI depend on an
// external host with no uptime guarantee).
describe.skipIf(process.env.CI)('live fetchTenders against the real MFMP portal', () => {
    it('fetches real OPEN solicitations with full detail', async () => {
        const tenders = await fetchTenders(['OPEN'], true, 5);

        expect(tenders.length).toBeGreaterThan(0);
        expect(tenders.length).toBeLessThanOrEqual(5);
        for (const t of tenders) {
            expect(t.advertisementId).toBeGreaterThan(0);
            expect(t.status).toBe('OPEN');
            expect(t.scrapedAt).toBeTruthy();
        }
        // at least one real solicitation should have detail data populated
        expect(tenders.some((t) => t.description !== null)).toBe(true);
    }, 60_000);

    it('paginates across multiple pages when maxItems exceeds one page', async () => {
        const tenders = await fetchTenders(['CLOSED'], false, 150);
        expect(tenders.length).toBeGreaterThan(100); // proves it advanced past the 100-item page size
        const ids = tenders.map((t) => t.advertisementId);
        expect(new Set(ids).size).toBe(ids.length); // no duplicates across pages
    }, 60_000);

    it('respects maxItems as a hard cap', async () => {
        const tenders = await fetchTenders(['CLOSED'], false, 5);
        expect(tenders.length).toBeLessThanOrEqual(5);
    }, 30_000);
});
