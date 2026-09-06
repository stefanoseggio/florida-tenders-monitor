# Florida Tenders Monitor

Extracts **public procurement solicitations** (bids, RFPs, ITBs,
single-source notices) from the State of Florida's MyFloridaMarketPlace
(MFMP) Vendor Information Portal - full description, commodity codes,
response contact info and direct document download links.

## 🔔 Delta mode - daily/hourly monitoring, not just a dump

Set `onlyNew: true` and this actor persists which `advertisementId`s it has
already returned (in its own private key-value store) and, on every
subsequent run, marks which records are genuinely new since the last run.

```json
{ "statuses": ["OPEN"], "onlyNew": true }
```

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")

# Daily monitoring run - only genuinely new solicitations come back
run = client.actor("stefano_seggio/florida-tenders-monitor").call(run_input={"onlyNew": True})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(f"[{item['event_type']}] {item['title']} - {item['source_url']}")
    # -> forward `item` as-is to your webhook/Slack/CRM; the record_id/
    #    event_type/scraped_at/source_url envelope needs no reshaping.
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });

// Daily monitoring run
const run = await client.actor('stefano_seggio/florida-tenders-monitor').call({ onlyNew: true });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
for (const item of items) {
    // item.record_id / item.event_type / item.scraped_at / item.source_url
    // are already webhook/Zapier/Make-ready - post `item` straight through.
}
```

**Webhook / Zapier / Make**: configure an
[Apify dataset webhook](https://docs.apify.com/platform/integrations/webhooks)
on `ACTOR.RUN.SUCCEEDED` for this actor and point it at your endpoint - the
standardized `record_id`/`event_type`/`scraped_at`/`is_new`/`source_url`
envelope on every item means no custom parser is needed on the receiving end.

**Important - `onlyNew` here is a post-filter, not early-stop pagination.**
Unlike some other actors in this fleet, MFMP's listing order is not
verified newest-first (live testing found items in neither `advertisementId`
nor `publishDate` order - see `AGENTS.md`), so a delta run still walks up to
`maxItems` listing items exactly like a normal run and only filters out
already-seen records afterward. It is correct, but it does not resolve
faster or cheaper than a normal run - raise `maxItems` if you suspect a run
is missing new records that are sitting deeper in the listing than the cap
reaches.

Prefer filtering by the source's own publish date instead of run history?
Use `dateRange` (`"24h"`, `"7d"`, or `"30d"`) - independent of `onlyNew`. It
filters on `publishDate` (when MFMP posted the ad), which is a genuine
publication timestamp here, not a lagging field the way some registers'
"offence"/"filed" dates can be - it typically precedes `openDate` (responses
aren't accepted until the ad has been up for a while), which is expected
procurement practice, not a data quality issue.

## What you get

Every record carries this standardized B2B integration envelope:

| Field        | Type    | Description                                        |
| ------------ | ------- | -------------------------------------------------- |
| `record_id`  | string  | `advertisementId` as a string - stable across runs |
| `event_type` | string  | Always `NEW_LISTING` (see Known limitations)       |
| `scraped_at` | string  | ISO-8601 timestamp of this extraction              |
| `is_new`     | boolean | `true` if not seen in a prior run (delta mode)     |
| `source_url` | string  | Direct link to the official MFMP detail page       |

Plus the full solicitation detail:

| Field                                    | Description                                       |
| ---------------------------------------- | ------------------------------------------------- |
| `advertisementId` / `uniqueName`         | Numeric ID and display ID, e.g. `AD-16672`        |
| `agencyAdNumber`                         | Agency's own advertisement number                 |
| `title`                                  | Solicitation title                                |
| `type`                                   | e.g. "Invitation to Bid", "Request for Proposals" |
| `status`                                 | `OPEN`, `CLOSED`, `WITHDRAWN`, or `PREVIEW`       |
| `agency`                                 | Issuing agency                                    |
| `openDate` / `closeDate` / `publishDate` | Key dates                                         |
| `description`                            | Full solicitation text (raw HTML from the source) |
| `commodityCodes`                         | Category codes: `{id, value}[]`                   |
| `documents`                              | Downloadable files: `{fileName, downloadUrl}[]`   |
| `responseContact`                        | Agency contact: name, email, phone, address       |

## Input

| Field         | Type    | Default    | Description                                                 |
| ------------- | ------- | ---------- | ----------------------------------------------------------- |
| `statuses`    | array   | `["OPEN"]` | `OPEN`, `CLOSED`, `WITHDRAWN`, `PREVIEW`                    |
| `fetchDetail` | boolean | `true`     | Fetch full detail per solicitation (one extra request each) |
| `maxItems`    | integer | `100`      | Hard cap on solicitations walked/returned this run          |
| `onlyNew`     | boolean | `false`    | Delta mode - see above                                      |
| `dateRange`   | string  | (none)     | `"24h"` \| `"7d"` \| `"30d"` - filter by `publishDate`      |

```json
{ "statuses": ["OPEN"], "fetchDetail": true, "maxItems": 100, "onlyNew": false }
```

## Usage

```bash
curl "https://api.apify.com/v2/acts/stefano_seggio~florida-tenders-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"statuses": ["OPEN"], "maxItems": 100}'
```

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/florida-tenders-monitor").call(run_input={"statuses": ["OPEN"], "maxItems": 100})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(item["uniqueName"], item["agency"], item["title"])
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/florida-tenders-monitor').call({ statuses: ['OPEN'], maxItems: 100 });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

## Known limitations

- No proxy needed - the source is reachable from a plain datacenter IP.
- Solicitation type and agency filters aren't exposed as input yet - every
  run pulls the full set for the selected statuses.
- `description` is raw HTML, not converted to plain text.
- `event_type` is always `NEW_LISTING` - every solicitation type (bid, RFP,
  single-source notice, etc.) gets the same value, since none of them carry
  a more specific, defensible event signal the way e.g. a completed
  prosecution record would. It does not diff field-level changes to a
  previously-seen record (e.g. a status flip from `OPEN` to `CLOSED`, or an
  amended `closeDate`) - that would need full snapshot storage and diffing
  rather than id-based delta tracking, and is out of scope for this pass.
- `onlyNew` is a safe post-filter, not early-stop pagination, because
  MFMP's listing order is not verified newest-first - see the Delta mode
  section above and `AGENTS.md` for the live evidence. A tightly-capped
  `maxItems` combined with `onlyNew: true` can therefore return fewer new
  records than actually exist, if some unseen ones sit past the walked
  window.

Full technical detail - including a real, non-obvious gotcha this
integration depends on (every endpoint needs an explicit `Accept:
application/json` header or it silently serves the wrong thing) and the
delta engine's design rationale - is in `AGENTS.md`.
