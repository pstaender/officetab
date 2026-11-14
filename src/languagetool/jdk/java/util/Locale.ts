// SPDX-License-Identifier: MPL-2.0
// java.util.Locale for the LanguageTool ports: not a port, the part of the JDK's API they use.
// The default locale is English (a Web Worker has no JVM default); setDefault changes it.

export class Locale {
  static readonly ENGLISH = new Locale('en');
  static readonly ROOT = new Locale('');
  private static defaultLocale: Locale = Locale.ENGLISH;

  private readonly language: string;
  private readonly country: string;
  private readonly variant: string;

  constructor(language: string, country = '', variant = '') {
    // Java lowercases the language and uppercases the country
    this.language = language.toLowerCase();
    this.country = country.toUpperCase();
    this.variant = variant;
  }

  static getDefault(): Locale { return Locale.defaultLocale; }
  static setDefault(locale: Locale): void { Locale.defaultLocale = locale; }

  getLanguage(): string { return this.language; }
  getCountry(): string { return this.country; }
  getVariant(): string { return this.variant; }

  /** "en_US", as Java prints it (and as resource bundle names use it). */
  toString(): string {
    let s = this.language;
    if (this.country !== '' || this.variant !== '') s += '_' + this.country;
    if (this.variant !== '') s += '_' + this.variant;
    return s;
  }

  equals(o: unknown): boolean {
    return o instanceof Locale && o.language === this.language && o.country === this.country && o.variant === this.variant;
  }
}
