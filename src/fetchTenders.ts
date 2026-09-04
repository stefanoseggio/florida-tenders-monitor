import { log } from 'apify';

import { apiGet, apiPost } from './http.js';
import { buildTenderRecord } from './parsers/record.js';
import type { AdStatus, DetailData, ListingItem, TenderRecord } from './types.js';

const SEARCH_PATH = '/mfmp/pub/search/bids';
const DETAIL_PATH = '/mfmp/pub/search/bids/detail';

// Verified live 2026-09-04 that the API accepts pageSize far above the
// portal UI's own default of 25 (tested 50 and 100, both returned exactly
// that many real items) - using 100 to minimize request count.
const PAGE_SIZE = 100;

function buildSearchPayload(statuses: AdStatus[], page: number) {
    return {
        pageSize: PAGE_SIZE,
        type: [],
        status: statuses,
        agency: [],
        adNumber: '',
        agencyAdvertisementNumber: '',
        title: '',
        publishedDate: '',
        openDate: '',
        endDate: '',
        commodityCodes: [],
        intendsToParticipate: '',
        assignee: '',
        page,
    };
}

async function fetchDetail(advertisementId: number): Promise<DetailData | null> {
    try {
        const response = await apiGet(`${DETAIL_PATH}?id=${advertisementId}`);
        return (await response.json()) as DetailData;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warning(`Fallo el detalle de advertisementId=${advertisementId} tras reintentos: ${message}`);
        return null;
    }
}

// No proxy, no auth, no HTML parsing - verified live: this is a clean
// public JSON API behind an Angular SPA shell. The one critical gotcha
// (see http.ts) is that every request needs an explicit
// `Accept: application/json` header or the server silently serves the
// SPA's index.html instead of real data - a 200 status that looks like
// success but isn't.
export async function fetchTenders(statuses: AdStatus[], shouldFetchDetail: boolean, maxItems: number): Promise<TenderRecord[]> {
    const results: TenderRecord[] = [];
    const seenIds = new Set<number>();

    for (let page = 1; results.length < maxItems; page++) {
        const payload = buildSearchPayload(statuses, page);
        const response = await apiPost(SEARCH_PATH, payload);
        const items = (await response.json()) as ListingItem[];

        if (items.length === 0) {
            log.info(`Pagina ${page}: 0 resultados - fin de resultados.`);
            break;
        }

        let newInPage = 0;
        for (const item of items) {
            if (results.length >= maxItems) break;
            if (seenIds.has(item.advertisementId)) continue;
            seenIds.add(item.advertisementId);
            newInPage += 1;

            const detail = shouldFetchDetail ? await fetchDetail(item.advertisementId) : null;
            results.push(buildTenderRecord(item, detail, new Date().toISOString()));
        }

        log.info(`Pagina ${page}: ${items.length} items (${newInPage} nuevos, acumulado: ${results.length})`);

        // Dedup-driven stall guard, same defensive pattern as
        // cordoba-compras-monitor and salta-compras-monitor: this is live
        // government data that can shift between requests as new
        // solicitations are published mid-crawl. No overlap was observed
        // during live testing, but the cost of guarding against it is
        // negligible.
        if (newInPage === 0) {
            log.warning(`Pagina ${page} no aporto items nuevos - fin de resultados.`);
            break;
        }
        if (items.length < PAGE_SIZE) break;
    }

    return results;
}
