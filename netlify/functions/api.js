import serverless from 'serverless-http';
import app from '../../src/api/server.js';

export const handler = serverless(app);
