import { attachmentDownloadUrl } from '../http.js';
import type { DetailData, ListingItem, TenderRecord } from '../types.js';

// Pure function, deliberately separated from the network layer so it can
// be tested against real captured fixtures without any HTTP calls.
export function buildTenderRecord(item: ListingItem, detail: DetailData | null, scrapedAt: string): TenderRecord {
    return {
        advertisementId: item.advertisementId,
        uniqueName: item.uniqueName,
        agencyAdNumber: item.agencyAdNumber,
        title: item.title,
        type: item.type,
        status: item.status,
        agency: item.agency,
        openDate: item.openDate,
        closeDate: item.closeDate,
        publishDate: item.publishDate,
        description: detail?.description ?? null,
        commodityCodes: detail?.commodityCodes ?? [],
        documents: (detail?.docs ?? []).map((d) => ({
            fileName: d.fileName,
            downloadUrl: attachmentDownloadUrl(d.attachmentId),
        })),
        responseContact: detail?.responseContact ?? null,
        detailUrl: `https://vendor.myfloridamarketplace.com/search/bids/detail/${item.advertisementId}`,
        scrapedAt,
    };
}
