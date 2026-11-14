// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/AgreementTools.java faithful
// Import cycle with AgreementRule (GrammarCategory): its value is only read inside methods.
import type { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { GrammarCategory } from './AgreementRule.ts';
import { AnalyzedGermanToken } from '../../tagging/de/AnalyzedGermanToken.ts';
import { Determination, Genus } from '../../tagging/de/GermanToken.ts';
import type { Kasus, Numerus } from '../../tagging/de/GermanToken.ts';

export class AgreementTools {

  private constructor() {
  }

  /** Return Kasus, Numerus, Genus of those forms with a determiner. */
  static getAgreementCategories(aToken: AnalyzedTokenReadings, omit: ReadonlySet<GrammarCategory>, skipSol: boolean): Set<string> {
    const { ALLGEMEIN, MASKULINUM, FEMININUM, NEUTRUM } = Genus;
    const set = new Set<string>();
    const readings = aToken.getReadings();
    for (const tmpReading of readings) {
      if (skipSol && tmpReading.getPOSTag() != null && tmpReading.getPOSTag()!.endsWith(':SOL')) {
        // SOL = alleinstehend - needs to be skipped so we find errors like "An der roter Ampel."
        continue;
      }
      const reading = new AnalyzedGermanToken(tmpReading);
      if (reading.getCasus() == null && reading.getNumerus() == null &&
        reading.getGenus() == null) {
        continue;
      }
      if (reading.getGenus() === ALLGEMEIN &&
        tmpReading.getPOSTag() != null && !tmpReading.getPOSTag()!.endsWith(':STV') &&  // STV: stellvertretend (!= begleitend)
        !AgreementTools.possessiveSpecialCase(aToken, tmpReading)) {
        // genus=ALG in the original data. Not sure if this is allowed, but expand this so
        // e.g. "Ich Arbeiter" doesn't get flagged as incorrect:
        if (reading.getDetermination() == null) {
          // Nouns don't have the determination property (definite/indefinite), and as we don't want to
          // introduce a special case for that, we just pretend they always fulfill both properties:
          set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), MASKULINUM, Determination.DEFINITE, omit));
          set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), MASKULINUM, Determination.INDEFINITE, omit));
          set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), FEMININUM, Determination.DEFINITE, omit));
          set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), FEMININUM, Determination.INDEFINITE, omit));
          set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), NEUTRUM, Determination.DEFINITE, omit));
          set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), NEUTRUM, Determination.INDEFINITE, omit));
        } else {
          set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), MASKULINUM, reading.getDetermination(), omit));
          set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), FEMININUM, reading.getDetermination(), omit));
          set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), NEUTRUM, reading.getDetermination(), omit));
        }
      } else {
        if (reading.getDetermination() == null || 'jed' === tmpReading.getLemma() || 'manch' === tmpReading.getLemma()) {  // "jeder" etc. needs a special case to avoid false alarm
          set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), reading.getGenus(), Determination.DEFINITE, omit));
          set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), reading.getGenus(), Determination.INDEFINITE, omit));
        } else {
          set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), reading.getGenus(), reading.getDetermination(), omit));
        }
      }
    }
    return set;
  }

  static getAgreementSOLCategories(aToken: AnalyzedTokenReadings, omit: ReadonlySet<GrammarCategory>): Set<string> {
    const set = new Set<string>();
    const readings = aToken.getReadings();
    for (const tmpReading of readings) {
      if (tmpReading.getPOSTag() != null && !tmpReading.getPOSTag()!.endsWith(':SOL')) {
        continue;
      }
      const reading = new AnalyzedGermanToken(tmpReading);
      if (reading.getCasus() == null && reading.getNumerus() == null && reading.getGenus() == null) {
        continue;
      }
      set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), reading.getGenus(), Determination.DEFINITE, omit));
      set.add(AgreementTools.makeString(reading.getCasus(), reading.getNumerus(), reading.getGenus(), Determination.INDEFINITE, omit));
    }
    return set;
  }

  private static possessiveSpecialCase(aToken: AnalyzedTokenReadings, tmpReading: AnalyzedToken): boolean {
    // would cause error misses as it contains 'ALG', e.g. in "Der Zustand meiner Gehirns."
    return aToken.hasPosTagStartingWith('PRO:POS') && (tmpReading.getLemma() === 'ich' || tmpReading.getLemma() === 'sich');
  }

  private static makeString(casus: Kasus | null, num: Numerus | null, gen: Genus | null,
                            determination: Determination | null, omit: ReadonlySet<GrammarCategory>): string {
    const l: string[] = [];
    if (casus != null && !omit.has(GrammarCategory.KASUS)) {
      l.push(casus.toString());
    }
    if (num != null && !omit.has(GrammarCategory.NUMERUS)) {
      l.push(num.toString());
    }
    if (gen != null && !omit.has(GrammarCategory.GENUS)) {
      l.push(gen.toString());
    }
    if (determination != null) {
      l.push(determination.toString());
    }
    return l.join('/');
  }

}
