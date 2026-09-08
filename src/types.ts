export type AdStatus = 'OPEN' | 'CLOSED' | 'WITHDRAWN' | 'PREVIEW';

/**
 * NEW_LISTING - an advertisement this delta memory has never delivered.
 * UPDATED - a known advertisement whose `version` counter rose (addendum,
 *           close-date extension, document added, any agency edit).
 * STATUS_CHANGE - a known advertisement whose status differs from the one
 *           stored (OPEN -> CLOSED / WITHDRAWN) - only visible when the new
 *           status is part of the walked `statuses`.
 */
export type EventType = 'NEW_LISTING' | 'UPDATED' | 'STATUS_CHANGE';

/** Legacy v1 preset, still honoured and mapped onto `dateFrom`. */
export type DateRangePreset = '24h' | '7d' | '30d';

export interface ActorInput {
    // Filters - every one except agencyNameContains / eventTypes / dateFrom /
    // dateTo is applied by the MFMP search endpoint itself.
    statuses?: AdStatus[];
    types?: string[];
    agencyIds?: string[];
    agencyNameContains?: string;
    titleContains?: string;
    adNumber?: string;
    agencyAdNumberContains?: string;
    commodityCodes?: string[];
    dateFrom?: string;
    dateTo?: string;
    openBefore?: string;
    closesAfter?: string;
    eventTypes?: EventType[];
    // Monitoring / delta
    onlyNew?: boolean;
    deltaStateName?: string;
    resetState?: boolean;
    // Performance & limits
    maxItems?: number;
    fetchDetail?: boolean;
    maxConcurrency?: number;
    /** @deprecated use dateFrom */
    dateRange?: DateRangePreset;
}

/** Fully resolved server-side query for POST /mfmp/pub/search/bids. */
export interface SearchFilters {
    statuses: AdStatus[];
    /** AdTypes ids as strings ("1".."10") */
    types: string[];
    /** organization.organizationId values as strings */
    agencyIds: string[];
    title: string | null;
    adNumber: string | null;
    agencyAdNumber: string | null;
    /** YYYY-MM-DD, exact UTC calendar day of publishDate */
    publishedDate: string | null;
    /** YYYY-MM-DD, openDate on or before this day */
    openDate: string | null;
    /** YYYY-MM-DD, closeDate on or after this day */
    endDate: string | null;
    commodityCodes: string[];
}

export interface Organization {
    organizationId: number;
    entity: string | null;
    shortName: string | null;
    name: string | null;
    vbsAgency?: boolean;
    version?: number;
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
    /** Amendment counter - rises on every agency edit. 0 on some 2022 records. */
    version: number;
    openDate: string;
    closeDate: string;
    publishDate: string;
    organization: Organization;
    agency: string;
    favorite?: boolean;
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
    version: number | null;
    docFor: string | null;
    advertisementId?: number;
    action?: string | null;
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

export interface Indicators {
    minorityEncouraged: boolean | null;
    preSolicitationConference: boolean | null;
    disabilitiesAct: boolean | null;
    rightToReject: boolean | null;
    agencyContactPeriod: boolean | null;
}

// Shape of GET /mfmp/pub/search/bids/detail?id={advertisementId}. An unknown
// id answers HTTP 200 with every field null (advertisementId included).
export interface DetailData {
    advertisementId: number | null;
    agencyAdNumber: string | null;
    linkedAdNumber: string | null;
    openDate: string | null;
    publishOption: string | null;
    closeDate: string | null;
    responseDate: string | null;
    lastUpdateDate: string | null;
    publishedDate: string | null;
    type: string | null;
    agency: string | null;
    title: string | null;
    description: string | null;
    status: AdStatus | null;
    commodityCodes: CommodityCode[] | null;
    indicators: Partial<Indicators> | null;
    docs: AdDocument[] | null;
    responseContact: ResponseContact | null;
    version: number | null;
    uniqueName: string | null;
    timeRemaining: number | null;
    organization: Organization | null;
    withdrawn: boolean | null;
}

export interface DocumentRecord {
    fileName: string;
    downloadUrl: string;
    attachmentId: number;
    description: string | null;
    date: string | null;
    dateUtc: string | null;
    version: number | null;
    docFor: string | null;
}

export interface TenderRecord {
    // ---- Standardised B2B envelope (shared across this portfolio's fleet) ----
    record_id: string;
    event_type: EventType;
    scraped_at: string;
    is_new: boolean;
    source_url: string;
    data_source: string;

    // ---- v1 fields (names and shapes unchanged) ----
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
    documents: DocumentRecord[];
    responseContact: ResponseContact | null;

    // ---- Identity & classification ----
    typeId: string;
    version: number;
    isAmended: boolean;
    previousVersion: number | null;
    previousStatus: AdStatus | null;
    organizationId: number | null;
    organizationShortName: string | null;
    organizationEntity: string | null;
    isAwardNotice: boolean;
    isSingleSource: boolean;

    // ---- Normalised dates (UTC ISO-8601 "Z" form, Florida wall-clock twins, day maths) ----
    publishDateUtc: string | null;
    openDateUtc: string | null;
    closeDateUtc: string | null;
    publishDateLocal: string | null;
    openDateLocal: string | null;
    closeDateLocal: string | null;
    publishDay: string | null;
    closeDay: string | null;
    responseWindowDays: number | null;
    daysUntilClose: number | null;
    isOpenForResponses: boolean;

    // ---- Detail fields (null when fetchDetail=false or detail unavailable) ----
    detailFetched: boolean;
    detailError: string | null;
    descriptionText: string | null;
    amountsUsd: number[];
    maxAmountUsd: number | null;
    currency: string;
    lastUpdateDate: string | null;
    lastUpdateDateUtc: string | null;
    responseDate: string | null;
    responseDateUtc: string | null;
    responseDateLocal: string | null;
    linkedAdNumber: string | null;
    linkedAdUrl: string | null;
    publishOption: string | null;
    withdrawn: boolean | null;
    timeRemainingMs: number | null;
    indicators: Indicators | null;
    minorityEncouraged: boolean | null;
    preSolicitationConference: boolean | null;
    disabilitiesAct: boolean | null;
    rightToReject: boolean | null;
    agencyContactPeriod: boolean | null;
    commodityCodeIds: string[];
    commodityCodesText: string | null;
    documentCount: number | null;
    latestDocumentDateUtc: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contactAddress: string | null;
    contactCity: string | null;
    contactState: string | null;
    contactZip: string | null;
}

export const DATA_SOURCE_ATTRIBUTION =
    'MyFloridaMarketPlace Vendor Information Portal (vendor.myfloridamarketplace.com), Florida Department of Management Services - public records under Florida Statutes ch. 119';
