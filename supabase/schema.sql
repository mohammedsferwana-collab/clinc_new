-- مركز الأمل الطبي — قاعدة البيانات (Supabase / PostgreSQL)
-- شغّل هذا الملف كاملاً مرة واحدة في: Supabase ← SQL Editor ← New query ← Run

create extension if not exists pgcrypto;

-- ========== المستخدمون والصلاحيات ==========
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  role text not null default 'reception' check (role in ('admin','reception','doctor','pharmacy')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- أول مستخدم يُنشأ يصبح مديراً تلقائياً، والبقية «استقبال» حتى يغيّر المدير دورهم
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, full_name, role)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          case when (select count(*) from profiles) = 0 then 'admin' else 'reception' end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

-- ========== الجداول ==========
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
  case_type text check (case_type in ('جديد','مراجع')),
  diagnosis text,
  notes text,
  legacy_prescription text,           -- العلاج القديم المستورد كنص حر
  status text not null default 'waiting' check (status in ('waiting','seen')),
  source text not null default 'app',
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);
create index if not exists visits_date_idx on visits (visit_date);
create index if not exists visits_patient_idx on visits (patient_id, visit_date desc);

create table if not exists drugs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null default 'حبة',
  min_stock int not null default 0,
  active boolean not null default true
);

create table if not exists visit_items (        -- بنود الوصفة (يكتبها الطبيب وتصرفها الصيدلية)
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
  qty int not null,                     -- in/out موجبة دائماً، adjust بإشارتها
  movement_date date not null default current_date,
  note text,
  item_id uuid references visit_items,
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);
create index if not exists movements_drug_idx on stock_movements (drug_id);
create index if not exists movements_date_idx on stock_movements (movement_date);

create or replace view drug_balance with (security_invoker = true) as
select d.id, d.name, d.unit, d.min_stock, d.active,
       coalesce(sum(case m.kind when 'in' then m.qty when 'out' then -m.qty else m.qty end), 0)::int as balance
from drugs d left join stock_movements m on m.drug_id = d.id
group by d.id;

-- صرف بند من الوصفة وخصمه من المخزون في خطوة واحدة (لا يمكن صرفه مرتين)
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
  using (my_role() = 'admin') with check (my_role() = 'admin');

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
create policy d_visits on visits for delete to authenticated using (my_role() = 'admin');

drop policy if exists w_items on visit_items;
create policy w_items on visit_items for all to authenticated
  using (my_role() in ('admin','doctor')) with check (my_role() in ('admin','doctor'));

drop policy if exists w_drugs on drugs;
create policy w_drugs on drugs for all to authenticated
  using (my_role() in ('admin','pharmacy')) with check (my_role() in ('admin','pharmacy'));

drop policy if exists i_moves on stock_movements;
drop policy if exists d_moves on stock_movements;
create policy i_moves on stock_movements for insert to authenticated with check (my_role() in ('admin','pharmacy'));
create policy d_moves on stock_movements for delete to authenticated using (my_role() = 'admin');
