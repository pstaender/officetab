// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/tagging/de/AnalyzedGermanToken.java faithful
// StringUtils.split(posTag, ':') drops empty parts, as the filter below does.
import type { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import { Determination, Genus, Kasus, Numerus, POSType } from './GermanToken.ts';

/**
 * One reading of a German word. Many words can have more
 * than one reading, e.g. "Tische" can be both Nominativ Plural
 * and Genitiv Plural (among other readings).
 *
 * @author Daniel Naber
 */
export class AnalyzedGermanToken {

  private readonly type: POSType | null;
  private readonly casus: Kasus | null;
  private readonly numerus: Numerus | null;
  private readonly genus: Genus | null;
  private readonly determination: Determination | null;

  constructor(token: AnalyzedToken) {
    const posTag = token.getPOSTag();
    let parts: string[];
    if (posTag == null || (parts = posTag.split(':').filter((p) => p.length > 0)).length < 3) {
      this.type = null;
      this.casus = null;
      this.numerus = null;
      this.genus = null;
      this.determination = null;
      return;
    }
    let tempType: POSType | null = null;
    let tempCasus: Kasus | null = null;
    let tempNumerus: Numerus | null = null;
    let tempGenus: Genus | null = null;
    let tempDetermination: Determination | null = null;
    for (const part of parts) {
      if (part === 'EIG') {
        tempType = POSType.PROPER_NOUN;
      } else if (part === 'SUB' && tempType == null) {
        tempType = POSType.NOMEN;
      } else if (part === 'PA1' || part === 'PA2') {
        tempType = POSType.PARTIZIP;
      } else if (part === 'VER' && tempType == null) {
        tempType = POSType.VERB;
      } else if (part === 'ADJ' && tempType == null) {
        tempType = POSType.ADJEKTIV;
      } else if (part === 'PRO' && tempType == null) {
        tempType = POSType.PRONOMEN;
      } else if (part === 'ART' && tempType == null) {
        tempType = POSType.DETERMINER;
      } else if (part === 'AKK') {
        tempCasus = Kasus.AKKUSATIV;
      } else if (part === 'GEN') {
        tempCasus = Kasus.GENITIV;
      } else if (part === 'NOM') {
        tempCasus = Kasus.NOMINATIV;
      } else if (part === 'DAT') {
        tempCasus = Kasus.DATIV;
      } else if (part === 'PLU') {
        tempNumerus = Numerus.PLURAL;
      } else if (part === 'SIN') {
        tempNumerus = Numerus.SINGULAR;
      } else if (part === 'MAS') {
        tempGenus = Genus.MASKULINUM;
      } else if (part === 'FEM') {
        tempGenus = Genus.FEMININUM;
      } else if (part === 'NEU') {
        tempGenus = Genus.NEUTRUM;
      } else if (part === 'NOG') {
        tempGenus = Genus.FEMININUM;    // NOG = no genus because only used as plural
      } else if (part === 'ALG') {
        tempGenus = Genus.ALLGEMEIN;
      } else if (part === 'IND') {
        tempDetermination = Determination.INDEFINITE;
      } else if (part === 'DEF') {
        tempDetermination = Determination.DEFINITE;
      }
    }
    this.type = tempType;
    this.casus = tempCasus;
    this.numerus = tempNumerus;
    this.genus = tempGenus;
    this.determination = tempDetermination;
  }

  getType(): POSType | null {
    return this.type;
  }

  getCasus(): Kasus | null {
    return this.casus;
  }

  getNumerus(): Numerus | null {
    return this.numerus;
  }

  getGenus(): Genus | null {
    return this.genus;
  }

  /** @since 3.2 */
  getDetermination(): Determination | null {
    return this.determination;
  }

}
