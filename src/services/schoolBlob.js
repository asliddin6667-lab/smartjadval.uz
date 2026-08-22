// =====================================================================
//  smartjadval.UZ — MAKTAB MA'LUMOTI "BLOB" FORMATI
//
//  Bu fayl faqat MA'LUMOT SHAKLI bilan shug'ullanadi: qaysi kalitlar
//  sinxronlanadi, ular bulutga qanday ko'rinishda yoziladi va qanday
//  qaytariladi, qaysi kalit o'zgarganini qanday aniqlaymiz.
//
//  Nima uchun alohida fayl: sinxronizatsiya dvigateli (cloudSync.js) va
//  versiya tarixi (versionService.js) ikkalasi ham shu formatni biladi.
//  Ilgari format cloudSync ichida edi va ikkinchi modul uni import qilsa
//  aylanma bog'liqlik (circular import) hosil bo'lardi.
// =====================================================================

// Sinxronlanadigan kalitlar — App.jsx dagi saveUserData kalitlari bilan bir xil.
// DIQQAT: bu ro'yxat App.jsx state'lari va readLocalData() bilan sinxron
// turishi SHART. Bittasi unutilsa — ma'lumot bulutga bormaydi.
export const SYNC_KEYS = [
  "settings",
  "classes",
  "subjects",
  "teachers",
  "classSubjects",
  "rooms",
  "timeslots",
  "lunchGroups",
  "shifts",
  "schedule",
  "savedSchedules",
];

// Ro'yxatning oldingi ko'rinishlari — eski `lastHash` ni tanish uchun.
// SYNC_KEYS ga yangi kalit qo'shsangiz, hozirgi ro'yxatni shu yerga
// ko'chiring. Aks holda barcha qurilmalar bir marta "o'zgargan" deb
// hisoblanadi.
export const LEGACY_KEY_SETS = [
  ["settings", "classes", "subjects", "teachers", "classSubjects",
   "rooms", "timeslots", "lunchGroups", "shifts", "schedule"],
];

// Har bir kalitning bo'sh qiymati (obyekt yoki massiv)
export const EMPTY = {
  settings: {},
  classes: [],
  subjects: [],
  teachers: [],
  classSubjects: {},
  rooms: [],
  timeslots: [],
  lunchGroups: [],
  shifts: [],
  schedule: {},
  savedSchedules: [],
};

// Ekranda ko'rsatiladigan nomlar (versiya tarixi sahifasi shundan foydalanadi)
export const KEY_TITLES = {
  settings: "Sozlamalar",
  classes: "Sinflar",
  subjects: "Fanlar",
  teachers: "O'qituvchilar",
  classSubjects: "Sinf fanlari",
  rooms: "Xonalar",
  timeslots: "Dars vaqtlari",
  lunchGroups: "Dam olish vaqtlari",
  shifts: "Smenalar",
  schedule: "Dars jadvali",
  savedSchedules: "Saqlangan jadvallar",
};

// Blob formati versiyasi — sparse ko'rinishni tanish uchun
export const WIRE_VERSION = 3;

// Blob ichidagi xizmat maydonlari (SYNC_KEYS ga kirmaydi)
export const WIRE_META = ["_v", "_rev", "_ts", "_dev"];

// ---------------------------------------------------------------------
//  SPARSE SERIALIZATION
//
//  classSubjects tuzilishi:  { [classId]: [ {fan sozlamasi}, ... ] }
//
//  Har bir yozuvda quyidagi maydonlar deyarli doimo default qiymatda
//  turadi. Bulutga yuborishda ular olib tashlanadi, qaytarishda
//  qayta qo'yiladi — natija bayt-ma-bayt bir xil bo'ladi.
//
//  ⚠️ classSubjects yozuviga YANGI MAYDON qo'shsangiz — shu ro'yxatni
//  ham yangilang, aks holda qiymat bulutdan noto'g'ri tiklanadi.
// ---------------------------------------------------------------------
export const CS_DEFAULTS = {
  isCore: false,
  roomId: "",
  roomId2: "",
  groupKey: "",
  groupName1: "1-guruh",
  groupName2: "2-guruh",
  spacedDays: false,
  swapRoomId: "",
  teacherId2: "",
  allowDouble: true,
  swapEnabled: false,
  splitEnabled: false,
  weekAltHours: 1,
  swapSubjectId: "",
  swapTeacherId: "",
  weekAltRoomId: "",
  weekAltEnabled: false,
  parallelEnabled: false,
  weekAltSubjectId: "",
  weekAltTeacherId: "",
  levelGroupEnabled: false,
  levelGroupKey: "",
  levelGroupCount: 0,
  // Bir vaqtda 2 fan (sinf ikkiga bo'linadi, har guruh o'z fanini o'qiydi)
  pairEnabled: false,
  pairSubjectId: "",
  pairTeacherId: "",
  pairRoomId: "",
  // Bir vaqtda 2 fan + PARALLEL sinflar: 1-guruh fani bir nechta sinfda
  // UMUMIY (bitta dars), 2-guruh fani esa har sinfda boshqa bo'lishi mumkin.
  // Shu kalit bir guruhga kiruvchi sinflarni bog'laydi.
  pairGroupKey: "",
};

// Bo'sh massiv sifatida tashlanadigan maydonlar
const CS_EMPTY_ARRAYS = ["levelGroups"];

function encodeEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const out = {};
  for (const k of Object.keys(entry)) {
    const v = entry[k];
    if (Object.prototype.hasOwnProperty.call(CS_DEFAULTS, k) && v === CS_DEFAULTS[k]) continue;
    if (CS_EMPTY_ARRAYS.includes(k) && Array.isArray(v) && v.length === 0) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function decodeEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const out = { ...CS_DEFAULTS };
  for (const k of CS_EMPTY_ARRAYS) out[k] = [];
  return Object.assign(out, entry);
}

function encodeClassSubjects(cs) {
  if (!cs || typeof cs !== "object") return cs;
  const out = {};
  for (const classId of Object.keys(cs)) {
    const list = cs[classId];
    out[classId] = Array.isArray(list) ? list.map(encodeEntry) : list;
  }
  return out;
}

function decodeClassSubjects(cs) {
  if (!cs || typeof cs !== "object") return cs;
  const out = {};
  for (const classId of Object.keys(cs)) {
    const list = cs[classId];
    out[classId] = Array.isArray(list) ? list.map(decodeEntry) : list;
  }
  return out;
}

// Butun blobni "sim uchun" siqish. `stamp` — versiya raqami, o'zgarish
// vaqti va qurilma identifikatori.
export function encodeBlob(blob, stamp = {}) {
  return {
    ...blob,
    classSubjects: encodeClassSubjects(blob.classSubjects),
    _v: WIRE_VERSION,
    _rev: stamp.rev || 0,
    _ts: stamp.ts || 0,
    _dev: stamp.dev || "",
  };
}

// Bulutdan kelgan blobni ochish (eski format ham qo'llab-quvvatlanadi)
export function decodeBlob(raw) {
  if (!raw || typeof raw !== "object") return {};
  const blob = { ...raw };
  const isV3 = raw._v === WIRE_VERSION;
  for (const k of WIRE_META) delete blob[k];
  if (isV3) {
    blob.classSubjects = decodeClassSubjects(blob.classSubjects);
  }
  return blob;
}

// Yetishmayotgan kalitlarni bo'sh qiymat bilan to'ldirish
export function fillBlob(blob) {
  const out = {};
  for (const k of SYNC_KEYS) {
    const v = blob?.[k];
    out[k] = v === undefined || v === null ? EMPTY[k] : v;
  }
  return out;
}

// ---------------------------------------------------------------------
//  Oddiy va tez hash (djb2) — "o'zgardimi?" savoliga javob beradi.
//  Kriptografik emas.
// ---------------------------------------------------------------------
export function quickHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return `${h >>> 0}_${str.length}`;
}

// Bitta kalit qiymatining hash'i — uchtomonlama birlashtirish (merge)
// aynan shularni taqqoslaydi.
export function keyHash(value) {
  return quickHash(JSON.stringify(value === undefined ? null : value));
}

// Butun blob uchun kalitma-kalit hash jadvali
export function hashKeysOf(blob) {
  const out = {};
  for (const k of SYNC_KEYS) out[k] = keyHash(blob?.[k]);
  return out;
}

// Ma'lumot bormi yoki bo'shmi?
export function isEmptyBlob(blob) {
  if (!blob) return true;
  const c = blob.classes, t = blob.teachers, s = blob.subjects;
  return !(c?.length || t?.length || s?.length);
}

// Kalitdagi yozuvlar soni — versiya tarixida "nima bor" ni ko'rsatish uchun
export function countOf(key, value) {
  if (Array.isArray(EMPTY[key])) return Array.isArray(value) ? value.length : 0;
  if (key === "schedule") {
    // jadvaldagi darslar soni: schedule[kun][slotId] = [dars, ...]
    let n = 0;
    Object.values(value || {}).forEach((bySlot) => {
      Object.values(bySlot || {}).forEach((list) => {
        if (Array.isArray(list)) n += list.length;
      });
    });
    return n;
  }
  return Object.keys(value || {}).length;
}

// Butun blob bo'yicha sanoq — versiya tarixi jadvalidagi `counts` ustuni
export function blobCounts(blob) {
  const out = {};
  for (const k of SYNC_KEYS) out[k] = countOf(k, blob?.[k]);
  return out;
}

// Jadvalda xona biriktirilgan darslar soni — "xonalar biriktirilganmi?"
// degan savolga tez javob (versiya tarixida foydali).
export function countRoomAssignments(schedule) {
  let n = 0;
  Object.values(schedule || {}).forEach((bySlot) => {
    Object.values(bySlot || {}).forEach((list) => {
      if (!Array.isArray(list)) return;
      list.forEach((l) => { if (l && l.roomId) n++; });
    });
  });
  return n;
}
