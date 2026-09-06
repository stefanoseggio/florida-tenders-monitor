export type DateRangePreset = '24h' | '7d' | '30d';

const WINDOW_MS: Record<DateRangePreset, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
};

// Florida's dates (openDate/closeDate/publishDate) are already real ISO-8601
// strings with an explicit offset (e.g. "2026-08-13T17:39:51.000+00:00"),
// unlike e.g. uk-hse-enforcement-monitor's DD/MM/YYYY text fields - a plain
// `new Date()` parse is correct here, no custom format parsing needed.
export function parseIsoDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function isWithinDateRange(date: Date | null, preset: DateRangePreset | undefined, now: Date): boolean {
    if (!preset) return true;
    if (!date) return false;
    return now.getTime() - date.getTime() <= WINDOW_MS[preset];
}
