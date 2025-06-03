import { config } from '@/config';
import { SUSPICIOUS_KEYWORDS, TranscriptSegment } from '@/types';
import { transcriptLogger } from '@/utils/logger';
import { google, youtube_v3 } from 'googleapis';

export class TranscriptAnalyzer {
  private youtube: youtube_v3.Youtube;

  constructor() {
    this.youtube = google.youtube({
      version: 'v3',
      auth: config.youtube.apiKey,
    });

    transcriptLogger.info('Transcript Analyzer initialized');
  }

  /**
   * Analyze video transcript for suspicious keywords and patterns
   */
  async analyzeTranscript(videoId: string): Promise<{
    segments: TranscriptSegment[];
    keywords: string[];
    suspiciousSegments: TranscriptSegment[];
  }> {
    try {
      transcriptLogger.videoInfo(videoId, 'Starting transcript analysis');

      // Get captions/subtitles
      const transcript = await this.getVideoTranscript(videoId);
      
      if (!transcript || transcript.length === 0) {
        transcriptLogger.videoInfo(videoId, 'No transcript available');
        return {
          segments: [],
          keywords: [],
          suspiciousSegments: []
        };
      }

      // Parse transcript into segments
      const segments = this.parseTranscript(transcript, videoId);

      // Find suspicious segments
      const suspiciousSegments = this.findSuspiciousSegments(segments, videoId);

      // Extract all found keywords
      const keywords = this.extractKeywords(segments);

      transcriptLogger.videoInfo(videoId, 'Transcript analysis completed', {
        totalSegments: segments.length,
        suspiciousSegments: suspiciousSegments.length,
        keywordsFound: keywords.length
      });

      return {
        segments,
        keywords,
        suspiciousSegments
      };

    } catch (error) {
      transcriptLogger.videoError(videoId, 'Error analyzing transcript', error as Error);
      return {
        segments: [],
        keywords: [],
        suspiciousSegments: []
      };
    }
  }

  /**
   * Get video transcript from YouTube API
   */
  private async getVideoTranscript(videoId: string): Promise<string | null> {
    try {
      // First, get available captions
      const captionsResponse = await this.youtube.captions.list({
        part: ['snippet'],
        videoId,
      });

      const captions = captionsResponse.data.items || [];
      
      if (captions.length === 0) {
        transcriptLogger.debug('No captions available', { videoId });
        return null;
      }

      // Prefer English captions
      let targetCaption = captions.find(c => 
        c.snippet?.language === 'en' || 
        c.snippet?.language === 'en-US' ||
        c.snippet?.language === 'en-GB'
      );

      // Fall back to first available caption
      if (!targetCaption) {
        targetCaption = captions[0];
      }

      if (!targetCaption || !targetCaption.id) {
        transcriptLogger.debug('No suitable captions found', { videoId });
        return null;
      }

      // Download caption content
      const captionResponse = await this.youtube.captions.download({
        id: targetCaption.id,
        tfmt: 'srv3', // SubRip format with timing
      });

      transcriptLogger.debug('Caption downloaded successfully', {
        videoId,
        captionId: targetCaption.id,
        language: targetCaption.snippet?.language
      });

      return captionResponse.data as string;

    } catch (error) {
      transcriptLogger.videoError(videoId, 'Error fetching transcript', error as Error);
      return null;
    }
  }

  /**
   * Parse raw transcript into timed segments
   */
  private parseTranscript(transcript: string, videoId: string): TranscriptSegment[] {
    try {
      // Handle different transcript formats
      if (this.isSRTFormat(transcript)) {
        return this.parseSRTTranscript(transcript, videoId);
      } else if (this.isVTTFormat(transcript)) {
        return this.parseVTTTranscript(transcript, videoId);
      } else {
        // Plain text format - create single segment
        return [{
          text: transcript,
          startTime: 0,
          endTime: 0,
          confidence: 0.5,
          keywords: this.findKeywordsInText(transcript)
        }];
      }

    } catch (error) {
      transcriptLogger.videoError(videoId, 'Error parsing transcript', error as Error);
      return [];
    }
  }

  /**
   * Parse SRT format transcript
   */
  private parseSRTTranscript(transcript: string, videoId: string): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];
    const blocks = transcript.split('\n\n').filter(block => block.trim());

    for (const block of blocks) {
      const lines = block.split('\n');
      if (lines.length < 3) continue;

      // Parse timing line (format: 00:00:01,000 --> 00:00:03,000)
      const timingLine = lines[1];
      const timingMatch = timingLine.match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
      
      if (!timingMatch) continue;

      const startTime = this.parseTimeString(timingMatch[1]);
      const endTime = this.parseTimeString(timingMatch[2]);
      
      // Extract text (remaining lines)
      const text = lines.slice(2).join(' ').trim();
      
      if (text) {
        const segment: TranscriptSegment = {
          text,
          startTime,
          endTime,
          confidence: 0.8, // Default confidence for manual captions
          keywords: this.findKeywordsInText(text)
        };

        segments.push(segment);
      }
    }

    transcriptLogger.debug('SRT transcript parsed', {
      videoId,
      segmentsFound: segments.length
    });

    return segments;
  }

  /**
   * Parse VTT format transcript
   */
  private parseVTTTranscript(transcript: string, videoId: string): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];
    const lines = transcript.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Look for timing lines (format: 00:00:01.000 --> 00:00:03.000)
      const timingMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/);
      
      if (timingMatch && i + 1 < lines.length) {
        const startTime = this.parseTimeString(timingMatch[1].replace('.', ','));
        const endTime = this.parseTimeString(timingMatch[2].replace('.', ','));
        
        // Get text from next line(s)
        let text = '';
        let j = i + 1;
        while (j < lines.length && lines[j].trim() && !lines[j].includes('-->')) {
          text += lines[j].trim() + ' ';
          j++;
        }
        
        text = text.trim();
        
        if (text) {
          const segment: TranscriptSegment = {
            text,
            startTime,
            endTime,
            confidence: 0.8,
            keywords: this.findKeywordsInText(text)
          };

          segments.push(segment);
        }
        
        i = j - 1; // Skip processed lines
      }
    }

    transcriptLogger.debug('VTT transcript parsed', {
      videoId,
      segmentsFound: segments.length
    });

    return segments;
  }

  /**
   * Find suspicious segments containing target keywords
   */
  private findSuspiciousSegments(segments: TranscriptSegment[], videoId: string): TranscriptSegment[] {
    const suspiciousSegments: TranscriptSegment[] = [];

    for (const segment of segments) {
      if (segment.keywords.length > 0) {
        // Check for high-value combinations
        const hasGiftKeyword = segment.keywords.some(k => 
          ['gift', 'amazon gift', 'coupon'].includes(k)
        );
        const hasMoneyKeyword = segment.keywords.some(k => 
          ['cash', 'dollars', 'money', 'free money'].includes(k)
        );
        const hasActionKeyword = segment.keywords.some(k => 
          ['redeem', 'claim', 'winner', 'congratulations'].includes(k)
        );

        // Mark as suspicious if multiple categories are present
        if ((hasGiftKeyword && hasMoneyKeyword) || 
            (hasGiftKeyword && hasActionKeyword) ||
            segment.keywords.length >= 3) {
          
          suspiciousSegments.push(segment);
          
          transcriptLogger.detection('suspicious-transcript', 0.8, {
            videoId,
            startTime: segment.startTime,
            endTime: segment.endTime,
            text: segment.text,
            keywords: segment.keywords
          });
        }
      }
    }

    return suspiciousSegments;
  }

  /**
   * Extract all keywords from segments
   */
  private extractKeywords(segments: TranscriptSegment[]): string[] {
    const allKeywords = new Set<string>();
    
    for (const segment of segments) {
      for (const keyword of segment.keywords) {
        allKeywords.add(keyword);
      }
    }
    
    return Array.from(allKeywords);
  }

  /**
   * Find keywords in text
   */
  private findKeywordsInText(text: string): string[] {
    const foundKeywords: string[] = [];
    const lowerText = text.toLowerCase();

    for (const keyword of SUSPICIOUS_KEYWORDS) {
      if (lowerText.includes(keyword)) {
        foundKeywords.push(keyword);
      }
    }

    // Look for monetary amounts mentioned in text
    const moneyPatterns = [
      /\$?\d{3,4}\s*dollars?/gi,
      /\$\d{3,4}/g,
      /\d{3,4}\s*bucks?/gi
    ];

    for (const pattern of moneyPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        foundKeywords.push(...matches.map(m => m.toLowerCase()));
      }
    }

    return foundKeywords;
  }

  /**
   * Parse time string to seconds
   */
  private parseTimeString(timeStr: string): number {
    // Handle formats: HH:MM:SS,mmm or HH:MM:SS.mmm
    const parts = timeStr.replace(',', '.').split(':');
    if (parts.length !== 3) return 0;

    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const secondsParts = parts[2].split('.');
    const seconds = parseInt(secondsParts[0], 10);
    const milliseconds = secondsParts[1] ? parseInt(secondsParts[1], 10) : 0;

    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  }

  /**
   * Check if transcript is in SRT format
   */
  private isSRTFormat(transcript: string): boolean {
    return transcript.includes('-->') && /\d{2}:\d{2}:\d{2},\d{3}/.test(transcript);
  }

  /**
   * Check if transcript is in VTT format
   */
  private isVTTFormat(transcript: string): boolean {
    return transcript.includes('WEBVTT') || 
           (transcript.includes('-->') && /\d{2}:\d{2}:\d{2}\.\d{3}/.test(transcript));
  }
} 