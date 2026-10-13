// دوال تنظيف وتوحيد البيانات (بدون اعتماد على المتصفح)
const AR = '٠١٢٣٤٥٦٧٨٩', FA = '۰۱۲۳۴۵۶۷۸۹';
export const digits = s => String(s ?? '').replace(/[٠-٩]/g, d => AR.indexOf(d)).replace(/[۰-۹]/g, d => FA.indexOf(d));
export const cleanText = s => String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
export const arNorm = s => cleanText(digits(s)).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي');

export function cleanId(s) {
  const t = digits(cleanText(s)).replace(/\D/g, '');
  return t.length >= 6 ? t : null;
}
export function cleanPhone(s) {
  let t = digits(cleanText(s)).replace(/\D/g, '');
  if (!t) return null;
  if (t.length === 9 && t[0] === '5') t = '0' + t;
  return t;
}

const iso = (y, m, d) => {
  if (y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') {
    if (v < 1000 || v > 80000) return null;
    const d = new Date(Math.round((v - 25569) * 86400000));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = digits(cleanText(v));
  let m;
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/))) return iso(+m[3], +m[2], +m[1]);
  return null;
}
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// توحيد أسماء العيادات المكتوبة بصيغ مختلفة
export function normClinic(raw) {
  const t = cleanText(raw).replace(/[أإآ]/g, 'ا').replace(/[ىی]/g, 'ي').replace(/ک/g, 'ك').replace(/[\s.+]/g, '');
  if (!t) return { clinic: null, doctor: null, known: false, empty: true };
  if (t.includes('نساء')) {
    const doctor = t.includes('اياد') ? 'د. إياد' : (t.includes('محمد') || t.includes('ممحمد')) ? 'د. محمد' : null;
    return { clinic: 'نساء وولادة', doctor, known: true };
  }
  const rules = [['اطف', 'أطفال'], ['عظ', 'عظام'], ['مسال', 'مسالك'], ['نفس', 'نفسي'], ['تمر', 'تمريض'], ['عام', 'عام']];
  for (const [k, name] of rules) if (t.includes(k)) return { clinic: name, doctor: null, known: true };
  return { clinic: null, doctor: null, known: false };
}
export function normGender(v) {
  const t = cleanText(v);
  if (/ذكر/.test(t)) return 'ذكر';
  if (/انث|أنث/.test(t)) return 'أنثى';
  return null;
}
export function normCase(v) {
  const t = cleanText(v);
  return t.includes('جديد') ? 'جديد' : t.includes('مراجع') ? 'مراجع' : null;
}

// العمر
export function ageParts(birth, on) {
  if (!birth || !on) return null;
  const [by, bm, bd] = birth.split('-').map(Number), [y, m, d] = on.split('-').map(Number);
  let yrs = y - by, mon = m - bm;
  if (d < bd) mon--;
  if (mon < 0) { yrs--; mon += 12; }
  return yrs < 0 ? null : { y: yrs, m: mon };
}
export function ageText(birth, on = todayISO()) {
  const a = ageParts(birth, on);
  if (!a) return '—';
  return a.y < 1 ? `${a.m} شهر` : `${a.y} سنة`;
}
export const AGE_GROUPS = ['أقل من 5 سنوات', '5–17 سنة', '18–59 سنة', '60 سنة فأكثر', 'غير معروف'];
export function ageGroup(birth, on) {
  const a = ageParts(birth, on);
  if (!a) return 'غير معروف';
  return a.y < 5 ? AGE_GROUPS[0] : a.y < 18 ? AGE_GROUPS[1] : a.y < 60 ? AGE_GROUPS[2] : AGE_GROUPS[3];
}

// حدود الفترة: يوم / أسبوع (من الأحد إلى السبت) / شهر
export function periodRange(type, d) {
  const [y, m, da] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, da));
  const f = x => x.toISOString().slice(0, 10);
  if (type === 'day') return [d, d];
  if (type === 'week') {
    const s = new Date(dt); s.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
    const e = new Date(s); e.setUTCDate(s.getUTCDate() + 6);
    return [f(s), f(e)];
  }
  return [f(new Date(Date.UTC(y, m - 1, 1))), f(new Date(Date.UTC(y, m, 0)))];
}
