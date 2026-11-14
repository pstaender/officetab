// SPDX-License-Identifier: MPL-2.0
// Guava's Function and Predicate (com.google.common.base) as the ports use them: not a port.
// In Java a parameter of these types takes an object implementing apply() or a lambda; here
// FunctionOrLambda accepts both and Function_apply calls either.

/** com.google.common.base.Function */
export interface Function<F, T> {
  apply(input: F): T;
}

/** com.google.common.base.Predicate */
export interface Predicate<T> {
  apply(input: T): boolean;
}

/** A Function argument as Java accepts it: an object with apply(), or a lambda. */
export type FunctionOrLambda<F, T> = Function<F, T> | ((input: F) => T);

/** function.apply(input), for an object or a lambda. */
export function Function_apply<F, T>(f: FunctionOrLambda<F, T>, input: F): T {
  return typeof f === 'function' ? f(input) : f.apply(input);
}
