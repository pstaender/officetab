// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/logic/LogicExpressionParser.java faithful
// java.util.Stack<Character> is an array; the Java regexes go through jdk Pattern.
import type { Function } from '../../../../../../jdk/com/google/common/base/Function.ts';
import { StringTrim } from '../../../../../../jdk/java/lang/Character.ts';
import { Matcher, Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { And, type Arg, type Expression, L, Not, Or, R } from './Expression.ts';
import { LogicExpression } from './LogicExpression.ts';
import { TokenizeLogicException } from './LogicException.ts';

/**
 * A logic expression engine that operates over user specified objects.
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param  <E>  the type of the base expressions
 */
export abstract class LogicExpressionParser<E> implements Function<string, LogicExpression<E>> {
    /***
     * Create a LogicExpression object from the supplied string.
     * @param string
     * @return
     */
    parse(string: string): LogicExpression<E> {
        const expressions: Expression<E>[] = this.tokenize(string);
        return new LogicExpression<E>(expressions);
    }

    apply(string: string): LogicExpression<E> {
        return this.parse(string);
    }

    /***
     * The factory method creates an argument from the supplied token string.
     * @param  argument  a string representation of a token
     * @return  an evaluatable representation of a token
     */
    abstract factory(argument: string): Arg<E>;

    static readonly doubleQuoteStringLiteralRegex: Pattern =
            Pattern.compile("\"" + "([^\"\\p{Cntrl}\\\\]*+(?:\\\\[\\\\'\"bfnrt])*+(?:\\\\u[a-fA-F0-9]{4})*+)*+" + "\"");
    static readonly singleQuoteStringLiteralRegex: Pattern =
            Pattern.compile("'" + "(?:[^']*+)" + "'");
    static readonly regexLiteralRegex: Pattern =
            Pattern.compile("/" + "(?:(?:[^/\\\\]*+(?:\\\\)*+(?:\\\\/)*+)*+)" + "/");
    private static readonly literalPatterns: Pattern[] = [
            LogicExpressionParser.doubleQuoteStringLiteralRegex, LogicExpressionParser.singleQuoteStringLiteralRegex,
            LogicExpressionParser.regexLiteralRegex];

    /***
     * The readToken method reads a token from the remaining LogicExpression string.
     *
     * A token may contain a string.  If it contains parentheses, the token
     * will last until the parentheses are balanced.  And &, |, or unbalanced )
     * will mark the end of a token.
     *
     * This is a default implementation that may be overriden.
     * @param  remainder  the remaining text to tokenize
     * @return  a token from the beginning on `remaining`
     */
    readToken(remainder: string): string {
        let token: string;
        try {
            const parens: string[] = [];

            let nextExpression: number;
            for (nextExpression = 0; nextExpression < remainder.length; nextExpression++) {
                const c = remainder.charAt(nextExpression);

                // check for quotation
                let match: string | null = null;
                for (const pattern of LogicExpressionParser.literalPatterns) {
                    const matcher: Matcher = pattern.matcher(remainder).region(
                            nextExpression, remainder.length);
                    if (matcher.lookingAt()) {
                        match = matcher.group(0);
                        break;
                    }
                }

                if (match != null) {
                    // we found and can consume a quotation
                    nextExpression += match.length - 1;
                } else if (c === '(') {
                    parens.push(c);
                } else if (c === ')') {
                    if (parens.length === 0) {
                        break;
                    } else {
                        parens.pop();
                    }
                } else if (c === '&' || c === '|') {
                    break;
                }
            }

            token = StringTrim(remainder.substring(0, nextExpression));
        } catch (e) {
            throw new TokenizeLogicException("Error parsing token: "
                    + remainder, e);
        }

        if (token.length === 0) {
            throw new TokenizeLogicException("zero-length token found.");
        }

        return token;
    }

    /***
     * Convert an infix string logic representation to an infix list of tokens.
     * @param input an infix string logic representation.
     * @param factory a delegate that converts a string representation of an
     * argument into a token object.  @return
     *
     * @throws TokenizeLogicException
     */
    tokenize(input: string): Expression<E>[] {
        const tokens: Expression<E>[] = [];

        let i = 0;
        while (i < input.length) {
            const substring = input.substring(i);
            const firstChar = substring.charAt(0);

            if (firstChar === ' ') {
                i += 1;
                continue;
            }
            else if (firstChar === '(') {
                tokens.push(new L<E>());
                i += 1;
            } else if (firstChar === ')') {
                tokens.push(new R<E>());
                i += 1;
            } else if (firstChar === '!') {
                tokens.push(new Not<E>());
                i += 1;
            } else if (firstChar === '&') {
                tokens.push(new And<E>());
                i += 1;
            } else if (firstChar === '|') {
                tokens.push(new Or<E>());
                i += 1;
            } else {
                // parse out the token
                const token = this.readToken(substring);

                tokens.push(this.factory(token));
                i += token.length;
            }
        }

        return tokens;
    }
}
