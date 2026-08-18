// =====================================================================
//  smartjadval.UZ — Auth xizmati (Supabase Auth + profiles jadvali)
//
//  O'ZGARISHLAR:
//  - QURILMA CHEKLOVI OLIB TASHLANDI. Foydalanuvchi istalgan
//    kompyuter/telefondan email+parol bilan kira oladi.
//  - PAROLNI TIKLASH qo'shildi:
//      1-yo'l: email orqali (sendPasswordReset -> completePasswordReset)
//      2-yo'l: superadmin orqali (adminResetPassword)
//  - DISTRICT ADMIN (v3): profilda district_id va must_change_password
//    maydonlari o'qiladi — tuman admini paneli uchun.
//
//  TUZATISH (v3.1):
//  - adminResetPassword endi "quick-handler" Edge Function'ini chaqiradi
//    (deploy qilingan haqiqiy nom). supabase.functions.invoke ishlatiladi.
//  - supabase.rpc(...).catch(...) XATO EDI: rpc() to'liq Promise emas,
//    unda .catch() metodi yo'q ("Oa.rpc(...).catch is not a function").
//    Endi await + { error } tekshiruvi bilan yozilgan.
//
//  YANGI (v3.2) — CAPTCHA (Cloudflare Turnstile):
//  - login() va registerUser() endi ixtiyoriy captchaToken qabul qiladi
//    va uni Supabase'ga options.captchaToken sifatida uzatadi.
//  - sendPasswordReset() ham ixtiyoriy token oladi (Supabase'da CAPTCHA
//    yoqilganda parol tiklash so'rovi ham token talab qiladi).
//  - Token bo'sh bo'lsa options'ga qo'shilmaydi — Supabase'da CAPTCHA
//    hali yoqilmagan bo'lsa hamma narsa avvalgidek ishlaydi.
//
//  TUZATISH (v3.3) — "Sessiya yaroqsiz. Qayta kiring" muammosi:
//  - SABAB: ilova profilni localStorage keshidan ko'rsatadi, shuning
//    uchun Supabase sessiyasi (access token ~1 soatda eskiradi) tugagan
//    bo'lsa ham superadmin paneli ochiq turaveradi. Shu holatda
//    functions.invoke() yaroqli token yubormaydi va Edge Function
//    "Sessiya yaroqsiz" deb rad etadi.
//  - YECHIM: getFreshSession() yordamchisi qo'shildi — har bir himoya-
//    langan chaqiruvdan OLDIN supabase.auth.getSession() orqali yaroqli
//    sessiya olinadi (eskirgan token refresh token bilan avtomatik
//    yangilanadi). Token endi Authorization header'ida ANIQ yuboriladi.
//  - Sessiya umuman tiklanmasa — foydalanuvchiga tushunarli xabar:
//    "Sessiyangiz muddati tugagan. Sahifani yangilab, qaytadan kiring."
//
//  Sessiya kesh: profil ma'lumotlari localStorage'da keshlanadi, shu
//  sababli getCurrentUser() va checkSubscription() SINXRON qolgan —
//  App.jsx va boshqa sahifalar o'zgarishsiz ishlayveradi.
// =====================================================================
import { loadData, saveData, removeData } from "./storageService";
import {
  supabase,
  SUPABASE_FN_URL,
  ANON_KEY,
  getResetRedirectUrl,
} from "./supabaseClient";

const SESSION_KEY = "auth_current_user";

// Edge Function nomi. Supabase Dashboard'da funksiya "quick-handler"
// nomi bilan deploy qilingan. Keyinchalik alohida "admin-reset-password"
// funksiyasi yaratsangiz, faqat shu qatorni o'zgartirasiz.
const RESET_PASSWORD_FN = "quick-handler";

// Foydalanuvchi ko'radigan unikal ID: EDU-XXXXXX
function genUid() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `EDU-${s}`;
}

// CAPTCHA xatolarini foydalanuvchiga tushunarli qilish
function isCaptchaError(msg) {
  return /captcha/i.test(String(msg || ""));
}
const CAPTCHA_ERR_MSG =
  "Xavfsizlik tekshiruvi (CAPTCHA) o'tmadi. Sahifani yangilab, qaytadan urinib ko'ring.";

// ---------------------------------------------------------------------
//  YANGI (v3.3): YAROQLI SESSIYA OLISH
//  getSession() eskirgan access tokenni refresh token orqali avtomatik
//  yangilaydi. Muddati tugashiga 60 soniyadan kam qolgan bo'lsa ham
//  oldindan yangilab qo'yamiz — Edge Function'ga doim "yangi" token
//  boradi. Sessiya umuman bo'lmasa (refresh token ham eskirgan) —
//  aniq xabar bilan to'xtatamiz.
// ---------------------------------------------------------------------
async function getFreshSession() {
  const { data } = await supabase.auth.getSession();
  let session = data?.session || null;

  // Muddati tugagan/tugash arafasidagi tokenni majburan yangilaymiz
  const expMs = session?.expires_at ? session.expires_at * 1000 : 0;
  if (session && expMs && expMs - Date.now() < 60000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed?.session) session = refreshed.session;
  }

  if (!session) {
    // Panel localStorage keshi tufayli ochiq turgan, lekin Supabase
    // sessiyasi tugagan — qayta kirish shart.
    throw new Error(
      "Sessiyangiz muddati tugagan. Sahifani yangilab, qaytadan kiring."
    );
  }
  return session;
}

// ---------------------------------------------------------------------
//  Profil (serverdagi qator) -> ilova ishlatadigan user obyekti
// ---------------------------------------------------------------------
function profileToUser(p) {
  if (!p) return null;
  return {
    id: p.id,
    uid: p.uid,
    name: p.name || "",
    email: p.email || "",
    phone: p.phone || "",
    role: p.role || "user",
    status: p.status || "active",
    schoolName: p.school_name || "",
    districtId: p.district_id || null,                    // YANGI: tuman
    mustChangePassword: !!p.must_change_password,          // YANGI: parol bayrog'i
    regionName: p.region_name || "",                       // YANGI: viloyat (matn)
    districtName: p.district_name || "",                   // YANGI: tuman (matn)
    createdAt: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
    subscription: {
      status: p.sub_status || "unpaid",
      plan: p.sub_plan || null,
      activatedAt: p.sub_activated_at ? new Date(p.sub_activated_at).getTime() : null,
      expiresAt: p.sub_expires_at ? new Date(p.sub_expires_at).getTime() : null,
    },
  };
}

async function fetchOwnProfile(authUserId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", authUserId)
    .single();
  if (error || !data) return null;
  return profileToUser(data);
}

// ---------------------------------------------------------------------
//  TELEFON RAQAM
//  Bazada bir xil ko'rinishda saqlanadi: +998901234567
//  Foydalanuvchi qanday yozsa ham (bo'shliq, qavs, chiziqcha) tozalanadi.
// ---------------------------------------------------------------------
export function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 9) return "+998" + d;                          // 901234567
  if (d.length === 12 && d.startsWith("998")) return "+" + d;      // 998901234567
  return null;                                                    // noto'g'ri
}

// Ekranda chiroyli ko'rsatish: +998 90 123 45 67
export function formatPhone(value) {
  const d = String(value || "").replace(/\D/g, "");
  const n = d.startsWith("998") ? d.slice(3) : d;
  if (!n) return "";
  const p = [n.slice(0, 2), n.slice(2, 5), n.slice(5, 7), n.slice(7, 9)].filter(Boolean);
  return "+998 " + p.join(" ");
}

// ---------------------------------------------------------------------
//  Sessiya keshi (sinxron o'qish uchun)
// ---------------------------------------------------------------------
export function getCurrentUser() {
  return loadData(SESSION_KEY, null);
}

export function setCurrentUser(user) {
  const safeUser = user ? { ...user, password: undefined } : null;
  saveData(SESSION_KEY, safeUser);
  return safeUser;
}

export function logout() {
  removeData(SESSION_KEY);
  // Supabase sessiyasini ham yopamiz (kutmasdan — UI bloklanmasin).
  // signOut() haqiqiy Promise qaytaradi, shuning uchun .catch() joiz.
  supabase.auth.signOut().catch(() => {});
}

// ---------------------------------------------------------------------
//  KIRISH — endi qurilma cheklovisiz
//  captchaToken — Turnstile widget'idan kelgan token (ixtiyoriy).
// ---------------------------------------------------------------------
export async function login(email, password, captchaToken) {
  const normalized = email.trim().toLowerCase();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalized,
    password,
    ...(captchaToken ? { options: { captchaToken } } : {}),
  });

  if (error) {
    if (isCaptchaError(error.message)) {
      throw new Error(CAPTCHA_ERR_MSG);
    }
    if (/invalid login credentials/i.test(error.message)) {
      throw new Error("Email yoki parol noto'g'ri");
    }
    if (/email not confirmed/i.test(error.message)) {
      throw new Error("Email tasdiqlanmagan. Pochtangizni tekshiring.");
    }
    if (/fetch|network/i.test(error.message)) {
      throw new Error("Server bilan aloqa yo'q. Internetni tekshiring.");
    }
    throw new Error(error.message);
  }

  const user = await fetchOwnProfile(data.user.id);
  if (!user) {
    await supabase.auth.signOut();
    throw new Error("Profil topilmadi. Admin bilan bog'laning.");
  }

  if (user.status === "blocked") {
    await supabase.auth.signOut();
    throw new Error("Bu foydalanuvchi bloklangan");
  }

  return setCurrentUser(user);
}

// ---------------------------------------------------------------------
//  "HISOB ALLAQACHON BOR" HOLATINI ANIQLASH
//
//  MUAMMO: signUp so'rovi serverda BAJARILIB, javobi yo'lda yo'qolishi
//  mumkin (mobil internet uzilishi, brauzer so'rovni qayta yuborishi).
//  Bunda hisob YARATILGAN bo'ladi, lekin ilova xato ko'radi. Foydalanuvchi
//  qayta bosadi va "Bu email oldin ro'yxatdan o'tgan" xabarini oladi —
//  holbuki hisob aynan o'sha payt, o'sha so'rovdan yaratilgan.
//
//  YECHIM: aynan shu email+parol bilan kirib ko'ramiz. Kirsa — hisob
//  shu foydalanuvchiniki, ro'yxatdan o'tish MUVAFFAQIYATLI hisoblanadi.
//  Kirmasa — email haqiqatan boshqa birov tomonidan band qilingan.
//
//  ESLATMA: Supabase'da CAPTCHA yoqilgan bo'lsa bu tekshiruv ishlamaydi
//  (Turnstile tokeni bir martalik, signUp'da sarflangan) — u holda
//  avvalgidek oddiy xato xabari ko'rsatiladi.
// ---------------------------------------------------------------------
async function claimExistingAccount(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
//  RO'YXATDAN O'TISH
//  captchaToken — Turnstile widget'idan kelgan token (ixtiyoriy).
// ---------------------------------------------------------------------
export async function registerUser(
  { name, email, password, schoolName, phone, region, district },
  captchaToken
) {
  const normalized = email.trim().toLowerCase();

  if (!schoolName?.trim()) throw new Error("Maktab nomini kiriting");

  const tel = normalizePhone(phone);
  if (!tel) throw new Error("Telefon raqamni to'g'ri kiriting: +998 90 123 45 67");

  if (!region?.trim()) throw new Error("Viloyat / shaharni tanlang");
  if (!district?.trim()) throw new Error("Tumanni tanlang");

  if (!normalized.includes("@")) throw new Error("Email noto'g'ri");
  if (password.length < 6) throw new Error("Parol kamida 6 ta belgi bo'lsin");

  const { data, error } = await supabase.auth.signUp({
    email: normalized,
    password,
    options: {
      ...(captchaToken ? { captchaToken } : {}),
      data: {
        // Ism maydoni ro'yxatdan o'tishda so'ralmaydi — maktab nomi
        // ishlatiladi. Superadmin keyin "Tahrirlash" orqali o'zgartiradi.
        name: (name || "").trim() || schoolName.trim(),
        school_name: schoolName.trim(),
        phone: tel,
        uid: genUid(),
        // Zaxira sifatida metadata'da ham saqlanadi
        region_name: region.trim(),
        district_name: district.trim(),
      },
    },
  });

  const ALREADY_MSG =
    "Bu email oldin ro'yxatdan o'tgan. \"Kirish\" bo'limidan kiring — " +
    "parolni eslay olmasangiz, \"Parolni unutdingizmi?\" dan foydalaning.";

  // Hisob egasining ID'si. signUp ishlamay qolgan, lekin hisob baribir
  // yaratilgan holatlarda claimExistingAccount() uni topib beradi.
  let userId = data?.user?.id || null;

  if (error) {
    if (isCaptchaError(error.message)) {
      throw new Error(CAPTCHA_ERR_MSG);
    }
    if (/already registered|already exists|user_already_exists/i.test(error.message)) {
      // Ehtimol hisobni AYNAN SHU ro'yxatdan o'tish yaratgan (javob yo'qolgan
      // yoki so'rov qayta yuborilgan). Shu parol bilan kira olsak — hisob
      // foydalanuvchiniki, ro'yxatdan o'tish muvaffaqiyatli.
      userId = await claimExistingAccount(normalized, password);
      if (!userId) throw new Error(ALREADY_MSG);
    } else if (/fetch|network/i.test(error.message)) {
      // Aloqa uzilgan — hisob serverda yaratilgan bo'lishi mumkin
      userId = await claimExistingAccount(normalized, password);
      if (!userId) throw new Error("Server bilan aloqa yo'q. Internetni tekshiring.");
    } else {
      throw new Error(error.message);
    }
  } else if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    // Supabase'da "Confirm email" YOQIQ bo'lsa, mavjud email uchun xato
    // qaytmaydi — email ro'yxatini fosh qilmaslik uchun identities'i bo'sh
    // "soxta" user qaytariladi. Bu ham "hisob allaqachon bor" degani.
    userId = await claimExistingAccount(normalized, password);
    if (!userId) throw new Error(ALREADY_MSG);
  }

  // ——— Bu nuqtadan keyin hisob ANIQ mavjud ———
  // Shu sababli quyidagi hech bir xato ro'yxatdan o'tishni "muvaffaqiyatsiz"
  // qilib ko'rsatmasligi kerak: aks holda foydalanuvchi qayta urinadi va
  // "bu email allaqachon ro'yxatdan o'tgan" xabariga duch keladi.
  // Yozilmagan maydonlarni superadmin "Tahrirlash" orqali to'ldiradi.
  if (userId) {
    try {
      // Telefon — asosiy ma'lumot, alohida yozamiz (viloyat ustunlari
      // hali yaratilmagan bo'lsa ham telefon yo'qolmasin)
      await supabase
        .from("profiles")
        .update({ phone: tel })
        .eq("id", userId);

      // Viloyat/tuman — ustunlar mavjud bo'lsa yoziladi
      const locPatch = {
        region_name: region.trim(),
        district_name: district.trim(),
      };

      // Agar shu tuman tizimda allaqachon yaratilgan bo'lsa —
      // foydalanuvchini darhol o'sha tumanga bog'laymiz. Shunda tuman
      // admini yangi maktabni hech qanday qo'shimcha ishsiz ko'radi.
      const { data: dRow } = await supabase
        .from("districts")
        .select("id")
        .eq("name", district.trim())
        .eq("region", region.trim())
        .maybeSingle();
      if (dRow?.id) locPatch.district_id = dRow.id;

      const { error: locErr } = await supabase
        .from("profiles")
        .update(locPatch)
        .eq("id", userId);
      if (locErr) console.warn("Viloyat/tuman yozilmadi:", locErr.message);
    } catch (e) {
      console.warn("Profil ma'lumotlari to'liq yozilmadi:", e);
    }
  }

  // Eski oqim saqlansin: "Ro'yxatdan o'tdingiz, endi login qiling"
  try {
    await supabase.auth.signOut();
  } catch {
    /* chiqolmasa ham ro'yxatdan o'tish muvaffaqiyatli */
  }
  return true;
}

// =====================================================================
//  PAROLNI TIKLASH — 1-YO'L: EMAIL ORQALI
// =====================================================================

// Foydalanuvchi emailiga tiklash havolasini yuboradi.
// Havola bosilganda sayt ?mode=reset bilan ochiladi va
// Supabase avtomatik vaqtinchalik sessiya beradi.
// captchaToken — Supabase'da CAPTCHA yoqilgan bo'lsa talab qilinadi.
export async function sendPasswordReset(email, captchaToken) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized.includes("@")) throw new Error("Email noto'g'ri");

  const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
    redirectTo: getResetRedirectUrl(),
    ...(captchaToken ? { captchaToken } : {}),
  });

  if (error) {
    if (isCaptchaError(error.message)) {
      throw new Error(CAPTCHA_ERR_MSG);
    }
    if (/rate limit|too many/i.test(error.message)) {
      throw new Error("Juda ko'p urinish. Bir necha daqiqadan so'ng qayta urinib ko'ring.");
    }
    if (/fetch|network/i.test(error.message)) {
      throw new Error("Server bilan aloqa yo'q. Internetni tekshiring.");
    }
    throw new Error(error.message);
  }

  // Xavfsizlik uchun "email topilmadi" deb aytmaymiz —
  // aks holda kimningdir ro'yxatda borligini bilib olish mumkin bo'ladi.
  return true;
}

// Tiklash havolasidan kelgan foydalanuvchi yangi parolni o'rnatadi.
export async function completePasswordReset(newPassword) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error("Parol kamida 6 ta belgi bo'lsin");
  }

  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session) {
    throw new Error("Tiklash havolasi eskirgan. Yangi havola so'rang.");
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);

  // Yangi parol bilan qaytadan kirsin
  await supabase.auth.signOut();
  removeData(SESSION_KEY);
  return true;
}

// URL'da tiklash rejimi bormi? (?mode=reset yoki #type=recovery)
export function isPasswordRecoveryUrl() {
  const search = window.location.search || "";
  const hash = window.location.hash || "";
  return search.includes("mode=reset") || hash.includes("type=recovery");
}

// Tiklash tugagach URL'ni tozalaymiz (token ko'rinib turmasin)
export function clearRecoveryUrl() {
  const clean = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, clean);
}

// ---------------------------------------------------------------------
//  SESSIYANI YANGILASH (App yuklanganda fonda chaqiriladi)
// ---------------------------------------------------------------------
export async function refreshCurrentUser() {
  const cached = getCurrentUser();
  if (!cached) return null;

  const { data } = await supabase.auth.getSession();
  if (!data?.session) {
    removeData(SESSION_KEY);
    return null;
  }

  const fresh = await fetchOwnProfile(data.session.user.id);
  if (!fresh) return cached; // server vaqtincha javob bermasa — keshda davom

  if (fresh.status === "blocked") {
    logout();
    return null;
  }

  return setCurrentUser(fresh);
}

// ---------------------------------------------------------------------
//  OBUNA HOLATI (sinxron — keshdagi profil asosida)
// ---------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;

export function checkSubscription(user) {
  if (!user) return { blocked: true, status: "unpaid", expiresAt: null, daysLeft: 0 };
  // Superadmin va tuman admini obuna to'lovidan ozod
  if (user.role === "superadmin" || user.role === "district_admin") {
    return { blocked: false, status: "active", expiresAt: null, daysLeft: Infinity, uid: user.uid };
  }

  const sub = user.subscription || { status: "unpaid", expiresAt: null };
  let status = sub.status;
  if (status === "active" && sub.expiresAt && Date.now() > sub.expiresAt) {
    status = "expired";
  }

  const daysLeft =
    status === "active"
      ? sub.expiresAt
        ? Math.max(0, Math.ceil((sub.expiresAt - Date.now()) / DAY_MS))
        : Infinity
      : 0;

  return { blocked: status !== "active", status, expiresAt: sub.expiresAt, daysLeft, uid: user.uid };
}

export async function refreshSubscription() {
  const fresh = await refreshCurrentUser();
  return checkSubscription(fresh || getCurrentUser());
}

// ---------------------------------------------------------------------
//  O'Z PROFILINI TAHRIRLASH
// ---------------------------------------------------------------------
export async function updateOwnProfile({ name, schoolName, email, password, phone }) {
  const cached = getCurrentUser();
  if (!cached) throw new Error("Avval tizimga kiring");

  const patch = {
    name: name.trim(),
    school_name: (schoolName || "").trim(),
  };

  // Telefon kiritilgan bo'lsa — tekshirib qo'shamiz
  if (phone !== undefined && String(phone).trim() !== "") {
    const tel = normalizePhone(phone);
    if (!tel) throw new Error("Telefon raqamni to'g'ri kiriting: +998 90 123 45 67");
    patch.phone = tel;
  }

  const { error: pErr } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", cached.id);
  if (pErr) throw new Error("Profilni saqlashda xato: " + pErr.message);

  const authPatch = {};
  const newEmail = email?.trim().toLowerCase();
  if (newEmail && newEmail !== cached.email) authPatch.email = newEmail;
  if (password) {
    if (password.length < 6) throw new Error("Parol kamida 6 ta belgi bo'lsin");
    authPatch.password = password;
  }
  if (Object.keys(authPatch).length) {
    const { error: aErr } = await supabase.auth.updateUser(authPatch);
    if (aErr) {
      if (/already registered|already exists/i.test(aErr.message)) {
        throw new Error("Bu email boshqa foydalanuvchida bor");
      }
      throw new Error(aErr.message);
    }
    if (authPatch.email) {
      await supabase.from("profiles").update({ email: authPatch.email }).eq("id", cached.id);
    }
  }

  return refreshCurrentUser();
}

// =====================================================================
//  SUPERADMIN FUNKSIYALARI
// =====================================================================

export async function fetchAllUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error("Foydalanuvchilarni yuklashda xato: " + error.message);
  return (data || []).map(profileToUser);
}

export async function activateSubscription(userId, days) {
  const { error } = await supabase.rpc("admin_set_subscription", { target: userId, days });
  if (error) throw new Error(error.message);
}

export async function deactivateSubscription(userId) {
  const { error } = await supabase.rpc("admin_revoke_subscription", { target: userId });
  if (error) throw new Error(error.message);
}

export async function adminSetStatus(userId, status) {
  const { error } = await supabase.rpc("admin_set_status", { target: userId, new_status: status });
  if (error) throw new Error(error.message);
}

export async function adminSetRole(userId, role) {
  const { error } = await supabase.rpc("admin_set_role", { target: userId, new_role: role });
  if (error) throw new Error(error.message);
}

// Superadmin boshqa foydalanuvchining telefonini o'zgartiradi
export async function adminSetPhone(userId, phone) {
  const tel = String(phone || "").trim() === "" ? null : normalizePhone(phone);
  if (phone && !tel) {
    throw new Error("Telefon raqamni to'g'ri kiriting: +998 90 123 45 67");
  }
  const { error } = await supabase.rpc("admin_set_phone", {
    target: userId,
    new_phone: tel,
  });
  if (error) throw new Error(error.message);
}

export async function adminUpdateProfile(userId, name, schoolName) {
  const { error } = await supabase.rpc("admin_update_profile", {
    target: userId, new_name: name.trim(), new_school: (schoolName || "").trim(),
  });
  if (error) throw new Error(error.message);
}

export async function adminDeleteUser(userId) {
  const { error } = await supabase.rpc("admin_delete_user", { target: userId });
  if (error) throw new Error(error.message);
}

export async function adminCreateUser({ name, email, password, schoolName, role = "user" }) {
  const { error } = await supabase.rpc("admin_create_user", {
    p_email: email.trim().toLowerCase(),
    p_password: password,
    p_name: name.trim(),
    p_school: schoolName?.trim() || "Maktab",
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

// =====================================================================
//  PAROLNI TIKLASH — 2-YO'L: SUPERADMIN TO'G'RIDAN-TO'G'RI O'RNATADI
//
//  Edge Function orqali ishlaydi, chunki parolni boshqa foydalanuvchiga
//  o'rnatish uchun service_role kaliti kerak — uni brauzerga qo'yish
//  MUMKIN EMAS. Funksiya "quick-handler" nomi bilan deploy qilingan.
//
//  TUZATISH (v3.3): "Sessiya yaroqsiz. Qayta kiring" xatosining sababi —
//  invoke() sessiya eskirganda yaroqli token yubormasdi. Endi:
//    1) getFreshSession() bilan yaroqli (kerak bo'lsa yangilangan)
//       sessiya olinadi;
//    2) token Authorization header'ida ANIQ yuboriladi;
//    3) sessiya tiklanmasa — foydalanuvchiga tushunarli xabar chiqadi.
// =====================================================================
export async function adminResetPassword(targetUserId, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error("Parol kamida 6 ta belgi bo'lsin");
  }

  // MUHIM: avval yaroqli sessiya olamiz. Eskirgan access token refresh
  // token orqali shu yerda avtomatik yangilanadi. Sessiya umuman
  // bo'lmasa — Edge Function'ga borishdan oldin aniq xabar bilan
  // to'xtaymiz.
  const session = await getFreshSession();

  // Ikkala nom uslubida ham yuboramiz — Edge Function snake_case
  // (target_user_id) yoki camelCase (targetUserId) qaysi birini
  // o'qisa ham ishlayveradi.
  const { data, error } = await supabase.functions.invoke(RESET_PASSWORD_FN, {
    headers: {
      // Yangi tokenni aniq yuboramiz — invoke ba'zan eski/keshdagi
      // sessiyani ishlatib qolishi mumkin edi.
      Authorization: `Bearer ${session.access_token}`,
    },
    body: {
      target_user_id: targetUserId,
      new_password: newPassword,
      targetUserId,
      newPassword,
    },
  });

  if (error) {
    // Edge Function 4xx/5xx qaytarsa, javob tanasidagi aniq xabarni
    // chiqarib olishga harakat qilamiz
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
    if (/jwt|token|expired|sessiya|unauthorized|401/i.test(msg)) {
      msg = "Sessiyangiz muddati tugagan. Sahifani yangilab, qaytadan kiring.";
    } else if (/fetch|network/i.test(msg)) {
      msg = "Server bilan aloqa yo'q. Internetni tekshiring.";
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);

  // Vaqtinchalik parol — foydalanuvchi birinchi kirishda YANGI parol
  // o'rnatishi majburiy bo'ladi. Bayroq yozilmasa ham parol allaqachon
  // o'rnatilgan, shuning uchun xatoni yutamiz (faqat konsolga yozamiz).
  try {
    const { error: flagErr } = await supabase.rpc(
      "admin_require_password_change",
      { target: targetUserId }
    );
    if (flagErr) console.warn("must_change_password yozilmadi:", flagErr.message);
  } catch (e) {
    console.warn("must_change_password yozilmadi:", e?.message);
  }

  return true;
}

// =====================================================================
//  MAJBURIY PAROL ALMASHTIRISH
//  Superadmin vaqtinchalik parol o'rnatgan foydalanuvchi birinchi
//  kirishda shu funksiya orqali o'ziga yangi parol qo'yadi.
// =====================================================================
export async function completeForcedPasswordChange(newPassword) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error("Parol kamida 6 ta belgi bo'lsin");
  }

  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session) {
    throw new Error("Sessiya topilmadi. Qaytadan kiring.");
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);

  // Bayroqni o'chiramiz — keyingi kirishlarda talab qilinmaydi
  const { error: fErr } = await supabase.rpc("clear_password_change_flag");
  if (fErr) throw new Error(fErr.message);

  return refreshCurrentUser();
}

// Superadmin foydalanuvchiga tiklash xatini yuboradi (Edge Function shart emas)
export async function adminSendPasswordReset(email) {
  return sendPasswordReset(email);
}