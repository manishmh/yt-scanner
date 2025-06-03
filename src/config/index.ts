import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  server: z.object({
    port: z.number().default(3000),
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  }),
  
  googleCloud: z.object({
    projectId: z.string().optional(), // Optional since we're mainly using AWS
    region: z.string().default('us-central1'),
    credentialsPath: z.string().optional(),
  }),



  pubsub: z.object({
    topicNewVideo: z.string().default('youtube-new-video'),
    subscriptionVideoProcessor: z.string().default('video-processor-sub'),
  }),



  youtube: z.object({
    apiKey: z.string().min(1, 'YouTube API key is required'),
    channelId: z.string().min(1, 'YouTube channel ID is required'),
  }),

  database: z.object({
    redisUrl: z.string().default('redis://localhost:6379'),
  }),

  cloudflare: z.object({
    apiToken: z.string().min(1, 'Cloudflare API Token is required'),
    accountId: z.string().min(1, 'Cloudflare Account ID is required'),
    databaseId: z.string().min(1, 'Cloudflare D1 Database ID is required'),
  }),

  videoProcessing: z.object({
    maxDurationMinutes: z.number().default(120),
    frameSamplingIntervalSeconds: z.number().default(0.5),
    ocrConfidenceThreshold: z.number().min(0).max(1).default(0.8),
  }),

  monetaryDetection: z.object({
    minDollarAmount: z.number().default(500),
    maxDollarAmount: z.number().default(1000),
    dollarAmountStep: z.number().default(50),
  }),

  audioAnalysis: z.object({
    laughterDetectionSensitivity: z.number().min(0).max(1).default(0.7),
    audioSegmentDurationSeconds: z.number().default(30),
  }),

  rateLimiting: z.object({
    youtubeApiRequestsPerMinute: z.number().default(100),
    visionApiRequestsPerMinute: z.number().default(1000),
  }),

  logging: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    file: z.string().default('logs/yt-scanner.log'),
  }),

  webhook: z.object({
    url: z.string().url().optional(),
    secret: z.string().optional(),
  }),
});

function loadConfig() {
  const rawConfig = {
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      nodeEnv: process.env.NODE_ENV as 'development' | 'production' | 'test',
    },
    googleCloud: {
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      region: process.env.GOOGLE_CLOUD_REGION || 'us-central1',
      credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    },

    pubsub: {
      topicNewVideo: process.env.PUBSUB_TOPIC_NEW_VIDEO || 'youtube-new-video',
      subscriptionVideoProcessor: process.env.PUBSUB_SUBSCRIPTION_VIDEO_PROCESSOR || 'video-processor-sub',
    },

    youtube: {
      apiKey: process.env.YOUTUBE_API_KEY || '',
      channelId: process.env.YOUTUBE_CHANNEL_ID || '',
    },
    database: {
      redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    cloudflare: {
      apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
      databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID || '',
    },
    videoProcessing: {
      maxDurationMinutes: parseInt(process.env.MAX_VIDEO_DURATION_MINUTES || '120', 10),
      frameSamplingIntervalSeconds: parseFloat(process.env.FRAME_SAMPLING_INTERVAL_SECONDS || '0.5'),
      ocrConfidenceThreshold: parseFloat(process.env.OCR_CONFIDENCE_THRESHOLD || '0.8'),
    },
    monetaryDetection: {
      minDollarAmount: parseInt(process.env.MIN_DOLLAR_AMOUNT || '500', 10),
      maxDollarAmount: parseInt(process.env.MAX_DOLLAR_AMOUNT || '1000', 10),
      dollarAmountStep: parseInt(process.env.DOLLAR_AMOUNT_STEP || '50', 10),
    },
    audioAnalysis: {
      laughterDetectionSensitivity: parseFloat(process.env.LAUGHTER_DETECTION_SENSITIVITY || '0.7'),
      audioSegmentDurationSeconds: parseInt(process.env.AUDIO_SEGMENT_DURATION_SECONDS || '30', 10),
    },
    rateLimiting: {
      youtubeApiRequestsPerMinute: parseInt(process.env.YOUTUBE_API_REQUESTS_PER_MINUTE || '100', 10),
      visionApiRequestsPerMinute: parseInt(process.env.VISION_API_REQUESTS_PER_MINUTE || '1000', 10),
    },
    logging: {
      level: process.env.LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug' || 'info',
      file: process.env.LOG_FILE || 'logs/yt-scanner.log',
    },
    webhook: {
      url: process.env.WEBHOOK_URL,
      secret: process.env.WEBHOOK_SECRET,
    },
  };

  try {
    return configSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Configuration validation failed:');
      error.errors.forEach((err) => {
        console.error(`- ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

export const config = loadConfig();
export type Config = z.infer<typeof configSchema>;

// Generate supported monetary amounts based on configuration
export function getSupportedAmounts(): number[] {
  const amounts: number[] = [];
  const { minDollarAmount, maxDollarAmount, dollarAmountStep } = config.monetaryDetection;
  
  for (let amount = minDollarAmount; amount <= maxDollarAmount; amount += dollarAmountStep) {
    amounts.push(amount);
  }
  
  return amounts;
}

// Validate if an amount is supported
export function isSupportedAmount(amount: number): boolean {
  const supportedAmounts = getSupportedAmounts();
  return supportedAmounts.includes(amount);
} 