// ——————————————————————————————————————————————————————————————
// PARALLEL SINFLAR — BIR KUNDA BIR XIL FAN
//
// 10-A, 10-B, 10-V — bitta darajaning parallel sinflari. Direktor uchun
// qulay bo'lsin deb ular IMKON QADAR bir kunda bir xil fanlarni o'qishi
// kerak: 10-A da dushanba Fizika bo'lsa, 10-B da ham dushanba Fizika.
//
// ⚠️ «Bir kun» — «bir soat» EMAS. Agar ikkala sinfga ayni bir ustoz kirsa,
// ular bir soatda o'qiy olmaydi (ustoz ikki joyda bo'la olmaydi). Shuning
// uchun maqsad — fanlar to'plamini BIR KUNGA yig'ish, soatlar surilishi
// normal.
//
// Qoida YUMSHOQ: joy topilmasa dars boshqa kunga tushaveradi. Hech qayerda
// qattiq cheklov (taqiq) sifatida ishlatilmaydi — aks holda tushmagan soat
// ko'payib ketardi.
// ——————————————————————————————————————————————————————————————
import { DAYS } from "./constants";
import { gradeOf } from "./homeroom";

// Darajada kamida shuncha sinf bo'lsa mexanizm ishga tushadi
const MIN_GROUP = 2;

/** Sozlama yoqilganmi? Sukut bo'yicha — YOQILGAN. */
export function parallelDaysOn(settings) {
  return settings?.parallelDays !== false;
}

/**
 * Sinflarni daraja bo'yicha guruhlaydi ("10-A", "10-B" → 10).
 * `cls.parallelOff === true` bo'lgan sinf guruhga kirmaydi.
 *
 * → {
 *      enabled,               // guruh umuman bormi
 *      count,                 // guruhlar soni (indekslar 0..count-1)
 *      grades: [10, 11, ...], // guruh indeksidan darajaga
 *      sizes:  [2, 3, ...],   // guruhdagi sinflar soni
 *      gIdxOf: Map<classId, gIdx>,
 *      idxArr: Int16Array,    // sinf INDEKSI (classes massividagi) → gIdx, yo'q bo'lsa -1
 *      classIds: [[id, ...]]  // guruh indeksidan sinf id'lariga
 *    }
 */
export function buildParallelIndex(classes = [], on = true) {
  const empty = { enabled: false, count: 0, grades: [], sizes: [], gIdxOf: new Map(), idxArr: new Int16Array(classes.length).fill(-1), classIds: [] };
  if (!on || !Array.isArray(classes) || classes.length < MIN_GROUP) return empty;

  const byGrade = new Map(); // daraja → [sinf indekslari]
  classes.forEach((c, ci) => {
    if (!c || c.parallelOff === true) return;
    const g = gradeOf(c.name);
    if (!g) return;
    if (!byGrade.has(g)) byGrade.set(g, []);
    byGrade.get(g).push(ci);
  });

  const grades = [];
  const sizes = [];
  const classIds = [];
  const gIdxOf = new Map();
  const idxArr = new Int16Array(classes.length).fill(-1);
  [...byGrade.keys()].sort((a, b) => a - b).forEach((g) => {
    const list = byGrade.get(g);
    if (list.length < MIN_GROUP) return;
    const gi = grades.length;
    grades.push(g);
    sizes.push(list.length);
    classIds.push(list.map((ci) => classes[ci].id));
    list.forEach((ci) => { idxArr[ci] = gi; gIdxOf.set(classes[ci].id, gi); });
  });

  if (!grades.length) return empty;
  return { enabled: true, count: grades.length, grades, sizes, gIdxOf, idxArr, classIds };
}

function classIdsOfLesson(lesson) {
  if (Array.isArray(lesson?.classIds) && lesson.classIds.length) return lesson.classIds;
  return lesson?.classId ? [lesson.classId] : [];
}

/**
 * Tayyor jadvaldan: qaysi sinf qaysi kuni qaysi fanni oladi.
 * → Map<classId, Map<subjectId, Set<day>>>
 */
function subjectDaysOf(schedule = {}) {
  const out = new Map();
  DAYS.forEach((day) => {
    const slots = schedule?.[day];
    if (!slots) return;
    Object.values(slots).forEach((cell) => {
      (Array.isArray(cell) ? cell : []).forEach((l) => {
        // Kartadagi HAR BIR fan hisobga olinadi (juftlik, hafta almashinuvi)
        const sids = [l?.subjectId, l?.pairSubjectId, l?.altSubjectId, l?.swapSubjectId];
        (Array.isArray(l?.pairExtra) ? l.pairExtra : []).forEach((g) => sids.push(g?.subjectId));
        classIdsOfLesson(l).forEach((cid) => {
          let m = out.get(cid);
          if (!m) { m = new Map(); out.set(cid, m); }
          sids.filter(Boolean).forEach((sid) => {
            let s = m.get(sid);
            if (!s) { s = new Set(); m.set(sid, s); }
            s.add(day);
          });
        });
      });
    });
  });
  return out;
}

/**
 * Parallel moslik hisoboti.
 *
 * `mismatch` — «yetishmayotgan hamroh» soni: guruhda fan o'qiydigan `n` ta
 * sinf bo'lsa, fan tushgan HAR BIR kunda `n − c` ta sinf yetishmaydi.
 * Hammasi mos bo'lsa — 0. Generator variantlarni shu son bo'yicha
 * taqqoslaydi (kam bo'lgani yaxshi).
 *
 * `slots` — «ideal» yig'indi: fan tushgan har bir kunda guruhning HAMMA
 * sinfi shu fanni olsa qancha bo'lardi. `matched = slots − mismatch`, ya'ni
 * `matched / slots` — moslik FOIZI. Bu son «to'liq mos fanlar» sonidan
 * ancha adolatliroq: 5 soatlik fanda bitta kun mos kelmasa ham fan
 * «mos emas» deb sanaladi, lekin qolgan kunlar baribir foydali.
 *
 * → { mismatch, slots, matched, total, aligned,
 *     groups: [{ grade, size, total, aligned, slots, matched, bad: [{ subjectId, name, miss }] }] }
 */
export function parallelReport(schedule = {}, classes = [], subjects = [], on = true) {
  const par = buildParallelIndex(classes, on);
  const base = { mismatch: 0, slots: 0, matched: 0, total: 0, aligned: 0, groups: [] };
  if (!par.enabled) return base;

  const nameOf = new Map((subjects || []).map((s) => [s.id, s.name]));
  const sdays = subjectDaysOf(schedule);
  let mismatch = 0;
  let slots = 0;
  let total = 0;
  let aligned = 0;
  const groups = [];

  par.classIds.forEach((ids, gi) => {
    // Guruhdagi sinflar bo'yicha fan → shu fanni oladigan sinflar (kunlari bilan)
    const subjMap = new Map(); // subjectId → Map<classId, Set<day>>
    ids.forEach((cid) => {
      const m = sdays.get(cid);
      if (!m) return;
      m.forEach((days, sid) => {
        let e = subjMap.get(sid);
        if (!e) { e = new Map(); subjMap.set(sid, e); }
        e.set(cid, days);
      });
    });

    const bad = [];
    let gTotal = 0;
    let gAligned = 0;
    let gSlots = 0;
    let gMiss = 0;
    subjMap.forEach((perClass, sid) => {
      const n = perClass.size;
      if (n < MIN_GROUP) return;   // fanni bitta sinf oladi — solishtiradigan narsa yo'q
      gTotal += 1;
      const dayCount = new Map();
      perClass.forEach((days) => days.forEach((d) => dayCount.set(d, (dayCount.get(d) || 0) + 1)));
      let miss = 0;
      dayCount.forEach((c) => { miss += n - c; });
      gSlots += dayCount.size * n;
      gMiss += miss;
      mismatch += miss;
      if (miss === 0) gAligned += 1;
      else bad.push({ subjectId: sid, name: nameOf.get(sid) || "Fan", miss });
    });

    total += gTotal;
    aligned += gAligned;
    slots += gSlots;
    if (gTotal) {
      bad.sort((a, b) => b.miss - a.miss);
      groups.push({
        grade: par.grades[gi], size: par.sizes[gi], total: gTotal, aligned: gAligned,
        slots: gSlots, matched: gSlots - gMiss, bad,
      });
    }
  });

  return { mismatch, slots, matched: slots - mismatch, total, aligned, groups };
}

/** Faqat nomuvofiqlik soni (generator variantlarni taqqoslash uchun) */
export function parallelMismatch(schedule, classes, subjects, on = true) {
  return parallelReport(schedule, classes, subjects, on).mismatch;
}
