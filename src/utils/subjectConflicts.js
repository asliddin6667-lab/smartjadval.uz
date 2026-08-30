// ═══════════ BIR KUNGA TUSHMAYDIGAN FANLAR ═══════════
// Ba'zi fanlar bitta sinfda BIR KUNDA birga o'qitilmaydi. Masalan Algebra
// va Geometriya — ikkalasi ham matematika bo'lgani uchun bir kunga tushsa
// bolaning yuki og'irlashadi, metodik jihatdan ham noto'g'ri.
//
// Qoida QATTIQ: generator, zichlash (compactSchedule) va zaxira to'ldirgich
// (fillRemaining) bunday juftlikni bir kunga QO'YMAYDI. Qo'lda ko'chirishda
// esa faqat ogohlantirish chiqadi — direktor bilib turib qo'yishi mumkin.
//
// Guruh ichidagi HAR QANDAY ikki fan bir kunga tushmaydi. Yangi juftlik
// kerak bo'lsa — shu ro'yxatga qo'shing, boshqa joyga tegish shart emas.
export const SAME_DAY_CONFLICT_GROUPS = [
  ["algebra", "geometriya"],
];

// Fan nomini solishtirish uchun soddalashtirish (apostrof shakllari xilma-xil)
const norm = (s) => String(s || "").toLowerCase().replace(/[\u02bb\u02bc\u2018\u2019`\u00b4]/g, "'").trim();

// Nomni so'zlarga ajratadi: "Algebra (10-sinf)" → ["algebra", "10", "sinf"]
const wordsOf = (s) => norm(s).split(/[^0-9a-z\u0400-\u04ff']+/i).filter(Boolean);

// Fanlar ro'yxatidan `subjectId -> Set(ziddiyatli subjectId)` xaritasini yasaydi.
// Bir fan guruhning IKKI tokeniga ham mos kelsa (masalan "Algebra va
// geometriya") — u qo'shma fan, qoidaga qo'shilmaydi.
export function buildSubjectConflicts(subjects = []) {
  const map = new Map();
  const list = (Array.isArray(subjects) ? subjects : []).filter((s) => s && s.id);
  if (!list.length) return map;
  SAME_DAY_CONFLICT_GROUPS.forEach((group) => {
    const byToken = group.map(() => []);
    list.forEach((s) => {
      const w = new Set(wordsOf(s.name));
      const hits = [];
      group.forEach((tok, gi) => { if (w.has(tok)) hits.push(gi); });
      if (hits.length === 1) byToken[hits[0]].push(s.id);
    });
    for (let a = 0; a < group.length; a++) {
      for (let b = 0; b < group.length; b++) {
        if (a === b) continue;
        byToken[a].forEach((idA) => byToken[b].forEach((idB) => {
          if (idA === idB) return;
          if (!map.has(idA)) map.set(idA, new Set());
          map.get(idA).add(idB);
        }));
      }
    }
  });
  return map;
}

// Ikki fan bir kunga tusha oladimi?
export function subjectsConflict(map, aId, bId) {
  if (!map || !aId || !bId || aId === bId) return false;
  const set = map.get(aId);
  return Boolean(set && set.has(bId));
}
