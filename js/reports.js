import * as N from './normalize.js';
import { esc, toast, errMsg, fmtDate, fetchAll } from './ui.js';
import { exportBar } from './export.js';

const TYPES = { day: 'يومي', week: 'أسبوعي', month: 'شهري' };
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const tally = (arr, fn) => { const m = new Map(); arr.forEach(x => { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); };
const pct = (n, t) => (t ? Math.round((n / t) * 100) + '%' : '0%');

export function renderReports(root, ctx) {
  const { sb } = ctx;
  let type = 'day', last = null;
  root.innerHTML = `<header class="pagehead noprint"><h1>التقارير</h1><div class="row">
    <div><label>نوع التقرير</label><select id="ty">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div><label>التاريخ</label><input type="date" id="dt" value="${N.todayISO()}"></div>
    <button class="btn" id="pr">طباعة</button><span id="bar"></span></div></header><div id="out"></div>`;
  const out = root.querySelector('#out'), ty = root.querySelector('#ty'), dt = root.querySelector('#dt');

  async function load() {
    type = ty.value;
    const [from, to] = N.periodRange(type, dt.value || N.todayISO());
    out.innerHTML = '<div class="panel empty">جارٍ إعداد التقرير…</div>';
    try {
      const [visits, outs, bal] = await Promise.all([
        fetchAll(() => sb.from('visits').select('id,visit_date,clinic,doctor_name,case_type,diagnosis,legacy_prescription,patient_id,patients(full_name,national_id,gender,birth_date),visit_items(drug_text,qty)')
          .gte('visit_date', from).lte('visit_date', to).order('visit_date').order('id')),
        fetchAll(() => sb.from('stock_movements').select('qty,drugs(name,unit)').eq('kind', 'out')
          .gte('movement_date', from).lte('movement_date', to).order('id')),
        sb.from('drug_balance').select('name,unit,balance,min_stock').eq('active', true).then(r => r.data || []),
      ]);
      last = { from, to, ...build(visits, outs, bal) };
      draw(last);
    } catch (e) { out.innerHTML = ''; toast(errMsg(e), 'bad'); }
  }

  function build(visits, outs, bal) {
    const total = visits.length;
    const byClinic = tally(visits, v => v.clinic || 'بدون عيادة');
    const byDay = tally(visits, v => v.visit_date).sort((a, b) => a[0].localeCompare(b[0]));
    const byGender = tally(visits, v => v.patients?.gender || 'غير مسجل');
    const ageMap = new Map(tally(visits, v => N.ageGroup(v.patients?.birth_date, v.visit_date)));
    const byAge = N.AGE_GROUPS.map(g => [g, ageMap.get(g) || 0]);
    const byCase = tally(visits, v => v.case_type || 'غير محدد');
    const diag = tally(visits.filter(v => v.diagnosis), v => N.cleanText(v.diagnosis).toLowerCase()).slice(0, 10);
    const dm = new Map();
    outs.forEach(o => { const k = o.drugs?.name || '—'; const cur = dm.get(k) || { qty: 0, unit: o.drugs?.unit || '' }; cur.qty += o.qty; dm.set(k, cur); });
    const drugs = [...dm].sort((a, b) => b[1].qty - a[1].qty).slice(0, 10);
    const low = bal.filter(b => b.balance <= b.min_stock).sort((a, b) => a.balance - b.balance);
    const days = byDay.length;
    return { visits, total, patients: new Set(visits.map(v => v.patient_id)).size, days, avg: days ? Math.round(total / days) : 0,
      byClinic, byDay, byGender, byAge, byCase, diag, drugs, low, dispensed: outs.reduce((s, o) => s + o.qty, 0) };
  }

  const table = (head, rows) => rows.length
    ? `<div class="tablewrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">لا توجد بيانات.</p>';
  const share = (list, t) => table(['البند', 'العدد', 'النسبة', ''], list.map(([k, n]) =>
    [esc(k), n, pct(n, t), `<div class="bar"><i style="width:${t ? (n / t) * 100 : 0}%"></i></div>`]));

  function draw(r) {
    const title = type === 'day' ? `تقرير يوم ${DAYS[new Date(r.from + 'T00:00:00Z').getUTCDay()]} ${fmtDate(r.from)}` : `تقرير ${TYPES[type]}: من ${fmtDate(r.from)} إلى ${fmtDate(r.to)}`;
    out.innerHTML = `<h2 style="font-size:1.3rem">${title}</h2>
    <div class="kpis"><div class="kpi"><b>${r.total}</b><span>إجمالي الزيارات</span></div><div class="kpi"><b>${r.patients}</b><span>مراجعون مختلفون</span></div>
      ${type !== 'day' ? `<div class="kpi"><b>${r.avg}</b><span>متوسط الزيارات في يوم العمل (${r.days} يوم)</span></div>` : ''}
      <div class="kpi"><b>${r.dispensed}</b><span>إجمالي الوحدات المصروفة</span></div></div>
    <div class="cols2"><div class="panel"><h2>الزيارات حسب العيادة</h2>${share(r.byClinic, r.total)}</div>
      <div class="panel"><h2>الفئة العمرية</h2>${share(r.byAge, r.total)}</div></div>
    <div class="cols2"><div class="panel"><h2>الجنس</h2>${share(r.byGender, r.total)}</div><div class="panel"><h2>جديد / مراجع</h2>${share(r.byCase, r.total)}</div></div>
    ${type !== 'day' ? `<div class="panel"><h2>الزيارات حسب اليوم</h2>${table(['اليوم', 'التاريخ', 'الزيارات'], r.byDay.map(([d, n]) => [DAYS[new Date(d + 'T00:00:00Z').getUTCDay()], fmtDate(d), n]))}</div>` : ''}
    <div class="cols2"><div class="panel"><h2>أكثر التشخيصات</h2>${table(['التشخيص', 'العدد'], r.diag.map(([k, n]) => [esc(k), n]))}</div>
      <div class="panel"><h2>أكثر الأدوية صرفاً</h2>${table(['الدواء', 'الكمية'], r.drugs.map(([k, v]) => [esc(k), `${v.qty} ${esc(v.unit)}`]))}</div></div>
    <div class="panel"><h2>أدوية منخفضة أو منتهية (حالياً)</h2>${table(['الدواء', 'الرصيد', 'حد الطلب'], r.low.slice(0, 30).map(b => [esc(b.name), `${b.balance} ${esc(b.unit)}`, b.min_stock]))}</div>`;
  }

  ty.onchange = dt.onchange = load;
  root.querySelector('#pr').onclick = () => window.print();
  root.querySelector('#bar').append(exportBar(() => {
    if (!last) return null;
    const L = last, tt = (t, n) => ({ heading: t, columns: ['البند', 'العدد'], rows: n });
    const rx = v => (v.visit_items || []).map(i => i.drug_text + (i.qty > 1 ? ' × ' + i.qty : '')).join('، ') || v.legacy_prescription || '';
    return { title: `تقرير ${TYPES[type]}`, subtitle: `من ${fmtDate(L.from)} إلى ${fmtDate(L.to)}`, filename: `تقرير-${TYPES[type]}-${L.from}`,
      sections: [
        { heading: 'ملخص', columns: ['البند', 'القيمة'], rows: [['إجمالي الزيارات', L.total], ['مراجعون مختلفون', L.patients], ['أيام العمل', L.days], ['الوحدات المصروفة', L.dispensed]] },
        tt('العيادات', L.byClinic), ...(type !== 'day' ? [tt('الأيام', L.byDay.map(([d, n]) => [fmtDate(d), n]))] : []),
        tt('الفئات العمرية', L.byAge), tt('الجنس', L.byGender), tt('جديد ومراجع', L.byCase), tt('التشخيصات', L.diag),
        { heading: 'الأدوية المصروفة', columns: ['الدواء', 'الكمية', 'الوحدة'], rows: L.drugs.map(([k, v]) => [k, v.qty, v.unit]) },
        { heading: 'مخزون منخفض', columns: ['الدواء', 'الرصيد', 'الوحدة', 'حد الطلب'], rows: L.low.map(b => [b.name, b.balance, b.unit, b.min_stock]) },
        { heading: 'سجل الزيارات', columns: ['التاريخ', 'المراجع', 'الهوية', 'العمر', 'الجنس', 'العيادة', 'الطبيب', 'التشخيص', 'العلاج'],
          rows: L.visits.map(v => [fmtDate(v.visit_date), v.patients?.full_name || '', v.patients?.national_id || '', N.ageText(v.patients?.birth_date, v.visit_date), v.patients?.gender || '', v.clinic || '', v.doctor_name || '', v.diagnosis || '', rx(v)]) },
      ] };
  }));
  load();
}
