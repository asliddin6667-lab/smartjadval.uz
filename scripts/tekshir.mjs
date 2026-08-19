// Tiklangan zaxira faylini asl tahlil bilan solishtiradi:
// har sinf soati, har ustoz yuklamasi va jadvaldagi darslar to'liqligi.
//   node scripts/tekshir.mjs <tahlil.json> <zaxira.json>
import fs from "node:fs";

const [tahlilFile, backupFile] = process.argv.slice(2);
const tahlil = JSON.parse(fs.readFileSync(tahlilFile, "utf8"));
const backup = JSON.parse(fs.readFileSync(backupFile, "utf8"));
const d = backup.data || backup;

const classById = new Map(d.classes.map((c) => [c.id, c]));
const teacherById = new Map(d.teachers.map((t) => [t.id, t]));

// ——— 1) Sinf soatlari ———
let bad = 0;
(tahlil.sinflar || []).forEach((c) => {
  const name = String(c.sinf).replace(/\s*sinf\s*$/i, "").trim();
  const cls = d.classes.find((x) => x.name === name);
  const list = (cls && d.classSubjects[cls.id]) || [];
  const sum = list.reduce((n, a) => n + Number(a.weeklyHours || 0), 0);
  if (sum !== Number(c.kerakli || 0)) {
    console.log(`⚠️ sinf ${name}: tahlil ${c.kerakli} ≠ tiklangan ${sum}`);
    bad++;
  }
});
console.log(bad ? `❌ ${bad} sinfda farq` : "✅ Barcha sinf soatlari mos");

// ——— 2) Ustoz yuklamasi (ClassSubjects.jsx dagi computeTeacherHours mantiqi) ———
const load = {};
const add = (tid, h) => { if (tid && h) load[tid] = (load[tid] || 0) + h; };
const poolDone = new Set();
const parallelDone = new Set();
Object.values(d.classSubjects || {}).forEach((list) => {
  (list || []).forEach((a) => {
    const h = Number(a.weeklyHours || 0);
    if (!h) return;
    if (a.levelGroupEnabled) {
      const key = String(a.levelGroupKey || "").trim();
      (a.levelGroups || []).forEach((g) => {
        if (!g?.teacherId) return;
        const sig = key ? `L|${a.subjectId}|${key}|${g.teacherId}` : "";
        if (sig) {
          if (poolDone.has(sig)) return;
          poolDone.add(sig);
        }
        add(g.teacherId, h);
      });
      return;
    }
    const pKey = String(a.groupKey || "").trim();
    if (pKey && a.teacherId) {
      const sig = `P|${a.subjectId}|${pKey}|${a.teacherId}`;
      if (parallelDone.has(sig)) return;
      parallelDone.add(sig);
      add(a.teacherId, h);
      return;
    }
    add(a.teacherId, h);
    if (a.splitEnabled && a.teacherId2) add(a.teacherId2, h);
  });
});

let diffs = 0;
let over = 0;
(tahlil.oqituvchilar || []).forEach((t) => {
  const name = String(t.oqituvchi).replace(/\s+/g, " ").trim();
  const teacher = d.teachers.find((x) => x.name === name);
  const got = teacher ? (load[teacher.id] || 0) : 0;
  const want = Number(t.jadvaldagi_soat || 0);
  if (got !== want) {
    diffs++;
    console.log(`↔️ ${name}: tahlil ${want} → tiklangan ${got} (maks ${teacher?.maxWeeklyHours ?? "?"})`);
  }
  if (teacher && got > Number(teacher.maxWeeklyHours || 0)) {
    over++;
    console.log(`   ⚠️ maksimaldan oshdi: ${name} ${got} > ${teacher.maxWeeklyHours}`);
  }
});
console.log(diffs ? `↔️ ${diffs} ustozda yuklama farq qiladi (${over} tasi maksimaldan oshgan)` : "✅ Ustoz yuklamalari ham mos");

// ——— 3) Jadval to'liqligi ———
const required = Object.values(d.classSubjects || {}).reduce(
  (n, list) => n + list.reduce((m, a) => m + Number(a.weeklyHours || 0), 0), 0
);
const placedByClass = new Map();
let rows = 0;
Object.values(d.schedule || {}).forEach((bySlot) => {
  Object.values(bySlot || {}).forEach((list) => {
    (list || []).forEach((les) => {
      rows++;
      const ids = Array.isArray(les.classIds) && les.classIds.length ? les.classIds : [les.classId];
      // Bir katakda bir sinf uchun bir nechta guruh darsi bo'lishi mumkin — soat 1 marta
      ids.filter(Boolean).forEach((cid) => {
        const key = `${cid}`;
        placedByClass.set(key, placedByClass.get(key) || new Set());
      });
    });
  });
});
// Soatni aniq sanash: sinf × kun × slot bo'yicha noyob kataklar
let placed = 0;
Object.entries(d.schedule || {}).forEach(([day, bySlot]) => {
  Object.entries(bySlot || {}).forEach(([slotId, list]) => {
    const seen = new Map(); // classId → Set(subjectId)
    (list || []).forEach((les) => {
      const ids = Array.isArray(les.classIds) && les.classIds.length ? les.classIds : [les.classId];
      ids.filter(Boolean).forEach((cid) => {
        if (!seen.has(cid)) seen.set(cid, new Set());
        seen.get(cid).add(les.subjectId);
      });
    });
    seen.forEach((subs) => { placed += subs.size; });
  });
});
console.log(`📊 Yuklama ${required} soat · jadvalda ${placed} soat (${rows} yozuv) — ${required ? ((placed / required) * 100).toFixed(1) : 0}%`);
if (!classById.size || !teacherById.size) console.log("⚠️ Bo'sh ro'yxat");
