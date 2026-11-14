// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/logic/LogicExpressionParsers.java faithful
// The anonymous subclasses are class expressions.
import { type Arg, Pred } from './Expression.ts';
import { LogicExpressionParser } from './LogicExpressionParser.ts';

/**
 * Static factories for logic expressions over basic objects.
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 */
export class LogicExpressionParsers {
    /**
     * Logic expressions where "true" evaluates to true and "false" evaluates to
     * false. For example:
     *
     * (true | false) & true
     *
     * This logic expression is trivial because it's value is independent of the
     * object it is applied to.
     */
    static readonly trivial: LogicExpressionParser<string> =
        new (class extends LogicExpressionParser<string> {
            override factory(string: string): Arg<string> {
                return new (class extends Pred<string> {
                    override apply(_entity: string): boolean {
                        return "true" === string;
                    }
                })(string);
            }
        })();

    /**
     * Logic expressions where tokens are strings.  A token is true if it
     * matches the input string.
     */
    static readonly stringMatch: LogicExpressionParser<string> =
        new (class extends LogicExpressionParser<string> {
            override factory(token: string): Arg<string> {
                return new (class extends Pred<string> {
                    readonly string = token.substring(1, token.length - 1);

                    override apply(entity: string): boolean {
                        return entity === this.string;
                    }
                })(token);
            }
        })();
}
