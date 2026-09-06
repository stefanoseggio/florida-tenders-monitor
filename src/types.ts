import type { DateRangePreset } from './dateFilter.js';

export type AdStatus = 'OPEN' | 'CLOSED' | 'WITHDRAWN' | 'PREVIEW';

// Every record this actor produces is a solicitation appearing in the
// listing - there is no more specific, defensible per-domain signal the way
// e.g. uk-hse-enforcement-monitor distinguishes SANCTION (a conviction IS an
// imposed sanction) from NEW_LISTING (a notice), so this actor only ever
// emits NEW_LISTING. See AGENTS.md "Delta engine" for the reasoning.
export type EventType = 'NEW_LISTING';

export interface ActorInput {
    statuses: AdStatus[];
    fetchDetail: boolean;
    maxItems: number;
    onlyNew: boolean;
    dateRange?: DateRangePreset;
}

export interface Organization {
    organizationId: number;
    entity: string;
    shortName: string;
    name: string;
}

// Shape of one entry in the POST /mfmp/pub/search/bids response array.
export interface ListingItem {
    advertisementId: number;
    uniqueName: string;
    agencyAdNumber: string | null;
    title: string;
    type: string;
    typeId: string;
    status: AdStatus;
    openDate: string;
    closeDate: string;
    publishDate: string;
    organization: Organization;
    agency: string;
}

export interface CommodityCode {
    id: string;
    value: string;
}

export interface AdDocument {
    attachmentId: number;
    fileName: string;
    description: string | null;
    date: string | null;
}

export interface ResponseContact {
    responseContact: string | null;
    email: string | null;
    ph: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
}

// Shape of GET /mfmp/pub/search/bids/detail?id={advertisementId} - only the
// fields this actor actually uses are typed; the real response has more.
export interface DetailData {
    description: string | null;
    commodityCodes: CommodityCode[];
    docs: AdDocument[];
    responseContact: ResponseContact | null;
}

export interface TenderRecord {
    advertisementId: number;
    uniqueName: string;
    agencyAdNumber: string | null;
    title: string;
    type: string;
    status: AdStatus;
    agency: string;
    openDate: string;
    closeDate: string;
    publishDate: string;
    description: string | null;
    commodityCodes: CommodityCode[];
    documents: { fileName: string; downloadUrl: string }[];
    responseContact: ResponseContact | null;
    // Standardized B2B integration envelope - consistent across this
    // portfolio's fleet so downstream webhook/Zapier/Make consumers need no
    // per-actor parser. `detailUrl`/`scrapedAt` (pre-delta-engine field
    // names) are replaced by `source_url`/`scraped_at` below rather than
    // kept alongside them - no actor in this portfolio has real paying
    // customers yet, so there's no backward-compatibility cost to keeping
    // this clean instead of carrying duplicate fields.
    record_id: string;
    event_type: EventType;
    scraped_at: string;
    is_new: boolean;
    source_url: string;
}
