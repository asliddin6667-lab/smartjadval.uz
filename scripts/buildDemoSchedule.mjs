// =====================================================================
//  DEMO JADVALNI QAYTA YARATISH
//
//  Ishga tushirish:   node scripts/buildDemoSchedule.mjs
//
//  NIMA UCHUN KERAK: jadval tuzish dvigateli endi brauzer bundle'ida
//  emas — u obuna tekshiruvidan keyin serverdan yuklanadi
//  (src/services/engineLoader.js). Demo hisobining obunasi yo'q,
//  shuning uchun uning jadvali OLDINDAN tuziladi va
//  src/utils/demoSchedule.js ga yoziladi.
//
//  ⚠️ demoData.js dagi sinf/fan/ustoz ro'yxati o'zgarsa — SHU SKRIPTNI
//  qayta ishga tushiring, aks holda demo jadval eski id'larga ishora
//  qilib qoladi va ekranda bo'sh setka ko'rinadi.
// =====================================================================
import { register } from "node:module";
import { writeFileSync } from "node:fs";

// Loyiha kodi Vite uslubida yozilgan: `import { DAYS } from "./constants"`
// — kengaytmasiz. Node bunday yozuvni tushunmaydi, shuning uchun kichik
// resolver ulanadi (faqat shu skript uchun, manba kodga tegilmaydi).
const hook = `
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/[.][a-zA-Z0-9]+$/.test(spec)) {
    const url = new URL(spec + '.js', ctx.parentURL);
    if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
  }
  return next(spec, ctx);
}`;
register("data:text/javascript," + encodeURIComponent(hook));

const { buildDemoSchoolData } = await import("../src/utils/demoData.js");
const { generateSchedule } = await import("../src/engine/scheduleEngine.js");

const d = buildDemoSchoolData();
const totalHours = Object.values(d.classSubjects || {}).reduce(
  (t, rows) => t + rows.reduce((s, a) => s + (Number(a.weeklyHours) || 0), 0), 0,
);
console.log(`Demo maktab: ${d.classes.length} sinf, ${d.teachers.length} ustoz, ${totalHours} soat`);

const t0 = Date.now();
const schedule = generateSchedule(
  d.classes, d.subjects, d.teachers, d.rooms, d.timeslots,
  d.classSubjects, d.lunchGroups, null, { attempts: 6, quiet: true },
);

let placed = 0;
for (const day of Object.keys(schedule)) {
  for (const slot of Object.keys(schedule[day] || {})) {
    placed += (schedule[day][slot] || []).length;
  }
}
console.log(`Tuzildi: ${placed} ta yozuv · ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const out = [
  "// =====================================================================",
  "//  DEMO JADVAL — AVTOMATIK YARATILGAN, QO'LDA TAHRIRLANMAYDI",
  "//  Manba: node scripts/buildDemoSchedule.mjs",
  "//",
  "//  Demo hisobida obuna yo'q, dvigatel esa serverdan obuna bilan",
  "//  beriladi — shuning uchun demo jadval tayyor holda saqlanadi.",
  "// =====================================================================",
  `export default ${JSON.stringify(schedule)};`,
  "",
].join("\n");

writeFileSync("src/utils/demoSchedule.js", out);
console.log(`Yozildi: src/utils/demoSchedule.js (${(out.length / 1024).toFixed(0)} KB)`);
