-- =====================================================================
--  smartjadval.UZ — OBUNA QULFI SERVER TOMONDA (RLS)
--  QAYERDA: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Idempotent: qayta ishga tushirsa bo'ladi.
--
--  NIMA UCHUN KERAK:
--  Obuna tekshiruvi ilgari FAQAT brauzerda edi (authService.js
--  `checkSubscription()` localStorage keshini o'qiydi, App.jsx esa
--  `guardClick` bilan bosishlarni to'sadi). Brauzerdagi kodni
--  foydalanuvchi o'zgartira oladi — localStorage'dagi profil nusxasiga
--  `sub_status: "active"` yozib qo'ysa, platforma to'liq ochilardi va
--  ma'lumot HAQIQATAN bulutga saqlanardi, chunki `schools` jadvalida
--  obuna umuman tekshirilmasdi.
--
--  Endi to'siq Postgres'da: obunasiz foydalanuvchi ma'lumotini
--  KO'RADI (mehmon rejimi), lekin YOZA OLMAYDI.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1) OBUNA TEKSHIRUVI
--  Superadmin va tuman admini to'lovdan ozod — authService.js dagi
--  `checkSubscription()` bilan bir xil qoida.
--  Bloklangan hisob (status <> 'active') ham yoza olmaydi.
-- ---------------------------------------------------------------------
create or replace function public.has_active_sub()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'active'
      and (
        role in ('superadmin', 'district_admin')
        or (sub_status = 'active'
            and (sub_expires_at is null or sub_expires_at > now()))
      )
  );
$$;

-- ---------------------------------------------------------------------
--  2) SCHOOLS — yozish faqat obuna bilan
--
--  DIQQAT: eski `schools_own` policy `FOR ALL` edi va shartsiz
--  `owner_id = auth.uid()` berardi. Permissive policy'lar YOKI (OR)
--  bilan birlashgani uchun u yangi shartni butunlay bekor qilardi.
--  Shuning uchun u o'chiriladi va o'rniga amal bo'yicha alohida
--  policy'lar qo'yiladi.
--
--  DELETE policy ataylab YO'Q — ilova `schools` dan hech qachon
--  qator o'chirmaydi (cloudSync.js faqat select/update/upsert qiladi).
-- ---------------------------------------------------------------------
alter table public.schools enable row level security;

drop policy if exists "schools_own" on public.schools;

-- O'qish — obunadan qat'i nazar. Mehmon rejimidagi foydalanuvchi
-- o'z jadvalini ko'rishi va Excel'ga chiqarishi kerak.
drop policy if exists "schools_select_own" on public.schools;
create policy "schools_select_own" on public.schools
  for select using (owner_id = auth.uid());

drop policy if exists "schools_insert" on public.schools;
create policy "schools_insert" on public.schools
  for insert with check (owner_id = auth.uid() and public.has_active_sub());

drop policy if exists "schools_update" on public.schools;
create policy "schools_update" on public.schools
  for update using      (owner_id = auth.uid() and public.has_active_sub())
             with check (owner_id = auth.uid() and public.has_active_sub());

-- ---------------------------------------------------------------------
--  3) SCHOOL_BACKUPS — zaxira yozish ham obuna bilan
-- ---------------------------------------------------------------------
drop policy if exists "school_backups_insert_own" on public.school_backups;
create policy "school_backups_insert_own" on public.school_backups
  for insert with check (auth.uid() = owner_id and public.has_active_sub());

-- ---------------------------------------------------------------------
--  4) PROFILES — USTUN DARAJASIDAGI RUXSAT (eng muhim qism)
--
--  `profiles_update_own` policy o'z qatoringizning ISTALGAN ustunini
--  o'zgartirishga ruxsat beradi. Yagona to'siq — quyidagi GRANT.
--  U bo'lmasa foydalanuvchi bir qator kod bilan o'ziga obuna yozadi:
--      supabase.from('profiles').update({ sub_status:'active' })
--
--  Ro'yxatdagi ustunlar — ilova HAQIQATAN yozadigan maydonlar:
--    name, school_name  -> updateOwnProfile()
--    email              -> updateOwnProfile() (auth.users bilan sinxron)
--    phone              -> registerUser() va updateOwnProfile()
--    region_name, district_name, district_id -> registerUser()
--
--  RO'YXATGA HECH QACHON QO'SHILMAYDI:
--    role, status, sub_status, sub_plan, sub_activated_at,
--    sub_expires_at, uid, id, created_at, must_change_password
--  Bularni faqat `admin_*` funksiyalari (security definer) o'zgartiradi.
-- ---------------------------------------------------------------------
revoke update on table public.profiles from anon, authenticated;
grant  select on table public.profiles to anon, authenticated;
grant  update (name, school_name, email, phone,
               region_name, district_name, district_id)
  on table public.profiles to authenticated;
