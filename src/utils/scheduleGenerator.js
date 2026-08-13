import { DAYS } from "./constants";

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

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(array, rng = Math.random) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cleanLevelGroups(groups = []) {
  return (Array.isArray(groups) ? groups : [])
    .map((g, i) => ({
      name: g?.name || `${i + 1}-guruh`,
      teacherId: g?.teacherId || "",
      roomId: g?.roomId || "",
    }))
    .filter((g) => g.teacherId);
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
    groupName1: item.groupName1 || "1-guruh",
    groupName2: item.groupName2 || "2-guruh",
    weekAltEnabled: Boolean(item.weekAltEnabled),
    weekAltSubjectId: item.weekAltSubjectId || "",
    weekAltTeacherId: item.weekAltTeacherId || "",
    weekAltRoomId: item.weekAltRoomId || "",
    weekAltHours: Number(item.weekAltHours || 1),
    levelGroupEnabled: Boolean(item.levelGroupEnabled),
    levelGroupKey: (item.levelGroupKey || "").trim(),
    isCore: Boolean(item.isCore),
    // ——— ORA KUNDA (kun oralab): Du → Cho → Ju ———
    spacedDays: Boolean(item.spacedDays),
    allowDouble:
      item.allowDouble === undefined
        ? Boolean(subject?.allowDouble)
        : Boolean(item.allowDouble),
    levelGroups,
  };
}

function toMinutes(time = "00:00") {
  const [h, m] = String(time).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(aEnd) > toMinutes(bStart);
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

  return [...new Set(errors)];
}

function classIdsOf(lesson) {
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

function splitHoursToBlocks(hours, allowDouble) {
  const total = Number(hours || 0);

  if (!allowDouble) {
    return Array.from({ length: total }, () => 1);
  }

  const blocks = [];
  let remaining = total;

  while (remaining >= 2) {
    blocks.push(2);
    remaining -= 2;
  }

  if (remaining === 1) blocks.push(1);

  return blocks;
}

function attemptSchedule(
  classes, subjects, teachers, rooms, timeslots,
  classSubjects = {}, lunchGroups = [], lockedSchedule = null, options = {}
) {
  const rng = mulberry32((options.seed ?? 1) >>> 0);
  // deadline zichlash bosqichida uzaytiriladi (ejection-chain o'sha yerda ham kerak)
  let deadline = options.deadline || Date.now() + 8000;
  const polishBudgetMs = options.polishBudgetMs ?? 450;
  const compactBudgetMs = options.compactBudgetMs ?? 3200;
  const schedule = emptySchedule(timeslots);
  if (!classes.length || !subjects.length || !teachers.length || !timeslots.length) {
    return { schedule, placed: 0, attempted: 0, soft: 0, report: null };
  }
  let attemptedHours = 0;
  let placedHours = 0;
  const D = DAYS.length;
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const teacherSubjSet = new Map(teachers.map((t) => [t.id, new Set(getTeacherSubjectIds(t))]));
  const allSortedTs = [...timeslots].sort((a, b) => Number(a.lessonNumber) - Number(b.lessonNumber));
  const teachingTs = allSortedTs.filter(isTeachingSlot);
  const T = teachingTs.length;
  const DT = D * T;
  const allIdxById = new Map(allSortedTs.map((ts, i) => [ts.id, i]));
  const teachIdxById = new Map(teachingTs.map((ts, i) => [ts.id, i]));
  const nextConsecutive = new Array(Math.max(0, T - 1)).fill(false);
  for (let i = 0; i < T - 1; i++) {
    nextConsecutive[i] = allIdxById.get(teachingTs[i + 1].id) === allIdxById.get(teachingTs[i].id) + 1;
  }
  const C = classes.length;
  const TT = teachers.length;
  const S = subjects.length;
  const ALL_C = Array.from({ length: C }, (_, i) => i);
  const cIdxOf = new Map(classes.map((c, i) => [c.id, i]));
  const tIdxOf = new Map(teachers.map((t, i) => [t.id, i]));
  const sIdxOf = new Map(subjects.map((s, i) => [s.id, i]));
  const classOffMask = new Uint8Array(C * D);
  const classOffSet = {};
  classes.forEach((c, ci) => {
    const off = new Set(Array.isArray(c.offDays) ? c.offDays : []);
    classOffSet[c.id] = off;
    DAYS.forEach((day, d) => { if (off.has(day)) classOffMask[ci * D + d] = 1; });
  });
  const teacherOffMask = new Uint8Array(TT * D);
  const teacherOffSet = {};
  teachers.forEach((t, ti) => {
    const off = new Set(Array.isArray(t.offDays) ? t.offDays : []);
    teacherOffSet[t.id] = off;
    DAYS.forEach((day, d) => { if (off.has(day)) teacherOffMask[ti * D + d] = 1; });
  });
  const lunchGrid = new Uint8Array(C * DT);
  classes.forEach((c, ci) => {
    DAYS.forEach((day, d) => {
      teachingTs.forEach((ts, i) => {
        if (classHasLunchAt(ts, c.id, lunchGroups, day)) lunchGrid[ci * DT + d * T + i] = 1;
      });
    });
  });
  // ——— Smena/sinf biriktiruvi: timeslot.classIds bo'yicha bandlik ———
  const slotClassBlock = new Uint8Array(C * DT);
  classes.forEach((c, ci) => {
    teachingTs.forEach((ts, i) => {
      const allowed = Array.isArray(ts.classIds) ? ts.classIds : [];
      if (allowed.length && !allowed.includes(c.id)) {
        for (let d = 0; d < D; d++) slotClassBlock[ci * DT + d * T + i] = 1;
      }
    });
  });
  // ——— ASOSIY FAN uchun soat o'rni (rank) ———
  const slotRank = new Int16Array(C * DT).fill(-1);
  for (let ci = 0; ci < C; ci++) {
    for (let d = 0; d < D; d++) {
      const base = ci * DT + d * T;
      let r = 0;
      for (let k = 0; k < T; k++) {
        if (lunchGrid[base + k] || slotClassBlock[base + k]) continue;
        slotRank[base + k] = r;
        r += 1;
      }
    }
  }
  const classGrid = new Uint8Array(C * DT);
  const teacherGrid = new Uint8Array(TT * DT);
  const roomGridMap = new Map();
  function roomGrid(rid) {
    let g = roomGridMap.get(rid);
    if (!g) { g = new Uint8Array(DT); roomGridMap.set(rid, g); }
    return g;
  }
  const teacherLoadArr = new Int16Array(TT);
  const teacherMaxArr = new Int16Array(TT);
  teachers.forEach((t, ti) => { teacherMaxArr[ti] = Number(t.maxWeeklyHours || 40); });
  const teacherDailyArr = new Int16Array(TT * D);
  const classDayCount = new Int16Array(C * D);
  const classDailySubj = new Int16Array(C * D * S);
  const placedKeyCount = new Map();
  function bumpKeyIdx(ci, si, delta) {
    if (ci < 0 || si < 0) return;
    const k = ci * S + si;
    placedKeyCount.set(k, (placedKeyCount.get(k) || 0) + delta);
  }
  function getPlacedKey(cid, sid) {
    const ci = cIdxOf.get(cid);
    const si = sIdxOf.get(sid);
    if (ci === undefined || si === undefined) return 0;
    return placedKeyCount.get(ci * S + si) || 0;
  }
  // ——— Kunlik me'yor: sinfning haftalik soati ish kunlariga teng bo'linadi ———
  const balLo = new Int16Array(C);
  const balHi = new Int16Array(C);
  const dayUsable = new Uint8Array(C * D);
  const usableDayCount = new Int16Array(C);
  for (let ci = 0; ci < C; ci++) {
    let ud = 0;
    for (let d = 0; d < D; d++) {
      let cap = 0;
      const cBase = ci * DT + d * T;
      if (!classOffMask[ci * D + d]) {
        for (let k = 0; k < T; k++) if (!lunchGrid[cBase + k] && !slotClassBlock[cBase + k]) cap += 1;
      }
      if (cap > 0) { dayUsable[ci * D + d] = 1; ud += 1; }
    }
    usableDayCount[ci] = ud;
  }
  function setBalanceTargets(totalsOf) {
    for (let ci = 0; ci < C; ci++) {
      const ud = usableDayCount[ci];
      if (!ud) { balLo[ci] = 0; balHi[ci] = 0; continue; }
      const total = totalsOf(ci);
      const base = Math.floor(total / ud);
      balLo[ci] = base;
      balHi[ci] = total - base * ud > 0 ? base + 1 : base;
    }
  }
  // Boshlang'ich me'yor — biriktirilgan haftalik soatlar bo'yicha
  const classNeed = new Int16Array(C);
  classes.forEach((c, ci) => {
    let n = 0;
    (classSubjects[c.id] || []).forEach((a) => { n += Number(a?.weeklyHours || 0); });
    classNeed[ci] = n;
  });
  setBalanceTargets((ci) => classNeed[ci]);

  // ——— BIR KUNDA BIR FAN NECHA SOAT? (qattiq cheklov uchun tayyorgarlik) ———
  // Har bir sinf+fan juftligi uchun haftalik soat yig'iladi. Kunlik limit
  // keyinchalik: max(blok o'lchami, ceil(haftalik soat / ish kunlari)).
  // Shu tufayli "2 soat blok" yoqilgan fan bir kunda 2 soatdan oshmaydi va
  // ikkita blok orqama-ket tushib 4 soat bo'lib ketmaydi.
  const keyHours = new Map();
  function addKeyHours(ci, si, h) {
    if (ci === undefined || si === undefined || si < 0 || !h) return;
    const k = ci * S + si;
    keyHours.set(k, (keyHours.get(k) || 0) + h);
  }
  classes.forEach((c, ci) => {
    (classSubjects[c.id] || []).forEach((raw) => {
      if (!raw || !raw.subjectId) return;
      const h = Number(raw.weeklyHours || 0);
      addKeyHours(ci, sIdxOf.get(raw.subjectId), h);
      if (raw.swapEnabled && raw.swapSubjectId) addKeyHours(ci, sIdxOf.get(raw.swapSubjectId), h);
      if (raw.weekAltEnabled && raw.weekAltSubjectId) {
        addKeyHours(ci, sIdxOf.get(raw.weekAltSubjectId), Number(raw.weekAltHours || 1));
      }
    });
  });
  function dayCapFor(cIdxs, sIdx, blockSize) {
    let cap = Math.max(1, blockSize || 1);
    if (sIdx < 0) return cap;
    for (const ci of cIdxs) {
      const ud = Math.max(1, usableDayCount[ci] || 1);
      const h = keyHours.get(ci * S + sIdx) || 0;
      if (h > 0) cap = Math.max(cap, Math.ceil(h / ud));
    }
    return cap;
  }

  const placements = [];
  const entryToPlacement = new Map();
  const LOCKED = { locked: true };
  const lockedCount = {};
  if (lockedSchedule) {
    const groupedCS = new Set();
    classes.forEach((c) => {
      (classSubjects[c.id] || []).forEach((a) => {
        if (a.groupKey || (a.levelGroupEnabled && a.levelGroupKey)) groupedCS.add(`${c.id}__${a.subjectId}`);
      });
    });
    const isGroupedLesson = (l) => classIdsOf(l).some((cid) => groupedCS.has(`${cid}__${l.subjectId}`));
    DAYS.forEach((day, d) => {
      allSortedTs.forEach((ts) => {
        const cell = lockedSchedule?.[day]?.[ts.id];
        if (!Array.isArray(cell)) return;
        const manual = cell.filter((l) => l && l.manual && !isGroupedLesson(l));
        if (!manual.length) return;
        if (!schedule[day]) schedule[day] = {};
        schedule[day][ts.id] = [...(schedule[day][ts.id] || []), ...manual];
        const tIdx = teachIdxById.get(ts.id);
        manual.forEach((l) => {
          entryToPlacement.set(l, LOCKED);
          const ti = tIdxOf.get(l.teacherId);
          if (ti !== undefined) {
            teacherLoadArr[ti] += 1;
            teacherDailyArr[ti * D + d] += 1;
            if (tIdx !== undefined) teacherGrid[ti * DT + d * T + tIdx] = 1;
          }
          if (l.roomId && tIdx !== undefined) roomGrid(l.roomId)[d * T + tIdx] = 1;
          if (l.alternating && l.altTeacherId) {
            const ti2 = tIdxOf.get(l.altTeacherId);
            if (ti2 !== undefined) {
              teacherLoadArr[ti2] += 1;
              teacherDailyArr[ti2 * D + d] += 1;
              if (tIdx !== undefined) teacherGrid[ti2 * DT + d * T + tIdx] = 1;
            }
          }
        });
        const seen = new Set();
        manual.forEach((l) => {
          const sid = l.subjectId;
          const si = sIdxOf.get(sid);
          classIdsOf(l).forEach((cid) => {
            const ci = cIdxOf.get(cid);
            const k = `${cid}__${sid}`;
            if (!seen.has(k)) {
              seen.add(k);
              lockedCount[k] = (lockedCount[k] || 0) + 1;
              if (ci !== undefined && si !== undefined) {
                classDailySubj[(ci * D + d) * S + si] += 1;
                bumpKeyIdx(ci, si, 1);
              }
            }
            if (ci !== undefined && tIdx !== undefined) {
              const gi = ci * DT + d * T + tIdx;
              if (!classGrid[gi]) { classGrid[gi] = 1; classDayCount[ci * D + d] += 1; }
            }
          });
        });
      });
    });
  }

  const simpleRequests = [];
  const groupMap = new Map();
  const levelGroupMap = new Map();
  shuffle(classes, rng).forEach((cls) => {
    const assigned = shuffle(classSubjects[cls.id] || [], rng);
    assigned.forEach((raw) => {
      const subject = subjectById.get(raw.subjectId);
      if (!subject) return;
      const a = normalizeAssignment(raw, subject);
      const lockedH = lockedCount[`${cls.id}__${a.subjectId}`] || 0;
      if (lockedH > 0) {
        a.weeklyHours = Math.max(0, Number(a.weeklyHours || 0) - lockedH);
        if (a.weeklyHours <= 0) return;
      }
      const blocks = splitHoursToBlocks(a.weeklyHours, Boolean(a.allowDouble));
      if (a.levelGroupEnabled && a.levelGroupKey) {
        if (!a.levelGroups.length) return;
        const key = `${a.subjectId}__LEVEL__${a.levelGroupKey}`;
        if (!levelGroupMap.has(key)) {
          levelGroupMap.set(key, {
            type: "levelGroup", subjectId: a.subjectId, levelGroupKey: a.levelGroupKey,
            classIds: [], blocks, levelGroups: a.levelGroups, isCore: a.isCore,
            spacedDays: a.spacedDays,
            priority: a.weeklyHours + 40 + (a.allowDouble ? 15 : 0) + a.levelGroups.length,
          });
        }
        const group = levelGroupMap.get(key);
        if (a.isCore) group.isCore = true;
        if (a.spacedDays) group.spacedDays = true;
        if (!group.classIds.includes(cls.id)) group.classIds.push(cls.id);
        if (a.levelGroups.length > group.levelGroups.length) group.levelGroups = a.levelGroups;
        if (blocks.length > group.blocks.length || a.weeklyHours > group.blocks.reduce((x, y) => x + y, 0)) group.blocks = blocks;
        return;
      }
      if (!a.teacherId) return;

      // ——— HAFTA ALMASHINUVI (juft/toq) ———
      if (a.weekAltEnabled && a.weekAltSubjectId && a.weekAltTeacherId) {
        const altHours = Math.max(1, Math.min(Number(a.weekAltHours || 1), Number(a.weeklyHours || 1)));
        const normalHours = Math.max(0, Number(a.weeklyHours || 0) - altHours);
        const normalBlocks = splitHoursToBlocks(normalHours, Boolean(a.allowDouble));
        normalBlocks.forEach((blockSize) => {
          simpleRequests.push({
            type: "single", classIds: [cls.id], subjectId: a.subjectId,
            teacherId: a.teacherId, roomId: a.roomId,
            blockSize, priority: a.weeklyHours + (blockSize === 2 ? 10 : 0), isCore: a.isCore,
            spacedDays: a.spacedDays,
          });
        });
        for (let k = 0; k < altHours; k++) {
          simpleRequests.push({
            type: "weekAlt", classIds: [cls.id],
            subjectId: a.subjectId, altSubjectId: a.weekAltSubjectId,
            teacherId: a.teacherId, altTeacherId: a.weekAltTeacherId,
            teacherIds: [a.teacherId, a.weekAltTeacherId],
            roomId: a.roomId || "", altRoomId: a.weekAltRoomId || "",
            roomIds: [a.roomId || "", a.weekAltRoomId || ""].filter(Boolean),
            blockSize: 1, priority: a.weeklyHours + 25, isCore: a.isCore,
            spacedDays: a.spacedDays,
          });
        }
        return;
      }

      if (a.splitEnabled && a.swapEnabled && a.swapSubjectId && a.swapTeacherId) {
        const swapBlocks = Math.max(1, Number(a.weeklyHours || 1));
        for (let k = 0; k < swapBlocks; k++) {
          simpleRequests.push({
            type: "swap", classIds: [cls.id], subjectId: a.subjectId, swapSubjectId: a.swapSubjectId,
            teacherId: a.teacherId, swapTeacherId: a.swapTeacherId, roomId: a.roomId || "", swapRoomId: a.swapRoomId || "",
            teacherIds: [a.teacherId, a.swapTeacherId], roomIds: [a.roomId || "", a.swapRoomId || ""],
            groupName1: a.groupName1 || "1-guruh", groupName2: a.groupName2 || "2-guruh",
            blockSize: 2, priority: a.weeklyHours + 30, isCore: a.isCore,
            spacedDays: a.spacedDays,
          });
        }
        return;
      }
      if (a.splitEnabled && a.teacherId2) {
        blocks.forEach((blockSize) => {
          simpleRequests.push({
            type: "split", classIds: [cls.id], subjectId: a.subjectId, teacherId: a.teacherId,
            teacherIds: [a.teacherId, a.teacherId2], roomId: a.roomId, roomIds: [a.roomId || "", a.roomId2 || ""],
            splitGroups: [
              { teacherId: a.teacherId, roomId: a.roomId || "", groupPart: a.groupName1 || "1-guruh" },
              { teacherId: a.teacherId2, roomId: a.roomId2 || "", groupPart: a.groupName2 || "2-guruh" },
            ],
            blockSize, priority: a.weeklyHours + (blockSize === 2 ? 10 : 0) + 15, isCore: a.isCore,
            spacedDays: a.spacedDays,
          });
        });
      } else if (a.groupKey) {
        const key = `${a.subjectId}__${a.teacherId}__${a.roomId || "xonasiz"}__${a.groupKey}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            type: "group", subjectId: a.subjectId, teacherId: a.teacherId, roomId: a.roomId,
            groupKey: a.groupKey, blocks, classIds: [], isCore: a.isCore,
            spacedDays: a.spacedDays,
            priority: a.weeklyHours + 20 + (a.allowDouble ? 10 : 0),
          });
        }
        const group = groupMap.get(key);
        if (a.isCore) group.isCore = true;
        if (a.spacedDays) group.spacedDays = true;
        if (!group.classIds.includes(cls.id)) group.classIds.push(cls.id);
        if (blocks.length > group.blocks.length || a.weeklyHours > group.blocks.reduce((x, y) => x + y, 0)) group.blocks = blocks;
      } else {
        blocks.forEach((blockSize) => {
          simpleRequests.push({
            type: "single", classIds: [cls.id], subjectId: a.subjectId, teacherId: a.teacherId,
            roomId: a.roomId, blockSize, priority: a.weeklyHours + (blockSize === 2 ? 10 : 0), isCore: a.isCore,
            spacedDays: a.spacedDays,
          });
        });
      }
    });
  });

  const groupRequests = [];
  for (const group of groupMap.values()) {
    group.blocks.forEach((blockSize) => { groupRequests.push({ ...group, blockSize }); });
  }
  for (const group of levelGroupMap.values()) {
    const teacherIds = group.levelGroups.map((g) => g.teacherId).filter(Boolean);
    const roomIds = group.levelGroups.map((g) => g.roomId || "");
    group.blocks.forEach((blockSize) => { groupRequests.push({ ...group, teacherIds, roomIds, blockSize }); });
  }

  const allRequests = [...groupRequests, ...simpleRequests];
  const teacherTotalReq = {};
  allRequests.forEach((r) => {
    (r.teacherIds || [r.teacherId]).filter(Boolean).forEach((id) => {
      teacherTotalReq[id] = (teacherTotalReq[id] || 0) + (r.blockSize || 1);
    });
  });
  function difficulty(r) {
    const tids = (r.teacherIds || [r.teacherId]).filter(Boolean);
    const maxTeacherLoad = tids.reduce((mx, id) => Math.max(mx, teacherTotalReq[id] || 0), 0);
    const teacherOff = tids.some((id) => teacherOffSet[id] && teacherOffSet[id].size) ? 8 : 0;
    const classOff = (r.classIds || []).some((cid) => classOffSet[cid] && classOffSet[cid].size) ? 5 : 0;
    const multiClass = (r.classIds?.length || 1) >= 2 ? 4 : 0;
    const multiTeacher = tids.length >= 2 ? tids.length * 12 : 0;
    const spaced = r.spacedDays ? 7 : 0;
    const core = r.isCore ? 6 : 0;
    const block = (r.blockSize || 1) >= 2 ? 10 : 0;
    return maxTeacherLoad + (r.blockSize || 1) * 2 + teacherOff + classOff + multiClass + multiTeacher + spaced + core + block;
  }
  function isValidRequest(req) {
    const reqTeacherIds = (req.teacherIds || [req.teacherId]).filter(Boolean);
    const reqTeachers = reqTeacherIds.map((id) => teacherById.get(id)).filter(Boolean);
    if (!subjectById.has(req.subjectId)) return false;
    if (reqTeachers.length !== reqTeacherIds.length) return false;
    if (req.type === "swap") {
      const tA = teacherById.get(req.teacherId);
      const tB = teacherById.get(req.swapTeacherId);
      if (!tA || !tB) return false;
      if (!teacherSubjSet.get(tA.id).has(req.subjectId)) return false;
      if (!teacherSubjSet.get(tB.id).has(req.swapSubjectId)) return false;
    } else if (req.type === "weekAlt") {
      const tA = teacherById.get(req.teacherId);
      const tB = teacherById.get(req.altTeacherId);
      if (!tA || !tB) return false;
      if (!teacherSubjSet.get(tA.id).has(req.subjectId)) return false;
      if (!teacherSubjSet.get(tB.id).has(req.altSubjectId)) return false;
    } else if (reqTeachers.some((t) => !teacherSubjSet.get(t.id).has(req.subjectId))) {
      return false;
    }
    if (new Set(reqTeacherIds).size !== reqTeacherIds.length) return false;
    return true;
  }
  const pending = [];
  for (const req of allRequests) {
    if (!isValidRequest(req)) continue;
    req.tids = (req.teacherIds || [req.teacherId]).filter(Boolean);
    req.rids = (req.roomIds || [req.roomId]).filter(Boolean);
    if (new Set(req.rids).size !== req.rids.length) req.roomDup = true;
    req.diff = difficulty(req);
    req.placedRef = null;
    req.cIdxs = req.classIds.map((cid) => cIdxOf.get(cid)).filter((x) => x !== undefined);
    req.tIdxs = req.tids.map((tid) => tIdxOf.get(tid)).filter((x) => x !== undefined);
    req.sIdx = sIdxOf.get(req.subjectId) ?? -1;
    req.swapSIdx = req.swapSubjectId ? (sIdxOf.get(req.swapSubjectId) ?? -1) : -1;
    req.roomArrs = req.rids.map((rid) => roomGrid(rid));
    // ——— Kunlik fan limiti (qattiq) ———
    req.dayCap = Math.max(
      dayCapFor(req.cIdxs, req.sIdx, req.blockSize),
      req.swapSIdx >= 0 ? dayCapFor(req.cIdxs, req.swapSIdx, req.blockSize) : 0
    );
    req.capRelax = 0;
    if (req.isCore) req.priority = (req.priority || 0) + 12;
    pending.push(req);
  }
  // ——— QATTIQ CHEKLOV: bir kunda bitta fan limitdan oshmasin ———
  // Bu "2 soat blok" yoqilganda ikkita blok bir kunga tushib 4 soat bo'lishini
  // va oddiy fan bir kunda bir necha marta takrorlanishini butunlay to'xtatadi.
  function subjDayOk(req, d) {
    if (req.sIdx < 0) return true;
    const cap = (req.dayCap || req.blockSize) + (req.capRelax || 0);
    const exD = req.placedRef && req.placedRef.active ? req.placedRef.d : -1;
    const bs = req.blockSize;
    for (const ci of req.cIdxs) {
      let n = classDailySubj[(ci * D + d) * S + req.sIdx];
      if (d === exD) n -= bs;
      if (n + bs > cap) return false;
      if (req.swapSIdx >= 0) {
        let m = classDailySubj[(ci * D + d) * S + req.swapSIdx];
        if (d === exD) m -= bs;
        if (m + bs > cap) return false;
      }
    }
    return true;
  }
  function buildDomain(req) {
    const dom = [];
    if (req.roomDup) return dom;
    for (let d = 0; d < D; d++) {
      let dayOk = true;
      for (const ci of req.cIdxs) if (classOffMask[ci * D + d]) { dayOk = false; break; }
      if (dayOk) for (const ti of req.tIdxs) if (teacherOffMask[ti * D + d]) { dayOk = false; break; }
      if (!dayOk) continue;
      for (let i = 0; i + req.blockSize <= T; i++) {
        let ok = true;
        for (let o = 0; o < req.blockSize; o++) {
          if (o > 0 && !nextConsecutive[i + o - 1]) { ok = false; break; }
          for (const ci of req.cIdxs) { if (lunchGrid[ci * DT + d * T + i + o] || slotClassBlock[ci * DT + d * T + i + o]) { ok = false; break; } }
          if (!ok) break;
        }
        if (ok) dom.push({ d, i });
      }
    }
    return shuffle(dom, rng);
  }
  pending.forEach((req) => { req.domain = buildDomain(req); });
  const reqsByTeacher = new Map();
  const reqsByClass = new Map();
  const reqsByRoom = new Map();
  function grabSet(map, key) {
    let s = map.get(key);
    if (!s) { s = new Set(); map.set(key, s); }
    return s;
  }
  pending.forEach((req) => {
    req.tids.forEach((id) => grabSet(reqsByTeacher, id).add(req));
    req.classIds.forEach((cid) => grabSet(reqsByClass, cid).add(req));
    req.rids.forEach((rid) => grabSet(reqsByRoom, rid).add(req));
  });
  pending.forEach((req) => {
    let deg = 0;
    req.tids.forEach((id) => (deg += (reqsByTeacher.get(id)?.size || 1) - 1));
    req.classIds.forEach((cid) => (deg += (reqsByClass.get(cid)?.size || 1) - 1));
    req.degree = deg;
    const set = new Set();
    req.tids.forEach((id) => reqsByTeacher.get(id)?.forEach((r) => { if (r !== req) set.add(r); }));
    req.classIds.forEach((cid) => reqsByClass.get(cid)?.forEach((r) => { if (r !== req) set.add(r); }));
    req.rids.forEach((rid) => reqsByRoom.get(rid)?.forEach((r) => { if (r !== req) set.add(r); }));
    req.affected = [...set];
  });
  function fitsAt(req, d, i) {
    if (!subjDayOk(req, d)) return false;
    const base = d * T + i;
    for (let o = 0; o < req.blockSize; o++) {
      const off = base + o;
      for (const ci of req.cIdxs) if (classGrid[ci * DT + off]) return false;
      for (const ti of req.tIdxs) if (teacherGrid[ti * DT + off]) return false;
      for (const rg of req.roomArrs) if (rg[off]) return false;
    }
    return true;
  }
  function loadAllows(req) {
    for (const ti of req.tIdxs) { if (teacherLoadArr[ti] + req.blockSize > teacherMaxArr[ti]) return false; }
    return true;
  }
  function refreshFeas(req) {
    let count = 0;
    const sample = [];
    for (const cand of req.domain) {
      if (fitsAt(req, cand.d, cand.i)) { count++; if (sample.length < 4) sample.push(cand); }
    }
    req.feasCount = count;
    req.feasSample = sample;
    req.dirty = false;
  }
  pending.forEach(refreshFeas);
  function markAffected(req) {
    for (const r of req.affected) {
      if (r.placedRef || r.failed) continue;
      if (r.feasCount !== undefined && r.feasCount <= 4) refreshFeas(r);
      else r.dirty = true;
    }
  }
  function buildEntries(req, blockIndex) {
    if (req.type === "swap") {
      const first = blockIndex === 0;
      const g1 = first ? { subjectId: req.subjectId, teacherId: req.teacherId, roomId: req.roomId }
        : { subjectId: req.swapSubjectId, teacherId: req.swapTeacherId, roomId: req.swapRoomId };
      const g2 = first ? { subjectId: req.swapSubjectId, teacherId: req.swapTeacherId, roomId: req.swapRoomId }
        : { subjectId: req.subjectId, teacherId: req.teacherId, roomId: req.roomId };
      return [
        { subjectId: g1.subjectId, classId: req.classIds[0], classIds: req.classIds, teacherId: g1.teacherId, roomId: g1.roomId || "", groupPart: req.groupName1, splitEnabled: true, swap: true, blockSize: 2, blockIndex },
        { subjectId: g2.subjectId, classId: req.classIds[0], classIds: req.classIds, teacherId: g2.teacherId, roomId: g2.roomId || "", groupPart: req.groupName2, splitEnabled: true, swap: true, blockSize: 2, blockIndex },
      ];
    }
    if (req.type === "weekAlt") {
      return [{
        subjectId: req.subjectId, classId: req.classIds[0], classIds: req.classIds,
        teacherId: req.teacherId, roomId: req.roomId || "",
        alternating: true, altSubjectId: req.altSubjectId, altTeacherId: req.altTeacherId,
        altRoomId: req.altRoomId || "", blockSize: 1, blockIndex,
      }];
    }
    if (req.type === "split") {
      return req.splitGroups.map((g) => ({
        subjectId: req.subjectId, classId: req.classIds[0], classIds: req.classIds,
        teacherId: g.teacherId, roomId: g.roomId || "", groupKey: req.groupKey || "",
        groupPart: g.groupPart, splitEnabled: true, blockSize: req.blockSize, blockIndex,
      }));
    }
    if (req.type === "levelGroup") {
      return req.levelGroups.map((g) => ({
        subjectId: req.subjectId, classId: req.classIds[0], classIds: req.classIds,
        teacherId: g.teacherId, roomId: g.roomId || "", groupKey: req.levelGroupKey || "",
        groupPart: g.name || "Daraja guruhi", levelGroupEnabled: true, blockSize: req.blockSize, blockIndex,
      }));
    }
    return [{
      subjectId: req.subjectId, classId: req.classIds[0], classIds: req.classIds,
      teacherId: req.teacherId, roomId: req.roomId || "", groupKey: req.groupKey || "",
      blockSize: req.blockSize, blockIndex,
    }];
  }
  function applyCounters(req, d, sign) {
    const bs = sign * req.blockSize;
    for (const ti of req.tIdxs) { teacherLoadArr[ti] += bs; teacherDailyArr[ti * D + d] += bs; }
    for (const ci of req.cIdxs) {
      classDailySubj[(ci * D + d) * S + req.sIdx] += bs;
      if (req.swapSIdx >= 0) classDailySubj[(ci * D + d) * S + req.swapSIdx] += bs;
      classDayCount[ci * D + d] += bs;
      bumpKeyIdx(ci, req.sIdx, bs);
      if (req.swapSIdx >= 0) bumpKeyIdx(ci, req.swapSIdx, bs);
    }
  }
  function place(req, d, i) {
    const day = DAYS[d];
    const slots = [];
    const entries = [];
    const base = d * T + i;
    for (let o = 0; o < req.blockSize; o++) {
      const ts = teachingTs[i + o];
      slots.push(ts);
      const cell = schedule[day][ts.id];
      const es = buildEntries(req, o);
      es.forEach((e) => cell.push(e));
      entries.push(...es);
      const off = base + o;
      for (const ci of req.cIdxs) classGrid[ci * DT + off] = 1;
      for (const ti of req.tIdxs) teacherGrid[ti * DT + off] = 1;
      for (const rg of req.roomArrs) rg[off] = 1;
    }
    applyCounters(req, d, +1);
    placedHours += req.blockSize;
    const p = { req, d, day, startIdx: i, slots, entries, locked: false, active: true };
    entries.forEach((e) => entryToPlacement.set(e, p));
    placements.push(p);
    req.placedRef = p;
    return p;
  }
  function unplace(p) {
    if (!p.active) return;
    p.active = false;
    const { req, d, day, startIdx } = p;
    const base = d * T + startIdx;
    for (let o = 0; o < req.blockSize; o++) {
      const ts = p.slots[o];
      schedule[day][ts.id] = schedule[day][ts.id].filter((e) => !p.entries.includes(e));
      const off = base + o;
      for (const ci of req.cIdxs) classGrid[ci * DT + off] = 0;
      for (const ti of req.tIdxs) teacherGrid[ti * DT + off] = 0;
      for (const rg of req.roomArrs) rg[off] = 0;
    }
    p.entries.forEach((e) => entryToPlacement.delete(e));
    applyCounters(req, d, -1);
    placedHours -= req.blockSize;
    const idx = placements.indexOf(p);
    if (idx >= 0) placements.splice(idx, 1);
    req.placedRef = null;
  }
  const journal = [];
  const chainTouched = new Set();
  function jPlace(req, d, i) { const p = place(req, d, i); journal.push({ op: "place", p }); chainTouched.add(req); return p; }
  function jUnplace(p) { unplace(p); journal.push({ op: "unplace", p }); chainTouched.add(p.req); }
  function rollbackTo(mark) {
    while (journal.length > mark) {
      const { op, p } = journal.pop();
      if (op === "place") unplace(p);
      else place(p.req, p.d, p.startIdx);
    }
  }
  function emptyBeforeCount(d, ci, idx) {
    const cBase = ci * DT + d * T;
    let empty = 0;
    for (let k = 0; k < idx; k++) {
      if (lunchGrid[cBase + k]) continue;
      if (classGrid[cBase + k]) continue;
      empty += 1;
    }
    return empty;
  }
  function adjacentSame(d, i, blockSize, req) {
    const day = DAYS[d];
    const checks = [];
    const before = i - 1;
    const after = i + blockSize;
    if (before >= 0 && nextConsecutive[before]) checks.push(before);
    if (after < T && nextConsecutive[after - 1]) checks.push(after);
    for (const k of checks) {
      const cell = schedule[day][teachingTs[k].id];
      for (const l of cell) {
        if (l.subjectId !== req.subjectId) continue;
        const ids = classIdsOf(l);
        for (const cid of req.classIds) if (ids.includes(cid)) return true;
      }
    }
    return false;
  }
  function forwardCheckPenalty(req, d, i) {
    let penalty = 0;
    const bEnd = i + req.blockSize - 1;
    for (const other of req.affected) {
      if (other.placedRef || other.failed) continue;
      const fc = other.feasCount;
      if (fc === undefined || fc > 3 || fc === 0) continue;
      let killed = 0;
      for (const cand of other.feasSample) {
        if (cand.d !== d) continue;
        const aStart = cand.i;
        const aEnd = cand.i + other.blockSize - 1;
        if (aStart > bEnd || aEnd < i) continue;
        killed += 1;
      }
      if (killed >= fc) penalty += 1e6;
      else if (killed > 0) penalty += killed * 220;
    }
    return penalty;
  }
  // ——— ORA KUNDA jarimasi ———
  function spacedPenalty(req, d) {
    if (!req.spacedDays || req.sIdx < 0) return 0;
    let p = 0;
    for (const ci of req.cIdxs) {
      const same = classDailySubj[(ci * D + d) * S + req.sIdx];
      if (same > 0) p += same * SPACED_W * 2;
      if (d - 1 >= 0 && classDailySubj[(ci * D + (d - 1)) * S + req.sIdx] > 0) p += SPACED_W;
      if (d + 1 < D && classDailySubj[(ci * D + (d + 1)) * S + req.sIdx] > 0) p += SPACED_W;
    }
    return p;
  }
  function scoreCandidate(req, d, i) {
    const blockSize = req.blockSize;
    const adjacencyPenalty = blockSize === 1 && adjacentSame(d, i, blockSize, req) ? 1500 : 0;
    let compactPenalty = 0;
    for (const ci of req.cIdxs) { for (let o = 0; o < blockSize; o++) { compactPenalty += emptyBeforeCount(d, ci, i + o) * 100; } }
    let repeatPenalty = 0;
    for (const ci of req.cIdxs) { repeatPenalty += classDailySubj[(ci * D + d) * S + req.sIdx] * REPEAT_HARD_W; }
    const spreadPenalty = Math.abs((d % 2) - (blockSize === 2 ? 0 : 1));
    let classLoadPenalty = 0;
    for (const ci of req.cIdxs) { classLoadPenalty += classDayCount[ci * D + d]; }
    // Kunlik me'yordan oshib ketmasin — darslar kunlarga teng tarqalsin
    let dayCapPenalty = 0;
    for (const ci of req.cIdxs) {
      const n = classDayCount[ci * D + d] + blockSize;
      if (n > balHi[ci]) dayCapPenalty += (n - balHi[ci]) * DAYCAP_W;
    }
    let teacherPenalty = 0;
    for (const ti of req.tIdxs) { teacherPenalty += teacherLoadArr[ti] + teacherDailyArr[ti * D + d]; }
    // ——— ASOSIY FAN: erta soatlarga tortish ———
    let corePenalty = 0;
    for (const ci of req.cIdxs) {
      const r = slotRank[ci * DT + d * T + i];
      if (r < 0) continue;
      if (req.isCore) {
        corePenalty += r * CORE_EARLY_W;
        if (r > 2) corePenalty += (r - 2) * CORE_LATE_W;
      } else if (r < 3) {
        corePenalty += (3 - r) * NONCORE_EARLY_W;
      }
    }
    const spacedPen = spacedPenalty(req, d);
    const randomPenalty = rng() * 5;
    return compactPenalty + repeatPenalty + classLoadPenalty + teacherPenalty + spreadPenalty + corePenalty + adjacencyPenalty + dayCapPenalty + spacedPen + randomPenalty;
  }
  function bestCandidate(req, withForwardCheck) {
    let best = null;
    let bestScore = Infinity;
    for (const cand of req.domain) {
      if (!fitsAt(req, cand.d, cand.i)) continue;
      let s = scoreCandidate(req, cand.d, cand.i);
      if (withForwardCheck) s += forwardCheckPenalty(req, cand.d, cand.i);
      if (s < bestScore) { bestScore = s; best = cand; }
    }
    return best;
  }
  const DAYCAP_W = 800;
  const SPACED_W = 900;
  const REPEAT_HARD_W = 260; // bir kunda fan takrorlansa — sezilarli jarima
  // ——— ASOSIY FAN og'irliklari ———
  const CORE_EARLY_W = 420;
  const CORE_LATE_W = 2200;
  const NONCORE_EARLY_W = 80;
  const CORE_C_W = 420;
  const EJECT_DEFAULT = { maxDepth: 3, blockersRoot: 3, blockersDeep: 2, tryRoot: 14, tryDeep: 6 };
  const EJECT_INTENSE = { maxDepth: 4, blockersRoot: 5, blockersDeep: 3, tryRoot: 28, tryDeep: 10 };
  function collectBlockers(req, d, i, frozen, maxBlockers) {
    const day = DAYS[d];
    const blockers = new Set();
    for (let o = 0; o < req.blockSize; o++) {
      const ts = teachingTs[i + o];
      const cell = schedule[day][ts.id];
      for (const l of cell) {
        const conflicts = classIdsOf(l).some((cid) => req.classIds.includes(cid)) ||
          (l.teacherId && req.tids.includes(l.teacherId)) || (l.roomId && req.rids.includes(l.roomId));
        if (!conflicts) continue;
        const p = entryToPlacement.get(l);
        if (!p || p.locked || frozen.has(p)) return null;
        blockers.add(p);
        if (blockers.size > maxBlockers) return null;
      }
    }
    return [...blockers];
  }
  function tryEject(req, depth, frozen, cfg) {
    if (Date.now() > deadline) return false;
    if (!loadAllows(req)) return false;
    const maxBlockers = depth === 1 ? cfg.blockersRoot : cfg.blockersDeep;
    const direct = bestCandidate(req, false);
    if (direct) { const p = jPlace(req, direct.d, direct.i); frozen.add(p); return true; }
    if (depth > cfg.maxDepth) return false;
    const cands = [];
    for (const cand of req.domain) {
      const blockers = collectBlockers(req, cand.d, cand.i, frozen, maxBlockers);
      if (blockers && blockers.length) cands.push({ cand, count: blockers.length });
    }
    cands.sort((a, b) => a.count - b.count);
    const tryLimit = depth === 1 ? cfg.tryRoot : cfg.tryDeep;
    for (let c = 0; c < Math.min(cands.length, tryLimit); c++) {
      const { cand } = cands[c];
      const blockers = collectBlockers(req, cand.d, cand.i, frozen, maxBlockers);
      if (!blockers) continue;
      if (!blockers.length) {
        if (fitsAt(req, cand.d, cand.i)) { const p = jPlace(req, cand.d, cand.i); frozen.add(p); return true; }
        continue;
      }
      const mark = journal.length;
      blockers.forEach((b) => jUnplace(b));
      if (!fitsAt(req, cand.d, cand.i)) { rollbackTo(mark); continue; }
      const myP = jPlace(req, cand.d, cand.i);
      frozen.add(myP);
      let ok = true;
      for (const b of blockers) { if (!tryEject(b.req, depth + 1, frozen, cfg)) { ok = false; break; } }
      if (ok) return true;
      frozen.delete(myP);
      rollbackTo(mark);
    }
    return false;
  }
  function ejectAndPlace(req, cfg = EJECT_DEFAULT) {
    const frozen = new Set();
    chainTouched.clear();
    const mark = journal.length;
    const ok = tryEject(req, 1, frozen, cfg);
    if (!ok) rollbackTo(mark);
    journal.length = 0;
    chainTouched.add(req);
    for (const r of chainTouched) markAffected(r);
    if (!req.placedRef) refreshFeas(req);
    chainTouched.clear();
    return ok;
  }
  const open = pending.filter((r) => r.domain.length > 0);
  pending.forEach((r) => { if (!r.domain.length) r.failed = true; });
  const deferred = [];
  function pickMRV() {
    for (let iter = 0; iter < 5; iter++) {
      let sel = null;
      for (const r of open) {
        if (r.placedRef || r.done) continue;
        if (!sel || r.feasCount < sel.feasCount ||
          (r.feasCount === sel.feasCount && (r.degree > sel.degree ||
            (r.degree === sel.degree && (r.diff > sel.diff || (r.diff === sel.diff && r.priority > sel.priority)))))) sel = r;
      }
      if (!sel) return null;
      if (!sel.dirty) return sel;
      refreshFeas(sel);
    }
    let sel = null;
    for (const r of open) {
      if (r.placedRef || r.done) continue;
      if (r.dirty) refreshFeas(r);
      if (!sel || r.feasCount < sel.feasCount) sel = r;
    }
    return sel;
  }
  let remainingOpen = open.length;
  while (remainingOpen > 0) {
    if (Date.now() > deadline) {
      for (const r of open) {
        if (r.placedRef || r.done) continue;
        r.done = true;
        remainingOpen -= 1;
        if (!loadAllows(r)) { r.failed = true; continue; }
        attemptedHours += r.blockSize;
        const cand = bestCandidate(r, false);
        if (cand) place(r, cand.d, cand.i);
        else deferred.push(r);
      }
      break;
    }
    const sel = pickMRV();
    if (!sel) break;
    sel.done = true;
    remainingOpen -= 1;
    if (!loadAllows(sel)) { sel.failed = true; continue; }
    attemptedHours += sel.blockSize;
    if (sel.dirty) refreshFeas(sel);
    if (sel.feasCount > 0) {
      const cand = bestCandidate(sel, true);
      if (cand) { place(sel, cand.d, cand.i); markAffected(sel); continue; }
    }
    if (!ejectAndPlace(sel)) deferred.push(sel);
  }
  let wave = 0;
  while (deferred.length && Date.now() < deadline && wave < 14) {
    const cfg = wave < 3 ? EJECT_DEFAULT : EJECT_INTENSE;
    // Uzoq urinishdan keyin kunlik fan limiti bittaga yumshatiladi —
    // aks holda joylashmagan soat qolib ketishi mumkin (limit "iloji boricha" shart).
    if (wave === 5 || wave === 9) {
      for (const r of deferred) r.capRelax = Math.min(2, (r.capRelax || 0) + 1);
    }
    const still = [];
    for (const req of shuffle(deferred, rng)) {
      if (Date.now() > deadline) { still.push(req); continue; }
      refreshFeas(req);
      if (req.feasCount > 0) {
        const cand = bestCandidate(req, false);
        if (cand) { place(req, cand.d, cand.i); markAffected(req); continue; }
      }
      req.domain = shuffle(req.domain, rng);
      if (!ejectAndPlace(req, cfg)) still.push(req);
    }
    if (still.length === deferred.length && wave >= 3) { deferred.length = 0; deferred.push(...still); break; }
    deferred.length = 0;
    deferred.push(...still);
    wave += 1;
  }
  let lnsRound = 0;
  while (deferred.length && Date.now() < deadline && lnsRound < 40) {
    lnsRound += 1;
    const target = deferred[lnsRound % deferred.length];
    const victims = [];
    const shuffledAff = shuffle(target.affected, rng);
    for (const r of shuffledAff) { if (victims.length >= 6) break; if (r.placedRef && !r.placedRef.locked) victims.push(r); }
    if (!victims.length) continue;
    const savedPos = victims.map((r) => ({ r, d: r.placedRef.d, i: r.placedRef.startIdx }));
    victims.forEach((r) => unplace(r.placedRef));
    const toPlace = [target, ...victims].sort((a, b) => b.diff - a.diff);
    const failedNow = [];
    for (const r of toPlace) {
      if (r.placedRef) continue;
      refreshFeas(r);
      let cand = r.feasCount > 0 ? bestCandidate(r, false) : null;
      if (cand) { place(r, cand.d, cand.i); continue; }
      if (!ejectAndPlace(r, EJECT_INTENSE)) failedNow.push(r);
    }
    if (failedNow.length === 0) {
      const di = deferred.indexOf(target);
      if (di >= 0) deferred.splice(di, 1);
      for (const r of victims) markAffected(r);
      markAffected(target);
    } else {
      for (const r of toPlace) { if (r.placedRef && !r.placedRef.locked) unplace(r.placedRef); }
      for (const { r, d, i } of savedPos) {
        if (fitsAt(r, d, i)) place(r, d, i);
        else {
          refreshFeas(r);
          const cand = r.feasCount > 0 ? bestCandidate(r, false) : null;
          if (cand) place(r, cand.d, cand.i);
          else if (!ejectAndPlace(r, EJECT_INTENSE)) { if (!deferred.includes(r)) deferred.push(r); }
        }
      }
      for (const { r } of savedPos) markAffected(r);
    }
  }
  for (const cls of classes) {
    if (Date.now() > deadline) break;
    const raws = classSubjects[cls.id] || [];
    for (const raw of raws) {
      const subj = subjectById.get(raw.subjectId);
      if (!subj) continue;
      const a = normalizeAssignment(raw, subj);
      if (a.levelGroupEnabled || a.splitEnabled || a.swapEnabled || a.weekAltEnabled || a.groupKey) continue;
      const tid = a.teacherId;
      if (!tid) continue;
      const t = teacherById.get(tid);
      if (!t || !teacherSubjSet.get(tid).has(a.subjectId)) continue;
      let remaining = Number(a.weeklyHours || 0) - getPlacedKey(cls.id, a.subjectId);
      let guard = 0;
      while (remaining > 0 && guard < 100) {
        guard += 1;
        const ti = tIdxOf.get(tid);
        if (ti === undefined || teacherLoadArr[ti] + 1 > teacherMaxArr[ti]) break;
        const ciFill = cIdxOf.get(cls.id);
        const sIdxFill = sIdxOf.get(a.subjectId) ?? -1;
        const fReq = {
          type: "single", classIds: [cls.id], subjectId: a.subjectId, teacherId: tid, roomId: a.roomId || "",
          tids: [tid], rids: a.roomId ? [a.roomId] : [], blockSize: 1, isCore: a.isCore, priority: 0, domain: null,
          spacedDays: a.spacedDays,
          cIdxs: [ciFill].filter((x) => x !== undefined), tIdxs: [ti], sIdx: sIdxFill,
          swapSIdx: -1, roomArrs: a.roomId ? [roomGrid(a.roomId)] : [], affected: [], diff: 0,
          dayCap: dayCapFor([ciFill].filter((x) => x !== undefined), sIdxFill, 1), capRelax: 1,
        };
        fReq.domain = buildDomain(fReq);
        let cand = bestCandidate(fReq, false);
        if (!cand) { if (!ejectAndPlace(fReq, EJECT_INTENSE)) break; remaining -= 1; continue; }
        place(fReq, cand.d, cand.i);
        remaining -= 1;
      }
    }
  }
  function polish(budgetMs) {
    const stop = Math.min(deadline, Date.now() + budgetMs);
    const movable = placements.filter((p) => !p.locked);
    if (!movable.length) return;
    let temperature = 60;
    while (Date.now() < stop) {
      for (let k = 0; k < 16; k++) {
        const p = movable[Math.floor(rng() * movable.length)];
        if (!p || p.req.placedRef !== p) continue;
        const req = p.req;
        const oldD = p.d;
        const oldIdx = p.startIdx;
        unplace(p);
        const oldScore = scoreCandidate(req, oldD, oldIdx);
        let cand = null;
        let candScore = Infinity;
        for (let tr = 0; tr < 6; tr++) {
          const c = req.domain[Math.floor(rng() * req.domain.length)];
          if (!c || !fitsAt(req, c.d, c.i)) continue;
          const s = scoreCandidate(req, c.d, c.i);
          if (s < candScore) { candScore = s; cand = c; }
        }
        const delta = candScore - oldScore;
        if (cand && (delta < 0 || rng() < Math.exp(-delta / Math.max(1, temperature)))) {
          const np = place(req, cand.d, cand.i);
          const mi = movable.indexOf(p);
          if (mi >= 0) movable[mi] = np;
        } else {
          place(req, oldD, oldIdx);
          const np = req.placedRef;
          const mi = movable.indexOf(p);
          if (mi >= 0 && np) movable[mi] = np;
        }
      }
      temperature *= 0.96;
      if (temperature < 0.5) temperature = 0.5;
    }
  }
  if (placedHours >= attemptedHours && attemptedHours > 0 && polishBudgetMs > 0) {
    polish(Math.min(polishBudgetMs, Math.max(0, deadline - Date.now())));
  }
  // ——— ZICHLASH (compaction) ———
  const GAP_W = 1000;
  const BAL_W = 900;
  const REPEAT_W = 260;
  const ADJ_W = 260;
  const SPACED_C_W = 600;

  let _lastGap = 0;
  function compactCost(cIdxs) {
    let cost = 0;
    let gaps = 0;
    for (const ci of cIdxs) {
      for (let d = 0; d < D; d++) {
        const cBase = ci * DT + d * T;
        let free = 0;
        let head = 0;
        for (let k = 0; k < T; k++) {
          if (lunchGrid[cBase + k] || slotClassBlock[cBase + k]) continue;
          if (classGrid[cBase + k]) head += free;
          else free += 1;
        }
        gaps += head;
        if (dayUsable[ci * D + d]) {
          const n = classDayCount[ci * D + d];
          const dev = n > balHi[ci] ? n - balHi[ci] : (n < balLo[ci] ? balLo[ci] - n : 0);
          cost += dev * dev * BAL_W;
        }
      }
    }
    _lastGap = gaps;
    return cost;
  }

  // Jadvaldagi barcha "oyna"lar (kun boshidagi va oradagi bo'sh darslar)
  function headGapsOf(cIdxs) {
    let gaps = 0;
    for (const ci of cIdxs) {
      for (let d = 0; d < D; d++) {
        const cBase = ci * DT + d * T;
        let free = 0;
        let head = 0;
        for (let k = 0; k < T; k++) {
          if (lunchGrid[cBase + k] || slotClassBlock[cBase + k]) continue;
          if (classGrid[cBase + k]) head += free;
          else free += 1;
        }
        gaps += head;
      }
    }
    return gaps;
  }

  function markBits(req, d, i, val) {
    const base = d * T + i;
    for (let o = 0; o < req.blockSize; o++) {
      const off = base + o;
      for (const ci of req.cIdxs) classGrid[ci * DT + off] = val;
      for (const ti of req.tIdxs) teacherGrid[ti * DT + off] = val;
      for (const rg of req.roomArrs) rg[off] = val;
    }
    const delta = val ? req.blockSize : -req.blockSize;
    for (const ci of req.cIdxs) classDayCount[ci * D + d] += delta;
  }

  function repeatCostAt(req, dd, oldD) {
    let c = 0;
    for (const ci of req.cIdxs) {
      let n = classDailySubj[(ci * D + dd) * S + req.sIdx];
      if (dd === oldD) n -= req.blockSize;
      if (n > 0) c += n * REPEAT_W;
    }
    return c;
  }

  function spacedCostAt(req, dd, oldD) {
    if (!req.spacedDays || req.sIdx < 0) return 0;
    let c = 0;
    for (const ci of req.cIdxs) {
      for (let k = -1; k <= 1; k++) {
        const nd = dd + k;
        if (nd < 0 || nd >= D) continue;
        let n = classDailySubj[(ci * D + nd) * S + req.sIdx];
        if (nd === oldD) n -= req.blockSize;
        if (n > 0) c += k === 0 ? n * SPACED_C_W * 2 : SPACED_C_W;
      }
    }
    return c;
  }

  function coreCostAt(req, dd, ii) {
    let c = 0;
    for (const ci of req.cIdxs) {
      const r = slotRank[ci * DT + dd * T + ii];
      if (r < 0) continue;
      if (req.isCore) c += r * CORE_C_W;
      else if (r < 3) c += (3 - r) * 30;
    }
    return c;
  }

  function compactPass(budgetMs) {
    if (!placements.length) return 0;
    const stop = Date.now() + Math.max(120, budgetMs);
    let totalMoved = 0;
    let round = 0;
    let moved = 1;
    while (moved > 0 && round < 12 && Date.now() < stop) {
      round += 1;
      moved = 0;
      const shuffled = shuffle(placements.filter((p) => !p.locked), rng);
      const list = [...shuffled.filter((p) => p.req.isCore), ...shuffled.filter((p) => !p.req.isCore)];
      for (const p of list) {
        if (Date.now() > stop) break;
        const req = p.req;
        if (!p.active || req.placedRef !== p) continue;
        if (!req.domain || req.domain.length < 2) continue;
        const oldD = p.d;
        const oldI = p.startIdx;
        const baseCost = compactCost(req.cIdxs) + repeatCostAt(req, oldD, oldD) + spacedCostAt(req, oldD, oldD) + coreCostAt(req, oldD, oldI);
        const baseGap = _lastGap;
        markBits(req, oldD, oldI, 0);
        let bestD = -1;
        let bestI = -1;
        let bestCost = baseCost;
        let bestGap = baseGap;
        for (const cand of req.domain) {
          if (cand.d === oldD && cand.i === oldI) continue;
          if (!fitsAt(req, cand.d, cand.i)) continue;
          markBits(req, cand.d, cand.i, 1);
          let c = compactCost(req.cIdxs) + repeatCostAt(req, cand.d, oldD) + spacedCostAt(req, cand.d, oldD) + coreCostAt(req, cand.d, cand.i);
          const g = _lastGap;
          markBits(req, cand.d, cand.i, 0);
          if (req.blockSize === 1 && adjacentSame(cand.d, cand.i, 1, req)) c += ADJ_W;
          if (g < bestGap || (g === bestGap && c < bestCost)) { bestGap = g; bestCost = c; bestD = cand.d; bestI = cand.i; }
        }
        markBits(req, oldD, oldI, 1);
        if (bestD >= 0) {
          unplace(p);
          place(req, bestD, bestI);
          moved += 1;
        }
      }
      totalMoved += moved;
    }
    return totalMoved;
  }

  function singleBlockerAt(req, d, i) {
    const day = DAYS[d];
    const set = new Set();
    for (let o = 0; o < req.blockSize; o++) {
      const cell = schedule[day][teachingTs[i + o].id];
      for (const l of cell) {
        const conflict = classIdsOf(l).some((cid) => req.classIds.includes(cid)) ||
          (l.teacherId && req.tids.includes(l.teacherId)) ||
          (l.roomId && req.rids.includes(l.roomId));
        if (!conflict) continue;
        const q = entryToPlacement.get(l);
        if (!q || q.locked || !q.active) return null;
        set.add(q);
        if (set.size > 1) return null;
      }
    }
    return set.size === 1 ? [...set][0] : null;
  }

  function inDomain(req, d, i) {
    if (!req.domain) return false;
    for (const c of req.domain) if (c.d === d && c.i === i) return true;
    return false;
  }

  // ——— OYNA TO'LDIRISH (kun boshidagi bo'sh katak) ———
  // Kun boshida yoki o'rtasida bo'sh katak qolsa, o'sha kundagi keyingi darslardan
  // birini shu katakka tortadi. To'g'ridan-to'g'ri bo'lmasa — to'siq darslarni
  // zanjir bilan boshqa joyga ko'chirib bo'shatadi (ejection chain). Har bir
  // harakat faqat umumiy oynalar soni KAMAYSA qabul qilinadi.
  function tryFillHole(ci, d, holeIdx) {
    const list = [];
    for (const p of placements) {
      if (!p.active || p.locked || p.d !== d) continue;
      if (p.req.placedRef !== p) continue;
      if (!p.req.cIdxs.includes(ci)) continue;
      if (p.startIdx <= holeIdx) continue;
      list.push(p);
    }
    if (!list.length) return false;
    list.sort((a, b) => a.startIdx - b.startIdx);
    const gapBefore = headGapsOf(ALL_C);
    for (const p of list) {
      if (Date.now() > deadline) return false;
      const req = p.req;
      if (!inDomain(req, d, holeIdx)) continue;
      const mark = journal.length;
      jUnplace(p);
      let done = false;
      if (fitsAt(req, d, holeIdx)) {
        jPlace(req, d, holeIdx);
        done = headGapsOf(ALL_C) < gapBefore;
      } else {
        const frozen = new Set();
        const blockers = collectBlockers(req, d, holeIdx, frozen, 3);
        if (blockers && blockers.length) {
          blockers.forEach((b) => jUnplace(b));
          if (fitsAt(req, d, holeIdx)) {
            const np = jPlace(req, d, holeIdx);
            frozen.add(np);
            let ok = true;
            for (const b of blockers) {
              if (!tryEject(b.req, 2, frozen, EJECT_DEFAULT)) { ok = false; break; }
            }
            done = ok && headGapsOf(ALL_C) < gapBefore;
          }
        }
      }
      if (done) { journal.length = 0; return true; }
      rollbackTo(mark);
      journal.length = 0;
    }
    return false;
  }

  function pullUpPass(budgetMs) {
    const stop = Date.now() + Math.max(150, budgetMs);
    let fixed = 0;
    for (let ci = 0; ci < C; ci++) {
      for (let d = 0; d < D; d++) {
        if (Date.now() > stop) return fixed;
        let guard = 0;
        while (guard < 8) {
          guard += 1;
          const cBase = ci * DT + d * T;
          let hole = -1;
          let lastOcc = -1;
          for (let k = 0; k < T; k++) {
            if (lunchGrid[cBase + k] || slotClassBlock[cBase + k]) continue;
            if (classGrid[cBase + k]) lastOcc = k;
            else if (hole < 0) hole = k;
          }
          if (hole < 0 || lastOcc < hole) break;
          if (!tryFillHole(ci, d, hole)) break;
          fixed += 1;
        }
      }
    }
    return fixed;
  }

  function trySwap(p, q) {
    const rp = p.req;
    const rq = q.req;
    if (rp === rq) return false;
    if (!p.active || !q.active || rp.placedRef !== p || rq.placedRef !== q) return false;
    if (!rp.domain || !rq.domain) return false;
    const pd = p.d, pi = p.startIdx, qd = q.d, qi = q.startIdx;
    if (!inDomain(rp, qd, qi) || !inDomain(rq, pd, pi)) return false;
    const seen = new Set();
    const union = [];
    for (const ci of rp.cIdxs) if (!seen.has(ci)) { seen.add(ci); union.push(ci); }
    for (const ci of rq.cIdxs) if (!seen.has(ci)) { seen.add(ci); union.push(ci); }
    const base = compactCost(union) + repeatCostAt(rp, pd, pd) + repeatCostAt(rq, qd, qd)
      + spacedCostAt(rp, pd, pd) + spacedCostAt(rq, qd, qd)
      + coreCostAt(rp, pd, pi) + coreCostAt(rq, qd, qi);
    const baseGap = _lastGap;
    let afterGap = Infinity;
    markBits(rp, pd, pi, 0);
    markBits(rq, qd, qi, 0);
    let okFit = false;
    let after = Infinity;
    if (fitsAt(rp, qd, qi)) {
      markBits(rp, qd, qi, 1);
      if (fitsAt(rq, pd, pi)) {
        markBits(rq, pd, pi, 1);
        okFit = true;
        after = compactCost(union) + repeatCostAt(rp, qd, pd) + repeatCostAt(rq, pd, qd)
          + spacedCostAt(rp, qd, pd) + spacedCostAt(rq, pd, qd)
          + coreCostAt(rp, qd, qi) + coreCostAt(rq, pd, pi);
        afterGap = _lastGap;
        markBits(rq, pd, pi, 0);
      }
      markBits(rp, qd, qi, 0);
    }
    markBits(rp, pd, pi, 1);
    markBits(rq, qd, qi, 1);
    if (!okFit) return false;
    if (afterGap > baseGap) return false;
    if (afterGap === baseGap && after >= base) return false;
    unplace(p);
    unplace(q);
    place(rp, qd, qi);
    place(rq, pd, pi);
    return true;
  }

  function swapPass(budgetMs) {
    const stop = Date.now() + Math.max(120, budgetMs);
    let n = 0;
    const list = shuffle(placements.filter((p) => !p.locked), rng);
    for (const p of list) {
      if (Date.now() > stop) break;
      const req = p.req;
      if (!p.active || req.placedRef !== p || !req.domain) continue;
      for (const cand of req.domain) {
        if (cand.d === p.d && cand.i === p.startIdx) continue;
        if (fitsAt(req, cand.d, cand.i)) continue;
        const q = singleBlockerAt(req, cand.d, cand.i);
        if (!q) continue;
        if (trySwap(p, q)) { n += 1; break; }
      }
    }
    return n;
  }

  // ——— ASOSIY FAN TARTIBI ———
  function tryCoreSwap(p, q) {
    const rp = p.req;
    const rq = q.req;
    if (rp === rq) return false;
    if (!p.active || !q.active || rp.placedRef !== p || rq.placedRef !== q) return false;
    if (!rp.domain || !rq.domain) return false;
    if (rp.blockSize !== rq.blockSize) return false;
    const pd = p.d, pi = p.startIdx, qd = q.d, qi = q.startIdx;
    if (!inDomain(rp, qd, qi) || !inDomain(rq, pd, pi)) return false;
    const uni = unionIdx(rp.cIdxs, rq.cIdxs);
    compactCost(uni);
    const gapBefore = _lastGap;
    markBits(rp, pd, pi, 0);
    markBits(rq, qd, qi, 0);
    let ok = false;
    if (fitsAt(rp, qd, qi)) {
      markBits(rp, qd, qi, 1);
      if (fitsAt(rq, pd, pi)) {
        markBits(rq, pd, pi, 1);
        compactCost(uni);
        ok = _lastGap <= gapBefore;
        markBits(rq, pd, pi, 0);
      }
      markBits(rp, qd, qi, 0);
    }
    markBits(rp, pd, pi, 1);
    markBits(rq, qd, qi, 1);
    if (!ok) return false;
    unplace(p);
    unplace(q);
    place(rp, qd, qi);
    place(rq, pd, pi);
    return true;
  }

  function tryCoreEvict(p, q) {
    const rp = p.req;
    const rq = q.req;
    if (rp === rq) return false;
    if (!p.active || !q.active || rp.placedRef !== p || rq.placedRef !== q) return false;
    if (!rp.domain || !rq.domain) return false;
    const pd = p.d, pi = p.startIdx, qd = q.d, qi = q.startIdx;
    if (!inDomain(rq, pd, pi)) return false;
    const uni = unionIdx(rp.cIdxs, rq.cIdxs);
    const costBefore = compactCost(uni) + repeatCostAt(rp, pd, pd) + spacedCostAt(rp, pd, pd);
    const gapBefore = _lastGap;
    for (const cand of rp.domain) {
      if (cand.d === pd && cand.i === pi) continue;
      markBits(rp, pd, pi, 0);
      markBits(rq, qd, qi, 0);
      let ok = false;
      if (fitsAt(rq, pd, pi)) {
        markBits(rq, pd, pi, 1);
        if (fitsAt(rp, cand.d, cand.i)) {
          markBits(rp, cand.d, cand.i, 1);
          const costAfter = compactCost(uni) + repeatCostAt(rp, cand.d, pd) + spacedCostAt(rp, cand.d, pd);
          const gapAfter = _lastGap;
          ok = gapAfter <= gapBefore && costAfter <= costBefore + BAL_W;
          markBits(rp, cand.d, cand.i, 0);
        }
        markBits(rq, pd, pi, 0);
      }
      markBits(rp, pd, pi, 1);
      markBits(rq, qd, qi, 1);
      if (ok) {
        unplace(p);
        unplace(q);
        place(rq, pd, pi);
        place(rp, cand.d, cand.i);
        return true;
      }
    }
    return false;
  }

  // ——— KEMPE ZANJIRI ———
  function resOfReq(req) {
    const r = [];
    for (const t of req.tids) r.push("T" + t);
    for (const x of req.rids) r.push("R" + x);
    for (const c of req.classIds) r.push("C" + c);
    return r;
  }
  function resOfLesson(l) {
    const r = [];
    if (l.teacherId) r.push("T" + l.teacherId);
    if (l.altTeacherId) r.push("T" + l.altTeacherId);
    if (l.roomId) r.push("R" + l.roomId);
    classIdsOf(l).forEach((c) => { if (c) r.push("C" + c); });
    return r;
  }
  function tryChainSlotSwap(seedA, seedB) {
    if (!seedA.active || !seedB.active) return false;
    if (seedA.req.placedRef !== seedA || seedB.req.placedRef !== seedB) return false;
    if (seedA.req.blockSize !== 1 || seedB.req.blockSize !== 1) return false;
    const d = seedA.d;
    if (seedB.d !== d) return false;
    const i = seedA.startIdx;
    const j = seedB.startIdx;
    if (i === j) return false;
    const day = DAYS[d];
    const gather = (idx) => {
      const map = new Map();
      for (const l of schedule[day][teachingTs[idx].id]) {
        const p = entryToPlacement.get(l);
        if (!p) return null;
        if (p.locked) {
          for (const r of resOfLesson(l)) map.set(r, "LOCKED");
          continue;
        }
        for (const r of resOfReq(p.req)) map.set(r, p);
      }
      return map;
    };
    const gi = gather(i);
    const gj = gather(j);
    if (!gi || !gj) return false;
    const chain = new Set([seedA, seedB]);
    const queue = [seedA, seedB];
    while (queue.length) {
      const p = queue.pop();
      if (!p.active || p.req.placedRef !== p) return false;
      if (p.req.blockSize !== 1) return false;
      if (chain.size > 12) return false;
      const there = p.startIdx === i ? gj : gi;
      for (const r of resOfReq(p.req)) {
        const q = there.get(r);
        if (q === "LOCKED") return false;
        if (q && !chain.has(q)) { chain.add(q); queue.push(q); }
      }
    }
    for (const p of chain) {
      const target = p.startIdx === i ? j : i;
      if (!p.req.domain || !inDomain(p.req, d, target)) return false;
    }
    let uni = [];
    for (const p of chain) uni = unionIdx(uni, p.req.cIdxs);
    compactCost(uni);
    const gapBefore = _lastGap;
    let coreBefore = 0;
    for (const p of chain) coreBefore += coreCostAt(p.req, d, p.startIdx);
    const saved = [...chain].map((p) => ({ req: p.req, fromI: p.startIdx }));
    for (const p of [...chain]) unplace(p);
    let ok = true;
    for (const m of saved) {
      const target = m.fromI === i ? j : i;
      if (!fitsAt(m.req, d, target)) { ok = false; break; }
      place(m.req, d, target);
    }
    if (ok) {
      compactCost(uni);
      let coreAfter = 0;
      for (const m of saved) {
        const pr = m.req.placedRef;
        coreAfter += coreCostAt(m.req, pr.d, pr.startIdx);
      }
      if (_lastGap > gapBefore || coreAfter >= coreBefore) ok = false;
    }
    if (!ok) {
      for (const m of saved) { const cur = m.req.placedRef; if (cur && cur.active) unplace(cur); }
      for (const m of saved) place(m.req, d, m.fromI);
      return false;
    }
    return true;
  }

  function tryCoreShift(list, x, d) {
    const a = list[x];
    const ra = a.req;
    if (!a.active || ra.placedRef !== a || !ra.domain) return false;
    if (ra.blockSize !== 1) return false;
    for (let y = x + 1; y < list.length; y++) {
      const p = list[y];
      if (p.req.blockSize !== 1) return false;
      if (!p.active || p.req.placedRef !== p || !p.req.domain) return false;
    }
    const reqs = [ra];
    for (let y = x + 1; y < list.length; y++) reqs.push(list[y].req);
    let uni = [];
    for (const r of reqs) uni = unionIdx(uni, r.cIdxs);
    const costBefore = compactCost(uni)
      + repeatCostAt(ra, a.d, a.d) + spacedCostAt(ra, a.d, a.d);
    const gapBefore = _lastGap;
    let coreBefore = coreCostAt(ra, a.d, a.startIdx);
    for (let y = x + 1; y < list.length; y++) {
      coreBefore += coreCostAt(list[y].req, list[y].d, list[y].startIdx);
    }
    const moves = reqs.map((r) => ({ req: r, fromD: r.placedRef.d, fromI: r.placedRef.startIdx }));
    const undo = () => {
      for (const m of moves) { const cur = m.req.placedRef; if (cur && cur.active) unplace(cur); }
      for (const m of moves) { place(m.req, m.fromD, m.fromI); }
    };
    unplace(a);
    let ok = true;
    let hole = moves[0].fromI;
    for (let y = 1; y < moves.length; y++) {
      const r = moves[y].req;
      const from = moves[y].fromI;
      if (!inDomain(r, d, hole)) { ok = false; break; }
      unplace(r.placedRef);
      if (!fitsAt(r, d, hole)) { ok = false; break; }
      place(r, d, hole);
      hole = from;
    }
    if (ok) {
      const cands = [...ra.domain].sort((c1, c2) => {
        const s1 = (c1.d === d ? 0 : 1) * 1000 + c1.i;
        const s2 = (c2.d === d ? 0 : 1) * 1000 + c2.i;
        return s1 - s2;
      });
      let placedA = false;
      for (const cand of cands) {
        if (!fitsAt(ra, cand.d, cand.i)) continue;
        place(ra, cand.d, cand.i);
        const costAfter = compactCost(uni)
          + repeatCostAt(ra, cand.d, cand.d) + spacedCostAt(ra, cand.d, cand.d);
        const gapAfter = _lastGap;
        let coreAfter = coreCostAt(ra, cand.d, cand.i);
        for (let y = 1; y < moves.length; y++) {
          const pr = moves[y].req.placedRef;
          coreAfter += coreCostAt(moves[y].req, pr.d, pr.startIdx);
        }
        if (gapAfter <= gapBefore && costAfter <= costBefore + BAL_W && coreAfter < coreBefore) {
          placedA = true;
          break;
        }
        unplace(ra.placedRef);
      }
      if (!placedA) ok = false;
    }
    if (!ok) { undo(); return false; }
    return true;
  }

  function coreOrderPass(budgetMs) {
    const stop = Date.now() + Math.max(150, budgetMs);
    let total = 0;
    for (let round = 0; round < 8; round++) {
      if (Date.now() > stop) break;
      let swapped = 0;
      for (let ci = 0; ci < C; ci++) {
        for (let d = 0; d < D; d++) {
          if (Date.now() > stop) break;
          let guard = 0;
          let again = true;
          while (again && guard < 10) {
            guard += 1;
            again = false;
            const list = [];
            for (const p of placements) {
              if (!p.active || p.locked || p.d !== d) continue;
              if (p.req.placedRef !== p) continue;
              if (!p.req.cIdxs.includes(ci)) continue;
              list.push(p);
            }
            list.sort((a, b) => a.startIdx - b.startIdx);
            outer:
            for (let x = 0; x < list.length; x++) {
              const a = list[x];
              if (a.req.isCore) continue;
              let coreLater = false;
              for (let y = x + 1; y < list.length; y++) {
                if (list[y].req.isCore) { coreLater = true; break; }
              }
              if (!coreLater) continue;
              for (let y = x + 1; y < list.length; y++) {
                const b = list[y];
                if (!b.req.isCore) continue;
                if (tryCoreSwap(a, b) || tryCoreEvict(a, b) || tryChainSlotSwap(a, b)) {
                  swapped += 1;
                  total += 1;
                  again = true;
                  break outer;
                }
              }
              if (tryCoreShift(list, x, d)) {
                swapped += 1;
                total += 1;
                again = true;
                break outer;
              }
            }
          }
        }
      }
      if (!swapped) break;
    }
    return total;
  }

  function classDeviation(ci) {
    let dev = 0;
    for (let d = 0; d < D; d++) {
      if (!dayUsable[ci * D + d]) continue;
      const n = classDayCount[ci * D + d];
      if (n > balHi[ci]) dev += n - balHi[ci];
      else if (n < balLo[ci]) dev += balLo[ci] - n;
    }
    return dev;
  }

  function unionIdx(a, b) {
    const seen = new Set(a);
    const out = [...a];
    for (const x of b) if (!seen.has(x)) { seen.add(x); out.push(x); }
    return out;
  }

  // ——— KUNLIK ME'YORNI TO'G'RILASH ———
  function balancePass(budgetMs) {
    const stop = Date.now() + Math.max(120, budgetMs);
    let fixed = 0;
    const order = [];
    for (let ci = 0; ci < C; ci++) if (classDeviation(ci) > 0) order.push(ci);
    for (const ci of order) {
      for (let guard = 0; guard < 14; guard++) {
        if (Date.now() > stop) return fixed;
        if (classDeviation(ci) === 0) break;
        const overs = [];
        const unders = [];
        for (let d = 0; d < D; d++) {
          if (!dayUsable[ci * D + d]) continue;
          const n = classDayCount[ci * D + d];
          if (n > balHi[ci]) overs.push(d);
          if (n < balLo[ci]) unders.push(d);
        }
        if (!overs.length || !unders.length) break;
        let anyDone = false;
        for (const overD of overs) {
        for (const underD of unders) {
        if (anyDone || Date.now() > stop) break;
        let lastOcc = -1;
        const oBase = ci * DT + overD * T;
        for (let k = 0; k < T; k++) if (classGrid[oBase + k]) lastOcc = k;
        const movers = [];
        for (const p of placements) {
          if (!p.active || p.locked || p.d !== overD) continue;
          if (p.req.placedRef !== p) continue;
          if (!p.req.cIdxs.includes(ci)) continue;
          if (p.startIdx + p.req.blockSize - 1 !== lastOcc) continue;
          movers.push(p);
        }
        let done = false;
        for (const p0 of shuffle(movers, rng)) {
          if (Date.now() > stop) return fixed;
          const req = p0.req;
          if (!req.domain) continue;
          const targets = req.domain.filter((c) => c.d === underD);
          if (!targets.length) continue;
          // 1) To'g'ridan-to'g'ri bo'sh joyga ko'chirish (oyna ko'paymasa)
          for (const c of targets) {
            const cur = req.placedRef;
            if (!cur || !cur.active || cur.d !== overD) break;
            if (!fitsAt(req, c.d, c.i)) continue;
            const uni = req.cIdxs;
            const before = compactCost(uni);
            const gapBefore = _lastGap;
            const oldD = cur.d;
            const oldI = cur.startIdx;
            unplace(cur);
            place(req, c.d, c.i);
            const cNow = compactCost(uni);
            const gNow = _lastGap;
            if (gNow <= gapBefore && cNow < before) { fixed += 1; done = true; break; }
            unplace(req.placedRef);
            place(req, oldD, oldI);
          }
          if (done) break;
          // 2) Band joyga — to'siq darsni boshqa katakka surib
          for (const c of targets) {
            const cur = req.placedRef;
            if (!cur || !cur.active || cur.d !== overD) break;
            const oldD = cur.d;
            const oldI = cur.startIdx;
            if (fitsAt(req, c.d, c.i)) continue;
            const q = singleBlockerAt(req, c.d, c.i);
            if (!q || !q.active || q.req === req) continue;
            const rq = q.req;
            if (!rq.domain || rq.placedRef !== q) continue;
            const qd = q.d;
            const qi = q.startIdx;
            const uni = unionIdx(req.cIdxs, rq.cIdxs);
            const before = compactCost(uni);
            const gapBefore = _lastGap;
            unplace(q);
            unplace(cur);
            let ok = false;
            if (fitsAt(req, c.d, c.i)) {
              place(req, c.d, c.i);
              let qBest = null;
              let qCost = Infinity;
              let qGap = Infinity;
              for (const c2 of rq.domain) {
                if (!fitsAt(rq, c2.d, c2.i)) continue;
                markBits(rq, c2.d, c2.i, 1);
                const cc = compactCost(uni);
                const gg = _lastGap;
                markBits(rq, c2.d, c2.i, 0);
                if (gg < qGap || (gg === qGap && cc < qCost)) { qGap = gg; qCost = cc; qBest = c2; }
              }
              if (qBest) {
                place(rq, qBest.d, qBest.i);
                const cNow = compactCost(uni);
                const gNow = _lastGap;
                if (gNow < gapBefore || (gNow === gapBefore && cNow < before)) ok = true;
                else unplace(rq.placedRef);
              }
              if (!ok) unplace(req.placedRef);
            }
            if (!ok) {
              if (!req.placedRef) place(req, oldD, oldI);
              if (!rq.placedRef) place(rq, qd, qi);
            } else {
              fixed += 1;
              done = true;
              break;
            }
          }
          if (done) break;
        }
        if (done) anyDone = true;
        }
        }
        if (!anyDone) break;
      }
    }
    return fixed;
  }

  if (compactBudgetMs > 0) {
    // Zichlash bosqichida ham ejection-chain kerak — muddatni uzaytiramiz
    deadline = Math.max(deadline, Date.now() + compactBudgetMs + 600);
    setBalanceTargets((ci) => { let t = 0; for (let d = 0; d < D; d++) t += classDayCount[ci * D + d]; return t; });
    const compactStop = Date.now() + compactBudgetMs;
    const left = () => compactStop - Date.now();
    const step = Math.max(150, Math.round(compactBudgetMs * 0.12));
    compactPass(Math.round(compactBudgetMs * 0.26));
    pullUpPass(Math.min(step, Math.max(150, left())));
    for (let k = 0; k < 5 && left() > 400; k++) {
      const a = swapPass(Math.min(step, left()));
      const b = balancePass(Math.min(step, left()));
      const c = pullUpPass(Math.min(step, left()));
      if (!a && !b && !c) break;
      compactPass(Math.min(step, left()));
    }
    // Yakuniy zichlash — oyna qolmasligi kafolatlanadi
    compactPass(Math.max(300, Math.round(left() * 0.5)));
    pullUpPass(Math.max(250, left()));
    // ——— Asosiy fanlar kun boshiga tartiblanadi ———
    for (let k = 0; k < 3; k++) {
      const moved = coreOrderPass(Math.max(200, left()));
      if (!moved) break;
      compactPass(Math.max(150, Math.min(step, left())));
    }
    coreOrderPass(Math.max(200, left()));
    // Tartiblashdan keyin: yukni tenglash + oyna paydo bo'lmaganini kafolatlash
    balancePass(Math.max(200, left()));
    compactPass(Math.max(200, left()));
    pullUpPass(Math.max(200, left()));
  }

  let soft = 0;
  for (const p of placements) { soft += scoreCandidate(p.req, p.d, p.startIdx); }
  const report = buildValidationReport({
    schedule, classes, subjects, teachers, timeslots: allSortedTs, classSubjects,
    lunchGroups, classOffSet, teacherOffSet, entryToPlacement,
  });
  return { schedule, placed: placedHours, attempted: attemptedHours, soft, report };
}

function buildValidationReport(ctx) {
  const {
    schedule, classes, subjects, teachers, timeslots, classSubjects,
    lunchGroups, classOffSet, teacherOffSet, entryToPlacement,
  } = ctx;
  const teacherConflicts = [];
  const roomConflicts = [];
  const classConflicts = [];
  const lunchConflicts = [];
  const offDayConflicts = [];
  const placedPerKey = {};
  DAYS.forEach((day) => {
    timeslots.forEach((ts) => {
      const cell = schedule[day]?.[ts.id];
      if (!Array.isArray(cell) || !cell.length) return;
      if (!isTeachingSlot(ts)) {
        cell.forEach((l) => { if (!l.manual) lunchConflicts.push({ day, tsId: ts.id, subjectId: l.subjectId }); });
      }
      const tSeen = new Map();
      const rSeen = new Map();
      const cSeen = new Map();
      cell.forEach((l) => {
        const p = entryToPlacement?.get(l) || l;
        if (l.teacherId) {
          if (tSeen.has(l.teacherId) && tSeen.get(l.teacherId) !== p) teacherConflicts.push({ day, tsId: ts.id, teacherId: l.teacherId });
          tSeen.set(l.teacherId, p);
        }
        if (l.alternating && l.altTeacherId) {
          if (tSeen.has(l.altTeacherId) && tSeen.get(l.altTeacherId) !== p) teacherConflicts.push({ day, tsId: ts.id, teacherId: l.altTeacherId });
          tSeen.set(l.altTeacherId, p);
        }
        if (l.roomId) {
          if (rSeen.has(l.roomId) && rSeen.get(l.roomId) !== p) roomConflicts.push({ day, tsId: ts.id, roomId: l.roomId });
          rSeen.set(l.roomId, p);
        }
        classIdsOf(l).forEach((cid) => {
          let set = cSeen.get(cid);
          if (!set) cSeen.set(cid, (set = new Set()));
          set.add(p);
          if (set.size > 1) classConflicts.push({ day, tsId: ts.id, classId: cid });
          if (!l.manual && isTeachingSlot(ts) && classHasLunchAt(ts, cid, lunchGroups, day)) lunchConflicts.push({ day, tsId: ts.id, classId: cid });
          if (!l.manual && classOffSet?.[cid]?.has(day)) offDayConflicts.push({ day, tsId: ts.id, classId: cid });
        });
        if (!l.manual && l.teacherId && teacherOffSet?.[l.teacherId]?.has(day)) offDayConflicts.push({ day, tsId: ts.id, teacherId: l.teacherId });
      });
      if (isTeachingSlot(ts)) {
        const uniq = new Set();
        cell.forEach((l) => classIdsOf(l).forEach((cid) => uniq.add(`${cid}__${l.subjectId}`)));
        uniq.forEach((k) => { placedPerKey[k] = (placedPerKey[k] || 0) + 1; });
      }
    });
  });
  let requiredTotal = 0;
  let placedTotal = 0;
  const remainingList = [];
  classes.forEach((cls) => {
    (classSubjects[cls.id] || []).forEach((raw) => {
      const subj = subjects.find((s) => s.id === raw.subjectId);
      if (!subj) return;
      const a = normalizeAssignment(raw, subj);
      if (a.levelGroupEnabled && !a.levelGroups.length) return;
      if (!a.levelGroupEnabled && !a.teacherId) return;
      const need = Number(a.weeklyHours || 0);
      const got = Math.min(need, placedPerKey[`${cls.id}__${a.subjectId}`] || 0);
      requiredTotal += need;
      placedTotal += got;
      if (got < need) remainingList.push({ className: cls.name, subjectName: subj.name, missing: need - got });
    });
  });
  return {
    requiredTotal, placedTotal, remainingTotal: Math.max(0, requiredTotal - placedTotal), remainingList,
    teacherConflicts, roomConflicts, classConflicts, lunchConflicts, offDayConflicts,
    ok: requiredTotal === placedTotal && !teacherConflicts.length && !roomConflicts.length &&
      !classConflicts.length && !lunchConflicts.length && !offDayConflicts.length,
  };
}

// ——— MUSTAQIL ZICHLASH ———
// Tayyor jadvalni (qo'lda tahrirdan keyin ham) qayta joylashtirmasdan zichlaydi.
// Blok (2 soat) darslar butunligicha ko'chadi, bir kunda bir fan limiti saqlanadi.
export function compactSchedule(classes = [], timeslots = [], lunchGroups = [], schedule = {}, classSubjects = {}) {
  const D = DAYS.length;
  const allTs = [...timeslots].sort((a, b) => Number(a.lessonNumber) - Number(b.lessonNumber));
  const teachingTs = allTs.filter(isTeachingSlot);
  const T = teachingTs.length;
  if (!classes.length || !T) return schedule;
  const DT = D * T;
  const C = classes.length;
  const cIdxOf = new Map(classes.map((c, i) => [c.id, i]));
  const allIdxById = new Map(allTs.map((ts, i) => [ts.id, i]));
  const nextConsecutive = new Array(Math.max(0, T - 1)).fill(false);
  for (let i = 0; i < T - 1; i++) {
    nextConsecutive[i] = allIdxById.get(teachingTs[i + 1].id) === allIdxById.get(teachingTs[i].id) + 1;
  }

  // "Ora kunda", "Asosiy fan" va haftalik soat ma'lumotlari
  const spacedSet = new Set();
  const coreSet = new Set();
  const hoursMap = new Map(); // `${cid}|${subjectId}` -> haftalik soat
  const doubleSet = new Set(); // 2 soat blok yoqilgan sinf+fan
  Object.entries(classSubjects || {}).forEach(([cid, list]) => {
    (Array.isArray(list) ? list : []).forEach((a) => {
      if (!a || !a.subjectId) return;
      if (a.spacedDays) spacedSet.add(`${cid}|${a.subjectId}`);
      if (a.isCore) coreSet.add(`${cid}|${a.subjectId}`);
      if (a.allowDouble) doubleSet.add(`${cid}|${a.subjectId}`);
      const k = `${cid}|${a.subjectId}`;
      hoursMap.set(k, (hoursMap.get(k) || 0) + Number(a.weeklyHours || 0));
      if (a.swapEnabled && a.swapSubjectId) {
        const k2 = `${cid}|${a.swapSubjectId}`;
        hoursMap.set(k2, (hoursMap.get(k2) || 0) + Number(a.weeklyHours || 0));
      }
    });
  });

  // Sinf uchun yopiq kataklar: obed, smena (classIds), dam kuni
  const blocked = new Uint8Array(C * DT);
  classes.forEach((c, ci) => {
    const off = new Set(Array.isArray(c.offDays) ? c.offDays : []);
    DAYS.forEach((day, d) => {
      teachingTs.forEach((ts, i) => {
        const allowed = Array.isArray(ts.classIds) ? ts.classIds : [];
        const bad = off.has(day) ||
          (allowed.length && !allowed.includes(c.id)) ||
          classHasLunchAt(ts, c.id, lunchGroups, day);
        if (bad) blocked[ci * DT + d * T + i] = 1;
      });
    });
  });

  const slotRank = new Int16Array(C * DT).fill(-1);
  for (let ci = 0; ci < C; ci++) {
    for (let d = 0; d < D; d++) {
      const base = ci * DT + d * T;
      let r = 0;
      for (let k = 0; k < T; k++) {
        if (blocked[base + k]) continue;
        slotRank[base + k] = r;
        r += 1;
      }
    }
  }

  // Ishlatiladigan kunlar soni (kunlik fan limitini hisoblash uchun)
  const usableDays = new Int16Array(C);
  for (let ci = 0; ci < C; ci++) {
    let ud = 0;
    for (let d = 0; d < D; d++) {
      let cap = 0;
      for (let k = 0; k < T; k++) if (!blocked[ci * DT + d * T + k]) cap += 1;
      if (cap > 0) ud += 1;
    }
    usableDays[ci] = ud;
  }

  // ——— Darslarni "birlik"larga ajratamiz ———
  const units = [];
  const baseKeyOf = (l) => (l.swap
    ? `SWAP|${classIdsOf(l).slice().sort().join("+")}`
    : `${l.subjectId}|${l.groupKey || ""}|${classIdsOf(l).slice().sort().join("+")}`);
  const perDay = [];
  for (let d = 0; d < D; d++) {
    const day = DAYS[d];
    const rows = [];
    for (let i = 0; i < T; i++) {
      const cell = schedule?.[day]?.[teachingTs[i].id];
      const map = new Map();
      if (Array.isArray(cell)) {
        for (const l of cell) {
          if (!l) continue;
          const k = `${baseKeyOf(l)}|${l.blockIndex ?? "-"}`;
          let g = map.get(k);
          if (!g) map.set(k, (g = { base: baseKeyOf(l), bi: l.blockIndex ?? -1, entries: [] }));
          g.entries.push(l);
        }
      }
      rows.push(map);
    }
    perDay.push(rows);
  }
  const consumed = new Set();
  for (let d = 0; d < D; d++) {
    for (let i = 0; i < T; i++) {
      for (const [k, g] of perDay[d][i]) {
        const tag = `${d}|${i}|${k}`;
        if (consumed.has(tag)) continue;
        const parts = [g];
        let len = 1;
        if (g.bi === 0 && i + 1 < T && nextConsecutive[i]) {
          for (const [k2, g2] of perDay[d][i + 1]) {
            if (g2.base === g.base && g2.bi === 1) {
              parts.push(g2);
              consumed.add(`${d}|${i + 1}|${k2}`);
              len = 2;
              break;
            }
          }
        }
        const entries = parts.flatMap((x) => x.entries);
        const cSet = new Set();
        const tSet = new Set();
        const rSet = new Set();
        let locked = false;
        let spaced = false;
        let core = false;
        for (const l of entries) {
          classIdsOf(l).forEach((cid) => {
            cSet.add(cid);
            if (spacedSet.has(`${cid}|${l.subjectId}`)) spaced = true;
            if (coreSet.has(`${cid}|${l.subjectId}`)) core = true;
          });
          if (l.teacherId) tSet.add(l.teacherId);
          if (l.altTeacherId) tSet.add(l.altTeacherId);
          if (l.roomId) rSet.add(l.roomId);
          if (l.manual) locked = true;
        }
        const cIdxs = [...cSet].map((cid) => cIdxOf.get(cid)).filter((x) => x !== undefined);
        if (!cIdxs.length) locked = true;
        const subjectId = entries[0]?.subjectId || "";
        // Kunlik fan limiti: blok o'lchami yoki soat/kun nisbati
        let cap = len;
        for (const cid of cSet) {
          const ci = cIdxOf.get(cid);
          if (ci === undefined) continue;
          if (doubleSet.has(`${cid}|${subjectId}`)) cap = Math.max(cap, 2);
          const h = hoursMap.get(`${cid}|${subjectId}`) || 0;
          const ud = Math.max(1, usableDays[ci] || 1);
          if (h > 0) cap = Math.max(cap, Math.ceil(h / ud));
        }
        units.push({
          d, i, len, locked, entries, spaced, core, cap,
          parts: parts.map((x) => x.entries),
          cIdxs, tids: [...tSet], rids: [...rSet],
          subjectId,
        });
      }
    }
  }

  // ——— Bandlik jadvallari ———
  const classGrid = new Uint8Array(C * DT);
  const tGrid = new Map();
  const rGrid = new Map();
  const gridOf = (map, id) => {
    let g = map.get(id);
    if (!g) { g = new Uint8Array(DT); map.set(id, g); }
    return g;
  };
  const classDayCount = new Int16Array(C * D);
  const subjDay = new Map(); // `${ci}|${d}|${subjectId}` -> soni
  const bumpSubj = (u, d, sign) => {
    for (const ci of u.cIdxs) {
      const k = `${ci}|${d}|${u.subjectId}`;
      subjDay.set(k, (subjDay.get(k) || 0) + sign * u.len);
    }
  };
  const setBits = (u, d, i, val) => {
    for (let o = 0; o < u.len; o++) {
      const off = d * T + i + o;
      for (const ci of u.cIdxs) classGrid[ci * DT + off] = val;
      for (const id of u.tids) gridOf(tGrid, id)[off] = val;
      for (const id of u.rids) gridOf(rGrid, id)[off] = val;
    }
    const delta = val ? u.len : -u.len;
    for (const ci of u.cIdxs) classDayCount[ci * D + d] += delta;
  };
  units.forEach((u) => { setBits(u, u.d, u.i, 1); bumpSubj(u, u.d, +1); });

  const fits = (u, d, i) => {
    // Bir kunda bir fan limiti (o'z hissasini chiqarib tashlaydi)
    if (u.subjectId) {
      for (const ci of u.cIdxs) {
        let n = subjDay.get(`${ci}|${d}|${u.subjectId}`) || 0;
        if (d === u.d) n -= u.len;
        if (n + u.len > u.cap) return false;
      }
    }
    for (let o = 0; o < u.len; o++) {
      if (o > 0 && !nextConsecutive[i + o - 1]) return false;
      const off = d * T + i + o;
      for (const ci of u.cIdxs) if (blocked[ci * DT + off] || classGrid[ci * DT + off]) return false;
      for (const id of u.tids) if (gridOf(tGrid, id)[off]) return false;
      for (const id of u.rids) if (gridOf(rGrid, id)[off]) return false;
    }
    return true;
  };
  units.forEach((u) => {
    const dom = [];
    for (let d = 0; d < D; d++) {
      for (let i = 0; i + u.len <= T; i++) {
        let ok = true;
        for (let o = 0; o < u.len && ok; o++) {
          if (o > 0 && !nextConsecutive[i + o - 1]) ok = false;
          for (const ci of u.cIdxs) if (blocked[ci * DT + d * T + i + o]) { ok = false; break; }
        }
        if (ok) dom.push({ d, i });
      }
    }
    u.domain = dom;
  });

  const BAL_W = 900;
  const REPEAT_W = 260;
  const SPACED_W = 600;
  const CORE_W = 220;

  const balLo = new Int16Array(C);
  const balHi = new Int16Array(C);
  const dayUsable = new Uint8Array(C * D);
  for (let ci = 0; ci < C; ci++) {
    let ud = 0;
    let total = 0;
    for (let d = 0; d < D; d++) {
      let cap = 0;
      const cBase = ci * DT + d * T;
      for (let k = 0; k < T; k++) if (!blocked[cBase + k]) cap += 1;
      if (cap > 0) { dayUsable[ci * D + d] = 1; ud += 1; }
      total += classDayCount[ci * D + d];
    }
    if (!ud) { balLo[ci] = 0; balHi[ci] = 0; continue; }
    const base = Math.floor(total / ud);
    balLo[ci] = base;
    balHi[ci] = total - base * ud > 0 ? base + 1 : base;
  }

  let _gap = 0;
  const costOf = (cIdxs) => {
    let cost = 0;
    let gaps = 0;
    for (const ci of cIdxs) {
      for (let d = 0; d < D; d++) {
        const cBase = ci * DT + d * T;
        let free = 0;
        let head = 0;
        for (let k = 0; k < T; k++) {
          if (blocked[cBase + k]) continue;
          if (classGrid[cBase + k]) head += free;
          else free += 1;
        }
        gaps += head;
        if (dayUsable[ci * D + d]) {
          const n = classDayCount[ci * D + d];
          const dev = n > balHi[ci] ? n - balHi[ci] : (n < balLo[ci] ? balLo[ci] - n : 0);
          cost += dev * dev * BAL_W;
        }
      }
    }
    _gap = gaps;
    return cost;
  };
  const repeatAt = (u, dd, oldD) => {
    let c = 0;
    for (const ci of u.cIdxs) {
      let n = subjDay.get(`${ci}|${dd}|${u.subjectId}`) || 0;
      if (dd === oldD) n -= u.len;
      if (n > 0) c += n * REPEAT_W;
    }
    return c;
  };
  const spacedAt = (u, dd, oldD) => {
    if (!u.spaced) return 0;
    let c = 0;
    for (const ci of u.cIdxs) {
      for (let k = -1; k <= 1; k++) {
        const nd = dd + k;
        if (nd < 0 || nd >= D) continue;
        let n = subjDay.get(`${ci}|${nd}|${u.subjectId}`) || 0;
        if (nd === oldD) n -= u.len;
        if (n > 0) c += k === 0 ? n * SPACED_W * 2 : SPACED_W;
      }
    }
    return c;
  };
  const coreAt = (u, d, i) => {
    let c = 0;
    for (const ci of u.cIdxs) {
      const r = slotRank[ci * DT + d * T + i];
      if (r < 0) continue;
      if (u.core) c += r * CORE_W;
      else if (r < 3) c += (3 - r) * 30;
    }
    return c;
  };

  const movableAll = units.filter((u) => !u.locked && u.domain.length > 1);
  const movable = [...movableAll.filter((u) => u.core), ...movableAll.filter((u) => !u.core)];
  const stop = Date.now() + 2500;
  for (let round = 0; round < 12 && Date.now() < stop; round++) {
    let moved = 0;
    for (const u of movable) {
      if (Date.now() > stop) break;
      const oldD = u.d;
      const oldI = u.i;
      const base = costOf(u.cIdxs) + repeatAt(u, oldD, oldD) + spacedAt(u, oldD, oldD) + coreAt(u, oldD, oldI);
      const baseGap = _gap;
      setBits(u, oldD, oldI, 0);
      let bd = -1;
      let bi = -1;
      let bc = base;
      let bg = baseGap;
      for (const cand of u.domain) {
        if (cand.d === oldD && cand.i === oldI) continue;
        if (!fits(u, cand.d, cand.i)) continue;
        setBits(u, cand.d, cand.i, 1);
        const c = costOf(u.cIdxs) + repeatAt(u, cand.d, oldD) + spacedAt(u, cand.d, oldD) + coreAt(u, cand.d, cand.i);
        const g = _gap;
        setBits(u, cand.d, cand.i, 0);
        if (g < bg || (g === bg && c < bc)) { bg = g; bc = c; bd = cand.d; bi = cand.i; }
      }
      if (bd >= 0) {
        setBits(u, bd, bi, 1);
        bumpSubj(u, oldD, -1);
        bumpSubj(u, bd, +1);
        u.d = bd;
        u.i = bi;
        moved += 1;
      } else {
        setBits(u, oldD, oldI, 1);
      }
    }
    if (!moved) break;
  }

  // ——— OYNA TO'LDIRISH: kun boshidagi bo'sh katakka keyingi darsni tortish ———
  const swapUnits = (a, b) => {
    const ad = a.d, ai = a.i, bd = b.d, bi = b.i;
    setBits(a, ad, ai, 0);
    setBits(b, bd, bi, 0);
    let ok = false;
    if (fits(a, bd, bi)) {
      setBits(a, bd, bi, 1);
      if (fits(b, ad, ai)) {
        setBits(b, ad, ai, 1);
        ok = true;
      } else {
        setBits(a, bd, bi, 0);
      }
    }
    if (!ok) {
      setBits(a, ad, ai, 1);
      setBits(b, bd, bi, 1);
      return false;
    }
    bumpSubj(a, ad, -1); bumpSubj(a, bd, +1);
    bumpSubj(b, bd, -1); bumpSubj(b, ad, +1);
    a.d = bd; a.i = bi;
    b.d = ad; b.i = ai;
    return true;
  };
  const pullStop = Date.now() + 900;
  for (let ci = 0; ci < C && Date.now() < pullStop; ci++) {
    for (let d = 0; d < D; d++) {
      let guard = 0;
      while (guard < 8) {
        guard += 1;
        const cBase = ci * DT + d * T;
        let hole = -1;
        let lastOcc = -1;
        for (let k = 0; k < T; k++) {
          if (blocked[cBase + k]) continue;
          if (classGrid[cBase + k]) lastOcc = k;
          else if (hole < 0) hole = k;
        }
        if (hole < 0 || lastOcc < hole) break;
        const list = units
          .filter((u) => !u.locked && u.d === d && u.cIdxs.includes(ci) && u.i > hole)
          .sort((a, b) => a.i - b.i);
        let moved = false;
        for (const u of list) {
          const oldD = u.d;
          const oldI = u.i;
          setBits(u, oldD, oldI, 0);
          if (fits(u, d, hole)) {
            setBits(u, d, hole, 1);
            u.i = hole;
            moved = true;
            break;
          }
          setBits(u, oldD, oldI, 1);
          // To'siq boshqa sinf darsi bo'lsa — o'rin almashtirib ko'ramiz
          const blocker = units.find((v) => v !== u && !v.locked && v.d === d && v.len === u.len
            && v.i === hole && !v.cIdxs.includes(ci));
          if (blocker && swapUnits(u, blocker)) { moved = true; break; }
        }
        if (!moved) break;
      }
    }
  }

  // ——— ASOSIY FANLAR TARTIBI ———
  const unionArr = (a, b) => {
    const seen = new Set(a);
    const res = [...a];
    for (const x of b) if (!seen.has(x)) { seen.add(x); res.push(x); }
    return res;
  };
  const coreStop = Date.now() + 900;
  for (let round = 0; round < 8 && Date.now() < coreStop; round++) {
    let swapped = 0;
    for (let ci = 0; ci < C; ci++) {
      for (let d = 0; d < D; d++) {
        if (Date.now() > coreStop) break;
        let guard = 0;
        let again = true;
        while (again && guard < 10) {
          guard += 1;
          again = false;
          const list = units
            .filter((u) => !u.locked && u.d === d && u.cIdxs.includes(ci))
            .sort((a, b) => a.i - b.i);
          outer:
          for (let x = 0; x < list.length; x++) {
            const a = list[x];
            if (a.core) continue;
            for (let y = x + 1; y < list.length; y++) {
              const b = list[y];
              if (!b.core || a.len !== b.len) continue;
              const uni = unionArr(a.cIdxs, b.cIdxs);
              costOf(uni);
              const gap0 = _gap;
              const ad = a.d, ai = a.i, bd2 = b.d, bi2 = b.i;
              setBits(a, ad, ai, 0);
              setBits(b, bd2, bi2, 0);
              let ok = false;
              if (fits(a, bd2, bi2)) {
                setBits(a, bd2, bi2, 1);
                if (fits(b, ad, ai)) {
                  setBits(b, ad, ai, 1);
                  costOf(uni);
                  ok = _gap <= gap0;
                  if (!ok) {
                    setBits(b, ad, ai, 0);
                    setBits(a, bd2, bi2, 0);
                  }
                } else {
                  setBits(a, bd2, bi2, 0);
                }
              }
              if (ok) {
                bumpSubj(a, ad, -1);
                bumpSubj(a, bd2, +1);
                bumpSubj(b, bd2, -1);
                bumpSubj(b, ad, +1);
                a.d = bd2;
                a.i = bi2;
                b.d = ad;
                b.i = ai;
                swapped += 1;
                again = true;
                break outer;
              }
              setBits(a, ad, ai, 1);
              setBits(b, bd2, bi2, 1);
              const evBefore = costOf(uni) + repeatAt(a, ad, ad) + spacedAt(a, ad, ad);
              const evGap = _gap;
              let evicted = false;
              for (const cand of a.domain) {
                if (cand.d === ad && cand.i === ai) continue;
                setBits(a, ad, ai, 0);
                setBits(b, bd2, bi2, 0);
                let ok2 = false;
                if (fits(b, ad, ai)) {
                  setBits(b, ad, ai, 1);
                  if (fits(a, cand.d, cand.i)) {
                    setBits(a, cand.d, cand.i, 1);
                    const evAfter = costOf(uni) + repeatAt(a, cand.d, ad) + spacedAt(a, cand.d, ad);
                    ok2 = _gap <= evGap && evAfter <= evBefore + BAL_W;
                    if (!ok2) {
                      setBits(a, cand.d, cand.i, 0);
                      setBits(b, ad, ai, 0);
                    }
                  } else {
                    setBits(b, ad, ai, 0);
                  }
                }
                if (ok2) {
                  bumpSubj(a, ad, -1);
                  bumpSubj(a, cand.d, +1);
                  a.d = cand.d;
                  a.i = cand.i;
                  b.d = ad;
                  b.i = ai;
                  evicted = true;
                  break;
                }
                setBits(a, ad, ai, 1);
                setBits(b, bd2, bi2, 1);
              }
              if (evicted) {
                swapped += 1;
                again = true;
                break outer;
              }
            }
          }
        }
      }
    }
    if (!swapped) break;
  }

  // ——— Yangi jadvalni yig'amiz ———
  const out = {};
  DAYS.forEach((day) => {
    out[day] = {};
    allTs.forEach((ts) => { out[day][ts.id] = []; });
  });
  DAYS.forEach((day) => {
    allTs.forEach((ts) => {
      if (isTeachingSlot(ts)) return;
      const cell = schedule?.[day]?.[ts.id];
      if (Array.isArray(cell) && cell.length) out[day][ts.id] = [...cell];
    });
  });
  units.forEach((u) => {
    const day = DAYS[u.d];
    u.parts.forEach((entries, o) => {
      const ts = teachingTs[u.i + o];
      entries.forEach((e) => out[day][ts.id].push(e));
    });
  });
  return out;
}

export function generateSchedule(...args) {
  const timeslots = args[4] || [];
  const HARD_ATTEMPT_CAP = 5000;
  let totalHours = 0;
  const cs = args[5] || {};
  Object.values(cs).forEach((list) => (Array.isArray(list) ? list : []).forEach((a) => { totalHours += Number(a?.weeklyHours || 0); }));
  const TIME_BUDGET_MS = totalHours <= 700 ? 9000 : Math.min(20000, Math.round(9000 + (totalHours - 700) * 4));
  const start = Date.now();
  const deadline = start + TIME_BUDGET_MS;
  const baseSeed = (Math.floor(Math.random() * 0x7fffffff)) | 0;
  let best = null;
  let attempt = 0;
  let noImprove = 0;
  while (attempt < HARD_ATTEMPT_CAP) {
    if (attempt > 0 && Date.now() >= deadline) break;
    if (noImprove >= 1 && Date.now() - start >= 9000) break;
    const slice = Math.max(3500, Math.round(TIME_BUDGET_MS * 0.34));
    const attemptDeadline = Math.min(deadline, Date.now() + slice);
    const seed = (baseSeed + attempt * 0x9e3779b1) | 0;
    const res = attemptSchedule(args[0], args[1], args[2], args[3], args[4], args[5] || {}, args[6] || [], args[7] || null, { seed, deadline: attemptDeadline });
    attempt += 1;
    const improved = !best || res.placed > best.placed;
    if (!best || res.placed > best.placed || (res.placed === best.placed && res.soft < best.soft)) best = res;
    noImprove = improved ? 0 : noImprove + 1;
    if (res.attempted > 0 && res.placed >= res.attempted && res.report?.remainingTotal === 0) {
      if (attempt >= 2 || Date.now() - start > TIME_BUDGET_MS * 0.45) break;
    }
    if (res.attempted === 0) break;
  }
  if (best) {
    if (typeof console !== "undefined" && best.report) {
      const r = best.report;
      const pct = r.requiredTotal ? ((r.placedTotal / r.requiredTotal) * 100).toFixed(1) : "0";
      console.log(`📊 Jadval generatori: ${r.placedTotal}/${r.requiredTotal} soat (${pct}%), urinishlar: ${attempt}, vaqt: ${Date.now() - start}ms`,
        { qolganSoatlar: r.remainingList, teacherConflicts: r.teacherConflicts.length, roomConflicts: r.roomConflicts.length,
          classConflicts: r.classConflicts.length, lunchConflicts: r.lunchConflicts.length, offDayConflicts: r.offDayConflicts.length });
    }
    return best.schedule;
  }
  return emptySchedule(timeslots);
}