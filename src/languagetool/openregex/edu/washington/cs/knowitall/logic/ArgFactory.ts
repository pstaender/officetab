// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/logic/ArgFactory.java faithful
import type { Function } from '../../../../../../jdk/com/google/common/base/Function.ts';
import type { Arg } from './Expression.ts';

/**
 * An abstract factory class that converts the string representation of
 * an argument into a token.  This token uses the supplied delegate to
 * evaluate the expression against an entity into a boolean.
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export abstract class ArgFactory<E> implements Function<string, Arg<E>> {
    /***
     * Converts the supplied string into a token.
     */
    abstract create(string: string): Arg<E>;

    /***
     * Method to satisfy abstract superclass.
     */
    apply(string: string): Arg<E> {
        return this.create(string);
    }
}
