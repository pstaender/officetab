// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/RuleMatch.java faithful
// The constructors are one: (rule, sentence, fromPos, toPos, message[, shortMessage[, suggestions]])
// for the common forms, the long form (rule, sentence, fromPos, toPos, patternFromPos,
// patternToPos, message, shortMessage, startWithUppercase, isAllUppercase, suggestionsOutMsg,
// setOriginalErrorStr) and the copy constructors (clone[, replacements]); see the constructor.
// The deprecated constructors without a sentence are reached by passing null as the sentence.
// Import cycles (see Rule.ts): PatternRuleMatcher.MISTAKE is repeated, and toString uses
// getFullId() for every rule, which only differs from the Java (getFullId() for PatternRules,
// getId() for the others) for non-pattern rules with a sub id. Suppliers are functions; URLs
// strings; the SortedMap of features a Map; hashCode is left out.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import { StringTools } from '../tools/StringTools.ts';
import type { Rule } from './Rule.ts';
import { MatchPosition } from './MatchPosition.ts';
import { SuggestedReplacement } from './SuggestedReplacement.ts';
import { Objects_equals, Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

/** PatternRuleMatcher.MISTAKE */
const MISTAKE = '<mistake/>';

/**
 * Unlike {@link Category}, this is specific to a RuleMatch, not to a rule.
 * It is mainly used for selecting the underline color in clients.
 * Note: this is experimental and might change soon (types might be added, deleted or renamed
 * without deprecating them first)
 *
 * @since 4.3
 */
export const Type = {
  /**
   * Spelling errors, typically red.
   */
  UnknownWord: 'UnknownWord',
  /**
   * Style errors, typically light blue.
   */
  Hint: 'Hint',
  /**
   * Other errors (including grammar), typically yellow/orange.
   */
  Other: 'Other',
} as const;
export type Type = typeof Type[keyof typeof Type];

class PatternPosition extends MatchPosition {}
class OffsetPosition extends MatchPosition {}
class SentencePosition extends MatchPosition {}
class LinePosition extends MatchPosition {}
class ColumnPosition extends MatchPosition {}

/** Suppliers.memoize */
function memoize<T>(supplier: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = supplier();
      done = true;
    }
    return value;
  };
}

/** Suppliers.ofInstance */
const ofInstance = <T>(value: T): (() => T) => () => value;

/**
 * Information about an error rule that matches text and the position of the match.
 * See {@link org.languagetool.tools.ContextTools} for displaying errors in their original text context.
 *
 * @author Daniel Naber
 */
export class RuleMatch {
  static readonly EMPTY_ARRAY: readonly RuleMatch[] = [];
  static readonly SUGGESTION_START_TAG = '<suggestion>';
  static readonly SUGGESTION_END_TAG = '</suggestion>';
  static readonly Type = Type;

  //private static final Pattern SUGGESTION_PATTERN = Pattern.compile("<suggestion>(.*?)</suggestion>");
  private readonly rule: Rule;
  private message: string;
  private shortMessage: string | null;   // used e.g. for OOo/LO context menu
  private readonly sentence: AnalyzedSentence | null;

  private patternPosition!: PatternPosition;
  private offsetPosition!: OffsetPosition;
  // Position from the sentence start, to keep this value
  // when the offsetPosition is adjusted with JLanguageTool.adjustRuleMatchPos()
  private sentencePosition: SentencePosition = new SentencePosition(-1, -1);
  private linePosition: LinePosition = new LinePosition(-1, -1);
  private columnPosition: ColumnPosition = new ColumnPosition(-1, -1);
  private suggestedReplacements!: () => SuggestedReplacement[];
  // track if more work needs to be done to compute suggestions;
  // allows enforcement of timeouts to return partial results without spending more time
  private suggestionsComputed = true;
  private url: string | null = null;
  private type: Type = Type.Other;
  private features: ReadonlyMap<string, number> = new Map();
  private autoCorrect = false;
  private newLanguageMatches: Map<string, number> = new Map();

  private specificRuleId = '';

  // the underlined error in the original sentence
  private originalErrorStr = '';

  /**
   * Creates a RuleMatch object, taking the rule that triggered
   * this match, position of the match and an explanation message.
   * This message is scanned for &lt;suggestion&gt;...&lt;/suggestion&gt;
   * to get suggested fixes for the problem detected by this rule.
   *
   * Forms (Java overloads):
   * - (clone: RuleMatch[, replacements: SuggestedReplacement[][, ignored]]): copy, optionally with new replacements
   * - (rule, sentence, fromPos, toPos, message[, shortMessage[, suggestions: string[]]])
   * - (rule, sentence, fromPos, toPos, patternFromPos, patternToPos, message, shortMessage
   *    [, startWithUppercase, isAllUppercase, suggestionsOutMsg, setOriginalErrorStr])
   *
   * @param fromPos            error start position in original text
   * @param toPos              error end position in original text
   * @param shortMessage       used for example in OpenOffice/LibreOffice's context menu (may be null)
   * @param startWithUppercase whether the original text at the position
   *                           of the match starts with an uppercase character
   */
  constructor(clone: RuleMatch, replacements?: SuggestedReplacement[], ignored?: boolean);
  constructor(rule: Rule, sentence: AnalyzedSentence | null, fromPos: number, toPos: number, message: string, shortMessage?: string | null, suggestions?: string[]);
  constructor(rule: Rule, sentence: AnalyzedSentence | null, fromPos: number, toPos: number, patternFromPos: number, patternToPos: number,
              message: string, shortMessage: string | null, startWithUppercase?: boolean, isAllUppercase?: boolean, suggestionsOutMsg?: string | null,
              setOriginalErrorStr?: boolean);
  constructor(...args: unknown[]) {
    if (args[0] instanceof RuleMatch) {
      const clone = args[0];
      this.rule = clone.getRule();
      this.sentence = clone.getSentence();
      this.setOffsetPosition(clone.getFromPos(), clone.getToPos());
      this.message = clone.getMessage();
      this.shortMessage = clone.getShortMessage();
      this.setPatternPosition(clone.getPatternFromPos(), clone.getPatternToPos());
      this.suggestedReplacements = clone.suggestedReplacements;
      this.setAutoCorrect(clone.isAutoCorrect());
      this.setFeatures(clone.getFeatures());
      this.setUrl(clone.getUrl());
      this.setType(clone.getType());
      this.setLine(clone.getLine());
      this.setEndLine(clone.getEndLine());
      this.setColumn(clone.getColumn());
      this.setEndColumn(clone.getEndColumn());
      this.setSpecificRuleId(clone.getSpecificRuleId());
      this.setOriginalErrorStr(clone.getOriginalErrorStr());
      this.setSentencePosition(clone.getFromPosSentence(), clone.getToPosSentence());
      if (args[1] !== undefined) {
        //clone with new replacements
        this.setSuggestedReplacementObjects(args[1] as SuggestedReplacement[]);
        // "ignored" is unused?
      }
      return;
    }
    const rule = args[0] as Rule;
    const sentence = (args[1] ?? null) as AnalyzedSentence | null;
    const fromPos = args[2] as number;
    const toPos = args[3] as number;
    let patternFromPos: number, patternToPos: number, message: string, shortMessage: string | null;
    let startWithUppercase = false, isAllUppercase = false, suggestionsOutMsg: string | null = null, setOriginalErrorStr = false;
    let suggestions: string[] | undefined;
    if (typeof args[4] === 'number') {
      patternFromPos = args[4];
      patternToPos = args[5] as number;
      message = args[6] as string;
      shortMessage = (args[7] ?? null) as string | null;
      startWithUppercase = (args[8] ?? false) as boolean;
      isAllUppercase = (args[9] ?? false) as boolean;
      suggestionsOutMsg = (args[10] ?? null) as string | null;
      setOriginalErrorStr = (args[11] ?? false) as boolean;
    } else {
      patternFromPos = fromPos;
      patternToPos = toPos;
      message = args[4] as string;
      shortMessage = (args[5] ?? null) as string | null;
      suggestions = args[6] as string[] | undefined;
    }
    this.rule = Objects_requireNonNull(rule);
    if (toPos <= fromPos) {
      throw new Error('IllegalArgumentException: fromPos (' + fromPos + ') must be less than toPos (' + toPos + ')');
    }
    this.patternPosition = new PatternPosition(patternFromPos, patternToPos);
    this.offsetPosition = new OffsetPosition(fromPos, toPos);
    this.message = Objects_requireNonNull(message);
    this.shortMessage = shortMessage;
    this.sentence = sentence;
    if (setOriginalErrorStr) {
      this.setOriginalErrorStr();
    }
    // extract suggestion from <suggestion>...</suggestion> in message:
    const replacements: SuggestedReplacement[] = [];  // LinkedHashSet
    const suggestion = message + (suggestionsOutMsg != null ? suggestionsOutMsg : '');
    let pos = suggestion.indexOf(RuleMatch.SUGGESTION_START_TAG);
    while (pos !== -1) {
      const end = suggestion.indexOf(RuleMatch.SUGGESTION_END_TAG, pos);
      if (end === -1) {
        break;
      }
      let replacement = suggestion.substring(pos + RuleMatch.SUGGESTION_START_TAG.length, end);
      pos = end + RuleMatch.SUGGESTION_END_TAG.length;
      if (replacement.includes(MISTAKE)) {
        continue;
      }
      // ignore single words in mixed case
      if (isAllUppercase && !(StringTools.isMixedCase(replacement) && !replacement.includes(' '))) {
        // do not create a suggestion equal to the input string
        if (!(this.getOriginalErrorStr() === replacement.toUpperCase())) {
          replacement = replacement.toUpperCase();
        }
      } else if (startWithUppercase) {
        replacement = StringTools.uppercaseFirstChar(replacement)!;
      }
      const repl = new SuggestedReplacement(replacement);
      if (!replacements.some((r) => r.equals(repl))) {
        replacements.push(repl);
      }
      pos = suggestion.indexOf(RuleMatch.SUGGESTION_START_TAG, pos);
    }

    this.suggestedReplacements = ofInstance([...replacements]);
    if (suggestions !== undefined) {
      // Create a rule match with any suggestions in the message overridden by the given suggestions (since 4.7)
      this.setSuggestedReplacements(suggestions);
    }
  }

  getFeatures(): ReadonlyMap<string, number> {
    return this.features;
  }

  setFeatures(features: ReadonlyMap<string, number>): void {
    this.features = features;
  }

  isAutoCorrect(): boolean {
    return this.autoCorrect;
  }

  setAutoCorrect(autoCorrect: boolean): void {
    this.autoCorrect = autoCorrect;
  }

  getRule(): Rule {
    return this.rule;
  }

  /**
   * Get the line number in which the match occurs (zero-based).
   *
   * @deprecated rely on the character-based {@link #getFromPos()} instead (deprecated since 3.4)
   */
  getLine(): number {
    return this.linePosition.getStart();
  }

  /**
   * Set the line number in which the match occurs (zero-based).
   */
  setLine(fromLine: number): void {
    this.linePosition = new LinePosition(fromLine, this.linePosition.getEnd());
  }

  /**
   * Get the line number in which the match ends (zero-based).
   *
   * @deprecated rely on {@link #getToPos()} instead (deprecated since 3.4)
   */
  getEndLine(): number {
    return this.linePosition.getEnd();
  }

  /**
   * Set the line number in which the match ends (zero-based).
   */
  setEndLine(endLine: number): void {
    this.linePosition = new LinePosition(this.linePosition.getStart(), endLine);
  }

  /**
   * Get the column number in which the match occurs (zero-based).
   *
   * @deprecated rely on the character-based {@link #getFromPos()} instead (deprecated since 3.4)
   */
  getColumn(): number {
    return this.columnPosition.getStart();
  }

  /**
   * Set the column number in which the match occurs (zero-based).
   *
   * @deprecated (deprecated since 3.5)
   */
  setColumn(column: number): void {
    this.columnPosition = new ColumnPosition(column, this.columnPosition.getEnd());
  }

  /**
   * Get the column number in which the match ends (zero-based).
   *
   * @deprecated rely on {@link #getToPos()} instead (deprecated since 3.4)
   */
  getEndColumn(): number {
    return this.columnPosition.getEnd();
  }

  /**
   * Set the column number in which the match ends (zero-based).
   *
   * @deprecated (deprecated since 3.5)
   */
  setEndColumn(endColumn: number): void {
    this.columnPosition = new ColumnPosition(this.columnPosition.getStart(), endColumn);
  }

  /**
   * Position of the start of the pattern (in characters, zero-based, relative to the original input text).
   */
  getPatternFromPos(): number {
    return this.patternPosition.getStart();
  }

  /**
   * Position of the end of the mistake pattern (in characters, zero-based, relative to the original input text).
   */
  getPatternToPos(): number {
    return this.patternPosition.getEnd();
  }

  setPatternPosition(fromPos: number, toPos: number): void {
    if (toPos <= fromPos) {
      throw new Error('RuntimeException: fromPos (' + fromPos + ') must be less than toPos (' + toPos + ')');
    }
    this.patternPosition = new PatternPosition(fromPos, toPos);
  }

  /**
   * Position of the start of the error (in characters, zero-based, relative to the original input text).
   */
  getFromPos(): number {
    return this.offsetPosition.getStart();
  }

  /**
   * Position of the end of the error (in characters, zero-based, relative to the original input text).
   */
  getToPos(): number {
    return this.offsetPosition.getEnd();
  }

  /**
   * Position of the start of the error (in characters, zero-based, relative to the original sentence).
   * This value is used to keep the position in the sentence when the offsetPosition is adjusted to the whole text
   */
  getFromPosSentence(): number {
    return this.sentencePosition.getStart();
  }

  /**
   * Position of the end of the error (in characters, zero-based, relative to the original sentence).
   * This value is used to keep the position in the sentence when the offsetPosition is adjusted to the whole text
   */
  getToPosSentence(): number {
    return this.sentencePosition.getEnd();
  }

  setOffsetPosition(fromPos: number, toPos: number): void {
    if (toPos <= fromPos) {
      throw new Error('RuntimeException: fromPos (' + fromPos + ') must be less than toPos (' + toPos + ') for match: <sentcontent>' + this + '</sentcontent>');
    }
    this.offsetPosition = new OffsetPosition(fromPos, toPos);
  }

  setSentencePosition(fromPos: number, toPos: number): void {
    if (toPos > -1 && fromPos > -1 && toPos <= fromPos) {
      throw new Error('RuntimeException: fromPos (' + fromPos + ') must be less than toPos (' + toPos + ') for match: <sentcontent>' + this + '</sentcontent>');
    }
    this.sentencePosition = new SentencePosition(fromPos, toPos);
  }

  /**
   * A human-readable explanation describing the error. This may contain
   * one or more corrections marked up with &lt;suggestion&gt;...&lt;/suggestion&gt;.
   *
   * @see #getSuggestedReplacements()
   * @see #getShortMessage()
   */
  getMessage(): string {
    return this.message;
  }

  setMessage(msg: string): void {
    this.message = msg;
  }

  /**
   * A shorter human-readable explanation describing the error or an empty string
   * if no such explanation is available.
   *
   * @see #getMessage()
   */
  getShortMessage(): string {
    if (this.shortMessage == null) {
      return '';  // just because this is what we have documented
    }
    return this.shortMessage;
  }

  setShortMessage(msg: string | null): void {
    this.shortMessage = msg;
  }

  /**
   * @see #getSuggestedReplacements()
   */
  setSuggestedReplacement(replacement: string): void {
    Objects_requireNonNull(replacement, 'replacement may be empty but not null');
    const replacements: string[] = [];
    replacements.push(replacement);
    this.setSuggestedReplacements(replacements);
  }

  addSuggestedReplacement(replacement: string): void {
    Objects_requireNonNull(replacement, 'replacement may be empty but not null');
    this.addSuggestedReplacements([replacement]);
  }

  addSuggestedReplacements(replacements: readonly string[]): void {
    Objects_requireNonNull(replacements, 'replacements may be empty but not null');
    const prev = this.suggestedReplacements;
    this.setLazySuggestedReplacements(() =>
      [...prev(), ...replacements.map((r) => new SuggestedReplacement(r))]);
  }

  /**
   * The text fragments which might be an appropriate fix for the problem. One
   * of these fragments can be used to replace the old text between {@link #getFromPos()}
   * to {@link #getToPos()}.
   *
   * @return unmodifiable list of String objects or an empty List
   */
  getSuggestedReplacements(): string[] {
    return this.suggestedReplacements().map((r) => r.getReplacement());
  }

  /**
   * @see #getSuggestedReplacements()
   */
  setSuggestedReplacements(replacements: readonly string[]): void {
    Objects_requireNonNull(replacements, 'replacements may be empty but not null');
    this.suggestionsComputed = true;
    this.suggestedReplacements = ofInstance(
      replacements.map((r) => new SuggestedReplacement(r))
    );
  }

  getSuggestedReplacementObjects(): readonly SuggestedReplacement[] {
    return this.suggestedReplacements();
  }

  /**
   * @see #getSuggestedReplacements()
   */
  setSuggestedReplacementObjects(replacements: readonly SuggestedReplacement[]): void {
    Objects_requireNonNull(replacements, 'replacements may be empty but not null');
    this.suggestedReplacements = ofInstance([...replacements]);
    this.suggestionsComputed = true;
  }

  /**
   * Set a lazy supplier that will compute suggested replacements
   * when {@link #getSuggestedReplacements()} or {@link #getSuggestedReplacementObjects()} is called.
   * This can be used to speed up sentence analysis
   * in cases when computationally expensive replacements won't necessarily be needed
   * (e.g. for an IDE in the same process).
   */
  setLazySuggestedReplacements(replacements: () => SuggestedReplacement[]): void {
    Objects_requireNonNull(replacements, 'replacements may not be null');
    this.suggestedReplacements = memoize(replacements);
    this.suggestionsComputed = false;
  }

  /**
   * Force computing replacements, e.g. for accurate metrics for computation time and to set timeouts for this process
   * Used in server use case (i.e. {@code org.languagetool.server.TextChecker})
   */
  computeLazySuggestedReplacements(): void {
    this.suggestedReplacements = ofInstance(this.suggestedReplacements());
    this.suggestionsComputed = true;
  }

  /**
   * Discard lazy suggested replacements, but keep other suggestions
   * Useful to enforce time limits on result computation
   */
  discardLazySuggestedReplacements(): void {
    if (!this.suggestionsComputed) {
      this.setSuggestedReplacementObjects([]);
    }
  }

  /**
   * A URL that points to a more detailed error description or {@code null}.
   * Note that the {@link Rule} itself might also have an URL, which is usually
   * a less specific one than this. This one will overwrite the rule's URL in
   * the JSON output.
   *
   * @since 4.0
   */
  getUrl(): string | null {
    return this.url;
  }

  /**
   * @since 4.0
   */
  setUrl(url: string | null): void {
    this.url = url;
  }

  /**
   * @since 4.0
   */
  getSentence(): AnalyzedSentence | null {
    return this.sentence;
  }

  /**
   * @since 4.3
   */
  getType(): Type {
    return this.type;
  }

  /**
   * @since 4.3
   */
  setType(type: Type): void {
    this.type = Objects_requireNonNull(type);
  }

  toString(): string {
    // Java: getFullId() for PatternRules, getId() for other rules (see the header)
    return this.rule.getFullId() + ':' + this.offsetPosition + ':' + this.message;
  }

  /**
   * Compare by start position.
   */
  compareTo(other: RuleMatch): number {
    Objects_requireNonNull(other);
    return Math.sign(this.getFromPos() - other.getFromPos());
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o == null || !(o instanceof RuleMatch) || o.constructor !== this.constructor) return false;
    const other = o;
    return this.rule.getId() === other.rule.getId()
      && Objects_equals(this.patternPosition, other.patternPosition)
      && Objects_equals(this.offsetPosition, other.offsetPosition)
      && this.message === other.message
      && Objects_equals(this.sentence, other.sentence)
      && this.type === other.type;
  }

  /**
   * The language that the text might be in if the error limit has been reached.
   *
   * @since 6.4
   */
  getNewLanguageMatches(): Map<string, number> {
    return this.newLanguageMatches;
  }

  /**
   * Call if the error limit is reached for this sentence. The caller will then get text ranges for the
   * sentence and can ignore errors there. Note: will not have an effect for text-level rules.
   *
   * @param newLanguageMatches a map of possible languages this could be instead
   * @since 6.4
   */
  setNewLanguageMatches(newLanguageMatches: Map<string, number>): void {
    this.newLanguageMatches = newLanguageMatches;
  }

  /**
   * Set a new specific rule ID in the RuleMatch to replace getRule().getId() in
   * the output. Used for statistical purposes.
   *
   * @since 5.6
   */
  setSpecificRuleId(ruleId: string): void {
    this.specificRuleId = ruleId;
  }

  /**
   * Get the specific rule ID from the RuleMatch to replace getRule().getId() in
   * the output. Used for statistical purposes.
   *
   * @since 5.6
   */
  getSpecificRuleId(): string {
    if (this.specificRuleId.length === 0) {
      return this.getRule().getId();
    } else {
      return this.specificRuleId;
    }
  }

  /**
   * Without an argument: computes the underlined string from the sentence.
   * With an argument: to store the underlined string in the original sentence.
   */
  setOriginalErrorStr(originalErrorStr?: string): void {
    if (originalErrorStr !== undefined) {
      this.originalErrorStr = originalErrorStr;
      return;
    }
    if (this.originalErrorStr.length !== 0) {
      return;
    }
    if (this.getSentence() == null) {
      return;
    }
    const sentenceStr = this.getSentence()!.getText();
    if (sentenceStr.length === 0) {
      return;
    }
    // use the positions in the sentence if available
    let fromPos = this.getFromPosSentence();
    let toPos = this.getToPosSentence();
    if (fromPos > -1 && toPos > -1 && toPos <= sentenceStr.length && fromPos < toPos) {
      this.originalErrorStr = sentenceStr.substring(fromPos, toPos);
      return;
    }
    // otherwise use the positions before the offsetPosition is adjusted to the whole text
    fromPos = this.getFromPos();
    toPos = this.getToPos();
    if (fromPos > -1 && toPos > -1 && toPos <= sentenceStr.length && fromPos < toPos) {
      this.originalErrorStr = sentenceStr.substring(fromPos, toPos);
    }
  }

  /**
   * Get the underlined string in the original sentence.
   * Only available for sentence-level pattern rules.
   * Returns an empty string if not available.
   * For other rules, use setOriginalErrorStr(String originalErrorStr)
   * @since 6.3
   */
  getOriginalErrorStr(): string {
    return this.originalErrorStr;
  }

  /**
   * Returns a new {@link RuleMatch} with the match span and suggested replacements trimmed
   * so that common tokens at the start and end of the error string are removed.
   * <p>
   * For example, if the error covers "foo bar baz" and all suggestions end with " baz",
   * the trailing " baz" is stripped from the suggestions and the end position is adjusted
   * accordingly. The same applies to common leading tokens.
   * </p>
   * <p>
   * Returns {@code this} unchanged if trimming is not possible (no replacements, no error
   * string, or no common tokens to remove).
   * </p>
   * @since 6.8
   */
  trimMatchEnds(): RuleMatch {
    let replacements: SuggestedReplacement[] = [...this.getSuggestedReplacementObjects()];
    if (replacements.length === 0) {
      return this;
    }
    let errorStr = this.getOriginalErrorStr();
    if (errorStr.length === 0) {
      this.setOriginalErrorStr();
      errorStr = this.getOriginalErrorStr();
    }
    if (errorStr.length === 0) {
      return this;
    }
    let fromPos = this.getFromPos();
    let toPos = this.getToPos();
    let fromPosSentence = this.getFromPosSentence();
    let toPosSentence = this.getToPosSentence();
    let changed = true;
    while (changed) {
      changed = false;
      // Try trimming from the end
      const lastSpaceIdx = errorStr.lastIndexOf(' ');
      if (lastSpaceIdx > 0) {
        const lastToken = errorStr.substring(lastSpaceIdx + 1);
        const endSuffix = ' ' + lastToken;
        const allEndWith = replacements.every((r) => r.getReplacement().endsWith(endSuffix));
        if (allEndWith) {
          const errorTrimLen = errorStr.length - lastSpaceIdx;
          const trimmed: SuggestedReplacement[] = [];
          for (const r of replacements) {
            const newR = new SuggestedReplacement(r);
            newR.setReplacement(r.getReplacement().substring(0, r.getReplacement().length - endSuffix.length));
            trimmed.push(newR);
          }
          replacements = trimmed;
          toPos -= errorTrimLen;
          if (toPosSentence >= 0) {
            toPosSentence -= errorTrimLen;
          }
          errorStr = errorStr.substring(0, lastSpaceIdx);
          changed = true;
        }
      }
      // Try trimming from the beginning
      const firstSpaceIdx = errorStr.indexOf(' ');
      if (firstSpaceIdx > 0) {
        const firstToken = errorStr.substring(0, firstSpaceIdx);
        const startPrefix = firstToken + ' ';
        const allStartWith = replacements.every((r) => r.getReplacement().startsWith(startPrefix));
        if (allStartWith) {
          const errorTrimLen = firstSpaceIdx + 1;
          const trimmed: SuggestedReplacement[] = [];
          for (const r of replacements) {
            const newR = new SuggestedReplacement(r);
            newR.setReplacement(r.getReplacement().substring(startPrefix.length));
            trimmed.push(newR);
          }
          replacements = trimmed;
          fromPos += errorTrimLen;
          if (fromPosSentence >= 0) {
            fromPosSentence += errorTrimLen;
          }
          errorStr = errorStr.substring(errorTrimLen);
          changed = true;
        }
      }
    }
    if (fromPos === this.getFromPos() && toPos === this.getToPos()) {
      return this;
    }
    const newMatch = new RuleMatch(this, replacements);
    newMatch.setOffsetPosition(fromPos, toPos);
    newMatch.setSentencePosition(fromPosSentence, toPosSentence);
    newMatch.setOriginalErrorStr(errorStr);
    return newMatch;
  }
}
