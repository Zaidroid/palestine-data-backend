/**
 * News Transformer
 * 
 * Standardizes news articles from various RSS feeds into the unified schema.
 */

export class NewsTransformer {
    constructor() {
        this.name = 'NewsTransformer';
    }

    /**
     * Transform raw data into unified format
     */
    transform(data, metadata = {}) {
        if (!Array.isArray(data)) {
            data = [data];
        }

        return data.map(item => {
            // RSS fetcher already does a lot of cleaning, but we ensure strict schema here
            return {
                id: item.guid || this.generateId(item),
                title: item.title,
                description: item.description,
                link: item.link,
                date: item.pubDate, // ISO string
                source: item.source,
                source_category: item.sourceCategory || 'news',
                category: item.articleCategory || 'general',
                language: item.language || 'en',
                reliability: item.reliability || 'unknown',
                // Standard unified fields
                event_type: 'news_report',
                location: this.extractLocation(item) || 'Palestine',
                timestamp: new Date(item.pubDate).getTime(),
            };
        });
    }

    /**
     * Enrich data (optional)
     */
    enrich(data) {
        return data.map(item => {
            return {
                ...item,
                // Add relative time or other derived fields if needed
                is_recent: this.isRecent(item.date),
            };
        });
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

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Helpers

    generateId(item) {
        // Simple hash of link or title
        const str = item.link || item.title;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return `news-${Math.abs(hash)}`;
    }

    isRecent(dateStr) {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        return diff < (24 * 60 * 60 * 1000); // 24 hours
    }

    extractLocation(item) {
        // Simple keyword matching for major locations
        const text = `${item.title} ${item.description}`.toLowerCase();
        if (text.includes('gaza')) return 'Gaza Strip';
        if (text.includes('west bank')) return 'West Bank';
        if (text.includes('jerusalem')) return 'Jerusalem';
        if (text.includes('jenin')) return 'Jenin';
        if (text.includes('nablus')) return 'Nablus';
        if (text.includes('hebron')) return 'Hebron';
        if (text.includes('rafah')) return 'Rafah';
        if (text.includes('khan yunis')) return 'Khan Yunis';
        return null;
    }
}
