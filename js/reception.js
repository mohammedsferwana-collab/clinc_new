import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, debounce, fmtDate, errMsg, fetchAll } from './ui.js';
import { exportBar } from './export.js';

const STATUS = { waiting: ['بانتظار الطبيب', 'wait'], seen: ['تمت المعاينة', 'ok'] };
const treatmentText = v =>
  (v.visit_items || []).map(i => i.drug_text + (i.qty > 1 ? ` × ${i.qty}` : '')).join('، ') || v.legacy_prescription || '—';

/* ========================================================
   أولاً: صفحة الاستمارة (بدل الاستقبال)
   تعبأ لكل مريض سيحضر للعيادة بالحقول الأحد عشر كاملة
======================================================== */
export function renderEstmara(root, ctx) {
  const { sb, clinics = [], doctors = [] } = ctx;
  const today = N.todayISO();
  let filter = '', todayRows = [];

  // بيانات مسبقة قادمة من صفحة البحث إن وُجدت
  const prefill = ctx.estmaraPrefill || {};
  ctx.estmaraPrefill = null; // تفريغ بعد الاستخدام

  root.innerHTML = `
    <header class="pagehead">
      <h1>صفحة الاستمارة — تسجيل مراجع جديد</h1>
      <div class="row" style="gap:.5rem">
        <a href="#/search" class="btn" style="text-decoration:none">🔍 الانتقال لصفحة البحث بالهوية</a>
        <a href="#/visits" class="btn" style="text-decoration:none">📋 قائمة الزيارات والعيادات</a>
      </div>
    </header>

    <!-- استمارة تسجيل المراجع والزيارة -->
    <div class="panel" style="border:1px solid var(--brand); box-shadow:0 4px 18px rgba(14,90,87,.08); margin-bottom:1.5rem">
      <div class="row between" style="border-bottom:1px solid var(--line); padding-bottom:.5rem; margin-bottom:.8rem">
        <h2 style="margin:0; color:var(--brand)">استمارة المراجع والزيارة (الحقول الـ 11)</h2>
        <span class="muted small">تُعبأ من موظف السكرتاريا لكل مراجع يحضر للمركز</span>
      </div>

      <form id="estmaraMainForm" class="grid">
        <!-- 1. تاريخ الزيارة -->
        <div>
          <label>1. تاريخ الزيارة *</label>
          <input name="visit_date" id="eVisitDate" type="date" required value="${today}">
        </div>

        <!-- 2. الاسم الرباعي -->
        <div>
          <label>2. الاسم الرباعي *</label>
          <input name="full_name" id="eFullName" required placeholder="مثال: محمد أحمد إبراهيم خليل" value="${esc(prefill.full_name || '')}">
        </div>

        <!-- 3. رقم الهوية -->
        <div>
          <label>3. رقم الهوية *</label>
          <input name="national_id" id="eNationalId" inputmode="numeric" required placeholder="رقم الهوية (9 أرقام)" value="${esc(prefill.national_id || '')}">
        </div>

        <!-- 4. رقم الجوال -->
        <div>
          <label>4. رقم الجوال</label>
          <input name="phone" id="ePhone" inputmode="tel" placeholder="مثال: 0599123456" value="${esc(prefill.phone || '')}">
        </div>

        <!-- 5. عنوان النزوح الحالي -->
        <div style="grid-column:1/-1">
          <label>5. عنوان النزوح الحالي</label>
          <input name="address" id="eAddress" placeholder="مكان السكن أو النزوح الحالي (المدرسة / المركز / المخيم)" value="${esc(prefill.address || '')}">
        </div>

        <!-- 6. الجنس -->
        <div>
          <label>6. الجنس *</label>
          <select name="gender" id="eGender" required>
            <option value="">اختر الجنس</option>
            <option value="ذكر" ${prefill.gender === 'ذكر' ? 'selected' : ''}>ذكر</option>
            <option value="أنثى" ${prefill.gender === 'أنثى' ? 'selected' : ''}>أنثى</option>
          </select>
        </div>

        <!-- 7. نوع الحالة -->
        <div>
          <label>7. نوع الحالة *</label>
          <select name="case_type" id="eCaseType" required>
            <option value="جديد">جديد</option>
            <option value="مراجع">مراجع</option>
            <option value="استشارة">استشارة</option>
            <option value="طوارئ">طوارئ</option>
          </select>
        </div>

        <!-- 8. تاريخ الميلاد -->
        <div>
          <label>8. تاريخ الميلاد</label>
          <input name="birth_date" id="eBirthDate" type="date" max="${today}" value="${esc(prefill.birth_date || '')}">
        </div>

        <!-- 9. العمر عند الزيارة (يُحسب آلياً وقابل للتعديل) -->
        <div>
          <label>9. العمر عند الزيارة</label>
          <input name="age_at_visit" id="eAgeAtVisit" placeholder="يُحسب آلياً من الميلاد أو اكتبه">
        </div>

        <!-- 10. العيادة المختصة -->
        <div>
          <label>10. العيادة المختصة *</label>
          <select name="clinic" id="eClinicSelect" required>
            <option value="">اختر العيادة</option>
            ${clinics.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}
          </select>
        </div>

        <!-- 11. اسم الطبيب -->
        <div>
          <label>11. اسم الطبيب</label>
          <select name="doctor_name" id="eDoctorSelect">
            <option value="">اختر الطبيب (اختياري)</option>
            ${doctors.map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')}
          </select>
        </div>

        <div style="grid-column:1/-1; margin-top:.8rem" class="row">
          <button class="btn primary" id="saveEstmaraBtn" style="flex:1; padding:.7rem 1.4rem; font-size:1.05rem">
            ✓ تسجيل المريض وتوجيهه للعيادة
          </button>
          <button type="reset" class="btn" id="resetEstmaraBtn">مسح الخانات</button>
        </div>
      </form>
    </div>

    <!-- سجل زيارات اليوم للمتابعة والتعديل والحذف -->
    <section>
      <div class="row between" style="margin-bottom:.6rem; flex-wrap:wrap; gap:.5rem">
        <h2 style="margin:0">سجل المسجلين اليوم بالعيادات</h2>
        <div class="row" style="gap:.5rem">
          <div class="chips" id="chips"></div>
          <div id="exportWrap"></div>
        </div>
      </div>
      <div id="todayTableWrap"></div>
    </section>
  `;

  // ربط شريط التصدير
  root.querySelector('#exportWrap').append(exportBar(() => ({
    title: 'زيارات اليوم', subtitle: today, filename: 'زيارات-' + today,
    sections: [{ heading: 'الزيارات', columns: ['#', 'المراجع', 'الهوية', 'العيادة', 'الطبيب', 'العمر', 'الحالة'],
      rows: todayRows.map((v, i) => [i + 1, v.patients?.full_name || '', v.patients?.national_id || '', v.clinic || '', v.doctor_name || '', v.age_at_visit || '', STATUS[v.status][0]]) }]
  })));

  // حساب العمر تلقائياً عند تغيير تاريخ الميلاد أو الزيارة
  const bDateInput = root.querySelector('#eBirthDate');
  const vDateInput = root.querySelector('#eVisitDate');
  const ageInput = root.querySelector('#eAgeAtVisit');

  const updateAge = () => {
    if (bDateInput.value && vDateInput.value) {
      ageInput.value = N.ageText(bDateInput.value, vDateInput.value);
    }
  };
  bDateInput.onchange = updateAge;
  vDateInput.onchange = updateAge;
  if (bDateInput.value) updateAge();

  // فحص الهوية تلقائياً إذا كان المريض مسجلاً مسبقاً لجلب بياناته وتسهيل التعبئة
  const idInput = root.querySelector('#eNationalId');
  idInput.onblur = async () => {
    const natId = N.cleanId(idInput.value);
    if (!natId) return;
    const { data: p } = await sb.from('patients').select('*').eq('national_id', natId).maybeSingle();
    if (p) {
      if (!root.querySelector('#eFullName').value) root.querySelector('#eFullName').value = p.full_name || '';
      if (!root.querySelector('#ePhone').value) root.querySelector('#ePhone').value = p.phone || '';
      if (!root.querySelector('#eAddress').value) root.querySelector('#eAddress').value = p.address || '';
      if (!root.querySelector('#eGender').value && p.gender) root.querySelector('#eGender').value = p.gender;
      if (!root.querySelector('#eBirthDate').value && p.birth_date) {
        root.querySelector('#eBirthDate').value = p.birth_date;
        updateAge();
      }
      root.querySelector('#eCaseType').value = 'مراجع';
      toast(`تم جلب بيانات المراجع السابق «${p.full_name}» تلقائياً`, 'ok');
    }
  };

  // تقديم الاستمارة
  const eForm = root.querySelector('#estmaraMainForm');
  eForm.onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(eForm));
    const btn = root.querySelector('#saveEstmaraBtn');
    btn.disabled = true;
    btn.textContent = 'جارٍ تسجيل الزيارة...';

    try {
      const natId = N.cleanId(f.national_id);
      if (!natId) throw new Error('يرجى إدخال رقم هوية صالح');

      const patData = {
        full_name: N.cleanText(f.full_name),
        national_id: natId,
        phone: N.cleanPhone(f.phone),
        address: N.cleanText(f.address) || null,
        gender: f.gender || null,
        birth_date: f.birth_date || null
      };

      // 1. التحقق من وجود المريض برقم الهوية
      let { data: patient } = await sb.from('patients').select('id').eq('national_id', natId).maybeSingle();

      if (!patient) {
        const { data: newP, error: pErr } = await sb.from('patients').insert({
          ...patData,
          created_by: ctx.profile.id
        }).select().single();
        if (pErr) throw pErr;
        patient = newP;
      } else {
        await sb.from('patients').update(patData).eq('id', patient.id);
      }

      // 2. إنشاء الزيارة الموجهة للعيادة
      const ageStr = N.cleanText(f.age_at_visit) || (f.birth_date ? N.ageText(f.birth_date, f.visit_date) : null);
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

      toast(`تم تسجيل المراجع «${patData.full_name}» في عيادة «${f.clinic}» بنجاح وهو الآن بانتظار الطبيب`);
      eForm.reset();
      root.querySelector('#eVisitDate').value = today;
      loadToday();
    } catch (err) {
      toast(errMsg(err), 'bad');
    } finally {
      btn.disabled = false;
      btn.textContent = '✓ تسجيل المريض وتوجيهه للعيادة';
    }
  };

  // تحميل زيارات اليوم
  async function loadToday() {
    const { data, error } = await sb.from('visits')
      .select('id,clinic,doctor_name,status,created_at,age_at_visit,patients(full_name,national_id)')
      .eq('visit_date', today).order('created_at', { ascending: false });
    if (error) return toast(errMsg(error), 'bad');
    todayRows = data || [];

    const counts = {};
    todayRows.forEach(v => { const c = v.clinic || 'بدون عيادة'; counts[c] = (counts[c] || 0) + 1; });
    root.querySelector('#chips').innerHTML =
      `<button class="chip ${filter ? '' : 'on'}" data-c="">الكل ${todayRows.length}</button>` +
      Object.entries(counts).map(([c, n]) => `<button class="chip ${filter === c ? 'on' : ''}" data-c="${esc(c)}">${esc(c)} ${n}</button>`).join('');

    const rows = todayRows.filter(v => !filter || (v.clinic || 'بدون عيادة') === filter);
    root.querySelector('#todayTableWrap').innerHTML = rows.length
      ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>المراجع</th><th>الهوية</th><th>العيادة</th><th>الطبيب</th><th>العمر</th><th>الحالة</th><th>الوقت</th><th>إجراءات</th></tr></thead><tbody>${rows.map((v, i) =>
          `<tr data-id="${v.id}"><td>${i + 1}</td><td><b>${esc(v.patients?.full_name)}</b></td><td>${esc(v.patients?.national_id || '—')}</td><td>${esc(v.clinic || '—')}</td><td>${esc(v.doctor_name || '—')}</td>
           <td>${esc(v.age_at_visit || '—')}</td>
           <td><span class="badge ${STATUS[v.status][1]}">${STATUS[v.status][0]}</span></td>
           <td>${new Date(v.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</td>
           <td class="row" style="gap:.25rem; flex-wrap:nowrap">
             <button class="btn sm" data-act="edit" title="تعديل بيانات الزيارة">تعديل</button>
             <button class="btn sm danger" data-act="del" title="حذف الزيارة">حذف</button>
           </td></tr>`).join('')}</tbody></table></div>`
      : '<div class="panel empty">لا توجد زيارات مسجلة اليوم حتى الآن.</div>';
  }

  root.querySelector('#chips').onclick = e => {
    const b = e.target.closest('.chip');
    if (b) { filter = b.dataset.c; loadToday(); }
  };

  root.querySelector('#todayTableWrap').onclick = e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const v = todayRows.find(x => x.id === tr?.dataset.id);
    if (!v) return;
    if (btn.dataset.act === 'edit') openEditVisit(ctx, v, loadToday);
    else if (btn.dataset.act === 'del') deleteVisit(ctx, v, loadToday);
  };

  loadToday();
  const t = setInterval(loadToday, 25000);
  ctx.cleanup = () => clearInterval(t);
}

export const renderReception = renderEstmara; // توافق عكسي

/* ========================================================
   ثانياً: صفحة البحث
   - بحث برقم الهوية
   - غير مسجل: زر تسجيل ينقله لصفحة الاستمارة
   - مسجل: جدول (الاسم، الهوية، تاريخ الزيارة، الجوال) + شريط تسجيل بالعيادة
======================================================== */
export function renderSearch(root, ctx) {
  const { sb, clinics = [], doctors = [] } = ctx;

  root.innerHTML = `
    <header class="pagehead">
      <h1>صفحة البحث والاستعلام</h1>
      <a href="#/estmara" class="btn primary" style="text-decoration:none">📝 فتح صفحة الاستمارة</a>
    </header>

    <div class="searchbox">
      <input id="qId" type="search" placeholder="أدخل رقم الهوية للبحث عن المراجع..." autocomplete="off" aria-label="بحث برقم الهوية">
      <button class="btn primary" id="doSearchBtn">بحث برقم الهوية</button>
    </div>

    <div id="searchResults" style="margin-top:1.2rem">
      <div class="panel empty">أدخل رقم الهوية أعلاه للتحقق مما إذا كان المريض مسجلاً مسبقاً وتسجيل زيارة سريعة له.</div>
    </div>
  `;

  const qInput = root.querySelector('#qId');
  const resultsBox = root.querySelector('#searchResults');
  qInput.focus();

  const performSearch = async () => {
    const rawVal = qInput.value.trim();
    const cleanNum = N.digits(rawVal).replace(/\D/g, '');

    if (!rawVal) {
      resultsBox.innerHTML = '<div class="panel empty">يرجى كتابة رقم الهوية للبحث.</div>';
      return;
    }

    resultsBox.innerHTML = '<div class="panel">جارٍ البحث في سجلات المراجعين...</div>';

    try {
      let qb = sb.from('patients').select(`
        *,
        visits(id, visit_date, clinic, doctor_name, case_type, status, diagnosis, notes)
      `);

      if (cleanNum && cleanNum.length >= 4) {
        qb = qb.or(`national_id.eq.${cleanNum},phone.ilike.%${cleanNum}%`);
      } else {
        qb = qb.ilike('search_name', '%' + N.arNorm(rawVal).replace(/ /g, '%') + '%');
      }

      const { data, error } = await qb.limit(5);
      if (error) {
        resultsBox.innerHTML = `<div class="panel" style="color:var(--bad)">تعذر البحث: ${esc(errMsg(error))}</div>`;
        return;
      }

      // حالة المريض غير مسجل: إظهار أيقونة وزر نقله لصفحة الاستمارة
      if (!data || !data.length) {
        resultsBox.innerHTML = `
          <div class="panel empty" style="border:2px dashed var(--bad); padding:2rem; text-align:center">
            <div style="font-size:2.5rem; margin-bottom:.5rem">👤❌</div>
            <h3 style="margin:0 0 .5rem; color:var(--bad)">المراجع صاحب الهوية «${esc(rawVal)}» غير مسجل في النظام</h3>
            <p class="muted">لم يتم العثور على أي ملف طبي بهذا الرقم. اضغط على الزر أدناه للانتقال إلى استمارة التسجيل وتعبئة بياناته كمرجع جديد.</p>
            <button class="btn primary" id="goToEstmaraBtn" style="font-size:1.1rem; padding:.7rem 1.6rem; margin-top:.5rem">
              📝 تسجيل المراجع في استمارة التسجيل
            </button>
          </div>
        `;
        resultsBox.querySelector('#goToEstmaraBtn').onclick = () => {
          ctx.estmaraPrefill = { national_id: cleanNum || rawVal };
          location.hash = '#/estmara';
        };
        return;
      }

      // حالة المريض مسجل لدينا: عرض شريط التسجيل في العيادة وجدول البيانات
      const p = data[0];
      const sortedVisits = (p.visits || []).sort((a, b) => b.visit_date.localeCompare(a.visit_date));
      const lastV = sortedVisits[0];

      resultsBox.innerHTML = `
        <!-- شريط تسجيل المريض في العيادة -->
        <div class="panel" style="background:var(--card); border:2px solid var(--brand); border-radius:var(--r); box-shadow:0 6px 20px rgba(14,90,87,.12); margin-bottom:1.5rem">
          <div class="row between" style="margin-bottom:.8rem; border-bottom:1px solid var(--line); padding-bottom:.4rem">
            <h3 style="margin:0; color:var(--brand)">✓ المريض مسجل — شريط تسجيل المريض في العيادة</h3>
            <span class="badge ok">مسجل في النظام</span>
          </div>

          <form id="quickVisitStrip" class="row" style="flex-wrap:wrap; gap:.8rem; align-items:flex-end">
            <div style="min-width:200px">
              <label>العيادة المراد الذهاب إليها *</label>
              <select name="clinic" id="stripClinic" required>
                <option value="">اختر العيادة</option>
                ${clinics.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}
              </select>
            </div>

            <div style="min-width:200px">
              <label>اسم الطبيب المعالج</label>
              <select name="doctor_name" id="stripDoctor">
                <option value="">اختر الطبيب (اختياري)</option>
                ${doctors.map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')}
              </select>
            </div>

            <div style="min-width:130px">
              <label>نوع الحالة</label>
              <select name="case_type">
                <option value="مراجع">مراجع</option>
                <option value="استشارة">استشارة</option>
                <option value="جديد">جديد</option>
              </select>
            </div>

            <div>
              <button class="btn primary" id="stripSubmitBtn" style="padding:.6rem 1.6rem; font-size:1.05rem">
                ✓ تسجيل وإرسال للعيادة
              </button>
            </div>
          </form>
        </div>

        <!-- جدول بيانات المريض المطلوب -->
        <div class="panel" style="margin-bottom:1.5rem">
          <h3 style="margin-top:0">بيانات المراجع</h3>
          <div class="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>الاسم رباعي</th>
                  <th>رقم الهوية</th>
                  <th>تاريخ الزيارة (آخر زيارة)</th>
                  <th>رقم الجوال</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>${esc(p.full_name)}</b></td>
                  <td>${esc(p.national_id || '—')}</td>
                  <td>${lastV ? `<span class="badge ok">${fmtDate(lastV.visit_date)}</span> (${esc(lastV.clinic || '—')})` : '<span class="muted">لا توجد زيارات سابقة</span>'}</td>
                  <td>${esc(p.phone || '—')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="row" style="margin-top:.8rem; gap:1.5rem; font-size:.9rem; color:var(--muted)">
            <span>الجنس: <b>${esc(p.gender || '—')}</b></span>
            <span>العنوان: <b>${esc(p.address || '—')}</b></span>
            <span>العمر الحالي: <b>${N.ageText(p.birth_date)}</b></span>
          </div>
        </div>

        <!-- سجل الزيارات والتشخيصات السابقة للمريض -->
        <div class="panel">
          <h3 style="margin-top:0">سجل الزيارات والتشخيصات السابقة (${sortedVisits.length})</h3>
          ${sortedVisits.length ? `
            <div class="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>تاريخ الزيارة</th>
                    <th>العيادة</th>
                    <th>الطبيب</th>
                    <th>نوع الحالة</th>
                    <th>التشخيص الطبي</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  ${sortedVisits.map(v => `
                    <tr>
                      <td>${fmtDate(v.visit_date)}</td>
                      <td>${esc(v.clinic || '—')}</td>
                      <td>${esc(v.doctor_name || '—')}</td>
                      <td>${esc(v.case_type || '—')}</td>
                      <td>${esc(v.diagnosis || '—')}</td>
                      <td><span class="badge ${STATUS[v.status][1]}">${STATUS[v.status][0]}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : '<p class="muted">لا توجد زيارات سابقة مسجلة لهذا المريض.</p>'}
        </div>
      `;

      // تقديم شريط تسجيل الزيارة
      const sForm = resultsBox.querySelector('#quickVisitStrip');
      sForm.onsubmit = async e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(sForm));
        const btn = sForm.querySelector('#stripSubmitBtn');
        btn.disabled = true;
        btn.textContent = 'جارٍ التسجيل...';

        try {
          const { error: vErr } = await sb.from('visits').insert({
            patient_id: p.id,
            visit_date: N.todayISO(),
            clinic: f.clinic,
            doctor_name: N.cleanText(f.doctor_name) || null,
            case_type: f.case_type || 'مراجع',
            age_at_visit: N.ageText(p.birth_date),
            status: 'waiting',
            created_by: ctx.profile.id
          });
          if (vErr) throw vErr;

          toast(`تم تسجيل المريض «${p.full_name}» في عيادة «${f.clinic}» بنجاح وهو الآن بقائمة انتظار الطبيب`);
          performSearch(); // تحديث شاشة العرض
        } catch (err) {
          toast(errMsg(err), 'bad');
          btn.disabled = false;
          btn.textContent = '✓ تسجيل وإرسال للعيادة';
        }
      };

    } catch (err) {
      resultsBox.innerHTML = `<div class="panel" style="color:var(--bad)">خطأ تقني: ${esc(errMsg(err))}</div>`;
    }
  };

  root.querySelector('#doSearchBtn').onclick = performSearch;
  qInput.onkeydown = e => { if (e.key === 'Enter') performSearch(); };
}

/* ========================================================
   ثالثاً: شاشة الطبيب وملف المريض والتشخيص والوصفة
   تظهر للطبيب المرضى المسجلين لديه اليوم، وعند الضغط على
   تشخيص يكتب التشخيص ويحدد الدواء ويرسله تلقائياً للصيدلية
======================================================== */
export function renderVisits(root, ctx) {
  const { sb } = ctx;
  const today = N.todayISO();
  let rows = [], shown = [], clinic = localStorage.getItem('visits_clinic') || '';

  root.innerHTML = `<header class="pagehead">
      <h1>قائمة الزيارات والتشخيص (شاشة الطبيب)</h1>
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
    let a = $('d1').value || today, b = $('d2').value || a;
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

  $('q').oninput = debounce(draw, 200);
  $('d1').onchange = $('d2').onchange = $('st').onchange = load;

  load();
  const t = setInterval(load, 15000); // تحديث دوري تلقائي لعيادة الطبيب
  ctx.cleanup = () => clearInterval(t);
}

// شاشة الطبيب وملف المريض وكتابة الوصفة وإرسالها للصيدلية
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
    
    <h3>السجل والتشخيصات السابقة للمريض</h3>
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
        <label>الشخيص الطبي *</label>
        <textarea name="diagnosis" required placeholder="اكتب التشخيص هنا..." ${!isDoctorOrAdmin ? 'disabled' : ''}>${esc(v.diagnosis || '')}</textarea>
      </div>
      <div style="margin-top:.6rem">
        <label>ملاحظات إضافية</label>
        <input name="notes" value="${esc(v.notes || '')}" placeholder="تعليمات أو توصيات..." ${!isDoctorOrAdmin ? 'disabled' : ''}>
      </div>

      <h4 style="margin:1rem 0 .4rem">الأدوية الموصوفة من المخزون</h4>
      <div id="rxItems"></div>
      ${isDoctorOrAdmin ? '<button type="button" class="btn sm" id="addDrugBtn">+ إضافة دواء للوصفة</button>' : ''}

      <div style="margin-top:1.2rem">
        ${isDoctorOrAdmin ? '<button class="btn primary" id="saveDiagBtn">✓ حفظ التشخيص وإرسال الوصفة للصيدلية</button>' : '<p class="muted">صلاحية الطبيب مطلوبة لتسجيل التشخيص.</p>'}
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

      const rows = [...rxContainer.querySelectorAll('.item-row')].map(r => {
        return {
          text: N.cleanText(r.querySelector('.dName').value),
          qty: parseInt(r.querySelector('.dQty').value) || 1,
          dosage: N.cleanText(r.querySelector('.dDosage').value) || null
        };
      }).filter(r => r.text);

      const drugMap = new Map(drugs.map(d => [d.name.toLowerCase(), d.id]));

      // 1. تحديث الزيارة بالتشخيص
      const { error: vErr } = await sb.from('visits').update({
        diagnosis: diagVal,
        notes: notesVal,
        status: 'seen'
      }).eq('id', v.id);
      if (vErr) throw vErr;

      // 2. تحديث بنود الوصفة الطبية وإرسالها للصيدلية
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

      toast('تم حفظ التشخيص بنجاح وإرسال الوصفة الطبية تلقائياً إلى الصيدلية');
      closeModal();
      if (onDone) onDone();
    } catch (err) {
      toast(errMsg(err), 'bad');
      saveBtn.disabled = false;
    }
  };
}

// دالة تعديل بيانات الزيارة
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

// دالة حذف الزيارة
export async function deleteVisit(ctx, v, onDone) {
  const { sb } = ctx;
  const pName = v.patients?.full_name || 'المراجع';
  const dateStr = fmtDate(v.visit_date);
  if (!confirm(`هل أنت متأكد من حذف زيارة «${pName}» بتاريخ ${dateStr} نهائياً؟\nسيتم حذف تفاصيل الزيارة والوصفة الطبية التابعة لها ولا يمكن التراجع.`)) return;

  try {
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
