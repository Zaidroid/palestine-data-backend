import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { specs } from './config/swagger.js';
import { initializeSearch } from './services/searchService.js';
import routes from './routes/index.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Search Index
initializeSearch();

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(compression());

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// Routes
app.use('/api/v1', routes);
app.use('/data', express.static('public/data'));


// 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server if this file is run directly
// Start server
const startServer = () => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Documentation: http://localhost:${PORT}/api-docs`);
        console.log(`Health check: http://localhost:${PORT}/api/v1/health`);
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
