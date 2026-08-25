// ═══════════════════════════════════════════════════════════════════
//  BOSHLANG'ICH SINF RAHBARI VA «BOLA NAZORATSIZ QOLMASIN» QOIDASI
// ═══════════════════════════════════════════════════════════════════
//
//  1–4 sinfda darslarning katta qismini BITTA ustoz beradi — u sinf
//  rahbari. Lekin uning boshqa sinflarda ham soati bo'lishi mumkin.
//  O'sha soatda u 1-A dan chiqib ketadi, demak 1-A da AYNI o'sha soatda
//  BOSHQA ustozning darsi turishi shart — aks holda bolalar nazoratsiz
//  qoladi.
//
//  Buni ta'minlaydigan uchta narsa bor:
//
//    1) SIG'IM. Rahbarning tashqi soati sinfdagi «begona ustoz» soatidan
//       ko'p bo'lsa, qoida JISMONAN bajarilmaydi — qancha urinmasin.
//       `supervisionRows()` shu tanqislikni oldindan hisoblab beradi.
//    2) GENERATOR. Joylashtirishda «begona ustoz» darslari tanqis resurs
//       sifatida erta joylanadi, rahbarning tashqi darsi esa aynan o'sha
//       kataklar ustiga tortiladi (scheduleGenerator.js).
//    3) TEKSHIRUV. Tayyor jadvalda qolgan buzilishlar `findSupervisionGaps()`
//       bilan topiladi va ekranda ro'yxat bo'lib ko'rinadi.
//
//  Sinf rahbari `classes[].headTeacherId` da saqlanadi. Belgilanmagan
//  bo'lsa — boshlang'ich sinf uchun AVTOMATIK aniqlanadi: eng ko'p FAN
//  bergan ustoz (teng bo'lsa — eng ko'p soat bergani).
//  `classes[].superviseOff === true` bo'lsa qoida shu sinfga qo'llanmaydi.
//
//  DIQQAT: bu fayl `scheduleGenerator.js` ichidan ham import qilinadi,
//  shuning uchun u yerdan HECH NARSA import qilmaydi (modul halqasi
//  bo'lmasin). Ikkita kichik predikat ataylab takrorlangan.
//
import { DAYS } from "./constants";
import { pairAllGroups, pairCardKey } from "./pairGroups";

// Boshlang'ich ta'lim — 1-sinfdan shu sinfgacha
export const PRIMARY_MAX_GRADE = 4;

// scheduleGenerator.isTeachingSlot nusxasi (halqasiz import uchun)
function isTeaching(ts) {
  const type = ts?.type || "lesson";
  return type !== "lunch" && type !== "break";
}

// moveResolver.slotAllowsClass nusxasi (halqasiz import uchun)
function allowsClass(ts, classId) {
  const ids = Array.isArray(ts?.classIds) ? ts.classIds : [];
  return ids.length === 0 || ids.includes(classId);
}

/** "4-A" → 4, "11-B" → 11, tanimasa 0 */
export function gradeOf(className = "") {
  const m = String(className).trim().match(/^(\d{1,2})/);
  return m ? Number(m[1]) : 0;
}

/** Sinf boshlang'ichmi (1–4)? */
export function isPrimaryClass(cls) {
  const g = gradeOf(cls?.name);
  return g >= 1 && g <= PRIMARY_MAX_GRADE;
}

// ───────────────────────────────────────────────────────────────────
//  BITTA «Sinf fanlari» QATORI → (ustoz, fan, soat) bo'laklari
// ───────────────────────────────────────────────────────────────────
//  Qator sinf setkasida `weeklyHours` ta KATAK egallaydi. Guruhlar,
//  daraja guruhlari va parallel sinflar AYNI o'sha kataklarda o'tadi —
//  shuning uchun bo'laklarning soati katak sonini oshirmaydi.
export function rowTeacherParts(a) {
  const parts = [];
  const h = Number(a?.weeklyHours || 0);
  if (!a || h <= 0) return parts;

  if (a.levelGroupEnabled && Array.isArray(a.levelGroups) && a.levelGroups.length) {
    a.levelGroups.forEach((g) => {
      if (g?.teacherId) parts.push({ teacherId: g.teacherId, subjectId: a.subjectId, hours: h });
    });
    return parts;
  }

  if (a.pairEnabled) {
    pairAllGroups(a).forEach((g) => {
      if (g.teacherId && g.subjectId) parts.push({ teacherId: g.teacherId, subjectId: g.subjectId, hours: h });
    });
    return parts;
  }

  // Hafta almashinuvi: `weekAltHours` soat ikkinchi ustozda o'tadi.
  // Asosiy ustoz shu soatlarda sinfda BO'LMAYDI — nazorat hisobida
  // shu ayirma muhim.
  const altH = a.weekAltEnabled && a.weekAltTeacherId
    ? Math.max(0, Math.min(Number(a.weekAltHours || 1), h))
    : 0;
  if (a.teacherId && h - altH > 0) parts.push({ teacherId: a.teacherId, subjectId: a.subjectId, hours: h - altH });
  if (altH > 0) parts.push({ teacherId: a.weekAltTeacherId, subjectId: a.weekAltSubjectId || a.subjectId, hours: altH });
  if (a.splitEnabled && a.teacherId2) parts.push({ teacherId: a.teacherId2, subjectId: a.subjectId, hours: h });
  if (a.swapEnabled && a.swapTeacherId) parts.push({ teacherId: a.swapTeacherId, subjectId: a.swapSubjectId || a.subjectId, hours: h });
  return parts;
}

/** Sinf setkasidagi JAMI katak (soat) soni */
export function classSlotTotal(rows) {
  return (rows || []).reduce((s, a) => s + Math.max(0, Number(a?.weeklyHours || 0)), 0);
}

/**
 * Shu sinfda har bir ustozning ulushi: `Map(teacherId → { hours, subjects:Set })`.
 * `hours` — ustoz SHU SINFDA nechta katakda turadi (bir qatorda bir necha
 * guruhda tursa ham bir marta sanaladi: guruhlar ayni soatda o'qiydi).
 */
export function classTeacherStats(rows) {
  const map = new Map();
  (rows || []).forEach((a) => {
    const per = new Map();
    rowTeacherParts(a).forEach((p) => {
      per.set(p.teacherId, Math.max(per.get(p.teacherId) || 0, p.hours));
      let e = map.get(p.teacherId);
      if (!e) map.set(p.teacherId, (e = { hours: 0, subjects: new Set() }));
      e.subjects.add(p.subjectId);
    });
    per.forEach((hours, tid) => { map.get(tid).hours += hours; });
  });
  return map;
}

/**
 * Sinf rahbarini AVTOMATIK aniqlash: eng ko'p FAN bergan ustoz.
 * Teng bo'lsa — eng ko'p soat bergani; u ham teng bo'lsa id bo'yicha
 * (natija barqaror bo'lishi uchun — har render'da o'zgarmasin).
 * Kamida 2 ta fan bermagan ustoz sinf rahbari deb hisoblanmaydi.
 */
export function detectHomeroomId(rows, minSubjects = 2) {
  const stats = classTeacherStats(rows);
  let best = "";
  let bestSubj = 0;
  let bestHours = 0;
  stats.forEach((e, tid) => {
    const n = e.subjects.size;
    const better =
      n > bestSubj ||
      (n === bestSubj && e.hours > bestHours) ||
      (n === bestSubj && e.hours === bestHours && best && String(tid) < String(best));
    if (better) { best = tid; bestSubj = n; bestHours = e.hours; }
  });
  return bestSubj >= minSubjects ? best : "";
}

/**
 * Shu sinfning rahbari kim? Avval qo'lda belgilangani, bo'lmasa —
 * boshlang'ich sinf uchun avtomatik aniqlangani.
 */
export function homeroomIdOf(cls, classSubjects = {}) {
  if (!cls) return "";
  const explicit = String(cls.headTeacherId || "").trim();
  if (explicit) return explicit;
  if (!isPrimaryClass(cls)) return "";
  return detectHomeroomId(classSubjects?.[cls.id] || []);
}

/** Nazorat qoidasi shu sinfga qo'llanadimi? */
export function supervisedClass(cls) {
  return Boolean(cls) && isPrimaryClass(cls) && cls.superviseOff !== true;
}

// ───────────────────────────────────────────────────────────────────
//  USTOZ YUKLAMASI — «DARS OQIMLARI» bo'yicha
// ───────────────────────────────────────────────────────────────────
//  Ustoz bir vaqtda faqat bitta joyda bo'la oladi. Parallel dars,
//  daraja guruhi va parallel sinflar bir nechta sinfni BITTA darsga
//  birlashtiradi — bunday dars ustoz uchun BIR MARTA sanaladi.
//  Har bir "oqim" = ustozning bitta haqiqiy dars birligi.
//
//  Natija: `Map(teacherId → { total, streams:Map(key→{hours,classIds}),
//                             classIds:Set, subjectIds:Set })`
export function buildTeacherStreams(classes = [], classSubjects = {}) {
  const out = new Map();
  const touch = (tid) => {
    let e = out.get(tid);
    if (!e) out.set(tid, (e = { total: 0, streams: new Map(), classIds: new Set(), subjectIds: new Set() }));
    return e;
  };
  const add = (tid, key, hours, classId, subjectId) => {
    const h = Number(hours || 0);
    if (!tid || h <= 0) return;
    const e = touch(tid);
    let st = e.streams.get(key);
    if (!st) e.streams.set(key, (st = { hours: 0, classIds: new Set() }));
    // Ayni oqim bir necha sinfdan kelsa — soat eng kattasi bo'yicha, bir marta
    st.hours = Math.max(st.hours, h);
    if (classId) { st.classIds.add(classId); e.classIds.add(classId); }
    if (subjectId) e.subjectIds.add(subjectId);
  };

  (classes || []).forEach((cls) => {
    (classSubjects?.[cls.id] || []).forEach((a, idx) => {
      if (!a) return;
      const h = Number(a.weeklyHours || 0);
      const lg = String(a.levelGroupKey || "").trim();
      const gk = String(a.groupKey || "").trim();
      // Haqiqiy bo'linish: 1- va 2-guruhga TURLI ustoz
      const realSplit = Boolean(a.splitEnabled && a.teacherId2 && a.teacherId2 !== a.teacherId);

      if (a.levelGroupEnabled && a.levelGroups?.length) {
        // Kalitga guruh INDEKSI emas, USTOZ id'si kiradi — guruhlar tartibi
        // sinflarda har xil bo'lsa ham soat ikkilanmaydi.
        const base = lg ? `LG|${lg}|${a.subjectId}` : `LGC|${cls.id}|${idx}`;
        a.levelGroups.forEach((g) => add(g?.teacherId, `${base}|${g?.teacherId}`, h, cls.id, a.subjectId));
      } else if (a.pairEnabled) {
        // Kartadagi guruhlar ayni soatda o'qiydi, parallel sinflar bitta
        // kartani baham ko'radi — har ustoz kartada BIR MARTA.
        const card = pairCardKey(a, cls.id);
        pairAllGroups(a).forEach((g) => add(g.teacherId, `${card}|${g.teacherId}`, h, cls.id, g.subjectId));
      } else if (gk && !realSplit) {
        // 🔁 Parallel dars: bir nechta sinf ayni soatda, bitta ustozdan
        add(a.teacherId, `G|${a.subjectId}|${a.teacherId}|${a.roomId || ""}|${gk}`, h, cls.id, a.subjectId);
      } else {
        add(a.teacherId, `C|${cls.id}|${idx}`, h, cls.id, a.subjectId);
        if (realSplit) add(a.teacherId2, `C2|${cls.id}|${idx}`, h, cls.id, a.subjectId);
      }
      if (a.swapEnabled && a.swapTeacherId) add(a.swapTeacherId, `SW|${cls.id}|${idx}`, h, cls.id, a.swapSubjectId);
      if (a.weekAltEnabled && a.weekAltTeacherId) {
        add(a.weekAltTeacherId, `WA|${cls.id}|${idx}`, Number(a.weekAltHours || 1), cls.id, a.weekAltSubjectId);
      }
    });
  });

  out.forEach((e) => { e.streams.forEach((st) => { e.total += st.hours; }); });
  return out;
}

// ───────────────────────────────────────────────────────────────────
//  NAZORAT SIG'IMI — jadval tuzilishidan OLDIN
// ───────────────────────────────────────────────────────────────────
//  Rahbar sinfdan chiqib ketgan soat ikki xil yo'l bilan xavfsiz bo'ladi:
//
//    1) o'sha soatda sinfda BOSHQA ustozning darsi turadi (`coverHours`);
//    2) sinf o'sha paytda umuman maktabda bo'lmaydi — kunini tugatgan,
//       dam kunida yoki boshqa smenada.
//
//  `riskHours = outHours − coverHours` — ikkinchi yo'lga majburan
//  tayanadigan soatlar. Bu «imkonsiz» degani EMAS (sinf kunini erta
//  tugatsa hammasi joyiga tushadi), lekin jadval shu qadar torayadi.
//  Shuning uchun UI da bu OGOHLANTIRISH, xato emas.
//
//  «Butunlay imkonsiz» holatni aytishga urinmaymiz: u matematik jihatdan
//  «rahbarning yuklamasi haftaga sig'maydi» degan holatga teng, uni esa
//  ustoz sig'imi ogohlantirishi allaqachon aniqroq ko'rsatadi.
//
//  Boshqa smenadagi sinflar hisobga OLINMAYDI: ularning darslari bilan
//  vaqt kesishmaydi, demak nazoratga ta'sir qilmaydi.
export function supervisionRows(ctx = {}) {
  const { classes = [], classSubjects = {}, timeslots = [], lunchGroups = [] } = ctx;
  const streams = buildTeacherStreams(classes, classSubjects);
  const teaching = (timeslots || []).filter(isTeaching);

  // Sinf → shu sinfga ruxsat etilgan dars slotlari (smena)
  const slotsOf = new Map();
  classes.forEach((c) => {
    slotsOf.set(c.id, new Set(teaching.filter((ts) => allowsClass(ts, c.id)).map((ts) => ts.id)));
  });
  const shareTime = (aId, bId) => {
    const A = slotsOf.get(aId);
    const B = slotsOf.get(bId);
    if (!A || !B || !A.size || !B.size) return true; // ma'lumot yetarli emas — ehtiyot shart
    for (const id of A) if (B.has(id)) return true;
    return false;
  };

  const rows = [];
  classes.forEach((cls) => {
    if (!supervisedClass(cls)) return;
    const list = classSubjects?.[cls.id] || [];
    const teacherId = homeroomIdOf(cls, classSubjects);
    if (!teacherId) return;

    const total = classSlotTotal(list);
    const stats = classTeacherStats(list);
    const homeHours = Math.min(total, stats.get(teacherId)?.hours || 0);
    const coverHours = Math.max(0, total - homeHours);

    // Sinfga haftada nechta dars o'rni ajratilgan (dam kuni, smena va
    // obed hisobga olingan holda) — shundan ortgani "bo'sh vaqt".
    const offDays = new Set(Array.isArray(cls.offDays) ? cls.offDays : []);
    let availSlots = 0;
    DAYS.forEach((day) => {
      if (offDays.has(day)) return;
      teaching.forEach((ts) => {
        if (!allowsClass(ts, cls.id)) return;
        if (classLunchAt(ts, cls.id, lunchGroups, day)) return;
        availSlots += 1;
      });
    });
    const slack = Math.max(0, availSlots - total);

    let outHours = 0;
    const outClassIds = new Set();
    const info = streams.get(teacherId);
    if (info) {
      info.streams.forEach((st) => {
        if (st.classIds.has(cls.id)) return;               // shu sinfning o'z darsi
        const risky = [...st.classIds].some((cid) => shareTime(cls.id, cid));
        if (!risky) return;                                 // boshqa smena — kesishmaydi
        outHours += st.hours;
        st.classIds.forEach((cid) => outClassIds.add(cid));
      });
    }

    rows.push({
      classId: cls.id,
      className: cls.name,
      teacherId,
      auto: !String(cls.headTeacherId || "").trim(),
      total,
      availSlots,
      slack,
      homeHours,
      coverHours,
      outHours,
      // Sinf kunini ERTA TUGATISH bilan qoplanishi kerak bo'lgan soatlar
      riskHours: Math.max(0, outHours - coverHours),
      outClassIds: [...outClassIds],
    });
  });
  return rows;
}


// ───────────────────────────────────────────────────────────────────
//  VAQT BANDLARI VA OBED — kichik nusxalar
// ───────────────────────────────────────────────────────────────────
//  scheduleGenerator dagi `buildTimeBuckets` / `classHasLunchAt` bilan
//  bir xil mantiq. Ataylab takrorlangan: teskari import modul halqasini
//  hosil qilardi (yuqoridagi DIQQAT izohiga qarang).
function toMin(t = "00:00") {
  const [h, m] = String(t).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function timeOverlaps(aS, aE, bS, bE) {
  return toMin(aS) < toMin(bE) && toMin(aE) > toMin(bS);
}

function hasClock(ts) {
  return Boolean(ts && ts.startTime && ts.endTime && toMin(ts.startTime) < toMin(ts.endTime));
}

// Vaqti kesishadigan slotlar bitta bandga birlashadi (ikki smena bir soatda)
function bucketsOf(slots = []) {
  const n = slots.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    return r;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!hasClock(slots[i]) || !hasClock(slots[j])) continue;
      if (!timeOverlaps(slots[i].startTime, slots[i].endTime, slots[j].startTime, slots[j].endTime)) continue;
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[b] = a;
    }
  }
  return slots.map((_, i) => find(i));
}

function classLunchAt(ts, classId, lunchGroups = [], day = null) {
  if (!ts || !classId) return false;
  return (lunchGroups || []).some((group) => {
    const ids = Array.isArray(group.classIds) ? group.classIds : [];
    if (!ids.includes(classId)) return false;
    const slotIds = Array.isArray(group.timeslotIds) ? group.timeslotIds : null;
    if (slotIds && slotIds.length) {
      if (!slotIds.includes(ts.id)) return false;
      const days = Array.isArray(group.days) && group.days.length ? group.days : null;
      if (day == null) return true;
      return days ? days.includes(day) : true;
    }
    return timeOverlaps(ts.startTime, ts.endTime, group.startTime, group.endTime);
  });
}

function lessonClassIds(l) {
  return Array.isArray(l?.classIds) && l.classIds.length ? l.classIds : [l?.classId].filter(Boolean);
}

function lessonTeacherIds(l) {
  const ids = [];
  if (l?.teacherId) ids.push(l.teacherId);
  if (l?.alternating && l?.altTeacherId) ids.push(l.altTeacherId);
  return ids;
}

// ───────────────────────────────────────────────────────────────────
//  NAZORATSIZ SOATLAR — TAYYOR JADVAL BO'YICHA
// ───────────────────────────────────────────────────────────────────
//  Buzilish shakli: sinfning katagi BO'SH, lekin shu kuni undan KEYIN
//  hali darsi bor (ya'ni bolalar maktabda), va aynan o'sha vaqtda sinf
//  rahbari BOSHQA sinfda dars bermoqda.
//
//  Hisobga OLINMAYDI:
//    • kun oxiridagi bo'sh kataklar — bolalar uyga ketgan;
//    • obed/uyqu vaqti — sinf o'z guruhida, nazorat boshqacha;
//    • rahbar shu soatda umuman bo'sh bo'lsa — u o'zi qaray oladi.
export function findSupervisionGaps(ctx = {}) {
  const {
    classes = [], classSubjects = {}, teachers = [],
    timeslots = [], lunchGroups = [], schedule = {},
  } = ctx;

  const teaching = [...(timeslots || [])]
    .filter(isTeaching)
    .sort((a, b) => Number(a.lessonNumber) - Number(b.lessonNumber));
  if (!teaching.length) return [];

  const buckets = bucketsOf(teaching);
  const bucketById = new Map(teaching.map((ts, i) => [ts.id, buckets[i]]));
  const teacherName = new Map((teachers || []).map((t) => [t.id, t.name]));
  const classNameById = new Map((classes || []).map((c) => [c.id, c.name]));

  // Rahbari aniqlangan, nazorat qilinadigan sinflar
  const watched = [];
  (classes || []).forEach((cls) => {
    if (!supervisedClass(cls)) return;
    const teacherId = homeroomIdOf(cls, classSubjects);
    if (teacherId) watched.push({ cls, teacherId });
  });
  if (!watched.length) return [];

  const gaps = [];
  DAYS.forEach((day) => {
    // Shu kuni: qaysi ustoz qaysi vaqt bandida qaysi sinfda
    const busy = new Map();   // `${bucket}|${teacherId}` → Set(classId)
    teaching.forEach((ts) => {
      const b = bucketById.get(ts.id);
      (schedule?.[day]?.[ts.id] || []).forEach((l) => {
        const cids = lessonClassIds(l);
        lessonTeacherIds(l).forEach((tid) => {
          const k = `${b}|${tid}`;
          let set = busy.get(k);
          if (!set) busy.set(k, (set = new Set()));
          cids.forEach((cid) => set.add(cid));
        });
      });
    });

    watched.forEach(({ cls, teacherId }) => {
      if (Array.isArray(cls.offDays) && cls.offDays.includes(day)) return;
      const mine = teaching.filter(
        (ts) => allowsClass(ts, cls.id) && !classLunchAt(ts, cls.id, lunchGroups, day)
      );
      const filled = mine.map((ts) =>
        (schedule?.[day]?.[ts.id] || []).some((l) => lessonClassIds(l).includes(cls.id))
      );
      let last = -1;
      filled.forEach((f, i) => { if (f) last = i; });
      if (last < 0) return;   // bu kuni sinfda umuman dars yo'q

      for (let i = 0; i < last; i++) {
        if (filled[i]) continue;
        const ts = mine[i];
        const where = busy.get(`${bucketById.get(ts.id)}|${teacherId}`);
        if (!where || !where.size) continue;    // rahbar bo'sh — o'zi qaray oladi
        if (where.has(cls.id)) continue;        // rahbar shu sinfda (bo'lishi mumkin emas, ehtiyot shart)
        gaps.push({
          classId: cls.id,
          className: cls.name || classNameById.get(cls.id) || "",
          teacherId,
          teacherName: teacherName.get(teacherId) || "",
          day,
          tsId: ts.id,
          lessonNumber: Number(ts.lessonNumber) || i + 1,
          busyIn: [...where].map((cid) => classNameById.get(cid) || "").filter(Boolean),
        });
      }
    });
  });
  return gaps;
}
