// ============================================================
// smartjadval.UZ — Qurilma qulflash xizmati (device lock)
// Qoida: 1 profil = 1 qurilma.
// Qurilma serverda (Supabase) ro'yxatga olinadi, shu sababli
// localStorage'ni boshqa kompyuterga ko'chirish ish bermaydi.
// ============================================================
import { supabase, isSupabaseConfigured } from './supabaseClient';

const DEVICE_ID_KEY = 'smartjadval_device_id';

// --- Qurilmaning tasodifiy ID'sini olish (bo'lmasa yaratish) ---
export function getDeviceUuid() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// --- Qurilma nomi (admin panelda ko'rish qulay bo'lishi uchun) ---
function getDeviceName() {
  const ua = navigator.userAgent || '';
  let os = 'Noma\u02bclum OS';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  let browser = 'Brauzer';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/')) browser = 'Safari';

  return os + ' / ' + browser;
}

/**
 * Login paytida chaqiriladi.
 * Natija: { status: 'ok' | 'locked' | 'offline' | 'error', message?, deviceName?, lockedAt? }
 *  - 'ok'      -> kirishga ruxsat (qurilma mos yoki birinchi marta bog'landi)
 *  - 'locked'  -> profil boshqa qurilmaga bog'langan, kirish taqiqlanadi
 *  - 'offline' -> server bilan aloqa yo'q (internetni tekshirish kerak)
 *  - 'error'   -> kutilmagan xato
 */
export async function checkAndRegisterDevice(userId) {
  if (!isSupabaseConfigured()) {
    // Supabase hali sozlanmagan bo'lsa — cheklovsiz o'tkazamiz,
    // dastur buzilmasligi uchun (dev rejim).
    console.warn('[deviceLock] Supabase sozlanmagan — cheklov o\u02bbchiq.');
    return { status: 'ok' };
  }

  const deviceUuid = getDeviceUuid();

  try {
    const { data, error } = await supabase
      .from('device_sessions')
      .select('device_uuid, device_name, locked_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    // 1) Yozuv yo'q -> birinchi kirish, qurilmani bog'laymiz
    if (!data) {
      const { error: insErr } = await supabase.from('device_sessions').insert({
        user_id: userId,
        device_uuid: deviceUuid,
        device_name: getDeviceName(),
      });
      if (insErr) throw insErr;
      return { status: 'ok', firstBind: true };
    }

    // 2) Qurilma mos -> ruxsat, last_seen yangilanadi
    if (data.device_uuid === deviceUuid) {
      supabase
        .from('device_sessions')
        .update({ last_seen: new Date().toISOString() })
        .eq('user_id', userId)
        .then(() => {});
      return { status: 'ok' };
    }

    // 3) Qurilma mos emas -> qulflangan
    return {
      status: 'locked',
      deviceName: data.device_name || 'boshqa qurilma',
      lockedAt: data.locked_at,
      message:
        'Bu profil boshqa qurilmaga bog\u02bblangan. Agar kompyuteringizni almashtirgan bo\u02bblsangiz, admin bilan bog\u02bblaning \u2014 qurilmangiz bepul qayta bog\u02bblab beriladi.',
    };
  } catch (e) {
    // Tarmoq xatosi (internet yo'q / Supabase ishlamayapti)
    if (
      e &&
      (e.message === 'Failed to fetch' ||
        e.message?.includes('NetworkError') ||
        e.name === 'TypeError')
    ) {
      return {
        status: 'offline',
        message:
          'Server bilan aloqa yo\u02bbq. Internet aloqasini tekshirib, qayta urinib ko\u02bbring.',
      };
    }
    console.error('[deviceLock] Xato:', e);
    return {
      status: 'error',
      message: 'Qurilmani tekshirishda xato yuz berdi. Qayta urinib ko\u02bbring.',
    };
  }
}

/**
 * SUPERADMIN: foydalanuvchi qurilmasini tiklash.
 * Serverdagi yozuv o'chiriladi -> foydalanuvchi keyingi login'da
 * yangi qurilmasini bog'laydi.
 */
export async function resetUserDevice(userId) {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Supabase sozlanmagan.' };
  }
  const { error } = await supabase
    .from('device_sessions')
    .delete()
    .eq('user_id', userId);
  if (error) {
    console.error('[deviceLock] Tiklashda xato:', error);
    return { ok: false, message: 'Tiklashda xato: ' + error.message };
  }
  return { ok: true, message: 'Qurilma tiklandi. Foydalanuvchi endi yangi qurilmadan kira oladi.' };
}

/**
 * SUPERADMIN: foydalanuvchining qaysi qurilmaga bog'langanini ko'rish.
 */
export async function getUserDevice(userId) {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase
    .from('device_sessions')
    .select('device_name, locked_at, last_seen')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  return data; // null bo'lsa — hali hech qaysi qurilmaga bog'lanmagan
}

/**
 * SUPERADMIN: barcha bog'langan qurilmalarni bitta so'rovda olish.
 * Natija: { 'EDU-XXXXXX': { device_name, locked_at, last_seen }, ... }
 */
export async function listDevices() {
  if (!isSupabaseConfigured()) return {};
  const { data, error } = await supabase
    .from('device_sessions')
    .select('user_id, device_name, locked_at, last_seen');
  if (error) {
    console.error('[deviceLock] Ro\u02bbyxat olishda xato:', error);
    return {};
  }
  const map = {};
  for (const row of data || []) map[row.user_id] = row;
  return map;
}