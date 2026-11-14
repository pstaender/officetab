// SPDX-License-Identifier: MPL-2.0
// German's hand-written Java rules (rules/de/*.ts), checked with ports of their upstream unit
// tests. The tests are grouped in germanrules/*.tests.ts and share germanrules/testGerman.ts,
// which must be imported first (it stubs the German rule classes not ported yet).
import './germanrules/testGerman.ts';
import './germanrules/agreement.tests.ts';
import './germanrules/case.tests.ts';
import './germanrules/verb.tests.ts';
import './germanrules/misc.tests.ts';
