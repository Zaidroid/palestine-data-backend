# GitHub Actions Workflows

## Automated Data Updates

This repository uses GitHub Actions to automatically update data from multiple sources on different schedules based on update frequency requirements.

### Overview

We have **four automated workflows** that fetch data from different sources:

1. **Real-Time Data** (every 6 hours) - Tech4Palestine
2. **Daily Data** (daily at midnight UTC) - Good Shepherd, B'Tselem
3. **Weekly Data** (Sundays at midnight UTC) - HDX, WFP
4. **Monthly Data** (1st of month at midnight UTC) - World Bank, WHO, UNRWA, PCBS

### How It Works

1. **Schedule**: Each workflow runs on its designated schedule
2. **Fetch Data**: Runs appropriate fetch scripts for each source
3. **Validate**: Runs data quality validation checks
4. **Check Changes**: Compares new data with existing data
5. **Commit & Push**: If data changed, commits and pushes to repository
6. **Auto Deploy**: Netlify detects the push and deploys automatically

## Workflow Details

### 1. Real-Time Data (Every 6 Hours)

- **File**: `.github/workflows/update-realtime-data.yml`
- **Schedule**: 00:00, 06:00, 12:00, 18:00 UTC daily
- **Sources**: Tech4Palestine
- **Duration**: ~2-3 minutes per run
- **Monthly Usage**: ~240 minutes (120 runs × 2 min)

**What it fetches:**
- Gaza casualties (daily)
- West Bank casualties (daily)
- Killed in Gaza (individual records)
- Press casualties
- Summary statistics

### 2. Daily Data (Midnight UTC)

- **File**: `.github/workflows/update-daily-data.yml`
- **Schedule**: 00:00 UTC daily
- **Sources**: Good Shepherd, B'Tselem
- **Duration**: ~3-5 minutes per run
- **Monthly Usage**: ~120 minutes (30 runs × 4 min)
- **Features**: Retry logic (3 attempts with 30s delay)

**What it fetches:**
- Good Shepherd: Healthcare attacks, home demolitions
- B'Tselem: Checkpoint data

### 3. Weekly Data (Sundays)

- **File**: `.github/workflows/update-weekly-data.yml`
- **Schedule**: 00:00 UTC every Sunday
- **Sources**: HDX CKAN, WFP
- **Duration**: ~5-10 minutes per run
- **Monthly Usage**: ~40 minutes (4 runs × 10 min)

**What it fetches:**
- HDX: Humanitarian datasets (conflict, infrastructure, displacement)
- WFP: Food security data (when available)

### 4. Monthly Data (1st of Month)

- **File**: `.github/workflows/update-monthly-data.yml`
- **Schedule**: 00:00 UTC on 1st of each month
- **Sources**: World Bank, WHO, UNRWA, PCBS
- **Duration**: ~10-15 minutes per run
- **Monthly Usage**: ~15 minutes (1 run × 15 min)

**What it fetches:**
- World Bank: Economic indicators (120+ indicators)
- WHO: Health indicators
- UNRWA: Refugee and service data (when available)
- PCBS: Official statistics (when available)

### Total Monthly Usage

- Real-Time: ~240 minutes
- Daily: ~120 minutes
- Weekly: ~40 minutes
- Monthly: ~15 minutes
- **Total: ~415 minutes/month**
- **Cost: FREE** ✅ (well within 2,000 minute free tier)

### Manual Trigger

You can manually trigger any workflow:

1. Go to: https://github.com/YOUR_USERNAME/YOUR_REPO/actions
2. Click on the workflow you want to run:
   - "Update Real-Time Data Sources"
   - "Update Daily Data Sources"
   - "Update Weekly Data Sources"
   - "Update Monthly Data Sources"
3. Click "Run workflow" button
4. Select branch (usually `main`)
5. Click "Run workflow"

### Monitoring

**View workflow runs:**
- Go to: https://github.com/YOUR_USERNAME/YOUR_REPO/actions
- Click on any workflow to see all runs
- Click on a specific run to see detailed logs

**What to look for:**
- ✅ Green checkmark = Success
- ❌ Red X = Failed (check logs)
- 🟡 Yellow dot = Running

**Artifacts:**
Each workflow uploads artifacts that persist for 7-30 days:
- Validation reports
- Summary reports
- Execution logs

**Download artifacts:**
1. Click on a workflow run
2. Scroll to "Artifacts" section
3. Click to download ZIP file

### Setup Instructions

#### 1. Enable GitHub Actions (if not already enabled)

GitHub Actions should be enabled by default. If not:

1. Go to repository Settings
2. Click "Actions" → "General"
3. Under "Actions permissions", select "Allow all actions and reusable workflows"
4. Click "Save"

#### 2. (Optional) Add HDX API Key

If you want to fetch HDX data, add the API key:

1. Go to repository Settings
2. Click "Secrets and variables" → "Actions"
3. Click "New repository secret"
4. Name: `HDX_API_KEY`
5. Value: Your HDX API key
6. Click "Add secret"

**Note**: The workflow works without this - it will just skip HDX data if not provided.

#### 3. Test the Workflow

**Option A: Wait for scheduled run**
- Next run will happen at the next 6-hour interval

**Option B: Trigger manually**
1. Go to Actions tab
2. Click "Update Data"
3. Click "Run workflow"
4. Wait 2-5 minutes
5. Check if data was updated

#### 4. Verify It's Working

After the first run:

1. Check Actions tab for green checkmark
2. Check recent commits for "🤖 Auto-update data"
3. Check Netlify for automatic deployment
4. Visit your site to verify data is current

### Troubleshooting

#### Workflow Not Running

**Check:**
1. GitHub Actions enabled in repository settings
2. Workflow file is in `.github/workflows/` directory
3. File has `.yml` extension
4. No syntax errors in YAML file

**Fix:**
```bash
# Verify file exists
ls -la .github/workflows/update-data.yml

# Check for syntax errors
cat .github/workflows/update-data.yml
```

#### Workflow Fails

**Common issues:**

1. **npm ci fails**
   - Check `package-lock.json` is committed
   - Verify Node.js version (should be 18)

2. **Data collection fails**
   - Check script logs in Actions tab
   - Verify API endpoints are accessible
   - Check for rate limiting

3. **Git push fails**
   - Check repository permissions
   - Verify GITHUB_TOKEN has write access

**View logs:**
1. Go to Actions tab
2. Click on failed run
3. Click on failed step
4. Read error message

#### No Data Changes

If workflow runs but doesn't commit:

**This is normal if:**
- Data sources haven't updated
- No new data available
- Data is identical to previous run

**Check logs:**
- Look for "No data changes detected"
- This means workflow is working correctly

### Customization

#### Change Schedule

Edit the appropriate workflow file:

**Real-Time (update-realtime-data.yml):**
```yaml
# Every 3 hours instead of 6
- cron: '0 */3 * * *'

# Every 12 hours
- cron: '0 */12 * * *'
```

**Daily (update-daily-data.yml):**
```yaml
# Run at 6 AM UTC instead of midnight
- cron: '0 6 * * *'

# Run twice daily (midnight and noon)
- cron: '0 0,12 * * *'
```

**Weekly (update-weekly-data.yml):**
```yaml
# Run on Mondays instead of Sundays
- cron: '0 0 * * 1'

# Run on Wednesdays at 9 AM UTC
- cron: '0 9 * * 3'
```

**Monthly (update-monthly-data.yml):**
```yaml
# Run on 15th of month instead of 1st
- cron: '0 0 15 * *'

# Run on 1st and 15th of each month
- cron: '0 0 1,15 * *'
```

**Cron syntax:**
```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
* * * * *
```

**Tool**: Use https://crontab.guru/ to generate cron expressions

#### Add Notifications

Add Slack/Discord notifications on failure:

```yaml
# Add after the last step
- name: Notify on failure
  if: failure()
  run: |
    curl -X POST YOUR_WEBHOOK_URL \
      -H 'Content-Type: application/json' \
      -d '{"text":"Data update failed!"}'
```

#### Run on Specific Days

Only run on weekdays:

```yaml
on:
  schedule:
    - cron: '0 */6 * * 1-5'  # Monday to Friday
```

### Cost Analysis

**GitHub Actions Free Tier:**
- 2,000 minutes/month for public repositories
- Unlimited for public repositories (if you enable it)

**Our Workflows:**
- Real-Time: 120 runs/month × 2 min = 240 minutes
- Daily: 30 runs/month × 4 min = 120 minutes
- Weekly: 4 runs/month × 10 min = 40 minutes
- Monthly: 1 run/month × 15 min = 15 minutes
- **Total: ~415 minutes/month**
- **Cost: FREE** ✅ (only 21% of free tier)

**Comparison:**
- GitHub Actions: FREE (415 min/month)
- Netlify Build Plugin: Uses build minutes (limited)
- Manual updates: Your time (expensive)

### Benefits

✅ **Automated**: No manual intervention needed
✅ **Scheduled**: Different schedules for different sources
✅ **Free**: Well within GitHub Actions free tier
✅ **Reliable**: Separate from site deployment
✅ **Flexible**: Can trigger manually anytime
✅ **Transparent**: Full logs and artifacts available
✅ **Smart**: Only commits if data changed
✅ **Resilient**: Retry logic for daily sources
✅ **Efficient**: Optimized schedules based on update frequency

### Alternative: Netlify Build Plugin

If you prefer Netlify Build Plugin instead:

**Pros:**
- Runs on every deploy
- Always fresh data

**Cons:**
- Increases build time by 2-5 minutes
- Uses Netlify build minutes
- Build fails if data collection fails
- No scheduled updates (only on deploy)

**Setup:**
See `DEPLOYMENT_CHECKLIST.md` for Netlify plugin instructions.

### Support

**Issues?**
1. Check Actions tab for error logs
2. Review this README
3. Check `DEPLOYMENT_CHECKLIST.md`
4. Review `QUESTIONS_ANSWERED.md`

**Need help?**
- Open an issue in the repository
- Check GitHub Actions documentation
- Review workflow logs

## Workflow Schedule Summary

| Workflow | Schedule | Sources | Duration | Runs/Month |
|----------|----------|---------|----------|------------|
| Real-Time | Every 6 hours | Tech4Palestine | 2-3 min | 120 |
| Daily | Daily at 00:00 UTC | Good Shepherd, B'Tselem | 3-5 min | 30 |
| Weekly | Sundays at 00:00 UTC | HDX, WFP | 5-10 min | 4 |
| Monthly | 1st at 00:00 UTC | World Bank, WHO, UNRWA, PCBS | 10-15 min | 1 |

## Error Handling

All workflows include:
- **Continue on error**: Workflows don't fail if one source fails
- **Retry logic**: Daily sources retry 3 times with 30s delays
- **Success tracking**: Each source reports success/failure status
- **Artifact uploads**: Logs and reports saved for debugging
- **Smart commits**: Only commits if data actually changed

## Legacy Workflows

The following workflows are still present but may be superseded:

- `update-data.yml` - Original combined workflow (runs every 6 hours)
- `update-btselem-data.yml` - B'Tselem only (runs weekly)

You can disable these if the new workflows cover your needs.

---

**Last Updated**: 2025-10-29
**Status**: ✅ Active - 4 Automated Workflows
**Next Run**: Check Actions tab for each workflow
