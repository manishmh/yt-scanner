import { getSupportedAmounts } from '@/config';
import { BoundingBox, MonetaryDetection, OCRResult } from '@/types';
import { videoLogger } from '@/utils/logger';
import { ImageAnnotatorClient } from '@google-cloud/vision';

export class OCRService {
  private client: ImageAnnotatorClient;

  constructor() {
    // Initialize Google Vision API client
    // This will use Application Default Credentials
    this.client = new ImageAnnotatorClient();
  }

  /**
   * Perform OCR analysis using Google Cloud Vision API
   */
  async performOCR(imageData: string, videoId: string): Promise<OCRResult> {
    try {
      videoLogger.debug('Performing Google Vision OCR analysis', { videoId });

      let visionRequest: any;

      // Check if imageData is a data URL or a regular URL
      if (imageData.startsWith('data:image/')) {
        // Extract base64 content from data URL
        const base64Content = imageData.split(',')[1];
        visionRequest = {
          image: { content: base64Content }
        };
        videoLogger.debug('Using base64 image content for OCR', { videoId });
      } else {
        // Use as image URI
        visionRequest = {
          image: { source: { imageUri: imageData } }
        };
        videoLogger.debug('Using image URI for OCR', { videoId, imageUri: imageData });
      }

      // Perform text detection on the image
      const [result] = await this.client.textDetection(visionRequest);

      const detections = result.textAnnotations || [];
      
      if (detections.length === 0) {
        videoLogger.debug('No text detected in image', { videoId });
        return {
          text: '',
          confidence: 0,
          boundingBox: { x: 0, y: 0, width: 0, height: 0 },
          monetaryValues: []
        };
      }

      // The first detection contains all detected text
      const fullText = detections[0].description || '';
      const confidence = detections[0].score || 0;

      // Extract bounding box from the first detection
      const vertices = detections[0].boundingPoly?.vertices || [];
      const boundingBox: BoundingBox = this.extractBoundingBox(vertices);

      videoLogger.debug('OCR text detected', { 
        videoId, 
        text: fullText, 
        confidence,
        boundingBox 
      });

      // Extract monetary values from the detected text
      const monetaryDetections = this.extractMonetaryValues(
        fullText, 
        detections, 
        videoId
      );

      return {
        text: fullText,
        confidence,
        boundingBox,
        monetaryValues: monetaryDetections
      };

    } catch (error) {
      videoLogger.error('Google Vision OCR failed', error as Error, { 
        videoId
      });

      // Return empty result on error
      return {
        text: '',
        confidence: 0,
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        monetaryValues: []
      };
    }
  }

  /**
   * Extract monetary values from detected text
   */
  private extractMonetaryValues(
    text: string, 
    detections: any[], 
    videoId: string
  ): MonetaryDetection[] {
    const monetaryDetections: MonetaryDetection[] = [];
    const supportedAmounts = getSupportedAmounts();

    videoLogger.debug('Extracting monetary values from text', { 
      videoId, 
      text: text.substring(0, 200),
      supportedAmounts 
    });

    // Regex patterns for detecting monetary values
    const patterns = [
      /\$\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g,  // $500, $ 550, $1,000, $500.00
      /(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)\s*(?:dollars?|USD|\$)/gi,  // 500 dollars, 550 USD, 550$
      /(?:USD|dollars?)\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/gi,  // USD 500, dollars 550
      /(\d{3,4})\s*(?:dollar|buck)/gi  // 550 dollar, 500 buck
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const amountStr = match[1].replace(/,/g, '').replace(/\./g, '');
        const amount = parseInt(amountStr, 10);

        videoLogger.debug('Found potential monetary match', {
          videoId,
          matchText: match[0],
          extractedAmount: amount,
          isSupported: supportedAmounts.includes(amount)
        });

        if (!isNaN(amount) && supportedAmounts.includes(amount)) {
          // Find the specific detection that contains this monetary value
          const boundingBox = this.findMonetaryBoundingBox(match[0], detections);

          monetaryDetections.push({
            amount,
            currency: 'USD',
            confidence: 0.9, // High confidence for regex matches
            boundingBox,
            source: 'thumbnail'
          });

          videoLogger.info('OCR detected monetary value', {
            videoId,
            amount,
            text: match[0],
            confidence: 0.9
          });
        }
      }
    }

    videoLogger.debug('Monetary extraction completed', {
      videoId,
      detectionsFound: monetaryDetections.length,
      amounts: monetaryDetections.map(d => d.amount)
    });

    return monetaryDetections;
  }

  /**
   * Extract bounding box coordinates from Vision API vertices
   */
  private extractBoundingBox(vertices: any[]): BoundingBox {
    if (vertices.length < 4) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const xs = vertices.map(v => v.x || 0);
    const ys = vertices.map(v => v.y || 0);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Find bounding box for a specific monetary text within detections
   */
  private findMonetaryBoundingBox(monetaryText: string, detections: any[]): BoundingBox {
    // Look for the detection that contains the monetary text
    for (const detection of detections) {
      if (detection.description && detection.description.includes(monetaryText)) {
        const vertices = detection.boundingPoly?.vertices || [];
        return this.extractBoundingBox(vertices);
      }
    }

    // Fallback to first detection's bounding box
    if (detections.length > 0) {
      const vertices = detections[0].boundingPoly?.vertices || [];
      return this.extractBoundingBox(vertices);
    }

    return { x: 0, y: 0, width: 0, height: 0 };
  }
} 