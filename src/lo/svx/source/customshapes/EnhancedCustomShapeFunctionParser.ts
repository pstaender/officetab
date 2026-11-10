// SPDX-License-Identifier: MPL-2.0
// @upstream svx/source/customshapes/EnhancedCustomShapeFunctionParser.cxx reduced
// The custom shape equation grammar (additive, multiplicative and unary expressions, constants,
// identifiers, functions, ?equation and $adjustment references) as a recursive descent parser
// instead of a Boost.Spirit grammar. The expression nodes only evaluate: fillNode (converting an
// expression back to an EnhancedCustomShapeEquation for binary export) is not ported.

/** EnhancedCustomShape::ExpressionFunct, the enumerations an identifier stands for. */
export type ExpressionFunct =
  | 'EnumPi' | 'EnumLeft' | 'EnumTop' | 'EnumRight' | 'EnumBottom' | 'EnumXStretch' | 'EnumYStretch'
  | 'EnumHasStroke' | 'EnumHasFill' | 'EnumWidth' | 'EnumHeight' | 'EnumLogWidth' | 'EnumLogHeight';

/** What the expressions read from their shape (EnhancedCustomShape2d). */
export interface CustomShapeContext {
  GetEnumFunc(eFunc: ExpressionFunct): number;
  GetAdjustValueAsDouble(nIndex: number): number;
  GetEquationValueAsDouble(nIndex: number): number;
}

export class ParseError extends Error {}

/** ExpressionNode: evaluates to a number. */
export type ExpressionNode = () => number;

const IDENTIFIERS: [string, ExpressionFunct][] = [
  ['pi', 'EnumPi'], ['left', 'EnumLeft'], ['top', 'EnumTop'], ['right', 'EnumRight'], ['bottom', 'EnumBottom'],
  ['xstretch', 'EnumXStretch'], ['ystretch', 'EnumYStretch'], ['hasstroke', 'EnumHasStroke'], ['hasfill', 'EnumHasFill'],
  ['width', 'EnumWidth'], ['height', 'EnumHeight'], ['logwidth', 'EnumLogWidth'], ['logheight', 'EnumLogHeight'],
];
const UNARY: Record<string, (x: number) => number> = { abs: Math.abs, sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan };
const BINARY: Record<string, (a: number, b: number) => number> = { min: Math.min, max: Math.max, atan2: Math.atan2 };

/** FunctionParser::parseFunction */
export function parseFunction(rFunction: string, rCustoShape: CustomShapeContext): ExpressionNode {
  const s = rFunction;
  let i = 0;
  const skip = () => { while (i < s.length && /\s/.test(s[i]!)) i++; };
  const peek = (t: string) => { skip(); return s.startsWith(t, i); };
  const expect = (t: string) => { if (!peek(t)) throw new ParseError(`expected "${t}" in "${s}"`); i += t.length; };
  // Tries a rule and backtracks when it fails, as Spirit alternatives do.
  const attempt = <T>(f: () => T): T | undefined => { const at = i; try { return f(); } catch (e) { if (!(e instanceof ParseError)) throw e; i = at; return undefined; } };

  const basicExpression = (): ExpressionNode => {
    skip();
    // real_parser with custom_real_parser_policies: unsigned, optional fraction and exponent.
    const num = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i));
    if (num) { i += num[0].length; const v = parseFloat(num[0]); return () => v; }
    for (const [name, eFunc] of IDENTIFIERS) {
      // str_p matches the prefix; the longer function names below are tried when the rest fails.
      if (s.startsWith(name, i) && !/[a-z0-9(]/i.test(s[i + name.length] ?? '')) { i += name.length; return () => rCustoShape.GetEnumFunc(eFunc); }
    }
    if (s[i] === '?') {
      // functionReference: "?" followed by letters and digits; the index is the leading number.
      const m = /^\?([A-Za-z0-9]+)/.exec(s.slice(i));
      if (!m) throw new ParseError(`bad equation reference in "${s}"`);
      i += m[0].length;
      const nIndex = parseInt(m[1]!, 10) || 0;
      let guard = false;
      // EquationExpression with its loop guard.
      return () => {
        if (guard) throw new ParseError('Loop in Expression');
        guard = true;
        try { return rCustoShape.GetEquationValueAsDouble(nIndex); } finally { guard = false; }
      };
    }
    if (s[i] === '$') {
      const m = /^\$(\d+)/.exec(s.slice(i));
      if (!m) throw new ParseError(`bad modifier reference in "${s}"`);
      i += m[0].length;
      const nIndex = parseInt(m[1]!, 10);
      return () => rCustoShape.GetAdjustValueAsDouble(nIndex);
    }
    for (const [name, f] of Object.entries(UNARY)) {
      const r = attempt(() => { expect(name); expect('('); const a = additiveExpression(); expect(')'); return () => f(a()); });
      if (r) return r;
    }
    for (const [name, f] of Object.entries(BINARY)) {
      const r = attempt(() => { expect(name); expect('('); const a = additiveExpression(); expect(','); const b = additiveExpression(); expect(')'); return () => f(a(), b()); });
      if (r) return r;
    }
    const tern = attempt(() => {
      expect('if'); expect('(');
      const a = additiveExpression(); expect(',');
      const b = additiveExpression(); expect(',');
      const c = additiveExpression(); expect(')');
      // IfExpression
      return () => (a() > 0 ? b() : c());
    });
    if (tern) return tern;
    if (peek('(')) { i++; const e = additiveExpression(); expect(')'); return e; }
    throw new ParseError(`unexpected "${s.slice(i)}" in "${s}"`);
  };
  const unaryExpression = (): ExpressionNode => {
    if (peek('-')) { i++; const a = basicExpression(); return () => -a(); }
    return basicExpression();
  };
  const multiplicativeExpression = (): ExpressionNode => {
    let a = unaryExpression();
    for (;;) {
      if (peek('*')) { i++; const l = a, r = unaryExpression(); a = () => l() * r(); }
      // o3tl::div_allow_zero: division by zero gives zero.
      else if (peek('/')) { i++; const l = a, r = unaryExpression(); a = () => { const d = r(); return d === 0 ? 0 : l() / d; }; }
      else return a;
    }
  };
  function additiveExpression(): ExpressionNode {
    let a = multiplicativeExpression();
    for (;;) {
      if (peek('+')) { i++; const l = a, r = multiplicativeExpression(); a = () => l() + r(); }
      else if (peek('-')) { i++; const l = a, r = multiplicativeExpression(); a = () => l() - r(); }
      else return a;
    }
  }

  const node = additiveExpression();
  skip();
  if (i !== s.length) throw new ParseError(`EnhancedCustomShapeFunctionParser::parseFunction(): string not fully parseable: "${s}"`);
  return node;
}
