-- ============================================================================
-- Receipt AI — Schritt 15: Benachrichtigungen wieder entfernen
--
-- Ausführen im SQL-Editor, nachdem 0011 gelaufen ist. Die Datei läuft in einer
-- Transaktion und ist mehrfach ausführbar.
--
-- ---------------------------------------------------------------------------
-- WARUM ES DIESE DATEI GIBT
-- ---------------------------------------------------------------------------
--
-- Schritt 13 hat den Monatsreport als Push-Benachrichtigung gebaut. Der Nutzer
-- will ihn nicht: **Eine Nachricht im Monat rechtfertigt weder die Einrichtung
-- noch den Schalter in den Einstellungen.** Das ist eine Entscheidung über den
-- Umfang und kein Fehler im Gebauten — deshalb wird auch nichts „repariert",
-- sondern zurückgenommen.
--
-- Die vorige Migration wird **nicht** verändert. Sie ist bereits ausgeführt, und
-- eine Migration nachträglich umzuschreiben hieße, dass zwei Datenbanken mit
-- derselben Dateiliste verschieden aussehen könnten. Was einmal lief, bleibt
-- stehen; rückgängig macht es die nächste Datei.
--
-- ---------------------------------------------------------------------------
-- WAS VERSCHWINDET
-- ---------------------------------------------------------------------------
--
--   * `push_subscriptions` — die Abos je Gerät.
--   * `v_last_month_report` — die Zahlen des Vormonats für die Meldung.
--   * `mark_report_sent()` — der Sendevermerk.
--
-- **Es gehen keine Bon-Daten verloren.** Die drei Dinge oben waren ausschließlich
-- für den Versand da; Bons, Produkte, Preise und Auswertungen berührt diese
-- Datei nicht. Wer die Vormonatszahlen sehen will, findet sie unverändert in den
-- Analysen — sie kamen ohnehin aus `v_month_summary`.
--
-- Zum Aufräumen gehören auch die Secrets, die nur der Report brauchte. Sie
-- stehen in Supabase und nicht hier; die Liste steht in `supabase/README.md`.
-- ============================================================================

begin;

drop view     if exists public.v_last_month_report;
drop function if exists public.mark_report_sent(text, date);
drop table    if exists public.push_subscriptions;

notify pgrst, 'reload schema';

commit;
