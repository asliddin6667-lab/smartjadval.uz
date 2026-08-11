// ============================================================
// smartjadval.UZ — Supabase klienti (sozlangan)
// ============================================================
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://faczvlynofpdkcnsvfnc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_GvzEaHVEfQ1SFkKbAlfLIQ_H0ADBmwJ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Parol tiklash havolasidan qaytganda URL'dagi token avtomatik o'qiladi.
    // BU O'CHIRILSA "parolni tiklash" havolasi ishlamaydi.
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

// Edge Function chaqirish uchun kerak
export const SUPABASE_FN_URL = SUPABASE_URL + '/functions/v1';
export const ANON_KEY = SUPABASE_ANON_KEY;

// Parol tiklash havolasi qaytadigan manzil.
// GitHub Pages'da BASE_URL = '/smartjadval/', domen ulangach '/' —
// avtomatik moslashadi, qo'lda o'zgartirish shart emas.
export function getResetRedirectUrl() {
  return window.location.origin + import.meta.env.BASE_URL + '?mode=reset';
}

// Sozlanganligini tekshirish uchun yordamchi.
// DIQQAT: pastdagi 'SIZNING-...' matnlariga tegmang — ular shunchaki
// "fayl hali to'ldirilmaganmi?" degan belgi sifatida tekshiriladi.
export function isSupabaseConfigured() {
  return (
    !SUPABASE_URL.includes('SIZNING-PROJECT') &&
    !SUPABASE_ANON_KEY.includes('SIZNING_ANON_KEY')
  );
}