// =====================================================================
//  EDGE FUNCTION: schedule-engine
//
//  Jadval tuzish dvigatelining KODINI qaytaradi — faqat obunasi faol
//  foydalanuvchiga. Brauzer uni engineLoader.js orqali so'raydi va
//  Blob URL sifatida import qiladi.
//
//  Deploy:
//     npm run build:engine
//     supabase functions deploy schedule-engine
//
//  NIMA UCHUN SHUNDAY:
//  Ma'lumot RLS bilan himoyalangan (obunasiz hech narsa saqlanmaydi),
//  lekin jadval TUZISH brauzerda bajarilardi — ya'ni bundle'ni patch
//  qilgan odam obunasiz ham jadval tuza olardi. Endi dvigatel kodi
//  bundle'da umuman yo'q: uni olish uchun serverdan so'rash kerak,
//  server esa avval `has_active_sub()` ni tekshiradi.
//
//  BU KRIPTOGRAFIYA EMAS: obunasi bor odam kodni saqlab qolishi mumkin.
//  Maqsad — obunasi YO'Q odamda dvigatel bo'lmasligi.
//
//  CPU: bu funksiya faqat fayl qaytaradi (~50 ms), ya'ni Supabase'ning
//  2 soniyalik CPU chegarasiga bemalol sig'adi. Jadvalning O'ZI
//  avvalgidek brauzerda tuziladi.
// =====================================================================
import { ENGINE_B64 } from "./engine.gen.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// Kod faqat shu manzillarga beriladi
const ALLOWED_ORIGINS = [
  "https://smartjadval.uz",
  "https://www.smartjadval.uz",
  "http://localhost:5175",
  "http://127.0.0.1:5175",
  // `npm run preview` — production build'ni saytga chiqarishdan oldin
  // shu yerda sinash uchun (dev serverda dvigatel manbadan olinadi,
  // ya'ni bu funksiya umuman chaqirilmaydi).
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

// base64 -> matn (UTF-8). Kod ichida o'zbekcha satrlar bor.
let engineCode: string | null = null;
function getEngineCode(): string {
  if (engineCode === null) {
    const bin = atob(ENGINE_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    engineCode = new TextDecoder().decode(bytes);
  }
  return engineCode;
}

function fail(status: number, message: string, origin: string | null) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "GET") {
    return fail(405, "Faqat GET", origin);
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return fail(401, "Avval tizimga kiring", origin);
  }

  // OBUNA TEKSHIRUVI — foydalanuvchining O'Z tokeni bilan.
  // `has_active_sub()` ichida auth.uid() chaqiruvchiniki bo'ladi,
  // ya'ni javobni brauzerdan soxtalashtirib bo'lmaydi
  // (subscription_rls_setup.sql).
  let allowed = false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/has_active_sub`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (r.status === 401) return fail(401, "Sessiya muddati tugagan", origin);
    if (!r.ok) {
      return fail(503, "Obunani tekshirib bo'lmadi, birozdan keyin urinib ko'ring", origin);
    }
    allowed = (await r.json()) === true;
  } catch {
    return fail(503, "Obunani tekshirib bo'lmadi, birozdan keyin urinib ko'ring", origin);
  }

  if (!allowed) {
    return fail(402, "Obuna faol emas", origin);
  }

  return new Response(getEngineCode(), {
    status: 200,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "text/javascript; charset=utf-8",
      // Brauzer keshida bir soat tursin — har generatsiyada qayta
      // yuklanmasin. "private" = faqat shu foydalanuvchi keshi.
      "Cache-Control": "private, max-age=3600",
    },
  });
});
