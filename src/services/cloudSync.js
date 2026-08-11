// =====================================================================
//  smartjadval.UZ — BULUT SINXRONIZATSIYASI
//
//  Vazifasi: maktab ma'lumotlarini (sinflar, o'qituvchilar, jadval...)
//  Supabase'dagi `schools` jadvalida saqlash, shunda foydalanuvchi
//  ISTALGAN QURILMADAN kirsa ma'lumoti joyida turadi.
//
//  ARXITEKTURA: localStorage — kesh, Supabase — asosiy manba.
//  - Kirishda: bulutdan tortiladi -> localStorage'ga yoziladi
//  - O'zgarishda: localStorage darhol yoziladi + debounce bilan
//    butun blob bulutga yuboriladi
//  - Internet uzilsa: ilova localStorage'da ishlashda davom etadi,
//    aloqa tiklangach avtomatik qayta urinadi
//
//  YANGI (v2):
//  - Push muvaffaqiyatsiz bo'lsa 3 marta qayta urinadi (backoff bilan)
//  - "dirty" bayrog'i localStorage'da saqlanadi -> brauzer yopilib
//    qayta ochilsa ham yuborilmagan o'zgarish esda qoladi
//  - Ma'lumot o'zgarmagan bo'lsa push umuman yuborilmaydi (hash)
//  - online hodisasida kutilayotgan push avtomatik jo'natiladi
//  - Push holatini kuzatish uchun onSyncState() obunasi
// =====================================================================
import { supabase } from "./supabaseClient";
import { loadData, saveData, loadUserData, saveUserData } from "./storageService";

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

// ---------------------------------------------------------------------
//  BULUTDAN TORTISH
// ---------------------------------------------------------------------
export async function pullFromCloud(userId) {
  const { data, error } = await supabase
    .from("schools")
    .select("data, updated_at")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) return { ok: false, reason: "error", message: error.message };
  if (!data) return { ok: false, reason: "empty" };

  const blob = data.data || {};
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
    dirty: false,
  });

  return { ok: true, updatedAt: data.updated_at, empty: isEmptyBlob(blob) };
}

// ---------------------------------------------------------------------
//  BULUTGA YUBORISH (bir marta urinish)
//  Eslatma: supabase-js v2 da .select() chaqirilmasa javob bo'sh
//  qaytadi — bu egress trafigini tejaydi.
// ---------------------------------------------------------------------
export async function pushToCloud(userId, { force = false } = {}) {
  if (!userId) return { ok: false, reason: "no-user" };

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

  const { error } = await supabase
    .from("schools")
    .upsert({ owner_id: userId, data: blob }, { onConflict: "owner_id" });

  if (error) {
    emitState("error", error.message);
    return { ok: false, reason: "error", message: error.message };
  }

  setMeta(userId, { lastPush: Date.now(), lastHash: hash, dirty: false });
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
//  8 soniya: jadval tahrirlashda o'nlab push o'rniga bittasi ketadi.
// ---------------------------------------------------------------------
let pushTimer = null;
let pendingUserId = null;
let inFlight = null; // hozir ketayotgan push (Promise)

export function schedulePush(userId, delay = 8000) {
  if (!userId) return;
  pendingUserId = userId;
  emitState("pending");
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const uid = pendingUserId;
    pendingUserId = null;
    if (!uid) return;
    inFlight = pushWithRetry(uid).finally(() => { inFlight = null; });
  }, delay);
}

// Kutilayotgan yuborishni darhol bajarish (chiqishdan/yopishdan oldin)
export async function flushPush() {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }

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
  return getMeta(userId).dirty === true;
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
//     (oldingi seansda internet uzilgan bo'lsa)
//   - Bulut bo'sh, mahalliy to'la   -> mahalliyni bulutga yuboramiz
//   - Bulut to'la                   -> bulutdan tortamiz
//   - Ikkalasi ham bo'sh            -> hech nima qilmaymiz
// ---------------------------------------------------------------------
export async function syncOnLogin(user) {
  if (!user?.id) return { action: "skip", reason: "no-user" };

  // Demo hisob bulutga yozilmaydi — demo ma'lumotlari mahalliy qoladi
  if (user.email === DEMO_EMAIL) return { action: "skip", reason: "demo" };

  bindOnlineRetry(user.id);

  const localBlob = collectLocal(user.id);
  const localHasData = !isEmptyBlob(localBlob);
  const unsynced = hasUnsyncedChanges(user.id);

  try {
    // ——— Oldingi seansdan yuborilmagan o'zgarish bo'lsa, u ustun ———
    // Bulutdan tortib olsak, o'sha o'zgarishlar ustidan yozilib ketardi.
    if (unsynced && localHasData) {
      const res = await pushWithRetry(user.id);
      if (res.ok) return { action: "recovered" };
      // Yuborilmadi — mahalliy ma'lumot bilan davom etamiz, ustiga yozmaymiz
      return { action: "offline", message: "Yuborilmagan o'zgarishlar bor" };
    }

    const pulled = await pullFromCloud(user.id);

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