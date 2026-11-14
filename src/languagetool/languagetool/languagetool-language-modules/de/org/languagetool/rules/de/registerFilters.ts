// SPDX-License-Identifier: MPL-2.0
// Not a port: Java finds the filter classes named in the German rule files
// (<filter class="..."> in grammar.xml, style.xml and disambiguation.xml) by reflection. Here each
// filter registers itself with FilterRegistry when its module is loaded (see
// rules/patterns/registry.ts); importing this file loads the German filters and the core filters
// German uses. Import it before German's rule files are loaded.
// Core filters:
import '../../../../../../languagetool-core/org/languagetool/rules/DateRangeChecker.ts';
import '../../../../../../languagetool-core/org/languagetool/rules/IsEnglishWordFilter.ts';
import '../../../../../../languagetool-core/org/languagetool/rules/WhitespaceCheckFilter.ts';
import '../../../../../../languagetool-core/org/languagetool/rules/spelling/multitoken/MultitokenSpellerFilter.ts';
// German filters:
import './AdvancedSynthesizerFilter.ts';
import './CompoundCheckFilter.ts';
import './DateCheckFilter.ts';
import './FutureDateFilter.ts';
import './GermanNumberInWordFilter.ts';
import './InsertCommaFilter.ts';
import './NewYearDateFilter.ts';
import './PotentialCompoundFilter.ts';
import './RecentYearFilter.ts';
import './RemoveUnknownCompoundsFilter.ts';
import './ValidWordFilter.ts';
import './YMDDateCheckFilter.ts';
import './YMDNewYearDateFilter.ts';
