// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/logic/Expression.java faithful
// The nested classes are exported under their simple names: Expression.Apply is Apply,
// Expression.Op.Mon.Not is Not, Expression.Arg.Pred is Pred, Expression.Paren.L is L, ...
// The toString(String symbol) overloads of Mon and Bin are toString with an optional symbol.
import type { Predicate } from '../../../../../../jdk/com/google/common/base/Function.ts';

/**
 * Superclass for expressions in a Logic Expression.
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export abstract class Expression<E> {
}

/**
 * An expression that can be applied.
 */
export abstract class Apply<E> extends Expression<E> {
    /**
     * Apply this expression to an entity to get true or false.
     */
    abstract apply(entity: E): boolean;
}

/**
 * An operator expression.
 */
export abstract class Op<E> extends Apply<E> {
    /**
     * @returns  true if this has precedence over that
     */
    preceeds(that: Op<unknown>): boolean {
        return this.precedence() < that.precedence();
    }

    /**
     * The precedence of this operator.  A smaller number denotes higher
     * precedence.
     *
     * @returns  the precedence level of this operator
     */
    abstract precedence(): number;
}

/**
 * An operator that takes a single argument, such as negation.
 */
export abstract class Mon<E> extends Op<E> {
    sub: Apply<E> | null = null;

    override toString(symbol?: string): string {
        if (symbol === undefined) {
            return super.toString();
        }
        if (this.sub == null) {
            return symbol;
        }
        else {
            return symbol + "(" + this.sub.toString() + ")";
        }
    }
}

/**
 * The negation operator.
 */
export class Not<E> extends Mon<E> {
    override toString(): string {
        return super.toString("!");
    }

    override apply(entity: E): boolean {
        return !this.sub!.apply(entity);
    }

    override precedence(): number {
        return 0;
    }
}

/**
 * An operator that takes two arguments, such as disjunction.
 */
export abstract class Bin<E> extends Op<E> {
    left: Apply<E> | null = null;
    right: Apply<E> | null = null;

    override toString(symbol?: string): string {
        if (symbol === undefined) {
            return super.toString();
        }
        if (this.left == null || this.right == null) {
            return symbol;
        }
        else {
            return "(" + this.left.toString() + " " + symbol + " " + this.right.toString() + ")";
        }
    }
}

/**
 * The conjunction (logical and) operator.
 */
export class And<E> extends Bin<E> {
    override toString(): string {
        return super.toString("&");
    }

    override apply(entity: E): boolean {
        return this.left!.apply(entity) && this.right!.apply(entity);
    }

    override precedence(): number {
        return 1;
    }
}

/**
 * The disjunction (logical or) operator.
 */
export class Or<E> extends Bin<E> {
    override toString(): string {
        return super.toString("|");
    }

    override apply(entity: E): boolean {
        return this.left!.apply(entity) || this.right!.apply(entity);
    }

    override precedence(): number {
        return 2;
    }
}

/**
 * An expression that evaluates to true or false.
 */
export abstract class Arg<E> extends Apply<E> implements Predicate<E> {
}

/**
 * An expression that evaluates to true or false by applying a
 * predicate to the supplied entity.
 */
export abstract class Pred<E> extends Arg<E> {
    private description: string;

    constructor(description: string) {
        super();
        this.description = description;
    }

    abstract override apply(entity: E): boolean;

    getDescription(): string {
        return this.description;
    }

    override toString(): string {
        return this.getDescription();
    }
}

/**
 * An expression that is a constant value--either true or false.
 */
export class Value<E> extends Arg<E> {
    private value: boolean;

    constructor(value: boolean) {
        super();
        this.value = value;
    }

    // apply(E entity) returns this.apply(); both overloads return the value.
    override apply(_entity?: E): boolean {
        return this.value;
    }

    override toString(): string {
        return String(this.value);
    }
}

/**
 * A parenthesis, used for grouping.  These are only uses prior to building
 * the AST.
 */
export class Paren<E> extends Expression<E> {
}

/**
 * A left parenthesis.
 */
export class L<E> extends Paren<E> {
    override toString(): string {
        return "(";
    }
}

/**
 * A right parenthesis.
 */
export class R<E> extends Paren<E> {
    override toString(): string {
        return ")";
    }
}
