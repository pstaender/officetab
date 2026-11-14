// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/regex/RegularExpressionParser.java faithful
// Lists are arrays; List.remove(size() - 1) on an empty list throws IndexOutOfBoundsException
// as in Java (List_removeLast). The Java regexes go through jdk Pattern.
import type { Function } from '../../../../../../jdk/com/google/common/base/Function.ts';
import { Integer_parseInt } from '../../../../../../jdk/java/lang/Exceptions.ts';
import { type Matcher, Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import {
    type BaseExpression, EndAssertion, type Expression, MatchingGroup, MinMax, NamedGroup, NonMatchingGroup,
    Option, Or, Plus, Star, StartAssertion,
} from './Expression.ts';
import { RegularExpression } from './RegularExpression.ts';
import { TokenizationRegexException } from './RegexException.ts';

/** list.remove(list.size() - 1) */
function List_removeLast<T>(list: T[]): T {
    if (list.length === 0) {
        throw new Error("IndexOutOfBoundsException: Index -1 out of bounds for length 0");
    }
    return list.pop()!;
}

/**
 * A regular expression parser turns strings into RegularExpression
 * objects.
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param  <E>  the type of the sequence elements
 */
export abstract class RegularExpressionParser<E> implements Function<string, RegularExpression<E>> {
    /***
     * The factory method creates an expression from the supplied token string.
     * @param  token  a string representation of a token
     * @return  an evaluatable representation of a token
     */
    abstract factory(token: string): BaseExpression<E>;

    parse(string: string): RegularExpression<E> {
        const expressions: Expression<E>[] = this.tokenize(string);
        return new RegularExpression<E>(expressions);
    }

    apply(string: string): RegularExpression<E> {
        return this.parse(string);
    }

    /***
     * Read a token from the remaining text and return it.
     *
     * This is a default implementation that is overridable.
     * In the default implementation, the starting and ending
     * token characters are not escapable.
     *
     * If this implemenation is overridden, A token MUST ALWAYS
     * start with '<' or '[' and end with '>' or ']'.
     *
     * @param remaining
     * @return
     */
    readToken(remaining: string): string {
        const start = 0;
        const c = remaining.charAt(0);

        let end: number;
        if (c === '<') {
            end = RegularExpressionParser.indexOfClose(remaining, start, '<', '>');
        }
        else if (c === '[' ){
            end = RegularExpressionParser.indexOfClose(remaining, start, '[', ']');
        }
        else {
            throw new Error("IllegalStateException");
        }

        // make sure we found the end
        if (end === -1) {
            throw new TokenizationRegexException(
                    "bad token. Non-matching brackets (<> or []): " + start
                    + ":\"" + remaining.substring(start) + "\"");
        }

        const token = remaining.substring(start, end + 1);
        return token;
    }

    /**
     * Convert a list of tokens (<...>) to a list of expressions.
     *
     * @param tokens
     * @param factory
     *            Factory class to create a BaseExpression from the text between
     *            angled brackets.
     * @return
     */
    tokenize(string: string): Expression<E>[] {
        const expressions: Expression<E>[] = [];

        const whitespacePattern = Pattern.compile("\\s+");
        const unaryPattern = Pattern.compile("[*?+]");
        const minMaxPattern = Pattern.compile("\\{(\\d+),(\\d+)\\}");
        const binaryPattern = Pattern.compile("[|]");

        const tokens: string[] = [];

        let stack = ' ';
        let start = 0;
        while (start < string.length) {
            let matcher: Matcher;

            // skip whitespace
            if ((matcher = whitespacePattern.matcher(string))
                .region(start, string.length).lookingAt()) {
                start = matcher.end();
                continue;
            }

            const c = string.charAt(start);
            // group, assertion, or token
            if (c === '(' || c === '<' || c === '[' || c === '$' || c === '^') {
                // group
                if (string.charAt(start) === '(') {
                    const end = RegularExpressionParser.indexOfClose(string, start, '(', ')');
                    if (end === -1) {
                        throw new TokenizationRegexException("unclosed parenthesis: " + start
                                + ":\"" + string.substring(start) + ")\"");
                    }

                    let group = string.substring(start + 1, end);
                    start = end + 1;

                    const namedPattern = Pattern.compile("<(\\w*)>:(.*)");
                    const unnamedPattern = Pattern.compile("\\?:(.*)");

                    // named group (matching)
                    if ((matcher = namedPattern.matcher(group)).matches()) {
                        const groupName = matcher.group(1)!;
                        group = matcher.group(2)!;
                        const groupExpressions: Expression<E>[] = this.tokenize(group);
                        expressions.push(new NamedGroup<E>(groupName, groupExpressions));
                    }
                    // unnamed group
                    else if ((matcher = unnamedPattern.matcher(group)).matches()) {
                        group = matcher.group(1)!;
                        const groupExpressions: Expression<E>[] = this.tokenize(group);
                        expressions.push(new NonMatchingGroup<E>(groupExpressions));
                    }
                    // group (matching)
                    else {
                        const groupExpressions: Expression<E>[] = this.tokenize(group);
                        expressions.push(new MatchingGroup<E>(groupExpressions));
                    }
                }

                // token
                else if (c === '<' || c === '[') {
                    const token = this.readToken(string.substring(start));
                    try {
                        // strip off enclosing characters
                        const tokenInside = token.substring(1, token.length - 1);
                        const base: BaseExpression<E> = this.factory(tokenInside);
                        expressions.push(base);

                        start += token.length;
                    }
                    catch (e) {
                        throw new TokenizationRegexException("error parsing token: " + token, e);
                    }
                }

                // assertion (^)
                else if (c === '^') {
                    expressions.push(new StartAssertion<E>());
                    start += 1;
                }

                // assertion ($)
                else if (c === '$') {
                    expressions.push(new EndAssertion<E>());
                    start += 1;
                }

                // check if we have a floating OR operator
                if (stack === '|') {
                    try {
                        stack = ' ';
                        if (expressions.length < 2) {
                            throw new Error(
                                    "IllegalStateException: OR operator is applied to fewer than 2 elements.");
                        }

                        const expr1: Expression<E> = List_removeLast(expressions);
                        const expr2: Expression<E> = List_removeLast(expressions);
                        expressions.push(new Or<E>(expr1, expr2));
                    }
                    catch (e) {
                        throw new TokenizationRegexException("error parsing OR (|) operator.", e);
                    }
                }
            }
            // unary operator
            else if ((matcher = unaryPattern.matcher(string))
                     .region(start, string.length).lookingAt()) {
                const operator = matcher.group(0)!.charAt(0);

                // pop the last expression
                const base: Expression<E> = List_removeLast(expressions);

                // add the operator to it
                let expr: Expression<E>;
                if (operator === '?') {
                    expr = new Option<E>(base);
                } else if (operator === '*') {
                    expr = new Star<E>(base);
                } else if (operator === '+') {
                    expr = new Plus<E>(base);
                }
                else {
                    throw new Error("IllegalStateException");
                }

                expressions.push(expr);

                start = matcher.end();
            }
            // min/max operator "{x,y}"
            else if ((matcher = minMaxPattern.matcher(string))
                    .region(start, string.length).lookingAt()) {
                const minOccurrences = Integer_parseInt(matcher.group(1));
                const maxOccurrences = Integer_parseInt(matcher.group(2));

                // pop the last expression and add operator
                const base: Expression<E> = List_removeLast(expressions);
                const expr: Expression<E> = new MinMax<E>(base, minOccurrences, maxOccurrences);

                expressions.push(expr);

                start = matcher.end();
            }
            // binary operator (alternation)
            else if ((matcher = binaryPattern.matcher(string))
                     .region(start, string.length).lookingAt()) {
                tokens.push(matcher.group(0)!);
                stack = '|';
                start = matcher.end();
            }
            else {
                throw new TokenizationRegexException("unknown symbol: "
                        + string.substring(start));
            }
        }

        if (stack === '|') {
            throw new TokenizationRegexException("OR remains on the stack.");
        }

        return expressions;
    }

    private static indexOfClose(string: string, start: number, open: string, close: string): number {
        start--;

        let count = 0;
        do {
            start++;

            // we hit the end
            if (start >= string.length) {
                return -1;
            }

            const c = string.charAt(start);

            // we hit an open/close
            if (c === open) {
                count++;
            } else if (c === close) {
                count--;
            }

        } while (count > 0);

        return start;
    }
}
