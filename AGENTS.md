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

## Known scope limits (disclosed, not hidden)

- `type` (the 10 solicitation types from `AdTypes`) and `agency` filters
  are not yet exposed as actor input - every run currently pulls the full
  set for whichever `status` values are selected. A future version could
  add these once each value is confirmed to actually filter (not
  live-verified in this build).
- `description` is returned as raw HTML from the source, not converted to
  plain text - matches this portfolio's convention of not silently
  reformatting source content.
