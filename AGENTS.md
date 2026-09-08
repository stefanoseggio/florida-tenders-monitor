# AGENTS.md - MyFloridaMarketPlace Bids Scraper & Monitor

Technical notes for whoever (human or AI) touches this actor next. Everything
below was verified live against `vendor.myfloridamarketplace.com` on
2026-09-07 (UTC) unless stated otherwise.

## What this actor does

Extracts every advertisement on the State of Florida's **MyFloridaMarketPlace
Vendor Information Portal** (the statutory Vendor Bid System for state-agency
solicitations: ITB, RFP, ITN, RFI, RSQ, Single Source, Agency Decision /
intent-to-award, Grant Opportunities, Public Meeting and Informational
notices) - listing + detail JSON per advertisement - with the portal's own
search filters applied server-side, and a delta engine keyed on the
advertisement's **`version` counter + `status`** so addenda and awards are
caught, not just first postings.

## Site facts that shape the design

### The `Accept: application/json` gate (the single most important fact)

Every endpoint on this host - GET or POST, JSON API or binary download -
serves the Angular app's `index.html` shell with **HTTP 200 / text/html**
unless the request carries an explicit `Accept: application/json` header. A
plain `fetch()` (default `Accept: */*`) gets the shell every time and looks
like success. `src/http.ts` sends the header unconditionally, checks the
response `content-type` for `application/json`, and throws `NotJsonError`
(never retried, never "0 results") when the shell comes back. The block
shape to recognise: 200, no/`text/html` content-type, body starting
`<!DOCTYPE html>` (fixture `test/fixtures/index_shell.html`). No WAF
challenge, no cookies, no auth, no proxy needed; a browser User-Agent is
sent for good measure.

### Endpoints (all public, unauthenticated)

| Endpoint                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /mfmp/pub/search/bids`                               | The listing. Body must carry EVERY key: `{pageSize, type[], status[], agency[], adNumber, agencyAdvertisementNumber, title, publishedDate, openDate, endDate, commodityCodes[], intendsToParticipate, assignee, page}`. Returns a JSON array of 14-key rows (`advertisementId, uniqueName, agencyAdNumber, title, type, typeId, status, version, openDate, closeDate, publishDate, organization{organizationId, entity, shortName, name, vbsAgency}, agency, favorite`).                       |
| `POST /mfmp/pub/search/bids/count`                         | Same body; returns a bare integer (JSON content-type). Exact total for the filter set - used to size the parallel page walk and reported as `totalMatchingOnMfmp`.                                                                                                                                                                                                                                                                                                                             |
| `GET /mfmp/pub/search/bids/detail?id=N`                    | 36 keys: adds `lastUpdateDate`, `responseDate`, `linkedAdNumber`, `publishOption`, `description` (HTML), `commodityCodes[]`, `indicators{}`, `docs[]` (`attachmentId, fileName, description, date, version, docFor`), `responseContact{}`, `timeRemaining` (ms to closeDate, negative when closed), `withdrawn`, `organization{}`. **An unknown id answers HTTP 200 with every field null** (`advertisementId: null`) - `api.ts:fetchDetail` returns null for that; a non-numeric id is a 400. |
| `GET /mfmp/bids/detail/attachment/download?attachmentId=N` | Binary attachment (needs the Accept header too). The actor only builds this URL; it never downloads bytes.                                                                                                                                                                                                                                                                                                                                                                                     |
| `GET /mfmp/bids/AdTypes`                                   | The 10 types, ids `"1"`..`"10"` (hard-coded in `src/api.ts` as `AD_TYPES`).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET /mfmp/bids/Agencies` and other `/mfmp/bids/*` lists   | 401 empty body - vendor-login only. Agencies are discovered from `organization.organizationId` in listing rows.                                                                                                                                                                                                                                                                                                                                                                                |

Error shapes: a malformed body or a wrongly typed filter value (label
instead of id, number instead of string) -> HTTP 400 JSON
`{"errorMessage":"We could not complete this action. Please contact the MFMP Help Desk at 866-FLA-EPRO ...","errorId":null}`
(fixture `error_400.json`) - surfaced as `MfmpApiError`, never retried.
Unknown-but-well-typed values (`type: ["99"]`, `status: []`, lowercase
status) return **0 results silently**, so `src/input.ts` validates against
the known enums.

### Server-side filters (verified with counts, OPEN register = 164 rows)

| body key                    | verified example         | behaviour                                                                                              |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `status`                    | `["OPEN"]`               | UPPERCASE enum, non-empty. OPEN 164, CLOSED 13,027, WITHDRAWN 421, PREVIEW 0, OPEN+CLOSED 13,191.      |
| `type`                      | `["6"]`, `["4","6"]`     | AdTypes ids as STRINGS. RFP 24, ITB 54, ITB+RFP 78. Label or numeric -> 400.                           |
| `agency`                    | `["30000021"]`           | `organization.organizationId` as STRINGS (FDOT -> 20). Numeric or short name -> 400; entity code -> 0. |
| `title`                     | `"software"`             | case-insensitive substring (3).                                                                        |
| `adNumber`                  | `"16672"` / `"AD-16672"` | exact id, prefix optional (1).                                                                         |
| `agencyAdvertisementNumber` | `"DOT"`                  | substring on agencyAdNumber (19).                                                                      |
| `publishedDate`             | `"2026-09-02"`           | exact UTC calendar day of publishDate (9); full ISO also works; `MM/DD/YYYY` -> 0. One day only.       |
| `openDate`                  | `"2026-01-01"`           | openDate <= day (7).                                                                                   |
| `endDate`                   | `"2026-12-01"`           | closeDate >= day (18; min closeDate returned = that day).                                              |
| `commodityCodes`            | `["83112200"]`           | exact 8-digit UNSPSC (3); two codes = union (5); prefix `"83"` -> 0.                                   |
| `pageSize`                  | `100`                    | silently capped at 100 (500 -> 100 rows).                                                              |
| `page`                      | `1`                      | 1-indexed; page 0 == page 1; past the end -> `[]` (2 bytes) - the only end marker.                     |

`intendsToParticipate` / `assignee` are vendor-login features; send `""`.

### Ordering: no sort parameter exists

The API and the JS bundle have no `sortBy`/`orderBy`. The listing is
deterministic and ordered by **type name alphabetically, then
`advertisementId` ascending** (checked programmatically on OPEN 164 rows
and 7 CLOSED pages incl. the last). Consequences:

- new postings land at the END of each type group and amendments anywhere,
  so there is **no page-level early-stop**; every run walks every page.
  OPEN is 2 pages; CLOSED is 131 pages (7 pages in 1.7 s with 7 in
  parallel), fetched with `mapWithConcurrency` because `/count` gives the
  page count up front.
- the delta engine's ordering key is the row's own **`publishDate`**
  (candidates are sorted newest-published first in memory); changes to
  known ads (UPDATED / STATUS_CHANGE) are ranked ahead of new rows.

### Amendments keep their `publishDate` -> `version` is the change key

`GO-14963` v7: `publishedDate` 2026-01-23, `lastUpdateDate` 2026-09-03,
six addenda posted Feb-Sep. `GO-16688` v3: published 08-14, updated 09-02.
A publishDate-keyed delta never sees addenda. The listing row carries
`version` (1..9 seen on OPEN, 0 and 14 on CLOSED), so UPDATED detection
costs zero extra requests; detail `lastUpdateDate` is stored alongside as
the human-readable "updated" timestamp. `version` was checked on 3 records,
not exhaustively - `lastUpdateDate` is emitted as the secondary signal.

### Timestamps

ISO-8601 with `+00:00`, genuinely UTC (an `openDate` of 20:30Z is "4:30
PM" in the ad body = EDT). `publishedDate` filtering matches the **UTC**
calendar day. `src/normalize.ts` emits canonical `Z` twins and
`America/New_York` wall-clock strings (`2026-09-09 16:30 EDT`).

### Detail quirks

- `withdrawn` is `false` even on a WITHDRAWN record (id 266) - `status` is
  authoritative; the flag is emitted as-is.
- `timeRemaining` = ms until `closeDate` at fetch time (negative once
  closed).
- `description` is HTML (`<p>`, `&nbsp;`, `<strong>`); `descriptionText` is
  a cheerio rendering. There is no structured value field; `amountsUsd`
  lists every `$` figure in the text (single-source notices carry them).
- `responseDate` can differ from `closeDate` by months (14963: response
  2026-03-19, close 2026-10-15).
- `linkedAdNumber` on an Agency Decision is the advertisementId of the
  original solicitation (16672 -> 16671).

### Rate tolerance

10 concurrent detail GETs: 10 x 200 in 626 ms total. 8 concurrent CLOSED
pages of 100: 1.7 s total. `maxConcurrency` is capped at 10, default 5.

### robots.txt, terms, licence

- `/robots.txt` -> Express `Cannot GET /robots.txt` (404): none.
- Footer: "Copyright (c) 2020 State of Florida", links to `/privacy` (SPA,
  JS-rendered) and to the VIP Terms of Use page on dms.myflorida.com
  (https://www.dms.myflorida.com/business_operations/state_purchasing/myfloridamarketplace/mfmp_vendors/vendor_information_portal_vip_terms_of_use).
  That page is a Next.js shell for plain fetchers, but its `__NEXT_DATA__`
  JSON carries the content: the current terms are **"Revised Terms of Use -
  V5" = PUR 3775, MFMP Terms of Use (07/2022), incorporated by reference in
  Rule 60A-1.033 F.A.C.**, PDF at
  https://dms-media.ccplatform.net/content/download/156614/file/MFMP%20Terms%20of%20Use_7.2022.pdf
  (read in full on 2026-09-08, 4 pages, 17 sections). Findings:
    - It is the **vendor-registration agreement**: "When presented with the
      Terms of Use at Vendor registration, you, the Vendor, will be given an
      opportunity to click 'I Accept'". The actor never registers or logs
      in, so it is not a party; it is disclosed anyway.
    - s.5 OWNERSHIP: the State owns the contents of MFMP; registered vendors
      get "a non-exclusive, non-transferable license to print and download
      content on MFMP solely for your non-commercial use, provided that you
      maintain the copyright notice". README quotes this and tells users
      to assess their own use; the actor extracts the factual elements of
      statutory public notices (ids, titles, agencies, dates, codes,
      contacts, document links) and links rather than copies attachments.
    - s.6 PUBLIC RECORDS binds vendors to ch. 119 access; nothing in the
      17 sections mentions automated access, robots, crawling or rate
      limits.
    - s.3 transaction fee (1%, Rule 60A-1.031) and s.10 indemnity apply to
      registered vendors' transactions - irrelevant to read-only access.
      The actor uses only the unauthenticated JSON endpoints the portal's own
      search page calls, never logs in, never touches vendor features
      (`intendsToParticipate`, `assignee`, notifications), and links (never
      downloads) attachments.
- Solicitation postings are public records (Florida Statutes ch. 119),
  advertised on the VBS pursuant to s. 287.042(3)(b) F.S. / Rule 60A-1
  F.A.C.

## Architecture

- `src/input.ts` - validates and resolves the input into `SearchFilters`
  (the exact POST body) + `RunOptions`; computes the filter fingerprint
  that names the delta store; relative dates; legacy `dateRange`.
- `src/api.ts` - `buildSearchPayload`, `AD_TYPES`, `fetchListingPage`
  (validated: JSON array of rows with identity fields), `fetchListingCount`,
  `fetchDetail` (all-null -> null).
- `src/http.ts` - `requestJson` with timeout, Accept header, content-type
  check, retry policy (network/timeout/408/425/429/5xx only), `MfmpApiError`
  for 400 bodies, `getJsonOptional` (404/410 -> null), `mapWithConcurrency`,
  URL builders.
- `src/fetchTenders.ts` - `walkListing()` (count-driven parallel page walk +
  dedupe + `classify()` + client-side filters + priority sort + maxItems
  cap, no detail fetches), `enrichBatch()` (detail with bounded
  concurrency), `fetchTenders()` one-shot for live tests.
- `src/parsers/record.ts` - `buildRecord()`: all normalisation, pure.
- `src/state.ts` - named-store delta state v2
  (`{ seen: {id: {version, status, updatedAt}}, baselineFloor, backlogFloor,
lastRunAt, filtersSignature }`), 50k prune (lowest ids first).
- `src/normalize.ts` - pure helpers (UTC/ET conversion, day maths,
  HTML->text, `$` amounts, ad-number normalisation, hash).
- `src/main.ts` - orchestration: walk -> deliver in batches oldest-first ->
  persist -> summary. Never pushes anything but records; fails the run on
  error (`Actor.fail`), so alerts fire.

## Delta engine invariants (do not break these)

1. **State is written only for delivered records** (`markSeen` after a
   successful `pushData`), plus, at the END of a successful run, for rows
   that were walked but intentionally excluded (unchanged / baseline /
   filtered). `saveState` runs every 50 delivered records, in a `finally`,
   and on the platform `migrating` / `aborting` events.
2. **Delivery is oldest-first** within a run (the reverse of the priority
   order), so a crash leaves the highest-priority candidates undelivered -
   exactly the rows the next walk ranks first. The dataset is an
   append-only log; views and README say `desc=true`.
3. **No early-stop.** Every page is walked every run (see Ordering).
   `classify()` decides NEW_LISTING / UPDATED / STATUS_CHANGE from the
   listing row alone; detail is fetched only for candidates that will be
   delivered.
4. A COLD delta run (empty store, no `lastRunAt`) cut short by `maxItems`
   defines the **baseline**: `state.baselineFloor` = `publishDateUtc` of the
   oldest NEW row in the delivered block. On later runs an unseen row
   published `<=` the floor is excluded as `'baseline'` (history), is not a
   change, and is marked seen at the end so a later `version` bump still
   surfaces as UPDATED. Only `resetState` clears it.
5. A NON-cold run cut short by `maxItems` never marks the overflow as seen;
   it logs a warning and records a **backlog floor** (`state.backlogFloor`
   = `publishDateUtc` of the oldest new row it delivered). Because every
   run re-walks every page, the undelivered rows are re-discovered on their
   own; the floor is informational (log line, `OUTPUT.backlogFloor`) and is
   cleared by the next complete delivery. Both floors have offline tests in
   `test/walkListing.test.ts`.
6. The delta store name defaults to `auto-<hash of filters>` (date windows,
   maxItems, fetchDetail and concurrency excluded from the hash), so
   distinct schedules never share memory unless `deltaStateName` says so.
   The v1 store is never inherited.
7. Charging: records with detail are pushed with event `result`, the rest
   with `result-summary`; `chargedCount` from the SDK is the number actually
   stored in PPE mode (outside PPE everything is stored, nothing charged).

## Tests

- `npm test` - offline, ~1.5 s, 58 tests: real captured fixtures
  (`listing_open_page1/2.json` = the full OPEN register of 2026-09-07,
  `detail_14963_amended.json`, `detail_unknown_id.json`, `error_400.json`,
  `index_shell.html`) + mocked HTTP; includes an end-to-end run of
  `src/main.ts` with the SDK mocked that asserts the persist-after-delivery
  invariant under a spending limit, and the two floors.
- `npm run test:live` (`LIVE=1`) - six live checks (~30 s): detail
  extraction, type+agency filters vs count, concurrent CLOSED walk without
  duplicates, one-day publish window, all-null detail, zero-result query.
- Local end-to-end: put an input in
  `storage/key_value_stores/default/INPUT.json` and `apify run --purge`; the
  delta store appears under
  `storage/key_value_stores/florida-tenders-monitor-state-<name>/`.

## Known scope limits (disclosed in the README)

- A record that leaves the walked statuses (OPEN-only monitor, ad closes)
  simply disappears - no event. Include CLOSED in `statuses` to get
  STATUS_CHANGE.
- `UPDATED` says the record changed (version rose), not which field; the
  `previousVersion`, `lastUpdateDateUtc`, `documents[].date` and
  `latestDocumentDateUtc` fields usually make it obvious.
- No structured contract value on the portal; `amountsUsd` is text mining.
- The MFMP Terms of Use (PUR 3775) are a vendor-registration agreement
  whose s.5 licenses registered vendors to download content for
  non-commercial use; the README quotes it and leaves the use decision to
  the customer (see "robots.txt, terms, licence" above).
