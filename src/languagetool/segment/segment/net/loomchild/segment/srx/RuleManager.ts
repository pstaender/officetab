// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/srx/RuleManager.java faithful
import type { Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { Util } from '../util/Util.ts';
import type { LanguageRule } from './LanguageRule.ts';
import type { Rule } from './Rule.ts';
import type { SrxDocument } from './SrxDocument.ts';

/**
 * Represents segmentation rules manager.
 * Responsible for constructing and storing break and exception rules.
 * 
 * @author loomchild
 */
export class RuleManager {
	
	private document: SrxDocument;
	
	private maxLookbehindConstructLength: number;

	private breakRuleList: Rule[];
	
	private exceptionPatternMap: Map<Rule, Pattern | null>;
	
	/**
	 * Constructor. Responsible for retrieving rules from SRX document for
	 * given language code, constructing patterns and storing them in 
	 * quick accessible format.
	 * Adds break rules to {@link #breakRuleList} and constructs
	 * corresponding exception patterns in {@link #exceptionPatternMap}.  
	 * Uses document cache to store rules and patterns. 
	 * @param document SRX document
	 * @param languageRuleList list of language rules
	 * @param maxLookbehindConstructLength Maximum length of regular expression in lookbehind (see {@link Util#finitize(String, int)}).
	 */
	constructor(document: SrxDocument, languageRuleList: LanguageRule[], 
			maxLookbehindConstructLength: number) {
		
		this.document = document;
		this.maxLookbehindConstructLength = maxLookbehindConstructLength;
		
		this.breakRuleList = [];
		this.exceptionPatternMap = new Map<Rule, Pattern | null>();

		let exceptionPatternBuilder = "";
		
		for (const languageRule of languageRuleList) {
			for (const rule of languageRule.getRuleList()) {

				if (rule.isBreak()) {
				
					this.breakRuleList.push(rule);
					
					let exceptionPattern: Pattern | null;
					
					if (exceptionPatternBuilder.length > 0) {
						const exceptionPatternString = 
							exceptionPatternBuilder;
						exceptionPattern = 
							Util.compile(document, exceptionPatternString);
					} else {
						exceptionPattern = null;
					}

					this.exceptionPatternMap.set(rule, exceptionPattern);
				
				} else {
				
					if (exceptionPatternBuilder.length > 0) {
						exceptionPatternBuilder += '|';
					}

					const patternString = this.createExceptionPatternString(rule);
					
					exceptionPatternBuilder += patternString;
			
				}
			
			}
		}
		
	}
	
	/**
	 * @return break rule list
	 */
	getBreakRuleList(): Rule[] {
		return this.breakRuleList;
	}
	
	/**
	 * @param breakRule
	 * @return exception pattern corresponding to give break rule
	 */
	getExceptionPattern(breakRule: Rule): Pattern | null {
		return this.exceptionPatternMap.get(breakRule) ?? null;
	}
	
	/**
	 * Creates exception pattern string that can be matched in the place 
	 * where break rule was matched. Both parts of the rule 
	 * (beforePattern and afterPattern) are incorporated
	 * into one pattern.
	 * beforePattern is used in lookbehind, therefore it needs to be 
	 * modified so it matches finite string (contains no *, + or {n,}). 
	 * @param rule exception rule
	 * @return string containing exception pattern
	 */
	private createExceptionPatternString(rule: Rule): string {
		
		let patternBuilder = "";
		
		// As Java does not allow infinite length patterns
		// in lookbehind, before pattern need to be shortened.
		const beforePattern = 
			Util.finitize(rule.getBeforePattern(), this.maxLookbehindConstructLength);
		const afterPattern = rule.getAfterPattern();
		
		patternBuilder += "(?:";
		if (beforePattern.length > 0) {
			patternBuilder += "(?<=" + beforePattern + ")";
		}
		if (afterPattern.length > 0) {
			patternBuilder += "(?=" + afterPattern + ")";
		}
		patternBuilder += ")";
		
		return patternBuilder;
		
	}
	
}
