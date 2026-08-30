-- =====================================================================
--  smartjadval.UZ — VERSIYA TARIXI (`school_backups`)
--  QAYERDA ISHGA TUSHIRILADI: Supabase Dashboard -> SQL Editor -> New query
--  Butun faylni nusxalab, "Run" bosing. Bir marta ishga tushiriladi.
--
--  NIMA UCHUN KERAK
--  `schools` jadvalida har bir maktabning FAQAT OXIRGI holati turadi.
--  Yangi holat yozilganda eskisi yo'qoladi. Shu jadval esa har bir
--  o'zgarishning to'liq nusxasini saqlab boradi — ilovadagi
--  "Zaxira nusxalar" sahifasi shundan o'qiydi va istalgan versiyani
--  qaytara oladi.
--
--  QANCHA SAQLANADI — POG'ONALI ("thinning") TOZALASH
--  Ilgari oddiy qoida bor edi: oxirgi 40 ta nusxa. Amalda bu YOMON
--  ishlardi — ilova har 10 daqiqada nusxa oladi, ya'ni 40 ta yozuv
--  atigi ~7 SOATni qamrab olardi. Kechagi holatga qaytish IMKONSIZ
--  edi, joy esa behuda ketardi (bazaning ~97% i shu jadval).
--
--  Endi nusxalar YAQINDA zich, UZOQDA siyrak saqlanadi:
--
--     • eng so'nggi 5 ta nusxa                     — har doim
--     • oxirgi 12 soat: har SOATdan bittadan
--     • oxirgi 14 kun:  har KUNdan bittadan
--     • MAJBURIY nusxalar (konflikt / tiklashdan oldingi holat /
--       qo'lda olingan) — 60 kungacha, 15 tagacha
--
--  Natija: yozuvlar soni ~40 dan ~18 gacha tushadi (joy ~2 barobar
--  kam), tarix chuqurligi esa 7 soatdan 14 KUNga chiqadi.
--
--  XAVFSIZLIK
--  RLS: foydalanuvchi faqat O'ZINING nusxalarini ko'radi va yozadi.
--  UPDATE siyosati umuman yo'q — yozilgan versiyani o'zgartirib
--  bo'lmaydi (tarix buzilmasin). Superadmin (public.is_admin())
--  hammasini o'qiy oladi — qo'llab-quvvatlash uchun.
-- =====================================================================

-- 1) JADVAL
create table if not exists public.school_backups (
  id          bigserial primary key,
  owner_id    uuid        not null references auth.users(id) on delete cascade,
  -- `schools.data` ichidagi `_rev` — qaysi versiyadan nusxa olingani
  rev         bigint      not null default 0,
  -- "📱 Telefon · a1b2c" ko'rinishida — qaysi qurilma yozgan
  device      text        not null default '',
  -- bo'sh bo'lsa: avtomatik zaxira. To'la bo'lsa: konflikt / tiklash oldidan
  note        text        not null default '',
  -- { "classes": 12, "teachers": 40, "schedule": 520, "roomAssignments": 480 }
  counts      jsonb       not null default '{}'::jsonb,
  -- to'liq nusxa (cloudSync dagi encodeBlob formati)
  data        jsonb       not null,
  created_at  timestamptz not null default now()
);

-- Ro'yxat so'rovi: owner bo'yicha, vaqt bo'yicha teskari tartibda
create index if not exists school_backups_owner_created_idx
  on public.school_backups (owner_id, created_at desc);

-- 2) RLS
alter table public.school_backups enable row level security;

drop policy if exists "school_backups_select_own" on public.school_backups;
create policy "school_backups_select_own" on public.school_backups
  for select using (auth.uid() = owner_id);

drop policy if exists "school_backups_insert_own" on public.school_backups;
create policy "school_backups_insert_own" on public.school_backups
  for insert with check (auth.uid() = owner_id);

drop policy if exists "school_backups_delete_own" on public.school_backups;
create policy "school_backups_delete_own" on public.school_backups
  for delete using (auth.uid() = owner_id);

-- UPDATE siyosati ATAYLAB yo'q: yozilgan versiya o'zgarmasligi kerak.

grant select, insert, delete on table public.school_backups to authenticated;
grant usage, select on sequence public.school_backups_id_seq to authenticated;

-- Superadmin uchun o'qish — faqat public.is_admin() mavjud bo'lsa
-- (u supabase_setup.sql da yaratiladi).
do $$
begin
  if to_regprocedure('public.is_admin()') is not null then
    execute 'drop policy if exists "school_backups_select_admin" on public.school_backups';
    execute 'create policy "school_backups_select_admin" on public.school_backups
             for select using (public.is_admin())';
  end if;
end $$;

-- 3) POG'ONALI TOZALASH
--
--  Bitta foydalanuvchining nusxalarini tartibga soladi. Trigger ham,
--  quyidagi bir martalik tozalash ham SHU funksiyani chaqiradi —
--  qoida ikki joyda ajralib ketmasin.
create or replace function public.prune_school_backups_for(uid uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
  now_ts  timestamptz := now();
begin
  delete from public.school_backups b
  where b.owner_id = uid
    and b.id not in (

      -- (a) MAJBURIY nusxalar: konflikt, tiklashdan oldingi holat,
      --     qo'lda olingan zaxira. Bular eng qimmatlisi.
      select id from (
        select id from public.school_backups
        where owner_id = uid
          and note <> ''
          and created_at > now_ts - interval '60 days'
        order by created_at desc, id desc
        limit 15
      ) forced

      union
      -- (b) eng so'nggi 5 ta — nima bo'lganda ham qoladi
      select id from (
        select id from public.school_backups
        where owner_id = uid
        order by created_at desc, id desc
        limit 5
      ) recent

      union
      -- (c) oxirgi 12 soat — har soatning ENG YANGI nusxasi
      select id from (
        select distinct on (date_trunc('hour', created_at)) id
        from public.school_backups
        where owner_id = uid
          and created_at > now_ts - interval '12 hours'
        order by date_trunc('hour', created_at) desc, created_at desc, id desc
      ) hourly

      union
      -- (d) oxirgi 14 kun — har kunning ENG YANGI nusxasi
      select id from (
        select distinct on (date_trunc('day', created_at)) id
        from public.school_backups
        where owner_id = uid
          and created_at > now_ts - interval '14 days'
        order by date_trunc('day', created_at) desc, created_at desc, id desc
      ) daily
    );

  get diagnostics removed = row_count;
  return removed;
end;
$$;

create or replace function public.prune_school_backups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.prune_school_backups_for(new.owner_id);
  return null;
end;
$$;

drop trigger if exists school_backups_prune on public.school_backups;
create trigger school_backups_prune
  after insert on public.school_backups
  for each row execute function public.prune_school_backups();

-- ⚠️ XAVFSIZLIK: `prune_school_backups_for` — `security definer`, ya'ni
-- RLS ni chetlab o'tadi. Postgres'da funksiyalarga `execute` huquqi
-- sukut bo'yicha HAMMAGA beriladi. Usiz istalgan foydalanuvchi
-- `select prune_school_backups_for('<begona-uuid>')` deb BOSHQA
-- maktabning zaxiralarini o'chirib yuborardi. Shuning uchun huquqni
-- olib tashlaymiz — funksiya faqat trigger ichidan chaqiriladi.
revoke all on function public.prune_school_backups_for(uuid) from public;
revoke all on function public.prune_school_backups_for(uuid) from anon;
revoke all on function public.prune_school_backups_for(uuid) from authenticated;


-- =====================================================================
--  3b) BIR MARTALIK TOZALASH — MAVJUD ma'lumotga yangi qoidani qo'llash
--
--  Triggersiz bu faqat foydalanuvchi yangi nusxa yozganda ishlardi.
--  Quyidagi ikki qator hozirning o'zida hamma foydalanuvchini tozalaydi.
--
--  Bu qadam eski qatorlarni O'CHIRADI, lekin Supabase paneldagi
--  "Database size" DARHOL kamaymaydi — buning uchun quyidagi 5-qadam
--  (VACUUM FULL) kerak.
-- =====================================================================
select coalesce(sum(public.prune_school_backups_for(owner_id)), 0) as ochirilgan
from (select distinct owner_id from public.school_backups) t;


-- =====================================================================
--  5) JOYNI DISKKA QAYTARISH — ⚠️ ALOHIDA SO'ROV QILIB ISHGA TUSHIRING
--
--  VACUUM tranzaksiya ichida ishlamaydi, Supabase SQL Editor esa butun
--  skriptni BITTA tranzaksiyada bajaradi. Shuning uchun quyidagi qator
--  SHU FAYLGA QO'SHILMAYDI — aks holda "VACUUM cannot run inside a
--  transaction block" xatosi chiqib, YUQORIDAGI HAMMA NARSA orqaga
--  qaytariladi (funksiya ham, trigger ham yozilmay qoladi).
--
--  Yuqoridagi skript muvaffaqiyatli o'tgach: "New query" oching va
--  FAQAT shu bitta qatorni yozib ishga tushiring —
--
--      vacuum full public.school_backups;
--
--  Usiz Postgres o'chirilgan qatorlar o'rnini ichida "bo'sh joy" qilib
--  ushlab turadi va panelda hajm kamaymaydi. Jadval kichik, shuning
--  uchun bir necha soniya davom etadi (qisqa vaqt jadval bloklanadi).
-- =====================================================================


-- =====================================================================
--  6) TEKSHIRISH
--  Quyidagi so'rov xatosiz ishlasa — hammasi joyida:
--     select count(*) from public.school_backups;
--
--  Har bir foydalanuvchida nechta nusxa qolganini va qancha joy
--  egallaganini ko'rish:
--     select owner_id, count(*) as nusxa,
--            pg_size_pretty(sum(pg_column_size(data))::bigint) as hajm,
--            min(created_at) as eng_eski
--     from public.school_backups group by 1 order by 3 desc;
--
--  Ilovada: "Zaxira nusxalar" sahifasini oching. Bir necha o'zgarish
--  kiritganingizdan keyin ro'yxatda versiyalar paydo bo'ladi.
-- =====================================================================
