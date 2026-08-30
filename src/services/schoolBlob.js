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
  // 4 soat blok — faqat superadmin yoqadi, shuning uchun default o'chiq
  allowQuad: false,
  swapEnabled: false,
  // Almashgandan keyingi (2-) soatga ALOHIDA ustoz/xona tanlash.
  // O'chiq bo'lsa 1-soatdagi ustoz davom etadi —
  // [swapGroups.js](../utils/swapGroups.js).
  swapAltTeachers: false,
  swapNextTeacherId: "",
  swapNextRoomId: "",
  swapNextTeacher2Id: "",
  swapNextRoom2Id: "",
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
  // 2-guruh fani ham parallel sinflarda UMUMIY bo'lsinmi (bitta dars,
  // bitta ustoz). O'chiq bo'lsa — har sinfda o'z fani.
  pairShare2: false,
  // Bir vaqtda 2 fan + PARALLEL sinflar: 1-guruh fani bir nechta sinfda
  // UMUMIY (bitta dars), 2-guruh fani esa har sinfda boshqa bo'lishi mumkin.
  // Shu kalit bir guruhga kiruvchi sinflarni bog'laydi.
  pairGroupKey: "",
};

// Bo'sh massiv sifatida tashlanadigan maydonlar
// `pairExtra` — 3-guruh, 4-guruh... (bir vaqtda 3+ fan)
const CS_EMPTY_ARRAYS = ["levelGroups", "pairExtra"];

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

// =====================================================================
//  SIQISH (gzip) — "KONTEYNER" FORMATI  `_v = 4`
//
//  NIMA UCHUN: bulutdagi joyning ~97% i zaxira nusxalarga ketadi
//  (`school_backups` da har foydalanuvchida o'nlab TO'LIQ nusxa).
//  O'lchov: 30 sinflik maktabning `schedule` kaliti 192 KB, gzip'dan
//  keyin 10 KB — 19 barobar. Base64 bilan birga ham ~14 barobar.
//
//  FORMAT: tashqi qobiq JSONB bo'lib qoladi, faqat og'ir qismi
//  base64(gzip(JSON)) ko'rinishida `_z` ga tushadi:
//
//      { "_v": 4, "_z": "H4sIA...", "_rev": 12, "_ts": 17..., "_dev": "d1a.." }
//
//  ⚠️ `_rev`/`_ts`/`_dev` TASHQARIDA qoladi — CAS so'rovi
//  (`data->>'_rev'`) va `readCloudHead()` shularni o'qiydi. Ularni
//  ichkariga yashirish sinxronizatsiyani buzadi.
//
//  ⚠️ ESKI ILOVA YANGI FORMATNI O'QIY OLMAYDI. Shuning uchun yozish
//  IKKI BOSQICHDA yoqiladi — pastdagi WRITE_COMPRESSED izohiga qarang.
// =====================================================================

// Siqilgan konteyner versiyasi (ichkaridagi blob esa WIRE_VERSION = 3)
export const ZIP_VERSION = 4;

// ---------------------------------------------------------------------
//  ⚠️⚠️  IKKI BOSQICHLI YOQISH — DIQQAT BILAN O'QING  ⚠️⚠️
//
//  `false` (hozirgi holat):
//      • siqilgan nusxani O'QIY oladi;
//      • lekin O'ZI hamon eski (siqilmagan) formatda yozadi.
//    Ya'ni bu versiya HAR QANDAY eski ilova bilan to'liq mos.
//
//  `true` (2-bosqich):
//      • yangi ma'lumot siqib yoziladi (~3-4 barobar kam joy).
//    Buni FAQAT yuqoridagi versiya kamida 1-2 hafta saytda turgandan
//    keyin yoqing. Sabab: o'sha vaqt ichida hamma qurilma yangi kodni
//    yuklab oladi. Aks holda ochiq qolgan ESKI ilova siqilgan blobni
//    "bo'sh" deb o'qib, ekranni bo'shatib qo'yishi mumkin.
//
//  ⚠️⚠️ 2026-08-30 DAGI O'LCHOV — HOZIRCHA YOQMANG ⚠️⚠️
//
//  Ishlab turgan bazada o'lchandi: Postgres `jsonb` ni TOAST/pglz bilan
//  ALLAQACHON 7.1 barobar siqib saqlayotgan ekan (xom 294 KB -> diskda
//  41 KB). Bu yerdagi gzip esa xom JSON ga nisbatan 12.5 barobar beradi.
//  Demak DISKDAGI haqiqiy qo'shimcha yutuq — atigi 12.5 / 7.1 ≈ 1.7x.
//
//  1.7x uchun formatni o'zgartirish arzimaydi: eski ilova siqilganni
//  o'qiy olmaydi, ya'ni ikki bosqichli deploy va ochiq qolgan tab xavfi
//  paydo bo'ladi. Joy muammosi esa `school_backups` ning POG'ONALI
//  tozalanishi bilan hal qilindi (137 MB -> ~50 MB, school_backups_setup.sql).
//
//  QACHON QAYTA O'YLASH KERAK: maktablar soni 5-10 barobar o'sib,
//  `school_backups` 250 MB dan oshsa. O'shanda avval yuqoridagi
//  o'lchovni takrorlang (pglz nisbati o'zgargan bo'lishi mumkin).
//
//  Yoqish = shu yerdagi `false` ni `true` ga o'zgartirib, qayta deploy —
//  lekin faqat bu kod 1-2 hafta saytda turgandan keyin.
//  Orqaga qaytarish xavfsiz: `true` -> `false` qilinsa, ilova siqilgan
//  eski yozuvlarni baribir o'qiyveradi.
// ---------------------------------------------------------------------
export const WRITE_COMPRESSED = false;

// Brauzer gzip'ni qo'llab-quvvatlaydimi? (Chrome 80+, Safari 16.4+, FF 113+)
export function canCompress() {
  return typeof CompressionStream !== "undefined"
    && typeof Blob !== "undefined"
    && typeof Response !== "undefined";
}

function canDecompress() {
  return typeof DecompressionStream !== "undefined"
    && typeof Blob !== "undefined"
    && typeof Response !== "undefined";
}

// Uint8Array -> base64. `btoa` ga butun massivni bir yo'la bersak
// (`String.fromCharCode(...bytes)`) katta blobda stek to'lib ketadi,
// shuning uchun bo'lak-bo'lak o'giriladi.
function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzipString(str) {
  const stream = new Blob([new TextEncoder().encode(str)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipToString(bytes) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------------
//  BULUTGA YOZISH UCHUN TAYYORLASH
//  Siqib bo'lmasa — eski format qaytadi (ma'lumot hech qachon
//  yo'qolmaydi, faqat joy ko'proq ketadi).
// ---------------------------------------------------------------------
// `compress` — sinov skripti uchun bekor qilish imkoni
// (scripts/blobRoundtrip.mjs). Odatda WRITE_COMPRESSED ishlatiladi.
export async function packBlob(blob, stamp = {}, { compress = WRITE_COMPRESSED } = {}) {
  const inner = encodeBlob(blob, stamp);
  if (!compress || !canCompress()) return inner;

  try {
    const z = bytesToBase64(await gzipString(JSON.stringify(inner)));
    if (!z) return inner;
    return {
      _v: ZIP_VERSION,
      _z: z,
      _rev: inner._rev,
      _ts: inner._ts,
      _dev: inner._dev,
    };
  } catch (e) {
    console.warn("⚠️ Siqib bo'lmadi, oddiy formatda yoziladi:", e);
    return inner;
  }
}

// ---------------------------------------------------------------------
//  BULUTDAN KELGANINI OCHISH
//
//  ⚠️ QAYTARISH QIYMATI: xato bo'lsa `null` (BO'SH OBYEKT EMAS).
//  Chaqiruvchi `null` ni "o'qib bo'lmadi" deb tushunishi va HECH
//  NARSANI ustidan yozmasligi SHART. Eski kodning eng xavfli joyi
//  aynan shu edi: tanimagan formatni "bo'sh ma'lumot" deb qabul qilib,
//  mahalliy nusxani o'chirib yuborardi.
// ---------------------------------------------------------------------
export async function unpackBlob(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw._z !== "string") return decodeBlob(raw);

  if (!canDecompress()) {
    console.warn("⚠️ Brauzer gzip'ni qo'llab-quvvatlamaydi — nusxani ochib bo'lmadi");
    return null;
  }

  try {
    const json = await gunzipToString(base64ToBytes(raw._z));
    const inner = JSON.parse(json);
    if (!inner || typeof inner !== "object") return null;
    return decodeBlob(inner);
  } catch (e) {
    console.warn("⚠️ Siqilgan nusxani ochib bo'lmadi:", e);
    return null;
  }
}
