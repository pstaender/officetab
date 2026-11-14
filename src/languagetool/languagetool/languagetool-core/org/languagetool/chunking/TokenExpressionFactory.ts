// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/chunking/TokenExpressionFactory.java faithful
import { LogicExpression } from '../../../../../openregex/edu/washington/cs/knowitall/logic/LogicExpression.ts';
import { BaseExpression } from '../../../../../openregex/edu/washington/cs/knowitall/regex/Expression.ts';
import { ExpressionFactory } from '../../../../../openregex/edu/washington/cs/knowitall/regex/ExpressionFactory.ts';
import type { ChunkTaggedToken } from './ChunkTaggedToken.ts';
import { TokenPredicate } from './TokenPredicate.ts';

/**
 * @since 2.9
 */
export class TokenExpressionFactory extends ExpressionFactory<ChunkTaggedToken> {

  private readonly caseSensitive: boolean;

  /**
   * @param caseSensitive whether word tokens should be compared case-sensitively - also used for regular expressions
   */
  constructor(caseSensitive: boolean) {
    super();
    this.caseSensitive = caseSensitive;
  }

  override create(expr: string): BaseExpression<ChunkTaggedToken> {
    const logicExpression = LogicExpression.compile<ChunkTaggedToken>(expr, (input) => new TokenPredicate(input, this.caseSensitive));
    return new (class extends BaseExpression<ChunkTaggedToken> {
      override apply(token: ChunkTaggedToken): boolean {
        return logicExpression.apply(token);
      }
    })(expr);
  }

}
