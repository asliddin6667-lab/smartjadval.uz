// =====================================================================
//  DARS SOAT SETKASI — EXCEL EKSPORT (maktab foydalanuvchisi uchun)
//
//  Tuman admin panelidagi "Soat setkasi" varag'i bilan AYNAN BIR XIL
//  ko'rinishda chiqadi (yashil banner, zebra qatorlar, ramkalar,
//  "Jami" ustuni va "JAMI" qatori).
//
//  Farqi: ma'lumot Excel yuklamadan emas, foydalanuvchining o'z
//  "Sinf fanlari" (classSubjects) sozlamasidan olinadi.
//
//  YANGILANDI: sarlavhadagi maktab nomi endi SOZLAMALAR bo'limidagi
//  "Maktab nomi" (settings.schoolName) dan olinadi — akkaunt nomidan
//  ("1-maktab") emas. Fayl nomi ham shu nomdan yasaladi.
//
//  Chaqirilishi: ImportExport.jsx → exportHourGridExcel({...})
// =====================================================================

import { loadStyledXLSX } from './excelUtils';

// ---------------------------------------------------------------------
//  Umumiy stil sozlamalari (districtExcel.jsx bilan bir xil)
// ---------------------------------------------------------------------
const TEAL = { accent: '0D9488', dark: '0F766E', zebra: 'E6FBF5' };
const XL_BORDER = 'C3C9D5';
const XL_TEXT = '1F2937';

const xlFill = (rgb) => ({ patternType: 'solid', fgColor: { rgb } });
const xlBorder = (rgb = XL_BORDER) => ({
  top: { style: 'thin', color: { rgb } },
  bottom: { style: 'thin', color: { rgb } },
  left: { style: 'thin', color: { rgb } },
  right: { style: 'thin', color: { rgb } },
});

function todayStr() {
  return new Date().toLocaleDateString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function safeFileDate() {
  return new Date().toISOString().slice(0, 10);
}

function natCmp(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'uz', { numeric: true, sensitivity: 'base' });
}

// =====================================================================
//  MAKTAB NOMINI ANIQLASH
//
//  Tartib (birinchi topilgani ishlatiladi):
//    1) settings.schoolName — to'g'ridan-to'g'ri prop orqali kelsa
//    2) localStorage dagi sozlamalar obyektidan (Sozlamalar sahifasi)
//    3) schoolName propi (akkaunt nomi — zaxira variant)
//    4) foydalanuvchi obyektidan (eng oxirgi chora)
//    5) "Maktab"
// =====================================================================
const SETTINGS_KEYS = [
  'edu-settings', 'edu_settings', 'eduSettings',
  'sj-settings', 'smartjadval-settings', 'edujadval-settings',
  'app-settings', 'settings', 'edu-sozlamalar', 'sozlamalar',
];

const USER_KEYS = [
  'edu-current-user', 'currentUser', 'edu-user', 'edu-auth-user',
  'sj-current-user', 'edu-session', 'user',
];

function readObj(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const t = raw.trim();
    if (t[0] !== '{') return null;
    const o = JSON.parse(t);
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
  } catch {
    return null;
  }
}

function pickSettingsName(o) {
  if (!o) return '';
  const n = o.schoolName ?? o.school_name ?? o.maktabNomi ?? '';
  return String(n).trim();
}

function looksLikeSettings(o) {
  if (!o) return false;
  return ('academicYear' in o) || ('academic_year' in o) || ('oquvYili' in o)
    || ('lessonDuration' in o) || ('directorName' in o) || ('theme' in o);
}

// Sozlamalar obyektidagi maktab nomini localStorage dan qidiramiz
function detectSettingsName() {
  try {
    if (typeof localStorage === 'undefined') return '';

    // 1) Ma'lum kalitlar
    for (const k of SETTINGS_KEYS) {
      const n = pickSettingsName(readObj(k));
      if (n) return n;
    }

    // 2) Nomida "setting/sozlama/config" bo'lgan kalitlar
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (!/setting|sozlama|config/i.test(k)) continue;
      const n = pickSettingsName(readObj(k));
      if (n) return n;
    }

    // 3) Sozlamalarga o'xshash har qanday obyekt (o'quv yili, dars davomiyligi...)
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      const o = readObj(k);
      if (!looksLikeSettings(o)) continue;
      const n = pickSettingsName(o);
      if (n) return n;
    }
  } catch {
    /* jim o'tamiz */
  }
  return '';
}

function pickUserName(o) {
  if (!o || typeof o !== 'object') return '';
  return String(
    o.schoolName || o.school_name || o.school?.name ||
    o.name || o.fullName || o.username || ''
  ).trim();
}

function detectUserName() {
  try {
    if (typeof localStorage === 'undefined') return '';
    for (const k of USER_KEYS) {
      const n = pickUserName(readObj(k));
      if (n) return n;
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (!/user|auth|profil/i.test(k)) continue;
      const n = pickUserName(readObj(k));
      if (n) return n;
    }
  } catch {
    /* jim o'tamiz */
  }
  return '';
}

export function resolveSchoolName({ settings, schoolName } = {}) {
  const fromProp = pickSettingsName(settings);
  if (fromProp) return fromProp;

  const fromStore = detectSettingsName();
  if (fromStore) return fromStore;

  const fallback = String(schoolName || '').trim();
  if (fallback) return fallback;

  return detectUserName() || 'Maktab';
}

// ---------------------------------------------------------------------
//  Stilli varaq yasash (districtExcel.jsx dagi makeStyledSheet nusxasi)
//
//    0-qator: TITLE     (katta oq matn, yashil banner, merge)
//    1-qator: subtitle  (kichik matn, o'sha banner, merge)
//    2-qator: bo'sh ajratuvchi
//    3-qator: ustun sarlavhalari (oq qalin, to'q yashil fon)
//    4+     : ma'lumot (zebra qatorlar, ramkalar)
//    oxiri  : JAMI qatori (to'q fon, oq qalin)
// ---------------------------------------------------------------------
function makeStyledSheet(XLSX, {
  title, subtitle, header, body,
  widths = [], align = [],
  boldCols = [], totalLast = false,
}) {
  const th = TEAL;
  const nCols = header.length;
  const aoa = [[title], [subtitle], [], header, ...body];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws['!cols'] = header.map((_, i) => ({ wch: widths[i] || 12 }));
  if (nCols > 1) {
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: nCols - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: nCols - 1 } },
    ];
  }
  ws['!rows'] = [
    { hpt: 40 }, { hpt: 17 }, { hpt: 6 }, { hpt: 26 },
    ...body.map(() => ({ hpt: 20 })),
  ];

  const lastRow = 3 + body.length;
  const totalRowIdx = totalLast ? lastRow : -1;

  for (let R = 0; R <= lastRow; R++) {
    for (let C = 0; C < nCols; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) ws[addr] = { v: '', t: 's' };
      const cell = ws[addr];

      if (R === 0) {
        cell.s = {
          font: { name: 'Calibri', sz: 18, bold: true, color: { rgb: 'FFFFFF' } },
          fill: xlFill(th.accent),
          alignment: { horizontal: 'center', vertical: 'center' },
        };
      } else if (R === 1) {
        cell.s = {
          font: { name: 'Calibri', sz: 10, color: { rgb: 'EDEBFF' } },
          fill: xlFill(th.accent),
          alignment: { horizontal: 'center', vertical: 'center' },
        };
      } else if (R === 2) {
        // bo'sh ajratuvchi qator — stilsiz
      } else if (R === 3) {
        cell.s = {
          font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
          fill: xlFill(th.dark),
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: xlBorder(th.dark),
        };
      } else if (R === totalRowIdx) {
        cell.s = {
          font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
          fill: xlFill(th.dark),
          alignment: {
            horizontal: align[C] === 'left' ? 'left' : 'center',
            vertical: 'center',
          },
          border: xlBorder(th.dark),
        };
      } else {
        const s = {
          font: { name: 'Calibri', sz: 10.5, color: { rgb: XL_TEXT } },
          alignment: { horizontal: align[C] || 'center', vertical: 'center' },
          border: xlBorder(),
        };
        if ((R - 4) % 2 === 1) s.fill = xlFill(th.zebra);
        if (boldCols.includes(C)) s.font = { ...s.font, bold: true };
        cell.s = s;
      }
    }
  }

  return ws;
}

// =====================================================================
//  SETKA MA'LUMOTINI QURISH
//
//  Sinf fanlari (classSubjects) sozlamasidan fan × sinf matritsasi.
//  Almashinuvchi (juft/toq) fan yoqilgan bo'lsa, ikkala fan ham
//  o'z soati bilan hisobga olinadi — tuman admin varag'idagi kabi.
// =====================================================================
export function buildHourGrid({ classes = [], subjects = [], classSubjects = {} }) {
  const subjName = new Map(subjects.map((s) => [s.id, s.name]));

  const classNames = classes
    .map((c) => c.name)
    .filter(Boolean)
    .sort(natCmp);

  const bySubject = new Map(); // fan nomi -> { subject, hours: { sinf: soat } }

  for (const c of classes) {
    if (!c?.name) continue;
    const list = Array.isArray(classSubjects[c.id]) ? classSubjects[c.id] : [];
    for (const a of list) {
      const h = Number(a?.weeklyHours || 0);
      if (!h) continue;
      const add = (sid) => {
        const nm = subjName.get(sid);
        if (!nm) return;
        if (!bySubject.has(nm)) bySubject.set(nm, { subject: nm, hours: {} });
        const row = bySubject.get(nm);
        row.hours[c.name] = (row.hours[c.name] || 0) + h;
      };
      add(a.subjectId);
      if (a.swapEnabled && a.swapSubjectId) add(a.swapSubjectId);
    }
  }

  const rows = [...bySubject.values()].sort((a, b) => natCmp(a.subject, b.subject));
  return { rows, classes: classNames };
}

// =====================================================================
//  EKSPORT
// =====================================================================
export async function exportHourGridExcel({
  classes = [],
  subjects = [],
  classSubjects = {},
  settings = null,
  schoolName = '',
  toast,
}) {
  try {
    if (!classes.length) {
      toast?.("Avval sinf qo'shing", 'warning');
      return;
    }

    const grid = buildHourGrid({ classes, subjects, classSubjects });
    if (!grid.rows.length) {
      toast?.("Sinf fanlari topilmadi — avval «Sinf fanlari» bo'limini to'ldiring", 'warning');
      return;
    }

    const XLSX = await loadStyledXLSX();
    const name = resolveSchoolName({ settings, schoolName });
    const stamp = `smartjadval · Soat setkasi · ${todayStr()}`;

    const cls = grid.classes;
    const colTotal = {};
    let grand = 0;

    const body = grid.rows.map((r) => {
      let rowSum = 0;
      const cells = cls.map((c) => {
        const h = r.hours[c] || 0;
        rowSum += h;
        colTotal[c] = (colTotal[c] || 0) + h;
        grand += h;
        return h || '';
      });
      return [r.subject, ...cells, rowSum];
    });
    body.push(['JAMI', ...cls.map((c) => colTotal[c] || ''), grand]);

    const ws = makeStyledSheet(XLSX, {
      title: `🕐 ${name} — SINF-FAN SOATLARI`,
      subtitle: stamp,
      header: ['Fan', ...cls, 'Jami'],
      body,
      widths: [24, ...cls.map(() => 7), 8],
      align: ['left', ...cls.map(() => 'center'), 'center'],
      boldCols: [0, cls.length + 1],
      totalLast: true,
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Soat setkasi');

    const safe = name.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || 'maktab';
    XLSX.writeFile(wb, `${safe}_soat_setkasi_${safeFileDate()}.xlsx`);
    toast?.('Dars soat setkasi Excelga yuklandi ✓', 'success');
  } catch (e) {
    toast?.(e.message || 'Excel eksportda xatolik', 'error');
  }
}