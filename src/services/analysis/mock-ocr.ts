import { getSupportedAmounts } from '@/config';
import { BoundingBox, MonetaryDetection, OCRResult } from '@/types';
import { videoLogger } from '@/utils/logger';

export class MockOCRService {
  /**
   * Mock OCR analysis that simulates detecting $550 in the thumbnail
   * This is for demonstration since Google Vision API is not enabled
   */
  async performOCR(imageUrl: string, videoId: string): Promise<OCRResult> {
    videoLogger.debug('Performing mock OCR analysis', { imageUrl, videoId });

    // Simulate OCR detection based on the actual thumbnail content
    // In the real implementation, this would be done by Google Vision API
    
    const mockBoundingBox: BoundingBox = {
      x: 300,
      y: 150,
      width: 200,
      height: 80
    };

    // Simulate detecting "$550" in the thumbnail
    const detectedText = "$550";
    const monetaryDetections: MonetaryDetection[] = [];

    // Check if the detected amount is in our supported range
    const supportedAmounts = getSupportedAmounts();
    const amount = 550;

    if (supportedAmounts.includes(amount)) {
      monetaryDetections.push({
        amount: amount,
        currency: 'USD',
        confidence: 0.95,
        boundingBox: mockBoundingBox,
        source: 'thumbnail'
      });

      videoLogger.info('Mock OCR detected monetary value', {
        videoId,
        amount,
        confidence: 0.95,
        text: detectedText
      });
    }

    return {
      text: detectedText,
      confidence: 0.95,
      boundingBox: mockBoundingBox,
      monetaryValues: monetaryDetections
    };
  }


} 