// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/srx/SrxDocument.java faithful
import { LanguageMap } from './LanguageMap.ts';
import type { LanguageRule } from './LanguageRule.ts';
import { SrxDocumentCache } from './SrxDocumentCache.ts';

/**
 * Represents SRX document. Responsible for storing and searching matching
 * language rules for given language code.
 * 
 * @author loomchild
 */
export class SrxDocument {

	/**
	 * Default cascade value.
	 */
	static readonly DEFAULT_CASCADE = true;

	private cascade: boolean;

	private languageMapList: LanguageMap[];
	
	private cache: SrxDocumentCache;

	/**
	 * Creates empty document.
	 * 
	 * @param cascade true if document is cascading; default cascade if omitted. See {@link #DEFAULT_CASCADE}.
	 */
	constructor(cascade: boolean = SrxDocument.DEFAULT_CASCADE) {
		this.cascade = cascade;
		this.languageMapList = [];
		this.cache = new SrxDocumentCache();
	}

	/**
	 * Sets if document is cascading or not.
	 * 
	 * @param cascade true f document is cascading
	 */
	setCascade(cascade: boolean): void {
		this.cascade = cascade;
	}

	/**
	 * @return true if document is cascading
	 */
	getCascade(): boolean {
		return this.cascade;
	}

	/**
	 * Add language map to this document.
	 * 
	 * @param pattern language code pattern
	 * @param languageRule
	 */
	addLanguageMap(pattern: string, languageRule: LanguageRule): void {
		const languageMap = new LanguageMap(pattern, languageRule);
		this.languageMapList.push(languageMap);
	}

	getLanguageMapList(): LanguageMap[] {
		return this.languageMapList;
	}	

	/**
	 * If cascade is true then returns all language rules matching given
	 * language code. If cascade is false returns first language rule matching
	 * given language code. If no matching language rules are found returns
	 * empty list.
	 * 
	 * @param languageCode language code, for example en_US
	 * @return matching language rules
	 */
	getLanguageRuleList(languageCode: string): LanguageRule[] {
		const matchingLanguageRuleList: LanguageRule[] = [];
		for (const languageMap of this.languageMapList) {
			if (languageMap.matches(languageCode)) {
				matchingLanguageRuleList.push(languageMap.getLanguageRule());
				if (!this.cascade) {
					break;
				}
			}
		}
		return matchingLanguageRuleList;
	}

	getCache(): SrxDocumentCache {
		return this.cache;
	}
	
}
