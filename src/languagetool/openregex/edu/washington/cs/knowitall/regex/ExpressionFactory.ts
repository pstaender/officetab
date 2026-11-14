// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/regex/ExpressionFactory.java faithful
import type { Function } from '../../../../../../jdk/com/google/common/base/Function.ts';
import type { BaseExpression } from './Expression.ts';

/**
 * Wrapper class for a Guava Function.  Used to unpickle a expression string
 * into a part of a logic expression.
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 */
export abstract class ExpressionFactory<E> implements Function<string, BaseExpression<E>> {
    abstract create(token: string): BaseExpression<E>;

    apply(token: string): BaseExpression<E> {
        return this.create(token);
    }
}
