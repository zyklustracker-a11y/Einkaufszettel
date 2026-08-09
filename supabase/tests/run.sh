#!/usr/bin/env bash
#
# Die Auswertungs-Sichten gegen selbst erzeugte Testdaten prüfen.
#
# Alles, was in `supabase/migrations/` steht, ist reine SQL-Logik: Summen,
# Vergleiche, Zeitfenster, Schwellen. Genau die Sorte Regel, die sich mit Tests
# festnageln lässt — und genau die Sorte, die sich mit einer fast leeren
# Datenbank NICHT von Hand prüfen lässt, weil der interessante Fall (vier
# Einkäufe, zwei Läden, ein Sonderangebot) darin gar nicht vorkommt.
#
# Deshalb dieser Weg: eine wegwerfbare Datenbank auf dem eigenen Rechner, die
# Migrationen der Reihe nach hinein, Testdaten dazu, und dann die Prüfungen aus
# `checks.sql`. Sie laufen als Rolle `pruefer` und damit unter derselben
# Zeilensicherheit wie die App.
#
# Voraussetzung: eine laufende PostgreSQL-Instanz, auf die `psql` als Superuser
# kommt. Aufruf:
#
#     npm run test:sql
#
# Die Datenbank heißt `receipt_ai_test` und wird bei jedem Lauf neu angelegt.

set -euo pipefail

DB="${RECEIPT_TEST_DB:-receipt_ai_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PSQL_ADMIN=(psql --quiet --no-psqlrc -v ON_ERROR_STOP=1)

# `postgres` als Wartungsdatenbank: Aus ihr heraus lässt sich die Testdatenbank
# löschen und neu anlegen.
"${PSQL_ADMIN[@]}" -d postgres -c "drop database if exists ${DB} with (force)" >/dev/null
"${PSQL_ADMIN[@]}" -d postgres -c "create database ${DB}" >/dev/null

run() {
  "${PSQL_ADMIN[@]}" -d "${DB}" -f "$1" >/dev/null
}

echo "→ Supabase-Umgebung nachbauen"
run "${ROOT}/supabase/tests/00_supabase_stub.sql"

echo "→ Migrationen"
for file in "${ROOT}"/supabase/migrations/*.sql; do
  echo "   $(basename "${file}")"
  run "${file}"
done

# Die Rolle `pruefer` muss auf alles kommen, was die Migrationen angelegt haben.
# `grant … on all tables` in 0001 wirkt nur auf das, was es zu dem Zeitpunkt
# schon gab — spätere Migrationen vergeben ihre Rechte selbst, aber die
# Testrolle bekommt sie hier gesammelt.
"${PSQL_ADMIN[@]}" -d "${DB}" -c "
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
" >/dev/null

echo "→ Testdaten"
run "${ROOT}/supabase/tests/fixtures.sql"

echo "→ Prüfungen"
"${PSQL_ADMIN[@]}" -d "${DB}" -f "${ROOT}/supabase/tests/checks.sql"

echo "Alle Prüfungen bestanden."
