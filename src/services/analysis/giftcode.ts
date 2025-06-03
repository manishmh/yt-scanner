import { BoundingBox, GiftCodeDetection, OCRResult } from '@/types';
import { videoLogger } from '@/utils/logger';

export class GiftCodeDetectionService {
  constructor() {
    videoLogger.info('Gift Code Detection Service initialized');
  }

  /**
   * Detect Amazon gift codes in OCR results
   * Pattern: xxxx-xxxxxx-xxxx (14 digits total with 2 hyphens)
   */
  detectGiftCodes(ocrResults: OCRResult[], videoId: string, timestamp?: number): GiftCodeDetection[] {
    const giftCodes: GiftCodeDetection[] = [];

    try {
      // Amazon gift code patterns
      const patterns = [
        // Standard format: XXXX-XXXXXX-XXXX
        /([A-Z0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]{4})/g,
        // Alternative format: XXXX XXXXXX XXXX (spaces instead of hyphens)
        /([A-Z0-9]{4}\s[A-Z0-9]{6}\s[A-Z0-9]{4})/g,
        // Compact format: XXXXXXXXXXXXXX (14 characters no separators)
        /([A-Z0-9]{14})/g,
        // Mixed separators: XXXX_XXXXXX_XXXX
        /([A-Z0-9]{4}[_-][A-Z0-9]{6}[_-][A-Z0-9]{4})/g
      ];

      for (const ocrResult of ocrResults) {
        const text = ocrResult.text.toUpperCase();
        
        for (const pattern of patterns) {
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const code = match[1];
            
            // Validate the code format
            if (this.isValidAmazonGiftCode(code)) {
              const giftCode: GiftCodeDetection = {
                code: this.normalizeGiftCode(code),
                confidence: this.calculateCodeConfidence(code, ocrResult.confidence),
                boundingBox: ocrResult.boundingBox,
                timestamp: timestamp || 0,
                source: 'video-frame',
                rawText: match[0],
                detectionMethod: this.getDetectionMethod(pattern)
              };

              giftCodes.push(giftCode);

              videoLogger.detection('gift-code', giftCode.confidence, {
                videoId,
                code: this.maskGiftCode(giftCode.code),
                timestamp: giftCode.timestamp,
                method: giftCode.detectionMethod
              });
            }
          }
        }
      }

      // Remove duplicates based on normalized code
      const uniqueCodes = this.removeDuplicateCodes(giftCodes);

      videoLogger.debug('Gift code detection completed', {
        videoId,
        timestamp,
        totalDetections: giftCodes.length,
        uniqueCodes: uniqueCodes.length
      });

      return uniqueCodes;

    } catch (error) {
      videoLogger.error('Error detecting gift codes', error as Error, {
        videoId,
        timestamp
      });
      return [];
    }
  }

  /**
   * Validate if a detected code matches Amazon gift code format
   */
  private isValidAmazonGiftCode(code: string): boolean {
    // Remove separators for validation
    const cleanCode = code.replace(/[-_\s]/g, '');
    
    // Must be exactly 14 characters
    if (cleanCode.length !== 14) {
      return false;
    }

    // Must contain only alphanumeric characters (Amazon uses A-Z, 0-9)
    if (!/^[A-Z0-9]{14}$/.test(cleanCode)) {
      return false;
    }

    // Amazon gift codes typically don't use certain characters to avoid confusion
    const excludedChars = ['0', 'O', 'I', '1'];
    const hasExcludedChars = excludedChars.some(char => cleanCode.includes(char));
    
    // If it has excluded chars, lower the confidence but don't reject
    return true;
  }

  /**
   * Normalize gift code to standard format
   */
  private normalizeGiftCode(code: string): string {
    // Remove all separators
    const cleanCode = code.replace(/[-_\s]/g, '');
    
    // Format as XXXX-XXXXXX-XXXX
    return `${cleanCode.slice(0, 4)}-${cleanCode.slice(4, 10)}-${cleanCode.slice(10, 14)}`;
  }

  /**
   * Calculate confidence score for detected gift code
   */
  private calculateCodeConfidence(code: string, ocrConfidence: number): number {
    let confidence = ocrConfidence;

    // Boost confidence for proper format
    if (/^[A-Z0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]{4}$/.test(code)) {
      confidence += 0.1;
    }

    // Reduce confidence for excluded characters
    const excludedChars = ['0', 'O', 'I', '1'];
    const cleanCode = code.replace(/[-_\s]/g, '');
    const excludedCount = excludedChars.filter(char => cleanCode.includes(char)).length;
    confidence -= (excludedCount * 0.05);

    // Boost confidence for typical Amazon patterns
    if (this.hasTypicalAmazonPattern(cleanCode)) {
      confidence += 0.05;
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Check if code has typical Amazon gift code patterns
   */
  private hasTypicalAmazonPattern(code: string): boolean {
    // Amazon codes often have certain patterns
    // This is a simplified check - could be enhanced with ML
    
    // Check for repeated characters (less likely in real codes)
    const hasRepeatedChars = /(.)\1{3,}/.test(code);
    if (hasRepeatedChars) return false;

    // Check for sequential patterns (less likely)
    const hasSequential = /(?:ABCD|1234|EFGH)/.test(code);
    if (hasSequential) return false;

    return true;
  }

  /**
   * Get detection method name based on regex pattern
   */
  private getDetectionMethod(pattern: RegExp): string {
    const patternStr = pattern.toString();
    
    if (patternStr.includes('-')) return 'hyphen-separated';
    if (patternStr.includes('\\s')) return 'space-separated';
    if (patternStr.includes('[_-]')) return 'mixed-separators';
    if (patternStr.includes('{14}')) return 'compact-format';
    
    return 'unknown';
  }

  /**
   * Remove duplicate gift codes
   */
  private removeDuplicateCodes(codes: GiftCodeDetection[]): GiftCodeDetection[] {
    const seen = new Set<string>();
    const unique: GiftCodeDetection[] = [];

    for (const code of codes) {
      const normalizedCode = this.normalizeGiftCode(code.code);
      
      if (!seen.has(normalizedCode)) {
        seen.add(normalizedCode);
        unique.push(code);
      }
    }

    return unique;
  }

  /**
   * Mask gift code for logging (security)
   */
  private maskGiftCode(code: string): string {
    if (code.length < 8) return '****';
    
    const parts = code.split('-');
    if (parts.length === 3) {
      return `${parts[0].slice(0, 2)}**-${parts[1].slice(0, 2)}****-${parts[2].slice(0, 2)}**`;
    }
    
    return `${code.slice(0, 4)}${'*'.repeat(code.length - 8)}${code.slice(-4)}`;
  }

  /**
   * Analyze text for potential gift code context
   */
  analyzeGiftCodeContext(text: string): {
    hasGiftCodeKeywords: boolean;
    contextKeywords: string[];
    confidence: number;
  } {
    const giftCodeKeywords = [
      'gift card', 'gift code', 'amazon gift', 'redeem code',
      'claim code', 'voucher', 'coupon', 'promo code',
      'free money', 'cash', 'giveaway', 'winner'
    ];

    const foundKeywords = giftCodeKeywords.filter(keyword => 
      text.toLowerCase().includes(keyword)
    );

    return {
      hasGiftCodeKeywords: foundKeywords.length > 0,
      contextKeywords: foundKeywords,
      confidence: Math.min(1.0, foundKeywords.length * 0.2)
    };
  }
} 