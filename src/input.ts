import { log } from 'apify';

import { AD_STATUSES, AD_TYPES } from './api.js';
import { normalizeAdNumber, shortHash } from './normalize.js';
import type { ActorInput, AdStatus, EventType, SearchFilters } from './types.js';

export interface RunOptions {
    maxItems: number;
    fetchDetail: boolean;
    onlyNew: boolean;
    maxConcurrency: number;
    agencyNameContains: string | null;
    eventTypes: ReadonlySet<EventType>;
    /** Client-side publish-day window (UTC calendar days, inclusive). */
    dateFrom: string | null;
    dateTo: string | null;
    deltaStateName: string;
    resetState: boolean;
}

export interface ResolvedInput {
    filters: SearchFilters;
    options: RunOptions;
    /** Stable hash of everything that changes WHICH records a run returns (used to name the delta store). */
    filtersSignature: string;
}

const ALL_EVENT_TYPES: EventType[] = ['NEW_LISTING', 'UPDATED', 'STATUS_CHANGE'];

// The whole register is ~13,600 advertisements (OPEN 164 + CLOSED 13,027 +
// WITHDRAWN 421 on 2026-09-07); 50,000 leaves years of headroom.
export const MAX_ITEMS_HARD_CAP = 50_000;
// 10 concurrent detail GETs answered in 0.63 s total; 10 is the proven ceiling.
export const MAX_CONCURRENCY_HARD_CAP = 10;

export class InputError extends Error {
    constructor(message: string) {
        super(`Invalid input: ${message}`);
        this.name = 'InputError';
    }
}

function text(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return v === '' ? null : v;
}

function stringList(value: unknown, field: string): string[] {
    if (value === undefined || value === null || value === '') return [];
    if (!Array.isArray(value)) throw new InputError(`${field} must be an array of strings`);
    return [...new Set(value.map((v) => String(v).trim()).filter((v) => v !== ''))];
}

/**
 * Accepts the Apify datepicker's absolute ("2026-09-01") and relative
 * ("7 days", "2 weeks", "3 months", "1 year") forms, plus the legacy v1
 * presets ("24h" | "7d" | "30d"). Relative windows count back from today's
 * UTC calendar date - the granularity MFMP's own date filters use. Returns
 * YYYY-MM-DD.
 */
export function resolveDate(value: unknown, now: Date, field: string): string | null {
    const v = text(value);
    if (!v) return null;
    const absolute = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (absolute) {
        const [, , m, d] = absolute.map(Number);
        if (m < 1 || m > 12 || d < 1 || d > 31) throw new InputError(`${field} "${v}" is not a valid date`);
        return v;
    }
    const legacy = v.match(/^(\d+)([hd])$/i);
    const relative = v.match(/^(\d+)\s*(day|week|month|year)s?$/i);
    let amount: number;
    let unit: string;
    if (legacy) {
        amount = legacy[2].toLowerCase() === 'h' ? Math.max(1, Math.ceil(Number(legacy[1]) / 24)) : Number(legacy[1]);
        unit = 'day';
    } else if (relative) {
        amount = Number(relative[1]);
        unit = relative[2].toLowerCase();
    } else {
        throw new InputError(`${field} must be YYYY-MM-DD or a relative window like "7 days" (got "${v}")`);
    }
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (unit === 'day') date.setUTCDate(date.getUTCDate() - amount);
    else if (unit === 'week') date.setUTCDate(date.getUTCDate() - amount * 7);
    else if (unit === 'month') date.setUTCMonth(date.getUTCMonth() - amount);
    else date.setUTCFullYear(date.getUTCFullYear() - amount);
    return date.toISOString().slice(0, 10);
}

export function resolveInput(raw: ActorInput, now: Date): ResolvedInput {
    const statusesRaw = stringList(raw.statuses, 'statuses');
    const statuses = (statusesRaw.length === 0 ? ['OPEN'] : statusesRaw).map((s) => s.toUpperCase()) as AdStatus[];
    for (const s of statuses) {
        if (!AD_STATUSES.includes(s)) {
            throw new InputError(`statuses contains "${s}" - allowed values are ${AD_STATUSES.join(', ')}`);
        }
    }

    // Accept the id ("6") or the label ("Request for Proposals", case-insensitive).
    const types = stringList(raw.types, 'types').map((t) => {
        if (AD_TYPES[t]) return t;
        const byLabel = Object.entries(AD_TYPES).find(([, label]) => label.toLowerCase() === t.toLowerCase());
        if (byLabel) return byLabel[0];
        throw new InputError(
            `types contains "${t}" - use one of ${Object.entries(AD_TYPES)
                .map(([id, label]) => `${id} (${label})`)
                .join(', ')}`,
        );
    });

    const agencyIds = stringList(raw.agencyIds, 'agencyIds');
    for (const id of agencyIds) {
        if (!/^\d{4,12}$/.test(id)) {
            throw new InputError(
                `agencyIds contains "${id}" - MFMP expects the numeric organizationId (e.g. 30000021 for FDOT), not a short name`,
            );
        }
    }

    const commodityCodes = stringList(raw.commodityCodes, 'commodityCodes');
    for (const code of commodityCodes) {
        if (!/^\d{8}$/.test(code)) {
            throw new InputError(
                `commodityCodes contains "${code}" - MFMP matches exact 8-digit UNSPSC codes only (a prefix such as "83" returns nothing)`,
            );
        }
    }

    const adNumberRaw = text(raw.adNumber);
    const adNumber = adNumberRaw ? normalizeAdNumber(adNumberRaw) : null;
    if (adNumberRaw && !adNumber) throw new InputError(`adNumber "${adNumberRaw}" should look like 16672 or AD-16672`);

    let dateFrom = resolveDate(raw.dateFrom, now, 'dateFrom');
    if (!dateFrom && raw.dateRange) {
        dateFrom = resolveDate(raw.dateRange, now, 'dateRange');
        log.warning(`dateRange is deprecated - use dateFrom (interpreted as dateFrom=${dateFrom}).`);
    }
    const dateTo = resolveDate(raw.dateTo, now, 'dateTo');
    if (dateFrom && dateTo && dateFrom > dateTo) throw new InputError('dateFrom is after dateTo');
    const openBefore = resolveDate(raw.openBefore, now, 'openBefore');
    const closesAfter = resolveDate(raw.closesAfter, now, 'closesAfter');

    const filters: SearchFilters = {
        statuses: [...new Set(statuses)],
        types: [...new Set(types)].sort((a, b) => Number(a) - Number(b)),
        agencyIds: [...agencyIds].sort(),
        title: text(raw.titleContains),
        adNumber,
        agencyAdNumber: text(raw.agencyAdNumberContains),
        // MFMP's publishedDate filter matches ONE UTC calendar day; a one-day
        // window is pushed server-side, anything wider is filtered client-side.
        publishedDate: dateFrom && dateTo && dateFrom === dateTo ? dateFrom : null,
        openDate: openBefore,
        endDate: closesAfter,
        commodityCodes: [...commodityCodes].sort(),
    };

    const eventTypesRaw = Array.isArray(raw.eventTypes) && raw.eventTypes.length > 0 ? raw.eventTypes : ALL_EVENT_TYPES;
    for (const t of eventTypesRaw) {
        if (!ALL_EVENT_TYPES.includes(t)) {
            throw new InputError(`eventTypes contains unknown value "${String(t)}" (${ALL_EVENT_TYPES.join(', ')})`);
        }
    }
    const agencyNameContains = text(raw.agencyNameContains);

    const maxItemsRaw = raw.maxItems === undefined || raw.maxItems === null ? 100 : Number(raw.maxItems);
    if (!Number.isFinite(maxItemsRaw) || maxItemsRaw < 1) throw new InputError('maxItems must be a positive integer');
    const maxItems = Math.min(Math.floor(maxItemsRaw), MAX_ITEMS_HARD_CAP);
    const concurrencyRaw =
        raw.maxConcurrency === undefined || raw.maxConcurrency === null ? 5 : Number(raw.maxConcurrency);
    const maxConcurrency = Math.max(
        1,
        Math.min(MAX_CONCURRENCY_HARD_CAP, Math.floor(Number.isFinite(concurrencyRaw) ? concurrencyRaw : 5)),
    );

    const deltaStateNameRaw = text(raw.deltaStateName);
    if (deltaStateNameRaw && !/^[A-Za-z0-9-]{1,30}$/.test(deltaStateNameRaw)) {
        throw new InputError('deltaStateName may only contain letters, digits and dashes (max 30 characters)');
    }

    // Everything that changes which rows come back - but not how many
    // (maxItems), how rich they are (fetchDetail) or a moving date window -
    // defines the delta store.
    const signatureSource = JSON.stringify({
        ...filters,
        publishedDate: null,
        openDate: null,
        endDate: null,
        agencyNameContains: agencyNameContains?.toLowerCase() ?? null,
        eventTypes: [...eventTypesRaw].sort(),
    });
    const filtersSignature = shortHash(signatureSource);

    return {
        filters,
        options: {
            maxItems,
            fetchDetail: raw.fetchDetail !== false,
            onlyNew: raw.onlyNew === true,
            maxConcurrency,
            agencyNameContains,
            eventTypes: new Set(eventTypesRaw),
            dateFrom,
            dateTo,
            deltaStateName: deltaStateNameRaw ?? `auto-${filtersSignature}`,
            resetState: raw.resetState === true,
        },
        filtersSignature,
    };
}
