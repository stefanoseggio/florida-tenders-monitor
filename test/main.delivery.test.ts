import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { ListingItem } from '../src/types.js';

// End-to-end run of src/main.ts with the Apify SDK and the HTTP layer mocked:
// proves the delta state is persisted ONLY for records actually stored, so a
// spending limit (or crash) half-way never loses advertisements for the next run.

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const PAGE1 = JSON.parse(readFileSync(`${fixturesDir}/listing_open_page1.json`, 'utf-8')) as ListingItem[];

const kv = new Map<string, unknown>();
const pushed: Record<string, unknown>[] = [];
const pushEvents: string[] = [];
const statusMessages: string[] = [];
let failMessage: string | null = null;
const CHARGE_LIMIT = 4; // the customer's budget allows 4 records

vi.mock('apify', () => {
    const store = {
        getValue: async (key: string) => kv.get(key) ?? null,
        setValue: async (key: string, value: unknown) => {
            kv.set(key, JSON.parse(JSON.stringify(value)));
        },
    };
    const noop = (): void => {};
    return {
        log: { info: noop, warning: noop, debug: noop, error: noop, exception: noop },
        Actor: {
            init: async () => {},
            exit: async () => {},
            fail: async (message: string) => {
                failMessage = message;
            },
            getInput: async () => ({ maxItems: 10, fetchDetail: false, onlyNew: true }),
            openKeyValueStore: async () => store,
            setValue: async (key: string, value: unknown) => {
                kv.set(`default:${key}`, value);
            },
            setStatusMessage: async (message: string) => {
                statusMessages.push(message);
            },
            on: noop,
            off: noop,
            getChargingManager: () => ({ getPricingInfo: () => ({ isPayPerEvent: true }) }),
            pushData: async (items: Record<string, unknown>[], eventName: string) => {
                const room = Math.max(0, CHARGE_LIMIT - pushed.length);
                const stored = items.slice(0, room);
                pushed.push(...stored);
                pushEvents.push(...stored.map(() => eventName));
                return {
                    chargedCount: stored.length,
                    eventChargeLimitReached: pushed.length >= CHARGE_LIMIT,
                    chargeableWithinLimit: {},
                };
            },
        },
    };
});

vi.mock('../src/http.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/http.js')>()),
    postJson: async (path: string, body: { page: number }) => {
        if (path.endsWith('/count')) return PAGE1.length;
        return body.page === 1 ? PAGE1 : [];
    },
    getJsonOptional: async () => null,
}));

describe('main.ts delivery semantics', () => {
    it('persists the seen-map only for delivered records and stops at the spending limit', async () => {
        await import('../src/main.js');

        expect(failMessage).toBeNull();
        expect(pushed.length).toBe(CHARGE_LIMIT);
        expect(pushEvents.every((e) => e === 'result-summary')).toBe(true); // fetchDetail=false -> summary price

        const state = kv.get('state') as {
            seen: Record<string, { version: number; status: string }>;
            baselineFloor: string | null;
            backlogFloor: string | null;
            lastRunAt: string;
        };
        expect(state).toBeDefined();
        // This is a COLD delta run (empty store) cut short by maxItems (10 < 100 rows): it defines the
        // baseline - the publish instant of the oldest row in the delivered block - and leaves no backlog.
        const newestTen = [...PAGE1]
            .sort((a, b) => (b.publishDate + b.advertisementId).localeCompare(a.publishDate + a.advertisementId))
            .slice(0, 10);
        expect(state.baselineFloor).toBe(new Date(newestTen[9].publishDate).toISOString());
        expect(state.backlogFloor).toBeNull();
        // Only the 4 stored records are remembered - and they are the 4 OLDEST of the 10-row block
        // (delivery is oldest-first), so the undelivered ones are the newest, i.e. the rows the next
        // walk ranks first.
        const deliveredIds = pushed.map((r) => r.advertisementId as number);
        expect(deliveredIds).toEqual(
            newestTen
                .slice(6, 10)
                .reverse()
                .map((i) => i.advertisementId),
        );
        expect(Object.keys(state.seen).sort()).toEqual(deliveredIds.map(String).sort());
        expect(state.seen[String(deliveredIds[0])]).toMatchObject({ status: 'OPEN' });
        expect(state.lastRunAt).toBeTruthy();

        const output = kv.get('default:OUTPUT') as {
            delivered: number;
            chargeLimitReached: boolean;
            mode: string;
            totalMatchingOnMfmp: number;
            undeliveredBeyondMaxItems: number;
        };
        expect(output.delivered).toBe(CHARGE_LIMIT);
        expect(output.chargeLimitReached).toBe(true);
        expect(output.mode).toBe('delta');
        expect(output.totalMatchingOnMfmp).toBe(100);
        expect(output.undeliveredBeyondMaxItems).toBe(90);
        expect(statusMessages.at(-1)).toMatch(/4 delivered .* spending limit reached/);
    });
});
