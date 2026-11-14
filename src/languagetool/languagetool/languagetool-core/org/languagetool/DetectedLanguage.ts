// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/DetectedLanguage.java faithful
import type { Language } from './Language.ts';

/**
 * @since 4.2
 */
export class DetectedLanguage {

  private readonly givenLanguage: Language;
  private readonly detectedLanguage: Language;
  private readonly detectionConfidence: number;
  private readonly detectionSource: string | null;

  /**
   * @since 4.4 (detectionConfidence, detectionSource)
   */
  constructor(givenLanguage: Language, detectedLanguage: Language, detectionConfidence = 1.0, detectionSource: string | null = null) {
    this.givenLanguage = givenLanguage;
    this.detectedLanguage = detectedLanguage;
    this.detectionConfidence = detectionConfidence;
    this.detectionSource = detectionSource;
  }

  getGivenLanguage(): Language {
    return this.givenLanguage;
  }

  getDetectedLanguage(): Language {
    return this.detectedLanguage;
  }

  /**
   * @since 4.4
   */
  getDetectionConfidence(): number {
    return this.detectionConfidence;
  }

  getDetectionSource(): string | null {
    return this.detectionSource;
  }

  toString(): string {
    return this.detectedLanguage.getShortCodeWithCountryAndVariant();
  }
}
