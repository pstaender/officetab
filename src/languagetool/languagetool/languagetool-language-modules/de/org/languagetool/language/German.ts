// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/language/German.java reduced
// Left out (server-only or not available in the browser): getRelevantLanguageModelRules
// (UpperCaseNgramRule, GermanConfusionProbabilityRule, ProhibitedCompoundRule: they need the
// ngram index, which LanguageWithModel never loads here).
// getDefaultLanguageVariant looks GermanyGerman up by its code (what GermanyGerman.getInstance
// does), as a value import of GermanyGerman, a subclass, would be an import cycle.
// getNonStrictCompoundSplitter returns the CompoundWordTokenizer lambda as a function.
import type { Language } from '../../../../../languagetool-core/org/languagetool/Language.ts';
import { LanguageMaintainedState } from '../../../../../languagetool-core/org/languagetool/LanguageMaintainedState.ts';
import { LanguageWithModel } from '../../../../../languagetool-core/org/languagetool/LanguageWithModel.ts';
import { Languages } from '../../../../../languagetool-core/org/languagetool/Languages.ts';
import { Tag } from '../../../../../languagetool-core/org/languagetool/Tag.ts';
import type { UserConfig } from '../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { Chunker } from '../../../../../languagetool-core/org/languagetool/chunking/Chunker.ts';
import { Contributor } from '../../../../../languagetool-core/org/languagetool/language/Contributor.ts';
import { Contributors } from '../../../../../languagetool-core/org/languagetool/language/Contributors.ts';
import type { AnnotatedText } from '../../../../../languagetool-core/org/languagetool/markup/AnnotatedText.ts';
import { EmptyLineRule } from '../../../../../languagetool-core/org/languagetool/rules/EmptyLineRule.ts';
import { Example } from '../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { LongParagraphRule } from '../../../../../languagetool-core/org/languagetool/rules/LongParagraphRule.ts';
import { MultipleWhitespaceRule } from '../../../../../languagetool-core/org/languagetool/rules/MultipleWhitespaceRule.ts';
import { PunctuationMarkAtParagraphEnd } from '../../../../../languagetool-core/org/languagetool/rules/PunctuationMarkAtParagraphEnd.ts';
import type { Rule } from '../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { UppercaseSentenceStartRule } from '../../../../../languagetool-core/org/languagetool/rules/UppercaseSentenceStartRule.ts';
import { WhiteSpaceAtBeginOfParagraph } from '../../../../../languagetool-core/org/languagetool/rules/WhiteSpaceAtBeginOfParagraph.ts';
import { WhiteSpaceBeforeParagraphEnd } from '../../../../../languagetool-core/org/languagetool/rules/WhiteSpaceBeforeParagraphEnd.ts';
import type { SpellingCheckRule } from '../../../../../languagetool-core/org/languagetool/rules/spelling/SpellingCheckRule.ts';
import type { Synthesizer } from '../../../../../languagetool-core/org/languagetool/synthesis/Synthesizer.ts';
import type { Tagger } from '../../../../../languagetool-core/org/languagetool/tagging/Tagger.ts';
import type { Disambiguator } from '../../../../../languagetool-core/org/languagetool/tagging/disambiguation/Disambiguator.ts';
import { SRXSentenceTokenizer } from '../../../../../languagetool-core/org/languagetool/tokenizers/SRXSentenceTokenizer.ts';
import type { SentenceTokenizer } from '../../../../../languagetool-core/org/languagetool/tokenizers/SentenceTokenizer.ts';
import type { Tokenizer } from '../../../../../languagetool-core/org/languagetool/tokenizers/Tokenizer.ts';
import { Tools } from '../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { GermanChunker } from '../chunking/GermanChunker.ts';
import { AgreementRule } from '../rules/de/AgreementRule.ts';
import { AgreementRule2 } from '../rules/de/AgreementRule2.ts';
import { CaseRule } from '../rules/de/CaseRule.ts';
import { CompoundCoherencyRule } from '../rules/de/CompoundCoherencyRule.ts';
import { CompoundInfinitivRule } from '../rules/de/CompoundInfinitivRule.ts';
import { ConjunctionAtBeginOfSentenceRule } from '../rules/de/ConjunctionAtBeginOfSentenceRule.ts';
import { DashRule } from '../rules/de/DashRule.ts';
import { DuUpperLowerCaseRule } from '../rules/de/DuUpperLowerCaseRule.ts';
import { GermanCommaWhitespaceRule } from '../rules/de/GermanCommaWhitespaceRule.ts';
import { GermanDoublePunctuationRule } from '../rules/de/GermanDoublePunctuationRule.ts';
import { GermanFillerWordsRule } from '../rules/de/GermanFillerWordsRule.ts';
import { GermanMultitokenSpeller } from '../rules/de/GermanMultitokenSpeller.ts';
import { GermanParagraphRepeatBeginningRule } from '../rules/de/GermanParagraphRepeatBeginningRule.ts';
import { GermanReadabilityRule } from '../rules/de/GermanReadabilityRule.ts';
import { GermanRepeatedWordsRule } from '../rules/de/GermanRepeatedWordsRule.ts';
import { GermanSpellerRule } from '../rules/de/GermanSpellerRule.ts';
import { GermanStyleRepeatedWordRule } from '../rules/de/GermanStyleRepeatedWordRule.ts';
import { GermanUnpairedBracketsRule } from '../rules/de/GermanUnpairedBracketsRule.ts';
import { GermanUnpairedQuotesRule } from '../rules/de/GermanUnpairedQuotesRule.ts';
import { GermanWordRepeatBeginningRule } from '../rules/de/GermanWordRepeatBeginningRule.ts';
import { GermanWordRepeatRule } from '../rules/de/GermanWordRepeatRule.ts';
import { GermanWrongWordInContextRule } from '../rules/de/GermanWrongWordInContextRule.ts';
import { LongSentenceRule } from '../rules/de/LongSentenceRule.ts';
import { MissingCommaRelativeClauseRule } from '../rules/de/MissingCommaRelativeClauseRule.ts';
import { MissingVerbRule } from '../rules/de/MissingVerbRule.ts';
import { NonSignificantVerbsRule } from '../rules/de/NonSignificantVerbsRule.ts';
import { OldSpellingRule } from '../rules/de/OldSpellingRule.ts';
import { PassiveSentenceRule } from '../rules/de/PassiveSentenceRule.ts';
import { RedundantModalOrAuxiliaryVerb } from '../rules/de/RedundantModalOrAuxiliaryVerb.ts';
import { SentenceWhitespaceRule } from '../rules/de/SentenceWhitespaceRule.ts';
import { SentenceWithManRule } from '../rules/de/SentenceWithManRule.ts';
import { SentenceWithModalVerbRule } from '../rules/de/SentenceWithModalVerbRule.ts';
import { SimilarNameRule } from '../rules/de/SimilarNameRule.ts';
import { SimpleReplaceRule } from '../rules/de/SimpleReplaceRule.ts';
import { StyleRepeatedSentenceBeginning } from '../rules/de/StyleRepeatedSentenceBeginning.ts';
import { StyleRepeatedVeryShortSentences } from '../rules/de/StyleRepeatedVeryShortSentences.ts';
import { StyleTooOftenUsedAdjectiveRule } from '../rules/de/StyleTooOftenUsedAdjectiveRule.ts';
import { StyleTooOftenUsedNounRule } from '../rules/de/StyleTooOftenUsedNounRule.ts';
import { StyleTooOftenUsedVerbRule } from '../rules/de/StyleTooOftenUsedVerbRule.ts';
import { SubjectVerbAgreementRule } from '../rules/de/SubjectVerbAgreementRule.ts';
import { UnitConversionRule } from '../rules/de/UnitConversionRule.ts';
import { UnnecessaryPhraseRule } from '../rules/de/UnnecessaryPhraseRule.ts';
import { VerbAgreementRule } from '../rules/de/VerbAgreementRule.ts';
import { WiederVsWiderRule } from '../rules/de/WiederVsWiderRule.ts';
import { WordCoherencyRule } from '../rules/de/WordCoherencyRule.ts';
import { GermanSynthesizer } from '../synthesis/GermanSynthesizer.ts';
import { GermanTagger } from '../tagging/de/GermanTagger.ts';
import { GermanRuleDisambiguator } from '../tagging/disambiguation/rules/de/GermanRuleDisambiguator.ts';
import { GermanCompoundTokenizer } from '../tokenizers/de/GermanCompoundTokenizer.ts';
import { GermanWordTokenizer } from '../tokenizers/de/GermanWordTokenizer.ts';
import type { ResourceBundle } from '../../../../../../jdk/java/util/ResourceBundle.ts';
import { Objects_requireNonNull } from '../../../../../../jdk/java/util/Objects.ts';
import { Pattern, StringReplaceAll, StringSplit } from '../../../../../../jdk/java/util/regex/Pattern.ts';

let patterns: { TYPOGRAPHY_PATTERN: Pattern; AI_DE_GGEC_MISSING_PUNCT: Pattern } | null = null;
const P = () => (patterns ??= {
  TYPOGRAPHY_PATTERN: Pattern.compile('\\b([a-zA-Z]\\.)([a-zA-Z]\\.)'),
  AI_DE_GGEC_MISSING_PUNCT:
    Pattern.compile('AI_DE_GGEC_MISSING_PUNCTUATION_\\d+_DASH_J(_|AE)HRIG|AI_DE_GGEC_REPLACEMENT_CONFUSION', Pattern.CASE_INSENSITIVE),
});
const GERMAN_SHORT_CODE = 'de';

const id2prio = new Map<string, number>();
  id2prio.set('DE_PROHIBITED_PHRASE', 11);
  id2prio.set('WRONG_SPELLING_PREMIUM_INTERNAL', 10);
  id2prio.set('OLD_SPELLING_RULE', 10);
  id2prio.set('DE_COMPOUNDS', 10);
  id2prio.set('E_MAIL_SIGNATUR', 10);
  id2prio.set('TELEFON_NR', 10);
  id2prio.set('IRGEND_COMPOUND', 10);
  id2prio.set('DA_DURCH', 2); // prefer over SUBSTANTIVIERUNG_NACH_DURCH and DURCH_SCHAUEN and DURCH_WACHSEN
  id2prio.set('BEI_GOOGLE', 2);   // prefer over agreement rules and VOR_BEI
  id2prio.set('EINE_ORIGINAL_RECHNUNG_TEST', 2);   // prefer over agreement rules
  id2prio.set('VON_SEITEN_RECOMMENDATION', 2);   // prefer over AI_DE_GGEC_UNNECESSARY_ORTHOGRAPHY_SPACE
  id2prio.set('AUFFORDERUNG_SIE', 2);   // prefer over AI_DE_GGEC_REPLACEMENT_ORTHOGRAPHY_LOWERCASE
  id2prio.set('WEIS_ICH', 2);   // prefer over AI_DE_GGEC_*
  id2prio.set('VONSTATTEN_GEHEN', 2);   // prefer over EINE_ORIGINAL_RECHNUNG
  id2prio.set('VERWECHSLUNG_MIR_DIR_MIR_DIE', 1); // prefer over MIR_DIR
  id2prio.set('ERNEUERBARE_ENERGIEN', 1); // prefer over VEREINBAREN
  id2prio.set('DRIVE_IN', 1); // prefer over agreement rules
  id2prio.set('DIES_MAL', 1); // prefer over GROSSSCHREIBUNG_MAL
  id2prio.set('AN_STATT', 1); // prefer over agreement rules
  id2prio.set('VOR_BEI', 1); // prefer over BEI_BEHALTEN
  id2prio.set('SUB_VER_KLEIN', 1); // prefer over casing rules
  id2prio.set('ALLES_GUTE', 1); // prefer over premium rules
  id2prio.set('NEUN_NEUEN', 1); // prefer over VIELZAHL_PLUS_SINGULAR
  id2prio.set('VERWANDET_VERWANDTE', 1); // prefer over DE_CASE
  id2prio.set('IN_DEUTSCHE_SPRACHE', 1); // prefer over most other rules
  id2prio.set('SCHMIERE_STEHEN', 1); // prefer over most other rules
  id2prio.set('UEBER_EIN_MANGEL', 1); // prefer over PRAEP_AKK
  id2prio.set('SEIT_LAENGEREN', 1); // prefer over DE_CASE
  id2prio.set('WIR_GEFUEHL', 1); // prefer over DE_CASE
  id2prio.set('VORHER_NACHHER_BILD', 1); // prefer over DE_CASE
  id2prio.set('SEIT_KLEIN_AUF', 1); // prefer over agreement rules
  id2prio.set('SEIT_GEBURT_AN', 1); // prefer over agreement rules
  id2prio.set('WO_VON', 1); // prefer over most agreement rules
  id2prio.set('ICH_BIN_STAND_JETZT_KOMMA', 1); // prefer over most agreement rules
  id2prio.set('EIN_LOGGEN', 1); // prefer over most agreement rules
  id2prio.set('ZU_GENÜGE', 1);   // prefer over ZU_KOENNE
  id2prio.set('SEIT_BEKANNT_WERDEN', 1);   // prefer over agreement and comma rules
  id2prio.set('IMPFLICHT', 1);   // prefer over agreement rules DE_AGREEMENT
  id2prio.set('NULL_KOMMA_NICHTS', 1);   // prefer over agreement rules
  id2prio.set('ZWEI_AN_HALB', 1);   // prefer over agreement rules
  id2prio.set('BLUETOOTH_LAUTSPRECHER', 1);   // prefer over agreement rules
  //id2prio.set('KOENNT_ICH', 1);   // prefer over DE_VERBAGREEMENT
  id2prio.set('WIR_HABE', 1);   // prefer over DE_VERBAGREEMENT
  id2prio.set('DAS_IST_GLAUBE_ICH_EGAL', 1);   // prefer over agreement rules
  id2prio.set('ICH_KOENNT', 1);   // prefer over DE_VERBAGREEMENT
  id2prio.set('HAT_DU', 1);   // prefer over agreement rules
  id2prio.set('HAST_DICH', 1);   // prefer over agreement rules
  id2prio.set('GRUNDE', 1);   // prefer over agreement rules
  id2prio.set('EIN_FACH', 1);   // prefer over agreement rules
  id2prio.set('WOGEN_SUBST', 1);   // prefer over agreement rules
  id2prio.set('SO_WIES_IST', 1);   // prefer over agreement rules
  id2prio.set('SICH_SICHT', 1);   // prefer over agreement rules
  id2prio.set('MIT_VERANTWORTLICH', 1);   // prefer over agreement rules
  id2prio.set('VOR_LACHEN', 1);   // prefer over ZUSAMMENGESETZTE_VERBEN
  id2prio.set('TOUREN_SUBST', 1);   // prefer over ZUSAMMENGESETZTE_VERBEN
  id2prio.set('AUF_DRÄNGEN', 1);   // prefer over ZUSAMMENGESETZTE_VERBEN
  id2prio.set('AUF_ZACK', 1);   // prefer over ZUSAMMENGESETZTE_VERBEN
  id2prio.set('UNTER_DRUCK', 1);   // prefer over ZUSAMMENGESETZTE_VERBEN
  id2prio.set('ZUCCHINIS', 1);   // overwrite spell checker
  id2prio.set('PASSWORTE', 1);   // overwrite agreement rules
  id2prio.set('ANGL_PA_ED_UNANGEMESSEN', 1);   // overwrite spell checker
  id2prio.set('ANFUEHRUNGSZEICHEN_DE_AT', 1); // higher prio than UNPAIRED_BRACKETS
  id2prio.set('ANFUEHRUNGSZEICHEN_CH_FR', 1); // higher prio than UNPAIRED_BRACKETS
  id2prio.set('EMAIL', 1);  // better suggestion than SIMPLE_AGREEMENT_*
  id2prio.set('IM_STICH_LASSEN', 1);  // higher prio than agreement rules
  id2prio.set('ZULANGE', 1);  // better suggestion than SAGT_RUFT
  id2prio.set('ROCK_N_ROLL', 1);  // better error than DE_CASE
  id2prio.set('JOE_BIDEN', 1);  // better error than DE_CASE
  //id2prio.set('RESOURCE_RESSOURCE', 1);  // better error than DE_CASE
  id2prio.set('ANS_OHNE_APOSTROPH', 1);
  id2prio.set('DIESEN_JAHRES', 1);
  id2prio.set('TAG_EIN_TAG_AUS', 1); // prefer over agreement rules
  id2prio.set('WERT_SEIN', 1); // prefer over DE_AGREEMENT
  id2prio.set('EBEN_FALLS', 1);
  //id2prio.set('DA_DRAUS', 1);
  id2prio.set('AUSSER_ORDENTLICH', 1);
  id2prio.set('IN_UND_AUSWENDIG', 1); // prefer over DE_CASE
  id2prio.set('HIER_MIT', 1); // prefer over agreement rules
  id2prio.set('HIER_FUER', 1); // prefer over agreement rules
  id2prio.set('MIT_REISSEN', 1); // prefer over agreement rules
  id2prio.set('JEDEN_FALLS', 1);
  id2prio.set('MOEGLICHER_WEISE_ETC', 1); // prefer over agreement rules
  id2prio.set('UST_ID', 1);
  id2prio.set('INS_FITNESS', 1); // prefer over DE_AGREEMENT
  id2prio.set('MIT_UNTER', 1); // prefer over agreement rules
  id2prio.set('SEIT_VS_SEID', 1); // prefer over some agreement rules (HABE_BIN from premium)
  id2prio.set('ZU_KOMMEN_LASSEN', 1); // prefer over INFINITIVGRP_VERMOD_PKT
  id2prio.set('ZU_SCHICKEN_LASSEN', 1); // prefer over INFINITIVGRP_VERMOD_PKT
  id2prio.set('IM_UM', 1); // prefer over MIT_MIR and IM_ERSCHEINUNG (premium)
  id2prio.set('EINEN_VERSUCH_WERT', 1); // prefer over DE_AGREEMENT
  id2prio.set('DASS_DAS_PA2_DAS_PROIND', 1); // prefer over HILFSVERB_HABEN_SEIN, DE_AGREEMENT
  id2prio.set('AUF_BITTEN', 1); // prefer over ZUSAMMENGESETZTE_VERBEN
  id2prio.set('MEINET_WEGEN', 1); // prefer over AUF_DEM_WEG
  id2prio.set('FUER_INSBESONDERE', 1); // prefer over KOMMA_VOR_ERLAEUTERUNG
  id2prio.set('COVID_19', 1); // prefer over PRAEP_GEN and DE_AGREEMENT
  id2prio.set('DA_VOR', 1); // prefer over ZUSAMMENGESETZTE_VERBEN
  id2prio.set('DAS_WUENSCHE_ICH', 1); // prefer over DE_AGREEMENT
  id2prio.set('KLEINSCHREIBUNG_MAL', 1); // prefer over DE_AGREEMENT
  id2prio.set('VERINF_DAS_DASS_SUB', 1); // prefer over DE_AGREEMENT
  id2prio.set('IM_ALTER', 1); // prefer over ART_ADJ_SOL
  id2prio.set('DAS_ALTER', 1); // prefer over ART_ADJ_SOL
  id2prio.set('VER_INF_PKT_VER_INF', 1); // prefer over DE_CASE
  id2prio.set('DASS_MIT_VERB', 1); // prefer over SUBJUNKTION_KOMMA ("Dass wird Konsequenzen haben.")
  id2prio.set('AB_TEST', 1); // prefer over spell checker and agreement
  id2prio.set('BZGL_ABK', 1); // prefer over spell checker
  id2prio.set('DURCH_WACHSEN', 1); // prefer over SUBSTANTIVIERUNG_NACH_DURCH
  //id2prio.set('ICH_WARTE', 1); // prefer over verb agreement rules (e.g. SUBJECT_VERB_AGREEMENT)
  id2prio.set('RUNDUM_SORGLOS_PAKET', 1); // higher prio than DE_CASE
  id2prio.set('MIT_FREUNDLICHEN_GRUESSE', 1); // higher prio than MEIN_KLEIN_HAUS
  id2prio.set('OK', 1); // higher prio than KOMMA_NACH_PARTIKEL_SENT_START[3]
  id2prio.set('EINE_ORIGINAL_RECHNUNG', 1); // higher prio than DE_CASE, DE_AGREEMENT and MEIN_KLEIN_HAUS
  //id2prio.set('VALENZ_TEST', 1); // see if this generates more corpus matches
  id2prio.set('WAEHRUNGSANGABEN_CHF', 1); // higher prio than WAEHRUNGSANGABEN_KOMMA
  // default is 0
  id2prio.set('FALSCHES_ANFUEHRUNGSZEICHEN', -1); // less prio than most grammar rules but higher prio than UNPAIRED_BRACKETS
  id2prio.set('VER_KOMMA_PRO_RIN', -1); // prefer WENN_WEN
  id2prio.set('VER_INF_VER_INF', -1); // prefer id2prio.put(rules
  id2prio.set('DE_COMPOUND_COHERENCY', -1);  // prefer EMAIL
  id2prio.set('GEFEATURED', -1); // prefer over spell checker
  id2prio.set('NUMBER_SUB', -1); // prefer over spell checker
  id2prio.set('MFG', -1); // prefer over spell checker
  id2prio.set('VER123_VERAUXMOD', -1); // prefer casing rules
  id2prio.set('DE_AGREEMENT', -1);  // prefer RECHT_MACHEN, MONTAGS, KONJUNKTION_DASS_DAS, DESWEITEREN, DIES_BEZUEGLICH and other
  id2prio.set('DE_AGREEMENT2', -1);  // prefer WILLKOMMEN_GROSS and other rules that offer suggestions
  id2prio.set('KOMMA_NEBEN_UND_HAUPTSATZ', -1);  // prefer SAGT_RUFT
  id2prio.set('FALSCHES_RELATIVPRONOMEN', -1); // prefer dass/das rules
  id2prio.set('AKZENT_STATT_APOSTROPH', -1);  // lower prio than PLURAL_APOSTROPH
  id2prio.set('BEENDE_IST_SENTEND', -1); // prefer more specific rules
  id2prio.set('VER_ADJ_ZU_SCHLAFEN', -1); // prefer ETWAS_GUTES
  id2prio.set('LT_RECOMMENDATION', -1);  // prefer over AI_DE_GGEC_MISSING_ORTHOGRAPHY_SPACE
  id2prio.set('MIO_PUNKT', -1); // higher prio than spell checker
  id2prio.set('AUSLASSUNGSPUNKTE_LEERZEICHEN', -1); // higher prio than spell checker
  id2prio.set('IM_ERSCHEINUNG_SPELLING_RULE', -1); // prefer ZUM_FEM_NOMEN
  id2prio.set('SPACE_BEFORE_OG', -1); // higher prio than spell checker
  id2prio.set('VERSEHENTLICHERWEISE', -1); // higher prio than spell checker
  id2prio.set('VERMOD_SKIP_VER_PKT', -1); // less prio than casing rules
  id2prio.set('N_NETTER_TYP', -1); // higher prio than EINZELBUCHSTABE_PREMIUM and speller
  id2prio.set('EINZELBUCHSTABE_PREMIUM', -2);  // lower prio than "A_LA_CARTE"
  id2prio.set('ART_IND_ADJ_SUB', -2);  // prefer DE_AGREEMENT rules
  id2prio.set('KATARI', -2); // higher prio than spell checker
  id2prio.set('SCHOENE_WETTER', -2); // prefer more specific rules that offer a suggestion (e.g. DE_AGREEMENT)
  id2prio.set('MEIN_KLEIN_HAUS', -2); // prefer more specific rules that offer a suggestion (e.g. DIES_BEZÜGLICH)
  id2prio.set('UNPAIRED_BRACKETS', -2);
  id2prio.set('DE_UNPAIRED_QUOTES', -2); // less prio than FALSCHES_ANFUEHRUNGSZEICHEN
  id2prio.set('ICH_GLAUBE_FUER_EUCH', -2); // prefer agreement rules
  id2prio.set('OBJECT_AGREEMENT', -2); // less prio than DE_AGREEMENT
  id2prio.set('ICH_INF_PREMIUM', -2); // prefer more specific rules that offer a suggestion (e.g. SUBJECT_VERB_AGREEMENT)
  id2prio.set('MEHRERE_WOCHE_PREMIUM', -2);  // less prio than DE_AGREEMENT
  id2prio.set('DOPPELTER_NOMINATIV', -2);  // give precedence to wie-wir-wird confusion rules
  id2prio.set('KUDAMM', -2);   // overwrite spell checker
  id2prio.set('ALTERNATIVEN_FUER_ANGLIZISMEN', -2);   // overwrite spell checker
  //id2prio.set('ANGLIZISMUS_INTERNAL', -2);   // overwrite spell checker
  id2prio.set('DOPPELUNG_VER_MOD_AUX', -2);
  //id2prio.set('AERZTEN_INNEN', -2);  // overwrite speller ("Ärzte/-innen")
  id2prio.set('ANGLIZISMEN', -2);   // overwrite spell checker
  id2prio.set('ANGLIZISMUS_PA_MIT_ED', -2);   // overwrite spell checker
  id2prio.set('MEINSTE', -2);   // overwrite spell checker
  //id2prio.set('ZAHL_IM_WORT', -2); //should not override rules like H2O
  id2prio.set('ICH_LIEBS', -2);  // higher prio than spell checker
  id2prio.set('WENNS_UND_ABERS', -2);  // higher prio than spell checker
  id2prio.set('ABERS_SATZANFANG_SPELLING_RULE', -2);  // higher prio than spell checker
  id2prio.set('VERNEB', -2);  // higher prio than spell checker
  id2prio.set('ZAHL_IM_WORT_SPELLING_RULE', -2); // higher prio than spell checker
  id2prio.set('GERMAN_SPELLER_RULE', -3);  // assume most other rules are more specific and helpful than the spelling rule
  id2prio.set('AUSTRIAN_GERMAN_SPELLER_RULE', -3);  // assume most other rules are more specific and helpful than the spelling rule
  id2prio.set('SWISS_GERMAN_SPELLER_RULE', -3);  // assume most other rules are more specific and helpful than the spelling rule
  id2prio.set('DE_VERBAGREEMENT', -4); // prefer more specific rules (e.g DU_WUENSCHT) and speller
  id2prio.set('UPPERCASE_SENTENCE_START', -4);  // prefer speller
  id2prio.set('PUNKT_ENDE_DIREKTE_REDE', -4); // prefer speller
  id2prio.set('LEERZEICHEN_NACH_VOR_ANFUEHRUNGSZEICHEN', -4); // prefer speller
  id2prio.set('ZEICHENSETZUNG_DIREKTE_REDE', -4); // prefer speller
  id2prio.set('GROSSSCHREIBUNG_WOERTLICHER_REDE', -4); // prefer speller
  id2prio.set('IM_IHM_SPELLING_RULE', -4);  // lower prio than spell checker
  id2prio.set('IN_UNKNOWNKLEIN_VER', -4);  // lower prio than spell checker
  id2prio.set('SEHR_GEEHRTER_NAME', -4);  // lower prio than spell checker
  id2prio.set('DE_PHRASE_REPETITION', -4);  // lower prio than spell checker
  id2prio.set('FRAGEZEICHEN_NACH_DIREKTER_REDE', -4);  // lower prio than spell checker
  id2prio.set('PUNCTUATION_PARAGRAPH_END', -4);  // don't hide spelling mistakes
  id2prio.set('F_ANSTATT_PH_2', -4);  // don't hide spelling mistakes
  id2prio.set('DAS_WETTER_IST', -5); // lower prio than spell checker
  id2prio.set('VEREIZ_VERINF_PKT', -5); // lower prio than spell checker
  id2prio.set('WER_STARK_SCHWITZ', -5); // lower prio than spell checker
  id2prio.set('VERBEN_PRAEFIX_AUS', -5); // lower prio than spell checker
  id2prio.set('ANFUEHRUNG_VERSCHACHTELT', -5);  // lower prio than speller and FALSCHES_ANFUEHRUNGSZEICHEN
  id2prio.set('SATZBAU_AN_DEN_KOMMT', -5);  // lower prio than rules that give a suggestion
  id2prio.set('SUBJECT_VERB_AGREEMENT', -5); // prefer more specific rules that offer a suggestion (e.g. DE_VERBAGREEMENT)
  id2prio.set('SAGT_SAGT', -9); // higher prio than KOMMA_ZWISCHEN_HAUPT_UND_NEBENSATZ_2 and GERMAN_WORD_REPEAT_RULE
  //id2prio.set('PUNKT_ENDE_ABSATZ', -10);  // should never hide other errors, as chance for a false alarm is quite high
  //id2prio.set('KOMMA_VOR_RELATIVSATZ', -10);
  id2prio.set('VON_LEBENSLAEUFE_SPELLING_RULE', -12); // less prio than AI
  id2prio.set('VER_WER_VER_3', -12); // less prio than AI
  id2prio.set('PA_WAS', -12); // less prio than AI
  id2prio.set('ICH_GEHE_DU_BLEIBST', -12); // prefer ICH_GLAUBE_FUER_EUCH and less prio than AI
  id2prio.set('PROPERNOMSIN_VERIMPSIN', -12); // less prio than AI
  id2prio.set('DIESE_HABE_ER_BELEIDIGTE', -12); // less prio than AI
  id2prio.set('VER123_VERAUXMOD_TEST1', -12); // less prio than AI to produce a single suggestion
  id2prio.set('ZUSAMMENGESETZTE_VERBEN', -12); // less prio than most more specific rules and AI
  id2prio.set('PRP_VER_PRGK', -13); // lower prio than ZUSAMMENGESETZTE_VERBEN
  id2prio.set('COMMA_IN_FRONT_RELATIVE_CLAUSE', -13); // prefer other rules (KONJUNKTION_DASS_DAS, ALL_DAS_WAS_KOMMA, AI) but higher prio than style
  id2prio.set('SAGT_RUFT', -13); // prefer id2prio.put(rules, DE_VERBAGREEMENT, AI and speller
  id2prio.set('KANNST_WERDEN', -13); // prefer more specific rules that offer a suggestion (A.I., spelling)
  id2prio.set('KOMMA_ZWISCHEN_HAUPT_UND_NEBENSATZ_2', -14); // lower prio than SAGT_SAGT, but higher than GERMAN_WORD_REPEAT_RULE
  id2prio.set('MAN_SIEHT_SEHR_SCHOEN', -14); // prefer over SEHR_SCHOEN
  id2prio.set('BEI_VERB', -14); // prefer case, spelling and AI rules
  id2prio.set('MODALVERB_FLEKT_VERB', -14); // prefer case, spelling and AI rules
  id2prio.set('DATIV_NACH_PRP', -14); // spelling and AI rules
  id2prio.set('DAT_ODER_AKK_NACH_PRP', -14); // prefer more specific rules that offer a suggestion (A.I., spelling)
  id2prio.set('SENT_START_SIN_PLU', -14); // prefer more specific rules that offer a suggestion (A.I., spelling)
  id2prio.set('SENT_START_PLU_SIN', -14); // prefer more specific rules that offer a suggestion (A.I., spelling)
  id2prio.set('VER_INFNOMEN', -14);  // prefer spelling and AI rules
  id2prio.set('GERMAN_WORD_REPEAT_RULE', -15); // lower prio than SAGT_RUFT and KOMMA_ZWISCHEN_HAUPT_UND_NEBENSATZ_2
  id2prio.set('TOO_LONG_PARAGRAPH', -15);
  id2prio.set('ALL_UPPERCASE', -15);
  id2prio.set('NUR_LEDIGLICH', -16); // lower prio than GERMAN_WORD_REPEAT_RULE
  id2prio.set('STYLE_KEINE_AHNUNG', -16); // lower prio than MUSSTE_IHM_HELFEN
  id2prio.set('COMMA_BEHIND_RELATIVE_CLAUSE', -52); // less prio than AI_DE_HYDRA_LEO
  id2prio.set('DOPPELUNG_MODALVERB', -52); // prefer comma rules (DOPPELUNG_MODALVERB, AI)
  id2prio.set('VER_DOPPELUNG', -52); // prefer comma rules (including AI)
  id2prio.set('DEF_ARTIKEL_INDEF_ADJ', -52); // less prio than DE_AGREMEENT and less prio than most comma rules
  id2prio.set('PRP_ADJ_AGREEMENT', -52); // less prio than DE_AGREMEENT and less prio than most comma rules
  id2prio.set('SIE_WOLLTEN_SIND', -52);
  id2prio.set('ART_ADJ_SOL', -52); // prefer comma rules
  id2prio.set('WURDEN_WORDEN_1', -52); // prefer comma rules
  id2prio.set('WAR_WAHR', -52); // higher prio than KOMMA_ZWISCHEN_HAUPT_UND_NEBENSATZ
  id2prio.set('KOMMA_ZWISCHEN_HAUPT_UND_NEBENSATZ', -53);
  id2prio.set('VERB_IST', -53); // less prio than comma rules and spell checker
  id2prio.set('WAR_WERDEN', -53); // less prio than comma rules
  id2prio.set('INF_VER_MOD_SPELLING_RULE', -53); // prefer case, spelling and AI rules
  id2prio.set('DOPPELTES_VERB', -53); // prefer comma rules (including AI)
  id2prio.set('VERB_FEM_SUBST', -54); // prefer comma rules (including AI)
  id2prio.set('SUBJUNKTION_KOMMA_2', -54); // lower prio than KOMMA_ZWISCHEN_HAUPT_UND_NEBENSATZ and KOMMA_ZWISCHEN_HAUPT_UND_NEBENSATZ_2
  id2prio.set('DOPPELUNG_GLEICHES_VERB', -55); // prefer comma rules
  id2prio.set('FEHLENDES_NOMEN', -60); // lower prio than most rules
  id2prio.set('REPETITIONS_STYLE', -60);
  id2prio.set('GERMAN_WORD_REPEAT_BEGINNING_RULE', -61); 
  // Category ids - make sure style issues don't hide overlapping "real" errors:
  id2prio.set('TYPOGRAPHY', -14);
  id2prio.set('COLLOQUIALISMS', -15);
  id2prio.set('STYLE', -15);
  id2prio.set('REDUNDANCY', -15);
  id2prio.set('GENDER_NEUTRALITY', -15);

/**
 * Support for German - use the sub classes {@link GermanyGerman}, {@link SwissGerman}, or {@link AustrianGerman}
 * if you need spell checking.
 */
export class German extends LanguageWithModel {

  /**
   * @deprecated use {@link GermanyGerman}, {@link AustrianGerman}, or {@link SwissGerman} instead -
   *  they have rules for spell checking, this class doesn't (deprecated since 3.2)
   */
  constructor() {
    super();
  }

  override getDefaultLanguageVariant(): Language {
    return Languages.getLanguageForShortCode('de-DE');  // GermanyGerman.getInstance(), see the header
  }

  protected override createDefaultSpellingRule(messages: ResourceBundle): SpellingCheckRule | null {
    return new GermanSpellerRule(messages, this);
  }

  override getDefaultSpellingRule(): GermanSpellerRule {
    return Objects_requireNonNull(super.getDefaultSpellingRule()) as GermanSpellerRule;
  }

  override createDefaultDisambiguator(): Disambiguator {
    return new GermanRuleDisambiguator(this.getDefaultLanguageVariant());
  }

  override createDefaultPostDisambiguationChunker(): Chunker | null {
    return new GermanChunker();
  }

  override getName(): string {
    return 'German';
  }

  override getShortCode(): string {
    return GERMAN_SHORT_CODE;
  }

  override getCountries(): string[] {
    return ['LU', 'LI', 'BE'];
  }

  override createDefaultTagger(): Tagger {
    return GermanTagger.INSTANCE;
  }

  override createDefaultSynthesizer(): Synthesizer | null {
    return GermanSynthesizer.INSTANCE;
  }

  override createDefaultSentenceTokenizer(): SentenceTokenizer {
    return new SRXSentenceTokenizer(this);
  }

  override getMaintainers(): Contributor[] {
    return [
        new Contributor('Jan Schreiber'),
        Contributors.DANIEL_NABER,
    ];
  }

  override getRelevantRules(messages: ResourceBundle, userConfig: UserConfig | null, _motherTongue: Language | null, _altLanguages: Language[]): Rule[] {
    return [
            new GermanCommaWhitespaceRule(messages,
                    Example.wrong('Die Partei<marker> ,</marker> die die letzte Wahl gewann.'),
                    Example.fixed('Die Partei<marker>,</marker> die die letzte Wahl gewann.'),
                    Tools.getUrl('https://languagetool.org/insights/de/beitrag/grammatik-leerzeichen/#fehler-1-leerzeichen-vor-und-nach-satzzeichen')),
            new GermanUnpairedBracketsRule(messages, this),
            new GermanUnpairedQuotesRule(messages, this),
            new UppercaseSentenceStartRule(messages, this,
                    Example.wrong('Das Haus ist alt. <marker>es</marker> wurde 1950 gebaut.'),
                    Example.fixed('Das Haus ist alt. <marker>Es</marker> wurde 1950 gebaut.'),
                    Tools.getUrl('https://languagetool.org/insights/de/beitrag/gross-klein-schreibung-rechtschreibung/#1-satzanf%C3%A4nge-schreiben-wir-gro%C3%9F')),
            new MultipleWhitespaceRule(messages, this),
            new WhiteSpaceBeforeParagraphEnd(messages, this),
            new WhiteSpaceAtBeginOfParagraph(messages),
            new EmptyLineRule(messages, this),
            new LongParagraphRule(messages, this, userConfig),
            new PunctuationMarkAtParagraphEnd(messages, this),
            // specific to German:
            new SimpleReplaceRule(messages, this),
            new OldSpellingRule(messages, this),
            new SentenceWhitespaceRule(messages),
            new GermanDoublePunctuationRule(messages),
            new MissingVerbRule(messages, this),
            new GermanWordRepeatRule(messages, this),
            new GermanWordRepeatBeginningRule(messages, this),
            new GermanWrongWordInContextRule(messages, this),
            new AgreementRule(messages, this),
            new AgreementRule2(messages, this),
            new CaseRule(messages, this),
            new DashRule(messages),
            new VerbAgreementRule(messages, this),
            new SubjectVerbAgreementRule(messages, this),
            new WordCoherencyRule(messages),
            new SimilarNameRule(messages),
            new WiederVsWiderRule(messages),
            new GermanStyleRepeatedWordRule(messages, this, userConfig),
            new CompoundCoherencyRule(messages),
            new LongSentenceRule(messages, userConfig, 40),
            new GermanFillerWordsRule(messages, this, userConfig),
            new PassiveSentenceRule(messages, this, userConfig),
            new SentenceWithModalVerbRule(messages, this, userConfig),
            new SentenceWithManRule(messages, this, userConfig),
            new ConjunctionAtBeginOfSentenceRule(messages, this, userConfig),
            new NonSignificantVerbsRule(messages, this, userConfig),
            new UnnecessaryPhraseRule(messages, this, userConfig),
            new GermanParagraphRepeatBeginningRule(messages, this),
            new DuUpperLowerCaseRule(messages),
            new UnitConversionRule(messages),
            new MissingCommaRelativeClauseRule(messages),
            new MissingCommaRelativeClauseRule(messages, true),
            new RedundantModalOrAuxiliaryVerb(messages),
            new GermanReadabilityRule(messages, this, userConfig, true),
            new GermanReadabilityRule(messages, this, userConfig, false),
            new CompoundInfinitivRule(messages, this, userConfig),
            new StyleRepeatedVeryShortSentences(messages, this, userConfig),
            new StyleRepeatedSentenceBeginning(messages),
            new GermanRepeatedWordsRule(messages),
            new StyleTooOftenUsedVerbRule(messages, this, userConfig),
            new StyleTooOftenUsedNounRule(messages, this, userConfig),
            new StyleTooOftenUsedAdjectiveRule(messages, this, userConfig),
    ];
  }

  /**
   * @since 2.7
   */
  getNonStrictCompoundSplitter(): (word: string) => string[] {
    const tokenizer = GermanCompoundTokenizer.getNonStrictInstance();  // there's a spelling mistake in (at least) one part, so strict mode wouldn't split the word
    return (word) => [...tokenizer.tokenize(word)];
  }

  /**
   * @since 2.7
   */
  getStrictCompoundTokenizer(): GermanCompoundTokenizer {
    return GermanCompoundTokenizer.getStrictInstance();
  }

  override createDefaultWordTokenizer(): Tokenizer {
    return new GermanWordTokenizer();
  }

  /** @since 5.1 */
  override getOpeningDoubleQuote(): string {
    return '„';
  }

  /** @since 5.1 */
  override getClosingDoubleQuote(): string {
    return '“';
  }

  /** @since 5.1 */
  override getOpeningSingleQuote(): string {
    return '‚';
  }

  /** @since 5.1 */
  override getClosingSingleQuote(): string {
    return '‘';
  }

  /** @since 5.1 */
  override isAdvancedTypographyEnabled(): boolean {
    return true;
  }

  override toAdvancedTypography(input: string): string {
    let output = super.toAdvancedTypography(input);
    //non-breaking space
    output = P().TYPOGRAPHY_PATTERN.matcher(output).replaceAll('$1 $2');
    output = P().TYPOGRAPHY_PATTERN.matcher(output).replaceAll('$1 $2');
    return output;
  }

  override getMaintainedState(): LanguageMaintainedState {
    return LanguageMaintainedState.ActivelyMaintained;
  }

  override getPriorityMap(): Map<string, number> {
    return id2prio;
  }

  protected override getPriorityForId(id: string): number {
    const prio = id2prio.get(id);
    if (prio !== undefined) {
      return prio;
    }
    if (id.startsWith('DE_PROHIBITED_COMPOUNDS_') || id.startsWith('DE_PROHIBITED_COMPOUNDS_PREMIUM_')) {   // don't hide spelling mistakes
      return -4;
    }
    if (id.startsWith('DE_MULTITOKEN_SPELLING')) {
      return -2;
    }
    if (id.startsWith('CONFUSION_RULE_')) {
      return -1;
    }
    if (id.startsWith('AI_DE_HYDRA_LEO')) { // prefer more specific rules (also speller)
      if (id.startsWith('AI_DE_HYDRA_LEO_MISSING_COMMA')) {
        return -51; // prefer comma style rules.
      }
      if (id.startsWith('AI_DE_HYDRA_LEO_CP')) {
        return 2;
      }
      if (id.startsWith('AI_DE_HYDRA_LEO_DATAKK')) {
        return 1;
      }
      return -11;
    }
    if (id.startsWith('AI_DE_KOMMA')) {
      return -52; // prefer comma style rules and AI_DE_HYDRA_LEO_MISSING_COMMA
    }
    if (id.startsWith('AI_DE_GGEC')) {
      // gGEC IDs that should have less prio than rules with default prio
      // e. g. ABKUERZUNG_FEHLENDE_PUNKTE
      switch (id) {
        case 'AI_DE_GGEC_MISSING_PUNCTUATION_E_DASH_MAIL':  // less prio than EMAIL
          return 0;
        case 'AI_DE_GGEC_REPLACEMENT_ADJECTIVE':
        case 'AI_DE_GGEC_REPLACEMENT_ADVERB':
        case 'AI_DE_GGEC_REPLACEMENT_NOUN':
        case 'AI_DE_GGEC_REPLACEMENT_ORTHOGRAPHY_LOWERCASE':
        case 'AI_DE_GGEC_REPLACEMENT_ORTHOGRAPHY_SPELL':
        case 'AI_DE_GGEC_REPLACEMENT_OTHER':
        case 'AI_DE_GGEC_REPLACEMENT_VERB':
        case 'AI_DE_GGEC_REPLACEMENT_VERB_FORM':
        case 'AI_DE_GGEC_UNNECESSARY_ORTHOGRAPHY_SPACE':
        case 'AI_DE_GGEC_UNNECESSARY_OTHER':
        case 'AI_DE_GGEC_UNNECESSARY_SPACE':
          return -1;
      }

      if (id.startsWith('AI_DE_GGEC_MISSING_ORTHOGRAPHY_SPACE')) {
        return -2; // lower prio than LT_RECOMMENDATION but higher prio than GERMAN_SPELLER_RULE
      }

      if (id.startsWith('AI_DE_GGEC_MISSING_PUNCTUATION_PERIOD')) {  // less prio than spell checker
        return -4;
      }
      if (id.startsWith('AI_DE_GGEC_UNNECESSARY_PUNCTUATION')) {  // less prio than FALSCHES_ANFUEHRUNGSZEICHEN
        return -2;
      }
      if (P().AI_DE_GGEC_MISSING_PUNCT.matcher(id).find()) {
        return -1;
      }
      return 1;
    }
    return super.getPriorityForId(id);
  }

  override hasMinMatchesRules(): boolean {
    return true;
  }

  override filterRuleMatches(ruleMatches: RuleMatch[], _text: AnnotatedText, _enabledRules: ReadonlySet<string>): RuleMatch[] {
    const resultMatches: RuleMatch[] = [];
    let previousMatch: RuleMatch | null = null;
    for (let i = 0; i < ruleMatches.length; i++) {
      const currentMatch = ruleMatches[i]!;
      const suggestions = currentMatch.getSuggestedReplacements();
      // ignore adding punctuation at the sentence end
      if (suggestions.length === 1 && currentMatch.getRule().getId().startsWith('AI_DE_GGEC')) {
        const suggestion = suggestions[0]!;
        if (currentMatch.getRule().getId() === 'AI_DE_GGEC_MISSING_PUNCTUATION_PERIOD' && suggestion.endsWith('.')) {
          if (StringReplaceAll(currentMatch.getSentence()!.getText(), '\\s+$', '').endsWith(suggestion.substring(0, suggestion.length - 1))) {
            continue;
          }
        }
      }
      if (previousMatch != null && previousMatch.getRule().getId().startsWith('AI_DE_GGEC') &&
        currentMatch.getRule().getId().startsWith('AI_DE_GGEC')) {
        if (previousMatch.getToPos() > currentMatch.getFromPos()) {
          continue;  // Skip overlapping matches
        }
        // Check if matches are adjacent and share the same 'picky' status
        if ((previousMatch.getToPos() === currentMatch.getFromPos() || previousMatch.getToPos() + 1 === currentMatch.getFromPos()) &&
          (previousMatch.getRule().getTags().includes(Tag.picky) === currentMatch.getRule().getTags().includes(Tag.picky))) {
          // Merge if they have the same ITSIssueType
          if (previousMatch.getRule().getLocQualityIssueType() === currentMatch.getRule().getLocQualityIssueType()) {
            const mergedMatch: RuleMatch = new RuleMatch(this.mergeMatches(previousMatch, currentMatch));
            previousMatch = mergedMatch;
            continue;
          }
          // If matches have different ITSIssueTypes but neither is a style match, merge them
          if (previousMatch.getRule().getLocQualityIssueType() !== currentMatch.getRule().getLocQualityIssueType() &&
            previousMatch.getRule().getLocQualityIssueType() !== ITSIssueType.Style && currentMatch.getRule().getLocQualityIssueType() !== ITSIssueType.Style) {
            const mergedMatch: RuleMatch = new RuleMatch(this.mergeMatches(previousMatch, currentMatch));
            previousMatch = mergedMatch;
            continue;
          }
        }
        // If no merge happened, add the previous match to results
        resultMatches.push(previousMatch);
        previousMatch = currentMatch;  // Move to next match
      } else {
        // Ensure current match becomes previous if no merging criteria are met
        if (previousMatch != null) {
          resultMatches.push(previousMatch);
        }
        previousMatch = currentMatch;
      }
    }
    // Add the last processed match if it exists and hasn't been added yet
    if (previousMatch != null) {
      resultMatches.push(previousMatch);
    }
    return resultMatches;
  }



  private mergeMatches(match1: RuleMatch, match2: RuleMatch): RuleMatch {
    // Calculate separator based on position
    let separator = '';
    if (match1.getToPos() + 1 === match2.getFromPos()) {
      separator = ' ';
    }
    // Merge original error strings and suggested replacements
    const newErrorStr = match1.getOriginalErrorStr() + separator + match2.getOriginalErrorStr();
    const newReplacement = match1.getSuggestedReplacements()[0] + separator + match2.getSuggestedReplacements()[0];

    // Create a new merged RuleMatch object
    const mergedMatch = new RuleMatch(match1.getRule(), match1.getSentence(), match1.getFromPos(), match2.getToPos(),
      'Hier scheint es einen Fehler zu geben.', 'Potenzieller Fehler');
    mergedMatch.setOriginalErrorStr(newErrorStr);
    mergedMatch.setSuggestedReplacement(newReplacement);

    // Create a new specific rule ID based on conditions
    const newId = 'AI_DE_MERGED_MATCH';
    mergedMatch.setSpecificRuleId(newId);

    // If issue types differ, set to Grammar unless both are Style
    if (match1.getRule().getLocQualityIssueType() !== match2.getRule().getLocQualityIssueType()) {
      mergedMatch.getRule().setLocQualityIssueType(ITSIssueType.Grammar);
    } else if (match1.getRule().getLocQualityIssueType() === ITSIssueType.Style && match2.getRule().getLocQualityIssueType() === ITSIssueType.Style) {
      mergedMatch.getRule().setLocQualityIssueType(ITSIssueType.Style);
    }

    return mergedMatch;
  }

  override prepareLineForSpeller(line: string): string[] {
    const results: string[] = [];
    const parts = StringSplit(line, '#');
    if (parts.length === 0) {
      return [line];
    }
    const formTag = StringSplit(parts[0]!, '[/]');
    if (formTag.length === 0) {
      return [''];
    }
    const form = formTag[0]!;
    results.push(form);
    let tag = '';
    if (formTag.length===2) {
      tag = formTag[1]!;
    }
    if (tag.includes('E')) {
      results.push(form + 'e');
    }
    if (tag.includes('S')) {
      results.push(form + 's');
    }
    if (tag.includes('N')) {
      results.push(form + 'n');
    }
    return results;
  }

  override getMultitokenSpeller(): GermanMultitokenSpeller {
    return GermanMultitokenSpeller.INSTANCE;
  }

  /**
   * This is a safety method if subclass forgets to create a getInstance method and API user going to invoke it via subclass.
   */
  static getInstance(): German {
    throw new Error('RuntimeException: You should not obtain the German language instance. Use getInstance method of derived language class instead. Or maybe subclass did not implement the getInstance method.');
  }
}

Languages.register('org.languagetool.language.German', German);
