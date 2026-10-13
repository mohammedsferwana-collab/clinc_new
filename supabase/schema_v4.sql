-- المرحلة الرابعة: تسجيل الدخول باسم المستخدم دون إيميل، إضافة المستخدمين بواسطة المدير، وصلاحيات الحذف والتعديل
-- شغّل هذا الملف في Supabase: SQL Editor ← New query ← Run

-- 1. إضافة عمود اسم المستخدم في جدول profiles
alter table profiles add column if not exists username text;
create unique index if not exists profiles_username_idx on profiles (lower(username)) where username is not null;

-- تعيين اسم مستخدم افتراضي للحسابات الحالية من البريد الإلكتروني
update profiles
set username = split_part(u.email, '@', 1)
from auth.users u
where profiles.id = u.id and (profiles.username is null or profiles.username = '');

-- 2. تحديث تريجر إنشاء المستخدم الجديد ليدعم اسم المستخدم
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

-- 3. دالة استرجاع البريد المقابل لاسم المستخدم عند تسجيل الدخول (دون كشف تفاصيل حساسة)
create or replace function get_email_for_username(p_username text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  found_email text;
  clean_u text := lower(trim(p_username));
begin
  if clean_u = '' then return null; end if;

  -- البحث في profiles أولاً
  select u.email into found_email
  from auth.users u
  join profiles p on p.id = u.id
  where lower(p.username) = clean_u and p.active = true
  limit 1;

  -- إن لم يوجد، البحث في بداية البريد الإلكتروني
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

-- 4. دالة للمدير لإضافة مستخدم جديد باسم مستخدم وكلمة مرور دون الحاجة للبريد الخارجي
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
  -- التحقق من صلاحية المدير
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

  -- فحص تكرار اسم المستخدم أو البريد
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

-- 5. دالة للمدير لتغيير كلمة مرور أي مستخدم
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

-- 6. سياسات الأمان لحذف وتعديل الزيارات وحركات الصيدلية
drop policy if exists d_visits on visits;
create policy d_visits on visits for delete to authenticated
  using (my_role() in ('admin','reception'));

drop policy if exists d_moves on stock_movements;
create policy d_moves on stock_movements for delete to authenticated
  using (my_role() in ('admin','pharmacy'));

drop policy if exists u_moves on stock_movements;
create policy u_moves on stock_movements for update to authenticated
  using (my_role() in ('admin','pharmacy'))
  with check (my_role() in ('admin','pharmacy'));
