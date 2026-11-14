// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/chunker/DefaultChunkerContextGenerator.java faithful
// The three getContext overloads are one method: a TokenTag[] sequence, or tokens and tags
// (with or without additionalContext).
import { TokenTag } from '../util/TokenTag.ts';
import type { ChunkerContextGenerator } from './ChunkerContextGenerator.ts';

/** Features based on chunking model described in Fei Sha and Fernando Pereira. Shallow
 *  parsing with conditional random fields. In Proceedings of HLT-NAACL 2003. Association
 *  for Computational Linguistics, 2003.
 */
export class DefaultChunkerContextGenerator implements ChunkerContextGenerator {
  getContext(index: number, sequence: TokenTag[], priorDecisions: string[], additionalContext: unknown[] | null): string[];
  getContext(i: number, toks: string[], tags: string[], preds: string[], additionalContext?: unknown[] | null): string[];
  getContext(i: number, toksOrSequence: string[] | TokenTag[], tagsOrPreds: string[], predsOrAdditional: string[] | unknown[] | null,
      _additionalContext?: unknown[] | null): string[] {
    if (toksOrSequence.length > 0 && toksOrSequence[0] instanceof TokenTag) {
      const sequence = toksOrSequence as TokenTag[];
      const token = TokenTag.extractTokens(sequence);
      const tags = TokenTag.extractTags(sequence);
      return this.getContext(i, token, tags, tagsOrPreds, predsOrAdditional);
    }
    const toks = toksOrSequence as string[];
    const tags = tagsOrPreds;
    const preds = predsOrAdditional as string[];

    // Words in a 5-word window
    let w_2: string, w_1: string, w0: string, w1: string, w2: string;

    // Tags in a 5-word window
    let t_2: string, t_1: string, t0: string, t1: string, t2: string;

    // Previous predictions
    let p_2: string, p_1: string;

    if (i < 2) {
      w_2 = 'w_2=bos';
      t_2 = 't_2=bos';
      p_2 = 'p_2=bos';
    }
    else {
      w_2 = 'w_2=' + toks[i - 2];
      t_2 = 't_2=' + tags[i - 2];
      p_2 = 'p_2' + preds[i - 2];
    }

    if (i < 1) {
      w_1 = 'w_1=bos';
      t_1 = 't_1=bos';
      p_1 = 'p_1=bos';
    }
    else {
      w_1 = 'w_1=' + toks[i - 1];
      t_1 = 't_1=' + tags[i - 1];
      p_1 = 'p_1=' + preds[i - 1];
    }

    w0 = 'w0=' + toks[i];
    t0 = 't0=' + tags[i];

    if (i + 1 >= toks.length) {
      w1 = 'w1=eos';
      t1 = 't1=eos';
    }
    else {
      w1 = 'w1=' + toks[i + 1];
      t1 = 't1=' + tags[i + 1];
    }

    if (i + 2 >= toks.length) {
      w2 = 'w2=eos';
      t2 = 't2=eos';
    }
    else {
      w2 = 'w2=' + toks[i + 2];
      t2 = 't2=' + tags[i + 2];
    }

    const features = [
        //add word features
        w_2,
        w_1,
        w0,
        w1,
        w2,
        w_1 + w0,
        w0 + w1,

        //add tag features
        t_2,
        t_1,
        t0,
        t1,
        t2,
        t_2 + t_1,
        t_1 + t0,
        t0 + t1,
        t1 + t2,
        t_2 + t_1 + t0,
        t_1 + t0 + t1,
        t0 + t1 + t2,

        //add pred tags
        p_2,
        p_1,
        p_2 + p_1,

        //add pred and tag
        p_1 + t_2,
        p_1 + t_1,
        p_1 + t0,
        p_1 + t1,
        p_1 + t2,
        p_1 + t_2 + t_1,
        p_1 + t_1 + t0,
        p_1 + t0 + t1,
        p_1 + t1 + t2,
        p_1 + t_2 + t_1 + t0,
        p_1 + t_1 + t0 + t1,
        p_1 + t0 + t1 + t2,

        //add pred and word
        p_1 + w_2,
        p_1 + w_1,
        p_1 + w0,
        p_1 + w1,
        p_1 + w2,
        p_1 + w_1 + w0,
        p_1 + w0 + w1,
    ];

    return features;
  }
}
