/**
 * News Summarizer Utility
 * 
 * Extracts key information from news articles and generates structured summaries.
 * Categorizes articles and extracts entities (locations, organizations, etc.)
 */

import { createLogger } from './logger.js';

const logger = createLogger({
    context: 'News-Summarizer',
    logLevel: 'INFO',
});

/**
 * Extract key entities from text
 */
export function extractEntities(text) {
    if (!text) return { locations: [], organizations: [], people: [] };

    const entities = {
        locations: [],
        organizations: [],
        people: [],
    };

    // Palestine locations
    const locationPatterns = [
        'Gaza', 'West Bank', 'Jerusalem', 'Hebron', 'Nablus', 'Jenin', 'Ramallah',
        'Rafah', 'Khan Yunis', 'Deir al-Balah', 'Bethlehem', 'Jericho', 'Tulkarm',
        'Qalqilya', 'Salfit', 'Tubas', 'Gaza City', 'East Jerusalem',
    ];

    // Organizations
    const orgPatterns = [
        'UNRWA', 'UN', 'United Nations', 'WHO', 'World Health Organization',
        'Hamas', 'Fatah', 'PLO', 'Palestinian Authority', 'IDF', 'Israeli Defense Forces',
        'Red Cross', 'Red Crescent', 'Doctors Without Borders', 'MSF',
    ];

    // Extract locations
    for (const location of locationPatterns) {
        if (text.includes(location) && !entities.locations.includes(location)) {
            entities.locations.push(location);
        }
    }

    // Extract organizations
    for (const org of orgPatterns) {
        if (text.includes(org) && !entities.organizations.includes(org)) {
            entities.organizations.push(org);
        }
    }

    return entities;
}

/**
 * Extract numbers and statistics from text
 */
export function extractStatistics(text) {
    if (!text) return [];

    const stats = [];

    // Pattern: number + unit (killed, injured, displaced, etc.)
    const patterns = [
        /(\d+(?:,\d+)*)\s+(?:people\s+)?(?:killed|dead|deaths)/gi,
        /(\d+(?:,\d+)*)\s+(?:people\s+)?(?:injured|wounded)/gi,
        /(\d+(?:,\d+)*)\s+(?:people\s+)?(?:displaced|evacuated)/gi,
        /(\d+(?:,\d+)*)\s+(?:buildings?|homes?|houses?)\s+(?:destroyed|damaged)/gi,
    ];

    for (const pattern of patterns) {
        const matches = [...text.matchAll(pattern)];
        for (const match of matches) {
            stats.push({
                value: match[1].replace(/,/g, ''),
                context: match[0],
            });
        }
    }

    return stats;
}

/**
 * Determine article urgency
 */
export function assessUrgency(article) {
    const text = `${article.title} ${article.description || ''}`.toLowerCase();

    // High urgency keywords
    const highUrgency = [
        'breaking', 'urgent', 'emergency', 'crisis', 'attack', 'strike',
        'killed', 'dead', 'casualties', 'bombing', 'explosion',
    ];

    // Medium urgency keywords
    const mediumUrgency = [
        'injured', 'wounded', 'damage', 'destroyed', 'displaced',
        'humanitarian', 'aid', 'relief',
    ];

    if (highUrgency.some(keyword => text.includes(keyword))) {
        return 'high';
    } else if (mediumUrgency.some(keyword => text.includes(keyword))) {
        return 'medium';
    } else {
        return 'low';
    }
}

/**
 * Generate article summary
 */
export function summarizeArticle(article) {
    const text = `${article.title} ${article.description || ''}`;

    const summary = {
        title: article.title,
        link: article.link,
        pubDate: article.pubDate,
        source: article.source,
        category: article.articleCategory || 'general',
        urgency: assessUrgency(article),
        entities: extractEntities(text),
        statistics: extractStatistics(text),
        snippet: generateSnippet(article.description, 200),
    };

    return summary;
}

/**
 * Generate a short snippet from text
 */
export function generateSnippet(text, maxLength = 200) {
    if (!text) return '';

    // Remove HTML tags
    let clean = text.replace(/<[^>]*>/g, '');

    // Trim to max length at word boundary
    if (clean.length > maxLength) {
        clean = clean.substring(0, maxLength);
        const lastSpace = clean.lastIndexOf(' ');
        if (lastSpace > 0) {
            clean = clean.substring(0, lastSpace);
        }
        clean += '...';
    }

    return clean.trim();
}

/**
 * Batch summarize articles
 */
export function summarizeArticles(articles) {
    return articles.map(article => summarizeArticle(article));
}

/**
 * Generate daily digest
 */
export function generateDailyDigest(articles) {
    const summaries = summarizeArticles(articles);

    // Group by urgency
    const byUrgency = {
        high: summaries.filter(s => s.urgency === 'high'),
        medium: summaries.filter(s => s.urgency === 'medium'),
        low: summaries.filter(s => s.urgency === 'low'),
    };

    // Group by category
    const byCategory = {};
    for (const summary of summaries) {
        const cat = summary.category;
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(summary);
    }

    // Extract all statistics
    const allStats = summaries.flatMap(s => s.statistics);

    // Extract all entities
    const allLocations = new Set();
    const allOrgs = new Set();

    for (const summary of summaries) {
        summary.entities.locations.forEach(loc => allLocations.add(loc));
        summary.entities.organizations.forEach(org => allOrgs.add(org));
    }

    return {
        date: new Date().toISOString().split('T')[0],
        totalArticles: summaries.length,
        byUrgency: {
            high: byUrgency.high.length,
            medium: byUrgency.medium.length,
            low: byUrgency.low.length,
        },
        byCategory: Object.entries(byCategory).map(([cat, arts]) => ({
            category: cat,
            count: arts.length,
        })),
        topLocations: Array.from(allLocations).slice(0, 10),
        topOrganizations: Array.from(allOrgs).slice(0, 10),
        totalStatistics: allStats.length,
        highlights: byUrgency.high.slice(0, 5), // Top 5 urgent stories
        summaries: summaries,
    };
}

export default {
    extractEntities,
    extractStatistics,
    assessUrgency,
    summarizeArticle,
    summarizeArticles,
    generateDailyDigest,
    generateSnippet,
};
