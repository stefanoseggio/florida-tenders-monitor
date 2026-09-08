import { attachmentDownloadUrl, detailPageUrl } from '../http.js';
import {
    daysBetween,
    daysUntil,
    htmlToText,
    parseUsdAmounts,
    toSiteLocal,
    toUtcIso,
    utcCalendarDay,
    yesNoToBoolean,
} from '../normalize.js';
import type { SeenEntry } from '../state.js';
import type { DetailData, EventType, Indicators, ListingItem, TenderRecord } from '../types.js';
import { DATA_SOURCE_ATTRIBUTION } from '../types.js';

export interface RecordContext {
    eventType: EventType;
    isNew: boolean;
    /** State entry from the previous delivery (null for a never-seen advertisement). */
    previous: SeenEntry | null;
}

export interface DetailResult {
    detail: DetailData | null;
    /** null when detail was fetched, 'NOT_FOUND' when MFMP has no such ad, otherwise the failure message. */
    error: string | null;
}

function indicatorsOf(detail: DetailData | null): Indicators | null {
    const raw = detail?.indicators;
    if (!raw || typeof raw !== 'object') return null;
    return {
        minorityEncouraged: yesNoToBoolean(raw.minorityEncouraged),
        preSolicitationConference: yesNoToBoolean(raw.preSolicitationConference),
        disabilitiesAct: yesNoToBoolean(raw.disabilitiesAct),
        rightToReject: yesNoToBoolean(raw.rightToReject),
        agencyContactPeriod: yesNoToBoolean(raw.agencyContactPeriod),
    };
}

function joinAddress(contact: DetailData['responseContact']): string | null {
    if (!contact) return null;
    const parts = [contact.address1, contact.address2].map((p) => p?.trim()).filter((p): p is string => !!p);
    return parts.length ? parts.join(', ') : null;
}

/**
 * Pure function merging one listing row with its (optional) detail response
 * into the final output shape. Separated from the network layer so it can be
 * tested against real captured fixtures with zero HTTP calls.
 */
export function buildRecord(
    item: ListingItem,
    detailResult: DetailResult | null,
    context: RecordContext,
    now: Date,
    scrapedAt = now.toISOString(),
): TenderRecord {
    const detail = detailResult?.detail ?? null;
    const docs = detail?.docs ?? [];
    const commodityCodes = detail?.commodityCodes ?? [];
    const contact = detail?.responseContact ?? null;
    const descriptionText = htmlToText(detail?.description);
    const amountsUsd = parseUsdAmounts(descriptionText);
    const indicators = indicatorsOf(detail);
    const closeDateUtc = toUtcIso(item.closeDate);
    const docDates = docs.map((d) => toUtcIso(d.date)).filter((d): d is string => d !== null);
    const linkedId = detail?.linkedAdNumber?.trim() || null;

    return {
        record_id: String(item.advertisementId),
        event_type: context.eventType,
        scraped_at: scrapedAt,
        is_new: context.isNew,
        source_url: detailPageUrl(item.advertisementId),
        data_source: DATA_SOURCE_ATTRIBUTION,

        advertisementId: item.advertisementId,
        uniqueName: item.uniqueName,
        agencyAdNumber: item.agencyAdNumber ?? detail?.agencyAdNumber ?? null,
        title: item.title,
        type: item.type,
        status: item.status,
        agency: item.agency ?? item.organization?.name ?? detail?.agency ?? '',
        openDate: item.openDate,
        closeDate: item.closeDate,
        publishDate: item.publishDate,
        description: detail?.description ?? null,
        commodityCodes,
        documents: docs.map((d) => ({
            fileName: d.fileName,
            downloadUrl: attachmentDownloadUrl(d.attachmentId),
            attachmentId: d.attachmentId,
            description: d.description ?? null,
            date: d.date ?? null,
            dateUtc: toUtcIso(d.date),
            version: d.version ?? null,
            docFor: d.docFor ?? null,
        })),
        responseContact: contact,

        typeId: item.typeId,
        version: item.version,
        isAmended: item.version > 1,
        previousVersion: context.previous?.version ?? null,
        previousStatus: context.previous?.status ?? null,
        organizationId: item.organization?.organizationId ?? detail?.organization?.organizationId ?? null,
        organizationShortName: item.organization?.shortName ?? detail?.organization?.shortName ?? null,
        organizationEntity: item.organization?.entity ?? detail?.organization?.entity ?? null,
        isAwardNotice: item.type === 'Agency Decision',
        isSingleSource: item.type === 'Single Source',

        publishDateUtc: toUtcIso(item.publishDate),
        openDateUtc: toUtcIso(item.openDate),
        closeDateUtc,
        publishDateLocal: toSiteLocal(item.publishDate),
        openDateLocal: toSiteLocal(item.openDate),
        closeDateLocal: toSiteLocal(item.closeDate),
        publishDay: utcCalendarDay(item.publishDate),
        closeDay: utcCalendarDay(item.closeDate),
        responseWindowDays: daysBetween(item.openDate, item.closeDate),
        daysUntilClose: daysUntil(item.closeDate, now),
        isOpenForResponses: item.status === 'OPEN' && closeDateUtc !== null && closeDateUtc > now.toISOString(),

        detailFetched: detail !== null,
        detailError: detailResult?.error ?? null,
        descriptionText,
        amountsUsd,
        maxAmountUsd: amountsUsd.length ? Math.max(...amountsUsd) : null,
        currency: 'USD',
        lastUpdateDate: detail?.lastUpdateDate ?? null,
        lastUpdateDateUtc: toUtcIso(detail?.lastUpdateDate),
        responseDate: detail?.responseDate ?? null,
        responseDateUtc: toUtcIso(detail?.responseDate),
        responseDateLocal: toSiteLocal(detail?.responseDate),
        linkedAdNumber: linkedId,
        linkedAdUrl: linkedId && /^\d+$/.test(linkedId) ? detailPageUrl(linkedId) : null,
        publishOption: detail?.publishOption ?? null,
        withdrawn: typeof detail?.withdrawn === 'boolean' ? detail.withdrawn : null,
        timeRemainingMs: typeof detail?.timeRemaining === 'number' ? detail.timeRemaining : null,
        indicators,
        minorityEncouraged: indicators?.minorityEncouraged ?? null,
        preSolicitationConference: indicators?.preSolicitationConference ?? null,
        disabilitiesAct: indicators?.disabilitiesAct ?? null,
        rightToReject: indicators?.rightToReject ?? null,
        agencyContactPeriod: indicators?.agencyContactPeriod ?? null,
        commodityCodeIds: commodityCodes.map((c) => c.id),
        commodityCodesText: commodityCodes.length ? commodityCodes.map((c) => `${c.id} ${c.value}`).join('; ') : null,
        documentCount: detail ? docs.length : null,
        latestDocumentDateUtc: docDates.length ? docDates.sort().at(-1)! : null,
        contactName: contact?.responseContact?.trim() || null,
        contactEmail: contact?.email?.trim() || null,
        contactPhone: contact?.ph?.trim() || null,
        contactAddress: joinAddress(contact),
        contactCity: contact?.city?.trim() || null,
        contactState: contact?.state?.trim() || null,
        contactZip: contact?.zip?.trim() || null,
    };
}
