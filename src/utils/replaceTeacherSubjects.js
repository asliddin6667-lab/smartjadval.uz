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
//    a.teacherId          — asosiy ustoz
//    a.teacherId2         — 2-guruh ustozi (✂️ 2 guruhga bo'lish)
//    a.swapTeacherId      — almashinuvdagi 2-fan ustozi
//    a.weekAltTeacherId   — hafta almashinuvi (juft/toq) 2-fan ustozi
//    a.levelGroups[].teacherId — daraja guruhi (hovuz) ustozlari
//
//  MUHIM: daraja guruhi (hovuz) bir nechta sinfga UMUMIY bo'ladi. Agar
//  faqat ayrim sinflar tanlansa, guruh sozlamalari sinflar orasida farq
//  qilib qolishi mumkin — shuning uchun natijada `levelGroupTouched`
//  qaytariladi va UI ogohlantirish ko'rsatadi.
// =====================================================================

const TEACHER_FIELDS = ["teacherId", "teacherId2", "swapTeacherId", "weekAltTeacherId"];

/**
 * Bitta biriktiruv (assignment) ichida eski ustoz nechta joyda uchraydi.
 * @returns {{ fields: string[], groupIndexes: number[] }}
 */
function findTeacherRefs(assignment, oldTeacherId) {
  const fields = TEACHER_FIELDS.filter((f) => assignment?.[f] === oldTeacherId);
  const groupIndexes = [];
  if (Array.isArray(assignment?.levelGroups)) {
    assignment.levelGroups.forEach((g, i) => {
      if (g?.teacherId === oldTeacherId) groupIndexes.push(i);
    });
  }
  return { fields, groupIndexes };
}

/**
 * Sinf fanlarida eski ustozni yangi ustozga almashtiradi.
 *
 * @param {Object}   params
 * @param {Object}   params.classSubjects  - joriy classSubjects (o'zgartirilmaydi)
 * @param {string}   params.oldTeacherId
 * @param {string}   params.newTeacherId
 * @param {string[]} [params.classIds]     - faqat shu sinflar (bo'sh/null → barcha sinflar)
 * @returns {{ classSubjects, changed, rows, levelGroupTouched }}
 *          changed — o'zgargan yozuvlar soni
 *          rows    — [{ classId, subjectId, places }] tafsilot (oldindan ko'rish uchun)
 */
export function applyTeacherToClassSubjects({
  classSubjects = {},
  oldTeacherId,
  newTeacherId,
  classIds = null,
}) {
  const result = { classSubjects, changed: 0, rows: [], levelGroupTouched: false };
  if (!oldTeacherId || !newTeacherId || oldTeacherId === newTeacherId) return result;

  const allow = Array.isArray(classIds) && classIds.length ? new Set(classIds) : null;
  const next = {};
  let changed = 0;
  const rows = [];
  let levelGroupTouched = false;

  for (const [classId, list] of Object.entries(classSubjects || {})) {
    if (allow && !allow.has(classId)) {
      next[classId] = list;
      continue;
    }

    let listChanged = false;
    const nextList = (list || []).map((a) => {
      const { fields, groupIndexes } = findTeacherRefs(a, oldTeacherId);
      if (!fields.length && !groupIndexes.length) return a;

      const updated = { ...a };
      fields.forEach((f) => { updated[f] = newTeacherId; });

      if (groupIndexes.length) {
        levelGroupTouched = true;
        updated.levelGroups = (a.levelGroups || []).map((g, i) =>
          groupIndexes.includes(i) ? { ...g, teacherId: newTeacherId } : { ...g }
        );
      }

      listChanged = true;
      changed += 1;
      rows.push({
        classId,
        subjectId: a.subjectId,
        places: [
          ...fields,
          ...groupIndexes.map((i) => `levelGroups[${i}]`),
        ],
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
}) {
  if (!oldTeacherId) return 0;
  const allow = Array.isArray(classIds) && classIds.length ? new Set(classIds) : null;
  let n = 0;
  for (const [classId, list] of Object.entries(classSubjects || {})) {
    if (allow && !allow.has(classId)) continue;
    (list || []).forEach((a) => {
      const { fields, groupIndexes } = findTeacherRefs(a, oldTeacherId);
      if (fields.length || groupIndexes.length) n += 1;
    });
  }
  return n;
}

/**
 * Eski ustoz sinf fanlarida qaysi sinflarda uchraydi (sinf tanlash ro'yxati uchun).
 * @returns {string[]} classId lar
 */
export function classIdsWithTeacherInSubjects(classSubjects = {}, oldTeacherId) {
  if (!oldTeacherId) return [];
  const out = [];
  for (const [classId, list] of Object.entries(classSubjects || {})) {
    const hit = (list || []).some((a) => {
      const { fields, groupIndexes } = findTeacherRefs(a, oldTeacherId);
      return fields.length > 0 || groupIndexes.length > 0;
    });
    if (hit) out.push(classId);
  }
  return out;
}
