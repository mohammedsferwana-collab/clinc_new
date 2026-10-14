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
  root.innerHTML = `<header class="pagehead noprint"><h1>التقارير الإحصائية الشاملة (لوحة الإدمن)</h1><div class="row">
    <div><label>الفترة (يومي / أسبوعي / شهري)</label><select id="ty">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div><label>التاريخ</label><input type="date" id="dt" value="${N.todayISO()}"></div>
    <button class="btn" id="pr">طباعة</button><span id="bar"></span></div></header><div id="out"></div>`;
  const out = root.querySelector('#out'), ty = root.querySelector('#ty'), dt = root.querySelector('#dt');

  async function load() {
    type = ty.value;
    const [from, to] = N.periodRange(type, dt.value || N.todayISO());
    out.innerHTML = '<div class="panel empty">جارٍ إعداد التقارير الإحصائية وحركة المخزون…</div>';
    try {
      const [visits, moves, bal] = await Promise.all([
        fetchAll(() => sb.from('visits').select('id,visit_date,clinic,doctor_name,case_type,status,diagnosis,legacy_prescription,patient_id,patients(full_name,national_id,gender,birth_date),visit_items(drug_text,qty)')
          .gte('visit_date', from).lte('visit_date', to).order('visit_date').order('id')),
        fetchAll(() => sb.from('stock_movements').select('kind,qty,movement_date,note,drugs(name,unit)')
          .gte('movement_date', from).lte('movement_date', to).order('movement_date', { ascending: false })),
        sb.from('drug_balance').select('*').eq('active', true).then(r => r.data || []),
      ]);
      last = { from, to, ...build(visits, moves, bal) };
      draw(last);
    } catch (e) { out.innerHTML = ''; toast(errMsg(e), 'bad'); }
  }

  function build(visits, moves, bal) {
    const total = visits.length;
    const byClinic = tally(visits, v => v.clinic || 'بدون عيادة');
    const byDoctor = tally(visits, v => v.doctor_name || 'غير محدد');
    const byDay = tally(visits, v => v.visit_date).sort((a, b) => a[0].localeCompare(b[0]));
    const byGender = tally(visits, v => v.patients?.gender || 'غير مسجل');
    const ageMap = new Map(tally(visits, v => N.ageGroup(v.patients?.birth_date, v.visit_date)));
    const byAge = N.AGE_GROUPS.map(g => [g, ageMap.get(g) || 0]);
    const byCase = tally(visits, v => v.case_type || 'غير محدد');
    const diag = tally(visits.filter(v => v.diagnosis), v => N.cleanText(v.diagnosis).toLowerCase()).slice(0, 10);

    const outs = moves.filter(m => m.kind === 'out');
    const ins = moves.filter(m => m.kind === 'in');

    const dm = new Map();
    outs.forEach(o => { const k = o.drugs?.name || '—'; const cur = dm.get(k) || { qty: 0, unit: o.drugs?.unit || '' }; cur.qty += o.qty; dm.set(k, cur); });
    const drugs = [...dm].sort((a, b) => b[1].qty - a[1].qty).slice(0, 15);

    const low = bal.filter(b => b.balance <= b.min_stock).sort((a, b) => a.balance - b.balance);
    const days = byDay.length;

    return {
      visits, moves, total,
      patients: new Set(visits.map(v => v.patient_id)).size,
      days, avg: days ? Math.round(total / days) : 0,
      byClinic, byDoctor, byDay, byGender, byAge, byCase, diag, drugs, low,
      dispensed: outs.reduce((s, o) => s + o.qty, 0),
      supplied: ins.reduce((s, i) => s + i.qty, 0)
    };
  }

  const table = (head, rows) => rows.length
    ? `<div class="tablewrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">لا توجد بيانات.</p>';
  const share = (list, t) => table(['البند', 'العدد', 'النسبة', ''], list.map(([k, n]) =>
    [esc(k), n, pct(n, t), `<div class="bar"><i style="width:${t ? (n / t) * 100 : 0}%"></i></div>`]));

  function draw(r) {
    const title = type === 'day' ? `تقرير يوم ${DAYS[new Date(r.from + 'T00:00:00Z').getUTCDay()]} ${fmtDate(r.from)}` : `تقرير ${TYPES[type]}: من ${fmtDate(r.from)} إلى ${fmtDate(r.to)}`;
    const kindAr = { in: 'توريد وارد (+)', out: 'صرف للمريض (-)', adjust: 'تسوية جرد' };

    out.innerHTML = `<h2 style="font-size:1.3rem">${title}</h2>
    <div class="kpis">
      <div class="kpi"><b>${r.total}</b><span>إجمالي المرضى / الزيارات</span></div>
      <div class="kpi"><b>${r.patients}</b><span>مرضى مختلفون</span></div>
      <div class="kpi"><b>${r.dispensed}</b><span>وحدات دوائية مصروفة</span></div>
      <div class="kpi"><b>${r.supplied}</b><span>وحدات دوائية موردة</span></div>
    </div>

    <div class="cols2">
      <div class="panel"><h2>توزيع المرضى حسب العيادات</h2>${share(r.byClinic, r.total)}</div>
      <div class="panel"><h2>توزيع المرضى حسب الأطباء</h2>${share(r.byDoctor, r.total)}</div>
    </div>

    <div class="cols2">
      <div class="panel"><h2>الفئة العمرية</h2>${share(r.byAge, r.total)}</div>
      <div class="panel"><h2>الجنس ونوع الحالة</h2>${share(r.byGender, r.total)}</div>
    </div>

    ${type !== 'day' ? `<div class="panel"><h2>عدد المرضى اليومي خلال الفترة</h2>${table(['اليوم', 'التاريخ', 'عدد المرضى'], r.byDay.map(([d, n]) => [DAYS[new Date(d + 'T00:00:00Z').getUTCDay()], fmtDate(d), n]))}</div>` : ''}

    <div class="cols2">
      <div class="panel"><h2>أكثر الأدوية صرفاً في الصيدلية</h2>${table(['الدواء', 'الكمية المصروفة'], r.drugs.map(([k, v]) => [esc(k), `${v.qty}${esc(v.unit)}`]))}</div>
      <div class="panel"><h2>أدوية منخفضة الرصيد أو نفدت (${r.low.length})</h2>${table(['الدواء', 'الرصيد المتاح', 'حد الطلب'], r.low.slice(0, 20).map(b => [esc(b.name), `${b.balance}${esc(b.unit)}`, b.min_stock]))}</div>
    </div>

    <div class="panel">
      <h2>سجل حركة مخزون الصيدلية التفصيلي (توريد / صرف / جرد)</h2>
      ${table(['التاريخ', 'الصنف الدوائي', 'نوع الحركة', 'الكمية', 'ملاحظات'], r.moves.slice(0, 50).map(m => [
        fmtDate(m.movement_date),
        esc(m.drugs?.name || '—'),
        esc(kindAr[m.kind] || m.kind),
        `${m.qty}${esc(m.drugs?.unit || '')}`,
        esc(m.note || '—')
      ]))}
    </div>`;
  }

  ty.onchange = dt.onchange = load;
  root.querySelector('#pr').onclick = () => window.print();
  root.querySelector('#bar').append(exportBar(() => {
    if (!last) return null;
    const L = last, tt = (t, n) => ({ heading: t, columns: ['البند', 'العدد'], rows: n });
    return {
      title: `تقرير ${TYPES[type]}`, subtitle: `من ${fmtDate(L.from)} إلى ${fmtDate(L.to)}`, filename: `تقرير-${TYPES[type]}-${L.from}`,
      sections: [
        { heading: 'ملخص', columns: ['البند', 'القيمة'], rows: [['إجمالي الزيارات', L.total], ['مراجعون مختلفون', L.patients], ['الوحدات المصروفة', L.dispensed], ['الوحدات الموردة', L.supplied]] },
        tt('العيادات', L.byClinic),
        tt('الأطباء', L.byDoctor),
        { heading: 'الأدوية المصروفة', columns: ['الدواء', 'الكمية', 'الوحدة'], rows: L.drugs.map(([k, v]) => [k, v.qty, v.unit]) },
        { heading: 'حركة المخزون', columns: ['التاريخ', 'الدواء', 'الحركة', 'الكمية', 'ملاحظة'], rows: L.moves.map(m => [fmtDate(m.movement_date), m.drugs?.name || '', m.kind, m.qty, m.note || '']) }
      ]
    };
  }));
  load();
}