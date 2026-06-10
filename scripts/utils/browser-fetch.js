/**
 * Shared headless-browser fetch utility (Phase-2 scrapers).
 *
 * Three jobs the plain fetch stack can't do:
 *   1. renderedHtml(url)        — pages behind JS challenges (Deflect, Radware)
 *      or bot-blocking 403s (HaMoked). Returns post-render HTML.
 *   2. captureResponses(url, m) — load a page and capture network responses
 *      whose URL matches `m` (regex). How we extract Power BI querydata
 *      without reverse-engineering the auth headers: let the embed make its
 *      own calls, record the JSON bodies.
 *   3. capturePost(url, m)      — like captureResponses but also returns each
 *      matched request's POST body, so a captured query can be replayed
 *      with modified bindings.
 *
 * Uses playwright-chromium (devDependency). Headless; one browser per call —
 * these scrapers run once a day, simplicity beats pooling.
 */

import { chromium } from 'playwright';

const DEFAULT_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

async function withPage(fn, { timeout = 90000 } = {}) {
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ userAgent: DEFAULT_UA });
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);
        return await fn(page);
    } finally {
        await browser.close();
    }
}

/**
 * Load `url`, wait for network-idle (or `waitMs`), return rendered HTML.
 * Survives JS challenges that resolve within the wait window.
 */
export async function renderedHtml(url, { waitMs = 8000, timeout = 90000 } = {}) {
    return withPage(async (page) => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        await page.waitForTimeout(waitMs);
        return page.content();
    }, { timeout });
}

/**
 * Load `url`; capture every response whose URL matches `urlPattern`.
 * Returns [{ url, status, body }] where body is parsed JSON when possible.
 * Stops after `settleMs` of page idle time.
 */
export async function captureResponses(url, urlPattern, { settleMs = 15000, timeout = 120000 } = {}) {
    return withPage(async (page) => {
        const captured = [];
        page.on('response', async (res) => {
            if (!urlPattern.test(res.url())) return;
            try {
                const text = await res.text();
                let body = text;
                try { body = JSON.parse(text); } catch {}
                captured.push({
                    url: res.url(),
                    status: res.status(),
                    request_body: res.request().postData() || null,
                    request_headers: await res.request().allHeaders(),
                    body,
                });
            } catch { /* response body unavailable (redirects etc.) */ }
        });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        await page.waitForTimeout(settleMs);
        return captured;
    }, { timeout });
}
