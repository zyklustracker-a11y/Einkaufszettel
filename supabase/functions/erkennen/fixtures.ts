/**
 * Die beiden echten Bons, an denen die Erkennung gescheitert ist.
 *
 * ---------------------------------------------------------------------------
 * WAS HIER VERLÄSSLICH IST — UND WAS NICHT
 * ---------------------------------------------------------------------------
 *
 * **Verlässlich** sind die Kopf- und Fußangaben. Sie stehen groß und einzeln auf
 * dem Papier und sind auf den Fotos zweifelsfrei zu lesen: Händlername,
 * Anschrift, Datum, Uhrzeit, die Gesamtsumme, der Steuerblock und die
 * Postenzahl. Sie sind unten als `erwartet` festgehalten, und die Tests prüfen
 * gegen sie.
 *
 * **Nicht verlässlich** sind die einzelnen Zeilenbeträge. Beide Bons liegen auf
 * den Fotos quer, die Schrift ist klein, und einzelne Ziffern sind nicht
 * zweifelsfrei zu unterscheiden — genau das ist ja das Problem, um das es hier
 * überhaupt geht. Die Zeilen unten sind deshalb eine **Abschrift nach bestem
 * Lesen** und ausdrücklich keine Wahrheit:
 *
 *     Edeka:  gelesen 120,57 €  ·  gedruckt 120,67 €  ·  0,10 € Unterschied
 *     toom:   gelesen  80,75 €  ·  gedruckt  87,75 €  ·  7,00 € Unterschied
 *
 * Beim Edeka-Bon nennt der Bon außerdem 35 Posten, gelesen sind 32.
 *
 * ---------------------------------------------------------------------------
 * WAS DER STEUERBLOCK VERRÄT — und was noch zu klären ist
 * ---------------------------------------------------------------------------
 *
 * Der MwSt-Block am Bonfuß ist auf beiden Fotos gut lesbar und seine Klassen
 * ergeben exakt die gedruckte Summe. Damit lässt sich die Lücke **eingrenzen**,
 * statt nur „irgendwo fehlen 2,80 €" zu sagen:
 *
 *     toom    7 %:  abgetippt 52,48  ·  gedruckt 59,48  →  7,00 € fehlen
 *     toom   19 %:  abgetippt 28,27  ·  gedruckt 28,27  →  stimmt genau ✓
 *
 *     Edeka   A (7 %):  gelesen 94,22  ·  gedruckt 96,22  →  2,00 € fehlen
 *     Edeka   B (19 %): gelesen 26,35  ·  gedruckt 24,45  →  1,90 € zu viel
 *
 * Beim toom-Bon ist damit **eine einzige Zeile** offen: In der 7-%-Klasse fehlen
 * genau 7,00 €.
 *
 * Beim Edeka-Bon sagen die beiden Zahlen zusammen etwas Genaueres, als eine
 * Gesamtdifferenz je könnte: **In der 19-%-Klasse steht 1,90 € zu viel, in der
 * 7-%-Klasse fehlen 2,00 €.** Verschöbe man einen Betrag von 1,90 € von B nach
 * A, ginge B genau auf und A wäre noch 0,10 € kurz — also genau die
 * Gesamtdifferenz. Es fehlt damit **keine Zeile**; eine Nicht-Lebensmittel-Zeile
 * ist um 1,90 € zu hoch gelesen, und irgendwo stecken 0,10 € Lesefehler.
 * Kandidaten sind `E.MUELLSACK 5,99` und `COTT.TOILETTENPAP. 3,55` — in einer
 * früheren Lesung standen dort 2,79 und 5,99.
 *
 * ---------------------------------------------------------------------------
 * WARUM DAS TROTZDEM BRAUCHBARE FIXTURES SIND
 * ---------------------------------------------------------------------------
 *
 * Weil sie zwei verschiedene Dinge prüfen, und für keins davon müssen die
 * Beträge stimmen:
 *
 *   1. **Das Zerlegen.** Ob aus „4250787606599 2,000 STK a 5,99 Calibrachoa-Mix
 *      11,98 7" eine Position mit Menge 2, Einzelpreis 5,99 und Kennzeichen 7
 *      wird, hängt an der Form der Zeile, nicht an ihrem Betrag. Dasselbe gilt
 *      für die Bonfuß-Zeilen, die Postenzahl und den Steuerblock.
 *
 *   2. **Das Verhalten bei Lücken.** Ein Bon, dessen Positionen nicht auf die
 *      gedruckte Summe kommen, ist genau der Fall, den die App seit Schritt 18
 *      können muss: warnen, ins Formular lassen, nicht ablehnen. Die
 *      unvollständige Abschrift ist dafür kein Mangel, sondern der Testfall.
 *
 * Was diese Fixtures **nicht** belegen können, ist die Erkennungsqualität des
 * Modells auf den echten Fotos. Dafür braucht es einen Scan mit den Bildern
 * selbst; kein Test im Repository kann das ersetzen.
 *
 * **Wenn die tatsächlichen Beträge vorliegen:** hier eintragen und in
 * `erwartet.summeStimmt` auf `true` stellen. Der Test daneben prüft dann
 * zusätzlich, dass Positionssumme und gedruckte Summe übereinstimmen.
 */

import type { ModelReceipt } from './validate.ts'

export interface Fixture {
  /** Wie die Antwort des Modells aussehen soll. */
  model: ModelReceipt
  /** Der Tag, gegen den die Datumsprüfung läuft. */
  today: string
  erwartet: {
    haendler: string
    datum: string
    /** Die gedruckte Gesamtsumme in Cent. */
    summeCent: number
    /** Die auf dem Bon gedruckte Postenzahl, falls es eine gibt. */
    posten: number | null
    /**
     * Ergeben die abgetippten Zeilen die gedruckte Summe?
     *
     * Bei beiden Bons `false` — siehe den Dateikopf. Auf `true` stellen, sobald
     * die Zeilen stimmen.
     */
    summeStimmt: boolean
  }
}

/* ============================================================ Edeka / Schmidts */

/**
 * Schmidts Märkte GmbH, Bad Säckingen — 35 Posten, 120,67 €.
 *
 * Der Bon, mit dem alles anfing: Bei ihm blieb der Fortschritt bei 80 % stehen
 * und die App meldete „Die Antwort der Erkennung war unbrauchbar".
 *
 * Zwei Zeilen sind hier besonders: `PFAND 0,15*A` (das Sternchen ist eine
 * Kassen-Eigenheit und kein Betrag) und zwei Mengenzeilen in der Edeka-Form
 * „0,99 € x 2" — der Preis steht **vor** der Stückzahl, anders als überall
 * sonst.
 */
export const EDEKA: Fixture = {
  today: '2026-08-17',
  model: {
    lesbar: true,
    haendler: 'Schmidts Märkte GmbH',
    datum: '2026-07-16',
    uhrzeit: '20:14',
    waehrung: 'EUR',
    summe_cent: 12067,
    posten: 35,
    steuerblock: [
      { kennzeichen: 'A', brutto_cent: 9622 },
      { kennzeichen: 'B', brutto_cent: 2445 },
    ],
    /*
     * ---------------------------------------------------------------------
     * DIESE ZEILEN SIND DIE ECHTE MODELLANTWORT — nicht meine Abschrift.
     * ---------------------------------------------------------------------
     *
     * Bis hierher stand hier, was sich vom Foto ablesen ließ. Seit dem vierten
     * echten Scan gibt es etwas Besseres: die tatsächliche Antwort des Modells
     * auf das aufbereitete Bild, wörtlich übernommen.
     *
     * Der Unterschied ist die **Herkunft**. Eine Abschrift vom gedrehten Foto
     * ist meine Vermutung darüber, was dasteht; diese Zeilen sind das, was die
     * Kette wirklich liefert. Damit prüft das Fixture den Parser gegen echte
     * Eingaben statt gegen nachgebaute — und die beiden Zeilen, an denen der
     * Parser zuletzt gescheitert ist (`PFAND 0,15*A` mit Sternchen, `AN` als
     * Kennzeichen), stehen so drin, wie sie ankamen.
     *
     * Fehlerfrei ist auch diese Fassung nicht — siehe den Dateikopf. Aber sie
     * ist nachvollziehbar falsch statt vermutet falsch.
     */
    zeilen: [
      'BIO SCHROZB.EIS               5,99 A',
      'BIO ALNA.TOM.SAUCE            3,29 A',
      'BIO ALNA.SAUCE                3,79 A',
      'CAREFR.SLIPEINL.              2,95 B',
      'DANKE TOIL-PAPIER             3,99 B',
      'G&G FARB.SCH.TUE              3,29 B',
      'BIO SWM SCHL.SAHNE            3,99 A',
      // Das Sternchen ist ein Vermerk der Kasse. Es hat den Parser zerlegt.
      'PFAND                        0,15*A',
      'BIO ALNA.D.BR 0,99 € x 2     1,98 A',
      'G&G PACKBAND                  2,79 B',
      'BIO ALNA.FETA                2,99 A',
      'ALTERN.B.ZIEG.KAESE          3,99 A',
      'HERT.MOZZARELLA              1,99 A',
      'UHU SEKUNDENKLEBER           3,79 B',
      'HERZ.WILDHEIDELBE            6,99 A',
      'NIERST.SCHAFSMILCH           3,99 A',
      // „AN" ist kein Steuersatz — der Satz ist das „A".
      'DEMETER BANANEN               1,77 AN',
      'BIO ALNA.JOGHURT             2,79 A',
      'E.MUELLSACK                  5,99 B',
      'COTT.TOILETTENPAP.           3,55 B',
      'BIO AND.CAMENBERT            3,79 A',
      'BIOD NEKTARINEN              4,99 A',
      'BIO TRAUBEN                  2,99 A',
      'BIO UHB ZWIEBELN             2,29 A',
      'BIO ALN.SCHAFQUARK           2,29 A',
      'BIO E.SCHMAND 0,89 € x 2     1,78 A',
      'BIO AVOCADOS 2,49 € x 2      4,98 A',
      'G&G MACADAMIAS               3,49 A',
      'CH APPENZELL.EXTRA           5,42 A',
      'APRIKOSEN                    2,99 A',
      'WASSERMEL.KERNARM           12,02 AN',
      'PAPAYA                       3,49 A',
    ],
    unsichere_zeilen: [],
  },
  erwartet: {
    haendler: 'Schmidts Märkte GmbH',
    datum: '2026-07-16',
    summeCent: 12067,
    posten: 35,
    summeStimmt: false,
  },
}

/* ==================================================================== toom */

/**
 * toom Baumarkt GmbH, Bad Säckingen — 87,75 €, bezahlt am 02.07.2026.
 *
 * Der Bon, an dem der **Zeilen-Parser** gescheitert wäre, selbst wenn das
 * Modell perfekt gelesen hätte: Jede Zeile endet auf einen Steuersatz als
 * Ziffer (`7`, `19`), und bis Schritt 18 verhinderte genau das den Treffer für
 * den Betrag am Zeilenende. Der ganze Bon hätte null Positionen ergeben.
 *
 * Dazu die Baumarkt-Form der Mengenzeile: Artikelnummer, Menge, Einheit, „a",
 * Einzelpreis, **dann** erst der Name.
 */
export const TOOM: Fixture = {
  today: '2026-08-17',
  model: {
    lesbar: true,
    haendler: 'toom Baumarkt GmbH',
    datum: '2026-07-02',
    uhrzeit: '10:32',
    waehrung: 'EUR',
    summe_cent: 8775,
    posten: null,
    /*
     * KORRIGIERT: Hier standen 2376 und 5559 — das sind die **Netto**-Beträge
     * aus dem MwSt-Block, nicht die Brutto-Beträge. Der Bon druckt je Klasse
     * „Netto-Entgelt" und „MwSt-Betrag" getrennt; gebraucht wird ihre Summe:
     *
     *     19 %:  23,76 netto + 4,51 MwSt = 28,27 brutto
     *      7 %:  55,59 netto + 3,89 MwSt = 59,48 brutto
     *                                      ─────────────
     *                                      87,75 = die gedruckte Summe
     *
     * Dass die beiden Klassen exakt die Gesamtsumme ergeben, ist die Probe —
     * und sie geht nur mit den Brutto-Werten auf. Der Test daneben prüft das.
     */
    steuerblock: [
      { kennzeichen: '19', brutto_cent: 2827 },
      { kennzeichen: '7', brutto_cent: 5948 },
    ],
    zeilen: [
      '4250787606599 2,000 STK a 5,99 Calibrachoa-Mix 11,98 7',
      '4260747080109 2,000 STK a 3,99 DIANTHUS PINK KI 7,98 7',
      '4388950829864 1,000 STK LAVENDEL WEISS 2,99 7',
      '4011260281111 1,000 STK ANTIRRHINUM 2,99 7',
      '4388601233714 1,000 STK ROSENBEGLEITSTAU 2,99 7',
      '4260767805964 1,000 STK KRAEUTER-DIP 8,99 7',
      '4388608687754 1,000 STK BASILIKUM NT BIO 4,29 7',
      '5701952006175 1,000 STK PETERSILIE, KRAU 2,99 7',
      '4388860687774 1,000 STK Gartenhandschuh 3,29 19',
      '4260767805966 1,000 STK KRAEUTER-DIP 2,99 7',
      '8054392600210 1,000 STK Kraeuter Mix 4,29 7',
      // 19 und nicht 7: Erst damit ergeben die 19-%-Zeilen (3,29 + 9,99 + 14,99)
      // exakt die gedruckten 28,27 € dieser Klasse. Ein Fliegengitter ist auch
      // sachlich kein ermäßigter Posten.
      '4063565596247 1,000 STK FLIEGENGITTERTU 9,99 19',
      '4042448169419 1,000 STK Klett für Fenste 14,99 19',
    ],
    unsichere_zeilen: [],
  },
  erwartet: {
    haendler: 'toom Baumarkt GmbH',
    datum: '2026-07-02',
    summeCent: 8775,
    posten: null,
    summeStimmt: false,
  },
}
