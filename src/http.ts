import { log } from 'apify';

export const BASE_URL = 'https://vendor.myfloridamarketplace.com';

// CRITICAL, verified live 2026-09-04 and again 2026-09-07: every endpoint on
// this host - GET or POST, JSON API or binary download - serves the Angular
// app's index.html shell (HTTP 200, text/html) unless the request carries an
// explicit `Accept: application/json` header. A plain fetch with the default
// `Accept: */*` gets the SPA shell every time and looks like success. Every
// request below sends the header unconditionally, and every JSON response is
// checked for a JSON content-type so the shell can never be mistaken for data.
const JSON_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
};

export class HttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly url: string,
        message?: string,
    ) {
        super(message ?? `HTTP ${status} for ${url}`);
        this.name = 'HttpError';
    }
}

/** HTTP 400 with MFMP's own `{ errorMessage }` body - a deterministic rejection of the request (never retried). */
export class MfmpApiError extends HttpError {
    constructor(status: number, url: string, apiMessage: string) {
        super(status, url, `MFMP rejected the request (HTTP ${status}): ${apiMessage} [${url}]`);
        this.name = 'MfmpApiError';
    }
}

/** The Angular index.html shell came back instead of JSON - the Accept gate changed or the endpoint moved. */
export class NotJsonError extends Error {
    constructor(
        public readonly url: string,
        contentType: string | null,
    ) {
        super(
            `MFMP answered ${url} with "${contentType ?? 'no content-type'}" instead of JSON (the Angular index.html shell). The Accept: application/json gate or the endpoint has changed - see AGENTS.md. Aborting instead of reporting "nothing new".`,
        );
        this.name = 'NotJsonError';
    }
}

export interface FetchOptions {
    maxRetries?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
}

const DEFAULTS: Required<FetchOptions> = {
    maxRetries: 4,
    baseDelayMs: 1000,
    // Listing pages answer in ~0.6-1.2 s, detail GETs in ~0.6 s; 30 s is generous.
    timeoutMs: 30_000,
};

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function isRetriableStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function absoluteUrl(path: string): string {
    return new URL(path, BASE_URL).href;
}

/**
 * Perform a request expecting JSON. Retries with jittered exponential backoff
 * on network errors, timeouts, 408/425/429 and 5xx only. A 400 (MFMP's
 * "could not complete this action" for malformed filters), 401 (vendor-only
 * endpoint) or 404 is deterministic and surfaces immediately as HttpError so
 * the caller decides (fail the run vs. degrade one record). A 200 whose body
 * is not JSON (the SPA shell) throws NotJsonError - never retried, never
 * silently treated as "no results".
 */
export async function requestJson(path: string, init: RequestInit = {}, options: FetchOptions = {}): Promise<unknown> {
    const { maxRetries, baseDelayMs, timeoutMs } = { ...DEFAULTS, ...options };
    const url = absoluteUrl(path);
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                ...init,
                headers: { ...JSON_HEADERS, ...(init.headers as Record<string, string> | undefined) },
                redirect: 'follow',
                signal: AbortSignal.timeout(timeoutMs),
            });
            const contentType = response.headers.get('content-type');
            const isJson = contentType !== null && contentType.toLowerCase().includes('application/json');
            if (response.ok) {
                if (!isJson) throw new NotJsonError(url, contentType);
                const text = await response.text();
                try {
                    return JSON.parse(text) as unknown;
                } catch {
                    throw new NotJsonError(url, `${contentType} but unparseable body: ${text.slice(0, 80)}`);
                }
            }
            if (!isRetriableStatus(response.status)) {
                let apiMessage: string | null = null;
                if (isJson) {
                    try {
                        const body = (await response.json()) as { errorMessage?: unknown };
                        if (typeof body.errorMessage === 'string') apiMessage = body.errorMessage;
                    } catch {
                        /* body is not JSON after all - fall through to a plain HttpError */
                    }
                }
                throw apiMessage
                    ? new MfmpApiError(response.status, url, apiMessage)
                    : new HttpError(response.status, url);
            }
            lastError = new HttpError(response.status, url);
        } catch (error) {
            if (error instanceof NotJsonError) throw error;
            if (error instanceof HttpError && !isRetriableStatus(error.status)) throw error;
            lastError = error instanceof Error ? error : new Error(String(error));
        }
        if (attempt < maxRetries) {
            const delay = Math.min(baseDelayMs * 2 ** attempt, 15_000) + Math.floor(Math.random() * 250);
            log.debug(`Retrying ${url} in ${delay}ms after: ${lastError.message}`);
            await sleep(delay);
        }
    }
    throw lastError;
}

export async function getJson(path: string, options: FetchOptions = {}): Promise<unknown> {
    return requestJson(path, { method: 'GET' }, options);
}

export async function postJson(path: string, body: unknown, options: FetchOptions = {}): Promise<unknown> {
    return requestJson(
        path,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        options,
    );
}

/** Like getJson but resolves to null when the resource is gone (404/410). */
export async function getJsonOptional(path: string, options: FetchOptions = {}): Promise<unknown | null> {
    try {
        return await getJson(path, options);
    } catch (error) {
        if (error instanceof HttpError && (error.status === 404 || error.status === 410)) return null;
        throw error;
    }
}

/**
 * Run `fn` over `items` with at most `concurrency` calls in flight, preserving
 * input order in the result. Errors propagate after in-flight calls settle.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    let firstError: unknown = null;
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
        while (next < items.length && firstError === null) {
            const index = next++;
            try {
                results[index] = await fn(items[index], index);
            } catch (error) {
                firstError ??= error;
            }
        }
    });
    await Promise.all(workers);
    if (firstError !== null) throw firstError;
    return results;
}

/** Direct download link for an attachment (the endpoint needs the same Accept header to serve bytes). */
export function attachmentDownloadUrl(attachmentId: number): string {
    return `${BASE_URL}/mfmp/bids/detail/attachment/download?attachmentId=${attachmentId}`;
}

/** The public portal page of an advertisement (Angular route). */
export function detailPageUrl(advertisementId: number | string): string {
    return `${BASE_URL}/search/bids/detail/${advertisementId}`;
}
