// SPDX-License-Identifier: MPL-2.0
// Not a port: Java finds the filter classes named in the English rule files
// (<filter class="..."> in grammar.xml, style.xml and disambiguation.xml) by reflection. Here each
// filter registers itself with FilterRegistry when its module is loaded (see
// rules/patterns/registry.ts); importing this file loads the English filters and the core
// filters English uses. Import it before English's rule files are loaded.
// Core filters:
import '../../../../../../languagetool-core/org/languagetool/rules/DateRangeChecker.ts';
import '../../../../../../languagetool-core/org/languagetool/rules/UnderlineSpacesFilter.ts';
import '../../../../../../languagetool-core/org/languagetool/rules/spelling/multitoken/MultitokenSpellerFilter.ts';
// English filters:
import './AdverbFilter.ts';
import './DateCheckFilter.ts';
import './EnglishNumberInWordFilter.ts';
import './EnglishPartialPosTagFilter.ts';
import './EnglishSuppressMisspelledSuggestionsFilter.ts';
import './FindSuggestionsFilter.ts';
import './FutureDateFilter.ts';
import './NewYearDateFilter.ts';
import './NoDisambiguationEnglishPartialPosTagFilter.ts';
import './OrdinalSuffixFilter.ts';
import './YMDDateCheckFilter.ts';
import './YMDNewYearDateFilter.ts';
