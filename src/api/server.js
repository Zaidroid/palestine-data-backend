import { Sentry, sentryEnabled } from './instrument.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import { fileURLToPath } from 'url';
import { specs } from './config/swagger.js';
import { initializeSearch } from './services/searchService.js';
import { apiKey } from './middleware/apiKey.js';
import { tieredRateLimit } from './middleware/rateLimit.js';
import { logger, httpLogger } from './logger.js';
import routes from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// Initialize Search Index
initializeSearch();

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:    ["'self'"],
            scriptSrc:     ["'self'", "'unsafe-inline'", "'unsafe-eval'", "cdn.jsdelivr.net", "unpkg.com"],
            scriptSrcElem: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "cdn.jsdelivr.net", "unpkg.com"],
            styleSrc:      ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "unpkg.com", "fonts.googleapis.com"],
            styleSrcElem:  ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "unpkg.com", "fonts.googleapis.com"],
            imgSrc:        ["'self'", "data:", "blob:", "https:", "http:"],
            connectSrc:    ["'self'", "http://localhost:*", "http://127.0.0.1:*", "https://cdn.jsdelivr.net", "https://unpkg.com"],
            fontSrc:       ["'self'", "https:", "data:", "fonts.gstatic.com"],
            workerSrc:     ["'self'", "blob:"],
            childSrc:      ["'self'", "blob:"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(httpLogger);
app.use(express.json());
app.use(compression());

// API-key resolution must run before tiered rate limiting so the limiter can
// key by req.customer.keyId (or fall back to req.ip for anonymous traffic).
app.use(apiKey);
app.use(tieredRateLimit);

// Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// Routes
app.use('/api/v1', routes);
app.use(express.static('public'));


// 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Sentry Express error handler (no-op when DSN unset)
if (sentryEnabled) {
    Sentry.setupExpressErrorHandler(app);
}

// Error Handler
app.use((err, req, res, next) => {
    (req.log || logger).error({ err }, 'request_failed');
    res.status(500).json({ error: 'Something went wrong!' });
});

// Process-level crash handlers — flush Sentry, then exit so the orchestrator restarts us.
const _crash = async (label, err) => {
    logger.fatal({ err, label }, 'process_crash');
    try {
        if (sentryEnabled) {
            Sentry.captureException(err);
            await Sentry.flush(2000);
        }
    } finally {
        process.exit(1);
    }
};
process.on('uncaughtException', (err) => _crash('uncaughtException', err));
process.on('unhandledRejection', (reason) => _crash('unhandledRejection', reason));

// Start server if this file is run directly
// Start server
const startServer = () => {
    app.listen(PORT, () => {
        logger.info({ port: PORT, docs: `http://localhost:${PORT}/api-docs`, health: `http://localhost:${PORT}/api/v1/health` }, 'server_started');
    });
};

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
    startServer();
} else {
    // Fallback for Windows if the above check fails due to case sensitivity or other path issues
    // We can check if the file name matches
    if (process.argv[1].endsWith('server.js')) {
        startServer();
    }
}

export default app;
