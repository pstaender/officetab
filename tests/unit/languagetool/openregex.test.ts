// OpenRegex 1.1.1 (src/languagetool/openregex/): its own unit tests (MinMaxTest.java and the
// Scala specs LogicTest, RegularExpressionAssertionTest, ...NamedGroupTest, ...PermutationTest,
// ...UnnamedGroupTest), ported with their expectations; ScalaCheck's random booleans are all
// combinations here.
import { describe, expect, it } from 'vitest';
import { LogicExpressionParsers } from '../../../src/languagetool/openregex/edu/washington/cs/knowitall/logic/LogicExpressionParsers.ts';
import { LogicExpression } from '../../../src/languagetool/openregex/edu/washington/cs/knowitall/logic/LogicExpression.ts';
import { Pred } from '../../../src/languagetool/openregex/edu/washington/cs/knowitall/logic/Expression.ts';
import {
  BaseExpression, type Expression, MinMax, Option, Plus, Star,
} from '../../../src/languagetool/openregex/edu/washington/cs/knowitall/regex/Expression.ts';
import { ExpressionFactory } from '../../../src/languagetool/openregex/edu/washington/cs/knowitall/regex/ExpressionFactory.ts';
import { RegularExpression } from '../../../src/languagetool/openregex/edu/washington/cs/knowitall/regex/RegularExpression.ts';
import { RegularExpressionParsers } from '../../../src/languagetool/openregex/edu/washington/cs/knowitall/regex/RegularExpressionParsers.ts';

const words = (s: string): string[] => s.split(' ');

describe('openregex MinMaxTest', () => {
  function getAbcRegex(min: number, max: number): RegularExpression<string> {
    const wordA = RegularExpressionParsers.word.parse('<a>').expressions[0]!;
    const wordB = RegularExpressionParsers.word.parse('<b>').expressions[0]!;
    const wordC = RegularExpressionParsers.word.parse('<c>').expressions[0]!;
    return RegularExpression.compile([wordA, new MinMax<string>(wordB, min, max), wordC]);
  }
  const assertMatch = (regex: RegularExpression<string>, ...input: string[]) => expect(regex.find(input)).not.toBeNull();
  const assertNoMatch = (regex: RegularExpression<string>, ...input: string[]) => expect(regex.find(input)).toBeNull();

  it('testMinMax', () => {
    const regExZeroToOne = getAbcRegex(0, 1);
    assertMatch(regExZeroToOne, 'a', 'c');
    assertMatch(regExZeroToOne, 'a', 'b', 'c');
    assertNoMatch(regExZeroToOne, 'a', 'b', 'b', 'c');

    const regExOne = getAbcRegex(1, 1);
    assertNoMatch(regExOne, 'a', 'c');
    assertMatch(regExOne, 'a', 'b', 'c');
    assertNoMatch(regExOne, 'a', 'b', 'b', 'c');

    const regExTwo = getAbcRegex(2, 2);
    assertNoMatch(regExTwo, 'a', 'c');
    assertNoMatch(regExTwo, 'a', 'b', 'c');
    assertMatch(regExTwo, 'a', 'b', 'b', 'c');
    assertNoMatch(regExTwo, 'a', 'b', 'b', 'b', 'c');

    const regExOneToTwo = getAbcRegex(1, 2);
    assertNoMatch(regExOneToTwo, 'a', 'c');
    assertMatch(regExOneToTwo, 'a', 'b', 'c');
    assertMatch(regExOneToTwo, 'a', 'b', 'b', 'c');
    assertNoMatch(regExOneToTwo, 'a', 'b', 'b', 'b', 'c');

    const regExTwoToFour = getAbcRegex(2, 4);
    assertNoMatch(regExTwoToFour, 'a', 'c');
    assertNoMatch(regExTwoToFour, 'a', 'b', 'c');
    assertMatch(regExTwoToFour, 'a', 'b', 'b', 'c');
    assertMatch(regExTwoToFour, 'a', 'b', 'b', 'b', 'c');
    assertMatch(regExTwoToFour, 'a', 'b', 'b', 'b', 'b', 'c');
    assertNoMatch(regExTwoToFour, 'a', 'b', 'b', 'b', 'b', 'b', 'c');
  });

  it('testException1-4: IllegalArgumentException', () => {
    for (const [min, max] of [[0, 0], [1, 0], [-1, 0], [0, -1]] as const) {
      expect(() => getAbcRegex(min, max)).toThrow(/^IllegalArgumentException/);
    }
  });
});

describe('openregex LogicTest', () => {
  const compile = (logic: string): LogicExpression<string> => LogicExpressionParsers.trivial.parse(logic);
  const compileStringMatch = (logic: string): LogicExpression<string> => LogicExpressionParsers.stringMatch.parse(logic);
  function substitute(expr: string, ...varargs: boolean[]): string {
    return varargs.reduce((e, arg, i) => e.replaceAll(String.fromCharCode(97 + i), String(arg)), expr);
  }
  function* combinations(n: number): Generator<boolean[]> {
    for (let bits = 0; bits < 1 << n; bits++) yield Array.from({ length: n }, (_, i) => (bits & (1 << i)) !== 0);
  }

  it('escape characters: tokenize ok', () => {
    const regex = compileStringMatch('"zebra" | "zeb\\"ra"');
    // note: escape characters are tokenized by not interpreted
    expect(regex.apply('zeb\\"ra')).toBe(true);
  });

  it('order of operations: infer the correct parenthesis', () => {
    expect(compile('false & false & false').toString()).toBe('(false & (false & false))');
    expect(compile('false & false | false').toString()).toBe('((false & false) | false)');
    expect(compile('false | false & false').toString()).toBe('(false | (false & false))');
  });

  const cases: [string, (...v: boolean[]) => boolean][] = [
    ['a | b', (a, b) => a! || b!],
    ['a & b', (a, b) => a! && b!],
    ['(a | (b & c))', (a, b, c) => a! || (b! && c!)],
    ['(a & (b & c))', (a, b, c) => a! && (b! && c!)],
    ['(a & (b | c))', (a, b, c) => a! && (b! || c!)],
    ['(a | (b | c))', (a, b, c) => a! || (b! || c!)],
    ['(a | (b & c & d))', (a, b, c, d) => a! || (b! && c! && d!)],
    ['(a | (b & c | d))', (a, b, c, d) => a! || ((b! && c!) || d!)],
    ['(a | (b | c & d))', (a, b, c, d) => a! || (b! || (c! && d!))],
    ['(a | (b | c | d))', (a, b, c, d) => a! || (b! || c! || d!)],
    ['(a & (b & c & d))', (a, b, c, d) => a! && (b! && c! && d!)],
    ['(a & (b & c | d))', (a, b, c, d) => a! && ((b! && c!) || d!)],
    ['(a & (b | c & d))', (a, b, c, d) => a! && (b! || (c! && d!))],
    ['(a & (b | c | d))', (a, b, c, d) => a! && (b! || c! || d!)],
    ['((a | b) & (c | d))', (a, b, c, d) => (a! || b!) && (c! || d!)],
    ['((a & b) | (c & d))', (a, b, c, d) => (a! && b!) || (c! && d!)],
    ['(!(a | b) & (c | d))', (a, b, c, d) => !(a! || b!) && (c! || d!)],
    ['((a | b) & !(c | d))', (a, b, c, d) => (a! || b!) && !(c! || d!)],
    ['(!((a | b) & !(c | d)))', (a, b, c, d) => !((a! || b!) && !(c! || d!))],
  ];
  for (const [expr, f] of cases) {
    it(`evaluate (${expr}) correctly`, () => {
      const n = new Set(expr.match(/[a-d]/g)).size;
      for (const v of combinations(n)) {
        expect(compile(substitute(expr, ...v)).apply(null as unknown as string), `${expr} ${v}`).toBe(f(...v));
      }
    });
  }

  it('getArgs, compile with a factory delegate and errors', () => {
    const expr = LogicExpression.compile<string>("'x' & !(y | 'z')", (s) => new (class extends Pred<string> {
      override apply(e: string): boolean { return e.includes(s.replace(/'/g, '')); }
    })(s));
    expect(expr.getArgs()).toEqual(["'x'"]); // getArgs does not descend into Not
    expect(expr.apply('x')).toBe(true);
    expect(expr.apply('xy')).toBe(false);
    expect(() => compile('(true')).toThrow('Unbalanced parentheses.');
    expect(() => compile('true)')).toThrow(expect.objectContaining({ name: 'EmptyStackException' }));
    expect(() => compile('true &')).toThrow('No argument for operator (stack empty): &');
  });
});

describe('openregex RegularExpressionAssertionTest', () => {
  const regexTokens = ['^', '<is>', '<a>', '$'];
  const matchTokens = ['this', 'is', 'a', 'test'];
  const tail = <T>(l: T[]) => l.slice(1);
  const init = <T>(l: T[]) => l.slice(0, -1);
  const regex = RegularExpressionParsers.word.parse(init(tail(regexTokens)).join(' '));
  const regexEnd = RegularExpressionParsers.word.parse(tail(regexTokens).join(' '));
  const regexStart = RegularExpressionParsers.word.parse(init(regexTokens).join(' '));
  const regexBoth = RegularExpressionParsers.word.parse(regexTokens.join(' '));

  it('evaluates assertions', () => {
    expect(regex.toString()).toBe('<is> <a>');
    expect(regexBoth.toString()).toBe('^ <is> <a> $');
    expect(regex.apply(matchTokens)).toBe(true);
    expect(regex.apply(tail(matchTokens))).toBe(true);
    expect(regex.apply(init(matchTokens))).toBe(true);

    expect(regexEnd.apply(matchTokens)).toBe(false);
    expect(regexEnd.apply(tail(matchTokens))).toBe(false);
    expect(regexEnd.apply(init(matchTokens))).toBe(true);

    expect(regexStart.apply(matchTokens)).toBe(false);
    expect(regexStart.apply(tail(matchTokens))).toBe(true);
    expect(regexStart.apply(init(matchTokens))).toBe(false);

    expect(regexBoth.matches(['is', 'a'])).toBe(true);
    expect(regexBoth.apply(matchTokens)).toBe(false);
    expect(regexBoth.apply(tail(matchTokens))).toBe(false);
    expect(regexBoth.apply(init(matchTokens))).toBe(false);
  });
});

describe('openregex RegularExpressionNamedGroupTest', () => {
  const regex = RegularExpressionParsers.word.parse("(<subject>: <I> | (?: <The> (<subjadj>: <crazy>)? <Mariners>)) <know> <all> <of> (<poss>: <her> | (?: <the> (<possadj>: <dirty>?) <King> <'s>)) <secrets>");

  it('matches', () => {
    for (const m of ['I know all of her secrets',
      'The Mariners know all of her secrets',
      "The Mariners know all of the dirty King 's secrets",
      "The Mariners know all of the King 's secrets",
      "The crazy Mariners know all of the King 's secrets"]) {
      expect(regex.apply(words(m)), m).toBe(true);
    }
  });

  it('yields the correct groups', () => {
    let m = regex.find(words("The crazy Mariners know all of the King 's secrets"))!;
    expect(m.groups().length).toBe(5);

    expect(m.group('subject')!.text()).toBe('The crazy Mariners');
    expect(m.group('subject')!.startIndex()).toBe(0);
    expect(m.group('subject')!.endIndex()).toBe(2);

    expect(m.group('subjadj')!.text()).toBe('crazy');
    expect(m.group('subjadj')!.startIndex()).toBe(1);
    expect(m.group('subjadj')!.endIndex()).toBe(1);

    expect(m.group('poss')!.text()).toBe("the King 's");
    expect(m.group('poss')!.startIndex()).toBe(6);
    expect(m.group('poss')!.endIndex()).toBe(8);

    expect(m.group('possadj')!.text()).toBe('');
    expect(m.group('possadj')!.startIndex()).toBe(-1);
    expect(m.group('possadj')!.endIndex()).toBe(-1);

    m = regex.find(words('The Mariners know all of her secrets'))!;
    expect(m.groups().length).toBe(3);

    expect(m.group('subject')!.text()).toBe('The Mariners');
    expect(m.group('subject')!.startIndex()).toBe(0);
    expect(m.group('subject')!.endIndex()).toBe(1);

    expect(m.group('poss')!.text()).toBe('her');
    expect(m.group('poss')!.startIndex()).toBe(5);
    expect(m.group('poss')!.endIndex()).toBe(5);
  });
});

describe('openregex RegularExpressionPermutationTest', () => {
  interface TestCase { tokens: string[]; value: boolean }
  const extend = (t: TestCase, test: TestCase): TestCase => ({ tokens: [...t.tokens, ...test.tokens], value: t.value && test.value });

  function cases(regex: RegularExpression<string>): TestCase[] {
    function makeNext(expr: Expression<string>): [string[][], string[][]] {
      if (expr instanceof Star) {
        const source = (expr.expr as BaseExpression<string>).source;
        return [[], [[], [source], [source, source]]];
      } else if (expr instanceof Plus) {
        const source = (expr.expr as BaseExpression<string>).source;
        return [[[]], [[source], [source, source]]];
      } else if (expr instanceof Option) {
        const source = (expr.expr as BaseExpression<string>).source;
        return [[[source, source]], [[], [source]]];
      } else if (expr instanceof BaseExpression) {
        const source = expr.source;
        return [[[], [source, source]], [[source]]];
      }
      return [[], []];
    }
    function makeNextCase(expr: Expression<string>): TestCase[] {
      const [falses, trues] = makeNext(expr);
      return [...falses.map((tokens) => ({ tokens, value: false })), ...trues.map((tokens) => ({ tokens, value: true }))];
    }
    function combine(tests: TestCase[], nexts: TestCase[]): TestCase[] {
      if (nexts.length === 0) return tests;
      return tests.flatMap((test) => nexts.map((next) => extend(test, next)));
    }
    function rec(exprs: Expression<string>[]): TestCase[] {
      if (exprs.length === 0) return [];
      return combine(makeNextCase(exprs[0]!), rec(exprs.slice(1)));
    }
    // SortedSet: distinct by (tokens, value)
    const set = new Map<string, TestCase>();
    for (const t of rec(regex.expressions)) set.set(`${t.tokens.join(' ')}|${t.value}`, t);
    return [...set.values()];
  }
  function permutations<T>(l: T[]): T[][] {
    if (l.length <= 1) return [l];
    return l.flatMap((x, i) => permutations([...l.slice(0, i), ...l.slice(i + 1)]).map((p) => [x, ...p]));
  }

  for (const permutation of permutations(['<this>+', '<is>*', '<a>?', '<test>'])) {
    it(`'${permutation.join(' ')}' matches sentences correctly`, () => {
      const regex = RegularExpressionParsers.word.parse(permutation.join(' '));
      for (const test of cases(regex)) {
        expect(regex.matches(test.tokens), `'${test.tokens.join(' ')}'`).toBe(test.value);
      }
    });
  }
});

describe('openregex RegularExpressionTest (unnamed groups)', () => {
  const regex = RegularExpressionParsers.word.parse('<this> <is> (((?:(?: <a> <very>+) | <an>) <amazing>? <new>{1,3}) | (?: <a> <many>* <centuries> <old>)) <test>');

  it('matches', () => {
    expect(regex.apply(words('this is a very very very amazing new test'))).toBe(true);
    expect(regex.apply(words('this is a very new test'))).toBe(true);
    expect(regex.apply(words('this is an amazing new test'))).toBe(true);
    expect(regex.apply(words('this is a centuries old test'))).toBe(true);
    expect(regex.apply(words('this is a many many centuries old test'))).toBe(true);
    expect(regex.apply(words('this is a very new test'))).toBe(true);
    expect(regex.apply(words('this is a very new new test'))).toBe(true);
    expect(regex.apply(words('this is a very new new new test'))).toBe(true);
    expect(regex.apply(words('this is a very new new new new test'))).toBe(false);
  });

  it('does not match', () => {
    expect(regex.apply(words('this is a amazing new test'))).toBe(false);
  });

  it('yields the correct groups', () => {
    let m = regex.find(words('this is a very very very amazing new test'))!;
    expect(m.groups().length).toBe(3);
    expect(m.groups()[1]!.text()).toBe('a very very very amazing new');
    expect(m.groups()[2]!.text()).toBe('a very very very amazing new');

    m = regex.find(words('this is a centuries old test'))!;
    expect(m.groups().length).toBe(2);
    expect(m.groups()[1]!.text()).toBe('a centuries old');
  });
});

describe('openregex as LanguageTool uses it (RegularExpression.compile with an ExpressionFactory, findAll)', () => {
  // TokenExpressionFactory's shape: a factory whose expressions are logic expressions over tokens.
  class WordFactory extends ExpressionFactory<string> {
    override create(expr: string): BaseExpression<string> {
      const logicExpression = LogicExpression.compile<string>(expr, (input) => new (class extends Pred<string> {
        override apply(token: string): boolean {
          return input.startsWith('regex=') ? new RegExp(`^(?:${input.substring(6)})$`).test(token) : token === input;
        }
      })(input));
      return new (class extends BaseExpression<string> {
        override apply(token: string): boolean { return logicExpression.apply(token); }
      })(expr);
    }
  }

  it('finds all non-overlapping matches', () => {
    const regex = RegularExpression.compile<string>('<der|die|das> <regex=[a-z]+>* <regex=[A-Z][a-z]+>', new WordFactory());
    expect(regex.toString()).toBe('<der|die|das> <regex=[a-z]+>* <regex=[A-Z][a-z]+>');
    const tokens = words('der kleine Hund und die gute alte Katze das Ende');
    const matches = regex.findAll(tokens);
    expect(matches.map((m) => [m.startIndex(), m.endIndex()])).toEqual([[0, 3], [4, 8], [8, 10]]);
    expect(matches[1]!.toString()).toBe("[(<der|die|das> <regex=[a-z]+>* <regex=[A-Z][a-z]+>):'die gute alte Katze', <der|die|das>:'die', <regex=[a-z]+>*:'gute alte', <regex=[a-z]+>:'gute', <regex=[a-z]+>:'alte', <regex=[A-Z][a-z]+>:'Katze']");
    expect(RegularExpression.compile<string>('<foo> <bar>', new WordFactory()).equals(RegularExpression.compile<string>('<foo>   <bar>', new WordFactory()))).toBe(true);
  });
});
