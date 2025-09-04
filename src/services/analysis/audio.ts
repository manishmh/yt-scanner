import { config } from '@/config';
import { AudioFeatures, AudioSegment, LaughterDetection } from '@/types';
import { audioLogger } from '@/utils/logger';
import { SpeechClient } from '@google-cloud/speech';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';

export class AudioAnalyzer {
  private speechClient: SpeechClient;

  constructor() {
    this.speechClient = new SpeechClient({
      projectId: config.googleCloud.projectId,
    });

    audioLogger.info('Audio Analyzer initialized', {
      segmentDuration: config.audioAnalysis.audioSegmentDurationSeconds,
      laughterSensitivity: config.audioAnalysis.laughterDetectionSensitivity
    });
  }

  /**
   * Analyze video audio for laughter peaks and suspicious segments
   */
  async analyzeAudio(videoUrl: string, videoId: string): Promise<{
    laughterPeaks: LaughterDetection[];
    suspiciousAudioSegments: AudioSegment[];
  }> {
    try {
      audioLogger.videoInfo(videoId, 'Starting audio analysis');

      // Extract audio from video
      const audioPath = await this.extractAudio(videoUrl, videoId);

      // Analyze audio for laughter and suspicious content
      const [laughterPeaks, suspiciousSegments] = await Promise.all([
        this.detectLaughterPeaks(audioPath, videoId),
        this.analyzeSuspiciousSegments(audioPath, videoId)
      ]);

      // Cleanup
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }

      audioLogger.videoInfo(videoId, 'Audio analysis completed', {
        laughterPeaks: laughterPeaks.length,
        suspiciousSegments: suspiciousSegments.length
      });

      return {
        laughterPeaks,
        suspiciousAudioSegments: suspiciousSegments
      };

    } catch (error) {
      audioLogger.videoError(videoId, 'Error analyzing audio', error as Error);
      return {
        laughterPeaks: [],
        suspiciousAudioSegments: []
      };
    }
  }

  /**
   * Extract audio from video URL
   */
  private async extractAudio(videoUrl: string, videoId: string): Promise<string> {
    const tempDir = path.join(process.cwd(), 'temp', 'audio');
    const audioPath = path.join(tempDir, `${videoId}.wav`);

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      audioLogger.debug('Extracting audio from video', { videoId, videoUrl });

      ffmpeg(videoUrl)
        .output(audioPath)
        .audioCodec('pcm_s16le')
        .audioChannels(1)
        .audioFrequency(16000)
        .duration(config.videoProcessing.maxDurationMinutes * 60) // Limit duration
        .on('end', () => {
          audioLogger.debug('Audio extraction completed', { videoId, audioPath });
          resolve(audioPath);
        })
        .on('error', (error) => {
          audioLogger.videoError(videoId, 'Error extracting audio', error);
          reject(error);
        })
        .run();
    });
  }

  /**
   * Detect laughter peaks in audio
   */
  private async detectLaughterPeaks(audioPath: string, videoId: string): Promise<LaughterDetection[]> {
    try {
      audioLogger.debug('Detecting laughter peaks', { videoId });

      // Split audio into segments for analysis
      const segments = await this.splitAudioIntoSegments(audioPath, videoId);
      const laughterPeaks: LaughterDetection[] = [];

      for (const segment of segments) {
        try {
          // Transcribe segment
          const transcription = await this.transcribeAudioSegment(segment.path);
          
          // Look for laughter indicators
          if (this.containsLaughter(transcription)) {
            const laughterEvent: LaughterDetection = {
              startTime: segment.startTime,
              endTime: segment.endTime,
              confidence: this.calculateLaughterConfidence(transcription),
              intensity: this.calculateLaughterIntensity(transcription),
              type: this.classifyLaughterType(transcription)
            };

            laughterPeaks.push(laughterEvent);

            audioLogger.detection('laughter-peak', laughterEvent.confidence, {
              videoId,
              startTime: segment.startTime,
              endTime: segment.endTime,
              intensity: laughterEvent.intensity,
              type: laughterEvent.type
            });
          }

          // Cleanup segment file
          if (fs.existsSync(segment.path)) {
            fs.unlinkSync(segment.path);
          }

        } catch (error) {
          audioLogger.debug('Error processing audio segment', { 
            videoId, 
            segmentStart: segment.startTime,
            error 
          });
        }
      }

      audioLogger.debug('Laughter detection completed', {
        videoId,
        segmentsAnalyzed: segments.length,
        laughterPeaksFound: laughterPeaks.length
      });

      return laughterPeaks;

    } catch (error) {
      audioLogger.videoError(videoId, 'Error detecting laughter peaks', error as Error);
      return [];
    }
  }

  /**
   * Analyze suspicious audio segments
   */
  private async analyzeSuspiciousSegments(audioPath: string, videoId: string): Promise<AudioSegment[]> {
    try {
      audioLogger.debug('Analyzing suspicious audio segments', { videoId });

      const suspiciousSegments: AudioSegment[] = [];
      const segments = await this.splitAudioIntoSegments(audioPath, videoId);

      for (const segment of segments) {
        try {
          const transcription = await this.transcribeAudioSegment(segment.path);
          
          if (this.isSuspiciousContent(transcription)) {
            const audioSegment: AudioSegment = {
              startTime: segment.startTime,
              endTime: segment.endTime,
              transcription,
              confidence: 0.8,
              audioFeatures: await this.extractAudioFeatures(segment.path)
            };

            suspiciousSegments.push(audioSegment);

            audioLogger.detection('suspicious-audio', 0.8, {
              videoId,
              startTime: segment.startTime,
              endTime: segment.endTime,
              transcription: transcription.substring(0, 100) // Truncate for logging
            });
          }

          // Cleanup segment file
          if (fs.existsSync(segment.path)) {
            fs.unlinkSync(segment.path);
          }

        } catch (error) {
          audioLogger.debug('Error analyzing audio segment', { 
            videoId, 
            segmentStart: segment.startTime,
            error 
          });
        }
      }

      return suspiciousSegments;

    } catch (error) {
      audioLogger.videoError(videoId, 'Error analyzing suspicious segments', error as Error);
      return [];
    }
  }

  /**
   * Split audio into segments for analysis
   */
  private async splitAudioIntoSegments(audioPath: string, videoId: string): Promise<{
    path: string;
    startTime: number;
    endTime: number;
  }[]> {
    const segments: { path: string; startTime: number; endTime: number; }[] = [];
    const segmentDuration = config.audioAnalysis.audioSegmentDurationSeconds;
    
    // Get audio duration
    const duration = await this.getAudioDuration(audioPath);
    const numSegments = Math.ceil(duration / segmentDuration);

    const tempDir = path.join(process.cwd(), 'temp', 'audio_segments', videoId);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const promises: Promise<void>[] = [];

    for (let i = 0; i < numSegments; i++) {
      const startTime = i * segmentDuration;
      const endTime = Math.min((i + 1) * segmentDuration, duration);
      const segmentPath = path.join(tempDir, `segment_${i}.wav`);

      const promise = new Promise<void>((resolve, reject) => {
        ffmpeg(audioPath)
          .output(segmentPath)
          .audioCodec('pcm_s16le')
          .audioChannels(1)
          .audioFrequency(16000)
          .seekInput(startTime)
          .duration(endTime - startTime)
          .on('end', () => {
            segments.push({ path: segmentPath, startTime, endTime });
            resolve();
          })
          .on('error', reject)
          .run();
      });

      promises.push(promise);
    }

    await Promise.all(promises);

    audioLogger.debug('Audio split into segments', {
      videoId,
      totalDuration: duration,
      segmentCount: segments.length
    });

    return segments;
  }

  /**
   * Transcribe audio segment using Google Speech-to-Text
   */
  private async transcribeAudioSegment(audioPath: string): Promise<string> {
    try {
      const audioBuffer = fs.readFileSync(audioPath);

      const [response] = await this.speechClient.recognize({
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode: 'en-US',
          enableWordTimeOffsets: true,
          enableAutomaticPunctuation: true,
          model: 'latest_long'
        },
        audio: {
          content: audioBuffer.toString('base64'),
        },
      });

      const transcription = response.results
        ?.map(result => result.alternatives?.[0]?.transcript)
        .filter(Boolean)
        .join(' ') || '';

      return transcription;

    } catch (error) {
      audioLogger.debug('Error transcribing audio segment', { audioPath, error });
      return '';
    }
  }

  /**
   * Check if transcription contains laughter
   */
  private containsLaughter(transcription: string): boolean {
    const laughterIndicators = [
      'haha', 'hehe', 'hah', 'laugh', 'laughing', 'lol', 
      'chuckle', 'giggle', 'chuckling', 'giggling'
    ];

    const lowerTranscription = transcription.toLowerCase();
    return laughterIndicators.some(indicator => lowerTranscription.includes(indicator));
  }

  /**
   * Check if content is suspicious
   */
  private isSuspiciousContent(transcription: string): boolean {
    const suspiciousKeywords = [
      'gift card', 'amazon gift', 'coupon', 'redeem', 'claim',
      'winner', 'congratulations', 'free money', 'cash', 'dollars'
    ];

    const lowerTranscription = transcription.toLowerCase();
    return suspiciousKeywords.some(keyword => lowerTranscription.includes(keyword));
  }

  /**
   * Calculate laughter confidence
   */
  private calculateLaughterConfidence(transcription: string): number {
    const laughterWords = transcription.toLowerCase().match(/\b(haha|hehe|laugh|lol|chuckle|giggle)\b/g) || [];
    const totalWords = transcription.split(/\s+/).length;
    
    // Base confidence plus bonus for multiple laughter words
    let confidence = 0.6 + (laughterWords.length / totalWords) * 0.4;
    
    // Boost confidence for explicit laughter words
    if (laughterWords.length > 2) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  /**
   * Calculate laughter intensity
   */
  private calculateLaughterIntensity(transcription: string): number {
    const laughCount = (transcription.toLowerCase().match(/ha|he|lol/g) || []).length;
    const repeatedLaugh = (transcription.toLowerCase().match(/haha+|hehe+/g) || []).length;
    
    // Intensity based on repetition and frequency
    let intensity = Math.min(laughCount / 10, 0.7);
    if (repeatedLaugh > 0) intensity += 0.3;
    
    return Math.min(intensity, 1.0);
  }

  /**
   * Classify laughter type
   */
  private classifyLaughterType(transcription: string): LaughterDetection['type'] {
    // This is a simplified classifier - in practice, you might use ML models
    // trained on KSI's specific laughter patterns
    
    const hasLongLaugh = /haha{3,}|hehe{3,}/i.test(transcription);
    const hasMultipleLaughs = (transcription.toLowerCase().match(/\b(haha|hehe|laugh)\b/g) || []).length > 2;
    
    // Simple heuristic - classify as KSI's laugh if it's intense/long
    if (hasLongLaugh || hasMultipleLaughs) {
      return 'ksi_laugh';
    }
    
    return 'general_laughter';
  }

  /**
   * Extract audio features (simplified version) laxmi did not bring chocolates for me. Because he doesnt listen to me HUH. she does the same. :(( who do u think you are ?
   */
  private async extractAudioFeatures(_audioPath: string): Promise<AudioFeatures> {
    // This is a placeholder - in practice, you'd use audio analysis libraries
    // to extract features like pitch, volume, speaking rate, etc.
    
    return {
      pitch: 0.5, // Placeholder values
      volume: 0.7,
      speakingRate: 1.2,
      emotionalTone: 'neutral'
    };
  }

  /**
   * Get audio duration
   */
  private async getAudioDuration(audioPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }
        
        const duration = metadata.format.duration || 0;
        resolve(duration);
      });
    });
  }
} 
