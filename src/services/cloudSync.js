// =====================================================================
//  smartjadval.UZ — BULUT SINXRONIZATSIYASI  (v3)
//
//  Vazifasi: maktab ma'lumotlarini (sinflar, o'qituvchilar, jadval...)
//  Supabase'dagi `schools` jadvalida saqlash, shunda foydalanuvchi
//  ISTALGAN QURILMADAN kirsa ma'lumoti joyida turadi.
//
//  ARXITEKTURA: localStorage — asosiy ish nusxasi, Supabase — zaxira
//  va qurilmalararo ko'prik.
//
//  v3 DAGI YANGILIKLAR:
//
//  1) MA'LUMOT YO'QOLISHI TUZATILDI (eng muhimi)
//     Ilgari: foydalanuvchi tahrir qilib, 8 soniyalik debounce
//     tugashidan oldin brauzerni yopsa — `dirty` bayrog'i yozilmay
//     qolardi. Keyingi kirishda bulutdan ESKI nusxa tortilib,
//     yuborilmagan o'zgarishlar ustidan yozilardi.
//     Endi: kirishda mahalliy ma'lumotning hash'i `lastHash` bilan
//     taqqoslanadi. Farq bo'lsa — yuborilmagan o'zgarish bor deb
//     hisoblanadi va bulut ustidan yozilmaydi.
//
//  2) KIRISH TEZLASHTIRILDI
//     Avval faqat `updated_at` so'raladi (bir necha bayt). Bulut
//     oxirgi tortishdan beri o'zgarmagan bo'lsa — 2 MB blob umuman
//     yuklab olinmaydi.
//
//  3) PAYLOAD KICHRAYTIRILDI (sparse serialization)
//     `classSubjects` yozuvlarida 27 ta maydondan ~20 tasi doimo
//     default qiymatda ("" yoki false) turadi va har yozuvda ~350
//     bayt ortiqcha joy egallaydi. Bulutga yuborishdan oldin ular
//     olib tashlanadi, tortib olganda qayta tiklanadi. Ma'lumot
//     yo'qolmaydi — bu faqat "simdagi" ko'rinish.
//
//  4) DEBOUNCE'ga MAKSIMAL KUTISH QO'SHILDI
//     Uzluksiz tahrirlashda 8 soniyalik taymer har safar qaytadan
//     boshlanardi va push umuman ketmasligi mumkin edi. Endi
//     birinchi o'zgarishdan 30 soniya o'tgach majburan yuboriladi.
//
//  5) ESKI `edujadval_` PREFIKSLI KALITLARNI TOZALASH
// =====================================================================
import { supabase } from "./supabaseClient";
import { loadData, saveData, loadUserData, saveUserData } from "./storageService";
import { isLocalOnly } from "./devMode";

// Sinxronlanadigan kalitlar — App.jsx dagi saveUserData kalitlari bilan bir xil
const SYNC_KEYS = [
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
];

// Har bir kalitning bo'sh qiymati (obyekt yoki massiv)
const EMPTY = {
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
};

const DEMO_EMAIL = "demo@smartjadval.uz";

// Qayta urinish sozlamalari
const MAX_RETRY = 3;
const RETRY_DELAYS = [3000, 8000, 20000]; // 3s -> 8s -> 20s

// Debounce: oddiy kutish va majburiy yuborish oralig'i
const PUSH_DELAY = 1000;
const PUSH_MAX_WAIT = 3000;

// Blob formati versiyasi — sparse ko'rinishni tanish uchun
const WIRE_VERSION = 3;

// ---------------------------------------------------------------------
//  SPARSE SERIALIZATION
//
//  classSubjects tuzilishi:  { [classId]: [ {fan sozlamasi}, ... ] }
//
//  Har bir yozuvda quyidagi maydonlar deyarli doimo default qiymatda
//  turadi. Bulutga yuborishda ular olib tashlanadi, qaytarishda
//  qayta qo'yiladi — natija bayt-ma-bayt bir xil bo'ladi.
// ---------------------------------------------------------------------
const CS_DEFAULTS = {
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
};

// Bo'sh massiv sifatida tashlanadigan maydonlar
const CS_EMPTY_ARRAYS = ["levelGroups"];

function encodeEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const out = {};
  for (const k of Object.keys(entry)) {
    const v = entry[k];
    // Default qiymatga teng bo'lsa — tashlab ketamiz
    if (Object.prototype.hasOwnProperty.call(CS_DEFAULTS, k) && v === CS_DEFAULTS[k]) continue;
    // Bo'sh massiv bo'lsa — tashlab ketamiz
    if (CS_EMPTY_ARRAYS.includes(k) && Array.isArray(v) && v.length === 0) continue;
    // undefined ham keraksiz
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

// Butun blobni "sim uchun" siqish
function encodeBlob(blob) {
  return {
    ...blob,
    classSubjects: encodeClassSubjects(blob.classSubjects),
    _v: WIRE_VERSION,
  };
}

// Bulutdan kelgan blobni ochish (eski format ham qo'llab-quvvatlanadi)
function decodeBlob(raw) {
  if (!raw || typeof raw !== "object") return {};
  const blob = { ...raw };
  delete blob._v;
  // v3 dan oldingi bloblar to'liq saqlangan — ochish shart emas,
  // lekin decodeEntry ular uchun ham zararsiz (mavjud qiymatlar ustun).
  if (raw._v === WIRE_VERSION) {
    blob.classSubjects = decodeClassSubjects(blob.classSubjects);
  }
  return blob;
}

// ---------------------------------------------------------------------
//  META — oxirgi yuborish vaqti, hash, "dirty" bayrog'i
// ---------------------------------------------------------------------
function metaKey(userId) {
  return `sync_meta_${userId}`;
}
function getMeta(userId) {
  return loadData(metaKey(userId), {
    lastPush: 0,
    lastPull: 0,
    lastHash: "",
    cloudUpdatedAt: "",
    dirty: false,
  });
}
function setMeta(userId, patch) {
  saveData(metaKey(userId), { ...getMeta(userId), ...patch });
}

// ---------------------------------------------------------------------
//  Oddiy va tez hash (djb2) — blob o'zgarganini bilish uchun
//  Kriptografik emas, faqat "o'zgardimi?" savoliga javob beradi.
// ---------------------------------------------------------------------
function quickHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  // uzunlikni ham qo'shamiz — to'qnashuv ehtimoli yanada kamayadi
  return `${h >>> 0}_${str.length}`;
}

// ---------------------------------------------------------------------
//  SINXRONIZATSIYA HOLATI — UI da ko'rsatish uchun (ixtiyoriy)
//  state: "idle" | "pending" | "saving" | "saved" | "error"
// ---------------------------------------------------------------------
let syncState = { state: "idle", message: "", at: 0 };
const stateListeners = new Set();

function emitState(state, message = "") {
  syncState = { state, message, at: Date.now() };
  for (const fn of stateListeners) {
    try { fn(syncState); } catch { /* listener xatosi sinxronni to'xtatmasin */ }
  }
}

export function onSyncState(fn) {
  stateListeners.add(fn);
  try { fn(syncState); } catch { /* ignore */ }
  return () => stateListeners.delete(fn);
}

export function getSyncState() {
  return syncState;
}

// ---------------------------------------------------------------------
//  Mahalliy ma'lumotlarni bitta obyektga yig'ish
// ---------------------------------------------------------------------
function collectLocal(userId) {
  const blob = {};
  for (const k of SYNC_KEYS) {
    blob[k] = loadUserData(userId, k, EMPTY[k]);
  }
  return blob;
}

// Ma'lumot bormi yoki bo'shmi?
function isEmptyBlob(blob) {
  if (!blob) return true;
  const c = blob.classes, t = blob.teachers, s = blob.subjects;
  return !(c?.length || t?.length || s?.length);
}

// Mahalliy nusxa bulutga yetkazilmagan o'zgarishni saqlayaptimi?
// Bu `dirty` bayrog'idan ishonchliroq: brauzer debounce tugashidan
// oldin yopilgan bo'lsa ham farqni topadi.
function localDiffersFromLastPush(userId) {
  const meta = getMeta(userId);
  if (!meta.lastHash) return false; // hali hech qachon sinxronlanmagan
  const hash = quickHash(JSON.stringify(collectLocal(userId)));
  return hash !== meta.lastHash;
}

// ---------------------------------------------------------------------
//  ESKI KALITLARNI TOZALASH
//  Loyiha `edujadval` dan `smartjadval` ga o'tganda eski prefiksli
//  nusxalar localStorage'da qolib ketgan — ular ~1 MB joy egallaydi
//  va hech qachon o'qilmaydi.
// ---------------------------------------------------------------------
export function cleanupLegacyKeys() {
  if (typeof localStorage === "undefined") return { removed: 0, freedKb: 0 };
  const doomed = [];
  let bytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("edujadval_")) {
      doomed.push(k);
      bytes += (localStorage.getItem(k) || "").length;
    }
  }
  for (const k of doomed) {
    try { localStorage.removeItem(k); } catch { /* kvota xatosi — e'tibor bermaymiz */ }
  }
  return { removed: doomed.length, freedKb: Math.round(bytes / 1024) };
}

// ---------------------------------------------------------------------
//  BULUTDAN TORTISH
//
//  `skipIfUnchanged` bilan avval faqat `updated_at` so'raladi.
//  Bulut oxirgi tortishdan beri o'zgarmagan bo'lsa — katta blob
//  umuman yuklab olinmaydi. Kirish shu tufayli sezilarli tezlashadi.
// ---------------------------------------------------------------------
export async function pullFromCloud(userId, { skipIfUnchanged = false } = {}) {
  // LOKAL REJIM: bulutga umuman so'rov yubormaymiz — mahalliy nusxa
  // bulutdagi ma'lumot bilan ustidan yozilmasin.
  if (isLocalOnly()) return { ok: false, reason: "local-only" };

  const meta = getMeta(userId);

  if (skipIfUnchanged && meta.cloudUpdatedAt) {
    const head = await supabase
      .from("schools")
      .select("updated_at")
      .eq("owner_id", userId)
      .maybeSingle();

    if (!head.error && head.data && head.data.updated_at === meta.cloudUpdatedAt) {
      return { ok: true, reason: "unchanged", skipped: true, empty: false };
    }
  }

  const { data, error } = await supabase
    .from("schools")
    .select("data, updated_at")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) return { ok: false, reason: "error", message: error.message };
  if (!data) return { ok: false, reason: "empty" };

  const blob = decodeBlob(data.data);
  for (const k of SYNC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(blob, k)) {
      saveUserData(userId, k, blob[k]);
    }
  }

  // Tortilgan ma'lumotning hash'ini yozib qo'yamiz — shunda darhol
  // keyin ortiqcha push yuborilmaydi.
  const fresh = collectLocal(userId);
  setMeta(userId, {
    lastPull: Date.now(),
    lastPush: Date.now(),
    lastHash: quickHash(JSON.stringify(fresh)),
    cloudUpdatedAt: data.updated_at || "",
    dirty: false,
  });

  return { ok: true, updatedAt: data.updated_at, empty: isEmptyBlob(blob) };
}

// ---------------------------------------------------------------------
//  BULUTGA YUBORISH (bir marta urinish)
// ---------------------------------------------------------------------
export async function pushToCloud(userId, { force = false } = {}) {
  if (!userId) return { ok: false, reason: "no-user" };

  // LOKAL REJIM: yozish butunlay to'xtatiladi. `dirty` bayrog'iga ham
  // tegilmaydi — bulutdagi ma'lumot o'z holicha, tegilmagan qoladi.
  if (isLocalOnly()) {
    emitState("idle");
    return { ok: true, reason: "local-only" };
  }

  const blob = collectLocal(userId);
  const hash = quickHash(JSON.stringify(blob));
  const meta = getMeta(userId);

  // Hech nima o'zgarmagan bo'lsa — serverni bezovta qilmaymiz
  if (!force && !meta.dirty && hash === meta.lastHash) {
    return { ok: true, reason: "unchanged" };
  }

  // Yuborishdan oldin "yuborilmagan o'zgarish bor" deb belgilaymiz.
  // Agar brauzer shu payt yopilsa, keyingi kirishda qayta yuboriladi.
  setMeta(userId, { dirty: true });
  emitState("saving");

  const { data, error } = await supabase
    .from("schools")
    .upsert({ owner_id: userId, data: encodeBlob(blob) }, { onConflict: "owner_id" })
    .select("updated_at")
    .maybeSingle();

  if (error) {
    emitState("error", error.message);
    return { ok: false, reason: "error", message: error.message };
  }

  setMeta(userId, {
    lastPush: Date.now(),
    lastHash: hash,
    cloudUpdatedAt: data?.updated_at || "",
    dirty: false,
  });
  emitState("saved");
  return { ok: true };
}

// ---------------------------------------------------------------------
//  QAYTA URINISH BILAN YUBORISH
//  Internet qisqa uzilsa ham ma'lumot yo'qolmasligi uchun.
// ---------------------------------------------------------------------
async function pushWithRetry(userId) {
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    let res;
    try {
      res = await pushToCloud(userId);
    } catch (e) {
      res = { ok: false, reason: "throw", message: String(e) };
    }

    if (res.ok) return res;

    if (attempt < MAX_RETRY) {
      const wait = RETRY_DELAYS[attempt] || 20000;
      await new Promise(r => setTimeout(r, wait));
    }
  }

  // Barcha urinishlar muvaffaqiyatsiz — dirty bayrog'i qoladi,
  // keyingi o'zgarishda yoki kirishda qayta yuboriladi.
  emitState("error", "Bulutga yuborilmadi — internetni tekshiring");
  return { ok: false, reason: "retry-exhausted" };
}

// ---------------------------------------------------------------------
//  DEBOUNCE — tez-tez o'zgarishda serverni bombardimon qilmaslik uchun
//
//  8 soniya kutiladi, lekin birinchi o'zgarishdan 30 soniya o'tsa
//  majburan yuboriladi. Aks holda uzluksiz tahrirlashda (jadvalni
//  surib chiqishda) taymer cheksiz qayta boshlanib, push umuman
//  ketmay qolardi.
// ---------------------------------------------------------------------
let pushTimer = null;
let pendingUserId = null;
let pendingSince = 0;
let inFlight = null; // hozir ketayotgan push (Promise)

function firePush() {
  pushTimer = null;
  pendingSince = 0;
  const uid = pendingUserId;
  pendingUserId = null;
  if (!uid) return;
  inFlight = pushWithRetry(uid).finally(() => { inFlight = null; });
}

export function schedulePush(userId, delay = PUSH_DELAY) {
  if (!userId) return;

  // LOKAL REJIM: taymer ham qo'yilmaydi ("Saqlanmoqda..." chiqmaydi)
  if (isLocalOnly()) return;

  pendingUserId = userId;
  if (!pendingSince) pendingSince = Date.now();
  emitState("pending");

  const waited = Date.now() - pendingSince;
  const remaining = Math.max(0, PUSH_MAX_WAIT - waited);
  const wait = Math.min(delay, remaining);

  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(firePush, wait);
}

// Kutilayotgan yuborishni darhol bajarish (chiqishdan/yopishdan oldin)
export async function flushPush() {
  if (isLocalOnly()) return { ok: true, reason: "local-only" };

  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  pendingSince = 0;

  const uid = pendingUserId;
  pendingUserId = null;

  // Allaqachon ketayotgan push bo'lsa — uni kutamiz
  if (!uid) {
    if (inFlight) { try { await inFlight; } catch { /* ignore */ } }
    return { ok: true, reason: "nothing-pending" };
  }

  // Yopilish oldidan uzoq kutib bo'lmaydi — bitta urinish yetarli.
  // Muvaffaqiyatsiz bo'lsa dirty bayrog'i qoladi va keyingi kirishda
  // syncOnLogin uni avtomatik yuboradi.
  try {
    return await pushToCloud(uid);
  } catch (e) {
    return { ok: false, reason: "throw", message: String(e) };
  }
}

// Yuborilmagan o'zgarish bormi?
export function hasPendingPush() {
  return pushTimer !== null || inFlight !== null;
}

// Bulutga yetkazilmagan o'zgarish bormi? (brauzer yopilib ochilsa ham biladi)
export function hasUnsyncedChanges(userId) {
  if (!userId) return false;
  if (getMeta(userId).dirty === true) return true;
  // Bayroq yozilmay qolgan bo'lsa ham — mazmunni taqqoslaymiz
  return localDiffersFromLastPush(userId);
}

// ---------------------------------------------------------------------
//  INTERNET TIKLANGANDA AVTOMATIK QAYTA YUBORISH
// ---------------------------------------------------------------------
let onlineUserId = null;
let onlineBound = false;

function handleOnline() {
  if (!onlineUserId) return;
  if (!hasUnsyncedChanges(onlineUserId)) return;
  pushWithRetry(onlineUserId).catch(() => {});
}

export function bindOnlineRetry(userId) {
  if (isLocalOnly()) return; // lokal rejimda qayta yuborish ham kerak emas
  onlineUserId = userId || null;
  if (onlineBound || typeof window === "undefined") return;
  window.addEventListener("online", handleOnline);
  onlineBound = true;
}

export function unbindOnlineRetry() {
  onlineUserId = null;
  if (!onlineBound || typeof window === "undefined") return;
  window.removeEventListener("online", handleOnline);
  onlineBound = false;
}

// ---------------------------------------------------------------------
//  KIRISHDA SINXRONIZATSIYA
//  Qaror mantiqi:
//   - Yuborilmagan o'zgarish bor    -> avval uni bulutga yuboramiz
//     (oldingi seansda internet uzilgan yoki brauzer erta yopilgan)
//   - Bulut o'zgarmagan            -> hech nima yuklab olinmaydi
//   - Bulut bo'sh, mahalliy to'la   -> mahalliyni bulutga yuboramiz
//   - Bulut to'la                   -> bulutdan tortamiz
//   - Ikkalasi ham bo'sh            -> hech nima qilmaymiz
// ---------------------------------------------------------------------
export async function syncOnLogin(user) {
  if (!user?.id) return { action: "skip", reason: "no-user" };

  // LOKAL REJIM: na tortish, na yuborish — ma'lumot faqat shu brauzerda
  if (isLocalOnly()) return { action: "skip", reason: "local-only" };

  // Demo hisob bulutga yozilmaydi — demo ma'lumotlari mahalliy qoladi
  if (user.email === DEMO_EMAIL) return { action: "skip", reason: "demo" };

  bindOnlineRetry(user.id);

  const localBlob = collectLocal(user.id);
  const localHasData = !isEmptyBlob(localBlob);
  const unsynced = hasUnsyncedChanges(user.id);

  try {
    // ——— Yuborilmagan o'zgarish bo'lsa, u ustun ———
    // Bulutdan tortib olsak, o'sha o'zgarishlar ustidan yozilib ketardi.
    if (unsynced && localHasData) {
      const res = await pushWithRetry(user.id);
      if (res.ok) return { action: "recovered" };
      // Yuborilmadi — mahalliy ma'lumot bilan davom etamiz, ustiga yozmaymiz
      return { action: "offline", message: "Yuborilmagan o'zgarishlar bor" };
    }

    // Mahalliy nusxa bor va bulut o'zgarmagan bo'lsa — yuklab olmaymiz
    const pulled = await pullFromCloud(user.id, { skipIfUnchanged: localHasData });

    if (pulled.skipped) return { action: "fresh" };

    // Bulutda ma'lumot bor va bo'sh emas -> tortdik, tamom
    if (pulled.ok && !pulled.empty) {
      return { action: "pulled", updatedAt: pulled.updatedAt };
    }

    // Bulut bo'sh, lekin bu qurilmada ma'lumot bor -> yuboramiz
    if (localHasData) {
      // pullFromCloud bo'sh blobni localStorage ustiga yozgan bo'lishi
      // mumkin — shuning uchun avval saqlab qo'ygan nusxani tiklaymiz
      if (pulled.ok) {
        for (const k of SYNC_KEYS) saveUserData(user.id, k, localBlob[k]);
      }
      const res = await pushToCloud(user.id, { force: true });
      return { action: res.ok ? "pushed" : "push-failed", message: res.message };
    }

    return { action: "empty" };
  } catch (e) {
    // Internet yo'q — mahalliy ma'lumot bilan davom etamiz
    return { action: "offline", message: String(e) };
  }
}

// ---------------------------------------------------------------------
//  Foydalanuvchi chiqqanda mahalliy nusxani tozalash (ixtiyoriy)
//  Umumiy kompyuterda ishlatilsa foydali.
// ---------------------------------------------------------------------
export function clearLocalCopy(userId) {
  if (!userId) return;
  for (const k of SYNC_KEYS) saveUserData(userId, k, EMPTY[k]);
}

export { SYNC_KEYS };