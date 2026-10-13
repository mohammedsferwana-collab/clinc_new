-- المرحلة الثالثة: الإعدادات العامة (الاسم، الشعار، الألوان، أيام الدوام)
-- شغّل هذا الملف بعد schema.sql وschema_v2.sql

create table if not exists app_settings (
  id int primary key default 1 check (id = 1),          -- صف واحد فقط
  site_name text not null default 'مركز الأمل الطبي',
  tagline text,
  logo_path text,
  primary_color text not null default '#0E5A57',
  radius text not null default 'round' check (radius in ('round','soft','square')),
  font_scale text not null default 'normal' check (font_scale in ('small','normal','large')),
  default_mode text not null default 'light' check (default_mode in ('light','dark','auto')),
  phone text,
  address text,
  work_days int[] not null default '{0,1,2,3,4}',        -- 0=الأحد ... 6=السبت
  updated_at timestamptz not null default now()
);
insert into app_settings (id) values (1) on conflict (id) do nothing;

alter table app_settings enable row level security;
drop policy if exists read_settings on app_settings;
drop policy if exists write_settings on app_settings;
-- القراءة متاحة قبل تسجيل الدخول (لعرض الاسم والشعار في صفحة الدخول)، والتعديل للمدير فقط
create policy read_settings on app_settings for select to anon, authenticated using (true);
create policy write_settings on app_settings for update to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- مخزن الشعار (عام للقراءة، والرفع للمدير فقط)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

drop policy if exists branding_admin on storage.objects;
create policy branding_admin on storage.objects for all to authenticated
  using (bucket_id = 'branding' and my_role() = 'admin')
  with check (bucket_id = 'branding' and my_role() = 'admin');
