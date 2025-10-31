# Quick Actions - Enable Auto-Updates

## 🚀 Enable Automated Data Updates (3 Steps)

### Step 1: Enable GitHub Actions (30 seconds)

1. Go to: https://github.com/Zaidroid/palestine-data-backend/actions
2. Click **"I understand my workflows, go ahead and enable them"**
3. Done! ✅

### Step 2: Allow Write Permissions (30 seconds)

1. Go to: https://github.com/Zaidroid/palestine-data-backend/settings/actions
2. Scroll to **"Workflow permissions"**
3. Select **"Read and write permissions"**
4. Click **"Save"**
5. Done! ✅

### Step 3: Test It (1 minute)

1. Go to: https://github.com/Zaidroid/palestine-data-backend/actions
2. Click **"Update Data"** workflow
3. Click **"Run workflow"** → **"Run workflow"**
4. Watch it run! ✅

## ✨ That's It!

Your data will now update automatically every day at midnight UTC!

## 📊 What Happens Next

- **Daily at 00:00 UTC**: Automatic data update
- **Fetches**: All 9 data sources
- **Processes**: Transforms and validates
- **Commits**: Pushes changes to repository
- **Reports**: Creates summary artifacts

## 🔍 Monitor Updates

**View runs**: https://github.com/Zaidroid/palestine-data-backend/actions

**Check commits**:
```bash
git log --author="github-actions[bot]"
```

## 🛠️ Manual Update Anytime

1. Go to Actions tab
2. Click "Update Data"
3. Click "Run workflow"
4. Done!

## 📖 Full Guide

See [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md) for detailed instructions.

---

**Total Time**: 2 minutes  
**Result**: Fully automated data updates! 🎉
