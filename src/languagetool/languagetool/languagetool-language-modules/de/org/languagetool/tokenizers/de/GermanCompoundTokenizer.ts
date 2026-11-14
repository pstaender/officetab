// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/tokenizers/de/GermanCompoundTokenizer.java partial
// The memoized strict and non-strict instances are created on first use; the constructor
// overloads are one (strictMode defaults to true). Left out: main() (a command line tool). The
// package-private ExtendedGermanWordSplitter is exported (TypeScript has no packages); the
// fastutil set is a Set (trim() only shrinks Java's storage).
import { EmbeddedGermanDictionary } from '../../../../../../../jwordsplitter/de/danielnaber/jwordsplitter/EmbeddedGermanDictionary.ts';
import { GermanWordSplitter } from '../../../../../../../jwordsplitter/de/danielnaber/jwordsplitter/GermanWordSplitter.ts';
import { InputTooLongException } from '../../../../../../../jwordsplitter/de/danielnaber/jwordsplitter/InputTooLongException.ts';
import type { Tokenizer } from '../../../../../../languagetool-core/org/languagetool/tokenizers/Tokenizer.ts';

let strictInstance: GermanCompoundTokenizer | null = null;
let nonStrictInstance: GermanCompoundTokenizer | null = null;

export class ExtendedGermanWordSplitter extends GermanWordSplitter {
  constructor(hideInterfixCharacters: boolean) {
    super(hideInterfixCharacters, ExtendedGermanWordSplitter.extendedList());
  }
  static extendedList(): Set<string> {
    const words = new Set<string>(EmbeddedGermanDictionary.getWords());
    // Add compound parts here so we don't need to update JWordSplitter for every missing word we find.
    // Note: adding words, especially short ones, can also cause incorrect splits. E.g. if "sport"
    // is in the list and you add "tran", without "transport" being in the list, it would split "transport".
    words.add('influencer');
    words.add('katheterisierung');
    words.add('rücklass');
    words.add('abdichtung');
    words.add('laptop');
    words.add('verschattung');
    words.add('paradeiser');
    words.add('einreichung');
    words.add('bestatter');
    words.add('divergenz');
    words.add('schrumpf');
    words.add('degustation');
    words.add('schaft');
    words.add('abstreifer');
    words.add('aufputz');
    words.add('glühwürmchen');
    words.add('aufwertung');
    words.add('einhausung');
    words.add('lackier');
    words.add('zarge');
    words.add('pluralisierung');
    words.add('schanzen');
    words.add('abscheide');
    words.add('rangier');
    words.add('temporal');
    words.add('kartonage');
    words.add('kartonagen');
    words.add('rebellion');
    words.add('binokular');
    words.add('umverlegung');
    words.add('umhausung');
    words.add('überholung');
    words.add('chloroplasten');
    words.add('nachrangigkeit');
    words.add('spital');
    words.add('turnus');
    words.add('teilnehmenden');
    words.add('pensionisten');
    words.add('graduierten');
    words.add('beladung');
    words.add('controller');
    words.add('resilienz');
    words.add('mitführ');
    words.add('trauma');
    words.add('abtau');
    words.add('normung');
    words.add('mikroskopie');
    words.add('bitumen');
    words.add('erfolglosigkeit');
    words.add('pneumatik');
    words.add('anlasser');
    words.add('allozierung');
    words.add('alphabetisierung');
    words.add('aktuator');
    words.add('akademisierung');
    words.add('allergiker');
    words.add('queer');
    words.add('filament');
    words.add('querung');
    words.add('curling');
    words.add('opioid');
    words.add('booster');
    words.add('schmuse');
    words.add('thrombozyten');
    words.add('dysfunktion');
    words.add('storchen');
    words.add('nasch');
    words.add('esperanto');
    words.add('passivierung');
    words.add('radikalisierung');
    words.add('erleuchtung');
    words.add('verwalter');
    words.add('verbiss');
    words.add('ausleih');
    words.add('rutsch');
    words.add('kufen');
    words.add('entferner');
    words.add('debitoren');
    words.add('terrakotta');
    words.add('graffiti');
    words.add('auffahr');
    words.add('anmutung');
    words.add('kritzel');
    words.add('salami');
    words.add('eukalyptus');
    words.add('kreativ');
    words.add('hochvolt');
    words.add('trading');
    words.add('extraktion');
    words.add('verstetigung');
    words.add('diagonal');
    words.add('margen');
    words.add('synonym');
    words.add('aufbringung');
    words.add('robustheit');
    words.add('nachuntersuchung');
    words.add('erstkommunion');
    words.add('hauptstadt');
    words.add('neustart');
    words.add('polarisierung');
    words.add('vollstreckbarkeit');
    words.add('vollziehung');
    words.add('kasko');
    words.add('blitzableiter');
    words.add('abschattungen');
    words.add('kuscheltier');
    words.add('gastro');
    words.add('hortensien');
    return words;
  }
}

/**
 * Split German nouns using the jWordSplitter library.
 *
 * @author Daniel Naber
 */
export class GermanCompoundTokenizer implements Tokenizer {

  private readonly wordSplitter: ExtendedGermanWordSplitter;

  constructor(strictMode = true) {
    this.wordSplitter = new ExtendedGermanWordSplitter(false);
    this.wordSplitter.setStrictMode(strictMode);
    this.wordSplitter.setMinimumWordLength(3);
    // add exceptions here so we don't need to update JWordSplitter for every exception we find:
    //wordSplitter.addException("Maskerade", Collections.singletonList("Maskerade"));
    //wordSplitter.addException("Sportshorts", asList("Sport", "shorts"));
    this.wordSplitter.addException('Absolventen', ['Absolventen']);
    this.wordSplitter.addException('Acetat', ['Acetat']);
    this.wordSplitter.addException('Alkoholabstinenz', ['Alkohol', 'abstinenz']);
    this.wordSplitter.addException('Androgen', ['Androgen']);
    this.wordSplitter.addException('Auberginen', ['Auberginen']);
    this.wordSplitter.addException('Auckland', ['Auckland']);
    this.wordSplitter.addException('Boston', ['Boston']);
    this.wordSplitter.addException('Brandenburg', ['Brandenburg']);
    this.wordSplitter.addException('Broadcast', ['Broadcast']);
    this.wordSplitter.addException('Buchsbaum', ['Buchsbaum']);
    this.wordSplitter.addException('Chiemsee', ['Chiemsee']);
    this.wordSplitter.addException('Coffein', ['Coffein']);
    this.wordSplitter.addException('Drohnen', ['Drohnen']);
    this.wordSplitter.addException('Eiben', ['Eiben']);
    this.wordSplitter.addException('Eingroschen', ['Eingroschen']);
    this.wordSplitter.addException('Einkomponenten', ['Einkomponenten']);
    this.wordSplitter.addException('Elster', ['Elster']);
    this.wordSplitter.addException('Engineering', ['Engineering']);
    this.wordSplitter.addException('Factoring', ['Factoring']);
    this.wordSplitter.addException('Flexodruck', ['Flexo', 'druck']);
    this.wordSplitter.addException('Graviton', ['Graviton']);
    this.wordSplitter.addException('Göttinnen', ['Göttinnen']);
    this.wordSplitter.addException('Hallesche', ['Hallesche']);
    this.wordSplitter.addException('Hinspiel', ['Hinspiel']);
    this.wordSplitter.addException('Homogen', ['Homogen']);
    this.wordSplitter.addException('Kolleggen', ['Kolleggen']);
    this.wordSplitter.addException('Karstadt', ['Karstadt']);
    this.wordSplitter.addException('Kartier', ['Kartier']);
    this.wordSplitter.addException('Kaukasus', ['Kaukasus']);
    this.wordSplitter.addException('Knoblauch', ['Knoblauch']);
    this.wordSplitter.addException('Kollagen', ['Kollagen']);
    this.wordSplitter.addException('Kommerz', ['Kommerz']);
    this.wordSplitter.addException('Mentoring', ['Mentoring']);
    this.wordSplitter.addException('Monarchen', ['Monarchen']);
    this.wordSplitter.addException('Oligarchen', ['Oligarchen']);
    this.wordSplitter.addException('Optimal', ['Optimal']);
    this.wordSplitter.addException('Saunieren', ['Saunieren']);
    this.wordSplitter.addException('Schiessen', ['Schiessen']);
    this.wordSplitter.addException('Spielgeleier', ['Spielgeleier']);
    this.wordSplitter.addException('Halleschen', ['Halleschen']);
    this.wordSplitter.addException('Reinigungstab', ['Reinigungs', 'tab']);
    this.wordSplitter.addException('Reinigungstabs', ['Reinigungs', 'tabs']);
    this.wordSplitter.addException('Tauschwerte', ['Tausch', 'werte']);
    this.wordSplitter.addException('Tauschwertes', ['Tausch', 'wertes']);
    this.wordSplitter.addException('Kinderspielen', ['Kinder', 'spielen']);
    this.wordSplitter.addException('Buchhaltungstrick', ['Buchhaltungs', 'trick']);
    this.wordSplitter.addException('Buchhaltungstricks', ['Buchhaltungs', 'tricks']);
    this.wordSplitter.addException('Haushaltstrick', ['Haushalts', 'trick']);
    this.wordSplitter.addException('Haushaltstricks', ['Haushalts', 'tricks']);
    this.wordSplitter.addException('Verkaufstrick', ['Verkaufs', 'trick']);
    this.wordSplitter.addException('Verkaufstricks', ['Verkaufs', 'tricks']);
    this.wordSplitter.addException('Ablenkungstrick', ['Ablenkungs', 'trick']);
    this.wordSplitter.addException('Ablenkungstricks', ['Ablenkungs', 'tricks']);
    this.wordSplitter.addException('Manipulationstrick', ['Manipulations', 'trick']);
    this.wordSplitter.addException('Manipulationstricks', ['Manipulations', 'tricks']);
    this.wordSplitter.addException('Erziehungstrick', ['Erziehungs', 'trick']);
    this.wordSplitter.addException('Erziehungstricks', ['Erziehungs', 'tricks']);
    this.wordSplitter.addException('Messetage', ['Messe', 'tage']);
    this.wordSplitter.addException('Messetagen', ['Messe', 'tagen']);
    this.wordSplitter.addException('karamelligen', ['karamelligen']);  // != Karamel+Ligen
    this.wordSplitter.addException('Häkelnadel', ['Häkel', 'nadel']);
    this.wordSplitter.addException('Häkelnadeln', ['Häkel', 'nadeln']);
    this.wordSplitter.addException('Freiberg', ['Freiberg']);
    this.wordSplitter.addException('Abtestat', ['Abtestat']);
    this.wordSplitter.addException('Abtestaten', ['Abtestaten']);
    this.wordSplitter.addException('Freibergs', ['Freibergs']);
    this.wordSplitter.addException('Kreuzberg', ['Kreuzberg']);
    this.wordSplitter.addException('Kreuzbergs', ['Kreuzbergs']);
    this.wordSplitter.addException('Digitalisierung', ['Digitalisierung']);
    this.wordSplitter.addException('Abtrocknung', ['Abtrocknung']);
    this.wordSplitter.addException('Erlösung', ['Erlösung']);
    this.wordSplitter.addException('Feuerung', ['Feuerung']);
    this.wordSplitter.addException('Aktivierung', ['Aktivierung']);
    this.wordSplitter.addException('Protokollierung', ['Protokollierung']);
    this.wordSplitter.addException('Budgetierung', ['Budgetierung']);
    this.wordSplitter.addException('Faltung', ['Faltung']);
    this.wordSplitter.addException('Anhäufung', ['Anhäufung']);
    this.wordSplitter.addException('Aufkohlung', ['Aufkohlung']);
    this.wordSplitter.addException('Festigung', ['Festigung']);
    this.wordSplitter.addException('Allerheiligen', ['Allerheiligen']);
    this.wordSplitter.addException('Druckerpressen', ['Drucker', 'pressen']);
    this.wordSplitter.addException('Habitat', ['Habitat']);
    this.wordSplitter.addException('Augarten', ['Augarten']);
    this.wordSplitter.addException('Auszeit', ['Auszeit']);
    this.wordSplitter.addException('Bewegtbild', ['Bewegt', 'bild']);
    this.wordSplitter.addException('Bigband', ['Bigband']);
    this.wordSplitter.addException('Bisexuelle', ['Bisexuelle']);
    this.wordSplitter.addException('Bisexuellen', ['Bisexuellen']);
    this.wordSplitter.addException('Bunsenbrenner', ['Bunsenbrenner']);  // avoid "Bunsenweisheit"
    this.wordSplitter.addException('Carbon', ['Carbon']);
    this.wordSplitter.addException('Carsharing', ['Carsharing']);
    this.wordSplitter.addException('Castor', ['Castor']);
    this.wordSplitter.addException('Catering', ['Catering']);
    this.wordSplitter.addException('Cholesterin', ['Cholesterin']);
    this.wordSplitter.addException('Damast', ['Damast']);
    this.wordSplitter.addException('Dispositiv', ['Dispositiv']);
    this.wordSplitter.addException('Emittent', ['Emittent']);
    this.wordSplitter.addException('Emittenten', ['Emittenten']);
    this.wordSplitter.addException('Express', ['Express']);
    this.wordSplitter.addException('Fairness', ['Fairness']);
    this.wordSplitter.addException('Fiberglas', ['Fiberglas']);  // avoid "Fiberthermometer"
    this.wordSplitter.addException('Globus', ['Globus']);
    this.wordSplitter.addException('Göttinnen', ['Göttinnen']);
    this.wordSplitter.addException('Illustration', ['Illustration']);
    this.wordSplitter.addException('Muttertag', ['Muttertag']);  // "Muttertag" needs infix s
    this.wordSplitter.addException('Muttertags', ['Muttertags']);  // "Muttertag" needs infix s
    this.wordSplitter.addException('Patriarchen', ['Patriarchen']);
    this.wordSplitter.addException('Phosgen', ['Phosgen']);
    this.wordSplitter.addException('Vatertag', ['Vatertag']);  // "Vatertag" needs infix s
    this.wordSplitter.addException('Vatertags', ['Vatertags']);  // "Vatertag" needs infix s
    this.wordSplitter.addException('Vaterland', ['Vaterland']);
    this.wordSplitter.addException('Vaterlands', ['Vaterlands']);
    this.wordSplitter.addException('Wehrmacht', ['Wehrmacht']);
    this.wordSplitter.addException('Wehrmachts', ['Wehrmachts']);
  }

  tokenize(word: string): string[] {
    try {
      return this.wordSplitter.splitWord(word);
    } catch (e) {
      if (e instanceof InputTooLongException) {
        return [word];
      }
      throw e;
    }
  }

  static getStrictInstance(): GermanCompoundTokenizer {
    return (strictInstance ??= new GermanCompoundTokenizer(true));
  }

  static getNonStrictInstance(): GermanCompoundTokenizer {
    return (nonStrictInstance ??= new GermanCompoundTokenizer(false));
  }

}
