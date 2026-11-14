// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/srx/RuleMatcher.java faithful
import type { Matcher } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { Util } from '../util/Util.ts';
import type { Rule } from './Rule.ts';
import type { SrxDocument } from './SrxDocument.ts';


/**
 * Represents matcher finding subsequent occurrences of one rule.
 *
 * @author loomchild
 */
export class RuleMatcher {
	
	private document: SrxDocument;

	private rule: Rule;
	
	private text: string;
	
	private beforeMatcher: Matcher;
	
	private afterMatcher: Matcher;
	
	found: boolean;

	
	/**
	 * Creates matcher.
	 * @param rule rule which will be searched in the text
	 * @param text
	 */
	constructor(document: SrxDocument, rule: Rule, text: string) {
		this.document = document;
		this.rule = rule;
		this.text = text;
		const beforePattern = Util.compile(document, rule.getBeforePattern());
		const afterPattern = Util.compile(document, rule.getAfterPattern());
		this.beforeMatcher = beforePattern.matcher(text);
		this.afterMatcher = afterPattern.matcher(text);	
		this.found = true;
	}
	
	/**
	 * Finds next rule match after previously found, or (with start) after given
	 * start position.
	 * @param start start position
	 * @return true if rule has been matched
	 */
	find(start?: number): boolean {
		if (start !== undefined) {
			this.beforeMatcher.region(start, this.text.length);
		}
		this.found = false;
		while ((!this.found) && this.beforeMatcher.find()) {
			this.afterMatcher.region(this.beforeMatcher.end(), this.text.length);
			this.found = this.afterMatcher.lookingAt();
		}
		return this.found;
	}
	
	/**
	 * @return true if end of text has been reached while searching
	 */
	hitEnd(): boolean {
		return !this.found;
	}
	
	/**
	 * @return position in text where the last matching starts
	 */
	getStartPosition(): number {
		return this.beforeMatcher.start();
	}

	/**
	 * @return position in text where text should be splitted according to last matching
	 */
	getBreakPosition(): number {
		return this.afterMatcher.start();
	}

	/**
	 * @return position in text where the last matching ends
	 */
	getEndPosition(): number {
		return this.afterMatcher.end();
	}

	/**
	 * @return matcher rule
	 */
	getRule(): Rule {
		return this.rule;
	}

}
