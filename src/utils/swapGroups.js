// ═══════════════════════════════════════════════════════════════════
//  FAN ALMASHINUVI — «guruhlar har xil fan o'qiydi va keyingi soatda
//  almashadi» (`splitEnabled` + `swapEnabled`)
//
//  Dars HAR DOIM 2 soatlik blok bo'lib tushadi:
//
//    1-soat   1-guruh → ASOSIY fan   (subjectId / teacherId / roomId)
//             2-guruh → 2-FAN        (swapSubjectId / swapTeacherId / swapRoomId)
//    2-soat   1-guruh → 2-FAN        ← guruhlar almashdi
//             2-guruh → ASOSIY fan
//
//  ⚠️ USTOZ ALMASHGANDAN KEYIN O'ZGARISHI MUMKIN (`swapAltTeachers`).
//  Masalan 1-guruh Rus tilini Samadjonovadan o'qiydi, keyingi soatda esa
//  o'sha guruhga Informatikani boshqa ustoz beradi — 2-soatning ustozi va
//  xonasi alohida tanlanadi:
//
//    ASOSIY fan 2-soatda → swapNextTeacherId  / swapNextRoomId
//    2-FAN      2-soatda → swapNextTeacher2Id / swapNextRoom2Id
//
//  Bayroq o'chiq bo'lsa (yoki maydon bo'sh bo'lsa) — 1-soatdagi ustoz/xona
//  davom etadi, ya'ni eski xatti-harakat aynan saqlanadi.
//
//  ⚠️ Almashinuv yozuvlarini QO'LDA o'qimang — shu yordamchilardan
//  foydalaning. Aks holda 2-soatning ustozi bir joyda hisobga olinib,
//  boshqasida unutiladi va ustoz bir vaqtda ikki sinfda paydo bo'ladi.
// ═══════════════════════════════════════════════════════════════════

/** Almashinuv shu qatorda HAQIQATAN ishlaydimi (fan ham, ustoz ham bor) */
export function swapActive(a) {
  return Boolean(a && a.splitEnabled && a.swapEnabled && a.swapSubjectId && a.swapTeacherId);
}

/** 2-soatda ustoz/xona alohida tanlanganmi */
export function swapAltOn(a) {
  return Boolean(a && a.swapEnabled && a.swapAltTeachers);
}

/**
 * Ikkala fanning IKKI SOATDAGI ustozi va xonasi.
 * Natija: { main: { subjectId, r1, r2 }, second: { subjectId, r1, r2 } },
 * bunda r1 — 1-soat, r2 — 2-soat: `{ teacherId, roomId }`.
 */
export function swapSides(a) {
  const alt = swapAltOn(a);
  const main = {
    subjectId: a?.subjectId || "",
    r1: { teacherId: a?.teacherId || "", roomId: a?.roomId || "" },
    // Bo'sh maydon = «1-soatdagidek» (ustoz ham, xona ham)
    r2: {
      teacherId: (alt && a?.swapNextTeacherId) || a?.teacherId || "",
      roomId: (alt && a?.swapNextRoomId) || a?.roomId || "",
    },
  };
  const second = {
    subjectId: a?.swapSubjectId || "",
    r1: { teacherId: a?.swapTeacherId || "", roomId: a?.swapRoomId || "" },
    r2: {
      teacherId: (alt && a?.swapNextTeacher2Id) || a?.swapTeacherId || "",
      roomId: (alt && a?.swapNextRoom2Id) || a?.swapRoomId || "",
    },
  };
  return { main, second };
}

/**
 * Blokning `round`-soatidagi (0 yoki 1) guruhlar.
 * Har element: `{ groupPart, subjectId, teacherId, roomId }`.
 * 0-soat: 1-guruh asosiy fan, 2-guruh 2-fan; 1-soat — teskarisi.
 */
export function swapRoundGroups(a, round = 0) {
  const { main, second } = swapSides(a);
  const r = round === 0 ? "r1" : "r2";
  const first = round === 0 ? main : second;
  const secondSide = round === 0 ? second : main;
  return [
    { groupPart: a?.groupName1 || "1-guruh", subjectId: first.subjectId, teacherId: first[r].teacherId, roomId: first[r].roomId || "" },
    { groupPart: a?.groupName2 || "2-guruh", subjectId: secondSide.subjectId, teacherId: secondSide[r].teacherId, roomId: secondSide[r].roomId || "" },
  ];
}

/** Ikkala soatning guruhlari: `[[1-soat guruhlari], [2-soat guruhlari]]` */
export function swapSlotGroups(a) {
  return [swapRoundGroups(a, 0), swapRoundGroups(a, 1)];
}

/** Almashinuvda qatnashadigan BARCHA ustozlar (takrorsiz) */
export function swapTeacherIds(a) {
  const { main, second } = swapSides(a);
  return [...new Set([main.r1.teacherId, main.r2.teacherId, second.r1.teacherId, second.r2.teacherId].filter(Boolean))];
}

/** Almashinuvda ishlatiladigan BARCHA xonalar (takrorsiz) */
export function swapRoomIds(a) {
  const { main, second } = swapSides(a);
  return [...new Set([main.r1.roomId, main.r2.roomId, second.r1.roomId, second.r2.roomId].filter(Boolean))];
}

// ——— USTOZ SOATI ———
// Almashinuv `weeklyHours` ta 2 soatlik blokdan iborat, ya'ni har blokda
// har bir ustoz 1 soat ishlaydi. Demak 2-soatda ALOHIDA ustoz tanlangan
// bo'lsa — har ikkalasi `weeklyHours` soat oladi. Ustoz ikkala soatda ham
// o'zi tursa hisob ilgarigidek `weeklyHours` bo'lib qolaveradi (bu qoida
// hamma joyda bir xil: ustoz almashinuv qatoridan `weeklyHours` soat oladi).

/** Shu fanni almashinuvda beradigan ustozlar (asosiy yoki 2-fan) */
export function swapTeachersOfSubject(a, subjectId) {
  if (!subjectId) return [];
  const { main, second } = swapSides(a);
  const side = main.subjectId === subjectId ? main : (second.subjectId === subjectId ? second : null);
  if (!side) return [];
  return [...new Set([side.r1.teacherId, side.r2.teacherId].filter(Boolean))];
}
