import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchFilters } from '../src/types.js';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const load = (name: string): unknown => JSON.parse(readFileSync(`${fixturesDir}/${name}`, 'utf-8'));

const postJsonMock = vi.fn<(path: string, body: unknown) => Promise<unknown>>();
const getJsonOptionalMock = vi.fn<(path: string) => Promise<unknown | null>>();
vi.mock('../src/http.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/http.js')>()),
    postJson: (path: string, body: unknown) => postJsonMock(path, body),
    getJsonOptional: (path: string) => getJsonOptionalMock(path),
}));

const { assertListingPage, buildSearchPayload, fetchDetail, fetchListingCount, fetchListingPage, AD_TYPES } =
    await import('../src/api.js');

const FILTERS: SearchFilters = {
    statuses: ['OPEN'],
    types: ['6'],
    agencyIds: [],
    title: null,
    adNumber: null,
    agencyAdNumber: null,
    publishedDate: null,
    openDate: null,
    endDate: null,
    commodityCodes: ['83112200'],
};

describe('search payload', () => {
    it('is byte-for-byte the body the portal posts (every key present, vendor-only keys empty)', () => {
        expect(buildSearchPayload(FILTERS, 2)).toEqual({
            pageSize: 100,
            type: ['6'],
            status: ['OPEN'],
            agency: [],
            adNumber: '',
            agencyAdvertisementNumber: '',
            title: '',
            publishedDate: '',
            openDate: '',
            endDate: '',
            commodityCodes: ['83112200'],
            intendsToParticipate: '',
            assignee: '',
            page: 2,
        });
    });

    it('knows the 10 advertisement types', () => {
        expect(Object.keys(AD_TYPES)).toHaveLength(10);
        expect(AD_TYPES['1']).toBe('Agency Decision');
        expect(AD_TYPES['10']).toBe('Single Source');
    });
});

describe('listing page validation', () => {
    it('accepts a real captured page and an empty end-of-results page', () => {
        expect(assertListingPage(load('listing_open_page1.json'), 1)).toHaveLength(100);
        expect(assertListingPage(load('listing_open_page3_empty.json'), 3)).toEqual([]);
    });

    it('refuses anything that is not a listing (object, error body, rows without identity)', () => {
        expect(() => assertListingPage(load('error_400.json'), 1)).toThrow(/not a JSON array/);
        expect(() => assertListingPage({ items: [] }, 1)).toThrow(/not a JSON array/);
        expect(() => assertListingPage([{ id: 1 }], 1)).toThrow(/schema changed/);
    });
});

describe('endpoint wrappers (http mocked)', () => {
    beforeEach(() => {
        postJsonMock.mockReset();
        getJsonOptionalMock.mockReset();
    });

    it('fetchListingCount parses the bare integer and rejects anything else', async () => {
        postJsonMock.mockResolvedValueOnce(164);
        await expect(fetchListingCount(FILTERS)).resolves.toBe(164);
        expect(postJsonMock).toHaveBeenCalledWith('/mfmp/pub/search/bids/count', expect.objectContaining({ page: 1 }));
        postJsonMock.mockResolvedValueOnce({ errorMessage: 'x' });
        await expect(fetchListingCount(FILTERS)).rejects.toThrow(/instead of an integer/);
    });

    it('fetchListingPage posts the page number and validates the rows', async () => {
        postJsonMock.mockResolvedValueOnce(load('listing_open_page2.json'));
        const rows = await fetchListingPage(FILTERS, 2);
        expect(rows).toHaveLength(64);
        expect(postJsonMock).toHaveBeenCalledWith('/mfmp/pub/search/bids', expect.objectContaining({ page: 2 }));
    });

    it('fetchDetail returns the record for a known id and null for the all-null body MFMP sends for an unknown id', async () => {
        getJsonOptionalMock.mockResolvedValueOnce(load('detail_14963_amended.json'));
        const detail = await fetchDetail(14963);
        expect(detail?.version).toBe(7);
        expect(detail?.docs).toHaveLength(9);
        expect(getJsonOptionalMock).toHaveBeenCalledWith('/mfmp/pub/search/bids/detail?id=14963');

        getJsonOptionalMock.mockResolvedValueOnce(load('detail_unknown_id.json'));
        await expect(fetchDetail(99999999)).resolves.toBeNull();

        getJsonOptionalMock.mockResolvedValueOnce(null); // a 404 surfaces as null too
        await expect(fetchDetail(1)).resolves.toBeNull();

        getJsonOptionalMock.mockResolvedValueOnce([1, 2]);
        await expect(fetchDetail(1)).rejects.toThrow(/not a JSON object/);
    });
});
