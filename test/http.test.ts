import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError, MfmpApiError, NotJsonError, getJsonOptional, mapWithConcurrency, postJson } from '../src/http.js';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const SHELL = readFileSync(`${fixturesDir}/index_shell.html`, 'utf-8');
const ERROR_400 = readFileSync(`${fixturesDir}/error_400.json`, 'utf-8');

function response(status: number, body: string, contentType: string | null): Response {
    return new Response(body, {
        status,
        headers: contentType ? { 'content-type': contentType } : {},
    });
}

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
vi.stubGlobal('fetch', fetchMock);
const FAST = { baseDelayMs: 1, maxRetries: 2 };

describe('requestJson', () => {
    afterEach(() => {
        fetchMock.mockReset();
    });

    it('sends Accept: application/json and a browser User-Agent on every request', async () => {
        fetchMock.mockResolvedValueOnce(response(200, '[]', 'application/json; charset=utf-8'));
        await postJson('/mfmp/pub/search/bids', { page: 1 }, FAST);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://vendor.myfloridamarketplace.com/mfmp/pub/search/bids');
        const headers = init.headers as Record<string, string>;
        expect(headers.Accept).toBe('application/json');
        expect(headers['User-Agent']).toMatch(/Mozilla/);
        expect(headers['Content-Type']).toBe('application/json');
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('treats the Angular index.html shell (HTTP 200, text/html) as a hard failure, without retrying', async () => {
        fetchMock.mockResolvedValue(response(200, SHELL, null));
        await expect(postJson('/mfmp/pub/search/bids', {}, FAST)).rejects.toThrow(NotJsonError);
        await expect(postJson('/mfmp/pub/search/bids', {}, FAST)).rejects.toThrow(/index\.html shell/);
        expect(fetchMock).toHaveBeenCalledTimes(2); // one call per attempt, no retries
    });

    it("surfaces MFMP's 400 errorMessage immediately (deterministic - no retry)", async () => {
        fetchMock.mockResolvedValue(response(400, ERROR_400, 'application/json; charset=utf-8'));
        const error = await postJson('/mfmp/pub/search/bids', {}, FAST).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(MfmpApiError);
        expect((error as Error).message).toMatch(/MFMP Help Desk/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry a 401 (vendor-only endpoint) but does retry 5xx and network errors', async () => {
        fetchMock.mockResolvedValueOnce(response(401, '', null));
        await expect(getJsonOptional('/mfmp/bids/Agencies', FAST)).rejects.toThrow(HttpError);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        fetchMock.mockReset();
        fetchMock
            .mockResolvedValueOnce(response(503, 'down', 'text/html'))
            .mockRejectedValueOnce(new Error('socket hang up'))
            .mockResolvedValueOnce(response(200, '{"ok":true}', 'application/json'));
        await expect(getJsonOptional('/x', FAST)).resolves.toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('resolves getJsonOptional to null on 404 so one withdrawn record degrades instead of aborting', async () => {
        fetchMock.mockResolvedValueOnce(response(404, '', null));
        await expect(getJsonOptional('/x', FAST)).resolves.toBeNull();
    });
});

describe('mapWithConcurrency', () => {
    it('preserves order, bounds parallelism and propagates the first error', async () => {
        let inFlight = 0;
        let peak = 0;
        const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => {
                setTimeout(r, 5);
            });
            inFlight -= 1;
            return n * 10;
        });
        expect(out).toEqual([10, 20, 30, 40, 50, 60]);
        expect(peak).toBe(2);
        await expect(
            mapWithConcurrency([1, 2], 2, async (n) => {
                if (n === 2) throw new Error('boom');
                return n;
            }),
        ).rejects.toThrow('boom');
    });
});
