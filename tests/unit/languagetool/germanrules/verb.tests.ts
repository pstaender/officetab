// SPDX-License-Identifier: MPL-2.0
// The upstream unit tests of German's verb and relative clause rules: SubjectVerbAgreementRuleTest,
// VerbAgreementRuleTest, MissingVerbRuleTest, MissingCommaRelativeClauseRuleTest,
// CompoundInfinitivRuleTest (languagetool-language-modules/de/src/test/java/org/languagetool/rules/de/),
// expectations unchanged. Every assertion is its own test case, so that failures are counted one by
// one. MissingVerbRuleTest uses TestTools.getEnglishMessages(); the messages do not matter for its
// assertions, here German's. Imported by tests/unit/languagetool/germanrules.test.ts after testGerman.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { german, lang } from './testGerman.ts';
import { JLanguageTool } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import type { AnalyzedTokenReadings } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { RuleMatch } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { German } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/language/German.ts';
import { SubjectVerbAgreementRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/SubjectVerbAgreementRule.ts';
import { VerbAgreementRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/VerbAgreementRule.ts';
import { MissingVerbRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/MissingVerbRule.ts';
import { MissingCommaRelativeClauseRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/MissingCommaRelativeClauseRule.ts';
import { CompoundInfinitivRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/CompoundInfinitivRule.ts';

const lt = (): JLanguageTool => german().lt;

describe('SubjectVerbAgreementRuleTest', () => {
  let rule: SubjectVerbAgreementRule;
  beforeAll(() => {
    rule = new SubjectVerbAgreementRule(german().messages, lang('de-DE') as German);
    lt().getAnalyzedSentence('Die Katze ist süß');  // loads the dictionaries and the disambiguator
  }, 300_000);

  const getTokens = (s: string): AnalyzedTokenReadings[] => lt().getAnalyzedSentence(s).getTokensWithoutWhitespace();
  const getMatches = (input: string): RuleMatch[] => rule.match(lt().getAnalyzedSentence(input));

  it('testPrevChunkIsNominative', () => {
    expect(rule.prevChunkIsNominative(getTokens("Die Katze ist süß"), 2)).toBe(true);
    expect(rule.prevChunkIsNominative(getTokens("Das Fell der Katzen ist süß"), 4)).toBe(true);

    expect(rule.prevChunkIsNominative(getTokens("Dem Mann geht es gut."), 2)).toBe(false);
    expect(rule.prevChunkIsNominative(getTokens("Dem alten Mann geht es gut."), 2)).toBe(false);
    expect(rule.prevChunkIsNominative(getTokens("Beiden Filmen war kein Erfolg beschieden."), 2)).toBe(false);
    expect(rule.prevChunkIsNominative(getTokens("Aber beiden Filmen war kein Erfolg beschieden."), 3)).toBe(false);
  });

  it('testArrayOutOfBoundsBug', () => {
    rule.match(lt().getAnalyzedSentence("Die nicht Teil des Näherungsmodells sind"));
  });

  const good = (input: string) => it('good: ' + input, () => {
    expect(getMatches(input).map(String), "Got unexpected match(es) for '" + input + "'").toEqual([]);
  });
  const bad = (input: string) => it('bad: ' + input, () => {
    expect(getMatches(input).length, "Did not get the expected match for '" + input + "'").toBeGreaterThan(0);
  });

  const incorrectSingular = [
    "Die Autos ist schnell.",
    "Der Hund und die Katze ist draußen.",
    "Ein Hund und eine Katze ist schön.",
    "Der Hund und die Katze ist schön.",
    "Der große Hund und die Katze ist schön.",
    "Der Hund und die graue Katze ist schön.",
    "Der große Hund und die graue Katze ist schön.",
    "Die Kenntnisse ist je nach Bildungsgrad verschieden.",
    "Die Kenntnisse der Sprachen ist je nach Bildungsgrad verschieden.",
    "Die Kenntnisse der Sprache ist je nach Bildungsgrad verschieden.",
    "Die Kenntnisse der europäischen Sprachen ist je nach Bildungsgrad verschieden.",
    "Die Kenntnisse der neuen europäischen Sprachen ist je nach Bildungsgrad verschieden.",
    "Die Kenntnisse der deutschen Sprache ist je nach Bildungsgrad verschieden.",
    "Die Kenntnisse der aktuellen deutschen Sprache ist je nach Bildungsgrad verschieden.",
    "Drei Katzen ist im Haus.",
    "Drei kleine Katzen ist im Haus.",
    "Viele Katzen ist schön.",
    "Drei Viertel der Erdoberfläche ist Wasser.",
    "Die ältesten und bekanntesten Maßnahmen ist die Einrichtung von Schutzgebieten.",
    "Ein Gramm Pfeffer waren früher wertvoll.",
    "Isolation und ihre Überwindung ist ein häufiges Thema in der Literatur."
  ];
  const correctSingular = [
    "Abschluss und Höhepunkt ist der Festumzug.",
    "Abschluss und Höhepunkt ist der Festumzug, der im Oktober stattfindet.",
    "All diesen Stadtteilen ist die Nähe zum Hamburger Hafen und zu den Industrie- und Gewerbegebieten gemein.",
    "All diesen Bereichen ist gemeinsam, dass sie unterfinanziert sind.",
    "Nicht entmutigen lassen, nur weil Sie kein Genie sind.",
    "Denken Sie daran, dass Sie hier zu Gast sind und sich entsprechend verhalten sollten.",
    "Ist es wahr, dass Sie ein guter Mensch sind?",
    "Die Katze ist schön.",
    "Die eine Katze ist schön.",
    "Eine Katze ist schön.",
    "Für Tunesiens Tourismusindustrie mit seinen Stränden, Oasen und antiken Kulturschätzen ist das Attentat ein verheerender Rückschlag.",
    "Man darf jedoch auch nicht glauben, weil die Brustvergrößerungscremes ein Allheilmittel sind, jedoch sind Sie optimal um Ihr Selbstvertrauen zu erhöhen",
    "Die Rechte der Kinder sind universell.",
    "Beiden Filmen war kein Erfolg beschieden.",
    "In einigen Fällen ist der vermeintliche Beschützer schwach.",
    "Was Wasser für die Fische ist.",
    "In den letzten Jahrzehnten ist die Zusammenarbeit der Astronomie verbessert worden.",
    "Für Oberleitungen bei elektrischen Bahnen ist es dagegen anders.",
    "... deren Thema die Liebe zwischen männlichen Charakteren ist.",
    "Mehr als das in westlichen Produktionen der Fall ist.",
    "Da das ein fast aussichtsloses Unterfangen ist.",
    "Was sehr verbreitet bei der Synthese organischer Verbindungen ist.",
    "In chemischen Komplexverbindungen ist das Kation wichtig.",
    "In chemischen Komplexverbindungen ist das As5+-Kation wichtig.",
    "Die selbstständige Behandlung psychischer Störungen ist jedoch ineffektiv.",
    "Die selbstständige Behandlung eigener psychischer Störungen ist jedoch ineffektiv.",
    "Im Gegensatz zu anderen akademischen Berufen ist es in der Medizin durchaus üblich ...",
    "Im Unterschied zu anderen Branchen ist Ärzten anpreisende Werbung verboten.",
    "Aus den verfügbaren Quellen ist es ersichtlich.",
    "Das Mädchen mit den langen Haaren ist Judy.",
    "Der Durchschnitt offener Mengen ist nicht notwendig offen.",
    "Der Durchschnitt vieler offener Mengen ist nicht notwendig offen.",
    "Der Durchschnitt unendlich vieler offener Mengen ist nicht notwendig offen.",
    "Der Ausgangspunkt für die heute gebräuchlichen Alphabete ist ...",
    "Nach sieben männlichen Amtsvorgängern ist Merkel ...",
    "Für einen japanischen Hamburger ist er günstig.",
    "Derzeitiger Bürgermeister ist seit 2008 der ehemalige Minister Müller.",
    "Derzeitiger Bürgermeister der Stadt ist seit 2008 der ehemalige Minister Müller.",
    "Die Eingabe mehrerer assoziativer Verknüpfungen ist beliebig.",
    "Die inhalative Anwendung anderer Adrenalinpräparate zur Akutbehandlung asthmatischer Beschwerden ist somit außerhalb der arzneimittelrechtlichen Zulassung.",
    "Die Kategorisierung anhand morphologischer Merkmale ist nicht objektivierbar.",
    "Die Kategorisierung mit morphologischen Merkmalen ist nicht objektivierbar.",
    "Ute, deren Hauptproblem ihr Mangel an Problemen ist, geht baden.",
    "Ute, deren Hauptproblem ihr Mangel an realen Problemen ist, geht baden.",
    "In zwei Wochen ist Weihnachten.",
    "In nur zwei Wochen ist Weihnachten.",
    "Mit chemischen Methoden ist es möglich, das zu erreichen.",
    "Für die Stadtteile ist auf kommunalpolitischer Ebene jeweils ein Beirat zuständig.",
    "Für die Stadtteile und selbständigen Ortsteile ist auf kommunalpolitischer Ebene jeweils ein Beirat zuständig.",
    "Die Qualität der Straßen ist unterschiedlich.",
    "In deutschen Installationen ist seit Version 3.3 ein neues Feature vorhanden.",
    "In deren Installationen ist seit Version 3.3 ein neues Feature vorhanden.",
    "In deren deutschen Installationen ist seit Version 3.3 ein neues Feature vorhanden.",
    "Die Führung des Wortes in Unternehmensnamen ist nur mit Genehmigung zulässig.",
    "Die Führung des Wortes in Unternehmensnamen und Institutionen ist nur mit Genehmigung zulässig.",
    "Die Hintereinanderreihung mehrerer Einheitenvorsatznamen oder Einheitenvorsatzzeichen ist nicht zulässig.",
    "Eines ihrer drei Autos ist blau und die anderen sind weiß.",
    "Eines von ihren drei Autos ist blau und die anderen sind weiß.",
    "Bei fünf Filmen war Robert F. Boyle für das Production Design verantwortlich.",
    "Insbesondere das Wasserstoffatom als das einfachste aller Atome war dabei wichtig.",
    "In den darauf folgenden Wochen war die Partei führungslos",
    "Gegen die wegen ihrer Schönheit bewunderte Phryne ist ein Asebie-Prozess überliefert.",
    "Dieses für Ärzte und Ärztinnen festgestellte Risikoprofil ist berufsunabhängig.",
    "Das ist problematisch, da kDa eine Masseeinheit und keine Gewichtseinheit ist.",
    "Nach sachlichen oder militärischen Kriterien war das nicht nötig.",
    "Die Pyramide des Friedens und der Eintracht ist ein Bauwerk.",
    "Ohne Architektur der Griechen ist die westliche Kultur der Neuzeit nicht denkbar.",
    "Ohne Architektur der Griechen und Römer ist die westliche Kultur der Neuzeit nicht denkbar.",
    "Ohne Architektur und Kunst der Griechen und Römer ist die westliche Kultur der Neuzeit nicht denkbar.",
    "In denen jeweils für eine bestimmte Anzahl Elektronen Platz ist.",
    "Mit über 1000 Handschriften ist Aristoteles ein Vielschreiber.",
    "Mit über neun Handschriften ist Aristoteles ein Vielschreiber.",
    "Die Klammerung assoziativer Verknüpfungen ist beliebig.",
    "Die Klammerung mehrerer assoziativer Verknüpfungen ist beliebig.",
    "Einen Sonderfall bildete jedoch Ägypten, dessen neue Hauptstadt Alexandria eine Gründung Alexanders und der Ort seines Grabes war.",
    "Jeder Junge und jedes Mädchen war erfreut.",
    "Jedes Mädchen und jeder Junge war erfreut.",
    "Jede Frau und jeder Junge war erfreut.",
    "Als Wissenschaft vom Erleben des Menschen einschließlich der biologischen Grundlagen ist die Psychologie interdisziplinär.",
    "Als Wissenschaft vom Erleben des Menschen einschließlich der biologischen und sozialen Grundlagen ist die Psychologie interdisziplinär.",
    "Als Wissenschaft vom Erleben des Menschen einschließlich der biologischen und neurowissenschaftlichen Grundlagen ist die Psychologie interdisziplinär.",
    "Als Wissenschaft vom Erleben und Verhalten des Menschen einschließlich der biologischen bzw. sozialen Grundlagen ist die Psychologie interdisziplinär.",
    "Alle vier Jahre ist dem Volksfest das Landwirtschaftliche Hauptfest angeschlossen.",
    "Aller Anfang ist schwer.",
    "Alle Dichtung ist zudem Darstellung von Handlungen.",
    "Allen drei Varianten ist gemeinsam, dass meistens nicht unter bürgerlichem...",
    "Er sagte, dass es neun Uhr war.",
    "Auch den Mädchen war es untersagt, eine Schule zu besuchen.",
    "Das dazugehörende Modell der Zeichen-Wahrscheinlichkeiten ist unter Entropiekodierung beschrieben.",
    "Ein über längere Zeit entladener Akku ist zerstört.",
    "Der Fluss mit seinen Oberläufen Río Paraná und Río Uruguay ist der wichtigste Wasserweg.",
    "In den alten Mythen und Sagen war die Eiche ein heiliger Baum.",
    "In den alten Religionen, Mythen und Sagen war die Eiche ein heiliger Baum.",
    "Zehn Jahre ist es her, seit ich mit achtzehn nach Tokio kam.",
    "Bei den niedrigen Oberflächentemperaturen ist Wassereis hart wie Gestein.",
    "Bei den sehr niedrigen Oberflächentemperaturen ist Wassereis hart wie Gestein.",
    "Die älteste und bekannteste Maßnahme ist die Einrichtung von Schutzgebieten.",
    "Die größte Dortmunder Grünanlage ist der Friedhof.",
    "Die größte Berliner Grünanlage ist der Friedhof.",
    "Die größte Bielefelder Grünanlage ist der Friedhof.",
    "Die Pariser Linie ist hier mit 2,2558 mm gerechnet.",
    "Die Frankfurter Innenstadt ist 7 km entfernt.",
    "Die Dortmunder Konzernzentrale ist ein markantes Gebäude an der Bundesstraße 1.",
    "Die Düsseldorfer Brückenfamilie war ursprünglich ein Sammelbegriff.",
    "Die Düssel ist ein rund 40 Kilometer langer Fluss.",
    "Die Berliner Mauer war während der Teilung Deutschlands die Grenze.",
    "Für amtliche Dokumente und Formulare ist das anders.",
    "Wie viele Kilometer ist ihre Stadt von unserer entfernt?",
    "Über laufende Sanierungsmaßnahmen ist bislang nichts bekannt.",
    "In den letzten zwei Monate war ich fleißig wie eine Biene.",
    "Durch Einsatz größerer Maschinen und bessere Kapazitätsplanung ist die Zahl der Flüge gestiegen.",
    "Die hohe Zahl dieser relativ kleinen Verwaltungseinheiten ist immer wieder Gegenstand von Diskussionen.",
    "Teil der ausgestellten Bestände ist auch die Bierdeckel-Sammlung.",
    "Teil der umfangreichen dort ausgestellten Bestände ist auch die Bierdeckel-Sammlung.",
    "Teil der dort ausgestellten Bestände ist auch die Bierdeckel-Sammlung.",
    "Der zweite Teil dieses Buches ist in England angesiedelt.",
    "Eine der am meisten verbreiteten Krankheiten ist die Diagnose",
    "Eine der verbreitetsten Krankheiten ist hier.",
    "Die Krankheit unserer heutigen Städte und Siedlungen ist folgendes.",
    "Die darauffolgenden Jahre war er ...",
    "Die letzten zwei Monate war ich fleißig wie eine Biene.",
    "Bei sehr guten Beobachtungsbedingungen ist zu erkennen, dass ...",
    "Die beste Rache für Undank und schlechte Manieren ist Höflichkeit.",
    "Ein Gramm Pfeffer war früher wertvoll.",
    "Die größte Stuttgarter Grünanlage ist der Friedhof.",
    "Mancher will Meister sein und ist kein Lehrjunge gewesen.",
    "Ellen war vom Schock ganz bleich.",
    "Nun gut, die Nacht ist sehr lang, oder?",
    "Der Morgen ist angebrochen, die lange Nacht ist vorüber.",
    "Die stabilste und häufigste Oxidationsstufe ist dabei −1.",
    "Man kann nicht eindeutig zuordnen, wer Täter und wer Opfer war.",
    "Ich schätze, die Batterie ist leer.",
    "Der größte und schönste Tempel eines Menschen ist in ihm selbst.",
    "Begehe keine Dummheit zweimal, die Auswahl ist doch groß genug!",
    "Seine größte und erfolgreichste Erfindung war die Säule.",
    "Egal was du sagst, die Antwort ist Nein.",
    "... in der Geschichte des Museums, die Sammlung ist seit 2011 zugänglich.",
    "Deren Bestimmung und Funktion ist allerdings nicht so klar.",
    "Sie hat eine Tochter, die Pianistin ist.",
    "Ja, die Milch ist sehr gut.",
    "Der als Befestigung gedachte östliche Teil der Burg ist weitgehend verfallen.",
    "Das Kopieren und Einfügen ist sehr nützlich.",
    "Der letzte der vier großen Flüsse ist die Kolyma.",
    "In christlichen, islamischen und jüdischen Traditionen ist das höchste Ziel der meditativen Praxis.",
    "Der Autor der beiden Spielbücher war Markus Heitz selbst.",
    "Der Autor der ersten beiden Spielbücher war Markus Heitz selbst.",
    "Das Ziel der elf neuen Vorstandmitglieder ist klar definiert.",
    "Laut den meisten Quellen ist das Seitenverhältnis der Nationalflagge...",
    "Seine Novelle, die eigentlich eine Glosse ist, war toll.",
    "Für in Österreich lebende Afrikaner und Afrikanerinnen ist dies nicht üblich.",
    "Von ursprünglich drei Almhütten ist noch eine erhalten.",
    "Einer seiner bedeutendsten Kämpfe war gegen den späteren Weltmeister.",
    "Aufgrund stark schwankender Absatzmärkte war die GEFA-Flug Mitte der 90er Jahre gezwungen, ...",
    "Der Abzug der Besatzungssoldaten und deren mittlerweile ansässigen Angehörigen der Besatzungsmächte war vereinbart.",
    "Das Bündnis zwischen der Sowjetunion und Kuba war für beide vorteilhaft.",
    "Knapp acht Monate ist die Niederlage nun her.",
    "Vier Monate ist die Niederlage nun her.",
    "Sie liebt Kunst und Kunst war auch kein Problem, denn er würde das Geld zurückkriegen.",
    "Bei komplexen und andauernden Störungen ist der Stress-Stoffwechsel des Hundes entgleist.",
    "Eltern ist der bisherige Kita-Öffnungsplan zu unkonkret",
    "Einer der bedeutendsten Māori-Autoren der Gegenwart ist Witi Ihimaera.",
    "Start und Ziel ist Innsbruck",
    "Heute ist sie lieb.",
    "Anfänger wie auch Fortgeschrittene sind herzlich willkommen!",
    "Die Aussichten für Japans Zukunft sind düster.",
    "Das Angeln an Mallorcas Felsküsten ist überaus Erfolg versprechend.",
    "Das bedeutendste Bauwerk und Wahrzeichen der Stadt ist die ehemalige Klosterkirche des Klosters Hofen.",
    "Das saisonale Obst und Gemüse ist köstlich und oft deutlich günstiger als in der Stadt.",
    "Gründer und Leiter des Zentrums ist der Rabbiner Marvin Hier, sein Stellvertreter ist Rabbi Abraham Cooper.",
    "Dank unserer Kunden, Freunde, Partner und unserer Mitarbeiter ist Alpenwahnsinn zur Heimatadresse für schöne Trachtenmode geworden.",
    "Laut seiner Recherche und mehreren Berichten der Welt ist die Zahl zu niedrig gegriffen."
  ];
  const incorrectPlural = [
    "Die Katze sind schön.",
    "Die Katze waren schön.",
    "Der Text sind gut.",
    "Das Auto sind schnell.",
    "Herr Schröder sind alt.",
    "Julia und Karsten ist alt.",
    "Julia, Heike und Karsten ist alt.",
    "Herr Karsten Schröder sind alt."
  ];
  const correctPlural = [
    "Wenn Sie kein Teil der Lösung sind, sind Sie ein Teil des Problems.",
    "Er bemerkte, dass Experimente nicht gerade sein Ding sind",
    "Die meisten der Spieler sind nicht vermögend",
    "Wie viel Prozent der Menschen sind total bescheuert?",
    "Glaubt wirklich jemand, dass gute Fotos keine Arbeit sind?",
    "Zwei Schülern war aufgefallen, dass man im Fernsehen dazu nichts mehr sieht.",
    "Auch die Reste eines sehr großen Insektenfressers sind unter den Fossilien.",
    "Eine Persönlichkeit sind Sie selbst.",
    "Die Katzen sind schön.",
    "Frau Meier und Herr Müller sind alt.",
    "Frau Julia Meier und Herr Karsten Müller sind alt.",
    "Julia und Karsten sind alt.",
    "Julia, Heike und Karsten sind alt.",
    "Frau und Herr Müller sind alt.",
    "Herr und Frau Schröder sind alt.",
    "Herr Meier und Frau Schröder sind alt.",
    "Die restlichen 86 Prozent sind in der Flasche.",
    "Die restlichen sechsundachtzig Prozent sind in der Flasche.",
    "Die restlichen 86 oder 87 Prozent sind in der Flasche.",
    "Die restlichen 86 % sind in der Flasche.",
    "Durch den schnellen Zerfall des Actiniums waren stets nur geringe Mengen verfügbar.",
    "Soda und Anilin waren die ersten Produkte des Unternehmens.",
    "Bob und Tom sind Brüder.",
    "Letztes Jahr sind wir nach London gegangen.",
    "Trotz des Regens sind die Kinder in die Schule gegangen.",
    "Die Zielgruppe sind Männer.",
    "Männer sind die Zielgruppe.",
    "Die Zielgruppe sind meist junge Erwachsene.",
    "Die USA sind ein repräsentativer demokratischer Staat.",
    "Wesentliche Eigenschaften der Hülle sind oben beschrieben.",
    "Wesentliche Eigenschaften der Hülle sind oben unter Quantenmechanische Atommodelle und Erklärung grundlegender Atomeigenschaften dargestellt.",
    "Er und seine Schwester sind eingeladen.",
    "Er und seine Schwester sind zur Party eingeladen.",
    "Sowohl er als auch seine Schwester sind zur Party eingeladen.",
    "Rekonstruktionen oder der Wiederaufbau sind wissenschaftlich sehr umstritten.",
    "Form und Materie eines Einzeldings sind aber nicht zwei verschiedene Objekte.",
    "Dieses Jahr sind die Birnen groß.",
    "Es so umzugestalten, dass sie wie ein Spiel sind.",
    "Die Zielgruppe sind meist junge Erwachsene.",
    "Die Ursache eines Hauses sind so Ziegel und Holz.",
    "Vertreter dieses Ansatzes sind unter anderem Roth und Meyer.",
    "Sowohl sein Vater als auch seine Mutter sind tot.",
    "Einige der Inhaltsstoffe sind schädlich.",
    "Diese Woche sind wir schon einen großen Schritt weiter.",
    "Diese Woche sind sie hier.",
    "Vorsitzende des Vereins waren:",
    "Weder Gerechtigkeit noch Freiheit sind möglich, wenn nur das Geld regiert.",
    "Ein typisches Beispiel sind Birkenpollenallergene.",
    "Eine weitere Variante sind die Miniatur-Wohnlandschaften.",
    "Eine Menge englischer Wörter sind aus dem Lateinischen abgeleitet.",
    "Völkerrechtlich umstrittenes Territorium sind die Falklandinseln.",
    "Einige dieser älteren Synthesen sind wegen geringer Ausbeuten ...",
    "Einzelne Atome sind klein.",
    "Die Haare dieses Jungens sind schwarz.",
    "Die wichtigsten Mechanismen des Aminosäurenabbaus sind:",
    "Wasserlösliche Bariumverbindungen sind giftig.",
    "Die Schweizer Trinkweise ist dabei die am wenigsten etablierte.",
    "Die Anordnung der vier Achsen ist damit identisch.",
    "Die Nauheimer Musiktage, die immer wieder ein kultureller Höhepunkt sind.",
    "Räumliche und zeitliche Abstände sowie die Trägheit sind vom Bewegungszustand abhängig.",
    "Solche Gewerbe sowie der Karosseriebau sind traditionell stark vertreten.",
    "Hundert Dollar sind doch gar nichts!",
    "Sowohl Tom als auch Maria waren überrascht.",
    "Robben, die die hauptsächliche Beute der Eisbären sind.",
    "Die Albatrosse sind eine Gruppe von Seevögeln",
    "Die Albatrosse sind eine Gruppe von großen Seevögeln",
    "Die Albatrosse sind eine Gruppe von großen bis sehr großen Seevögeln",
    "Vier Elemente, welche der Urstoff aller Körper sind.",
    "Die Beziehungen zwischen Kanada und dem Iran sind seitdem abgebrochen.",
    "Die diplomatischen Beziehungen zwischen Kanada und dem Iran sind seitdem abgebrochen.",
    "Die letzten zehn Jahre seines Lebens war er erblindet.",
    "Die letzten zehn Jahre war er erblindet.",
    "... so dass Knochenbrüche und Platzwunden die Regel sind.",
    "Die Eigentumsverhältnisse an der Gesellschaft sind unverändert geblieben.",
    "Gegenstand der Definition sind für ihn die Urbilder.",
    "Mindestens zwanzig Häuser sind abgebrannt.",
    "Sie hielten geheim, dass sie Geliebte waren.",
    "Einige waren verspätet.",
    "Kommentare, Korrekturen und Kritik sind verboten.",
    "Kommentare, Korrekturen, Kritik sind verboten.",
    "Letztere sind wichtig, um die Datensicherheit zu garantieren.",
    "Jüngere sind oft davon überzeugt, im Recht zu sein.",
    "Verwandte sind selten mehr als Bekannte.",
    "Ursache waren die hohe Arbeitslosigkeit und die Wohnungsnot.",
    "Ursache waren unter anderem die hohe Arbeitslosigkeit und die Wohnungsnot.",
    "Er ahnt nicht, dass sie und sein Sohn ein Paar sind.",
    "Die Ursachen der vorliegenden Durchblutungsstörung sind noch unbekannt.",
    "Der See und das Marschland sind ein Naturschutzgebiet",
    "Details, Dialoge, wie auch die Typologie der Charaktere sind frei erfunden.",
    "Die internen Ermittler und auch die Staatsanwaltschaft sind nun am Zug.",
    "Sie sind so erfolgreich, weil sie eine Einheit sind.",
    "Wie viele Erwerbstätige sind im Gesundheitswesen beschäftigt?",
    "Auch Polizisten zu Fuß sind unterwegs.",
    "Julia sagte, dass Vater und Mutter zu Hause sind.",
    "Damit müssen sie zurechtkommen, wenn Kinder zu Hause sind.",
    "Auch Studien zu Zink sind vielversprechend.",
    "Die Züge vor Ort sind nicht klimatisiert.",
    "Ich verspreche dir, dass wir ein tolles Team sind."
  ];
  const correctSingularAndPlural = [
    "Solchen Personen ist der Zugriff auf diese Daten verboten.",
    "Personen ist der Zugriff auf diese Daten verboten.",
    "So mancher Mitarbeiter und manche Führungskraft ist im Urlaub.",
    "So mancher Mitarbeiter und manche Führungskraft sind im Urlaub.",
    "Jeder Schüler und jede Schülerin ist mal schlecht gelaunt.",
    "Jeder Schüler und jede Schülerin sind mal schlecht gelaunt.",
    "Kaum mehr als vier Prozent der Fläche ist für landwirtschaftliche Nutzung geeignet.",
    "Kaum mehr als vier Prozent der Fläche sind für landwirtschaftliche Nutzung geeignet.",
    "Kaum mehr als vier Millionen Euro des Haushalts ist verplant.",
    "Kaum mehr als vier Millionen Euro des Haushalts sind verplant.",
    "80 Cent ist nicht genug.",
    "80 Cent sind nicht genug.",
    "1,5 Pfund ist nicht genug.",
    "1,5 Pfund sind nicht genug.",
    "Hier ist sowohl Anhalten wie Parken verboten.",
    "Hier sind sowohl Anhalten wie Parken verboten.",
    "Der Eifer der Männer und Frauen ist enorm."
  ];

  describe('testRuleWithIncorrectSingularVerb', () => { for (const s of incorrectSingular) bad(s); });
  describe('testRuleWithCorrectSingularVerb', () => { for (const s of correctSingular) good(s); });
  describe('testRuleWithIncorrectPluralVerb', () => { for (const s of incorrectPlural) bad(s); });
  describe('testRuleWithCorrectPluralVerb', () => { for (const s of correctPlural) good(s); });
  describe('testRuleWithCorrectSingularAndPluralVerb', () => { for (const s of correctSingularAndPlural) good(s); });
});

describe('VerbAgreementRuleTest', () => {
  let rule: VerbAgreementRule;
  beforeAll(() => {
    rule = new VerbAgreementRule(german().messages, lang('de-DE') as German);
  }, 300_000);

  const matches = (s: string): RuleMatch[] => rule.match(lt().analyzeText(s));

  it('testSuggestionSorting', () => {
    const match1 = matches("Wir nenne ihn mal „wild“.");
    expect(match1.length).toBe(1);
    expect('[' + match1[0]!.getSuggestedReplacements().join(', ') + ']')
      .toBe("[Wir nennen, Wir nennten, Er nenne, Sie nenne, Wir nannten, Ich nenne, Es nenne]");
  });

  it('testPositions', () => {
    const match1 = matches("Du erreichst ich unter 12345");
    expect(match1.length).toBe(1);
    expect(match1[0]!.getFromPos()).toBe(3);
    expect(match1[0]!.getToPos()).toBe(16);
    const match2 = matches("Hallo Karl. Du erreichst ich unter 12345");
    expect(match2.length).toBe(1);
    expect(match2[0]!.getFromPos()).toBe(12+3);
    expect(match2[0]!.getToPos()).toBe(12+16);
    const match3 = matches("Ihr könnt das Training abbrechen, weil es nichts bringen wird. Er geht los und sagt dabei: Werde ich machen.");
    expect(match3.length).toBe(1);
    expect(match3[0]!.getFromPos()).toBe(97);
    expect(match3[0]!.getToPos()).toBe(107);

    //Was a FP, now fixed
    const match4 = matches("Mir ist bewusst, dass viele Menschen wie du empfinden.");
    expect(match4.length).toBe(0);
  });

  const good = (s: string) => it('good: ' + s, () => {
    expect(matches(s).map(String), "Got > 0 matches for '" + s + "'").toEqual([]);
  });
  /**
   * assertBad(s), assertBad(s, n), assertBad(s, expectedErrorSubstring),
   * assertBad(s, n, expectedSuggestions...), assertBad(s, expectedSuggestions...) (two or more).
   */
  const bad = (s: string, ...args: (number | string)[]) => it('bad: ' + s + (args.length > 0 ? ' ' + JSON.stringify(args) : ''), () => {
    if (args.length === 1 && typeof args[0] === 'string') {
      const expectedErrorSubstring = args[0];
      expect(matches(s).length).toBe(1);
      const errorMessage = matches(s)[0]!.getMessage();
      expect(errorMessage.includes(expectedErrorSubstring), "Got error '" + errorMessage + "', expected substring '" + expectedErrorSubstring + "'").toBe(true);
      return;
    }
    const expectedMatches = typeof args[0] === 'number' ? args[0] : 1;
    const expectedSuggestions = (typeof args[0] === 'number' ? args.slice(1) : args) as string[];
    const m = matches(s);
    expect(m.length, "Did not find " + expectedMatches + " match(es) in sentence '" + s + "'").toBe(expectedMatches);
    if (expectedSuggestions.length > 0) {
      let match = m[0]!;
      // When two errors are reported by the rule (so TODO above), it might happen that the first match does not have the suggestions, but the second one
      if (m.length > 1 && match.getSuggestedReplacements().length === 0) {
        match = m[1]!;
      }
      expect(match.getSuggestedReplacements()).toEqual(expectedSuggestions);
    }
  });

  describe('testWrongVerb', () => {

    // correct sentences:
    good("*runterguck* das ist aber tief");  // chat style / Inflektiv
    good("Weder Peter noch ich wollen das.");
    good("Du bist in dem Moment angekommen, als ich gegangen bin.");
    good("Kümmere du dich mal nicht darum!");
    good("Ich weiß, was ich tun werde, falls etwas geschehen sollte.");
    good("...die dreißig Jahre jünger als ich ist.");
    good("Ein Mann wie ich braucht einen Hut.");
    good("Egal, was er sagen wird, ich habe meine Entscheidung getroffen.");
    good("Du Beharrst darauf, dein Wörterbuch hätte recht, hast aber von den Feinheiten des Japanischen keine Ahnung!");
    good("Bin gleich wieder da.");
    good("Wobei ich äußerst vorsichtig bin.");
    good("Es ist klar, dass ich äußerst vorsichtig mit den Informationen umgehe");
    good("Es ist klar, dass ich äußerst vorsichtig bin.");
    good("Wobei er äußerst selten darüber spricht.");
    good("Wobei er äußerst selten über seine erste Frau spricht.");
    good("Das Wort „schreibst“ ist schön.");
    good("Die Jagd nach bin Laden.");
    good("Die Unterlagen solltet ihr gründlich durcharbeiten.");
    good("Er reagierte äußerst negativ.");
    good("Max und ich sollten das machen.");
    good("Osama bin Laden stammt aus Saudi-Arabien.");
    good("Solltet ihr das machen?");
    good("Dann beende du den Auftrag und bring sie ihrem Vater.");
    good("- Wirst du ausflippen?");
    good("Ein Geschenk, das er einst von Aphrodite erhalten hatte.");
    good("Wenn ich sterben sollte, wer würde sich dann um die Katze kümmern?");
    good("Wenn er sterben sollte, wer würde sich dann um die Katze kümmern?");
    good("Wenn sie sterben sollte, wer würde sich dann um die Katze kümmern?");
    good("Wenn es sterben sollte, wer würde sich dann um die Katze kümmern?");
    good("Wenn ihr sterben solltet, wer würde sich dann um die Katze kümmern?");
    good("Wenn wir sterben sollten, wer würde sich dann um die Katze kümmern?");
    good("Dafür erhielten er sowie der Hofgoldschmied Theodor Heiden einen Preis.");
    good("Probst wurde deshalb in den Medien gefeiert.");
    good("/usr/bin/firefox");
    good("Das sind Leute, die viel mehr als ich wissen.");
    good("Das ist mir nicht klar, kannst ja mal beim Kunden nachfragen.");
    good("So tes\u00ADtest Du das mit dem soft hyphen.");
    good("Viele Brunnen in Italiens Hauptstadt sind bereits abgeschaltet.");
    good("„Werde ich tun!“");
    good("Könntest dir mal eine Scheibe davon abschneiden!");
    good("Müsstest dir das mal genauer anschauen.");
    good("Kannst ein neues Release machen.");
    good("Sie fragte: „Muss ich aussagen?“");
    good("„Können wir bitte das Thema wechseln, denn ich möchte ungern darüber reden?“");
    good("Er sagt: „Willst du behaupten, dass mein Sohn euch liebt?“");
    good("Kannst mich gerne anrufen.");
    good("Kannst ihn gerne anrufen.");
    good("Kannst sie gerne anrufen.");
    good("Aber wie ich sehe, benötigt ihr Nachschub.");
    good("Wie ich sehe, benötigt ihr Nachschub.");
    good("Einer wie du kennt doch bestimmt viele Studenten.");
    good("Für Sie mache ich eine Ausnahme.");
    good("Ohne sie hätte ich das nicht geschafft.");
    good("Ohne Sie hätte ich das nicht geschafft.");
    good("Ich hoffe du auch.");
    good("Ich hoffe ihr auch.");
    good("Wird hoffen du auch.");
    good("Hab einen schönen Tag!");
    good("Tom traue ich mehr als Maria.");
    good("Tom kenne ich nicht besonders gut, dafür aber seine Frau.");
    good("Tom habe ich heute noch nicht gesehen.");
    good("Tom bezahle ich gut.");
    good("Tom werde ich nicht noch mal um Hilfe bitten.");
    good("Tom konnte ich überzeugen, nicht aber Maria.");
    good("Mach du mal!");
    good("Das bekomme ich nicht hin.");
    good("Dies betreffe insbesondere Nietzsches Aussagen zu Kant und der Evolutionslehre.");
    good("❌Du fühlst Dich unsicher?");
    good("Bringst nicht einmal so etwas Einfaches zustande!");
    good("Bekommst sogar eine Sicherheitszulage");
    good("Dallun sagte nur, dass er gleich kommen wird und legte wieder auf.");
    good("Tinne, Elvis und auch ich werden gerne wiederkommen!");
    good("Du bist Lehrer und weißt diese Dinge nicht?");
    good("Die Frage lautet: Bist du bereit zu helfen?");
    good("Ich will nicht so wie er enden.");
    good("Das heißt, wir geben einander oft nach als gute Freunde, ob wir gleich nicht einer Meinung sind.");
    good("Wir seh'n uns in Berlin.");
    good("Bist du bereit, darüber zu sprechen?");
    good("Bist du schnell eingeschlafen?");
    good("Im Gegenzug bin ich bereit, beim Türkischlernen zu helfen.");
    good("Das habe ich lange gesucht.");
    good("Dann solltest du schnell eine Nummer der sexy Omas wählen.");
    good("Vielleicht würdest du bereit sein, ehrenamtlich zu helfen.");
    good("Werde nicht alt, egal wie lange du lebst.");
    good("Du bist hingefallen und hast dir das Bein gebrochen.");
    good("Mögest du lange leben!");
    good("Planst du lange hier zu bleiben?");
    good("Du bist zwischen 11 und 12 Jahren alt und spielst gern Fußball bzw. möchtest damit anfangen?");
    good("Ein großer Hadithwissenschaftler, Scheich Şemseddin Mehmed bin Muhammed-ül Cezri, kam in der Zeit von Mirza Uluğ Bey nach Semerkant.");
    good("Die Prüfbescheinigung bekommst du gleich nach der bestanden Prüfung vom Prüfer.");
    good("Du bist sehr schön und brauchst überhaupt gar keine Schminke zu verwenden.");
    good("Ist das so schnell, wie du gehen kannst?");
    good("Egal wie lange du versuchst, die Leute davon zu überzeugen");
    good("Du bist verheiratet und hast zwei Kinder.");
    good("Du bist aus Berlin und wohnst in Bonn.");
    good("Sie befestigen die Regalbretter vermittelst dreier Schrauben.");
    good("Meine Familie & ich haben uns ein neues Auto gekauft.");
    good("Der Bescheid lasse im übrigen die Abwägungen vermissen, wie die Betriebsprüfung zu den Sachverhaltsbeurteilungen gelange, die den von ihr bekämpften Bescheiden zugrundegelegt worden seien.");
    good("Die Bildung des Samens erfolgte laut Alkmaion im Gehirn, von wo aus er durch die Adern in den Hoden gelange.");
    good("Michael Redmond (geb. 1963, USA).");
    good("Würd mich sehr freuen drüber.");
    good("Es würd' ein jeder Doktor sein, wenn's Wissen einging wie der Wein.");
    good("Bald merkte er, dass er dank seines Talents nichts mehr in der österreichischen Jazzszene lernen konnte.");
    good("»Alles, was wir dank dieses Projektes sehen werden, wird für uns neu sein«, so der renommierte Bienenforscher.");
    good("Und da wir äußerst Laissez-faire sind, kann man das auch machen.");
    good("Duzen, jemanden mit Du anreden, eine Sitte, die bei allen alten Völkern üblich war.");
    good("Schreibtischtäter wie Du sind doch eher selten.");
    good("Nee, geh du!");
    //good("Nee, mach du das mal.");
    //good("Ein Mädchen, das genauso wie wir war!");  // known false alarm
    //good("Und bin völlig ohne Idee losgelaufen.");  // known false alarm (could be a picky match maybe)
    // incorrect sentences:
    bad("Als Borcarbid weißt es eine hohe Härte auf.");
    bad("Das greift auf Vorläuferinstitutionen bist auf die Zeit von 1234 zurück.");
    bad("Die Eisenbahn dienst überwiegend dem Güterverkehr.");
    bad("Die Unterlagen solltest ihr gründlich durcharbeiten.");
    bad("Peter bin nett.");
    //bad("Solltest ihr das machen?", "Subjekt und Prädikat (Solltest)"); - could be okay in colloquial language (short for "Du solltest ihr das machen")
    bad("Weiter befindest sich im Osten die Gemeinde Dorf.");
    bad("Ich geht jetzt nach Hause, weil ich schon zu spät bin.");
    bad("„Du muss gehen.“");
    bad("Du weiß es doch.");
    bad("Sie sagte zu mir: „Du muss gehen.“");
    bad("„Ich müsst alles machen.“");
    bad("„Ich könnt mich sowieso nicht verstehen.“");
    bad("Er sagte düster: Ich brauchen mich nicht böse angucken.");
    bad("David sagte düster: Ich brauchen mich nicht böse angucken.");
    bad("Ich setzet mich auf den weichen Teppich und kreuzte die Unterschenkel wie ein Japaner.");
    bad("Ich brauchen einen Karren mit zwei Ochsen.");
    bad("Ich haben meinen Ohrring fallen lassen.");
    bad("Ich stehen Ihnen gerne für Rückfragen zur Verfügung.");  });

  describe('testWrongVerbSubject', () => {

    // correct sentences:
    good("Auch morgen lebe ich.");
    good("Auch morgen leben wir noch.");
    good("Auch morgen lebst du.");
    good("Auch morgen lebt er.");
    good("Auch wenn du leben möchtest.");
    good("auf der er sieben Jahre blieb.");
    good("Das absolute Ich ist nicht mit dem individuellen Geist zu verwechseln.");
    good("Das Ich ist keine Einbildung");
    good("Das lyrische Ich ist verzweifelt.");
    good("Den Park, von dem er äußerst genaue Karten zeichnete.");
    good("Der auffälligste Ring ist der erster Ring, obwohl er verglichen mit den anderen Ringen sehr schwach erscheint.");
    good("Der Fehler, falls er bestehen sollte, ist schwerwiegend.");
    good("Der Vorfall, bei dem er einen Teil seines Vermögens verloren hat, ist lange vorbei.");
    good("Diese Lösung wurde in der 64'er beschrieben, kam jedoch nie.");
    good("Die Theorie, mit der ich arbeiten konnte.");
//    good("Die Zeitschrift film-dienst.");
    good("Du bist nett.");
    good("Du kannst heute leider nicht kommen.");
    good("Du lebst.");
    good("Du wünschst dir so viel.");
    good("Er geht zu ihr.");
    good("Er ist nett.");
    good("Er kann heute leider nicht kommen.");
    good("Er lebt.");
    good("Er wisse nicht, ob er lachen oder weinen solle.");
    good("Er und du leben.");
    good("Er und ich leben.");
    good("Falls er bestehen sollte, gehen sie weg.");
//     good("Fest wie unsere Eichen halten allezeit wir stand, wenn Stürme brausen übers Land."); // TODO (remembers "brausen", forgets about "halten")
    good("Heere, des Gottes der Schlachtreihen Israels, den du verhöhnt hast.");
    good("Ich bin");
    good("Ich bin Frankreich!");
    good("Ich bin froh, dass ich arbeiten kann.");
    good("Ich bin nett.");
    good("‚ich bin tot‘"); // TODO 1st token is "‚ich" ?
    good("Ich kann heute leider nicht kommen.");
    good("Ich lebe.");
    good("Lebst du?");
    good("Morgen kommen du und ich.");
    good("Morgen kommen er, den ich sehr mag, und ich.");
    good("Morgen kommen er und ich.");
    good("Morgen kommen ich und sie.");
    good("Morgen kommen wir und sie.");
    good("nachdem er erfahren hatte");
    good("Nett bin ich.");
    good("Nett bist du.");
    good("Nett ist er.");
    good("Nett sind wir.");
    good("Niemand ahnte, dass er gewinnen könne.");
    good("Sie lebt und wir leben.");
    good("Sie und er leben.");
    good("Sind ich und Peter nicht nette Kinder?");
    good("Sodass ich sagen möchte, dass unsere schönen Erinnerungen gut sind.");
    good("Wann ich meinen letzten Film drehen werde, ist unbekannt.");
    good("Was ich tun muss.");
    good("Welche Aufgaben er dabei tatsächlich übernehmen könnte");
    good("wie er beschaffen war");
    good("Wir gelangen zu dir.");
    good("Wir können heute leider nicht kommen.");
    good("Wir leben noch.");
    good("Wir sind nett.");
    good("Wobei wir benutzt haben, dass der Satz gilt.");
    good("Wünschst du dir mehr Zeit?");
    good("Wyrjtjbst du?"); // make sure that "UNKNOWN" is handled correctly
    good("Wenn ich du wäre, würde ich das nicht machen.");
    good("Er sagte: „Darf ich bitten, mir zu folgen?“");
    good("Ja sind ab morgen dabei.");
    good("Oh bin überfragt.");
    // TODO: bad("Er fragte irritiert: „Darf ich fragen, die an dich gerichtet werden, beantworten?“");
    good("Angenommen, du wärst ich.");
    good("Ich denke, dass das Haus, in das er gehen will, heute Morgen gestrichen worden ist.");
    good("Ich hab mein Leben, leb du deines!");
    good("Da freut er sich, wenn er schlafen geht und was findet.");
    good("John nimmt weiter an einem Abendkurs über Journalismus teil.");
    good("Viele nahmen an der Aktion teil und am Ende des rAAd-Events war die Tafel zwar bunt, aber leider überwogen die roten Kärtchen sehr deutlich.");
    good("Musst also nichts machen.");
    good("Eine Situation, wo der Stadtrat gleich mal zum Du übergeht.");
    good("Machen wir, sobald wir frische und neue Akkus haben.");
    good("Darfst nicht so reden, Franz!");
    good("Finde du den Jungen.");
    good("Finde Du den Jungen.");
    good("Kümmerst dich ja gar nicht um sie.");
    good("Könntest was erfinden, wie dein Papa.");
    good("Siehst aus wie ein Wachhund.");
    good("Solltest es mal in seinem Büro versuchen.");
    good("Stehst einfach nicht zu mir.");
    good("Stellst für deinen Dad etwas zu Essen bereit.");
    good("Springst weit, oder?");
    good("Wirst groß, was?");
    // incorrect sentences:
    bad("Auch morgen leben du.");
    bad("Du weiß noch, dass du das gestern gesagt hast.");
    bad("Auch morgen leben du"); // do not segfault because "du" is the last token
    bad("Auch morgen leben er.");
    bad("Auch morgen leben ich.");
    bad("Auch morgen lebte wir noch.");
    bad("Du bin nett.", 2); // TODO 2 errors
    bad("Du können heute leider nicht kommen.");
    bad("Du können heute leider nicht kommen.", "Du könnest", "Du kannst", "Du könntest", "Wir können", "Sie können", "Du konntest");
    bad("Du leben.");
    bad("Du wünscht dir so viel.");
    bad("Er bin nett.", 2);
    bad("Er gelangst zu ihr.", 2);
    bad("Er können heute leider nicht kommen.", "Subjekt (Er) und Prädikat (können)");
    bad("Er lebst.", 2);
    bad("Ich bist nett.", 2);
//     bad("Ich geht jetzt nach Hause und dort gehe ich sofort unter die Dusche."); TODO
    bad("Ich kannst heute leider nicht kommen.", 2);
    bad("Ich leben.");
    bad("Ich leben.", "Ich lebe", "Ich lebte", "Wir leben", "Sie leben");
    bad("Lebe du?");
    bad("Lebe du?", "Lebest du", "Lebst du", "Lebe er", "Lebe es", "Lebtest du", "Lebe ich", "Lebe sie");
    bad("Leben du?");
    bad("Nett bist ich nicht.", 2);
    bad("Nett bist ich nicht.", 2, "bin ich", "bist du", "sei ich", "wäre ich", "war ich");
    bad("Nett sind du.");
    bad("Nett sind er.");
    bad("Nett sind er.", "sind wir", "sei er", "ist er", "sind sie", "wäre er", "war er");
    bad("Nett warst wir.", 2);
    bad("Wir bin nett.", 2);
    bad("Wir gelangst zu ihr.", 2);
    bad("Wir könnt heute leider nicht kommen.");
    bad("Wünscht du dir mehr Zeit?", "Subjekt (du) und Prädikat (Wünscht)");
    bad("Wir lebst noch.", 2);
    bad("Wir lebst noch.", 2, "Wir leben", "Wir lebten", "Du lebst");
    bad("Er sagte düster: „Ich brauchen mich nicht schuldig fühlen.“", 1, "Ich brauche", "Ich brauchte", "Ich bräuchte", "Wir brauchen", "Sie brauchen");
    bad("Er sagte: „Ich brauchen mich nicht schuldig fühlen.“", 1, "Ich brauche", "Ich brauchte", "Ich bräuchte", "Wir brauchen", "Sie brauchen");  });
});

describe('MissingVerbRuleTest', () => {
  let rule: MissingVerbRule;
  beforeAll(() => {
    rule = new MissingVerbRule(german().messages, lang('de-DE') as German);
  }, 300_000);

  const good = (text: string) => it('good: ' + text, () => {
    expect(rule.match(lt().getAnalyzedSentence(text)).length, "Found unexpected error in: '" + text + "'").toBe(0);
  });
  const bad = (text: string) => it('bad: ' + text, () => {
    expect(rule.match(lt().getAnalyzedSentence(text)).length, "Did not find expected error in: '" + text + "'").toBe(1);
  });

  good("Da ist ein Verb, mal so zum testen.");
  good("Überschrift ohne Verb aber doch nicht zu kurz");
  good("Sprechen Sie vielleicht zufällig Türkisch?");
  good("Leg den Tresor in den Koffer im Kofferraum.");
  good("Bring doch einfach deine Kinder mit.");
  good("Gut so.");  // no verb, but very short
  good("Ja!");  // no verb, but very short
  good("Vielen Dank für alles, was Du für mich getan hast.");
  good("Herzlichen Glückwunsch zu Deinem zwanzigsten Geburtstag.");

  bad("Dieser Satz kein Verb.");
  bad("Aus einer Idee sich erste Wortgruppen, aus Wortgruppen einzelne Sätze, aus Sätzen ganze Texte.");
  bad("Ich ein neues Rad.");
  //bad("Ich einen neuen Fehler gefunden.");  // see issue #42
});

describe('MissingCommaRelativeClauseRuleTest', () => {
  let rule: MissingCommaRelativeClauseRule;
  let ruleBehind: MissingCommaRelativeClauseRule;
  beforeAll(() => {
    rule = new MissingCommaRelativeClauseRule(german().messages);
    ruleBehind = new MissingCommaRelativeClauseRule(german().messages, true);
  }, 300_000);

  const noMatch = (input: string, behind = false) => it((behind ? 'behind ' : '') + 'no match: ' + input, () => {
    expect((behind ? ruleBehind : rule).match(lt().getAnalyzedSentence(input)).map(String)).toEqual([]);
  });
  const match = (input: string, from: number, to: number, behind = false) => it((behind ? 'behind ' : '') + 'match: ' + input, () => {
    const matches = (behind ? ruleBehind : rule).match(lt().getAnalyzedSentence(input));
    expect(matches.length).toBe(1);
    expect(matches[0]!.getFromPos()).toBe(from);
    expect(matches[0]!.getToPos()).toBe(to);
  });

  match("Das Auto das am Straßenrand steht parkt im Halteverbot.", 4, 12);
  match("Das Auto das am Straßenrand steht, parkt im Halteverbot.", 4, 12);
  match("Das Auto in dem der Mann sitzt, parkt im Halteverbot.", 4, 15);
  match("Das Auto in dem der Mann sitzt parkt im Halteverbot.", 4, 15);
  match("Die Frau die vor dem Auto steht hat schwarze Haare.", 4, 12);
  match("Die Frau die vor dem Auto steht, hat schwarze Haare.", 4, 12);
  match("Alles was ich habe, ist ein Buch.", 0, 9);

  noMatch("Computer machen die Leute dumm.");
  noMatch("Die Unstimmigkeit zwischen den Geschichten der zwei Unfallbeteiligten war groß.");
  noMatch("Ebenso darf keine schwerere Strafe als die zum Zeitpunkt der Begehung der strafbaren Handlung angedrohte Strafe verhängt werden.");
  noMatch("Als dritte Gruppe lassen sich Aminosäuren fassen, die der Organismus anstelle dieser in Proteine einbaut.");
  noMatch("Selbst wenn das alles perfekt verlustfrei wäre, hätte ich nichts gewonnen.");
  noMatch("Die Studenten, deren Urteil am stärksten von dem der Profis abwich, waren sich sicher, einen guten von einem schlechten unterscheiden zu können.");
  noMatch("Die Studenten, deren Urteil am stärksten durch das der Profis beeinflusst wurde, waren sich sicher, einen guten von einem schlechten unterscheiden zu können.");

  // rule = new MissingCommaRelativeClauseRule(TestTools.getMessages("de"), true);

  match("Das Auto, das am Straßenrand steht parkt im Halteverbot.", 29, 40, true);
  match("Das Auto, in dem der Mann sitzt parkt im Halteverbot.", 26, 37, true);
  match("Die Frau, die vor dem Auto steht hat schwarze Haare.", 27, 36, true);
  match("Alles, was ich habe ist ein Buch.", 15, 23, true);
  match("In diesem Prozess sind aber Entwicklungsschritte ja integriert, die wir Psychiater glaube ich auch gut kennen.", 72, 93, true);
  match("Alles, was du für die Spieße brauchst sind Tortellini, getrocknete Tomaten, Cherrytomaten und Mozzarellakugeln.", 29, 42, true);

  noMatch(".... das war eher so das, was alle im Browser deaktiviert hatten, weil man dachte, über Javascript wird irgendwie Schadsoftware eingeschleust.", true);
  noMatch("Ich habe einige Fehler begangen, die ich vermeiden hätte können sollen.", true);
  noMatch("Doch die Rolle, die Mohammed bin Salman in Riad spielt, ist zwiespältig.", true);
  noMatch("Laut Josef Peter Burg gehörte das Haus, aus dem er samt Familie geworfen wurde, Werner und Sigrid Bahlke, während er darin wohnte und darauf aufpasste.", true);
  noMatch("Darüber hinaus stellt die klassische Metaphysik eine Grundfrage, die sich etwa wie folgt formulieren lässt: Warum ist überhaupt Seiendes und nicht vielmehr Nichts?", true);
  noMatch("Wenn du alles, was du meinst nicht zu können, von anderen erledigen lässt, wirst du es niemals selbst lernen.", true);
  noMatch("Er hat einen Zeitraum durchlebt, in dem seine Gedanken verträumt auf den weiten Feldern der Mysterien umherirrten.", true);
  noMatch("Es ist die Wiederkehr der Panikmache, die der neue Nationalismus mit dem der Sprachreiniger verbindet und die Geschichte der Sprachreinigung zu einem Lehrstück macht.", true);
  noMatch("Gesuche können von Institutionen, Organisationen, Vereinen und Gruppierungen gestellt werden, die im Kanton Luzern domiziliert sind.", true);
  noMatch("Die Klausel kann zudem nur Gleichrang mit Verbindlichkeiten des Schuldners herstellen, die vom Gesetz in der Insolvenz nicht privilegiert sind, so dass die Klausel nichts an der gesetzlich vorgesehenen Rangfolge im Insolvenzverfahren ändert.", true);
  noMatch("Plan von Maßnahmen, mit denen das Ansteckungsrisiko während des Aufenthalts an einem Ort verringert werden soll", true);
  noMatch("Aus diesem Grund sind die Wörter nicht direkt übersetzt, stattdessen wird der Zustand oder die Situation beschrieben in der die Wörter benutzt werden.", true);
  noMatch("Kryptographisch sichere Verfahren sind dann solche, für die es keine bessere Methode zum Brechen der Sicherheit als das Faktorisieren einer großen Zahl gibt, insbesondere kann der private nicht aus dem öffentlichen Schlüssel errechnet werden.", true);
  noMatch("Wayne Jancik begrenzt seine One-Hit-Wonders in den USA auf die Billboard-Top-40-Pop-Hitparade mit einer „Ruhe-Periode“ von 5 Jahren, innerhalb derer kein weiterer Hit desselben Interpreten in die Top 40 gelangen darf.", true);
  noMatch("Nach dem Abzug russischer Truppen aus der Region Kiew sind in den ehemals besetzten und umkämpften ukrainischen Gebieten inzwischen Hunderte Leichen von Bewohnern gefunden worden.", true);
  noMatch("Bei der Installation werden Ihnen Sticker und Aufkleber zur Verfügung gestellt, die Sie anstelle der traditionellen Emojis verwenden können.", true);
  noMatch("»Alles, was wir dank dieses Projektes sehen werden, wird für uns neu sein«, so der renommierte Bienenforscher.", true);
});

describe('CompoundInfinitivRuleTest', () => {
  let rule: CompoundInfinitivRule;
  let ltDe: JLanguageTool;
  beforeAll(() => {
    const germanLang = lang('de');
    rule = new CompoundInfinitivRule(german().messages, germanLang, null);
    ltDe = new JLanguageTool(germanLang);
  }, 300_000);

  const count = (input: string, n: number) => it(n + ': ' + input, () => {
    expect(rule.match(ltDe.getAnalyzedSentence(input)).length).toBe(n);
  });

  count("Ich brachte ihn dazu, mein Zimmer sauber zu machen.", 1);
  count("Du brauchst nicht bei mir vorbei zu kommen.", 1);
  count("Ich ging zur Seite, um die alte Dame vorbei zu lassen.", 1);

  count("Seine Frau gab vor zu schlafen.", 0);
  count("Mein Herz hörte auf zu schlagen.", 0);
  count("Den Sonnenaufgang von einem Berggipfel aus zu sehen, ist eine Wonne.", 0);
  count("Hör auf zu schreien", 0);
  count("Sie riss sich zusammen und fing wieder an zu reden.", 0);
  count("Fang an zu zählen.", 0);
  count("Er hatte nichts weiter zu sagen", 0);
  count("Sie strengte sich an zu schwimmen.", 0);
  count("Er erhob sich von dem Stuhl, auf dem er gesessen hatte, und begann im Zimmer auf und ab zu schreiten.", 0);
  count("Tom stand auf und fing an, auf und ab zu gehen.", 0);
  count("Aber um auf Nummer sicher zu gehen, schrieb er es auf.", 0);
  count("Sie scheint aus Spanien heraus zu kaufen.", 0);
  count("Hab keine Lust, mir Gedanken darüber zu machen.", 0);
  count("Fang an zu lesen, wo du aufgehört hast.", 0);
  count("Fang dort an zu lesen, wo du aufgehört hast.", 0);
  count("Der diensthabende Kollege hatte ganz schön zu tun.", 0);
});
