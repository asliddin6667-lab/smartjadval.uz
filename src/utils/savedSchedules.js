// =====================================================================
//  SAQLANGAN DARS JADVALLARI — umumiy yordamchilar
//
//  Yozuv tuzilishi (`savedSchedules` massivi elementi):
//    {
//      id, name,
//      createdAt, updatedAt,        // ISO sana
//      schedule: { [kun]: { [slotId]: [dars, ...] } },   // to'liq nusxa
//      meta: { lessons, classes, days }                  // ro'yxatda ko'rsatish uchun
//    }
//
//  Bu kalit ham boshqa ma'lumotlar kabi localStorage va bulut bilan
//  sinxronlanadi (cloudSync.js dagi SYNC_KEYS).
// =====================================================================
import { DAYS } from "./constants";
import { genId } from "./helpers";

// Nechta nusxa saqlashga ruxsat. Har bir nusxa butun jadvalni o'z ichiga
// oladi — cheklovsiz to'planib ketsa localStorage kvotasi va bulutga
// yuboriladigan blob keraksiz shishadi.
export const MAX_SAVED = 20;

// Jadvaldagi darslar soni
export function countLessons(schedule) {
  let n = 0;
  Object.values(schedule || {}).forEach((bySlot) => {
    Object.values(bySlot || {}).forEach((list) => {
      if (Array.isArray(list)) n += list.length;
    });
  });
  return n;
}

function classIdsOf(lesson) {
  return Array.isArray(lesson?.classIds) ? lesson.classIds : [lesson?.classId].filter(Boolean);
}

// Ro'yxatda ko'rsatiladigan qisqa statistika
export function describeSaved(schedule, classes = []) {
  const classIds = new Set();
  let lessons = 0;
  let days = 0;

  DAYS.forEach((day) => {
    const bySlot = schedule?.[day];
    if (!bySlot) return;
    let dayHas = false;
    Object.values(bySlot).forEach((list) => {
      if (!Array.isArray(list) || !list.length) return;
      dayHas = true;
      lessons += list.length;
      list.forEach((lesson) => classIdsOf(lesson).forEach((id) => classIds.add(id)));
    });
    if (dayHas) days += 1;
  });

  // Sinf ro'yxati berilgan bo'lsa — o'chirilgan sinflar hisobga olinmaydi
  const known = classes.length
    ? [...classIds].filter((id) => classes.some((c) => c.id === id)).length
    : classIds.size;

  return { lessons, classes: known || classIds.size, days };
}

// Takrorlanmas nom taklif qilish: "Jadval 1", "Jadval 2", ...
export function suggestName(savedSchedules = []) {
  const taken = new Set(savedSchedules.map((s) => String(s?.name || "").trim().toLowerCase()));
  let i = savedSchedules.length + 1;
  while (taken.has(`jadval ${i}`)) i += 1;
  return `Jadval ${i}`;
}

// Ro'yxatga qo'shish yoki mavjud nusxani yangilash — saqlash mantig'i
// bir joyda tursin (Dars jadvali sahifasi ham, Saqlangan jadvallar
// sahifasi ham shu funksiyani chaqiradi).
export function upsertSaved(list = [], { name, overwriteId = null, schedule = {}, classes = [] }) {
  const now = new Date().toISOString();
  const snapshot = JSON.parse(JSON.stringify(schedule || {}));
  const meta = describeSaved(snapshot, classes);

  if (overwriteId) {
    return list.map((s) => (s.id === overwriteId
      ? { ...s, name: name || s.name, updatedAt: now, schedule: snapshot, meta }
      : s));
  }

  return [...list, {
    id: genId(),
    name,
    createdAt: now,
    updatedAt: now,
    schedule: snapshot,
    meta,
  }];
}
