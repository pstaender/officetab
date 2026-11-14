// SPDX-License-Identifier: MPL-2.0
// Not a port: stands in for META-INF/org/languagetool/language-module.properties of the German
// module and for the class path that Java's reflection searches. Importing this file
// - registers the rule filters that the German rule files name by class (rules/de/registerFilters.ts,
//   plus the generic pattern filters), which must happen before the rule files are loaded;
// - registers the German languages with Languages in the order the properties file lists them
//   (languageClasses=...German,...GermanyGerman,...AustrianGerman,...SwissGerman).
// (Language first: it wires the pattern classes into JLanguageTool and Rule, see Language.ts)
import '../../languagetool-core/org/languagetool/Language.ts';
import './org/languagetool/rules/de/registerFilters.ts';
import '../../languagetool-core/org/languagetool/rules/patterns/ApostropheTypeFilter.ts';
import '../../languagetool-core/org/languagetool/rules/patterns/RegexAntiPatternFilter.ts';
import './org/languagetool/language/German.ts';
import './org/languagetool/language/GermanyGerman.ts';
import './org/languagetool/language/AustrianGerman.ts';
import './org/languagetool/language/SwissGerman.ts';

/**
 * Class path resources German needs besides the broker's getLanguagePaths('de') (which takes only
 * the /org/languagetool/.../de/ paths): jwordsplitter's dictionary and exception list, which
 * GermanCompoundTokenizer (and through it the tagger, synthesizer and speller) reads, and the
 * English tagger's dictionary and word lists, which IsEnglishWordFilter (in German's
 * disambiguation.xml and grammar.xml) uses through EnglishTagger. Preload them with the
 * language's resources.
 */
export const GERMAN_EXTRA_RESOURCES: readonly string[] = [
  '/de/danielnaber/jwordsplitter/wordsGerman.txt',
  '/de/danielnaber/jwordsplitter/exceptionsGerman.txt',
  '/org/languagetool/resource/en/english.dict',
  '/org/languagetool/resource/en/english.info',
  '/org/languagetool/resource/en/english_tags.txt',
  '/org/languagetool/resource/en/added.txt',
  '/org/languagetool/resource/en/added_custom.txt',
  '/org/languagetool/resource/en/removed.txt',
  '/org/languagetool/resource/en/removed_custom.txt',
];
