-- =====================================================================
--  smartjadval.UZ — OBUNASIZ YOZISH KANALLARINI YOPISH
--  QAYERDA: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Idempotent: qayta ishga tushirsa bo'ladi.
--
--  SHART: subscription_rls_setup.sql allaqachon qo'llangan
--  (has_active_sub() mavjud; pg_policies da schools_insert va
--  school_backups_insert_own shartida ko'rinib turibdi).
--
--  BU FAYL FRONTENDGA TEGMAYDI.
--
--  MUAMMO:
--  `schools` va `school_backups` obuna bilan qulflangan, lekin bazada
--  boshqa jadvallarga yozish OCHIQ qolgan edi. Obunasiz foydalanuvchi
--  brauzer konsolidan jadvalini o'sha jadvallardan biriga yozib, keyin
--  qaytib o'qishi mumkin — ya'ni bazani "bepul ombor" sifatida
--  ishlatib, to'lovni chetlab o'tishi mumkin edi.
--
--  Topilgan kanallar (pg_policies, 02.09.2026):
--    1) device_sessions.device_sessions_own — cmd = ALL, ya'ni
--       o'qish HAM, yozish HAM ochiq. Eng jiddiy: to'liq ombor.
--    2) schedule_submissions.subm_school_insert — har qanday
--       authenticated foydalanuvchi o'z nomidan yozuv qo'sha oladi
--       (snapshot ustuni butun jadvalni sig'diradi).
--    3) audit_log.audit_insert_own — INSERT hammaga ochiq,
--       `details` ustuni esa ixtiyoriy JSON.
--    4) profiles ning matn ustunlari (school_name va h.k.) uzunligi
--       cheklanmagan — u yerga ham megabaytlab matn sig'adi.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1) DEVICE_SESSIONS — O'LIK JADVALGA YOZISH YO'LI YOPILADI
--
--  deviceLock.js va DeviceLockNotice.jsx hech qayerdan import
--  qilinmaydi (qurilma cheklovi olib tashlangan), ya'ni bu siyosat
--  hech qanday ish bajarmaydi — faqat ochiq yozish nuqtasi bo'lib
--  turibdi. Siyosat `ALL` bo'lgani uchun foydalanuvchi o'z uid'i bilan
--  qator qo'shib, keyin o'qib ola olardi.
--
--  Jadvalning O'ZI o'chirilmaydi (ma'lumot yo'qolmasin) — faqat
--  foydalanuvchi siyosati olib tashlanadi. Admin siyosati
--  (device_sessions_admin_all) joyida qoladi.
--
--  Jadval butunlay keraksizligiga ishonch hosil qilsangiz:
--     select count(*) from public.device_sessions;   -- 0 bo'lsa
--     drop table public.device_sessions cascade;
-- ---------------------------------------------------------------------
drop policy if exists "device_sessions_own" on public.device_sessions;


-- ---------------------------------------------------------------------
--  2) SCHEDULE_SUBMISSIONS — JADVAL TOPSHIRISH FAQAT OBUNA BILAN
--
--  Eski shart: (school_id = auth.uid()) and status in ('draft','submitted')
--  — obuna umuman tekshirilmagan. Yozuvda jadval snapshot'i turadi,
--  ya'ni bu to'liq "bepul saqlash" yo'li edi.
--
--  Frontend hozircha bu jadvalga maktab tomonidan yozmaydi
--  (districtService.js faqat o'qiydi va tuman admini yangilaydi),
--  shuning uchun shartni qattiqlashtirish hech narsani buzmaydi —
--  keyinchalik "jadvalni tumanga topshirish" tugmasi qo'shilganda
--  u to'lagan maktablarda ishlayveradi.
-- ---------------------------------------------------------------------
drop policy if exists "subm_school_insert" on public.schedule_submissions;
create policy "subm_school_insert" on public.schedule_submissions
  for insert with check (
    school_id = auth.uid()
    and status = any (array['draft', 'submitted'])
    and public.has_active_sub()
  );


-- ---------------------------------------------------------------------
--  3) AUDIT_LOG — JURNALGA YOZISH FAQAT HAQIQIY YOZUVCHILARGA
--
--  Jurnalni faqat tuman moduli yozadi (districtService.js `logAction`,
--  DistrictApp.jsx dan chaqiriladi). Tuman admini va superadmin
--  has_active_sub() dan ozod (funksiya ichida role bo'yicha istisno
--  bor), shuning uchun ular uchun hech narsa o'zgarmaydi.
--
--  Oddiy foydalanuvchi esa jurnalga yozmaydi — endi yoza ham olmaydi.
--  Bu ikki narsani beradi: "bepul ombor" yo'li yopiladi va jurnalni
--  cheksiz qator bilan to'ldirish (joy yeyish) imkoni qolmaydi.
--
--  DIQQAT: security_hardening.sql dagi audit_fill_actor triggeri
--  saqlanadi — u actor_id/email/role ni serverdan majburan yozadi.
--  Ikkalasi birga ishlaydi: trigger KIM yozganini to'g'rilaydi,
--  quyidagi siyosat KIMGA yozishga ruxsat borligini hal qiladi.
-- ---------------------------------------------------------------------
drop policy if exists "audit_insert_own" on public.audit_log;
create policy "audit_insert_own" on public.audit_log
  for insert with check (
    actor_id = auth.uid()
    and public.has_active_sub()
  );


-- ---------------------------------------------------------------------
--  4) PROFILES — MATN USTUNLARI OMBOR BO'LMASIN
--
--  `grant update (name, school_name, email, phone, region_name,
--  district_name, district_id)` — bu ustunlarni foydalanuvchi
--  o'zgartira oladi (profilni tahrirlash uchun kerak). Postgres'da
--  `text` uzunligi cheklanmagan, ya'ni butun jadvalni base64 qilib
--  `school_name` ga yozib qo'yish mumkin edi.
--
--  `not valid` — mavjud qatorlar tekshirilmaydi (eski uzun qiymat
--  bo'lsa migratsiya yiqilmaydi), YANGI yozuvlarga esa qo'llanadi.
--  Chegaralar real ehtiyojdan ancha keng olingan.
-- ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_text_len_chk;
alter table public.profiles add constraint profiles_text_len_chk check (
  coalesce(length(name), 0)          <= 120
  and coalesce(length(school_name), 0)   <= 200
  and coalesce(length(email), 0)         <= 254
  and coalesce(length(phone), 0)         <= 24
  and coalesce(length(region_name), 0)   <= 120
  and coalesce(length(district_name), 0) <= 120
) not valid;


-- =====================================================================
--  TEKSHIRISH
-- =====================================================================
-- 1) Yozish kanallari qayta ko'rib chiqiladi — endi har bir INSERT/ALL
--    shartida yo has_active_sub(), yo rol tekshiruvi turishi kerak:
--
--    select tablename, policyname, cmd, with_check
--      from pg_policies
--     where schemaname = 'public' and cmd in ('INSERT', 'ALL')
--     order by tablename, policyname;
--
-- 2) O'QISH tomonini ham bir ko'zdan kechiring (bu so'rov faqat
--    INSERT/ALL ni ko'rsatgan edi). Ayniqsa audit_log da o'z yozuvini
--    qaytib o'qish siyosati bor-yo'qligi:
--
--    select tablename, policyname, cmd, qual
--      from pg_policies
--     where schemaname = 'public' and cmd in ('SELECT', 'UPDATE')
--     order by tablename, policyname;
--
-- 3) Tuman moduli ishlayotganini sinang: tuman admini sifatida kirib,
--    bir amal bajaring va audit jurnalida yangi qator paydo bo'lganini
--    tekshiring (u has_active_sub() dan ozod, ya'ni ishlashi shart).
