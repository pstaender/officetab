// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/SpecificIdRule.java faithful
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { Tag } from '../Tag.ts';
import type { Category } from './Category.ts';
import type { ITSIssueType } from './ITSIssueType.ts';
import { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

export class SpecificIdRule extends Rule {

  private readonly id: string;
  private readonly desc: string;

  constructor(id: string, desc: string, isPremium: boolean, category: Category, issueType: ITSIssueType | null, tags: readonly Tag[]) {
    super();
    this.id = Objects_requireNonNull(id);
    this.desc = Objects_requireNonNull(desc);
    this.setPremium(isPremium);
    this.setCategory(category);
    if (issueType != null) {
      this.setLocQualityIssueType(issueType);
    }
    this.setTags([...tags]);
  }

  override getId(): string {
    return this.id;
  }

  override getDescription(): string {
    return this.desc;
  }

  override match(_sentence: AnalyzedSentence): RuleMatch[] {
    return RuleMatch.EMPTY_ARRAY as RuleMatch[];
  }

}
