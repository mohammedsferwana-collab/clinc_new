import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, errMsg, fmtDate, fetchAll } from './ui.js';
import { exportBar } from './export.js';

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const TYPES = { day: 'يومي', week: 'أسبوعي', month: 'شهري' };
const hm = iso => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—');
const mins = r => (r.check_in && r.check_out ? Math.max(0, Math.round((new Date(r.check_out) - new Date(r.check_in)) / 60000)) : null);
const fmtM = m => (m == null ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function eachDate(a, b) {
  const out = []; if (a > b) return out;
  for (let d = new Date(a + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= b; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export function renderAttendance(root, ctx) {
  const { sb } = ctx;
  const admin = ctx.profile.role === 'admin';
  const WORKDAYS = ctx.settings?.work_days || [0, 1, 2, 3, 4];   // من الإعدادات العامة
  const timers = [];
  ctx.cleanup = () => timers.forEach(clearInterval);
  let tab = 'today';
  const tabs = [['today', 'اليوم'], ...(admin ? [['records', 'السجلات']] : []), ['report', 'التقارير']];
  root.innerHTML = `<header class="pagehead"><h1>الحضور والانصراف</h1><div class="chips" id="tabs">${tabs.map(([k, l]) => `<button class="chip ${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div></header><div id="pane"></div>`;
  const pane = root.querySelector('#pane');
  root.querySelector('#tabs').onclick = e => {
    const b = e.target.closest('.chip'); if (!b) return;
    tab = b.dataset.t; root.querySelectorAll('#tabs .chip').forEach(c => c.classList.toggle('on', c === b));
    timers.splice(0).forEach(clearInterval); show();
  };
  const show = () => (tab === 'today' ? today() : tab === 'records' ? records() : report());

  /* ---------- اليوم ---------- */
  async function today() {
    const d = N.todayISO();
    const [{ data: me }, { data: emps }, { data: recs }] = await Promise.all([
      sb.from('employees').select('*').eq('user_id', ctx.profile.id).maybeSingle(),
      sb.from('employees').select('*').eq('active', true).order('full_name'),
      sb.from('attendance').select('*').eq('work_date', d),
    ]);
    const mine = me && (recs || []).find(r => r.employee_id === me.id);
    let html = '';
    if (me) {
      const late = mine?.late_minutes || 0;
      html += `<div class="panel selfcard"><div><div class="muted">${DAYS[new Date().getDay()]} ${fmtDate(d)}</div><div class="clock" id="clk"></div><div class="muted small">${esc(me.full_name)} — الدوام ${me.work_start.slice(0, 5)} إلى ${me.work_end.slice(0, 5)}</div></div>
        <div class="row"><button class="btn primary bigbtn" id="cin" ${mine ? 'disabled' : ''}>تسجيل الحضور الآن</button><button class="btn bigbtn" id="cout" ${!mine || mine.check_out ? 'disabled' : ''}>تسجيل الانصراف الآن</button></div>
        <div>${mine ? `حضور <b>${hm(mine.check_in)}</b> ${mine.late_minutes ? `<span class="badge bad">متأخر ${late} دقيقة</span>` : '<span class="badge ok">في الوقت</span>'}<br>${mine.check_out ? `انصراف <b>${hm(mine.check_out)}</b> — المدة <b>${fmtM(mins(mine))}</b>` : '<span class="muted">لم يُسجل الانصراف بعد</span>'}` : '<span class="muted">لم يُسجل الحضور اليوم</span>'}</div></div>`;
    } else if (!admin) html += '<div class="panel empty">حسابك غير مرتبط ببطاقة موظف، فلا يمكنك تسجيل الحضور. تواصل مع المدير لربط الحساب.</div>';
    if (admin) {
      html += `<div class="row between" style="margin-bottom:.6rem"><h2 style="margin:0">حضور اليوم (${(recs || []).length} من ${(emps || []).length})</h2><button class="btn" id="addm">تسجيل يدوي</button></div>
      <div class="tablewrap"><table><thead><tr><th>الموظف</th><th>التخصص</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>التأخير</th><th>الحالة</th><th></th></tr></thead><tbody>${(emps || []).map(e => {
        const r = (recs || []).find(x => x.employee_id === e.id);
        return `<tr><td>${esc(e.full_name)}</td><td>${esc(e.specialty || '—')}</td><td>${hm(r?.check_in)}</td><td>${hm(r?.check_out)}</td><td>${fmtM(r && mins(r))}</td><td>${r?.late_minutes ? r.late_minutes + ' د' : '—'}</td>
          <td>${r ? `<span class="badge ${r.check_out ? 'ok' : 'wait'}">${r.check_out ? 'منصرف' : 'حاضر'}</span>` : '<span class="badge bad">لم يحضر</span>'}</td>
          <td><button class="btn sm" data-e="${e.id}">${r ? 'تعديل' : 'تسجيل'}</button></td></tr>`;
      }).join('')}</tbody></table></div>`;
    }
    pane.innerHTML = html;
    if (me) {
      const tick = () => { const c = pane.querySelector('#clk'); if (c) c.textContent = new Date().toLocaleTimeString('en-GB'); };
      tick(); timers.push(setInterval(tick, 1000));
      const act = fn => async () => { const { error } = await sb.rpc(fn); if (error) return toast(errMsg(error), 'bad'); toast(fn === 'clock_in' ? 'تم تسجيل الحضور' : 'تم تسجيل الانصراف'); today(); };
      pane.querySelector('#cin').onclick = act('clock_in');
      pane.querySelector('#cout').onclick = act('clock_out');
    }
    if (admin) {
      pane.querySelector('#addm').onclick = () => manual(emps, null, null, d, today);
      pane.querySelector('tbody').onclick = e => { const b = e.target.closest('button[data-e]'); if (b) manual(emps, (recs || []).find(r => r.employee_id === b.dataset.e), b.dataset.e, d, today); };
    }
  }

  /* ---------- إدخال/تعديل يدوي (للمدير) ---------- */
  function manual(emps, rec, empId, date, done) {
    const loc = iso => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
    const body = openModal(`<h2>${rec ? 'تعديل سجل حضور' : 'تسجيل حضور يدوي'}</h2><form id="mf" class="grid">
      <div><label>الموظف</label><select name="emp" required ${rec ? 'disabled' : ''}><option value="">اختر</option>${emps.map(e => `<option value="${e.id}" ${e.id === (rec?.employee_id || empId) ? 'selected' : ''}>${esc(e.full_name)}</option>`).join('')}</select></div>
      <div><label>التاريخ</label><input name="date" type="date" required value="${rec?.work_date || date}" ${rec ? 'disabled' : ''}></div>
      <div><label>وقت الحضور</label><input name="tin" type="time" value="${loc(rec?.check_in)}"></div>
      <div><label>وقت الانصراف</label><input name="tout" type="time" value="${loc(rec?.check_out)}"></div>
      <div style="grid-column:1/-1"><label>ملاحظة (مثل: إجازة، مهمة خارجية)</label><input name="note" value="${esc(rec?.note)}"></div>
      <div style="grid-column:1/-1" class="row"><button class="btn primary">حفظ</button>${rec ? '<button type="button" class="btn danger" id="del">حذف السجل</button>' : ''}</div></form>`);
    body.querySelector('#mf').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const eid = rec?.employee_id || f.emp, dt = rec?.work_date || f.date, emp = emps.find(x => x.id === eid);
      if (f.tout && !f.tin) return toast('أدخل وقت الحضور أولاً', 'bad');
      const cin = f.tin ? new Date(`${dt}T${f.tin}:00`) : null, cout = f.tout ? new Date(`${dt}T${f.tout}:00`) : null;
      if (cin && cout && cout <= cin) return toast('وقت الانصراف يجب أن يكون بعد الحضور', 'bad');
      const late = f.tin ? Math.max(0, toMin(f.tin) - toMin(emp.work_start.slice(0, 5)) - emp.grace_minutes) : 0;
      const { error } = await sb.from('attendance').upsert({ employee_id: eid, work_date: dt, check_in: cin?.toISOString() || null, check_out: cout?.toISOString() || null,
        late_minutes: late, source: 'manual', note: N.cleanText(f.note) || null }, { onConflict: 'employee_id,work_date' });
      if (error) return toast(errMsg(error), 'bad');
      toast('تم الحفظ'); closeModal(); done();
    };
    if (rec) body.querySelector('#del').onclick = async () => {
      if (!confirm('حذف سجل الحضور هذا؟')) return;
      const { error } = await sb.from('attendance').delete().eq('id', rec.id);
      if (error) return toast(errMsg(error), 'bad');
      closeModal(); done();
    };
  }

  /* ---------- السجلات (للمدير) ---------- */
  async function records() {
    const d = N.todayISO();
    pane.innerHTML = `<div class="row" style="margin-bottom:.8rem"><div><label>من</label><input type="date" id="a" value="${d.slice(0, 8)}01"></div><div><label>إلى</label><input type="date" id="b" value="${d}"></div>
      <div><label>الموظف</label><select id="e" style="min-width:200px"><option value="">الكل</option></select></div><button class="btn primary" id="new">تسجيل يدوي</button></div><div id="tbl"></div>`;
    const { data: emps } = await sb.from('employees').select('*').order('full_name');
    pane.querySelector('#e').innerHTML += (emps || []).map(e => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('');
    let rows = [];
    const load = async () => {
      const a = pane.querySelector('#a').value, b = pane.querySelector('#b').value, e = pane.querySelector('#e').value;
      rows = await fetchAll(() => { let q = sb.from('attendance').select('*, employees(full_name)').gte('work_date', a).lte('work_date', b).order('work_date', { ascending: false }).order('id'); return e ? q.eq('employee_id', e) : q; }).catch(er => { toast(errMsg(er), 'bad'); return []; });
      pane.querySelector('#tbl').innerHTML = rows.length ? `<div class="tablewrap"><table><thead><tr><th>التاريخ</th><th>الموظف</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>التأخير</th><th>المصدر</th><th>ملاحظة</th></tr></thead><tbody>${rows.map(r =>
        `<tr class="click" data-id="${r.id}"><td>${fmtDate(r.work_date)}</td><td>${esc(r.employees?.full_name)}</td><td>${hm(r.check_in)}</td><td>${hm(r.check_out)}</td><td>${fmtM(mins(r))}</td><td>${r.late_minutes || '—'}</td><td>${r.source === 'manual' ? 'يدوي' : 'زر'}</td><td>${esc(r.note || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="panel empty">لا توجد سجلات في هذه الفترة.</div>';
    };
    pane.querySelectorAll('input,select').forEach(el => (el.onchange = load));
    pane.querySelector('#tbl').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) manual(emps, rows.find(r => r.id === tr.dataset.id), null, null, load); };
    pane.querySelector('#new').onclick = () => manual(emps.filter(x => x.active), null, pane.querySelector('#e').value || null, N.todayISO(), load);
    load();
  }

  /* ---------- التقارير ---------- */
  async function report() {
    pane.innerHTML = `<div class="row noprint" style="margin-bottom:1rem"><div><label>نوع التقرير</label><select id="ty">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div><label>التاريخ</label><input type="date" id="dt" value="${N.todayISO()}"></div><button class="btn" id="pr">طباعة</button><span id="bar"></span></div><div id="out"></div>`;
    const ty = pane.querySelector('#ty'), dt = pane.querySelector('#dt'), out = pane.querySelector('#out');
    let data = null;
    pane.querySelector('#bar').append(exportBar(() => data && ({ title: data.title, subtitle: data.subtitle, filename: `حضور-${TYPES[ty.value]}-${data.from}`, sections: data.sections })));
    pane.querySelector('#pr').onclick = () => window.print();
    const load = async () => {
      const type = ty.value, [from, to] = N.periodRange(type, dt.value || N.todayISO()), t = N.todayISO();
      const [{ data: emps }, recs] = await Promise.all([
        sb.from('employees').select('*').eq('active', true).order('full_name'),
        fetchAll(() => sb.from('attendance').select('*, employees(full_name)').gte('work_date', from).lte('work_date', to).order('work_date').order('id')),
      ]);
      const workdays = eachDate(from, to < t ? to : t).filter(d => WORKDAYS.includes(dow(d)));
      const detail = recs.map(r => [fmtDate(r.work_date), r.employees?.full_name || '', hm(r.check_in), hm(r.check_out), fmtM(mins(r)), r.late_minutes || 0, r.source === 'manual' ? 'يدوي' : 'زر', r.note || '']);
      const DCOLS = ['التاريخ', 'الموظف', 'الحضور', 'الانصراف', 'الساعات', 'التأخير (دقيقة)', 'المصدر', 'ملاحظة'];
      let sections, kpis;
      if (type === 'day') {
        const isWork = WORKDAYS.includes(dow(from));
        const rows = (emps || []).map(e => { const r = recs.find(x => x.employee_id === e.id);
          return [e.full_name, e.specialty || '', hm(r?.check_in), hm(r?.check_out), fmtM(r && mins(r)), r?.late_minutes || 0, r ? (r.check_out ? 'منصرف' : 'حاضر') : (isWork ? 'غائب' : 'عطلة')]; });
        sections = [{ heading: 'حضور اليوم', columns: ['الموظف', 'التخصص', 'الحضور', 'الانصراف', 'الساعات', 'التأخير (دقيقة)', 'الحالة'], rows }];
        kpis = [[recs.length, 'حاضرون'], [rows.filter(r => r[6] === 'غائب').length, 'غائبون'], [rows.filter(r => r[5] > 0).length, 'متأخرون'], [fmtM(recs.reduce((s, r) => s + (mins(r) || 0), 0)), 'مجموع الساعات']];
      } else {
        const rows = (emps || []).map(e => {
          const rs = recs.filter(x => x.employee_id === e.id), have = new Set(rs.map(x => x.work_date));
          const total = rs.reduce((s, x) => s + (mins(x) || 0), 0), withOut = rs.filter(x => mins(x) != null).length;
          return [e.full_name, e.specialty || '', rs.length, workdays.filter(d => !have.has(d)).length, fmtM(total), fmtM(withOut ? Math.round(total / withOut) : null),
            rs.filter(x => x.late_minutes > 0).length, rs.reduce((s, x) => s + x.late_minutes, 0), rs.filter(x => x.check_in && !x.check_out && x.work_date < t).length];
        });
        sections = [{ heading: 'ملخص الموظفين', columns: ['الموظف', 'التخصص', 'أيام الحضور', 'أيام الغياب', 'مجموع الساعات', 'متوسط الساعات/يوم', 'أيام التأخير', 'مجموع التأخير (دقيقة)', 'سجلات بلا انصراف'], rows },
          { heading: 'تفاصيل السجلات', columns: DCOLS, rows: detail }];
        kpis = [[recs.length, 'إجمالي سجلات الحضور'], [workdays.length, 'أيام العمل في الفترة'], [rows.reduce((s, r) => s + r[3], 0), 'مجموع أيام الغياب'], [rows.reduce((s, r) => s + r[7], 0), 'مجموع دقائق التأخير']];
      }
      const title = type === 'day' ? `تقرير الحضور اليومي — ${DAYS[dow(from)]} ${fmtDate(from)}` : `تقرير الحضور ${TYPES[type]} — من ${fmtDate(from)} إلى ${fmtDate(to)}`;
      data = { title, subtitle: `أيام الدوام: ${WORKDAYS.map(d => DAYS[d]).join('، ')}. الساعات = الانصراف − الحضور.`, from, sections };
      out.innerHTML = `<h2 style="font-size:1.3rem">${esc(data.title)}</h2><div class="kpis">${kpis.map(([n, l]) => `<div class="kpi"><b>${n}</b><span>${l}</span></div>`).join('')}</div>` +
        sections.map(s => `<div class="panel"><h2>${esc(s.heading)}</h2>${s.rows.length ? `<div class="tablewrap"><table><thead><tr>${s.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">لا توجد بيانات.</p>'}</div>`).join('');
    };
    ty.onchange = dt.onchange = () => load().catch(er => toast(errMsg(er), 'bad'));
    load().catch(er => toast(errMsg(er), 'bad'));
  }

  show();
}
