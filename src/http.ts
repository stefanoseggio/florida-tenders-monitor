const BASE_URL = 'https://vendor.myfloridamarketplace.com';

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

// CRITICAL, verified live 2026-09-04: every single endpoint on this host -
// GET or POST, JSON API or file download - falls back to serving the
// Angular app's index.html shell (a plain 200, easy to mistake for
// success) unless the request carries an explicit `Accept: application/json`
// header. A plain curl/fetch with the default `Accept: */*` gets the SPA
// shell every time; this is true even for a binary document-download
// endpoint that has nothing to do with JSON. This is the single most
// important fact about this integration - every request function below
// sends this header unconditionally.
const JSON_HEADERS = { Accept: 'application/json' };

async function requestWithRetry(url: string, init: RequestInit, maxRetries = 4, baseDelayMs = 1000): Promise<Response> {
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, { ...init, headers: { ...JSON_HEADERS, ...init.headers } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxRetries) {
                await sleep(baseDelayMs * 2 ** attempt);
            }
        }
    }
    throw lastError;
}

export async function apiGet(path: string): Promise<Response> {
    return requestWithRetry(`${BASE_URL}${path}`, { method: 'GET' });
}

export async function apiPost(path: string, body: unknown): Promise<Response> {
    return requestWithRetry(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

export function attachmentDownloadUrl(attachmentId: number): string {
    return `${BASE_URL}/mfmp/bids/detail/attachment/download?attachmentId=${attachmentId}`;
}
