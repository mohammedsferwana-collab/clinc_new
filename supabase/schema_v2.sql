-- المرحلة الثانية: الموظفون، الحضور والانصراف، العهد، وملفات الموظفين
-- شغّل هذا الملف بعد schema.sql (SQL Editor ← New query ← Run)

-- ========== الموظفون ==========
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  national_id text unique,
  phone text,
  gender text check (gender in ('ذكر','أنثى')),
  specialty text,
  user_id uuid unique references auth.users on delete set null,   -- حساب الدخول المرتبط (لزر الحضور الذاتي)
  work_start time not null default '08:00',
  work_end time not null default '15:00',
  grace_minutes int not null default 0 check (grace_minutes >= 0),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists employee_files (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees on delete cascade,
  kind text not null check (kind in ('id','certificate','course','other')),
  title text,
  path text not null,
  file_name text,
  created_at timestamptz not null default now()
);
create index if not exists emp_files_idx on employee_files (employee_id);

-- ========== الحضور ==========
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees on delete cascade,
  work_date date not null,
  check_in timestamptz,
  check_out timestamptz,
  late_minutes int not null default 0,
  source text not null default 'button' check (source in ('button','manual')),
  note text,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index if not exists attendance_date_idx on attendance (work_date);

-- ========== العهد ==========
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  asset_type text not null,
  name text not null,
  serial_no text,
  color text,
  model text,
  assigned_to uuid references employees on delete set null,
  assigned_date date,
  status text not null default 'in_use' check (status in ('in_use','in_store','damaged')),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists assets_emp_idx on assets (assigned_to);

-- ========== الدوال ==========
create or replace function my_employee() returns uuid
language sql stable security definer set search_path = public as $$
  select id from employees where user_id = auth.uid() and active and my_role() is not null
$$;

-- الحضور بتوقيت الخادم (لا يمكن التلاعب بساعة الجهاز). التوقيت المحلي: غزة
create or replace function clock_in() returns void
language plpgsql security definer set search_path = public as $$
declare e employees; ln timestamp := (now() at time zone 'Asia/Gaza'); late int;
begin
  if my_role() is null then raise exception 'غير مصرح'; end if;
  select * into e from employees where user_id = auth.uid() and active;
  if not found then raise exception 'حسابك غير مرتبط بموظف'; end if;
  late := greatest(0, floor(extract(epoch from (ln::time - e.work_start)) / 60)::int - e.grace_minutes);
  insert into attendance(employee_id, work_date, check_in, late_minutes, source)
  values (e.id, ln::date, now(), late, 'button');
exception when unique_violation then
  raise exception 'تم تسجيل الحضور اليوم مسبقاً';
end $$;

create or replace function clock_out() returns void
language plpgsql security definer set search_path = public as $$
declare e employees;
begin
  if my_role() is null then raise exception 'غير مصرح'; end if;
  select * into e from employees where user_id = auth.uid() and active;
  if not found then raise exception 'حسابك غير مرتبط بموظف'; end if;
  update attendance set check_out = now()
   where employee_id = e.id and work_date = (now() at time zone 'Asia/Gaza')::date and check_out is null;
  if not found then raise exception 'لا يوجد حضور مفتوح لليوم'; end if;
end $$;

-- ========== الصلاحيات ==========
alter table employees enable row level security;
alter table employee_files enable row level security;
alter table attendance enable row level security;
alter table assets enable row level security;

drop policy if exists r_employees on employees;
drop policy if exists w_employees on employees;
create policy r_employees on employees for select to authenticated
  using (my_role() = 'admin' or (user_id = auth.uid() and my_role() is not null));
create policy w_employees on employees for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

drop policy if exists w_emp_files on employee_files;
create policy w_emp_files on employee_files for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

drop policy if exists r_attendance on attendance;
drop policy if exists w_attendance on attendance;
create policy r_attendance on attendance for select to authenticated
  using (my_role() = 'admin' or employee_id = my_employee());
create policy w_attendance on attendance for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

drop policy if exists r_assets on assets;
drop policy if exists w_assets on assets;
create policy r_assets on assets for select to authenticated
  using (my_role() = 'admin' or assigned_to = my_employee());
create policy w_assets on assets for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- ========== مخزن الملفات (خاص، للمدير فقط) ==========
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-files', 'employee-files', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists emp_files_admin on storage.objects;
create policy emp_files_admin on storage.objects for all to authenticated
  using (bucket_id = 'employee-files' and my_role() = 'admin')
  with check (bucket_id = 'employee-files' and my_role() = 'admin');
