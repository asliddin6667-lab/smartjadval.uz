// =====================================================================
//  smartjadval — USTOZ ALMASHTIRISH YOZUVLARI (vaqtinchalik / doimiy)
//
//  "Ustoz almashtirish" sahifasi ilgari jadvalni darhol o'zgartirib,
//  iz qoldirmasdi. Endi har bir almashtirish `substitutions` ro'yxatida
//  YOZUV sifatida saqlanadi (bulutga ham boradi) va uch bosqichda yashaydi:
//
//    scheduled  — boshlanish sanasi hali kelmagan (rejalashtirilgan)
//    active     — vaqtinchalik almashtirish amalda (muddati tugashini kutadi)
//    done       — doimiy almashtirish qo'llandi (qaytarish faqat qo'lda)
//    reverted   — eski ustozga qaytarildi (tarix uchun qoladi)
//
//  Yozuv shakli:
//    {
//      id, createdAt,
//      oldTeacherId, newTeacherId,
//      mode: "temporary" | "permanent",
//      startDate: "2026-10-23", endDate: "2026-11-05",   // ISO, lokal sana
//      pairs: [{ classId, subjectId }] | null,           // null = hammasi
//      status, appliedAt?, revertedAt?,
//      changes: [...],   // qo'llanganda jadvalda nima o'zgargani (qaytarish uchun)
//      csRows: [...],    // sinf fanlarida qaysi joylar yangilangani
//      applied: { total, inPlace, swapped, failed, cs },
//      reverted: { movedBack, renamed, missing, conflicts, cs },
//    }
//
//  QAYTARISH — "teskari amal", nusxani tiklash EMAS. Oraliqda jadval
//  qo'lda tahrirlangan yoki qaytadan tuzilgan bo'lishi mumkin; shuning
//  uchun qaytarish:
//    1) o'rin almashgan darslarni (swap) avval yozilgan joyidan topib,
//       ikkala katak ham bo'sh bo'lsa, ORQAGA almashtiradi;
//    2) joyida qolgan darslarni yozilgan katagidan topib, ustoz nomini
//       eski ustozga qaytaradi;
//    3) topilmaganlarni (jadval qayta tuzilgan) butun jadvaldan
//       (yangi ustoz, fan, sinf) bo'yicha qidirib, nomini qaytaradi;
//    4) sinf fanlaridagi joylarda hali yangi ustoz tursa — eskiga qaytaradi.
//  Oraliqda boshqa odam o'zgartirgan joylarga tegilmaydi.
//
//  AVTOMATIK ISH: App.jsx `runDueSubstitutions()` ni ma'lumot yuklanganda,
//  oyna faollashganda va har daqiqada chaqiradi — boshlanish sanasi
//  kelganlar qo'llanadi, muddati o'tganlar qaytariladi.
// =====================================================================
import { DAYS } from "./constants";
import { genId } from "./helpers";
import { replaceTeacher } from "./replaceTeacher";
import {
  applyTeacherToClassSubjects,
  revertTeacherInClassSubjects,
} from "./replaceTeacherSubjects";

export const SUB_STATUS = {
  SCHEDULED: "scheduled",
  ACTIVE: "active",
  DONE: "done",
  REVERTED: "reverted",
};

// ---------------------------------------------------------------------
//  SANA YORDAMCHILARI — hammasi LOKAL sana, "YYYY-MM-DD" ko'rinishida.
//  ISO satrlari leksikografik taqqoslanadi (a < b), bu sanalar uchun to'g'ri.
// ---------------------------------------------------------------------
export function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isoAddDays(iso, n) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d + Number(n || 0));
  return todayISO(dt);
}

// Ikki sana orasidagi kunlar soni (ikkalasi ham kiradi): 23.10 → 25.10 = 3
export function daysInclusive(a, b) {
  const [y1, m1, d1] = String(a || "").split("-").map(Number);
  const [y2, m2, d2] = String(b || "").split("-").map(Number);
  if (!y1 || !y2) return 0;
  const t1 = new Date(y1, m1 - 1, d1).getTime();
  const t2 = new Date(y2, m2 - 1, d2).getTime();
  return Math.round((t2 - t1) / 86400000) + 1;
}

// "2026-10-23" → "23.10.2026"
export function fmtDate(iso) {
  const [y, m, d] = String(iso || "").split("-");
  if (!y || !m || !d) return iso || "";
  return `${d}.${m}.${y}`;
}

// ---------------------------------------------------------------------
//  YOZUV YARATISH
// ---------------------------------------------------------------------
export function makeSubstitution({
  oldTeacherId, newTeacherId, mode = "permanent",
  startDate = "", endDate = "", pairs = null, today = todayISO(),
}) {
  const start = mode === "temporary" ? (startDate || today) : today;
  return {
    id: genId(),
    createdAt: new Date().toISOString(),
    oldTeacherId,
    newTeacherId,
    mode: mode === "temporary" ? "temporary" : "permanent",
    startDate: start,
    endDate: mode === "temporary" ? (endDate || start) : "",
    pairs: Array.isArray(pairs) && pairs.length ? pairs.map((p) => ({ classId: p.classId, subjectId: p.subjectId })) : null,
    status: start > today ? SUB_STATUS.SCHEDULED : SUB_STATUS.ACTIVE,
    changes: [],
    csRows: [],
  };
}

// Boshlanish sanasi kelgan, lekin hali qo'llanmagan
export function isDueToApply(sub, today = todayISO()) {
  return sub?.status === SUB_STATUS.SCHEDULED && String(sub.startDate || "") <= today;
}

// Vaqtinchalik almashtirish muddati o'tgan (tugash sanasi KIRADI)
export function isDueToRevert(sub, today = todayISO()) {
  return sub?.status === SUB_STATUS.ACTIVE
    && sub.mode === "temporary"
    && !!sub.endDate
    && String(sub.endDate) < today;
}

export function hasDueSubstitutions(list, today = todayISO()) {
  return (list || []).some((s) => isDueToApply(s, today) || isDueToRevert(s, today));
}

// Amaldagi (jadvalga ta'sir qilib turgan) yozuvlar
export function isLive(sub) {
  return sub?.status === SUB_STATUS.ACTIVE || sub?.status === SUB_STATUS.DONE;
}

// ---------------------------------------------------------------------
//  JADVAL YORDAMCHILARI
// ---------------------------------------------------------------------
function classIdsOf(lesson) {
  return Array.isArray(lesson?.classIds) ? lesson.classIds : [lesson?.classId].filter(Boolean);
}

function sameClassSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function cloneSchedule(schedule) {
  const next = {};
  for (const day of Object.keys(schedule || {})) {
    next[day] = {};
    for (const tsId of Object.keys(schedule[day] || {})) {
      next[day][tsId] = (schedule[day][tsId] || []).map((l) => ({ ...l }));
    }
  }
  return next;
}

// ---------------------------------------------------------------------
//  QO'LLASH
//  `replaceTeacher` (jadval) + `applyTeacherToClassSubjects` (sinf fanlari).
//  Natijada yozuvga qaytarish uchun yetarli iz qoladi.
// ---------------------------------------------------------------------
export function applySubstitution({
  sub, schedule, classSubjects, timeslots, teachers, classes = [], lunchGroups = [],
}) {
  const res = replaceTeacher({
    schedule, timeslots, teachers, classes, lunchGroups,
    oldTeacherId: sub.oldTeacherId,
    newTeacherId: sub.newTeacherId,
    onlyClassSubjectIds: sub.pairs || null,
  });
  if (res.summary?.error) return { ok: false, error: res.summary.error };

  const cs = applyTeacherToClassSubjects({
    classSubjects,
    oldTeacherId: sub.oldTeacherId,
    newTeacherId: sub.newTeacherId,
    pairs: sub.pairs || null,
  });

  // O'rin almashgan har bir darsga o'z sherigini biriktiramiz —
  // replaceTeacher `movedOthers` ni `changes` dagi swap'lar tartibida yozadi.
  let k = 0;
  const changes = (res.changes || []).map((c) => {
    if (c.kind !== "swapped") return c;
    const m = res.movedOthers?.[k++];
    return {
      ...c,
      partner: m ? { teacherId: m.teacherId, subjectId: m.subjectId, classIds: m.classIds } : null,
    };
  });

  const s = res.summary || {};
  const next = {
    ...sub,
    status: sub.mode === "permanent" ? SUB_STATUS.DONE : SUB_STATUS.ACTIVE,
    appliedAt: new Date().toISOString(),
    changes,
    csRows: cs.rows || [],
    applied: {
      total: s.totalLessons || 0,
      inPlace: s.inPlace || 0,
      swapped: s.swapped || 0,
      failed: s.failed || 0,
      cs: cs.changed || 0,
    },
  };

  return {
    ok: true,
    schedule: res.schedule,
    classSubjects: cs.changed > 0 ? cs.classSubjects : classSubjects,
    sub: next,
    summary: next.applied,
    preview: res,
  };
}

// ---------------------------------------------------------------------
//  QAYTARISH (teskari amal)
// ---------------------------------------------------------------------
export function revertSubstitution({ sub, schedule, classSubjects }) {
  const sch = cloneSchedule(schedule);
  const oldT = sub.oldTeacherId;
  const newT = sub.newTeacherId;

  let movedBack = 0, renamed = 0, missing = 0, conflicts = 0;
  const handled = new Set();   // qayta ishlangan dars obyektlari

  const cell = (day, tsId) => sch[day]?.[tsId] || [];
  const findIn = (day, tsId, pred) => cell(day, tsId).find((l) => !handled.has(l) && pred(l));
  const isTarget = (l, c) => l.teacherId === newT
    && l.subjectId === c.subjectId
    && sameClassSet(classIdsOf(l), c.classIds || []);

  function detach(day, tsId, lesson) {
    const arr = sch[day]?.[tsId];
    if (!arr) return;
    const i = arr.indexOf(lesson);
    if (i >= 0) arr.splice(i, 1);
  }
  function attach(day, tsId, lesson) {
    if (!sch[day]) sch[day] = {};
    if (!sch[day][tsId]) sch[day][tsId] = [];
    sch[day][tsId].push(lesson);
  }
  // Nomini qaytarib, eski ustoz shu soatda band emasligini tekshiramiz
  function rename(day, tsId, lesson) {
    lesson.teacherId = oldT;
    handled.add(lesson);
    renamed += 1;
    if (cell(day, tsId).some((l) => l !== lesson && l.teacherId === oldT)) conflicts += 1;
  }

  const pending = [];
  const changes = (sub.changes || []).filter((c) => c?.to);

  // --- 1) O'rin almashganlar (swap) — TESKARI tartibda va bir necha o'tishda.
  // Qo'llashda keyingi swap oldingisining katagiga dars qo'yib qo'ygan
  // bo'lishi mumkin (masalan, ikkala sinfning sherigi bitta ustoz). Shuning
  // uchun oxirgisidan boshlab qaytaramiz; hozircha sig'maganlar keyingi
  // o'tishga qoldiriladi — boshqalari qaytgach joy bo'shaydi.
  let queue = changes.filter((c) => c.kind === "swapped" && c.partner && c.from).reverse();
  while (queue.length) {
    const defer = [];
    let progress = false;
    for (const c of queue) {
      const L = findIn(c.to.day, c.to.tsId, (l) => isTarget(l, c));
      const P = findIn(c.from.day, c.from.tsId, (l) => l.teacherId === c.partner.teacherId
        && l.subjectId === c.partner.subjectId
        && sameClassSet(classIdsOf(l), c.partner.classIds || []));
      if (L && P) {
        const fromCell = cell(c.from.day, c.from.tsId);
        const toCell = cell(c.to.day, c.to.tsId);
        const oldFreeAtFrom = !fromCell.some((l) => l !== P && l.teacherId === oldT);
        const partnerFreeAtTo = !toCell.some((l) => l !== L && l.teacherId === P.teacherId);
        const roomOkFrom = !L.roomId || !fromCell.some((l) => l !== P && l.roomId === L.roomId);
        const roomOkTo = !P.roomId || !toCell.some((l) => l !== L && l.roomId === P.roomId);
        if (oldFreeAtFrom && partnerFreeAtTo && roomOkFrom && roomOkTo) {
          detach(c.to.day, c.to.tsId, L);
          detach(c.from.day, c.from.tsId, P);
          L.teacherId = oldT;
          attach(c.from.day, c.from.tsId, L);
          attach(c.to.day, c.to.tsId, P);
          handled.add(L); handled.add(P);
          movedBack += 1;
          progress = true;
          continue;
        }
      }
      defer.push(c);
    }
    queue = defer;
    if (!progress) break;
  }
  // O'rniga qaytarib bo'lmaganlar — hech bo'lmasa ustoz nomi qaytadi
  for (const c of queue) {
    const L = findIn(c.to.day, c.to.tsId, (l) => isTarget(l, c));
    if (L) rename(c.to.day, c.to.tsId, L);
    else pending.push(c);
  }

  // --- 2) Joyida qolgan darslar — yozilgan katagidan topib nomini qaytaramiz
  for (const c of changes) {
    if (c.kind === "swapped" && c.partner && c.from) continue;
    const L = findIn(c.to.day, c.to.tsId, (l) => isTarget(l, c));
    if (L) rename(c.to.day, c.to.tsId, L);
    else pending.push(c);
  }

  // Yozilgan joyida topilmaganlar — jadval qayta tuzilgan bo'lishi mumkin.
  // Butun jadvaldan (yangi ustoz, fan, sinf) bo'yicha qidiramiz.
  for (const c of pending) {
    let found = null;
    for (const day of DAYS) {
      for (const tsId of Object.keys(sch[day] || {})) {
        const L = findIn(day, tsId, (l) => isTarget(l, c));
        if (L) { found = { L, day, tsId }; break; }
      }
      if (found) break;
    }
    if (found) rename(found.day, found.tsId, found.L);
    else missing += 1;
  }

  const cs = revertTeacherInClassSubjects({
    classSubjects, rows: sub.csRows || [], oldTeacherId: oldT, newTeacherId: newT,
  });

  const reverted = { movedBack, renamed, missing, conflicts, cs: cs.reverted || 0 };
  const next = {
    ...sub,
    status: SUB_STATUS.REVERTED,
    revertedAt: new Date().toISOString(),
    reverted,
  };

  return {
    schedule: sch,
    classSubjects: cs.reverted > 0 ? cs.classSubjects : classSubjects,
    sub: next,
    summary: reverted,
  };
}

// ---------------------------------------------------------------------
//  MUDDATI KELGANLARNI BAJARISH (App.jsx chaqiradi)
//  Qaytaradi: { changed, substitutions, schedule, classSubjects, events }
//  events — [{ type: "applied"|"reverted"|"skipped", sub, summary }]
// ---------------------------------------------------------------------
export function runDueSubstitutions({
  substitutions, schedule, classSubjects, timeslots, teachers, classes, lunchGroups,
  today = todayISO(),
}) {
  let sch = schedule;
  let cs = classSubjects;
  let changed = false;
  const events = [];

  const next = (substitutions || []).map((sub) => {
    if (isDueToRevert(sub, today)) {
      const r = revertSubstitution({ sub, schedule: sch, classSubjects: cs });
      sch = r.schedule; cs = r.classSubjects; changed = true;
      events.push({ type: "reverted", sub: r.sub, summary: r.summary });
      return r.sub;
    }
    if (isDueToApply(sub, today)) {
      // Boshlanishi ham, tugashi ham o'tib ketgan (ilova uzoq ochilmagan) —
      // qo'llamaymiz, yozuvni tarixga o'tkazamiz.
      if (sub.mode === "temporary" && sub.endDate && String(sub.endDate) < today) {
        changed = true;
        const s = { ...sub, status: SUB_STATUS.REVERTED, skipped: true, revertedAt: new Date().toISOString() };
        events.push({ type: "skipped", sub: s });
        return s;
      }
      const a = applySubstitution({
        sub, schedule: sch, classSubjects: cs, timeslots, teachers, classes, lunchGroups,
      });
      if (!a.ok) return sub;
      sch = a.schedule; cs = a.classSubjects; changed = true;
      events.push({ type: "applied", sub: a.sub, summary: a.summary });
      return a.sub;
    }
    return sub;
  });

  return { changed, substitutions: next, schedule: sch, classSubjects: cs, events };
}
