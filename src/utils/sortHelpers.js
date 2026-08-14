// =====================================================================
//  smartjadval — ALIFBO BO'YICHA TARTIBLASH (umumiy yordamchi)
//
//  Platformada ham lotin (Matematika, Ona tili), ham kirill (Русский язык,
//  Азбука) nomlar ishlatiladi. Oddiy String.sort() kirillni lotindan keyin
//  tashlaydi va katta/kichik harfni noto'g'ri ajratadi. Shuning uchun
//  hamma joyda bitta Intl.Collator ishlatiladi:
//
//    - numeric: true      → 1-A, 2-A, ... 9-A, 10-A (10-A 2-A dan keyin)
//    - sensitivity: base  → "ona tili" va "Ona tili" bir xil hisoblanadi
//
//  Ishlatish:
//    import { sortByName, cmpName } from "../utils/sortHelpers";
//    sortByName(teachers).map(...)
//    [...list].sort((a, b) => cmpName(a.name, b.name))
// =====================================================================

export const nameCollator = new Intl.Collator(["uz", "ru", "en"], {
  numeric: true,
  sensitivity: "base",
});

/** Ikki nomni alifbo bo'yicha solishtiradi (sort ichida ishlatiladi) */
export function cmpName(a, b) {
  return nameCollator.compare(String(a ?? ""), String(b ?? ""));
}

/** Obyektlar ro'yxatini `name` maydoni bo'yicha tartiblaydi (yangi massiv qaytaradi) */
export function sortByName(list) {
  return [...(list || [])].sort((a, b) => cmpName(a?.name, b?.name));
}

/** Ixtiyoriy maydon bo'yicha tartiblash: sortByField(rooms, "title") */
export function sortByField(list, field = "name") {
  return [...(list || [])].sort((a, b) => cmpName(a?.[field], b?.[field]));
}

// Ma'no jihatidan aniqroq nomlar (kodda o'qilishi oson bo'lsin)
export const sortClasses = sortByName;
export const sortTeachers = sortByName;
export const sortSubjects = sortByName;
export const sortRooms = sortByName;
