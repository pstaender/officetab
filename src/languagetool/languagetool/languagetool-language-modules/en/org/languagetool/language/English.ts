// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/language/English.java reduced
// Left out (server-only or not available in the browser):
// - getRelevantLanguageModelRules (UpperCaseNgramRule, EnglishConfusionProbabilityRule,
//   EnglishNgramProbabilityRule: they need the ngram index) and
//   getRelevantLanguageModelCapableRules' false friend rules (EnglishFor*FalseFriendRule: they need
//   a language model; without one Java returns no rules either);
// - getRemoteEnhancedRules (BERT suggestion ranking, a remote service).
// getDefaultLanguageVariant looks AmericanEnglish up by its code (what AmericanEnglish.getInstance
// does), as a value import of AmericanEnglish, a subclass, would be an import cycle. The Guava
// cache of L2 rule files (expiring after 30 minutes) is a Map. close() is LanguageWithModel's.
import { LanguageWithModel } from '../../../../../languagetool-core/org/languagetool/LanguageWithModel.ts';
import { JLanguageTool } from '../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import type { Language } from '../../../../../languagetool-core/org/languagetool/Language.ts';
import { LanguageMaintainedState } from '../../../../../languagetool-core/org/languagetool/LanguageMaintainedState.ts';
import { Languages } from '../../../../../languagetool-core/org/languagetool/Languages.ts';
import type { UserConfig } from '../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { Chunker } from '../../../../../languagetool-core/org/languagetool/chunking/Chunker.ts';
import { Contributor } from '../../../../../languagetool-core/org/languagetool/language/Contributor.ts';
import { Contributors } from '../../../../../languagetool-core/org/languagetool/language/Contributors.ts';
import type { AnnotatedText } from '../../../../../languagetool-core/org/languagetool/markup/AnnotatedText.ts';
import { CommaWhitespaceRule } from '../../../../../languagetool-core/org/languagetool/rules/CommaWhitespaceRule.ts';
import { DoublePunctuationRule } from '../../../../../languagetool-core/org/languagetool/rules/DoublePunctuationRule.ts';
import { EmptyLineRule } from '../../../../../languagetool-core/org/languagetool/rules/EmptyLineRule.ts';
import { Example } from '../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { LongParagraphRule } from '../../../../../languagetool-core/org/languagetool/rules/LongParagraphRule.ts';
import { MultipleWhitespaceRule } from '../../../../../languagetool-core/org/languagetool/rules/MultipleWhitespaceRule.ts';
import { ParagraphRepeatBeginningRule } from '../../../../../languagetool-core/org/languagetool/rules/ParagraphRepeatBeginningRule.ts';
import { PunctuationMarkAtParagraphEnd } from '../../../../../languagetool-core/org/languagetool/rules/PunctuationMarkAtParagraphEnd.ts';
import { PunctuationMarkAtParagraphEnd2 } from '../../../../../languagetool-core/org/languagetool/rules/PunctuationMarkAtParagraphEnd2.ts';
import { ReadabilityRule } from '../../../../../languagetool-core/org/languagetool/rules/ReadabilityRule.ts';
import type { Rule } from '../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { SentenceWhitespaceRule } from '../../../../../languagetool-core/org/languagetool/rules/SentenceWhitespaceRule.ts';
import { SuggestedReplacement } from '../../../../../languagetool-core/org/languagetool/rules/SuggestedReplacement.ts';
import { UppercaseSentenceStartRule } from '../../../../../languagetool-core/org/languagetool/rules/UppercaseSentenceStartRule.ts';
import { WhiteSpaceAtBeginOfParagraph } from '../../../../../languagetool-core/org/languagetool/rules/WhiteSpaceAtBeginOfParagraph.ts';
import { WhiteSpaceBeforeParagraphEnd } from '../../../../../languagetool-core/org/languagetool/rules/WhiteSpaceBeforeParagraphEnd.ts';
import { PatternRuleLoader } from '../../../../../languagetool-core/org/languagetool/rules/patterns/PatternRuleLoader.ts';
import type { SpellingCheckRule } from '../../../../../languagetool-core/org/languagetool/rules/spelling/SpellingCheckRule.ts';
import type { Synthesizer } from '../../../../../languagetool-core/org/languagetool/synthesis/Synthesizer.ts';
import type { Tagger } from '../../../../../languagetool-core/org/languagetool/tagging/Tagger.ts';
import type { Disambiguator } from '../../../../../languagetool-core/org/languagetool/tagging/disambiguation/Disambiguator.ts';
import { SRXSentenceTokenizer } from '../../../../../languagetool-core/org/languagetool/tokenizers/SRXSentenceTokenizer.ts';
import type { SentenceTokenizer } from '../../../../../languagetool-core/org/languagetool/tokenizers/SentenceTokenizer.ts';
import type { Tokenizer } from '../../../../../languagetool-core/org/languagetool/tokenizers/Tokenizer.ts';
import { Tools } from '../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { EnglishChunker } from '../chunking/EnglishChunker.ts';
import { AvsAnRule } from '../rules/en/AvsAnRule.ts';
import { CompoundRule } from '../rules/en/CompoundRule.ts';
import { ConsistentApostrophesRule } from '../rules/en/ConsistentApostrophesRule.ts';
import { ContractionSpellingRule } from '../rules/en/ContractionSpellingRule.ts';
import { EnglishMultitokenSpeller } from '../rules/en/EnglishMultitokenSpeller.ts';
import { EnglishDashRule } from '../rules/en/EnglishDashRule.ts';
import { EnglishDiacriticsRule } from '../rules/en/EnglishDiacriticsRule.ts';
import { EnglishPlainEnglishRule } from '../rules/en/EnglishPlainEnglishRule.ts';
import { EnglishRedundancyRule } from '../rules/en/EnglishRedundancyRule.ts';
import { EnglishRepeatedWordsRule } from '../rules/en/EnglishRepeatedWordsRule.ts';
import { EnglishSpecificCaseRule } from '../rules/en/EnglishSpecificCaseRule.ts';
import { EnglishUnpairedBracketsRule } from '../rules/en/EnglishUnpairedBracketsRule.ts';
import { EnglishUnpairedQuotesRule } from '../rules/en/EnglishUnpairedQuotesRule.ts';
import { EnglishWordRepeatBeginningRule } from '../rules/en/EnglishWordRepeatBeginningRule.ts';
import { EnglishWordRepeatRule } from '../rules/en/EnglishWordRepeatRule.ts';
import { EnglishWrongWordInContextRule } from '../rules/en/EnglishWrongWordInContextRule.ts';
import { LongSentenceRule } from '../rules/en/LongSentenceRule.ts';
import { MorfologikAmericanSpellerRule } from '../rules/en/MorfologikAmericanSpellerRule.ts';
import { SimpleReplaceProfanityRule } from '../rules/en/SimpleReplaceProfanityRule.ts';
import { SimpleReplaceRule } from '../rules/en/SimpleReplaceRule.ts';
import { StyleTooOftenUsedAdjectiveRule } from '../rules/en/StyleTooOftenUsedAdjectiveRule.ts';
import { StyleTooOftenUsedNounRule } from '../rules/en/StyleTooOftenUsedNounRule.ts';
import { StyleTooOftenUsedVerbRule } from '../rules/en/StyleTooOftenUsedVerbRule.ts';
import { WordCoherencyRule } from '../rules/en/WordCoherencyRule.ts';
import { EnglishSynthesizer } from '../synthesis/en/EnglishSynthesizer.ts';
import { EnglishHybridDisambiguator } from '../tagging/en/EnglishHybridDisambiguator.ts';
import { EnglishTagger } from '../tagging/en/EnglishTagger.ts';
import { EnglishWordTokenizer } from '../tokenizers/en/EnglishWordTokenizer.ts';
import type { ResourceBundle } from '../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern, StringSplit } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { List_contains } from '../../../../../../jdk/java/util/Objects.ts';
import { StringTrim } from '../../../../../../jdk/java/lang/Character.ts';

const cache = new Map<string, Rule[]>();
function cacheGetUnchecked(path: string): Rule[] {
  let rules = cache.get(path);
  if (rules === undefined) {
    rules = [];
    const loader = new PatternRuleLoader();
    const is = JLanguageTool.getDataBroker().getAsStream(path);
    if (is == null) {
      throw new Error('IOException: ' + path);
    }
    rules.push(...loader.getRules(is, path, null));
    cache.set(path, rules);
  }
  return rules;
}
let FALSE_FRIENDS_PATTERN: Pattern | null = null;

const id2prio = new Map<string, number>();
  id2prio.set('I_E', 10);  // needs higher prio than EN_COMPOUNDS ("i.e learning")
  id2prio.set('CHILDISH_LANGUAGE', 8);   // prefer over spell checker
  id2prio.set('RUDE_SARCASTIC', 6);   // prefer over spell checker
  id2prio.set('FOR_NOUN_SAKE', 6);   // prefer over PROFANITY (e.g. "for fuck sake")
  id2prio.set('YEAR_OLD_HYPHEN', 6);   // higher prio than MISSING_HYPHEN
  id2prio.set('MISSING_HYPHEN', 5);
  id2prio.set('WRONG_APOSTROPHE', 5);
  id2prio.set('YOU_GOOD', 3);   // prefer over AI_HYDRA_LEO_CP (YOU_YOURE etc.) // prefer over PRP_PAST_PART
  id2prio.set('DOS_AND_DONTS', 3);
  id2prio.set('IF_YOU_FURTHER_QUESTIONS', 3);   // higher prio than agreement rules and AI
  id2prio.set('ABBREVIATION_PUNCTUATION', 2);
  id2prio.set('READ_ONLY_ACCESS_HYPHEN', 2);   // higher priority than agreement rules
  id2prio.set('MAKE_OR_BREAK_HYPHEN', 2);   // higher priority than agreement rules
  id2prio.set('LINKED_IN', 2);   // higher prio than agreement rules
  id2prio.set('T_HE', 1);   // higher prio than agreement rules
  id2prio.set('I_A_M', 1);   // higher prio than EN_A_VS_AN
  id2prio.set('ACCESS_EXCESS', 1);   // higher prio than A_UNCOUNTABLE
  id2prio.set('PRP_ABLE_TO', 1);   // higher prio than AI_HYDRA_LEO_CP_YOU.*
  id2prio.set('WEE_WE', 1);   // higher prio than INTERJECTIONS_PUNCTUATION
  id2prio.set('CAN_MISSPELLING', 1);   // higher prio than COM_COME
  id2prio.set('FOR_THE_MOST_PART2', 1);   // higher prio than FOR_THE_MOST_PART
  id2prio.set('FACE_TO_FACE_HYPHEN', 1);   // higher prio than THIS_NNS
  id2prio.set('RUN_ON', 1);   // higher prio than TOO_LONG_SENTENCE
  id2prio.set('ON_THE_LOOK_OUT', 1);   // higher prio than VERB_NOUN_CONFUSION
  id2prio.set('APOSTROPHE_IN_DAYS', 1);   // higher prio than A_NNS
  id2prio.set('SAFE_GUARD_COMPOUND', 1);   // higher prio than some agreement rules
  id2prio.set('EVEN_HANDED_HYPHEN', 1);   // higher prio than some agreement rules
  id2prio.set('GET_TOGETHER_HYPHEN', 1);   // higher prio than some agreement rules
  id2prio.set('GOT_HERE', 1);   // higher prio than GET_VBN and HEAR_HERE
  id2prio.set('PICTURE_PERFECT_HYPHEN', 1);   // higher prio than some agreement rules
  id2prio.set('SEEM_SEEN', 1);   // higher prio than some agreement rules (e.g. PRP_HAVE_VB)
  id2prio.set('SAVE_SAFE', 1);   // higher prio than agreement rules
  id2prio.set('FEDEX', 2);   // higher prio than many verb rules (e.g. MD_BASEFORM)
  id2prio.set('DROP_DEAD_HYPHEN', 1);   // higher prio than agreement rules (e.g. I_AM_VB)
  id2prio.set('HEAR_HERE', 1);   // higher prio than agreement rules (e.g. I_AM_VB)
  id2prio.set('THE_FRENCH', 1);   // higher prio than agreement rules (e.g. I_AM_VB)
  id2prio.set('A_HEADS_UP', 1);   // higher prio than some plural agreement rules (e.g. THERE_S_MANY)
  id2prio.set('UNITES_UNITED', 1);   // higher prio than IS_VBZ
  id2prio.set('THIS_MISSING_VERB', 1);   // higher priority than A_MY
  id2prio.set('YOURE', 1);   // prefer over EN_CONTRACTION_SPELLING
  id2prio.set('LIFE_COMPOUNDS', 1);
  id2prio.set('DRIVE_THROUGH_HYPHEN', 1);   // higher prio than agreement rules
  id2prio.set('CAUSE_COURSE', 1);   // higher prio than CAUSE_BECAUSE
  id2prio.set('THANK_YOUR', 1);   // higher prio than POSSESSIVE_DETERMINER_SENT_END
  id2prio.set('AN_AND', 1);   // higher prio than A_MY and DT_PRP
  id2prio.set('HER_S', 1);   // higher prio than THEIR_S
  id2prio.set('ONE_TO_MANY_HYPHEN', 1);   // higher prio than TO_TOO
  id2prio.set('COVID_19', 1);
  id2prio.set('RATHER_NOT_VB', 1);   // higher prio than NOT_TO_DOES_NOT
  id2prio.set('PIECE_COMPOUNDS', 1);
  id2prio.set('OTHER_WISE_COMPOUND', 1);
  id2prio.set('ON_EXCEL', 1);
  id2prio.set('ALL_NN', 1);   // higher prio than MASS_AGREEMENT
  id2prio.set('SHOW_COMPOUNDS', 1);   // higher prio than agreement rules
  id2prio.set('PRP_AREA', 1);   // higher prio than you/your confusion rules
  id2prio.set('IF_VB_PCT', 1);   // higher prio than IF_VB
  id2prio.set('CAUSE_BECAUSE', 1);   // higher prio than MISSING_TO_BETWEEN_BE_AND_VB
  id2prio.set('MAY_MANY', 1);   // higher prio than MAY_MANY_MY
  id2prio.set('BOUT_TO', 1);   // higher prio than PRP_VB
  id2prio.set('HAVE_HAVE', 1);   // higher prio than HE_D_VBD
  id2prio.set('LUV', 1);   // higher prio than spell checker
  id2prio.set('DAT', 1);   // higher prio than spell checker
  id2prio.set('MAC_OS', 1);   // higher prio than spell checker
  id2prio.set('BESTEST', 1);   // higher prio than spell checker
  id2prio.set('OFF_OF', 1);   // higher prio than ADJECTIVE_ADVERB
  id2prio.set('SHELL_COMPOUNDS', 1);   // higher prio than HELL
  id2prio.set('HANDS_ON_HYPHEN', 1);   // higher prio than A_NNS
  id2prio.set('PROFITS_WARNINGS', 1);   // higher prio than A_NNS
  id2prio.set('QUIET_QUITE', 1);   // higher prio than A_QUITE_WHILE
  id2prio.set('A_OK', 1);   // prefer over A_AN
  id2prio.set('I_A', 1);   // higher prio than I_IF
  id2prio.set('PRP_NO_VB', 1);   // higher prio than I_IF
  id2prio.set('GAVE_HAVE', 1);   // higher prio than MD_BASEFORM
  id2prio.set('THERE_FORE', 1);   // higher prio than FORE_FOR
  id2prio.set('FOLLOW_UP', 1);   // higher prio than MANY_NN
  id2prio.set('IT_SOMETHING', 1);   // higher prio than IF_YOU_ANY and IT_THE_PRP
  id2prio.set('NO_KNOW', 1);   // higher prio than DOUBLE_NEGATIVE
  id2prio.set('WILL_BASED_ON', 1);   // higher prio than MD_BASEFORM / PRP_PAST_PART
  id2prio.set('DON_T_AREN_T', 1);   // higher prio than DID_BASEFORM
  id2prio.set('WILL_BECOMING', 1);   // higher prio than MD_BASEFORM
  id2prio.set('WOULD_NEVER_VBN', 1);   // higher prio than MD_BASEFORM
  id2prio.set('MONEY_BACK_HYPHEN', 1);   // higher prio than A_UNCOUNTABLE
  id2prio.set('WORLDS_BEST', 1);   // higher prio than THE_SUPERLATIVE
  id2prio.set('STEP_COMPOUNDS', 1);   // higher prio than STARS_AND_STEPS
  id2prio.set('WON_T_TO', 1);   // higher prio than DON_T_AREN_T
  id2prio.set('WAN_T', 1);   // higher prio than DON_T_AREN_T
  id2prio.set('THE_US', 1);   // higher prio than DT_PRP
  id2prio.set('THE_IT', 1);   // higher prio than DT_PRP
  id2prio.set('THANK_YOU_MUCH', 1);   // higher prio than other rules
  id2prio.set('TO_DO_HYPHEN', 1);   // higher prio than other rules
  id2prio.set('A_NUMBER_NNS', 1);   // higher prio than A_NNS
  id2prio.set('A_HUNDREDS', 1);   // higher prio than A_NNS
  id2prio.set('NOW_A_DAYS', 1);   // higher prio than A_NNS
  id2prio.set('COUPLE_OF_TIMES', 1);   // higher prio than A_NNS
  id2prio.set('A_WINDOWS', 1);   // higher prio than A_NNS
  id2prio.set('A_SCISSOR', 1);   // higher prio than A_NNS
  id2prio.set('A_SNICKERS', 1);   // higher prio than A_NNS
  id2prio.set('A_NNS_BEST_NN', 1);   // higher prio than A_NNS
  id2prio.set('BACHELORS', 1);   // higher prio than A_NNS
  id2prio.set('WERE_WEAR', 1);   // higher prio than agreement rules
  id2prio.set('NEITHER_NOR', 1);   // higher prio than COMMA_COMPOUND_SENTENCE
  id2prio.set('FOR_AWHILE', 1);   // higher prio than COMMA_COMPOUND_SENTENCE
  id2prio.set('A_BUT', 1);   // higher prio than COMMA_COMPOUND_SENTENCE
  id2prio.set('BORN_IN', 1);   // higher prio than PRP_PAST_PART
  id2prio.set('DO_TO', 1);   // higher prio than HAVE_PART_AGREEMENT
  id2prio.set('CURIOS_CURIOUS', 1);   // higher prio than A_NNS and POSSESSIVE_APOSTROPHE
  id2prio.set('INCORRECT_POSSESSIVE_APOSTROPHE', 1);  // higher prio than THIS_NNS
  id2prio.set('THIS_YEARS_POSSESSIVE_APOSTROPHE', 1);  // higher prio than THIS_NNS
  id2prio.set('SPURIOUS_APOSTROPHE', 1);   // higher prio than THIS_NNS
  id2prio.set('BE_NOT_BE_JJ', 1);   // higher prio than BEEN_PART_AGREEMENT
  id2prio.set('IN_THIS_REGARDS', 1);   // higher prio than THIS_NNS
  id2prio.set('IT_SEAMS', 1);   // higher prio than THIS_NNS_VB
  id2prio.set('NO_WHERE', 1);   // higher prio than NOW
  id2prio.set('APOSTROPHE_VS_QUOTE', 1);   // higher prio than EN_QUOTES
  id2prio.set('ALL_OF_SUDDEN', 1);   // higher prio than ALL_MOST_SOME_OF_NOUN
  id2prio.set('COMMA_PERIOD', 1);   // higher prio than COMMA_PARENTHESIS_WHITESPACE
  id2prio.set('COMMA_CLOSING_PARENTHESIS', 1);   // higher prio than COMMA_PARENTHESIS_WHITESPACE
  id2prio.set('ELLIPSIS', 1);   // higher prio than COMMA_PARENTHESIS_WHITESPACE
  id2prio.set('HERE_HEAR', 1);   // higher prio than ENGLISH_WORD_REPEAT_RULE
  id2prio.set('MISSING_POSS_APOS', 1);   // higher prio than SINGULAR_NOUN_VERB_AGREEMENT
  id2prio.set('DO_HE_VERB', 1);   // prefer over HE_VERB_AGR
  id2prio.set('LIGATURES', 1);   // prefer over spell checker
  id2prio.set('APPSTORE', 1);   // prefer over spell checker
  id2prio.set('INCORRECT_CONTRACTIONS', 1);   // prefer over EN_CONTRACTION_SPELLING
  id2prio.set('DONT_T', 1);   // prefer over EN_CONTRACTION_SPELLING
  id2prio.set('WHATS_APP', 1);   // prefer over EN_CONTRACTION_SPELLING
  id2prio.set('NON_STANDARD_COMMA', 1);   // prefer over spell checker
  id2prio.set('NON_ENGLISH_CHARACTER_IN_A_WORD', 1);  // prefer over spell checker
  id2prio.set('WONT_CONTRACTION', 1);   // prefer over WONT_WANT
  id2prio.set('THAN_THANK', 1);   // prefer over THAN_THEN
  id2prio.set('SPURIOUS_APOSTROPHE', 1);   // prefer over CD_NN and LOWERCASE_NAME_APOSTROPHE_S
  id2prio.set('IT_IF', 1);   // needs higher prio than PRP_COMMA and IF_YOU_ANY
  id2prio.set('FINE_TUNE_COMPOUNDS', 1);   // prefer over less specific rules
  id2prio.set('WHAT_IS_YOU', 1);   // prefer over HOW_DO_I_VB, NON3PRS_VERB
  id2prio.set('SUPPOSE_TO', 1);   // prefer over HOW_DO_I_VB and I_AM_VB and ARE_WE_HAVE
  id2prio.set('CONFUSION_GONG_GOING', 1);   // prefer over I_AM_VB
  id2prio.set('SEEN_SEEM', 1);   // prefer over PRP_PAST_PART
  id2prio.set('PROFANITY', 1);   // prefer over spell checker (less prio than EN_COMPOUNDS)
  id2prio.set('PROFANITY_XML', 1);
  id2prio.set('GOOD_FLUCK', 2);   // prefer over PROFANITY
  id2prio.set('PROFANITY_TYPOS', 2);   // prefer over PROFANITY
  id2prio.set('THE_THEM', 1);   // prefer over TO_TWO
  id2prio.set('THERE_THEIR', 1);   // prefer over GO_TO_HOME
  id2prio.set('TO_WORRIED_ABOUT', 1);   // higher prio than TO_TOO
  id2prio.set('IT_IS_DEPENDING_ON', 1);   // prefer over PROGRESSIVE_VERBS
  id2prio.set('TO_NIGHT_TO_DAY', 1);   // prefer over TOO_JJ_TO
  id2prio.set('IRREGARDLESS', 1);   // prefer over spell checker
  id2prio.set('MD_APOSTROPHE_VB', 1);   // prefer over typography rules
  id2prio.set('ULTRA_HYPHEN', 1);   // prefer over EN_COMPOUND_ADJECTIVE_INTERNAL
  id2prio.set('THINK_BELIEVE_THAT', 1);
  id2prio.set('HAS_TO_APPROVED_BY', 1);   // prefer over TO_NON_BASE
  id2prio.set('MD_VBD', -1);  // prefer LOWERCASE_MONTHS
  id2prio.set('PRP_PRP', -1);  // prefer other rules that give a suggestion
  id2prio.set('IS_LIKELY_TO_BE', -1);  // give IS_RB_BE precedence (more suggestions)
  id2prio.set('WANNA', 1);   // prefer over spell checker
  id2prio.set('LOOK_FORWARD_TO', 1);   // prefer over LOOK_FORWARD_NOT_FOLLOWED_BY_TO
  id2prio.set('LOOK_SLIKE', 1);   // higher prio than prem:SINGULAR_NOUN_VERB_AGREEMENT
  id2prio.set('A3FT', 1);   // higher prio than NUMBERS_IN_WORDS
  id2prio.set('HYPHEN_TO_EN', 1);   // higher prio than DASH_RULE (due to one picky subrule)
  id2prio.set('EVERY_NOW_AND_THEN', 0);
  id2prio.set('EN_DIACRITICS_REPLACE_ORTHOGRAPHY', -1);   // prefer over spell checker, less prio than ATTACHE_ATTACH
  id2prio.set('MISSING_COMMA_BETWEEN_DAY_AND_YEAR', -1);   // less priority than DATE_WEEKDAY
  id2prio.set('FASTLY', -1);   // higher prio than spell checker
  id2prio.set('WHO_NOUN', -1);   // prefer SPECIFIC_CASE
  id2prio.set('ANYWAYS', -1);   // higher prio than spell checker
  id2prio.set('MISSING_GENITIVE', -1);  // prefer over spell checker (like EN_SPECIFIC_CASE)
  id2prio.set('EN_UNPAIRED_BRACKETS', -1);  // less priority than rules that suggest the correct brackets
  id2prio.set('WAKED_UP', -1);  // less priority than other grammar rules
  id2prio.set('NEEDS_FIXED', -1);  // less priority than MISSING_TO_BEFORE_A_VERB
  id2prio.set('SENT_START_NNP_COMMA', -1);  // prefer other more specific rules
  id2prio.set('SENT_START_NN_DT', -1);  // prefer MISSING_PREPOSITION
  id2prio.set('DT_PDT', -1);  // prefer other more specific rules
  id2prio.set('MD_VB_AND_NOTVB', -1);  // prefer other more specific rules
  id2prio.set('BLACK_SEA', -1);  // less priority than SEA_COMPOUNDS
  id2prio.set('A_TO', -1);  // less priority than other rules that offer suggestions
  id2prio.set('MANY_NN', -1);  // less priority than PUSH_UP_HYPHEN, SOME_FACULTY
  id2prio.set('WE_BE', -1);
  id2prio.set('A_LOT_OF_NN', -1);
  id2prio.set('REPETITIONS_STYLE', -51);  // repetition style rules, usually with prefix REP_
  id2prio.set('ORDER_OF_WORDS_WITH_NOT', -1);  // less prio than punctuation rules
  id2prio.set('ADVERB_WORD_ORDER_10_TEMP', 1);
  id2prio.set('ADVERB_WORD_ORDER', -1);  // less prio than PRP_PAST_PART //
  id2prio.set('HAVE_VB_DT', -1);
  id2prio.set('MD_PRP', -1);  // prefer ME_BE
  id2prio.set('IT_IS_2', -1);  // needs higher prio than BEEN_PART_AGREEMENT
  id2prio.set('A_RB_NN', -1);  // prefer other more specific rules (e.g. QUIET_QUITE, A_QUITE_WHILE)
  id2prio.set('DT_RB_IN', -1);  // prefer other more specific rules
  id2prio.set('VERB_NOUN_CONFUSION', -1);  // prefer other more specific rules
  id2prio.set('NOUN_VERB_CONFUSION', -1);  // prefer other more specific rules
  id2prio.set('PLURAL_VERB_AFTER_THIS', -1);  // prefer other more specific rules (e.g. COMMA_TAG_QUESTION)
  id2prio.set('BE_RB_BE', -1);  // prefer other more specific rules
  id2prio.set('IT_ITS', -1);  // prefer other more specific rules
  id2prio.set('ENGLISH_WORD_REPEAT_RULE', -1);  // prefer other more specific rules (e.g. IT_IT)
  id2prio.set('DT_JJ_NO_NOUN', -1);  // prefer other more specific rules (e.g. THIRD_PARTY)
  id2prio.set('AGREEMENT_SENT_START', -1);  // prefer other more specific rules
  id2prio.set('PREPOSITION_VERB', -1);  // prefer other more specific rules
  id2prio.set('EN_A_VS_AN', -1);  // prefer other more specific rules (with suggestions, e.g. AN_ALSO)
  id2prio.set('CD_NN', -1);  // prefer other more specific rules (with suggestions)
  id2prio.set('CD_NNU', -1);  // prefer other more specific rules (with suggestions)
  id2prio.set('ATD_VERBS_TO_COLLOCATION', -1);  // prefer other more specific rules (with suggestions)
  id2prio.set('ORDINAL_NUMBER_MISSING_ORDINAL_INDICATOR', -1);  // prefer other more specific rules (with suggestions)
  id2prio.set('ADVERB_OR_HYPHENATED_ADJECTIVE', -1);  // prefer other more specific rules (with suggestions)
  id2prio.set('GOING_TO_VBD', -1);  // prefer other more specific rules (with suggestions, e.g. GOING_TO_JJ)
  id2prio.set('MISSING_PREPOSITION', -1);  // prefer other more specific rules (with suggestions)
  id2prio.set('CHARACTER_APOSTROPHE_WORD', -1);  // prefer other more specific rules
  id2prio.set('SINGLE_CHARACTER', -1);  // prefer other more specific rules (with suggestions)
  id2prio.set('BE_TO_VBG', -1);  // prefer other more specific rules (with suggestions)
  id2prio.set('NON3PRS_VERB', -1);  // prefer other more specific rules (with suggestions, e.g. DONS_T)
  id2prio.set('DT_NN_VBG', -1);  // prefer other more specific rules (with suggestions)
  id2prio.set('NNS_THAT_ARE_JJ', -1);  // prefer other more specific rules
  id2prio.set('DID_FOUND_AMBIGUOUS', -1);  // prefer other more specific rules (e.g. TWO_CONNECTED_MODAL_VERBS)
  id2prio.set('BE_I_BE_GERUND', -1);  // prefer other more specific rules (with suggestions)
  id2prio.set('VBZ_VBD', -1);  // prefer other more specific rules (e.g. IS_WAS)
  id2prio.set('SUPERLATIVE_THAN', -1);  // prefer other more specific rules
  id2prio.set('UNLIKELY_OPENING_PUNCTUATION', -1);  // prefer other more specific rules
  id2prio.set('MD_DT_JJ', -1);  // prefer other more specific rules
  id2prio.set('I_IF', -1);  // prefer other more specific rules
  id2prio.set('NOUNPHRASE_VB_RB_DT', -1);  // prefer other more specific rules
  id2prio.set('SENT_START_NN_NN_VB', -1);  // prefer other more specific rules
  id2prio.set('VB_A_JJ_NNS', -1);  // prefer other more specific rules (e.g. A_NNS)
  id2prio.set('DUPLICATION_OF_IS_VBZ', -1);  // prefer other more specific rules (e.g. A_NNS)
  id2prio.set('METRIC_UNITS_EN_IMPERIAL', -1);  // prefer MILE_HYPHEN
  id2prio.set('IF_THEN_COMMA', -1);  // prefer CONFUSION_OF_THEN_THAN
  id2prio.set('COMMA_COMPOUND_SENTENCE', -1);  // prefer other rules
  id2prio.set('COMMA_COMPOUND_SENTENCE_2', -1);  // prefer other rules
  id2prio.set('BE_VBG_BE', -1);  // prefer other more specific rules
  id2prio.set('PRP_VB_VB', -1);  // prefer other more specific rules
  id2prio.set('FOR_ANY_CLARIFICATIONS', -1);  // prefer SENT_START_ALL_CAPITALS and ALL_UPPERCASE
  id2prio.set('PLEASE_LET_ME_KNOW', -1);  // prefer SENT_START_ALL_CAPITALS and ALL_UPPERCASE
  id2prio.set('UNNECESSARY_CAPITALIZATION', -1);  // prefer other more specific rules
  id2prio.set('CONFUSION_OF_A_JJ_NNP_NNS_PRP', -1);  // prefer other more specific rules
  id2prio.set('PLURALITY_CONFUSION_OF_NNS_OF_NN', -1); // prefer several compound rules
  id2prio.set('NP_TO_IS', -1);  // prefer other more specific rules
  id2prio.set('REPEATED_VERBS', -1);  // prefer other rules
  id2prio.set('NNP_COMMA_QUESTION', -2);  // prefer other more specific rules
  id2prio.set('THE_CC', -2);  // prefer other more specific rules (with suggestions)
  id2prio.set('PRP_VBG', -2);  // prefer other more specific rules (with suggestions, prefer over HE_VERB_AGR)
  id2prio.set('CANT_JJ', -2);  // prefer other more specific rules
  id2prio.set('WOULD_A', -2);  // prefer other more specific rules
  id2prio.set('I_AM_VB', -2);  // prefer other rules
  id2prio.set('VBP_VBP', -2);  // prefer more specific rules
  id2prio.set('GONNA_TEMP', -3);
  id2prio.set('A_INFINITIVE', -3);  // prefer other more specific rules (with suggestions, e.g. PREPOSITION_VERB, THE_TO)
  id2prio.set('INDIAN_ENGLISH', -3);  // prefer grammar rules, but higher prio than spell checker
  id2prio.set('DO_PRP_NOTVB', -3);  // prefer other more specific rules (e.g. HOW_DO_I_VB)
  id2prio.set('GONNA', -4);  // prefer over spelling rules
  id2prio.set('WHATCHA', -4);  // prefer over spelling rules
  id2prio.set('DONTCHA', -4);  // prefer over spelling rules
  id2prio.set('GOTCHA', -4);  // prefer over spelling rules
  id2prio.set('OUTTA', -4);  // prefer over spelling rules
  id2prio.set('Y_ALL', -4);  // prefer over spelling rules
  id2prio.set('GIMME', -4);  // prefer over spelling rules
  id2prio.set('LEMME', -4);  // prefer over spelling rules
  id2prio.set('ID_CASING', -4);  // prefer over spelling rules but not over ID_IS
  id2prio.set('MORFOLOGIK_RULE_EN_US', -10);  // more specific rules (e.g. L2 rules) have priority
  id2prio.set('MORFOLOGIK_RULE_EN_GB', -10);  // more specific rules (e.g. L2 rules) have priority
  id2prio.set('MORFOLOGIK_RULE_EN_CA', -10);  // more specific rules (e.g. L2 rules) have priority
  id2prio.set('MORFOLOGIK_RULE_EN_ZA', -10);  // more specific rules (e.g. L2 rules) have priority
  id2prio.set('MORFOLOGIK_RULE_EN_NZ', -10);  // more specific rules (e.g. L2 rules) have priority
  id2prio.set('MORFOLOGIK_RULE_EN_AU', -10);  // more specific rules (e.g. L2 rules) have priority
  id2prio.set('UPPERCASE_SENTENCE_START', -11);  // speller needs higher priority
  id2prio.set('MD_PRP_QUESTION_MARK', -11);  // speller needs higher priority
  id2prio.set('PRP_RB_NO_VB', -12);  // prefer other more specific rules (with suggestions)
  id2prio.set('MD_JJ', -12);  // prefer other rules (e.g. NOUN_VERB_CONFUSION)
  id2prio.set('HE_VERB_AGR', -12);  // prefer other more specific rules (e.g. AI models, PRP_VBG)
  id2prio.set('MD_BASEFORM', -12);  // prefer other more specific rules (e.g. AI models)
  id2prio.set('IT_VBZ', -12);  // prefer other more specific rules (e.g. AI models)
  id2prio.set('PRP_THE', -12);  // prefer other rules (e.g. AI models, I_A, PRP_JJ, IF_YOU_ANY, I_AN)
  id2prio.set('PRP_JJ', -12);  // prefer other rules (e.g. AI models, PRP_VBG, IT_IT and ADJECTIVE_ADVERB, PRP_ABLE, PRP_NEW, MD_IT_JJ)
  id2prio.set('SINGULAR_NOUN_VERB_AGREEMENT', -12);  // prefer other rules (e.g. AI models, PRP_VBG, IT_IT and ADJECTIVE_ADVERB, PRP_ABLE, PRP_NEW, MD_IT_JJ)
  id2prio.set('SINGULAR_AGREEMENT_SENT_START', -12);    // prefer AI
  id2prio.set('VB_TO_NN_DT', -12);  // prefer AI and other more specific rules (e.g. NOUN_VERB_CONFUSION)
  id2prio.set('SUBJECTVERBAGREEMENT_2', -12);    // prefer AI
  id2prio.set('THE_SENT_END', -12);    // prefer AI
  id2prio.set('DT_NN_ARE_AME', -12);    // prefer AI
  id2prio.set('COLLECTIVE_NOUN_VERB_AGREEMENT_VBP', -12);    // prefer AI
  id2prio.set('SUBJECT_VERB_AGREEMENT', -12);    // prefer AI
  id2prio.set('VERB_APOSTROPHE_S', -12);    // prefer AI
  id2prio.set('WHERE_MD_VB', -12);    // prefer AI
  id2prio.set('SENT_START_PRPS_JJ_NN_VBP', -12);  // prefer AI
  id2prio.set('TO_AFTER_MODAL_VERBS', -12);  // prefer AI
  id2prio.set('SINGULAR_NOUN_ADV_AGREEMENT', -12);  // prefer AI
  id2prio.set('BE_VBP_IN', -12);  // prefer over BEEN_PART_AGREEMENT but not over AI_EN_LECTOR
  id2prio.set('BE_VBG_NN', -12);  // prefer other more specific rules and speller
  id2prio.set('THE_NNS_NN_IS', -12);  // prefer HYDRA_LEO
  id2prio.set('IF_DT_NN_VBZ', -12);  // prefer HYDRA_LEO and lector
  id2prio.set('PRP_MD_NN', -12);  // prefer other more specific rules (e.g. MD_ABLE, WONT_WANT)
  id2prio.set('HAVE_PART_AGREEMENT', -13);  // prefer HYDRA_LEO and lector
  id2prio.set('BEEN_PART_AGREEMENT', -13);  // prefer HYDRA_LEO and lector
  id2prio.set('BE_WITH_WRONG_VERB_FORM', -14);  // prefer HYDRA_LEO, BEEN_PART_AGREEMENT and other rules
  id2prio.set('TWO_CONNECTED_MODAL_VERBS', -15);
  id2prio.set('PRP_NO_ADVERB_VERB', -15);  // prefer other more specific rules (e.g. PRP_VBG, IT_ITS, ...)
  id2prio.set('MISSING_TO_BETWEEN_BE_AND_VB', -15); // prefer AI and comma rules
  id2prio.set('IN_DT_IN', -15); // prefer AI and comma rules
  id2prio.set('MISSING_SUBJECT', -15);  // prefer other more specific rules
  id2prio.set('HAVE_TO_NOTVB', -15); // prefer AI and comma rules
  id2prio.set('PLEASE_DO_NOT_THE_CAT', -15); // prefer AI and comma rules
  id2prio.set('VB_TO_JJ', -15); // prefer AI and comma rules
  id2prio.set('CC_PRP_ARTICLE', -15);  // prefer other more specific rules
  id2prio.set('BE_MD', -20);  // prefer other more specific rules (e.g. BEEN_PART_AGREEMENT, HYDRA_LEO)
  id2prio.set('POSSESSIVE_APOSTROPHE', -10);  // prefer over AI_HYDRA_LEO_APOSTROPHE_S_XS (again, temporarily)
  id2prio.set('WANT_TO_NN', -25);  // prefer more specific rules that give a suggestion
  id2prio.set('QUESTION_WITHOUT_VERB', -25);  // prefer more specific rules that give a suggestion
  id2prio.set('PRP_VB', -25);  // prefer other rules (with suggestions, e.g. confusion rules)
  id2prio.set('PRP_VB_NN', -25);  // prefer other more specific rules (e.g. HYDRA_LEO)
  id2prio.set('BE_NN', -26);  // prefer other more specific rules (e.g. PRP_VB_NN, BEEN_PART_AGREEMENT, HYDRA_LEO)
  id2prio.set('BE_VB_OR_NN', -26);  // prefer other more specific rules (e.g. PRP_VB_NN, BE_MD, BEEN_PART_AGREEMENT, HYDRA_LEO)
  id2prio.set('DO_DT_NN_BE', -26);  // prefer other more specific rules (e.g. PRP_VB_NN, BE_MD, BEEN_PART_AGREEMENT, HYDRA_LEO)
  id2prio.set('PRONOUN_NOUN', -26);  // prefer other rules (with suggestions, e.g. confusion rules)
  id2prio.set('ETC_PERIOD', -49);  // prefer over QB rules that are now style
  id2prio.set('COULD_YOU_NOT_NEEDED', -49);  // prefer over TAKE_A_LOOK
  id2prio.set('SENTENCE_FRAGMENT', -50);  // prefer other more important sentence start corrections.
  id2prio.set('SENTENCE_FRAGMENT', -51);  // prefer other more important sentence start corrections.
  id2prio.set('SEEMS_TO_BE', -51);  // prefer SEEM_APPEAR
  id2prio.set('MD_NN', -60);  // prefer PRP_MD_NN
  id2prio.set('I_THINK_FEEL', -60);
  id2prio.set('KNOW_AWARE_REDO', -60);
  id2prio.set('EN_REDUNDANCY_REPLACE', -510);  // style rules should always have the lowest priority.
  id2prio.set('EN_PLAIN_ENGLISH_REPLACE', -511);  // style rules should always have the lowest priority.
  id2prio.set('REP_PASSIVE_VOICE', -599);  // higher prio than PASSIVE_VOICE for testing purposes, but lower than other style rules
  id2prio.set('FOUR_NN', -599);  // higher prio than THREE_NN for testing purposes, but lower than other style rules
  id2prio.set('THREE_NN', -600);  // style rules should always have the lowest priority.
  id2prio.set('SENT_START_NUM', -600);  // style rules should always have the lowest priority.
  id2prio.set('PASSIVE_VOICE', -600);  // style rules should always have the lowest priority.
  id2prio.set('EG_NO_COMMA', -600);  // style rules should always have the lowest priority.
  id2prio.set('IE_NO_COMMA', -600);  // style rules should always have the lowest priority.
  id2prio.set('REASON_WHY', -600);  // style rules should always have the lowest priority.
  id2prio.set(LongSentenceRule.RULE_ID, -997);
  id2prio.set(LongParagraphRule.RULE_ID, -998);
  id2prio.set('ALL_UPPERCASE', -1000);  // do not hide spelling and grammar issues, when text is all upper case	  

/**
 * Support for English - use the sub classes {@link BritishEnglish}, {@link AmericanEnglish},
 * etc. if you need spell checking.
 * Make sure to call {@link #close()} after using this (currently only relevant if you make
 * use of {@link EnglishConfusionProbabilityRule}).
 */
export class English extends LanguageWithModel {

  /**
   * @deprecated use {@link AmericanEnglish} or {@link BritishEnglish} etc. instead -
   *  they have rules for spell checking, this class doesn't (deprecated since 3.2)
   */
  constructor() {
    super();
  }

  override getDefaultLanguageVariant(): Language {
    return Languages.getLanguageForShortCode('en-US');  // AmericanEnglish.getInstance(), see the header
  }

  override createDefaultSentenceTokenizer(): SentenceTokenizer {
    return new SRXSentenceTokenizer(this);
  }

  override getName(): string {
    return 'English';
  }

  override getShortCode(): string {
    return 'en';
  }

  override getCountries(): string[] {
    return [];
  }

  override createDefaultTagger(): Tagger {
    return EnglishTagger.INSTANCE;
  }

  override createDefaultChunker(): Chunker | null {
    return new EnglishChunker();
  }

  override createDefaultSynthesizer(): Synthesizer | null {
    return EnglishSynthesizer.INSTANCE;
  }

  override createDefaultDisambiguator(): Disambiguator {
    return new EnglishHybridDisambiguator(this.getDefaultLanguageVariant());
  }

  override createDefaultWordTokenizer(): Tokenizer {
    return new EnglishWordTokenizer();
  }

  override getMaintainers(): Contributor[] {
    return [new Contributor('Mike Unwalla'), Contributors.MARCIN_MILKOWSKI, Contributors.DANIEL_NABER];
  }

  override getMaintainedState(): LanguageMaintainedState {
    return LanguageMaintainedState.ActivelyMaintained;
  }

  override getRelevantRules(messages: ResourceBundle, userConfig: UserConfig | null, motherTongue: Language | null, _altLanguages: Language[]): Rule[] {
    const allRules: Rule[] = [];
    if (motherTongue != null) {
      if ('de' === motherTongue.getShortCode()) {
        allRules.push(...cacheGetUnchecked('/org/languagetool/rules/en/grammar-l2-de.xml'));
      } else if ('fr' === motherTongue.getShortCode()) {
        allRules.push(...cacheGetUnchecked('/org/languagetool/rules/en/grammar-l2-fr.xml'));
      }
    }
    allRules.push(
        new CommaWhitespaceRule(messages,
                Example.wrong('We had coffee<marker> ,</marker> cheese and crackers and grapes.'),
                Example.fixed('We had coffee<marker>,</marker> cheese and crackers and grapes.')),
        new DoublePunctuationRule(messages, Tools.getUrl('https://languagetool.org/insights/post/punctuation-guide/#what-are-periods')),
        new UppercaseSentenceStartRule(messages, this,
                Example.wrong('This house is old. <marker>it</marker> was built in 1950.'),
                Example.fixed('This house is old. <marker>It</marker> was built in 1950.'),
                Tools.getUrl('https://languagetool.org/insights/post/spelling-capital-letters/')),
        new MultipleWhitespaceRule(messages, this),
        new SentenceWhitespaceRule(messages),
        new WhiteSpaceBeforeParagraphEnd(messages, this),
        new WhiteSpaceAtBeginOfParagraph(messages),
        new EmptyLineRule(messages, this),
        new LongSentenceRule(messages, userConfig, 40),
        new LongParagraphRule(messages, this, userConfig),
        //new OpenNMTRule(),     // commented out because of #903
        new ParagraphRepeatBeginningRule(messages, this),
        new PunctuationMarkAtParagraphEnd(messages, this),
        new PunctuationMarkAtParagraphEnd2(messages, this),
        // specific to English:
        new ConsistentApostrophesRule(messages),
        new EnglishSpecificCaseRule(messages),
        new EnglishUnpairedBracketsRule(messages, this),
        new EnglishUnpairedQuotesRule(messages, this),
        new EnglishWordRepeatRule(messages, this),
        new AvsAnRule(messages),
        new EnglishWordRepeatBeginningRule(messages, this),
        new CompoundRule(messages, this, userConfig),
        new ContractionSpellingRule(messages, this),
        new EnglishWrongWordInContextRule(messages, this),
        new EnglishDashRule(messages),
        new WordCoherencyRule(messages),
        new EnglishDiacriticsRule(messages),
        new EnglishPlainEnglishRule(messages),
        new EnglishRedundancyRule(messages),
        new SimpleReplaceRule(messages, this),
        new SimpleReplaceProfanityRule(messages, this),
        new ReadabilityRule(messages, this, userConfig, false),
        new ReadabilityRule(messages, this, userConfig, true),
        new EnglishRepeatedWordsRule(messages),
        new StyleTooOftenUsedVerbRule(messages, this, userConfig),
        new StyleTooOftenUsedNounRule(messages, this, userConfig),
        new StyleTooOftenUsedAdjectiveRule(messages, this, userConfig),
    );
    return allRules;
  }

  override hasNGramFalseFriendRule(motherTongue: Language | null): boolean {
    return motherTongue != null && (
      // Note: extend EnglishForL2SpeakersFalseFriendRuleTest.testMessageDetailData()
      // if you add a language here
      'de' === motherTongue.getShortCode() ||
      'fr' === motherTongue.getShortCode() ||
      'es' === motherTongue.getShortCode() ||
      'nl' === motherTongue.getShortCode());
  }

  /** @since 5.1 */
  override getOpeningDoubleQuote(): string {
    return '“';
  }

  /** @since 5.1 */
  override getClosingDoubleQuote(): string {
    return '”';
  }

  /** @since 5.1 */
  override getOpeningSingleQuote(): string {
    return '‘';
  }

  /** @since 5.1 */
  override getClosingSingleQuote(): string {
    return '’';
  }

  /** @since 5.1 */
  override isAdvancedTypographyEnabled(): boolean {
    return true;
  }

  protected override getDefaultRulePriorityForStyle(): number {
    return -50;
  }

  override getPriorityMap(): Map<string, number> {
    return id2prio;
  }

  protected override getPriorityForId(id: string): number {
    const prio = id2prio.get(id);
    if (prio !== undefined) {
      return prio;
    }
    if (id.startsWith('EN_COMPOUNDS_')) {
      return 2;
    }
    if (id === 'PRP_VBZ') {
      return -2; // prefer other more specific rules (with suggestions)
    }
    if (id.startsWith('CONFUSION_RULE_')) {
      return -20;
    }
    if (id === 'EN_UPPER_CASE_NGRAM') {
      return -12; // prefer other more specific rules (e.g. AI models)
    }
    if (id.startsWith('AI_SPELLING_RULE')) {
      return -9; // higher than MORFOLOGIK_*, for testing
    }
    if (id.startsWith('EN_MULTITOKEN_SPELLING_')) {
      return -9; // higher than MORFOLOGIK_*
    }
    if (id.startsWith('EN_GB_SIMPLE_REPLACE')) {
      return -5; // higher than MORFOLOGIK_*
    }
    if (id.startsWith('EN_US_SIMPLE_REPLACE')) {
      return -5; // higher than MORFOLOGIK_*
    }
    if (id === 'QB_EN_OXFORD') {
      return -51; // MISSING_COMMA_AFTER_YEAR
    }
    if (id.startsWith('EN_SIMPLE_REPLACE') &&
      (id.endsWith('GRAMME') || id.endsWith('GRAMMES'))) {
      return -49; // Higher prio than Oxford rule
    }
    if (id.startsWith('AI_HYDRA_LEO')) { // prefer more specific rules (also speller)
      if (id === 'AI_HYDRA_LEO_MISSING_COMMA') {
        return -51; // prefer comma style rules.
      }
      if (id.startsWith('AI_HYDRA_LEO_CP_YOU_YOUARE')) {
        return -1;
      }
      if (id.startsWith('AI_HYDRA_LEO_CP')) {
        return 2;
      }
      if (id.startsWith('AI_HYDRA_LEO_MISSING_TO')) {
        return -14; // prefer lector, HAVE_PART_AGREEMENT and BEEN_PART_AGREEMENT
      }
      return -11;
    }
    if (id.startsWith('AI_EN_LECTOR')) { // prefer more specific rules (also speller)
      return -11;
    }
    if ((FALSE_FRIENDS_PATTERN ??= Pattern.compile('EN_FOR_[A-Z]+_SPEAKERS_FALSE_FRIENDS.*')).matcher(id).matches()) {
      return -21;
    }
    return super.getPriorityForId(id);
  }

  override hasMinMatchesRules(): boolean {
    return true;
  }

  protected override createDefaultSpellingRule(messages: ResourceBundle): SpellingCheckRule | null {
      return new MorfologikAmericanSpellerRule(messages, this, null, null, [], null, null);  // (messages, this, null, emptyList())
  }

  override filterRuleMatches(ruleMatches: RuleMatch[], _text: AnnotatedText, _enabledRules: ReadonlySet<string>): RuleMatch[] {
    const newRuleMatches: RuleMatch[] = [];
    for (const rm of ruleMatches) {
      const errorStr = rm.getOriginalErrorStr();
      const suggestedReplacements = rm.getSuggestedReplacementObjects();
      const newReplacements: SuggestedReplacement[] = [];
      for (const suggestedReplacement of suggestedReplacements) {
        let newReplStr = suggestedReplacement.getReplacement();
        if (errorStr.length > 2) {
          // add a whitespace when the error is in a contraction and the suggestion is not
          if (errorStr.startsWith("'") && !newReplStr.startsWith("'") && !newReplStr.startsWith('’')
              && !newReplStr.startsWith(' ')) {
            newReplStr = ' ' + newReplStr;
          }
          if (errorStr.startsWith("n't") && !newReplStr.startsWith("n't") && !newReplStr.startsWith('n’t')) {
            newReplStr = ' ' + newReplStr;
          }
        }
        const newSuggestedReplacement = new SuggestedReplacement(suggestedReplacement);
        newSuggestedReplacement.setReplacement(newReplStr);
        if (!List_contains(newReplacements, newSuggestedReplacement)) {
          newReplacements.push(newSuggestedReplacement);
        }
      }
      const newMatch = new RuleMatch(rm, newReplacements);
      if (newMatch.getSpecificRuleId().startsWith('EN_SIMPLE_REPLACE') &&
        (newMatch.getSpecificRuleId().endsWith('GRAMME') || newMatch.getSpecificRuleId().endsWith('GRAMMES'))) {
        newMatch.getRule().setLocQualityIssueType(ITSIssueType.LocaleViolation);
      }
      newRuleMatches.push(newMatch);
    }
    return newRuleMatches;
  }

  override prepareLineForSpeller(line: string): string[] {
    const parts = StringSplit(line, '#');
    if (parts.length === 0) {
      return [line];
    }
    if (line.includes('+')) {
      // while the morfologik separator is "+", multiwords with '+' can cause undesired results.
      return [''];
    }
    const formTag = StringSplit(parts[0]!, '\t');
    const form = StringTrim(formTag[0]!);
    if (formTag.length > 1) {
      const tag = StringTrim(formTag[1]!);
      if (tag.startsWith('NN') || tag.startsWith('JJ')) {
        return [form];
      } else {
        return [''];
      }
    }
    return [line];
  }

  override getMultitokenSpeller(): EnglishMultitokenSpeller {
    return EnglishMultitokenSpeller.INSTANCE;
  }

}

Languages.register('org.languagetool.language.English', English);
