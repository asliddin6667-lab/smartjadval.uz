// =====================================================================
//  TAHLIL JSON  →  SMARTJADVAL ZAXIRA (school-backup) O'GIRUVCHI
//
//  Nima uchun: "jadval tahlili" faylida sinflar, fanlar, ustozlar va
//  har bir sinf-fan uchun HAFTALIK SOAT bor, lekin id lar, xonalar va
//  darslarning kun/soat bo'yicha joylashuvi YO'Q. Shu skript o'sha
//  tahlildan Sozlamalar > "Ma'lumotni tiklash" qabul qiladigan to'liq
//  JSON yasaydi va jadvalni qaytadan generatsiya qiladi.
//
//  Ishlatish:
//    node scripts/tahlilToBackup.mjs "<tahlil.json>" [chiqish.json] [--no-schedule]
//
//  Nimalar tiklanadi: classes, subjects, teachers, classSubjects,
//  timeslots, rooms (bo'sh), lunchGroups (bo'sh), shifts (bo'sh), schedule.
//  `settings` faylga QO'SHILMAYDI — tiklashda maktab nomi o'chib
//  ketmasligi uchun (parseBackup faylda yo'q kalitga tegmaydi).
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { SUBJECT_COLORS } from "../src/utils/constants.js";

// src/ ichidagi importlar Vite uslubida kengaytmasiz yozilgan ("./constants"),
// shuning uchun Node uchun kichik "resolve" ilgagi ulanadi.
register("./nodeResolveExt.mjs", import.meta.url);
const { generateSchedule } = await import("../src/utils/scheduleGenerator.js");

const argv = process.argv.slice(2);
const noSchedule = argv.includes("--no-schedule");
const files = argv.filter((a) => !a.startsWith("--"));
const inFile = files[0];
if (!inFile) {
  console.error("Foydalanish: node scripts/tahlilToBackup.mjs <tahlil.json> [chiqish.json] [--no-schedule]");
  process.exit(1);
}
const outFile = files[1] || path.join(
  path.dirname(inFile),
  `smartjadval_zaxira_${path.basename(inFile, ".json")}.json`
);

// Barcha yozuvlar uchun bir xil vaqt tamg'asi (qayta yugurtirilsa ham bir xil fayl)
const NOW = Date.parse("2026-08-19T00:00:00Z");

// ——— Yordamchilar ———

// "1-A sinf" → "1-A"
function className(raw) {
  return String(raw || "").replace(/\s*sinf\s*$/i, "").trim();
}

// Ismlar ro'yxati: "A, B,  C" → ["A","B","C"] (qo'sh probel va bo'shlar tozalanadi)
function splitNames(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s && s !== "—" && s !== "–" && s !== "-");
}

function isCyr(s) {
  return /[А-Яа-яЁё]/.test(String(s));
}

// Nomdan barqaror id: bir xil nom → doim bir xil id
function slugId(prefix, text) {
  const base = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  let hash = 5381;
  const s = String(text);
  for (let i = 0; i < s.length; i++) hash = ((hash * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${prefix}_${base || "x"}_${hash.toString(36)}`;
}

function addMin(t, m) {
  const [h, mi] = String(t).split(":").map(Number);
  const total = h * 60 + mi + m;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ——— Tahlil faylini o'qish ———
// Ikki ko'rinish qo'llab-quvvatlanadi: {sinflar, oqituvchilar} va
// {sinflar_tahlili:{sinflar…}, oqituvchilar_tahlili:{oqituvchilar…}}
const raw = JSON.parse(fs.readFileSync(inFile, "utf8"));
const srcClasses = raw.sinflar || raw.sinflar_tahlili?.sinflar || [];
const srcTeachers = raw.oqituvchilar || raw.oqituvchilar_tahlili?.oqituvchilar || [];
if (!srcClasses.length) {
  console.error("Faylda 'sinflar' ro'yxati topilmadi");
  process.exit(1);
}

// ——— 1) SINFLAR ———
const classes = srcClasses.map((c) => {
  const name = className(c.sinf);
  // Sinf tili: fan nomlari kirillda bo'lsa — rus sinfi
  const cyr = (c.fanlar || []).filter((f) => isCyr(f.fan)).length;
  const lat = (c.fanlar || []).length - cyr;
  return {
    id: slugId("class", name),
    name,
    studentCount: "",
    headTeacher: "",
    offDays: [],
    eduLang: cyr > lat ? "ru" : "uz",
    createdAt: NOW,
  };
});
const classIdByName = new Map(classes.map((c) => [c.name, c.id]));

// ——— 2) FANLAR ———
// Nom bo'yicha yig'iladi: soat = eng ko'p uchragan qiymat,
// tur = biror sinfda 2+ ustoz bo'lsa "Guruhli".
const subjMap = new Map(); // name → { hours: Map, grouped: bool }
srcClasses.forEach((c) => {
  (c.fanlar || []).forEach((f) => {
    const name = String(f.fan || "").trim();
    if (!name) return;
    if (!subjMap.has(name)) subjMap.set(name, { hours: new Map(), grouped: false });
    const rec = subjMap.get(name);
    const h = Number(f.kerakli || f.joylashgan || 1) || 1;
    rec.hours.set(h, (rec.hours.get(h) || 0) + 1);
    if (splitNames(f.ustoz).length > 1) rec.grouped = true;
  });
});
// Ustozlar ro'yxatida bor, lekin hech bir sinfga biriktirilmagan fanlar ham qo'shiladi
srcTeachers.forEach((t) => {
  splitNames(t.fanlar).forEach((name) => {
    if (!subjMap.has(name)) subjMap.set(name, { hours: new Map([[1, 1]]), grouped: false });
  });
});

const subjects = [...subjMap.entries()]
  .sort((a, b) => a[0].localeCompare(b[0], "uz"))
  .map(([name, rec], i) => {
    let best = 1;
    let bestN = -1;
    rec.hours.forEach((n, h) => {
      if (n > bestN) { best = h; bestN = n; }
    });
    return {
      id: slugId("sub", name),
      name,
      weeklyHours: best,
      type: rec.grouped ? "Guruhli" : "Oddiy",
      color: SUBJECT_COLORS[i % SUBJECT_COLORS.length],
      allowDouble: false,
      lang: isCyr(name) ? "ru" : "uz",
      createdAt: NOW,
    };
  });
const subjectIdByName = new Map(subjects.map((s) => [s.name, s.id]));

// ——— 3) O'QITUVCHILAR ———
// Asosiy manba — tahlilning "oqituvchilar" bo'limi. Sinf jadvalida uchrab,
// ro'yxatda yo'q ustoz bo'lsa, u ham qo'shiladi (ma'lumot yo'qolmasin).
const teacherMap = new Map();
function ensureTeacher(name) {
  const key = String(name).replace(/\s+/g, " ").trim();
  if (!key) return null;
  if (!teacherMap.has(key)) {
    teacherMap.set(key, {
      id: slugId("teacher", key),
      name: key,
      subjectIds: [],
      phone: "",
      maxWeeklyHours: 40,
      status: "Bo'sh",
      offDays: [],
      createdAt: NOW,
    });
  }
  return teacherMap.get(key);
}
srcTeachers.forEach((t) => {
  const teacher = ensureTeacher(t.oqituvchi);
  if (!teacher) return;
  const max = Number(t.maksimal_soat);
  if (Number.isFinite(max) && max > 0) teacher.maxWeeklyHours = max;
  splitNames(t.fanlar).forEach((sname) => {
    const sid = subjectIdByName.get(sname);
    if (sid && !teacher.subjectIds.includes(sid)) teacher.subjectIds.push(sid);
  });
});
srcClasses.forEach((c) => {
  (c.fanlar || []).forEach((f) => {
    const sid = subjectIdByName.get(String(f.fan || "").trim());
    splitNames(f.ustoz).forEach((tname) => {
      const teacher = ensureTeacher(tname);
      if (teacher && sid && !teacher.subjectIds.includes(sid)) teacher.subjectIds.push(sid);
    });
  });
});
const teachers = [...teacherMap.values()].sort((a, b) => a.name.localeCompare(b.name, "uz"));
const teacherIdByName = new Map(teachers.map((t) => [t.name, t.id]));

// ——— 4) SINF FANLARI (yuklama) ———
// Ko'p ustozli fanni qanday tiklash kerak? Tahlildagi "jadvaldagi_soat"
// ustunlari bilan solishtirib topilgan qoida (60 ustozdan 59 tasi aniq mos
// tushadi, scripts/tekshir.mjs buni tekshiradi):
//
//   1 ustoz   → oddiy dars
//   2 ustoz   → SINF ICHIDA IKKI GURUH (split) — har sinfda alohida
//   3+ ustoz  → HOVUZ (daraja guruhi): bir PARALLELdagi (bir xil sinf raqami)
//               va aynan bir xil ustozlar to'plamiga ega sinflar birga o'qiydi
const POOL_MIN_TEACHERS = 3;

function gradeOf(name) {
  const m = String(name).match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}

// ClassSubjects.jsx dagi makeAssignment bilan bir xil maydonlar
function makeAssignment(subject) {
  return {
    subjectId: subject.id,
    weeklyHours: subject.weeklyHours || 1,
    teacherId: "",
    roomId: "",
    groupKey: "",
    splitEnabled: false,
    teacherId2: "",
    roomId2: "",
    swapEnabled: false,
    swapSubjectId: "",
    swapTeacherId: "",
    swapRoomId: "",
    groupName1: "1-guruh",
    groupName2: "2-guruh",
    levelGroupEnabled: false,
    levelGroupKey: "",
    allowDouble: false,
    levelGroupCount: 3,
    levelGroups: [
      { name: "1-daraja", teacherId: "", roomId: "" },
      { name: "2-daraja", teacherId: "", roomId: "" },
      { name: "3-daraja", teacherId: "", roomId: "" },
    ],
    parallelEnabled: false,
    isCore: false,
    spacedDays: false,
    weekAltEnabled: false,
    weekAltSubjectId: "",
    weekAltTeacherId: "",
    weekAltRoomId: "",
    weekAltHours: 1,
  };
}

const classSubjects = {};
classes.forEach((cls) => { classSubjects[cls.id] = []; });

srcClasses.forEach((c) => {
  const cid = classIdByName.get(className(c.sinf));
  if (!cid) return;
  (c.fanlar || []).forEach((f) => {
    const sname = String(f.fan || "").trim();
    const sid = subjectIdByName.get(sname);
    const subject = subjects.find((s) => s.id === sid);
    if (!subject) return;
    const hours = Number(f.kerakli || f.joylashgan || 0) || 0;
    if (!hours) return;

    const tIds = splitNames(f.ustoz).map((n) => teacherIdByName.get(n)).filter(Boolean);
    const a = makeAssignment(subject);
    a.weeklyHours = hours;

    if (tIds.length <= 1) {
      a.teacherId = tIds[0] || "";
    } else if (tIds.length < POOL_MIN_TEACHERS) {
      // Ikki ustoz → sinf ichida ikki guruh
      a.splitEnabled = true;
      a.teacherId = tIds[0];
      a.teacherId2 = tIds[1];
    } else {
      // Hovuz: shu paralleldagi, aynan shu ustozlar to'plamiga ega sinflar birga
      const sortedIds = [...tIds].sort();
      const grade = gradeOf(className(c.sinf));
      a.levelGroupEnabled = true;
      a.levelGroupKey = `${sname} hovuz — ${grade}-parallel — ${sortedIds.join("_")}`;
      a.levelGroups = tIds.map((tid, i) => ({ name: `${i + 1}-daraja`, teacherId: tid, roomId: "" }));
      a.levelGroupCount = a.levelGroups.length;
      a.teacherId = "";
    }
    classSubjects[cid].push(a);
  });
});

// ——— 5) DARS VAQTLARI ———
// Eng band sinfning haftalik soatiga qarab kunlik dars soni: 6 kun × N (+1 zaxira)
const maxWeek = Math.max(0, ...Object.values(classSubjects).map(
  (list) => list.reduce((n, a) => n + Number(a.weeklyHours || 0), 0)
));
const perDay = Math.min(9, Math.max(5, Math.ceil(maxWeek / 6) + 1));
const timeslots = [];
let cur = "08:00";
for (let i = 1; i <= perDay; i++) {
  timeslots.push({
    id: `ts_${i}`,
    lessonNumber: i,
    startTime: cur,
    endTime: addMin(cur, 45),
    type: "lesson",
    title: "",
    classIds: [],
  });
  cur = addMin(cur, 50);
}

// ——— 6) JADVAL ———
const rooms = [];
const lunchGroups = [];
const shifts = [];
let schedule = {};
if (!noSchedule) {
  console.log(`⏳ Jadval generatsiyasi… (eng band sinf ${maxWeek} soat, kuniga ${perDay} dars)`);
  schedule = generateSchedule(
    classes, subjects, teachers, rooms, timeslots, classSubjects, lunchGroups, null,
    { attempts: 6 }
  );
}

// ——— 7) ZAXIRA FAYLI ———
function countOf(v) {
  return Array.isArray(v) ? v.length : Object.keys(v || {}).length;
}
let lessonCount = 0;
Object.values(schedule || {}).forEach((bySlot) => {
  Object.values(bySlot || {}).forEach((list) => {
    if (Array.isArray(list)) lessonCount += list.length;
  });
});

const backup = {
  app: "smartjadval",
  type: "school-backup",
  version: 1,
  exportedAt: new Date(NOW).toISOString(),
  schoolName: "",
  note: `Tahlil faylidan tiklandi: ${path.basename(inFile)}`,
  counts: {
    classes: classes.length,
    subjects: subjects.length,
    teachers: teachers.length,
    classSubjects: countOf(classSubjects),
    rooms: rooms.length,
    timeslots: timeslots.length,
    lunchGroups: lunchGroups.length,
    shifts: shifts.length,
    schedule: lessonCount,
  },
  data: { classes, subjects, teachers, classSubjects, rooms, timeslots, lunchGroups, shifts, schedule },
};

fs.writeFileSync(outFile, JSON.stringify(backup, null, 2), "utf8");

// ——— Qisqa hisobot ———
const totalHours = Object.values(classSubjects).reduce(
  (n, list) => n + list.reduce((m, a) => m + Number(a.weeklyHours || 0), 0), 0
);
console.log(`✅ ${outFile}`);
console.log(`   sinflar ${classes.length} · fanlar ${subjects.length} · ustozlar ${teachers.length}`);
console.log(`   yuklama ${totalHours} soat · jadvalda ${lessonCount} dars · vaqtlar ${timeslots.length}`);
