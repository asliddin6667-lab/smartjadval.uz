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
const UZ_ROWS = [
  // I. Filologiya fanlari
  { name: "Ona tili", aliases: ["ona tili"], h: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 3, 8: 3, 9: 3, 10: 2, 11: 2 } },
  { name: "O'qish savodxonligi", aliases: ["o'qish savodxonligi", "alifbe", "o'qish", "ona tili va o'qish savodxonligi"], h: { 1: 4, 2: 3, 3: 3, 4: 3 } },
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

/* ===================================================================
   SHU REJANING RUS SINFLARI UCHUN NUSXASI

   Soatlar O'ZBEK SINFLARI BILAN AYNAN BIR XIL — har qatorning `h` i
   yuqoridagi CURRICULUM_UZ dagi mos qatordan ko'chirilgan. Farq faqat
   fan NOMIDA: rus sinfida fanlar ruscha nomlanadi.

   Ikki qatorda til roli almashadi (rus maktabidagi odatiy holat):
     - "Ona tili"  -> "Русский язык"   (sinfning o'z tili)
     - "Rus tili"  -> "Узбекский язык" (ikkinchi davlat tili)
   Qolgan hamma fan — oddiy tarjima.

   ⚠️ QATOR TARTIBI O'ZBEK RO'YXATI BILAN BIR XIL BO'LISHI SHART —
   soat shu tartib bo'yicha bog'lanadi (pastdagi CURRICULUM_RU ga
   qarang). Bu yerdagi `h` faqat ZAXIRA; haqiqiy soat o'zbek qatoridan
   olinadi, shuning uchun uni qo'lda yangilash kerak emas.
=================================================================== */
const RU_ROWS = [
  // I. Filologiya fanlari
  { name: "Русский язык", aliases: ["русский язык", "русский язык и грамотность чтения", "родной язык"], h: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 3, 8: 3, 9: 3, 10: 2, 11: 2 } },
  { name: "Грамотность чтения", aliases: ["грамотность чтения", "азбука", "букварь", "чтение", "литературное чтение", "выразительное чтение"], h: { 1: 4, 2: 3, 3: 3, 4: 3 } },
  { name: "Литература", aliases: ["литература"], h: { 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Узбекский язык", aliases: ["узбекский язык", "государственный язык"], h: { 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Иностранный язык", aliases: ["иностранный язык", "английский язык", "немецкий язык", "французский язык"], h: { 1: 1, 2: 2, 3: 2, 4: 2, 5: 4, 6: 4, 7: 4, 8: 3, 9: 3, 10: 2, 11: 2 } },

  // II. Ijtimoiy fanlar
  { name: "Рассказы по истории", aliases: ["рассказы по истории"], h: { 5: 2 } },
  { name: "История древнего мира", aliases: ["история древнего мира"], h: { 6: 2 } },
  { name: "История Узбекистана", aliases: ["история узбекистана"], h: { 7: 2, 8: 2, 9: 2, 10: 1, 11: 1 } },
  { name: "Всемирная история", aliases: ["всемирная история"], h: { 7: 1, 8: 1, 9: 1, 10: 1, 11: 1 } },
  { name: "Основы государства и права", aliases: ["основы государства и права", "основы права"], h: { 8: 1, 9: 1, 10: 1, 11: 1 } },
  { name: "Воспитание", aliases: ["воспитание"], h: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1 } },

  // III. Aniq fanlar
  { name: "Математика", aliases: ["математика"], h: { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5 } },
  { name: "Алгебра", aliases: ["алгебра"], h: { 8: 3, 9: 3, 10: 3, 11: 3 } },
  { name: "Геометрия", aliases: ["геометрия"], h: { 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Информатика и информационные технологии", aliases: ["информатика и информационные технологии", "информатика", "информационные технологии", "информатика и ит"], h: { 1: 1, 2: 1, 3: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 2, 10: 2, 11: 2 } },

  // IV. Tabiiy va iqtisodiy fanlar
  { name: "Физика", aliases: ["физика"], h: { 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Астрономия", aliases: ["астрономия"], h: { 11: 1 } },
  { name: "Химия", aliases: ["химия"], h: { 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Биология", aliases: ["биология"], h: { 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "География", aliases: ["география"], h: { 7: 2, 8: 1.5, 9: 1.5, 10: 2 } },
  { name: "Основы экономических знаний", aliases: ["основы экономических знаний", "основы экономики"], h: { 8: 0.5, 9: 0.5 } },
  { name: "Основы предпринимательства", aliases: ["основы предпринимательства"], h: { 11: 1 } },
  { name: "Естествознание", aliases: ["естествознание", "естествознание science", "science", "природоведение", "естественные науки"], h: { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 3 } },

  // V. Amaliy fanlar
  { name: "Музыкальная культура", aliases: ["музыкальная культура", "музыка"], h: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 } },
  { name: "Изобразительное искусство", aliases: ["изобразительное искусство", "изо"], h: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 } },
  { name: "Черчение", aliases: ["черчение"], h: { 8: 1, 9: 1 } },
  { name: "Технология", aliases: ["технология", "труд", "трудовое обучение"], h: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1 } },
  { name: "Физическая культура", aliases: ["физическая культура", "физкультура", "физическое воспитание"], h: { 1: 1, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Начальная допризывная подготовка", aliases: ["начальная допризывная подготовка", "ндп", "допризывная подготовка"], h: { 10: 2, 11: 2 } },
];

/* ===================================================================
   IKKI TIL — BITTA SOAT MANBAI

   ⚠️ SOAT FAQAT O'ZBEK JADVALIDAN OLINADI. Ilgari `h` ikkala ro'yxatda
   QO'LDA takrorlanardi va «o'zgartirsangiz ikkinchisini ham o'zgartiring»
   degan izohga tayanardi — jonli maktabda ular ajralib ketdi: 3-B (rus)
   14 soat, 3-V (o'zbek) 25 soat bo'lib qoldi. Endi rus qatori o'zbek
   qatoridan AYNI `h` obyektini oladi, ya'ni ajralishi MUMKIN EMAS.
   RU_ROWS dagi `h` faqat zaxira (juftlik topilmasa).

   `key` — ikki tildagi qatorni bog'lovchi barqaror kalit (o'zbekcha nom).
   U nom bo'yicha KESIShGAN qidiruv uchun kerak: «Букварь» deb nomlangan
   fan o'zbek sinfida ham «O'qish savodxonligi» qatorini topsin.
=================================================================== */
export const CURRICULUM_UZ = UZ_ROWS.map((r) => ({ ...r, key: r.name }));

export const CURRICULUM_RU = RU_ROWS.map((r, i) => ({
  name: r.name,
  aliases: r.aliases,
  key: UZ_ROWS[i]?.name || r.name,
  h: UZ_ROWS[i]?.h || r.h,
}));

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


// Standart holat: IKKALA til ham to'ldirilgan — soatlar bir xil,
// rus sinflarida fanlar ruscha nomlanadi.
export const DEFAULT_CURRICULUM = { uz: CURRICULUM_UZ, ru: CURRICULUM_RU };

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
        // `key` — ikki tildagi qatorni bog'lovchi kalit. Saqlangan
        // yozuvda bo'lmasa juftlik tartib bo'yicha topiladi.
        const key = String(r?.key || "").trim();
        return key ? { name, aliases, h, key } : { name, aliases, h };
      })
      .filter(Boolean);
    if (out[lang].length) any = true;
  });
  return any ? out : null;
}

/* Bo'sh qolgan tilni ichki reja bilan to'ldiradi.
   NIMA UCHUN KERAK: bulutdagi `standard_hours` qatori superadmin
   tomonidan `{ uz: [...], ru: [] }` ko'rinishida saqlangan bo'lishi
   mumkin (rus rejasi ilgari umuman yo'q edi). Bunday yozuv
   `normalizeCurriculum` dan o'tadi va ichki rejani BOSIB YUBORARDI —
   natijada rus sinflari baribir zaxira usulga tushib, soatni fanning
   umumiy `weeklyHours` idan olardi.
   Faqat O'QISH yo'lida qo'llanadi; saqlashda ishlatilmaydi, aks holda
   superadmin yozmagan ma'lumot jimgina bazaga tushib qolardi. */
export function withCurriculumDefaults(c) {
  const out = { uz: [], ru: [] };
  ["uz", "ru"].forEach((lang) => {
    const rows = Array.isArray(c?.[lang]) ? c[lang] : [];
    out[lang] = rows.length ? rows : DEFAULT_CURRICULUM[lang];
  });
  return out;
}

// Ikki tildagi ro'yxatni qator-qator bog'laydi: `key` bo'lsa o'sha
// bo'yicha, bo'lmasa (bulutdagi eski yozuv) tartib bo'yicha.
function pairRows(rows, other) {
  const juft = new Map();
  const kalitli = new Map();
  (rows || []).forEach((r) => { if (r?.key) kalitli.set(r.key, r); });
  (other || []).forEach((o, i) => {
    const mos = (o?.key && kalitli.get(o.key)) || rows?.[i] || null;
    if (mos) juft.set(o, mos);
  });
  return juft;
}

/* Fan nomi (va uning muqobil nomlari) -> reja qatori.

   ⚠️ NOM IKKALA TILDA HAM QIDIRILADI. Maktabning fanlar ro'yxati
   aralash bo'lishi odatiy hol: eMaktabdan import qilingan fanlar
   ruscha nomlangan («Букварь», «Изо», «Естественные науки»), qo'lda
   kiritilganlari — o'zbekcha. Ilgari indeks faqat O'Z tilidagi
   nomlarni bilardi va aralash ro'yxatda rejaning yarmi tushmay
   qolardi: jonli maktabda 3-B (rus) 8 fan / 14 soat, 3-V (o'zbek)
   esa 13 fan / 25 soat chiqdi.

   Endi boshqa tildagi nom ham SHU tildagi qatorga olib boradi, ya'ni
   fan qaysi tilda nomlangan bo'lsa ham rejadagi o'z soatini oladi.
   O'z tilidagi nom USTUN — avval u yoziladi. */
export function buildCurriculumIndex(rows, other) {
  const m = new Map();
  const yoz = (alias, row) => {
    const k = normName(alias);
    if (k && !m.has(k)) m.set(k, row);
  };
  (rows || []).forEach((row) => {
    [row.name, ...(row.aliases || [])].forEach((a) => yoz(a, row));
  });
  const juft = pairRows(rows, other);
  (other || []).forEach((o) => {
    const mos = juft.get(o);
    if (!mos) return;
    [o.name, ...(o.aliases || [])].forEach((a) => yoz(a, mos));
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
