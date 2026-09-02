// =====================================================================
//  QURILGAN DVIGATELNI EDGE FUNCTION ICHIGA JOYLASH
//
//  Ishga tushirish:  npm run build:engine  (vite build'dan keyin
//                    avtomatik chaqiriladi)
//
//  build/engine/engine.js  ->  supabase/functions/schedule-engine/engine.gen.ts
//
//  Nega base64: kod ichida backtick, ${...} va qator uzilishlari bor —
//  ularni TypeScript satriga to'g'ridan-to'g'ri yozib bo'lmaydi.
//  base64 esa har doim xavfsiz va Deno uni bir qatorda dekodlaydi.
// =====================================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const SRC = "build/engine/engine.js";
const OUT_DIR = "supabase/functions/schedule-engine";
const OUT = `${OUT_DIR}/engine.gen.ts`;

if (!existsSync(SRC)) {
  console.error(`Topilmadi: ${SRC}\nAvval "npm run build:engine" ni to'liq ishga tushiring.`);
  process.exit(1);
}

const code = readFileSync(SRC);
if (code.length < 20000) {
  console.error(`Dvigatel juda kichik (${code.length} bayt) — qurilish xato ketgan bo'lishi mumkin.`);
  process.exit(1);
}

// Dvigatel haqiqatan ichida ekanini tekshiramiz (marker — minifikatsiyadan
// keyin ham qoladigan obyekt kaliti)
const text = code.toString("utf8");
for (const marker of ["teacherHints", "remainingTotal"]) {
  if (!text.includes(marker)) {
    console.error(`Dvigatelda "${marker}" belgisi yo'q — noto'g'ri fayl qurilgan.`);
    process.exit(1);
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const b64 = code.toString("base64");
const out = [
  "// =====================================================================",
  "//  AVTOMATIK YARATILGAN — QO'LDA TAHRIRLAMANG",
  "//  Manba: npm run build:engine (scripts/packEngine.mjs)",
  "// =====================================================================",
  `export const ENGINE_B64 = "${b64}";`,
  `export const ENGINE_BYTES = ${code.length};`,
  "",
].join("\n");
writeFileSync(OUT, out);

console.log(`Dvigatel: ${(code.length / 1024).toFixed(0)} KB -> ${OUT} (${(out.length / 1024).toFixed(0)} KB base64)`);
console.log("Keyingi qadam:  supabase functions deploy schedule-engine");
