#!/usr/bin/env node

/**
 * RSS Feed Fetcher
 * 
 * Fetches news from verified RSS/Atom feeds related to Palestine.
 * Filters and categorizes news articles for real-time updates.
 * 
 * Sources:
 * - Al Jazeera (Palestine section)
 * - Reuters (Middle East)
 * - UN News (Palestine)
 * - Middle East Eye
 * - Haaretz
 * 
 * Usage: node scripts/fetch-rss-feeds.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize logger
const logger = createLogger({
    context: 'RSS-Fetcher',
    logLevel: 'INFO',
});

// Configuration
const DATA_DIR = path.join(__dirname, '../public/data/news');
const RATE_LIMIT_DELAY = 1000; // 1 second between feeds

// RSS Feed Sources
const RSS_FEEDS = [
    {
        name: 'Al Jazeera Palestine',
        url: 'https://www.aljazeera.com/xml/rss/all.xml',
        category: 'news',
        reliability: 'high',
        language: 'en',
    },
    {
        name: 'Al Jazeera Arabic',
        url: 'https://www.aljazeera.net/xml/rss/all.xml',
        category: 'news',
        reliability: 'high',
        language: 'ar',
    },
    {
        name: 'Middle East Eye',
        url: 'https://www.middleeasteye.net/rss',
        category: 'news',
        reliability: 'high',
        language: 'en',
    },
    {
        name: '+972 Magazine',
        url: 'https://972mag.com/feed',
        category: 'news',
        reliability: 'high',
        language: 'en',
    },
    {
        name: 'Haaretz',
        url: 'https://www.haaretz.com/srv/israel-news-rss',
        category: 'news',
        reliability: 'high',
        language: 'en',
    },
    {
        name: 'The Electronic Intifada',
        url: 'https://electronicintifada.net/rss.xml',
        category: 'news',
        reliability: 'medium',
        language: 'en',
    },
    {
        name: 'Mondoweiss',
        url: 'https://mondoweiss.net/feed/',
        category: 'news',
        reliability: 'medium',
        language: 'en',
    },
    {
        name: 'Palestine Chronicle',
        url: 'https://www.palestinechronicle.com/feed/',
        category: 'news',
        reliability: 'medium',
        language: 'en',
    },
    {
        name: 'WAFA News Agency',
        url: 'https://english.wafa.ps/rss',
        category: 'official',
        reliability: 'high',
        language: 'en',
    },
    {
        name: 'OCHA oPt',
        url: 'https://www.ochaopt.org/rss.xml',
        category: 'official',
        reliability: 'high',
        language: 'en',
    },
    {
        name: 'Amnesty International',
        url: 'https://www.amnesty.org/en/location/middle-east-and-north-africa/israel-and-occupied-palestinian-territories/feed/',
        category: 'human_rights',
        reliability: 'high',
        language: 'en',
    },
    {
        name: 'Quds News Network',
        url: 'https://qudsnen.co/feed/',
        category: 'news',
        reliability: 'medium',
        language: 'en',
    },
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
}

/**
 * Write JSON file
 */
async function writeJSON(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Parse XML to extract feed items
 * Simple XML parser for RSS/Atom feeds
 */
function parseRSSFeed(xmlText) {
    const items = [];

    // Extract items/entries
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;

    let matches = [...xmlText.matchAll(itemRegex)];
    if (matches.length === 0) {
        matches = [...xmlText.matchAll(entryRegex)];
    }

    for (const match of matches) {
        const itemXml = match[1];

        const item = {
            title: extractTag(itemXml, 'title'),
            link: extractTag(itemXml, 'link'),
            description: extractTag(itemXml, 'description') || extractTag(itemXml, 'summary'),
            pubDate: extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'published') || extractTag(itemXml, 'updated'),
            category: extractTag(itemXml, 'category'),
            guid: extractTag(itemXml, 'guid') || extractTag(itemXml, 'id'),
        };

        items.push(item);
    }

    return items;
}

/**
 * Extract content from XML tag
 */
function extractTag(xml, tagName) {
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\/${tagName}>`, 'i');
    const match = xml.match(regex);
    if (match) {
        // Remove CDATA wrapper if present
        let content = match[1].trim();
        content = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
        // Decode HTML entities
        content = content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
        return content;
    }
    return null;
}

/**
 * Check if article is Palestine-relevant
 */
function isPalestineRelevant(item) {
    const palestineKeywords = [
        'palestine', 'palestinian', 'gaza', 'west bank', 'westbank',
        'jerusalem', 'hebron', 'nablus', 'jenin', 'ramallah',
        'rafah', 'khan yunis', 'israel', 'israeli', 'idf',
        'hamas', 'fatah', 'plo', 'unrwa', 'occupied territories',
    ];

    const text = `${item.title} ${item.description || ''}`.toLowerCase();

    return palestineKeywords.some(keyword => text.includes(keyword));
}

/**
 * Categorize news article
 */
function categorizeArticle(item) {
    const text = `${item.title} ${item.description || ''}`.toLowerCase();

    if (text.match(/conflict|war|attack|strike|bomb|casualt|kill|death/)) {
        return 'conflict';
    } else if (text.match(/humanitarian|aid|relief|refugee|displace/)) {
        return 'humanitarian';
    } else if (text.match(/health|hospital|medical|disease/)) {
        return 'health';
    } else if (text.match(/politic|government|election|diplomat/)) {
        return 'political';
    } else if (text.match(/econom|trade|business|market/)) {
        return 'economic';
    } else {
        return 'general';
    }
}

/**
 * Fetch and parse RSS feed
 */
async function fetchRSSFeed(feed) {
    await logger.info(`Fetching: ${feed.name}`);

    try {
        const response = await fetch(feed.url, {
            headers: {
                'User-Agent': 'Palestine-Data-Backend/1.0',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const xmlText = await response.text();
        const items = parseRSSFeed(xmlText);

        // Filter for Palestine-relevant articles
        const relevantItems = items.filter(isPalestineRelevant);

        await logger.success(`Found ${relevantItems.length}/${items.length} Palestine-relevant articles`);

        // Categorize and enrich
        const enrichedItems = relevantItems.map(item => ({
            ...item,
            source: feed.name,
            sourceCategory: feed.category,
            reliability: feed.reliability,
            language: feed.language || 'en',
            articleCategory: categorizeArticle(item),
            fetchedAt: new Date().toISOString(),
        }));

        return enrichedItems;

    } catch (error) {
        await logger.error(`Failed to fetch ${feed.name}`, error);
        return [];
    }
}

/**
 * Main function
 */
async function fetchRSSFeeds() {
    await logger.info('========================================');
    await logger.info('RSS Feed Fetcher');
    await logger.info('========================================');

    await ensureDir(DATA_DIR);

    const allArticles = [];

    for (const feed of RSS_FEEDS) {
        const articles = await fetchRSSFeed(feed);
        allArticles.push(...articles);
        await sleep(RATE_LIMIT_DELAY);
    }

    // Sort by publication date (newest first)
    allArticles.sort((a, b) => {
        const dateA = new Date(a.pubDate || 0);
        const dateB = new Date(b.pubDate || 0);
        return dateB - dateA;
    });

    // Group by category
    const byCategory = {};
    for (const article of allArticles) {
        const cat = article.articleCategory;
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(article);
    }

    // Save all articles
    const allDataPath = path.join(DATA_DIR, 'all-articles.json');
    await writeJSON(allDataPath, {
        fetchedAt: new Date().toISOString(),
        totalArticles: allArticles.length,
        sources: RSS_FEEDS.map(f => f.name),
        articles: allArticles,
    });
    await logger.success(`Saved ${allArticles.length} articles to all-articles.json`);

    // Save by category
    for (const [category, articles] of Object.entries(byCategory)) {
        const categoryPath = path.join(DATA_DIR, `${category}.json`);
        await writeJSON(categoryPath, {
            category,
            count: articles.length,
            articles,
        });
        await logger.info(`${category}: ${articles.length} articles`);
    }

    // Save recent (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentArticles = allArticles.filter(a => {
        const pubDate = new Date(a.pubDate);
        return pubDate > oneDayAgo;
    });

    const recentPath = path.join(DATA_DIR, 'recent.json');
    await writeJSON(recentPath, {
        timeframe: '24 hours',
        count: recentArticles.length,
        articles: recentArticles,
    });
    await logger.info(`Recent (24h): ${recentArticles.length} articles`);

    // Generate summary
    const summary = {
        fetchedAt: new Date().toISOString(),
        totalArticles: allArticles.length,
        recentArticles: recentArticles.length,
        sources: RSS_FEEDS.length,
        byCategory: Object.entries(byCategory).map(([cat, arts]) => ({
            category: cat,
            count: arts.length,
        })),
        bySource: RSS_FEEDS.map(feed => ({
            name: feed.name,
            count: allArticles.filter(a => a.source === feed.name).length,
        })),
    };

    const summaryPath = path.join(DATA_DIR, 'summary.json');
    await writeJSON(summaryPath, summary);

    // Print summary
    await logger.info('========================================');
    await logger.info('Fetch Summary');
    await logger.info('========================================');
    await logger.info(`Total articles: ${allArticles.length}`);
    await logger.info(`Recent (24h): ${recentArticles.length}`);
    await logger.info('By category:');
    for (const item of summary.byCategory) {
        await logger.info(`  ${item.category}: ${item.count}`);
    }
    await logger.info('========================================');

    return summary;
}

// Run
if (import.meta.url === `file://${process.argv[1]}`) {
    fetchRSSFeeds()
        .then(async () => {
            await logger.success('RSS feed fetch completed successfully');
            process.exit(0);
        })
        .catch(async (error) => {
            await logger.error('RSS feed fetch failed', error);
            process.exit(1);
        });
}

export { fetchRSSFeeds };
