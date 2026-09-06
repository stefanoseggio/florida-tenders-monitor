import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListingItem } from '../src/types.js';

// Delta engine (onlyNew/dateRange) unit tests against a real captured
// fixture, with the network layer mocked out - same top-level
// vi.mock('../src/http.js', ...) + dynamic re-import pattern used by
// uk-hse-enforcement-monitor's test/fetchListingIds.test.ts. This lives in
// its own file (rather than alongside fetchTenders.test.ts) because
// vi.mock is file-scoped: mixing it into the same file as the live,
// unmocked tests would silently make those live tests hit the mock instead
// of the real network.
//
// `fetchDetail: false` is used throughout so these tests only need to mock
// the listing endpoint (apiPost) - detail merging is already covered by
// test/parsers/record.test.ts against the same fixtures.
//
// Note on early-stop: unlike uk-hse-enforcement-monitor, this actor does
// NOT implement early-stop pagination for onlyNew (see the design note atop
// src/fetchTenders.ts - MFMP's listing order is not verified newest-first).
// There is therefore no "stops after 2 consecutive fully-known pages"
// behavior to assert here; the real listing_open.json fixture used below is
// a single page of 3 items (well under PAGE_SIZE), so the loop always
// terminates naturally via the "items.length < PAGE_SIZE" branch, onlyNew
// or not - these tests confirm the FILTERING is correct, not an early
// termination that this actor deliberately does not have.
const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const LISTING_OPEN: ListingItem[] = JSON.parse(
    readFileSync(`${fixturesDir}/listing_open.json`, 'utf-8'),
) as ListingItem[];
const ALL_IDS = LISTING_OPEN.map((i) => String(i.advertisementId)); // ['16672', '16833', '16851']

const apiPostMock = vi.fn<(path: string, body: unknown) => Promise<{ json: () => Promise<unknown> }>>();
const apiGetMock = vi.fn<(path: string) => Promise<{ json: () => Promise<unknown> }>>();

vi.mock('../src/http.js', async () => {
    const actual = await vi.importActual<typeof import('../src/http.js')>('../src/http.js');
    return {
        ...actual, // keep the real attachmentDownloadUrl (pure URL builder, no network)
        apiPost: (path: string, body: unknown) => apiPostMock(path, body),
        apiGet: (path: string) => apiGetMock(path),
    };
});

const { fetchTenders } = await import('../src/fetchTenders.js');

describe('fetchTenders delta engine (onlyNew / dateRange), mocked http against a real captured fixture', () => {
    beforeEach(() => {
        apiPostMock.mockReset();
        apiGetMock.mockReset();
        // Page 1 = the real 3-item fixture; any further page = empty (never
        // actually reached here, since 3 < PAGE_SIZE ends the walk at page 1).
        apiPostMock.mockImplementation(async (_path, body) => {
            const { page } = body as { page: number };
            return { json: async () => (page === 1 ? LISTING_OPEN : []) };
        });
    });

    it('(a) cold run: empty seen-set marks every record is_new=true', async () => {
        const { results, allIdsThisRun } = await fetchTenders(
            ['OPEN'],
            false,
            100,
            new Set(),
            false,
            undefined,
            new Date(),
        );

        expect(results).toHaveLength(3);
        expect(results.every((r) => r.is_new)).toBe(true);
        expect(results.map((r) => r.record_id).sort()).toEqual([...ALL_IDS].sort());
        expect(allIdsThisRun.sort()).toEqual([...ALL_IDS].sort());
        expect(apiPostMock).toHaveBeenCalledTimes(1); // 3 items < PAGE_SIZE -> stops at page 1
    });

    it('(b) onlyNew=true with a fully-seen state: returns zero records but still reports every id it walked', async () => {
        const seenIds = new Set(ALL_IDS);
        const { results, allIdsThisRun } = await fetchTenders(
            ['OPEN'],
            false,
            100,
            seenIds,
            true,
            undefined,
            new Date(),
        );

        expect(results).toHaveLength(0);
        // Proves this is a post-filter, not early-stop: the listing was
        // still fully walked and every id reported for state-saving, even
        // though nothing was new enough to keep.
        expect(allIdsThisRun.sort()).toEqual([...ALL_IDS].sort());
    });

    it('onlyNew=true with a partially-seen state: returns only the genuinely unseen records', async () => {
        const seenIds = new Set(['16672']); // everything except this one is new
        const { results } = await fetchTenders(['OPEN'], false, 100, seenIds, true, undefined, new Date());

        expect(results.map((r) => r.record_id).sort()).toEqual(['16833', '16851']);
        expect(results.every((r) => r.is_new)).toBe(true);
    });

    it('onlyNew=false still computes is_new correctly (a full run tells the consumer what happens to be new)', async () => {
        const seenIds = new Set(['16672']);
        const { results } = await fetchTenders(['OPEN'], false, 100, seenIds, false, undefined, new Date());

        expect(results).toHaveLength(3); // nothing filtered out
        const byId = new Map(results.map((r) => [r.record_id, r.is_new]));
        expect(byId.get('16672')).toBe(false);
        expect(byId.get('16833')).toBe(true);
        expect(byId.get('16851')).toBe(true);
    });

    it('(c) dateRange excludes records whose publishDate falls outside the window', async () => {
        // Fixture publishDates: 16672 -> 2026-08-13, 16833 -> 2026-09-02 (17:13),
        // 16851 -> 2026-09-02 (19:04). A "7d" window from 2026-09-06T12:00:00Z
        // includes both Sep-02 records and excludes the Aug-13 one.
        const now = new Date('2026-09-06T12:00:00.000Z');
        const { results } = await fetchTenders(['OPEN'], false, 100, new Set(), false, '7d', now);

        expect(results.map((r) => r.record_id).sort()).toEqual(['16833', '16851']);
    });

    it('dateRange and onlyNew combine (both filters apply)', async () => {
        const now = new Date('2026-09-06T12:00:00.000Z');
        const seenIds = new Set(['16833']); // already seen, would otherwise pass the date filter
        const { results } = await fetchTenders(['OPEN'], false, 100, seenIds, true, '7d', now);

        expect(results.map((r) => r.record_id)).toEqual(['16851']);
    });
});
