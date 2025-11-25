import swaggerJsdoc from 'swagger-jsdoc';

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Palestine Data API',
            version: '1.0.0',
            description: 'Unified API for Palestine data, aggregating sources like UN OCHA, PCBS, WHO, and more.',
            contact: {
                name: 'API Support',
                url: 'https://github.com/yourusername/palestine-data-backend'
            },
        },
        servers: [
            {
                url: 'http://localhost:3000/api/v1',
                description: 'Local server',
            },
        ],
        components: {
            schemas: {
                UnifiedRecord: {
                    type: 'object',
                    properties: {
                        date: { type: 'string', format: 'date' },
                        location: { type: 'string' },
                        category: { type: 'string' },
                        source: { type: 'string' },
                        // Add other common fields
                    }
                }
            }
        }
    },
    apis: ['./src/api/routes/*.js'], // Path to the API docs
};

export const specs = swaggerJsdoc(options);
