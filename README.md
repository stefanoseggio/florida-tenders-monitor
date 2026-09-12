# Florida State Procurement Monitor - MyFloridaMarketPlace Bids & Awards (US Government Contracts)

[![Built for Apify](https://img.shields.io/badge/Built%20for-Apify-00C0B5?style=flat-square&logo=apify&logoColor=white)](https://apify.com)
[![Pay-Per-Event pricing](https://img.shields.io/badge/Pricing-Pay--Per--Event%20from%20%240.001-2ea44f?style=flat-square)](https://apify.com/stefano_seggio/florida-tenders-monitor)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](./LICENSE)

[![Run on Apify](https://apify.com/actor-badge?actor=stefano_seggio/florida-tenders-monitor)](https://apify.com/stefano_seggio/florida-tenders-monitor)

## Executive Value Proposition

MyFloridaMarketPlace's Vendor Bid System has no timestamp sort, no RSS feed and no change log for the addenda that quietly move close dates - so checking it manually means re-scanning the full OPEN and CLOSED lists, by status and type, every single time. This Actor replaces that recurring manual scan with one scheduled run: it applies the same server-side filters as the portal's own search form (status, type, agency, UNSPSC code, publish/open/close dates), and in delta mode returns only the advertisements that are new, amended or have changed status since the previous run. Every record also arrives pre-normalised - UTC and Florida wall-clock timestamps, plain-text descriptions, flattened contacts, UNSPSC codes as a clean array - so a contracts or business-development team reviews a short, already-filtered diff instead of re-reading raw portal pages one advertisement at a time.

## Who uses this

- **Government contractors and SMEs (IT, construction, health and social services)** - filter by `commodityCodeIds`, `type` and `agency` to see only the ITBs, RFPs and ITNs that match their line of business, with `closeDateLocal` and `daysUntilClose` to prioritise which ones to answer first.
- **Capture teams, incumbents and competitive-bid intelligence** - run with `onlyNew: true` against known solicitations and watch for `event_type: UPDATED`: the portal's `version` counter rises on every agency edit, so an addendum, a Q&A document or a close-date extension is caught even though the advertisement's publish date never moves.
- **Compliance and bid-protest teams** - track `STATUS_CHANGE` events (e.g. OPEN to CLOSED) and `isAwardNotice` / `linkedAdNumber` on Agency Decision notices to know the moment an intended award is posted against a solicitation they are following, and confirm on the portal before the statutory protest window closes.

## Quick start

Run it from the [Apify CLI](https://docs.apify.com/cli) with a real input - this pulls open FDOT RFPs and ITNs closing after today, delta-mode on:

```bash
apify call stefano_seggio/florida-tenders-monitor --input '{
    "statuses": ["OPEN"],
    "types": ["5", "6"],
    "agencyIds": ["30000021"],
    "closesAfter": "0 days",
    "onlyNew": true,
    "maxItems": 100,
    "fetchDetail": true
}'
```

Or start it from the [Actor page](https://apify.com/stefano_seggio/florida-tenders-monitor) in the Apify Console, or call it from Node.js / Python with `apify-client` - see [`examples/`](./examples) below.

## Input

Every filter below is applied server-side by MyFloridaMarketPlace's own search endpoint unless marked client-side; leave everything empty to walk every OPEN advertisement.

```json
{
    "statuses": ["OPEN", "CLOSED"],
    "types": ["4", "5", "6"],
    "agencyIds": ["30000021"],
    "commodityCodes": ["43230000"],
    "closesAfter": "0 days",
    "onlyNew": true,
    "maxItems": 200,
    "fetchDetail": true
}
```

| Field                    | Type     | Default                    | Description                                                                                                                                                                                               |
| ------------------------ | -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `statuses`               | string[] | `["OPEN"]`                 | `OPEN`, `CLOSED`, `WITHDRAWN`, `PREVIEW`. OPEN is 2 pages; add `CLOSED` (131 pages, fetched in parallel) for award tracking and `STATUS_CHANGE` events                                                    |
| `types`                  | string[] | `[]` (all)                 | `1` Agency Decision, `2` Grant Opportunities, `3` Informational Notice, `4` ITB, `5` ITN, `6` RFP, `7` Public Meeting Notice, `8` RFI, `9` RSQ, `10` Single Source. Several = union                       |
| `agencyIds`              | string[] | `[]`                       | MFMP `organizationId` values, e.g. `30000021` FDOT, `30000023` DCF, `30000029` AHCA, `30000032` DMS, `30000026` DOH. Every record carries its `organizationId`                                            |
| `agencyNameContains`     | string   | -                           | Substring on the agency name or short name (client-side)                                                                                                                                                  |
| `titleContains`          | string   | -                           | Case-insensitive substring on the title                                                                                                                                                                   |
| `commodityCodes`         | string[] | `[]`                       | Exact 8-digit UNSPSC codes (the portal has no prefix search)                                                                                                                                              |
| `adNumber`                | string   | -                           | One advertisement, `16672` or `AD-16672`                                                                                                                                                                  |
| `agencyAdNumberContains` | string   | -                           | Substring on the agency's own reference, e.g. `DOT-RFP-27`                                                                                                                                                |
| `dateFrom`, `dateTo`     | string   | -                           | Publish window, absolute (`2026-09-01`) or relative (`7 days`). Amendments keep the original publish date                                                                                                |
| `openBefore`             | string   | -                           | Only advertisements whose open date is on or before this day                                                                                                                                              |
| `closesAfter`            | string   | -                           | Only advertisements whose close date is on or after this day (`0 days` = still open today)                                                                                                                |
| `eventTypes`             | string[] | all three                  | Which of `NEW_LISTING`, `UPDATED`, `STATUS_CHANGE` to deliver                                                                                                                                             |
| `onlyNew`                | boolean  | `false`                    | Delta mode - see Reliability below                                                                                                                                                                        |
| `deltaStateName`         | string   | fingerprint of the filters | Name of the delta memory; share it between tasks on purpose, never by accident                                                                                                                            |
| `resetState`             | boolean  | `false`                    | Forget delivered advertisements and re-baseline                                                                                                                                                           |
| `maxItems`               | integer  | `100`                      | Cap on delivered records per run, and on cost. Maximum `50000`                                                                                                                                            |
| `fetchDetail`            | boolean  | `true`                     | One extra request per delivered record for description, commodity codes, documents, contact, response date, last-update timestamp, linked solicitation, indicator flags                                  |
| `maxConcurrency`         | integer  | `5`                        | Parallel listing-page / detail requests (1-10)                                                                                                                                                            |

## Output

One real record (description trimmed; every record carries 70+ fields):

```json
{
    "record_id": "16861",
    "event_type": "NEW_LISTING",
    "scraped_at": "2026-09-08T08:20:11.402Z",
    "is_new": true,
    "source_url": "https://vendor.myfloridamarketplace.com/search/bids/detail/16861",
    "data_source": "MyFloridaMarketPlace Vendor Information Portal (vendor.myfloridamarketplace.com), Florida Department of Management Services - public records under Florida Statutes ch. 119",
    "advertisementId": 16861,
    "uniqueName": "RFP-16861",
    "agencyAdNumber": "DOT-RFP-27-9018-SJ",
    "title": "Commercial Driver's License (CDL) Training and Testing Services",
    "type": "Request for Proposals",
    "typeId": "6",
    "status": "OPEN",
    "agency": "Florida Department of Transportation (FDOT)",
    "organizationId": 30000021,
    "organizationShortName": "FDOT",
    "openDate": "2026-09-03T20:06:37.000+00:00",
    "closeDate": "2026-09-21T14:00:00.000+00:00",
    "publishDateLocal": "2026-09-03 16:06 EDT",
    "closeDateLocal": "2026-09-21 10:00 EDT",
    "responseWindowDays": 17,
    "daysUntilClose": 13,
    "version": 1,
    "isAmended": false,
    "isAwardNotice": false,
    "isSingleSource": false,
    "descriptionText": "The Florida Department of Transportation requests competitive sealed bids/proposals/replies for the procurement of:\nCommercial Driver's License (CDL) Training and Testing Services...",
    "commodityCodes": [
        { "id": "86101715", "value": "Road or rail transportation vocational training services" },
        { "id": "86131701", "value": "Vehicle driving schools services" }
    ],
    "commodityCodeIds": ["71151007", "80111504", "86101609", "86101700", "86101715", "86111600", "86131700", "86131701", "86132000"],
    "documents": [
        {
            "fileName": "9018 - Solicitation Document.pdf",
            "downloadUrl": "https://vendor.myfloridamarketplace.com/mfmp/bids/detail/attachment/download?attachmentId=40095",
            "attachmentId": 40095,
            "description": "SOLICITATION DOCUMENT",
            "dateUtc": "2026-09-03T20:06:24.000Z"
        }
    ],
    "documentCount": 1,
    "responseContact": {
        "responseContact": "SHERILL JOHNSON",
        "email": "CO.Purch@dot.state.fl.us",
        "ph": "(000) 000-0000",
        "address1": "FDOT PROCUREMENT OFFICE",
        "city": "TALLAHASSEE",
        "state": "FL",
        "zip": "32399-0450"
    },
    "contactName": "SHERILL JOHNSON",
    "contactEmail": "CO.Purch@dot.state.fl.us",
    "minorityEncouraged": false,
    "preSolicitationConference": false
}
```

An amendment carries `"event_type": "UPDATED"`, `"is_new": false`, a higher `version`, a `previousVersion` and a fresh entry in `documents[]` (e.g. `"description": "Addendum No. 03 - Q&A"`). An intent-to-award notice carries `"type": "Agency Decision"`, `"isAwardNotice": true` and `linkedAdNumber` / `linkedAdUrl` pointing at the original solicitation.

**Integration envelope** (same on every run): `record_id`, `event_type` (`NEW_LISTING` / `UPDATED` / `STATUS_CHANGE`), `scraped_at`, `is_new`, `source_url`, `data_source`.

**Advertisement fields**, grouped: Identity (`advertisementId`, `uniqueName`, `agencyAdNumber`, `title`, `type`, `typeId`, `status`, `isAwardNotice`, `isSingleSource`) - Agency (`agency`, `organizationId`, `organizationShortName`, `organizationEntity`) - Dates, raw and normalised (`openDate`/`closeDate`/`publishDate`, their `...Utc` and `...Local` twins, `publishDay`, `closeDay`, `responseWindowDays`, `daysUntilClose`, `isOpenForResponses`) - Amendments (`version`, `isAmended`, `previousVersion`, `previousStatus`, `lastUpdateDateUtc`) - Detail, when `fetchDetail: true` (`description`, `descriptionText`, `amountsUsd`, `maxAmountUsd`, `responseDate`/`responseDateLocal`, `linkedAdNumber`/`linkedAdUrl`, `withdrawn`, `minorityEncouraged`, `preSolicitationConference`) - Commodity codes (`commodityCodes` as `{id, value}[]`, `commodityCodeIds`) - Documents (`documents[]` with `fileName`, `downloadUrl`, `attachmentId`, `description`, `dateUtc`, `documentCount`) - Contact (`responseContact` raw object plus flattened `contactName`, `contactEmail`, `contactPhone`, `contactAddress`, `contactCity`, `contactState`, `contactZip`).

Output tab views: Overview, Bid pipeline, Amendments & status changes, Awards & single source, Contacts - or export JSON, CSV or Excel.

## Reliability

Delta mode (`onlyNew: true`) is keyed on the portal's own `version` counter and `status`, not on publish date - because MFMP keeps an advertisement's original `publishDate` even after an agency adds an addendum, so a date-keyed check would never see the edit.

- **Baseline run**: the first run with `onlyNew: true` delivers up to `maxItems` of the most recently published matching advertisements and remembers each one's `advertisementId`, `version` and `status` in a private, named key-value store (`florida-tenders-monitor-state-<deltaStateName>`). A small `maxItems` on that first run keeps the baseline cheap; anything older is treated as history.
- **Later runs**: every run re-reads the full listing for your filters (MFMP has no timestamp sort), then delivers only rows that are unknown (`NEW_LISTING`), whose `version` rose (`UPDATED`) or whose `status` flipped (`STATUS_CHANGE`). Detail is fetched only for rows that will actually be delivered.
- **Crash-safe delivery**: memory is written only for records that were actually stored in the dataset, and records are appended oldest-first within a run, so a spending limit, timeout or platform migration mid-run never loses an advertisement - the next run simply picks up where delivery stopped. Anything that overflows `maxItems` is logged as a backlog and re-discovered automatically on the next run.
- **Isolated or shared memory**: different filter combinations get separate delta memories automatically (fingerprinted from your input); set `deltaStateName` to share one memory across tasks on purpose, or `resetState: true` to force a fresh baseline.
- **Rate handling**: the listing endpoint starts returning HTTP 429 above roughly 8 requests in flight, so default concurrency is 5 and 429s are retried with backoff rather than failing the run.
- **Fail loud, not silent**: every response is validated for the expected JSON shape; if the portal changes in a way the parser doesn't recognise, the run fails instead of returning an empty "0 results, success" dataset.

## Pricing (Pay-Per-Event)

Pay per event (`PAY_PER_EVENT`) - platform usage is included, you pay only for delivered records, never for compute time:

| Event                            | Title                        | Price                        | When it's charged                                                                              |
| --------------------------------- | ----------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `result`                          | Record (full detail)          | **$0.003** per advertisement  | A record delivered with full detail (description, commodity codes, documents, contact, 70+ fields) |
| `result-summary`                  | Record (listing summary)      | **$0.001** per advertisement  | A listing-only record (`fetchDetail: false`, or a detail request that could not be completed)     |
| Actor start                       | -                              | $0.00005                      | Once per run                                                                                     |

Worked examples from these figures: the entire OPEN register (roughly 165 advertisements) with full detail costs about **$0.50**; a daily delta-mode monitor that turns up 8 new or amended advertisements costs about **$0.024/day** - under $1/month; a full CLOSED-register backfill of roughly 13,000 records costs about **$39** with detail or **$13** listing-only. A quiet monitoring run that finds nothing new costs only the Actor-start fee.

## Support & Enterprise SLA

This Actor is built and maintained by an independent developer, not a vendor support team - there is no enterprise SLA on offer, and none is claimed here. Bug reports and feature requests are handled through the Apify Store **Issues** tab for this Actor, with a typical first response inside about 48 hours. Versioned changes are recorded in the Actor's Changelog tab so you can see exactly what shipped between runs.

---

This Actor is part of **Delta Registry** - pay-per-event regulatory & compliance data infrastructure built and operated by Stefano Seggio. For professional inquiries or enterprise licensing, connect on [LinkedIn](https://www.linkedin.com/in/stefanoseggio-deltaregistry); for the rest of the fleet, see [github.com/stefanoseggio](https://github.com/stefanoseggio).
