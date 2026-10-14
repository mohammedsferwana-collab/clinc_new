-- schema_v5: إضافة نوع مرفق «السيرة الذاتية» لمرفقات الموظفين
-- شغّل هذا الملف مرة واحدة في Supabase → SQL Editor
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.employee_files'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.employee_files drop constraint %I', c);
  end loop;
end $$;

alter table public.employee_files
  add constraint employee_files_kind_check
  check (kind in ('id','certificate','cv','course','other'));
