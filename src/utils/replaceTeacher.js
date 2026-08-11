import { DAYS } from "./constants";

// =====================================================================
//  smartjadval — O'QITUVCHINI ALMASHTIRISH (bo'sh katak qoldirmaydigan usul)
//
//  Maqsad: ketgan o'qituvchining darslarini yangi o'qituvchiga o'tkazish,
//  BUTUN JADVALNI QAYTA TUZMASDAN va sinf jadvalida BO'SH KATAK
//  QOLDIRMASDAN. Har bir dars uchun:
//
//    1-daraja (joyida): yangi ustoz o'sha soatda bo'sh → faqat nom almashadi.
//       Hech narsa surilmaydi, katak o'z joyida qoladi.
//
//    2-daraja (SWAP / o'rin almashuv): yangi ustoz o'sha soatda band →
//       dars bo'sh joyga KO'CHIRILMAYDI (bu eski katakni bo'sh qoldirar edi).
//       Buning o'rniga o'sha sinfning BOSHQA DARSI bilan o'rin almashtiriladi:
//         - maqsad dars yangi ustoz bo'sh bo'lgan soatga o'tadi,
//         - u yerdagi dars (boshqa ustozniki) esa bo'shagan katakka keladi.
//       Natijada ikkala katak ham to'la qoladi — jadvalda teshik yo'q.
//
//    Ikkalasi ham iloji bo'lmasa — dars eski ustoz nomida joyida qoladi va
//    ogohlantirish beriladi (jadval buzilmaydi, katak bo'shamaydi).
//
//  Tashqi API: mavjud `schedule` obyektini oladi, o'zgartirilgan nusxa va
//  o'zgarishlar jurnalini qaytaradi. scheduleGenerator formatiga to'liq mos.
// =====================================================================

function isTeachingSlot(timeslot) {
  const type = timeslot?.type || "lesson";
  return type !== "lunch" && type !== "break";
}

function classIdsOf(lesson) {
  return Array.isArray(lesson.classIds)
    ? lesson.classIds
    : [lesson.classId].filter(Boolean);
}

function getTeacherSubjectIds(teacher) {
  return Array.isArray(teacher.subjectIds)
    ? teacher.subjectIds
    : teacher.subjectId
    ? [teacher.subjectId]
    : [];
}

// Ikki sinf ro'yxati bir xil to'plammi (guruh darslari buzilmasligi uchun)
function sameClassSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// schedule ni chuqur nusxalash (asl jadval buzilmasin)
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

/**
 * O'qituvchini almashtirish.
 *
 * @param {Object} params
 * @param {Object} params.schedule       - mavjud dars jadvali (o'zgartirilmaydi, nusxasi qaytadi)
 * @param {Array}  params.timeslots      - dars vaqtlari
 * @param {Array}  params.teachers       - barcha o'qituvchilar
 * @param {Array}  params.classes        - barcha sinflar (dam kunlari uchun)
 * @param {string} params.oldTeacherId   - ketgan o'qituvchi id
 * @param {string} params.newTeacherId   - yangi o'qituvchi id
 * @param {Array}  [params.lunchGroups]  - obed guruhlari
 * @param {Array}  [params.onlyClassSubjectIds] - faqat shu {classId, subjectId} juftlarini
 *                                          ko'chirish (bo'sh bo'lsa — hammasini)
 * @returns {{ schedule, changes, movedOthers, failed, summary }}
 */
export function replaceTeacher({
  schedule,
  timeslots,
  teachers,
  classes = [],
  oldTeacherId,
  newTeacherId,
  lunchGroups = [],
  onlyClassSubjectIds = null,
}) {
  const result = {
    schedule: cloneSchedule(schedule),
    changes: [],       // [{classIds, subjectId, kind: "inPlace"|"swapped", from, to}]
    movedOthers: [],   // swap sherigi — eski katakka kelgan boshqa ustoz darslari
    failed: [],        // ko'chirib bo'lmagan darslar
    summary: null,
  };

  if (!oldTeacherId || !newTeacherId) {
    result.summary = { error: "Eski yoki yangi o'qituvchi tanlanmagan" };
    return result;
  }
  if (oldTeacherId === newTeacherId) {
    result.summary = { error: "Eski va yangi o'qituvchi bir xil" };
    return result;
  }

  const sch = result.schedule;
  const newTeacher = teachers.find((t) => t.id === newTeacherId);
  const oldTeacher = teachers.find((t) => t.id === oldTeacherId);
  if (!newTeacher) {
    result.summary = { error: "Yangi o'qituvchi topilmadi" };
    return result;
  }

  // ——— Slotlar va indekslar ———
  const allSortedTs = [...timeslots].sort(
    (a, b) => Number(a.lessonNumber) - Number(b.lessonNumber)
  );
  const teachingTs = allSortedTs.filter(isTeachingSlot);
  const T = teachingTs.length;
  const teachIdxById = new Map(teachingTs.map((ts, i) => [ts.id, i]));

  const newTeacherSubjects = new Set(getTeacherSubjectIds(newTeacher));
  const newTeacherMax = Number(newTeacher.maxWeeklyHours || 40);
  const newTeacherOff = new Set(Array.isArray(newTeacher.offDays) ? newTeacher.offDays : []);

  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  function teacherOffDays(tid) {
    const t = teacherById.get(tid);
    return new Set(Array.isArray(t?.offDays) ? t.offDays : []);
  }

  const classOff = {};
  classes.forEach((c) => {
    classOff[c.id] = new Set(Array.isArray(c.offDays) ? c.offDays : []);
  });

  // ——— Obed bloklangan slotlar ———
  function classHasLunchAt(ts, classId, day) {
    return (lunchGroups || []).some((group) => {
      const cids = Array.isArray(group.classIds) ? group.classIds : [];
      if (!cids.includes(classId)) return false;
      const slotIds = Array.isArray(group.timeslotIds) ? group.timeslotIds : null;
      if (slotIds && slotIds.length) {
        if (!slotIds.includes(ts.id)) return false;
        const days = Array.isArray(group.days) && group.days.length ? group.days : null;
        return days ? days.includes(day) : true;
      }
      // eski format (vaqt oralig'i) — soddalik uchun bloklangan deb hisoblaymiz
      const toMin = (t = "00:00") => { const [h, m] = String(t).split(":").map(Number); return (h || 0) * 60 + (m || 0); };
      return toMin(ts.startTime) < toMin(group.endTime) && toMin(ts.endTime) > toMin(group.startTime);
    });
  }

  // ——— Joriy bandlik holatini jadvaldan qurish ———
  const occTeacher = new Map();
  const occRoom = new Map();
  const occClass = new Map();
  const teacherWeekLoad = new Map();

  function grab(map, key) {
    let s = map.get(key);
    if (!s) { s = new Set(); map.set(key, s); }
    return s;
  }

  for (const day of DAYS) {
    for (const ts of teachingTs) {
      const cell = sch[day]?.[ts.id] || [];
      const key = `${day}|${ts.id}`;
      for (const l of cell) {
        if (l.teacherId) {
          grab(occTeacher, key).add(l.teacherId);
          teacherWeekLoad.set(l.teacherId, (teacherWeekLoad.get(l.teacherId) || 0) + 1);
        }
        if (l.roomId) grab(occRoom, key).add(l.roomId);
        classIdsOf(l).forEach((cid) => grab(occClass, key).add(cid));
      }
    }
  }

  // ——— Ketgan ustozning ko'chiriladigan darslarini yig'ish ———
  const targets = [];
  const onlySet = onlyClassSubjectIds
    ? new Set(onlyClassSubjectIds.map((x) => `${x.classId}__${x.subjectId}`))
    : null;

  for (const day of DAYS) {
    for (const ts of teachingTs) {
      const cell = sch[day]?.[ts.id] || [];
      for (const l of cell) {
        if (l.teacherId !== oldTeacherId) continue;
        if (onlySet) {
          const match = classIdsOf(l).some((cid) => onlySet.has(`${cid}__${l.subjectId}`));
          if (!match) continue;
        }
        targets.push({ day, tsId: ts.id, lesson: l, classIds: classIdsOf(l), subjectId: l.subjectId });
      }
    }
  }

  if (!targets.length) {
    result.summary = {
      ok: true,
      message: "Ketgan o'qituvchining ko'chiriladigan darsi topilmadi",
      totalLessons: 0, inPlace: 0, swapped: 0, failed: 0,
    };
    return result;
  }

  const subjectsCovered = new Set(targets.map((t) => t.subjectId));
  const uncoveredSubjects = [...subjectsCovered].filter((sid) => !newTeacherSubjects.has(sid));

  // ——— Yordamchi tekshiruvlar ———
  function slotBlockedForClasses(day, tsId, classIds) {
    const ts = teachingTs[teachIdxById.get(tsId)];
    if (!ts) return true;
    for (const cid of classIds) {
      if (classOff[cid]?.has(day)) return true;
      if (classHasLunchAt(ts, cid, day)) return true;
    }
    return false;
  }

  // Hujayra bo'yicha aniq tekshiruvlar (ignore — hisobga olinmaydigan darslar)
  function teacherFreeInCell(day, tsId, teacherId, ignore = []) {
    if (!teacherId) return true;
    const cell = sch[day]?.[tsId] || [];
    return !cell.some((l) => !ignore.includes(l) && l.teacherId === teacherId);
  }
  function roomFreeInCell(day, tsId, roomId, ignore = []) {
    if (!roomId) return true;
    const cell = sch[day]?.[tsId] || [];
    return !cell.some((l) => !ignore.includes(l) && l.roomId === roomId);
  }
  function classesFreeInCell(day, tsId, classIds, ignore = []) {
    const cell = sch[day]?.[tsId] || [];
    return !cell.some(
      (l) => !ignore.includes(l) && classIdsOf(l).some((cid) => classIds.includes(cid))
    );
  }

  // 1-daraja: shu joyning o'zida yangi ustoz bilan qoldirish mumkinmi
  function canStayInPlace(day, tsId, classIds, roomId, lesson) {
    if (newTeacherOff.has(day)) return false;
    if (slotBlockedForClasses(day, tsId, classIds)) return false;
    if (!teacherFreeInCell(day, tsId, newTeacherId, [lesson])) return false;
    if (!classesFreeInCell(day, tsId, classIds, [lesson])) return false;
    if (!roomFreeInCell(day, tsId, roomId, [lesson])) return false;
    return true;
  }

  // Bandlik indekslaridan darsni olib tashlash (cell'dan detach qilishdan OLDIN chaqiriladi)
  function removeFromOcc(day, tsId, lesson) {
    const key = `${day}|${tsId}`;
    const cell = sch[day]?.[tsId] || [];
    if (lesson.teacherId) {
      const stillTeacher = cell.some((l) => l !== lesson && l.teacherId === lesson.teacherId);
      if (!stillTeacher) occTeacher.get(key)?.delete(lesson.teacherId);
      teacherWeekLoad.set(lesson.teacherId, Math.max(0, (teacherWeekLoad.get(lesson.teacherId) || 0) - 1));
    }
    if (lesson.roomId) {
      const stillRoom = cell.some((l) => l !== lesson && l.roomId === lesson.roomId);
      if (!stillRoom) occRoom.get(key)?.delete(lesson.roomId);
    }
    classIdsOf(lesson).forEach((cid) => {
      const stillClass = cell.some((l) => l !== lesson && classIdsOf(l).includes(cid));
      if (!stillClass) occClass.get(key)?.delete(cid);
    });
  }

  function addToOcc(day, tsId, lesson) {
    const key = `${day}|${tsId}`;
    if (lesson.teacherId) {
      grab(occTeacher, key).add(lesson.teacherId);
      teacherWeekLoad.set(lesson.teacherId, (teacherWeekLoad.get(lesson.teacherId) || 0) + 1);
    }
    if (lesson.roomId) grab(occRoom, key).add(lesson.roomId);
    classIdsOf(lesson).forEach((cid) => grab(occClass, key).add(cid));
  }

  function detachLesson(day, tsId, lesson) {
    const cell = sch[day]?.[tsId];
    if (!cell) return;
    const idx = cell.indexOf(lesson);
    if (idx >= 0) cell.splice(idx, 1);
  }

  function attachLesson(day, tsId, lesson) {
    if (!sch[day]) sch[day] = {};
    if (!sch[day][tsId]) sch[day][tsId] = [];
    sch[day][tsId].push(lesson);
  }

  function newLoadOk(extra = 1) {
    return (teacherWeekLoad.get(newTeacherId) || 0) + extra <= newTeacherMax;
  }

  // ——— 2-daraja: SWAP sherigini qidirish ———
  // Sinfning boshqa (boshqa ustozdagi) darsini topamiz:
  //   maqsad dars → sherik turgan joyga (yangi ustoz u yerda bo'sh),
  //   sherik dars → maqsadning eski katagiga (sherik ustozi u yerda bo'sh).
  // Ikkala katak ham to'la qoladi — jadvalda teshik yo'q.
  function findSwapPartner(origDay, origTsId, lesson, classIds, roomId) {
    const origDayIdx = DAYS.indexOf(origDay);
    // Avval o'sha kun, keyin yaqin kunlar (kun ichidagi tuzilma saqlansin)
    const dayOrder = [...DAYS].sort((a, b) => (
      Math.abs(DAYS.indexOf(a) - origDayIdx) - Math.abs(DAYS.indexOf(b) - origDayIdx)
    ));

    for (const day2 of dayOrder) {
      if (newTeacherOff.has(day2)) continue;
      for (let i = 0; i < T; i++) {
        const ts2 = teachingTs[i];
        if (day2 === origDay && ts2.id === origTsId) continue;
        if (slotBlockedForClasses(day2, ts2.id, classIds)) continue;

        const cell = sch[day2]?.[ts2.id] || [];
        for (const partner of cell) {
          if (partner === lesson) continue;
          // ketgan ustozning boshqa darsi bilan almashish ma'nosiz (u ham ko'chadi)
          if (partner.teacherId === oldTeacherId) continue;
          // guruh darslari buzilmasligi uchun sinf to'plami aynan bir xil bo'lsin
          const pClasses = classIdsOf(partner);
          if (!sameClassSet(pClasses, classIds)) continue;

          // — Maqsad dars sherik joyiga sig'adimi (sherik ketadi deb hisoblaymiz) —
          if (!teacherFreeInCell(day2, ts2.id, newTeacherId, [partner])) continue;
          if (!classesFreeInCell(day2, ts2.id, classIds, [partner])) continue;
          if (!roomFreeInCell(day2, ts2.id, roomId, [partner])) continue;
          if (!newLoadOk(1)) continue;

          // — Sherik dars eski katakka sig'adimi (maqsad ketadi deb hisoblaymiz) —
          const pOff = teacherOffDays(partner.teacherId);
          if (pOff.has(origDay)) continue;
          if (!teacherFreeInCell(origDay, origTsId, partner.teacherId, [lesson])) continue;
          if (!classesFreeInCell(origDay, origTsId, pClasses, [lesson])) continue;
          if (!roomFreeInCell(origDay, origTsId, partner.roomId || "", [lesson])) continue;

          return { partner, day: day2, tsId: ts2.id };
        }
      }
    }
    return null;
  }

  // ——— Har bir maqsad darsni qayta ishlash ———
  let inPlace = 0, swapped = 0;

  for (const target of targets) {
    const { day, tsId, lesson } = target;
    const classIds = classIdsOf(lesson);
    const roomId = lesson.roomId || "";

    // === 1-DARAJA: o'z joyida qoldirish (faqat ustoz nomi almashadi) ===
    if (canStayInPlace(day, tsId, classIds, roomId, lesson) && newLoadOk(1)) {
      removeFromOcc(day, tsId, lesson);
      lesson.teacherId = newTeacherId;
      addToOcc(day, tsId, lesson);
      inPlace += 1;
      result.changes.push({
        classIds, subjectId: lesson.subjectId, kind: "inPlace",
        from: { day, tsId }, to: { day, tsId },
      });
      continue;
    }

    // === 2-DARAJA: sinfning boshqa darsi bilan O'RIN ALMASHUV (swap) ===
    const swap = findSwapPartner(day, tsId, lesson, classIds, roomId);
    if (swap) {
      const { partner, day: d2, tsId: t2 } = swap;

      // Ikkala darsni ham indekslardan va kataklardan chiqaramiz
      removeFromOcc(day, tsId, lesson);
      removeFromOcc(d2, t2, partner);
      detachLesson(day, tsId, lesson);
      detachLesson(d2, t2, partner);

      // Maqsad dars → sherik joyiga, yangi ustoz bilan
      lesson.teacherId = newTeacherId;
      attachLesson(d2, t2, lesson);
      addToOcc(d2, t2, lesson);

      // Sherik dars → bo'shagan eski katakka (teshik yopiladi)
      attachLesson(day, tsId, partner);
      addToOcc(day, tsId, partner);

      swapped += 1;
      result.changes.push({
        classIds, subjectId: lesson.subjectId, kind: "swapped",
        from: { day, tsId }, to: { day: d2, tsId: t2 },
      });
      result.movedOthers.push({
        teacherId: partner.teacherId,
        classIds: classIdsOf(partner),
        subjectId: partner.subjectId,
        from: { day: d2, tsId: t2 },
        to: { day, tsId },
      });
      continue;
    }

    // === Iloji bo'lmadi ===
    // Dars joyida, eski ustoz nomida qoladi — katak bo'shamaydi, jadval buzilmaydi
    result.failed.push({
      classIds, subjectId: lesson.subjectId, at: { day, tsId },
    });
  }

  result.summary = {
    ok: result.failed.length === 0,
    totalLessons: targets.length,
    inPlace,
    swapped,
    failed: result.failed.length,
    uncoveredSubjects,
    oldTeacherName: oldTeacher?.name || oldTeacherId,
    newTeacherName: newTeacher?.name || newTeacherId,
  };

  return result;
}