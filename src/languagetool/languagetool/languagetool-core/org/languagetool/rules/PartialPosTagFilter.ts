// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/PartialPosTagFilter.java faithful
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { RuleFilter } from './patterns/RuleFilter.ts';
import type { RuleMatch } from './RuleMatch.ts';
import { Integer_parseInt } from '../../../../../jdk/java/lang/Exceptions.ts';
import { Pattern, StringMatches } from '../../../../../jdk/java/util/regex/Pattern.ts';

/**
 * Filters rule matches so that only matches are kept where a <em>part of the
 * token</em> has a given POS tag. Expects these arguments:
 * <ul>
 *   <li>{@code no}: an integer of the matching 'token' position to be considered. Starts with 1.</li>
 *   <li>{@code regexp}: the regular expression to specify the part of the token to be considered.
 *       For example, <code>(?:in|un)(.*)</code> will consider the part of the token that comes after 'in' or 'un'.
 *       Note that always the first group is considered, so if you need more parenthesis you need to use
 *       non-capturing groups <code>(?:...)</code>, as in the example.</li>
 *   <li>{@code postag_regexp}: a regular expression to match the POS tag of the part of the word, e.g. <code>VB.?</code>
 *       to match any verb in English.</li>
 *   <li>{@code negate_postag}: if value is yes, then the regexp is negated (not negated if not specified).</li>
 *   <li>{@code two_groups_regexp}: if value is yes, then the regexp must contain 2 groups (if not specified - 1 groups).</li>
 *   <li>{@code prefix}: a string with prefix that is added to token (since 5.0).</li>
 *   <li>{@code suffix}: a string with suffix that is added to token (since 5.0).</li>
 * </ul>
 * @since 2.8
 */
export abstract class PartialPosTagFilter extends RuleFilter {

  protected abstract tag(token: string): AnalyzedTokenReadings[] | null;

  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, _patternTokenPos: number,
                           patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    if (!(args.has('no') && args.has('regexp') && args.has('postag_regexp'))) {
      throw new Error("RuntimeException: Set 'no', 'regexp' and 'postag_regexp' for filter " + 'PartialPosTagFilter');
    }
    const tokenPos = Integer_parseInt(args.get('no'));
    const pattern = Pattern.compile(args.get('regexp')!);
    const requiredTagRegexp = args.get('postag_regexp')!;
    const negatePos = args.has('negate_pos');
    const two_groups_regexp = args.has('two_groups_regexp');

      let prefix = '';
      let suffix = '';

      if (args.has('prefix')) {
          prefix = args.get('prefix')!;
      }

      if (args.has('suffix')) {
          suffix = args.get('suffix')!;
      }


    const token = prefix + patternTokens[tokenPos - 1]!.getToken() + suffix;

    const matcher = pattern.matcher(token);
    if ((matcher.groupCount() !== 1) && !(two_groups_regexp)) {
      throw new Error('RuntimeException: Got ' + matcher.groupCount() + " groups for regex '" + pattern.pattern() + "', expected 1");
    }
    if ((matcher.groupCount() !== 2) && (two_groups_regexp)) {
      throw new Error('RuntimeException: Got ' + matcher.groupCount() + " groups for regex '" + pattern.pattern() + "', expected 2");
    }
    if (matcher.matches()) {
      let partialToken = String(matcher.group(1));
      if (matcher.groupCount() === 2) {
        partialToken += matcher.group(2);
      }
      const tags = this.tag(partialToken);
      if (tags != null && this.partialTagHasRequiredTag(tags, requiredTagRegexp, negatePos)) {
        return match;
      }
      return null;
    }
    return null;
  }

  private partialTagHasRequiredTag(tags: AnalyzedTokenReadings[], requiredTagRegexp: string, negatePos: boolean): boolean {
    // Without negate_pos=yes: return true if any postag matches the regexp.
    // With negate_pos=yes:    return true if there are postag and none them matches the regexp.
    let postagCount = 0;
    for (const tag of tags) {
      for (const analyzedToken of tag.getReadings()) {
        if (analyzedToken.getPOSTag() != null) {
          if (negatePos) {
            postagCount++;
            if (StringMatches(analyzedToken.getPOSTag()!, requiredTagRegexp)) {
              return false;
            }
          } else {
            if (StringMatches(analyzedToken.getPOSTag()!, requiredTagRegexp)) {
              return true;
            }
          }
        }
      }
    }
    return postagCount === 0 ? false : negatePos;
  }
}
