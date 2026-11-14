// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/util/Util.java partial
// Only the regular expression and parameter helpers: the IO, XML (schema, JAXB, XSLT) and
// manifest helpers are not needed, as readers are strings here and SRX is not validated.
import { Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import type { SrxDocument } from '../srx/SrxDocument.ts';

export class Util {
	
	static readonly READ_BUFFER_SIZE = 1024;

	private static readonly STAR_PATTERN = Pattern
			.compile("(?<=(?<!\\\\)(?:\\\\\\\\){0,100})\\*");

	private static readonly PLUS_PATTERN = Pattern
			.compile("(?<=(?<!\\\\)(?:\\\\\\\\){0,100})(?<![\\?\\*\\+]|\\{[0-9],?[0-9]?\\}?\\})\\+");

	private static readonly RANGE_PATTERN = Pattern
			.compile("(?<=(?<!\\\\)(?:\\\\\\\\){0,100})\\{\\s*([0-9]+)\\s*,\\s*\\}");

	private static readonly CAPTURING_GROUP_PATTERN = Pattern
			.compile("(?<=(?<!\\\\)(?:\\\\\\\\){0,100})\\((?!\\?)");

	/**
	 * Replaces block quotes in regular expressions with normal quotes. For
	 * example "\Qabc\E" will be replace with "\a\b\c".
	 * 
	 * @param pattern
	 * @return pattern with replaced block quotes
	 */
	static removeBlockQuotes(pattern: string): string {
		let patternBuilder = "";
		let quote = false;
		let previousChar = "\0";

		for (let i = 0; i < pattern.length; ++i) {
			const currentChar = pattern.charAt(i);

			if (quote) {
				if (previousChar == '\\' && currentChar == 'E') {
					quote = false;
					// Need to remove "\\" at the end as it has been added
					// in previous iteration.
					patternBuilder = patternBuilder.slice(0, patternBuilder.length - 2);
				} else {
					patternBuilder += '\\';
					patternBuilder += currentChar;
				}
			} else {
				if (previousChar == '\\' && currentChar == 'Q') {
					quote = true;
					// Need to remove "\" at the end as it has been added
					// in previous iteration.
					patternBuilder = patternBuilder.slice(0, patternBuilder.length - 1);
				} else {
					patternBuilder += currentChar;
				}
			}

			previousChar = currentChar;
		}

		return patternBuilder;
	}

	/**
	 * Changes unlimited length pattern to limited length pattern. It is done by
	 * replacing constructs with "*" and "+" symbols with their finite 
	 * counterparts - "{0,n}" and {1,n}. 
	 * As a side effect block quotes are replaced with normal quotes
	 * by using {@link #removeBlockQuotes(String)}.
	 * 
	 * @param pattern pattern to be finitized
	 * @param infinity "n" number
	 * @return limited length pattern
	 */
	static finitize(pattern: string, infinity: number): string {
		let finitePattern = Util.removeBlockQuotes(pattern);
		
		const starMatcher = Util.STAR_PATTERN.matcher(finitePattern);
		finitePattern = starMatcher.replaceAll("{0," + infinity + "}");
		
		const plusMatcher = Util.PLUS_PATTERN.matcher(finitePattern);
		finitePattern = plusMatcher.replaceAll("{1," + infinity + "}");
		
		const rangeMatcher = Util.RANGE_PATTERN.matcher(finitePattern);
		finitePattern = rangeMatcher.replaceAll("{$1," + infinity + "}");
		
		return finitePattern;
	}

	static compile(document: SrxDocument, regex: string): Pattern {
		const key = "PATTERN_" + regex;
		let pattern = document.getCache().get(key) as Pattern | undefined;
		if (pattern == null) {
			pattern = Pattern.compile(regex);
			document.getCache().put(key, pattern);
		}
		return pattern;
	}

	/**
	 * Replaces capturing groups with non-capturing groups in the given regular
	 * expression. As a side effect block quotes are replaced with normal quotes
	 * by using {@link #removeBlockQuotes(String)}.
	 * 
	 * @param pattern
	 * @return modified pattern
	 */
	static removeCapturingGroups(pattern: string): string {
		let newPattern = Util.removeBlockQuotes(pattern);
		const capturingGroupMatcher = Util.CAPTURING_GROUP_PATTERN
				.matcher(newPattern);
		newPattern = capturingGroupMatcher.replaceAll("(?:");
		return newPattern;
	}
	
	/**
	 * Returns value if it is not null or default value if it is null.
	 * Automatically cast value to the same type as default value.
	 * @param value object
	 * @param defaultValue default value.
	 * @return object value or default value if object value is null
	 */
	static getParameter<T>(value: unknown, defaultValue: T): T {
		let result: T;
		if (value != null) {
			result = value as T;
		} else {
			result = defaultValue;
		}
		return result;
	}
	
	static getEmptyParameterMap(): Map<string, unknown> {
		return new Map<string, unknown>();
	}

}
