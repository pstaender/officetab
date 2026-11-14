// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/logic/LogicException.java faithful
// The constructor overloads (message) and (message, Exception) are one constructor with an
// optional cause; the nested exceptions are exported under their simple names.

/**
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 */
export class LogicException extends Error {
    constructor(message: string, e?: unknown) {
        super(message, e === undefined ? undefined : { cause: e });
        this.name = "LogicException";
    }
}

/**
 * Exception while applying an expression to an object.
 */
export class ApplyLogicException extends LogicException {
    constructor(message: string, e?: unknown) {
        super(message, e);
        this.name = "ApplyLogicException";
    }
}

/**
 * Exception while converting the tokens into a valid expression.
 */
export class CompileLogicException extends LogicException {
    constructor(message: string, e?: unknown) {
        super(message, e);
        this.name = "CompileLogicException";
    }
}

/**
 * Exception while tokenizing the logic expression string.
 */
export class TokenizeLogicException extends LogicException {
    constructor(message: string, e?: unknown) {
        super(message, e);
        this.name = "TokenizeLogicException";
    }
}
