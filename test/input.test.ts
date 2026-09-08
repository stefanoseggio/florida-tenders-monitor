import { describe, expect, it } from 'vitest';

import { resolveDate, resolveInput } from '../src/input.js';

const NOW = new Date('2026-09-06T12:00:00.000Z');

describe('resolveDate', () => {
    it('accepts absolute dates, relative windows and the legacy presets, counting back in UTC days', () => {
        expect(resolveDate('2026-07-01', NOW, 'x')).toBe('2026-07-01');
        expect(resolveDate('7 days', NOW, 'x')).toBe('2026-08-30');
        expect(resolveDate('2 weeks', NOW, 'x')).toBe('2026-08-23');
        expect(resolveDate('3 months', NOW, 'x')).toBe('2026-06-06');
        expect(resolveDate('1 year', NOW, 'x')).toBe('2025-09-06');
        expect(resolveDate('0 days', NOW, 'x')).toBe('2026-09-06');
        expect(resolveDate('24h', NOW, 'x')).toBe('2026-09-05');
        expect(resolveDate('7d', NOW, 'x')).toBe('2026-08-30');
        expect(resolveDate('30d', NOW, 'x')).toBe('2026-08-07');
        expect(resolveDate('', NOW, 'x')).toBeNull();
        expect(() => resolveDate('next tuesday', NOW, 'x')).toThrow(/Invalid input/);
        expect(() => resolveDate('2026-13-01', NOW, 'x')).toThrow(/not a valid date/);
    });
});

describe('resolveInput', () => {
    it('applies the documented defaults for an empty input', () => {
        const r = resolveInput({}, NOW);
        expect(r.filters).toEqual({
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
        });
        expect(r.options).toMatchObject({
            maxItems: 100,
            fetchDetail: true,
            onlyNew: false,
            maxConcurrency: 5,
            resetState: false,
            dateFrom: null,
            dateTo: null,
            agencyNameContains: null,
        });
        expect([...r.options.eventTypes].sort()).toEqual(['NEW_LISTING', 'STATUS_CHANGE', 'UPDATED']);
        expect(r.options.deltaStateName).toMatch(/^auto-[0-9a-f]{8}$/);
    });

    it('maps every server-side filter into the exact shape MFMP expects (ids as strings, uppercase statuses)', () => {
        const r = resolveInput(
            {
                statuses: ['open', 'CLOSED'] as never,
                types: ['6', 'Invitation to Bid', '4'],
                agencyIds: ['30000021'],
                titleContains: ' software ',
                adNumber: 'AD-16672',
                agencyAdNumberContains: 'DOT',
                commodityCodes: ['83112200', '93131700', '83112200'],
                openBefore: '2026-01-01',
                closesAfter: '2026-10-01',
            },
            NOW,
        );
        expect(r.filters).toEqual({
            statuses: ['OPEN', 'CLOSED'],
            types: ['4', '6'],
            agencyIds: ['30000021'],
            title: 'software',
            adNumber: '16672',
            agencyAdNumber: 'DOT',
            publishedDate: null,
            openDate: '2026-01-01',
            endDate: '2026-10-01',
            commodityCodes: ['83112200', '93131700'],
        });
    });

    it('pushes a one-day publish window server-side and keeps wider windows client-side', () => {
        const oneDay = resolveInput({ dateFrom: '2026-09-02', dateTo: '2026-09-02' }, NOW);
        expect(oneDay.filters.publishedDate).toBe('2026-09-02');
        expect(oneDay.options.dateFrom).toBe('2026-09-02');
        const week = resolveInput({ dateFrom: '7 days' }, NOW);
        expect(week.filters.publishedDate).toBeNull();
        expect(week.options.dateFrom).toBe('2026-08-30');
        expect(week.options.dateTo).toBeNull();
        const legacy = resolveInput({ dateRange: '24h' }, NOW);
        expect(legacy.options.dateFrom).toBe('2026-09-05');
    });

    it('rejects malformed filters with a clear message', () => {
        expect(() => resolveInput({ statuses: ['PENDING'] as never }, NOW)).toThrow(/statuses contains "PENDING"/);
        expect(() => resolveInput({ types: ['RFP'] }, NOW)).toThrow(/types contains "RFP"/);
        expect(() => resolveInput({ agencyIds: ['FDOT'] }, NOW)).toThrow(/numeric organizationId/);
        expect(() => resolveInput({ commodityCodes: ['83'] }, NOW)).toThrow(/8-digit UNSPSC/);
        expect(() => resolveInput({ adNumber: 'abc' }, NOW)).toThrow(/adNumber/);
        expect(() => resolveInput({ dateFrom: '2026-09-01', dateTo: '2026-08-01' }, NOW)).toThrow(
            /dateFrom is after dateTo/,
        );
        expect(() => resolveInput({ eventTypes: ['BOGUS' as never] }, NOW)).toThrow(/eventTypes/);
        expect(() => resolveInput({ deltaStateName: 'has space' }, NOW)).toThrow(/deltaStateName/);
        expect(() => resolveInput({ maxItems: 0 }, NOW)).toThrow(/maxItems/);
    });

    it('clamps performance knobs to safe ranges', () => {
        const r = resolveInput({ maxItems: 10_000_000, maxConcurrency: 99 }, NOW);
        expect(r.options.maxItems).toBe(50_000);
        expect(r.options.maxConcurrency).toBe(10);
        expect(resolveInput({ maxConcurrency: 0 }, NOW).options.maxConcurrency).toBe(1);
    });

    it('derives the delta store from the filter set only - not from date windows, maxItems or fetchDetail', () => {
        const a = resolveInput({ types: ['6'], maxItems: 10, fetchDetail: false, dateFrom: '7 days' }, NOW);
        const b = resolveInput({ types: ['6'], maxItems: 500, fetchDetail: true, closesAfter: '2026-10-01' }, NOW);
        const c = resolveInput({ types: ['4'] }, NOW);
        const d = resolveInput({ statuses: ['OPEN', 'CLOSED'] }, NOW);
        expect(a.filtersSignature).toBe(b.filtersSignature);
        expect(a.filtersSignature).not.toBe(c.filtersSignature);
        expect(c.filtersSignature).not.toBe(d.filtersSignature);
        expect(resolveInput({ deltaStateName: 'fdot-watch' }, NOW).options.deltaStateName).toBe('fdot-watch');
    });
});
