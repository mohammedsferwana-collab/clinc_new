import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, errMsg } from './ui.js';
import { exportBar } from './export.js';

const KIND = { id: 'صورة الهوية', certificate: 'شهادة جامعية', course: 'دورة تدريبية', other: 'أخرى' };
const BUCKET = 'employee-files';
const hhmm = t => (t || '').slice(0, 5);

export function renderEmployees(root, ctx) {
  const { sb } = ctx;
  let list = [];
  root.innerHTML = `<header class="pagehead"><h1>الموظفون</h1><div class="row" id="tools">
    <input id="f" placeholder="بحث بالاسم أو الهوية أو التخصص" style="width:260px"><button class="btn primary" id="new">موظف جديد</button></div></header><div id="list"></div>`;
  const tools = root.querySelector('#tools');
  tools.append(exportBar(() => ({
    title: 'قائمة الموظفين', subtitle: 'تاريخ التصدير: ' + N.todayISO(), filename: 'الموظفون-' + N.todayISO(),
    sections: [{ heading: 'الموظفون', columns: ['الاسم الرباعي', 'رقم الهوية', 'رقم التواصل', 'الجنس', 'التخصص', 'بداية الدوام', 'نهاية الدوام', 'الحالة'],
      rows: list.map(e => [e.full_name, e.national_id || '', e.phone || '', e.gender || '', e.specialty || '', hhmm(e.work_start), hhmm(e.work_end), e.active ? 'على رأس العمل' : 'متوقف']) }],
  })));

  async function load() {
    const { data, error } = await sb.from('employees').select('*, employee_files(count)').order('full_name');
    if (error) return toast(errMsg(error), 'bad');
    list = data; draw();
  }
  function draw() {
    const t = N.arNorm(root.querySelector('#f').value);
    const rows = list.filter(e => !t || N.arNorm([e.full_name, e.national_id, e.specialty, e.phone].join(' ')).includes(t));
    root.querySelector('#list').innerHTML = rows.length
      ? `<div class="tablewrap"><table><thead><tr><th>الاسم الرباعي</th><th>الهوية</th><th>التواصل</th><th>الجنس</th><th>التخصص</th><th>الدوام</th><th>الملفات</th><th>الحالة</th></tr></thead><tbody>${rows.map(e =>
        `<tr class="click" data-id="${e.id}"><td>${esc(e.full_name)}</td><td>${esc(e.national_id || '—')}</td><td>${esc(e.phone || '—')}</td><td>${esc(e.gender || '—')}</td><td>${esc(e.specialty || '—')}</td>
        <td>${hhmm(e.work_start)} – ${hhmm(e.work_end)}</td><td>${e.employee_files?.[0]?.count || 0}</td><td><span class="badge ${e.active ? 'ok' : 'bad'}">${e.active ? 'على رأس العمل' : 'متوقف'}</span></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="panel empty">لا يوجد موظفون. اضغط «موظف جديد» لإضافة أول موظف.</div>';
  }
  root.querySelector('#f').oninput = draw;
  root.querySelector('#list').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) openEmployee(ctx, list.find(x => x.id === tr.dataset.id), load); };
  root.querySelector('#new').onclick = () => openEmployee(ctx, null, load);
  load();
}

async function openEmployee(ctx, emp, done) {
  const { sb } = ctx;
  const { data: profs } = await sb.from('profiles').select('id,full_name,role').eq('active', true).order('full_name');
  const v = emp || { work_start: '08:00', work_end: '15:00', grace_minutes: 0, active: true };
  const body = openModal(`<h2>${emp ? esc(emp.full_name) : 'موظف جديد'}</h2><form id="ef" class="grid">
    <div style="grid-column:1/-1"><label>الاسم الرباعي *</label><input name="full_name" required value="${esc(v.full_name)}"></div>
    <div><label>رقم الهوية</label><input name="national_id" inputmode="numeric" value="${esc(v.national_id)}"></div>
    <div><label>رقم التواصل</label><input name="phone" inputmode="tel" value="${esc(v.phone)}"></div>
    <div><label>الجنس</label><select name="gender"><option value="">—</option>${['ذكر', 'أنثى'].map(g => `<option ${v.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
    <div><label>التخصص / الوظيفة</label><input name="specialty" value="${esc(v.specialty)}" placeholder="مثال: طبيب عام، صيدلي، تمريض"></div>
    <div><label>بداية الدوام</label><input name="work_start" type="time" required value="${hhmm(v.work_start)}"></div>
    <div><label>نهاية الدوام</label><input name="work_end" type="time" required value="${hhmm(v.work_end)}"></div>
    <div><label>مهلة التأخير (دقائق)</label><input name="grace_minutes" type="number" min="0" value="${v.grace_minutes}"></div>
    <div><label>حساب الدخول المرتبط (لزر الحضور)</label><select name="user_id"><option value="">بدون حساب</option>${(profs || []).map(p => `<option value="${p.id}" ${v.user_id === p.id ? 'selected' : ''}>${esc(p.full_name)}</option>`).join('')}</select></div>
    <div style="grid-column:1/-1"><label>ملاحظات</label><input name="notes" value="${esc(v.notes)}"></div>
    <div><label><input type="checkbox" name="active" ${v.active ? 'checked' : ''} style="width:auto"> على رأس العمل</label></div>
    <div style="grid-column:1/-1" class="row"><button class="btn primary">${emp ? 'حفظ التعديلات' : 'حفظ الموظف'}</button>${emp ? '<button type="button" class="btn danger" id="del">حذف الموظف</button>' : ''}</div></form>
    <div id="files"></div>`, { wide: true });

  body.querySelector('#ef').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const rec = { full_name: N.cleanText(f.full_name), national_id: N.cleanId(f.national_id), phone: N.cleanPhone(f.phone), gender: f.gender || null,
      specialty: N.cleanText(f.specialty) || null, work_start: f.work_start, work_end: f.work_end, grace_minutes: parseInt(f.grace_minutes) || 0,
      user_id: f.user_id || null, notes: N.cleanText(f.notes) || null, active: !!f.active };
    const res = emp ? await sb.from('employees').update(rec).eq('id', emp.id).select().single() : await sb.from('employees').insert(rec).select().single();
    if (res.error) return toast(res.error.code === '23505' ? 'رقم الهوية أو حساب الدخول مستخدم لموظف آخر' : errMsg(res.error), 'bad');
    toast('تم الحفظ'); await done();
    if (emp) closeModal(); else openEmployee(ctx, res.data, done);   // بعد الإضافة تُفتح البطاقة لرفع الملفات
  };
  if (emp) {
    body.querySelector('#del').onclick = async () => {
      if (!confirm('حذف الموظف نهائياً مع ملفاته وسجل حضوره؟ لا يمكن التراجع.')) return;
      const { data: fs } = await sb.from('employee_files').select('path').eq('employee_id', emp.id);
      if (fs?.length) await sb.storage.from(BUCKET).remove(fs.map(x => x.path));
      const { error } = await sb.from('employees').delete().eq('id', emp.id);
      if (error) return toast(errMsg(error), 'bad');
      toast('تم الحذف'); closeModal(); done();
    };
    filesSection(ctx, emp, body.querySelector('#files'));
  } else body.querySelector('#files').innerHTML = '<p class="muted small">بعد حفظ الموظف تظهر هنا خانة رفع صورة الهوية والشهادات والدورات.</p>';
}

async function filesSection(ctx, emp, box) {
  const { sb } = ctx;
  async function draw() {
    const { data, error } = await sb.from('employee_files').select('*').eq('employee_id', emp.id).order('created_at');
    if (error) return toast(errMsg(error), 'bad');
    box.innerHTML = `<h3>المرفقات</h3><div class="filebox">${data.length ? data.map(f => `<div class="filerow" data-id="${f.id}" data-path="${esc(f.path)}">
      <span><b>${KIND[f.kind]}</b>${f.title ? ' — ' + esc(f.title) : ''} <span class="muted small">${esc(f.file_name || '')}</span></span>
      <span><button class="btn sm" data-a="open">عرض</button> <button class="btn sm danger" data-a="del">حذف</button></span></div>`).join('') : '<span class="muted">لا توجد مرفقات بعد.</span>'}</div>
      <form id="uf" class="row" style="margin-top:.8rem"><div><label>النوع</label><select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div style="flex:1;min-width:160px"><label>الوصف (مثل: بكالوريوس تمريض)</label><input name="title"></div>
      <div><label>الملف (صورة أو PDF، حتى 10 ميجابايت)</label><input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple required></div>
      <button class="btn primary">رفع</button></form>`;
    box.querySelector('.filebox').onclick = async e => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const row = b.closest('.filerow');
      if (b.dataset.a === 'open') {
        const w = window.open('', '_blank');
        const { data: s, error: er } = await sb.storage.from(BUCKET).createSignedUrl(row.dataset.path, 120);
        if (er) { w?.close(); return toast(errMsg(er), 'bad'); }
        if (w) w.location = s.signedUrl; else toast('اسمح بالنوافذ المنبثقة لعرض الملف', 'bad');
      } else if (confirm('حذف هذا المرفق؟')) {
        await sb.storage.from(BUCKET).remove([row.dataset.path]);
        const { error: er } = await sb.from('employee_files').delete().eq('id', row.dataset.id);
        if (er) return toast(errMsg(er), 'bad');
        draw();
      }
    };
    box.querySelector('#uf').onsubmit = async e => {
      e.preventDefault();
      const f = e.target, kind = f.kind.value, title = N.cleanText(f.title.value) || null, btn = f.querySelector('button');
      btn.disabled = true;
      try {
        for (const file of f.file.files) {
          if (file.size > 10 * 1024 * 1024) throw new Error(`الملف «${file.name}» أكبر من 10 ميجابايت`);
          const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
          const path = `${emp.id}/${crypto.randomUUID()}.${ext}`;
          const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type });
          if (up.error) throw up.error;
          const { error } = await sb.from('employee_files').insert({ employee_id: emp.id, kind, title, path, file_name: file.name });
          if (error) { await sb.storage.from(BUCKET).remove([path]); throw error; }
        }
        toast('تم رفع الملفات');
        draw();
      } catch (er) { toast(errMsg(er), 'bad'); btn.disabled = false; }
    };
  }
  draw();
}
