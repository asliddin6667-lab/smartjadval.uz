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
export const PAIR_MAX_EXTRA = 2;        // qo'shimcha PARALLEL SINFLAR soni
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

// Guruh qaysi "dars oqimi"ga tegishli. Umumiy guruh parallel sinflarda
// BITTA dars — shuning uchun ustoz soati bir marta sanalsin.
export function pairGroupSignature(a, g, classId) {
  const pk = String(a?.pairGroupKey || "").trim();
  return g.shared && pk
    ? `PS|${pk}|${a.subjectId}|${g.gid}`
    : `PC|${classId}|${a.subjectId}|${g.gid}`;
}

// Shu qatordagi BARCHA fanlar (1-guruh + qolganlari)
export function pairSubjectIds(a) {
  return pairAllGroups(a).map((g) => g.subjectId).filter(Boolean);
}
