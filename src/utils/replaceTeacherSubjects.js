// =====================================================================
//  smartjadval — USTOZ ALMASHTIRISHNI "SINF FANLARI"GA HAM QO'LLASH
//
//  MUAMMO: `replaceTeacher.js` faqat tayyor JADVALNI (schedule) o'zgartiradi.
//  Sinf fanlari (`classSubjects`) esa eski ustozda qolib ketardi. Natijada
//  jadval qayta tuzilganda generator manba sifatida classSubjects'ni o'qib,
//  darslarni yana ESKI ustozga qaytarardi.
//
//  YECHIM: almashtirish qo'llanganda classSubjects ichidagi barcha ustoz
//  havolalari ham yangilanadi:
//
//    a.teacherId          — asosiy ustoz                  (fan: a.subjectId)
//    a.teacherId2         — 2-guruh ustozi (✂️ 2 guruh)    (fan: a.subjectId)
//    a.swapNextTeacherId  — almashinuv 2-soat, asosiy fan  (fan: a.subjectId)
//    a.swapTeacherId      — almashinuvdagi 2-fan ustozi    (fan: a.swapSubjectId)
//    a.swapNextTeacher2Id — almashinuv 2-soat, 2-fan       (fan: a.swapSubjectId)
//    a.weekAltTeacherId   — juft/toq hafta 2-fan ustozi    (fan: a.weekAltSubjectId)
//    a.pairTeacherId      — bir vaqtda 2 fan, 2-guruh      (fan: a.pairSubjectId)
//    a.levelGroups[].teacherId — daraja guruhi (hovuz)     (fan: a.subjectId)
//    a.pairExtra[].teacherId   — 3-guruh+ (bir vaqtda 3+ fan) (fan: g.subjectId)
//
//  HAR BIR HAVOLA O'Z FANIGA BOG'LANADI. Shu tufayli almashtirishni faqat
//  ayrim (sinf, fan) juftlariga qo'llash mumkin: bitta ustoz 7-A da ham
//  matematika, ham informatika o'qitsa — faqat matematikani o'tkazsa bo'ladi.
//
//  MUHIM: daraja guruhi (hovuz) bir nechta sinfga UMUMIY bo'ladi. Agar
//  faqat ayrim sinflar tanlansa, guruh sozlamalari sinflar orasida farq
//  qilib qolishi mumkin — shuning uchun natijada `levelGroupTouched`
//  qaytariladi va UI ogohlantirish ko'rsatadi.
// =====================================================================

// Oddiy maydonlar: maydon nomi → shu ustoz o'qitadigan fan qaysi maydonda
const TEACHER_FIELDS = {
  teacherId: "subjectId",
  teacherId2: "subjectId",
  swapNextTeacherId: "subjectId",
  swapTeacherId: "swapSubjectId",
  swapNextTeacher2Id: "swapSubjectId",
  weekAltTeacherId: "weekAltSubjectId",
  pairTeacherId: "pairSubjectId",
};

export function pairKey(classId, subjectId) {
  return `${classId}__${subjectId}`;
}

// `pairs` → tez tekshiruv to'plami. null/bo'sh → cheklov yo'q.
function pairSetOf(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  return new Set(pairs.map((p) => pairKey(p.classId, p.subjectId)));
}

/**
 * Bitta biriktiruv (assignment) ichida eski ustoz qaysi joylarda uchraydi.
 * Har bir joy (place) o'z fani bilan qaytadi.
 *
 * @returns {Array<{ place: string, subjectId: string }>}
 *   place — "teacherId" | "swapTeacherId" | ... | "levelGroups[2]" | "pairExtra[0]"
 */
export function findTeacherRefs(assignment, oldTeacherId) {
  const out = [];
  if (!assignment || !oldTeacherId) return out;
  for (const [field, subjField] of Object.entries(TEACHER_FIELDS)) {
    if (assignment[field] === oldTeacherId) {
      out.push({ place: field, subjectId: assignment[subjField] || assignment.subjectId || "" });
    }
  }
  if (Array.isArray(assignment.levelGroups)) {
    assignment.levelGroups.forEach((g, i) => {
      if (g?.teacherId === oldTeacherId) out.push({ place: `levelGroups[${i}]`, subjectId: assignment.subjectId || "" });
    });
  }
  if (Array.isArray(assignment.pairExtra)) {
    assignment.pairExtra.forEach((g, i) => {
      if (g?.teacherId === oldTeacherId) out.push({ place: `pairExtra[${i}]`, subjectId: g.subjectId || assignment.subjectId || "" });
    });
  }
  return out;
}

// Bitta joyga (place) yangi qiymat yozish — yangi obyekt qaytaradi
function setPlace(assignment, place, teacherId) {
  const m = /^(levelGroups|pairExtra)\[(\d+)\]$/.exec(place);
  if (!m) return { ...assignment, [place]: teacherId };
  const arr = Array.isArray(assignment[m[1]]) ? assignment[m[1]] : [];
  const idx = Number(m[2]);
  return {
    ...assignment,
    [m[1]]: arr.map((g, i) => (i === idx ? { ...g, teacherId } : g)),
  };
}

// Joydagi hozirgi qiymatni o'qish
export function readPlace(assignment, place) {
  const m = /^(levelGroups|pairExtra)\[(\d+)\]$/.exec(place);
  if (!m) return assignment?.[place];
  return assignment?.[m[1]]?.[Number(m[2])]?.teacherId;
}

// Qamrov tekshiruvi: shu sinf va fan ko'chiriladimi?
function allowed(classId, subjectId, allowClasses, allowPairs) {
  if (allowPairs) return allowPairs.has(pairKey(classId, subjectId));
  if (allowClasses) return allowClasses.has(classId);
  return true;
}

/**
 * Sinf fanlarida eski ustozni yangi ustozga almashtiradi.
 *
 * @param {Object}   params
 * @param {Object}   params.classSubjects  - joriy classSubjects (o'zgartirilmaydi)
 * @param {string}   params.oldTeacherId
 * @param {string}   params.newTeacherId
 * @param {string[]} [params.classIds]     - faqat shu sinflar (bo'sh/null → barcha)
 * @param {Array}    [params.pairs]        - faqat shu {classId, subjectId} juftlari
 *                                           (berilsa `classIds` e'tiborga olinmaydi)
 * @returns {{ classSubjects, changed, rows, levelGroupTouched }}
 *          changed — o'zgargan yozuvlar soni
 *          rows    — [{ classId, subjectId, places }] tafsilot (qaytarish uchun ham)
 */
export function applyTeacherToClassSubjects({
  classSubjects = {},
  oldTeacherId,
  newTeacherId,
  classIds = null,
  pairs = null,
}) {
  const result = { classSubjects, changed: 0, rows: [], levelGroupTouched: false };
  if (!oldTeacherId || !newTeacherId || oldTeacherId === newTeacherId) return result;

  const allowClasses = Array.isArray(classIds) && classIds.length ? new Set(classIds) : null;
  const allowPairs = pairSetOf(pairs);
  const next = {};
  let changed = 0;
  const rows = [];
  let levelGroupTouched = false;

  for (const [classId, list] of Object.entries(classSubjects || {})) {
    let listChanged = false;
    const nextList = (list || []).map((a) => {
      const refs = findTeacherRefs(a, oldTeacherId)
        .filter((r) => allowed(classId, r.subjectId, allowClasses, allowPairs));
      if (!refs.length) return a;

      let updated = a;
      refs.forEach((r) => {
        updated = setPlace(updated, r.place, newTeacherId);
        if (r.place.startsWith("levelGroups")) levelGroupTouched = true;
      });

      listChanged = true;
      changed += 1;
      rows.push({
        classId,
        subjectId: a.subjectId,
        places: refs.map((r) => r.place),
      });
      return updated;
    });

    next[classId] = listChanged ? nextList : list;
  }

  return { classSubjects: next, changed, rows, levelGroupTouched };
}

/**
 * Hech narsani o'zgartirmasdan faqat nechta yozuv tegishini sanaydi
 * (tugma matni va oldindan ko'rish uchun).
 */
export function countTeacherInClassSubjects({
  classSubjects = {},
  oldTeacherId,
  classIds = null,
  pairs = null,
}) {
  if (!oldTeacherId) return 0;
  const allowClasses = Array.isArray(classIds) && classIds.length ? new Set(classIds) : null;
  const allowPairs = pairSetOf(pairs);
  let n = 0;
  for (const [classId, list] of Object.entries(classSubjects || {})) {
    (list || []).forEach((a) => {
      const hit = findTeacherRefs(a, oldTeacherId)
        .some((r) => allowed(classId, r.subjectId, allowClasses, allowPairs));
      if (hit) n += 1;
    });
  }
  return n;
}

/**
 * Eski ustoz sinf fanlarida qaysi sinflarda uchraydi (sinf tanlash ro'yxati uchun).
 * @returns {string[]} classId lar
 */
export function classIdsWithTeacherInSubjects(classSubjects = {}, oldTeacherId) {
  return [...new Set(pairsWithTeacherInSubjects(classSubjects, oldTeacherId).map((p) => p.classId))];
}

/**
 * Eski ustoz sinf fanlarida qaysi (sinf, fan) juftlarida uchraydi —
 * sinf ichida fan tanlash uchun.
 * @returns {Array<{ classId: string, subjectId: string }>}
 */
export function pairsWithTeacherInSubjects(classSubjects = {}, oldTeacherId) {
  if (!oldTeacherId) return [];
  const seen = new Set();
  const out = [];
  for (const [classId, list] of Object.entries(classSubjects || {})) {
    (list || []).forEach((a) => {
      findTeacherRefs(a, oldTeacherId).forEach((r) => {
        if (!r.subjectId) return;
        const k = pairKey(classId, r.subjectId);
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ classId, subjectId: r.subjectId });
      });
    });
  }
  return out;
}

/**
 * Almashtirishni ORQAGA qaytarish: `rows` dagi joylarda hozir `newTeacherId`
 * turgan bo'lsa — `oldTeacherId` ga qaytariladi. Boshqa qiymat turgan bo'lsa
 * (foydalanuvchi oraliqda qo'lda o'zgartirgan) — tegilmaydi.
 *
 * @returns {{ classSubjects, reverted, skipped }}
 */
export function revertTeacherInClassSubjects({
  classSubjects = {},
  rows = [],
  oldTeacherId,
  newTeacherId,
}) {
  const result = { classSubjects, reverted: 0, skipped: 0 };
  if (!oldTeacherId || !newTeacherId || !Array.isArray(rows) || !rows.length) return result;

  const next = { ...(classSubjects || {}) };
  let reverted = 0;
  let skipped = 0;

  rows.forEach((row) => {
    const list = next[row.classId];
    if (!Array.isArray(list)) { skipped += 1; return; }
    const idx = list.findIndex((a) => a?.subjectId === row.subjectId);
    if (idx < 0) { skipped += 1; return; }
    let a = list[idx];
    let touched = false;
    (row.places || []).forEach((place) => {
      if (readPlace(a, place) === newTeacherId) {
        a = setPlace(a, place, oldTeacherId);
        touched = true;
      } else {
        skipped += 1;
      }
    });
    if (touched) {
      next[row.classId] = list.map((x, i) => (i === idx ? a : x));
      reverted += 1;
    }
  });

  return { classSubjects: next, reverted, skipped };
}
