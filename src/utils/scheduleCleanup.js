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

// Bitta sinfdan bitta fanni olib tashlash
export function removeSubjectLessons(schedule, classId, subjectId) {
  if (!classId || !subjectId) return { schedule, removed: 0 };
  return stripSchedule(schedule, [classId], l => l.subjectId === subjectId);
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
  let touched = false;
  const next = {};
  Object.entries(res.schedule || {}).forEach(([day, slots]) => {
    if (!slots || typeof slots !== "object") { next[day] = slots; return; }
    const dayOut = {};
    Object.entries(slots).forEach(([tsId, cell]) => {
      dayOut[tsId] = (Array.isArray(cell) ? cell : []).map((l) => {
        if (l.altSubjectId !== subjectId) return l;
        touched = true;
        return { ...l, alternating: false, altSubjectId: "", altTeacherId: "", altRoomId: "" };
      });
    });
    next[day] = dayOut;
  });
  return { schedule: touched ? next : res.schedule, removed: res.removed };
}
