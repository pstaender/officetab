// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRuleReplacer.java faithful
import { AnalyzedSentence } from '../../../AnalyzedSentence.ts';
import { AnalyzedToken } from '../../../AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../../AnalyzedTokenReadings.ts';
import { ChunkTag } from '../../../chunking/ChunkTag.ts';
import { AbstractPatternRulePerformer } from '../../../rules/patterns/AbstractPatternRulePerformer.ts';
import { CaseConversion, IncludeRange, Match } from '../../../rules/patterns/Match.ts';
import { PatternRuleMatcher } from '../../../rules/patterns/PatternRuleMatcher.ts';
import type { PatternToken } from '../../../rules/patterns/PatternToken.ts';
import { RuleFilterEvaluator } from '../../../rules/patterns/RuleFilterEvaluator.ts';
import { StringTools } from '../../../tools/StringTools.ts';
import { List_contains } from '../../../../../../../jdk/java/util/Objects.ts';
import { Pattern, StringMatches } from '../../../../../../../jdk/java/util/regex/Pattern.ts';
import type { DisambiguationPatternRule } from './DisambiguationPatternRule.ts';
import { DisambiguatorAction } from './DisambiguationPatternRule.ts';

/**
 * @since 2.3
 */
export class DisambiguationPatternRuleReplacer extends AbstractPatternRulePerformer {

  constructor(rule: DisambiguationPatternRule) {
    // The disambiguation Unifier is always in the default language variant
    super(rule, rule.getLanguage().getDefaultLanguageVariant().getDisambiguationUnifier());
  }

  replace(sentence: AnalyzedSentence): AnalyzedSentence {
    const tokens = sentence.getTokensWithoutWhitespace();
    const preDisambigTokens = sentence.getTokens();
    const whTokens: AnalyzedTokenReadings[][] = [sentence.getTokens()];
    const changed: boolean[] = [false];

    this.doMatch(sentence, tokens, (tokenPositions, firstMatchToken, lastMatchToken, _firstMarkerMatchToken, lastMarkerMatchToken) => {
      let ruleMatchFromPos = -1;
      let ruleMatchToPos = -1;
      let tokenCount = 0;
      for (const token of tokens) {
        if (ruleMatchFromPos === -1 && tokenCount === firstMatchToken) {
          ruleMatchFromPos = token.getStartPos();
        }
        if (ruleMatchToPos === -1 && tokenCount === lastMatchToken) {
          ruleMatchToPos = token.getEndPos();
        }
        tokenCount++;
      }
      const matchingTokens = tokenPositions.filter((i) => i !== 0).length;
      if (this.keepDespiteFilter(tokens, tokenPositions, firstMatchToken, lastMatchToken) && this.keepByDisambig(sentence, ruleMatchFromPos, ruleMatchToPos)) {
        whTokens[0] = this.executeAction(sentence, whTokens[0]!, this.unifiedTokens, firstMatchToken, lastMarkerMatchToken, matchingTokens, tokenPositions);
        changed[0] = true;
      }
    });
    if (changed[0]) {
      return new AnalyzedSentence(whTokens[0]!, preDisambigTokens);
    }
    return sentence;
  }

  private keepByDisambig(sentence: AnalyzedSentence, ruleMatchFromPos: number, ruleMatchToPos: number): boolean {
    const antiPatterns = this.rule.getAntiPatterns();
    for (const antiPattern of antiPatterns) {
      if (!antiPattern.canBeIgnoredFor(sentence)) {
        const matches = new PatternRuleMatcher(antiPattern, false).match(sentence);
        for (const disMatch of matches) {
          if ((disMatch.getFromPos() <= ruleMatchFromPos && disMatch.getToPos() >= ruleMatchFromPos) ||  // left overlap of rule match start
              (disMatch.getFromPos() <= ruleMatchToPos && disMatch.getToPos() >= ruleMatchToPos) ||  // right overlap of rule match end
              (disMatch.getFromPos() >= ruleMatchFromPos && disMatch.getToPos() <= ruleMatchToPos)  // inside longer rule match
          ) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private keepDespiteFilter(tokens: AnalyzedTokenReadings[], tokenPositions: number[], firstMatchToken: number, lastMatchToken: number): boolean {
    const filter = this.rule.getFilter();
    if (filter != null) {
      const ruleFilterEval = new RuleFilterEvaluator(filter);
      const tokensPos = [...tokenPositions];
      const resolvedArguments = ruleFilterEval.getResolvedArguments(this.rule.getFilterArguments()!, tokens, firstMatchToken, tokensPos);
      const relevantTokens = tokens.slice(firstMatchToken, lastMatchToken + 1);
      return filter.matches(resolvedArguments, relevantTokens, firstMatchToken, tokensPos);
    }
    return true;
  }

  private executeAction(sentence: AnalyzedSentence,
                        whiteTokens: AnalyzedTokenReadings[],
                        unifiedTokens: AnalyzedTokenReadings[] | null,
                        firstMatchToken: number, lastMatchToken: number,
                        matchingTokens: number, tokenPositions: number[]): AnalyzedTokenReadings[] {
    const whTokens = [...whiteTokens];
    const rule = this.rule as DisambiguationPatternRule;

    let correctedStPos = 0;
    let startPositionCorrection = rule.getStartPositionCorrection();
    let endPositionCorrection = rule.getEndPositionCorrection();

    let matchingTokensWithCorrection = matchingTokens;

    if (startPositionCorrection > 0) {
      correctedStPos--; //token positions are shifted by 1

      for (let l = 0; l <= startPositionCorrection && l < tokenPositions.length; l++) {
        correctedStPos += tokenPositions[l]!;
      }

      const w = startPositionCorrection; // adjust to make sure the token count is fine as it's checked later
      for (let j = 0; j <= w; j++) {
        if (j < tokenPositions.length && tokenPositions[j] === 0) {
          startPositionCorrection--;
        }
      }
    }

    if (endPositionCorrection < 0) { // adjust the end position correction if one of the elements has not been matched
      for (let d = startPositionCorrection; d < tokenPositions.length; d++) {
        if (tokenPositions[d] === 0) {
          endPositionCorrection++;
        }
      }
    }

    if (lastMatchToken !== -1) {
      const maxPosCorrection = Math.max((lastMatchToken + 1 - (firstMatchToken + correctedStPos)) - matchingTokens, 0);
      matchingTokensWithCorrection += maxPosCorrection;
    }

    const fromPos = sentence.getOriginalPosition(firstMatchToken + correctedStPos);

    const disAction = rule.getAction();

    const newTokenReadings = rule.getNewTokenReadings();
    const matchElement = rule.getMatchElement();
    const disambiguatedPOS = rule.getDisambiguatedPOS();

    switch (disAction) {
    case DisambiguatorAction.UNIFY:
      if (unifiedTokens != null &&
          unifiedTokens.length === matchingTokensWithCorrection - startPositionCorrection + endPositionCorrection) {
        //TODO: unifiedTokens.length is larger > matchingTokensWithCorrection in cases where there are no markers...
        if (whTokens[sentence.getOriginalPosition(firstMatchToken
            + correctedStPos + unifiedTokens.length - 1)]!.isSentenceEnd()) {
          unifiedTokens[unifiedTokens.length - 1]!.setSentEnd();
        }
        for (let i = 0; i < unifiedTokens.length; i++) {
          const position = sentence.getOriginalPosition(firstMatchToken + correctedStPos + i);
          whTokens[position] = new AnalyzedTokenReadings(whTokens[position]!, unifiedTokens[i]!.getReadings(), rule.getFullId());
        }
      }
      break;
    case DisambiguatorAction.REMOVE:
      if (newTokenReadings != null && newTokenReadings.length > 0) {
        if (newTokenReadings.length === matchingTokensWithCorrection
            - startPositionCorrection + endPositionCorrection) {
          for (let i = 0; i < newTokenReadings.length; i++) {
            const position = sentence.getOriginalPosition(firstMatchToken + correctedStPos + i);
            whTokens[position]!.removeReading(newTokenReadings[i]!, rule.getFullId());
          }
        }
      } else if (!StringTools.isEmpty(disambiguatedPOS)) { // negative filtering
        const p = Pattern.compile(disambiguatedPOS!);
        const tmp = new AnalyzedTokenReadings(whTokens[fromPos]!.getReadings(),
            whTokens[fromPos]!.getStartPos());
        for (const analyzedToken of tmp) {
          if (analyzedToken.getPOSTag() != null && p.matcher(analyzedToken.getPOSTag()!).matches()) {
            const position = sentence.getOriginalPosition(firstMatchToken + correctedStPos);
            whTokens[position]!.removeReading(analyzedToken, rule.getFullId());
          }
        }
      }
      break;
    case DisambiguatorAction.ADD:
      if (newTokenReadings != null && newTokenReadings.length === matchingTokensWithCorrection
            - startPositionCorrection + endPositionCorrection) {
        for (let i = 0; i < newTokenReadings.length; i++) {
          let token: string;
          const position = sentence.getOriginalPosition(firstMatchToken + correctedStPos + i);
          if (newTokenReadings[i]!.getToken() === '') {
            token = whTokens[position]!.getToken();
          } else {
            token = newTokenReadings[i]!.getToken();
          }
          let lemma: string;
          if (newTokenReadings[i]!.getLemma() == null) {
            lemma = token;
          } else {
            lemma = newTokenReadings[i]!.getLemma()!;
          }
          const newTok = new AnalyzedToken(token,
              newTokenReadings[i]!.getPOSTag(), lemma);
          whTokens[position]!.addReading(newTok, rule.getFullId());
        }
      }
      break;
    case DisambiguatorAction.ADDCHUNK:
      if (newTokenReadings != null && newTokenReadings.length === matchingTokensWithCorrection
            - startPositionCorrection + endPositionCorrection) {
        for (let i = 0; i < newTokenReadings.length; i++) {
          const position = sentence.getOriginalPosition(firstMatchToken + correctedStPos + i);
          const listChunkTag: ChunkTag[] = [];
          listChunkTag.push(...whTokens[position]!.getChunkTags());
          // the POStag is added to the ChunkTag
          const newChunkTag = new ChunkTag(newTokenReadings[i]!.getPOSTag()!);
          if (!List_contains(listChunkTag, newChunkTag)) {
            listChunkTag.push(newChunkTag);
          }
          whTokens[position]!.setChunkTags(listChunkTag);
        }
      }
      break;
    case DisambiguatorAction.FILTERALL:
      for (let i = 0; i < matchingTokensWithCorrection - startPositionCorrection + endPositionCorrection; i++) {
        const position = sentence.getOriginalPosition(firstMatchToken + correctedStPos + i);
        let pToken: PatternToken;
        if (tokenPositions[i + startPositionCorrection]! > 0) {
          pToken = rule.getPatternTokens()![i + startPositionCorrection]!;
        } else {
          let k = 1;
          while (i + startPositionCorrection + k < rule.getPatternTokens()!.length + endPositionCorrection &&
              tokenPositions[i + startPositionCorrection + k] === 0) {
            k++;
          }
         pToken = rule.getPatternTokens()![i + k + startPositionCorrection]!;
        }
        const tmpMatchToken = new Match(pToken.getPOStag(), null,
            true,
            pToken.getPOStag(),
            null, CaseConversion.NONE, false, false,
            IncludeRange.NONE);

        const matchState = tmpMatchToken.createState(rule.getLanguage().getSynthesizer(), whTokens[position]!);
        whTokens[position] = new AnalyzedTokenReadings(whTokens[position]!, matchState.filterReadings()!.getReadings(), rule.getFullId());
      }
      break;
    case DisambiguatorAction.IMMUNIZE:
      for (let i = 0; i < matchingTokensWithCorrection - startPositionCorrection + endPositionCorrection; i++) {
        whTokens[sentence.getOriginalPosition(firstMatchToken + correctedStPos + i)]!.immunize(rule.getXmlLineNumber());
      }
      break;
    case DisambiguatorAction.IGNORE_SPELLING:
      for (let i = 0; i < matchingTokensWithCorrection - startPositionCorrection + endPositionCorrection; i++) {
        whTokens[sentence.getOriginalPosition(firstMatchToken + correctedStPos + i)]!.ignoreSpelling();
      }
      break;
    case DisambiguatorAction.FILTER:
    case DisambiguatorAction.REPLACE:
    default:
      if (disAction === DisambiguatorAction.FILTER && matchElement == null) { // same as REPLACE if using <match>
        const tmpMatchToken = new Match(disambiguatedPOS, null,
            true, disambiguatedPOS, null,
            CaseConversion.NONE, false, false,
            IncludeRange.NONE);
        let newPOSmatches = false;

        // only apply filter rule when it matches previous tags:
        for (let i = 0; i < whTokens[fromPos]!.getReadingsLength(); i++) {
          if (!whTokens[fromPos]!.getAnalyzedToken(i).hasNoTag() &&
              whTokens[fromPos]!.getAnalyzedToken(i).getPOSTag() != null &&
              StringMatches(whTokens[fromPos]!.getAnalyzedToken(i).getPOSTag()!, disambiguatedPOS!)) {
            newPOSmatches = true;
            break;
          }
        }
        if (newPOSmatches) {
          const matchState = tmpMatchToken.createState(rule.getLanguage().getSynthesizer(), whTokens[fromPos]!);
          whTokens[fromPos] = new AnalyzedTokenReadings(whTokens[fromPos]!, matchState.filterReadings()!.getReadings(), rule.getFullId());

        }
        break;
      }
      //fallthrough (FILTER with <match> is REPLACE)
        if (newTokenReadings != null && newTokenReadings.length > 0) {
          if (newTokenReadings.length === matchingTokensWithCorrection - startPositionCorrection + endPositionCorrection) {
            for (let i = 0; i < newTokenReadings.length; i++) {
              let token: string;
              const position = sentence.getOriginalPosition(firstMatchToken + correctedStPos + i);
              if ('' === newTokenReadings[i]!.getToken()) { // empty token
                token = whTokens[position]!.getToken();
              } else {
                token = newTokenReadings[i]!.getToken();
              }
              let lemma: string;
              if (newTokenReadings[i]!.getLemma() == null) { // empty lemma
                lemma = token;
              } else {
                lemma = newTokenReadings[i]!.getLemma()!;
              }
              const analyzedToken = new AnalyzedToken(token, newTokenReadings[i]!.getPOSTag(), lemma);
              const toReplace = new AnalyzedTokenReadings(
                  analyzedToken,
                  whTokens[fromPos]!.getStartPos());
              whTokens[position] = new AnalyzedTokenReadings(whTokens[position]!, toReplace.getReadings(), rule.getFullId());
            }
          }
        } else if (matchElement == null) {
          let lemma: string | null = '';
          for (const analyzedToken of whTokens[fromPos]!) {
            if (analyzedToken.getPOSTag() != null
                && analyzedToken.getPOSTag() === disambiguatedPOS && analyzedToken.getLemma() != null) {
              lemma = analyzedToken.getLemma();
            }
          }
          if (StringTools.isEmpty(lemma)) {
            lemma = whTokens[fromPos]!.getAnalyzedToken(0).getLemma();
          }

          const analyzedToken = new AnalyzedToken(whTokens[fromPos]!.getToken(), disambiguatedPOS, lemma);
          const toReplace = new AnalyzedTokenReadings(
              analyzedToken, whTokens[fromPos]!.getStartPos());
          whTokens[fromPos] = new AnalyzedTokenReadings(whTokens[fromPos]!, toReplace.getReadings(), rule.getFullId());
        } else {
          // using the match element
          const matchElementState = matchElement.createState(rule.getLanguage().getSynthesizer(), whTokens[fromPos]!);
          whTokens[fromPos] = new AnalyzedTokenReadings(whTokens[fromPos]!, matchElementState.filterReadings()!.getReadings(), rule.getFullId());
          matchElementState.filterReadings();
        }
      }

    return whTokens;
  }

}
