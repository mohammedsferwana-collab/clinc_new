-- مركز الأمل الطبي — قاعدة البيانات الشاملة والمحدثة (Supabase / PostgreSQL)
-- شغّل هذا الملف كاملاً في: Supabase ← SQL Editor ← New query ← Run

create extension if not exists pgcrypto;

-- ========== المستخدمون والصلاحيات ==========
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  username text unique,
  avatar_url text,
  role text not null default 'reception' check (role in ('admin','reception','doctor','pharmacy')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  u_name text;
begin
  u_name := coalesce(
    new.raw_user_meta_data->>'username',
    split_part(new.email, '@', 1)
  );
  insert into profiles(id, full_name, role, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when (select count(*) from profiles) = 0 then 'admin' else coalesce(new.raw_user_meta_data->>'role', 'reception') end,
    u_name
  )
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, profiles.full_name),
    username = coalesce(excluded.username, profiles.username);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

-- ========== الجداول التعريفية (Master Data) ==========
create table if not exists clinics (
  id serial primary key,
  name text not null unique,
  sort int not null default 100
);
insert into clinics(name, sort) values
  ('عام',1),('أطفال',2),('عظام',3),('مسالك',4),('نساء وولادة',5),('تمريض',6),('نفسي',7)
on conflict (name) do nothing;

create table if not exists doctors (
  id serial primary key,
  name text not null unique
);

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  national_id text unique,
  full_name text not null,
  search_name text generated always as (translate(lower(full_name), 'أإآى', 'اااي')) stored,
  phone text,
  address text,
  gender text check (gender in ('ذكر','أنثى')),
  birth_date date,
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);
create index if not exists patients_name_idx on patients (search_name);
create index if not exists patients_phone_idx on patients (phone);

create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients on delete cascade,
  visit_date date not null default current_date,
  clinic text,
  doctor_name text,
  case_type text check (case_type in ('جديد','مراجع','استشارة','طوارئ','محول','أخرى')),
  age_at_visit text,
  diagnosis text,
  notes text,
  legacy_prescription text,
  status text not null default 'waiting' check (status in ('waiting','in_progress','seen')),
  source text not null default 'app',
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);

-- ترقية جدول الزيارات إن كان موجوداً مسبقاً
ALTER TABLE visits ADD COLUMN IF NOT EXISTS age_at_visit text;
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_status_check;
ALTER TABLE visits ADD CONSTRAINT visits_status_check CHECK (status IN ('waiting', 'in_progress', 'seen'));
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_case_type_check;
ALTER TABLE visits ADD CONSTRAINT visits_case_type_check CHECK (case_type IN ('جديد', 'مراجع', 'استشارة', 'طوارئ', 'محول', 'أخرى'));

create index if not exists visits_date_idx on visits (visit_date);
create index if not exists visits_patient_idx on visits (patient_id, visit_date desc);

create table if not exists drugs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  scientific_name text,
  dosage text,
  unit text not null default 'حبة',
  price numeric(10,2) not null default 0,
  supplier text,
  expiry_date date,
  min_stock int not null default 0,
  active boolean not null default true
);

-- ترقية جدول الأدوية إن كان موجوداً مسبقاً
ALTER TABLE drugs ADD COLUMN IF NOT EXISTS scientific_name text;
ALTER TABLE drugs ADD COLUMN IF NOT EXISTS dosage text;
ALTER TABLE drugs ADD COLUMN IF NOT EXISTS price numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE drugs ADD COLUMN IF NOT EXISTS supplier text;
ALTER TABLE drugs ADD COLUMN IF NOT EXISTS expiry_date date;

create table if not exists visit_items (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits on delete cascade,
  drug_id uuid references drugs,
  drug_text text not null,
  qty int not null default 1 check (qty > 0),
  dosage text,
  dispensed_at timestamptz,
  dispensed_by uuid references auth.users,
  created_at timestamptz not null default now()
);
create index if not exists items_visit_idx on visit_items (visit_id);
create index if not exists items_pending_idx on visit_items (dispensed_at) where dispensed_at is null;

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  drug_id uuid not null references drugs,
  kind text not null check (kind in ('in','out','adjust')),
  qty int not null,
  movement_date date not null default current_date,
  note text,
  item_id uuid references visit_items,
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);
create index if not exists movements_drug_idx on stock_movements (drug_id);
create index if not exists movements_date_idx on stock_movements (movement_date);

DROP VIEW IF EXISTS drug_balance;
create or replace view drug_balance with (security_invoker = true) as
select d.id, d.name, d.scientific_name, d.dosage, d.unit, d.price, d.supplier, d.expiry_date, d.min_stock, d.active,
       coalesce(sum(case m.kind when 'in' then m.qty when 'out' then -m.qty else m.qty end), 0)::int as balance
from drugs d left join stock_movements m on m.drug_id = d.id
group by d.id;

create or replace function dispense_item(p_item uuid, p_drug uuid, p_qty int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('pharmacy','admin') then raise exception 'غير مصرح'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'الكمية غير صالحة'; end if;
  update visit_items set drug_id = p_drug, qty = p_qty, dispensed_at = now(), dispensed_by = auth.uid()
   where id = p_item and dispensed_at is null;
  if not found then raise exception 'تم صرف هذا البند مسبقاً'; end if;
  insert into stock_movements(drug_id, kind, qty, item_id, created_by)
  values (p_drug, 'out', p_qty, p_item, auth.uid());
end $$;

-- ========== الصلاحيات (Row Level Security) ==========
do $$
declare t text;
begin
  foreach t in array array['profiles','clinics','doctors','patients','visits','visit_items','drugs','stock_movements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "read_%1$s" on %1$I', t);
    execute format('create policy "read_%1$s" on %1$I for select to authenticated using (my_role() is not null)', t);
  end loop;
end $$;

drop policy if exists admin_profiles on profiles;
create policy admin_profiles on profiles for update to authenticated
  using (id = auth.uid() or my_role() = 'admin') with check (id = auth.uid() or my_role() = 'admin');

drop policy if exists w_clinics on clinics;
create policy w_clinics on clinics for all to authenticated using (my_role() = 'admin') with check (my_role() = 'admin');
drop policy if exists w_doctors on doctors;
create policy w_doctors on doctors for all to authenticated using (my_role() = 'admin') with check (my_role() = 'admin');

drop policy if exists i_patients on patients;
drop policy if exists u_patients on patients;
drop policy if exists d_patients on patients;
create policy i_patients on patients for insert to authenticated with check (my_role() in ('admin','reception','doctor'));
create policy u_patients on patients for update to authenticated using (my_role() in ('admin','reception','doctor')) with check (my_role() in ('admin','reception','doctor'));
create policy d_patients on patients for delete to authenticated using (my_role() = 'admin');

drop policy if exists i_visits on visits;
drop policy if exists u_visits on visits;
drop policy if exists d_visits on visits;
create policy i_visits on visits for insert to authenticated with check (my_role() in ('admin','reception','doctor'));
create policy u_visits on visits for update to authenticated using (my_role() in ('admin','reception','doctor')) with check (my_role() in ('admin','reception','doctor'));
create policy d_visits on visits for delete to authenticated using (my_role() in ('admin','reception'));

drop policy if exists w_items on visit_items;
create policy w_items on visit_items for all to authenticated
  using (my_role() in ('admin','doctor')) with check (my_role() in ('admin','doctor'));

drop policy if exists w_drugs on drugs;
create policy w_drugs on drugs for all to authenticated
  using (my_role() in ('admin','pharmacy')) with check (my_role() in ('admin','pharmacy'));

drop policy if exists i_moves on stock_movements;
drop policy if exists d_moves on stock_movements;
drop policy if exists u_moves on stock_movements;
create policy i_moves on stock_movements for insert to authenticated with check (my_role() in ('admin','pharmacy'));
create policy d_moves on stock_movements for delete to authenticated using (my_role() in ('admin','pharmacy'));
create policy u_moves on stock_movements for update to authenticated using (my_role() in ('admin','pharmacy')) with check (my_role() in ('admin','pharmacy'));

-- ========== دوال إدارة المستخدمين والدخول بدون بريد ==========
create or replace function get_email_for_username(p_username text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  found_email text;
  clean_u text := lower(trim(p_username));
begin
  if clean_u = '' then return null; end if;
  select u.email into found_email
  from auth.users u
  join profiles p on p.id = u.id
  where lower(p.username) = clean_u and p.active = true
  limit 1;

  if found_email is null then
    select u.email into found_email
    from auth.users u
    join profiles p on p.id = u.id
    where (lower(split_part(u.email, '@', 1)) = clean_u or lower(u.email) = clean_u)
      and p.active = true
    limit 1;
  end if;

  return found_email;
end $$;
grant execute on function get_email_for_username(text) to anon, authenticated;

create or replace function admin_create_user(
  p_username text,
  p_password text,
  p_full_name text,
  p_role text default 'reception'
) returns json
language plpgsql security definer set search_path = auth, public, extensions as $$
declare
  new_id uuid := gen_random_uuid();
  clean_user text := lower(trim(p_username));
  user_email text;
  encrypted_pw text;
begin
  if (select role from public.profiles where id = auth.uid() and active) <> 'admin' then
    raise exception 'غير مصرح: صلاحية مدير مطلوبة لإنشاء المستخدمين';
  end if;

  if clean_user = '' or p_password = '' then
    raise exception 'اسم المستخدم وكلمة المرور مطلوبان';
  end if;

  if length(p_password) < 6 then
    raise exception 'كلمة المرور يجب أن لا تقل عن 6 خانات';
  end if;

  if p_role not in ('admin', 'reception', 'doctor', 'pharmacy') then
    p_role := 'reception';
  end if;

  user_email := clean_user || '@clinic.local';

  if exists (select 1 from auth.users where lower(email) = user_email) or
     exists (select 1 from public.profiles where lower(username) = clean_user) then
    raise exception 'اسم المستخدم «%» مسجل مسبقاً', clean_user;
  end if;

  encrypted_pw := crypt(p_password, gen_salt('bf'));

  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
  ) values (
    new_id, '00000000-0000-0000-0000-000000000000', user_email, encrypted_pw, now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'username', clean_user, 'role', p_role),
    now(), now(), 'authenticated', 'authenticated'
  );

  insert into public.profiles (id, full_name, role, username, active)
  values (new_id, p_full_name, p_role, clean_user, true)
  on conflict (id) do update set
    full_name = excluded.full_name,
    role = excluded.role,
    username = excluded.username,
    active = true;

  return json_build_object('id', new_id, 'username', clean_user, 'email', user_email, 'full_name', p_full_name, 'role', p_role);
end $$;
grant execute on function admin_create_user(text, text, text, text) to authenticated;

create or replace function admin_set_user_password(
  p_user_id uuid,
  p_new_password text
) returns void
language plpgsql security definer set search_path = auth, public, extensions as $$
begin
  if (select role from public.profiles where id = auth.uid() and active) <> 'admin' then
    raise exception 'غير مصرح: صلاحية مدير مطلوبة';
  end if;
  if length(trim(p_new_password)) < 6 then
    raise exception 'كلمة المرور يجب أن لا تقل عن 6 خانات';
  end if;
  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;
  if not found then
    raise exception 'المستخدم غير موجود';
  end if;
end $$;
grant execute on function admin_set_user_password(uuid, text) to authenticated;

create or replace function admin_delete_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = auth, public as $$
begin
  if (select role from public.profiles where id = auth.uid() and active) <> 'admin' then
    raise exception 'غير مصرح: صلاحية مدير مطلوبة';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'لا يمكنك حذف حسابك الحالي المسجل به الدخول';
  end if;
  delete from public.employees where user_id = p_user_id;
  delete from auth.users where id = p_user_id;
end $$;
grant execute on function admin_delete_user(uuid) to authenticated;

create or replace function admin_update_user(
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_role text,
  p_active boolean default true,
  p_avatar_url text default null
) returns void
language plpgsql security definer set search_path = auth, public as $$
begin
  if (select role from public.profiles where id = auth.uid() and active) <> 'admin' then
    raise exception 'غير مصرح: صلاحية مدير مطلوبة';
  end if;

  update public.profiles
  set username = lower(trim(p_username)),
      full_name = p_full_name,
      role = p_role,
      active = p_active,
      avatar_url = coalesce(p_avatar_url, avatar_url)
  where id = p_user_id;

  update auth.users
  set raw_user_meta_data = jsonb_build_object('full_name', p_full_name, 'username', lower(trim(p_username)), 'role', p_role)
  where id = p_user_id;
end $$;
grant execute on function admin_update_user(uuid, text, text, text, boolean, text) to authenticated;