// =====================================================================
//  smartjadval.UZ — BULUT SINXRONIZATSIYASI  (v4)
//
//  Vazifasi: maktab ma'lumotlarini (sinflar, o'qituvchilar, jadval...)
//  Supabase'dagi `schools` jadvalida saqlash, shunda foydalanuvchi
//  ISTALGAN QURILMADAN kirsa OXIRGI o'zgarishlarni ko'radi.
//
//  ARXITEKTURA: localStorage — asosiy ish nusxasi, Supabase — zaxira
//  va qurilmalararo ko'prik.
//
//  v4 DAGI YANGILIKLAR — "OXIRGI O'ZGARISH G'OLIB"
//
//  1) VERSIYA RAQAMI (`_rev`) VA O'ZGARISH VAQTI (`_ts`)
//     Bulutdagi blob ichida versiya raqami yuradi. Har bir qurilma o'zi
//     ko'rgan oxirgi versiyani (`baseRev`) eslab qoladi. Kirishda
//     bulutdagi versiya kattaroq bo'lsa — demak boshqa qurilma yozgan.
//     v3 da bunday tekshiruv umuman yo'q edi: "yuborilmagan o'zgarishim
//     bor" degan qurilma bulutdagi YANGIROQ nusxa ustidan ham yozaverardi.
//
//  2) `updated_at` ENDI QO'LDA YOZILADI
//     Ilgari upsert faqat `data` ni yuborardi. `schools.updated_at`
//     ustunida UPDATE uchun trigger bo'lmasa, u INSERT vaqtida qotib
//     qolardi va "bulut o'zgarmagan" tekshiruvi HAR DOIM rost chiqardi —
//     ya'ni ikkinchi qurilma birinchisining ishini umuman ko'rmasdi.
//
//  3) KONFLIKTDA YO'QOTISH YO'Q
//     Ikkala tomon ham o'zgargan bo'lsa — vaqt bo'yicha yangirog'i
//     qo'llanadi, yutqazgan nusxa `conflict_<userId>` kalitida
//     zaxira sifatida saqlanadi.
//
//  4) SEANS DAVOMIDA YANGILANISH
//     Ilova oynasi yana faollashganda bulut tekshiriladi va boshqa
//     qurilmadagi o'zgarish darhol ekranga tushadi (`checkRemote`).
//
//  5) SYNC_KEYS RO'YXATI O'ZGARSA — SOXTA "dirty" BO'LMAYDI
//     `lastHash` qaysi kalitlar bo'yicha hisoblangani meta'da yoziladi.
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
  "savedSchedules",
];

// Ro'yxatning oldingi ko'rinishlari — eski `lastHash` ni tanish uchun.
// SYNC_KEYS ga yangi kalit qo'shsangiz, hozirgi ro'yxatni shu yerga
// ko'chiring. Aks holda barcha qurilmalar bir marta "o'zgargan" deb
// hisoblanadi va bir-birining ustidan yozib yuborishi mumkin.
const LEGACY_KEY_SETS = [
  ["settings", "classes", "subjects", "teachers", "classSubjects",
   "rooms", "timeslots", "lunchGroups", "shifts", "schedule"],
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
  savedSchedules: [],
};

const DEMO_EMAIL = "demo@smartjadval.uz";

// Qayta urinish sozlamalari
const MAX_RETRY = 3;
const RETRY_DELAYS = [3000, 8000, 20000]; // 3s -> 8s -> 20s

// Debounce: oddiy kutish va majburiy yuborish oralig'i
const PUSH_DELAY = 1000;
const PUSH_MAX_WAIT = 3000;

// Oyna faollashganda bulutni tez-tez so'ramaslik uchun eng kam oraliq
const REMOTE_CHECK_INTERVAL = 10000;

// Blob formati versiyasi — sparse ko'rinishni tanish uchun
const WIRE_VERSION = 3;

// Blob ichidagi xizmat maydonlari (SYNC_KEYS ga kirmaydi)
const WIRE_META = ["_v", "_rev", "_ts", "_dev"];

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

// Butun blobni "sim uchun" siqish. `stamp` — versiya raqami, o'zgarish
// vaqti va qurilma identifikatori: konfliktni aynan shular hal qiladi.
function encodeBlob(blob, stamp = {}) {
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
function decodeBlob(raw) {
  if (!raw || typeof raw !== "object") return {};
  const blob = { ...raw };
  const isV3 = raw._v === WIRE_VERSION;
  for (const k of WIRE_META) delete blob[k];
  // v3 dan oldingi bloblar to'liq saqlangan — ochish shart emas,
  // lekin decodeEntry ular uchun ham zararsiz (mavjud qiymatlar ustun).
  if (isV3) {
    blob.classSubjects = decodeClassSubjects(blob.classSubjects);
  }
  return blob;
}

// ---------------------------------------------------------------------
//  QURILMA IDENTIFIKATORI — konfliktni jurnalga yozishda foydali
// ---------------------------------------------------------------------
function deviceId() {
  let id = loadData("device_id", "");
  if (!id || typeof id !== "string") {
    id = `d${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    saveData("device_id", id);
  }
  return id;
}

// ---------------------------------------------------------------------
//  META — oxirgi yuborish vaqti, versiya, hash, "dirty" bayrog'i
//
//    baseRev  — shu qurilma ko'rgan oxirgi bulut versiyasi
//    localTs  — mahalliy ma'lumot oxirgi marta o'zgargan vaqt (ms)
//    hashKeys — `lastHash` qaysi kalitlar bo'yicha hisoblangani
// ---------------------------------------------------------------------
function metaKey(userId) {
  return `sync_meta_${userId}`;
}
function getMeta(userId) {
  return loadData(metaKey(userId), {
    lastPush: 0,
    lastPull: 0,
    lastHash: "",
    hashKeys: "",
    baseRev: 0,
    localTs: 0,
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
//  BOSHQA QURILMADAN KELGAN YANGILANISH — ilovaga xabar berish
//  App.jsx shunga obuna bo'ladi va ekrandagi ma'lumotni yangilaydi.
// ---------------------------------------------------------------------
const remoteListeners = new Set();

function emitRemote(info) {
  for (const fn of remoteListeners) {
    try { fn(info); } catch { /* listener xatosi sinxronni to'xtatmasin */ }
  }
}

export function onRemoteUpdate(fn) {
  remoteListeners.add(fn);
  return () => remoteListeners.delete(fn);
}

// ---------------------------------------------------------------------
//  Mahalliy ma'lumotlarni bitta obyektga yig'ish
// ---------------------------------------------------------------------
function collectLocal(userId, keys = SYNC_KEYS) {
  const blob = {};
  for (const k of keys) {
    blob[k] = loadUserData(userId, k, EMPTY[k]);
  }
  return blob;
}

function hashLocal(userId, keys = SYNC_KEYS) {
  return quickHash(JSON.stringify(collectLocal(userId, keys)));
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
//
// SYNC_KEYS ro'yxati o'zgargan bo'lsa (yangi kalit qo'shilgan), eski
// `lastHash` yangi hash bilan hech qachon mos kelmaydi. Shuning uchun
// avvalgi ro'yxatlar bo'yicha ham tekshiramiz — mos kelsa, ma'lumot
// aslida o'zgarmagan va meta jimgina yangilanadi.
function localDiffersFromLastPush(userId) {
  const meta = getMeta(userId);
  if (!meta.lastHash) return false; // hali hech qachon sinxronlanmagan

  const sig = SYNC_KEYS.join(",");
  const current = hashLocal(userId);
  if (current === meta.lastHash) {
    if (meta.hashKeys !== sig) setMeta(userId, { hashKeys: sig });
    return false;
  }

  // Meta hozirgi ro'yxat bo'yicha yozilgan bo'lsa — bu haqiqiy o'zgarish
  if (meta.hashKeys === sig) return true;

  for (const keys of LEGACY_KEY_SETS) {
    if (meta.hashKeys && meta.hashKeys !== keys.join(",")) continue;
    if (hashLocal(userId, keys) === meta.lastHash) {
      // Ma'lumot o'zgarmagan — faqat kalitlar ro'yxati kengaygan
      setMeta(userId, { lastHash: current, hashKeys: sig });
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------
//  KONFLIKT ZAXIRASI
//  Ikkala tomon ham o'zgargan bo'lsa, yutqazgan nusxa yo'qolmasin.
//  Faqat oxirgi bittasi saqlanadi — blob katta (~2 MB) va localStorage
//  kvotasi cheklangan.
// ---------------------------------------------------------------------
function backupConflict(userId, label, blob) {
  try {
    saveData(`conflict_${userId}`, { at: Date.now(), label, blob });
    console.warn(`⚠️ Sinxronizatsiya konflikti — "${label}" nusxasi zaxiraga olindi`);
  } catch {
    // Kvota to'lgan — zaxira ixtiyoriy, sinxronizatsiya to'xtamaydi
  }
}

export function getConflictBackup(userId) {
  if (!userId) return null;
  return loadData(`conflict_${userId}`, null);
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
//  BULUT "BOSH QISMI" — katta blobni tortmasdan holatni bilish
//
//  Faqat versiya raqami, o'zgarish vaqti va `updated_at` so'raladi
//  (bir necha o'nlab bayt). 2 MB blob faqat haqiqatan kerak bo'lganda
//  yuklab olinadi.
// ---------------------------------------------------------------------
async function readCloudHead(userId) {
  // JSONB ichidan maydon tanlash (PostgREST): `alias:ustun->>kalit`
  try {
    const { data, error } = await supabase
      .from("schools")
      .select("updated_at, rev:data->>_rev, ts:data->>_ts, dev:data->>_dev")
      .eq("owner_id", userId)
      .maybeSingle();

    if (!error) {
      if (!data) return { ok: true, exists: false, rev: 0, ts: 0 };
      return {
        ok: true,
        exists: true,
        updatedAt: data.updated_at || "",
        rev: Number(data.rev) || 0,
        ts: Number(data.ts) || 0,
        dev: data.dev || "",
      };
    }
  } catch {
    // eski PostgREST — pastdagi soddaroq so'rovga o'tamiz
  }

  // Zaxira yo'l: faqat `updated_at`. Versiya noma'lum (rev = 0) —
  // bunday holatda mantiq ehtiyotkor tomonga og'adi (bulutni tortadi).
  const { data, error } = await supabase
    .from("schools")
    .select("updated_at")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: true, exists: false, rev: 0, ts: 0, limited: true };
  return {
    ok: true,
    exists: true,
    updatedAt: data.updated_at || "",
    rev: 0,
    ts: 0,
    dev: "",
    limited: true,
  };
}

// ---------------------------------------------------------------------
//  BULUTDAN TORTISH
// ---------------------------------------------------------------------
export async function pullFromCloud(userId) {
  // LOKAL REJIM: bulutga umuman so'rov yubormaymiz — mahalliy nusxa
  // bulutdagi ma'lumot bilan ustidan yozilmasin.
  if (isLocalOnly()) return { ok: false, reason: "local-only" };

  const { data, error } = await supabase
    .from("schools")
    .select("data, updated_at")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) return { ok: false, reason: "error", message: error.message };
  if (!data) return { ok: false, reason: "empty" };

  const raw = data.data || {};
  const blob = decodeBlob(raw);
  for (const k of SYNC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(blob, k)) {
      saveUserData(userId, k, blob[k]);
    }
  }

  // Tortilgan ma'lumotning hash'ini yozib qo'yamiz — shunda darhol
  // keyin ortiqcha push yuborilmaydi. `baseRev` endi bulutdagiga teng:
  // keyingi safar bulut oldinga ketganini shundan bilamiz.
  setMeta(userId, {
    lastPull: Date.now(),
    lastPush: Date.now(),
    lastHash: hashLocal(userId),
    hashKeys: SYNC_KEYS.join(","),
    baseRev: Number(raw._rev) || 0,
    localTs: Number(raw._ts) || 0,
    cloudUpdatedAt: data.updated_at || "",
    dirty: false,
  });

  return {
    ok: true,
    updatedAt: data.updated_at,
    rev: Number(raw._rev) || 0,
    empty: isEmptyBlob(blob),
  };
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

  // Mazmun haqiqatan o'zgargan bo'lsa — o'zgarish vaqtini belgilaymiz.
  // Konfliktda "oxirgi o'zgarish" aynan shu vaqt bo'yicha aniqlanadi.
  const changed = hash !== meta.lastHash;
  const localTs = changed ? Date.now() : (meta.localTs || Date.now());
  const rev = (meta.baseRev || 0) + 1;

  // Yuborishdan oldin "yuborilmagan o'zgarish bor" deb belgilaymiz.
  // Agar brauzer shu payt yopilsa, keyingi kirishda qayta yuboriladi.
  setMeta(userId, { dirty: true, localTs });
  emitState("saving");

  // `updated_at` ni QO'LDA yozamiz. Jadvalda UPDATE uchun trigger
  // bo'lmasa, u aks holda birinchi INSERT vaqtida qotib qoladi va
  // boshqa qurilma "bulut o'zgarmagan" degan xato xulosaga keladi.
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("schools")
    .upsert(
      {
        owner_id: userId,
        data: encodeBlob(blob, { rev, ts: localTs, dev: deviceId() }),
        updated_at: nowIso,
      },
      { onConflict: "owner_id" }
    )
    .select("updated_at")
    .maybeSingle();

  if (error) {
    emitState("error", error.message);
    return { ok: false, reason: "error", message: error.message };
  }

  setMeta(userId, {
    lastPush: Date.now(),
    lastHash: hash,
    hashKeys: SYNC_KEYS.join(","),
    baseRev: rev,
    localTs,
    cloudUpdatedAt: data?.updated_at || nowIso,
    dirty: false,
  });
  emitState("saved");
  return { ok: true, rev };
}

// ---------------------------------------------------------------------
//  QAYTA URINISH BILAN YUBORISH
//  Internet qisqa uzilsa ham ma'lumot yo'qolmasligi uchun.
// ---------------------------------------------------------------------
async function pushWithRetry(userId, opts = {}) {
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    let res;
    try {
      res = await pushToCloud(userId, opts);
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
//  1 soniya kutiladi, lekin birinchi o'zgarishdan 3 soniya o'tsa
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
//  KONFLIKTNI HAL QILISH — "OXIRGI O'ZGARISH G'OLIB"
//
//  Ikkala tomon ham o'zgargan bo'lsa, vaqt bo'yicha yangirog'i qoladi.
//  Yutqazgan nusxa `conflict_<userId>` da zaxira sifatida saqlanadi —
//  ma'lumot butunlay yo'qolmaydi.
// ---------------------------------------------------------------------
async function resolveConflict(userId, head, localBlob) {
  const meta = getMeta(userId);
  // Mahalliy o'zgarish vaqti noma'lum bo'lsa (brauzer push ulgurmasdan
  // yopilgan), oxirgi muvaffaqiyatli yuborish vaqtidan boshlab hisoblaymiz.
  const localTs = meta.localTs || meta.lastPush || 0;
  const cloudTs = head.ts || 0;

  if (cloudTs > localTs) {
    // Bulutdagi o'zgarish yangiroq — mahalliyni zaxiraga olib, tortamiz
    backupConflict(userId, "mahalliy", localBlob);
    const pulled = await pullFromCloud(userId);
    if (pulled.ok) return { action: "pulled", updatedAt: pulled.updatedAt, conflict: true };
    return { action: "offline", message: pulled.message };
  }

  // Mahalliy o'zgarish yangiroq — bulutdagini zaxiraga olib, yuboramiz
  try {
    const remote = await supabase
      .from("schools")
      .select("data")
      .eq("owner_id", userId)
      .maybeSingle();
    if (!remote.error && remote.data?.data) {
      backupConflict(userId, "bulut", decodeBlob(remote.data.data));
    }
  } catch { /* zaxira ixtiyoriy */ }

  // Bulutdagi versiya ustiga yozamiz — `baseRev` ni bulutdagiga
  // tenglashtiramiz, shunda yangi versiya raqami undan katta bo'ladi.
  setMeta(userId, { baseRev: Math.max(head.rev || 0, meta.baseRev || 0) });
  const res = await pushWithRetry(userId, { force: true });
  return res.ok
    ? { action: "recovered", conflict: true }
    : { action: "offline", message: res.message };
}

// ---------------------------------------------------------------------
//  KIRISHDA SINXRONIZATSIYA
//
//  Qaror jadvali (bulutdagi versiya = head.rev, bizniki = baseRev):
//
//   mahalliyda o'zgarish yo'q:
//     bulut oldinda yoki noma'lum -> TORTAMIZ
//     bulut biz bilgan holatda    -> hech nima qilmaymiz
//   mahalliyda o'zgarish bor:
//     bulut biz bilgan holatda    -> YUBORAMIZ
//     bulut oldinda               -> KONFLIKT: vaqt bo'yicha yangirog'i
//                                    qoladi, ikkinchisi zaxiraga tushadi
// ---------------------------------------------------------------------
export async function syncOnLogin(user) {
  if (!user?.id) return { action: "skip", reason: "no-user" };

  // LOKAL REJIM: na tortish, na yuborish — ma'lumot faqat shu brauzerda
  if (isLocalOnly()) return { action: "skip", reason: "local-only" };

  // Demo hisob bulutga yozilmaydi — demo ma'lumotlari mahalliy qoladi
  if (user.email === DEMO_EMAIL) return { action: "skip", reason: "demo" };

  bindOnlineRetry(user.id);

  const userId = user.id;
  const localBlob = collectLocal(userId);
  const localHasData = !isEmptyBlob(localBlob);
  const localDirty = hasUnsyncedChanges(userId) && localHasData;
  const meta = getMeta(userId);

  try {
    const head = await readCloudHead(userId);

    // Bulutni o'qib bo'lmadi — mahalliy nusxa bilan davom etamiz
    if (!head.ok) {
      return { action: "offline", message: head.message };
    }

    // Bulutda hali qator yo'q
    if (!head.exists) {
      if (!localHasData) return { action: "empty" };
      const res = await pushToCloud(userId, { force: true });
      return { action: res.ok ? "pushed" : "push-failed", message: res.message };
    }

    const base = meta.baseRev || 0;
    // rev = 0 — bulutda hali versiyasiz (eski) blob yotibdi. Uni biz
    // ko'rgan-ko'rmaganimizni bilib bo'lmaydi, shuning uchun `updated_at`
    // ga tayanamiz va shubha bo'lsa tortamiz.
    const cloudUnknown = head.rev === 0;
    const cloudAhead = head.rev > base;
    const stampDiffers = !!head.updatedAt && head.updatedAt !== meta.cloudUpdatedAt;

    // ——— Mahalliyda yuborilmagan o'zgarish yo'q ———
    if (!localDirty) {
      if (!cloudAhead && !cloudUnknown && !stampDiffers && localHasData) {
        return { action: "fresh" };
      }

      const pulled = await pullFromCloud(userId);

      if (!pulled.ok) {
        // Bulutdagi qator yo'q ekan — mahalliyni yuboramiz
        if (pulled.reason === "empty" && localHasData) {
          const res = await pushToCloud(userId, { force: true });
          return { action: res.ok ? "pushed" : "push-failed", message: res.message };
        }
        return localHasData
          ? { action: "offline", message: pulled.message }
          : { action: "empty" };
      }

      if (pulled.empty && localHasData) {
        // Bulutdagi blob bo'sh — mahalliy nusxani tiklab, yuboramiz
        for (const k of SYNC_KEYS) saveUserData(userId, k, localBlob[k]);
        const res = await pushToCloud(userId, { force: true });
        return { action: res.ok ? "pushed" : "push-failed", message: res.message };
      }

      return pulled.empty ? { action: "empty" } : { action: "pulled", updatedAt: pulled.updatedAt };
    }

    // ——— Mahalliyda yuborilmagan o'zgarish bor ———
    if (cloudAhead || (cloudUnknown && stampDiffers)) {
      return await resolveConflict(userId, head, localBlob);
    }

    // Bulut biz bilgan holatda — o'zgarishimizni bemalol yuboramiz
    const res = await pushWithRetry(userId);
    if (res.ok) return { action: "recovered" };
    return { action: "offline", message: "Yuborilmagan o'zgarishlar bor" };
  } catch (e) {
    // Internet yo'q — mahalliy ma'lumot bilan davom etamiz
    return { action: "offline", message: String(e) };
  }
}

// ---------------------------------------------------------------------
//  SEANS DAVOMIDA TEKSHIRISH
//  Oyna yana faollashganda chaqiriladi. Boshqa qurilma yozgan bo'lsa —
//  ma'lumot tortiladi va `onRemoteUpdate` obunachilariga xabar beriladi.
//
//  Mahalliyda yuborilmagan o'zgarish bo'lsa — TEGILMAYDI. Foydalanuvchi
//  hozir yozayotgan narsa ustidan yozilib ketmasligi kerak; u avval
//  bulutga yuboriladi, konflikt esa keyingi tekshiruvda hal bo'ladi.
// ---------------------------------------------------------------------
let lastRemoteCheck = 0;
let remoteChecking = false;

export async function checkRemote(userId, { force = false } = {}) {
  if (!userId || isLocalOnly()) return { action: "skip" };
  if (remoteChecking) return { action: "busy" };

  const now = Date.now();
  if (!force && now - lastRemoteCheck < REMOTE_CHECK_INTERVAL) {
    return { action: "throttled" };
  }
  lastRemoteCheck = now;

  // Hozir yuborilayotgan yoki kutayotgan o'zgarish bor — tegmaymiz
  if (hasPendingPush() || hasUnsyncedChanges(userId)) {
    return { action: "busy" };
  }

  remoteChecking = true;
  try {
    const head = await readCloudHead(userId);
    if (!head.ok || !head.exists) return { action: "skip" };

    const meta = getMeta(userId);
    const cloudAhead = head.rev > (meta.baseRev || 0);
    const stampDiffers = !!head.updatedAt && head.updatedAt !== meta.cloudUpdatedAt;
    if (!cloudAhead && !stampDiffers) return { action: "fresh" };

    const pulled = await pullFromCloud(userId);
    if (!pulled.ok || pulled.empty) return { action: "skip" };

    emitRemote({ updatedAt: pulled.updatedAt, rev: pulled.rev });
    return { action: "pulled", updatedAt: pulled.updatedAt };
  } catch (e) {
    return { action: "offline", message: String(e) };
  } finally {
    remoteChecking = false;
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

export { SYNC_KEYS, EMPTY };
