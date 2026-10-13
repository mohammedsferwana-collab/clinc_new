import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, debounce, fmtDate, errMsg } from './ui.js';
import { exportBar } from './export.js';

const STATUS = { waiting: ['بانتظار الطبيب', 'wait'], seen: ['تمت المعاينة', 'ok'] };
const treatmentText = v =>
  (v.visit_items || []).map(i => i.drug_text + (i.qty > 1 ? ` × ${i.qty}` : '')).join('، ') || v.legacy_prescription || '—';

/* ============ الاستقبال ============ */
export function renderReception(root, ctx) {
  const { sb } = ctx;
  let filter = '', todayRows = [];
  root.innerHTML = `<header class="pagehead"><h1>الاستقبال</h1></header>
    <div class="searchbox"><input id="q" type="search" placeholder="بحث بالاسم أو رقم الهوية أو الجوال" autocomplete="off" aria-label="بحث عن مراجع"><button class="btn primary" id="newp">مراجع جديد</button></div>
    <div id="results"></div>
    <section><div class="row between" style="margin-bottom:.6rem"><h2 style="margin:0">زيارات اليوم</h2><div class="chips" id="chips"></div></div><div id="today"></div></section>`;
  const q = root.querySelector('#q'), results = root.querySelector('#results');
  q.focus();
  root.querySelector('#chips').parentElement.append(exportBar(() => ({ title: 'زيارات اليوم', subtitle: N.todayISO(), filename: 'زيارات-' + N.todayISO(),
    sections: [{ heading: 'الزيارات', columns: ['#', 'المراجع', 'الهوية', 'العيادة', 'الطبيب', 'الحالة'], rows: todayRows.map((v, i) => [i + 1, v.patients?.full_name || '', v.patients?.national_id || '', v.clinic || '', v.doctor_name || '', STATUS[v.status][0]]) }] })));

  async function loadToday() {
    const { data, error } = await sb.from('visits')
      .select('id,clinic,doctor_name,status,created_at,patients(full_name,national_id)')
      .eq('visit_date', N.todayISO()).order('created_at');
    if (error) return toast(errMsg(error), 'bad');
    todayRows = data;
    const counts = {};
    data.forEach(v => { const c = v.clinic || 'بدون عيادة'; counts[c] = (counts[c] || 0) + 1; });
    root.querySelector('#chips').innerHTML =
      `<button class="chip ${filter ? '' : 'on'}" data-c="">الكل ${data.length}</button>` +
      Object.entries(counts).map(([c, n]) => `<button class="chip ${filter === c ? 'on' : ''}" data-c="${esc(c)}">${esc(c)} ${n}</button>`).join('');
    const rows = data.filter(v => !filter || (v.clinic || 'بدون عيادة') === filter);
    root.querySelector('#today').innerHTML = rows.length
      ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>المراجع</th><th>العيادة</th><th>الطبيب</th><th>الحالة</th><th>الوقت</th></tr></thead><tbody>${rows.map((v, i) =>
          `<tr><td>${i + 1}</td><td>${esc(v.patients?.full_name)}</td><td>${esc(v.clinic || '—')}</td><td>${esc(v.doctor_name || '—')}</td>
           <td><span class="badge ${STATUS[v.status][1]}">${STATUS[v.status][0]}</span></td>
           <td>${new Date(v.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="panel empty">لا توجد زيارات مسجلة اليوم. ابحث عن مراجع أو أضف مراجعاً جديداً للبدء.</div>';
  }
  root.querySelector('#chips').onclick = e => { const b = e.target.closest('.chip'); if (b) { filter = b.dataset.c; loadToday(); } };

  const search = debounce(async () => {
    const s = N.digits(q.value).replace(/[,()%*]/g, ' ').trim();
    if (s.length < 2) { results.innerHTML = ''; return; }
    let qb = sb.from('patients').select('*').limit(15);
    qb = /^\d+$/.test(s) ? qb.or(`national_id.ilike.%${s}%,phone.ilike.%${s}%`)
      : qb.ilike('search_name', '%' + N.arNorm(s).replace(/ /g, '%') + '%');
    const { data, error } = await qb;
    if (error) return toast(errMsg(error), 'bad');
    results.innerHTML = data.length
      ? `<div class="tablewrap" style="margin-bottom:1.4rem"><table><thead><tr><th>الاسم</th><th>الهوية</th><th>الجوال</th><th>العمر</th><th>العنوان</th></tr></thead><tbody>${data.map(p =>
          `<tr class="click" data-id="${p.id}"><td>${esc(p.full_name)}</td><td>${esc(p.national_id || '—')}</td><td>${esc(p.phone || '—')}</td><td>${N.ageText(p.birth_date)}</td><td>${esc(p.address || '—')}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="panel empty">لا يوجد مراجع بهذه البيانات. اضغط «مراجع جديد» لتسجيله.</div>';
    results._data = data;
  }, 300);
  q.addEventListener('input', search);
  results.onclick = e => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openPatient(ctx, results._data.find(p => p.id === tr.dataset.id), () => { q.value = ''; results.innerHTML = ''; loadToday(); });
  };
  root.querySelector('#newp').onclick = () => patientForm(ctx, null, q.value, () => { q.value = ''; results.innerHTML = ''; loadToday(); });

  loadToday();
  const t = setInterval(loadToday, 20000);
  ctx.cleanup = () => clearInterval(t);
}

/* ============ بيانات المراجع ============ */
function patientForm(ctx, p, prefill, done) {
  const { sb } = ctx;
  const pre = prefill ? (/^[\d٠-٩]+$/.test(prefill) ? { national_id: N.digits(prefill) } : { full_name: prefill }) : {};
  const v = { ...(p || {}), ...pre };
  const body = openModal(`<h2>${p ? 'تعديل بيانات المراجع' : 'مراجع جديد'}</h2><form id="pf" class="grid">
    <div style="grid-column:1/-1"><label>الاسم الرباعي *</label><input name="full_name" required value="${esc(v.full_name)}"></div>
    <div><label>رقم الهوية</label><input name="national_id" inputmode="numeric" value="${esc(v.national_id)}"></div>
    <div><label>رقم الجوال</label><input name="phone" inputmode="tel" value="${esc(v.phone)}"></div>
    <div><label>الجنس</label><select name="gender"><option value="">—</option>${['ذكر', 'أنثى'].map(g => `<option ${v.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
    <div><label>تاريخ الميلاد</label><input name="birth_date" type="date" max="${N.todayISO()}" value="${esc(v.birth_date)}"></div>
    <div style="grid-column:1/-1"><label>عنوان النزوح الحالي</label><input name="address" value="${esc(v.address)}"></div>
    <div style="grid-column:1/-1"><button class="btn primary">${p ? 'حفظ التعديلات' : 'حفظ ومتابعة'}</button></div></form>`);
  body.querySelector('#pf').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const rec = { full_name: N.cleanText(f.full_name), national_id: N.cleanId(f.national_id), phone: N.cleanPhone(f.phone),
      address: N.cleanText(f.address) || null, gender: f.gender || null, birth_date: f.birth_date || null };
    const res = p ? await sb.from('patients').update(rec).eq('id', p.id).select().single()
                  : await sb.from('patients').insert({ ...rec, created_by: ctx.profile.id }).select().single();
    if (res.error) return toast(res.error.code === '23505' ? 'رقم الهوية مسجل مسبقاً؛ ابحث عن المراجع بدل إضافته' : errMsg(res.error), 'bad');
    openPatient(ctx, res.data, done);
  };
}

async function openPatient(ctx, p, done) {
  const { sb } = ctx;
  const [h, c] = await Promise.all([
    sb.from('visits').select('id,visit_date,clinic,doctor_name,diagnosis,legacy_prescription,visit_items(drug_text,qty)')
      .eq('patient_id', p.id).order('visit_date', { ascending: false }).order('created_at', { ascending: false }).limit(2),
    sb.from('visits').select('id', { count: 'exact', head: true }).eq('patient_id', p.id),
  ]);
  const prior = c.count || 0;
  const hist = (h.data || []).map(v => `<div class="hist"><b>${fmtDate(v.visit_date)}</b> — ${esc(v.clinic || '—')}${v.doctor_name ? ' / ' + esc(v.doctor_name) : ''}<br>
    <span class="muted">التشخيص:</span> ${esc(v.diagnosis || '—')}<br><span class="muted">العلاج:</span> ${esc(treatmentText(v))}</div>`).join('');
  const body = openModal(`<h2>${esc(p.full_name)}</h2>
    <p class="muted">${[p.national_id && 'هوية ' + esc(p.national_id), p.phone && esc(p.phone), N.ageText(p.birth_date), p.gender, p.address].filter(Boolean).map(x => `<span>${x}</span>`).join(' • ')}
    <button class="btn sm" id="edit" style="margin-inline-start:.6rem">تعديل</button></p>
    <h3>آخر زيارتين ${prior ? `<span class="muted small">(إجمالي الزيارات ${prior})</span>` : ''}</h3>${hist || '<p class="muted">لا توجد زيارات سابقة — سيُسجل كحالة جديدة.</p>'}
    <h3>تسجيل زيارة اليوم</h3><form id="vf" class="grid">
      <div><label>العيادة *</label><select name="clinic" required><option value="">اختر العيادة</option>${ctx.clinics.map(c => `<option>${esc(c.name)}</option>`).join('')}</select></div>
      <div><label>الطبيب (اختياري)</label><input name="doctor" list="docs"><datalist id="docs">${ctx.doctors.map(d => `<option value="${esc(d.name)}">`).join('')}</datalist></div>
      <div style="grid-column:1/-1"><button class="btn primary">تسجيل الزيارة (${prior ? 'مراجع' : 'جديد'})</button></div></form>`, { wide: true });
  body.querySelector('#edit').onclick = () => patientForm(ctx, p, '', done);
  body.querySelector('#vf').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const today = N.todayISO();
    const { data: dup } = await sb.from('visits').select('id').eq('patient_id', p.id).eq('visit_date', today).eq('clinic', f.clinic);
    if (dup?.length && !confirm('لهذا المراجع زيارة اليوم في نفس العيادة. تسجيل زيارة أخرى؟')) return;
    const { error } = await sb.from('visits').insert({ patient_id: p.id, visit_date: today, clinic: f.clinic,
      doctor_name: N.cleanText(f.doctor) || null, case_type: prior ? 'مراجع' : 'جديد', created_by: ctx.profile.id });
    if (error) return toast(errMsg(error), 'bad');
    toast('تم تسجيل الزيارة'); closeModal(); done();
  };
}

/* ============ العيادة (الطبيب) ============ */
export function renderClinic(root, ctx) {
  const { sb } = ctx;
  root.innerHTML = `<header class="pagehead"><h1>العيادة</h1><div class="row">
    <div><label>العيادة</label><select id="cl"><option value="">كل العيادات</option>${ctx.clinics.map(c => `<option>${esc(c.name)}</option>`).join('')}</select></div>
    <div><label>التاريخ</label><input type="date" id="dt" value="${N.todayISO()}"></div></div></header><div id="list"></div>`;
  const cl = root.querySelector('#cl'), dt = root.querySelector('#dt');
  cl.value = localStorage.getItem('clinic') || '';
  async function load() {
    localStorage.setItem('clinic', cl.value);
    let qb = sb.from('visits').select('id,clinic,status,created_at,diagnosis,patients(full_name,birth_date,gender)').eq('visit_date', dt.value).order('created_at');
    if (cl.value) qb = qb.eq('clinic', cl.value);
    const { data, error } = await qb;
    if (error) return toast(errMsg(error), 'bad');
    data.sort((a, b) => (a.status === b.status ? 0 : a.status === 'waiting' ? -1 : 1));
    root.querySelector('#list').innerHTML = data.length
      ? `<div class="tablewrap"><table><thead><tr><th>المراجع</th><th>العمر</th><th>العيادة</th><th>التشخيص</th><th>الحالة</th></tr></thead><tbody>${data.map(v =>
          `<tr class="click" data-id="${v.id}"><td>${esc(v.patients.full_name)}</td><td>${N.ageText(v.patients.birth_date, dt.value)}</td><td>${esc(v.clinic || '—')}</td><td>${esc(v.diagnosis || '—')}</td>
          <td><span class="badge ${STATUS[v.status][1]}">${STATUS[v.status][0]}</span></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="panel empty">لا توجد زيارات لهذا اليوم والعيادة.</div>';
  }
  cl.onchange = dt.onchange = load;
  root.querySelector('#list').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) openVisit(ctx, tr.dataset.id, load); };
  load();
  const t = setInterval(load, 20000);
  ctx.cleanup = () => clearInterval(t);
}

async function openVisit(ctx, id, done) {
  const { sb } = ctx;
  const { data: v, error } = await sb.from('visits').select('*, patients(*), visit_items(*)').eq('id', id).single();
  if (error) return toast(errMsg(error), 'bad');
  const { data: prev } = await sb.from('visits').select('visit_date,clinic,diagnosis,legacy_prescription,visit_items(drug_text,qty)')
    .eq('patient_id', v.patient_id).neq('id', id).order('visit_date', { ascending: false }).limit(3);
  const sent = v.visit_items.filter(i => i.dispensed_at), open = v.visit_items.filter(i => !i.dispensed_at);
  const row = (i = {}) => `<div class="item-row editable"><input list="druglist" placeholder="اسم الدواء" value="${esc(i.drug_text)}"><input type="number" min="1" value="${i.qty || 1}" aria-label="الكمية"><input placeholder="الجرعة / ملاحظات" value="${esc(i.dosage)}"><button type="button" class="btn sm danger" aria-label="حذف">×</button></div>`;
  const body = openModal(`<h2>${esc(v.patients.full_name)}</h2>
    <p class="muted">${[N.ageText(v.patients.birth_date, v.visit_date), v.patients.gender, v.clinic, v.case_type].filter(Boolean).join(' • ')}</p>
    ${(prev || []).length ? `<h3>زيارات سابقة</h3>${prev.map(p => `<div class="hist"><b>${fmtDate(p.visit_date)}</b> — ${esc(p.clinic || '—')}: ${esc(p.diagnosis || '—')} <span class="muted">| ${esc(treatmentText(p))}</span></div>`).join('')}` : ''}
    <form id="vf"><div class="grid"><div style="grid-column:1/-1"><label>التشخيص</label><input name="diagnosis" value="${esc(v.diagnosis)}"></div>
    <div><label>اسم الطبيب</label><input name="doctor" list="docs" value="${esc(v.doctor_name)}"><datalist id="docs">${ctx.doctors.map(d => `<option value="${esc(d.name)}">`).join('')}</datalist></div>
    <div><label>ملاحظات</label><input name="notes" value="${esc(v.notes)}"></div></div>
    <h3>الوصفة الطبية</h3><datalist id="druglist">${ctx.drugs.map(d => `<option value="${esc(d.name)}">`).join('')}</datalist>
    ${sent.map(i => `<div class="muted small">✓ مصروف: ${esc(i.drug_text)} × ${i.qty}</div>`).join('')}
    <div id="items">${open.map(row).join('')}</div><button type="button" class="btn sm" id="add">+ إضافة دواء</button>
    <div style="margin-top:1.2rem"><button class="btn primary">حفظ وإنهاء المعاينة</button></div></form>`, { wide: true });
  const items = body.querySelector('#items');
  if (!open.length) items.insertAdjacentHTML('beforeend', row());
  body.querySelector('#add').onclick = () => items.insertAdjacentHTML('beforeend', row());
  items.onclick = e => { if (e.target.matches('button')) e.target.closest('.item-row').remove(); };
  body.querySelector('#vf').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const rows = [...items.querySelectorAll('.item-row')].map(r => {
      const [a, b, c] = r.querySelectorAll('input');
      return { text: N.cleanText(a.value), qty: Math.max(1, parseInt(b.value) || 1), dosage: N.cleanText(c.value) || null };
    }).filter(r => r.text);
    const byName = new Map(ctx.drugs.map(d => [d.name.toLowerCase(), d.id]));
    let r = await sb.from('visits').update({ diagnosis: N.cleanText(f.diagnosis) || null, notes: N.cleanText(f.notes) || null,
      doctor_name: N.cleanText(f.doctor) || null, status: 'seen' }).eq('id', id);
    if (!r.error) r = await sb.from('visit_items').delete().eq('visit_id', id).is('dispensed_at', null);
    if (!r.error && rows.length) r = await sb.from('visit_items').insert(rows.map(x =>
      ({ visit_id: id, drug_id: byName.get(x.text.toLowerCase()) || null, drug_text: x.text, qty: x.qty, dosage: x.dosage })));
    if (r.error) return toast(errMsg(r.error), 'bad');
    toast('تم حفظ المعاينة'); closeModal(); done();
  };
}
