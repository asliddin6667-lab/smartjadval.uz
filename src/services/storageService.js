// =====================================================================
//  localStorage bilan ishlash
//
//  KALIT PREFIKSI REJIMGA BOG'LIQ:
//    lokal rejim (npm run dev) -> "smartjadval_dev_..."
//    bulut yoqiq (sayt)        -> "smartjadval_..."
//
//  NIMA UCHUN: lokalda kiritilgan sinov ma'lumoti ALOHIDA "qutida"
//  yotadi. Bulutga yuboradigan kod (cloudSync) faqat oddiy prefiksni
//  o'qiydi — demak lokal sinov ma'lumoti bulutga chiqishi JISMONAN
//  mumkin emas, hatto keyinchalik bulut yoqib qo'yilsa ham.
//
//  Prefiks modul yuklanganda BIR MARTA hisoblanadi — rejim almashuvi
//  sahifani yangilashni talab qiladi (devMode.js da shunday yozilgan).
//
//  ---------------------------------------------------------------
//  KVOTA — NIMA UCHUN BU FAYL ENDI XATO CHIQARMAYDI
//  ---------------------------------------------------------------
//  Brauzerda localStorage hajmi ~5 MB. Bitta maktabning jadvali +
//  20 tagacha saqlangan nusxa allaqachon bir necha MB. Shu brauzerda
//  IKKINCHI profil ochilsa (boshqa maktab) — kvota to'lib qoladi.
//
//  Ilgari `saveData` xatoni O'ZIDAN CHIQARIB yuborardi. U App.jsx
//  dagi `useEffect` ichida chaqiriladi — ya'ni xato React'ga chiqib
//  ketardi va React BUTUN DARAXTNI yechib tashlardi: ekran OPPOQ
//  bo'lib qolardi (aynan jadval generatsiyasidan keyin, chunki eng
//  katta yozuv o'sha payt bo'ladi).
//
//  Endi yozuv HECH QACHON xato chiqarmaydi:
//    1) urinamiz;
//    2) kvota to'lgan bo'lsa — joy bo'shatamiz (eski kalitlar, BOSHQA
//       profillarning keshi) va qayta urinamiz;
//    3) baribir bo'lmasa `false` qaytaramiz va tinglovchilarga
//       xabar beramiz (App.jsx ogohlantirish ko'rsatadi).
//
//  DIQQAT: bulut baribir yagona haqiqat manbai. Mahalliy kesh
//  yozilmasa ham ma'lumot bulutga ketaveradi — faqat foydalanuvchi
//  buni bilib turishi kerak.
// =====================================================================
import { storagePrefix } from "./devMode";

const PREFIX = storagePrefix();

// ---------------------------------------------------------------------
//  FAOL FOYDALANUVCHI
//  Kvota to'lganda joy bo'shatiladi. Faol profilning ma'lumotiga
//  imkon qadar tegilmaydi — avval boshqa profillarning keshi o'chadi
//  (ular bulutdan qayta yuklanadi).
// ---------------------------------------------------------------------
let activeUserId = null;

export function setActiveUser(userId) {
  activeUserId = userId || null;
}

// ---------------------------------------------------------------------
//  YOZIB BO'LMAGANDA XABAR BERISH
//  App.jsx shunga obuna bo'ladi va ogohlantirish ko'rsatadi.
// ---------------------------------------------------------------------
const failListeners = new Set();

export function onStorageError(fn) {
  failListeners.add(fn);
  return () => failListeners.delete(fn);
}

function emitFail(info) {
  for (const fn of failListeners) {
    try { fn(info); } catch { /* tinglovchi xatosi saqlashni to'xtatmasin */ }
  }
}

// ---------------------------------------------------------------------
//  YORDAMCHILAR
// ---------------------------------------------------------------------
function hasStorage() {
  try { return typeof localStorage !== "undefined"; } catch { return false; }
}

// Kvota xatosi barcha brauzerlarda bir xil nomlanmaydi
function isQuotaError(e) {
  if (!e) return false;
  const name = e.name || "";
  const code = e.code;
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||   // Firefox
    code === 22 || code === 1014 ||
    /quota|exceeded|storage is full/i.test(String(e.message || ""))
  );
}

function allKeys() {
  const out = [];
  if (!hasStorage()) return out;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) out.push(k);
    }
  } catch { /* ignore */ }
  return out;
}

function sizeOf(key) {
  try { return (localStorage.getItem(key) || "").length + key.length; }
  catch { return 0; }
}

function drop(key) {
  try { localStorage.removeItem(key); return true; } catch { return false; }
}

// `smartjadval_user_<id>_<kalit>` -> <id>
function userIdOfKey(key) {
  const head = `${PREFIX}user_`;
  if (!key.startsWith(head)) return null;
  const rest = key.slice(head.length);
  const cut = rest.indexOf("_");
  return cut > 0 ? rest.slice(0, cut) : null;
}

// Shu profilda bulutga yuborilmagan o'zgarish bormi?
// cloudSync IMPORT QILINMAYDI (aylanma bog'liqlik bo'lardi) —
// `sync_meta_<id>` kaliti to'g'ridan-to'g'ri o'qiladi.
function metaDirty(userId) {
  try {
    const raw = localStorage.getItem(`${PREFIX}sync_meta_${userId}`);
    // Meta umuman yo'q — bu profil hech qachon bulut bilan
    // sinxronlanmagan. Uning ma'lumoti faqat shu brauzerda bo'lishi
    // mumkin, shuning uchun EHTIYOT tomon: "yuborilmagan" deb hisoblaymiz.
    if (!raw) return true;
    return JSON.parse(raw)?.dirty === true;
  } catch { return true; }
}

// ---------------------------------------------------------------------
//  BITTA PROFILNING MAHALLIY KESHINI O'CHIRISH
//  Bulut yagona haqiqat manbai — profil qayta kirganda hammasi
//  bulutdan yuklanadi. Shuning uchun bu amal ma'lumot yo'qotmaydi.
// ---------------------------------------------------------------------
export function purgeUserData(userId) {
  if (!userId || !hasStorage()) return { removed: 0, freedKb: 0 };
  let removed = 0;
  let bytes = 0;
  for (const k of allKeys()) {
    const owner = userIdOfKey(k);
    const isMeta =
      k === `${PREFIX}sync_meta_${userId}` ||
      k === `${PREFIX}conflict_${userId}` ||
      k === `${PREFIX}version_last_${userId}`;
    if (owner === userId || isMeta) {
      bytes += sizeOf(k);
      if (drop(k)) removed++;
    }
  }
  return { removed, freedKb: Math.round(bytes / 1024) };
}

// ---------------------------------------------------------------------
//  BOSHQA PROFILLARNING KESHINI TOZALASH
//
//  Bitta brauzerda bir necha maktab hisobi ishlatilsa, har biri o'z
//  jadvalini localStorage'da qoldiradi va kvota to'lib qoladi. Kirishda
//  faol profildan boshqasi tozalanadi.
//
//  XAVFSIZLIK: bulutga yuborilmagan o'zgarishi bor profilga TEGILMAYDI
//  (`force` berilmagan bo'lsa) — u profil qayta kirganda o'sha
//  o'zgarish bulutga jo'natiladi.
// ---------------------------------------------------------------------
export function purgeOtherUsers(keepUserId, { force = false } = {}) {
  if (!hasStorage()) return { users: 0, removed: 0, freedKb: 0 };

  const ids = new Set();
  for (const k of allKeys()) {
    const owner = userIdOfKey(k);
    if (owner && owner !== keepUserId) ids.add(owner);
  }

  let users = 0;
  let removed = 0;
  let freedKb = 0;
  for (const id of ids) {
    if (!force && metaDirty(id)) continue;   // yuborilmagan ishi bor — tegmaymiz
    const r = purgeUserData(id);
    if (r.removed) { users++; removed += r.removed; freedKb += r.freedKb; }
  }
  return { users, removed, freedKb };
}

// ---------------------------------------------------------------------
//  JOY BO'SHATISH — bosqichma-bosqich, eng kam kerakligidan boshlab.
//  Har bosqichdan keyin yozish qayta sinab ko'riladi.
// ---------------------------------------------------------------------
function freeSpaceStep(step) {
  if (!hasStorage()) return 0;
  let freed = 0;

  // 1) Eski `edujadval_` kalitlari va vaqtinchalik keshlar
  if (step === 0) {
    for (const k of allKeys()) {
      if (
        k.startsWith("edujadval_") ||
        k === "dash_month_snapshot" ||
        k.startsWith(`${PREFIX}version_last_`)
      ) {
        freed += sizeOf(k);
        drop(k);
      }
    }
    return freed;
  }

  // 2) Boshqa profillarning konflikt zaxiralari (nusxasi bulutda ham bor)
  if (step === 1) {
    for (const k of allKeys()) {
      if (!k.startsWith(`${PREFIX}conflict_`)) continue;
      if (activeUserId && k === `${PREFIX}conflict_${activeUserId}`) continue;
      freed += sizeOf(k);
      drop(k);
    }
    return freed;
  }

  // 3) Boshqa profillarning butun keshi (yuborilmagan ishi bo'lmaganlari)
  if (step === 2) {
    return purgeOtherUsers(activeUserId).freedKb * 1024;
  }

  // 4) Oxirgi chora — faqat faol profil ma'lum bo'lganda.
  //    Kim ishlayotgani noma'lum bo'lsa, majburan o'chirmaymiz.
  if (step === 3 && activeUserId) {
    // Yuborilmagan o'zgarishi bor boshqa profillar ham. Ular baribir
    // bulutdan yuklanadi; muqobili — hozirgi ishning umuman saqlanmasligi.
    const r = purgeOtherUsers(activeUserId, { force: true });
    if (r.freedKb) {
      console.warn("⚠️ Kvota to'ldi — boshqa profillarning mahalliy keshi tozalandi");
      return r.freedKb * 1024;
    }
    // Faol profilning eng og'ir, bulutdan tiklanadigan kaliti
    const heavy = `${PREFIX}user_${activeUserId}_savedSchedules`;
    if (activeUserId && sizeOf(heavy) > 0) {
      const n = sizeOf(heavy);
      drop(heavy);
      console.warn("⚠️ Kvota to'ldi — «Saqlangan jadvallar» keshi tozalandi (bulutda saqlanib qoladi)");
      return n;
    }
  }

  return 0;
}

const FREE_STEPS = 4;

// ---------------------------------------------------------------------
//  O'QISH / YOZISH
// ---------------------------------------------------------------------
export function loadData(key, fallback = []) {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

// Yozish HECH QACHON xato chiqarmaydi — `true`/`false` qaytaradi.
export function saveData(key, value) {
  const full = `${PREFIX}${key}`;
  let text;
  try {
    text = JSON.stringify(value);
  } catch (e) {
    emitFail({ key, reason: "serialize", message: String(e) });
    return false;
  }

  try {
    localStorage.setItem(full, text);
    return true;
  } catch (e) {
    if (!isQuotaError(e)) {
      // localStorage butunlay bloklangan (maxfiy rejim, brauzer sozlamasi)
      emitFail({ key, reason: "blocked", message: String(e?.message || e) });
      return false;
    }
  }

  // Kvota to'ldi — joy bo'shatib qayta urinamiz
  for (let step = 0; step < FREE_STEPS; step++) {
    if (!freeSpaceStep(step)) continue;
    try {
      localStorage.setItem(full, text);
      return true;
    } catch (e) {
      if (!isQuotaError(e)) {
        emitFail({ key, reason: "blocked", message: String(e?.message || e) });
        return false;
      }
    }
  }

  emitFail({
    key,
    reason: "quota",
    message: "Brauzer xotirasi to'ldi — mahalliy nusxa saqlanmadi",
  });
  return false;
}

export function removeData(key) {
  try { localStorage.removeItem(`${PREFIX}${key}`); } catch { /* ignore */ }
}

export function loadUserData(userId, key, fallback = []) {
  if (!userId) return fallback;
  return loadData(`user_${userId}_${key}`, fallback);
}

export function saveUserData(userId, key, value) {
  if (!userId) return false;
  return saveData(`user_${userId}_${key}`, value);
}

// ---------------------------------------------------------------------
//  DIAGNOSTIKA — konsolda yoki sozlamalarda ko'rsatish uchun
// ---------------------------------------------------------------------
export function storageStats() {
  let total = 0;
  const perUser = {};
  for (const k of allKeys()) {
    const n = sizeOf(k);
    total += n;
    const owner = userIdOfKey(k);
    if (owner) perUser[owner] = (perUser[owner] || 0) + n;
  }
  return {
    totalKb: Math.round(total / 1024),
    users: Object.keys(perUser).length,
    perUserKb: Object.fromEntries(
      Object.entries(perUser).map(([id, n]) => [id, Math.round(n / 1024)])
    ),
  };
}
