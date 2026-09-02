// =====================================================================
//  BUNDLE TEKSHIRUVI — DVIGATEL SIZIB CHIQMADIMI?
//
//  Ishga tushirish:  npm run build && node scripts/checkBundle.mjs
//
//  Jadval tuzish dvigateli (src/engine/scheduleEngine.js) brauzerga
//  yuboriladigan `dist/` ga TUSHMASLIGI kerak — u obuna tekshiruvidan
//  keyin serverdan yuklanadi. Kimdir uni xato bilan statik import
//  qilsa (masalan `import { generateSchedule } from "../engine/..."`),
//  Vite uni jimgina bundle'ga qo'shib yuboradi va himoya yo'qoladi.
//
//  Shuning uchun bu yerda MINIFIKATSIYADAN KEYIN HAM qoladigan
//  belgilar qidiriladi: obyekt kalitlari va satr qiymatlari
//  (funksiya nomlari minifikatsiyada o'zgaradi, ular yaramaydi).
// =====================================================================
import { readdirSync, readFileSync, existsSync } from "node:fs";

const DIST = "dist/assets";

// Faqat dvigatelda uchraydigan belgilar (src/ bo'yicha tekshirilgan)
const MARKERS = [
  "teacherHints",         // noteTeacherAlternatives -> report
  "perClassSIdx",         // so'rov maydoni
  "levelGroupMap",        // daraja guruhlari xaritasi
  "offDayConflicts",      // buildValidationReport
  "blockedSlotConflicts", // buildValidationReport
];

if (!existsSync(DIST)) {
  console.error(`Topilmadi: ${DIST}\nAvval "npm run build" ni ishga tushiring.`);
  process.exit(1);
}

const files = readdirSync(DIST).filter((f) => f.endsWith(".js"));
if (!files.length) {
  console.error("dist/assets ichida .js fayl yo'q — build to'liq bajarilmagan.");
  process.exit(1);
}

let leaked = false;
for (const f of files) {
  const text = readFileSync(`${DIST}/${f}`, "utf8");
  const hits = MARKERS.filter((m) => text.includes(m));
  if (hits.length) {
    leaked = true;
    console.error(`XATO: ${f} ichida dvigatel belgilari topildi -> ${hits.join(", ")}`);
  }
}

if (leaked) {
  console.error("\nDvigatel bundle'ga tushib qolgan. Sabab odatda bitta:");
  console.error("  src/ ichidagi biror fayl src/engine/... dan STATIK import qilgan.");
  console.error("  To'g'ri yo'l — src/services/engineLoader.js orqali yuklash.");
  process.exit(1);
}

console.log(`OK — ${files.length} ta bundle faylida dvigatel belgilari yo'q.`);
