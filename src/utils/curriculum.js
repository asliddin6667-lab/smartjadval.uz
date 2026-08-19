// =====================================================================
//  TAYANCH O'QUV REJA — standart haftalik soatlar
//
//  Bu fayl ikki joyda ishlatiladi:
//    1) Sinf fanlari sahifasidagi "⚡ Standart soatlar" tugmasi;
//    2) Superadminning "Standart soatlar" sahifasi (tahrirlash).
//
//  Superadmin Supabase'dagi standard_hours jadvalini to'ldirsa — o'sha
//  ma'lumot ustunlik qiladi; jadval bo'sh yoki ochilmasa, quyidagi
//  ichki (default) reja ishlatiladi.
// =====================================================================

/* ===================================================================
   2025-2026 o'quv yili TAYANCH O'QUV REJA (o'zbek tilidagi maktablar)
   Maktabgacha va maktab ta'limi vaziri 2025-yil 10-apreldagi
   121-son buyrug'iga 1-ILOVA.
   h = { sinf: haftalik soat }.  Kasr soatlar (1,5 / 0,5) generator uchun
   butun songa yaxlitlanadi (Math.round) — quyidagi curriculumHours() ga qarang.
=================================================================== */
export const CURRICULUM_UZ = [
  // I. Filologiya fanlari
  { name: "Ona tili", aliases: ["ona tili"], h: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 3, 8: 3, 9: 3, 10: 2, 11: 2 } },
  { name: "O'qish savodxonligi", aliases: ["o'qish savodxonligi", "alifbe", "o'qish"], h: { 1: 4, 2: 3, 3: 3, 4: 3 } },
  { name: "Adabiyot", aliases: ["adabiyot"], h: { 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Rus tili", aliases: ["rus tili"], h: { 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Chet tili", aliases: ["chet tili", "ingliz tili", "nemis tili", "fransuz tili", "xorijiy til"], h: { 1: 1, 2: 2, 3: 2, 4: 2, 5: 4, 6: 4, 7: 4, 8: 3, 9: 3, 10: 2, 11: 2 } },

  // II. Ijtimoiy fanlar
  { name: "Tarixdan hikoyalar", aliases: ["tarixdan hikoyalar"], h: { 5: 2 } },
  { name: "Qadimgi dunyo tarixi", aliases: ["qadimgi dunyo tarixi"], h: { 6: 2 } },
  { name: "O'zbekiston tarixi", aliases: ["o'zbekiston tarixi"], h: { 7: 2, 8: 2, 9: 2, 10: 1, 11: 1 } },
  { name: "Jahon tarixi", aliases: ["jahon tarixi"], h: { 7: 1, 8: 1, 9: 1, 10: 1, 11: 1 } },
  { name: "Davlat va huquq asoslari", aliases: ["davlat va huquq asoslari", "huquq asoslari"], h: { 8: 1, 9: 1, 10: 1, 11: 1 } },
  { name: "Tarbiya", aliases: ["tarbiya"], h: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1 } },

  // III. Aniq fanlar
  { name: "Matematika", aliases: ["matematika"], h: { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5 } },
  { name: "Algebra", aliases: ["algebra"], h: { 8: 3, 9: 3, 10: 3, 11: 3 } },
  { name: "Geometriya", aliases: ["geometriya"], h: { 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Informatika va axborot texnologiyalari", aliases: ["informatika va axborot texnologiyalari", "informatika", "informatika va at", "axborot texnologiyalari"], h: { 1: 1, 2: 1, 3: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 2, 10: 2, 11: 2 } },

  // IV. Tabiiy va iqtisodiy fanlar
  { name: "Fizika", aliases: ["fizika"], h: { 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Astronomiya", aliases: ["astronomiya", "astranomiya"], h: { 11: 1 } },
  { name: "Kimyo", aliases: ["kimyo"], h: { 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Biologiya", aliases: ["biologiya"], h: { 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Geografiya", aliases: ["geografiya"], h: { 7: 2, 8: 1.5, 9: 1.5, 10: 2 } },
  { name: "Iqtisodiy bilim asoslari", aliases: ["iqtisodiy bilim asoslari", "iqtisodiyot asoslari"], h: { 8: 0.5, 9: 0.5 } },
  { name: "Tadbirkorlik asoslari", aliases: ["tadbirkorlik asoslari"], h: { 11: 1 } },
  { name: "Tabiiy fanlar", aliases: ["tabiiy fanlar", "tabiiy fanlar science", "science", "tabiatshunoslik"], h: { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 3 } },

  // V. Amaliy fanlar
  { name: "Musiqa madaniyati", aliases: ["musiqa madaniyati", "musiqa"], h: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 } },
  { name: "Tasviriy san'at", aliases: ["tasviriy san'at", "tasviriy sanat"], h: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 } },
  { name: "Chizmachilik", aliases: ["chizmachilik"], h: { 8: 1, 9: 1 } },
  { name: "Texnologiya", aliases: ["texnologiya", "mehnat", "mehnat ta'limi", "texnologiya ta'limi"], h: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1 } },
  { name: "Jismoniy tarbiya", aliases: ["jismoniy tarbiya", "jismoniy madaniyat"], h: { 1: 1, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Chaqiruvga qadar boshlang'ich tayyorgarlik", aliases: ["chaqiruvga qadar boshlang'ich tayyorgarlik", "chqbt", "chaqiruvgacha boshlang'ich tayyorgarlik"], h: { 10: 2, 11: 2 } },
];

// Fan nomlarini solishtirish uchun: apostroflar, katta-kichik harf,
// ortiqcha bo'shliq va qavslar hisobga olinmaydi.
export function normName(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BB\u02BC\u0060\u00B4`']/g, "'")
    .replace(/[()[\].,:;!?"«»\-–—_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


// Standart holat: o'zbek maktablari uchun to'ldirilgan, rus maktablari
// uchun bo'sh (superadmin to'ldirmaguncha eski usul ishlaydi).
export const DEFAULT_CURRICULUM = { uz: CURRICULUM_UZ, ru: [] };

export const CURRICULUM_LANGS = [
  { key: "uz", label: "O'zbek sinflari" },
  { key: "ru", label: "Rus sinflari" },
];

export const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// Tashqaridan kelgan (Supabase / localStorage) ma'lumotni xavfsiz shaklga keltiradi
export function normalizeCurriculum(raw) {
  const out = { uz: [], ru: [] };
  if (!raw || typeof raw !== "object") return null;
  let any = false;
  ["uz", "ru"].forEach((lang) => {
    const rows = Array.isArray(raw[lang]) ? raw[lang] : [];
    out[lang] = rows
      .map((r) => {
        const name = String(r?.name || "").trim();
        if (!name) return null;
        const h = {};
        Object.entries(r?.h || {}).forEach(([g, v]) => {
          const grade = Number(g);
          const hours = Number(v);
          if (grade >= 1 && grade <= 11 && hours > 0) h[grade] = hours;
        });
        const aliases = Array.isArray(r?.aliases)
          ? r.aliases.map((a) => String(a).trim()).filter(Boolean)
          : [];
        return { name, aliases, h };
      })
      .filter(Boolean);
    if (out[lang].length) any = true;
  });
  return any ? out : null;
}

// Fan nomi (va uning muqobil nomlari) -> reja qatori
export function buildCurriculumIndex(rows) {
  const m = new Map();
  (rows || []).forEach((row) => {
    [row.name, ...(row.aliases || [])].forEach((alias) => {
      const k = normName(alias);
      if (k && !m.has(k)) m.set(k, row);
    });
  });
  return m;
}

// Shu sinf uchun rejadagi soat. Fan bu sinfda o'qitilmasa — null.
// Kasr soatlar (1,5 / 0,5) butun songa yaxlitlanadi.
export function hoursFromRow(row, grade) {
  if (!row) return null;
  const h = row.h?.[grade];
  if (h === undefined) return null;
  return Math.max(1, Math.round(h));
}

// Rejada shu sinfga tegishli fanlar ro'yxati (nomlari bilan)
export function namesForGrade(rows, grade) {
  return (rows || []).filter((r) => r.h?.[grade] !== undefined).map((r) => r.name);
}
