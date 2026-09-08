import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotJsonError } from '../src/http.js';
import { toUtcIso } from '../src/normalize.js';
import type { DeltaState, SeenEntry } from '../src/state.js';
import { emptyState, recordWalkCoverage } from '../src/state.js';
import type { ListingItem, SearchFilters } from '../src/types.js';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const load = <T>(name: string): T => JSON.parse(readFileSync(`${fixturesDir}/${name}`, 'utf-8')) as T;
// Real captured OPEN listing (2026-09-07): 100 + 64 rows, ordered by type name then advertisementId.
const PAGE1 = load<ListingItem[]>('listing_open_page1.json');
const PAGE2 = load<ListingItem[]>('listing_open_page2.json');
const ALL = [...PAGE1, ...PAGE2];
const DETAIL_AMENDED = load<unknown>('detail_14963_amended.json');
const DETAIL_UNKNOWN = load<unknown>('detail_unknown_id.json');

const postJsonMock = vi.fn<(path: string, body: { page: number }) => Promise<unknown>>();
const getJsonOptionalMock = vi.fn<(path: string) => Promise<unknown | null>>();
vi.mock('../src/http.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/http.js')>()),
    postJson: (path: string, body: { page: number }) => postJsonMock(path, body),
    getJsonOptional: (path: string) => getJsonOptionalMock(path),
}));

const { walkListing, enrichBatch, fetchTenders } = await import('../src/fetchTenders.js');

const FILTERS: SearchFilters = {
    statuses: ['OPEN'],
    types: [],
    agencyIds: [],
    title: null,
    adNumber: null,
    agencyAdNumber: null,
    publishedDate: null,
    openDate: null,
    endDate: null,
    commodityCodes: [],
};
const ALL_EVENTS = new Set(['NEW_LISTING', 'UPDATED', 'STATUS_CHANGE'] as const);
const NOW = new Date('2026-09-08T02:00:00.000Z');

/** Serve `count` from /count and the given pages from /bids (anything past the end -> []). */
function serve(count: number, ...pages: ListingItem[][]): void {
    postJsonMock.mockImplementation(async (path, body) => {
        if (path.endsWith('/count')) return count;
        return pages[body.page - 1] ?? [];
    });
}
function walk(overrides: Partial<Parameters<typeof walkListing>[0]> = {}) {
    return walkListing({
        filters: FILTERS,
        maxItems: 1000,
        onlyNew: false,
        seen: {},
        agencyNameContains: null,
        eventTypes: ALL_EVENTS,
        maxConcurrency: 3,
        ...overrides,
    });
}
function seenOf(items: ListingItem[]): Record<string, SeenEntry> {
    const seen: Record<string, SeenEntry> = {};
    for (const i of items) seen[String(i.advertisementId)] = { version: i.version, status: i.status, updatedAt: null };
    return seen;
}
const newestFirst = (items: ListingItem[]) =>
    [...items].sort((a, b) => (b.publishDate + b.advertisementId).localeCompare(a.publishDate + a.advertisementId));

describe('walkListing against real captured pages', () => {
    beforeEach(() => {
        postJsonMock.mockReset();
        getJsonOptionalMock.mockReset();
    });

    it('cold full run: walks every page (count-driven), reads the exact total, delivers all 164 rows newest-published first', async () => {
        serve(164, PAGE1, PAGE2);
        const result = await walk();
        expect(result.candidates).toHaveLength(164);
        expect(result.excluded).toEqual([]);
        expect(result.totalMatching).toBe(164);
        expect(result.pagesWalked).toBe(2);
        expect(result.rowsWalked).toBe(164);
        expect(result.stopReason).toBe('end-of-results');
        expect(result.truncatedByMaxItems).toBe(false);
        expect(result.candidates.every((c) => c.eventType === 'NEW_LISTING' && c.isNew)).toBe(true);
        // priority order = newest publishDate first (the site itself has no timestamp sort)
        expect(result.candidates.map((c) => c.item.advertisementId)).toEqual(
            newestFirst(ALL).map((i) => i.advertisementId),
        );
        // /count + 2 pages, nothing else
        expect(postJsonMock).toHaveBeenCalledTimes(3);
    });

    it('keeps paging past the count when the listing grew between /count and the page fetches', async () => {
        serve(100, PAGE1, PAGE2); // count says 1 page, but page 1 comes back full -> page 2 (64 rows, so the end) is fetched too
        const result = await walk();
        expect(result.candidates).toHaveLength(164);
        expect(result.pagesWalked).toBe(2);
        expect(postJsonMock).toHaveBeenCalledTimes(3);

        const PAGE2_FULL = PAGE1.map((i) => ({ ...i, advertisementId: i.advertisementId + 100_000 }));
        serve(100, PAGE1, PAGE2_FULL); // page 2 also full -> page 3 (empty) is fetched to find the end
        const grown = await walk();
        expect(grown.candidates).toHaveLength(200);
        expect(grown.pagesWalked).toBe(3);
    });

    it('de-duplicates rows that repeat across pages when the listing shifts under the walk', async () => {
        serve(200, PAGE1, PAGE1);
        const result = await walk();
        expect(result.candidates).toHaveLength(100);
        expect(new Set(result.candidates.map((c) => c.item.advertisementId)).size).toBe(100);
    });

    it('caps delivery at maxItems with the NEWEST rows, reports the overflow and never marks it seen', async () => {
        serve(164, PAGE1, PAGE2);
        const result = await walk({ maxItems: 10 });
        expect(result.candidates).toHaveLength(10);
        expect(result.overflow).toBe(154);
        expect(result.truncatedByMaxItems).toBe(true);
        expect(result.stopReason).toBe('max-items');
        expect(result.candidates.map((c) => c.item.advertisementId)).toEqual(
            newestFirst(ALL)
                .slice(0, 10)
                .map((i) => i.advertisementId),
        );
        expect(result.excluded).toEqual([]); // overflow is not "excluded" - it stays undelivered and unseen
    });

    it('delta: a fully-known listing (same version, same status) yields nothing', async () => {
        serve(164, PAGE1, PAGE2);
        const result = await walk({ onlyNew: true, seen: seenOf(ALL) });
        expect(result.candidates).toEqual([]);
        expect(result.excluded).toHaveLength(164);
        expect(result.excluded.every((c) => c.excludedBy === 'unchanged')).toBe(true);
    });

    it('delta: version rise -> UPDATED, status flip -> STATUS_CHANGE, unseen -> NEW_LISTING; changes rank first', async () => {
        serve(164, PAGE1, PAGE2);
        const seen = seenOf(ALL);
        const amended = ALL.find((i) => i.advertisementId === 14963)!; // GO-14963, version 7 on the site
        seen['14963'] = { version: 6, status: 'OPEN', updatedAt: '2026-08-03T15:33:21.000Z' };
        seen['16672'] = { version: 1, status: 'PREVIEW', updatedAt: null }; // was in preview, now OPEN
        delete seen['16851']; // never delivered
        const result = await walk({ onlyNew: true, seen });
        expect(result.candidates.map((c) => [c.item.advertisementId, c.eventType, c.isNew])).toEqual([
            [16672, 'STATUS_CHANGE', false],
            [14963, 'UPDATED', false],
            [16851, 'NEW_LISTING', true],
        ]);
        expect(amended.version).toBe(7);
        expect(result.candidates[1].previous).toEqual({
            version: 6,
            status: 'OPEN',
            updatedAt: '2026-08-03T15:33:21.000Z',
        });
        expect(result.excluded).toHaveLength(161);
    });

    it('delta: a version stored as null (unknown) never produces an UPDATED storm', async () => {
        serve(164, PAGE1, PAGE2);
        const seen = seenOf(ALL);
        for (const entry of Object.values(seen)) entry.version = null;
        const result = await walk({ onlyNew: true, seen });
        expect(result.candidates).toEqual([]);
    });

    it('applies the client-side agency, event-type and publish-window filters and reports why rows were excluded', async () => {
        serve(164, PAGE1, PAGE2);
        const byAgency = await walk({ agencyNameContains: 'fdot' });
        expect(byAgency.candidates.length).toBeGreaterThan(0);
        expect(byAgency.candidates.every((c) => c.item.organization.shortName === 'FDOT')).toBe(true);
        expect(byAgency.excluded.every((c) => c.excludedBy === 'agency')).toBe(true);

        const seen = seenOf(ALL);
        seen['14963'] = { version: 6, status: 'OPEN', updatedAt: null };
        delete seen['16851'];
        const onlyUpdates = await walk({ onlyNew: true, seen, eventTypes: new Set(['UPDATED'] as const) });
        expect(onlyUpdates.candidates.map((c) => c.item.advertisementId)).toEqual([14963]);
        expect(onlyUpdates.excluded.find((c) => c.item.advertisementId === 16851)?.excludedBy).toBe('eventType');

        const window = await walk({ dateFrom: '2026-09-02', dateTo: '2026-09-02' });
        expect(window.candidates).toHaveLength(9); // live-verified: 9 ads published on 2026-09-02 (UTC)
        expect(window.candidates.every((c) => c.item.publishDate.startsWith('2026-09-02'))).toBe(true);
        expect(window.excluded.every((c) => c.excludedBy === 'dateWindow')).toBe(true);
    });

    it('refuses to mistake a blocked page, an error body or a changed schema for "nothing new"', async () => {
        postJsonMock.mockImplementation(async (path) => {
            if (path.endsWith('/count')) return 164;
            throw new NotJsonError('https://vendor.myfloridamarketplace.com/mfmp/pub/search/bids', 'text/html');
        });
        await expect(walk()).rejects.toThrow(/index\.html shell/);

        postJsonMock.mockImplementation(async (path) => (path.endsWith('/count') ? 164 : { errorMessage: 'x' }));
        await expect(walk()).rejects.toThrow(/not a JSON array/);

        postJsonMock.mockImplementation(async () => 'OK');
        await expect(walk()).rejects.toThrow(/instead of an integer/);
    });
});

describe('the two floors of the delta memory (MFMP has no timestamp sort, so every run walks every page)', () => {
    beforeEach(() => {
        postJsonMock.mockReset();
    });

    it('BASELINE: a cold run cut short by maxItems delivers the newest block; the next run treats the older 154 rows as history, and a later amendment of one of them still surfaces as UPDATED', async () => {
        serve(164, PAGE1, PAGE2);
        const state: DeltaState = emptyState('sig');

        // Run 1 (cold, maxItems 10): the 10 most recently published ads.
        const first = await walk({ onlyNew: true, seen: state.seen, maxItems: 10 });
        expect(first.candidates).toHaveLength(10);
        const oldestDelivered = first.candidates.at(-1)!;
        recordWalkCoverage(state, true, first.truncatedByMaxItems, oldestDelivered.publishDateUtc);
        expect(state.baselineFloor).toBe(toUtcIso(oldestDelivered.item.publishDate));
        expect(state.backlogFloor).toBeNull();
        for (const c of first.candidates) {
            state.seen[String(c.item.advertisementId)] = {
                version: c.item.version,
                status: c.item.status,
                updatedAt: null,
            };
        }
        state.lastRunAt = '2026-09-07T00:00:00.000Z';

        // Run 2: nothing new on the site -> 0 delivered, the 154 older rows are excluded as baseline (not backlog).
        const second = await walk({
            onlyNew: true,
            seen: state.seen,
            maxItems: 10,
            baselineFloor: state.baselineFloor,
        });
        expect(second.candidates).toEqual([]);
        expect(second.excluded.filter((c) => c.excludedBy === 'baseline')).toHaveLength(154);
        expect(second.excluded.filter((c) => c.excludedBy === 'unchanged')).toHaveLength(10);
        recordWalkCoverage(state, false, second.truncatedByMaxItems, null);
        expect(state.baselineFloor).not.toBeNull(); // only resetState clears the baseline
        // main.ts marks excluded rows seen at the end of the run:
        for (const c of second.excluded) {
            state.seen[String(c.item.advertisementId)] = {
                version: c.item.version,
                status: c.item.status,
                updatedAt: null,
            };
        }

        // Run 3: an agency posts an addendum to one of the "history" ads (version 1 -> 2) -> UPDATED, nothing else.
        const target = ALL.find((i) => i.advertisementId === 16672)!;
        expect(target.publishDate < oldestDelivered.item.publishDate).toBe(true); // it really is below the baseline
        const bumped = ALL.map((i) => (i.advertisementId === 16672 ? { ...i, version: i.version + 1 } : i));
        serve(164, bumped.slice(0, 100), bumped.slice(100));
        const third = await walk({ onlyNew: true, seen: state.seen, maxItems: 10, baselineFloor: state.baselineFloor });
        expect(third.candidates.map((c) => [c.item.advertisementId, c.eventType])).toEqual([[16672, 'UPDATED']]);
    });

    it('BACKLOG: a non-cold run cut short by maxItems leaves the rest unseen; the next run walks through the delivered block and delivers exactly the remainder, then clears the floor', async () => {
        serve(164, PAGE1, PAGE2);
        // A store that already completed a run knowing the 50 lowest ids (an earlier, smaller register).
        const known = [...ALL].sort((a, b) => a.advertisementId - b.advertisementId).slice(0, 50);
        const state: DeltaState = emptyState('sig');
        Object.assign(state.seen, seenOf(known));
        state.lastRunAt = '2026-09-01T00:00:00.000Z';

        // Run A: 114 new ads, maxItems 20 -> the 20 newest are delivered, 94 stay unseen.
        const a = await walk({ onlyNew: true, seen: state.seen, maxItems: 20 });
        expect(a.candidates).toHaveLength(20);
        expect(a.overflow).toBe(94);
        recordWalkCoverage(state, false, a.truncatedByMaxItems, a.candidates.at(-1)!.publishDateUtc);
        expect(state.backlogFloor).toBe(a.candidates.at(-1)!.publishDateUtc);
        expect(state.baselineFloor).toBeNull(); // a non-cold run never sets a baseline
        const deliveredA = a.candidates.map((c) => c.item.advertisementId);
        for (const c of a.candidates) {
            state.seen[String(c.item.advertisementId)] = {
                version: c.item.version,
                status: c.item.status,
                updatedAt: null,
            };
        }

        // Run B: walks through the 20 delivered (now "unchanged") and delivers the 94 below the floor - none twice.
        const b = await walk({
            onlyNew: true,
            seen: state.seen,
            maxItems: 1000,
            backlogFloor: state.backlogFloor,
            baselineFloor: state.baselineFloor,
        });
        expect(b.candidates).toHaveLength(94);
        expect(b.candidates.every((c) => c.isNew && !deliveredA.includes(c.item.advertisementId))).toBe(true);
        expect(b.candidates.every((c) => c.publishDateUtc! <= state.backlogFloor!)).toBe(true);
        expect(b.excluded.filter((c) => c.excludedBy === 'unchanged')).toHaveLength(70);
        recordWalkCoverage(state, false, b.truncatedByMaxItems, null);
        expect(state.backlogFloor).toBeNull();
    });
});

describe('enrichBatch / fetchTenders record shape', () => {
    beforeEach(() => {
        postJsonMock.mockReset();
        getJsonOptionalMock.mockReset();
    });

    it('builds a full record with envelope, normalised twins and detail fields from a real amended grant opportunity', async () => {
        serve(164, PAGE1, PAGE2);
        getJsonOptionalMock.mockResolvedValue(DETAIL_AMENDED);
        const { records } = await fetchTenders({
            filters: { ...FILTERS, adNumber: '14963' },
            maxItems: 1,
            onlyNew: false,
            seen: { '14963': { version: 6, status: 'OPEN', updatedAt: null } },
            agencyNameContains: 'DCF',
            eventTypes: ALL_EVENTS,
            maxConcurrency: 2,
            fetchDetail: true,
            now: NOW,
        });
        expect(records).toHaveLength(1);
        const r = records[0];
        expect(r.record_id).toBe('14963');
        expect(r.uniqueName).toBe('GO-14963');
        expect(r.event_type).toBe('UPDATED');
        expect(r.is_new).toBe(false);
        expect(r.previousVersion).toBe(6);
        expect(r.previousStatus).toBe('OPEN');
        expect(r.version).toBe(7);
        expect(r.isAmended).toBe(true);
        expect(r.scraped_at).toBe(NOW.toISOString());
        expect(r.source_url).toBe('https://vendor.myfloridamarketplace.com/search/bids/detail/14963');
        expect(r.data_source).toMatch(/MyFloridaMarketPlace/);
        expect(r.typeId).toBe('2');
        expect(r.organizationId).toBe(30000023);
        expect(r.organizationShortName).toBe('DCF');
        expect(r.organizationEntity).toBe('600000');
        expect(r.publishDateUtc).toBe('2026-01-23T22:43:58.000Z');
        expect(r.publishDateLocal).toBe('2026-01-23 17:43 EST');
        expect(r.closeDateUtc).toBe('2026-10-15T20:00:00.000Z');
        expect(r.closeDateLocal).toBe('2026-10-15 16:00 EDT');
        expect(r.closeDay).toBe('2026-10-15');
        expect(r.responseWindowDays).toBe(264);
        expect(r.daysUntilClose).toBe(37);
        expect(r.isOpenForResponses).toBe(true);
        expect(r.detailFetched).toBe(true);
        expect(r.detailError).toBeNull();
        expect(r.lastUpdateDateUtc).toBe('2026-09-03T21:04:36.000Z');
        expect(r.responseDateUtc).toBe('2026-03-19T15:00:00.000Z');
        expect(r.responseDateLocal).toBe('2026-03-19 11:00 EDT');
        expect(r.publishOption).toBe('Start Immediately');
        expect(r.withdrawn).toBe(false);
        expect(r.timeRemainingMs).toBe((DETAIL_AMENDED as { timeRemaining: number }).timeRemaining);
        expect(r.descriptionText).toMatch(/^09\/03\/2026: Addendum No\. 06 posted with timeline update\.\n/);
        expect(r.description).toMatch(/^<p>/);
        expect(r.commodityCodeIds).toEqual(['93131700', '93141503', '93141507', '93141808']);
        expect(r.commodityCodesText).toMatch(/^93131700 Health programs; /);
        expect(r.documentCount).toBe(9);
        expect(r.documents[0]).toEqual({
            fileName: 'DCF RFA 2526 024.pdf',
            downloadUrl:
                'https://vendor.myfloridamarketplace.com/mfmp/bids/detail/attachment/download?attachmentId=35449',
            attachmentId: 35449,
            description: 'DCF RFA 2526 024 - CJMHSA Reinvestment Grant Program',
            date: '2026-01-23T22:40:31.000+00:00',
            dateUtc: '2026-01-23T22:40:31.000Z',
            version: null,
            docFor: 'advertisementDocuments',
        });
        expect(r.documents.at(-1)?.description).toBe('Addendum No. 06');
        expect(r.latestDocumentDateUtc).toBe('2026-09-03T21:04:37.000Z');
        expect(r.indicators).toEqual({
            minorityEncouraged: false,
            preSolicitationConference: false,
            disabilitiesAct: false,
            rightToReject: false,
            agencyContactPeriod: false,
        });
        expect(r.rightToReject).toBe(false);
        expect(r.contactName).toBe('Joshua Burns');
        expect(r.contactEmail).toBe('joshua.burns@myflfamilies.com');
        expect(r.contactPhone).toBe('(000) 000-0000');
        expect(r.contactCity).toBe('Tallahassee');
        expect(r.contactZip).toBe('32303');
        expect(r.responseContact?.email).toBe('joshua.burns@myflfamilies.com'); // v1 object kept
        expect(r.linkedAdNumber).toBeNull();
        expect(r.currency).toBe('USD');
    });

    it('degrades to a summary record (detailFetched=false, NOT_FOUND) when MFMP answers the all-null detail, instead of failing the run', async () => {
        serve(164, PAGE1, PAGE2);
        getJsonOptionalMock.mockResolvedValue(DETAIL_UNKNOWN);
        const { candidates } = await walk({ maxItems: 1 });
        const [r] = await enrichBatch(candidates, { fetchDetail: true, maxConcurrency: 1, now: NOW });
        expect(r.detailFetched).toBe(false);
        expect(r.detailError).toBe('NOT_FOUND');
        expect(r.title).toBeTruthy(); // listing fields survive
        expect(r.description).toBeNull();
        expect(r.documents).toEqual([]);
        expect(r.documentCount).toBeNull();
        expect(r.commodityCodes).toEqual([]);
    });

    it('degrades to a summary record when the detail request fails after retries', async () => {
        serve(164, PAGE1, PAGE2);
        getJsonOptionalMock.mockRejectedValue(new Error('HTTP 503 for detail'));
        const { candidates } = await walk({ maxItems: 2 });
        const records = await enrichBatch(candidates, { fetchDetail: true, maxConcurrency: 2, now: NOW });
        expect(records.every((r) => !r.detailFetched && r.detailError === 'HTTP 503 for detail')).toBe(true);
    });

    it('listing-only mode never touches the detail endpoint', async () => {
        serve(164, PAGE1, PAGE2);
        const { candidates } = await walk({ maxItems: 3 });
        const records = await enrichBatch(candidates, { fetchDetail: false, maxConcurrency: 5, now: NOW });
        expect(records).toHaveLength(3);
        expect(records.every((r) => !r.detailFetched && r.detailError === null)).toBe(true);
        expect(getJsonOptionalMock).not.toHaveBeenCalled();
    });
});
