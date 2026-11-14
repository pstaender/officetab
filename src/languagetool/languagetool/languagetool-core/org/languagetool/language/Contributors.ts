// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/language/Contributors.java faithful
import { Contributor } from './Contributor.ts';

/**
 * Constants for contributors who contribute to more than one language (use to avoid duplication).
 */
export class Contributors {

  private constructor() {
  }

  static readonly MARCIN_MILKOWSKI = new Contributor('Marcin Miłkowski', 'http://marcinmilkowski.pl');
  static readonly DANIEL_NABER = new Contributor('Daniel Naber', 'http://www.danielnaber.de');
  static readonly DOMINIQUE_PELLE = new Contributor('Dominique Pellé', 'http://dominiko.livejournal.com/tag/lingvoilo');

}
