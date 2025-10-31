# GitHub Actions Setup Guide

This guide will help you enable automated data updates using GitHub Actions.

## What Gets Automated

Once enabled, GitHub Actions will:
- ✅ Fetch data from all 9 sources daily at midnight UTC
- ✅ Transform data to unified format
- ✅ Validate data quality
- ✅ Generate manifests
- ✅ Commit and push changes automatically
- ✅ Create summary reports

## Step 1: Enable GitHub Actions

### On GitHub.com

1. **Go to your repository**: https://github.com/Zaidroid/palestine-data-backend

2. **Click on "Actions" tab** at the top

3. **Enable workflows** if prompted:
   - Click "I understand my workflows, go ahead and enable them"

4. **Verify workflows are enabled**:
   - You should see "Update Data" workflow listed
   - Status should show as enabled (green)

## Step 2: Configure Repository Settings

### Allow GitHub Actions to Write

1. Go to **Settings** → **Actions** → **General**

2. Scroll to **"Workflow permissions"**

3. Select **"Read and write permissions"**

4. Check **"Allow GitHub Actions to create and approve pull requests"**

5. Click **"Save"**

This allows the workflow to commit data updates back to your repository.

## Step 3: Test the Workflow

### Manual Trigger

1. Go to **Actions** tab

2. Click on **"Update Data"** workflow

3. Click **"Run workflow"** button (top right)

4. Select branch: **main**

5. Leave sources as: **all**

6. Click **"Run workflow"**

### Monitor Progress

- Watch the workflow run in real-time
- Check logs for any errors
- Review the summary when complete

## Step 4: Verify Automation

### Check First Run

After the first run completes:

1. **Check commits**: You should see a new commit like:
   ```
   chore: automated data update - 2025-10-31 00:00:00 UTC
   ```

2. **Check data files**: New/updated data in `data/` directory

3. **Check artifacts**: Download artifacts to see reports

### Schedule

The workflow runs automatically:
- **Daily**: Every day at midnight UTC (00:00)
- **Manual**: Anytime you trigger it manually

## Optional: Add API Keys

Some data sources work better with API keys (optional):

### HDX API Key (Optional)

1. Get an API key from: https://data.humdata.org/

2. Go to **Settings** → **Secrets and variables** → **Actions**

3. Click **"New repository secret"**

4. Name: `HDX_API_KEY`

5. Value: Your API key

6. Click **"Add secret"**

## Workflow Files

Your repository includes these workflows:

### Main Workflow
- **File**: `.github/workflows/update-data.yml`
- **Schedule**: Daily at midnight UTC
- **Purpose**: Complete data update pipeline

### Other Workflows
- `update-daily-data.yml` - Daily updates
- `update-weekly-data.yml` - Weekly updates  
- `update-monthly-data.yml` - Monthly updates
- `update-realtime-data.yml` - Real-time updates (every 6 hours)
- `update-btselem-data.yml` - B'Tselem specific updates

## Monitoring

### View Workflow Runs

1. Go to **Actions** tab
2. See all workflow runs with status
3. Click on any run to see details

### Check Logs

1. Click on a workflow run
2. Click on the job name
3. Expand steps to see detailed logs

### Download Artifacts

1. Scroll to bottom of workflow run
2. Download artifacts:
   - `data-update-{number}` - Contains summary and manifest

## Troubleshooting

### Workflow Not Running

**Check**:
- Actions are enabled in repository settings
- Workflow file exists in `.github/workflows/`
- Branch is `main` (workflows run on main branch)

**Fix**:
```bash
# Verify workflow file
ls -la .github/workflows/update-data.yml

# Check branch
git branch
```

### Permission Errors

**Error**: `refusing to allow a GitHub App to create or update workflow`

**Fix**:
1. Go to Settings → Actions → General
2. Enable "Read and write permissions"
3. Save and re-run workflow

### Data Not Committing

**Check**:
- Workflow has write permissions
- Data actually changed (no changes = no commit)
- Check workflow logs for errors

### API Rate Limits

**Issue**: Some sources may hit rate limits

**Fix**:
- Add API keys (see Optional section above)
- Reduce frequency of updates
- Use `continue-on-error: true` (already configured)

## Customization

### Change Schedule

Edit `.github/workflows/update-data.yml`:

```yaml
on:
  schedule:
    # Change this cron expression
    - cron: '0 0 * * *'  # Daily at midnight
    # Examples:
    # - cron: '0 */6 * * *'  # Every 6 hours
    # - cron: '0 0 * * 0'    # Weekly on Sunday
    # - cron: '0 0 1 * *'    # Monthly on 1st
```

### Update Specific Sources

When manually triggering:

1. Click "Run workflow"
2. In "sources" field, enter:
   - `all` - All sources (default)
   - `worldbank` - Only World Bank
   - `pcbs,worldbank` - Multiple sources (comma-separated)

### Disable Automation

To disable automatic updates:

1. Go to Actions tab
2. Click on "Update Data" workflow
3. Click "..." menu (top right)
4. Select "Disable workflow"

Or delete the workflow file:
```bash
git rm .github/workflows/update-data.yml
git commit -m "Disable automated updates"
git push
```

## Cost

### GitHub Actions Free Tier

- **Public repositories**: Unlimited minutes ✅
- **Private repositories**: 2,000 minutes/month (free tier)

### This Workflow Usage

- **Per run**: ~5-10 minutes
- **Daily runs**: ~300 minutes/month
- **Cost**: $0 for public repos, within free tier for private

## Best Practices

### 1. Monitor First Few Runs

Watch the first 3-5 automated runs to ensure:
- Data fetches successfully
- No errors occur
- Commits are created properly

### 2. Review Commits

Periodically check automated commits:
```bash
git log --author="github-actions[bot]" --oneline
```

### 3. Check Data Quality

Review validation reports in artifacts:
- Download artifacts after runs
- Check `data-collection-summary.json`
- Verify data quality scores

### 4. Handle Failures

If a workflow fails:
1. Check the logs
2. Fix the issue
3. Re-run the workflow manually
4. Monitor next scheduled run

## Summary

✅ **Enabled**: GitHub Actions workflows  
✅ **Scheduled**: Daily at midnight UTC  
✅ **Automated**: Complete data pipeline  
✅ **Monitored**: Logs and artifacts  
✅ **Cost**: Free for public repos  

Your data will now update automatically every day! 🎉

## Next Steps

1. ✅ Enable GitHub Actions (Step 1)
2. ✅ Configure permissions (Step 2)
3. ✅ Test with manual run (Step 3)
4. ✅ Verify first automated run (Step 4)
5. 📊 Monitor and enjoy automated updates!

---

**Need Help?**
- Check workflow logs in Actions tab
- Review this guide
- Check GitHub Actions documentation: https://docs.github.com/actions
