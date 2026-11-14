// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/regex/RegularExpression.java partial
// Left out: main() (an interactive stdin loop) and hashCode. Lists are arrays. Overloads are one
// method with optional parameters: compile (a list of expressions, or a string and a factory
// delegate, which may be an object with apply(), such as an ExpressionFactory, or a lambda),
// find and lookingAt (start defaults to 0).
import { Function_apply, type FunctionOrLambda, type Predicate } from '../../../../../../jdk/com/google/common/base/Function.ts';
import { type BaseExpression, type Expression, MatchingGroup } from './Expression.ts';
import type { Automaton } from './FiniteAutomaton.ts';
import type { Match } from './Match.ts';
import { RegularExpressionParser } from './RegularExpressionParser.ts';

/**
 * A regular expression engine that operates over sequences of user-specified
 * objects.
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param  <E>  the type of the sequence elements
 */
export class RegularExpression<E> implements Predicate<E[]> {
    readonly expressions: Expression<E>[];
    readonly auto: Automaton<E>;

    constructor(expressions: Expression<E>[]) {
        this.expressions = expressions;
        this.auto = RegularExpression.build(this.expressions);
    }

    /***
     * Create a regular expression without tokenization support.
     * @param expressions
     * @return
     *
     * With a string: create a regular expression from the specified string.
     * @param expression
     * @param factoryDelegate
     * @return
     */
    static compile<E>(expression: Expression<E>[] | string,
            factoryDelegate?: FunctionOrLambda<string, BaseExpression<E>>): RegularExpression<E> {
        if (typeof expression !== "string") {
            return new RegularExpression<E>(expression);
        }
        return new (class extends RegularExpressionParser<E> {
            override factory(token: string): BaseExpression<E> {
                return Function_apply(factoryDelegate!, token);
            }
        })().parse(expression);
    }

    equals(other: unknown): boolean {
        if (! (other instanceof RegularExpression)) {
            return false;
        }

        const expression = other as RegularExpression<unknown>;
        return this.toString() === expression.toString();
    }

    toString(): string {
        const expressions: string[] = [];
        for (const expr of this.expressions) {
            expressions.push(expr.toString());
        }

        return expressions.join(" ");
    }

    /**
     * Build an NFA from the list of expressions.
     * @param exprs
     * @return
     */
    static build<E>(exprs: Expression<E>[]): Automaton<E> {
        const group = new MatchingGroup<E>(exprs);
        return group.build();
    }

    /**
     * Apply the expression against a list of tokens.
     *
     * @return true iff the expression if found within the tokens.
     */
    apply(tokens: E[]): boolean {
        if (this.find(tokens) != null) {
            return true;
        } else {
            return false;
        }
    }

    /**
     * Apply the expression against a list of tokens.
     *
     * @return true iff the expression matches all of the tokens.
     */
    matches(tokens: E[]): boolean {
        const match = this.lookingAt(tokens, 0);
        return match != null && match.endIndex() === tokens.length;
    }

    /**
     * Find the first match of the regular expression against tokens. This
     * method is slightly slower due to additional memory allocations. However,
     * the response has much greater detail and is very useful for
     * writing/debugging regular expressions.
     *
     * (With start: find the first match of the regular expression against
     * tokens, starting at the specified index.)
     *
     * @param tokens tokens to match against.
     * @param start index to start looking for a match.
     * @return an object representing the match, or null if no match is found.
     */
    find(tokens: E[], start = 0): Match<E> | null {
        let match: Match<E> | null;
        for (let i = start; i <= tokens.length - this.auto.minMatchingLength(); i++) {
            match = this.lookingAt(tokens, i);
            if (match != null) {
                return match;
            }
        }

        return null;
    }

    /**
     * Determine if the regular expression matches the beginning of the
     * supplied tokens.
     *
     * (With start: determine if the regular expression matches the supplied
     * tokens, starting at the specified index.)
     *
     * @param tokens the list of tokens to match.
     * @param start the index where the match should begin.
     * @return an object representing the match, or null if no match is found.
     */
    lookingAt(tokens: E[], start = 0): Match<E> | null {
        return this.auto.lookingAt(tokens, start);
    }

    match(tokens: E[]): Match<E> | null {
        const match = this.lookingAt(tokens);
        if (match != null && match.endIndex() === tokens.length) {
            return match;
        }
        else {
            return null;
        }
    }

    /**
     * Find all non-overlapping matches of the regular expression against tokens.
     *
     * @param tokens
     * @return an list of objects representing the match.
     */
    findAll(tokens: E[]): Match<E>[] {
        const results: Match<E>[] = [];

        let start = 0;
        let match: Match<E> | null;
        do {
            match = this.find(tokens, start);

            if (match != null) {
                start = match.endIndex();

                // match may be empty query string has all optional parts
                if (!match.isEmpty()) {
                    results.push(match);
                }
            }
        } while (match != null);

        return results;
    }
}
