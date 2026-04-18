import express from 'express';
import apicache from 'apicache';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MANIFEST_PATH = path.resolve(__dirname, '../../../public/data/unified/unified-manifest.json');
const PKG_PATH = path.resolve(__dirname, '../../../package.json');

const router = express.Router();
const cache = apicache.middleware;

function deriveDatasetVersion(generatedAtIso, revision = 1) {
    const d = new Date(generatedAtIso);
    if (Number.isNaN(d.getTime())) return null;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd}+${revision}`;
}

router.get('/', cache('5 minutes'), async (req, res) => {
    try {
        const [manifestRaw, pkgRaw] = await Promise.all([
            fs.readFile(MANIFEST_PATH, 'utf8'),
            fs.readFile(PKG_PATH, 'utf8'),
        ]);
        const manifest = JSON.parse(manifestRaw);
        const pkg = JSON.parse(pkgRaw);

        const generated_at = manifest.generated_at || null;
        const dataset_version = generated_at ? deriveDatasetVersion(generated_at) : null;

        res.json({
            api_version: pkg.version || 'unknown',
            schema_version: '3.0.0',
            dataset_version,
            generated_at,
            sentry_release: process.env.SENTRY_RELEASE || null,
            categories: manifest.categories ? Object.keys(manifest.categories).length : 0,
        });
    } catch (e) {
        res.status(503).json({ error: 'version_unavailable', detail: e.message });
    }
});

export default router;
export { deriveDatasetVersion };
