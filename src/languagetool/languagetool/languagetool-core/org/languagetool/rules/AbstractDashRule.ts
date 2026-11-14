// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractDashRule.java faithful
// AhoCorasickDoubleArrayTrie (com.hankcs) is not ported: the class below is a stand-in with the
// API the rule uses (build(map), parseText(text) giving hits with begin, end and value). It finds
// every occurrence of every key and returns the hits in the library's order (by end position;
// for the same end, longer hit first), which is all match() relies on: after reversing, longer
// hits come first for the same start position.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import { JLanguageTool } from '../JLanguageTool.ts';
import { Tag } from '../Tag.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { StringMatches, StringReplaceAll } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Categories } from './Categories.ts';
import { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';

/** AhoCorasickDoubleArrayTrie.Hit */
export class Hit<V> {
  readonly begin: number;
  readonly end: number;
  readonly value: V;
  constructor(begin: number, end: number, value: V) {
    this.begin = begin;
    this.end = end;
    this.value = value;
  }
}

interface TrieNode<V> {
  children: Map<string, TrieNode<V>>;
  value?: V;
  hasValue: boolean;
}

/** Stand-in for com.hankcs.algorithm.AhoCorasickDoubleArrayTrie (see the header). */
export class AhoCorasickDoubleArrayTrie<V> {
  private root: TrieNode<V> = { children: new Map(), hasValue: false };

  build(map: ReadonlyMap<string, V>): void {
    this.root = { children: new Map(), hasValue: false };
    for (const [key, value] of map) {
      let node = this.root;
      for (const c of key) {
        let next = node.children.get(c);
        if (next === undefined) {
          next = { children: new Map(), hasValue: false };
          node.children.set(c, next);
        }
        node = next;
      }
      node.value = value;
      node.hasValue = true;
    }
  }

  parseText(text: string): Hit<V>[] {
    const hits: Hit<V>[] = [];
    for (let begin = 0; begin < text.length; begin++) {
      let node: TrieNode<V> | undefined = this.root;
      let i = begin;
      while (node !== undefined && i < text.length) {
        const cp = text.codePointAt(i)!;
        const c = String.fromCodePoint(cp);
        node = node.children.get(c);
        i += c.length;
        if (node !== undefined && node.hasValue) {
          hits.push(new Hit(begin, i, node.value as V));
        }
      }
    }
    hits.sort((a, b) => a.end - b.end || a.begin - b.begin);
    return hits;
  }
}

/**
 * Another use of the compounds file -- check for compounds written with
 * dashes instead of hyphens (for example, Rabka — Zdrój).
 * @since 3.8
 */
export abstract class AbstractDashRule extends Rule {

  constructor(messages: ResourceBundle) {
    super(messages);
    this.setCategory(Categories.TYPOGRAPHY.getCategory(messages));
    this.setTags([Tag.picky]);
  }

  override getId(): string {
    return 'DASH_RULE';
  }

  abstract override getDescription(): string;

  abstract getMessage(): string;

  protected abstract getCompoundsData(): AhoCorasickDoubleArrayTrie<string>;

  override estimateContextForSureMatch(): number {
    return 2;
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const matches: RuleMatch[] = [];
    const text = sentence.getText();
    const hits = this.getCompoundsData().parseText(text);
    const startPositions = new Set<number>();
    hits.reverse();  // work on longest matches first
    for (const hit of hits) {
      if (startPositions.has(hit.begin)) {
        continue;   // avoid overlapping matches
      }
      if (hit.begin > 0 && !this.isBoundary(text.substring(hit.begin - 1, hit.begin))) {
        // prevent substring matches
        continue;
      }
      if (hit.end < text.length && !this.isBoundary(text.substring(hit.end, hit.end + 1))) {
        // prevent substring matches, e.g. "Foto" for "Photons"
        continue;
      }
      const match = new RuleMatch(this, sentence, hit.begin, hit.end, hit.begin, hit.end,
              this.getMessage(), null, false, false, '');
      const covered = text.substring(hit.begin, hit.end);
      match.setSuggestedReplacement(StringReplaceAll(covered, ' ?[–—] ?', '-'));
      matches.push(match);
      startPositions.add(hit.begin);
    }
    return matches;
  }

  protected isBoundary(s: string): boolean {
    return !StringMatches(s, '[a-zA-Z]');
  }

  protected static loadCompoundFile(path: string): AhoCorasickDoubleArrayTrie<string> {
    const words: string[] = [];
    const lines = JLanguageTool.getDataBroker().getFromResourceDirAsLines(path);
    for (let line of lines) {
      if (line.length === 0 || line.charAt(0) === '#') {
        continue;     // ignore comments
      }
      if (line.endsWith('+') || line.endsWith('?')) {
        continue; // skip non-hyphenated suggestions
      } else if (line.endsWith('*') || line.endsWith('$')) {
        line = AbstractDashRule.removeLastCharacter(line);
      }
      words.push(line);
    }
    const map = new Map<string, string>();
    for (const word of words) {
      const variant1 = word.replaceAll('-', '–');
      map.set(variant1, variant1);
      const variant2 = word.replaceAll('-', '—');
      map.set(variant2, variant2);
      const variant3 = word.replaceAll('-', ' – ');
      map.set(variant3, variant3);
      const variant4 = word.replaceAll('-', ' — ');
      map.set(variant4, variant4);
    }
    const trie = new AhoCorasickDoubleArrayTrie<string>();
    trie.build(map);
    return trie;
  }

  private static removeLastCharacter(str: string): string {
    return str.substring(0, str.length - 1);
  }

}
