-- =====================================================================
--  smartjadval.UZ — XAVFSIZLIK MUSTAHKAMLASH
--  QAYERDA: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Idempotent: qayta ishga tushirsa bo'ladi.
--
--  SHART: avval subscription_rls_setup.sql ishga tushirilgan bo'lsin
--  (tekshirildi 02.09.2026 — qo'llangan: schools_insert/schools_update bor).
--
--  BU FAYL FRONTENDGA TEGMAYDI. Hech qanday JS o'zgartirmasdan
--  ishlaydi — barcha to'siqlar server tomonda.
-- =====================================================================


-- =====================================================================
--  1-QISM — XAVFSIZ, DARHOL ISHGA TUSHIRING
-- =====================================================================

-- ---------------------------------------------------------------------
--  1.1) TUMAN ADMINI O'Z TUMANINI O'ZGARTIRA OLMASIN   <-- ENG MUHIM
--
--  Muammo: `district_id` foydalanuvchi yoza oladigan ustun
--  (registerUser() uni brauzerdan yozadi), tuman modulida esa
--  `schools` va `profiles` o'qish huquqi AYNAN shu ustunga tayanadi
--  (districtService.js `fetchDistrictSchools` filtrsiz so'raydi).
--
--  Natijada tuman admini o'ziga boshqa tuman id sini yozib, o'sha
--  tumandagi barcha maktablarning TO'LIQ blobini o'qiy olardi.
--  Tumanlarni aylanib chiqsa — butun baza.
--
--  Yechim: oddiy foydalanuvchi (role='user') o'z tumanini belgilay
--  oladi (ro'yxatdan o'tish shunga tayanadi), imtiyozli rol esa YO'Q.
--  Trigger qiymatni jimgina eskisiga qaytaradi — xato chiqarmaydi,
--  ya'ni ro'yxatdan o'tish oqimi buzilmaydi.
--
--  DIQQAT: `is_admin()` sharti SHART. Usiz trigger superadminning
--  `admin_set_district()` RPC sini ham bloklab qo'yardi va tuman
--  adminiga tuman biriktirib bo'lmasdi. security definer funksiya
--  ichida ham auth.uid() CHAQIRUVCHINIKI bo'lib qoladi (JWT dan
--  o'qiladi), shuning uchun tekshiruv to'g'ri ishlaydi.
-- ---------------------------------------------------------------------
create or replace function public.profiles_guard_district()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  if new.district_id is distinct from old.district_id
     and coalesce(old.role, 'user') <> 'user'
     and not public.is_admin() then
    new.district_id := old.district_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists profiles_guard_district_trg on public.profiles;
create trigger profiles_guard_district_trg
  before update on public.profiles
  for each row execute function public.profiles_guard_district();


-- ---------------------------------------------------------------------
--  1.2) AUDIT LOGNI SOXTALASHTIRIB BO'LMASIN
--
--  Muammo: districtService.js `logAction()` actor_id / actor_email /
--  actor_role ni BRAUZERDAN yuboradi, `audit_insert_own` policy esa
--  INSERT ni ochiq qo'ygan. Ya'ni har kim boshqa odam nomidan,
--  "superadmin" roli bilan soxta yozuv kirita olardi — jurnalga
--  tergov paytida ishonib bo'lmaydi.
--
--  Yechim: trigger identifikatsiya maydonlarini SERVERDAN majburan
--  qayta yozadi. Brauzer nima yuborsa ham bazaga haqiqiy auth.uid()
--  tushadi. Frontendga tegilmaydi — logAction o'zgarishsiz ishlaydi.
-- ---------------------------------------------------------------------
create or replace function public.audit_fill_actor()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  new.actor_id := auth.uid();
  select p.email, p.role
    into new.actor_email, new.actor_role
    from public.profiles p
   where p.id = auth.uid();
  return new;
end;
$fn$;

drop trigger if exists audit_fill_actor_trg on public.audit_log;
create trigger audit_fill_actor_trg
  before insert on public.audit_log
  for each row execute function public.audit_fill_actor();


-- ---------------------------------------------------------------------
--  1.3) BLOKLASH HAQIQIY BO'LSIN
--
--  Muammo: admin_set_status(..., 'blocked') faqat profiles.status ni
--  yozadi. Server tomonda `status` faqat has_active_sub() ichida
--  tekshiriladi — ya'ni bloklangan odam baribir tizimga KIRA oladi
--  va o'z ma'lumotini o'qiy oladi.
--
--  Yechim: auth.users.banned_until qo'yiladi (GoTrue kirishni rad
--  etadi) va ochiq sessiyalar o'chiriladi — bloklash DARHOL kuchga
--  kiradi, keyingi login kutilmaydi.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_status(target uuid, new_status text)
returns void
language plpgsql security definer set search_path = public, auth
as $fn$
begin
  if not public.is_admin() then raise exception 'Ruxsat yo''q'; end if;
  if new_status not in ('active','blocked') then raise exception 'Noto''g''ri status'; end if;
  if target = auth.uid() then raise exception 'O''zingizni bloklay olmaysiz'; end if;

  update public.profiles set status = new_status where id = target;

  update auth.users
     set banned_until = case
           when new_status = 'blocked' then now() + interval '100 years'
           else null
         end
   where id = target;

  -- Ochiq sessiyalarni uzamiz. Jadval nomi/tipi GoTrue versiyasiga
  -- qarab farq qilishi mumkin — bo'lmasa jim o'tamiz, asosiy ish
  -- (banned_until) allaqachon bajarilgan.
  if new_status = 'blocked' then
    begin
      delete from auth.sessions where user_id = target;
    exception when others then null;
    end;
    begin
      delete from auth.refresh_tokens where user_id = target::text;
    exception when others then null;
    end;
  end if;
end;
$fn$;


-- ---------------------------------------------------------------------
--  1.4) O'LIK JADVALNI OLIB TASHLASH
--
--  deviceLock.js va DeviceLockNotice.jsx hech qayerdan import
--  qilinmaydi (qurilma cheklovi olib tashlangan), lekin bazada
--  `device_sessions` jadvali va `device_sessions_admin_all` (ALL)
--  siyosati turibdi. Ishlatilmaydigan yozish nuqtasi — keraksiz xavf.
--
--  DIQQAT: qator ATAYLAB izohda. Avval bo'shligini tasdiqlang:
--     select count(*) from public.device_sessions;
--  Keyin izohni oching.
-- ---------------------------------------------------------------------
-- drop table if exists public.device_sessions cascade;


-- =====================================================================
--  2-QISM — SCHOOLS SIYOSATLARINI TOZALASH
--
--  !! AVVAL 1-QISMNI ISHGA TUSHIRING VA TUMAN MODULINI SINANG.
--  Bu qismni alohida, sinovdan keyin bajaring.
--
--  Muammo: `schools` jadvalida BESHTA select siyosati bor —
--    schools_select_own, schools_select_admin, schools_admin_read,
--    schools_superadmin_read, schools_district_admin_read
--  Permissive siyosatlar OR bilan birlashadi, ya'ni ENG BO'SH sharti
--  g'olib chiqadi. Aynan shu mexanizm eski `schools_own` ni xavfli
--  qilgan edi. Beshtasi vaqt o'tib to'planib qolgan va nazoratdan
--  chiqqan — hammasini o'chirib, uchta aniq siyosat qo'yamiz.
-- =====================================================================

-- Tuman admini shu maktabni o'qiy oladimi? Bitta ha/yo'q javob —
-- "kim qaysi tumanda" xaritasini fosh qilmaydi.
create or replace function public.can_district_read(owner uuid)
returns boolean
language sql stable security definer set search_path = public
as $fn$
  select exists (
    select 1
      from public.profiles me, public.profiles ow
     where me.id = auth.uid()
       and me.role = 'district_admin'
       and me.status = 'active'
       and me.district_id is not null
       and ow.id = owner
       and ow.district_id = me.district_id
  );
$fn$;

-- Eski, nazoratdan chiqqan siyosatlar
drop policy if exists "schools_select_own"          on public.schools;
drop policy if exists "schools_select_admin"        on public.schools;
drop policy if exists "schools_admin_read"          on public.schools;
drop policy if exists "schools_superadmin_read"     on public.schools;
drop policy if exists "schools_district_admin_read" on public.schools;

-- 1) O'z maktabi — obunadan qat'i nazar (mehmon rejimi ko'ra oladi)
create policy "schools_select_own" on public.schools
  for select using (owner_id = auth.uid());

-- 2) Superadmin — "Foydalanuvchilar" sahifasidagi zaxira tugmalari uchun
create policy "schools_select_superadmin" on public.schools
  for select using (public.is_admin());

-- 3) Tuman admini — FAQAT o'z tumani
create policy "schools_select_district" on public.schools
  for select using (public.can_district_read(owner_id));


-- =====================================================================
--  TEKSHIRISH
-- =====================================================================
-- select policyname, cmd, qual from pg_policies
--   where schemaname='public' and tablename='schools' order by cmd, policyname;
--
-- Tuman admini (turon3@gmail.com) sifatida kirib, "Tuman" sahifasi
-- maktablarni ko'rsatayotganini tasdiqlang. Ko'rsatmasa — 3-siyosatning
-- sharti sizning district_id modelingizga mos emas, xabar bering.
