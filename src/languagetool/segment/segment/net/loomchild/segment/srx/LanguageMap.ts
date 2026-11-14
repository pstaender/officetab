// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/srx/LanguageMap.java faithful
import { Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import type { LanguageRule } from './LanguageRule.ts';

/**
 * Represents mapping between language code pattern and language rule.
 * 
 * @author loomchild
 */
export class LanguageMap {

	private languagePattern: Pattern;

	private languageRule: LanguageRule;

	/**
	 * Creates mapping.
	 * 
	 * @param pattern language code pattern
	 * @param languageRule language rule
	 */
	constructor(pattern: string, languageRule: LanguageRule) {
		this.languagePattern = Pattern.compile(pattern);
		this.languageRule = languageRule;
	}

	/**
	 * @param languageCode language code
	 * @return true if given language code matches language pattern
	 */
	matches(languageCode: string): boolean {
		return this.languagePattern.matcher(languageCode).matches();
	}
	
	getLanguagePattern(): Pattern {
		return this.languagePattern;
	}

	/**
	 * @return language rule
	 */
	getLanguageRule(): LanguageRule {
		return this.languageRule;
	}

}
