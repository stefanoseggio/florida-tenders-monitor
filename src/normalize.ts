// Pure normalisation helpers for the values MFMP returns. Every function is
// total: invalid input yields null, never throws.
import * as cheerio from 'cheerio';

// MFMP timestamps are genuine UTC instants rendered with a "+00:00" offset
// (verified live 2026-09-07: an openDate of 20:30Z is described in the
// advertisement body as "4:30 PM", i.e. Eastern Daylight Time). The portal
// itself is operated from Tallahassee, so wall-clock twins use the
// America/New_York zone (EST/EDT) - the clock a Florida vendor reads.
export const SITE_TIME_ZONE = 'America/New_York';

const localParts = new Intl.DateTimeFormat('en-US', {
    timeZone: SITE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
});

/** "2026-08-13T17:39:51.000+00:00" -> "2026-08-13T17:39:51.000Z" (canonical UTC form); null when unparseable. */
export function toUtcIso(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** UTC calendar day (YYYY-MM-DD) of an instant - the granularity of MFMP's own publishedDate filter. */
export function utcCalendarDay(value: string | null | undefined): string | null {
    const iso = toUtcIso(value);
    return iso ? iso.slice(0, 10) : null;
}

/** "2026-09-09T20:30:00.000+00:00" -> "2026-09-09 16:30 EDT" (Florida wall-clock). */
export function toSiteLocal(value: string | null | undefined): string | null {
    const iso = toUtcIso(value);
    if (!iso) return null;
    const parts = Object.fromEntries(localParts.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
    const hour = String(Number(parts.hour) % 24).padStart(2, '0'); // Intl may render midnight as "24"
    return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute} ${parts.timeZoneName}`;
}

/** Signed whole days from `now` to `target` (truncated toward zero; negative once passed). */
export function daysUntil(target: string | null | undefined, now: Date): number | null {
    const iso = toUtcIso(target);
    if (!iso) return null;
    return Math.trunc((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

/** Whole days between two instants (truncated toward zero). */
export function daysBetween(start: string | null | undefined, end: string | null | undefined): number | null {
    const a = toUtcIso(start);
    const b = toUtcIso(end);
    if (!a || !b) return null;
    return Math.trunc((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

/**
 * Raw advertisement HTML -> readable plain text: block elements become line
 * breaks, entities are decoded, runs of whitespace and &nbsp; collapse.
 */
export function htmlToText(html: string | null | undefined): string | null {
    if (!html) return null;
    const $ = cheerio.load(html, null, false);
    $('script, style').remove();
    $('br').replaceWith('\n');
    $('p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, table').each((_, el) => {
        $(el).append('\n');
    });
    const raw: string = $.root().text();
    const text = raw
        .replace(/\u00a0/g, ' ')
        .split('\n')
        .map((line: string) => line.replace(/[ \t]+/g, ' ').trim())
        .filter((line: string) => line !== '')
        .join('\n');
    return text === '' ? null : text;
}

/** Every "$1,234,567.89" style figure in a text, de-duplicated, in order of appearance. */
export function parseUsdAmounts(text: string | null | undefined): number[] {
    if (!text) return [];
    const out: number[] = [];
    const re = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
    for (const match of text.matchAll(re)) {
        const n = Number(match[1].replace(/,/g, ''));
        if (Number.isFinite(n) && !out.includes(n)) out.push(n);
    }
    return out;
}

/** "AD-16672" / "GO-14963" / " 16672 " -> "16672"; anything without digits -> null. */
export function normalizeAdNumber(value: string | null | undefined): string | null {
    if (!value) return null;
    const digits = value.replace(/^\s*[A-Za-z]{2,3}-?/, '').replace(/\D/g, '');
    return digits === '' ? null : String(Number(digits));
}

export function yesNoToBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return null;
    const v = value.trim().toLowerCase();
    if (v === 'yes' || v === 'true') return true;
    if (v === 'no' || v === 'false') return false;
    return null;
}

/** Stable short hash (FNV-1a) used to derive a delta-state store name from the filter set. */
export function shortHash(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        // eslint-disable-next-line no-bitwise
        h ^= input.charCodeAt(i);
        // eslint-disable-next-line no-bitwise
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
