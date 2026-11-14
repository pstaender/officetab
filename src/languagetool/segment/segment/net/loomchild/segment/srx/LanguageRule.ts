// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/srx/LanguageRule.java faithful
import type { Rule } from './Rule.ts';

/**
 * Represents rule for segmenting text in some language. Contains {@link Rule}
 * list.
 * 
 * @author loomchild
 */
export class LanguageRule {

	private ruleList: Rule[];

	private name: string;

	/**
	 * Creates language rule (or an empty one without a rule list).
	 * 
	 * @param name language rule name
	 * @param ruleList rule list (it will be shallow copied)
	 */
	constructor(name: string, ruleList: Rule[] = []) {
		this.ruleList = [...ruleList];
		this.name = name;
	}

	/**
	 * @return unmodifiable rules list
	 */
	getRuleList(): readonly Rule[] {
		return this.ruleList;
	}

	/**
	 * Adds rule to the end of rule list.
	 * @param rule
	 */
	addRule(rule: Rule): void {
		this.ruleList.push(rule);
	}

	/**
	 * @return language rule name
	 */
	getName(): string {
		return this.name;
	}

}
