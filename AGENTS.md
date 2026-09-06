# AGENTS.md - Florida Tenders Monitor

Technical notes for whoever (human or AI) touches this actor next.

## What this actor does

Extracts public procurement solicitations (bids, RFPs, ITBs, single-source
notices) from the State of Florida's MyFloridaMarketPlace (MFMP) Vendor
Information Portal, with full detail, commodity codes, response contact
info and direct document download links.

## The one fact that matters most about this integration

**Every single endpoint on `vendor.myfloridamarketplace.com` - GET or
POST, JSON search API or binary file download - silently falls back to
serving the Angular app's `index.html` shell (a plain HTTP 200) unless the
request carries an explicit `Accept: application/json` header.** This is
not limited to the search API; it is also true of the document-download
endpoint, which has nothing to do with JSON. A plain `curl`/`fetch()` with
the default `Accept: */*` gets the SPA shell every time and looks like a
successful, empty response - there is no error to catch, just wrong data.
`src/http.ts` sends this header on every request unconditionally for this
reason. If a future change to this actor adds a new endpoint call, keep
using `apiGet`/`apiPost` rather than raw `fetch()`, or this bug will
reappear silently.

Verified live 2026-09-04 via real browser network-traffic capture (a
wrapped `XMLHttpRequest`, since a wrapped `window.fetch` on this
particular Angular app's own JSON calls gets intercepted by something in
the page bundle before reaching the real endpoint - use XHR wrapping,
not fetch wrapping, if a future audit needs to re-capture traffic on this
site).

## Endpoints (all verified live, no auth, no proxy needed)

- `POST /mfmp/pub/search/bids` - the listing search. Body:
  `{pageSize, type: [], status: [...], agency: [], adNumber: "", agencyAdvertisementNumber: "", title: "", publishedDate: "", openDate: "", endDate: "", commodityCodes: [], intendsToParticipate: "", assignee: "", page}`.
  `pageSize` accepts values well above the portal UI's own default of 25
    - tested 50 and 100 live, both returned exactly that many real items;
      this actor uses 100 to minimize request count. `page` is 1-indexed.
- `POST /mfmp/pub/search/bids/count` - same body shape, returns a bare
  integer count as plain text (not JSON).
- `GET /mfmp/pub/search/bids/detail?id={advertisementId}` - full detail:
  raw HTML `description`, `commodityCodes[]`, `docs[]` (each with
  `attachmentId` and `fileName`), `responseContact` (name/email/phone/
  address).
- `GET /mfmp/bids/detail/attachment/download?attachmentId={id}` - direct
  file download (verified live: a real 19KB `.docx` came back with a
  correct `Content-Disposition: attachment; filename=...` header). This
  actor only builds and returns this URL, it does not download the file
  itself.
- `GET /mfmp/bids/AdTypes` - the 10 valid `type` values (Agency Decision,
  Grant Opportunities, Informational Notice, Invitation to Bid, Invitation
  to Negotiate, Request for Proposals, Public Meeting Notice, Request for
  Information, Request for Statement of Qualifications, Single Source).
  Not currently exposed as an input filter (see Known scope limits).

## The `status` enum

Confirmed by inspecting the real Angular Material list options in the
live UI (not guessed): **`OPEN`, `CLOSED`, `WITHDRAWN`, `PREVIEW`** (all
uppercase - lowercase/mixed-case variants return 0 results, verified by
testing them directly against `/count` before finding the real values).
Live counts at audit time: OPEN=165, CLOSED=13026, WITHDRAWN=421,
PREVIEW=0 (a valid status that simply had no current entries that day -
don't assume it's invalid just because it returned zero).

## Architecture

- `src/http.ts` - shared fetch-with-retry helper. Always injects
  `Accept: application/json`. Also exports `attachmentDownloadUrl(id)`,
  a pure URL builder (not a fetcher - this actor never downloads the
  actual document bytes, only resolves the correct link).
- `src/parsers/record.ts` - `buildTenderRecord(item, detail, scrapedAt)`,
  a pure function merging one listing item with its (optional) detail
  response into the final output shape. Deliberately separated from the
  network layer so it's testable against real captured fixtures with zero
  HTTP calls.
- `src/fetchTenders.ts` - drives the search: loops POSTing
  `{...filters, page: N}` with `page` incrementing, optionally fetching
  detail per item (default on - one extra GET per item, richer output).
  Dedups by `advertisementId` as a defensive measure (same pattern as
  `cordoba-compras-monitor` and `salta-compras-monitor`) even though no
  actual page overlap was observed during live testing - live government
  data can shift between requests as new solicitations publish mid-run.
  Also drives the delta engine's `onlyNew`/`dateRange` post-filtering (see
  below).
- `src/state.ts` - the delta engine's persisted seen-id state.
- `src/dateFilter.ts` - the delta engine's `dateRange` window logic.

## Delta engine (2026-09-06 retrofit)

Added `onlyNew`/`dateRange` input + a standardized B2B output envelope
(`record_id`, `event_type`, `scraped_at`, `is_new`, `source_url`) across
this portfolio's fleet, matching the contract shipped and cloud-verified on
`uk-hse-enforcement-monitor`. Florida-specific implementation notes:

- **`onlyNew` is a safe POST-FILTER, not early-stop pagination - this is
  the one point where this actor deliberately deviates from the HSE
  shape, and it's backed by live evidence, not a guess.** Before writing
  any early-stop logic, two identical live `POST /mfmp/pub/search/bids`
  requests (page 1, `pageSize: 100`, `status: ["OPEN"]`) were captured
  one page apart on 2026-09-06:
    - The two identical requests returned byte-identical results (the
      listing IS stable/deterministic run-to-run for the same filters -
      good) but the item order within a 100-item page is **not** sorted by
      `advertisementId` ascending or descending, and **not** sorted by
      `publishDate` ascending or descending either (verified
      programmatically: none of those four orderings held across the full
      page). A 5-item sample from the same capture: ids `16672, 16833,
16851, 16854, 16858` came back with `publishDate`s `Aug 13, Sep 2
17:13, Sep 2 19:04, Sep 4 14:16, Sep 3 14:24` - not monotonic in
      either direction.
    - Page 1 and page 2 of the same request had **zero `advertisementId`
      overlap**, consistent with a large, non-overlapping default sort
      (something server-side, not exposed by this API) rather than a
      "newest N first" feed.
    - This is the same direction this actor's own pre-existing code was
      already pointing before the retrofit: the `seenInThisRun`
      dedup/stall-guard in `fetchTenders.ts` and its comment about "live
      government data can shift between requests" were written specifically
      because page overlap/reordering was considered plausible here, unlike
      a simple newest-first feed.
    - Given all of that, an early-stop ("stop after N consecutive pages
      with zero unseen ids") would be actively wrong: a genuinely new record
      could land anywhere in the page order, including past wherever the
      early-stop gave up, and would be silently missed - the exact failure
      mode a delta monitor must not have. So `fetchTenders()` walks pages
      exactly as it did before this retrofit (same `maxItems` cap, same
      stall guard, no `onlyNew`-driven termination), and only after the full
      walk are already-seen records dropped from the returned results. See
      the design-note comment atop `src/fetchTenders.ts` for the same
      reasoning inline with the code.
    - Disclosed consequence (in the README, not silently shipped): a
      tightly-capped `maxItems` combined with `onlyNew: true` can return
      fewer new records than actually exist, if unseen ones sit past the
      walked window. Raising `maxItems` is the mitigation, at the cost of
      more requests per run - there is no way to get both "guaranteed to
      find every new record" and "cheaper than a full run" without a
      verified stable sort, which this source does not have.
- `src/state.ts` opens a **named** key-value store
  (`florida-tenders-monitor-delta-state`) rather than the run's default
  one, for the same reason as every other actor in this fleet: the default
  KV store is isolated per run and would not survive between scheduled
  runs. Only one dataset exists here (no convictions/notices-style split),
  so the state shape is the plain `{ seenIds: string[], lastRunAt: string
| null }` from the spec, capped at 3000 ids. Because source order isn't
  verified newest-first, the cap eviction is "most-recently-observed
  first" (this run's ids kept, then backfilled from the previous state up
  to the cap) rather than tied to any source ordering - see the comment in
  `state.ts`.
- `record_id` = `String(item.advertisementId)` - the actual dedup key
  already used everywhere in this codebase (the `seenInThisRun` set, the
  detail/source URLs), not `uniqueName` (`"AD-16672"`), which is just a
  formatted display of the same id.
- `event_type` is always `'NEW_LISTING'` - there is no more specific,
  defensible per-record signal the way HSE's Convictions register has
  (`'SANCTION'`, because a conviction record IS an imposed sanction).
  Every MFMP solicitation type (Invitation to Bid, RFP, Single Source
  Award notice, etc.) is equally "a listing appearing in the register", so
  giving some types a different `event_type` than others would be
  arbitrary rather than domain-grounded. This does not detect field-level
  updates to a previously-seen record (e.g. `status` flipping from `OPEN`
  to `CLOSED`, or a `closeDate` extension) - disclosed as a known
  limitation, matching the HSE precedent.
- `dateRange` filters on `publishDate` via `src/dateFilter.ts`'s
  `parseIsoDate` - a plain `new Date()` parse is correct here since MFMP's
  dates are already real ISO-8601 strings with an explicit UTC offset
  (`"2026-08-13T17:39:51.000+00:00"`), unlike HSE's `DD/MM/YYYY` text
  fields which needed a custom parser. Checked for an HSE-style "lag"
  problem and did not find one: `publishDate` genuinely represents when
  MFMP posted the ad (it is the field this actor's own record-building
  code already treats as the publication timestamp), so a `dateRange`
  filter on it is not misleading the way filtering HSE's Offence Date
  would be. It does commonly sit hours-to-weeks _before_ `openDate`
  (responses aren't accepted the instant an ad posts) - that is normal
  procurement lead time, not a data-quality caveat, and is called out in
  the README so it isn't mistaken for one.
- **Not cloud-verified in this pass.** Deployment/cloud steps were
  explicitly out of scope for this retrofit (build/lint/test + a pushed
  commit only), so unlike HSE's 2026-09-06 cloud run-to-run check, the
  named-KV-store propagation behavior on Apify's platform was not
  re-verified live for this actor. Assume the same possible short
  eventual-consistency window HSE found (state written by run N not
  immediately visible to run N+1 if triggered within seconds) until this
  is checked against a real deployment.

## Known scope limits (disclosed, not hidden)

- `type` (the 10 solicitation types from `AdTypes`) and `agency` filters
  are not yet exposed as actor input - every run currently pulls the full
  set for whichever `status` values are selected. A future version could
  add these once each value is confirmed to actually filter (not
  live-verified in this build).
- `description` is returned as raw HTML from the source, not converted to
  plain text - matches this portfolio's convention of not silently
  reformatting source content.
