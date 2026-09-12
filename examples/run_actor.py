"""
Python example - calls the Florida State Procurement Monitor Actor via apify-client.
Install: pip install apify-client
Run:     APIFY_TOKEN=your_token python run_actor.py
"""

import os

from apify_client import ApifyClient

# Read your Apify API token from an environment variable - never hardcode it.
client = ApifyClient(os.environ["APIFY_TOKEN"])

ACTOR_ID = "afSZyXLVcgnLpucyo"  # stefano_seggio/florida-tenders-monitor


def main() -> None:
    run_input = {
        "statuses": ["OPEN"],
        "types": ["5", "6"],  # Invitation to Negotiate (ITN), Request for Proposals (RFP)
        "agencyIds": ["30000021"],  # Florida Department of Transportation (FDOT)
        "closesAfter": "0 days",  # only advertisements still open today
        "onlyNew": True,  # delta mode: only new / amended / status-changed records
        "maxItems": 100,
        "fetchDetail": True,
    }

    # Start the run and wait for it to finish.
    run = client.actor(ACTOR_ID).call(run_input=run_input)

    # Fetch the delivered records from the run's dataset.
    dataset_items = client.dataset(run["defaultDatasetId"]).list_items().items

    for item in dataset_items:
        print(f"{item['event_type']} | {item['uniqueName']} | {item['title']} ({item['status']})")

    print(f"\nTotal records: {len(dataset_items)}")


if __name__ == "__main__":
    main()
