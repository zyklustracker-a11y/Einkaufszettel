-- ============================================================================
-- Receipt AI — Schritt 19: Positionen ohne Zuordnung nachpflegen
--
-- Ausführen im SQL-Editor, nach 0015. Läuft in einer Transaktion und ist
-- mehrfach ausführbar.
--
-- ---------------------------------------------------------------------------
-- DAS EINZIGE LOSE ENDE IM DATENBESTAND
-- ---------------------------------------------------------------------------
--
-- Eine Position ohne Kategorie bekommt kein kanonisches Produkt (PROJEKT.md:
-- „Eine Position ohne Kategorie bekommt kein Produkt", und raten ist auch dem
-- Code verboten). Sie zählt in die Monatssumme, aber in keinen Kategorietopf,
-- in keinen Preisvergleich und in keinen Rhythmus. Der Korrektur-Screen sagt
-- **vor** dem Speichern, wie viele Zeilen das betrifft — danach tauchte die
-- Auskunft nirgends wieder auf. Wer sie damals durchgewinkt hat, fand sie nie
-- wieder.
--
-- Das ist die einzige Stelle, an der Datenqualität dauerhaft verlorengeht: Alles
-- andere wächst mit jedem Bon von selbst zusammen. Deshalb hier eine Sicht, die
-- die offenen Rohtexte sammelt, und eine Funktion, die einen davon in einem
-- Rutsch zuordnet.
--
-- ---------------------------------------------------------------------------
-- WARUM ÜBER DEN ROHTEXT UND NICHT ÜBER DIE EINZELNE ZEILE
-- ---------------------------------------------------------------------------
--
-- „G&G H-MILCH 1,5%" steht auf zwölf Bons. Zwölfmal dasselbe zuzuordnen wäre
-- Arbeit ohne Erkenntnis — und genau dafür gibt es `product_mappings`. Die
-- Funktion ordnet deshalb **den Rohtext** zu und zieht alle Zeilen mit, die ihn
-- tragen. Das ist derselbe Lernkreis wie beim Speichern eines Bons, nur
-- nachträglich angestoßen.
--
-- Die Zuordnung wird als `quelle = 'user'` geschrieben. Damit gilt die Regel aus
-- Schritt 4b-2: Eine bestehende Nutzerkorrektur wird nie auf `model`
-- zurückgestuft, und ein Modellvorschlag fasst sie nicht mehr an.
--
-- ---------------------------------------------------------------------------
-- WAS AUSSERDEM VERSCHWINDET
-- ---------------------------------------------------------------------------
--
--   * `v_product_merchant_latest` — sie belieferte die Händlerliste unter jeder
--     Bestpreis-Karte. Bei zwei Läden war das eine Zeile Auskunft auf drei
--     Zeilen Fläche; die Liste ist aus der Oberfläche entfernt, die Sicht wäre
--     damit tote Leitung. Der vollständige Verlauf steht unverändert im
--     Produkt-Detail.
--   * Die Töpfe `custom` aus `v_spending_trend` — der Reiter „Eigen" zeigte die
--     letzten vierzehn Tage in zwei Balken und war an nichts anpassbar.
-- ============================================================================

begin;

/* ------------------------------------------- 1. Was ist überhaupt noch offen */

-- Gruppiert über den Rohtext, weil genau der zugeordnet wird. Pfand- und
-- Rabattzeilen sind ausgenommen: Ihnen fehlt kein Produkt, sie sind keines.
create or replace view public.v_unassigned_items
with (security_invoker = true) as
select
  i.household_id,
  btrim(ri.raw_text)                    as raw_text,
  min(i.product_name)                   as sample_name,
  count(*)::int                         as item_count,
  sum(i.total_cents)::bigint            as amount_cents,
  min(i.purchased_on)                   as first_purchased_on,
  max(i.purchased_on)                   as last_purchased_on
from public.v_items i
join public.receipt_items ri
  on ri.id = i.item_id and ri.household_id = i.household_id
where i.canonical_product_id is null
  and not i.is_adjustment
  and btrim(ri.raw_text) <> ''
group by i.household_id, btrim(ri.raw_text);

comment on view public.v_unassigned_items is
  'Rohtexte ohne kanonisches Produkt, gruppiert — die Nachpflege in den Einstellungen.';


/* ------------------------------------------------- 2. Einen Rohtext zuordnen */

/*
 * Läuft mit den Rechten des **Aufrufers**, wie `save_receipt`. In einen fremden
 * Haushalt kann sie damit gar nicht schreiben, und das verhindert die Datenbank
 * und nicht der Code — dieselbe Linie wie überall sonst.
 *
 * Gibt zurück, wie viele Positionen dabei zugeordnet wurden.
 */
create or replace function public.assign_raw_text(
  p_raw_text text,
  p_name     text,
  p_category text,
  p_traits   text[] default '{}'
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_household uuid;
  v_raw       text := btrim(coalesce(p_raw_text, ''));
  v_name      text := btrim(coalesce(p_name, ''));
  v_category  text := nullif(btrim(coalesce(p_category, '')), '');
  v_product   uuid;
  v_count     integer;
begin
  select hm.household_id into v_household
  from public.household_members hm
  where hm.user_id = auth.uid()
  limit 1;

  if v_household is null then
    raise exception 'Zu diesem Konto gehört noch kein Haushalt.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_raw = '' or v_name = '' or v_category is null then
    raise exception 'Rohtext, Name und Kategorie sind alle drei nötig.'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1 from public.categories c
    where c.household_id = v_household and c.key = v_category
  ) then
    raise exception 'Diese Kategorie gibt es in deinem Haushalt nicht.'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * Der Rohtext muss wirklich offen sein. Ohne diese Prüfung legte ein Aufruf
   * mit einem Text, den es gar nicht gibt, stillschweigend ein Produkt an, das
   * an keiner Position hängt — eine Karteileiche, die dann in Bestpreisen und
   * Kategorien mitzählte. Die Funktion pflegt nach, sie legt nichts Neues an.
   */
  if not exists (
    select 1
    from public.receipt_items ri
    where ri.household_id = v_household
      and ri.canonical_product_id is null
      and lower(btrim(ri.raw_text)) = lower(v_raw)
  ) then
    raise exception 'Zu diesem Text gibt es keine offene Position mehr.'
      using errcode = 'no_data_found';
  end if;

  -- Ein Klarname, ein Produkt — dieselbe Regel wie in `save_receipt`.
  select cp.id into v_product
  from public.canonical_products cp
  where cp.household_id = v_household
    and lower(btrim(cp.name)) = lower(v_name)
  limit 1;

  if v_product is null then
    insert into public.canonical_products (household_id, name, category_key)
    values (v_household, v_name, v_category)
    returning id into v_product;
  else
    -- Der Nutzer entscheidet ausdrücklich, also schreibt die Kategorie durch.
    update public.canonical_products cp
       set category_key = v_category
     where cp.id = v_product and cp.household_id = v_household;
  end if;

  -- Merkmale ersetzen statt ergänzen: Was im Blatt steht, gilt.
  delete from public.canonical_product_traits cpt
   where cpt.household_id = v_household and cpt.canonical_product_id = v_product;

  insert into public.canonical_product_traits (household_id, canonical_product_id, trait_id)
  select v_household, v_product, t.id
  from public.traits t
  where t.household_id = v_household
    and t.key = any(coalesce(p_traits, '{}'))
  on conflict do nothing;

  -- Das Gedächtnis: ab jetzt erkennt die App diesen Rohtext von selbst.
  insert into public.product_mappings (household_id, raw_text, canonical_product_id, source)
  values (v_household, v_raw, v_product, 'user')
  on conflict (household_id, lower(btrim(raw_text)))
  do update set canonical_product_id = excluded.canonical_product_id,
                source               = 'user';

  -- Und rückwirkend jede Zeile, die den Rohtext trägt und noch offen ist.
  update public.receipt_items ri
     set canonical_product_id = v_product
   where ri.household_id = v_household
     and ri.canonical_product_id is null
     and lower(btrim(ri.raw_text)) = lower(v_raw);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.assign_raw_text(text, text, text, text[]) is
  'Ordnet einen Rohtext nachträglich einem Produkt zu — samt Lernkreis und '
  'allen bereits gespeicherten Positionen mit diesem Text.';

revoke all on function public.assign_raw_text(text, text, text, text[]) from public;
grant execute on function public.assign_raw_text(text, text, text, text[]) to authenticated;


/* -------------------------------------------- 3. Der Zeitraum „Eigen" fällt weg */

create or replace view public.v_spending_trend
with (security_invoker = true) as
with buckets as (
  -- Woche: Montag bis Sonntag der laufenden Woche, ein Topf je Tag.
  select
    'week'::text                                     as range_id,
    g.i                                              as bucket_index,
    (date_trunc('week', current_date)::date + g.i)   as bucket_start,
    (date_trunc('week', current_date)::date + g.i)   as bucket_end
  from generate_series(0, 6) as g(i)

  union all

  -- Monat: die Kalenderwochen, die den laufenden Monat berühren, an den
  -- Monatsgrenzen abgeschnitten.
  select
    'month',
    g.i,
    greatest(
      date_trunc('week', date_trunc('month', current_date))::date + g.i * 7,
      date_trunc('month', current_date)::date
    ),
    least(
      date_trunc('week', date_trunc('month', current_date))::date + g.i * 7 + 6,
      (date_trunc('month', current_date) + interval '1 month - 1 day')::date
    )
  from generate_series(0, 5) as g(i)
  where date_trunc('week', date_trunc('month', current_date))::date + g.i * 7
        <= (date_trunc('month', current_date) + interval '1 month - 1 day')::date

  union all

  -- Jahr: die letzten sechs Monate, der laufende zuletzt.
  select
    'year',
    g.i,
    (date_trunc('month', current_date) - make_interval(months => 5 - g.i))::date,
    (date_trunc('month', current_date) - make_interval(months => 5 - g.i)
      + interval '1 month - 1 day')::date
  from generate_series(0, 5) as g(i)
)
select
  h.id                                    as household_id,
  b.range_id,
  b.bucket_index,
  b.bucket_start,
  b.bucket_end,
  extract(week from b.bucket_start)::int  as iso_week,
  (
    coalesce(s.amount_cents, 0) + coalesce(t.tip_cents, 0)
  )::bigint                               as amount_cents
from public.households h
cross join buckets b
left join lateral (
  select sum(i.total_cents) as amount_cents
  from public.v_items i
  where i.household_id = h.id
    and i.purchased_on between b.bucket_start and b.bucket_end
) s on true
left join lateral (
  select sum(v.tip_cents) as tip_cents
  from public.v_tips v
  where v.household_id = h.id
    and v.purchased_on between b.bucket_start and b.bucket_end
) t on true;


/* -------------------------------------------------- 4. Tote Leitung abräumen */

drop view if exists public.v_product_merchant_latest;

grant select on public.v_unassigned_items to authenticated;

notify pgrst, 'reload schema';

commit;
