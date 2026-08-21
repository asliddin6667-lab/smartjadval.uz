-- =====================================================================
--  SUPERADMIN — boshqa foydalanuvchilarning maktab ma'lumotini O'QISH
--
--  Nima uchun: "Foydalanuvchilar" sahifasidagi "⬇ Zaxira" va
--  "⬇ Hammasining zaxirasi (JSON)" tugmalari `schools` jadvalidan
--  boshqa foydalanuvchining blobini o'qiydi. RLS da bunday siyosat
--  bo'lmasa, so'rov xatosiz, lekin BO'SH natija qaytaradi va tugma
--  "bulutda ma'lumot yo'q" deydi.
--
--  Faqat SELECT beriladi — superadmin begona ma'lumotni o'zgartira
--  olmaydi (INSERT/UPDATE siyosatlari tegilmaydi).
--
--  Supabase SQL Editor'da bir marta ishga tushiriladi.
--  is_admin() supabase_setup.sql da yaratilgan.
-- =====================================================================

drop policy if exists "schools_select_admin" on public.schools;
create policy "schools_select_admin" on public.schools
  for select using (public.is_admin());

-- Tekshirish: superadmin sifatida kirib
--   select owner_id, updated_at from public.schools order by updated_at desc limit 5;
