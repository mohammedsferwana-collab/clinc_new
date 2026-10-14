import * as N from './normalize.js';
import { FIELDS, detectHeader, autoMap, rowsToRecords, parseStock } from './parse.js';
import { esc, toast, errMsg, fetchAll } from './ui.js';

const chunk = (a, n = 500) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const IMPORT_NOTE = 'استيراد من إكسل';

export function renderImport(root, ctx) {
  const { sb } = ctx;
  let wb = null, rows = [], hdr = -1, map = {}, parsed = null;

  root.innerHTML = `<header class="pagehead"><h1>استيراد من إكسل</h1></header>
  <div class="panel"><h2>1. اختيار الملف</h2><input type="file" id="file" accept=".xlsx,.xls,.csv"><p class="muted small" id="fileinfo">يدعم ملف البرنامج الحالي أو أي كشف مراجعين بنفس نوع الأعمدة.</p></div>
  <div class="panel" id="vsec" hidden><h2>2. سجل الزيارات</h2>
    <div class="row"><div style="min-width:240px"><label>الورقة</label><select id="sheet"></select></div></div>
    <h3>مطابقة الأعمدة</h3><div class="grid" id="map"></div>
    <div id="preview"></div>
    <div class="row" style="margin-top:1rem"><div><label>تاريخ بديل للصفوف بلا تاريخ (اختياري)</label><input type="date" id="fb"></div>
      <button class="btn primary" id="go" disabled>استيراد الزيارات</button></div><div class="progress" id="prog"></div></div>
  <div class="panel" id="ssec" hidden><h2>3. الأدوية والتوريدات</h2><div id="sinfo"></div>
    <div class="row" style="margin-top:.8rem"><button class="btn primary" id="sgo">استيراد الأدوية والتوريدات</button></div><div class="progress" id="sprog"></div></div>`;
  const $ = s => root.querySelector(s);

  $('#file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { wb = XLSX.read(await f.arrayBuffer(), { type: 'array' }); } catch { return toast('تعذر قراءة الملف', 'bad'); }
    const hidden = (wb.Workbook?.Sheets || []).map(s => s.Hidden);
    const names = wb.SheetNames.filter((n, i) => !hidden[i]);
    $('#fileinfo').textContent = `${f.name} — ${names.length} ورقة`;
    const rowsOf = n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false });
    const best = names.find(n => detectHeader(rowsOf(n)) >= 0) || names[0];
    $('#sheet').innerHTML = names.map(n => `<option ${n === best ? 'selected' : ''}>${esc(n)}</option>`).join('');
    $('#sheet').onchange = () => loadSheet(rowsOf);
    $('#vsec').hidden = false;
    loadSheet(rowsOf);
    const stock = names.find(n => /مخزون/.test(n));
    if (stock) {
      const s = parseStock(rowsOf(stock));
      $('#ssec').hidden = false; $('#ssec')._s = s;
      $('#sinfo').innerHTML = `<p>تم العثور على ورقة «${esc(stock)}»: <b>${s.drugs.length}</b> دواءً و<b>${s.receipts.length}</b> عملية توريد.</p>
        <p class="muted small">سيُضاف كل توريد كرصيد وارد. الصرف اليومي غير المسجل في الملف لا يُستورد، فراجع الأرصدة بعد الاستيراد وعدّلها بـ «تسوية جرد» عند الحاجة. وحدة الدواء المعتمدة هي وحدة جدول المخزون الشهري.</p>`;
    } else $('#ssec').hidden = true;
  };

  function loadSheet(rowsOf) {
    rows = rowsOf($('#sheet').value);
    hdr = detectHeader(rows);
    if (hdr < 0) { $('#map').innerHTML = ''; $('#preview').innerHTML = '<p class="muted">لم أجد صف عناوين مطابقاً في هذه الورقة. اختر ورقة أخرى.</p>'; $('#go').disabled = true; parsed = null; return; }
    map = autoMap(rows[hdr]);
    const heads = rows[hdr].map((c, i) => [i, N.cleanText(c)]).filter(([, c]) => c);
    $('#map').innerHTML = FIELDS.map(([k, label]) => `<div><label>${label}</label><select data-k="${k}"><option value="">— غير موجود —</option>${heads.map(([i, c]) => `<option value="${i}" ${map[k] === i ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>`).join('');
    $('#map').onchange = e => { const v = e.target.value; if (v === '') delete map[e.target.dataset.k]; else map[e.target.dataset.k] = +v; preview(); };
    preview();
  }

  function preview() {
    if (map.name == null) { $('#preview').innerHTML = '<p class="muted">حدد عمود الاسم لعرض المعاينة.</p>'; $('#go').disabled = true; return; }
    parsed = rowsToRecords(rows, hdr, map);
    const r = parsed.records;
    const noDate = r.filter(x => !x.visit_date).length, noId = r.filter(x => !x.national_id).length;
    const oddId = r.filter(x => x.national_id && x.national_id.length !== 9).length;
    const unk = r.filter(x => !x.clinicKnown);
    const dates = r.map(x => x.visit_date).filter(Boolean).sort();
    const cl = {}; r.forEach(x => { const k = x.clinic || 'بدون عيادة'; cl[k] = (cl[k] || 0) + 1; });
    $('#preview').innerHTML = `<h3>المعاينة</h3><ul>
      <li><b>${r.length}</b> زيارة جاهزة${dates.length ? ` (من ${dates[0]} إلى ${dates.at(-1)})` : ''}، وتجاهلت ${parsed.skipped} صفاً فارغاً من الاسم.</li>
      <li>العيادات بعد التوحيد: ${Object.entries(cl).map(([k, n]) => `${esc(k)} ${n}`).join('، ')}</li>
      ${noDate ? `<li style="color:var(--bad)">${noDate} زيارة بلا تاريخ صالح — ستُتجاهل ما لم تحدد تاريخاً بديلاً.</li>` : ''}
      ${noId ? `<li class="muted">${noId} زيارة بلا رقم هوية (يُطابق المراجع بالاسم وتاريخ الميلاد).</li>` : ''}
      ${oddId ? `<li class="muted">${oddId} رقم هوية طوله ليس 9 خانات — راجعها بعد الاستيراد.</li>` : ''}
      ${unk.length ? `<li class="muted">${unk.length} زيارة عيادتها فارغة أو غير مفهومة${unk.some(x => x.clinicRaw) ? ' (مثل: ' + esc([...new Set(unk.map(x => x.clinicRaw).filter(Boolean))].slice(0, 4).join('، ')) + ')' : ''} — تُستورد بلا عيادة.</li>` : ''}</ul>
      <div class="tablewrap"><table><thead><tr><th>التاريخ</th><th>الاسم</th><th>الهوية</th><th>العيادة</th><th>التشخيص</th><th>العلاج</th></tr></thead><tbody>${r.slice(0, 6).map(x =>
        `<tr><td>${x.visit_date || '—'}</td><td>${esc(x.name)}</td><td>${esc(x.national_id || '—')}</td><td>${esc(x.clinic || '—')}</td><td>${esc(x.diagnosis || '—')}</td><td>${esc(x.treatment || '—')}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted small">الاستيراد آمن للتكرار: الزيارات المطابقة (نفس المراجع والتاريخ والعلاج) لا تُضاف مرتين.</p>`;
    $('#go').disabled = !r.length;
  }

  $('#go').onclick = async () => {
    const log = m => ($('#prog').textContent = m);
    $('#go').disabled = true;
    try {
      const fb = $('#fb').value || null;
      const recs = parsed.records.map(r => ({ ...r, visit_date: r.visit_date || fb })).filter(r => r.visit_date);
      if (!recs.length) throw new Error('لا توجد زيارات صالحة للاستيراد');
      log('تحميل المراجعين الحاليين…');
      const existing = await fetchAll(() => sb.from('patients').select('id,national_id,full_name,birth_date').order('id'));
      const byId = new Map(), byNB = new Map();
      existing.forEach(p => { if (p.national_id) byId.set(p.national_id, p.id); byNB.set(p.full_name + '|' + (p.birth_date || ''), p.id); });
      const newPatients = [];
      const keyed = recs.map(r => {
        const nb = r.name + '|' + (r.birth_date || '');
        let pid = (r.national_id && byId.get(r.national_id)) || byNB.get(nb);
        if (!pid) {
          pid = crypto.randomUUID();
          newPatients.push({ id: pid, national_id: r.national_id, full_name: r.name, phone: r.phone, address: r.address, gender: r.gender, birth_date: r.birth_date, created_by: ctx.profile.id });
          if (r.national_id) byId.set(r.national_id, pid);
          byNB.set(nb, pid);
        }
        return { ...r, pid };
      });
      let done = 0;
      for (const part of chunk(newPatients)) {
        const { error } = await sb.from('patients').insert(part);
        if (error) throw error;
        log(`إضافة المراجعين الجدد… ${(done += part.length)} / ${newPatients.length}`);
      }
      log('فحص الزيارات المكررة…');
      const ds = keyed.map(r => r.visit_date).sort();
      const ex = await fetchAll(() => sb.from('visits').select('id,patient_id,visit_date,legacy_prescription').gte('visit_date', ds[0]).lte('visit_date', ds.at(-1)).order('id'));
      const seen = new Set(ex.map(v => `${v.patient_id}|${v.visit_date}|${v.legacy_prescription || ''}`));
      const toAdd = [];
      let dup = 0;
      keyed.forEach(r => {
        const k = `${r.pid}|${r.visit_date}|${r.treatment || ''}`;
        if (seen.has(k)) { dup++; return; }
        seen.add(k);
        toAdd.push({ patient_id: r.pid, visit_date: r.visit_date, clinic: r.clinic, doctor_name: r.doctor, case_type: r.case_type, diagnosis: r.diagnosis,
          notes: r.notes, legacy_prescription: r.treatment, status: 'seen', source: 'import', created_by: ctx.profile.id });
      });
      done = 0;
      for (const part of chunk(toAdd)) {
        const { error } = await sb.from('visits').insert(part);
        if (error) throw error;
        log(`إضافة الزيارات… ${(done += part.length)} / ${toAdd.length}`);
      }
      // لا تُضاف أسماء الأطباء من الإكسل؛ الأطباء يُضافون فقط من «الموظفون والحسابات». يبقى اسم الطبيب مسجلاً نصاً في الزيارة.
      await ctx.loadLookups();
      log(`اكتمل الاستيراد: ${toAdd.length} زيارة جديدة، ${newPatients.length} مراجع جديد، ${dup} زيارة مكررة تم تخطيها.`);
      toast('اكتمل الاستيراد');
    } catch (e) { log(''); toast(errMsg(e), 'bad'); }
    $('#go').disabled = false;
  };

  $('#sgo').onclick = async () => {
    const s = $('#ssec')._s, log = m => ($('#sprog').textContent = m);
    $('#sgo').disabled = true;
    try {
      const { count } = await sb.from('stock_movements').select('id', { count: 'exact', head: true }).eq('note', IMPORT_NOTE);
      if (count) throw new Error('سبق استيراد توريدات من إكسل. لتفادي تكرار الأرصدة لن يُنفذ الاستيراد مرة ثانية.');
      log('إضافة الأدوية…');
      for (const part of chunk(s.drugs)) {
        const { error } = await sb.from('drugs').upsert(part.map(d => ({ name: d.name, unit: d.unit })), { onConflict: 'name', ignoreDuplicates: true });
        if (error) throw error;
      }
      const all = await fetchAll(() => sb.from('drugs').select('id,name').order('id'));
      const ids = new Map(all.map(d => [d.name.toLowerCase(), d.id]));
      const moves = s.receipts.map(r => ({ drug_id: ids.get(r.name.toLowerCase()), kind: 'in', qty: r.qty, movement_date: r.date, note: IMPORT_NOTE, created_by: ctx.profile.id })).filter(m => m.drug_id);
      let done = 0;
      for (const part of chunk(moves)) {
        const { error } = await sb.from('stock_movements').insert(part);
        if (error) throw error;
        log(`إضافة التوريدات… ${(done += part.length)} / ${moves.length}`);
      }
      await ctx.loadLookups();
      log(`اكتمل: ${s.drugs.length} دواء و${moves.length} توريد.`);
      toast('اكتمل استيراد المخزون');
    } catch (e) { log(''); toast(errMsg(e), 'bad'); $('#sgo').disabled = false; }
  };
}
