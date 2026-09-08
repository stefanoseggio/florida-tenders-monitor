# MyFloridaMarketPlace Bids Scraper & Monitor

**The Florida state bids API that MyFloridaMarketPlace never shipped.** This Actor turns the **Vendor Information Portal of MyFloridaMarketPlace (MFMP VBS, vendor.myfloridamarketplace.com)** - the statutory posting site for every State of Florida agency solicitation - into clean JSON/CSV: **Invitations to Bid (ITB), Requests for Proposals (RFP), Invitations to Negotiate (ITN), RFIs, RSQs, Single Source notices, Agency Decisions (intent to award), Grant Opportunities, public meeting and informational notices**, each with agency, dates, UNSPSC commodity codes, response contact, plain-text description and direct document download links. Put it on a schedule with _Only new_ switched on and every run returns just the advertisements that were **posted, amended or changed status since the last run** - including the addenda and Q&A that move due dates and that publish-date alerts never see.

[![MyFloridaMarketPlace Bids Scraper & Monitor](https://apify.com/actor-badge?actor=stefano_seggio/florida-tenders-monitor)](https://apify.com/stefano_seggio/florida-tenders-monitor)

- **Search like the portal, at API speed** - status, the 10 advertisement types, agency, title keyword, agency reference, exact UNSPSC commodity codes, publish day, open-by and closes-after dates are applied by MFMP's own search endpoint, so a narrow monitor costs a handful of requests.
- **Catch addenda, extensions and awards** - MFMP keeps the original publish date when an agency amends a solicitation, so date-keyed scrapers and email digests miss every addendum. This Actor keys its memory on the portal's own `version` counter and `status`, and tags each row `NEW_LISTING`, `UPDATED` or `STATUS_CHANGE`.
- **Warehouse-ready, not screen-scraped** - every raw portal value comes with a normalised twin: UTC ISO timestamps, Florida wall-clock strings (EST/EDT), response window in days, days until close, plain-text description, dollar amounts mined from the text, flattened contact, linked original solicitation for award notices.
- **No browser, no proxy, no login.** Plain HTTP against the portal's public JSON endpoints, 256 MB of memory, pay per record.

## What is MyFloridaMarketPlace and why does the Vendor Bid System matter?

MyFloridaMarketPlace is Florida's statewide e-procurement system, run by the Department of Management Services (DMS). Under section 287.042(3)(b) of the Florida Statutes and Rule 60A-1 F.A.C., state agencies must advertise their competitive solicitations - and post their intended awards - on the Vendor Bid System, which today lives in the MFMP Vendor Information Portal. It is the single official feed of _who in Florida state government is buying what, from when to when, under which commodity codes, and who they intend to award it to_. On 8 September 2026 the portal held 165 OPEN advertisements, 13,027 CLOSED and 421 WITHDRAWN.

The portal has a search form and, for registered vendors, email notifications by commodity code - but **no public API, no RSS, no CSV export, and no change feed for addenda**. The Angular front end talks to a JSON back end that only answers when a request carries a specific `Accept` header; this Actor is the programmable layer on top of it. Start from the portal at [vendor.myfloridamarketplace.com/search/bids](https://vendor.myfloridamarketplace.com/search/bids).

## Quick start

1. Click **Try for free**. The default input returns the 100 most recently published OPEN advertisements with full detail - about 20 seconds and $0.30.
2. Open the **Output** tab: five ready-made views (Overview, Bid pipeline, Amendments & status changes, Awards & single source, Agency contacts) or export **JSON, CSV or Excel**.
3. Narrow it: pick _Advertisement types_ (ITB, RFP, ITN...), an _Agency ID_ such as `30000021` (FDOT), a _Title contains_ keyword, or your UNSPSC codes.
4. Monitor it: keep **Only new** on, add an [Apify Schedule](https://docs.apify.com/platform/schedules) (every 6 or 24 hours) and a [webhook](https://docs.apify.com/platform/integrations/webhooks) or the Slack / Make / Zapier integration. From the second run on you only pay for what actually appeared or changed.

## Who uses Florida state procurement data

| Team                                                                               | Question they ask                                                                                         | Fields that answer it                                                                             | Decision                                                               |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Florida government contractors and SMEs (IT, construction, health/social services) | Which new ITBs / RFPs / ITNs match my commodity codes, and when is the Q&A deadline?                      | `type`, `commodityCodeIds`, `closeDateLocal`, `daysUntilClose`, `documents[]`, `contactEmail`     | Bid / no-bid, proposal calendar                                        |
| Capture teams and incumbents                                                       | Did the agency just post an addendum or extend the close date on a solicitation we are working on?        | `event_type: UPDATED`, `version`, `previousVersion`, `lastUpdateDateUtc`, `latestDocumentDateUtc` | Re-read the addendum, re-plan the response                             |
| Bid-protest counsel, competitive intelligence                                      | Which intent-to-award notices were posted today, and which original solicitation do they resolve?         | `isAwardNotice`, `linkedAdNumber`, `linkedAdUrl`, `publishDateLocal`                              | File a notice of protest inside the 72-hour window (s. 120.57(3) F.S.) |
| Bid-notification resellers and procurement-intelligence platforms                  | A normalised Florida state feed with change detection, instead of an in-house scraper for the Angular SPA | The whole record, `record_id`, `event_type`, `is_new`                                             | Buy the feed, retire the crawler                                       |
| Agencies' vendor-diversity and small-business offices                              | Which solicitations flag minority participation or a pre-solicitation conference?                         | `minorityEncouraged`, `preSolicitationConference`, `agency`                                       | Outreach lists                                                         |
| Journalists, researchers, civic tech                                               | How often do agencies buy single-source, from whom, and for how much?                                     | `isSingleSource`, `descriptionText`, `amountsUsd`, `maxAmountUsd`, `statuses: CLOSED`             | Stories, public-spending datasets                                      |

## Sample output

One real record (description trimmed; every record carries all 70+ fields listed below):

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
    "organizationEntity": "550000",
    "openDate": "2026-09-03T20:06:37.000+00:00",
    "closeDate": "2026-09-21T14:00:00.000+00:00",
    "publishDate": "2026-09-03T20:06:37.000+00:00",
    "publishDateUtc": "2026-09-03T20:06:37.000Z",
    "closeDateUtc": "2026-09-21T14:00:00.000Z",
    "publishDateLocal": "2026-09-03 16:06 EDT",
    "closeDateLocal": "2026-09-21 10:00 EDT",
    "publishDay": "2026-09-03",
    "closeDay": "2026-09-21",
    "responseWindowDays": 17,
    "daysUntilClose": 13,
    "isOpenForResponses": true,
    "version": 1,
    "isAmended": false,
    "previousVersion": null,
    "previousStatus": null,
    "isAwardNotice": false,
    "isSingleSource": false,
    "detailFetched": true,
    "detailError": null,
    "description": "<p>The Florida Department of Transportation requests competitive sealed bids/proposals/replies for the procurement of:&nbsp;</p><p><strong>Commercial Driver’s License (CDL) Training and Testing Services</strong></p>...",
    "descriptionText": "The Florida Department of Transportation requests competitive sealed bids/proposals/replies for the procurement of:\nCommercial Driver’s License (CDL) Training and Testing Services\nAll Bidders, Proposers, and Respondents must be registered in the State of Florida’s MyFloridaMarketplace system. ...",
    "amountsUsd": [],
    "maxAmountUsd": null,
    "currency": "USD",
    "lastUpdateDate": "2026-09-03T20:06:37.000+00:00",
    "lastUpdateDateUtc": "2026-09-03T20:06:37.000Z",
    "responseDate": "2026-09-21T14:00:00.000+00:00",
    "responseDateLocal": "2026-09-21 10:00 EDT",
    "linkedAdNumber": null,
    "publishOption": "Start Immediately",
    "withdrawn": false,
    "commodityCodes": [
        { "id": "86101715", "value": "Road or rail transportation vocational training services" },
        { "id": "86131701", "value": "Vehicle driving schools services" }
    ],
    "commodityCodeIds": [
        "71151007",
        "80111504",
        "86101609",
        "86101700",
        "86101715",
        "86111600",
        "86131700",
        "86131701",
        "86132000"
    ],
    "documents": [
        {
            "fileName": "9018 - Solicitation Document.pdf",
            "downloadUrl": "https://vendor.myfloridamarketplace.com/mfmp/bids/detail/attachment/download?attachmentId=40095",
            "attachmentId": 40095,
            "description": "SOLICITATION DOCUMENT",
            "date": "2026-09-03T20:06:24.000+00:00",
            "dateUtc": "2026-09-03T20:06:24.000Z",
            "version": null,
            "docFor": "advertisementDocuments"
        }
    ],
    "documentCount": 1,
    "latestDocumentDateUtc": "2026-09-03T20:06:24.000Z",
    "responseContact": {
        "responseContact": "SHERILL JOHNSON",
        "email": "CO.Purch@dot.state.fl.us",
        "ph": "(000) 000-0000",
        "address1": "FDOT PROCUREMENT OFFICE",
        "address2": "605 SUWANNEE STREET",
        "city": "TALLAHASSEE",
        "state": "FL",
        "zip": "32399-0450"
    },
    "contactName": "SHERILL JOHNSON",
    "contactEmail": "CO.Purch@dot.state.fl.us",
    "contactPhone": "(000) 000-0000",
    "contactAddress": "FDOT PROCUREMENT OFFICE, 605 SUWANNEE STREET",
    "contactCity": "TALLAHASSEE",
    "contactState": "FL",
    "contactZip": "32399-0450",
    "minorityEncouraged": false,
    "preSolicitationConference": false
}
```

An amendment looks the same with `"event_type": "UPDATED"`, `"is_new": false`, `"version": 7`, `"previousVersion": 6`, a fresh `lastUpdateDateUtc` and a new entry in `documents[]` such as `"description": "Addendum No. 03 - Q&A"`. An intent-to-award notice carries `"type": "Agency Decision"`, `"isAwardNotice": true` and `"linkedAdNumber": "16671"` with `linkedAdUrl` pointing at the original solicitation.

## Output fields

**Integration envelope** (identical across all of this developer's public-register Actors, so one webhook parser serves them all):

| Field         | Type    | Description                                                                                                                                                                                      |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `record_id`   | string  | `advertisementId` as a string - stable across runs                                                                                                                                               |
| `event_type`  | string  | `NEW_LISTING` (never delivered before), `UPDATED` (a known advertisement whose `version` counter rose: addendum, Q&A, close-date extension, new document), `STATUS_CHANGE` (e.g. OPEN -> CLOSED) |
| `scraped_at`  | string  | ISO-8601 UTC timestamp of the extraction                                                                                                                                                         |
| `is_new`      | boolean | `true` if never delivered by a previous run of this delta memory                                                                                                                                 |
| `source_url`  | string  | The advertisement's page on the portal                                                                                                                                                           |
| `data_source` | string  | Attribution string                                                                                                                                                                               |

**Advertisement** - raw portal values are kept verbatim (the v1 field names are unchanged); normalised twins sit next to them:

| Group                        | Fields                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity                     | `advertisementId`, `uniqueName` (`RFP-16861`, `AD-16672`, `GO-14963`...), `agencyAdNumber`, `title`, `type`, `typeId`, `status`, `isAwardNotice`, `isSingleSource`                                                                                                                                                                                                                                                                                          |
| Agency                       | `agency`, `organizationId` (the `agencyIds` filter value), `organizationShortName`, `organizationEntity`                                                                                                                                                                                                                                                                                                                                                    |
| Dates                        | `openDate` / `closeDate` / `publishDate` (raw), `openDateUtc` / `closeDateUtc` / `publishDateUtc` (canonical `Z`), `openDateLocal` / `closeDateLocal` / `publishDateLocal` (Florida wall-clock, EST/EDT), `publishDay`, `closeDay`, `responseWindowDays`, `daysUntilClose`, `isOpenForResponses`                                                                                                                                                            |
| Amendments                   | `version` (the portal's amendment counter), `isAmended`, `previousVersion`, `previousStatus`, `lastUpdateDate` / `lastUpdateDateUtc`                                                                                                                                                                                                                                                                                                                        |
| Detail (`fetchDetail: true`) | `description` (HTML), `descriptionText` (plain text), `amountsUsd`, `maxAmountUsd`, `currency`, `responseDate` / `responseDateUtc` / `responseDateLocal` (proposal due date - can differ from `closeDate`), `linkedAdNumber` / `linkedAdUrl` (award -> original solicitation), `publishOption`, `withdrawn`, `timeRemainingMs`, `indicators` + `minorityEncouraged`, `preSolicitationConference`, `disabilitiesAct`, `rightToReject`, `agencyContactPeriod` |
| Commodity codes              | `commodityCodes` (`{id, value}[]`), `commodityCodeIds`, `commodityCodesText`                                                                                                                                                                                                                                                                                                                                                                                |
| Documents                    | `documents[]` (`fileName`, `downloadUrl`, `attachmentId`, `description` - addendum title, `date` / `dateUtc`, `version`, `docFor`), `documentCount`, `latestDocumentDateUtc`                                                                                                                                                                                                                                                                                |
| Contact                      | `responseContact` (raw object), `contactName`, `contactEmail`, `contactPhone`, `contactAddress`, `contactCity`, `contactState`, `contactZip`                                                                                                                                                                                                                                                                                                                |
| Provenance                   | `detailFetched`, `detailError` (`NOT_FOUND` when the portal no longer has the advertisement)                                                                                                                                                                                                                                                                                                                                                                |

Records are appended **oldest-first within a run** (that is what makes delta mode crash-safe - see _How monitoring works_). The Output views show newest first; on the API add `?desc=true`.

## Input

Every filter is applied server-side by MFMP unless marked otherwise.

| Field                    | Type     | Default                    | Description                                                                                                                                                                                               |
| ------------------------ | -------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `statuses`               | string[] | `["OPEN"]`                 | `OPEN`, `CLOSED`, `WITHDRAWN`, `PREVIEW`. OPEN is 2 pages; add CLOSED (131 pages, fetched in parallel) for award tracking and `STATUS_CHANGE` events                                                      |
| `types`                  | string[] | `[]` (all)                 | `1` Agency Decision, `2` Grant Opportunities, `3` Informational Notice, `4` ITB, `5` ITN, `6` RFP, `7` Public Meeting Notice, `8` RFI, `9` RSQ, `10` Single Source. Several = union. Labels also accepted |
| `agencyIds`              | string[] | `[]`                       | MFMP `organizationId` values, e.g. `30000021` FDOT, `30000023` DCF, `30000029` AHCA, `30000032` DMS, `30000026` DOH. Every record carries its `organizationId`                                            |
| `agencyNameContains`     | string   | -                          | Substring on the agency name or short name (**client-side**)                                                                                                                                              |
| `titleContains`          | string   | -                          | Case-insensitive substring on the title                                                                                                                                                                   |
| `commodityCodes`         | string[] | `[]`                       | Exact 8-digit UNSPSC codes (the portal has no prefix search)                                                                                                                                              |
| `adNumber`               | string   | -                          | One advertisement, `16672` or `AD-16672`                                                                                                                                                                  |
| `agencyAdNumberContains` | string   | -                          | Substring on the agency's own reference, e.g. `DOT-RFP-27`                                                                                                                                                |
| `dateFrom`, `dateTo`     | string   | -                          | Publish window, `2026-09-01` or relative `7 days`. A one-day window is pushed to the portal; wider windows are applied client-side on the listing. Amendments keep the original publish date              |
| `openBefore`             | string   | -                          | Only advertisements whose open date is on or before this day                                                                                                                                              |
| `closesAfter`            | string   | -                          | Only advertisements whose close date is on or after this day (`0 days` = still open today)                                                                                                                |
| `eventTypes`             | string[] | all three                  | Which of `NEW_LISTING`, `UPDATED`, `STATUS_CHANGE` to deliver                                                                                                                                             |
| `onlyNew`                | boolean  | `false`                    | Delta mode - see below                                                                                                                                                                                    |
| `deltaStateName`         | string   | fingerprint of the filters | Name of the delta memory; share it between tasks on purpose, never by accident                                                                                                                            |
| `resetState`             | boolean  | `false`                    | Forget delivered advertisements and re-baseline                                                                                                                                                           |
| `maxItems`               | integer  | `100`                      | Cap on delivered records per run (and on cost). Max 50,000                                                                                                                                                |
| `fetchDetail`            | boolean  | `true`                     | One extra request per delivered record for description, commodity codes, documents, contact, response date, last-update timestamp, linked solicitation, indicator flags                                   |
| `maxConcurrency`         | integer  | `5`                        | Parallel listing-page / detail requests (1-10)                                                                                                                                                            |
| `dateRange`              | string   | -                          | Deprecated v1 preset (`24h`, `7d`, `30d`); still honoured as `dateFrom`                                                                                                                                   |

### Ready-to-run examples

**Daily monitor of every new, amended or closed state solicitation**

```json
{ "statuses": ["OPEN", "CLOSED"], "onlyNew": true, "maxItems": 500 }
```

**RFPs and ITNs only, monitored**

```json
{ "types": ["5", "6"], "onlyNew": true, "maxItems": 200 }
```

**Everything FDOT currently has open, still accepting responses**

```json
{ "agencyIds": ["30000021"], "closesAfter": "0 days", "maxItems": 200 }
```

**Intent-to-award and single-source notices (72-hour protest watch)**

```json
{ "types": ["1", "10"], "onlyNew": true, "eventTypes": ["NEW_LISTING", "UPDATED"], "maxItems": 200 }
```

**Software and IT services by UNSPSC code, listing only**

```json
{ "commodityCodes": ["43230000", "81111500", "81112200"], "fetchDetail": false, "maxItems": 500 }
```

**Historical backfill of the closed register (award research)**

```json
{ "statuses": ["CLOSED"], "dateFrom": "2026-01-01", "maxItems": 5000, "maxConcurrency": 10 }
```

## How monitoring works (delta mode)

1. The first run with `onlyNew: true` delivers up to `maxItems` of the most recently published advertisements that match your filters and remembers each one's `advertisementId`, `version` and `status` in a private, named key-value store (`florida-tenders-monitor-state-<deltaStateName>`). That first run is the **baseline**: if `maxItems` cut it short, anything published on or before the oldest advertisement it delivered is treated as history and is never delivered later - so a small `maxItems` on the first run keeps the baseline cheap without turning later runs into a slow drain of the archive. (Those older rows are still remembered, so a later addendum to one of them surfaces as `UPDATED`.)
2. Every later run re-reads the listing for your filters - MFMP has no timestamp sort, so every page is walked, in parallel; OPEN is 2 requests - and delivers only rows that are unknown (`NEW_LISTING`), whose `version` counter rose (`UPDATED`) or whose status flipped (`STATUS_CHANGE`). Detail is fetched only for those rows. A quiet day costs three requests and the start fee.
3. Memory is written **only for records that were actually stored** - and records are delivered oldest-first, changes to known advertisements last - so a spending limit, a timeout or a platform migration half-way never loses an advertisement: the next run simply picks it up. If a later run hits `maxItems` before delivering everything, the overflow stays unseen and is logged as a backlog; the next run re-discovers it on its own. The memory holds 50,000 advertisements - more than the whole register.
4. Different filter sets get different memories automatically; set `deltaStateName` to share one deliberately, `resetState: true` to start over.

Why `version` and not the publish date? Because MFMP keeps the original `publishDate` when an agency posts an addendum: grant opportunity `GO-14963` was published on 23 January 2026, edited seven times and had six addenda added through September, and its publish date never moved. Keyed on publish date it is invisible; keyed on `version` (which the listing row carries for free) it is an `UPDATED` event the same day.

## Scheduling and alerts: Slack, email, Make, Zapier, n8n, Google Sheets

- **Apify Schedule + webhook** - schedule the task, add a webhook on `ACTOR.RUN.SUCCEEDED` pointing at your endpoint; the payload links the dataset and every item already carries the envelope, so no parser is needed. Read the items newest-first with `?desc=true`. A failed run (portal blocked or changed) fires `ACTOR.RUN.FAILED` instead of delivering an empty dataset.
- **Slack** - the native [Apify Slack integration](https://apify.com/integrations/slack) posts each run's results to a channel.
- **Make** - _Apify > Watch Actor Runs_ -> _Get Dataset Items_ -> Slack / Gmail / Google Sheets ([apify.com/integrations/make](https://apify.com/integrations/make)).
- **Zapier** - _Apify: Finished Actor Run_ -> _Get Dataset Items_ -> anything ([apify.com/integrations/zapier](https://apify.com/integrations/zapier)).
- **n8n** - the Apify node, same pattern.
- **Google Sheets** - the [Apify Google Sheets integration](https://apify.com/integrations/google-sheets), or `=IMPORTDATA("https://api.apify.com/v2/datasets/<datasetId>/items?format=csv&desc=true&token=<token>")` (the token is then visible in the sheet - use a read-only token).

## Use it from code

**Node.js**

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/florida-tenders-monitor').call({
    types: ['5', '6'],
    onlyNew: true,
    maxItems: 200,
});
const { items } = await client.dataset(run.defaultDatasetId).listItems({ desc: true });
for (const ad of items) {
    console.log(ad.event_type, ad.uniqueName, ad.agency, ad.title, ad.closeDateLocal, ad.source_url);
}
```

**Python**

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/florida-tenders-monitor").call(
    run_input={"agencyIds": ["30000021"], "closesAfter": "0 days", "maxItems": 200}
)
for ad in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(ad["uniqueName"], ad["type"], ad["title"], ad["daysUntilClose"], ad["contactEmail"])
```

**cURL (synchronous, up to 300 s - fine for delta runs and small pulls)**

```bash
curl -X POST "https://api.apify.com/v2/acts/stefano_seggio~florida-tenders-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN&desc=true" \
  -H "Content-Type: application/json" \
  -d '{"onlyNew": true, "maxItems": 500}'
```

For large backfills start the run asynchronously (`/runs`) and read the dataset when the webhook fires.

**Apify CLI**

```bash
apify call stefano_seggio/florida-tenders-monitor --input '{"titleContains":"software","maxItems":100}' --output-dataset
```

**AI agents (MCP)** - add `https://mcp.apify.com/?tools=stefano_seggio/florida-tenders-monitor` as an MCP server and ask: _"List Florida state RFPs and ITNs published in the last 7 days that mention software, with their close dates and contact emails."_

## How much does it cost to scrape MyFloridaMarketPlace?

Pay per event, platform usage included - you pay only for records, never for compute:

| Event            | Price                        | When                                                                                         |
| ---------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| `result`         | **$0.003** per advertisement | A record with the full detail (description, commodity codes, documents, contact, 70+ fields) |
| `result-summary` | **$0.001** per advertisement | Listing-only record (`fetchDetail: false`, or a detail that could not be fetched)            |
| Actor start      | $0.00005                     | Once per run                                                                                 |

Worked examples: the whole OPEN register (165 advertisements) with detail costs about **$0.50**; a daily monitor that finds 8 new or amended advertisements costs **$0.024/day** - under **$1 a month**; a full 13,000-record CLOSED backfill with detail **$39** (listing-only **$13**, about 30 seconds). A quiet monitoring run with nothing new costs the start fee only. The Apify free plan's monthly credit covers well over a thousand detailed records.

Compare: DemandStar's Florida state plans run $100-1,499 per year and BidNet Direct's statewide plan about $299 per year - as human-oriented alerts, without a JSON feed or amendment detection.

## This Actor vs. the alternatives

|                      | This Actor                                                                                                   | MFMP portal (manual)                         | DemandStar / BidNet              | Generic government-bid scrapers |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | -------------------------------- | ------------------------------- |
| Coverage             | Every Florida state-agency advertisement on the VBS, all 10 types, OPEN + CLOSED + WITHDRAWN                 | Same, one screen at a time                   | Florida state + local, re-keyed  | Varies; usually no MFMP         |
| Export               | JSON, CSV, Excel, API, webhooks                                                                              | Screen only                                  | Email, PDF downloads             | JSON/CSV                        |
| Change detection     | `NEW_LISTING`, `UPDATED` (version-based), `STATUS_CHANGE`                                                    | Vendor email by commodity code, new ads only | New-bid alerts, no addendum feed | Usually new ids only            |
| Fields               | 70+ incl. UNSPSC codes, documents with addendum titles, contact, response date, linked award, ISO + ET dates | Listing columns + detail page                | Summary + document download      | Title, agency, dates            |
| Filters              | Status, type, agency, title, agency reference, UNSPSC, publish day, open-by, closes-after                    | Same form, by hand                           | Keyword, region                  | Keyword                         |
| Price                | $0.003 per detailed record, pay as you go                                                                    | Free                                         | $100-1,499 / year (state plans)  | $0.002-0.02 per record          |
| Time for 500 records | ~1 minute                                                                                                    | Hours                                        | n/a                              | Varies                          |

## Where the data comes from, legality and attribution

The Actor reads the public, logged-out MyFloridaMarketPlace Vendor Information Portal operated by the Florida Department of Management Services, using the same unauthenticated JSON endpoints the portal's own search page calls (`/mfmp/pub/search/bids`, `/count`, `/detail`). It bypasses no login, CAPTCHA or access control - the only requirement, an `Accept: application/json` header, is what the portal's front end sends - never touches vendor-only features (`intendsToParticipate`, `assignee`, notifications) and **links to attachments without downloading them**. There is no `robots.txt` on the host (verified 2026-09-07); requests are paced at a proven-tolerated concurrency (10 or fewer).

Solicitations and intended awards are **public records under Chapter 119, Florida Statutes**, that agencies are required to advertise on the Vendor Bid System (s. 287.042(3)(b) F.S., Rule 60A-1 F.A.C.). The portal footer carries "Copyright (c) 2020 State of Florida" and links to the **MFMP Terms of Use (PUR 3775, rev. 07/2022, incorporated by reference in Rule 60A-1.033 F.A.C.)**, which is the vendor-registration agreement accepted by clicking "I Accept" at registration. This Actor never registers or logs in, so it is not a party to that agreement; note however that section 5 of those terms licenses registered vendors to print and download portal content "solely for non-commercial use" with copyright notices kept, and that the terms contain no clause about automated access. What the Actor extracts are the factual elements of the public notices (identifiers, titles, agencies, dates, commodity codes, contacts, document links); assess your own use of the data accordingly. Response contacts are government employees' work details published so that vendors can respond - do not build personal profiles from them. Intent-to-award notices start statutory protest clocks (s. 120.57(3) F.S.); this Actor is a data feed, not legal notice - verify on the portal before acting. Every record carries a `data_source` attribution string. This Actor is not affiliated with or endorsed by the Florida Department of Management Services or the State of Florida.

## Honest limits

- MFMP has no timestamp sort, so every run re-reads every listing page for the chosen statuses. OPEN is 2 pages (seconds); CLOSED is 131 pages (about 30 seconds in parallel) - fine for a daily schedule, but add CLOSED only if you need award tracking.
- `UPDATED` tells you a known advertisement changed (its `version` rose), not which field changed; `previousVersion`, `lastUpdateDateUtc`, `documents[].date` and `latestDocumentDateUtc` usually make it obvious. `version` was verified on several amended records, not exhaustively; `lastUpdateDateUtc` is emitted as a second signal.
- An advertisement that leaves the walked statuses simply disappears (an OPEN-only monitor does not see it close). Include `CLOSED` in `statuses` to receive `STATUS_CHANGE`.
- The portal has no structured contract value; `amountsUsd` is mined from the description text (single-source and agency-decision notices usually carry a figure, solicitations rarely do).
- The portal's own publish-day filter matches one UTC calendar day; multi-day windows are applied on the listing rows after the walk (cheap - the walk happens anyway).
- Agency ids are discovered from the records themselves: the portal's agency list endpoint requires a vendor login.
- Portal changes can break extraction; the Actor validates every response and fails the run (never "0 results, success") so your schedule alerts you.

## FAQ

### Is there a MyFloridaMarketPlace API?

Not a public one. The portal is an Angular application talking to JSON endpoints that only answer requests with the right `Accept` header; this Actor is the programmable interface on top of them, with filters, normalisation and change detection.

### How do I get alerts for new Florida state bids and RFPs?

Run this Actor on a schedule with `onlyNew: true` and connect a webhook, Slack, Make or Zapier. Each run delivers only the advertisements that appeared, were amended or changed status since the previous run.

### Does it catch addenda, Q&A documents and close-date extensions?

Yes. MFMP raises the advertisement's `version` counter on every agency edit, and the delta memory is keyed on it, so an addendum is delivered as `UPDATED` with the new document in `documents[]` - even though the portal's publish date does not move.

### Can I filter by agency, solicitation type or commodity code?

Yes - status, type, agency (`organizationId`), title keyword, agency reference, exact UNSPSC codes, publish day, open-by and closes-after dates are all applied by MFMP itself; agency name is matched client-side.

### How do I track intent-to-award notices and bid protests?

Filter `types: ["1"]` (Agency Decision) with `onlyNew: true` on a frequent schedule. Each notice carries `isAwardNotice: true` and `linkedAdNumber` / `linkedAdUrl` pointing at the original solicitation. The 72-hour protest window under s. 120.57(3) F.S. runs from the agency's posting - verify on the portal.

### How far back does the data go?

The CLOSED register holds 13,000+ advertisements going back years; use `statuses: ["CLOSED"]` with `dateFrom` / `dateTo` (publish window) to slice it.

### How often is MyFloridaMarketPlace updated?

Agencies post throughout the business day (Eastern time); typically 5-15 new advertisements and a handful of amendments per day. Running every 6-24 hours is plenty; hourly if you watch award notices.

### Can I export MFMP bids to CSV or Excel?

Yes - every run's dataset can be downloaded as JSON, CSV, Excel or XML from the Output tab or the API.

### Do I need a proxy?

No. The portal is reachable from Apify's datacenter IPs with no login, no CAPTCHA and no rate limiting at the concurrency the Actor uses.

### What happens if the portal changes?

The Actor checks that every response is real JSON with the expected fields and fails the run instead of silently returning nothing, so your schedule alerts you. Report anything odd in the Issues tab.

### Is scraping MyFloridaMarketPlace legal?

The advertisements are public records that Florida agencies must publish; the Actor uses the portal's public endpoints without logging in and links rather than copies documents. Read _Where the data comes from_ above for what the portal's Terms of Use say and decide about your own use of the data.

## Resumen en español

Este Actor extrae y monitorea las **licitaciones del Estado de Florida** publicadas en MyFloridaMarketPlace (el Vendor Bid System oficial): ITB, RFP, ITN, RFI, avisos de fuente única y decisiones de adjudicación, con agencia, fechas, códigos UNSPSC, contacto y enlaces a los documentos. Con `onlyNew: true` cada ejecución programada devuelve solo las oportunidades de contratación pública nuevas, enmendadas o con cambio de estado desde la ejecución anterior. Precio: $0.003 por registro con detalle, $0.001 por registro de listado.

## Related Actors and roadmap

Same envelope, same delta engine, other registers by the same developer: [GrantConnect Grant Awards Scraper & Monitor](https://apify.com/stefano_seggio/australia-grantconnect-monitor) (Australian Government grants), [UK HSE Enforcement Monitor](https://apify.com/stefano_seggio/uk-hse-enforcement-monitor), and public-procurement monitors for Argentina and Chile.

Coming next for MFMP: **field-level change diffs** for `UPDATED` events (which document was added, how the close date moved), a **commodity-code prefix filter** applied client-side, and a **Florida local-government** companion. Ask for features in the Issues tab.

## Support

Report problems or request fields in the **Issues** tab of this Actor - typical response within one business day. Versioned changes are listed in the Changelog tab.
