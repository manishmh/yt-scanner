import { config } from '@/config';
import fs from 'fs';
import path from 'path';
import winston from 'winston';

// Ensure logs directory exists
const logsDir = path.dirname(config.logging.file);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for structured logging
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, service, videoId, jobId, ...meta }) => {
    const logObj: Record<string, unknown> = {
      timestamp,
      level,
      message,
      service: service || 'yt-scanner',
      ...meta
    };
    
    if (videoId) {
      logObj.videoId = videoId;
    }
    if (jobId) {
      logObj.jobId = jobId;
    }
    
    return JSON.stringify(logObj);
  })
);

// Create the logger
export const logger = winston.createLogger({
  level: config.logging.level,
  format: customFormat,
  defaultMeta: { service: 'yt-scanner' },
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Separate file for errors
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true
    })
  ]
});

// Add console transport for development
if (config.server.nodeEnv === 'development') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf((info) => {
        const { timestamp, level, message, videoId, jobId, ...meta } = info;
        let logMessage = `${timestamp} [${level}]: ${message}`;
        if (videoId) logMessage += ` (VideoID: ${videoId})`;
        if (jobId) logMessage += ` (JobID: ${jobId})`;
        if (Object.keys(meta).length > 0) {
          logMessage += ` ${JSON.stringify(meta)}`;
        }
        return logMessage;
      })
    )
  }));
}

// Specialized loggers for different components
export const createComponentLogger = (component: string) => {
  return {
    info: (message: string, meta?: Record<string, unknown>) => 
      logger.info(message, { component, ...meta }),
    
    warn: (message: string, meta?: Record<string, unknown>) => 
      logger.warn(message, { component, ...meta }),
    
    error: (message: string, error?: Error, meta?: Record<string, unknown>) => 
      logger.error(message, { component, error: error?.stack || error, ...meta }),
    
    debug: (message: string, meta?: Record<string, unknown>) => 
      logger.debug(message, { component, ...meta }),

    // Video-specific logging
    videoInfo: (videoId: string, message: string, meta?: Record<string, unknown>) =>
      logger.info(message, { component, videoId, ...meta }),

    videoError: (videoId: string, message: string, error?: Error, meta?: Record<string, unknown>) =>
      logger.error(message, { component, videoId, error: error?.stack || error, ...meta }),

    // Job-specific logging
    jobInfo: (jobId: string, message: string, meta?: Record<string, unknown>) =>
      logger.info(message, { component, jobId, ...meta }),

    jobError: (jobId: string, message: string, error?: Error, meta?: Record<string, unknown>) =>
      logger.error(message, { component, jobId, error: error?.stack || error, ...meta }),

    // Performance logging
    performance: (operation: string, duration: number, meta?: Record<string, unknown>) =>
      logger.info(`Performance: ${operation} completed in ${duration}ms`, { 
        component, 
        operation, 
        duration, 
        type: 'performance',
        ...meta 
      }),

    // Detection logging
    detection: (type: string, confidence: number, meta?: Record<string, unknown>) =>
      logger.info(`Detection: ${type} found with confidence ${confidence}`, {
        component,
        detectionType: type,
        confidence,
        type: 'detection',
        ...meta
      })
  };
};

// Pre-configured component loggers
export const youtubeLogger = createComponentLogger('youtube-monitor');
export const thumbnailLogger = createComponentLogger('thumbnail-analyzer');
export const videoLogger = createComponentLogger('video-processor');
export const transcriptLogger = createComponentLogger('transcript-analyzer');
export const audioLogger = createComponentLogger('audio-analyzer');
export const ocrLogger = createComponentLogger('ocr-processor');
export const pubsubLogger = createComponentLogger('pubsub');
export const storageLogger = createComponentLogger('storage');
export const apiLogger = createComponentLogger('api');

// Middleware for Express request logging
export const requestLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'requests.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3
    })
  ]
});

// Express middleware function
export const logRequests = (req: any, res: any, next: any) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    requestLogger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
  });
  
  next();
};

// Error logging helper
export const logError = (error: Error, context?: Record<string, unknown>) => {
  logger.error('Unhandled error', {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    ...context
  });
};

// Process error handlers
process.on('uncaughtException', (error) => {
  logError(error, { type: 'uncaughtException' });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason,
    promise: promise.toString(),
    type: 'unhandledRejection'
  });
});

export default logger; 