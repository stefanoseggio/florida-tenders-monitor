import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildRecord } from '../../src/parsers/record.js';
import type { DetailData, ListingItem } from '../../src/types.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

function loadFixture<T>(name: string): T {
    return JSON.parse(readFileSync(`${fixturesDir}/${name}`, 'utf-8')) as T;
}

const NOW = new Date('2026-09-04T00:00:00.000Z');
const NEW = { eventType: 'NEW_LISTING' as const, isNew: true, previous: null };
const listing = loadFixture<ListingItem[]>('listing_open.json');
const detail = loadFixture<DetailData>('detail_16672.json');
const item = listing.find((i) => i.advertisementId === 16672)!;

describe('buildRecord', () => {
    it('merges a real listing item with its real detail into a complete record, keeping every v1 field', () => {
        const record = buildRecord(item, { detail, error: null }, NEW, NOW);

        expect(record.advertisementId).toBe(16672);
        expect(record.uniqueName).toBe('AD-16672');
        expect(record.agencyAdNumber).toBe('IA-27-044');
        expect(record.title).toBe('Intent to Award Single Source Provider to Mobex');
        expect(record.type).toBe('Agency Decision');
        expect(record.status).toBe('OPEN');
        expect(record.agency).toContain('Florida School for the Deaf');
        expect(record.openDate).toBe('2026-09-03T20:30:00.000+00:00');
        expect(record.closeDate).toBe('2026-09-09T20:30:00.000+00:00');
        expect(record.publishDate).toBe('2026-08-13T17:39:51.000+00:00');
        expect(record.description).toContain('Mobex, Inc.');
        expect(record.commodityCodes.length).toBeGreaterThanOrEqual(2);
        expect(record.responseContact?.email).toBe('whitwamk@fsdbk12.org');
    });

    it('resolves document download URLs and keeps the attachment metadata', () => {
        const record = buildRecord(item, { detail, error: null }, NEW, NOW);
        expect(record.documents).toHaveLength(1);
        expect(record.documents[0].fileName).toBe('3-Mobex IA-27-044.docx');
        expect(record.documents[0].downloadUrl).toBe(
            'https://vendor.myfloridamarketplace.com/mfmp/bids/detail/attachment/download?attachmentId=39311',
        );
        expect(record.documents[0].attachmentId).toBe(39311);
        expect(record.documents[0].dateUtc).toBe('2026-08-13T17:39:44.000Z');
        expect(record.documentCount).toBe(1);
    });

    it('adds the award-tracking fields: linked solicitation, response date, flags, flattened contact', () => {
        const record = buildRecord(item, { detail, error: null }, NEW, NOW);
        expect(record.isAwardNotice).toBe(true);
        expect(record.isSingleSource).toBe(false);
        expect(record.linkedAdNumber).toBe('16671');
        expect(record.linkedAdUrl).toBe('https://vendor.myfloridamarketplace.com/search/bids/detail/16671');
        expect(record.responseDateUtc).toBe('2026-09-09T20:30:00.000Z');
        expect(record.publishOption).toBe('Schedule Start');
        expect(record.lastUpdateDateUtc).toBe('2026-08-13T17:39:51.000Z');
        expect(record.version).toBe(1);
        expect(record.isAmended).toBe(false);
        expect(record.contactName).toBe('Kim Whitwam');
        expect(record.contactPhone).toBe('(904) 827-2356');
        expect(record.contactAddress).toBe('207 San Marco Ave.');
        expect(record.contactCity).toBe('SAINT AUGUSTINE');
        expect(record.contactState).toBe('FL');
        expect(record.descriptionText).toContain('Single Source Award to: Mobex, Inc.');
        expect(record.descriptionText).not.toMatch(/<p>|&nbsp;/);
        expect(record.amountsUsd).toEqual([]);
        expect(record.maxAmountUsd).toBeNull();
    });

    it('computes the normalised date twins and the open/close maths', () => {
        const record = buildRecord(item, { detail, error: null }, NEW, NOW);
        expect(record.publishDateUtc).toBe('2026-08-13T17:39:51.000Z');
        expect(record.openDateUtc).toBe('2026-09-03T20:30:00.000Z');
        expect(record.closeDateUtc).toBe('2026-09-09T20:30:00.000Z');
        expect(record.openDateLocal).toBe('2026-09-03 16:30 EDT'); // "4:30 PM" in the ad body
        expect(record.closeDateLocal).toBe('2026-09-09 16:30 EDT');
        expect(record.publishDay).toBe('2026-08-13');
        expect(record.closeDay).toBe('2026-09-09');
        expect(record.responseWindowDays).toBe(6);
        expect(record.daysUntilClose).toBe(5);
        expect(record.isOpenForResponses).toBe(true);
        const later = buildRecord(item, { detail, error: null }, NEW, new Date('2026-09-20T00:00:00.000Z'));
        expect(later.isOpenForResponses).toBe(false);
        expect(later.daysUntilClose).toBe(-10);
    });

    it('falls back to nulls/empty arrays when detail is unavailable (fetchDetail: false path)', () => {
        const record = buildRecord(listing[0], null, { ...NEW, isNew: false }, NOW);
        expect(record.description).toBeNull();
        expect(record.descriptionText).toBeNull();
        expect(record.commodityCodes).toEqual([]);
        expect(record.documents).toEqual([]);
        expect(record.documentCount).toBeNull();
        expect(record.responseContact).toBeNull();
        expect(record.contactEmail).toBeNull();
        expect(record.indicators).toBeNull();
        expect(record.detailFetched).toBe(false);
        expect(record.detailError).toBeNull();
        expect(record.advertisementId).toBe(listing[0].advertisementId);
        expect(record.is_new).toBe(false);
    });

    it('records the failure reason when a detail fetch was attempted and failed', () => {
        const record = buildRecord(item, { detail: null, error: 'NOT_FOUND' }, NEW, NOW);
        expect(record.detailFetched).toBe(false);
        expect(record.detailError).toBe('NOT_FOUND');
    });

    describe('B2B integration envelope (record_id/event_type/scraped_at/is_new/source_url)', () => {
        it('sets record_id to the real advertisementId as a string, not a hash', () => {
            expect(buildRecord(item, null, NEW, NOW).record_id).toBe('16672');
        });

        it('carries the event type and previous state through', () => {
            const r = buildRecord(
                item,
                null,
                { eventType: 'UPDATED', isNew: false, previous: { version: 0, status: 'OPEN', updatedAt: null } },
                NOW,
            );
            expect(r.event_type).toBe('UPDATED');
            expect(r.previousVersion).toBe(0);
            expect(r.previousStatus).toBe('OPEN');
            expect(r.is_new).toBe(false);
        });

        it('sets scraped_at to the run instant and source_url from the real advertisementId', () => {
            const r = buildRecord(item, null, NEW, NOW);
            expect(r.scraped_at).toBe('2026-09-04T00:00:00.000Z');
            expect(r.source_url).toBe('https://vendor.myfloridamarketplace.com/search/bids/detail/16672');
            expect(r.data_source).toContain('vendor.myfloridamarketplace.com');
        });
    });
});
