export type AdStatus = 'OPEN' | 'CLOSED' | 'WITHDRAWN' | 'PREVIEW';

export interface ActorInput {
    statuses: AdStatus[];
    fetchDetail: boolean;
    maxItems: number;
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
    detailUrl: string;
    scrapedAt: string;
}
