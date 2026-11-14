// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/regex/Match.java faithful
// The nested classes are exported under their simple names (Match.FinalMatch is FinalMatch,
// Match.Group is Group); Group's private nested Token is module-local. Group's token list is
// the field _tokens (Java: tokens, next to the method tokens()), read by Match as Java does.
// Overloads (the constructors, add) are one method with optional parameters; Joiner and
// Lists.transform are join and map; unmodifiable lists are copies.
import { BaseExpression, type Expression, MatchingGroup, NamedGroup, NonMatchingGroup } from './Expression.ts';

/**
 * A class to represent a match. Each part of the regular expression is matched
 * to a sequence of tokens.   A match also stores information about the range
 * of tokens matched and the matching groups in the match.
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export abstract class Match<E> {
    protected _pairs: Group<E>[];

    /** Match(), or Match(Match match): a copy of match's pairs. */
    protected constructor(match?: Match<E>) {
      this._pairs = [];
      if (match !== undefined) {
        for (const pair of match._pairs) {
            this.add(new Group<E>(pair.expr, pair._tokens));
        }
      }
    }

    /**
     * add(Group pair), or add(Expression expr, E token, int pos):
     * convenience method for add(new Group<E>(expr, token, pos)).
     * @param expr
     * @param token
     * @param pos
     * @return
     */
    add(pair: Group<E> | Expression<E>, token?: E, pos?: number): boolean {
        if (pos !== undefined) {
            return this.add(new Group<E>(pair as Expression<E>, token as E, pos));
        }
        this._pairs.push(pair as Group<E>);
        return true;
    }

    addAll(pairs: readonly Group<E>[]): boolean {
        let result = true;
        for (const pair of pairs) {
            result = this.add(pair) && result;
        }

        return result;
    }

    /**
     * True iff this match contains no pairs.  This should only happen on an
     * IntermediateMatch that has not had any pairs added to it yet.
     */
    isEmpty(): boolean {
        return this._pairs.length === 0;
    }

    toString(): string {
        return "[" + this._pairs.map((p) => p.toString()).join(", ") + "]";
    }

    toMultilineString(): string {
        return this._pairs.map((p) => p.toString()).join("\n");
    }

    /**
     * @return the index of the first token matched (inclusive start).
     */
    abstract startIndex(): number;

    /**
     * @return the index one past of the last token matched (exclusive end).
     */
    abstract endIndex(): number;

    /**
     * Pairs differ from the matching groups in that each regular expression
     * element has a pair to associate the element with the text matched.
     * For example, 'a*' might be associated with 'a a a a'.
     *
     * @return all pairs in this match.
     */
    pairs(): readonly Group<E>[] {
        return this._pairs;
    }

    /**
     * @return all matching groups (named and unnamed).
     */
    abstract groups(): readonly Group<E>[];

    /**
     * @return all matched tokens.
     */
    abstract tokens(): readonly E[];

    /**
     * @return the number of tokens in the match.
     */
    length(): number {
        return this.tokens().length;
    }

    /**
     * Retrieve a group by name.
     * @param name the name of the group to retrieve.
     * @return the associated group.
     */
    group(name: string): Group<E> | null {
        for (const group of this.groups()) {
            if (group.expr instanceof NamedGroup) {
                const namedGroup = group.expr as NamedGroup<E>;
                if (namedGroup.name === name) {
                    return group;
                }
            }
        }

        return null;
    }
}

/**
 * A match representation that has efficient method calls but is immutable.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class FinalMatch<E> extends Match<E> {
    private readonly _startIndex: number;
    private readonly _tokens: readonly E[];
    private readonly _groups: readonly Group<E>[];

    constructor(m: Match<E>) {
        super(m);
        this._startIndex = m.startIndex();
        this._tokens = m.tokens().slice();
        this._groups = m.groups().slice();
    }

    startIndex(): number {
        return this._startIndex;
    }

    endIndex(): number {
        return this.startIndex() + this._tokens.length;
    }

    tokens(): readonly E[] {
        return this._tokens;
    }

    groups(): readonly Group<E>[] {
        return this._groups;
    }
}

/**
 * A match representation that is mutable but many method calls compute
 * values instead of returning stored values.  This is a good in-between
 * while building a match object.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class IntermediateMatch<E> extends Match<E> {
    constructor() {
        super();
    }

    tokens(): readonly E[] {
        const tokens: E[] = [];
        for (const pair of this._pairs) {
            if (pair.expr instanceof BaseExpression) {
                tokens.push(...pair.tokens());
            }
        }

        return tokens;
    }

    groups(): readonly Group<E>[] {
        const groups: Group<E>[] = [];
        for (const pair of this._pairs) {
            if (pair.expr instanceof MatchingGroup
            && !(pair.expr instanceof NonMatchingGroup)) {
                groups.push(pair);
            }
        }

        return groups;
    }

    startIndex(): number {
        for (const pair of this._pairs) {
            if (pair.expr instanceof BaseExpression) {
                return pair._tokens[0]!.index;
            }
        }

        return -1;
    }

    endIndex(): number {
        for (const pair of this._pairs.slice().reverse()) {
            if (pair.expr instanceof BaseExpression) {
                return pair._tokens[0]!.index;
            }
        }

        return -1;
    }
}

class Token<E> {
    entity: E;
    index: number;

    constructor(entity: E, index: number) {
        this.entity = entity;
        this.index = index;
    }

    toString(): string {
        return String(this.entity);
    }
}

/**
 * A captured group in a matched expression.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class Group<E> {
    readonly expr: Expression<E>;
    /** @internal Java: the private field tokens, which Match reads. */
    readonly _tokens: Token<E>[];

    /**
     * Group(Expression expr, E token, int pos), Group(Expression expr, List<Token> tokens)
     * or Group(Expression expr) (no tokens).
     */
    constructor(expr: Expression<E>, token?: E | readonly Token<E>[], pos?: number) {
        this.expr = expr;
        if (pos !== undefined) {
            this._tokens = [new Token<E>(token as E, pos)];
        } else if (token !== undefined) {
            this._tokens = (token as readonly Token<E>[]).slice();
        } else {
            this._tokens = [];
        }
    }

    /**
     * Add tokens to the group.
     * @param group
     */
    addTokens(group: Group<E>): void {
        this._tokens.push(...group._tokens);
    }

    /**
     * @return the tokens matched.
     */
    tokens(): E[] {
        return this._tokens.map((token) => token.entity);
    }

    /**
     * @return the index of the first token in this group or -1
     */
    startIndex(): number {
        let min = -1;
        for (const token of this._tokens) {
            if (min === -1 || token.index < min)
                min = token.index;
        }

        return min;
    }

    /**
     * @return the index of the last token in this group or -1
     */
    endIndex(): number {
        let max = -1;
        for (const token of this._tokens) {
            if (token.index === -1 || token.index > max)
                max = token.index;
        }

        return max;
    }

    /**
     * A string representation of the group.
     * This is a lighter-weight representation than toString.
     */
    text(): string {
        return this.tokens().map((t) => String(t)).join(" ");
    }

    /**
     * @return the number of tokens matched.
     */
    tokenCount(): number {
        return this._tokens.length;
    }

    toString(): string {
        return this.expr.toString()
                + ":'"
                + this._tokens.map((t) => t.toString()).join(" ") + "'";
    }
}
