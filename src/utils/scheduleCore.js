// =====================================================================
//  JADVAL — UMUMIY YORDAMCHILAR
//
//  Bu fayl scheduleGenerator.js dan AJRATILDI. Sabab: jadval tuzish
//  dvigateli (attemptSchedule) endi brauzer bundle’iga tushmaydi —
//  u obuna tekshiruvidan keyin serverdan yuklanadi
//  (src/services/engineLoader.js). Bu yerdagi yordamchilar esa UI ga
//  ham kerak (setka chizish, ko’chirish qoidalari, obed, smena),
//  shuning uchun ular bundle’da qoladi.
//
//  DIQQAT: bu faylga dvigatelga xos mantiq yozilmasin — u yerdan bu
//  yerga ko’chirilgan har bir funksiya himoyadan chiqib ketadi.
// =====================================================================
import { DAYS } from "./constants.js";
import { normalizePairExtra, pairSideGroups, pairAllGroups } from "./pairGroups.js";

export function isTeachingSlot(timeslot) {
  const type = timeslot?.type || "lesson";
  return type !== "lunch" && type !== "break";
}

export function emptySchedule(timeslots) {
  const schedule = {};
  DAYS.forEach((day) => {
    schedule[day] = {};
    timeslots.forEach((ts) => {
      schedule[day][ts.id] = [];
    });
  });
  return schedule;
}

export function getTeacherSubjectIds(teacher) {
  return Array.isArray(teacher.subjectIds)
    ? teacher.subjectIds
    : teacher.subjectId
    ? [teacher.subjectId]
    : [];
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(array, rng = Math.random) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cleanLevelGroups(groups = []) {
  // Bir xil ustoz ikki darajaga qo'yilgan bo'lsa — takroriysi tashlanadi.
  // Daraja guruhlari AYNI VAQTDA o'qiydi, ustoz esa bir vaqtda faqat bitta
  // guruhda bo'la oladi. Ilgari bunday dars butunlay yaroqsiz deb hisoblanib,
  // soatlari jimgina yo'qolardi.
  const seen = new Set();
  return (Array.isArray(groups) ? groups : [])
    .map((g, i) => ({
      name: g?.name || `${i + 1}-guruh`,
      teacherId: g?.teacherId || "",
      roomId: g?.roomId || "",
    }))
    .filter((g) => {
      if (!g.teacherId || seen.has(g.teacherId)) return false;
      seen.add(g.teacherId);
      return true;
    });
}

export function normalizeAssignment(item, subject) {
  const levelGroups = cleanLevelGroups(item.levelGroups || []);

  return {
    subjectId: item.subjectId,
    weeklyHours: Number(item.weeklyHours || subject?.weeklyHours || 1),
    teacherId: item.teacherId || "",
    roomId: item.roomId || "",
    groupKey: (item.groupKey || "").trim(),
    splitEnabled: Boolean(item.splitEnabled),
    teacherId2: item.teacherId2 || "",
    roomId2: item.roomId2 || "",
    swapEnabled: Boolean(item.swapEnabled),
    swapSubjectId: item.swapSubjectId || "",
    swapTeacherId: item.swapTeacherId || "",
    swapRoomId: item.swapRoomId || "",
    // Almashgandan keyingi (2-) soat ustozi/xonasi — bo'sh bo'lsa
    // 1-soatdagi ustoz davom etadi ([swapGroups.js](./swapGroups.js)).
    swapAltTeachers: Boolean(item.swapAltTeachers),
    swapNextTeacherId: item.swapNextTeacherId || "",
    swapNextRoomId: item.swapNextRoomId || "",
    swapNextTeacher2Id: item.swapNextTeacher2Id || "",
    swapNextRoom2Id: item.swapNextRoom2Id || "",
    groupName1: item.groupName1 || "1-guruh",
    groupName2: item.groupName2 || "2-guruh",
    weekAltEnabled: Boolean(item.weekAltEnabled),
    weekAltSubjectId: item.weekAltSubjectId || "",
    weekAltTeacherId: item.weekAltTeacherId || "",
    weekAltRoomId: item.weekAltRoomId || "",
    weekAltHours: Number(item.weekAltHours || 1),
    levelGroupEnabled: Boolean(item.levelGroupEnabled),
    levelGroupKey: (item.levelGroupKey || "").trim(),
    // ——— BIR VAQTDA 2 FAN ———
    // Sinf ikkiga bo'linadi va guruhlar BIR VAQTDA turli fan o'qiydi
    // (masalan 1-guruh Ona tili, 2-guruh Rus tili). Almashinuv YO'Q —
    // har guruh o'z fanida qoladi (`swapEnabled` dan farqi shu).
    pairEnabled: Boolean(item.pairEnabled),
    pairSubjectId: item.pairSubjectId || "",
    pairTeacherId: item.pairTeacherId || "",
    pairRoomId: item.pairRoomId || "",
    // 2-guruh ham parallel sinflarda UMUMIY bo'lsinmi (bitta dars)
    pairShare2: Boolean(item.pairShare2),
    // 3-guruh, 4-guruh... — har birida o'z `shared` bayrog'i
    pairExtra: normalizePairExtra(item.pairExtra),
    // PARALLEL SINFLAR: shu kalit bir nechta sinfning "bir vaqtda 2 fan"
    // sozlamasini BITTA darsga bog'laydi — 1-guruh fanini hamma sinf birga,
    // bitta ustozdan o'qiydi; 2-guruh fani esa har sinfda boshqa bo'lishi mumkin.
    pairGroupKey: (item.pairGroupKey || "").trim(),
    isCore: Boolean(item.isCore),
    // ——— ORA KUNDA (kun oralab): Du → Cho → Ju ———
    spacedDays: Boolean(item.spacedDays),
    allowDouble:
      item.allowDouble === undefined
        ? Boolean(subject?.allowDouble)
        : Boolean(item.allowDouble),
    // ——— 4 SOAT BLOK (faqat superadmin yoqadi) ———
    // Fan bir kunda KETMA-KET 4 soat tushadi. Fanlar bo'limidagi umumiy
    // sozlamadan meros olinmaydi — faqat sinf fanida aniq yoqilsa ishlaydi.
    allowQuad: Boolean(item.allowQuad),
    levelGroups,
  };
}

// ——— BLOK OBED/TANAFFUSDAN OSHIB O'TISHI MUMKIN ———
// Ikki dars orasida faqat obed/tanaffus bandi tursa, 2 (yoki 4) soatlik blok
// shu uzilishdan oshib o'tadi: «4-dars → obed → 6-dars». Uzilish shu
// chegaradan uzun bo'lsa (smena almashinuvi) — blok o'tmaydi.
export const BRIDGE_MAX_GAP = 60; // daqiqa

export function toMinutes(time = "00:00") {
  const [h, m] = String(time).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(aEnd) > toMinutes(bStart);
}

// ═══ VAQT BANDLARI ═══
// Ikki smena bir xil soatda o'tishi mumkin: timeslot id'lari boshqa, lekin
// soati bir xil. Shuning uchun USTOZ va XONA bandligi slot id/indeksi emas,
// VAQT bo'yicha yuritiladi — aks holda smenalar bir-birini "ko'rmaydi".
// Sinf bandligi va ustoz setkasidagi qulflar slot bo'yicha qoladi.
function hasClock(ts) {
  return Boolean(
    ts && ts.startTime && ts.endTime && toMinutes(ts.startTime) < toMinutes(ts.endTime)
  );
}

// Ikki slot bir vaqtga to'g'ri keladimi?
export function slotsOverlap(a, b) {
  if (!a || !b) return false;
  if (a.id && a.id === b.id) return true;
  if (!hasClock(a) || !hasClock(b)) return false;
  return overlaps(a.startTime, a.endTime, b.startTime, b.endTime);
}

// slot bilan vaqti kesishadigan barcha slotlar (slotning o'zi ham kiradi)
export function overlappingSlots(timeslots = [], slot) {
  if (!slot) return [];
  return (Array.isArray(timeslots) ? timeslots : []).filter((ts) => slotsOverlap(ts, slot));
}

// Vaqti kesishadigan slotlarni bitta "vaqt bandi"ga birlashtiradi (union-find).
// bucketOf[i] — i-slotning band raqami, count — bandlar umumiy soni.
// Vaqti ko'rsatilmagan slot faqat o'zi bilan qoladi (eski xatti-harakat).
export function buildTimeBuckets(slots = []) {
  const n = slots.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    let c = x;
    while (parent[c] !== r) { const nx = parent[c]; parent[c] = r; c = nx; }
    return r;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!hasClock(slots[i]) || !hasClock(slots[j])) continue;
      if (!overlaps(slots[i].startTime, slots[i].endTime, slots[j].startTime, slots[j].endTime)) continue;
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[b] = a;
    }
  }
  const idx = new Map();
  const bucketOf = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!idx.has(r)) idx.set(r, idx.size);
    bucketOf[i] = idx.get(r);
  }
  return { bucketOf, count: idx.size };
}

export function classHasLunchAt(timeslot, classId, lunchGroups = [], day = null) {
  if (!timeslot || !classId) return false;

  return (lunchGroups || []).some((group) => {
    const classIds = Array.isArray(group.classIds) ? group.classIds : [];
    if (!classIds.includes(classId)) return false;

    const slotIds = Array.isArray(group.timeslotIds) ? group.timeslotIds : null;
    if (slotIds && slotIds.length) {
      if (!slotIds.includes(timeslot.id)) return false;
      const days = Array.isArray(group.days) && group.days.length ? group.days : null;
      if (day == null) return true;
      return days ? days.includes(day) : true;
    }

    return overlaps(timeslot.startTime, timeslot.endTime, group.startTime, group.endTime);
  });
}

export function classesHaveLunchAt(timeslot, classIds = [], lunchGroups = [], day = null) {
  return classIds.some((classId) => classHasLunchAt(timeslot, classId, lunchGroups, day));
}

export function validateScheduleData(classes, subjects, teachers, rooms, timeslots, classSubjects) {
  const errors = [];

  if (!classes.length) errors.push("Sinflar qo'shilmagan");
  if (!subjects.length) errors.push("Fanlar qo'shilmagan");
  if (!teachers.length) errors.push("O'qituvchilar qo'shilmagan");
  if (!timeslots.length) errors.push("Dars vaqtlari qo'shilmagan");

  if (timeslots.length && !timeslots.some(isTeachingSlot)) {
    errors.push("Kamida bitta dars vaqti bo'lishi kerak");
  }

  classes.forEach((cls) => {
    const assigned = classSubjects?.[cls.id] || [];

    if (!assigned.length) {
      errors.push(`${cls.name} sinfiga fan biriktirilmagan`);
    }

    assigned.forEach((raw) => {
      const subject = subjects.find((s) => s.id === raw.subjectId);
      if (!subject) return;

      const a = normalizeAssignment(raw, subject);

      if (a.levelGroupEnabled) {
        if (!a.levelGroupKey) {
          errors.push(`${cls.name}: ${subject.name} uchun daraja guruh kaliti yozilmagan`);
        }

        if (!a.levelGroups.length) {
          errors.push(`${cls.name}: ${subject.name} daraja guruhlariga ustozlar tanlanmagan`);
        }

        const seen = new Set();

        a.levelGroups.forEach((g, i) => {
          const teacher = teachers.find((t) => t.id === g.teacherId);

          if (!teacher) {
            errors.push(`${cls.name}: ${subject.name} ${g.name || `${i + 1}-guruh`} ustoz topilmadi`);
          } else if (!getTeacherSubjectIds(teacher).includes(a.subjectId)) {
            errors.push(`${teacher.name} ${subject.name} faniga biriktirilmagan`);
          }

          if (seen.has(g.teacherId)) {
            errors.push(`${cls.name}: ${subject.name} daraja guruhlarida bitta ustoz ikki marta tanlangan`);
          }

          seen.add(g.teacherId);
        });

        return;
      }

      if (!a.teacherId) {
        errors.push(`${cls.name}: ${subject.name} faniga 1-ustoz tanlanmagan`);
      } else {
        const teacher = teachers.find((t) => t.id === a.teacherId);

        if (!teacher) {
          errors.push(`${cls.name}: ${subject.name} uchun tanlangan 1-ustoz topilmadi`);
        } else if (!getTeacherSubjectIds(teacher).includes(a.subjectId)) {
          errors.push(`${teacher.name} ${subject.name} faniga biriktirilmagan`);
        }
      }

      // Hafta almashinuvi (juft/toq) — sinf bo'linmaydi, butun sinf navbatlashadi
      if (a.weekAltEnabled) {
        const altSubject = subjects.find((s) => s.id === a.weekAltSubjectId);
        if (!a.weekAltSubjectId || !altSubject) {
          errors.push(`${cls.name}: ${subject.name} hafta almashinuvi uchun 2-fan tanlanmagan`);
        }
        if (!a.weekAltTeacherId) {
          errors.push(`${cls.name}: ${subject.name} hafta almashinuvi uchun 2-fan ustozi tanlanmagan`);
        } else {
          const altTeacher = teachers.find((t) => t.id === a.weekAltTeacherId);
          if (!altTeacher) {
            errors.push(`${cls.name}: ${subject.name} hafta almashinuvi 2-fan ustozi topilmadi`);
          } else if (altSubject && !getTeacherSubjectIds(altTeacher).includes(a.weekAltSubjectId)) {
            errors.push(`${altTeacher.name} ${altSubject.name} faniga biriktirilmagan`);
          }
        }
      }

      // ——— BIR VAQTDA 2 FAN ———
      if (a.pairEnabled) {
        const pairSubject = subjects.find((s) => s.id === a.pairSubjectId);
        if (!a.pairSubjectId || !pairSubject) {
          errors.push(`${cls.name}: ${subject.name} bilan birga o'tadigan 2-fan tanlanmagan`);
        } else if (a.pairSubjectId === a.subjectId) {
          errors.push(`${cls.name}: ${subject.name} — 2-fan boshqa fan bo'lishi kerak`);
        }
        if (!a.pairTeacherId) {
          errors.push(`${cls.name}: ${subject.name} bilan birga o'tadigan 2-fan ustozi tanlanmagan`);
        } else {
          const pairTeacher = teachers.find((t) => t.id === a.pairTeacherId);
          if (!pairTeacher) {
            errors.push(`${cls.name}: ${subject.name} 2-fan ustozi topilmadi`);
          } else if (pairSubject && !getTeacherSubjectIds(pairTeacher).includes(a.pairSubjectId)) {
            errors.push(`${pairTeacher.name} ${pairSubject.name} faniga biriktirilmagan`);
          }
          if (a.teacherId && a.teacherId === a.pairTeacherId) {
            errors.push(`${cls.name}: ${subject.name} — ikki fan bir vaqtda o'tadi, ustozlar bir xil bo'lmasin`);
          }
        }
        if (a.roomId && a.pairRoomId && a.roomId === a.pairRoomId) {
          errors.push(`${cls.name}: ${subject.name} — ikki fan bir vaqtda o'tadi, xonalar bir xil bo'lmasin`);
        }
      }

      if (a.splitEnabled && a.swapEnabled) {
        const swapSubject = subjects.find((s) => s.id === a.swapSubjectId);
        if (!a.swapSubjectId || !swapSubject) {
          errors.push(`${cls.name}: ${subject.name} almashinuv uchun 2-fan tanlanmagan`);
        }
        if (!a.swapTeacherId) {
          errors.push(`${cls.name}: ${subject.name} almashinuv uchun 2-fan ustozi tanlanmagan`);
        } else {
          const swapTeacher = teachers.find((t) => t.id === a.swapTeacherId);
          if (!swapTeacher) {
            errors.push(`${cls.name}: ${subject.name} almashinuv 2-fan ustozi topilmadi`);
          } else if (swapSubject && !getTeacherSubjectIds(swapTeacher).includes(a.swapSubjectId)) {
            errors.push(`${swapTeacher.name} ${swapSubject.name} faniga biriktirilmagan`);
          }
          if (a.teacherId && a.teacherId === a.swapTeacherId) {
            errors.push(`${cls.name}: ${subject.name} almashinuvida ikkala fan ustozi bir xil bo'lmasin`);
          }
        }
        // 2-soatga alohida ustoz tanlangan bo'lsa — u ham o'z faniga
        // biriktirilgan bo'lishi va o'sha soatda takrorlanmasligi kerak.
        if (a.swapAltTeachers) {
          const check = (tid, sid, label) => {
            if (!tid) return;
            const t = teachers.find((x) => x.id === tid);
            const sub = subjects.find((x) => x.id === sid);
            if (!t) { errors.push(`${cls.name}: ${subject.name} — ${label} ustozi topilmadi`); return; }
            if (sub && !getTeacherSubjectIds(t).includes(sid)) {
              errors.push(`${t.name} ${sub.name} faniga biriktirilmagan`);
            }
          };
          check(a.swapNextTeacherId, a.subjectId, "2-soat 2-guruh");
          check(a.swapNextTeacher2Id, a.swapSubjectId, "2-soat 1-guruh");
          const t1 = a.swapNextTeacher2Id || a.swapTeacherId;
          const t2 = a.swapNextTeacherId || a.teacherId;
          if (t1 && t1 === t2) {
            errors.push(`${cls.name}: ${subject.name} — 2-soatda ikkala guruhga bir ustoz qo'yilgan`);
          }
        }
      } else if (a.splitEnabled) {
        if (!a.teacherId2) {
          errors.push(`${cls.name}: ${subject.name} 2-guruh uchun 2-ustoz tanlanmagan`);
        } else {
          const teacher2 = teachers.find((t) => t.id === a.teacherId2);

          if (!teacher2) {
            errors.push(`${cls.name}: ${subject.name} uchun tanlangan 2-ustoz topilmadi`);
          } else if (!getTeacherSubjectIds(teacher2).includes(a.subjectId)) {
            errors.push(`${teacher2.name} ${subject.name} faniga biriktirilmagan`);
          }

          if (a.teacherId && a.teacherId === a.teacherId2) {
            errors.push(`${cls.name}: ${subject.name} uchun 1-ustoz va 2-ustoz bir xil bo'lmasin`);
          }
        }
      }
    });
  });

  // ——— BIR VAQTDA 2 FAN: PARALLEL SINFLAR (pairGroupKey) ———
  // Guruhdagi sinflar bitta soatda o'qiydi, shuning uchun 2-guruh
  // ustozlari va xonalari sinflar bo'ylab TAKRORLANMASLIGI shart.
  const pairGroups = new Map();
  classes.forEach((cls) => {
    (classSubjects?.[cls.id] || []).forEach((raw) => {
      const key = String(raw?.pairGroupKey || "").trim();
      if (!raw?.pairEnabled || !key) return;
      const gk = `${raw.subjectId}__${key}`;
      if (!pairGroups.has(gk)) pairGroups.set(gk, []);
      pairGroups.get(gk).push({ cls, a: raw });
    });
  });
  pairGroups.forEach((members) => {
    if (members.length < 2) return;
    const names = members.map((m) => m.cls.name).join(", ");
    const base = members[0].a;
    const subject = subjects.find((s) => s.id === base.subjectId);
    const label = `${names} — ${subject?.name || "Fan"} (parallel)`;
    // 1-guruh: fan, ustoz va soat hamma sinfda bir xil bo'lishi kerak
    if (members.some((m) => m.a.teacherId !== base.teacherId)) {
      errors.push(`${label}: 1-guruh ustozi barcha sinflarda bir xil bo'lishi kerak`);
    }
    if (members.some((m) => Number(m.a.weeklyHours || 0) !== Number(base.weeklyHours || 0))) {
      errors.push(`${label}: haftalik soat barcha sinflarda bir xil bo'lishi kerak`);
    }
    // Qolgan guruhlar (2-, 3-, 4-…) bir vaqtda o'qiydi — ustoz ham,
    // xona ham takrorlanmasligi shart. UMUMIY guruh butun guruh bo'yicha
    // BITTA dars, shuning uchun u faqat bir marta tekshiriladi.
    const tSeen = new Map();
    const rSeen = new Map();
    if (base.roomId) rSeen.set(base.roomId, "1-guruh");
    if (base.teacherId) tSeen.set(base.teacherId, "1-guruh");
    const sharedDone = new Map();
    members.forEach((m) => {
      pairSideGroups(m.a).forEach((g) => {
        // Umumiy guruh: birinchi sinfda tekshiriladi, keyingilarida esa
        // sozlamalari BIR XIL ekani nazorat qilinadi.
        if (g.shared) {
          const prev = sharedDone.get(g.gid);
          if (prev) {
            if (prev.subjectId !== g.subjectId || prev.teacherId !== g.teacherId) {
              errors.push(`${label}: «${g.name}» umumiy guruh — fani va ustozi barcha sinflarda bir xil bo'lishi kerak`);
            }
            return;
          }
          sharedDone.set(g.gid, g);
        }
        const where = g.shared ? `${g.name} (umumiy)` : `${m.cls.name} ${g.name}`;
        if (g.teacherId) {
          if (tSeen.has(g.teacherId)) {
            const who = teachers.find((x) => x.id === g.teacherId)?.name || "Ustoz";
            errors.push(`${label}: ${who} bir vaqtda ikki joyda (${tSeen.get(g.teacherId)} va ${where})`);
          } else tSeen.set(g.teacherId, where);
        }
        if (g.roomId) {
          if (rSeen.has(g.roomId)) {
            const rn = rooms.find((x) => x.id === g.roomId)?.name || "Xona";
            errors.push(`${label}: ${rn} xonasi bir vaqtda ikki guruhga berilgan (${rSeen.get(g.roomId)} va ${where})`);
          } else rSeen.set(g.roomId, where);
        }
      });
    });
  });

  return [...new Set(errors)];
}

export function classIdsOf(lesson) {
  return Array.isArray(lesson.classIds)
    ? lesson.classIds
    : [lesson.classId].filter(Boolean);
}

export function hasAdjacentSameSubject(schedule, day, tsId, classIds, subjectId, timeslots) {
  const sorted = [...timeslots].sort(
    (a, b) => Number(a.lessonNumber) - Number(b.lessonNumber)
  );

  const idx = sorted.findIndex((ts) => ts.id === tsId);
  if (idx < 0) return false;

  const neighbors = [sorted[idx - 1], sorted[idx + 1]].filter(Boolean);

  return neighbors.some((ts) => {
    if (!isTeachingSlot(ts)) return false;

    const lessons = schedule[day]?.[ts.id] || [];

    return lessons.some(
      (l) =>
        l.subjectId === subjectId &&
        classIdsOf(l).some((id) => classIds.includes(id))
    );
  });
}

// ——— 4 SOAT BLOK ———
// "2 soat blok" bilan bir xil mexanizm, faqat blok uzunligi 4.
export const QUAD_SIZE = 4;

// Haftalik soatni bloklarga ajratadi.
//   allowQuad   — avval 4 soatlik bloklar ajraladi (ketma-ket 4 soat);
//   allowDouble — qolgani 2 soatlik bloklarga bo'linadi;
//   ikkalasi ham o'chiq bo'lsa — har soat alohida dars.
// Masalan 6 soat: quad+double → [4, 2]; faqat quad → [4, 1, 1].
export function splitHoursToBlocks(hours, allowDouble, allowQuad) {
  const total = Number(hours || 0);

  if (!allowDouble && !allowQuad) {
    return Array.from({ length: total }, () => 1);
  }

  const blocks = [];
  let remaining = total;

  if (allowQuad) {
    while (remaining >= QUAD_SIZE) {
      blocks.push(QUAD_SIZE);
      remaining -= QUAD_SIZE;
    }
  }

  if (allowDouble) {
    while (remaining >= 2) {
      blocks.push(2);
      remaining -= 2;
    }
  }

  while (remaining > 0) {
    blocks.push(1);
    remaining -= 1;
  }

  return blocks;
}

// Blok ustuvorligi: uzun blok kam joyga sig'adi — avvalroq joylanadi.
// 1 soat → 0, 2 soat → 10 (eski qiymat), 4 soat → 30.
export function blockPriority(blockSize) {
  return (Math.max(1, Number(blockSize || 1)) - 1) * 10;
}

// ——— KELAJAK SOATI: nom bo'yicha avtomatik aniqlash ———
// Nomi "Kelajak soati" (yoki ruscha "Час будущего") bo'lgan fan hech qanday
// sozlamasiz avtomatik ravishda DUSHANBA kunining 1-DARSIGA qo'yiladi.
// Katta-kichik harf, ortiqcha probel va apostrof turlari farq qilmaydi.
const FIXED_MONDAY_NAMES = new Set([
  "kelajak soati",
  "час будущего",
  "келажак соати",
]);
function normSubjName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
export function isFixedMondaySubject(subject) {
  return FIXED_MONDAY_NAMES.has(normSubjName(subject?.name));
}
export function fixedMondaySubjectIds(subjects = []) {
  return new Set((subjects || []).filter((s) => isFixedMondaySubject(s)).map((s) => s.id));
}

// ——— O'CHIRILGAN XONAGA HAVOLA ———
// Xona ro'yxatdan o'chirilsa, "Sinf fanlari"dagi biriktirmalarda uning id'si
// qolib ketadi. Dvigatel esa uni HAQIQIY resurs deb biladi: o'sha "xona"ga
// bog'langan barcha darslar bir-birini bloklaydi va bir vaqtda faqat bittasi
// o'tishi mumkin bo'lib qoladi. Bir nechta sinf bitta o'chirilgan xonaga
// bog'langan bo'lsa — yuzlab soat umuman joylashmaydi.
// Shuning uchun mavjud bo'lmagan xona "xonasiz" deb qaraladi.
export function stripMissingRooms(classSubjects = {}, rooms = null) {
  if (!Array.isArray(rooms)) return classSubjects || {};
  const ok = new Set(rooms.map((r) => r?.id).filter(Boolean));
  const bad = (id) => Boolean(id) && !ok.has(id);
  let changed = false;
  const out = {};
  Object.entries(classSubjects || {}).forEach(([cid, list]) => {
    out[cid] = (Array.isArray(list) ? list : []).map((a) => {
      if (!a) return a;
      const hit = bad(a.roomId) || bad(a.roomId2) || bad(a.swapRoomId) || bad(a.weekAltRoomId) ||
        bad(a.swapNextRoomId) || bad(a.swapNextRoom2Id) ||
        (Array.isArray(a.levelGroups) && a.levelGroups.some((g) => bad(g?.roomId)));
      if (!hit) return a;
      changed = true;
      const copy = { ...a };
      if (bad(copy.roomId)) copy.roomId = "";
      if (bad(copy.roomId2)) copy.roomId2 = "";
      if (bad(copy.swapRoomId)) copy.swapRoomId = "";
      if (bad(copy.swapNextRoomId)) copy.swapNextRoomId = "";
      if (bad(copy.swapNextRoom2Id)) copy.swapNextRoom2Id = "";
      if (bad(copy.weekAltRoomId)) copy.weekAltRoomId = "";
      if (Array.isArray(copy.levelGroups)) {
        copy.levelGroups = copy.levelGroups.map((g) => (bad(g?.roomId) ? { ...g, roomId: "" } : g));
      }
      return copy;
    });
  });
  return changed ? out : (classSubjects || {});
}


export function totalWeeklyHours(classSubjects = {}) {
  let total = 0;
  Object.values(classSubjects).forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((a) => {
      if (a?.pairEnabled) {
        // Kartadagi guruhlar BITTA soatda o'qiydi: sinf setkasida har bir
        // TURLI fan `weeklyHours` ta soat egallaydi (takroriy fan — 1 marta).
        const uniq = new Set(pairAllGroups(a).map((g) => g.subjectId).filter(Boolean));
        total += Math.max(1, uniq.size) * Number(a?.weeklyHours || 0);
        return;
      }
      total += Number(a?.weeklyHours || 0);
      if (a?.swapEnabled && a?.swapSubjectId) total += Number(a?.weeklyHours || 0);
      if (a?.weekAltEnabled && a?.weekAltSubjectId) total += Number(a?.weekAltHours || 1);
    });
  });
  return total;
}

// Maktab hajmiga qarab bitta urinishning vaqt byudjeti.
//   mode "fast" — tezkor zondlash: past cap, urinish ~0.3–1s.
//                 Ko'pincha shu yerdayoq 100% chiqadi.
//   mode "deep" — to'liq qidiruv: faqat tezkor urinishlar kamchilik qoldirsa.
// Bular CHEGARA (cap), sarf emas — bosqichlar yaxshilanish tugashi bilan
// erta to'xtaydi, shuning uchun mantiq (qoidalar) hech qayerda qisqarmaydi.

export function budgetFor(totalHours, mode = "deep") {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  if (mode === "fast") {
    return {
      solveMs: clamp(300 + totalHours * 0.35, 450, 1400),
      compactMs: clamp(400 + totalHours * 0.4, 550, 1600),
      polishMs: totalHours > 1500 ? 120 : 160,
    };
  }
  // Bular — CHEGARA (cap), sarf emas: bosqichlar yaxshilanish tugashi bilan
  // erta to'xtaydi. Shuning uchun kichik maktabda urinish ~0.3–1s, kattada ~2–4s.
  return {
    solveMs: clamp(900 + totalHours * 1.2, 1400, 4000),
    compactMs: clamp(1200 + totalHours * 1.3, 1800, 4500),
    polishMs: totalHours > 1500 ? 200 : 350,
  };
}

// Bitta urinish — to'liq natija bilan (hisobot, oyna soni, jarima)
