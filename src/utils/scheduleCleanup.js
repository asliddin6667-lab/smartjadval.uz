// Sinf fanlari ro'yxatidan fan olib tashlanganda — dars jadvalida qolib
// ketgan darslarni ham tozalaydi.
//
// Ilgari "Sinf fanlari" sahifasidagi belgini olib tashlash faqat
// `classSubjects` ni o'zgartirardi. Jadvaldagi dars esa joyida qolar,
// uni faqat qayta generatsiya yo'qotardi — natijada ro'yxatda yo'q fan
// jadvalda "arvoh" bo'lib turardi.

// Dars qaysi sinflarga tegishli
function lessonClassIds(l) {
  if (Array.isArray(l?.classIds) && l.classIds.length) return l.classIds;
  return l?.classId ? [l.classId] : [];
}

// Sanab o'tilgan sinflarni darsdan chiqarish.
// Boshqa sinf qolmasa — null (dars butunlay o'chadi).
function withoutClasses(l, drop) {
  const rest = lessonClassIds(l).filter(id => !drop.includes(id));
  if (!rest.length) return null;
  return { ...l, classIds: rest, classId: rest.includes(l.classId) ? l.classId : rest[0] };
}

// Bitta katakni tozalash. `hit(lesson, classId)` — shu dars shu sinf uchun
// o'chirilishi kerakmi.
function cleanCell(cell, classIds, hit) {
  const src = Array.isArray(cell) ? cell : [];
  let removed = 0;
  let changed = false;

  // "Bir vaqtda 2 fan" kartasi ikki darsdan iborat (`pairKey`). Bir yarmi
  // o'chsa — ikkinchisi egasiz qoladi, shuning uchun u ham ketadi.
  const dropPairs = new Set();

  const pass = (list, match) => {
    const out = [];
    list.forEach((l) => {
      const targets = match(l);
      if (!targets.length) { out.push(l); return; }
      changed = true;
      removed += 1;
      if (l.pairKey) targets.forEach(cid => dropPairs.add(`${l.pairKey}\u0000${cid}`));
      const shrunk = withoutClasses(l, targets);
      if (shrunk) out.push(shrunk);
    });
    return out;
  };

  const first = pass(src, (l) => {
    const scope = classIds || lessonClassIds(l);
    return scope.filter(cid => lessonClassIds(l).includes(cid) && hit(l, cid));
  });
  if (!dropPairs.size) return { cell: first, removed, changed };

  const second = pass(first, l => (
    l.pairKey ? lessonClassIds(l).filter(cid => dropPairs.has(`${l.pairKey}\u0000${cid}`)) : []
  ));

  return { cell: second, removed, changed };
}

// Jadvalni tozalab, yangi nusxa qaytaradi.
// `hit(lesson, classId)` — o'chirish sharti; `classIds` — tegiladigan sinflar
// (null bo'lsa — darsning barcha sinflari).
function stripSchedule(schedule, classIds, hit) {
  if (!schedule || (classIds && !classIds.length)) return { schedule, removed: 0 };
  let removed = 0;
  let touched = false;
  const next = {};

  Object.entries(schedule).forEach(([day, slots]) => {
    if (!slots || typeof slots !== "object") { next[day] = slots; return; }
    const dayOut = {};
    Object.entries(slots).forEach(([tsId, cell]) => {
      const res = cleanCell(cell, classIds, hit);
      removed += res.removed;
      if (res.changed) touched = true;
      if (res.cell.length) dayOut[tsId] = res.cell;
    });
    next[day] = dayOut;
  });

  return touched ? { schedule: next, removed } : { schedule, removed: 0 };
}

// Juft-hafta almashinuvining IKKINCHI yarmi o'chirilgan fan bo'lsa — dars
// saqlanadi (birinchi fan hali ham haqiqiy), faqat almashinuv bekor qilinadi.
// Aks holda o'chirilgan fan katakda "bir hafta …" yozuvi bo'lib qolaverardi.
function clearAltHalves(schedule, hit) {
  let touched = false;
  const next = {};
  Object.entries(schedule || {}).forEach(([day, slots]) => {
    if (!slots || typeof slots !== "object") { next[day] = slots; return; }
    const dayOut = {};
    Object.entries(slots).forEach(([tsId, cell]) => {
      dayOut[tsId] = (Array.isArray(cell) ? cell : []).map((l) => {
        if (!l?.altSubjectId || !hit(l)) return l;
        touched = true;
        return { ...l, alternating: false, altSubjectId: "", altTeacherId: "", altRoomId: "" };
      });
    });
    next[day] = dayOut;
  });
  return touched ? next : schedule;
}

// Bitta sinfdan bitta fanni olib tashlash
export function removeSubjectLessons(schedule, classId, subjectId) {
  if (!classId || !subjectId) return { schedule, removed: 0 };
  const res = stripSchedule(schedule, [classId], l => l.subjectId === subjectId);
  const cleared = clearAltHalves(
    res.schedule,
    l => l.altSubjectId === subjectId && lessonClassIds(l).includes(classId)
  );
  return { schedule: cleared, removed: res.removed };
}

// Bir nechta sinfning barcha darslarini olib tashlash
export function removeClassesLessons(schedule, classIds) {
  const ids = (classIds || []).filter(Boolean);
  if (!ids.length) return { schedule, removed: 0 };
  return stripSchedule(schedule, ids, () => true);
}

// Fan butunlay o'chirilganda — barcha sinflardagi darslarini olib tashlash.
// Juft-hafta almashinuvida shu fan IKKINCHI yarim bo'lsa, dars saqlanadi,
// faqat almashinuv bekor qilinadi (birinchi fan hali ham haqiqiy).
export function removeSubjectEverywhere(schedule, subjectId) {
  if (!subjectId) return { schedule, removed: 0 };
  const res = stripSchedule(schedule, null, l => l.subjectId === subjectId);
  return {
    schedule: clearAltHalves(res.schedule, l => l.altSubjectId === subjectId),
    removed: res.removed,
  };
}

// Bir nechta (sinf, fan) biriktirmasining darslarini birdaniga olib tashlash.
// `pairs` — [{ classId, subjectId }]. "Yetim" (fanlar ro'yxatida yo'q) yoki
// sinf tiliga mos kelmaydigan biriktirmalar guruh bilan o'chirilganda kerak:
// yozuv classSubjects'dan ketsa ham, dars jadvalda qolib soat sifatida
// hisoblanaverardi.
export function removeAssignmentsLessons(schedule, pairs) {
  const map = new Map(); // classId -> Set(subjectId)
  (pairs || []).forEach((p) => {
    if (!p?.classId || !p?.subjectId) return;
    if (!map.has(p.classId)) map.set(p.classId, new Set());
    map.get(p.classId).add(p.subjectId);
  });
  if (!map.size) return { schedule, removed: 0 };
  const res = stripSchedule(schedule, [...map.keys()], (l, cid) => Boolean(map.get(cid)?.has(l.subjectId)));
  const cleared = clearAltHalves(
    res.schedule,
    l => lessonClassIds(l).some(cid => map.get(cid)?.has(l.altSubjectId))
  );
  return { schedule: cleared, removed: res.removed };
}
