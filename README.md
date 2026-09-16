# Florida State Procurement Monitor - MyFloridaMarketPlace Bids & Awards (US Government Contracts)

[![Built for Apify](https://img.shields.io/badge/Built%20for-Apify-00C0B5?style=flat-square&logo=apify&logoColor=white)](https://apify.com)
[![Pay-Per-Event pricing](https://img.shields.io/badge/Pricing-Pay--Per--Event%20from%20%240.001-2ea44f?style=flat-square)](https://apify.com/stefano_seggio/florida-tenders-monitor)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](./LICENSE)

[![Run on Apify](https://apify.com/actor-badge?actor=stefano_seggio/florida-tenders-monitor)](https://apify.com/stefano_seggio/florida-tenders-monitor)

**Monitors MyFloridaMarketPlace (MFMP VBS) — the State of Florida's official Vendor Bid System — for ITB / RFP / ITN / RFI / RSQ solicitations and Agency Decision (award) notices, and runs on whatever Apify schedule you configure; there is no fixed built-in cadence.**

## Executive Value Proposition

MyFloridaMarketPlace's Vendor Bid System has no timestamp sort, no RSS feed and no change log for the addenda that quietly move close dates - so checking it manually means re-scanning the full OPEN and CLOSED lists, by status and type, every single time. This Actor replaces that recurring manual scan with one scheduled run: it applies the same server-side filters as the portal's own search form (status, type, agency, UNSPSC code, publish/open/close dates), and in delta mode returns only the advertisements that are new, amended or have changed status since the previous run. Every record also arrives pre-normalised - UTC and Florida wall-clock timestamps, plain-text descriptions, flattened contacts, UNSPSC codes as a clean array - so a contracts or business-development team reviews a short, already-filtered diff instead of re-reading raw portal pages one advertisement at a time.

## Who uses this

- **Government contractors and SMEs (IT, construction, health and social services)** - filter by `commodityCodeIds`, `type` and `agency` to see only the ITBs, RFPs and ITNs that match their line of business, with `closeDateLocal` and `daysUntilClose` to prioritise which ones to answer first.
- **Capture teams, incumbents and competitive-bid intelligence** - run with `onlyNew: true` against known solicitations and watch for `event_type: UPDATED`: the portal's `version` counter rises on every agency edit, so an addendum, a Q&A document or a close-date extension is caught even though the advertisement's publish date never moves.
- **Compliance and bid-protest teams** - track `STATUS_CHANGE` events (e.g. OPEN to CLOSED) and `isAwardNotice` / `linkedAdNumber` on Agency Decision notices to know the moment an intended award is posted against a solicitation they are following, and confirm on the portal before the statutory protest window closes.

## Cost & BYOK Disclosure

**No third-party key required.** This Actor needs nothing beyond your Apify account — there is no BYOK requirement, no separate MyFloridaMarketPlace credential, and no pooled or resold third-party license involved.

Pay per event (`PAY_PER_EVENT`) - platform usage is included, you pay only for delivered records, never for compute time:

| Event | Title | Price | When it's charged |
| --- | --- | --- | --- |
| `result` | Record (full detail) | **$0.003** per advertisement | A record delivered with full detail (description, commodity codes, documents, contact, 70+ fields) |
| `result-summary` | Record (listing summary) | **$0.001** per advertisement | A listing-only record (`fetchDetail: false`, or a detail request that could not be completed) |
| Actor start | — | $0.00005 | Once per run |

**Unchanged records are never billed.** Delta mode is keyed on the portal's own `version` counter and `status` field, not a generic timestamp: a record whose `version` and `status` still match what this Actor delivered on a previous run is treated as unchanged and is suppressed before delivery — it never reaches the dataset and is never charged. Only a record that is genuinely new, whose `version` rose (an addendum, Q&A, or close-date extension), or whose `status` flipped, is delivered and billed.

Worked examples from these figures: the entire OPEN register (roughly 165 advertisements) with full detail costs about **$0.50**; a daily delta-mode monitor that turns up 8 new or amended advertisements costs about **$0.024/day** - under $1/month; a full CLOSED-register backfill of roughly 13,000 records costs about **$39** with detail or **$13** listing-only. A quiet monitoring run that finds nothing new costs only the Actor-start fee.

## Quickstart

Also runnable straight from the [Apify CLI](https://docs.apify.com/cli) with a real input — this pulls open FDOT RFPs and ITNs closing after today, delta-mode on — or from the [Actor page](https://apify.com/stefano_seggio/florida-tenders-monitor) in the Apify Console:

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

### cURL (instant terminal run)

Runs synchronously and returns the resulting dataset items directly in the response - no polling needed. Get your token from [console.apify.com/settings/integrations](https://console.apify.com/settings/integrations).

```bash
curl -X POST "https://api.apify.com/v2/acts/afSZyXLVcgnLpucyo/run-sync-get-dataset-items?token=<YOUR_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
  "maxItems": 50,
  "onlyNew": true
}'
```

### Python (`apify-client`)

```python
import os

from apify_client import ApifyClient

client = ApifyClient(os.environ["APIFY_TOKEN"])

run_input = {
    "statuses": ["OPEN"],
    "types": ["5", "6"],  # Invitation to Negotiate (ITN), Request for Proposals (RFP)
    "agencyIds": ["30000021"],  # Florida Department of Transportation (FDOT)
    "closesAfter": "0 days",  # only advertisements still open today
    "onlyNew": True,  # delta mode: only new / amended / status-changed records
    "maxItems": 100,
    "fetchDetail": True,
}

run = client.actor("stefano_seggio/florida-tenders-monitor").call(run_input=run_input)

dataset_items = client.dataset(run["defaultDatasetId"]).list_items().items
for item in dataset_items:
    print(f"{item['event_type']} | {item['uniqueName']} | {item['title']} ({item['status']})")
```

A full, runnable copy of this script lives at [`examples/run_actor.py`](./examples/run_actor.py).

### Node.js (`apify-client`)

```js
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const input = {
    statuses: ['OPEN'],
    types: ['5', '6'], // Invitation to Negotiate (ITN), Request for Proposals (RFP)
    agencyIds: ['30000021'], // Florida Department of Transportation (FDOT)
    closesAfter: '0 days', // only advertisements still open today
    onlyNew: true, // delta mode: only new / amended / status-changed records
    maxItems: 100,
    fetchDetail: true,
};

const run = await client.actor('stefano_seggio/florida-tenders-monitor').call(input);
const { items } = await client.dataset(run.defaultDatasetId).listItems();

for (const item of items) {
    console.log(`${item.event_type} | ${item.uniqueName} | ${item.title} (${item.status})`);
}
```

A full, runnable copy of this script lives at [`examples/run-actor.cjs`](./examples/run-actor.cjs) (CommonJS, `require`-based).

## Input & Output Schema

### Input

Every filter below is applied server-side by MyFloridaMarketPlace's own search endpoint unless marked client-side; leave everything empty to walk every OPEN advertisement. Field definitions come straight from [`.actor/input_schema.json`](./.actor/input_schema.json).

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

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `statuses` | string[] | `["OPEN"]` | `OPEN`, `CLOSED`, `WITHDRAWN`, `PREVIEW`. OPEN is 2 pages; add `CLOSED` (131 pages, fetched in parallel) for award tracking and `STATUS_CHANGE` events |
| `types` | string[] | `[]` (all) | `1` Agency Decision, `2` Grant Opportunities, `3` Informational Notice, `4` ITB, `5` ITN, `6` RFP, `7` Public Meeting Notice, `8` RFI, `9` RSQ, `10` Single Source. Several = union |
| `agencyIds` | string[] | `[]` | MFMP `organizationId` values, e.g. `30000021` FDOT, `30000023` DCF, `30000029` AHCA, `30000032` DMS, `30000026` DOH. Every record carries its `organizationId` |
| `agencyNameContains` | string | - | Substring on the agency name or short name (client-side) |
| `titleContains` | string | - | Case-insensitive substring on the title |
| `commodityCodes` | string[] | `[]` | Exact 8-digit UNSPSC codes (the portal has no prefix search) |
| `adNumber` | string | - | One advertisement, `16672` or `AD-16672` |
| `agencyAdNumberContains` | string | - | Substring on the agency's own reference, e.g. `DOT-RFP-27` |
| `dateFrom`, `dateTo` | string | - | Publish window, absolute (`2026-09-01`) or relative (`7 days`). Amendments keep the original publish date |
| `openBefore` | string | - | Only advertisements whose open date is on or before this day |
| `closesAfter` | string | - | Only advertisements whose close date is on or after this day (`0 days` = still open today) |
| `eventTypes` | string[] | all three | Which of `NEW_LISTING`, `UPDATED`, `STATUS_CHANGE` to deliver |
| `onlyNew` | boolean | `false` | Delta mode - see Reliability below |
| `deltaStateName` | string | fingerprint of the filters | Name of the delta memory; share it between tasks on purpose, never by accident |
| `resetState` | boolean | `false` | Forget delivered advertisements and re-baseline |
| `maxItems` | integer | `100` | Cap on delivered records per run, and on cost. Maximum `50000` |
| `fetchDetail` | boolean | `true` | One extra request per delivered record for description, commodity codes, documents, contact, response date, last-update timestamp, linked solicitation, indicator flags |
| `maxConcurrency` | integer | `5` | Parallel listing-page / detail requests (1-10) |

### Output

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

Field descriptions below (from [`.actor/dataset_schema.json`](./.actor/dataset_schema.json)) cover every field in the sample above:

**Integration envelope** (same on every run):

| Field | Description |
| --- | --- |
| `record_id` | `advertisementId` as a string - stable across runs |
| `event_type` | `NEW_LISTING`, `UPDATED` (version counter rose) or `STATUS_CHANGE` (e.g. OPEN → CLOSED) |
| `scraped_at` | ISO-8601 UTC timestamp of this extraction |
| `is_new` | `true` when this advertisement was never delivered by a previous run of this delta memory |
| `source_url` | The advertisement's page on the portal |
| `data_source` | Attribution string |

**Advertisement identity & agency:**

| Field | Description |
| --- | --- |
| `advertisementId` | Numeric portal ID |
| `uniqueName` | Display ID, e.g. `AD-16672` |
| `agencyAdNumber` | The agency's own reference |
| `title` | Advertisement title |
| `type` / `typeId` | Human-readable type / the `types` filter value (`"1"`–`"10"`) |
| `status` | `OPEN`, `CLOSED`, `WITHDRAWN` or `PREVIEW` |
| `agency` / `organizationId` / `organizationShortName` | Agency name, stable ID and short name (e.g. `FDOT`) |

**Dates:**

| Field | Description |
| --- | --- |
| `openDate` / `closeDate` | Raw portal timestamps |
| `publishDateLocal` / `closeDateLocal` | Florida wall-clock strings with EST/EDT |
| `responseWindowDays` | Whole days between open and close |
| `daysUntilClose` | Negative once closed |

**Amendments:**

| Field | Description |
| --- | --- |
| `version` | The portal's amendment counter - rises on every agency edit; the delta engine's change key |
| `isAmended` | `version > 1` |
| `previousVersion` / `previousStatus` | Value at the previous delivery (`UPDATED` / `STATUS_CHANGE` events only) |
| `isAwardNotice` | `type = Agency Decision` (starts the 72-hour protest window) |
| `isSingleSource` | Non-competitive purchase notice |

**Detail, commodity codes, documents, contact** (populated when `fetchDetail: true`):

| Field | Description |
| --- | --- |
| `descriptionText` | Plain-text rendering of the portal's HTML description |
| `commodityCodes` | UNSPSC codes with labels, as `{id, value}[]` |
| `commodityCodeIds` | Same codes as a flat string array |
| `documents` / `documentCount` | Attachments with direct download links and posting dates; addenda appear here with their title |
| `responseContact` | Raw contact object from the portal |
| `contactName` / `contactEmail` | Flattened contact fields |
| `minorityEncouraged` / `preSolicitationConference` | The portal's own indicator flags |

Output tab views in the Apify Console: Overview, Bid pipeline, Amendments & status changes, Awards & single source, Contacts - or export JSON, CSV or Excel.

## Reliability

Delta mode (`onlyNew: true`) is keyed on the portal's own `version` counter and `status`, not on publish date - because MFMP keeps an advertisement's original `publishDate` even after an agency adds an addendum, so a date-keyed check would never see the edit.

- **Baseline run**: the first run with `onlyNew: true` delivers up to `maxItems` of the most recently published matching advertisements and remembers each one's `advertisementId`, `version` and `status` in a private, named key-value store (`florida-tenders-monitor-state-<deltaStateName>`). A small `maxItems` on that first run keeps the baseline cheap; anything older is treated as history.
- **Later runs**: every run re-reads the full listing for your filters (MFMP has no timestamp sort), then delivers only rows that are unknown (`NEW_LISTING`), whose `version` rose (`UPDATED`) or whose `status` flipped (`STATUS_CHANGE`). Detail is fetched only for rows that will actually be delivered.
- **Crash-safe delivery**: memory is written only for records that were actually stored in the dataset, and records are appended oldest-first within a run, so a spending limit, timeout or platform migration mid-run never loses an advertisement - the next run simply picks up where delivery stopped. Anything that overflows `maxItems` is logged as a backlog and re-discovered automatically on the next run.
- **Isolated or shared memory**: different filter combinations get separate delta memories automatically (fingerprinted from your input); set `deltaStateName` to share one memory across tasks on purpose, or `resetState: true` to force a fresh baseline.
- **Rate handling**: the listing endpoint starts returning HTTP 429 above roughly 8 requests in flight, so default concurrency is 5 and 429s are retried with backoff rather than failing the run.
- **Fail loud, not silent**: every response is validated for the expected JSON shape; if the portal changes in a way the parser doesn't recognise, the run fails instead of returning an empty "0 results, success" dataset.

## Contributing & Local Setup

This repository contains the Actor's real, buildable TypeScript source (`src/`) — there is no proprietary logic held back from GitHub. To work on it locally:

```bash
git clone https://github.com/stefanoseggio/florida-tenders-monitor.git
cd florida-tenders-monitor
npm install

# Run against the real MyFloridaMarketPlace portal, Apify-CLI style:
apify login          # one-time, needs an Apify account
apify run             # runs src/main.ts via the Apify SDK's local dev flow

# Or run the TypeScript entrypoint directly:
npm run start:dev     # tsx src/main.ts

# Build, lint and test before opening a PR:
npm run build          # tsc
npm run lint
npm test               # vitest run (mocked fixtures)
npm run test:live      # vitest run against the live portal (LIVE=1)
```

Source layout: `src/main.ts` (Actor entrypoint), `src/fetchTenders.ts` (listing walk + pagination), `src/api.ts` / `src/http.ts` (MFMP endpoint calls, retry/backoff), `src/normalize.ts` (raw-to-normalised field mapping), `src/parsers/` (portal response parsing), `src/state.ts` (delta key-value store), `src/input.ts` / `src/types.ts` (input validation and shared types). Real unit tests live in `test/`, with fixture-based coverage for parsing and delivery plus an opt-in `test:live` suite that hits the real portal.

Bug reports and feature requests are handled through the Apify Store **Issues** tab for this Actor (see [Support](#support--enterprise-sla) below) rather than GitHub Issues, since that is where paying users of the published Actor already are — but pull requests against this repository are welcome.

## Support & Enterprise SLA

This Actor is built and maintained by an independent developer, not a vendor support team - there is no enterprise SLA on offer, and none is claimed here. Bug reports and feature requests are handled through the Apify Store **Issues** tab for this Actor, with a typical first response inside about 48 hours. Versioned changes are recorded in the Actor's Changelog tab so you can see exactly what shipped between runs.

## License

The source code in this repository is licensed under the [Apache License 2.0](./LICENSE).

---

This Actor is part of **Delta Registry** - pay-per-event regulatory & compliance data infrastructure built and operated by Stefano Seggio. For professional inquiries or enterprise licensing, connect on [LinkedIn](https://www.linkedin.com/in/stefanoseggio-deltaregistry); for the rest of the fleet, see [github.com/stefanoseggio](https://github.com/stefanoseggio).
