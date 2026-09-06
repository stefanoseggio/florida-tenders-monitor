import { describe, expect, it } from 'vitest';

import { isWithinDateRange, parseIsoDate } from '../src/dateFilter.js';

describe('parseIsoDate', () => {
    it('parses a real MFMP publishDate string (ISO-8601 with explicit offset)', () => {
        const date = parseIsoDate('2026-08-13T17:39:51.000+00:00');
        expect(date).not.toBeNull();
        expect(date?.toISOString()).toBe('2026-08-13T17:39:51.000Z');
    });

    it('returns null for null/undefined/empty/garbage input', () => {
        expect(parseIsoDate(null)).toBeNull();
        expect(parseIsoDate(undefined)).toBeNull();
        expect(parseIsoDate('')).toBeNull();
        expect(parseIsoDate('not a date')).toBeNull();
    });
});

describe('isWithinDateRange', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');

    it('returns true when no preset is given (dateRange not requested)', () => {
        expect(isWithinDateRange(new Date('2020-01-01T00:00:00.000Z'), undefined, now)).toBe(true);
    });

    it('returns false when a preset is given but the date is null (unparseable)', () => {
        expect(isWithinDateRange(null, '24h', now)).toBe(false);
    });

    it('includes a date exactly at the window boundary and excludes one just past it', () => {
        const exactlySevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const justOverSevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000 - 1);
        expect(isWithinDateRange(exactlySevenDaysAgo, '7d', now)).toBe(true);
        expect(isWithinDateRange(justOverSevenDaysAgo, '7d', now)).toBe(false);
    });

    it('correctly separates 24h/7d/30d windows using real fixture-shaped dates', () => {
        const threeHoursAgo = new Date('2026-09-06T09:00:00.000Z');
        const fourDaysAgo = new Date('2026-09-02T12:00:00.000Z');
        const twentyDaysAgo = new Date('2026-08-17T12:00:00.000Z');

        expect(isWithinDateRange(threeHoursAgo, '24h', now)).toBe(true);
        expect(isWithinDateRange(fourDaysAgo, '24h', now)).toBe(false);
        expect(isWithinDateRange(fourDaysAgo, '7d', now)).toBe(true);
        expect(isWithinDateRange(twentyDaysAgo, '7d', now)).toBe(false);
        expect(isWithinDateRange(twentyDaysAgo, '30d', now)).toBe(true);
    });
});
