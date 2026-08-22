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
--  QANCHA SAQLANADI
--  Har bir foydalanuvchi uchun ENG OXIRGI 40 ta versiya. Undan
--  eskilari yangi versiya qo'shilganda avtomatik o'chiriladi
--  (trigger: prune_school_backups).
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

-- 3) ESKILARINI TOZALASH — har bir foydalanuvchida oxirgi 40 tasi qoladi
create or replace function public.prune_school_backups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.school_backups b
  where b.owner_id = new.owner_id
    and b.id not in (
      select id from public.school_backups
      where owner_id = new.owner_id
      order by created_at desc, id desc
      limit 40
    );
  return null;
end;
$$;

drop trigger if exists school_backups_prune on public.school_backups;
create trigger school_backups_prune
  after insert on public.school_backups
  for each row execute function public.prune_school_backups();

-- =====================================================================
--  4) TEKSHIRISH
--  Quyidagi so'rov xatosiz ishlasa — hammasi joyida:
--     select count(*) from public.school_backups;
--
--  Ilovada: "Zaxira nusxalar" sahifasini oching. Bir necha o'zgarish
--  kiritganingizdan keyin ro'yxatda versiyalar paydo bo'ladi.
-- =====================================================================
