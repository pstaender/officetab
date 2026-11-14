// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/AbstractTextIterator.java faithful
import type { TextIterator } from './TextIterator.ts';
import type { LanguageRule } from './srx/LanguageRule.ts';


/**
 * Represents abstract text iterator. Responsible for implementing remove
 * operation.
 * 
 * @author loomchild
 * 
 */
export abstract class AbstractTextIterator implements TextIterator {

	abstract next(): string | null;

	abstract hasNext(): boolean;

	/**
	 * {@inheritDoc}
	 */
	remove(): void {
		throw new Error(
				"UnsupportedOperationException: Remove is not supported by TextIterator.");
	}

	toString(languageRuleList?: LanguageRule[]): string {
		if (languageRuleList === undefined) {
			return Object.prototype.toString.call(this);
		}
		let builder = "";
		if (languageRuleList.length > 0) {
			const iterator = languageRuleList[Symbol.iterator]();
			builder += iterator.next().value!.getName();
			for (let r = iterator.next(); !r.done; r = iterator.next()) {
				builder += r.value.getName();
			}
		}
		return builder;
	}
	

	
}
