'use strict';

// Node.js example - calls the Florida State Procurement Monitor Actor via apify-client.
// Install: npm install apify-client
// Run:     APIFY_TOKEN=your_token node run-actor.cjs

const { ApifyClient } = require('apify-client');

// Read your Apify API token from an environment variable - never hardcode it.
const client = new ApifyClient({
    token: process.env.APIFY_TOKEN,
});

const ACTOR_ID = 'afSZyXLVcgnLpucyo'; // stefano_seggio/florida-tenders-monitor

async function main() {
    const input = {
        statuses: ['OPEN'],
        types: ['5', '6'], // Invitation to Negotiate (ITN), Request for Proposals (RFP)
        agencyIds: ['30000021'], // Florida Department of Transportation (FDOT)
        closesAfter: '0 days', // only advertisements still open today
        onlyNew: true, // delta mode: only new / amended / status-changed records
        maxItems: 100,
        fetchDetail: true,
    };

    // Start the run and wait for it to finish.
    const run = await client.actor(ACTOR_ID).call(input);

    // Fetch the delivered records from the run's dataset.
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    for (const item of items) {
        console.log(`${item.event_type} | ${item.uniqueName} | ${item.title} (${item.status})`);
    }

    console.log(`\nTotal records: ${items.length}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
