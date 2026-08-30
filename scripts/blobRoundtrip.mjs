// =====================================================================
//  BLOB FORMATI — YO'QOTISHSIZLIK SINOVI
//
//  Ishga tushirish:   node scripts/blobRoundtrip.mjs
//
//  NIMA UCHUN KERAK: bulutga yoziladigan format o'zgarsa, ma'lumot
//  jimgina buzilishi mumkin — ekranda esa hammasi joyidek ko'rinadi.
//  Bu skript sun'iy, lekin realistik maktab yasab, uni bulut formatiga
//  o'girib qaytaradi va natija AYNAN bir xilligini tekshiradi.
//
//  ⚠️ `schoolBlob.js` ga (ayniqsa CS_DEFAULTS, encodeBlob/decodeBlob,
//  packBlob/unpackBlob) tegilsa — SHU SKRIPTNI QAYTA ISHGA TUSHIRING.
//  `WRITE_COMPRESSED` ni `true` ga o'tkazishdan oldin ham majburiy.
// =====================================================================
import {
  packBlob, unpackBlob, fillBlob, encodeBlob, decodeBlob,
  quickHash, keyHash, hashKeysOf, SYNC_KEYS, canCompress,
} from "../src/services/schoolBlob.js";

const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const DAYS = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Realistik maktab: 30 sinf, 6 kun, kuniga 6 dars
const cids = Array.from({ length: 30 }, id);
const sids = Array.from({ length: 6 }, id);
const subj = Array.from({ length: 18 }, id);
const tch = Array.from({ length: 45 }, id);
const rms = Array.from({ length: 25 }, id);

const schedule = {};
for (const d of DAYS) {
  schedule[d] = {};
  for (const s of sids) {
    schedule[d][s] = cids.map((c) => ({
      subjectId: pick(subj), classId: c, classIds: [c], teacherId: pick(tch),
      roomId: pick(rms), groupKey: "", blockSize: 1, blockIndex: 0,
    }));
  }
}

// classSubjects — default VA default bo'lmagan qiymatlar aralash
// (sparse kodlash aynan shu yerda ishlaydi)
const classSubjects = {};
for (const c of cids) {
  classSubjects[c] = Array.from({ length: 15 }, () => ({
    id: id(), subjectId: pick(subj), teacherId: pick(tch), weeklyHours: 2,
    isCore: false, roomId: "", allowDouble: true, splitEnabled: Math.random() < 0.2,
    pairEnabled: false, levelGroups: [], pairExtra: [], groupName1: "1-guruh",
    spacedDays: Math.random() < 0.3, levelGroupCount: 0, pairShare2: false,
  }));
}

const blob = {
  settings: { schoolName: "Sinov maktabi", parallelDays: true },
  classes: cids.map((c, i) => ({ id: c, name: `${1 + (i % 11)}-${"ABV"[i % 3]}` })),
  subjects: subj.map((s) => ({ id: s, name: "Fan " + s })),
  teachers: tch.map((t) => ({ id: t, name: "Ustoz " + t, offDays: [] })),
  classSubjects,
  rooms: rms.map((r) => ({ id: r, name: "Xona " + r })),
  timeslots: sids.map((s, i) => ({ id: s, startTime: `0${8 + i}:00`, endTime: `0${8 + i}:45` })),
  lunchGroups: [], shifts: [], schedule,
  savedSchedules: [{ id: id(), name: "Jadval 1", schedule, meta: { lessons: 1080 } }],
};

const stamp = { rev: 42, ts: 1756500000000, dev: "d1a2b3c4" };
// JSONB orqali o'tishni taqlid qilamiz (bulutga borib-kelish)
const wire = (o) => JSON.parse(JSON.stringify(o));

// Kanonik shakl — bulutdan qaytgandan keyingi holat
const ref = fillBlob(decodeBlob(encodeBlob(blob, stamp)));

let fail = 0;
function check(name, got) {
  const ok = quickHash(JSON.stringify(got)) === quickHash(JSON.stringify(ref))
    && JSON.stringify(hashKeysOf(got)) === JSON.stringify(hashKeysOf(ref));
  if (!ok) {
    fail++;
    for (const k of SYNC_KEYS) {
      if (keyHash(got[k]) !== keyHash(ref[k])) console.log(`     ❗ farq: ${k}`);
    }
  }
  console.log(`${ok ? "✅" : "❌"} ${name}`);
}

const plain = await packBlob(blob, stamp, { compress: false });
const zipped = await packBlob(blob, stamp, { compress: true });

check("siqilmagan: pack -> unpack aynan bir xil", fillBlob(await unpackBlob(wire(plain))));
check("siqilgan:   pack -> unpack aynan bir xil", fillBlob(await unpackBlob(wire(zipped))));
check("yangi kod ESKI (siqilmagan) yozuvni o'qidi", fillBlob(decodeBlob(wire(plain))));

// Idempotentlik: qayta-qayta aylantirganda kalit hash'lari o'zgarmasin,
// aks holda qurilmalar orasida YOLG'ON konflikt chiqadi.
let cur = fillBlob(await unpackBlob(wire(zipped)));
for (let i = 0; i < 3; i++) {
  cur = fillBlob(await unpackBlob(wire(await packBlob(cur, stamp, { compress: true }))));
}
check("3 marta aylantirilgandan keyin ham o'zgarmadi", cur);

// Buzilgan yozuv -> null (BO'SH OBYEKT EMAS!). Shu qoida buzilsa,
// tanilmagan format "bo'sh maktab" deb qabul qilinib, foydalanuvchining
// ma'lumoti ustidan yozilib ketardi.
const bad = await unpackBlob({ _v: 4, _z: "buzuq!!!", _rev: 1 });
console.log(`${bad === null ? "✅" : "❌"} buzilgan nusxa -> null (ustidan yozilmaydi)`);
if (bad !== null) fail++;

// CAS so'rovi `data->>'_rev'` ni o'qiydi — u siqilgan qismda QOLMASLIGI kerak
const casOk = zipped._rev === 42 && zipped._ts === stamp.ts && zipped._dev === stamp.dev;
console.log(`${casOk ? "✅" : "❌"} _rev/_ts/_dev tashqarida (CAS ishlaydi)`);
if (!casOk) fail++;

const kb = (n) => (n / 1024).toFixed(0) + " KB";
const a = JSON.stringify(plain).length, b = JSON.stringify(zipped).length;
console.log(`\ngzip mavjud: ${canCompress() ? "ha" : "YO'Q"}`);
console.log(`Hajm: ${kb(a)} -> ${kb(b)}  (${(a / b).toFixed(1)}x kichik)`);
console.log(fail ? `\n❌ ${fail} ta sinov muvaffaqiyatsiz` : "\n✅ HAMMA SINOV O'TDI");
process.exit(fail ? 1 : 0);
