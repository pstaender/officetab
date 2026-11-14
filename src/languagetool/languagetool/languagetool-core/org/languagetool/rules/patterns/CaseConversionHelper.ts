// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/CaseConversionHelper.java faithful
import type { Language } from '../../Language.ts';
import { StringTools } from '../../tools/StringTools.ts';
import { CaseConversion } from './Match.ts';

/**
 * @since 3.2
 */
export const CaseConversionHelper = {

  /**
   * Converts case of the string token according to match element attributes.
   * @param s Token to be converted.
   * @param sample the sample string used to determine how the original string looks like (used only on case preservation)
   * @return Converted string.
   */
  convertCase(conversion: CaseConversion, s: string, sample: string, lang: Language | null): string {
    if (StringTools.isEmpty(s)) {
      return s;
    }
    let token = s;
    switch (conversion) {
      case CaseConversion.NONE:
        break;
      case CaseConversion.PRESERVE:
        if (StringTools.startsWithUppercase(sample)) {
          if (StringTools.isAllUppercase(sample)) {
            token = token.toUpperCase();
          } else {
            token = StringTools.uppercaseFirstChar(token, lang)!;
          }
        }
        break;
      case CaseConversion.STARTLOWER:
        token = token.substring(0, 1).toLowerCase() + token.substring(1);
        break;
      case CaseConversion.STARTUPPER:
        token = StringTools.uppercaseFirstChar(token, lang)!;
        break;
      case CaseConversion.ALLUPPER:
        token = token.toUpperCase();
        break;
      case CaseConversion.FIRSTUPPER:
        token = token.toLowerCase();
        token = StringTools.uppercaseFirstChar(token, lang)!;
        break;
      case CaseConversion.ALLLOWER:
        token = token.toLowerCase();
        break;
      case CaseConversion.NOTASHKEEL:
        token = StringTools.removeTashkeel(token);
        break;
      default:
        break;
    }
    return token;
  },

};
