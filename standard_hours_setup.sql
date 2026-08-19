-- =====================================================================
--  smartjadval.UZ — "Standart soatlar" (tayanch o'quv reja) jadvali
--  QAYERDA ISHGA TUSHIRILADI: Supabase Dashboard -> SQL Editor -> New query
--  Butun faylni nusxalab, "Run" bosing. Bir marta ishga tushiriladi.
--
--  Nima uchun kerak: superadmin "Standart soatlar" sahifasida qaysi
--  sinfda qaysi fan necha soat bo'lishini belgilaydi. Foydalanuvchi
--  "Sinf fanlari" sahifasida "⚡ Standart soatlar" tugmasini bosganda
--  sinflar aynan shu soatlar bilan to'ldiriladi.
--
--  DIQQAT: bu skript supabase_setup.sql dagi public.is_admin()
--  funksiyasiga tayanadi (superadmin tekshiruvi). Avval o'sha fayl
--  ishga tushirilgan bo'lishi kerak.
-- =====================================================================

-- 1) Jadval: butun tizim uchun BITTA qator (id = 'global')
create table if not exists public.standard_hours (
  id text primary key default 'global',
  -- { "uz": [ { "name": "Ona tili", "aliases": ["ona tili"],
  --            "h": { "1": 4, "2": 4 } } ], "ru": [ ... ] }
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- 2) RLS: hamma o'qiy oladi (foydalanuvchiga standart soatlar kerak),
--    yozish esa — faqat superadmin
alter table public.standard_hours enable row level security;

drop policy if exists "standard_hours_select" on public.standard_hours;
create policy "standard_hours_select" on public.standard_hours
  for select using (true);

drop policy if exists "standard_hours_insert" on public.standard_hours;
create policy "standard_hours_insert" on public.standard_hours
  for insert with check (public.is_admin());

drop policy if exists "standard_hours_update" on public.standard_hours;
create policy "standard_hours_update" on public.standard_hours
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "standard_hours_delete" on public.standard_hours;
create policy "standard_hours_delete" on public.standard_hours
  for delete using (public.is_admin());

grant select on table public.standard_hours to anon, authenticated;
grant insert, update, delete on table public.standard_hours to authenticated;

-- 3) Bo'sh qator (superadmin sahifada saqlaganda to'ladi)
insert into public.standard_hours (id, data)
values ('global', '{"uz": [], "ru": []}'::jsonb)
on conflict (id) do nothing;
