# 🛠️ Maintenance Guide

## Running Updates Manually
If you need to trigger an update immediately:

1.  **Run the master script**:
    ```bash
    ./scripts/update-all-data.sh
    ```
2.  **Check the logs**:
    Logs are printed to stdout and saved to `data-collection.log`.

## Adding a New Data Source
1.  **Create a Fetcher**:
    Create a new script in `scripts/fetch-new-source.js`. It should output raw JSON to `public/data/new-source/`.
2.  **Create a Transformer**:
    Add a transformer class in `scripts/utils/` to map the raw data to the unified schema.
3.  **Register**:
    - Add the fetcher to `scripts/update-all-data.sh`.
    - Add the transformer to `scripts/populate-unified-data.js`.
4.  **Validate**:
    Add any specific validation rules to `scripts/validate-data.js`.

## Troubleshooting

### "Validation Failed"
Run `npm run validate-data` locally to see the detailed error report. Common causes:
- **Schema Mismatch**: An external API changed its format.
- **Missing Data**: A source failed to download.

### "Script Permission Denied"
Ensure the scripts are executable:
```bash
chmod +x scripts/*.sh
```

### "Rate Limit Exceeded"
If fetching fails due to rate limits (e.g., GitHub or HDX), check the `RATE_LIMIT_DELAY` constant in the respective fetch script and increase it.
