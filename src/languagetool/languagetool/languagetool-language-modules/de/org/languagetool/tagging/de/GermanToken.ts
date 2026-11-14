// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/tagging/de/GermanToken.java faithful
// The nested classes are exported under their simple names and are also static members of
// GermanToken, so that both GermanToken.POSType.NOMEN and POSType.NOMEN read as in Java.

export class POSType {
  static readonly NOMEN = new POSType('Nomen');
  static readonly VERB = new POSType('Verb');
  static readonly ADJEKTIV = new POSType('Adjektiv');
  static readonly DETERMINER = new POSType('Determiner');
  static readonly PRONOMEN = new POSType('Pronomen');
  static readonly PARTIZIP = new POSType('Partizip');
  static readonly PROPER_NOUN = new POSType('Eigenname');
  static readonly OTHER = new POSType('Other');      // e.g. sentence start

  private readonly name: string;

  private constructor(name: string) {
    this.name = name;
  }

  toString(): string {
    return this.name;
  }
}

export class Kasus {
  static readonly NOMINATIV = new Kasus('Nominativ');
  static readonly AKKUSATIV = new Kasus('Akkusativ');
  static readonly DATIV = new Kasus('Dativ');
  static readonly GENITIV = new Kasus('Genitiv');
  static readonly OTHER = new Kasus('Other');

  private readonly name: string;

  private constructor(name: string) {
    this.name = name;
  }

  toString(): string {
    return this.name;
  }
}

export class Numerus {
  static readonly SINGULAR = new Numerus('Singular');
  static readonly PLURAL = new Numerus('Plural');
  static readonly OTHER = new Numerus('Other');

  private readonly name: string;

  private constructor(name: string) {
    this.name = name;
  }

  toString(): string {
    return this.name;
  }
}

export class Genus {
  static readonly NEUTRUM = new Genus('Neutrum');
  static readonly MASKULINUM = new Genus('Maskulinum');
  static readonly FEMININUM = new Genus('Femininum');
  static readonly OTHER = new Genus('Other');
  static readonly ALLGEMEIN = new Genus('Allgemein');   // Morphy ALG = Mas, Fem, or Neu

  private readonly name: string;

  private constructor(name: string) {
    this.name = name;
  }

  toString(): string {
    return this.name;
  }
}

/** @since 3.2 */
export class Determination {
  static readonly DEFINITE = new Determination('definit');
  static readonly INDEFINITE = new Determination('indefinit');

  private readonly name: string;

  private constructor(name: string) {
    this.name = name;
  }

  toString(): string {
    return this.name;
  }
}

/**
 * Constants used to describe the properties of German tokens.
 *
 * @author Daniel Naber
 */
export class GermanToken {

  static readonly POSType = POSType;
  static readonly Kasus = Kasus;
  static readonly Numerus = Numerus;
  static readonly Genus = Genus;
  static readonly Determination = Determination;

  private constructor() {
    // only static stuff
  }

}
