// =====================================================================
//  smartjadval.UZ — BULUT SINXRONIZATSIYASI  (v5)
//
//  ASOSIY QOIDA: **BULUT — YAGONA HAQIQAT MANBAI.**
//  Foydalanuvchi qaysi qurilmadan kirmasin, ekranda DOIM bulutdagi
//  oxirgi holat turadi. localStorage endi "haqiqat" emas — u faqat
//  tezkor kesh va internet uzilganda ko'rsatiladigan nusxa.
//
//  ---------------------------------------------------------------
//  v4 DA NIMA XATO EDI (ma'lumot yo'qolishiga sabab bo'lgan joylar)
//  ---------------------------------------------------------------
//  1) Yuborish KO'R-KO'RONA `upsert` edi. Qurilma bulutdagi qatorni
//     ko'rmasdan ustidan yozardi. Ikki qurilma orasida "kim oxirgi
//     yozgan bo'lsa — o'shaniki" degan poyga bor edi.
//  2) Konflikt QURILMA SOATI bo'yicha hal qilinardi. Telefon soati
//     oldinga ketgan bo'lsa, undagi ESKI ma'lumot "yangiroq" deb
//     hisoblanib, kompyuterdagi yangi ishni bosib ketardi.
//  3) Konflikt butun blob bo'yicha edi: bitta kalitdagi (masalan
//     `teachers`) o'zgarish tufayli BOSHQA kalitdagi (`schedule`)
//     ishlar ham yo'qolardi.
//  4) Yutqazgan nusxa faqat o'sha qurilmaning localStorage'iga
//     tushardi va uni ko'rsatadigan ekran yo'q edi.
//
//  ---------------------------------------------------------------
//  v5 KAFOLATLARI
//  ---------------------------------------------------------------
//  A) **CAS (compare-and-swap) yozish.** Yuborish `UPDATE ... WHERE
//     owner_id = ? AND (data->>'_rev') = <biz ko'rgan versiya>`
//     ko'rinishida ketadi. Bulut oldinga ketgan bo'lsa UPDATE 0 qator
//     o'zgartiradi va biz HECH NIMANI bosib o'tmaymiz. Ya'ni bulutdagi
//     yangiroq ma'lumotni eski qurilma ustidan yozishi endi MUMKIN EMAS.
//
//  B) **Kalitma-kalit uchtomonlama birlashtirish (3-way merge).**
//     Har bir kalit uchun uchta hash taqqoslanadi: bazaviy (biz oxirgi
//     marta ko'rgan bulut holati), mahalliy va bulutdagi hozirgi.
//        • faqat mahalliy o'zgargan  -> mahalliy qoladi
//        • faqat bulut o'zgargan     -> bulutniki olinadi
//        • ikkalasi ham o'zgargan    -> BULUT ustun (u umumiy holat),
//          mahalliy nusxa esa versiya tarixiga ZAXIRAGA olinadi
//     Qurilma soati umuman ishlatilmaydi — noto'g'ri sana endi
//     ma'lumotni yo'qota olmaydi.
//
//  C) **Har bir o'zgarish tarixda qoladi.** Muvaffaqiyatli yuborishdan
//     keyin holat `school_backups` jadvaliga tushadi (versionService).
//     Konfliktda yutqazgan nusxa MAJBURIY arxivlanadi.
//
//  D) **Avtosaqlash to'xtamaydi.** Debounce (0.7s) + majburiy yuborish
//     (2.5s) + har 10 soniyada "qorovul" tekshiruvi + internet qaytganda
//     qayta urinish + sahifa yopilishida flush.
//
//  E) **Internet yo'q bo'lsa — FAQAT O'QISH.** Bulut bilan aloqa
//     yo'qolsa ilova tahrirlashni bloklaydi (App.jsx). Shu tufayli
//     mahalliy nusxa bulutdan ajralib keta olmaydi.
// =====================================================================
import { supabase } from "./supabaseClient";
import { loadData, saveData, removeData, loadUserData, saveUserData } from "./storageService";
import { isLocalOnly } from "./devMode";
import { archiveVersion } from "./versionService";
import {
  SYNC_KEYS, LEGACY_KEY_SETS, EMPTY, KEY_TITLES,
  encodeBlob, decodeBlob, fillBlob,
  quickHash, keyHash, hashKeysOf, isEmptyBlob,
} from "./schoolBlob";

const DEMO_EMAIL = "demo@smartjadval.uz";

// Qayta urinish sozlamalari
const MAX_RETRY = 4;
const RETRY_DELAYS = [1500, 4000, 10000, 20000];

// Debounce: oddiy kutish va majburiy yuborish oralig'i.
// v4 da 1s/3s edi — v5 da qisqartirildi, chunki o'zgarish qancha tez
// bulutga ketsa, konflikt ehtimoli shuncha kam.
const PUSH_DELAY = 700;
const PUSH_MAX_WAIT = 2500;

// "Qorovul" — yuborilmagan o'zgarish qolib ketmasin
const WATCHDOG_INTERVAL = 10000;

// Bulutni tekshirish oralig'i (oyna ochiq va faol bo'lganda)
const REMOTE_CHECK_INTERVAL = 8000;

export { SYNC_KEYS, EMPTY };

// ---------------------------------------------------------------------
//  QURILMA IDENTIFIKATORI — kim yozganini bilish uchun
// ---------------------------------------------------------------------
function deviceId() {
  let id = loadData("device_id", "");
  if (!id || typeof id !== "string") {
    id = `d${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    saveData("device_id", id);
  }
  return id;
}

// Qurilma nomi — versiya tarixida ko'rsatiladi ("Telefon", "Kompyuter")
function deviceLabel() {
  if (typeof navigator === "undefined") return "qurilma";
  const ua = navigator.userAgent || "";
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  return `${mobile ? "📱 Telefon" : "💻 Kompyuter"} · ${deviceId().slice(1, 6)}`;
}

// ---------------------------------------------------------------------
//  META — qurilmaning bulut haqidagi "bilimi"
//
//    baseRev   — biz ko'rgan oxirgi bulut versiyasi (CAS shunga tayanadi)
//    keyHashes — o'sha versiyadagi HAR BIR KALIT hash'i (3-way merge uchun)
//    lastHash  — oxirgi yuborilgan/tortilgan butun blob hash'i
//    dirty     — yuborilmagan o'zgarish bormi
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
    keyHashes: null,
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
//  SINXRONIZATSIYA HOLATI — UI da ko'rsatish uchun
//  state: "idle" | "pending" | "saving" | "saved" | "error" | "offline"
//
//  "offline" va "error" — ilova FAQAT O'QISH rejimiga o'tadi (App.jsx).
// ---------------------------------------------------------------------
let syncState = { state: "idle", message: "", at: 0, savedAt: 0 };
const stateListeners = new Set();

function emitState(state, message = "") {
  syncState = {
    state,
    message,
    at: Date.now(),
    savedAt: state === "saved" ? Date.now() : syncState.savedAt,
  };
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
//  MAHALLIY NUSXA BILAN ISHLASH
// ---------------------------------------------------------------------
function collectLocal(userId, keys = SYNC_KEYS) {
  const blob = {};
  for (const k of keys) blob[k] = loadUserData(userId, k, EMPTY[k]);
  return blob;
}

function writeLocal(userId, blob) {
  for (const k of SYNC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(blob, k)) {
      saveUserData(userId, k, blob[k]);
    }
  }
}

function hashLocal(userId, keys = SYNC_KEYS) {
  return quickHash(JSON.stringify(collectLocal(userId, keys)));
}

// Mahalliy nusxa bulutga yetkazilmagan o'zgarishni saqlayaptimi?
// `dirty` bayrog'idan ishonchliroq: brauzer debounce tugashidan oldin
// yopilgan bo'lsa ham farqni topadi.
function localDiffersFromLastPush(userId) {
  const meta = getMeta(userId);
  if (!meta.lastHash) return false; // hali hech qachon sinxronlanmagan

  const sig = SYNC_KEYS.join(",");
  const current = hashLocal(userId);
  if (current === meta.lastHash) {
    if (meta.hashKeys !== sig) setMeta(userId, { hashKeys: sig });
    return false;
  }

  if (meta.hashKeys === sig) return true;

  // SYNC_KEYS ro'yxati kengaygan bo'lsa — eski ro'yxat bo'yicha ham tekshiramiz
  for (const keys of LEGACY_KEY_SETS) {
    if (meta.hashKeys && meta.hashKeys !== keys.join(",")) continue;
    if (hashLocal(userId, keys) === meta.lastHash) {
      setMeta(userId, { lastHash: current, hashKeys: sig });
      return false;
    }
  }
  return true;
}

export function hasUnsyncedChanges(userId) {
  if (!userId) return false;
  if (getMeta(userId).dirty === true) return true;
  return localDiffersFromLastPush(userId);
}

// ---------------------------------------------------------------------
//  KONFLIKT ZAXIRASI (mahalliy)
//  Bulutdagi versiya tarixiga qo'shimcha — internet yo'q bo'lsa ham
//  yutqazgan nusxa shu qurilmada qoladi.
// ---------------------------------------------------------------------
function backupConflict(userId, label, blob) {
  try {
    saveData(`conflict_${userId}`, { at: Date.now(), label, blob });
    console.warn(`⚠️ Konflikt — "${label}" nusxasi zaxiraga olindi`);
  } catch {
    // Kvota to'lgan — zaxira ixtiyoriy, sinxronizatsiya to'xtamaydi
  }
}

export function getConflictBackup(userId) {
  if (!userId) return null;
  return loadData(`conflict_${userId}`, null);
}

export function clearConflictBackup(userId) {
  if (!userId) return;
  removeData(`conflict_${userId}`);
}

// ---------------------------------------------------------------------
//  ESKI KALITLARNI TOZALASH (`edujadval_` prefiksi)
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
    try { localStorage.removeItem(k); } catch { /* kvota xatosi — e'tiborsiz */ }
  }
  return { removed: doomed.length, freedKb: Math.round(bytes / 1024) };
}

// ---------------------------------------------------------------------
//  BULUT "BOSH QISMI" — 2 MB blobni tortmasdan holatni bilish
// ---------------------------------------------------------------------
async function readCloudHead(userId) {
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

  const { data, error } = await supabase
    .from("schools")
    .select("updated_at")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: true, exists: false, rev: 0, ts: 0, limited: true };
  return {
    ok: true, exists: true,
    updatedAt: data.updated_at || "",
    rev: 0, ts: 0, dev: "", limited: true,
  };
}

// Bulutdagi to'liq blobni o'qish (mahalliy nusxaga TEGILMAYDI)
async function fetchCloudBlob(userId) {
  const { data, error } = await supabase
    .from("schools")
    .select("data, updated_at")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) return { ok: false, reason: "error", message: error.message };
  if (!data) return { ok: false, reason: "empty" };

  const raw = data.data || {};
  return {
    ok: true,
    blob: fillBlob(decodeBlob(raw)),
    rev: Number(raw._rev) || 0,
    ts: Number(raw._ts) || 0,
    dev: raw._dev || "",
    updatedAt: data.updated_at || "",
  };
}

// ---------------------------------------------------------------------
//  BULUTDAN TORTISH — ekrandagi ma'lumot bulutdagiga TENGLASHTIRILADI
// ---------------------------------------------------------------------
export async function pullFromCloud(userId) {
  if (isLocalOnly()) return { ok: false, reason: "local-only" };

  const got = await fetchCloudBlob(userId);
  if (!got.ok) return got;

  writeLocal(userId, got.blob);

  setMeta(userId, {
    lastPull: Date.now(),
    lastPush: Date.now(),
    lastHash: hashLocal(userId),
    hashKeys: SYNC_KEYS.join(","),
    keyHashes: hashKeysOf(got.blob),
    baseRev: got.rev,
    localTs: got.ts,
    cloudUpdatedAt: got.updatedAt,
    dirty: false,
  });

  return {
    ok: true,
    updatedAt: got.updatedAt,
    rev: got.rev,
    empty: isEmptyBlob(got.blob),
  };
}

// ---------------------------------------------------------------------
//  BULUTGA YOZISH
//
//  CAS: `UPDATE schools SET data = ... WHERE owner_id = ?
//        AND (data->>'_rev')::text = '<baseRev>'`
//  0 qator o'zgarsa — bulut oldinga ketgan, biz hech nimani bosmaymiz
//  va `stale` qaytaramiz. Chaqiruvchi (pushWithRetry) birlashtirishga
//  o'tadi.
// ---------------------------------------------------------------------
async function casUpdate(userId, payload, baseRev) {
  try {
    const { data, error } = await supabase
      .from("schools")
      .update(payload)
      .eq("owner_id", userId)
      .filter("data->>_rev", "eq", String(baseRev))
      .select("updated_at")
      .maybeSingle();

    if (error) return { ok: false, reason: "error", message: error.message };
    if (!data) return { ok: false, reason: "no-row" };
    return { ok: true, updatedAt: data.updated_at };
  } catch (e) {
    return { ok: false, reason: "error", message: String(e) };
  }
}

// CAS ishlamaydigan holatlar: qator umuman yo'q yoki versiyasiz eski
// blob (rev = 0). Bunda avval bulut holati tekshiriladi — biz bilgan
// holatdan farq qilsa, YOZILMAYDI.
async function guardedUpsert(userId, payload, meta, overwrite) {
  if (!overwrite) {
    const head = await readCloudHead(userId);
    if (!head.ok) return { ok: false, reason: "error", message: head.message };
    if (head.exists) {
      const sameRev = (head.rev || 0) === (meta.baseRev || 0);
      const sameStamp = !head.updatedAt || head.updatedAt === meta.cloudUpdatedAt;
      if (!sameRev || !sameStamp) return { ok: false, reason: "stale", head };
    }
  }

  const { data, error } = await supabase
    .from("schools")
    .upsert({ owner_id: userId, ...payload }, { onConflict: "owner_id" })
    .select("updated_at")
    .maybeSingle();

  if (error) return { ok: false, reason: "error", message: error.message };
  return { ok: true, updatedAt: data?.updated_at };
}

export async function pushToCloud(userId, { force = false, overwrite = false } = {}) {
  if (!userId) return { ok: false, reason: "no-user" };

  // LOKAL REJIM: yozish butunlay to'xtatiladi
  if (isLocalOnly()) {
    emitState("idle");
    return { ok: true, reason: "local-only" };
  }

  const blob = collectLocal(userId);
  const hash = quickHash(JSON.stringify(blob));
  const meta = getMeta(userId);

  if (!force && !meta.dirty && hash === meta.lastHash) {
    return { ok: true, reason: "unchanged" };
  }

  const changed = hash !== meta.lastHash;
  const localTs = changed ? Date.now() : (meta.localTs || Date.now());
  const baseRev = meta.baseRev || 0;
  const rev = baseRev + 1;

  // Yuborishdan OLDIN "yuborilmagan o'zgarish bor" deb belgilaymiz.
  // Brauzer shu payt yopilsa ham keyingi kirishda qayta yuboriladi.
  setMeta(userId, { dirty: true, localTs });
  emitState("saving");

  // `updated_at` QO'LDA yoziladi — `schools` da UPDATE trigger yo'q.
  const payload = {
    data: encodeBlob(blob, { rev, ts: localTs, dev: deviceId() }),
    updated_at: new Date().toISOString(),
  };

  let res;
  if (baseRev > 0 && !overwrite) {
    res = await casUpdate(userId, payload, baseRev);
    if (!res.ok && res.reason === "no-row") {
      // Qator yo'qmi yoki versiya boshqami?
      const head = await readCloudHead(userId);
      if (!head.ok) res = { ok: false, reason: "error", message: head.message };
      else if (head.exists) res = { ok: false, reason: "stale", head };
      else res = await guardedUpsert(userId, payload, meta, true);
    } else if (!res.ok && res.reason === "error") {
      // CAS so'rovining o'zi rad etildi (masalan PostgREST JSON filtrni
      // qo'llab-quvvatlamasa). Ma'lumot saqlanmay qolmasin: himoyalangan
      // yo'lga o'tamiz — u ham bulut holatini tekshirib yozadi.
      console.warn("⚠️ CAS yozuv ishlamadi, himoyalangan yo'lga o'tildi:", res.message);
      res = await guardedUpsert(userId, payload, meta, false);
    }
  } else {
    res = await guardedUpsert(userId, payload, meta, overwrite);
  }

  if (!res.ok) {
    if (res.reason === "stale") {
      emitState("pending", "Bulutda yangiroq nusxa bor");
      return { ok: false, reason: "stale", head: res.head };
    }
    // Bitta muvaffaqiyatsiz urinish hali "faqat o'qish" degani emas —
    // `pushWithRetry` yana bir necha marta uriladi va faqat hammasi
    // barbod bo'lgandagina "offline" holati qo'yiladi (ilova qulflanadi).
    console.warn("⚠️ Bulutga yozib bo'lmadi:", res.message);
    emitState("pending", res.message || "Saqlab bo'lmadi — qayta urinilmoqda");
    return { ok: false, reason: "error", message: res.message };
  }

  setMeta(userId, {
    lastPush: Date.now(),
    lastHash: hash,
    hashKeys: SYNC_KEYS.join(","),
    keyHashes: hashKeysOf(blob),
    baseRev: rev,
    localTs,
    cloudUpdatedAt: res.updatedAt || payload.updated_at,
    dirty: false,
  });
  emitState("saved");

  // Versiya tarixiga nusxa (o'zi tezlikni tekshiradi, xatosi jim yutiladi)
  archiveVersion(userId, blob, { rev, device: deviceLabel() }).catch(() => {});

  return { ok: true, rev };
}

// ---------------------------------------------------------------------
//  KALITMA-KALIT UCHTOMONLAMA BIRLASHTIRISH
//
//  base — biz oxirgi marta ko'rgan bulut holatining kalit hash'lari.
//  Uchta holat:
//    • mahalliy = bulut          -> farq yo'q
//    • mahalliy = baza           -> mahalliyda o'zgarish yo'q, bulutniki
//    • bulut    = baza           -> bulutda o'zgarish yo'q, mahalliyniki
//    • ikkalasi ham boshqa       -> KONFLIKT: bulut ustun (umumiy holat),
//                                   mahalliy nusxa zaxiraga olinadi
//
//  Baza noma'lum bo'lsa (eski qurilma) — ehtiyot tomon: bulut ustun.
// ---------------------------------------------------------------------
function threeWayMerge(local, cloud, base) {
  const merged = {};
  const fromLocal = [];
  const fromCloud = [];
  const conflicted = [];

  for (const k of SYNC_KEYS) {
    const lh = keyHash(local?.[k]);
    const ch = keyHash(cloud?.[k]);

    if (lh === ch) { merged[k] = cloud?.[k]; continue; }

    const bh = base && base[k];
    if (bh && lh === bh) { merged[k] = cloud?.[k]; fromCloud.push(k); continue; }
    if (bh && ch === bh) { merged[k] = local?.[k]; fromLocal.push(k); continue; }

    // Ikkala tomon ham o'zgargan (yoki baza noma'lum) — bulut ustun
    merged[k] = cloud?.[k];
    fromCloud.push(k);
    conflicted.push(k);
  }

  return { merged: fillBlob(merged), fromLocal, fromCloud, conflicted };
}

// ---------------------------------------------------------------------
//  MOSLASHTIRISH (reconcile) — bulut oldinga ketgan, bizda ham o'zgarish bor
//
//  1) bulutdagi to'liq blob o'qiladi (mahalliyga tegilmaydi);
//  2) kalitma-kalit birlashtiriladi;
//  3) konflikt bo'lsa — mahalliy nusxa versiya tarixiga VA mahalliy
//     konflikt zaxirasiga MAJBURIY yoziladi;
//  4) natija mahalliyga yoziladi va (agar bulutdagidan farq qilsa)
//     bulutga yuboriladi;
//  5) ekran yangilanadi (`emitRemote`).
// ---------------------------------------------------------------------
async function reconcile(userId, depth = 0) {
  if (depth > 3) return { ok: false, reason: "busy", message: "Bulut tinimsiz o'zgaryapti" };

  const got = await fetchCloudBlob(userId);
  if (!got.ok) return { ok: false, reason: got.reason, message: got.message };

  const local = collectLocal(userId);
  const meta = getMeta(userId);
  const { merged, fromLocal, fromCloud, conflicted } =
    threeWayMerge(local, got.blob, meta.keyHashes);

  if (conflicted.length) {
    backupConflict(userId, "mahalliy", local);
    archiveVersion(userId, local, {
      rev: meta.baseRev || 0,
      device: deviceLabel(),
      note: `Konflikt — shu qurilmadagi nusxa (${conflicted.map((k) => KEY_TITLES[k] || k).join(", ")})`,
    }).catch(() => {});
  }

  writeLocal(userId, merged);
  setMeta(userId, {
    lastPull: Date.now(),
    baseRev: got.rev,
    cloudUpdatedAt: got.updatedAt,
    keyHashes: hashKeysOf(got.blob),
    lastHash: quickHash(JSON.stringify(collectLocal(userId))),
    hashKeys: SYNC_KEYS.join(","),
    dirty: false,
  });

  // Birlashma bulutdagidan farq qiladimi? (mahalliy kalitlar saqlanib qolgan)
  const differs = fromLocal.length > 0;
  let pushed = false;
  if (differs) {
    setMeta(userId, { dirty: true });
    const res = await pushToCloud(userId, { force: true });
    if (!res.ok && res.reason === "stale") {
      // Bulut yana oldinga ketdi — qayta moslashtiramiz
      return reconcile(userId, depth + 1);
    }
    pushed = res.ok;
  }

  emitRemote({ updatedAt: got.updatedAt, rev: got.rev, merged: true });
  if (!differs) emitState("saved");

  return { ok: true, conflicted, fromCloud, fromLocal, pushed };
}

// ---------------------------------------------------------------------
//  QAYTA URINISH BILAN YUBORISH
//  `stale` — xato emas: bulut oldinga ketgan, moslashtirib qayta yuboramiz.
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

    if (res.reason === "stale") {
      const rec = await reconcile(userId);
      if (rec.ok) return { ok: true, reason: "merged", conflicted: rec.conflicted };
      // moslashtirish ham bo'lmadi — qayta urinishga o'tamiz
    }

    if (attempt < MAX_RETRY) {
      emitState("pending", "Qayta urinilmoqda...");
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt] || 20000));
      if (!hasUnsyncedChanges(userId) && !opts.force) {
        return { ok: true, reason: "resolved" };
      }
    } else {
      emitState("offline", res.message || "Bulutga ulanib bo'lmadi");
      return res;
    }
  }
  return { ok: false, reason: "exhausted" };
}

// ---------------------------------------------------------------------
//  DEBOUNCE BILAN YUBORISH — har bir o'zgarishdan keyin chaqiriladi
// ---------------------------------------------------------------------
let pushTimer = null;
let pendingUserId = null;
let pendingSince = 0;
let inFlight = null;

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

  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  pendingSince = 0;

  const uid = pendingUserId;
  pendingUserId = null;

  if (!uid) {
    if (inFlight) { try { await inFlight; } catch { /* ignore */ } }
    return { ok: true, reason: "nothing-pending" };
  }

  try {
    return await pushToCloud(uid);
  } catch (e) {
    return { ok: false, reason: "throw", message: String(e) };
  }
}

export function hasPendingPush() {
  return pushTimer !== null || inFlight !== null;
}

// ---------------------------------------------------------------------
//  KIRISHDA SINXRONIZATSIYA — "BULUT BIRINCHI"
//
//  Qaror jadvali:
//    bulutda qator yo'q            -> mahalliyni yuboramiz
//    mahalliyda o'zgarish yo'q     -> bulut oldinda bo'lsa TORTAMIZ
//    mahalliyda o'zgarish bor:
//       bulut biz bilgan holatda   -> YUBORAMIZ (CAS)
//       bulut oldinda              -> MOSLASHTIRAMIZ (kalitma-kalit)
// ---------------------------------------------------------------------
export async function syncOnLogin(user) {
  if (!user?.id) return { action: "skip", reason: "no-user" };
  if (isLocalOnly()) return { action: "skip", reason: "local-only" };
  if (user.email === DEMO_EMAIL) return { action: "skip", reason: "demo" };

  const userId = user.id;
  bindOnlineRetry(userId);

  const localBlob = collectLocal(userId);
  const localHasData = !isEmptyBlob(localBlob);
  const localDirty = hasUnsyncedChanges(userId) && localHasData;
  const meta = getMeta(userId);

  try {
    const head = await readCloudHead(userId);

    if (!head.ok) {
      emitState("offline", head.message || "Bulutga ulanib bo'lmadi");
      return { action: "offline", message: head.message };
    }

    // Bulutda hali qator yo'q — birinchi yuborish
    if (!head.exists) {
      if (!localHasData) { emitState("idle"); return { action: "empty" }; }
      const res = await pushToCloud(userId, { force: true });
      return { action: res.ok ? "pushed" : "push-failed", message: res.message };
    }

    const base = meta.baseRev || 0;
    // rev = 0 — versiyasiz eski blob. Ko'rgan-ko'rmaganimizni bilib
    // bo'lmaydi, shuning uchun shubha bo'lsa TORTAMIZ.
    const cloudAhead = head.rev > base || head.rev === 0;
    const stampDiffers = !!head.updatedAt && head.updatedAt !== meta.cloudUpdatedAt;

    // ——— Mahalliyda yuborilmagan o'zgarish YO'Q ———
    if (!localDirty) {
      if (!cloudAhead && !stampDiffers && localHasData) {
        emitState("saved");
        return { action: "fresh" };
      }

      const pulled = await pullFromCloud(userId);

      if (!pulled.ok) {
        if (pulled.reason === "empty" && localHasData) {
          const res = await pushToCloud(userId, { force: true });
          return { action: res.ok ? "pushed" : "push-failed", message: res.message };
        }
        emitState("offline", pulled.message || "Bulutdan o'qib bo'lmadi");
        return localHasData
          ? { action: "offline", message: pulled.message }
          : { action: "empty" };
      }

      if (pulled.empty && localHasData) {
        // Bulutdagi blob bo'sh — mahalliy nusxani tiklab, yuboramiz
        writeLocal(userId, localBlob);
        const res = await pushToCloud(userId, { force: true });
        return { action: res.ok ? "pushed" : "push-failed", message: res.message };
      }

      emitState("saved");
      return pulled.empty
        ? { action: "empty" }
        : { action: "pulled", updatedAt: pulled.updatedAt };
    }

    // ——— Mahalliyda yuborilmagan o'zgarish BOR ———
    if (cloudAhead || stampDiffers) {
      const rec = await reconcile(userId);
      if (!rec.ok) {
        emitState("offline", rec.message || "Moslashtirib bo'lmadi");
        return { action: "offline", message: rec.message };
      }
      return {
        action: "merged",
        conflicted: rec.conflicted,
        fromCloud: rec.fromCloud,
        fromLocal: rec.fromLocal,
      };
    }

    const res = await pushWithRetry(userId);
    if (res.ok) return { action: "recovered" };
    emitState("offline", res.message || "Yuborilmagan o'zgarishlar bor");
    return { action: "offline", message: "Yuborilmagan o'zgarishlar bor" };
  } catch (e) {
    emitState("offline", String(e));
    return { action: "offline", message: String(e) };
  }
}

// ---------------------------------------------------------------------
//  SEANS DAVOMIDA TEKSHIRISH
//  Boshqa qurilma yozgan bo'lsa — ma'lumot tortiladi va ekran yangilanadi.
//  Mahalliyda yuborilmagan o'zgarish bo'lsa — TEGILMAYDI (avval u ketadi).
// ---------------------------------------------------------------------
let lastRemoteCheck = 0;
let remoteChecking = false;

// Bir martalik uzilish tufayli ilova "faqat o'qish"ga o'tib qolmasin —
// ketma-ket IKKI marta javob kelmagandagina qulflanadi.
let headFailures = 0;

export async function checkRemote(userId, { force = false } = {}) {
  if (!userId || isLocalOnly()) return { action: "skip" };
  if (remoteChecking) return { action: "busy" };

  const now = Date.now();
  if (!force && now - lastRemoteCheck < REMOTE_CHECK_INTERVAL) {
    return { action: "throttled" };
  }
  lastRemoteCheck = now;

  // Yuborilmagan o'zgarish bo'lsa tegmaymiz. Bu yerda ARZON tekshiruv
  // ishlatiladi (bayroq) — 2 MB blobni har 10 soniyada hash qilmaslik uchun.
  // Chuqur tekshiruv `autoTick` da davriy va `syncOnLogin` da bajariladi.
  if (hasPendingPush() || getMeta(userId).dirty === true) return { action: "busy" };

  remoteChecking = true;
  try {
    const head = await readCloudHead(userId);
    if (!head.ok) {
      headFailures++;
      if (headFailures >= 2) emitState("offline", head.message || "Bulutga ulanib bo'lmadi");
      return { action: "offline", message: head.message };
    }
    headFailures = 0;
    if (!head.exists) return { action: "skip" };

    const meta = getMeta(userId);
    const cloudAhead = head.rev > (meta.baseRev || 0) || head.rev === 0;
    const stampDiffers = !!head.updatedAt && head.updatedAt !== meta.cloudUpdatedAt;
    if (!cloudAhead && !stampDiffers) {
      if (syncState.state === "offline" || syncState.state === "error") emitState("saved");
      return { action: "fresh" };
    }

    const pulled = await pullFromCloud(userId);
    if (!pulled.ok) return { action: "skip" };
    if (pulled.empty) return { action: "skip" };

    emitState("saved");
    emitRemote({ updatedAt: pulled.updatedAt, rev: pulled.rev });
    return { action: "pulled", updatedAt: pulled.updatedAt };
  } catch (e) {
    headFailures++;
    if (headFailures >= 2) emitState("offline", String(e));
    return { action: "offline", message: String(e) };
  } finally {
    remoteChecking = false;
  }
}

// ---------------------------------------------------------------------
//  AVTOMATIK SINXRONIZATSIYA — "QOROVUL"
//
//  Har 10 soniyada (oyna faol bo'lganda):
//    • yuborilmagan o'zgarish bo'lsa — yuboradi;
//    • bo'lmasa — bulutni tekshiradi (boshqa qurilma yozganmi?).
//  Bundan tashqari: oyna faollashganda, internet qaytganda darhol.
// ---------------------------------------------------------------------
let autoTimer = null;
let autoUserId = null;
let autoBound = false;
let autoTicks = 0;

async function autoTick() {
  const uid = autoUserId;
  if (!uid || isLocalOnly()) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    if (syncState.state !== "offline") emitState("offline", "Internet yo'q");
    return;
  }

  try {
    // Har tikda 2 MB blobni hash qilmaymiz: odatda `dirty` bayrog'i yetarli,
    // to'liq taqqoslash esa ~60 soniyada bir marta (bayroq yozilmay qolgan
    // holatlarni ham topish uchun).
    const deep = (autoTicks++ % 6) === 0;
    const unsynced = deep ? hasUnsyncedChanges(uid) : getMeta(uid).dirty === true;

    if (unsynced) {
      if (!hasPendingPush()) await pushWithRetry(uid);
      return;
    }
    await checkRemote(uid);
  } catch { /* keyingi tekshiruvda qayta urinamiz */ }
}

function onWake() {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  autoTick();
}

function onOnline() {
  emitState("pending", "Ulanish tiklandi");
  autoTick();
}

function onOffline() {
  emitState("offline", "Internet yo'q");
}

export function startAutoSync(userId) {
  stopAutoSync();
  if (!userId || isLocalOnly()) return;
  autoUserId = userId;
  autoTimer = setInterval(autoTick, WATCHDOG_INTERVAL);

  if (typeof window !== "undefined" && !autoBound) {
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onWake);
    autoBound = true;
  }
}

export function stopAutoSync() {
  autoUserId = null;
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  if (typeof window !== "undefined" && autoBound) {
    window.removeEventListener("focus", onWake);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onWake);
    autoBound = false;
  }
}

// Qo'lda "Qayta ulanish" tugmasi uchun
export async function forceSyncNow(userId) {
  if (!userId || isLocalOnly()) return { ok: true, reason: "skip" };
  if (hasUnsyncedChanges(userId)) {
    const res = await pushWithRetry(userId);
    return { ok: res.ok, action: "push", message: res.message };
  }
  const res = await checkRemote(userId, { force: true });
  return { ok: res.action !== "offline", action: res.action, message: res.message };
}

// ---------------------------------------------------------------------
//  INTERNET QAYTGANDA QAYTA YUBORISH (eski API — saqlab qolindi)
// ---------------------------------------------------------------------
let onlineUserId = null;
let onlineBound = false;

function handleOnline() {
  if (!onlineUserId || isLocalOnly()) return;
  if (!hasUnsyncedChanges(onlineUserId)) return;
  pushWithRetry(onlineUserId).catch(() => {});
}

export function bindOnlineRetry(userId) {
  if (isLocalOnly()) return;
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
//  TIKLASH — versiya tarixidan yoki konflikt zaxirasidan
//
//  1) hozirgi holat MAJBURIY arxivlanadi (tiklash ham qaytariladigan
//     bo'lsin — noto'g'ri versiyani tiklab qo'ysa, orqaga qaytadi);
//  2) tanlangan nusxa mahalliyga yoziladi;
//  3) bulutga MAJBURAN yuboriladi (overwrite) — chunki bu foydalanuvchi
//     ataylab qilgan amal.
// ---------------------------------------------------------------------
export async function restoreBlob(userId, blob, { label = "tiklash" } = {}) {
  if (!userId || !blob) return { ok: false, reason: "empty" };

  const current = collectLocal(userId);
  await archiveVersion(userId, current, {
    rev: getMeta(userId).baseRev || 0,
    device: deviceLabel(),
    note: `Tiklashdan oldingi holat (${label})`,
  }).catch(() => {});

  const full = fillBlob(blob);
  writeLocal(userId, full);
  setMeta(userId, { dirty: true, localTs: Date.now() });

  if (isLocalOnly()) {
    emitState("idle");
    return { ok: true, reason: "local-only", blob: full };
  }

  const res = await pushToCloud(userId, { force: true, overwrite: true });
  return { ok: res.ok, message: res.message, blob: full };
}

// Hozirgi holatni QO'LDA zaxiraga olish ("Zaxira nusxalar" sahifasidagi
// tugma). Avtomatik zaxiradan farqi: oraliq tekshirilmaydi, doim yoziladi.
export async function archiveCurrent(userId, note = "Qo'lda olingan zaxira") {
  if (!userId) return { ok: false, reason: "no-user" };
  const blob = collectLocal(userId);
  return archiveVersion(userId, blob, {
    rev: getMeta(userId).baseRev || 0,
    device: deviceLabel(),
    note,
  });
}

// ---------------------------------------------------------------------
//  Foydalanuvchi chiqqanda mahalliy nusxani tozalash (ixtiyoriy)
// ---------------------------------------------------------------------
export function clearLocalCopy(userId) {
  if (!userId) return;
  for (const k of SYNC_KEYS) saveUserData(userId, k, EMPTY[k]);
}

// ---------------------------------------------------------------------
//  BOSHQA FOYDALANUVCHINING BULUTDAGI MA'LUMOTI (faqat superadmin)
//  Ruxsatni RLS tekshiradi. Hech narsa yozilmaydi.
// ---------------------------------------------------------------------
export async function fetchSchoolData(ownerId) {
  if (!ownerId) return { ok: false, reason: "empty" };
  const { data, error } = await supabase
    .from("schools")
    .select("data, updated_at")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) return { ok: false, reason: "error", message: error.message };
  if (!data) return { ok: false, reason: "empty" };

  return {
    ok: true,
    data: decodeBlob(data.data || {}),
    updatedAt: data.updated_at || "",
  };
}
