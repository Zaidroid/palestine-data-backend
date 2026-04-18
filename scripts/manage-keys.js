#!/usr/bin/env node
import { upsertCustomer, issueApiKey, _paths } from '../src/api/services/keyStore.js';

const [, , cmd, ...args] = process.argv;

function usage() {
    console.log(`Usage:
  node scripts/manage-keys.js issue <email> [tier]      Create customer if needed, issue an API key
  node scripts/manage-keys.js where                      Print the keys DB path

Tiers: free | journalist | ngo | enterprise (default: free)
`);
    process.exit(1);
}

if (cmd === 'issue') {
    const [email, tier = 'free'] = args;
    if (!email) usage();
    const customer = upsertCustomer({ email });
    const key = issueApiKey({ customerId: customer.id, tier });
    console.log(JSON.stringify({ email, tier, key: key.raw, keyId: key.id }, null, 2));
    console.log('\nStore this key now — it will not be shown again.');
} else if (cmd === 'where') {
    console.log(_paths.DB_PATH);
} else {
    usage();
}
