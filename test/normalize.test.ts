import { describe, expect, it } from 'vitest';

import {
    daysBetween,
    daysUntil,
    htmlToText,
    normalizeAdNumber,
    parseUsdAmounts,
    shortHash,
    toSiteLocal,
    toUtcIso,
    utcCalendarDay,
    yesNoToBoolean,
} from '../src/normalize.js';

describe('MFMP timestamps (UTC instants with a +00:00 offset)', () => {
    it('canonicalises to the Z form and rejects garbage', () => {
        expect(toUtcIso('2026-08-13T17:39:51.000+00:00')).toBe('2026-08-13T17:39:51.000Z');
        expect(toUtcIso('2026-09-09T20:30:00.000+00:00')).toBe('2026-09-09T20:30:00.000Z');
        expect(toUtcIso('not a date')).toBeNull();
        expect(toUtcIso('')).toBeNull();
        expect(toUtcIso(null)).toBeNull();
    });

    it('reports the UTC calendar day - the granularity of the portal publishedDate filter', () => {
        expect(utcCalendarDay('2026-09-02T22:59:00.000+00:00')).toBe('2026-09-02'); // still 2 Sep in UTC (18:59 EDT)
        expect(utcCalendarDay(null)).toBeNull();
    });

    it('renders the Florida wall-clock twin with the right DST label', () => {
        // "4:30 PM" per the advertisement body - EDT in September
        expect(toSiteLocal('2026-09-09T20:30:00.000+00:00')).toBe('2026-09-09 16:30 EDT');
        // January = EST (UTC-5)
        expect(toSiteLocal('2026-01-23T22:43:58.000+00:00')).toBe('2026-01-23 17:43 EST');
        // A UTC instant just after midnight is still the previous evening in Florida
        expect(toSiteLocal('2026-09-10T02:15:00.000+00:00')).toBe('2026-09-09 22:15 EDT');
        expect(toSiteLocal(null)).toBeNull();
    });

    it('does signed day maths', () => {
        const now = new Date('2026-09-08T02:23:39.000Z');
        expect(daysUntil('2026-09-09T20:30:00.000+00:00', now)).toBe(1);
        expect(daysUntil('2026-10-15T20:00:00.000+00:00', now)).toBe(37);
        expect(daysUntil('2026-09-02T15:30:00.000+00:00', now)).toBe(-5);
        expect(daysUntil(null, now)).toBeNull();
        expect(daysBetween('2026-09-03T20:30:00.000+00:00', '2026-09-09T20:30:00.000+00:00')).toBe(6);
        expect(daysBetween('2026-01-23T22:43:58.000+00:00', '2026-10-15T20:00:00.000+00:00')).toBe(264);
        expect(daysBetween(null, '2026-09-09T20:30:00.000+00:00')).toBeNull();
    });
});

describe('description HTML', () => {
    it('renders readable plain text with line breaks and decoded entities', () => {
        const html =
            '<p>Single Source Award to: <strong>Mobex, Inc.</strong></p><p>&nbsp;</p><p>Version Number: 000</p><p>83112403 &ndash; Point to point&nbsp;&nbsp;&nbsp;circuit</p><ul><li>one</li><li>two &amp; three</li></ul>';
        expect(htmlToText(html)).toBe(
            'Single Source Award to: Mobex, Inc.\nVersion Number: 000\n83112403 – Point to point circuit\none\ntwo & three',
        );
        expect(htmlToText('<p>&nbsp;</p>')).toBeNull();
        expect(htmlToText(null)).toBeNull();
    });

    it('extracts dollar figures in order, de-duplicated', () => {
        expect(
            parseUsdAmounts('Estimated value $1,250,000.00 (not to exceed $1,250,000.00); fee $500 per unit'),
        ).toEqual([1250000, 500]);
        expect(parseUsdAmounts('no money here')).toEqual([]);
        expect(parseUsdAmounts(null)).toEqual([]);
    });
});

describe('identifiers and flags', () => {
    it('normalises advertisement numbers to the bare id', () => {
        expect(normalizeAdNumber('AD-16672')).toBe('16672');
        expect(normalizeAdNumber('GO-14963')).toBe('14963');
        expect(normalizeAdNumber(' 16672 ')).toBe('16672');
        expect(normalizeAdNumber('AD-00015')).toBe('15');
        expect(normalizeAdNumber('nope')).toBeNull();
    });

    it('maps yes/no and booleans', () => {
        expect(yesNoToBoolean(true)).toBe(true);
        expect(yesNoToBoolean('No')).toBe(false);
        expect(yesNoToBoolean('maybe')).toBeNull();
        expect(yesNoToBoolean(undefined)).toBeNull();
    });

    it('hashes stably', () => {
        expect(shortHash('a')).toBe(shortHash('a'));
        expect(shortHash('a')).not.toBe(shortHash('b'));
        expect(shortHash('x')).toMatch(/^[0-9a-f]{8}$/);
    });
});
