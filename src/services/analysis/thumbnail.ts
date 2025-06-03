import { config, getSupportedAmounts, isSupportedAmount } from '@/config';
import { MonetaryDetection, OCRResult } from '@/types';
import { thumbnailLogger } from '@/utils/logger';
import axios from 'axios';
import sharp from 'sharp';
import { MockOCRService } from './mock-ocr';
import { OCRService } from './ocr';

export class ThumbnailAnalyzer {
  private ocrService: OCRService;
  private mockOCR: MockOCRService;
  private supportedAmounts: number[];

  constructor() {
    this.ocrService = new OCRService();
    this.mockOCR = new MockOCRService();
    
    this.supportedAmounts = getSupportedAmounts();
    
    thumbnailLogger.info('Thumbnail Analyzer initialized', {
      supportedAmounts: this.supportedAmounts,
      confidenceThreshold: config.videoProcessing.ocrConfidenceThreshold
    });
  }

  /**
   * Analyze thumbnail for monetary values
   */
  async analyzeThumbnail(thumbnailUrl: string, videoId: string): Promise<{
    monetaryDetections: MonetaryDetection[];
    hasMoneyThumbnail: boolean;
  }> {
    const startTime = Date.now();
    
    try {
      thumbnailLogger.videoInfo(videoId, 'Starting thumbnail analysis', {
        thumbnailUrl
      });

      // Download and preprocess the thumbnail
      const imageBuffer = await this.downloadAndPreprocessImage(thumbnailUrl);
      
      // Perform OCR
      const ocrResults = await this.performOCR(imageBuffer, videoId);
      
      // Extract monetary values
      const monetaryDetections = this.extractMonetaryValues(ocrResults, videoId);
      
      const hasMoneyThumbnail = monetaryDetections.length > 0;
      
      const duration = Date.now() - startTime;
      thumbnailLogger.performance('thumbnail-analysis', duration, {
        videoId,
        monetaryDetectionsCount: monetaryDetections.length,
        hasMoneyThumbnail
      });

      thumbnailLogger.videoInfo(videoId, 'Thumbnail analysis completed', {
        monetaryDetections: monetaryDetections.length,
        hasMoneyThumbnail,
        detectedAmounts: monetaryDetections.map(d => d.amount)
      });

      return {
        monetaryDetections,
        hasMoneyThumbnail
      };

    } catch (error) {
      thumbnailLogger.videoError(videoId, 'Error analyzing thumbnail', error as Error, {
        thumbnailUrl
      });
      throw error;
    }
  }

  /**
   * Download and preprocess thumbnail image
   */
  private async downloadAndPreprocessImage(thumbnailUrl: string): Promise<Buffer> {
    try {
      thumbnailLogger.debug('Downloading thumbnail', { thumbnailUrl });
      
      const response = await axios.get(thumbnailUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'YT-Scanner/1.0'
        }
      });

      let imageBuffer = Buffer.from(response.data);
      
      // Preprocess image for better OCR results
      imageBuffer = await sharp(imageBuffer)
        .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
        .sharpen()
        .modulate({ brightness: 1.1, saturation: 1.2 })
        .png()
        .toBuffer();

      thumbnailLogger.debug('Thumbnail preprocessed successfully', {
        originalSize: response.data.byteLength,
        processedSize: imageBuffer.length
      });

      return imageBuffer;

    } catch (error) {
      thumbnailLogger.error('Error downloading/preprocessing thumbnail', error as Error, {
        thumbnailUrl
      });
      throw error;
    }
  }

  /**
   * Perform OCR using our OCR service, fallback to mock OCR
   */
  private async performOCR(imageBuffer: Buffer, videoId: string): Promise<OCRResult[]> {
    try {
      thumbnailLogger.debug('Performing OCR with Google Cloud Vision', { videoId });

      // Convert buffer to base64 data URL for the OCR service
      const base64Image = imageBuffer.toString('base64');
      const dataUrl = `data:image/png;base64,${base64Image}`;

      // Use our OCR service
      const ocrResult = await this.ocrService.performOCR(dataUrl, videoId);
      
      if (!ocrResult.text) {
        thumbnailLogger.debug('No text detected in thumbnail', { videoId });
        return [];
      }

      thumbnailLogger.debug('OCR completed', {
        videoId,
        textLength: ocrResult.text.length,
        confidence: ocrResult.confidence,
        monetaryValues: ocrResult.monetaryValues.length
      });

      return [ocrResult];

    } catch (error) {
      thumbnailLogger.videoError(videoId, 'Google Vision API failed, using mock OCR', error as Error);
      
      // Fallback to mock OCR for demonstration
      try {
        const mockResult = await this.mockOCR.performOCR('thumbnail-url', videoId);
        return [mockResult];
      } catch (mockError) {
        thumbnailLogger.videoError(videoId, 'Mock OCR also failed', mockError as Error);
        return [];
      }
    }
  }

  /**
   * Extract monetary values from OCR results
   */
  private extractMonetaryValues(ocrResults: OCRResult[], videoId: string): MonetaryDetection[] {
    const monetaryDetections: MonetaryDetection[] = [];

    for (const ocrResult of ocrResults) {
      // If the OCR service already extracted monetary values, use them
      if (ocrResult.monetaryValues && ocrResult.monetaryValues.length > 0) {
        monetaryDetections.push(...ocrResult.monetaryValues);
        
        for (const detection of ocrResult.monetaryValues) {
          thumbnailLogger.detection('monetary-value', detection.confidence, {
            videoId,
            amount: detection.amount,
            text: ocrResult.text,
            boundingBox: detection.boundingBox
          });
        }
      } else {
        // Fallback to manual extraction for backward compatibility
        const amounts = this.findMonetaryAmounts(ocrResult.text);
        
        for (const amount of amounts) {
          if (this.isSupportedAmount(amount)) {
            const detection: MonetaryDetection = {
              amount,
              currency: 'USD',
              confidence: ocrResult.confidence,
              boundingBox: ocrResult.boundingBox,
              source: 'thumbnail'
            };

            monetaryDetections.push(detection);
            
            thumbnailLogger.detection('monetary-value', detection.confidence, {
              videoId,
              amount,
              text: ocrResult.text,
              boundingBox: detection.boundingBox
            });
          }
        }

        // Update OCR result with found monetary values
        ocrResult.monetaryValues = monetaryDetections.filter(d => 
          d.boundingBox.x === ocrResult.boundingBox.x && 
          d.boundingBox.y === ocrResult.boundingBox.y
        );
      }
    }

    return monetaryDetections;
  }

  /**
   * Find monetary amounts in text
   */
  private findMonetaryAmounts(text: string): number[] {
    const amounts: number[] = [];
    
    // Patterns for detecting monetary values
    const patterns = [
      /\$\s?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g, // $500, $1,000, $500.00
      /(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)\s?\$/g, // 500$, 1,000$
      /(\d{1,4}(?:,\d{3})*)\s?(?:dollars?|USD|bucks?)/gi, // 500 dollars, 1000 USD
      /\$?\s?(\d{3,4})\s?(?:dollar|buck)/gi, // $500 dollar, 1000 buck
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const amountStr = match[1].replace(/,/g, '');
        const amount = parseInt(amountStr, 10);
        
        if (!isNaN(amount) && amount >= 100 && amount <= 10000) {
          amounts.push(amount);
        }
      }
    }

    return [...new Set(amounts)]; // Remove duplicates
  }

  /**
   * Check if amount is in supported range
   */
  private isSupportedAmount(amount: number): boolean {
    return isSupportedAmount(amount);
  }


  /**
   * Batch analyze multiple thumbnails
   */
  async analyzeThumbnails(thumbnails: Array<{ url: string; videoId: string }>): Promise<Map<string, {
    monetaryDetections: MonetaryDetection[];
    hasMoneyThumbnail: boolean;
  }>> {
    const results = new Map();
    
    thumbnailLogger.info('Starting batch thumbnail analysis', {
      count: thumbnails.length
    });

    // Process thumbnails in parallel with limited concurrency
    const concurrency = 5;
    const chunks = [];
    
    for (let i = 0; i < thumbnails.length; i += concurrency) {
      chunks.push(thumbnails.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(async ({ url, videoId }) => {
        try {
          const result = await this.analyzeThumbnail(url, videoId);
          results.set(videoId, result);
        } catch (error) {
          thumbnailLogger.videoError(videoId, 'Failed to analyze thumbnail in batch', error as Error);
          results.set(videoId, { monetaryDetections: [], hasMoneyThumbnail: false });
        }
      });

      await Promise.all(promises);
    }

    thumbnailLogger.info('Batch thumbnail analysis completed', {
      totalProcessed: results.size,
      withMonetaryValues: Array.from(results.values()).filter(r => r.hasMoneyThumbnail).length
    });

    return results;
  }
} 