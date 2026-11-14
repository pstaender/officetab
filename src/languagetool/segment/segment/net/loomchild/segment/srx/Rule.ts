// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/srx/Rule.java faithful

/**
 * Represents break or exception rule. Contains after break and before
 * break patterns,
 * 
 * @author loomchild
 */
export class Rule {

	private breaking: boolean;

	private beforePattern: string;

	private afterPattern: string;

	/**
	 * Creates rule.
	 * 
	 * @param breaking type of rule; true - break rule, false - exception rule
	 * @param beforePattern pattern matching text before break
	 * @param afterPattern pattern matching text after break
	 */
	constructor(breaking: boolean, beforePattern: string, afterPattern: string) {
		this.breaking = breaking;
		this.beforePattern = beforePattern;
		this.afterPattern = afterPattern;
	}

	/**
	 * @return type of rule; true - break rule, false - exception rule
	 */
	isBreak(): boolean {
		return this.breaking;
	}

	/**
	 * @return pattern matching text before break
	 */
	getBeforePattern(): string {
		return this.beforePattern;
	}

	/**
	 * @return pattern matching text after break
	 */
	getAfterPattern(): string {
		return this.afterPattern;
	}

}
