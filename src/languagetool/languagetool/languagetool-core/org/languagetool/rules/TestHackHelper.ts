// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/TestHackHelper.java reduced
// Java looks for JUnit (or PatternRuleTest) on the current thread's stack trace; a JavaScript stack
// does not tell that reliably, so tests switch the flag on with setJUnitTest(true) (the date
// filters then assume the year 2014 and January, as the <example>s of the rule files expect).

let junitTest = false;

export class TestHackHelper {

  private constructor() {
  }

  static isJUnitTest(): boolean {
    return junitTest;
  }

  /** Not in Java: stands in for the stack trace inspection (see the header). */
  static setJUnitTest(isJUnitTest: boolean): void {
    junitTest = isJUnitTest;
  }
}
