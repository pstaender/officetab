// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/PatternRuleId.java faithful
// The two constructors are one with an optional subId.

/**
 * A {@link PatternRule}'s id with an optional sub-id.
 */
export class PatternRuleId {

  private readonly id: string;
  private readonly subId: string | null;

  /**
   * @param id the rule id
   * @param subId the sub id of a rulegroup, starting at {@code 1}
   */
  constructor(id: string, subId?: string | null) {
    if (id == null || id.length === 0) throw new Error('IllegalArgumentException: id must be set');
    if (subId === undefined) {
      this.id = id;
      this.subId = null;
    } else {
      if (subId == null || subId.length === 0) throw new Error('IllegalArgumentException: subId must be set, if specified');
      this.id = id;
      this.subId = subId;
    }
  }

  getId(): string {
    return this.id;
  }

  /**
   * @return a sub id or {@code null} if no sub id has been set
   */
  getSubId(): string | null {
    return this.subId;
  }

  toString(): string {
    if (this.subId != null) {
      return this.id + '[' + this.subId + ']';
    } else {
      return this.id;
    }
  }

}
