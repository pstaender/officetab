// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/tagging/de/VerbPrefixes.java faithful
// Collections.sort and List.sort are stable, as Array.prototype.sort is; Collections.sort sorts
// by String.compareTo (UTF-16 code units), as the default comparison below does.

// https://deutschegrammatik20.de/spezielle-verben/verben-mit-praefix-trennbare-und-nicht-trennbare-verben/uebersicht-trennbare-praefixe/
const prefixes: string[] = ['ab', 'an', 'auf', 'aus', 'auseinander', 'bei', 'ein', 'empor', 'entgegen', 'entlang', 'entzwei',
  'fehl', 'fern', 'fest', 'fort', 'gegenüber', 'heim', 'hinterher', 'hoch', 'los', 'mit', 'nach', 'neben', 'nieder', 'vor',
  'weg', 'weiter', 'zu', 'zurecht', 'zurück', 'zusammen', 'da', 'hin', 'her',
  'herab', 'heran', 'herauf', 'heraus', 'herbei', 'herein', 'hernieder', 'herüber', 'herum', 'herunter', 'hervor', 'herzu',
  'hinab', 'hinan', 'hinauf', 'hinaus', 'hinein', 'hinüber', 'hinunter', 'hinweg', 'hinzu', 'vorab', 'voran', 'vorauf', 'voraus',
  'vorbei', 'vorweg', 'vorher', 'vorüber',
  'dabei', 'dafür', 'dagegen', 'daher', 'dahin', 'dahinter', 'daneben', 'daran', 'darauf', 'darein', 'darüber', 'darunter',
  'hinter', 'dran', 'drauf', 'drein', 'drüber', 'drunter',
  'davon', 'davor', 'dazu', 'dazwischen',
  'durch', 'über', 'unter', 'um', 'wider', 'wieder', 'rüber', 'aneinander', 'ran', 'rauf', 'runter', 'rein',
  // not listed in source above (deutschegrammatik20.de):
  'umher', 'ent', 'frei', 'ver', 'zer', 'gegen',
];
// sort alphabetically and then longest first:
prefixes.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
prefixes.sort((k, v) => v.length - k.length);

/**
 * List of German verb prefixes. Not guaranteed to be complete.
 * @since 5.0
 */
export class VerbPrefixes {

  private constructor() {
  }

  static get(): readonly string[] {
    return prefixes;
  }
}
