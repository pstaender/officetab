// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/srx/SrxTextIterator.java partial
// Only the constructors taking the whole text: the streaming ones (a Reader) are left out.
// The parameter map is a Map (or a plain object).
import type { Matcher, Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { AbstractTextIterator } from '../AbstractTextIterator.ts';
import { Util } from '../util/Util.ts';
import type { LanguageRule } from './LanguageRule.ts';
import { RuleManager } from './RuleManager.ts';
import { RuleMatcher } from './RuleMatcher.ts';
import type { SrxDocument } from './SrxDocument.ts';
import { TextManager } from './TextManager.ts';

const getParameter = Util.getParameter;

/**
 * Represents text iterator splitting text according to rules in SRX file.
 * 
 * The algorithm idea is as follows:
 *
 * <pre>
 * 1. Rule matcher list is created based on SRX file and language. Each rule 
 *    matcher is responsible for matching before break and after break regular 
 *    expressions of one break rule.
 * 2. Each rule matcher is matched to the text. If the rule was not found the 
 *    rule matcher is removed from the list. 
 * 3. First rule matcher in terms of its break position in text is selected.
 * 4. List of exception rules corresponding to break rule is retrieved. 
 * 5. If none of exception rules is matching in break position then 
 *    the text is marked as split and new segment is created. In addition 
 *    all rule matchers are moved so they start after the end of new segment 
 *    (which is the same as break position of the matched rule). 
 * 6. All the rules that have break position behind last matched rule 
 *    break position are moved until they pass it.
 * 7. If segment was not found the whole process is repeated.
 * </pre>
 *
 * In streaming version of this algorithm character buffer is searched. 
 * When the end of it is reached or break position is in the margin 
 * (break position &gt; buffer size - margin) and there is more text, 
 * the buffer is moved in the text until it starts after last found segment. 
 * If this happens rule matchers are reinitialized and the text is searched again.
 * Streaming version has a limitation that read buffer must be at least as long 
 * as any segment in the text.
 * 
 * As this algorithm uses lookbehind extensively but Java does not permit
 * infinite regular expressions in lookbehind, so some patterns are finitized. 
 * For example a* pattern will be changed to something like a{0,100}.
 *
 * @author loomchild
 */
export class SrxTextIterator extends AbstractTextIterator {
	
	/**
	 * Margin size. Used in streaming splitter.
	 * If rule is matched but its position is in the margin 
	 * (position &gt; bufferLength - margin) then the matching is ignored, 
	 * and more text is read and rule is matched again.
	 */
	static readonly MARGIN_PARAMETER = "margin";
	
	/**
	 * 	Reader buffer size. Segments cannot be longer than this value.
	 */
	static readonly BUFFER_LENGTH_PARAMETER = "bufferLength";

	/**
	 * Maximum length of a regular expression construct that occurs in lookbehind. 
	 */
	static readonly MAX_LOOKBEHIND_CONSTRUCT_LENGTH_PARAMETER = 
		"maxLookbehindConstructLength";
	
	/**
	 * Default margin size. 
	 */
	static readonly DEFAULT_MARGIN = 128;
	
	/**
	 * Default size of read buffer when using streaming version of this class.
	 * Any segment cannot be longer than buffer size.
	 */
	static readonly DEFAULT_BUFFER_LENGTH = 1024 * 1024;

	/** 
	 * Default max lookbehind construct length parameter.
	 */
	static readonly DEFAULT_MAX_LOOKBEHIND_CONSTRUCT_LENGTH = 100;
	
	private document!: SrxDocument;

	private segment!: string | null;

	private start!: number;
	private end!: number;
	
	private textManager!: TextManager;
	
	private ruleManager!: RuleManager;
	
	private ruleMatcherList!: RuleMatcher[];
	
	private margin!: number;
	
	
	/**
	 * Creates text iterator that obtains language rules form given document
	 * using given language code. This constructor version is not streaming 
	 * because it receives whole text as a string. 
	 * Supported parameters: {@link #MAX_LOOKBEHIND_CONSTRUCT_LENGTH_PARAMETER}.
	 * Without parameterMap, creates text iterator with no additional parameters.
	 * 
	 * @param document SRX document
	 * @param languageCode text language code of text used to retrieve the rules
	 * @param text
	 * @param parameterMap additional segmentation parameters
	 */
	constructor(document: SrxDocument, languageCode: string, 
			text: string, parameterMap: Map<string, unknown> | Record<string, unknown> = Util.getEmptyParameterMap()) {
		super();
		const newParameterMap = new Map<string, unknown>(parameterMap instanceof Map ? parameterMap : Object.entries(parameterMap));
		newParameterMap.set(SrxTextIterator.MARGIN_PARAMETER, 0);
		this.init(document, languageCode, new TextManager(text), newParameterMap);
	}

	/**
	 * Finds the next segment in the text and returns it.
	 * 
	 * @return next segment or null if it doesn't exist
	 * @throws IllegalStateException if buffer is too small to hold the segment
	 * @throws IORuntimeException if IO error occurs when reading the text
	 */
	next(): string | null {
		if (this.hasNext()) {

			// Initialize matchers before first search.
			if (this.segment == null) {
				this.initMatchers();
			}
			
			let found = false;
			
			while (!found) {
				
				let minMatcher = this.getMinMatcher();
				
				if (minMatcher == null && !this.textManager.hasMoreText()) {

					found = true;
					this.end = this.textManager.getText().length;
				
				} else {
					
					if (this.textManager.hasMoreText() && 
							(minMatcher == null || 
							minMatcher.getBreakPosition() > 
							this.textManager.getBufferLength() - this.margin)) {
						
						if (this.start == 0) {
							throw new Error("IllegalStateException: Buffer too short" +
									" - it must be at least as long as the" +
									" longest segment in the text; " +
									"try using the bufferLength option");
						}
						
						this.textManager.readText(this.start);
						this.start = 0;
						this.initMatchers();
						minMatcher = this.getMinMatcher();						

					}
					
					this.end = minMatcher!.getBreakPosition();

					if (this.end > this.start) {
						found = this.isException(minMatcher!);
						if (found) {
							this.cutMatchers();
						}
					}
					
				}
				
				this.moveMatchers();
			}
			
			this.segment = this.textManager.getText().substring(this.start, this.end);
			this.start = this.end;
			return this.segment;
			
		} else {
			
			return null;
			
		}
	}

	/**
	 * @return true if there are more segments
	 */
	hasNext(): boolean {
		return (this.textManager.hasMoreText() || 
				this.start < this.textManager.getText().length);
	}
	
	/**
	 * Initializes splitter.
	 *  
	 * @param document SRX document
	 * @param languageCode text language code
	 * @param textManager text manager containing the text
	 * @param parameterMap additional segmentation parameters
	 */
	private init(document: SrxDocument, languageCode: string, 
			textManager: TextManager, parameterMap: Map<string, unknown>): void {
		
		const margin = getParameter(parameterMap.get(SrxTextIterator.MARGIN_PARAMETER), 
				SrxTextIterator.DEFAULT_MARGIN);
		const maxLookbehindConstructLength = getParameter(parameterMap.get(
				SrxTextIterator.MAX_LOOKBEHIND_CONSTRUCT_LENGTH_PARAMETER), 
					SrxTextIterator.DEFAULT_MAX_LOOKBEHIND_CONSTRUCT_LENGTH);

		if (textManager.getBufferLength() > 0 &&
				textManager.getBufferLength() <= margin) {
			throw new Error("IllegalArgumentException: Margin: " + margin +
					" must be smaller than buffer itself: " + 
					textManager.getBufferLength() + ".");
		}
		
		this.document = document;
		this.segment = null;
		this.start = 0;
		this.end = 0;
		this.textManager = textManager;
		this.margin = margin;

		const languageRuleList: LanguageRule[] = 
			document.getLanguageRuleList(languageCode);
		
		const key = "RULE_MANAGER_" + this.toString(languageRuleList) 
				+ "_" + maxLookbehindConstructLength;
		
		this.ruleManager = document.getCache().get(key) as RuleManager;
		
		if (this.ruleManager == null) {
			this.ruleManager = new RuleManager(document, languageRuleList, 
					maxLookbehindConstructLength);
			document.getCache().put(key, this.ruleManager);
		}

	}
		
	/**
	 * Initializes matcher list according to rules from ruleManager and 
	 * text from textManager.
	 */
	private initMatchers(): void {
		this.ruleMatcherList = [];
		for (const rule of this.ruleManager.getBreakRuleList()) {
			const matcher = 
				new RuleMatcher(this.document, rule, this.textManager.getText());
			matcher.find();
			if (!matcher.hitEnd()) {
				this.ruleMatcherList.push(matcher);
			}
		}
	}

	/**
	 * Moves all matchers to the next position if their break position 
	 * is smaller than last segment end position.
	 */
	private moveMatchers(): void {
		// Iterator.remove: the list is rebuilt from the matchers that stay.
		this.ruleMatcherList = this.ruleMatcherList.filter((matcher) => {
			while (matcher.getBreakPosition() <= this.end) {
				matcher.find();
				if (matcher.hitEnd()) {
					return false;
				}
			}
			return true;
		});
	}

	/**
	 * Move matchers that start before previous segment end.
	 */
	private cutMatchers(): void {
		this.ruleMatcherList = this.ruleMatcherList.filter((matcher) => {
			if (matcher.getStartPosition() < this.end) {
				matcher.find(this.end);
				if (matcher.hitEnd()) {
					return false;
				}
			}
			return true;
		});
	}

	/**
	 * @return first matcher in the text or null if there are no matchers
	 */
	private getMinMatcher(): RuleMatcher | null {
		let minPosition = Number.MAX_SAFE_INTEGER;
		let minMatcher: RuleMatcher | null = null;
		for (const matcher of this.ruleMatcherList) {
			if (matcher.getBreakPosition() < minPosition) {
				minPosition = matcher.getBreakPosition();
				minMatcher = matcher;
			}
		}
		return minMatcher;
	}
	
	/**
	 * Returns true if there are no exception rules preventing given
	 * rule matcher from breaking the text.
	 * @param ruleMatcher rule matcher
	 * @return true if rule matcher breaks the text
	 */
	private isException(ruleMatcher: RuleMatcher): boolean {
		
		const pattern: Pattern | null = 
			this.ruleManager.getExceptionPattern(ruleMatcher.getRule());
		
		if (pattern != null) {
			const matcher: Matcher = pattern.matcher(this.textManager.getText());
			matcher.useTransparentBounds(true);
			matcher.region(ruleMatcher.getBreakPosition(), 
					this.textManager.getText().length);
			return !matcher.lookingAt();
		} else {
			return true;
		}

	}
	
}
