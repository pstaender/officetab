// SPDX-License-Identifier: MPL-2.0
// Not a port: stands in for META-INF/org/languagetool/language-module.properties of the English
// module and for the class path that Java's reflection searches. Importing this file
// - registers the rule filters that the English rule files name by class (rules/en/registerFilters.ts,
//   plus the generic pattern filters), which must happen before the rule files are loaded;
// - registers the English languages with Languages in the order the properties file lists them
//   (languageClasses=...English,...AmericanEnglish,...BritishEnglish,...).
// (Language first: it wires the pattern classes into JLanguageTool and Rule, see Language.ts)
import '../../languagetool-core/org/languagetool/Language.ts';
import './org/languagetool/rules/en/registerFilters.ts';
import '../../languagetool-core/org/languagetool/rules/patterns/ApostropheTypeFilter.ts';
import '../../languagetool-core/org/languagetool/rules/patterns/RegexAntiPatternFilter.ts';
import './org/languagetool/language/English.ts';
import './org/languagetool/language/AmericanEnglish.ts';
import './org/languagetool/language/BritishEnglish.ts';
import './org/languagetool/language/AustralianEnglish.ts';
import './org/languagetool/language/CanadianEnglish.ts';
import './org/languagetool/language/NewZealandEnglish.ts';
import './org/languagetool/language/SouthAfricanEnglish.ts';
