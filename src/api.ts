// Thin, validated wrappers around the three public MFMP endpoints this actor
// uses. Everything here was verified live on 2026-09-07 (see AGENTS.md).
import { getJsonOptional, postJson } from './http.js';
import type { AdStatus, DetailData, ListingItem, SearchFilters } from './types.js';

export const SEARCH_PATH = '/mfmp/pub/search/bids';
export const COUNT_PATH = '/mfmp/pub/search/bids/count';
export const DETAIL_PATH = '/mfmp/pub/search/bids/detail';

// The server silently caps pageSize at 100 (pageSize 500 -> 100 rows).
export const PAGE_SIZE = 100;

/** GET /mfmp/bids/AdTypes, captured 2026-09-07. Ids are what the `type` filter expects (as strings). */
export const AD_TYPES: Readonly<Record<string, string>> = {
    '1': 'Agency Decision',
    '2': 'Grant Opportunities',
    '3': 'Informational Notice',
    '4': 'Invitation to Bid',
    '5': 'Invitation to Negotiate',
    '6': 'Request for Proposals',
    '7': 'Public Meeting Notice',
    '8': 'Request for Information',
    '9': 'Request for Statement of Qualifications',
    '10': 'Single Source',
};

export const AD_STATUSES: readonly AdStatus[] = ['OPEN', 'CLOSED', 'WITHDRAWN', 'PREVIEW'];

/**
 * The exact body the portal's own search page posts. Every key must be
 * present (a missing key or a wrongly typed value -> HTTP 400); the
 * vendor-only `intendsToParticipate` / `assignee` stay empty strings.
 */
export function buildSearchPayload(filters: SearchFilters, page: number, pageSize = PAGE_SIZE) {
    return {
        pageSize,
        type: filters.types,
        status: filters.statuses,
        agency: filters.agencyIds,
        adNumber: filters.adNumber ?? '',
        agencyAdvertisementNumber: filters.agencyAdNumber ?? '',
        title: filters.title ?? '',
        publishedDate: filters.publishedDate ?? '',
        openDate: filters.openDate ?? '',
        endDate: filters.endDate ?? '',
        commodityCodes: filters.commodityCodes,
        intendsToParticipate: '',
        assignee: '',
        page,
    };
}

/** Human-readable description of the query (for logs and the run summary). */
export function describeFilters(filters: SearchFilters): string {
    const parts = [`status=${filters.statuses.join('|')}`];
    if (filters.types.length) parts.push(`type=${filters.types.map((t) => AD_TYPES[t] ?? t).join('|')}`);
    if (filters.agencyIds.length) parts.push(`agency=${filters.agencyIds.join('|')}`);
    if (filters.title) parts.push(`title~"${filters.title}"`);
    if (filters.adNumber) parts.push(`adNumber=${filters.adNumber}`);
    if (filters.agencyAdNumber) parts.push(`agencyAdNumber~"${filters.agencyAdNumber}"`);
    if (filters.commodityCodes.length) parts.push(`commodity=${filters.commodityCodes.join('|')}`);
    if (filters.publishedDate) parts.push(`publishedDate=${filters.publishedDate}`);
    if (filters.openDate) parts.push(`openDate<=${filters.openDate}`);
    if (filters.endDate) parts.push(`closeDate>=${filters.endDate}`);
    return parts.join(' ');
}

function isListingItem(value: unknown): value is ListingItem {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.advertisementId === 'number' &&
        typeof v.uniqueName === 'string' &&
        typeof v.status === 'string' &&
        typeof v.type === 'string' &&
        typeof v.publishDate === 'string'
    );
}

/**
 * Validate that a search response really is a listing page: a JSON array
 * whose every element carries the advertisement identity fields. Anything
 * else (an object, an HTML shell already rejected by http.ts, a changed
 * schema) throws so a blocked or altered endpoint can never be reported as
 * "0 results".
 */
export function assertListingPage(body: unknown, page: number): ListingItem[] {
    if (!Array.isArray(body)) {
        throw new Error(
            `MFMP search page ${page} is not a JSON array (${typeof body}) - the endpoint contract changed. See AGENTS.md.`,
        );
    }
    for (const row of body) {
        if (!isListingItem(row)) {
            throw new Error(
                `MFMP search page ${page} contains a row without advertisementId/uniqueName/status/type/publishDate - the listing schema changed. See AGENTS.md. Row: ${JSON.stringify(row).slice(0, 200)}`,
            );
        }
    }
    return body as ListingItem[];
}

/** POST /mfmp/pub/search/bids for one page (1-indexed; page 0 behaves as page 1). */
export async function fetchListingPage(filters: SearchFilters, page: number): Promise<ListingItem[]> {
    const body = await postJson(SEARCH_PATH, buildSearchPayload(filters, page));
    return assertListingPage(body, page);
}

/** POST /mfmp/pub/search/bids/count - the exact total for the filter set (bare integer). */
export async function fetchListingCount(filters: SearchFilters): Promise<number> {
    const body = await postJson(COUNT_PATH, buildSearchPayload(filters, 1));
    const n = typeof body === 'number' ? body : Number(body);
    if (!Number.isInteger(n) || n < 0) {
        throw new Error(`MFMP count endpoint returned "${String(body)}" instead of an integer. See AGENTS.md.`);
    }
    return n;
}

/**
 * GET /mfmp/pub/search/bids/detail?id=N. Resolves to null when the
 * advertisement is unknown: MFMP answers HTTP 200 with an all-null object
 * (advertisementId null) rather than a 404, so that case is checked
 * explicitly. A 400 (non-numeric id) or any other error propagates.
 */
export async function fetchDetail(advertisementId: number): Promise<DetailData | null> {
    const body = await getJsonOptional(`${DETAIL_PATH}?id=${advertisementId}`);
    if (body === null) return null;
    if (typeof body !== 'object' || Array.isArray(body)) {
        throw new Error(`MFMP detail ${advertisementId} is not a JSON object - the endpoint contract changed.`);
    }
    const detail = body as DetailData;
    if (detail.advertisementId === null || detail.advertisementId === undefined) return null;
    return detail;
}
