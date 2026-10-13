// قراءة جداول إكسل القديمة وتحويلها إلى سجلات (بدون اعتماد على المتصفح)
import { cleanText, cleanId, cleanPhone, parseDate, normClinic, normGender, normCase } from './normalize.js';

export const FIELDS = [
  ['date', 'تاريخ الزيارة', /تاريخ.*زيار|^التاريخ$/],
  ['name', 'الاسم', /الاسم/],
  ['id', 'رقم الهوية', /هوي/],
  ['phone', 'الجوال', /جوال|هاتف|موبايل/],
  ['address', 'العنوان', /عنوان|نزوح|سكن/],
  ['gender', 'الجنس', /جنس/],
  ['caseType', 'نوع الحالة', /نوع.*حالة/],
  ['birth', 'تاريخ الميلاد', /ميلاد/],
  ['clinic', 'العيادة', /عيادة/],
  ['doctor', 'الطبيب', /طبيب/],
  ['diagnosis', 'التشخيص', /تشخيص/],
  ['treatment', 'العلاج الموصوف', /علاج|وصف/],
  ['notes', 'ملاحظات', /ملاحظ/],
];

export function detectHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = (rows[i] || []).map(c => cleanText(c));
    const hits = FIELDS.filter(([, , re]) => cells.some(c => re.test(c))).length;
    if (hits >= 3) return i;
  }
  return -1;
}
export function autoMap(headerRow) {
  const cells = (headerRow || []).map(c => cleanText(c));
  const used = new Set(), map = {};
  for (const [key, , re] of FIELDS) {
    const idx = cells.findIndex((c, i) => !used.has(i) && c && re.test(c));
    if (idx >= 0) { map[key] = idx; used.add(idx); }
  }
  return map;
}

export function rowsToRecords(rows, hdr, map) {
  const get = (r, k) => (map[k] == null ? null : r[map[k]] ?? null);
  const records = [];
  let skipped = 0;
  const seen = new Set();
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = cleanText(get(r, 'name'));
    if (!name) { if (r.some(c => c != null && cleanText(c))) skipped++; continue; }
    const cl = normClinic(get(r, 'clinic'));
    const rec = {
      rowNo: i + 1,
      visit_date: parseDate(get(r, 'date')),
      name,
      national_id: cleanId(get(r, 'id')),
      phone: cleanPhone(get(r, 'phone')),
      address: cleanText(get(r, 'address')) || null,
      gender: normGender(get(r, 'gender')),
      birth_date: parseDate(get(r, 'birth')),
      case_type: normCase(get(r, 'caseType')),
      clinic: cl.clinic,
      clinicRaw: cleanText(get(r, 'clinic')),
      clinicKnown: cl.known,
      doctor: cleanText(get(r, 'doctor')) || cl.doctor || null,
      diagnosis: cleanText(get(r, 'diagnosis')) || null,
      treatment: cleanText(get(r, 'treatment')) || null,
      notes: cleanText(get(r, 'notes')) || null,
    };
    if (rec.birth_date && rec.visit_date && rec.birth_date > rec.visit_date) rec.birth_date = null;
    const key = [rec.national_id || rec.name, rec.visit_date, rec.treatment || '', rec.diagnosis || ''].join('|');
    rec.dupInFile = seen.has(key);
    seen.add(key);
    records.push(rec);
  }
  return { records, skipped };
}

// جدول المخزون: أول ترويسة «الاسم التجاري» = الشهري، والثانية = التوريدات
export function parseStock(rows) {
  const heads = [];
  rows.forEach((r, i) => { if ((r || []).some(c => cleanText(c) === 'الاسم التجاري')) heads.push(i); });
  const col = (hr, re) => (rows[hr] || []).findIndex(c => re.test(cleanText(c)));
  const drugs = new Map();
  const receipts = [];
  if (heads.length) {
    const h = heads[0], end = heads[1] ?? rows.length;
    const cn = col(h, /الاسم التجاري/), cu = col(h, /^الوحدة$/);
    for (let i = h + 1; i < end; i++) {
      const name = cleanText((rows[i] || [])[cn]);
      if (!name) continue;
      const unit = cleanText((rows[i] || [])[cu]);
      if (!drugs.has(name.toLowerCase())) drugs.set(name.toLowerCase(), { name, unit: unit || 'حبة' });
    }
  }
  if (heads.length > 1) {
    const h = heads[1];
    const cn = col(h, /الاسم التجاري/), cd = col(h, /التاريخ/), cq = col(h, /وارد/), cu = col(h, /^الوحدة$/);
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = cleanText(r[cn]);
      const qty = Number(r[cq]);
      const date = parseDate(r[cd]);
      if (!name || !(qty > 0) || !date) continue;
      const unit = cleanText(r[cu]) || 'حبة';
      receipts.push({ name, date, qty: Math.round(qty), unit });
      if (!drugs.has(name.toLowerCase())) drugs.set(name.toLowerCase(), { name, unit });
    }
  }
  return { drugs: [...drugs.values()], receipts };
}
