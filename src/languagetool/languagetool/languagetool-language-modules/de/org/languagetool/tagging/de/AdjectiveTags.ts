// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/tagging/de/AdjectiveTags.java faithful
// The package-private class is exported (TypeScript has no packages).

export class AdjectiveTags {

  // adjective forms for base form, like "chemisch":
  static readonly tagsForAdj: readonly string[] = Object.freeze([
    'ADJ:PRD:GRU',
  ]);

  // adjective forms ending in -e, like "chemische":
  static readonly tagsForAdjE: readonly string[] = Object.freeze([
    'ADJ:AKK:PLU:FEM:GRU:SOL',
    'ADJ:AKK:PLU:MAS:GRU:SOL',
    'ADJ:AKK:PLU:NEU:GRU:SOL',
    'ADJ:AKK:SIN:FEM:GRU:DEF',
    'ADJ:AKK:SIN:FEM:GRU:IND',
    'ADJ:AKK:SIN:FEM:GRU:SOL',
    'ADJ:AKK:SIN:NEU:GRU:DEF',

    'ADJ:NOM:PLU:FEM:GRU:SOL',
    'ADJ:NOM:PLU:MAS:GRU:SOL',
    'ADJ:NOM:PLU:NEU:GRU:SOL',
    'ADJ:NOM:SIN:FEM:GRU:DEF',
    'ADJ:NOM:SIN:FEM:GRU:IND',
    'ADJ:NOM:SIN:FEM:GRU:SOL',
    'ADJ:NOM:SIN:MAS:GRU:DEF',
    'ADJ:NOM:SIN:NEU:GRU:DEF',
  ]);

  static readonly tagsForAdjEn: readonly string[] = Object.freeze([
    'ADJ:AKK:PLU:FEM:GRU:DEF',
    'ADJ:AKK:PLU:FEM:GRU:IND',
    'ADJ:AKK:PLU:MAS:GRU:DEF',
    'ADJ:AKK:PLU:MAS:GRU:IND',
    'ADJ:AKK:PLU:NEU:GRU:DEF',
    'ADJ:AKK:PLU:NEU:GRU:IND',
    'ADJ:AKK:SIN:MAS:GRU:DEF',
    'ADJ:AKK:SIN:MAS:GRU:IND',
    'ADJ:AKK:SIN:MAS:GRU:SOL',
    'ADJ:DAT:PLU:FEM:GRU:DEF',
    'ADJ:DAT:PLU:FEM:GRU:IND',
    'ADJ:DAT:PLU:FEM:GRU:SOL',
    'ADJ:DAT:PLU:MAS:GRU:DEF',
    'ADJ:DAT:PLU:MAS:GRU:IND',
    'ADJ:DAT:PLU:MAS:GRU:SOL',
    'ADJ:DAT:PLU:NEU:GRU:DEF',
    'ADJ:DAT:PLU:NEU:GRU:IND',
    'ADJ:DAT:PLU:NEU:GRU:SOL',
    'ADJ:DAT:SIN:FEM:GRU:DEF',
    'ADJ:DAT:SIN:FEM:GRU:IND',
    'ADJ:DAT:SIN:MAS:GRU:DEF',
    'ADJ:DAT:SIN:MAS:GRU:IND',
    'ADJ:DAT:SIN:NEU:GRU:DEF',
    'ADJ:DAT:SIN:NEU:GRU:IND',
    'ADJ:GEN:PLU:FEM:GRU:DEF',
    'ADJ:GEN:PLU:FEM:GRU:IND',
    'ADJ:GEN:PLU:MAS:GRU:DEF',
    'ADJ:GEN:PLU:MAS:GRU:IND',
    'ADJ:GEN:PLU:NEU:GRU:DEF',
    'ADJ:GEN:PLU:NEU:GRU:IND',
    'ADJ:GEN:SIN:FEM:GRU:DEF',
    'ADJ:GEN:SIN:FEM:GRU:IND',
    'ADJ:GEN:SIN:MAS:GRU:DEF',
    'ADJ:GEN:SIN:MAS:GRU:IND',
    'ADJ:GEN:SIN:MAS:GRU:SOL',
    'ADJ:GEN:SIN:NEU:GRU:DEF',
    'ADJ:GEN:SIN:NEU:GRU:IND',
    'ADJ:GEN:SIN:NEU:GRU:SOL',
    'ADJ:NOM:PLU:FEM:GRU:DEF',
    'ADJ:NOM:PLU:FEM:GRU:IND',
    'ADJ:NOM:PLU:MAS:GRU:DEF',
    'ADJ:NOM:PLU:MAS:GRU:IND',
    'ADJ:NOM:PLU:NEU:GRU:DEF',
    'ADJ:NOM:PLU:NEU:GRU:IND',
  ]);

  static readonly tagsForAdjEr: readonly string[] = Object.freeze([
    'ADJ:DAT:SIN:FEM:GRU:SOL',
    'ADJ:GEN:PLU:FEM:GRU:SOL',
    'ADJ:GEN:PLU:MAS:GRU:SOL',
    'ADJ:GEN:PLU:NEU:GRU:SOL',
    'ADJ:GEN:SIN:FEM:GRU:SOL',
    'ADJ:NOM:SIN:MAS:GRU:IND',
    'ADJ:NOM:SIN:MAS:GRU:SOL',
  ]);

  static readonly tagsForAdjEm: readonly string[] = Object.freeze([
    'ADJ:DAT:SIN:MAS:GRU:SOL',
    'ADJ:DAT:SIN:NEU:GRU:SOL',
  ]);

  static readonly tagsForAdjEs: readonly string[] = Object.freeze([
    'ADJ:AKK:SIN:NEU:GRU:IND',
    'ADJ:AKK:SIN:NEU:GRU:SOL',
    'ADJ:NOM:SIN:NEU:GRU:IND',
    'ADJ:NOM:SIN:NEU:GRU:SOL',
  ]);

}
