// =====================================================================
//  smartjadval.UZ — BULUTDAGI VERSIYA TARIXI  (`school_backups`)
//
//  MAQSAD: ma'lumot yo'qolishi JISMONAN imkonsiz bo'lsin. `schools`
//  jadvalida faqat ENG OXIRGI holat turadi — u ustidan yozilsa, eski
//  nusxa yo'qoladi. Shuning uchun har bir muvaffaqiyatli yuborishdan
//  keyin holatning to'liq nusxasi `school_backups` ga tushadi va
//  "Zaxira nusxalar" sahifasidan istalgan payt tiklanadi.
//
//  QACHON YOZILADI:
//    • avtomatik — bulutga yuborishdan keyin, lekin har 4 daqiqada
//      bir martadan ko'p emas (blob katta, kvota behuda ketmasin);
//    • MAJBURIY — konflikt yuz berganda (yutqazgan nusxa), tiklashdan
//      oldingi holat, qo'lda "Hozirgi holatni zaxiraga olish" tugmasi.
//
//  Eskilari serverdagi trigger bilan tozalanadi (oxirgi 40 tasi qoladi)
//  — qarang: school_backups_setup.sql
//
//  DIQQAT: jadval bo'lmasa (SQL hali ishga tushirilmagan) — barcha
//  funksiyalar jimgina `ok: false` qaytaradi va sinxronizatsiya
//  odatdagidek davom etadi.
// =====================================================================
import { supabase } from "./supabaseClient";
import { loadData, saveData } from "./storageService";
import { isLocalOnly } from "./devMode";
import {
  encodeBlob, decodeBlob, fillBlob, blobCounts, countRoomAssignments,
} from "./schoolBlob";

const TABLE = "school_backups";

// Avtomatik zaxira oralig'i — bundan tez-tez yozilmaydi
const AUTO_GAP = 4 * 60 * 1000;

// Ro'yxatda ko'rsatiladigan maksimal versiya
export const MAX_LIST = 50;

// Jadval yo'qligi bir marta aniqlangach, keyingi urinishlar qilinmaydi
let tableMissing = false;

function isMissingTable(error) {
  const code = error?.code || "";
  const msg = String(error?.message || "");
  return code === "42P01" || /does not exist|schema cache/i.test(msg);
}

function lastAutoKey(userId) {
  return `version_last_${userId}`;
}

// ---------------------------------------------------------------------
//  YOZISH
//  note bo'sh bo'lsa — avtomatik zaxira (oraliq tekshiriladi).
//  note bo'lsa — MAJBURIY (konflikt, tiklashdan oldingi holat va h.k.)
// ---------------------------------------------------------------------
export async function archiveVersion(userId, blob, { rev = 0, note = "", device = "" } = {}) {
  if (!userId || !blob) return { ok: false, reason: "no-user" };
  if (isLocalOnly()) return { ok: false, reason: "local-only" };
  if (tableMissing) return { ok: false, reason: "no-table" };

  const auto = !note;
  if (auto) {
    const last = Number(loadData(lastAutoKey(userId), 0)) || 0;
    if (Date.now() - last < AUTO_GAP) return { ok: false, reason: "throttled" };
  }

  const full = fillBlob(blob);
  const counts = blobCounts(full);
  counts.roomAssignments = countRoomAssignments(full.schedule);

  const { error } = await supabase.from(TABLE).insert({
    owner_id: userId,
    rev: Number(rev) || 0,
    device: String(device || "").slice(0, 60),
    note: String(note || "").slice(0, 120),
    counts,
    data: encodeBlob(full, { rev, ts: Date.now(), dev: device }),
  });

  if (error) {
    if (isMissingTable(error)) {
      tableMissing = true;
      console.warn(
        "⚠️ `school_backups` jadvali topilmadi — versiya tarixi o'chiq. " +
        "school_backups_setup.sql ni Supabase SQL Editor'da ishga tushiring."
      );
    }
    return { ok: false, reason: "error", message: error.message };
  }

  if (auto) saveData(lastAutoKey(userId), Date.now());
  return { ok: true };
}

// ---------------------------------------------------------------------
//  RO'YXAT — og'ir `data` ustuni SO'RALMAYDI
// ---------------------------------------------------------------------
export async function listVersions(userId, { limit = MAX_LIST } = {}) {
  if (!userId) return { ok: false, reason: "no-user", items: [] };

  const { data, error } = await supabase
    .from(TABLE)
    .select("id, rev, device, note, counts, created_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTable(error)) tableMissing = true;
    return {
      ok: false,
      reason: isMissingTable(error) ? "no-table" : "error",
      message: error.message,
      items: [],
    };
  }
  return { ok: true, items: data || [] };
}

// ---------------------------------------------------------------------
//  BITTA VERSIYANI OCHISH (tiklashdan oldin)
// ---------------------------------------------------------------------
export async function fetchVersion(userId, id) {
  if (!userId || !id) return { ok: false, reason: "empty" };

  const { data, error } = await supabase
    .from(TABLE)
    .select("id, rev, device, note, counts, created_at, data")
    .eq("owner_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, reason: "error", message: error.message };
  if (!data) return { ok: false, reason: "empty" };

  return {
    ok: true,
    meta: {
      id: data.id, rev: data.rev, device: data.device,
      note: data.note, counts: data.counts, created_at: data.created_at,
    },
    blob: fillBlob(decodeBlob(data.data || {})),
  };
}

// ---------------------------------------------------------------------
//  O'CHIRISH (qo'lda — foydalanuvchi so'rasa)
// ---------------------------------------------------------------------
export async function deleteVersion(userId, id) {
  if (!userId || !id) return { ok: false, reason: "empty" };
  const { error } = await supabase.from(TABLE).delete().eq("owner_id", userId).eq("id", id);
  if (error) return { ok: false, reason: "error", message: error.message };
  return { ok: true };
}

// Versiya tarixi umuman ishlayaptimi? (sahifada ogohlantirish uchun)
export function isHistoryDisabled() {
  return tableMissing;
}
