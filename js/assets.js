import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, errMsg, fmtDate, fetchAll } from './ui.js';
import { exportBar } from './export.js';

const STATUS = { in_use: ['في الاستخدام', 'ok'], in_store: ['في المخزن', 'wait'], damaged: ['تالف', 'bad'] };
const BASE_TYPES = ['أثاث', 'أجهزة', 'معدات', 'أدوات طبية', 'أجهزة اتصال', 'مركبات', 'أخرى'];

export function renderAssets(root, ctx) {
  const { sb } = ctx;
  let items = [], emps = [], tab = 'list';
  root.innerHTML = `<header class="pagehead"><h1>العهد</h1><div class="row"><div class="chips" id="tabs"><button class="chip on" data-t="list">القائمة</button><button class="chip" data-t="report">تقرير العهد</button></div>
    <span id="bar"></span><button class="btn primary" id="new">عهدة جديدة</button></div></header><div id="pane"></div>`;
  const pane = root.querySelector('#pane');
  root.querySelector('#tabs').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; tab = b.dataset.t; root.querySelectorAll('#tabs .chip').forEach(c => c.classList.toggle('on', c === b)); draw(); };
  const owner = a => a.employees?.full_name || 'بدون (غير مُسلّمة)';
  const detailRows = list => list.map(a => [a.asset_type, a.name, a.model || '', a.color || '', a.serial_no || '', a.employees?.full_name || '', a.assigned_date || '', STATUS[a.status][0]]);
  const DETAIL_COLS = ['النوع', 'الاسم', 'الموديل', 'اللون', 'الرقم التسلسلي', 'صاحب العهدة', 'تاريخ التسليم', 'الحالة'];
  let shown = [];
  root.querySelector('#bar').append(exportBar(() => ({
    title: tab === 'report' ? 'تقرير العهد' : 'سجل العهد', subtitle: 'تاريخ التصدير: ' + N.todayISO(), filename: 'العهد-' + N.todayISO(),
    sections: tab === 'report' ? reportSections() : [{ heading: 'العهد', columns: DETAIL_COLS, rows: detailRows(shown) }],
  })));

  async function load() {
    const [a, e] = await Promise.all([
      fetchAll(() => sb.from('assets').select('*, employees(full_name,specialty)').order('created_at')),
      sb.from('employees').select('id,full_name,specialty').eq('active', true).order('full_name'),
    ]).catch(er => { toast(errMsg(er), 'bad'); return [[], { data: [] }]; });
    items = a; emps = e.data || []; draw();
  }

  function reportSections() {
    const byEmp = new Map();
    items.forEach(a => { const k = owner(a); if (!byEmp.has(k)) byEmp.set(k, { sp: a.employees?.specialty || '', list: [] }); byEmp.get(k).list.push(a); });
    const byType = new Map();
    items.forEach(a => byType.set(a.asset_type, (byType.get(a.asset_type) || 0) + 1));
    const assigned = items.filter(a => a.assigned_to && a.status === 'in_use').length;
    return [
      { heading: 'ملخص', columns: ['البند', 'العدد'], rows: [['إجمالي العهد', items.length], ['في عهدة موظفين', assigned], ['في المخزن', items.filter(a => a.status === 'in_store').length], ['تالفة', items.filter(a => a.status === 'damaged').length], ['موظفون لديهم عهد', [...byEmp.keys()].filter(k => !k.startsWith('بدون')).length]] },
      { heading: 'العهد حسب الموظف', columns: ['الموظف', 'التخصص', 'عدد العهد', 'التفاصيل'],
        rows: [...byEmp].sort((a, b) => b[1].list.length - a[1].list.length).map(([k, v]) => [k, v.sp, v.list.length, v.list.map(a => `${a.asset_type}: ${a.name}${a.serial_no ? ' (' + a.serial_no + ')' : ''}`).join('؛ ')]) },
      { heading: 'العهد حسب النوع', columns: ['النوع', 'العدد'], rows: [...byType].sort((a, b) => b[1] - a[1]) },
      { heading: 'تفاصيل العهد', columns: DETAIL_COLS, rows: detailRows(items) },
    ];
  }

  function draw() {
    if (tab === 'report') {
      const secs = reportSections();
      const tb = (cols, rows) => `<div class="tablewrap"><table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      pane.innerHTML = `<div class="kpis">${secs[0].rows.map(([k, n]) => `<div class="kpi"><b>${n}</b><span>${k}</span></div>`).join('')}</div>
        <div class="panel"><h2>العهد حسب الموظف</h2>${tb(secs[1].columns, secs[1].rows)}</div><div class="panel"><h2>العهد حسب النوع</h2>${tb(secs[2].columns, secs[2].rows)}</div>`;
      return;
    }
    const types = [...new Set(items.map(a => a.asset_type))].sort();
    pane.innerHTML = `<div class="row" style="margin-bottom:.8rem"><input id="f" placeholder="بحث بالاسم أو الرقم التسلسلي أو الموديل" style="width:280px">
      <select id="ft" style="width:160px"><option value="">كل الأنواع</option>${types.map(t => `<option>${esc(t)}</option>`).join('')}</select>
      <select id="fe" style="width:200px"><option value="">كل أصحاب العهد</option><option value="none">بدون صاحب</option>${emps.map(e => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('')}</select></div><div id="tbl"></div>`;
    const redraw = () => {
      const t = N.arNorm(pane.querySelector('#f').value), ty = pane.querySelector('#ft').value, em = pane.querySelector('#fe').value;
      shown = items.filter(a => (!ty || a.asset_type === ty) && (!em || (em === 'none' ? !a.assigned_to : a.assigned_to === em)) && (!t || N.arNorm([a.name, a.serial_no, a.model, a.color].join(' ')).includes(t)));
      pane.querySelector('#tbl').innerHTML = shown.length
        ? `<div class="tablewrap"><table><thead><tr>${DETAIL_COLS.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${shown.map(a =>
          `<tr class="click" data-id="${a.id}"><td>${esc(a.asset_type)}</td><td>${esc(a.name)}</td><td>${esc(a.model || '—')}</td><td>${esc(a.color || '—')}</td><td>${esc(a.serial_no || '—')}</td><td>${esc(a.employees?.full_name || '—')}</td><td>${fmtDate(a.assigned_date) || '—'}</td><td><span class="badge ${STATUS[a.status][1]}">${STATUS[a.status][0]}</span></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="panel empty">لا توجد عهد مطابقة. اضغط «عهدة جديدة» لإضافة أول عهدة.</div>';
    };
    pane.querySelectorAll('input,select').forEach(el => (el.oninput = el.onchange = redraw));
    pane.querySelector('#tbl').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) form(items.find(a => a.id === tr.dataset.id)); };
    redraw();
  }

  function form(a) {
    const v = a || { status: 'in_use', assigned_date: N.todayISO() };
    const types = [...new Set([...BASE_TYPES, ...items.map(x => x.asset_type)])];
    const body = openModal(`<h2>${a ? 'تعديل عهدة' : 'عهدة جديدة'}</h2><form id="af" class="grid">
      <div><label>نوع العهدة *</label><input name="asset_type" list="atypes" required value="${esc(v.asset_type)}"><datalist id="atypes">${types.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
      <div><label>الاسم *</label><input name="name" required value="${esc(v.name)}" placeholder="مثال: حاسوب محمول"></div>
      <div><label>الموديل</label><input name="model" value="${esc(v.model)}"></div>
      <div><label>اللون</label><input name="color" value="${esc(v.color)}"></div>
      <div><label>الرقم التسلسلي (إن وجد)</label><input name="serial_no" value="${esc(v.serial_no)}" dir="ltr"></div>
      <div><label>صاحب العهدة</label><select name="assigned_to"><option value="">بدون (في المخزن)</option>${emps.map(e => `<option value="${e.id}" ${v.assigned_to === e.id ? 'selected' : ''}>${esc(e.full_name)}</option>`).join('')}</select></div>
      <div><label>تاريخ التسليم</label><input name="assigned_date" type="date" value="${esc(v.assigned_date)}"></div>
      <div><label>الحالة</label><select name="status">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${v.status === k ? 'selected' : ''}>${s[0]}</option>`).join('')}</select></div>
      <div style="grid-column:1/-1"><label>ملاحظات</label><input name="notes" value="${esc(v.notes)}"></div>
      <div style="grid-column:1/-1" class="row"><button class="btn primary">حفظ</button>${a ? '<button type="button" class="btn danger" id="del">حذف</button>' : ''}</div></form>`, { wide: true });
    body.querySelector('#af').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const rec = { asset_type: N.cleanText(f.asset_type), name: N.cleanText(f.name), model: N.cleanText(f.model) || null, color: N.cleanText(f.color) || null,
        serial_no: N.cleanText(f.serial_no) || null, assigned_to: f.assigned_to || null, assigned_date: f.assigned_to ? (f.assigned_date || N.todayISO()) : null,
        status: f.assigned_to || f.status !== 'in_use' ? f.status : 'in_store', notes: N.cleanText(f.notes) || null };
      const { error } = a ? await sb.from('assets').update(rec).eq('id', a.id) : await sb.from('assets').insert(rec);
      if (error) return toast(errMsg(error), 'bad');
      toast('تم الحفظ'); closeModal(); load();
    };
    if (a) body.querySelector('#del').onclick = async () => {
      if (!confirm('حذف هذه العهدة نهائياً؟')) return;
      const { error } = await sb.from('assets').delete().eq('id', a.id);
      if (error) return toast(errMsg(error), 'bad');
      toast('تم الحذف'); closeModal(); load();
    };
  }
  root.querySelector('#new').onclick = () => form(null);
  load();
}
