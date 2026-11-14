// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/regex/RegexException.java faithful
// The constructor overloads are one constructor with an optional cause; the nested
// TokenizationRegexException is exported under its simple name.

/**
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 */
export class RegexException extends Error {
    constructor(message: string, e?: unknown) {
        super(message, e === undefined ? undefined : { cause: e });
        this.name = "RegexException";
    }
}

export class TokenizationRegexException extends RegexException {
    constructor(message: string, e?: unknown) {
        super(message, e);
        this.name = "TokenizationRegexException";
    }
}
