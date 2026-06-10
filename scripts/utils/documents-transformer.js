/**
 * ReliefWeb documents transformer.
 *
 * Input (from scripts/sources/reliefweb-pse.js): one row per report:
 *   { id, date, title, source, format, themes, language, url }
 *
 * Output: canonical record with event_type "document".
 */

import { BaseTransformer } from './base-transformer.js';

export class DocumentsTransformer extends BaseTransformer {
    constructor() {
        super('documents');
    }

    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter((r) => r && r.id && r.date && r.title)
            .map((r) => this.transformRecord(r, context));
    }

    transformRecord(r) {
        return this.toCanonical({
            id: r.id,
            date: r.date,
            category: 'documents',
            event_type: 'document',
            location: {
                name: 'Palestine',
                region: 'Palestine',
                governorate: null,
                lat: null,
                lon: null,
                precision: 'country',
            },
            metrics: {},
            title: r.title,
            document_format: r.format,
            document_themes: r.themes || [],
            document_language: r.language,
            document_url: r.url,
            publisher: r.source,
            description: `${r.format || 'Report'}: ${r.title}${r.source ? ` — ${r.source}` : ''}`,
            sources: [{
                name: 'ReliefWeb',
                organization: 'OCHA',
                url: r.url,
                license: 'metadata-free-with-attribution',
            }],
        });
    }
}
