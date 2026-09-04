# Florida Tenders Monitor

Extracts **public procurement solicitations** (bids, RFPs, ITBs,
single-source notices) from the State of Florida's MyFloridaMarketPlace
(MFMP) Vendor Information Portal - full description, commodity codes,
response contact info and direct document download links.

## What you get

| Field | Description |
|---|---|
| `advertisementId` / `uniqueName` | Numeric ID and display ID, e.g. `AD-16672` |
| `agencyAdNumber` | Agency's own advertisement number |
| `title` | Solicitation title |
| `type` | e.g. "Invitation to Bid", "Request for Proposals" |
| `status` | `OPEN`, `CLOSED`, `WITHDRAWN`, or `PREVIEW` |
| `agency` | Issuing agency |
| `openDate` / `closeDate` / `publishDate` | Key dates |
| `description` | Full solicitation text (raw HTML from the source) |
| `commodityCodes` | Category codes: `{id, value}[]` |
| `documents` | Downloadable files: `{fileName, downloadUrl}[]` |
| `responseContact` | Agency contact: name, email, phone, address |
| `detailUrl` | Link to the official detail page |
| `scrapedAt` | ISO timestamp of extraction |

## Input

| Field | Type | Default | Description |
|---|---|---|---|
| `statuses` | array | `["OPEN"]` | `OPEN`, `CLOSED`, `WITHDRAWN`, `PREVIEW` |
| `fetchDetail` | boolean | `true` | Fetch full detail per solicitation (one extra request each) |
| `maxItems` | integer | `100` | Hard cap on solicitations returned this run |

```json
{ "statuses": ["OPEN"], "fetchDetail": true, "maxItems": 100 }
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

Full technical detail - including a real, non-obvious gotcha this
integration depends on (every endpoint needs an explicit `Accept:
application/json` header or it silently serves the wrong thing) - is in
`AGENTS.md`.
