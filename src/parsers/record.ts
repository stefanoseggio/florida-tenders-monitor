import { attachmentDownloadUrl } from '../http.js';
import type { DetailData, ListingItem, TenderRecord } from '../types.js';

// Pure function, deliberately separated from the network layer so it can
// be tested against real captured fixtures without any HTTP calls.
export function buildTenderRecord(
    item: ListingItem,
    detail: DetailData | null,
    scrapedAt: string,
    isNew: boolean,
): TenderRecord {
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
        // advertisementId is the real, already-unique id used throughout this
        // actor (the seenIds dedup set, the URL builders below) - reused as
        // a string rather than uniqueName ("AD-16672") since it's the actual
        // database key uniqueName is just a display formatting of.
        record_id: String(item.advertisementId),
        event_type: 'NEW_LISTING',
        scraped_at: scrapedAt,
        is_new: isNew,
        source_url: `https://vendor.myfloridamarketplace.com/search/bids/detail/${item.advertisementId}`,
    };
}
