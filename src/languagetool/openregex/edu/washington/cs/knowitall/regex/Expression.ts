// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/regex/Expression.java faithful
// The interface's nested classes are exported under their simple names (Expression.MatchingGroup
// is MatchingGroup, Expression.BaseExpression is BaseExpression, ...). AssertionExpression's two
// apply overloads (apply(E) and apply(boolean, List<E>, int)) are one method: with one argument it
// is apply(E), which is false; the assertions override it and answer the three-argument form.
import type { Predicate } from '../../../../../../jdk/com/google/common/base/Function.ts';
import { Automaton, State } from './FiniteAutomaton.ts';

/**
 * Interface for a component of a regular expression.
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 */
export interface Expression<E> extends Predicate<E> {

    build(): Automaton<E>;

    minMatchingLength(): number;

    toString(): string;
}

/** IllegalArgumentException, as the ports throw it. */
function IllegalArgumentException(message: string): Error {
    return new Error("IllegalArgumentException: " + message);
}

/**
 * Represents a matching group that is referred to by order number.
 *     {@code (<foo> <bar>+)}
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class MatchingGroup<E> implements Expression<E> {
    readonly expressions: Expression<E>[];

    constructor(expressions: Expression<E>[]) {
        this.expressions = expressions;
    }

    apply(_entity: E): boolean {
        throw new Error("UnsupportedOperationException");
    }

    subexpString(): string {
        const subs: string[] = [];
        for (const expr of this.expressions) {
            subs.push(expr.toString());
        }

        return subs.join(" ");
    }

    toString(): string {
        return "(" + this.subexpString() + ")";
    }

    /**
     * Convert the expression into a NFA.
     */
    build(): Automaton<E> {
        const auto = new Automaton<E>(this);

        const exprIterator = this.expressions[Symbol.iterator]();
        let sub: Automaton<E>;

        // connect the start to the first subexpression
        let prev: State<E> = auto.start;
        let next = exprIterator.next();
        if (!next.done) {
            sub = next.value.build();
            auto.start.connect(sub.start);
            prev = sub.end;
        }
        while (!(next = exprIterator.next()).done) {
            const expr: Expression<E> = next.value;
            sub = expr.build();

            const connector = new State<E>();

            prev.connect(connector);
            connector.connect(sub.start);
            prev = sub.end;
        }

        prev.connect(auto.end);

        return auto;
    }

    minMatchingLength(): number {
        let len = 0;
        for (const expr of this.expressions) {
            len += expr.minMatchingLength();
        }
        return len;
    }
}

/**
 * Represents a matching group that is referred to by name.
 *     {@code (<name>:<foo> <bar>+)}
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class NamedGroup<E> extends MatchingGroup<E> {
    readonly name: string;

    constructor(name: string, expressions: Expression<E>[]) {
        super(expressions);
        this.name = name;
    }

    override toString(): string {
        return "(<"+this.name+">:" + super.subexpString() + ")";
    }
}

/**
 * Represents a non-matching group.
 *     {@code (?:<foo> <bar>+)}
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class NonMatchingGroup<E> extends MatchingGroup<E> {
    constructor(expressions: Expression<E>[]) {
        super(expressions);
    }

    override toString(): string {
        return "(?:" + super.subexpString() + ")";
    }
}

/**
 * Disjunction of two experssions.
 *     {@code <foo>|<bar>}
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class Or<E> implements Expression<E> {
    readonly expr1: Expression<E>;
    readonly expr2: Expression<E>;

    constructor(expr1: Expression<E>, expr2: Expression<E>) {
        this.expr1 = expr1;
        this.expr2 = expr2;
    }

    apply(_entity: E): boolean {
        return true;
    }

    toString(): string {
        return this.expr1.toString() + " | " + this.expr2.toString();
    }

    /**
     * Convert the expression into a NFA.
     */
    build(): Automaton<E> {
        const auto = new Automaton<E>(this);

        const sub1 = this.expr1.build();
        const sub2 = this.expr2.build();

        // attach the sub automata
        auto.start.connect(sub1.start);
        auto.start.connect(sub2.start);
        sub1.end.connect(auto.end);
        sub2.end.connect(auto.end);

        return auto;
    }

    minMatchingLength(): number {
        const left = this.expr1.minMatchingLength();
        const right = this.expr2.minMatchingLength();
        if (left < right)
          return left;
        else
          return right;
    }
}

/**
 * Kleene-star: zero or more of the enclosed expression.
 *     {@code <foo>*}
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class Star<E> implements Expression<E> {
    readonly expr: Expression<E>;

    constructor(expr: Expression<E>) {
        this.expr = expr;
    }

    apply(entity: E): boolean {
        return this.expr.apply(entity);
    }

    toString(): string {
        return this.expr.toString() + "*";
    }

    /**
     * Convert the expression into a NFA.
     */
    build(): Automaton<E> {
        const auto = new Automaton<E>(this);

        const sub = this.expr.build();

        // run it again
        sub.end.connect(sub.start);

        // attach the sub automaton
        auto.start.connect(sub.start);
        sub.end.connect(auto.end);

        // skip it completely
        auto.start.connect(auto.end);

        return auto;
    }

    minMatchingLength(): number {
        return 0;
    }
}

/**
 * One or more of the enclosed expression.  Plus(expr) is equivalent to
 * expr followed by Star(expr).
 *     {@code <foo>+} is the same as {@code <foo> <foo>*}
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class Plus<E> implements Expression<E> {
    readonly expr: Expression<E>;

    constructor(expr: Expression<E>) {
        this.expr = expr;
    }

    apply(entity: E): boolean {
        return this.expr.apply(entity);
    }

    toString(): string {
        return this.expr.toString() + "+";
    }

    /**
     * Convert the expression into a NFA.
     */
    build(): Automaton<E> {
        const auto = new Automaton<E>(this);

        const sub = this.expr.build();

        // run it again
        sub.end.connect(sub.start);

        // attach the sub automaton
        auto.start.connect(sub.start);
        sub.end.connect(auto.end);

        return auto;
    }

    minMatchingLength(): number {
        return 1;
    }
}

/**
 * Zero or one of the enclosed expression.
 *     {@code <foo>?}
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class Option<E> implements Expression<E> {
    expr: Expression<E>;

    constructor(expr: Expression<E>) {
        this.expr = expr;
    }

    apply(entity: E): boolean {
        return this.expr.apply(entity);
    }

    toString(): string {
        return this.expr.toString() + "?";
    }

    /**
     * Convert the expression into a NFA.
     */
    build(): Automaton<E> {
        const auto = new Automaton<E>(this);

        const sub = this.expr.build();

        // attach the sub automaton
        auto.start.connect(sub.start);
        sub.end.connect(auto.end);

        // skip it completely
        auto.start.connect(auto.end);

        return auto;
    }

    minMatchingLength(): number {
        return 0;
    }
}

/**
 * A minimum to maximum number of occurrences of the enclosed expression.
 *     {@code <foo>{1,3}}
 * @author Daniel Naber
 *
 * @param <E>
 */
export class MinMax<E> implements Expression<E> {
    expr: Expression<E>;
    readonly minOccurrences: number;
    readonly maxOccurrences: number;

    /**
     * @param minOccurrences minimum occurrences, must be >= 0
     * @param maxOccurrences maximum occurrences, must be >= 1 - you should prefer small values,
     *                       as the use of large values will create a large automaton that takes a lot of memory
     */
    constructor(expr: Expression<E>, minOccurrences: number, maxOccurrences: number) {
        this.expr = expr;
        if (minOccurrences < 0 || maxOccurrences < 1) {
            throw IllegalArgumentException("minOccurrences must be >= 0 and maxOccurrences must be >= 1: "
                    + minOccurrences + ", " + maxOccurrences);
        }
        if (minOccurrences > maxOccurrences) {
            throw IllegalArgumentException("minOccurrences must be <= maxOccurrences: "
                    + minOccurrences + " > " + maxOccurrences);
        }
        this.minOccurrences = minOccurrences;
        this.maxOccurrences = maxOccurrences;
    }

    apply(entity: E): boolean {
        return this.expr.apply(entity);
    }

    toString(): string {
        return this.expr.toString() + "{" + this.minOccurrences + "," + this.maxOccurrences + "}";
    }

    /**
     * Convert the expression into a NFA.
     */
    build(): Automaton<E> {
        const auto = new Automaton<E>(this);

        const subAutos: Automaton<E>[] = [];
        const numberOfNodes = this.maxOccurrences;
        for (let i = 0; i < numberOfNodes; i++) {
            const sub = this.expr.build();
            subAutos.push(sub);
        }

        // attach the first sub automaton
        auto.start.connect(subAutos[0]!.start);

        // attach the sub automatons among themselves and with the end
        for (let i = 0; i < subAutos.length; i++) {
            const sub = subAutos[i]!;
            if (i >= this.minOccurrences - 1) {
                sub.end.connect(auto.end);
            }
            if (i < subAutos.length - 1) {
                const nextSub = subAutos[i + 1]!;
                sub.end.connect(nextSub.start);
            }
        }

        if (this.minOccurrences === 0) {
            // skip it completely
            auto.start.connect(auto.end);
        }

        return auto;
    }

    minMatchingLength(): number {
        return this.minOccurrences;
    }
}

/**
 * An expression with no subexpression that is evaluated against a token
 * using the supplied delegate.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export abstract class BaseExpression<E> implements Expression<E> {
    readonly source: string;

    constructor(source: string) {
        this.source = source;
    }

    /**
     * The delegate to evaluate the expression against a token.
     */
    abstract apply(entity: E): boolean;

    toString(): string {
        return "<" + this.source + ">";
    }

    /**
     * Convert the expression into a NFA.
     */
    build(): Automaton<E> {
        const auto = new Automaton<E>(this);

        auto.start.connect(auto.end, this);

        return auto;
    }

    minMatchingLength(): number {
        return 1;
    }
}

/**
 * A non-consuming expression that matches a token against a property of
 * the text, such as the start or end of a line.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export abstract class AssertionExpression<E> implements Expression<E> {
    /**
     * apply(E entity): false. With hasStart, tokens and count: the assertion
     * (abstract in Java; the subclasses answer it).
     */
    apply(_entity: E | boolean, _tokens?: E[], _count?: number): boolean {
        return false;
    }

    /**
     * Convert the expression into a NFA.
     */
    build(): Automaton<E> {
        const auto = new Automaton<E>(this);

        auto.start.connect(auto.end, this);

        return auto;
    }

    minMatchingLength(): number {
        return 0;
    }

    abstract toString(): string;
}

/**
 * A non-consuming expression that matches the start of a line.
 *     {@code ^<foo>}
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class StartAssertion<E> extends AssertionExpression<E> {
    override apply(hasStart: E | boolean, tokens?: E[], count?: number): boolean {
        if (tokens === undefined) {
            return super.apply(hasStart);
        }
        return hasStart === true && tokens.length === count;
    }

    override toString(): string {
        return "^";
    }
}

/**
 * A non-consuming expression that matches the end of a line.
 *     {@code <foo>$}
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class EndAssertion<E> extends AssertionExpression<E> {
    override apply(hasStart: E | boolean, tokens?: E[], count?: number): boolean {
        if (tokens === undefined) {
            return super.apply(hasStart);
        }
        return tokens.length === 0;
    }

    override toString(): string {
        return "$";
    }
}
