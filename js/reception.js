import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, debounce, fmtDate, errMsg, fetchAll } from './ui.js';
import { exportBar } from './export.js';

const STATUS = { waiting: ['بانتظار الطبيب', 'wait'], seen: ['تمت المعاينة', 'ok'] };
const treatmentText = v =>
  (v.visit_items || []).map(i => i.drug_text + (i.qty > 1 ? ` × ${i.qty}` : '')).join('، ') || v.legacy_prescription || '—';

export function renderReception(root, ctx) {
  const { sb } = ctx;
  let filter = '', todayRows = [];

  root.innerHTML = `<header class="pagehead">
      <h1>الاستقبال</h1>
      <button class="btn primary" id="openFormBtn">صفحة الاستمارة (تسجيل مراجع وزيارة)</button>
    </header>
    <div class="searchbox">
      <input id="q" type="search" placeholder="بحث برقم الهوية، الاسم، أو الجوال" autocomplete="off" aria-label="بحث عن مراجع">
      <button class="btn" id="searchBtn">بحث</button>
    </div>
    <div id="results"></div>
    <section>
      <div class="row between" style="margin-bottom:.6rem">
        <h2 style="margin:0">زيارات اليوم</h2>
        <div class="chips" id="chips"></div>
      </div>
      <div id="today"></div>
    </section>`;

  const q = root.querySelector('#q');
  const results = root.querySelector('#results');
  q.focus();

  root.querySelector('#chips').parentElement.append(exportBar(() => ({
    title: 'زيارات اليوم', subtitle: N.todayISO(), filename: 'زيارات-' + N.todayISO(),
    sections: [{ heading: 'الزيارات', columns: ['#', 'المراجع', 'الهوية', 'العيادة', 'الطبيب', 'الحالة'],
      rows: todayRows.map((v, i) => [i + 1, v.patients?.full_name || '', v.patients?.national_id || '', v.clinic || '', v.doctor_name || '', STATUS[v.status][0]]) }]
  })));

  async function loadToday() {
    const { data, error } = await sb.from('visits')
      .select('id,clinic,doctor_name,status,created_at,age_at_visit,patients(full_name,national_id)')
      .eq('visit_date', N.todayISO()).order('created_at', { ascending: false });
    if (error) return toast(errMsg(error), 'bad');
    todayRows = data;
    const counts = {};
    data.forEach(v => { const c = v.clinic || 'بدون عيادة'; counts[c] = (counts[c] || 0) + 1; });
    root.querySelector('#chips').innerHTML =
      `<button class="chip ${filter ? '' : 'on'}" data-c="">الكل ${data.length}</button>` +
      Object.entries(counts).map(([c, n]) => `<button class="chip ${filter === c ? 'on' : ''}" data-c="${esc(c)}">${esc(c)} ${n}</button>`).join('');
    const rows = data.filter(v => !filter || (v.clinic || 'بدون عيادة') === filter);
    root.querySelector('#today').innerHTML = rows.length
      ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>المراجع</th><th>الهوية</th><th>العيادة</th><th>الطبيب</th><th>العمر</th><th>الحالة</th><th>الوقت</th><th>إجراءات</th></tr></thead><tbody>${rows.map((v, i) =>
          `<tr data-id="${v.id}"><td>${i + 1}</td><td>${esc(v.patients?.full_name)}</td><td>${esc(v.patients?.national_id || '—')}</td><td>${esc(v.clinic || '—')}</td><td>${esc(v.doctor_name || '—')}</td>
           <td>${esc(v.age_at_visit || '—')}</td>
           <td><span class="badge ${STATUS[v.status][1]}">${STATUS[v.status][0]}</span></td>
           <td>${new Date(v.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</td>
           <td class="row" style="gap:.25rem; flex-wrap:nowrap">
             <button class="btn sm" data-act="edit" title="تعديل بيانات الزيارة">تعديل</button>
             <button class="btn sm danger" data-act="del" title="حذف الزيارة">حذف</button>
           </td></tr>`).join('')}</tbody></table></div>`
      : '<div class="panel empty">لا توجد زيارات مسجلة اليوم.</div>';
  }

  root.querySelector('#chips').onclick = e => {
    const b = e.target.closest('.chip');
    if (b) { filter = b.dataset.c; loadToday(); }
  };
  root.querySelector('#today').onclick = e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const v = todayRows.find(x => x.id === tr?.dataset.id);
    if (!v) return;
    if (btn.dataset.act === 'edit') openEditVisit(ctx, v, loadToday);
    else if (btn.dataset.act === 'del') deleteVisit(ctx, v, loadToday);
  };

  // البحث المخصص (R2) مع فصل حالات الفشل عن عدم الوجود
  const executeSearch = async () => {
    const val = N.digits(q.value).trim();
    if (!val) { results.innerHTML = ''; return; }
    
    results.innerHTML = '<div class="panel">جارٍ البحث في السجلات...</div>';
    try {
      let qb = sb.from('patients').select('*, visits(visit_date, clinic, doctor_name)').limit(10);
      const isNum = /^\d+$/.test(val);
      if (isNum) {
        qb = qb.or(`national_id.eq.${val},phone.ilike.%${val}%`);
      } else {
        qb = qb.ilike('search_name', '%' + N.arNorm(val).replace(/ /g, '%') + '%');
      }

      const { data, error } = await qb;
      if (error) {
        results.innerHTML = `<div class="panel" style="color:var(--bad)">فشل الاتصال أثناء البحث: ${esc(errMsg(error))}</div>`;
        return;
      }

      if (!data || !data.length) {
        // حالة غير مسجل (R2): إتاحة الانتقال إلى الاستمارة مع الاحتفاظ برقم الهوية
        results.innerHTML = `<div class="panel empty">
          <p>المراجع غير مسجل في النظام.</p>
          <button class="btn primary" id="regNewBtn">تسجيل مراجع جديد برقم الهوية (${esc(val)})</button>
        </div>`;
        const btn = results.querySelector('#regNewBtn');
        if (btn) btn.onclick = () => renderFormModal(ctx, { national_id: val }, loadToday);
        return;
      }

      // حالة العثور على مراجع: عرض الجدول وآخر زيارة
      results.innerHTML = `<div class="tablewrap" style="margin-bottom:1.4rem">
        <table>
          <thead>
            <tr>
              <th>الاسم الرباعي</th>
              <th>رقم الهوية</th>
              <th>رقم الجوال</th>
              <th>آخر زيارة مسجلة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(p => {
              const lastV = (p.visits || []).sort((a,b) => b.visit_date.localeCompare(a.visit_date))[0];
              return `<tr data-id="${p.id}">
                <td>${esc(p.full_name)}</td>
                <td>${esc(p.national_id || '—')}</td>
                <td>${esc(p.phone || '—')}</td>
                <td>${lastV ? `${fmtDate(lastV.visit_date)} (${esc(lastV.clinic || '')})` : 'لا توجد زيارات سابقة'}</td>
                <td><button class="btn sm primary" data-act="addvisit">تسجيل زيارة جديدة</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

      results.onclick = e => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        const p = data.find(x => x.id === tr.dataset.id);
        if (e.target.dataset.act === 'addvisit') {
          openNewVisitSection(ctx, p, loadToday);
        }
      };
    } catch (e) {
      results.innerHTML = `<div class="panel" style="color:var(--bad)">خطأ تقني أثناء الاتصال: ${esc(errMsg(e))}</div>`;
    }
  };

  q.addEventListener('input', debounce(executeSearch, 400));
  root.querySelector('#searchBtn').onclick = executeSearch;
  root.querySelector('#openFormBtn').onclick = () => renderFormModal(ctx, {}, loadToday);

  loadToday();
  const t = setInterval(loadToday, 20000);
  ctx.cleanup = () => clearInterval(t);
}

// شاشة الاستمارة المتكاملة (R1) بالحقول الأحد عشر كاملة
export function renderFormModal(ctx, initialData = {}, onDone) {
  const { sb, clinics, doctors } = ctx;
  const today = N.todayISO();

  const body = openModal(`<h2>الاستمارة — تسجيل مراجع وزيارة جديدة</h2>
    <form id="estmaraForm" class="grid">
      <!-- 1. تاريخ الزيارة -->
      <div>
        <label>1. تاريخ الزيارة *</label>
        <input name="visit_date" type="date" required value="${today}">
      </div>
      <!-- 2. الاسم الرباعي -->
      <div>
        <label>2. الاسم الرباعي *</label>
        <input name="full_name" required value="${esc(initialData.full_name || '')}">
      </div>
      <!-- 3. رقم الهوية -->
      <div>
        <label>3. رقم الهوية *</label>
        <input name="national_id" inputmode="numeric" required value="${esc(initialData.national_id || '')}">
      </div>
      <!-- 4. رقم الجوال -->
      <div>
        <label>4. رقم الجوال</label>
        <input name="phone" inputmode="tel" value="${esc(initialData.phone || '')}">
      </div>
      <!-- 5. عنوان النزوح الحالي -->
      <div style="grid-column:1/-1">
        <label>5. عنوان النزوح الحالي</label>
        <input name="address" value="${esc(initialData.address || '')}">
      </div>
      <!-- 6. الجنس -->
      <div>
        <label>6. الجنس *</label>
        <select name="gender" required>
          <option value="">اختر</option>
          <option value="ذكر" ${initialData.gender === 'ذكر' ? 'selected' : ''}>ذكر</option>
          <option value="أنثى" ${initialData.gender === 'أنثى' ? 'selected' : ''}>أنثى</option>
        </select>
      </div>
      <!-- 7. نوع الحالة -->
      <div>
        <label>7. نوع الحالة *</label>
        <select name="case_type" required>
          <option value="جديد">جديد</option>
          <option value="مراجع">مراجع</option>
        </select>
      </div>
      <!-- 8. تاريخ الميلاد -->
      <div>
        <label>8. تاريخ الميلاد</label>
        <input name="birth_date" id="bDate" type="date" max="${today}" value="${esc(initialData.birth_date || '')}">
      </div>
      <!-- 9. العمر عند الزيارة (محسوب آلياً) -->
      <div>
        <label>9. العمر عند الزيارة</label>
        <input name="age_calc" id="ageCalc" readonly placeholder="يُحسب آلياً">
      </div>
      <!-- 10. العيادة المختصة -->
      <div>
        <label>10. العيادة المختصة *</label>
        <select name="clinic" id="cSelect" required>
          <option value="">اختر العيادة</option>
          ${clinics.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <!-- 11. اسم الطبيب -->
      <div>
        <label>11. اسم الطبيب</label>
        <input name="doctor_name" list="docList" placeholder="اختر أو اكتب الطبيب">
        <datalist id="docList">
          ${doctors.map(d => `<option value="${esc(d.name)}">`).join('')}
        </datalist>
      </div>
      <div style="grid-column:1/-1; margin-top:.8rem">
        <button class="btn primary" id="saveFormBtn" style="width:100%">حفظ الاستمارة وإنشاء الزيارة</button>
      </div>
    </form>`, { wide: true });

  const form = body.querySelector('#estmaraForm');
  const bDate = body.querySelector('#bDate');
  const vDate = form.querySelector('[name=visit_date]');
  const ageCalc = body.querySelector('#ageCalc');

  const updateAge = () => {
    if (bDate.value && vDate.value) {
      ageCalc.value = N.ageText(bDate.value, vDate.value);
    } else {
      ageCalc.value = '—';
    }
  };
  bDate.onchange = updateAge;
  vDate.onchange = updateAge;
  updateAge();

  form.onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('#saveFormBtn');
    btn.disabled = true;

    try {
      const natId = N.cleanId(f.national_id);
      if (!natId) throw new Error('رقم الهوية غير صالح');

      // 1. فحص وجود المريض برقم الهوية لمنع الازدواجية
      let { data: patient } = await sb.from('patients').select('id').eq('national_id', natId).maybeSingle();
      
      const patData = {
        full_name: N.cleanText(f.full_name),
        national_id: natId,
        phone: N.cleanPhone(f.phone),
        address: N.cleanText(f.address) || null,
        gender: f.gender || null,
        birth_date: f.birth_date || null
      };

      if (!patient) {
        const { data: newP, error: pErr } = await sb.from('patients').insert({
          ...patData,
          created_by: ctx.profile.id
        }).select().single();
        if (pErr) throw pErr;
        patient = newP;
      } else {
        // تحديث بيانات المريض الموجود
        await sb.from('patients').update(patData).eq('id', patient.id);
      }

      // 2. إنشاء الزيارة الموجهة
      const ageStr = N.ageText(f.birth_date, f.visit_date);
      const { error: vErr } = await sb.from('visits').insert({
        patient_id: patient.id,
        visit_date: f.visit_date,
        clinic: f.clinic,
        doctor_name: N.cleanText(f.doctor_name) || null,
        case_type: f.case_type,
        age_at_visit: ageStr,
        status: 'waiting',
        created_by: ctx.profile.id
      });
      if (vErr) throw vErr;

      toast('تم حفظ الاستمارة وتوجيه الزيارة بنجاح');
      closeModal();
      if (onDone) onDone();
    } catch (err) {
      toast(errMsg(err), 'bad');
      btn.disabled = false;
    }
  };
}

// شاشة تسجيل زيارة لمريض موجود مسبقاً (R3)
function openNewVisitSection(ctx, patient, onDone) {
  const { sb, clinics, doctors } = ctx;
  const today = N.todayISO();

  const body = openModal(`<h2>تسجيل زيارة: ${esc(patient.full_name)}</h2>
    <p class="muted">هوية: ${esc(patient.national_id || '—')} | جوال: ${esc(patient.phone || '—')}</p>
    <form id="quickVisitForm" class="grid">
      <div>
        <label>تاريخ الزيارة</label>
        <input name="visit_date" type="date" required value="${today}">
      </div>
      <div>
        <label>العيادة المختصة *</label>
        <select name="clinic" required>
          <option value="">اختر العيادة</option>
          ${clinics.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>الطبيب المختص</label>
        <input name="doctor_name" list="docQuickList" placeholder="اسم الطبيب">
        <datalist id="docQuickList">
          ${doctors.map(d => `<option value="${esc(d.name)}">`).join('')}
        </datalist>
      </div>
      <div>
        <label>نوع الحالة</label>
        <select name="case_type">
          <option value="مراجع">مراجع</option>
          <option value="جديد">جديد</option>
        </select>
      </div>
      <div style="grid-column:1/-1; margin-top:.8rem">
        <button class="btn primary" id="submitVisitBtn" style="width:100%">إرسال الزيارة إلى عيادة الطبيب</button>
      </div>
    </form>`);

  const form = body.querySelector('#quickVisitForm');
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('#submitVisitBtn');
    btn.disabled = true;

    const f = Object.fromEntries(new FormData(form));
    const ageStr = N.ageText(patient.birth_date, f.visit_date);

    try {
      const { error } = await sb.from('visits').insert({
        patient_id: patient.id,
        visit_date: f.visit_date,
        clinic: f.clinic,
        doctor_name: N.cleanText(f.doctor_name) || null,
        case_type: f.case_type,
        age_at_visit: ageStr,
        status: 'waiting',
        created_by: ctx.profile.id
      });
      if (error) throw error;

      toast('تم إرسال الزيارة إلى الطبيب');
      closeModal();
      if (onDone) onDone();
    } catch (err) {
      toast(errMsg(err), 'bad');
      btn.disabled = false;
    }
  };
}

/* ============ قائمة الزيارات والتشخيص (R4, R5) ============ */
export function renderVisits(root, ctx) {
  const { sb } = ctx;
  const today = N.todayISO();
  let rows = [], shown = [], clinic = localStorage.getItem('visits_clinic') || '';

  root.innerHTML = `<header class="pagehead">
      <h1>سجل الزيارات والتشخيص</h1>
      <span id="bar"></span>
    </header>
    <div class="panel noprint">
      <div class="row">
        <div style="flex:1;min-width:240px">
          <label>بحث بالاسم / الهوية / التشخيص</label>
          <input id="q" type="search" placeholder="بحث..." autocomplete="off">
        </div>
        <div>
          <label>من تاريخ</label>
          <input type="date" id="d1" value="${today}">
        </div>
        <div>
          <label>إلى تاريخ</label>
          <input type="date" id="d2" value="${today}">
        </div>
        <div>
          <label>الحالة</label>
          <select id="st">
            <option value="">الكل</option>
            <option value="waiting">بانتظار الطبيب</option>
            <option value="seen">تمت المعاينة</option>
          </select>
        </div>
      </div>
    </div>
    <div class="chips" id="clinics" style="margin-bottom:.8rem"></div>
    <div id="list"></div>`;

  const $ = id => root.querySelector('#' + id);

  async function load() {
    let a = $('d1').value || today, b =$('d2').value || a;
    if (a > b) [a, b] = [b, a];
    const st = $('st').value;

    try {
      rows = await fetchAll(() => {
        let q = sb.from('visits').select(`
          id,visit_date,clinic,doctor_name,case_type,status,diagnosis,notes,legacy_prescription,age_at_visit,created_at,
          patients(id,full_name,national_id,phone,gender,birth_date,address),
          visit_items(id,drug_id,drug_text,qty,dosage,dispensed_at)
        `).gte('visit_date', a).lte('visit_date', b).order('created_at', { ascending: false });
        return st ? q.eq('status', st) : q;
      });
      draw();
    } catch (e) {
      toast(errMsg(e), 'bad');
    }
  }

  function draw() {
    const t = N.arNorm($('q').value);
    const base = rows.filter(v => !t || N.arNorm([v.patients?.full_name, v.patients?.national_id, v.diagnosis, v.doctor_name].join(' ')).includes(t));
    shown = base.filter(v => !clinic || (v.clinic || 'بدون عيادة') === clinic);

    $('list').innerHTML = shown.length
      ? `<div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>المريض</th>
              <th>العمر</th>
              <th>العيادة</th>
              <th>الطبيب</th>
              <th>التشخيص</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map(v => `
              <tr data-id="${v.id}">
                <td>${fmtDate(v.visit_date)}</td>
                <td><b>${esc(v.patients?.full_name)}</b><br><span class="muted small">${esc(v.patients?.national_id || '')}</span></td>
                <td>${esc(v.age_at_visit || N.ageText(v.patients?.birth_date, v.visit_date))}</td>
                <td>${esc(v.clinic || '—')}</td>
                <td>${esc(v.doctor_name || '—')}</td>
                <td>${esc(v.diagnosis || '—')}</td>
                <td><span class="badge ${STATUS[v.status][1]}">${STATUS[v.status][0]}</span></td>
                <td class="row" style="gap:.25rem; flex-wrap:nowrap">
                  <button class="btn sm primary" data-act="open" title="فتح الملف والتشخيص">الملف والتشخيص</button>
                  <button class="btn sm" data-act="edit" title="تعديل بيانات الزيارة">تعديل</button>
                  <button class="btn sm danger" data-act="del" title="حذف الزيارة نهائياً">حذف</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`
      : '<div class="panel empty">لا توجد زيارات مطابقة.</div>';
  }

  $('list').onclick = e => {
    const btn = e.target.closest('button[data-act]');
    const tr = e.target.closest('tr');
    if (!tr) return;
    const v = shown.find(x => x.id === tr.dataset.id);
    if (!v) return;

    const act = btn?.dataset.act;
    if (act === 'edit') {
      openEditVisit(ctx, v, load);
    } else if (act === 'del') {
      deleteVisit(ctx, v, load);
    } else {
      openDoctorConsultation(ctx, v, load);
    }
  };

  $('q').oninput = debounce(draw, 200);$('d1').onchange = $('d2').onchange =$('st').onchange = load;

  load();
  const t = setInterval(load, 15000); // تحديث دوري تلقائي لعيادة الطبيب (R4)
  ctx.cleanup = () => clearInterval(t);
}

// شاشة الطبيب وملف المريض وكتابة الوصفة (R4, R5)
async function openDoctorConsultation(ctx, v, onDone) {
  const { sb, drugs, profile } = ctx;
  const isDoctorOrAdmin = ['doctor', 'admin'].includes(profile.role);

  // جلب السجلات والتشخيصات السابقة للمريض
  const { data: history } = await sb.from('visits')
    .select('id,visit_date,clinic,doctor_name,diagnosis,legacy_prescription,visit_items(drug_text,qty)')
    .eq('patient_id', v.patients.id)
    .neq('id', v.id)
    .order('visit_date', { ascending: false });

  const body = openModal(`<h2>الملف الطبي: ${esc(v.patients.full_name)}</h2>
    <div class="panel">
      <div class="row between">
        <span><b>رقم الهوية:</b> ${esc(v.patients.national_id || '—')}</span>
        <span><b>الجنس:</b> ${esc(v.patients.gender || '—')}</span>
        <span><b>العمر عند الزيارة:</b> ${esc(v.age_at_visit || N.ageText(v.patients.birth_date, v.visit_date))}</span>
      </div>
    </div>
    
    <h3>السجل والتشخيصات السابقة</h3>
    <div style="max-height:160px; overflow-y:auto; margin-bottom:1rem">
      ${(history && history.length) ? history.map(h => `
        <div class="hist">
          <b>${fmtDate(h.visit_date)}</b> — العيادة: ${esc(h.clinic || '—')} (الطبيب: ${esc(h.doctor_name || '—')})<br>
          <span class="muted">التشخيص:</span> ${esc(h.diagnosis || '—')}<br>
          <span class="muted">العلاج:</span> ${esc(treatmentText(h))}
        </div>
      `).join('') : '<p class="muted">لا توجد زيارات سابقة لهذا المريض.</p>'}
    </div>

    <h3>تسجيل التشخيص والوصفة الطبية (الزيارة الحالية)</h3>
    <form id="diagForm">
      <div>
        <label>التشخيص الطبي *</label>
        <textarea name="diagnosis" required placeholder="اكتب التشخيص هنا..." ${!isDoctorOrAdmin ? 'disabled' : ''}>${esc(v.diagnosis || '')}</textarea>
      </div>
      <div style="margin-top:.6rem">
        <label>ملاحظات إضافية</label>
        <input name="notes" value="${esc(v.notes || '')}" placeholder="تعليمات أو توصيات..." ${!isDoctorOrAdmin ? 'disabled' : ''}>
      </div>

      <h4 style="margin:1rem 0 .4rem">الأدوية الموصوفة</h4>
      <div id="rxItems"></div>
      ${isDoctorOrAdmin ? '<button type="button" class="btn sm" id="addDrugBtn">+ إضافة دواء للوصفة</button>' : ''}

      <div style="margin-top:1.2rem">
        ${isDoctorOrAdmin ? '<button class="btn primary" id="saveDiagBtn">حفظ التشخيص وإرسال الوصفة للصيدلية</button>' : '<p class="muted">صلاحية الطبيب مطلوبة لتسجيل التشخيص.</p>'}
      </div>
    </form>`, { wide: true });

  const rxContainer = body.querySelector('#rxItems');
  const addBtn = body.querySelector('#addDrugBtn');

  const renderDrugRow = (item = {}) => {
    const div = document.createElement('div');
    div.className = 'item-row';
    div.style.gridTemplateColumns = '1.8fr 90px 1.5fr auto';
    div.style.alignItems = 'center';
    div.innerHTML = `
      <input list="stockDrugs" class="dName" placeholder="اسم الدواء من المخزون" value="${esc(item.drug_text || '')}" ${!isDoctorOrAdmin ? 'disabled' : ''} required>
      <input type="number" class="dQty" min="1" value="${item.qty || 1}" title="الكمية" ${!isDoctorOrAdmin ? 'disabled' : ''} required>
      <input class="dDosage" placeholder="الجرعة (مثال: مرتين يومياً)" value="${esc(item.dosage || '')}" ${!isDoctorOrAdmin ? 'disabled' : ''}>
      ${isDoctorOrAdmin ? '<button type="button" class="btn sm danger delDrug">×</button>' : ''}
    `;
    div.querySelector('.delDrug')?.addEventListener('click', () => div.remove());
    rxContainer.append(div);
  };

  // إضافة قائمة خيارات الأدوية
  const dl = document.createElement('datalist');
  dl.id = 'stockDrugs';
  dl.innerHTML = drugs.map(d => `<option value="${esc(d.name)}">`).join('');
  body.append(dl);

  if (v.visit_items && v.visit_items.length) {
    v.visit_items.forEach(renderDrugRow);
  } else if (isDoctorOrAdmin) {
    renderDrugRow();
  }

  if (addBtn) addBtn.onclick = () => renderDrugRow();

  const dForm = body.querySelector('#diagForm');
  dForm.onsubmit = async e => {
    e.preventDefault();
    const saveBtn = body.querySelector('#saveDiagBtn');
    saveBtn.disabled = true;

    try {
      const diagVal = N.cleanText(dForm.diagnosis.value);
      const notesVal = N.cleanText(dForm.notes.value) || null;

      // تجميع الأدوية
      const rows = [...rxContainer.querySelectorAll('.item-row')].map(r => {
        return {
          text: N.cleanText(r.querySelector('.dName').value),
          qty: parseInt(r.querySelector('.dQty').value) || 1,
          dosage: N.cleanText(r.querySelector('.dDosage').value) || null
        };
      }).filter(r => r.text);

      const drugMap = new Map(drugs.map(d => [d.name.toLowerCase(), d.id]));

      // 1. تحديث الزيارة
      const { error: vErr } = await sb.from('visits').update({
        diagnosis: diagVal,
        notes: notesVal,
        status: 'seen'
      }).eq('id', v.id);
      if (vErr) throw vErr;

      // 2. تحديث الوصفة الطبية (حذف غير المصروف وإعادة إدخاله)
      await sb.from('visit_items').delete().eq('visit_id', v.id).is('dispensed_at', null);
      if (rows.length) {
        const { error: iErr } = await sb.from('visit_items').insert(rows.map(r => ({
          visit_id: v.id,
          drug_id: drugMap.get(r.text.toLowerCase()) || null,
          drug_text: r.text,
          qty: r.qty,
          dosage: r.dosage
        })));
        if (iErr) throw iErr;
      }

      toast('تم حفظ التشخيص وإرسال الوصفة إلى الصيدلية');
      closeModal();
      if (onDone) onDone();
    } catch (err) {
      toast(errMsg(err), 'bad');
      saveBtn.disabled = false;
    }
  };
}
// دالة تعديل بيانات الزيارة (تاريخ، عيادة، طبيب، حالة، تشخيص، ملاحظات)
export function openEditVisit(ctx, v, onDone) {
  const { sb, clinics = [], doctors = [] } = ctx;
  const pName = v.patients?.full_name || 'المراجع';
  const pId = v.patients?.national_id || '—';

  const body = openModal(`<h2>تعديل بيانات الزيارة: ${esc(pName)}</h2>
    <p class="muted small" style="margin-top:-.4rem; margin-bottom:.8rem">رقم الهوية: ${esc(pId)}</p>
    <form id="editVisitForm" class="grid">
      <div>
        <label>تاريخ الزيارة *</label>
        <input name="visit_date" type="date" value="${v.visit_date || N.todayISO()}" required>
      </div>
      <div>
        <label>العيادة *</label>
        <input name="clinic" list="clinicsList" value="${esc(v.clinic || '')}" required placeholder="اختر أو اكتب العيادة">
        <datalist id="clinicsList">
          ${clinics.map(c => `<option value="${esc(c.name)}"></option>`).join('')}
        </datalist>
      </div>
      <div>
        <label>الطبيب المعالج</label>
        <input name="doctor_name" list="doctorsList" value="${esc(v.doctor_name || '')}" placeholder="اختر أو اكتب اسم الطبيب">
        <datalist id="doctorsList">
          ${doctors.map(d => `<option value="${esc(d.name)}"></option>`).join('')}
        </datalist>
      </div>
      <div>
        <label>نوع الحالة</label>
        <select name="case_type">
          ${['جديد', 'مراجع', 'استشارة', 'طوارئ', 'أخرى'].map(t => `<option value="${t}" ${v.case_type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>حالة الزيارة *</label>
        <select name="status" required>
          <option value="waiting" ${v.status === 'waiting' ? 'selected' : ''}>بانتظار الطبيب</option>
          <option value="seen" ${v.status === 'seen' ? 'selected' : ''}>تمت المعاينة</option>
        </select>
      </div>
      <div>
        <label>العمر عند الزيارة (اختياري)</label>
        <input name="age_at_visit" value="${esc(v.age_at_visit || '')}" placeholder="مثال: 25 سنة">
      </div>
      <div style="grid-column:1/-1">
        <label>التشخيص الطبي</label>
        <textarea name="diagnosis" placeholder="التشخيص الطبي للزيارة...">${esc(v.diagnosis || '')}</textarea>
      </div>
      <div style="grid-column:1/-1">
        <label>ملاحظات إضافية</label>
        <input name="notes" value="${esc(v.notes || '')}" placeholder="أي ملاحظات حول الزيارة...">
      </div>
      <div style="grid-column:1/-1" class="row">
        <button class="btn primary" id="saveVisitBtn" style="flex:1">حفظ تعديلات الزيارة</button>
        <button type="button" class="btn danger" id="delVisitFromEdit">حذف الزيارة</button>
      </div>
    </form>`);

  body.querySelector('#delVisitFromEdit').onclick = () => {
    closeModal();
    deleteVisit(ctx, v, onDone);
  };

  body.querySelector('#editVisitForm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = body.querySelector('#saveVisitBtn');
    btn.disabled = true;

    const rec = {
      visit_date: f.visit_date,
      clinic: N.cleanText(f.clinic) || null,
      doctor_name: N.cleanText(f.doctor_name) || null,
      case_type: f.case_type || null,
      status: f.status,
      age_at_visit: N.cleanText(f.age_at_visit) || null,
      diagnosis: N.cleanText(f.diagnosis) || null,
      notes: N.cleanText(f.notes) || null
    };

    const { error } = await sb.from('visits').update(rec).eq('id', v.id);
    if (error) {
      btn.disabled = false;
      return toast(errMsg(error), 'bad');
    }

    toast('تم تحديث بيانات الزيارة بنجاح');
    closeModal();
    if (onDone) onDone();
  };
}

// دالة حذف الزيارة مع فك الارتباط الآمن بحركات المخزون والوصفات
export async function deleteVisit(ctx, v, onDone) {
  const { sb } = ctx;
  const pName = v.patients?.full_name || 'المراجع';
  const dateStr = fmtDate(v.visit_date);
  if (!confirm(`هل أنت متأكد من حذف زيارة «${pName}» بتاريخ ${dateStr} نهائياً؟\nسيتم حذف تفاصيل الزيارة والوصفة الطبية التابعة لها ولا يمكن التراجع.`)) return;

  try {
    // فك ارتباط حركات المخزون بوصفات هذه الزيارة لتجنب مشاكل القيود
    const { data: items } = await sb.from('visit_items').select('id').eq('visit_id', v.id);
    if (items?.length) {
      await sb.from('stock_movements').update({ item_id: null }).in('item_id', items.map(x => x.id));
    }

    const { error } = await sb.from('visits').delete().eq('id', v.id);
    if (error) return toast(errMsg(error), 'bad');

    toast('تم حذف الزيارة بنجاح');
    if (onDone) onDone();
  } catch (err) {
    toast(errMsg(err), 'bad');
  }
}
