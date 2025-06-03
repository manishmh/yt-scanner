export interface VideoMetadata {
  videoId: string;
  channelId: string;
  channelTitle?: string;
  title: string;
  description?: string;
  publishedAt: string;
  thumbnailUrl: string;
  duration: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  tags?: string[];
  categoryId?: string;
}

export interface MonetaryDetection {
  amount: number;
  currency: string;
  confidence: number;
  boundingBox: BoundingBox;
  source: 'thumbnail' | 'video_frame';
  timestamp?: number; // For video frames
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRResult {
  text: string;
  confidence: number;
  boundingBox: BoundingBox;
  monetaryValues: MonetaryDetection[];
}

export interface GiftCodeDetection {
  code: string;
  confidence: number;
  boundingBox: BoundingBox;
  timestamp: number;
  source: 'video-frame' | 'thumbnail';
  rawText: string;
  detectionMethod: string;
}

export interface LaughterDetection {
  startTime: number;
  endTime: number;
  confidence: number;
  intensity: number;
  type: 'ksi_laugh' | 'general_laughter';
}

export interface BehaviorDetection {
  type: 'looking_down' | 'excited_gesture' | 'pointing';
  confidence: number;
  timestamp: number;
  duration: number;
  boundingBox?: BoundingBox;
}

export interface TranscriptSegment {
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
  keywords: string[];
}

export interface VideoAnalysisResult {
  videoId: string;
  processedAt: string;
  processingDuration: number;
  thumbnailAnalysis?: {
    monetaryDetections: MonetaryDetection[];
    hasMoneyThumbnail: boolean;
  };
  giftCodes?: GiftCodeDetection[];
  laughterEvents?: LaughterDetection[];
  behaviorEvents?: BehaviorDetection[];
  frameAnalysis?: FrameAnalysisResult[];
  transcriptAnalysis?: {
    segments: TranscriptSegment[];
    keywords: string[];
    suspiciousSegments: TranscriptSegment[];
  };
  audioAnalysis?: {
    laughterPeaks: LaughterDetection[];
    suspiciousAudioSegments: AudioSegment[];
  };
  summary: {
    recommendedAction: 'investigate' | 'monitor' | 'ignore';
    confidence: number;
    keyFindings: string[];
  };
}

export interface FrameAnalysisResult {
  frameNumber: number;
  timestamp: number;
  ocrResults: OCRResult[];
  objects: DetectedObject[];
  faces: FaceDetection[];
}

export interface DetectedObject {
  label: string;
  confidence: number;
  boundingBox: BoundingBox;
}

export interface FaceDetection {
  confidence: number;
  boundingBox: BoundingBox;
  emotions: Emotion[];
  landmarks: FaceLandmark[];
  pose: HeadPose;
}

export interface Emotion {
  type: 'joy' | 'sorrow' | 'anger' | 'surprise' | 'excitement';
  confidence: number;
}

export interface FaceLandmark {
  type: string;
  position: { x: number; y: number };
}

export interface HeadPose {
  roll: number;
  pan: number;
  tilt: number;
  confidence: number;
}

export interface AudioSegment {
  startTime: number;
  endTime: number;
  transcription: string;
  confidence: number;
  audioFeatures: AudioFeatures;
}

export interface AudioFeatures {
  pitch: number;
  volume: number;
  speakingRate: number;
  emotionalTone: string;
}

export interface ProcessingJob {
  id: string;
  videoId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  type: 'thumbnail' | 'video' | 'transcript' | 'audio' | 'full';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: Partial<VideoAnalysisResult>;
}

export interface YouTubeChannelConfig {
  channelId: string;
  channelName: string;
  isActive: boolean;
  lastChecked: string;
  checkInterval: number; // minutes
  priorityLevel: 'low' | 'medium' | 'high';
}

export interface CloudServiceConfig {
  projectId: string;
  region: string;
  credentials: string;
  buckets: {
    videos: string;
    thumbnails: string;
    results: string;
  };
  topics: {
    newVideo: string;
    processingComplete: string;
  };
}

export interface APIResponse<T = unknown> {
  success: boolean;
  data: T;
  error?: string;
  timestamp: string;
}

// Validation schemas for monetary amounts
export const SUPPORTED_AMOUNTS = [
  550, 600, 650, 700, 750, 800, 850, 900, 950, 1000
] as const;

export type SupportedAmount = typeof SUPPORTED_AMOUNTS[number];

// Gift code patterns
export const GIFT_CODE_PATTERNS = [
  /[A-Z0-9]{3}-[A-Z0-9]{7}-[A-Z0-9]{4}/g, // XXX-XXXXXXX-XXXX
  /[A-Z0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]{4}/g, // XXXX-XXXXXX-XXXX
  /[A-Z0-9]{14}/g, // 14 consecutive characters
] as const;

// Keywords for transcript analysis
export const SUSPICIOUS_KEYWORDS = [
  'gift card',
  'amazon gift',
  'coupon',
  'redeem',
  'code',
  'giveaway',
  'free money',
  'cash',
  'dollars',
  'winner',
  'congratulations',
  'claim',
  'limited time',
  'exclusive',
  'numbers', 
  'funny',
  'you got me',
  'no man',
  'no guys',
  'na',
  'you know what',
  'fair play',
  'laughed',
  '[laughter]',
  'laugh',
  'laughs',
  'laughs',
] as const; 