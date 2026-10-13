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
    <input id="f" placeholder="بحث بالاسم أو الهوية أو التخصص" style="width:260px"><button class="btn" id="importEmpBtn" title="استيراد موظفين من ملف إكسل">+ إضافة بإكسل</button><button class="btn primary" id="new">موظف جديد</button></div></header><div id="list"></div>`;
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
  root.querySelector('#importEmpBtn').onclick = () => openEmployeesExcelImport(ctx, list, load);
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
    <div><label>نوع الدور / الوظيفة في العيادة</label><select name="clinic_role"><option value="">اختر الدور</option>
      <option value="doctor" ${/طبيب|دكتور/i.test(v.specialty || '') ? 'selected' : ''}>طبيب معالج (يُضاف للأطباء تلقائياً)</option>
      <option value="pharmacy" ${/صيدل/i.test(v.specialty || '') ? 'selected' : ''}>صيدلي / صيدلية</option>
      <option value="nurse" ${/تمريض/i.test(v.specialty || '') ? 'selected' : ''}>تمريض</option>
      <option value="reception" ${/استقبال|سكرتار/i.test(v.specialty || '') ? 'selected' : ''}>سكرتاريا واستقبال</option>
      <option value="other">أخرى</option></select></div>
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
    // مزامنة الأطباء تلقائياً إذا كان الموظف طبيباً معالجاً
    if ((f.clinic_role === 'doctor' || /طبيب|دكتور/i.test(rec.specialty || '')) && rec.active) {
      const { data: exDoc } = await sb.from('doctors').select('id').eq('name', rec.full_name).maybeSingle();
      if (!exDoc) await sb.from('doctors').insert({ name: rec.full_name });
      await ctx.loadLookups();
    }
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


// استيراد الموظفين من ملف إكسل
function openEmployeesExcelImport(ctx, existingList, onDone) {
  const { sb } = ctx;

  const body = openModal(`<h2>استيراد موظفين من ملف إكسل</h2>
    <div class="panel" style="margin-bottom:1rem">
      <p>يمكنك إضافة مجموعة من الموظفين دفعة واحدة من ملف إكسل (.xlsx أو .xls أو .csv).</p>
      <div class="row" style="gap:.6rem; margin-top:.5rem">
        <button class="btn sm" id="dlEmpTemplateBtn">⬇ تحميل نموذج إكسل للموظفين</button>
        <span class="muted small">يحتوي النموذج على الأعمدة: الاسم الرباعي، رقم الهوية، رقم التواصل، الجنس، التخصص، بداية الدوام، نهاية الدوام، مهلة التأخير، ملاحظات.</span>
      </div>
    </div>

    <div style="margin-bottom:1rem">
      <label>اختر ملف الإكسل</label>
      <input type="file" id="empExcelFile" accept=".xlsx,.xls,.csv">
    </div>

    <div id="empImportPreview" style="max-height:280px; overflow-y:auto; margin-bottom:1rem"></div>

    <div class="row between" id="empImportActions" hidden>
      <span id="empImportSummary" class="muted"></span>
      <button class="btn primary" id="confirmEmpImportBtn">تأكيد واستيراد الموظفين</button>
    </div>`, { wide: true });

  // تحميل نموذج إكسل
  body.querySelector('#dlEmpTemplateBtn').onclick = () => {
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    const headers = ['الاسم الرباعي', 'رقم الهوية', 'رقم التواصل', 'الجنس', 'التخصص / الوظيفة', 'بداية الدوام', 'نهاية الدوام', 'مهلة التأخير (دقائق)', 'ملاحظات'];
    const sampleData = [
      headers,
      ['د. محمد أحمد سعيد', '900123456', '0599123456', 'ذكر', 'طبيب عام', '08:00', '15:00', 15, 'دوام صباحي'],
      ['سارة محمود خالد', '900654321', '0599654321', 'أنثى', 'صيدلانية', '08:00', '15:00', 10, 'مسؤولة الصيدلية'],
      ['إياد كمال ناصر', '900789123', '0599789123', 'ذكر', 'تمريض', '08:00', '15:00', 0, 'قسم التمريض']
    ];
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    ws['!cols'] = [{ wch: 26 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, 'الموظفون');
    XLSX.writeFile(wb, 'نموذج_الموظفون.xlsx');
  };

  const parseTimeVal = (v, defaultVal) => {
    if (v == null || v === '') return defaultVal;
    if (typeof v === 'number' && v >= 0 && v < 1) {
      const totalSecs = Math.round(v * 86400);
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const s = String(v).trim();
    const match = s.match(/(\d{1,2}):(\d{2})/);
    if (match) return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
    return defaultVal;
  };

  let parsedEmployees = [];
  const fileInput = body.querySelector('#empExcelFile');
  const previewDiv = body.querySelector('#empImportPreview');
  const actionsDiv = body.querySelector('#empImportActions');
  const summarySpan = body.querySelector('#empImportSummary');
  const confirmBtn = body.querySelector('#confirmEmpImportBtn');

  fileInput.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { header: 1, raw: true, defval: '' });

      if (!rawRows || rawRows.length < 2) {
        previewDiv.innerHTML = '<p class="muted bad">الملف فارغ أو لا يحتوي على صفوف بيانات.</p>';
        actionsDiv.hidden = true;
        return;
      }

      // البحث عن صف العناوين
      let headerIdx = -1;
      for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
        const rowStr = rawRows[i].map(c => String(c).trim()).join(' ');
        if (/اسم|موظف|هوية|وظيفة/i.test(rowStr)) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx === -1) headerIdx = 0;

      const headers = rawRows[headerIdx].map(c => String(c).trim());
      const nameCol = headers.findIndex(h => /اسم.*رباعي|^الاسم$|name|employee/i.test(h));
      const idCol = headers.findIndex(h => /هوي|national|id/i.test(h));
      const phoneCol = headers.findIndex(h => /هاتف|جوال|موبايل|تواصل|phone|mobile/i.test(h));
      const genderCol = headers.findIndex(h => /جنس|gender/i.test(h));
      const specCol = headers.findIndex(h => /تخصص|وظيفة|مهنة|specialty|job/i.test(h));
      const startCol = headers.findIndex(h => /بداية.*دوام|حضور|start/i.test(h));
      const endCol = headers.findIndex(h => /نهاية.*دوام|انصراف|end/i.test(h));
      const graceCol = headers.findIndex(h => /مهلة|تأخير|grace/i.test(h));
      const notesCol = headers.findIndex(h => /ملاحظ|note/i.test(h));

      if (nameCol === -1) {
        previewDiv.innerHTML = '<p class="muted bad">تعذر العثور على عمود «الاسم» في ملف الإكسل.</p>';
        actionsDiv.hidden = true;
        return;
      }

      parsedEmployees = [];
      const existingIds = new Set(existingList.map(emp => emp.national_id).filter(Boolean));
      const existingNames = new Set(existingList.map(emp => N.arNorm(emp.full_name)));

      for (let i = headerIdx + 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        const fullName = N.cleanText(r[nameCol]);
        if (!fullName) continue;

        const natId = idCol >= 0 ? N.cleanId(r[idCol]) : null;
        const phone = phoneCol >= 0 ? N.cleanPhone(r[phoneCol]) : null;
        const gender = genderCol >= 0 ? N.normGender(r[genderCol]) : null;
        const specialty = specCol >= 0 ? N.cleanText(r[specCol]) : null;
        const workStart = startCol >= 0 ? parseTimeVal(r[startCol], '08:00') : '08:00';
        const workEnd = endCol >= 0 ? parseTimeVal(r[endCol], '15:00') : '15:00';
        const graceMinutes = graceCol >= 0 ? Math.max(0, parseInt(r[graceCol]) || 0) : 0;
        const notes = notesCol >= 0 ? N.cleanText(r[notesCol]) : null;

        const isDupId = natId && existingIds.has(natId);
        const isDupName = existingNames.has(N.arNorm(fullName));

        parsedEmployees.push({
          full_name: fullName,
          national_id: natId,
          phone,
          gender,
          specialty,
          work_start: workStart,
          work_end: workEnd,
          grace_minutes: graceMinutes,
          notes,
          isDupId,
          isDupName
        });
      }

      if (!parsedEmployees.length) {
        previewDiv.innerHTML = '<p class="muted">لم يتم العثور على موظفين صالحين للاستيراد في الملف.</p>';
        actionsDiv.hidden = true;
        return;
      }

      previewDiv.innerHTML = `
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th>الاسم الرباعي</th>
                <th>رقم الهوية</th>
                <th>رقم التواصل</th>
                <th>الجنس</th>
                <th>التخصص</th>
                <th>الدوام</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              ${parsedEmployees.map(e => `
                <tr>
                  <td><b>${esc(e.full_name)}</b></td>
                  <td>${esc(e.national_id || '—')}</td>
                  <td>${esc(e.phone || '—')}</td>
                  <td>${esc(e.gender || '—')}</td>
                  <td>${esc(e.specialty || '—')}</td>
                  <td>${esc(e.work_start)} – ${esc(e.work_end)}</td>
                  <td>
                    ${e.isDupId
                      ? '<span class="badge bad" title="رقم الهوية مسجل لموظف آخر">تكرار هوية</span>'
                      : e.isDupName
                      ? '<span class="badge wait" title="الاسم مسجل مسبقاً">تكرار اسم</span>'
                      : '<span class="badge ok">جديد</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;

      const validCount = parsedEmployees.filter(e => !e.isDupId).length;
      summarySpan.textContent = `الإجمالي: ${parsedEmployees.length} موظف (${validCount} مؤهل للإضافة).`;
      actionsDiv.hidden = false;

    } catch (err) {
      previewDiv.innerHTML = `<p class="bad">خطأ أثناء قراءة الملف: ${esc(err.message)}</p>`;
      actionsDiv.hidden = true;
    }
  };

  confirmBtn.onclick = async () => {
    if (!parsedEmployees.length) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'جارٍ استيراد الموظفين...';

    let added = 0;
    let skipped = 0;

    for (const emp of parsedEmployees) {
      if (emp.isDupId) {
        skipped++;
        continue;
      }

      const rec = {
        full_name: emp.full_name,
        national_id: emp.national_id,
        phone: emp.phone,
        gender: emp.gender,
        specialty: emp.specialty,
        work_start: emp.work_start,
        work_end: emp.work_end,
        grace_minutes: emp.grace_minutes,
        notes: emp.notes,
        active: true
      };

      const { error } = await sb.from('employees').insert(rec);
      if (error) {
        skipped++;
      } else {
        added++;
      }
    }

    toast(`تم استيراد ${added} موظف بنجاح${skipped ? ` (تم تخطي ${skipped} موظف)` : ''}`);
    closeModal();
    onDone();
  };
}
