# Changelog

## 2.0.0 - 2026-09-08

The "institutional-grade" release: same envelope and field names, far more data, every server-side filter the portal supports, and a delta engine that finally sees addenda and awards.

### Added

- **Server-side filters** mirroring the portal's own search form, all verified live with counts: `types` (the 10 advertisement types), `agencyIds` (organizationId), `titleContains`, `adNumber`, `agencyAdNumberContains`, `commodityCodes` (exact UNSPSC), `openBefore`, `closesAfter`, and a one-day `dateFrom`/`dateTo` window pushed to the portal's `publishedDate` parameter (wider windows are applied client-side on the listing).
- **`agencyNameContains`** (client-side) and **`eventTypes`** filters.
- **`UPDATED` and `STATUS_CHANGE` event types.** The delta memory now stores `advertisementId -> { version, status, lastUpdateDate }` instead of a bare id list, so an addendum, Q&A, close-date extension or new document (the portal bumps `version` on every agency edit) and an OPEN -> CLOSED / WITHDRAWN flip are delivered as events. Amendments keep their original `publishDate` on MFMP, so the v1 `dateRange`-on-`publishDate` filter could never see them.
- **New fields** (v1 names unchanged): `data_source`, `typeId`, `version`, `isAmended`, `previousVersion`, `previousStatus`, `organizationId`, `organizationShortName`, `organizationEntity`, `isAwardNotice`, `isSingleSource`, `publishDateUtc` / `openDateUtc` / `closeDateUtc`, `publishDateLocal` / `openDateLocal` / `closeDateLocal` (Florida wall-clock with EST/EDT), `publishDay`, `closeDay`, `responseWindowDays`, `daysUntilClose`, `isOpenForResponses`, `detailFetched`, `detailError`, `descriptionText` (plain text), `amountsUsd`, `maxAmountUsd`, `currency`, `lastUpdateDate(Utc)`, `responseDate(Utc/Local)`, `linkedAdNumber`, `linkedAdUrl` (award -> original solicitation), `publishOption`, `withdrawn`, `timeRemainingMs`, `indicators` + five flattened booleans, `commodityCodeIds`, `commodityCodesText`, `documentCount`, `latestDocumentDateUtc`, `contactName` / `contactEmail` / `contactPhone` / `contactAddress` / `contactCity` / `contactState` / `contactZip`. `documents[]` items gain `attachmentId`, `description` (addendum title), `date` / `dateUtc`, `version`, `docFor`.
- **Concurrency** (`maxConcurrency`, default 5, max 10) for listing pages and detail requests. The page count is known up front from the portal's `/count` endpoint, so a 131-page CLOSED walk takes about 30 s instead of 2+ minutes, and 164 OPEN details take ~20 s instead of ~100 s.
- **Run summary** in the key-value store (`OUTPUT`): delivered by event type, exact total matching on MFMP, pages walked, undelivered overflow, stop reason, excluded-by-reason, delta store name and floors, the exact search request sent.
- Five dataset views (Overview, Bid pipeline, Amendments & status changes, Awards & single source, Agency contacts) and CSV / Excel / newest-first output links.
- `deltaStateName` and `resetState` inputs; delta memory is now per filter set by default, so several schedules never interfere.
- Cheaper `result-summary` price for listing-only records (`fetchDetail: false`, or a detail that could not be fetched); `result` for detail-enriched records.
- `npm run test:live` (LIVE=1) with six live checks; CI runs lint + build + offline tests only.

### Fixed

- **Silent data loss in delta mode**: the seen-set used to be persisted _before_ records were pushed, so a spending limit, timeout or migration mid-run marked undelivered advertisements as seen forever. State is now written only for records actually stored, delivery is oldest-first so any gap sits where the next walk starts, and state is flushed every 50 records, on `migrating` / `aborting` and in a `finally`.
- A failed extraction used to push an `{ error }` row into the dataset and finish as SUCCEEDED. The run now fails properly (alerts and webhooks fire) and never writes non-record rows.
- The Angular `index.html` shell (HTTP 200, `text/html`) or a changed response schema is now detected on every request and fails the run loudly instead of being parsed as "0 results".
- MFMP's HTTP 400 `{ errorMessage }` (malformed filter), 401 and 404 are no longer retried four times; only network errors, timeouts, 408/425/429 and 5xx are, with jittered backoff. Every request has a 30 s timeout.
- `maxItems` now caps **delivered** records, not walked listing rows: every page is walked (the portal has no timestamp sort - rows come back by type name then id, so new postings land at the end of each type group), cheap filters are applied first, and the cap keeps the newest-published rows. v1 could stop after 50 Agency Decisions / Grant Opportunities and never reach the RFPs posted that morning.
- `onlyNew` and the publish window are decided from the listing row **before** any detail request; a quiet daily run makes 3 requests instead of 165.
- An unknown advertisement id (HTTP 200 with an all-null body) is reported as `detailError: "NOT_FOUND"` instead of being shipped as a record full of nulls; a failed detail degrades to a `result-summary` record with `detailFetched: false`.
- The 3,000-id state cap (below the 13,027 CLOSED records) is gone: the map holds 50,000 entries.
- Duplicate rows caused by the listing shifting between page fetches are de-duplicated within a run; a shrinking listing is logged instead of stopping the walk.
- Log messages are in English.

### Changed

- `dateRange` is deprecated (still honoured) in favour of `dateFrom` / `dateTo`.
- The delta memory moved to per-filter-set named stores (`florida-tenders-monitor-state-<name>`); the v1 store (`florida-tenders-monitor-delta-state`, a bare id list) is not inherited, so the first v2 run of an existing task re-baselines: with `onlyNew: true` it delivers up to `maxItems` of the most recently published advertisements and treats older ones as history.
- Records are appended oldest-first within a run; use `?desc=true` on the dataset API (the views already do) to read newest-first.
- Package licence is Apache-2.0; `cheerio` added for the plain-text description.
- README rewritten (use cases, sample record, pricing, comparison, FAQ) and the MFMP Terms of Use (PUR 3775, rev. 07/2022) read and disclosed: a vendor-registration agreement with a non-commercial download licence for registered vendors and no clause on automated access; the Actor never registers or logs in.

## 1.0.2 - 2026-09-06

- Delta engine (`onlyNew`, `dateRange` on `publishDate`) and the standardised `record_id` / `event_type` / `scraped_at` / `is_new` / `source_url` envelope.

## 1.0.0 - 2026-09-04

- Initial release: OPEN / CLOSED / WITHDRAWN / PREVIEW listing + detail extraction via the portal's public JSON endpoints (`Accept: application/json` gotcha), commodity codes, response contact, document download links.
