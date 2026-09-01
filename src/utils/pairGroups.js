// ═══════════════════════════════════════════════════════════════════
//  BIR VAQTDA BIR NECHTA FAN — GURUHLAR MODELI
// ═══════════════════════════════════════════════════════════════════
//
//  Sinf bir necha guruhga bo'linadi va guruhlar AYNI BIR SOATDA turli
//  fan o'qiydi. Guruhlar:
//
//    1-guruh  — qatorning O'Z fani (`subjectId` + `teacherId` + `roomId`).
//               Parallel sinflarda HAR DOIM umumiy: bitta dars, bitta ustoz.
//    2-guruh  — `pairSubjectId` / `pairTeacherId` / `pairRoomId`.
//               `pairShare2` yoqilsa — u ham parallel sinflarda UMUMIY.
//    3-guruh+ — `pairExtra[]` massivi. Har birida o'z `shared` bayrog'i bor.
//
//  «Umumiy» (shared) guruh — parallel sinflarning hammasi uchun BITTA dars
//  (bitta fan, bitta ustoz, bitta xona). «Umumiy emas» — har sinfda o'zi.
//
//  Massivning STRUKTURASI (gid / name / shared) guruhdagi barcha sinfda
//  bir xil turadi; qiymatlar esa umumiy guruhda bir xil, aks holda sinfga xos.
//
export const PAIR_MAX_EXTRA = 5;        // qo'shimcha PARALLEL SINFLAR soni (jami 6 sinf)
export const PAIR_MAX_GROUPS = 6;       // bitta kartadagi guruhlar soni (1-guruh bilan)
export const PAIR_MAX_EXTRA_GROUPS = PAIR_MAX_GROUPS - 2;

// Yangi guruh uchun barqaror, takrorlanmaydigan kalit
export function makePairGroupId() {
  return `g${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 5)}`;
}

export function makePairGroup(index = 3) {
  return {
    gid: makePairGroupId(),
    name: `${index}-guruh`,
    shared: false,
    subjectId: "",
    teacherId: "",
    roomId: "",
  };
}

// `pairExtra` ni xavfsiz shaklga keltiradi (bulutdan noto'g'ri kelsa ham)
export function normalizePairExtra(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  raw.forEach((g, i) => {
    if (!g || typeof g !== "object") return;
    let gid = String(g.gid || "").trim() || makePairGroupId();
    while (seen.has(gid)) gid = makePairGroupId();
    seen.add(gid);
    out.push({
      gid,
      name: String(g.name || `${i + 3}-guruh`),
      shared: Boolean(g.shared),
      subjectId: g.subjectId || "",
      teacherId: g.teacherId || "",
      roomId: g.roomId || "",
    });
  });
  return out.slice(0, PAIR_MAX_EXTRA_GROUPS);
}

// 2-guruh + qo'shimcha guruhlar (1-guruhsiz). Fani tanlanmagan guruh
// tashlanadi — u hali sozlanmagan, jadvalga chiqmaydi.
export function pairSideGroups(a) {
  if (!a || !a.pairEnabled) return [];
  const out = [];
  if (a.pairSubjectId) {
    out.push({
      gid: "g2",
      name: a.groupName2 || "2-guruh",
      shared: Boolean(a.pairShare2),
      subjectId: a.pairSubjectId,
      teacherId: a.pairTeacherId || "",
      roomId: a.pairRoomId || "",
    });
  }
  normalizePairExtra(a.pairExtra).forEach((g) => {
    if (g.subjectId) out.push(g);
  });
  return out;
}

// Sozlash oynasi uchun — fani tanlanmagan guruhlar ham qaytadi
export function pairSideSlots(a) {
  if (!a) return [];
  const out = [{
    gid: "g2",
    name: a.groupName2 || "2-guruh",
    shared: Boolean(a.pairShare2),
    subjectId: a.pairSubjectId || "",
    teacherId: a.pairTeacherId || "",
    roomId: a.pairRoomId || "",
    isSecond: true,
  }];
  normalizePairExtra(a.pairExtra).forEach((g) => out.push({ ...g, isSecond: false }));
  return out;
}

// 1-guruh + qolgan guruhlar — kartada ko'rsatish uchun to'liq ro'yxat
export function pairAllGroups(a) {
  if (!a || !a.pairEnabled) return [];
  return [
    {
      gid: "g1",
      name: a.groupName1 || "1-guruh",
      shared: true,
      subjectId: a.subjectId || "",
      teacherId: a.teacherId || "",
      roomId: a.roomId || "",
    },
    ...pairSideGroups(a),
  ];
}

// ——— KARTA = BITTA SOAT ———
// Kartadagi barcha guruh AYNI SOATDA o'qiydi, parallel sinflar esa bitta
// kartani baham ko'radi. Demak ustoz kartada nechta guruhda tursa ham
// (va nechta sinf bo'lsa ham) KO'PI BILAN `weeklyHours` soat band bo'ladi —
// u bir vaqtda ikki joyda tura olmaydi.
//
// Shu kalit yordamida ustoz soati kartada BIR MARTA sanaladi. Qoida
// `shared` bayrog'iga bog'liq emas: bir xil ustoz + bir xil karta = bir xil
// dars, sozlama qanday bo'lishidan qat'i nazar.
export function pairCardKey(a, classId) {
  const pk = String(a?.pairGroupKey || "").trim();
  return pk ? `PK|${pk}|${a?.subjectId || ""}` : `PC|${classId}|${a?.subjectId || ""}`;
}

// Kartadagi BARCHA ustozlar (takrorsiz) — 1-guruh va qolganlari
export function pairTeacherIds(a) {
  return [...new Set(pairAllGroups(a).map((g) => g.teacherId).filter(Boolean))];
}

// A'ZO SINF guruhlari — tuzilishi ASOSIY sinfdan olinadi.
// Guruh nomi va "umumiy" bayrog'i kartaga tegishli, shuning uchun ular
// har doim asosiy sinfnikidan o'qiladi; qiymatlar esa umumiy guruhda
// asosiy sinfdan, aks holda a'zoning o'zidan. Shu tufayli bayroq
// sinflar orasida nomutanosib bo'lib qolsa ham ekran to'g'ri ko'rsatadi.
export function pairAlignSlots(owner, member) {
  const mine = pairSideSlots(member);
  return pairSideSlots(owner).map((og) => {
    if (og.shared) return { ...og };
    const mg = mine.find((x) => x.gid === og.gid);
    return {
      ...og,
      subjectId: mg?.subjectId || "",
      teacherId: mg?.teacherId || "",
      roomId: mg?.roomId || "",
    };
  });
}

// Shu qatordagi BARCHA fanlar (1-guruh + qolganlari)
export function pairSubjectIds(a) {
  return pairAllGroups(a).map((g) => g.subjectId).filter(Boolean);
}
