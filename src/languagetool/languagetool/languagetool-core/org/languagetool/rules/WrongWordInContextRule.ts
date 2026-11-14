// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/WrongWordInContextRule.java faithful
// The Guava cache (expiring after 30 minutes) is a Map. The Scanner reading the stream line by
// line is a split of the decoded text. The nested class ContextWords is exported as ContextWords.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import { JLanguageTool } from '../JLanguageTool.ts';
import type { Language } from '../Language.ts';
import { StringTools } from '../tools/StringTools.ts';
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Matcher, Pattern, StringReplaceFirst, StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Category } from './Category.ts';
import { CategoryIds } from './CategoryIds.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';
import { SpecificIdRule } from './SpecificIdRule.ts';

const cache = new Map<string, readonly ContextWords[]>();

/**
 * Check if there is a confusion of two words (which might have a similar spelling) depending on the context.
 * This rule loads the words and their respective context from an external file with the following 
 * format (tab-separated):
 * 
 * <pre>word1 word2 match1 match2 context1 context2 explanation1 explanation2</pre>
 * 
 * <ul>
 * <li>word1 and word2 are regular expressions of the words that can easily be confused
 * <li>match1 is the substring of word1 that will be replaced with match2 when word1 occurs in a context where it is probably wrong (and vice versa) 
 * <li>context1 is the context in which word1 typically occurs (but which is wrong for word2), given as a regular expression
 * <li>context2 is the context in which word2 typically occurs (but which is wrong for word1), given as a regular expression
 * <li>explanation1 is a short description of word1 (optional)
 * <li>explanation2 is a short description of word2 (optional)
 * </ul>
 * 
 * @author Markus Brenneis
 */
export abstract class WrongWordInContextRule extends Rule {

  private readonly contextWordsSet: readonly ContextWords[];
  private readonly lang: Language;

  private matchLemmas = false;

  constructor(_messages: ResourceBundle | null, lang: Language) {
    super();
    super.setCategory(new Category(CategoryIds.CONFUSED_WORDS, this.getCategoryString()));
    const filename = this.getFilename();
    let contextWords = cache.get(filename);
    if (contextWords === undefined) {
      contextWords = WrongWordInContextRule.loadContextWords(filename);
      cache.set(filename, contextWords);
    }
    this.contextWordsSet = contextWords;
    this.setLocQualityIssueType(ITSIssueType.Misspelling);
    this.lang = lang;
  }

  protected abstract getFilename(): string;

  protected getCategoryString(): string {
    return this.messages!.getString('category_misc');
  }

  override getId(): string {
    return 'WRONG_WORD_IN_CONTEXT';
  }

  override getDescription(): string {
    return 'Confusion of words';
  }

  /*
   *  Match lemmas instead of word forms
   */
  setMatchLemmmas(): void {
    this.matchLemmas = true;
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = sentence.getTokensWithoutWhitespace();
    const sentenceLower = sentence.getText().toLowerCase();
    for (const contextWords of this.contextWordsSet) {
      if (!contextWords.couldMatchSentence(sentenceLower)) {
        continue;
      }
      const matchedWord = [false, false];
      const matchers: Matcher[] = [contextWords.words[0]!.matcher(''), contextWords.words[1]!.matcher('')];
      let matchedPos0 = -1, matchedPos1 = -1;
      let token1 = '', token2 = '';
      // search for word1 and word2 in a single pass, ignoring token 0 (SENT_START)
      for (let k = 1; k < tokens.length && (!matchedWord[0] || !matchedWord[1]); k++) {
        if (!tokens[k]!.hasPartialPosTag('IS_URL')) {
          const t = tokens[k]!.getToken();
          if (!matchedWord[0] && matchers[0]!.reset(t).find()) {
            matchedWord[0] = true;
            matchedPos0 = k;
            token1 = t;
          }
          if (!matchedWord[1] && matchers[1]!.reset(t).find()) {
            matchedWord[1] = true;
            matchedPos1 = k;
            token2 = t;
          }
        }
      }
      let foundWord = -1;
      let notFoundWord = -1;
      let startPos = 0;
      let endPos = 0;
      let matchedToken = '';
      // when both words have been found, we cannot determine if one of them is wrong
      if (matchedWord[0] && !matchedWord[1]) {
        foundWord = 0;
        notFoundWord = 1;
        startPos = tokens[matchedPos0]!.getStartPos();
        endPos = tokens[matchedPos0]!.getStartPos() + token1.length;
        matchedToken = token1;
      } else if (matchedWord[1] && !matchedWord[0]) {
        foundWord = 1;
        notFoundWord = 0;
        startPos = tokens[matchedPos1]!.getStartPos();
        endPos = tokens[matchedPos1]!.getStartPos() + token2.length;
        matchedToken = token2;
      }

      if (foundWord !== -1) {
        const matchedContext = [false, false];
        matchers[foundWord] = contextWords.contexts[foundWord]!.matcher('');
        matchers[notFoundWord] = contextWords.contexts[notFoundWord]!.matcher('');
        // search for both context patterns in a single pass, ignoring token 0 (SENT_START)
        for (let k = 1; k < tokens.length && (!matchedContext[foundWord] || !matchedContext[notFoundWord]); k++) {
          if (this.matchLemmas) {
            for (let j = 0; j < tokens[k]!.getReadingsLength() && (!matchedContext[foundWord] || !matchedContext[notFoundWord]); j++) {
              const lemma = tokens[k]!.getAnalyzedToken(j).getLemma();
              if (lemma != null && lemma.length > 0) {
                if (!matchedContext[foundWord]) {
                  matchedContext[foundWord] = matchers[foundWord]!.reset(lemma).find();
                }
                if (!matchedContext[notFoundWord]) {
                  matchedContext[notFoundWord] = matchers[notFoundWord]!.reset(lemma).find();
                }
              }
            }
          } else {
            const token = tokens[k]!.getToken();
            if (!matchedContext[foundWord]) {
              matchedContext[foundWord] = matchers[foundWord]!.reset(token).find();
            }
            if (!matchedContext[notFoundWord]) {
              matchedContext[notFoundWord] = matchers[notFoundWord]!.reset(token).find();
            }
          }
        }
        if (matchedContext[notFoundWord] && !matchedContext[foundWord]) {
          const originalStr = contextWords.matches[foundWord]!;
          const replacementStr = contextWords.matches[notFoundWord]!;
          const repl = StringTools.preserveCase(StringReplaceFirst(matchedToken, '(?i)' + originalStr, replacementStr)
            , matchedToken);
          const msg = this.getMessage(matchedToken, repl, contextWords.explanations[notFoundWord]!, contextWords.explanations[foundWord]!);
          const id = StringTools.toId(this.getId() + '_' + matchedToken + '_' + repl, this.lang);
          const desc = this.getDescription().replaceAll('$match', matchedToken + '/' + repl);
          const specificIdRule = new SpecificIdRule(id, desc, this.isPremium(), this.getCategory(), this.getLocQualityIssueType(), this.getTags());
          const ruleMatch = new RuleMatch(specificIdRule, sentence, startPos, endPos, msg, this.getShortMessageString());
          ruleMatches.push(ruleMatch);
        }
      } // if foundWord != -1
    } // for each contextWords in contextWordsSet
    return this.toRuleMatchArray(ruleMatches);
  }

  /**
   * @return a string like "Possible confusion of words: Did you mean &lt;suggestion&gt;$SUGGESTION&lt;/suggestion&gt; instead of '$WRONGWORD'?"
   */
  protected abstract getMessageString(): string;

  /**
   * @return a string like "Possible confusion of words"
   */
  protected abstract getShortMessageString(): string;

  /**
   * @return a string like "Possible confusion of words: Did you mean &lt;suggestion&gt;$SUGGESTION&lt;/suggestion&gt;
   * (= $EXPLANATION_SUGGESTION) instead of '$WRONGWORD' (= $EXPLANATION_WRONGWORD)?"
   */
  protected abstract getLongMessageString(): string;

  private getMessage(wrongWord: string, suggestion: string, explanationSuggestion: string, explanationWrongWord: string): string {
    const quotedSuggestion = Matcher.quoteReplacement(suggestion);
    const quotedWrongWord = Matcher.quoteReplacement(wrongWord);
    const quotedExplanationSuggestion = Matcher.quoteReplacement(explanationSuggestion);
    const quotedExplanationWrongWord = Matcher.quoteReplacement(explanationWrongWord);
    if (explanationSuggestion.length === 0 || explanationWrongWord.length === 0) {
      return StringReplaceFirst(StringReplaceFirst(this.getMessageString(),
        '\\$SUGGESTION', quotedSuggestion),
        '\\$WRONGWORD', quotedWrongWord);
    } else {
      return StringReplaceFirst(StringReplaceFirst(StringReplaceFirst(StringReplaceFirst(this.getLongMessageString(),
        '\\$SUGGESTION', quotedSuggestion),
        '\\$WRONGWORD', quotedWrongWord),
        '\\$EXPLANATION_SUGGESTION', quotedExplanationSuggestion),
        '\\$EXPLANATION_WRONGWORD', quotedExplanationWrongWord);
    }
  }

  /**
   * Load words, contexts, and explanations.
   */
  private static loadContextWords(path: string): readonly ContextWords[] {
    const set: ContextWords[] = [];
    const stream = JLanguageTool.getDataBroker().getFromRulesDirAsStream(path);
    const lines = new TextDecoder('utf-8').decode(stream).split(/\r\n|[\n\r\u2028\u2029\u0085]/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      if (StringTrim(line).length === 0 || line.charAt(0) === '#') {
        continue;
      }
      const column = StringSplit(line, '\t');
      if (column.length >= 6) {
        const contextWords = new ContextWords();
        contextWords.setWord(0, column[0]!);
        contextWords.setWord(1, column[1]!);
        contextWords.matches[0] = column[2]!;
        contextWords.matches[1] = column[3]!;
        contextWords.setContext(0, column[4]!);
        contextWords.setContext(1, column[5]!);
        if (column.length > 6) {
          contextWords.explanations[0] = column[6]!;
          if (column.length > 7) {
            contextWords.explanations[1] = column[7]!;
          }
        }
        set.push(contextWords);
      } // if (column.length >= 6)
    }
    return set;
  }

}

export class ContextWords {

  private static readonly MIN_PREFIX_LENGTH = 3;

  readonly matches: string[] = ['', ''];
  readonly explanations: string[] = ['', ''];
  readonly words: (Pattern | null)[];
  readonly contexts: (Pattern | null)[];
  readonly wordPrefixes: string[] = ['', ''];

  constructor() {
    this.words = [null, null];
    this.contexts = [null, null];
  }

  private addBoundaries(str: string): string {
    let ignoreCase = '';
    if (str.startsWith('(?i)')) {
      str = str.substring(4);
      ignoreCase = '(?i)';
    }
    return ignoreCase + '\\b(' + str + ')\\b';
  }

  setWord(i: number, word: string): void {
    this.words[i] = Pattern.compile(this.addBoundaries(word));
    let pattern = word;
    if (pattern.startsWith('(?i)')) {
      pattern = pattern.substring(4);
    } else if (pattern.startsWith('(?-i)')) {
      pattern = pattern.substring(5);
    }
    this.wordPrefixes[i] = ContextWords.extractWordPrefix(pattern);
  }

  setContext(i: number, context: string): void {
    this.contexts[i] = Pattern.compile(this.addBoundaries(context));
  }

  couldMatchSentence(sentenceLower: string): boolean {
    const word0Could = this.wordPrefixes[0]!.length === 0 || sentenceLower.includes(this.wordPrefixes[0]!);
    const word1Could = this.wordPrefixes[1]!.length === 0 || sentenceLower.includes(this.wordPrefixes[1]!);
    return word0Could || word1Could;
  }

  private static extractWordPrefix(pattern: string): string {
    const alternatives = ContextWords.splitTopLevelAlternatives(pattern);
    const prefixes: string[] = [];
    for (const alt of alternatives) {
      const p = ContextWords.extractSimplePrefix(alt);
      if (p.length < ContextWords.MIN_PREFIX_LENGTH) {
        return '';
      }
      prefixes.push(p.toLowerCase());
    }
    if (prefixes.length === 0) {
      return '';
    }
    let common = prefixes[0]!;
    for (let i = 1; i < prefixes.length; i++) {
      common = ContextWords.commonPrefix(common, prefixes[i]!);
      if (common.length < ContextWords.MIN_PREFIX_LENGTH) {
        return '';
      }
    }
    return common;
  }

  private static splitTopLevelAlternatives(pattern: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern.charAt(i);
      if (c === '\\') { i++; continue; }
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === '|' && depth === 0) {
        parts.push(pattern.substring(start, i));
        start = i + 1;
      }
    }
    parts.push(pattern.substring(start));
    return parts;
  }

  private static extractSimplePrefix(alt: string): string {
    let sb = '';
    for (let i = 0; i < alt.length; i++) {
      const c = alt.charAt(i);
      if (c === '\\' && i + 1 < alt.length) {
        i++;
        const escaped = alt.charAt(i);
        if (i + 1 < alt.length && (alt.charAt(i + 1) === '?' || alt.charAt(i + 1) === '*')) {
          break; // escaped char is optional
        }
        sb += escaped;
        if (i + 1 < alt.length && alt.charAt(i + 1) === '+') {
          i++; // skip quantifier
        }
      } else if ('[(|.^$\\{'.indexOf(c) >= 0) {
        break;
      } else if (c === '?' || c === '*') {
        if (sb.length > 0) sb = sb.substring(0, sb.length - 1); // preceding char was optional
        break;
      } else if (c === '+') {
        break;
      } else {
        if (i + 1 < alt.length && (alt.charAt(i + 1) === '?' || alt.charAt(i + 1) === '*')) {
          break; // this char is optional
        }
        sb += c;
      }
    }
    return sb;
  }

  private static commonPrefix(a: string, b: string): string {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a.charAt(i) !== b.charAt(i)) return a.substring(0, i);
    }
    return a.substring(0, len);
  }

}
