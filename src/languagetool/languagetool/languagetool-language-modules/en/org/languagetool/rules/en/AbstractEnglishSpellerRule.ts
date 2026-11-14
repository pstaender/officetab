// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/AbstractEnglishSpellerRule.java reduced
// Left out:
// - the named-entity filter of match() (NERService, a server-side service that needs a
//   GlobalConfig with an NER URL, and filter(), which needs a BaseLanguageModel, with Apache's
//   LevenshteinDistance): nerPipe is always null here, so match() never filters (as Java does
//   without a language model or NER URL);
// - BeoLingusTranslator and getTranslator (the translator is null; MorfologikSpellerRule.ts
//   leaves out its translator branch);
// - the logger.
// The constructors are one (the trailing parameters optional, as in MorfologikSpellerRule.ts).
// The two getIrregularFormsOrNull overloads are one method (the one-argument form when only
// `word` is given). The static patterns are compiled on first use. Guava's LinkedHashSet in
// addFormsToFirstMatch keeps the first of equal suggestions (SuggestedReplacement.equals).
// The suggestion maps are unchanged (s.put → s.set).
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { GlobalConfig } from '../../../../../../languagetool-core/org/languagetool/GlobalConfig.ts';
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { LanguageModel } from '../../../../../../languagetool-core/org/languagetool/languagemodel/LanguageModel.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { SuggestedReplacement } from '../../../../../../languagetool-core/org/languagetool/rules/SuggestedReplacement.ts';
import { MorfologikSpellerRule } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/morfologik/MorfologikSpellerRule.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { StringTrim } from '../../../../../../../jdk/java/lang/Character.ts';
import { List_contains, Objects_requireNonNull } from '../../../../../../../jdk/java/util/Objects.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern, StringReplaceFirst, StringSplit } from '../../../../../../../jdk/java/util/regex/Pattern.ts';
import type { VariantInfo } from './VariantInfo.ts';

const { CASE_INSENSITIVE, UNICODE_CASE } = Pattern;
const compile = Pattern.compile;
const topMatch = SuggestedReplacement.topMatch;

/** Apache's StringUtils.replaceOnce: replaces the first occurrence of searchString (no regex). */
function replaceOnce(text: string, searchString: string, replacement: string): string {
  const start = text.indexOf(searchString);
  if (start === -1) {
    return text;
  }
  return text.substring(0, start) + replacement + text.substring(start + searchString.length);
}

/** List.remove(Object): removes the first occurrence. */
function List_remove(l: string[], o: string): void {
  const i = l.indexOf(o);
  if (i >= 0) l.splice(i, 1);
}

const lcDoNotSuggestWords = new Set<string>([
  // words with 'NOSUGGEST' in en_US.dic:
  "asshole",
  "assholes",
  "bullshit",
  "bullshitted",
  "bullshitter",
  "bullshitters",
  "bullshitting",
  "chickenshit",
  "chickenshits",
  "cocksucker",
  "cocksuckers",
  "coon",
  "coon ass",
  "coon asses",
  "cunt",
  "germane", // confused with German
  "double check",
  "flat screen", // flatscreen
  "full time", // should be 'full-time'
  "part time", // should be 'part-time'
  "java script",
  "off topic",
  "hard coding",
  "hard coded",
  "fine tune",
  "fine tuned",
  "fine tuning",
  "kick started", // kickstarted
  "kick starting", // kickstarting
  "kicks tarting", // kickstarting
  "kicks tarted", // kickstarted
  "with holdings",
  "hard coded",
  "hands free",
  "screens hare", // suggestion to screenshare
  "screens hares", // suggestion to screenshare
  "screens hared", // suggestion to screenshare
  "screens haring", // suggestion to screenshare
  "in flight",
  "in car",
  "client side",
  "server side",
  "worry some", // suggestion for worrysome
  "skillet", // wrong suggestion for skillset
  "skillets", // wrong suggestion for skillsets
  "code named",
  "code naming",
  "in house",
  "back office",
  "faggot",
  "faggots",
  "fuckable",
  "fuck",
  "fucker",
  "fuckhead",
  "fuckheads",
  "horseshit",
  "kraut",
  "krauts",
  "blackie",
  "blackies",
  "motherfucker",
  "motherfuckers",
  "motherfucking",
  "nigga",
  "niggas",
  "niggaz",
  "negro",
  "nigger",
  "nigger lip",
  "nigger lips",
  "niggers",
  "skillet",
  "shit",
  "shits",
  "shitfaced",
  "shithead",
  "shitheads",
  "shitload",
  "shitted",
  "shitting",
  "shitty",
  "wop",
  "wops",
  // extension:
  "niggard", "niggardly",
]);

let patterns: ReturnType<typeof compilePatterns> | null = null;
function compilePatterns() {
  return {
    PROFILERATION: compile("[Pp]rofileration"),
    CEMETARY: compile("[Cc]emetary"),
    CEMETARIES: compile("[Cc]emetaries"),
    BASICLY: compile("[Bb]asicly"),
    BELEIVES: compile("[Bb]eleives?"),
    BELIVES: compile("[Bb]elives?"),
    BIZZARE: compile("[Bb]izzare"),
    COMPLETLY: compile("[Cc]ompletly"),
    DISSAPEARS: compile("[Dd]issapears?"),
    FARENHEIT: compile("[Ff]arenheit"),
    FREINDS: compile("[Ff]reinds?"),
    INCIDENTLY: compile("[Ii]ncidently"),
    INTERUPTS: compile("[Ii]nterupts?"),
    LOLLYPOPS: compile("[Ll]ollypops?"),
    OCASSIONS: compile("[Oo]cassions?"),
    OCCURANCES: compile("[Oo]ccurances?"),
    PERSISTANT: compile("[Pp]ersistant"),
    PEICES: compile("[Pp]eices?"),
    SEIGES: compile("[Ss]eiges?"),
    SUPERCEDES: compile("[Ss]upercedes?"),
    THRESHHOLDS: compile("[Tt]hreshholds?"),
    TOMMORROWS: compile("[Tt]ommorrows?"),
    TOUTES: compile("[Tt]ounges?"),
    WIERD: compile("[Ww]ierd"),
    SARGENT: compile("[Ss]argent"),
    SWIMMED: compile("swimmed"),
    MISSPELT: compile("misspelt"),
    JIST: compile("[Jj]ist"),
    ADHOC: compile("[Ad]hoc"),
    DEACTIVE: compile("[De]eactive"),
    HONGKONG: compile("[hH]on[kg]kong"),
    AFAIK: compile("afaik"),
    JANUARY: compile("january"),
    ADMITTINGLY: compile("[Aa]dmittingly"),
    APRIL: compile("april"),
    SEPTEMBER: compile("september"),
    OCTOBER: compile("october"),
    NOVEMBER: compile("november"),
    DECEMBER: compile("december"),
    ENGLISH: compile("english"),
    SPANISH: compile("spanish"),
    GITLAB: compile("[Gg]itlab"),
    BONAFIDE: compile("[Bb]onafide"),
    WHEREEVER: compile("[Ww]hereever"),
    UNINSPIRATIONAL: compile("[Uu]ninspirational"),
    WHATSAPP: compile("[Ww]hatsapp"),
    JETLAGGED: compile("jetlagged"),
    MACBOOK: compile("[Mm]acbooks?"),
    LIKELYHOOD: compile("[Ll]ikelyhood"),
    FORSEEABLE: compile("[Ff]orseeable"),
    UNFORSEEABLE: compile("[Uu]nforseeable"),
    FORSEEABLY: compile("[Ff]orseeably"),
    UNFORSEEABLY: compile("[Uu]nforseeably"),
    UNECESSARY: compile("[Uu]necessary"),
    HUBSPOT: compile("[Hh]ubspot"),
    URL: compile("[Uu]rl"),
    TV: compile("tv"),
    HTTP: compile("[Hh]ttp"),
    HTTPS: compile("[Hh]ttps"),
    EUROPEAN: compile("european"),
    EUROPEANS: compile("europeans"),
    FYI: compile("[Ff]yi"),
    MICROSOFT: compile("microsoft"),
    DEVOPS: compile("[Dd]evops"),
    ALLRIGHT: compile("[Aa]llright"),
    INTRANSPARENT: compile("intransparent(ly)?"),
    ADDON: compile("[Aa]ddons?"),
    WDYT: compile("[Ww]dyt"),
    UNCOMPLIANT: compile("[UuIi]ncompliant"),
    UX: compile("ux"),
    LANGUAGETOOL: compile("[Ll]anguagetool"),
    UNDETERMINISTIC: compile("undeterministic"),
    QUILLBOT_POS: compile("QuillBots"),
    QUILLBOT1: compile("[Qq]uill?bot"),
    QUILLBOT1_POS: compile("[Qq]uill?bots"),
    QUILLBOT2: compile("QuilBot"),
    QUILLBOT2_POS: compile("QuilBots"),
    CONTAINS_TOKEN: compile(".* (b|c|d|e|f|g|h|j|k|l|m|n|o|p|q|r|s|t|v|w|y|z|ll|ve)"),
  };
}
const P = () => (patterns ??= compilePatterns());

// private static NERService nerPipe = null; (not ported, see the header)
const nerPipe: null = null;

const maxPatterns = 9;
let wordPatterns: Pattern[] | null = null;
const blogLinks: string[] = new Array<string>(maxPatterns);
/** Java's static initializer for wordPatterns and blogLinks, run on first use. */
function initWordPatterns(): Pattern[] {
  if (wordPatterns != null) {
    return wordPatterns;
  }
  const wp: Pattern[] = new Array<Pattern>(maxPatterns);
  wp[0] = compile(".*[yi][zs]e([sd])?|.*[yi][zs]ings?|.*i[zs]ations?", CASE_INSENSITIVE | UNICODE_CASE);
  blogLinks[0] = "https://quillbot.com/blog/category/uk-vs-us/";

  wp[1] = compile(".*(defen[cs]e|offen[sc]e|preten[sc]e).*", CASE_INSENSITIVE | UNICODE_CASE);
  blogLinks[1] = "https://quillbot.com/blog/category/uk-vs-us/";

  wp[2] = compile(".*og|.*ogue", CASE_INSENSITIVE | UNICODE_CASE);
  blogLinks[2] = "https://quillbot.com/blog/category/uk-vs-us/";

  wp[3] = compile(".*(or|our).*", CASE_INSENSITIVE | UNICODE_CASE);
  blogLinks[3] = "https://languagetool.org/insights/post/our-or/#colour-or-color%E2%80%94colourise-or-colorize";

  wp[4] = compile(".*e?able|.*dge?ments?|aging|ageing|ax|axe|.*grame?s?|neuron|neurone|neurons|neurones", CASE_INSENSITIVE | UNICODE_CASE);
  blogLinks[4] = "https://languagetool.org/insights/post/our-or/#likeable-vs-likable-judgement-vs-judgment-oestrogen-vs-estrogen";

  wp[5] = compile(".*(centre|center).*|.*(re|er)", CASE_INSENSITIVE | UNICODE_CASE);
  blogLinks[5] = "https://languagetool.org/insights/post/re-vs-er/#the-difference-of-%E2%80%9C-reer%E2%80%9D-at-the-center-of-attention";

  wp[6] = compile("canceled|cancelled|canceling|cancelling|chili|chilli|chilies|chillies|chilis|chillis|counselor|counsellor|counselors|counsellors|defueled|defuelled|defueling|defuelling|defuelings|defuellings|dialed|dialled|dialer|dialler|dialers|diallers|dialing|dialling|dialog|dialogue|dialogize|dialogise|dialogized|dialogised|dialogizes|dialogises|dialogizing|dialogising|dialogs|dialogues|dialyzable|dialysable|dialyze|dialyse|dialyzed|dialysed|dialyzes|dialyses|dialyzing|dialysing|enroll|enrol|enrolled|enroled|enrolling|enroling|enrollment|enrolment|enrollments|enrolments|enrolls|enrols|fueled|fuelled|fueling|fuelling|fulfill|fulfil|fulfillment|fulfilment|fulfills|fulfils|installment|instalment|installments|instalments|jewelry|jewellery|labeled|labelled|labeling|labelling|marvelous|marvellous|medalist|medallist|medalists|medallists|modeled|modelled|modeling|modelling|noise-canceling|noise-cancelling|refueled|refuelled|refueling|refuelling|relabeled|relabelled|relabeling|relabelling|remodeled|remodelled|remodeling|remodelling|signalization|signalisation|signalize|signalise|signalized|signalised|signalizes|signalises|signalizing|signalising|skillful|skilful|skillfully|skilfully|tranquilize|tranquillize|tranquilized|tranquillized|tranquilizes|tranquillizes|traveled|travelled|traveler|traveller|travelers|travellers|traveling|travelling|uncanceled|uncancelled|uncanceling|uncancelling|unlabeled|unlabelled|wooly|woolly", CASE_INSENSITIVE | UNICODE_CASE);
  blogLinks[6] = "https://languagetool.org/insights/post/re-vs-er/#british-english-prefers-doubling-consonants-doesn%E2%80%99t-it";

  wp[7] = compile("airfoil|aerofoil|airfoils|aerofoils|airplane|aeroplane|airplanes|aeroplanes|aluminum|aluminium|artifact|artefact|artifacts|artefacts|backdraft|backdraught|cozy|cosy|", CASE_INSENSITIVE | UNICODE_CASE);
  blogLinks[7] = "https://languagetool.org/insights/post/re-vs-er/#more-radical-differences-between-british-and-american-english-spellings";

  wp[8] = compile("amenorrhea|amenorrhoea|anesthesia|anaesthesia|anesthesias|anaesthesias|anesthetic|anaesthetic|anesthetically|anaesthetically|anesthetics|anaesthetics|anesthetist|anaesthetist|anesthetists|anaesthetists|anesthetization|anaesthetisation|anesthetizations|anaesthetisations|anesthetize|anaesthetise|anesthetized|anaesthetised|anesthetizes|anaesthetises|anesthetizing|anaesthetising|archeological|archaeological|archeologically|archaeologically|archeologies|archaeologies|archeology|archaeology|cesium|caesium|diarrhea|diarrhoea|diarrheal|diarrhoeal|dyslipidemia|dyslipidaemia|dyslipidemias|dyslipidaemias|edematous|oedematous|encyclopedia|encyclopaedia|encyclopedias|encyclopaedias|eon|aeon|eons|aeons|esophagi|oesophagi|esophagus|oesophagus|esophaguses|oesophaguses|esthetic|aesthetic|esthetical|aesthetical|esthetically|aesthetically|esthetician|aesthetician|estheticians|aestheticians|estrogen|oestrogen|estrus|oestrus|etiologies|aetiologies|etiology|aetiology|feces|faeces|fetal|foetal|fetus|foetus|fetuses|foetuses|gastroesophageal|gastro-oesophageal|glycemic|glycaemic|gynecomastia|gynaecomastia|hematemesis|haematemesis|hematoma|haematoma|hematomas|haematomas|hematopoietic|haematopoietic|hematuria|haematuria|hematurias|haematurias|hemolytic|haemolytic|hemophilia|haemophilia|hemorrhage|haemorrhage|hemorrhages|haemorrhages|hemostasis|haemostasis|homeopathies|homoeopathies|homeopathy|homoeopathy|hyperemia|hyperaemia|hyperemic|hyperaemic|hypnopedia|hypnopaedia|hypnopedic|hypnopaedic|hypocalcaemia|hypocalcaemia|hypokalaemic|hypokalemic|kinesthesia|kinaesthesia|kinesthesis|kinaesthesis|kinesthetic|kinaesthetic|kinesthetically|kinaesthetically|maneuver|manoeuvre|maneuvers|manoeuvres|orthopedic|orthopaedic|orthopedics|orthopaedics|paleoecology|palaeoecology|paleogeographical|palaeogeographical|paleogeographically|palaeogeographically|paleogeography|palaeogeography|paresthesia|paraesthesia|pediatric|paediatric|pediatrically|paediatrically|pediatrician|paediatrician|pediatricians|paediatricians|pedomorphic|paedomorphic|pedophile|paedophile|pedophiles|paedophiles|polycythemia|polycythaemia|pretorium|praetorium|pyorrhea|pyorrhoea|septicemia|septicaemia|synesthesia|synaesthesia|synesthete|synaesthete|synesthetes|synaesthetes|tracheoesophageal|tracheo-oesophageal", CASE_INSENSITIVE | UNICODE_CASE);
  blogLinks[8] = "https://languagetool.org/insights/post/our-or/#likeable-vs-likable-judgement-vs-judgment-oestrogen-vs-estrogen";
  wordPatterns = wp;
  return wp;
}

export abstract class AbstractEnglishSpellerRule extends MorfologikSpellerRule {

  override getAdditionalSpellingFileNames(): string[] {
    // NOTE: also add to GermanSpellerRule.getSpeller() when adding items here:
    return [this.language.getShortCode() + AbstractEnglishSpellerRule.CUSTOM_SPELLING_FILE, AbstractEnglishSpellerRule.GLOBAL_SPELLING_FILE,
      "/en/multiwords.txt"];
  }

  //private static final EnglishSynthesizer synthesizer = (EnglishSynthesizer) Languages.getLanguageForShortCode("en").getSynthesizer();

  // private final BeoLingusTranslator translator; (not ported, see the header)

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const matches = super.match(sentence);
    if (this.languageModel != null && nerPipe != null) {
      // the named-entity filter is not ported (see the header); nerPipe is always null
    }
    // add custom URLs
    for (const match of matches) {
      const misspelledWord = match.getSentence()!.getText().substring(match.getFromPos(), match.getToPos());
      if (this.isValidInOtherVariant(misspelledWord) != null) {
        const wordPatterns = initWordPatterns();
        for (let i = 0; i < maxPatterns; i++) {
          const m = wordPatterns[i]!.matcher(misspelledWord);
          if (m.matches()) {
            match.setUrl(blogLinks[i]!);
            break;
          }
        }
      }
    }
    return matches;
  }

  protected override filterNoSuggestWords(l: SuggestedReplacement[]): SuggestedReplacement[] {
    return l.filter((k) => !lcDoNotSuggestWords.has(k.getReplacement().toLowerCase()));
  }

  protected static loadWordlist(path: string, column: number): Map<string, string> {
    if (column !== 0 && column !== 1) {
      throw new Error("IllegalArgumentException: Only column 0 and 1 are supported: " + column);
    }
    const words = new Map<string, string>();
    const lines = JLanguageTool.getDataBroker().getFromResourceDirAsLines(path);
    for (let line of lines) {
      line = StringTrim(line);
      if (line.length === 0 || line.startsWith("#")) {
        continue;
      }
      const parts = StringSplit(line, ";");
      if (parts.length !== 2) {
        throw new Error("RuntimeException: Unexpected format in " + path + ": " + line + " - expected two parts delimited by ';'");
      }
      words.set(parts[column]!.toLowerCase(), parts[column === 1 ? 0 : 1]!);
    }
    return words;
  }

  /**
   * Java's constructors: (messages, language), (messages, language, userConfig, altLanguages) (@since 4.4)
   * and (messages, language, globalConfig, userConfig, altLanguages, languageModel, motherTongue) (@since 4.5,
   * optional: language model for better suggestions). Here one, the trailing parameters optional.
   */
  constructor(messages: ResourceBundle, language: Language, globalConfig: GlobalConfig | null = null, userConfig: UserConfig | null = null,
              altLanguages: Language[] = [], languageModel: LanguageModel | null = null, motherTongue: Language | null = null) {
    super(messages, language, globalConfig, userConfig, altLanguages, languageModel, motherTongue);
    this.ignoreWordsWithLength = 1;
    this.setCheckCompound(true);
    this.addExamplePair(Example.wrong("This <marker>sentenc</marker> contains a spelling mistake."),
                   Example.fixed("This <marker>sentence</marker> contains a spelling mistake."));
    const languageSpecificIgnoreFile = this.getSpellingFileName()!.replaceAll(".txt", "_" + language.getShortCodeWithCountryAndVariant() + ".txt");
    for (const ignoreWord of this.wordListLoader.loadWords(languageSpecificIgnoreFile)) {
      this.addIgnoreWords(ignoreWord);
    }
    // translator = BeoLingusTranslator.getInstance(globalConfig); (not ported)
    this.topSuggestions = AbstractEnglishSpellerRule.getTopSuggestions();
    this.topSuggestionsIgnoreCase = AbstractEnglishSpellerRule.getTopSuggestionsIgnoreCase();
    // nerPipe = new NERService(globalConfig.getNerUrl()); (not ported)
  }

  protected override filterSuggestions(suggestions: SuggestedReplacement[]): SuggestedReplacement[] {
    const result = super.filterSuggestions(suggestions);
    const clean: SuggestedReplacement[] = [];
    for (const suggestion of result) {
      if (!P().CONTAINS_TOKEN.matcher(suggestion.getReplacement()).matches())   // e.g. 'timezones' suggests 'timezone s'
        clean.push(suggestion);
    }
    return clean;
  }

  protected override getRuleMatches(word: string, startPos: number, sentence: AnalyzedSentence, ruleMatchesSoFar: RuleMatch[], idx: number,
                                    tokens: readonly AnalyzedTokenReadings[]): RuleMatch[] {
    const ruleMatches = super.getRuleMatches(word, startPos, sentence, ruleMatchesSoFar, idx, tokens);
    if (ruleMatches.length > 0) {
      // so 'word' is misspelled:
      const forms = this.getIrregularFormsOrNull(word);
      if (forms != null) {
        const message = "Possible spelling mistake. Did you mean <suggestion>" + forms.forms[0] +
                "</suggestion>, the " + forms.formName + " form of the " + forms.posName +
                " '" + forms.baseform + "'?";
        this.addFormsToFirstMatch(message, sentence, ruleMatches, forms.forms);
      } else {
        const variantInfo = this.isValidInOtherVariant(word);
        if (variantInfo != null) {
          const message = "Possible spelling mistake. '" + word + "' is " + variantInfo.getVariantName() + ".";
          const suggestion = StringTools.startsWithUppercase(word) ?
              StringTools.uppercaseFirstChar(variantInfo.otherVariant())! : variantInfo.otherVariant();
          this.replaceFormsOfFirstMatch(message, sentence, ruleMatches, suggestion);
        }
      }
    }
    // filter "re ..." (#2562):
    return ruleMatches.map((m) => {
      const copy = new RuleMatch(m);
      copy.setLazySuggestedReplacements(() => AbstractEnglishSpellerRule.cleanSuggestions(m));
      return copy;
    });
  }

  private static cleanSuggestions(ruleMatch: RuleMatch): SuggestedReplacement[] {
    return ruleMatch.getSuggestedReplacementObjects()
      .filter((k) => {
        const rep = k.getReplacement();
        if (!rep.includes(" ")) {
          return true;
        }
        const repLc = rep.toLowerCase();
        return (
          !repLc.startsWith("re ") &&
          !repLc.startsWith("en ") &&
          !repLc.startsWith("co ") &&
          !repLc.startsWith("cl ") &&
          !repLc.startsWith("de ") &&
          !repLc.startsWith("ex ") &&
          !repLc.startsWith("es ") &&
          !repLc.startsWith("ab ") &&
          !repLc.startsWith("ty ") &&
          !repLc.startsWith("mid ") &&
          !repLc.startsWith("non ") &&
          !repLc.startsWith("bio ") &&
          !repLc.startsWith("bi ") &&
          !repLc.startsWith("op ") &&
          !repLc.startsWith("con ") &&
          !repLc.startsWith("pre ") &&
          !repLc.startsWith("mis ") &&
          !repLc.startsWith("socio ") &&
          !repLc.startsWith("proto ") &&
          !repLc.startsWith("neo ") &&
          !repLc.startsWith("geo ") &&
          !repLc.startsWith("inter ") &&
          !repLc.startsWith("multi ") &&
          !repLc.startsWith("retro ") &&
          !repLc.startsWith("extra ") &&
          !repLc.startsWith("mega ") &&
          !repLc.startsWith("meta ") &&
          !repLc.startsWith("poly ") &&
          !repLc.startsWith("para ") &&
          !repLc.startsWith("uni ") &&
          !repLc.startsWith("anti ") &&
          !repLc.startsWith("necro ") &&
          !repLc.startsWith("photo ") &&
          !repLc.startsWith("post ") &&
          !repLc.startsWith("sub ") &&
          !repLc.startsWith("auto ") &&
          !repLc.startsWith("pl ") &&
          !repLc.startsWith("ht ") &&
          !repLc.startsWith("dis ") &&
          !repLc.startsWith("est ") &&
          !repLc.startsWith("mono ") &&
          !repLc.startsWith("trans ") &&
          !repLc.startsWith("neuro ") &&
          !repLc.startsWith("hetero ") &&
          !repLc.startsWith("ultra ") &&
          !repLc.startsWith("mini ") &&
          !repLc.startsWith("hyper ") &&
          !repLc.startsWith("micro ") &&
          !repLc.startsWith("counter ") &&
          !repLc.startsWith("over ") &&
          !repLc.startsWith("overs ") &&
          !repLc.startsWith("overt ") &&
          !repLc.startsWith("under ") &&
          !repLc.startsWith("cyber ") &&
          !repLc.startsWith("hydro ") &&
          !repLc.startsWith("ergo ") &&
          !repLc.startsWith("fore ") &&
          !repLc.startsWith("pro ") &&
          !repLc.startsWith("pseudo ") &&
          !repLc.startsWith("psycho ") &&
          !repLc.startsWith("mi ") &&
          !repLc.startsWith("nano ") &&
          !repLc.startsWith("ans ") &&
          !repLc.startsWith("semi ") &&
          !repLc.startsWith("infra ") &&
          !repLc.startsWith("hypo ") &&
          !repLc.startsWith("syn ") &&
          !repLc.startsWith("adv ") &&
          !repLc.startsWith("com ") &&
          !repLc.startsWith("res ") &&
          !repLc.startsWith("resp ") &&
          !repLc.startsWith("lo ") &&
          !repLc.startsWith("ed ") &&
          !repLc.startsWith("ac ") &&
          !repLc.startsWith("al ") &&
          !repLc.startsWith("ea ") &&
          !repLc.startsWith("ge ") &&
          !repLc.startsWith("mu ") &&
          !repLc.startsWith("ma ") &&
          !repLc.startsWith("la ") &&
          !repLc.startsWith("bis ") &&
          !repLc.startsWith("ger ") &&
          !repLc.startsWith("inf ") &&
          !repLc.startsWith("tar ") &&
          !repLc.startsWith("f ") &&
          !repLc.startsWith("k ") &&
          !repLc.startsWith("l ") &&
          !repLc.startsWith("b ") &&
          !repLc.startsWith("e ") &&
          !repLc.startsWith("c ") &&
          !repLc.startsWith("d ") &&
          !repLc.startsWith("p ") &&
          !repLc.startsWith("v ") &&
          !repLc.startsWith("h ") &&
          !repLc.startsWith("r ") &&
          !repLc.startsWith("s ") &&
          !repLc.startsWith("t ") &&
          !repLc.startsWith("u ") &&
          !repLc.startsWith("w ") &&
          !repLc.startsWith("um ") &&
          !repLc.startsWith("oft ") &&
          !rep.startsWith("i ") &&
          !rep.startsWith("sh ") &&
          !rep.startsWith("li ") &&
          !rep.startsWith("ha ") &&
          !rep.startsWith("st ") &&
          !rep.startsWith("ins ") && // instable (ins table)
          !rep.endsWith(" i") &&
          !rep.endsWith(" ING") &&
          !rep.endsWith(" able") &&
          !rep.endsWith(" om") &&
          !rep.endsWith(" ox") &&
          !rep.endsWith(" ht") &&
          !rep.endsWith(" wide") && // (e.g. storewide)
          !rep.endsWith(" less") && // (e.g. permissionless)
          !rep.endsWith(" sly") && // unnecessary suggestion (e.g. for continuesly)
          !rep.endsWith(" OO") && // unnecessary suggestion (e.g. for "HELLOOO")
          !rep.endsWith(" HHH") && // unnecessary suggestion (e.g. for "OHHHH")
          !rep.endsWith(" ally") && // adverbs ending in "ally" that LT doesn't know (yet)
          !rep.endsWith(" ize") && // "advertize"
          !rep.endsWith(" sh") &&
          !rep.endsWith(" st") &&
          !rep.endsWith(" est") &&
          !rep.endsWith(" em") &&
          !rep.endsWith(" ward") &&
          !rep.endsWith(" ability") && // interruptability
          !rep.endsWith(" ware") && // drinkware
          !rep.endsWith(" logy") && // volcanology
          !rep.endsWith(" ting") && // someting
          !rep.endsWith(" ion") && // presention
          !rep.endsWith(" ions") && // sealions
          !rep.endsWith(" cal") &&
          !rep.endsWith(" ted") && // "bursted"
          !rep.endsWith(" sphere") &&
          !rep.endsWith(" ell") &&
          !rep.endsWith(" co") &&
          !rep.endsWith(" con") &&
          !rep.endsWith(" com") &&
          !rep.endsWith(" sis") &&
          !rep.endsWith(" like") && // "ribbonlike"
          !rep.endsWith(" full") && // do not suggest "use full" for "useful"
          !rep.endsWith(" en") && // "Antwerpen" suggests "Antwerp en"
          !rep.endsWith(" ne") &&
          !rep.endsWith(" ed") &&
          !rep.endsWith(" al") &&
          !rep.endsWith(" ans") &&
          !rep.endsWith(" mans") &&
          !rep.endsWith(" ti") &&
          !rep.endsWith(" de") &&
          !rep.endsWith(" ea") &&
          !rep.endsWith(" ge") &&
          !rep.endsWith(" ab") &&
          !rep.endsWith(" rs") &&
          !rep.endsWith(" mi") &&
          !rep.endsWith(" tar") &&
          !rep.endsWith(" adv") &&
          !rep.endsWith(" re") &&
          !rep.endsWith(" e") &&
          !rep.endsWith(" c") &&
          !rep.endsWith(" v") &&
          !rep.endsWith(" h") &&
          !rep.endsWith(" s") &&
          !rep.endsWith(" r") &&
          !rep.endsWith(" l") &&
          !rep.endsWith(" u") &&
          !rep.endsWith(" um") &&
          !rep.endsWith(" er") &&
          !rep.endsWith(" es") &&
          !rep.endsWith(" ex") &&
          !rep.endsWith(" na") &&
          !rep.endsWith(" ifs") &&
          !rep.endsWith(" gs") &&
          !rep.endsWith(" don") &&
          !rep.endsWith(" dons") &&
          !rep.endsWith(" la") &&
          !rep.endsWith(" ism") &&
          !rep.endsWith(" ma"));
      });
  }

  /**
   * @since 4.5
   */
  protected isValidInOtherVariant(_word: string): VariantInfo | null {
    return null;
  }

  private addFormsToFirstMatch(message: string, sentence: AnalyzedSentence, ruleMatches: RuleMatch[], forms: readonly string[]): void {
    // recreating match, might overwrite information by SuggestionsRanker;
    // this has precedence
    const oldMatch = ruleMatches[0]!;
    const newMatch = new RuleMatch(this, sentence, oldMatch.getFromPos(), oldMatch.getToPos(), message);
    newMatch.setType(oldMatch.getType());
    newMatch.setLazySuggestedReplacements(() => {
      // new ArrayList<>(Sets.newLinkedHashSet(Iterables.concat(forms → SuggestedReplacement, oldMatch's)))
      const result: SuggestedReplacement[] = [];
      for (const s of [...forms.map((f) => new SuggestedReplacement(f)), ...oldMatch.getSuggestedReplacementObjects()]) {
        if (!List_contains(result, s)) result.push(s);
      }
      return result;
    });
    ruleMatches[0] = newMatch;
  }

  private replaceFormsOfFirstMatch(message: string, sentence: AnalyzedSentence, ruleMatches: RuleMatch[], suggestion: string): void {
    // recreating match, might overwrite information by SuggestionsRanker;
    // this has precedence
    const oldMatch = ruleMatches[0]!;
    const newMatch = new RuleMatch(this, sentence, oldMatch.getFromPos(), oldMatch.getToPos(), message);
    newMatch.setType(oldMatch.getType());
    const sugg = new SuggestedReplacement(suggestion);
    sugg.setShortDescription(this.language.getName());
    newMatch.setSuggestedReplacementObjects([sugg]);
    ruleMatches[0] = newMatch;
  }

  /**
   * Java's overloads getIrregularFormsOrNull(word) and
   * getIrregularFormsOrNull(word, wordSuffix, suffixes, posTag, posName, formName).
   */
  private getIrregularFormsOrNull(word: string, wordSuffix?: string, suffixes?: readonly string[], posTag?: string, posName?: string,
                                  formName?: string): IrregularForms | null {
    if (wordSuffix === undefined) {
      let irregularFormsOrNull = this.getIrregularFormsOrNull(word, "ed", ["ed"], "VBD", "verb", "past tense");
      if (irregularFormsOrNull != null) return irregularFormsOrNull;
      irregularFormsOrNull = this.getIrregularFormsOrNull(word, "ed", ["d" /* e.g. awaked */], "VBD", "verb", "past tense");
      if (irregularFormsOrNull != null) return irregularFormsOrNull;
      irregularFormsOrNull = this.getIrregularFormsOrNull(word, "s", ["s"], "NNS", "noun", "plural");
      if (irregularFormsOrNull != null) return irregularFormsOrNull;
      irregularFormsOrNull = this.getIrregularFormsOrNull(word, "es", ["es"/* e.g. 'analysises' */], "NNS", "noun", "plural");
      if (irregularFormsOrNull != null) return irregularFormsOrNull;
      irregularFormsOrNull = this.getIrregularFormsOrNull(word, "er", ["er"/* e.g. 'farer' */], "JJR", "adjective", "comparative");
      if (irregularFormsOrNull != null) return irregularFormsOrNull;
      irregularFormsOrNull = this.getIrregularFormsOrNull(word, "est", ["est"/* e.g. 'farest' */], "JJS", "adjective", "superlative");
      return irregularFormsOrNull;
    }
    for (const suffix of suffixes!) {
      if (word.endsWith(wordSuffix)) {
        const baseForm = word.substring(0, word.length - suffix.length);
        const forms = Objects_requireNonNull(this.language.getSynthesizer()).synthesize(new AnalyzedToken(word, null, baseForm), posTag!);
        const result: string[] = [];
        for (const form of forms) {
          if (!this.speller1.isMisspelled(form)) {
            // only accept suggestions that the spellchecker will accept
            result.push(form);
          }
        }
        // the internal dict might contain forms that the spell checker doesn't accept (e.g. 'criterions'),
        // but we trust the spell checker in this case:
        List_remove(result, word);
        List_remove(result, "badder");  // non-standard usage
        List_remove(result, "baddest");  // non-standard usage
        List_remove(result, "spake");  // can be removed after dict update
        if (result.length > 0) {
          return new IrregularForms(baseForm, posName!, formName!, result);
        }
      }
    }
    return null;
  }

  protected readonly topSuggestions: Map<string, string[]>;
  protected readonly topSuggestionsIgnoreCase: Map<string, string[]>;

  protected static getTopSuggestionsIgnoreCase(): Map<string, string[]> {
    const s = new Map<string, string[]>();
    s.set("json", ["Jason"]);
    s.set("bmps", ["BMPs"]);
    s.set("ppts", ["PPTs"]);

    s.set("italia", ["Italy"]);
    s.set("copenhague", ["Copenhagen"]);
    s.set("applepay", ["Apple Pay"]);
    s.set("&&", ["&"]);
    s.set("wensday", ["Wednesday"]);
    s.set("interweb", ["internet"]);
    s.set("interwebs", ["internet"]);
    s.set("srilanka", ["Sri Lanka"]);
    s.set("pcs", ["PCs"]);

    s.set("oconnor", ["O'Connor"]);
    s.set("oconor", ["O'Conor"]);
    s.set("obrien", ["O'Brien"]);
    s.set("odonnell", ["O'Donnell"]);
    s.set("oneill", ["O'Neill"]);
    s.set("oneil", ["O'Neil"]);
    s.set("oconnell", ["O'Connell"]);
    s.set("todo", ["To-do", "To do"]);
    s.set("todos", ["To-dos"]);
    s.set("elearning", ["e-learning"]);
    s.set("g-mail", ["Gmail"]);
    s.set("playstation", ["PlayStation"]);
    s.set("iam", ["I am", "I'm"]);
    s.set("kpop", ["K-pop"]);
    s.set("defenate", ["definite"]);
    s.set("defenately", ["definitely"]);
    s.set("trumpian", ["Trumpist"]);
    s.set("trumpians", ["Trumpists"]);
    s.set("UberEats", ["Uber Eats"]);
    s.set("KWH", ["kWh"]);
    s.set("MWH", ["MWh"]);
    s.set("xray", ["X-ray"]);
    s.set("xrays", ["X-rays"]);
    s.set("soo", ["so", "too", "son"]);
    return s;
  }

  protected static getTopSuggestions(): Map<string, string[]> {
    const s = new Map<string, string[]>();
    s.set("Ths", ["This", "The"]);
    s.set("prev", ["previous"]);
    s.set("kilotonne", ["kiloton"]);
    s.set("kilotonnes", ["kilotons"]);
    s.set("litehouse", ["lighthouse"]);
    s.set("Litehouse", ["Lighthouse"]);
    s.set("whitout", ["without", "white out"]);
    s.set("Whitout", ["Without", "White out"]);
    s.set("compability", ["compatibility"]);
    s.set("Compability", ["Compatibility"]);
    s.set("enroute", ["en route"]);
    s.set("teasered", ["teased"]);
    s.set("teasering", ["teasing"]);
    s.set("stealed", ["stole", "stolen"]);
    s.set("stealt", ["stole", "stolen"]);
    s.set("ignight", ["ignite"]);
    s.set("Ignight", ["Ignite"]);
    s.set("ignights", ["ignites"]);
    s.set("Ignights", ["Ignites"]);
    s.set("ignighted", ["ignited"]);
    s.set("Ignighted", ["Ignited"]);
    s.set("ignighting", ["igniting"]);
    s.set("Ignighting", ["Igniting"]);
    s.set("transcripted", ["transcribed"]);
    s.set("transcripting", ["transcribing"]);
    s.set("incase", ["in case"]);
    s.set("Incase", ["In case"]);
    s.set("admittably", ["admittedly"]);
    s.set("Admittably", ["Admittedly"]);
    s.set("fam", ["family", "fame"]);
    s.set("awnser", ["answer"]);
    s.set("Awnser", ["Answer"]);
    s.set("awnsers", ["answers"]);
    s.set("Awnsers", ["Answers"]);
    s.set("megatonne", ["megaton"]);
    s.set("Megatonne", ["Megaton"]);
    s.set("megatonnes", ["megatons"]);
    s.set("Megatonnes", ["Megatons"]);
    s.set("retd", ["retd.", "retired"]);
    s.set("Retd", ["Retd.", "Retired"]);
    s.set("intransparent", ["non-transparent", "lacking transparency"]);
    s.set("repetion", ["repetition"]);
    s.set("Repetion", ["Repetition"]);
    s.set("repetions", ["repetitions"]);
    s.set("Repetions", ["Repetitions"]);
    s.set("rom", ["room"]);
    s.set("th", ["the"]);
    s.set("transman", ["trans man"]);
    s.set("Transman", ["Trans man"]);
    s.set("transmen", ["trans men"]);
    s.set("Transmen", ["Trans men"]);
    s.set("transwoman", ["trans woman"]);
    s.set("Transwoman", ["Trans woman"]);
    s.set("transwomen", ["trans women"]);
    s.set("Transwomen", ["Trans women"]);
    s.set("litterly", ["literally"]);
    s.set("Litterly", ["Literally"]);
    s.set("abt", ["about"]);
    s.set("ley", ["let"]);
    s.set("Ley", ["Let"]);
    s.set("becuz", ["because"]);
    s.set("becus", ["because"]);
    s.set("lullabys", ["lullabies"]);
    s.set("Lullabys", ["Lullabies"]);
    s.set("forceably", ["forcibly"]);
    s.set("Forceably", ["Forcibly"]);
    s.set("accidently", ["accidentally"]);
    s.set("Accidently", ["Accidentally"]);
    s.set("aer", ["are", "air"]);
    s.set("Aer", ["Are", "Air"]);
    s.set("downie", ["downy"]);
    s.set("Downie", ["Downy"]);
    s.set("happing", ["happening"]);
    s.set("Happing", ["Happening"]);
    s.set("se", ["see"]);
    s.set("maam", ["ma'am", "madam"]);
    s.set("Maam", ["Ma'am", "Madam"]);
    s.set("mam", ["ma'am"]);
    s.set("Mam", ["Ma'am"]);
    s.set("evidents", ["evidence"]);
    s.set("Evidents", ["Evidence"]);
    s.set("greatfull", ["grateful"]);
    s.set("Greatfull", ["Grateful"]);
    s.set("verticle", ["vertical"]);
    s.set("Verticle", ["Vertical"]);
    s.set("definaly", ["definitely"]);
    s.set("Definaly", ["Definitely"]);
    s.set("definally", ["definitely"]);
    s.set("Definally", ["Definitely"]);
    s.set("handable", ["handleable"]);
    s.set("Handable", ["Handleable"]);
    s.set("sal-ammoniac", ["sal ammoniac"]);
    s.set("mumbo-jumbo", ["mumbo jumbo"]);
    s.set("Mumbo-jumbo", ["Mumbo jumbo"]);
    s.set("Mumbo-Jumbo", ["Mumbo Jumbo"]);
    s.set("Tuffed", ["Toughed"]);
    s.set("tuffed", ["toughed"]);
    s.set("biosim", ["biosimilar"]);
    s.set("biosims", ["biosimilars"]);
    s.set("Tuffest", ["Toughest"]);
    s.set("tuffest", ["toughest"]);
    s.set("Tuffer", ["Tougher"]);
    s.set("tuffer", ["tougher"]);
    s.set("devast", ["devastate"]);
    s.set("devasts", ["devastates"]);
    s.set("devasted", ["devastated"]);
    s.set("devasting", ["devastating"]);
    s.set("Fundrace", ["Fundraise"]);
    s.set("fundrace", ["fundraise"]);
    s.set("Fundraces", ["Fundraises"]);
    s.set("fundraces", ["fundraises"]);
    s.set("Fundracing", ["Fundraising"]);
    s.set("fundracing", ["fundraising"]);
    s.set("Fundraced", ["Fundraised"]);
    s.set("fundraced", ["fundraised"]);
    s.set("withing", ["within"]);
    s.set("Withing", ["Within"]);
    s.set("hollyday", ["holiday"]);
    s.set("Hollyday", ["Holiday"]);
    s.set("hollydays", ["holidays"]);
    s.set("Hollydays", ["Holidays"]);
    s.set("overnite", ["overnight"]);
    s.set("Overnite", ["Overnight"]);
    s.set("tonite", ["tonight"]);
    s.set("Tonite", ["Tonight"]);
    s.set("nite", ["night"]);
    s.set("Nite", ["Night"]);
    s.set("nites", ["nights"]);
    s.set("Nites", ["Nights"]);
    s.set("upto", ["up to", "unto"]);
    s.set("Upto", ["Up to", "Unto"]);
    s.set("prolly", ["probably"]);
    s.set("corse", ["course"]);
    s.set("util", ["utility"]);
    s.set("Util", ["Utility"]);
    s.set("prorata", ["pro rata"]);
    s.set("pro-rata", ["pro rata"]);
    s.set("Prorata", ["Pro rata"]);
    s.set("Pro-rata", ["Pro rata"]);
    s.set("wast", ["was", "waste", "waist", "wasn't"]);
    s.set("Wast", ["Was", "Waste", "Waist", "Wasn't"]);
    s.set("drag&drop", ["drag & drop"]);
    s.set("Drag&drop", ["Drag & drop"]);
    s.set("Drag&Drop", ["Drag & Drop"]);
    s.set("copy&paste", ["copy & paste"]);
    s.set("Copy&paste", ["Copy & paste"]);
    s.set("Copy&Paste", ["Copy & Paste"]);
    s.set("hiphop", ["hip-hop"]);
    s.set("Hiphop", ["Hip-hop", "Hip-Hop"]);
    s.set("ap", ["app", "up", "AP"]);
    s.set("Ap", ["App", "Up", "AP"]);
    s.set("aps", ["apps"]);
    s.set("Aps", ["Apps"]);
    s.set("hehe", ["he-he"]);
    s.set("Hehe", ["He-he"]);
    s.set("politeful", ["polite"]);
    s.set("Politeful", ["Polite"]);
    s.set("defacto", ["de facto"]);
    s.set("Defacto", ["De facto"]);
    s.set("rethoric", ["rhetoric"]);
    s.set("Rethoric", ["Rhetoric"]);
    s.set("differently-abled", ["differently abled"]);
    s.set("Differently-abled", ["Differently abled"]);
    s.set("data-uri", ["data URI"]);
    s.set("Ppl", ["People"]);
    s.set("Si", ["Is"]);
    s.set("si", ["is"]);
    s.set("pcs", ["PCs"]);
    s.set("constits", ["consists"]);
    s.set("ect", ["etc"]);
    s.set("fastly", ["fast"]);
    s.set("carrie", ["carry"]);
    s.set("bare-bone", ["bare-bones", "bare-boned"]);
    s.set("Bare-bone", ["Bare-bones", "Bare-boned"]);
    s.set("mae", ["make", "MAE", "may", "May", "man"]);
    s.set("transportion", ["transportation"]);
    s.set("Transportion", ["Transportation"]);
    s.set("presention", ["presentation"]);
    s.set("Presention", ["Presentation"]);
    s.set("presension", ["presentation"]);
    s.set("Presension", ["Presentation"]);
    s.set("realtime", ["real-time"]);
    s.set("Realtime", ["Real-time"]);
    s.set("morphium", ["morphine"]);
    s.set("Morphium", ["Morphine"]);
    s.set("morphiums", ["morphines"]);
    s.set("Morphiums", ["Morphines"]);
    s.set("approvement", ["approval"]);
    s.set("Approvement", ["Approval"]);
    s.set("approvements", ["approvals"]);
    s.set("Approvements", ["Approvals"]);
    s.set("ciggarets", ["cigarettes"]);
    s.set("Ciggarets", ["Cigarettes"]);
    s.set("pro-bono", ["pro bono"]);
    s.set("Pro-bono", ["Pro bono"]);
    s.set("probono", ["pro bono"]);
    s.set("Probono", ["Pro bono"]);
    s.set("electronical", ["electronic", "electronically"]);
    s.set("Electronical", ["Electronic", "Electronically"]);
    s.set("unpolite", ["impolite"]);
    s.set("armys", ["armies"]);
    s.set("Armys", ["Armies"]);
    s.set("tarrif", ["tariff"]);
    s.set("Tarrif", ["Tariff"]);
    s.set("tarrifs", ["tariffs"]);
    s.set("Tarrifs", ["Tariffs"]);
    s.set("techy", ["techie"]);
    s.set("Techy", ["Techie"]);
    s.set("techys", ["techies"]);
    s.set("Techys", ["Techies"]);
    s.set("non-techy", ["non-techie"]);
    s.set("pharmasuitable", ["pharmaceutical"]);
    s.set("storie", ["story", "store", "stories"]);
    s.set("Storie", ["Story", "Store", "Stories"]);
    s.set("ensuite", ["en suite"]);
    s.set("Ensuite", ["En suite"]);
    s.set("insite", ["insight"]);
    s.set("insites", ["insights"]);
    s.set("Insite", ["Insight"]);
    s.set("Insites", ["Insights"]);
    s.set("thouraly", ["thoroughly"]);
    s.set("heiaracky", ["hierarchy"]);
    s.set("on-prem", ["on-premise"]);
    s.set("sin-off", ["sign-off"]);
    s.set("sin-offs", ["sign-offs"]);
    s.set("Sin-off", ["Sign-off"]);
    s.set("Sin-offs", ["Sign-offs"]);
    s.set("Alot", ["A lot"]);
    s.set("alot", ["a lot"]);
    s.set("DDOS", ["DDoS"]);
    s.set("disencouraged", ["discouraged"]);
    s.set("Disencouraged", ["Discouraged"]);
    s.set("async", ["asynchronous", "asynchronously"]);
    s.set("Async", ["Asynchronous", "Asynchronously"]);
    s.set("endevours", ["endeavours"]);
    s.set("endevors", ["endeavors"]);
    s.set("endevour", ["endeavour"]);
    s.set("endevor", ["endeavor"]);
    s.set("industrys", ["industries", "industry's", "industry"]);
    s.set("Industrys", ["Industries", "Industry's", "Industry"]);
    s.set("partys", ["parties", "party's", "party"]);
    s.set("Partys", ["Parties", "Party's", "Party"]);
    s.set("countrys", ["countries", "country's", "country"]);
    s.set("Countrys", ["Countries", "Country's", "Country"]);
    s.set("bodys", ["bodies", "body's", "body"]);
    s.set("Bodys", ["Bodies", "Body's", "Body"]);
    s.set("ladys", ["ladies", "lady's", "lady"]);
    s.set("Ladys", ["Ladies", "Lady's", "Lady"]);
    s.set("citys", ["cities", "city's", "city"]);
    s.set("Citys", ["Cities", "City's", "City"]);
    s.set("batterys", ["batteries", "battery's", "battery"]);
    s.set("Batterys", ["Batteries", "Battery's", "Battery"]);
    s.set("technologys", ["technologies", "technology's", "technology"]);
    s.set("Technologys", ["Technologies", "Technology's", "Technology"]);
    s.set("childrens", ["children's", "children"]);
    s.set("Childrens", ["Children's", "Children"]);
    s.set("countys", ["counties", "county's", "county"]);
    s.set("Countys", ["Counties", "County's", "County"]);
    s.set("familys", ["families", "family's", "family"]);
    s.set("Familys", ["Families", "Family's", "Family"]);
    s.set("Thak", ["Thank"]);
    s.set("thak", ["thank"]);
    s.set("dieing", ["dying"]);
    s.set("Dieing", ["Dying"]);
    s.set("Supposably", ["Supposedly"]);
    s.set("supposably", ["supposedly"]);
    s.set("dem", ["them"]);
    s.set("Dem", ["Them"]);
    s.set("infact", ["in fact"]);
    s.set("Infact", ["In fact"]);
    s.set("ad-hoc", ["ad hoc"]);
    s.set("adhoc", ["ad hoc"]);
    s.set("Ad-hoc", ["Ad hoc"]);
    s.set("Adhoc", ["Ad hoc"]);
    s.set("ad-on", ["add-on"]);
    s.set("add-o", ["add-on"]);
    s.set("acc", ["account", "accusative"]);
    s.set("Acc", ["Account", "Accusative"]);
    s.set("ºC", ["°C"]);
    s.set("jus", ["just", "juice"]);
    s.set("Jus", ["Just", "Juice"]);
    s.set("sayed", ["said"]);
    s.set("sess", ["says", "session", "cess"]);
    s.set("Addon", ["Add-on"]);
    s.set("Addons", ["Add-ons"]);
    s.set("ios", ["iOS"]);
    s.set("yrs", ["years"]);
    s.set("standup", ["stand-up"]);
    s.set("standups", ["stand-ups"]);
    s.set("Standup", ["Stand-up"]);
    s.set("Standups", ["Stand-ups"]);
    s.set("Playdough", ["Play-Doh"]);
    s.set("playdough", ["Play-Doh"]);
    s.set("biggy", ["biggie"]);
    s.set("lieing", ["lying"]);
    s.set("preffered", ["preferred"]);
    s.set("preffering", ["preferring"]);
    s.set("reffered", ["referred"]);
    s.set("reffering", ["referring"]);
    s.set("passthrough", ["pass-through"]);
    s.set("&&", ["&"]);
    s.set("cmon", ["c'mon"]);
    s.set("Cmon", ["C'mon"]);
    s.set("da", ["the"]);
    s.set("Da", ["The"]);
    s.set("Vue", ["Vue.JS"]);
    s.set("errornous", ["erroneous"]);
    s.set("brang", ["brought"]);
    s.set("brung", ["brought"]);
    s.set("thru", ["through"]);
    s.set("pitty", ["pity"]);
    s.set("barbwire", ["barbed wire"]);
    s.set("barbwires", ["barbed wires"]);
    s.set("monkie", ["monkey"]);
    s.set("Monkie", ["Monkey"]);
    s.set("monkies", ["monkeys"]);
    s.set("Monkies", ["Monkeys"]);
    s.set("Daddys", ["Daddy's", "Daddies"]);
    s.set("Mommys", ["Mommy's", "Mommies"]);
    s.set("daddys", ["daddy's", "daddies"]);
    s.set("mommys", ["mommy's", "mommies"]);
    s.set("dat", ["that", "day"]);
    s.set("Dat", ["That", "Day"]);
    // the replacement pairs would prefer "speak"
    s.set("speach", ["speech"]);
    s.set("icecreem", ["ice cream"]);
    // in en-gb it's 'maths'
    s.set("math", ["maths"]);
    s.set("fora", ["for a"]);
    s.set("fomr", ["form", "from"]);
    s.set("lotsa", ["lots of"]);
    s.set("tryna", ["trying to"]);
    s.set("coulda", ["could have"]);
    s.set("shoulda", ["should have"]);
    s.set("woulda", ["would have"]);
    s.set("tellem", ["tell them"]);
    s.set("Tellem", ["Tell them"]);
    s.set("Webex", ["WebEx"]);
    s.set("didint", ["didn't"]);
    s.set("Didint", ["Didn't"]);
    s.set("wasint", ["wasn't"]);
    s.set("hasint", ["hasn't"]);
    s.set("doesint", ["doesn't"]);
    s.set("ist", ["is"]);
    s.set("Boing", ["Boeing"]);
    s.set("te", ["the"]);
    s.set("todays", ["today's"]);
    s.set("Todays", ["Today's"]);
    s.set("todo", ["to-do", "to do"]);
    s.set("todos", ["to-dos", "to do"]);
    s.set("heres", ["here's"]);
    s.set("Heres", ["Here's"]);
    s.set("aways", ["always"]);
    s.set("McDonalds", ["McDonald's"]);
    s.set("ux", ["UX"]);
    s.set("ive", ["I've"]);
    s.set("infos", ["informations"]);
    s.set("Infos", ["Informations"]);
    s.set("prios", ["priorities"]);
    s.set("Prio", ["Priority"]);
    s.set("prio", ["priority"]);
    s.set("Ecommerce", ["E-Commerce"]);
    s.set("ezine", ["e-zine"]);
    s.set("Ezine", ["E-zine"]);
    s.set("ezines", ["e-zines"]);
    s.set("Ezines", ["E-zines"]);
    s.set("ebook", ["e-book"]);
    s.set("ebooks", ["e-books"]);
    s.set("eBook", ["e-book"]);
    s.set("eBooks", ["e-books"]);
    s.set("Ebook", ["E-Book"]);
    s.set("Ebooks", ["E-Books"]);
    s.set("Esport", ["E-Sport"]);
    s.set("Esports", ["E-Sports"]);
    s.set("R&B", ["R & B", "R 'n' B"]);
    s.set("ie", ["i.e."]);
    s.set("eg", ["e.g."]);
    s.set("ppl", ["people"]);
    s.set("kiddin", ["kidding"]);
    s.set("doin", ["doing"]);
    s.set("nothin", ["nothing"]);
    s.set("SPOC", ["SpOC"]);
    s.set("Thx", ["Thanks"]);
    s.set("thx", ["thanks"]);
    s.set("ty", ["thank you", "thanks"]);
    s.set("Sry", ["Sorry"]);
    s.set("sry", ["sorry"]);
    s.set("im", ["I'm"]);
    s.set("spoilt", ["spoiled"]);
    s.set("Lil", ["Little"]);
    s.set("lil", ["little"]);
    s.set("gmail", ["Gmail"]);
    s.set("Sucka", ["Sucker"]);
    s.set("sucka", ["sucker"]);
    s.set("whaddya", ["what are you", "what do you"]);
    s.set("Whaddya", ["What are you", "What do you"]);
    s.set("sinc", ["sync"]);
    s.set("sweety", ["sweetie"]);
    s.set("sweetys", ["sweeties"]);
    s.set("sowwy", ["sorry"]);
    s.set("Sowwy", ["Sorry"]);
    s.set("shouldent", ["shouldn't"]);
    s.set("couldent", ["couldn't"]);
    s.set("grandmum", ["grandma", "grandmother"]);
    s.set("grandmom", ["grandma", "grandmother"]);
    s.set("Grandmum", ["Grandma", "Grandmother"]);
    s.set("Grandmom", ["Grandma", "Grandmother"]);
    s.set("enlighting", ["enlightening"]);
    s.set("Enlighting", ["Enlightening"]);
    // For non-US English
    s.set("center", ["centre"]);
    s.set("ur", ["your", "you are"]);
    s.set("Ur", ["Your", "You are"]);
    s.set("ure", ["your", "you are"]);
    s.set("Ure", ["Your", "You are"]);
    s.set("mins", ["minutes", "min"]);
    s.set("geo", ["geography", "geographic"]);
    s.set("Geo", ["Geography", "Geographic"]);
    s.set("addon", ["add-on"]);
    s.set("addons", ["add-ons"]);
    s.set("afterparty", ["after-party"]);
    s.set("Afterparty", ["After-party"]);
    s.set("wellbeing", ["well-being"]);
    s.set("cuz", ["because"]);
    s.set("Cuz", ["Because"]);
    s.set("coz", ["because"]);
    s.set("Coz", ["Because"]);
    s.set("pls", ["please"]);
    s.set("Pls", ["Please"]);
    s.set("plz", ["please"]);
    s.set("Plz", ["Please"]);
    // AtD irregular plurals - START
    s.set("addendums", ["addenda"]);
    s.set("algas", ["algae"]);
    s.set("alumnas", ["alumnae"]);
    s.set("alumnuses", ["alumni"]);
    s.set("analysises", ["analyses"]);
    s.set("appendixs", ["appendices"]);
    s.set("axises", ["axes"]);
    s.set("bacilluses", ["bacilli"]);
    s.set("bacteriums", ["bacteria"]);
    s.set("basises", ["bases"]);
    s.set("beaus", ["beaux"]);
    s.set("bisons", ["bison"]);
    s.set("buffalos", ["buffaloes"]);
    s.set("calfs", ["calves"]);
    s.set("Childs", ["Children", "Child's"]);
    s.set("childs", ["children", "child's"]);
    s.set("crisises", ["crises"]);
    s.set("criterions", ["criteria"]);
    s.set("curriculums", ["curricula"]);
    s.set("datums", ["data"]);
    s.set("deers", ["deer"]);
    s.set("diagnosises", ["diagnoses"]);
    s.set("echos", ["echoes"]);
    s.set("elfs", ["elves"]);
    s.set("ellipsises", ["ellipses"]);
    s.set("ir", ["it"]);
    s.set("embargos", ["embargoes"]);
    s.set("erratums", ["errata"]);
    s.set("firemans", ["firemen"]);
    s.set("fishs", ["fishes", "fish"]);
    s.set("genuses", ["genera"]);
    s.set("gooses", ["geese"]);
    s.set("halfs", ["halves"]);
    s.set("heros", ["heroes"]);
    s.set("indexs", ["indices", "indexes"]);
    s.set("lifes", ["lives"]);
    s.set("mans", ["men", "man's"]);
    s.set("mens", ["men", "men's"]);
    s.set("matrixs", ["matrices"]);
    s.set("meanses", ["means"]);
    s.set("mediums", ["media"]);
    s.set("memorandums", ["memoranda"]);
    s.set("mooses", ["moose"]);
    s.set("mosquitos", ["mosquitoes"]);
    s.set("moskitos", ["mosquitoes"]);
    s.set("moskito", ["mosquito"]);
    s.set("neurosises", ["neuroses"]);
    s.set("nucleuses", ["nuclei"]);
    s.set("oasises", ["oases"]);
    s.set("ovums", ["ova"]);
    s.set("oxs", ["oxen"]);
    s.set("oxes", ["oxen"]);
    s.set("paralysises", ["paralyses"]);
    s.set("potatos", ["potatoes"]);
    s.set("radiuses", ["radii"]);
    s.set("selfs", ["selves"]);
    s.set("serieses", ["series"]);
    s.set("sheeps", ["sheep"]);
    s.set("shelfs", ["shelves"]);
    s.set("scissorses", ["scissors"]);
    s.set("specieses", ["species"]);
    s.set("stimuluses", ["stimuli"]);
    s.set("stratums", ["strata"]);
    s.set("tableaus", ["tableaux"]);
    s.set("thats", ["those"]);
    s.set("thesises", ["theses"]);
    s.set("thiefs", ["thieves"]);
    s.set("thises", ["these"]);
    s.set("tomatos", ["tomatoes"]);
    s.set("tooths", ["teeth"]);
    s.set("torpedos", ["torpedoes"]);
    s.set("vertebras", ["vertebrae"]);
    s.set("vetos", ["vetoes"]);
    s.set("vitas", ["vitae"]);
    s.set("watchs", ["watches"]);
    s.set("wifes", ["wives", "wife's"]);
    s.set("womans", ["women", "woman's"]);
    s.set("Womans", ["Women", "Woman's"]);
    s.set("womens", ["women's"]);
    s.set("Womens", ["Women's"]);
    s.set("deauthorized", ["unauthorized"]);
    // AtD irregular plurals - END
    // "tippy-top" is an often used word by Donald Trump
    s.set("tippy-top", ["tip-top", "top most"]);
    s.set("tippytop", ["tip-top", "top most"]);
    s.set("imma", ["I'm going to", "I'm a"]);
    s.set("Imma", ["I'm going to", "I'm a"]);
    s.set("dontcha", ["don't you"]);
    s.set("tobe", ["to be"]);
    s.set("Gi", ["Hi"]);
    s.set("Ji", ["Hi"]);
    s.set("Dontcha", ["don't you"]);
    s.set("greatfruit", ["grapefruit", "great fruit"]);
    s.set("Insta", ["Instagram"]);
    s.set("IO", ["I/O"]);
    s.set("wierd", ["weird"]);
    s.set("Wierd", ["Weird"]);
    s.set("HipHop", ["Hip-Hop"]);
    s.set("gove", ["love", "give", "gave", "move"]);
    s.set("birdseye", ["bird's-eye"]);
    s.set("Birdseye", ["Bird's-eye"]);
    s.set("al", ["all", "Al"]);
    s.set("publically", ["publicly"]);
    s.set("fo", ["for"]);
    s.set("shawty", ["shorty"]);
    s.set("Shawty", ["Shorty"]);
    s.set("savy", ["savvy"]);
    s.set("Savy", ["Savvy"]);
    s.set("automization", ["automatization"]);
    s.set("automisation", ["automatisation"]);
    s.set("Automization", ["Automatization"]);
    s.set("Automisation", ["Automatisation"]);
    s.set("aswell", ["as well"]);
    s.set("Continuesly", ["Continuously"]);
    s.set("continuesly", ["continuously"]);
    s.set("humain", ["humane", "human"]);
    s.set("protene", ["protein"]);
    s.set("throught", ["thought", "through", "throat"]);
    s.set("specifity", ["specificity"]);
    s.set("specicity", ["specificity"]);
    s.set("Specifity", ["Specificity"]);
    s.set("Specicity", ["Specificity"]);
    s.set("specifities", ["specificities"]);
    s.set("specicities", ["specificities"]);
    s.set("Specifities", ["Specificities"]);
    s.set("Specicities", ["Specificities"]);
    s.set("Neonazi", ["Neo-Nazi"]);
    s.set("Neonazis", ["Neo-Nazis"]);
    s.set("neonazi", ["neo-Nazi"]);
    s.set("neonazis", ["neo-Nazis"]);
    s.set("fiveteen", ["fifteen"]);
    s.set("Fiveteen", ["Fifteen"]);
    s.set("critism", ["criticism"]);
    s.set("Critism", ["Criticism"]);
    s.set("Hobbie", ["Hobby"]);
    s.set("hobbie", ["hobby"]);
    s.set("Hobbys", ["Hobbies"]);
    s.set("hobbys", ["hobbies"]);
    s.set("Copie", ["Copy"]);
    s.set("Copys", ["Copies"]);
    s.set("copie", ["copy"]);
    s.set("copys", ["copies"]);
    s.set("unconform", ["nonconform"]);
    s.set("Unconform", ["Nonconform"]);
    s.set("rideshare", ["ride-share"]);
    s.set("Rideshare", ["Ride-share"]);
    s.set("Rideshares", ["Ride-shares"]);
    s.set("dropoff", ["drop-off"]);
    s.set("Dropoff", ["Drop-off"]);
    s.set("reportings", ["reports", "reporting"]);
    s.set("Reportings", ["Reports", "Reporting"]);
    s.set("luv", ["love"]);
    s.set("luvs", ["loves"]);
    s.set("Luv", ["Love"]);
    s.set("Luvs", ["Loves"]);
    s.set("islam", ["Islam"]);
    s.set("andit", ["and it"]);
    s.set("wud", ["what", "mud", "bud"]);
    s.set("Wud", ["What", "Mud", "Bud"]);
    s.set("fablet", ["phablet", "tablet"]);
    s.set("Fablet", ["Phablet", "Tablet"]);
    s.set("companys", ["companies", "company's", "company"]);
    s.set("Companys", ["Companies", "Company's", "Company"]);
    s.set("unencode", ["decode"]);
    s.set("unencodes", ["decodes"]);
    s.set("unencoded", ["decoded"]);
    s.set("unencoding", ["decoding"]);
    s.set("cheq", ["check"]);
    s.set("southwest", ["south-west"]);
    s.set("southeast", ["south-east"]);
    s.set("northwest", ["north-west"]);
    s.set("northeast", ["north-east"]);
    s.set("Marylin", ["Marilyn"]);
    s.set("blest", ["blessed"]);
    s.set("yeld", ["yelled"]);
    s.set("os", ["OS", "is", "so"]);
    s.set("abel", ["able"]);
    s.set("param", ["parameter"]);
    s.set("params", ["parameters"]);
    s.set("Param", ["Parameter"]);
    s.set("Params", ["Parameters"]);
    s.set("amature", ["amateur"]);
    s.set("amatures", ["amateurs"]);
    s.set("egoic", ["egoistic"]);
    s.set("tarpit", ["tar pit"]);
    s.set("tarpits", ["tar pits"]);
    s.set("Tarpit", ["Tar pit"]);
    s.set("Tarpits", ["Tar pits"]);
    s.set("wheater", ["weather"]);
    s.set("Wheater", ["Weather"]);
    s.set("defi", ["defibrillator", "DeFi"]);
    s.set("Defi", ["Defibrillator", "DeFi"]);
    s.set("topup", ["top-up"]);
    s.set("topups", ["top-ups"]);
    s.set("nacked", ["backed", "naked"]);
    s.set("no-profit", ["non-profit"]);
    s.set("No-profit", ["Non-profit"]);
    s.set("wrose", ["worse"]);
    s.set("Wrose", ["Worse"]);
    s.set("reak", ["wreak"]);
    s.set("Reak", ["Wreak"]);
    s.set("reaks", ["wreaks"]);
    s.set("Reaks", ["Wreaks"]);
    s.set("reaked", ["wreaked"]);
    s.set("Reaked", ["Wreaked"]);
    s.set("reaking", ["wreaking"]);
    s.set("Reaking", ["Wreaking"]);
    s.set("hight", ["height"]);
    s.set("Hight", ["Height"]);
    s.set("fulltime", ["full-time"]);
    s.set("Fulltime", ["Full-time"]);
    s.set("slimiar", ["similar"]);
    s.set("Slimiar", ["Similar"]);

    return s;
  }

  /**
   * @since 2.7
   */
  protected override getAdditionalTopSuggestions(suggestions: readonly SuggestedReplacement[], word: string): SuggestedReplacement[] {
    /*if (word.length() < 20 && word.matches("[a-zA-Z-]+.?")) {
      List<String> prefixes = Arrays.asList("inter", "pre");
      for (String prefix : prefixes) {
        if (word.startsWith(prefix)) {
          String lastPart = word.substring(prefix.length());
          if (!isMisspelled(lastPart)) {
            // as these are only single words and both the first part and the last part are spelled correctly
            // (but the combination is not), it's okay to log the words from a privacy perspective:
            logger.info("UNKNOWN-EN: " + word);
          }
        }
      }
    }*/
    const curatedSuggestions: string[] = [];
    curatedSuggestions.push(...(this.topSuggestions.get(word) ?? []));
    curatedSuggestions.push(...(this.topSuggestionsIgnoreCase.get(word.toLowerCase()) ?? []));
    if (curatedSuggestions.length !== 0) {
      return SuggestedReplacement.convert(curatedSuggestions);
    } else if (word.endsWith("ys")) {
      const suggestion = StringReplaceFirst(word, "ys$", "ies");
      if (!this.speller1.isMisspelled(suggestion)) {
        return SuggestedReplacement.convert([suggestion]);
      }
    }
    return super.getAdditionalTopSuggestions(suggestions, word);
  }

  // trivial approach that assumes only one part of the hyphenated word has a typo...
  protected override addHyphenSuggestions(parts: string[], topSuggestions: SuggestedReplacement[]): void {
    let i = 0;
    for (const part of parts) {
      if (this.isMisspelled(part)) {
        let partSuggestions = this.speller1.getSuggestions(part);
        if (partSuggestions.length === 0) {
          partSuggestions = this.speller2.getSuggestions(part);
        }
        if (partSuggestions.length > 0) {
          const suggestion = this.getHyphenatedWordSuggestion(parts, i, partSuggestions[0]!);
          topSuggestions.push(new SuggestedReplacement(suggestion));
        }
      }
      i++;
    }
  }

  private getHyphenatedWordSuggestion(parts: readonly string[], currentPos: number, currentPostSuggestion: string): string {
    const newParts: string[] = [];
    for (let j = 0; j < parts.length; j++) {
      if (currentPos === j) {
        newParts.push(currentPostSuggestion);
      } else {
        newParts.push(parts[j]!);
      }
    }
    return newParts.join("-");
  }

  // getTranslator(globalConfig) is not ported (see the header)

  // Do not tokenize new words from spelling.txt...
  // Multi-token words should be in multiwords.txt
  protected override tokenizeNewWords(): boolean {
    return false;
  }

  protected override getOnlySuggestions(word: string): SuggestedReplacement[] {
    const p = P();
    // NOTE: only add words here that would otherwise have more than one suggestion
    // and have apply to all variants of English (en-US, en-GB, ...):
    if (p.PROFILERATION.matcher(word).matches())
      return topMatch(replaceOnce(word, "rofileration", "roliferation"), "rapid expansion");
    if (p.CEMETARY.matcher(word).matches()) return topMatch(replaceOnce(word, "emetary", "emetery"));
    if (p.CEMETARIES.matcher(word).matches()) return topMatch(replaceOnce(word, "emetaries", "emeteries"));
    if (p.BASICLY.matcher(word).matches()) return topMatch(replaceOnce(word, "asicly", "asically"));
    if (p.BELEIVES.matcher(word).matches()) return topMatch(replaceOnce(word, "eleive", "elieve"));
    if (p.BELIVES.matcher(word).matches()) return topMatch(replaceOnce(word, "elive", "elieve"));
    if (p.BIZZARE.matcher(word).matches()) return topMatch(replaceOnce(word, "izzare", "izarre"));
    if (p.COMPLETLY.matcher(word).matches()) return topMatch(replaceOnce(word, "ompletly", "ompletely"));
    if (p.DISSAPEARS.matcher(word).matches()) return topMatch(replaceOnce(word, "issapear", "isappear"));
    if (p.FARENHEIT.matcher(word).matches()) return topMatch(replaceOnce(word, "arenheit", "ahrenheit"));
    if (p.FREINDS.matcher(word).matches()) return topMatch(replaceOnce(word, "reind", "riend"));
    if (p.INCIDENTLY.matcher(word).matches()) return topMatch(replaceOnce(word, "ncidently", "ncidentally"));
    if (p.INTERUPTS.matcher(word).matches()) return topMatch(replaceOnce(word, "nterupt", "nterrupt"));
    if (p.LOLLYPOPS.matcher(word).matches()) return topMatch(replaceOnce(word, "ollypop", "ollipop"));
    if (p.OCASSIONS.matcher(word).matches()) return topMatch(replaceOnce(word, "cassion", "ccasion"));
    if (p.OCCURANCES.matcher(word).matches()) return topMatch(replaceOnce(word, "ccurance", "ccurrence"));
    if (p.PERSISTANT.matcher(word).matches()) return topMatch(replaceOnce(word, "ersistant", "ersistent"));
    if (p.PEICES.matcher(word).matches()) return topMatch(replaceOnce(word, "eice", "iece"));
    if (p.SEIGES.matcher(word).matches()) return topMatch(replaceOnce(word, "eige", "iege"));
    if (p.SUPERCEDES.matcher(word).matches()) return topMatch(replaceOnce(word, "upercede", "upersede"));
    if (p.THRESHHOLDS.matcher(word).matches()) return topMatch(replaceOnce(word, "hreshhold", "hreshold"));
    if (p.TOMMORROWS.matcher(word).matches()) return topMatch(replaceOnce(word, "ommorrow", "omorrow"));
    if (p.TOUTES.matcher(word).matches()) return topMatch(replaceOnce(word, "ounge", "ongue"));
    if (p.WIERD.matcher(word).matches()) return topMatch(replaceOnce(word, "ierd", "eird"));
    if (p.SARGENT.matcher(word).matches()) return topMatch(replaceOnce(word, "argent", "ergeant"));
    if (p.SWIMMED.matcher(word).matches()) return topMatch("swam");
    if (p.MISSPELT.matcher(word).matches()) return topMatch("misspelled");
    if (p.ADHOC.matcher(word).matches()) return topMatch("ad hoc");
    if (p.DEACTIVE.matcher(word).matches()) return topMatch("inactive");
    if (p.HUBSPOT.matcher(word).matches()) return topMatch("HubSpot");
    if (p.URL.matcher(word).matches()) return topMatch("URL");
    if (p.HTTP.matcher(word).matches()) return topMatch("HTTP");
    if (p.HTTPS.matcher(word).matches()) return topMatch("HTTPS");
    if (p.FYI.matcher(word).matches()) return topMatch("FYI");
    if (p.EUROPEAN.matcher(word).matches()) return topMatch("European");
    if (p.EUROPEANS.matcher(word).matches()) return topMatch("Europeans");
    if (p.DEVOPS.matcher(word).matches()) return topMatch("DevOps");
    if (p.MICROSOFT.matcher(word).matches()) return topMatch("Microsoft");
    if (p.LANGUAGETOOL.matcher(word).matches()) return topMatch("LanguageTool");
    if (p.HONGKONG.matcher(word).matches()) return topMatch("Hong Kong");
    if (p.OCTOBER.matcher(word).matches()) return topMatch("October");
    if (p.SEPTEMBER.matcher(word).matches()) return topMatch("September");
    if (p.DECEMBER.matcher(word).matches()) return topMatch("December");
    if (p.NOVEMBER.matcher(word).matches()) return topMatch("November");
    if (p.APRIL.matcher(word).matches()) return topMatch("April");
    if (p.AFAIK.matcher(word).matches()) return topMatch("AFAIK");
    if (p.JANUARY.matcher(word).matches()) return topMatch("January");
    if (p.ADMITTINGLY.matcher(word).matches()) return topMatch(replaceOnce(word, "dmittingly", "dmittedly"));
    if (p.ENGLISH.matcher(word).matches()) return topMatch("English");
    if (p.SPANISH.matcher(word).matches()) return topMatch("Spanish");
    if (p.UNDETERMINISTIC.matcher(word).matches()) return topMatch("nondeterministic");
    if (p.WDYT.matcher(word).matches()) return topMatch("WDYT");
    if (p.INTRANSPARENT.matcher(word).matches()) return topMatch(replaceOnce(word, "in", "un"));
    if (p.UNCOMPLIANT.matcher(word).matches()) return topMatch("non-compliant");
    if (p.UX.matcher(word).matches()) return topMatch("UX");
    if (p.GITLAB.matcher(word).matches()) return topMatch("GitLab");
    if (p.BONAFIDE.matcher(word).matches()) return topMatch(replaceOnce(word, "onafide", "ona fide"));
    if (p.ALLRIGHT.matcher(word).matches()) return topMatch(replaceOnce(word, "llright", "lright"));
    if (p.ADDON.matcher(word).matches()) return topMatch(replaceOnce(word, "ddon", "dd-on"));
    if (p.WHEREEVER.matcher(word).matches()) return topMatch(replaceOnce(word, "hereever", "herever"));
    if (p.WHATSAPP.matcher(word).matches()) return topMatch("WhatsApp");
    if (p.UNINSPIRATIONAL.matcher(word).matches()) return topMatch(replaceOnce(word, "ninspirational", "ninspiring"));
    if (p.JETLAGGED.matcher(word).matches()) return topMatch("jet-lagged");
    if (p.MACBOOK.matcher(word).matches()) return topMatch(replaceOnce(word, "acbook", "acBook"));
    if (p.LIKELYHOOD.matcher(word).matches()) return topMatch(replaceOnce(word, "ikelyhood", "ikelihood"));
    if (p.UNECESSARY.matcher(word).matches()) return topMatch(replaceOnce(word, "necessary", "nnecessary"));
    if (p.FORSEEABLE.matcher(word).matches()) return topMatch(replaceOnce(word, "orseeable", "oreseeable"));
    if (p.UNFORSEEABLE.matcher(word).matches()) return topMatch(replaceOnce(word, "orseeable", "oreseeable"));
    if (p.FORSEEABLY.matcher(word).matches()) return topMatch(replaceOnce(word, "orseeably", "oreseeably"));
    if (p.UNFORSEEABLY.matcher(word).matches()) return topMatch(replaceOnce(word, "orseeably", "oreseeably"));
    if (p.QUILLBOT1.matcher(word).matches() || p.QUILLBOT2.matcher(word).matches()) return topMatch("QuillBot");
    if (p.QUILLBOT_POS.matcher(word).matches() || p.QUILLBOT1_POS.matcher(word).matches() ||
      p.QUILLBOT2_POS.matcher(word).matches()) {
      const l: SuggestedReplacement[] = [];
      l.push(new SuggestedReplacement("QuillBot's"));
      l.push(new SuggestedReplacement("QuillBot"));
      return l;
    }
    if (p.TV.matcher(word).matches()) {
      const l: SuggestedReplacement[] = [];
      l.push(new SuggestedReplacement("TV"));
      l.push(new SuggestedReplacement("to"));
      return l;
    }
    if (p.JIST.matcher(word).matches()) {
      const l: SuggestedReplacement[] = [];
      l.push(new SuggestedReplacement("just"));
      l.push(new SuggestedReplacement("gist"));
      return l;
    }
    return [];
  }

}

class IrregularForms {
  readonly baseform: string;
  readonly posName: string;
  readonly formName: string;
  readonly forms: string[];
  constructor(baseform: string, posName: string, formName: string, forms: string[]) {
    this.baseform = baseform;
    this.posName = posName;
    this.formName = formName;
    this.forms = forms;
  }
}
