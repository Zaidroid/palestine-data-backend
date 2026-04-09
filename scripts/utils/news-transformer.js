/**
 * News Transformer
 *
 * Standardizes news articles from various RSS feeds into the unified schema.
 */

import { BaseTransformer } from './base-transformer.js';

export class NewsTransformer extends BaseTransformer {
    constructor() {
        super('news');
    }

    /**
     * Transform raw data into unified format
     */
    transform(data, metadata = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter(item => item && item.title)
            .map(item => this.transformRecord(item, metadata));
    }

    transformRecord(item, metadata) {
        const date = this.normalizeDate(item.pubDate || item.date) || new Date().toISOString().split('T')[0];
        const locationName = this.extractLocationName(item);
        const region = this.classifyRegion(locationName);

        return this.toCanonical({
            id: item.guid || this.generateId('news', { link: item.link, title: item.title }),
            date,
            category: 'news',
            event_type: 'news_report',
            location: {
                name: locationName,
                governorate: null,
                region,
                lat: null,
                lon: null,
                precision: 'region',
            },
            metrics: { count: 1, unit: 'articles' },
            description: item.title || '',
            // News-specific supplemental fields
            title: item.title,
            article_description: item.description,
            link: item.link,
            source: item.source,
            source_category: item.sourceCategory || 'news',
            article_category: item.articleCategory || 'general',
            language: item.language || 'en',
            reliability: item.reliability || 'unknown',
            sources: [{
                name: item.source || metadata.source || 'RSS Feed',
                organization: item.source || metadata.organization || 'Media',
                url: item.link || null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        });
    }

    /**
     * Enrich data
     */
    enrich(data) {
        return data.map(item => ({
            ...item,
            is_recent: this.isRecent(item.date),
        }));
    }

    /**
     * Validate transformed data
     */
    validate(data) {
        const errors = [];
        data.forEach((item, index) => {
            if (!item.title) errors.push(`Row ${index}: Missing title`);
            if (!item.date) errors.push(`Row ${index}: Missing date`);
            if (!item.link) errors.push(`Row ${index}: Missing link`);
        });
        return { valid: errors.length === 0, errors };
    }

    isRecent(dateStr) {
        const date = new Date(dateStr);
        const now = new Date();
        return (now - date) < (24 * 60 * 60 * 1000);
    }

    extractLocationName(item) {
        const text = `${item.title || ''} ${item.description || ''}`.toLowerCase();
        if (text.includes('gaza')) return 'Gaza Strip';
        if (text.includes('west bank')) return 'West Bank';
        if (text.includes('jerusalem')) return 'Jerusalem';
        if (text.includes('jenin')) return 'Jenin';
        if (text.includes('nablus')) return 'Nablus';
        if (text.includes('hebron')) return 'Hebron';
        if (text.includes('rafah')) return 'Rafah';
        if (text.includes('khan yunis')) return 'Khan Yunis';
        return 'Palestine';
    }
}

export default NewsTransformer;
