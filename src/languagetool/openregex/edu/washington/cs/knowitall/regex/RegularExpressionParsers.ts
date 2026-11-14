// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/regex/RegularExpressionParsers.java faithful
// The anonymous subclasses are class expressions; Character tokens are one-char strings.
import { BaseExpression } from './Expression.ts';
import { RegularExpressionParser } from './RegularExpressionParser.ts';

/**
 * Static factories for regular expressions over some basic sequences.
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 */
export class RegularExpressionParsers {
    /**
     * Regular expressions over words where sequences are string
     * representations of words.
     */
    static readonly word: RegularExpressionParser<string> =
        new (class extends RegularExpressionParser<string> {
            override factory(string: string): BaseExpression<string> {
                return new (class extends BaseExpression<string> {
                    override apply(token: string): boolean {
                        return string === token;
                    }
                })(string);
            }
        })();

    /**
     * Regular expression over characters, as in java.util.Regex.
     */
    static readonly character: RegularExpressionParser<string> =
        new (class extends RegularExpressionParser<string> {
            override factory(string: string): BaseExpression<string> {
                return new (class extends BaseExpression<string> {
                    override apply(token: string): boolean {
                        return string === token.toString();
                    }
                })(string);
            }
        })();
}
