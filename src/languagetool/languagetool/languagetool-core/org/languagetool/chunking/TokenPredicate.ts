// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/chunking/TokenPredicate.java faithful
// The package-private class is exported (TypeScript has no packages); java.util.function.Predicate
// is a function.
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { StringMatcher } from '../rules/patterns/StringMatcher.ts';
import { Pred } from '../../../../../openregex/edu/washington/cs/knowitall/logic/Expression.ts';
import { StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';
import type { ChunkTaggedToken } from './ChunkTaggedToken.ts';

export class TokenPredicate extends Pred<ChunkTaggedToken> {
  private readonly predicate: (analyzedToken: ChunkTaggedToken) => boolean;

  constructor(description: string, caseSensitive: boolean) {
    super(description);
    this.predicate = this.compile(description, caseSensitive);
  }

  private compile(description: string, caseSensitive: boolean): (analyzedToken: ChunkTaggedToken) => boolean {
    const parts = StringSplit(description, '=');
    let exprType: string;
    let exprValue: string;
    if (parts.length === 1) {
      exprType = 'string';
      exprValue = TokenPredicate.unquote(parts[0]!);
    } else if (parts.length === 2) {
      exprType = parts[0]!;
      exprValue = TokenPredicate.unquote(parts[1]!);
    } else {
      throw new Error('RuntimeException: Could not parse expression: ' + this.getDescription());
    }

    switch (exprType) {
      case 'string':
      case 'regex':
      case 'regexCS': {
        const matcher = StringMatcher.create(exprValue, !('string' === exprType), caseSensitive || 'regexCS' === exprType);
        return (analyzedToken) => matcher.matches(analyzedToken.getToken());
      }

      case 'chunk': {
        const chunkPattern = StringMatcher.regexp(exprValue);
        return (analyzedToken) => {
          for (const chunkTag of analyzedToken.getChunkTags()) {
            if (chunkPattern.matches(chunkTag.getChunkTag())) {
              return true;
            }
          }
          return false;
        };
      }

      case 'pos':
        return (analyzedToken) => {
          const readings: AnalyzedTokenReadings | null = analyzedToken.getReadings();
          if (readings != null) {
            for (const token of readings) {
              if (token.getPOSTag() != null && token.getPOSTag()!.includes(exprValue)) {
                return true;
              }
            }
          }
          return false;
        };

      case 'posre':
      case 'posregex': {
        const posPattern = StringMatcher.regexp(exprValue);
        return (analyzedToken) => {
          const readings: AnalyzedTokenReadings | null = analyzedToken.getReadings();
          if (readings != null) {
            for (const token of readings) {
              if (token.getPOSTag() != null && posPattern.matches(token.getPOSTag()!)) {
                return true;
              }
            }
          }
          return false;
        };
      }

      default:
        throw new Error("RuntimeException: Expression type not supported: '" + exprType + "'");
    }

  }

  private static unquote(s: string): string {
    return s.startsWith("'") && s.endsWith("'") ? s.substring(1, s.length - 1) : s;
  }

  override apply(analyzedToken: ChunkTaggedToken): boolean {
    return this.predicate(analyzedToken);
  }
}
