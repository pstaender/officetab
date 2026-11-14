// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/logic/LogicExpression.java partial
// Left out: main() (an interactive stdin loop). The two compile() overloads are one method
// (a token list, or a string and a factory delegate, which may be an object with apply() or a
// lambda); the public getArgs() and the private getArgs(Apply, List) helper are one method
// with optional parameters. The constructor is public (Java: protected, used by the package's
// LogicExpressionParser). java.util.Stack is an array; its pop() throws EmptyStackException.
import { Function_apply, type FunctionOrLambda, type Predicate } from '../../../../../../jdk/com/google/common/base/Function.ts';
import { Apply, Arg, Bin, Expression, L, Mon, Op, Pred, R } from './Expression.ts';
import { ApplyLogicException, CompileLogicException } from './LogicException.ts';
import { LogicExpressionParser } from './LogicExpressionParser.ts';

class EmptyStackException extends Error {
    constructor() {
        super();
        this.name = "EmptyStackException";
    }
}

/** java.util.Stack.pop() */
function Stack_pop<T>(stack: T[]): T {
    if (stack.length === 0) {
        throw new EmptyStackException();
    }
    return stack.pop()!;
}

/** java.util.Stack.peek() */
function Stack_peek<T>(stack: T[]): T {
    if (stack.length === 0) {
        throw new EmptyStackException();
    }
    return stack[stack.length - 1]!;
}

/** AbstractCollection.toString() */
function Collection_toString(c: readonly unknown[]): string {
    return "[" + c.map((x) => String(x)).join(", ") + "]";
}

/**
 * A logic expression engine that operates over user specified objects.
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param  <E>  the type of the base expressions
 */
export class LogicExpression<E> implements Predicate<E> {
    private readonly expression: Apply<E> | null;

    /***
     *
     * @param input an infix representation of the logic expression.
     * @throws TokenizeLogicException
     * @throws CompileLogicException
     */
    constructor(expressions: Expression<E>[]) {
        // put in reverse polish notation
        const rpn: Expression<E>[] = this.rpn(expressions);

        // compile the expression
        this.expression = LogicExpression.buildAst(rpn);
    }

    /***
     * Compile an infix list of tokens into an expression tree.
     * @param rpn a list of tokens in infix form.
     * @return an expression tree.
     *
     * Helper factory method to instantiate a LogicExpression.
     * @param  input  The string to parse.
     * @param  factoryDelegate  The factory to build tokens.
     * @return  a new LogicExpression
     */
    static compile<E>(input: Expression<E>[] | string,
            factoryDelegate?: FunctionOrLambda<string, Arg<E>>): LogicExpression<E> {
        if (typeof input !== "string") {
            return new LogicExpression<E>(input);
        }
        return new (class extends LogicExpressionParser<E> {
            override factory(argument: string): Arg<E> {
                return Function_apply(factoryDelegate!, argument);
            }
        })().parse(input);
    }

    toString(): string {
        if (this.isEmpty()) {
            return "(empty)";
        }
        else {
            return this.expression!.toString();
        }
    }


    /***
     * If the expression is empty, it returns true for all inputs.
     * @return true iff the expression is empty.
     */
    isEmpty(): boolean {
        return this.expression == null;
    }

    apply(entity: E): boolean {
        if (this.isEmpty()) {
            return true;
        }
        else {
            return this.expression!.apply(entity);
        }
    }

    /***
     * Compile a rpn list of tokens into an expression tree.
     * @param rpn a list of tokens in infix form.
     * @return an expression tree.
     */
    static buildAst<E>(rpn: Expression<E>[]): Apply<E> | null {
        if (rpn.length === 0) {
            return null;
        }

        const stack: Apply<E>[] = [];
        for (const tok of rpn) {
            if (tok instanceof Arg) {
                stack.push(tok as Arg<E>);
            } else if (tok instanceof Op) {
                try {
                    if (tok instanceof Mon){
                       const sub: Apply<E> = Stack_pop(stack);

                        const mon = tok as Mon<E>;

                        mon.sub = sub;

                        stack.push(mon);
                    }
                    if (tok instanceof Bin) {
                        const arg2: Apply<E> = Stack_pop(stack);
                        const arg1: Apply<E> = Stack_pop(stack);

                        const bin = tok as Bin<E>;

                        bin.left = arg1;
                        bin.right = arg2;

                        stack.push(bin);
                    }
                }
                catch (e) {
                    if (!(e instanceof EmptyStackException)) throw e;
                    throw new CompileLogicException(
                            "No argument for operator (stack empty): "
                            + tok.toString());
                }
            }
        }

        if (stack.length > 1) {
            throw new ApplyLogicException(
                    "Stack has multiple elements after apply: " + Collection_toString(stack));
        }

        if (stack.length === 0) {
            throw new ApplyLogicException(
                    "Stack has zero elements after apply.");
        }

        if (!(Stack_peek(stack) instanceof Apply)) {
            throw new ApplyLogicException(
                    "Stack contains non-appliable tokens after apply: " + Collection_toString(stack));
        }

        return (Stack_pop(stack));
    }

    /***
     * Return a list of the arguments contained in the expression.
     * @return
     *
     * (With apply and args: private helper method to recursively find arguments.
     * @param apply the expression tree to search.
     * @param args the resulting list of arguments.)
     */
    getArgs(apply?: Apply<unknown> | null, args?: string[]): string[] {
        if (args === undefined) {
            const args: string[] = [];
            this.getArgs(this.expression, args);

            return args;
        }
        if (apply instanceof Bin) {
            const bin = apply as Bin<unknown>;

            this.getArgs(bin.left, args);
            this.getArgs(bin.right, args);
        }
        else if (apply instanceof Pred) {
            args.push((apply as Pred<unknown>).getDescription());
        }
        return args;
    }

    /***
     * Converts an infix logic representation into a postfix logic representation.
     * @param tokens a list of tokens in infix form.
     * @return a list of tokens in postfix (rpn) form.
     * @throws CompileLogicException
     */
    rpn(tokens: Expression<E>[]): Expression<E>[] {
        // intermediate storage
        const stack: Expression<E>[] = [];

        // final rpn output
        const output: Expression<E>[] = [];

        for (const tok of tokens) {
            if (tok instanceof L) {
                stack.push(tok);
            } else if (tok instanceof R) {
                let top: Expression<E>;
                do {
                    top = Stack_pop(stack);

                    if (!(top instanceof L)) {
                        output.push(top);
                    }

                } while (!(top instanceof L));

            } else if (tok instanceof Mon) {
                stack.push(tok);
            } else if (tok instanceof Bin) {
                // higher precedence
                while (!(stack.length === 0) && Stack_peek(stack) instanceof Op
                        && (Stack_peek(stack) as Op<unknown>).preceeds(tok as Op<unknown>)) {
                    output.push(Stack_pop(stack));
                }

                stack.push(tok);
            } else if (tok instanceof Arg) {
                output.push(tok);
            }
        }

        // empty out items remaining ni the stack
        while (!(stack.length === 0)) {
            const top: Expression<E> = Stack_pop(stack);

            if (top instanceof L || top instanceof R) {
                throw new CompileLogicException("Unbalanced parentheses.");
            }

            output.push(top);
        }

        return output;
    }
}
