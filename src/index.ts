import { config } from '@/config';
import webhookRoutes from '@/routes/webhook';
import { DatabaseService } from '@/services/database';
import { VideoProcessor } from '@/services/processor';
import { SimpleVideoProcessor } from '@/services/processor/simple-processor';
import { YouTubeMonitor } from '@/services/youtube/monitor';
import { APIResponse } from '@/types';
import { apiLogger, logger, logRequests } from '@/utils/logger';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

class YTScannerApp {
  private app: express.Application;
  private youtubeMonitor: YouTubeMonitor;
  private videoProcessor: VideoProcessor;
  private simpleProcessor: SimpleVideoProcessor;
  private database: DatabaseService;

  constructor() {
    this.app = express();
    this.youtubeMonitor = new YouTubeMonitor();
    this.videoProcessor = new VideoProcessor();
    this.simpleProcessor = new SimpleVideoProcessor();
    this.database = new DatabaseService();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }


  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    
    // CORS middleware
    this.app.use(cors({
      origin: process.env.NODE_ENV === 'production' ? false : true,
      credentials: true
    }));

    // Raw body parsing for webhooks (before JSON parsing) to add parsing manishmh
    this.app.use('/api/webhook', express.raw({ type: 'application/atom+xml', limit: '1mb' }));
    this.app.use('/api/webhook', express.raw({ type: 'text/xml', limit: '1mb' }));
    this.app.use('/api/webhook', express.text({ type: 'text/plain', limit: '1mb' }));

    // Request parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use(logRequests);

    apiLogger.info('Express middleware configured');
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (_req, res) => {
      const response: APIResponse = {
        success: true,
        data: {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          database: this.database.isConnectedToDatabase(),
          uptime: process.uptime()
        },
        timestamp: new Date().toISOString()
      };
      res.json(response);
    });

    // Webhook routes
    this.app.use('/api/webhook', webhookRoutes);

    // Get system status
    this.app.get('/api/status', async (_req, res) => {
      try {
        const processorStatus = await this.videoProcessor.getStatus();
        const dbStats = await this.database.getStatistics();
        const monitorStatus = this.youtubeMonitor.getMonitoringStatus();

        const response: APIResponse = {
          success: true,
          data: {
            processor: processorStatus,
            database: dbStats,
            monitor: monitorStatus
          },
          timestamp: new Date().toISOString()
        };

        res.json(response);

      } catch (error) {
        apiLogger.error('Error getting system status', error as Error);
        const response: APIResponse = {
          success: false,
          data: null,
          error: 'Failed to get system status',
          timestamp: new Date().toISOString()
        };
        res.status(500).json(response);
      }
    });

    // Get analysis results
    this.app.get('/api/results', async (req, res) => {
      try {
        const {
          recommendedAction,
          hasMoneyThumbnail,
          codesFoundMin,
          codesFoundMax,
          limit = 20,
          skip = 0,
          sortBy = 'processedAt',
          sortOrder = 'desc'
        } = req.query;

        const options = {
          recommendedAction: recommendedAction as 'investigate' | 'monitor' | 'ignore' | undefined,
          hasMoneyThumbnail: hasMoneyThumbnail === 'true' ? true : 
            hasMoneyThumbnail === 'false' ? false : undefined,
          codesFound: (codesFoundMin || codesFoundMax) ? {
            min: codesFoundMin ? parseInt(codesFoundMin as string) : undefined,
            max: codesFoundMax ? parseInt(codesFoundMax as string) : undefined
          } : undefined,
          limit: parseInt(limit as string),
          skip: parseInt(skip as string),
          sortBy: sortBy as string,
          sortOrder: sortOrder as 'asc' | 'desc'
        };

        const results = await this.database.getResults(options);

        const response: APIResponse = {
          success: true,
          data: results,
          timestamp: new Date().toISOString()
        };

        res.json(response);

      } catch (error) {
        apiLogger.error('Error getting analysis results', error as Error);
        const response: APIResponse = {
          success: false,
          data: null,
          error: 'Failed to get analysis results',
          timestamp: new Date().toISOString()
        };
        res.status(500).json(response);
      }
    });

    // Get specific analysis result
    this.app.get('/api/results/:videoId', async (req, res) => {
      try {
        const { videoId } = req.params;
        const result = await this.database.getResult(videoId);

        if (!result) {
          const response: APIResponse = {
            success: false,
            data: null,
            error: 'Analysis result not found',
            timestamp: new Date().toISOString()
          };
          return res.status(404).json(response);
        }

        const response: APIResponse = {
          success: true,
          data: result,
          timestamp: new Date().toISOString()
        };

        return res.json(response);

      } catch (error) {
        apiLogger.error('Error getting analysis result', error as Error, {
          videoId: req.params.videoId
        });
        const response: APIResponse = {
          success: false,
          data: null,
          error: 'Failed to get analysis result',
          timestamp: new Date().toISOString()
        };
        return res.status(500).json(response);
      }
    });

    // Manually trigger video processing
    this.app.post('/api/process/:videoId', async (req, res) => {
      try {
        const { videoId } = req.params;
        
        await this.youtubeMonitor.processVideoManually(videoId);

        const response: APIResponse = {
          success: true,
          data: {
            message: 'Video processing triggered',
            videoId
          },
          timestamp: new Date().toISOString()
        };

        res.json(response);

      } catch (error) {
        apiLogger.error('Error triggering video processing', error as Error, {
          videoId: req.params.videoId
        });
        const response: APIResponse = {
          success: false,
          data: null,
          error: 'Failed to trigger video processing',
          timestamp: new Date().toISOString()
        };
        res.status(500).json(response);
      }
    });

    // Simplified video processing (bypasses Redis)
    this.app.post('/api/analyze/:videoId', async (req, res) => {
      try {
        const { videoId } = req.params;
        
        // Get video metadata
        const video = await this.youtubeMonitor.getVideoMetadata(videoId);
        if (!video) {
          const response: APIResponse = {
            success: false,
            data: null,
            error: 'Video not found',
            timestamp: new Date().toISOString()
          };
          return res.status(404).json(response);
        }

        // Process with simplified processor
        const result = await this.simpleProcessor.processVideo(video);

        const response: APIResponse = {
          success: true,
          data: result,
          timestamp: new Date().toISOString()
        };

        return res.json(response);

      } catch (error) {
        apiLogger.error('Error in simplified video analysis', error as Error, {
          videoId: req.params.videoId
        });
        const response: APIResponse = {
          success: false,
          data: null,
          error: 'Failed to analyze video',
          timestamp: new Date().toISOString()
        };
        return res.status(500).json(response);
      }
    });

    // Get processing jobs
    this.app.get('/api/jobs', async (req, res) => {
      try {
        const {
          status,
          videoId,
          type,
          priority,
          limit = 20,
          skip = 0
        } = req.query;

        const options = {
          status: status as 'pending' | 'processing' | 'completed' | 'failed' | undefined,
          videoId: videoId as string,
          type: type as 'thumbnail' | 'video' | 'transcript' | 'audio' | 'full' | undefined,
          priority: priority as 'low' | 'medium' | 'high' | 'urgent' | undefined,
          limit: parseInt(limit as string),
          skip: parseInt(skip as string)
        };

        const jobs = await this.database.getJobs(options);

        const response: APIResponse = {
          success: true,
          data: jobs,
          timestamp: new Date().toISOString()
        };

        res.json(response);

      } catch (error) {
        apiLogger.error('Error getting processing jobs', error as Error);
        const response: APIResponse = {
          success: false,
          data: null,
          error: 'Failed to get processing jobs',
          timestamp: new Date().toISOString()
        };
        res.status(500).json(response);
      }
    });

    // Get statistics
    this.app.get('/api/statistics', async (_req, res) => {
      try {
        const stats = await this.database.getStatistics();

        const response: APIResponse = {
          success: true,
          data: stats,
          timestamp: new Date().toISOString()
        };

        res.json(response);

      } catch (error) {
        apiLogger.error('Error getting statistics', error as Error);
        const response: APIResponse = {
          success: false,
          data: null,
          error: 'Failed to get statistics',
          timestamp: new Date().toISOString()
        };
        res.status(500).json(response);
      }
    });

    // Cleanup old data
    this.app.post('/api/cleanup', async (req, res) => {
      try {
        const { olderThanDays = 30, keepInvestigateResults = true } = req.body;

        const result = await this.database.cleanup({
          olderThanDays,
          keepInvestigateResults
        });

        const response: APIResponse = {
          success: true,
          data: result,
          timestamp: new Date().toISOString()
        };

        res.json(response);

      } catch (error) {
        apiLogger.error('Error during cleanup', error as Error);
        const response: APIResponse = {
          success: false,
          data: null,
          error: 'Failed to cleanup old data',
          timestamp: new Date().toISOString()
        };
        res.status(500).json(response);
      }
    });

    // 404 handler
    this.app.use('*', (_req, res) => {
      const response: APIResponse = {
        success: false,
        data: null,
        error: 'Endpoint not found',
        timestamp: new Date().toISOString()
      };
      res.status(404).json(response);
    });

    apiLogger.info('API routes configured');
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    this.app.use((error: Error, req: express.Request, res: express.Response) => {
      apiLogger.error('Unhandled API error', error, {
        method: req.method,
        url: req.url,
        body: req.body
      });

      const response: APIResponse = {
        success: false,
        data: null,
        error: config.server.nodeEnv === 'production' ? 'Internal server error' : error.message,
        timestamp: new Date().toISOString()
      };

      res.status(500).json(response);
    });

    apiLogger.info('Error handling configured');
  }

  /**
   * Start all services
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting YT Scanner application...', {
        nodeEnv: config.server.nodeEnv,
        port: config.server.port
      });

      // Start video processor
      await this.videoProcessor.startProcessing();
      logger.info('Video processor started');

      // Start YouTube monitor
      await this.youtubeMonitor.startMonitoring();
      logger.info('YouTube monitor started');

      // Start API server
      this.app.listen(config.server.port, () => {
        logger.info('API server started', {
          port: config.server.port,
          env: config.server.nodeEnv
        });
      });

      logger.info('YT Scanner application started successfully');

    } catch (error) {
      logger.error('Failed to start application', error as Error);
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      logger.info('Shutting down YT Scanner application...');

      // Stop YouTube monitor
      await this.youtubeMonitor.stopMonitoring();
      logger.info('YouTube monitor stopped');

      // Stop video processor
      await this.videoProcessor.stopProcessing();
      logger.info('Video processor stopped');

      // Disconnect from database
      await this.database.disconnect();
      logger.info('Database disconnected');

      logger.info('YT Scanner application shut down successfully');
      logger.info('Laxmi has made some changes');
      process.exit(0);

    } catch (error) {
      logger.error('Error during shutdown', error as Error);
      process.exit(1);
    }
  }
}

// Create and start application
const app = new YTScannerApp();

// Handle graceful shutdown
process.on('SIGTERM', () => app.shutdown());
process.on('SIGINT', () => app.shutdown());

// Start the application
app.start().catch((error) => {
  logger.error('Failed to start application', error);
  process.exit(1);
}); 
