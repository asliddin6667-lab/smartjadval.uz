-- =====================================================================
--  smartjadval.UZ — Supabase migratsiya skripti (hisoblar + obuna)
--  QAYERDA ISHGA TUSHIRILADI: Supabase Dashboard -> SQL Editor -> New query
--  Butun faylni nusxalab, "Run" bosing. Bir marta ishga tushiriladi.
-- =====================================================================

-- 1) PROFILES jadvali: har bir auth foydalanuvchisi uchun profil
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  uid text unique,                      -- EDU-XXXXXX (to'lovda ishlatiladi)
  name text default '',
  email text default '',
  school_name text default '',
  role text not null default 'user',    -- user | superadmin
  status text not null default 'active',-- active | blocked
  sub_status text not null default 'unpaid', -- unpaid | active | expired
  sub_plan text,
  sub_activated_at timestamptz,
  sub_expires_at timestamptz,           -- null = muddatsiz
  created_at timestamptz not null default now()
);

-- 2) Yangi ro'yxatdan o'tganda profil avtomatik yaratiladi
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, uid, name, email, school_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'uid',
      'EDU-' || upper(substr(md5(random()::text || new.id::text), 1, 6))
    ),
    coalesce(new.raw_user_meta_data->>'name', ''),
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'school_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Superadmin tekshiruvi (RLS ichida ishlatiladi)
create or replace function public.is_admin()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'superadmin'
  );
$$;

-- 4) RLS: har kim faqat o'z profilini ko'radi; superadmin hammani ko'radi
alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Oddiy foydalanuvchi faqat ism va maktabini o'zgartira oladi.
-- role / status / obuna ustunlari — faqat pastdagi admin funksiyalar orqali.
revoke update on table public.profiles from anon, authenticated;
grant select on table public.profiles to anon, authenticated;
grant update (name, school_name) on table public.profiles to authenticated;

-- =====================================================================
--  ADMIN FUNKSIYALARI (faqat superadmin chaqira oladi)
-- =====================================================================

-- Obunani N kunga faollashtirish (faol bo'lsa muddat ustiga qo'shiladi)
create or replace function public.admin_set_subscription(target uuid, days int)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Ruxsat yo''q'; end if;
  update public.profiles set
    sub_status = 'active',
    sub_plan = case when days >= 365 then 'yillik' else 'standart' end,
    sub_activated_at = now(),
    sub_expires_at = greatest(coalesce(sub_expires_at, now()), now()) + make_interval(days => days)
  where id = target;
end;
$$;

-- Obunani bekor qilish
create or replace function public.admin_revoke_subscription(target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Ruxsat yo''q'; end if;
  update public.profiles set
    sub_status = 'unpaid', sub_plan = null,
    sub_activated_at = null, sub_expires_at = null
  where id = target;
end;
$$;

-- Bloklash / faollashtirish
create or replace function public.admin_set_status(target uuid, new_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Ruxsat yo''q'; end if;
  if new_status not in ('active','blocked') then raise exception 'Noto''g''ri status'; end if;
  if target = auth.uid() then raise exception 'O''zingizni bloklay olmaysiz'; end if;
  update public.profiles set status = new_status where id = target;
end;
$$;

-- Rolni o'zgartirish
create or replace function public.admin_set_role(target uuid, new_role text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Ruxsat yo''q'; end if;
  if new_role not in ('user','superadmin') then raise exception 'Noto''g''ri rol'; end if;
  if target = auth.uid() then raise exception 'O''z rolingizni o''zgartira olmaysiz'; end if;
  update public.profiles set role = new_role where id = target;
end;
$$;

-- Boshqa foydalanuvchining ismi/maktabini tahrirlash
create or replace function public.admin_update_profile(target uuid, new_name text, new_school text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Ruxsat yo''q'; end if;
  update public.profiles set name = new_name, school_name = new_school where id = target;
end;
$$;

-- Foydalanuvchini butunlay o'chirish (auth + profil)
create or replace function public.admin_delete_user(target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Ruxsat yo''q'; end if;
  if target = auth.uid() then raise exception 'O''zingizni o''chira olmaysiz'; end if;
  delete from auth.users where id = target;
end;
$$;

-- Admin panelidan yangi foydalanuvchi yaratish (admin sessiyasi buzilmasligi uchun)
create or replace function public.admin_create_user(
  p_email text, p_password text, p_name text, p_school text, p_role text default 'user'
)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if not public.is_admin() then raise exception 'Ruxsat yo''q'; end if;
  if exists (select 1 from auth.users where lower(email) = lower(p_email)) then
    raise exception 'Bu email oldin ro''yxatdan o''tgan';
  end if;
  if length(p_password) < 6 then raise exception 'Parol kamida 6 ta belgi bo''lsin'; end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('name', p_name, 'school_name', p_school),
    now(), now()
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', lower(p_email), 'email_verified', true),
    'email', now(), now(), now()
  );

  if p_role = 'superadmin' then
    update public.profiles set role = 'superadmin' where id = v_id;
  end if;

  return v_id;
end;
$$;

-- =====================================================================
--  TAYYOR! Endi qo'lda 2 ta qadam:
--
--  A) Authentication -> Sign In / Providers -> Email:
--     - "Confirm email" ni O'CHIRING (toggle off)
--     - "Secure email change" ni ham o'chiring
--     (aks holda ro'yxatdan o'tish email tasdiqlashda tiqilib qoladi)
--
--  B) Saytda o'zingizga hisob oching (admin email + kuchli parol bilan),
--     keyin shu yerda quyidagini ishga tushiring (emailni moslang):
--
--     update public.profiles set role = 'superadmin', sub_status = 'active'
--     where email = 'SIZNING@EMAILINGIZ.uz';
--
--     Demo hisob uchun (saytda demo@smartjadval.uz ro'yxatdan o'tgach):
--
--     update public.profiles set sub_status = 'active', sub_expires_at = null
--     where email = 'demo@smartjadval.uz';
-- =====================================================================
