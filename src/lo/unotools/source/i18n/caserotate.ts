// SPDX-License-Identifier: MPL-2.0
// @upstream unotools/source/i18n/caserotate.cxx faithful
import { TransliterationFlags } from '../../../i18npool/source/transliteration/transliteration_body.ts';

/** unotools' RotateTransliteration: Shift+F3 cycles title case, sentence case, upper and lower case. */
export class RotateTransliteration {
  private nF3ShiftCounter = 0;
  getNextMode(): TransliterationFlags {
    let nMode: TransliterationFlags;
    switch (this.nF3ShiftCounter) {
      case 0: nMode = TransliterationFlags.TITLE_CASE; break;
      case 1: nMode = TransliterationFlags.SENTENCE_CASE; break; // tdf#116315
      case 2: nMode = TransliterationFlags.LOWERCASE_UPPERCASE; break;
      default: nMode = TransliterationFlags.UPPERCASE_LOWERCASE; this.nF3ShiftCounter = -1; break;
    }
    this.nF3ShiftCounter++;
    return nMode;
  }
}
