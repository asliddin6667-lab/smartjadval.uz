// =====================================================================
//  smartjadval.UZ — TUMAN (DISTRICT) XIZMATI
//
//  - Superadmin: tuman yaratish/o'chirish, foydalanuvchini tumanga
//    biriktirish
//  - District Admin: o'z tumanidagi maktablar, jadval tekshiruvi,
//    bildirishnoma yuborish, audit log
//
//  syncAllDistricts() — O'zbekistonning BARCHA viloyat va tumanlarini
//  uzRegions.js ro'yxatidan bazaga avtomatik qo'shadi. Nomlar aynan
//  bir xil bo'lgani uchun ro'yxatdan o'tgan maktablar o'z tumaniga
//  xatosiz avtomatik bog'lanadi.
//
//  PAROL TIKLASH: Edge Function "quick-handler" nomi bilan deploy
//  qilingan — resetSchoolPassword() va adminResetPassword() ikkalasi
//  ham aynan shu funksiyani chaqiradi.
//
//  XAVFSIZLIK: barcha cheklovlar Supabase RLS darajasida — bu fayl
//  faqat so'rov yuboradi, ruxsatni server tekshiradi.
// =====================================================================
import { supabase } from "./supabaseClient";
import { UZ_REGIONS, districtsOf } from "../utils/uzRegions";

// Edge Function nomi. Supabase Dashboard'da funksiya "quick-handler"
// nomi bilan deploy qilingan. Agar keyinchalik "admin-reset-password"
// nomli alohida funksiya yaratsangiz, shu qatorni o'zgartirish kifoya.
const RESET_PASSWORD_FN = "quick-handler";

// ---------------------------------------------------------------------
//  TUMANLAR (superadmin boshqaradi, RLS himoya qiladi)
// ---------------------------------------------------------------------
export async function fetchDistricts() {
  const { data, error } = await supabase
    .from("districts")
    .select("*")
    .order("name");
  if (error) throw new Error("Tumanlarni yuklashda xato: " + error.message);
  return data || [];
}

export async function createDistrict(name, region) {
  if (!name?.trim()) throw new Error("Tuman nomini kiriting");
  const { error } = await supabase
    .from("districts")
    .insert({ name: name.trim(), region: (region || "").trim() });
  if (error) throw new Error(error.message);
}

export async function deleteDistrict(id) {
  const { error } = await supabase.from("districts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------
//  BARCHA TUMANLARNI AVTOMATIK QO'SHISH
//  uzRegions.js dagi to'liq ro'yxat bilan bazani solishtiradi va
//  yetishmayotgan tumanlarni bitta so'rovda qo'shadi.
//  Bazadagi districts INSERT trigger'i (trg_link_profiles_new_district)
//  shu tumanni tanlagan foydalanuvchilarni avtomatik bog'laydi.
//  Qaytaradi: yangi qo'shilgan tumanlar soni.
// ---------------------------------------------------------------------
export async function syncAllDistricts() {
  const { data, error } = await supabase
    .from("districts")
    .select("name, region");
  if (error) throw new Error("Tumanlarni tekshirishda xato: " + error.message);

  const existing = new Set(
    (data || []).map((d) => `${(d.region || "").trim()}|${(d.name || "").trim()}`)
  );

  const missing = [];
  for (const r of UZ_REGIONS) {
    for (const dName of districtsOf(r.name)) {
      if (!existing.has(`${r.name}|${dName}`)) {
        missing.push({ name: dName, region: r.name });
      }
    }
  }

  if (missing.length === 0) return 0;

  const { error: insErr } = await supabase.from("districts").insert(missing);
  if (insErr) throw new Error("Tumanlarni qo'shishda xato: " + insErr.message);

  return missing.length;
}

// Foydalanuvchini tumanga biriktirish (null = tumandan chiqarish)
export async function assignUserDistrict(userId, districtId) {
  const { error } = await supabase.rpc("admin_set_district", {
    target: userId,
    new_district: districtId || null,
  });
  if (error) throw new Error(error.message);
}

// Superadmin foydalanuvchining viloyat/tumanini qo'lda o'rnatadi.
// Tuman tizimda mavjud bo'lsa, server district_id ni ham avtomatik
// bog'laydi (admin_set_location RPC ichida).
export async function adminSetLocation(userId, region, district) {
  const { error } = await supabase.rpc("admin_set_location", {
    target: userId,
    new_region: (region || "").trim(),
    new_district: (district || "").trim(),
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------
//  DISTRICT ADMIN — O'Z TUMANI HAQIDA
// ---------------------------------------------------------------------
export async function fetchMyDistrictInfo(districtId) {
  if (!districtId) return null;
  const { data } = await supabase
    .from("districts")
    .select("*")
    .eq("id", districtId)
    .maybeSingle();
  return data || null;
}

// ---------------------------------------------------------------------
//  Jadvaldagi darslarni chuqur sanash — schedule qanday shaklda
//  bo'lsa ham (tekis yoki ichma-ich obyekt) barg (leaf) yozuvlarni
//  sanaydi.
// ---------------------------------------------------------------------
function countLessons(schedule) {
  if (!schedule || typeof schedule !== "object") return 0;
  let n = 0;
  for (const v of Object.values(schedule)) {
    if (v && typeof v === "object" && !Array.isArray(v)) n += countLessons(v);
    else if (v !== null && v !== undefined) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------
//  O'Z TUMANIDAGI MAKTABLAR RO'YXATI (statistika bilan)
//  RLS tufayli faqat o'z tumanidagi qatorlar qaytadi.
// ---------------------------------------------------------------------
export async function fetchDistrictSchools() {
  const [profRes, blobRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, uid, name, email, phone, school_name, status, role, sub_status, sub_expires_at, district_id, region_name, district_name")
      .order("school_name"),
    supabase
      .from("schools")
      .select("owner_id, updated_at, data"),
  ]);

  if (profRes.error) throw new Error("Maktablarni yuklashda xato: " + profRes.error.message);
  if (blobRes.error) throw new Error("Ma'lumotlarni yuklashda xato: " + blobRes.error.message);

  const blobMap = new Map((blobRes.data || []).map((b) => [b.owner_id, b]));

  return (profRes.data || [])
    .filter((p) => p.role === "user")
    .map((p) => {
      const b = blobMap.get(p.id);
      const d = b?.data || {};
      const lessons = countLessons(d.schedule || {});
      return {
        id: p.id,
        uid: p.uid || "",
        name: p.name || "",
        email: p.email || "",
        phone: p.phone || "",
        schoolName: p.school_name || "(nomsiz maktab)",
        regionName: p.region_name || "",
        districtName: p.district_name || "",
        status: p.status || "active",
        subStatus: p.sub_status || "unpaid",
        subExpiresAt: p.sub_expires_at ? new Date(p.sub_expires_at).getTime() : null,
        updatedAt: b?.updated_at ? new Date(b.updated_at).getTime() : null,
        classesCount: Array.isArray(d.classes) ? d.classes.length : 0,
        teachersCount: Array.isArray(d.teachers) ? d.teachers.length : 0,
        subjectsCount: Array.isArray(d.subjects) ? d.subjects.length : 0,
        roomsCount: Array.isArray(d.rooms) ? d.rooms.length : 0,
        lessonsCount: lessons,
        hasSchedule: lessons > 0,
        data: d, // batafsil ko'rish oynasi uchun (faqat o'qish)
      };
    });
}

// ---------------------------------------------------------------------
//  JADVAL TEKSHIRUV OQIMI (schedule_submissions)
// ---------------------------------------------------------------------
export async function fetchSubmissions() {
  const { data, error } = await supabase
    .from("schedule_submissions")
    .select("id, school_id, status, school_comment, review_comment, submitted_at, reviewed_at, updated_at")
    .order("submitted_at", { ascending: false });
  if (error) throw new Error("Jadvallarni yuklashda xato: " + error.message);
  return data || [];
}

// Bitta submission'ni snapshot bilan olish (ko'rish oynasi uchun)
export async function fetchSubmissionFull(id) {
  const { data, error } = await supabase
    .from("schedule_submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Tuman admini statusni o'zgartiradi: reviewing / returned / approved / archived
export async function reviewSubmission(id, status, comment) {
  const patch = {
    status,
    reviewed_at: new Date().toISOString(),
  };
  if (comment !== undefined && comment !== null) patch.review_comment = comment;

  const { data: sess } = await supabase.auth.getSession();
  const me = sess?.session?.user?.id;
  if (me) patch.reviewer_id = me;

  const { error } = await supabase
    .from("schedule_submissions")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------
//  BILDIRISHNOMALAR
// ---------------------------------------------------------------------
export async function sendNotification({ recipientId, districtId, type, title, body }) {
  if (!recipientId) throw new Error("Qabul qiluvchi maktabni tanlang");
  if (!title?.trim()) throw new Error("Sarlavha kiriting");

  const { data: sess } = await supabase.auth.getSession();
  const sender = sess?.session?.user?.id;
  if (!sender) throw new Error("Sessiya topilmadi. Qaytadan kiring.");

  const { error } = await supabase.from("notifications").insert({
    sender_id: sender,
    recipient_id: recipientId,
    district_id: districtId || null,
    type: type || "info",
    title: title.trim(),
    body: (body || "").trim(),
  });
  if (error) throw new Error(error.message);
}

export async function fetchSentNotifications() {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data || [];
}

// Maktab (user) o'ziga kelgan bildirishnomalarni o'qiydi — keyingi
// bosqichda maktab interfeysiga ulanadi.
export async function fetchMyNotifications() {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function markNotificationRead(id) {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------
//  AUDIT LOG
// ---------------------------------------------------------------------
export async function fetchAuditLog(limit = 200) {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

// Amalni logga yozish (xato bersa ham asosiy ishni to'xtatmaydi)
export async function logAction({ user, action, targetType, targetId, details }) {
  try {
    if (!user?.id) return;
    await supabase.from("audit_log").insert({
      actor_id: user.id,
      actor_email: user.email || null,
      actor_role: user.role || null,
      action,
      target_type: targetType || null,
      target_id: targetId != null ? String(targetId) : null,
      details: details || {},
      district_id: user.districtId || null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch {
    /* log yozilmasa ham davom etamiz */
  }
}

// =====================================================================
//  PAROL TIKLASH (Edge Function: quick-handler)
//
//  Tuman admini o'z tumanidagi maktabga, superadmin istalgan
//  foydalanuvchiga (superadmindan tashqari) vaqtinchalik parol
//  o'rnatadi. Maktab keyingi kirishida parolni majburiy almashtiradi.
//  Ruxsat tekshiruvi to'liq serverda (Edge Function) bajariladi.
// =====================================================================

// Vaqtinchalik parol generatori: "EDU-" + 8 belgi.
// Adashtiruvchi belgilar yo'q (0/O, 1/l/I ishlatilmaydi).
export function generateTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 8; i++) {
    out += chars[buf[i] % chars.length];
  }
  return "EDU-" + out;
}

// Ichki yordamchi: quick-handler'ni chaqirib, xatoni aniq xabar
// bilan tashlaydi. Ikkala nom uslubida ham yuboriladi — Edge Function
// snake_case yoki camelCase qaysi birini o'qisa ham ishlayveradi.
async function invokeResetPassword(targetUserId, newPassword) {
  const { data, error } = await supabase.functions.invoke(RESET_PASSWORD_FN, {
    body: {
      target_user_id: targetUserId,
      new_password: newPassword,
      targetUserId,
      newPassword,
    },
  });

  if (error) {
    // Edge Function xato status qaytarsa, javob tanasidagi aniq
    // xabarni o'qishga harakat qilamiz
    let msg = error.message || "Parol tiklashda xatolik";
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === "function") {
        const body = await ctx.json();
        if (body?.error) msg = body.error;
      }
    } catch {
      /* jim */
    }
    if (/fetch|network/i.test(msg)) {
      msg = "Server bilan aloqa yo'q. Internetni tekshiring.";
    }
    throw new Error(msg);
  }

  if (data?.error) throw new Error(data.error);
  return data; // { ok: true } yoki { ok: true, warning: "..." }
}

/**
 * Maktab foydalanuvchisiga vaqtinchalik parol o'rnatish.
 * Muvaffaqiyatda { ok: true, warning? } qaytaradi, xatoda Error tashlaydi.
 */
export async function resetSchoolPassword(targetUserId, newPassword) {
  if (!targetUserId) throw new Error("Foydalanuvchi tanlanmagan");
  if (!newPassword || newPassword.length < 8) {
    throw new Error("Vaqtinchalik parol kamida 8 belgidan iborat bo'lishi kerak");
  }
  return invokeResetPassword(targetUserId, newPassword);
}

/**
 * Tuman admini / superadmin uchun umumiy nom bilan eksport —
 * eski importlar buzilmasligi uchun saqlab qolindi.
 *
 * @param {string} targetUserId - maktab profilining id'si (profiles.id)
 * @param {string} newPassword  - vaqtinchalik parol (kamida 8 belgi)
 */
export async function adminResetPassword(targetUserId, newPassword) {
  if (!targetUserId) throw new Error("Foydalanuvchi tanlanmagan");
  if (!newPassword || newPassword.length < 8) {
    throw new Error("Vaqtinchalik parol kamida 8 belgidan iborat bo'lishi kerak");
  }
  return invokeResetPassword(targetUserId, newPassword);
}