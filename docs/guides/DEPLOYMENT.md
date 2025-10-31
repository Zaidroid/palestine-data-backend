# Deployment Guide

## Overview

Palestine Pulse V3 is a static site that can be deployed to any static hosting service. This guide covers deployment to Netlify (recommended) and other platforms.

## Prerequisites

- Git repository (GitHub, GitLab, etc.)
- Node.js 18+ installed locally
- Data fetched and validated (`npm run update-data`)

## Netlify Deployment (Recommended)

### Initial Setup

1. **Push to Git**
```bash
git add .
git commit -m "Prepare for deployment"
git push origin main
```

2. **Connect to Netlify**
- Go to [netlify.com](https://netlify.com)
- Click "Add new site" > "Import an existing project"
- Connect your Git provider
- Select your repository

3. **Configure Build Settings**
```
Build command: npm run build
Publish directory: dist
Node version: 18
```

4. **Deploy**
- Click "Deploy site"
- Wait for build to complete
- Site will be live at `https://[random-name].netlify.app`

### Custom Domain

1. **Add Domain**
- Go to Site settings > Domain management
- Click "Add custom domain"
- Enter your domain name

2. **Configure DNS**
- Add CNAME record pointing to Netlify
- Or use Netlify DNS

3. **Enable HTTPS**
- Automatic with Let's Encrypt
- Enabled by default

### Environment Variables

If needed, add in Netlify dashboard:
- Site settings > Environment variables
- Add key-value pairs

### Continuous Deployment

Netlify automatically deploys on:
- Push to main branch
- Pull request (preview deploy)

## Manual Deployment

### Build Locally

```bash
# 1. Update data
npm run update-data

# 2. Build
npm run build

# 3. Test build
npm run preview

# 4. Deploy dist/ folder
# Upload to your hosting service
```

### Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Production deploy
vercel --prod
```

### Deploy to GitHub Pages

1. **Install gh-pages**
```bash
npm install --save-dev gh-pages
```

2. **Add to package.json**
```json
{
  "scripts": {
    "predeploy": "npm run build",
    "deploy": "gh-pages -d dist"
  },
  "homepage": "https://[username].github.io/[repo]"
}
```

3. **Deploy**
```bash
npm run deploy
```

4. **Configure GitHub**
- Go to repository settings
- Pages > Source: gh-pages branch

## Configuration

### Vite Config

```typescript
// vite.config.ts
export default defineConfig({
  base: '/', // Change for subdirectory deployment
  build: {
    outDir: 'dist',
    sourcemap: false, // Disable for production
  },
});
```

### Netlify Config

```toml
# netlify.toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[build.environment]
  NODE_VERSION = "18"
```

## Pre-Deployment Checklist

### Code Quality
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

### Data
- [ ] Data is up-to-date (`npm run update-data`)
- [ ] Data validates (`npm run validate-data`)
- [ ] Manifest is generated
- [ ] All data files present in `public/data/`
- [ ] Unified data is transformed and partitioned
- [ ] Data quality scores meet thresholds (≥0.8)
- [ ] Cross-dataset relationships are generated

### Testing
- [ ] All dashboards work
- [ ] All charts display correctly
- [ ] Data loads correctly
- [ ] Responsive on mobile
- [ ] Works in dark mode
- [ ] No broken links

### Performance
- [ ] Build size is reasonable
- [ ] Page load time is fast
- [ ] Images are optimized
- [ ] No unnecessary dependencies

### SEO & Meta
- [ ] Page titles are set
- [ ] Meta descriptions are set
- [ ] Open Graph tags are set
- [ ] Favicon is present

## Post-Deployment

### Verify Deployment

1. **Check Site Loads**
- Visit deployed URL
- Check all pages load

2. **Test Dashboards**
- Gaza dashboard works
- West Bank dashboard works
- All tabs work

3. **Test Data**
- Data displays correctly
- Charts render correctly
- No console errors

4. **Test Responsiveness**
- Check on mobile
- Check on tablet
- Check on desktop

5. **Test Performance**
- Use Lighthouse
- Check load times
- Check bundle size

### Monitor

**Netlify Analytics:**
- Page views
- Unique visitors
- Top pages
- Bandwidth usage

**Error Tracking:**
- Check browser console
- Check Netlify logs
- Monitor user reports

## Updating Data

### Automated Updates with Unified Data System

The unified data system includes automated GitHub Actions workflows for different update frequencies:

**Real-time Updates (Every 6 hours):**
- Tech4Palestine data
- See `.github/workflows/update-realtime-data.yml`

**Daily Updates (Midnight UTC):**
- Good Shepherd data
- B'Tselem data
- See `.github/workflows/update-daily-data.yml`

**Weekly Updates (Sunday Midnight):**
- HDX data
- WFP data
- See `.github/workflows/update-weekly-data.yml`

**Monthly Updates (1st of Month):**
- World Bank data
- WHO data
- UNRWA data
- PCBS data
- See `.github/workflows/update-monthly-data.yml`

**Custom GitHub Actions:**
```yaml
# .github/workflows/update-data.yml
name: Update Data

on:
  schedule:
    - cron: '0 0 * * 0' # Weekly on Sunday
  workflow_dispatch: # Manual trigger

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm install
      - run: npm run fetch-all-data
      - uses: stefanzweifel/git-auto-commit-action@v4
        with:
          commit_message: "chore: update data"
```

**Netlify Build Hooks:**
1. Go to Site settings > Build & deploy > Build hooks
2. Create build hook
3. Use webhook URL to trigger builds

### Manual Updates

```bash
# 1. Update all data sources
npm run fetch-all-data

# 2. Validate data quality
npm run validate-data

# 3. Check unified data structure
ls public/data/unified/

# 4. Commit and push
git add public/data/
git commit -m "chore: update data"
git push

# 5. Netlify auto-deploys
```

### Unified Data System Updates

The unified data system automatically:
- Transforms raw data to unified format
- Enriches with geospatial and temporal context
- Validates data quality
- Partitions large datasets
- Creates cross-dataset relationships
- Generates metadata and validation reports

**Check data quality:**
```bash
# View validation reports
cat public/data/unified/conflict/validation.json
cat public/data/unified/economic/validation.json

# Check quality scores
node -e "console.log(require('./public/data/unified/conflict/metadata.json').quality)"
```

## Rollback

### Netlify

1. Go to Deploys
2. Find previous successful deploy
3. Click "Publish deploy"

### Manual

```bash
# Revert to previous commit
git revert HEAD
git push

# Or reset to specific commit
git reset --hard <commit-hash>
git push --force
```

## Troubleshooting

### Build Fails

**Check build logs:**
- Netlify: Deploys > Failed deploy > View logs
- Look for error messages

**Common issues:**
- Missing dependencies: `npm install`
- TypeScript errors: `npm run build` locally
- Environment variables: Check Netlify settings

### Site Not Loading

**Check:**
- Build succeeded
- Publish directory is correct (`dist`)
- Redirects are configured
- DNS is configured correctly

### Data Not Loading

**Check:**
- Data files exist in `public/data/`
- Manifest is generated
- File paths are correct
- CORS is not blocking requests

### Performance Issues

**Optimize:**
- Enable compression (automatic on Netlify)
- Optimize images
- Reduce bundle size
- Enable caching

## Best Practices

1. **Always test locally** before deploying
2. **Update data regularly** (weekly recommended)
3. **Monitor performance** with Lighthouse
4. **Use preview deploys** for testing
5. **Keep dependencies updated**
6. **Monitor error logs**
7. **Have rollback plan**
8. **Document changes**

## Security

### Headers

Add to `netlify.toml`:
```toml
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    X-XSS-Protection = "1; mode=block"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

### HTTPS

- Always use HTTPS
- Automatic with Netlify
- Force HTTPS redirect

### Dependencies

```bash
# Check for vulnerabilities
npm audit

# Fix vulnerabilities
npm audit fix
```

## Resources

- [Netlify Docs](https://docs.netlify.com)
- [Vite Deployment](https://vitejs.dev/guide/static-deploy.html)
- [Vercel Docs](https://vercel.com/docs)
- [GitHub Pages](https://pages.github.com)

## Support

- Check [Troubleshooting](../troubleshooting/DATA_SOURCE_TROUBLESHOOTING.md)
- Review Netlify logs
- Check browser console
- Test locally first
