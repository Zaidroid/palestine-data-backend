import pino from 'pino';
import pinoHttp from 'pino-http';
import crypto from 'crypto';

const isProd = (process.env.NODE_ENV || 'development') === 'production';

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: { service: 'palestine-data-api' },
    redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', '*.api_key', '*.password'],
        censor: '[REDACTED]',
    },
    formatters: {
        level(label) {
            return { level: label };
        },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    transport: isProd
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
});

export const httpLogger = pinoHttp({
    logger,
    genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = incoming || crypto.randomUUID();
        res.setHeader('x-request-id', id);
        return id;
    },
    customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    },
    customProps: (req) => ({
        tier: req.customer?.tier,
        customer_id: req.customer?.id,
    }),
    serializers: {
        req(req) {
            return {
                id: req.id,
                method: req.method,
                url: req.url,
                remoteAddress: req.socket?.remoteAddress,
            };
        },
        res(res) {
            return { statusCode: res.statusCode };
        },
    },
});
