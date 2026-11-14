// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/dictionary/serializer/EntryInserter.java faithful
import type { Entry } from './Entry.ts';

export interface EntryInserter {
  insert(entry: Entry): void;
}
