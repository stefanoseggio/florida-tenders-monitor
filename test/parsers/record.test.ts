import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildTenderRecord } from '../../src/parsers/record.js';
import type { DetailData, ListingItem } from '../../src/types.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

function loadFixture<T>(name: string): T {
    return JSON.parse(readFileSync(`${fixturesDir}/${name}`, 'utf-8')) as T;
}

describe('buildTenderRecord', () => {
    it('merges a real listing item with its real detail into a complete record', () => {
        const listing = loadFixture<ListingItem[]>('listing_open.json');
        const detail = loadFixture<DetailData>('detail_16672.json');
        const item = listing.find((i) => i.advertisementId === 16672)!;

        const record = buildTenderRecord(item, detail, '2026-09-04T00:00:00.000Z', true);

        expect(record.advertisementId).toBe(16672);
        expect(record.uniqueName).toBe('AD-16672');
        expect(record.title).toBe('Intent to Award Single Source Provider to Mobex');
        expect(record.status).toBe('OPEN');
        expect(record.agency).toContain('Florida School for the Deaf');
        expect(record.description).toContain('Mobex, Inc.');
    });

    it('resolves document download URLs from the detail attachment IDs', () => {
        const listing = loadFixture<ListingItem[]>('listing_open.json');
        const detail = loadFixture<DetailData>('detail_16672.json');
        const item = listing.find((i) => i.advertisementId === 16672)!;

        const record = buildTenderRecord(item, detail, '2026-09-04T00:00:00.000Z', true);

        expect(record.documents).toHaveLength(1);
        expect(record.documents[0].fileName).toBe('3-Mobex IA-27-044.docx');
        expect(record.documents[0].downloadUrl).toBe(
            'https://vendor.myfloridamarketplace.com/mfmp/bids/detail/attachment/download?attachmentId=39311',
        );
    });

    it('extracts commodity codes and response contact from real detail data', () => {
        const listing = loadFixture<ListingItem[]>('listing_open.json');
        const detail = loadFixture<DetailData>('detail_16672.json');
        const item = listing.find((i) => i.advertisementId === 16672)!;

        const record = buildTenderRecord(item, detail, '2026-09-04T00:00:00.000Z', true);

        expect(record.commodityCodes.length).toBeGreaterThanOrEqual(2);
        expect(record.responseContact?.email).toBe('whitwamk@fsdbk12.org');
    });

    it('falls back to nulls/empty arrays when detail is unavailable (fetchDetail: false path)', () => {
        const listing = loadFixture<ListingItem[]>('listing_open.json');
        const item = listing[0];

        const record = buildTenderRecord(item, null, '2026-09-04T00:00:00.000Z', false);

        expect(record.description).toBeNull();
        expect(record.commodityCodes).toEqual([]);
        expect(record.documents).toEqual([]);
        expect(record.responseContact).toBeNull();
        expect(record.advertisementId).toBe(item.advertisementId);
    });

    describe('B2B integration envelope (record_id/event_type/scraped_at/is_new/source_url)', () => {
        const listing = loadFixture<ListingItem[]>('listing_open.json');
        const item = listing.find((i) => i.advertisementId === 16672)!;

        it('sets record_id to the real advertisementId as a string, not a hash', () => {
            const record = buildTenderRecord(item, null, '2026-09-04T00:00:00.000Z', true);
            expect(record.record_id).toBe('16672');
        });

        it('always sets event_type to NEW_LISTING (no more specific per-domain signal exists)', () => {
            const record = buildTenderRecord(item, null, '2026-09-04T00:00:00.000Z', true);
            expect(record.event_type).toBe('NEW_LISTING');
        });

        it('sets scraped_at to the value passed in, verbatim', () => {
            const record = buildTenderRecord(item, null, '2026-09-04T00:00:00.000Z', true);
            expect(record.scraped_at).toBe('2026-09-04T00:00:00.000Z');
        });

        it('carries is_new through correctly in both directions', () => {
            expect(buildTenderRecord(item, null, '2026-09-04T00:00:00.000Z', true).is_new).toBe(true);
            expect(buildTenderRecord(item, null, '2026-09-04T00:00:00.000Z', false).is_new).toBe(false);
        });

        it('builds source_url from the real advertisementId', () => {
            const record = buildTenderRecord(item, null, '2026-09-04T00:00:00.000Z', true);
            expect(record.source_url).toBe('https://vendor.myfloridamarketplace.com/search/bids/detail/16672');
        });
    });
});
