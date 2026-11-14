// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractRepeatedWordsRule.java faithful
// The Scanner reading the word file line by line is a split of the decoded text (at Scanner's
// line separators).
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import { AnalyzedToken } from '../AnalyzedToken.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../JLanguageTool.ts';
import type { Language } from '../Language.ts';
import type { Synthesizer } from '../synthesis/Synthesizer.ts';
import { StringTools } from '../tools/StringTools.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { SynonymsData } from './SynonymsData.ts';
import { TextLevelRule } from './TextLevelRule.ts';
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern, StringMatches, StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';

const PUNCT_PATTERN = Pattern.compile('\\p{P}');
const HASH_PATTERN = Pattern.compile('#.*');
const FILE_ENCODING = 'utf-8';

export abstract class AbstractRepeatedWordsRule extends TextLevelRule {

  protected abstract getWordsToCheck(): Map<string, SynonymsData>;

  protected abstract getSynthesizer(): Synthesizer;

  override minToCheckParagraph(): number {
    return 1;
  }

  protected maxWordsDistance(): number {
    return 150;
  }

  protected abstract getMessage(): string;

  protected abstract getShortMessage(): string;

  override getId(): string {
    return this.ruleId;
  }

  private readonly ruleId: string;
  protected readonly language: Language;

  abstract override getDescription(): string;

  constructor(messages: ResourceBundle, language: Language) {
    super(messages);
    super.setCategory(Categories.REPETITIONS_STYLE.getCategory(messages));
    super.setLocQualityIssueType(ITSIssueType.Style);
    this.ruleId = language.getShortCode().toUpperCase() + '_' + 'REPEATEDWORDS';
    this.language = language;
  }

  protected adjustPostag(postag: string): string {
    return postag;
  }

  protected abstract isException(tokens: AnalyzedTokenReadings[], i: number, sentStart: boolean,
      isCapitalized: boolean, isAllUppercase: boolean): boolean;

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const matches: RuleMatch[] = [];
    // int sentenceNumber = 0;
    let wordNumber = 0;
    const wordsLastSeen = new Map<string, number>();
    let pos = 0;
    let prevSentenceLength = 0;
    for (const sentence of sentences) {
      // sentenceNumber++;
      const tokens = this.getSentenceWithImmunization(sentence).getTokensWithoutWhitespace();
      pos += prevSentenceLength;
      prevSentenceLength = sentence.getText().length;
      // ignore sentences not ending in period
      const lastToken = tokens[tokens.length - 1]!.getToken();
      if (lastToken !== '.' && lastToken !== '!' && lastToken !== '?') {
        continue;
      }
      let sentStart = true;
      const lemmasInSentece: string[] = [];
      let i = -1;
      for (const atrs of tokens) {
        if (atrs.isImmunized()) {
          continue;
        }
        const token = atrs.getToken();
        if (token.length !== 0) {
          wordNumber++;
        }
        const isCapitalized = StringTools.isCapitalizedWord(token);
        const isAllUppercase = StringTools.isAllUppercase(token);
        i++;
        const isException = token.length === 0 || this.isException(tokens, i, sentStart, isCapitalized, isAllUppercase);
        if (sentStart && token.length !== 0 && !PUNCT_PATTERN.matcher(token).matches()) {
          sentStart = false;
        }
        if (isException) {
          continue;
        }
        const lemmas: (string | null)[] = [];
        for (const atr of atrs) {
          const lemma = atr.getLemma();
          lemmas.push(lemma);
          const seenInWordPosition = lemma == null ? undefined : wordsLastSeen.get(lemma);
          if (seenInWordPosition != null && !lemmasInSentece.includes(lemma!)
              && (wordNumber - seenInWordPosition) <= this.maxWordsDistance()) {
            let createMatch = true;
            const postag = this.getWordsToCheck().get(lemma!)!.getPostag();
            if (postag != null && !StringMatches(atr.getPOSTag()!, postag)) {
              createMatch = false;
            }
            const chunk = this.getWordsToCheck().get(lemma!)!.getChunk();
            if (chunk != null && !atrs.matchesChunkRegex(chunk)) {
              createMatch = false;
            }
            // create match
            if (createMatch) {
              const rulematch = new RuleMatch(this, sentence, pos + atrs.getStartPos(), pos + atrs.getEndPos(),
                  this.getMessage(), this.getShortMessage());
              rulematch.setSpecificRuleId(this.ruleId + '_' + StringTools.toId(lemma!, this.language));
              const replacementLemmas = this.getWordsToCheck().get(lemma!)!.getSynonyms();
              for (const replacementLemma of replacementLemmas) {
                let replacements = this.getSynthesizer().synthesize(
                    new AnalyzedToken(token, atr.getPOSTag(), replacementLemma), this.adjustPostag(atr.getPOSTag()!), true);
                // if there is no result from the synthesizer, use the lemma as it is (it can be a multiword)
                if (replacements.length === 0) {
                  replacements = [replacementLemma];
                }
                for (let r of replacements) {
                  if (isAllUppercase) {
                    r = r.toUpperCase();
                  } else if (isCapitalized) {
                    r = StringTools.uppercaseFirstChar(r)!;
                  }
                  rulematch.addSuggestedReplacement(r);
                }
              }
              matches.push(rulematch);
              break;
            }
          }
        }
        // count even if postag/chunk don't match
        for (const lemma of lemmas) {
          if (lemma != null && this.getWordsToCheck().has(lemma)) {
            wordsLastSeen.set(lemma, wordNumber);
            lemmasInSentece.push(lemma);
          }
        }
      }
    }
    return this.toRuleMatchArray(matches);
  }

  protected static loadWords(path: string): Map<string, SynonymsData> {
    const inputStream = JLanguageTool.getDataBroker().getFromRulesDirAsStream(path);
    const map = new Map<string, SynonymsData>();
    const scanner = new TextDecoder(FILE_ENCODING).decode(inputStream).split(/\r\n|[\n\r\u2028\u2029\u0085]/);
    for (const nextLine of scanner) {
      const line = StringTrim(HASH_PATTERN.matcher(nextLine).replaceFirst(''));
      if (line.length === 0) {
        continue;
      }
      const mainParts = StringSplit(line, '=');
      let parts: string[];
      let postag: string | null = null;
      let chunk: string | null = null;
      let word: string;
      if (mainParts.length === 2) {
        parts = StringSplit(mainParts[1]!, ';');
        word = mainParts[0]!;
        const wordPosChunk = StringSplit(word, '/');
        word = wordPosChunk[0]!;
        if (wordPosChunk.length > 1) {
          postag = wordPosChunk[1]!;
        }
        if (wordPosChunk.length > 2) {
          chunk = wordPosChunk[2]!;
        }
      } else if (mainParts.length === 1) {
        parts = StringSplit(line, ';');
        word = '';
      } else {
        throw new Error('RuntimeException: Format error in file ' + path + ', line: ' + line);
      }
      if (word.length === 0 && parts.length < 2 || word.length !== 0 && parts.length < 1) {
        throw new Error('RuntimeException: Format error in file ' + path + ', line: ' + line);
      }
      if (word.length !== 0) {
        if (!map.has(word)) {
          const synonymsData = new SynonymsData([...parts], postag, chunk);
          map.set(word, synonymsData);
        } else {
          throw new Error('RuntimeException: Word found in more than one line. "' + word + '" in line: ' + line);
        }
      } else {
        for (const key of parts) {
          const values: string[] = [];
          for (const value of parts) {
            if (value !== key) {
              values.push(value);
            }
          }
          if (!map.has(key)) {
            const synonymsData = new SynonymsData(values, postag, chunk);
            map.set(key, synonymsData);
          } else {
            throw new Error('RuntimeException: Word found in more than one line. "' + key + '" in line: ' + line);
          }
        }
      }
    }
    return map;
  }

}
