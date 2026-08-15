import { useEffect, useState } from "react";
import {
  PRIMARY_SUBJECT_NAMES, MIDDLE_SUBJECT_NAMES, HIGH_SUBJECT_NAMES,
  PRIMARY_SUBJECT_NAMES_RU, MIDDLE_SUBJECT_NAMES_RU, HIGH_SUBJECT_NAMES_RU
} from "../utils/constants";
import { sortByName, cmpName } from "../utils/sortHelpers";

function teacherSubjectIds(teacher) {
  return Array.isArray(teacher.subjectIds) ? teacher.subjectIds : (teacher.subjectId ? [teacher.subjectId] : []);
}

function getGradeFromClassName(name = "") {
  const match = String(name).match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

// Sinf va fanning ta'lim tili (eski ma'lumotlar uchun standart — o'zbekcha)
function classLangOf(c) { return c?.eduLang || "uz"; }
function subjectLangOf(s) { return s?.lang || "uz"; }

// ——— Hovuz (daraja guruhi) a'zolari uchun UMUMIY maydonlar ———
// Bir joyda o'zgarsa — guruhdagi barcha sinflarda bir xil bo'ladi.
// Diqqat: levelGroupEnabled shu ro'yxatda YO'Q — bitta sinfni guruhdan
// chiqarish boshqalarni o'chirib yubormasligi kerak.
const POOL_SHARED_FIELDS = [
  "weeklyHours",
  "allowDouble",
  "isCore",
  "spacedDays",
  "levelGroupCount",
  "levelGroups",
  "parallelEnabled",
  "groupKey",
  "splitEnabled",
  "swapEnabled",
  "weekAltEnabled",
  "weekAltSubjectId",
  "weekAltTeacherId",
  "weekAltRoomId",
  "weekAltHours",
];

function pickShared(obj = {}) {
  const out = {};
  POOL_SHARED_FIELDS.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  });
  return out;
}

function cloneShared(shared = {}) {
  const out = { ...shared };
  if (Array.isArray(out.levelGroups)) out.levelGroups = out.levelGroups.map((g) => ({ ...g }));
  return out;
}

function namesForGrade(grade, lang = "uz") {
  if (lang === "ru") {
    if (grade >= 1 && grade <= 4) return PRIMARY_SUBJECT_NAMES_RU;
    if (grade >= 5 && grade <= 8) return MIDDLE_SUBJECT_NAMES_RU;
    return HIGH_SUBJECT_NAMES_RU;
  }
  if (grade >= 1 && grade <= 4) return PRIMARY_SUBJECT_NAMES;
  if (grade >= 5 && grade <= 8) return MIDDLE_SUBJECT_NAMES;
  return HIGH_SUBJECT_NAMES;
}

/* ===================================================================
   2025-2026 o'quv yili TAYANCH O'QUV REJA (o'zbek tilidagi maktablar)
   Maktabgacha va maktab ta'limi vaziri 2025-yil 10-apreldagi
   121-son buyrug'iga 1-ILOVA.
   h = { sinf: haftalik soat }.  Kasr soatlar (1,5 / 0,5) generator uchun
   butun songa yaxlitlanadi (Math.round) — quyidagi curriculumHours() ga qarang.
=================================================================== */
const CURRICULUM_UZ = [
  // I. Filologiya fanlari
  { name: "Ona tili", aliases: ["ona tili"], h: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 3, 8: 3, 9: 3, 10: 2, 11: 2 } },
  { name: "O'qish savodxonligi", aliases: ["o'qish savodxonligi", "alifbe", "o'qish"], h: { 1: 4, 2: 3, 3: 3, 4: 3 } },
  { name: "Adabiyot", aliases: ["adabiyot"], h: { 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Rus tili", aliases: ["rus tili"], h: { 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Chet tili", aliases: ["chet tili", "ingliz tili", "nemis tili", "fransuz tili", "xorijiy til"], h: { 1: 1, 2: 2, 3: 2, 4: 2, 5: 4, 6: 4, 7: 4, 8: 3, 9: 3, 10: 2, 11: 2 } },

  // II. Ijtimoiy fanlar
  { name: "Tarixdan hikoyalar", aliases: ["tarixdan hikoyalar"], h: { 5: 2 } },
  { name: "Qadimgi dunyo tarixi", aliases: ["qadimgi dunyo tarixi"], h: { 6: 2 } },
  { name: "O'zbekiston tarixi", aliases: ["o'zbekiston tarixi"], h: { 7: 2, 8: 2, 9: 2, 10: 1, 11: 1 } },
  { name: "Jahon tarixi", aliases: ["jahon tarixi"], h: { 7: 1, 8: 1, 9: 1, 10: 1, 11: 1 } },
  { name: "Davlat va huquq asoslari", aliases: ["davlat va huquq asoslari", "huquq asoslari"], h: { 8: 1, 9: 1, 10: 1, 11: 1 } },
  { name: "Tarbiya", aliases: ["tarbiya"], h: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1 } },

  // III. Aniq fanlar
  { name: "Matematika", aliases: ["matematika"], h: { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5 } },
  { name: "Algebra", aliases: ["algebra"], h: { 8: 3, 9: 3, 10: 3, 11: 3 } },
  { name: "Geometriya", aliases: ["geometriya"], h: { 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Informatika va axborot texnologiyalari", aliases: ["informatika va axborot texnologiyalari", "informatika", "informatika va at", "axborot texnologiyalari"], h: { 1: 1, 2: 1, 3: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 2, 10: 2, 11: 2 } },

  // IV. Tabiiy va iqtisodiy fanlar
  { name: "Fizika", aliases: ["fizika"], h: { 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Astronomiya", aliases: ["astronomiya", "astranomiya"], h: { 11: 1 } },
  { name: "Kimyo", aliases: ["kimyo"], h: { 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Biologiya", aliases: ["biologiya"], h: { 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Geografiya", aliases: ["geografiya"], h: { 7: 2, 8: 1.5, 9: 1.5, 10: 2 } },
  { name: "Iqtisodiy bilim asoslari", aliases: ["iqtisodiy bilim asoslari", "iqtisodiyot asoslari"], h: { 8: 0.5, 9: 0.5 } },
  { name: "Tadbirkorlik asoslari", aliases: ["tadbirkorlik asoslari"], h: { 11: 1 } },
  { name: "Tabiiy fanlar", aliases: ["tabiiy fanlar", "tabiiy fanlar science", "science", "tabiatshunoslik"], h: { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 3 } },

  // V. Amaliy fanlar
  { name: "Musiqa madaniyati", aliases: ["musiqa madaniyati", "musiqa"], h: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 } },
  { name: "Tasviriy san'at", aliases: ["tasviriy san'at", "tasviriy sanat"], h: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 } },
  { name: "Chizmachilik", aliases: ["chizmachilik"], h: { 8: 1, 9: 1 } },
  { name: "Texnologiya", aliases: ["texnologiya", "mehnat", "mehnat ta'limi", "texnologiya ta'limi"], h: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1 } },
  { name: "Jismoniy tarbiya", aliases: ["jismoniy tarbiya", "jismoniy madaniyat"], h: { 1: 1, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2 } },
  { name: "Chaqiruvga qadar boshlang'ich tayyorgarlik", aliases: ["chaqiruvga qadar boshlang'ich tayyorgarlik", "chqbt", "chaqiruvgacha boshlang'ich tayyorgarlik"], h: { 10: 2, 11: 2 } },
];

// Fan nomlarini solishtirish uchun: apostroflar, katta-kichik harf,
// ortiqcha bo'shliq va qavslar hisobga olinmaydi.
function normName(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BB\u02BC\u0060\u00B4`']/g, "'")
    .replace(/[()\[\].,:;!?"«»\-–—_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CURRICULUM_INDEX = (() => {
  const m = new Map();
  CURRICULUM_UZ.forEach((row) => {
    [row.name, ...(row.aliases || [])].forEach((alias) => {
      const k = normName(alias);
      if (k && !m.has(k)) m.set(k, row);
    });
  });
  return m;
})();

function curriculumRowFor(subjectName) {
  return CURRICULUM_INDEX.get(normName(subjectName)) || null;
}

// Shu sinf uchun tayanch rejadagi soat. Fan bu sinfda o'qitilmasa — null.
function curriculumHours(subjectName, grade) {
  const row = curriculumRowFor(subjectName);
  if (!row) return null;
  const h = row.h[grade];
  if (h === undefined) return null;
  return Math.max(1, Math.round(h)); // 1,5 → 2 ; 0,5 → 1
}

// Tayanch rejada shu sinfga tegishli fanlar ro'yxati (nomlari bilan)
function curriculumNamesForGrade(grade) {
  return CURRICULUM_UZ.filter((r) => r.h[grade] !== undefined).map((r) => r.name);
}

function makeLevelGroups(count = 3, existing = []) {
  const n = Math.max(1, Math.min(12, Number(count || 1)));
  return Array.from({ length: n }, (_, i) => ({
    name: existing[i]?.name || `${i + 1}-daraja`,
    teacherId: existing[i]?.teacherId || "",
    roomId: existing[i]?.roomId || "",
  }));
}

function makeAssignment(subject, firstTeacherId = "") {
  return {
    subjectId: subject?.id || "",
    weeklyHours: subject?.weeklyHours || 1,
    teacherId: firstTeacherId,
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
    // "2 soat blok" — fan qo'shilganda HAR DOIM o'chiq.
    // Faqat foydalanuvchi ⚙️ Sozlamalardan o'zi yoqsa ishlaydi.
    allowDouble: false,
    levelGroupCount: 3,
    levelGroups: makeLevelGroups(3),
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

// ——— Ustoz yuklamasi: hovuz va parallel darslar 1 marta hisoblanadi ———
// Hovuz: 3 sinf birga, bir vaqtda o'qiydi → ustozga 3 soat emas, 1 soat.
// Parallel: bir ustoz bir nechta sinfga bir vaqtda kiradi → 1 marta.
function computeTeacherHours(classSubjects) {
  const load = {};
  const add = (tid, h) => {
    if (!tid || !h) return;
    load[tid] = (load[tid] || 0) + h;
  };
  const poolDone = new Set();
  const parallelDone = new Set();

  Object.values(classSubjects || {}).forEach((list) => {
    (list || []).forEach((a) => {
      if (!a) return;
      const h = Number(a.weeklyHours || 0);
      if (!h) return;

      // 1) Hovuz / daraja guruhi — har bir daraja ustozi guruh bo'yicha 1 marta
      if (a.levelGroupEnabled) {
        const key = String(a.levelGroupKey || "").trim();
        (a.levelGroups || []).forEach((g) => {
          const tid = g?.teacherId;
          if (!tid) return;
          const sig = key ? `L|${a.subjectId}|${key}|${tid}` : "";
          if (sig) {
            if (poolDone.has(sig)) return;
            poolDone.add(sig);
          }
          add(tid, h);
        });
        return;
      }

      // 2) Parallel dars — bitta ustoz, bitta slot, bir nechta sinf
      const pKey = String(a.groupKey || "").trim();
      if (pKey && a.teacherId) {
        const sig = `P|${a.subjectId}|${pKey}|${a.teacherId}`;
        if (parallelDone.has(sig)) return;
        parallelDone.add(sig);
        add(a.teacherId, h);
        return;
      }

      // 3) Oddiy dars
      add(a.teacherId, h);
      if (a.splitEnabled && a.teacherId2) add(a.teacherId2, h);
    });
  });

  return load;
}

export default function ClassSubjectsPage({ classes, subjects, teachers, rooms, classSubjects, setClassSubjects, toast }) {
  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id || "");
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolForm, setPoolForm] = useState({ subjectId: "", classIds: [], teacherIds: [], weeklyHours: 5 });
  // Qaysi fan qatorining ilg'or sozlamalari ochiq (subjectId)
  const [openSettings, setOpenSettings] = useState(null);
  // O'chirish tasdiq oynasi
  const [clearOpen, setClearOpen] = useState(false);
  // "Barcha sinflardan" tugmasi — ikkinchi bosishda o'chiradi (xatolik oldini olish)
  const [armAll, setArmAll] = useState(false);

  useEffect(() => {
    if (!selectedClassId && classes[0]?.id) setSelectedClassId(classes[0].id);
  }, [classes, selectedClassId]);

  const selectedClass = classes.find(c => c.id === selectedClassId);
  const assignments = classSubjects[selectedClassId] || [];

  // ——— Alifbo tartibidagi umumiy ro'yxatlar ———
  const sortedClasses = sortByName(classes);
  const sortedRooms = sortByName(rooms);
  const sortedAllSubjects = sortByName(subjects);

  // ——— Ta'lim tili: tanlangan sinf tiliga mos fanlar (alifbo bo'yicha) ———
  const classLang = classLangOf(selectedClass);
  const langSubjects = sortByName(subjects.filter(s => subjectLangOf(s) === classLang));
  // Tanlangan sinf bilan bir tildagi sinflar (parallel/hovuz/nusxalash faqat shular orasida)
  const sameLangClasses = sortByName(classes.filter(c => classLangOf(c) === classLang));

  function subjectById(id) { return subjects.find(s => s.id === id); }

  // Hovuz (daraja guruhi) tez yaratish: tanlangan sinflarga bir xil guruh biriktiriladi
  function createPool() {
    const { subjectId, classIds, teacherIds, weeklyHours } = poolForm;
    if (!subjectId) { toast?.("Fan tanlang", "warning"); return; }
    if (classIds.length < 2) { toast?.("Kamida 2 ta sinf tanlang", "warning"); return; }
    if (teacherIds.length < 1) { toast?.("Kamida 1 ta ustoz tanlang", "warning"); return; }
    const subject = subjectById(subjectId);
    const key = `${subject?.name || "Fan"} hovuz — ${[...classIds].sort().join("_")}`;
    const levelGroups = teacherIds.map((tid, i) => ({ name: `${i + 1}-daraja`, teacherId: tid, roomId: "" }));
    const next = { ...classSubjects };
    classIds.forEach((cid) => {
      const list = (next[cid] || []).filter((a) => a.subjectId !== subjectId);
      const base = makeAssignment(subject);
      next[cid] = [
        ...list,
        {
          ...base,
          subjectId,
          weeklyHours: Number(weeklyHours) || 1,
          levelGroupEnabled: true,
          levelGroupKey: key,
          levelGroupCount: levelGroups.length,
          levelGroups: levelGroups.map((g) => ({ ...g })),
          parallelEnabled: false,
          groupKey: "",
          splitEnabled: false,
          swapEnabled: false,
          teacherId: "",
        },
      ];
    });
    setClassSubjects(next);
    setPoolOpen(false);
    toast?.(`Hovuz yaratildi: ${classIds.length} sinf × ${teacherIds.length} daraja ✓`, "success");
  }

  function togglePoolClass(cid) {
    setPoolForm((p) => ({ ...p, classIds: p.classIds.includes(cid) ? p.classIds.filter((x) => x !== cid) : [...p.classIds, cid] }));
  }
  function togglePoolTeacher(tid) {
    setPoolForm((p) => ({ ...p, teacherIds: p.teacherIds.includes(tid) ? p.teacherIds.filter((x) => x !== tid) : [...p.teacherIds, tid] }));
  }
  // Fanga biriktirilgan ustozlar — alifbo bo'yicha
  function teachersForSubject(subjectId) {
    return sortByName(teachers.filter(t => teacherSubjectIds(t).includes(subjectId)));
  }
  function isChecked(subjectId) { return assignments.some(a => a.subjectId === subjectId); }
  function getAssignment(subjectId) { return assignments.find(a => a.subjectId === subjectId) || {}; }
  // "2 soat blok" faqat shu sinf fanida aniq yoqilgan bo'lsa ishlaydi.
  // Fanlar bo'limidagi umumiy sozlama bu yerga avtomatik ko'chmaydi.
  function assignmentAllowsDouble(a) { return Boolean(a?.allowDouble); }

  function sameLevelGroupAssignments(subjectId, levelGroupKey) {
    const key = String(levelGroupKey || "").trim();
    if (!subjectId || !key) return [];
    const rows = [];
    Object.entries(classSubjects || {}).forEach(([classId, list]) => {
      (list || []).forEach((a, index) => {
        if (a.subjectId === subjectId && a.levelGroupEnabled && String(a.levelGroupKey || "").trim() === key) {
          rows.push({ classId, index, assignment: a });
        }
      });
    });
    return rows;
  }

  function getSharedLevelConfig(subjectId, assignment) {
    if (!assignment?.levelGroupEnabled || !assignment?.levelGroupKey) return assignment || {};
    const rows = sameLevelGroupAssignments(subjectId, assignment.levelGroupKey);
    let best = assignment;
    rows.forEach(row => {
      const currentCount = makeLevelGroups(row.assignment.levelGroupCount || 1, row.assignment.levelGroups).length;
      const bestCount = makeLevelGroups(best.levelGroupCount || 1, best.levelGroups).length;
      if (currentCount > bestCount) best = row.assignment;
    });
    return best || assignment;
  }

  function syncSharedLevelGroups(subjectId, levelGroupKey, patch) {
    const key = String(levelGroupKey || "").trim();
    if (!subjectId || !key) return;
    const next = { ...classSubjects };
    Object.entries(next).forEach(([classId, list]) => {
      next[classId] = (list || []).map(a => {
        if (a.subjectId === subjectId && a.levelGroupEnabled && String(a.levelGroupKey || "").trim() === key) {
          return { ...a, ...patch, levelGroupKey: key };
        }
        return a;
      });
    });
    setClassSubjects(next);
  }

  function normalizeAllSharedLevelGroups(showToast = false) {
    // Har bir hovuz uchun "etalon" sozlama tanlanadi: guruhlari eng ko'p bo'lgani,
    // teng bo'lsa — soati eng kattasi.
    const canon = new Map();
    Object.entries(classSubjects || {}).forEach(([classId, list]) => {
      (list || []).forEach((a) => {
        if (!a.levelGroupEnabled || !a.levelGroupKey) return;
        const key = `${a.subjectId}__${String(a.levelGroupKey).trim()}`;
        const cfg = makeLevelGroups(a.levelGroupCount || 1, a.levelGroups);
        const cur = canon.get(key);
        const better =
          !cur ||
          cfg.length > cur.groups.length ||
          (cfg.length === cur.groups.length && Number(a.weeklyHours || 0) > Number(cur.shared.weeklyHours || 0));
        if (better) canon.set(key, { groups: cfg, shared: pickShared(a) });
      });
    });

    let changed = false;
    const next = { ...classSubjects };
    Object.entries(next).forEach(([classId, list]) => {
      next[classId] = (list || []).map(a => {
        if (!a.levelGroupEnabled || !a.levelGroupKey) return a;
        const c = canon.get(`${a.subjectId}__${String(a.levelGroupKey).trim()}`);
        if (!c) return a;
        const merged = {
          ...a,
          ...cloneShared(c.shared),
          levelGroupCount: c.groups.length,
          levelGroups: c.groups.map(g => ({ ...g })),
        };
        if (JSON.stringify(merged) !== JSON.stringify(a)) {
          changed = true;
          return merged;
        }
        return a;
      });
    });
    if (changed) {
      setClassSubjects(next);
      if (showToast) toast("Birlashtirilgan sinflar sozlamalari va soatlari tenglashtirildi ✓", "success");
    } else if (showToast) {
      toast("Guruhlar allaqachon bir xil", "success");
    }
  }

  function saveAssignments(next, targetClassId = selectedClassId) {
    setClassSubjects({ ...classSubjects, [targetClassId]: next });
  }

  function toggleSubject(subjectId) {
    if (!selectedClassId) return;
    const current = classSubjects[selectedClassId] || [];
    const subject = subjectById(subjectId);
    if (current.some(a => a.subjectId === subjectId)) {
      saveAssignments(current.filter(a => a.subjectId !== subjectId));
      if (openSettings === subjectId) setOpenSettings(null);
    } else {
      const firstTeacher = teachersForSubject(subjectId)[0];
      saveAssignments([...current, makeAssignment(subject, firstTeacher?.id || "")]);
    }
  }

  // Sozlama o'zgarganda — agar bu fan hovuzda (daraja guruhida) bo'lsa,
  // umumiy maydonlar (soat, 2 soat blok, ora kunda, asosiy fan, hafta almashinuvi...)
  // guruhdagi BARCHA sinflarga bir xil qilib yoziladi.
  function updateAssignment(subjectId, patch) {
    const current = classSubjects[selectedClassId] || [];
    const a = current.find(x => x.subjectId === subjectId);
    const oldKey = String(a?.levelGroupKey || "").trim();
    const pooled = Boolean(a?.levelGroupEnabled) && Boolean(oldKey);

    if (!pooled) {
      saveAssignments(current.map(x => x.subjectId === subjectId ? { ...x, ...patch } : x));
      return;
    }

    const renaming = Object.prototype.hasOwnProperty.call(patch, "levelGroupKey");
    const newKey = renaming ? patch.levelGroupKey : oldKey;
    const shared = pickShared(patch);

    const next = { ...classSubjects };
    Object.entries(next).forEach(([cid, list]) => {
      next[cid] = (list || []).map(x => {
        if (x.subjectId !== subjectId) return x;
        if (cid === selectedClassId) return { ...x, ...patch };
        if (x.levelGroupEnabled && String(x.levelGroupKey || "").trim() === oldKey) {
          return { ...x, ...cloneShared(shared), ...(renaming ? { levelGroupKey: newKey } : {}) };
        }
        return x;
      });
    });
    setClassSubjects(next);
  }

  function updateLevelGroup(subjectId, index, patch) {
    const a = getAssignment(subjectId);
    const shared = getSharedLevelConfig(subjectId, a);
    const groups = makeLevelGroups(shared.levelGroupCount || a.levelGroupCount || 3, shared.levelGroups || a.levelGroups);
    groups[index] = { ...groups[index], ...patch };
    if (a.levelGroupEnabled && a.levelGroupKey) {
      syncSharedLevelGroups(subjectId, a.levelGroupKey, { levelGroupCount: groups.length, levelGroups: groups.map(g => ({ ...g })) });
    } else {
      updateAssignment(subjectId, { levelGroups: groups });
    }
  }

  function changeLevelGroupCount(subjectId, count) {
    // Bo'sh qiymat (foydalanuvchi hali yozmoqda) — hech narsa qilmaymiz
    if (String(count ?? "").trim() === "") return;
    const a = getAssignment(subjectId);
    const shared = getSharedLevelConfig(subjectId, a);
    const nextGroups = makeLevelGroups(count, shared.levelGroups || a.levelGroups);
    if (a.levelGroupEnabled && a.levelGroupKey) {
      syncSharedLevelGroups(subjectId, a.levelGroupKey, { levelGroupCount: nextGroups.length, levelGroups: nextGroups.map(g => ({ ...g })) });
    } else {
      updateAssignment(subjectId, { levelGroupCount: nextGroups.length, levelGroups: nextGroups });
    }
  }

  /* ——— Sinf uchun reja: qaysi fan, necha soat ———
     O'zbek tilidagi 1-11 sinflar uchun 2025-2026 TAYANCH O'QUV REJA soatlari
     ishlatiladi. Rus sinflari va reja qamramagan holatlar uchun eski usul
     (fanning o'z haftalik soati) saqlanadi. */
  function planForClass(cls) {
    const lang = classLangOf(cls);
    const grade = getGradeFromClassName(cls?.name);

    if (lang === "uz" && grade >= 1 && grade <= 11) {
      const rows = [];
      const usedRows = new Set();
      sortByName(subjects.filter(s => subjectLangOf(s) === "uz")).forEach(s => {
        const hours = curriculumHours(s.name, grade);
        if (hours == null) return;
        const row = curriculumRowFor(s.name);
        if (usedRows.has(row.name)) return; // bir xil fanning ikkinchi varianti
        usedRows.add(row.name);
        rows.push({ subject: s, hours });
      });
      if (rows.length) {
        const missing = curriculumNamesForGrade(grade).filter(n => !usedRows.has(n));
        return { rows, missing, source: "reja" };
      }
    }

    // Zaxira usul — eski standart ro'yxatlar
    const names = namesForGrade(grade, lang);
    const rows = sortByName(subjects.filter(s => names.includes(s.name) && subjectLangOf(s) === lang))
      .map(s => ({ subject: s, hours: Math.max(1, Number(s.weeklyHours || 1)) }));
    return { rows, missing: [], source: "standart" };
  }

  function assignmentsFromPlan(rows) {
    return rows.map(({ subject, hours }) => ({
      ...makeAssignment(subject, teachersForSubject(subject.id)[0]?.id || ""),
      weeklyHours: hours,
    }));
  }

  function applySmartForSelected() {
    if (!selectedClass) return;
    const { rows, missing, source } = planForClass(selectedClass);
    if (!rows.length) {
      toast(classLang === "ru"
        ? "Avval Fanlar bo'limida ruscha standart fanlarni qo'shing"
        : "Avval Fanlar bo'limida standart fanlarni qo'shing", "warning");
      return;
    }
    const next = { ...classSubjects };
    next[selectedClassId] = assignmentsFromPlan(rows);
    setClassSubjects(next);
    setOpenSettings(null);

    const total = rows.reduce((sum, r) => sum + r.hours, 0);
    if (missing.length) {
      toast(`${selectedClass.name}: ${rows.length} fan · ${total} soat ✓ — Fanlar bo'limida yo'q: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` va yana ${missing.length - 3} ta` : ""}`, "warning");
    } else {
      toast(`${selectedClass.name}: ${rows.length} fan · ${total} soat biriktirildi ✓${source === "reja" ? " (tayanch o'quv reja)" : ""}`, "success");
    }
  }

  function applySmartForAllClasses() {
    const next = { ...classSubjects };
    let done = 0, totalHoursAll = 0;
    let missingRu = false, missingUz = false;
    const missingNames = new Set();

    classes.forEach(cls => {
      const { rows, missing } = planForClass(cls);
      if (!rows.length) {
        if (classLangOf(cls) === "ru") missingRu = true; else missingUz = true;
        return; // fanlar hali qo'shilmagan tildagi sinfga tegmaymiz
      }
      next[cls.id] = assignmentsFromPlan(rows);
      done += 1;
      totalHoursAll += rows.reduce((sum, r) => sum + r.hours, 0);
      missing.forEach(n => missingNames.add(n));
    });

    setClassSubjects(next);
    setOpenSettings(null);

    if (missingRu) toast("Rus sinflari o'tkazib yuborildi: Fanlar bo'limida ruscha standart fanlarni qo'shing", "warning");
    else if (missingUz) toast("O'zbek sinflari o'tkazib yuborildi: Fanlar bo'limida standart fanlarni qo'shing", "warning");
    else if (missingNames.size) {
      const list = [...missingNames];
      toast(`${done} ta sinfga · jami ${totalHoursAll} soat biriktirildi ✓ — Fanlar bo'limida yo'q: ${list.slice(0, 3).join(", ")}${list.length > 3 ? ` va yana ${list.length - 3} ta` : ""}`, "warning");
    } else {
      toast(`${done} ta sinfga tayanch o'quv reja bo'yicha ${totalHoursAll} soat biriktirildi ✓`, "success");
    }
  }

  function copyToAllClasses() {
    if (!assignments.length) return toast("Avval tanlangan sinfga fan biriktiring", "warning");
    const next = { ...classSubjects };
    // Faqat bir xil ta'lim tilidagi sinflarga nusxalanadi (fanlar tili mos bo'lishi uchun)
    sameLangClasses.forEach(c => { next[c.id] = assignments.map(a => ({ ...a, levelGroups: (a.levelGroups || []).map(g => ({ ...g })) })); });
    setClassSubjects(next);
    toast(`Tanlangan sozlama ${classLang === "ru" ? "barcha rus" : "barcha o'zbek"} sinflariga nusxalandi ✓`, "success");
  }

  // ——— O'CHIRISH (tasdiq bilan) ———
  function openClearDialog() {
    setArmAll(false);
    setClearOpen(true);
  }

  function closeClearDialog() {
    setArmAll(false);
    setClearOpen(false);
  }

  // Faqat tanlangan sinfning fanlarini o'chirish
  function clearSelectedClass() {
    if (!selectedClassId) return;
    const count = (classSubjects[selectedClassId] || []).length;
    if (!count) { toast("Bu sinfda o'chiriladigan fan yo'q", "warning"); return; }
    const next = { ...classSubjects };
    delete next[selectedClassId];
    setClassSubjects(next);
    setOpenSettings(null);
    closeClearDialog();
    toast(`${selectedClass?.name || "Sinf"} — ${count} ta fan o'chirildi ✓`, "success");
  }

  // Barcha sinflardagi fanlarni o'chirish (ikki bosqichli tasdiq)
  function clearAllClasses() {
    const totalSubjects = Object.values(classSubjects || {}).reduce((sum, l) => sum + (l || []).length, 0);
    if (!totalSubjects) { toast("O'chiriladigan fan yo'q", "warning"); return; }
    setClassSubjects({});
    setOpenSettings(null);
    closeClearDialog();
    toast(`Barcha sinflardan ${totalSubjects} ta fan o'chirildi ✓`, "success");
  }

  function classInLevelGroup(classId, subjectId, key) {
    const list = classSubjects[classId] || [];
    const a = list.find(x => x.subjectId === subjectId);
    return Boolean(a && a.levelGroupEnabled && String(a.levelGroupKey || "").trim() === String(key || "").trim());
  }

  // Sinfni hovuzga qo'shganda — asosiy sinfning SOATI va BARCHA sozlamalari
  // bir xil qilib ko'chiriladi.
  function toggleClassInLevelGroup(subjectId, key, groupsConfig, groupCount, classId) {
    const owner = getAssignment(subjectId);
    const next = { ...classSubjects };
    const list = next[classId] || [];
    const idx = list.findIndex(a => a.subjectId === subjectId);
    if (classInLevelGroup(classId, subjectId, key)) {
      next[classId] = list.filter(a => a.subjectId !== subjectId);
    } else {
      const subject = subjectById(subjectId);
      const base = idx >= 0 ? list[idx] : makeAssignment(subject, "");
      const updated = {
        ...base,
        ...cloneShared(pickShared(owner)),
        levelGroupEnabled: true,
        levelGroupKey: key,
        levelGroupCount: groupCount,
        levelGroups: (groupsConfig || []).map(g => ({ ...g })),
        splitEnabled: false,
        swapEnabled: false,
        parallelEnabled: false,
        groupKey: "",
      };
      next[classId] = idx >= 0 ? list.map((a, i) => i === idx ? updated : a) : [...list, updated];
    }
    setClassSubjects(next);
  }

  // ——— Parallel dars: qaysi sinflar bir ustozga, bir vaqtda ———
  function classInParallel(classId, subjectId, key) {
    const list = classSubjects[classId] || [];
    const a = list.find(x => x.subjectId === subjectId);
    return Boolean(a && a.groupKey && String(a.groupKey).trim() === String(key || "").trim());
  }

  function toggleClassInParallel(subjectId, key, teacherId, roomId, weeklyHours, classId) {
    const next = { ...classSubjects };
    const list = next[classId] || [];
    const idx = list.findIndex(a => a.subjectId === subjectId);
    if (classInParallel(classId, subjectId, key)) {
      next[classId] = list.filter(a => a.subjectId !== subjectId);
    } else {
      const subject = subjectById(subjectId);
      const base = idx >= 0 ? list[idx] : makeAssignment(subject, teacherId || "");
      const updated = {
        ...base,
        parallelEnabled: true,
        groupKey: key,
        teacherId: teacherId || base.teacherId || "",
        roomId: roomId || "",
        weeklyHours: weeklyHours || base.weeklyHours,
        levelGroupEnabled: false,
        splitEnabled: false,
        swapEnabled: false,
      };
      next[classId] = idx >= 0 ? list.map((a, i) => i === idx ? updated : a) : [...list, updated];
    }
    setClassSubjects(next);
  }

  function autoGroupSameGrade(subjectId) {
    if (!selectedClass) return;
    const subject = subjectById(subjectId);
    const owner = getAssignment(subjectId);
    const grade = getGradeFromClassName(selectedClass.name);
    const key = `${grade}-sinf ${subject?.name || "fan"} daraja guruhlari`;
    const sameGradeClasses = sameLangClasses.filter(c => getGradeFromClassName(c.name) === grade);
    const firstTeachers = teachersForSubject(subjectId).slice(0, 12);
    const defaultGroups = makeLevelGroups(Math.max(2, firstTeachers.length || 3)).map((g, i) => ({
      ...g,
      name: `${i + 1}-guruh`,
      teacherId: firstTeachers[i]?.id || "",
    }));

    const next = { ...classSubjects };
    sameGradeClasses.forEach(c => {
      const list = next[c.id] || [];
      const idx = list.findIndex(a => a.subjectId === subjectId);
      const base = idx >= 0 ? list[idx] : makeAssignment(subject, firstTeachers[0]?.id || "");
      const updated = {
        ...base,
        ...cloneShared(pickShared(owner)),
        levelGroupEnabled: true,
        levelGroupKey: key,
        levelGroupCount: defaultGroups.length,
        levelGroups: defaultGroups.map(g => ({ ...g })),
        splitEnabled: false,
        swapEnabled: false,
        parallelEnabled: false,
        groupKey: "",
      };
      next[c.id] = idx >= 0 ? list.map((a, i) => i === idx ? updated : a) : [...list, updated];
    });
    setClassSubjects(next);
    toast(`${grade}-sinf ${subject?.name || "fan"} daraja guruhlariga birlashtirildi ✓`, "success");
  }

  function autoParallelSameGrade(subjectId) {
    if (!selectedClass) return;
    const subject = subjectById(subjectId);
    const grade = getGradeFromClassName(selectedClass.name);
    const key = `${grade}-sinf ${subject?.name || "fan"} parallel dars`;
    const sameGradeClasses = sameLangClasses.filter(c => getGradeFromClassName(c.name) === grade);
    const firstTeacher = teachersForSubject(subjectId)[0];

    const next = { ...classSubjects };
    sameGradeClasses.forEach(c => {
      const list = next[c.id] || [];
      const idx = list.findIndex(a => a.subjectId === subjectId);
      const base = idx >= 0 ? list[idx] : makeAssignment(subject, firstTeacher?.id || "");
      const updated = {
        ...base,
        parallelEnabled: true,
        groupKey: key,
        levelGroupEnabled: false,
        levelGroupKey: "",
      };
      next[c.id] = idx >= 0 ? list.map((a, i) => i === idx ? updated : a) : [...list, updated];
    });
    setClassSubjects(next);
    toast(`${grade}-sinf ${subject?.name || "fan"} parallel darsga birlashtirildi ✓`, "success");
  }

  // Barcha sinflarda shu fanni "ora kunda" qilib belgilash
  function applySpacedToAllClasses(subjectId, value) {
    const next = { ...classSubjects };
    let count = 0;
    Object.entries(next).forEach(([classId, list]) => {
      next[classId] = (list || []).map(a => {
        if (a.subjectId !== subjectId) return a;
        count += 1;
        return { ...a, spacedDays: value };
      });
    });
    setClassSubjects(next);
    const subject = subjectById(subjectId);
    toast(value
      ? `${subject?.name || "Fan"} — ${count} ta sinfda "ora kunda" yoqildi ✓`
      : `${subject?.name || "Fan"} — ${count} ta sinfda "ora kunda" o'chirildi`, "success");
  }

  useEffect(() => {
    const timer = setTimeout(() => normalizeAllSharedLevelGroups(false), 0);
    return () => clearTimeout(timer);
  }, [classes.length, subjects.length]);

  const totalHours = assignments.reduce((sum, a) => sum + Number(a.weeklyHours || 0), 0);

  // Ustoz yuklamasi — alifbo tartibida, hovuz/parallel 1 marta hisoblangan holda
  const teacherHourMap = computeTeacherHours(classSubjects);
  const teacherLoads = sortByName(teachers).map(t => ({ ...t, load: teacherHourMap[t.id] || 0 }));

  // Fan qatorida ko'rinadigan "yoqilgan sozlama" chiplari
  function activeChips(a, s) {
    const chips = [];
    if (a.isCore) chips.push({ text: "⭐ Asosiy", bg: "#fef3c7", fg: "#92400e" });
    if (assignmentAllowsDouble(a)) chips.push({ text: "2 soat blok", bg: "#e0e7ff", fg: "#3730a3" });
    if (a.spacedDays) chips.push({ text: "📆 Ora kunda", bg: "#ffedd5", fg: "#9a3412" });
    if (a.groupKey && !a.levelGroupEnabled) chips.push({ text: "🔁 Parallel", bg: "#d1fae5", fg: "#065f46" });
    if (a.splitEnabled && !a.levelGroupEnabled) chips.push({ text: a.swapEnabled ? "🔄 Almashinuv" : "✂️ 2 guruh", bg: "#fce7f3", fg: "#9d174d" });
    if (a.levelGroupEnabled) chips.push({ text: "🎯 Daraja guruhi", bg: "#dbeafe", fg: "#1e40af" });
    if (a.weekAltEnabled) chips.push({ text: "⇄ Hafta almashinuvi", bg: "#ede9fe", fg: "#6d28d9" });
    return chips;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Sinf fanlari</div>
          <div className="page-subtitle">Sinfga fan, ustoz, soat, xona va daraja guruhlarini biriktiring</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={() => { setPoolForm({ subjectId: langSubjects[0]?.id || sortedAllSubjects[0]?.id || "", classIds: [], teacherIds: [], weeklyHours: 5 }); setPoolOpen(true); }} disabled={!classes.length || !subjects.length}>🏊 Hovuz (daraja guruhi)</button>
          <button className="btn btn-secondary" onClick={applySmartForSelected} disabled={!selectedClassId || !subjects.length}>⚡ Mos fanlar</button>
          <button className="btn btn-success" onClick={applySmartForAllClasses} disabled={!classes.length || !subjects.length}>⚡ Hammaga mos</button>
          <button className="btn btn-primary" onClick={copyToAllClasses} disabled={!selectedClassId || !classes.length}>↗ Nusxalash</button>
          <button
            className="btn"
            style={{ background: "#dc2626", borderColor: "#dc2626", color: "#fff" }}
            onClick={openClearDialog}
            disabled={!classes.length}
            title="Sinf fanlarini o'chirish (tasdiq so'raladi)"
          >
            🗑 Hammasini o'chirish
          </button>
        </div>
      </div>

      <div className="page-body">
        {classes.length === 0 || subjects.length === 0 ? (
          <div className="card"><div className="empty-state"><div className="empty-state-icon">📚</div><div className="empty-state-title">Ma'lumot yetarli emas</div><div className="empty-state-desc">Avval Sinflar va Fanlar bo'limidan ma'lumot qo'shing</div></div></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, height: "calc(100vh - 170px)", overflow: "hidden" }}>
            <div className="card" style={{ overflowY: "auto", minHeight: 0, height: "100%" }}><div className="card-body">
              <div style={{ fontWeight: 700, marginBottom: 12 }}>🏫 Sinflar</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sortedClasses.map(c => {
                  const count = (classSubjects[c.id] || []).length;
                  return <button key={c.id} className={`nav-item ${selectedClassId === c.id ? "active" : ""}`} style={{ background: selectedClassId === c.id ? "var(--accent-light)" : "transparent", color: selectedClassId === c.id ? "#fff" : "var(--text-secondary)" }} onClick={() => setSelectedClassId(c.id)}>
                    <span className="nav-icon">🏫</span><span className="nav-label" style={{ position: "relative", zIndex: 1 }}>{c.name}{classLangOf(c) === "ru" ? " 🇷🇺" : ""}</span><span style={{ marginLeft: "auto", position: "relative", zIndex: 1 }} className="badge badge-default">{count}</span>
                  </button>;
                })}
              </div>
              <div style={{ marginTop: 18, fontSize: 12, color: "var(--text-secondary)" }}>
                Tanlangan sinf jami: <b>{totalHours}</b> soat
              </div>
            </div></div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", minHeight: 0, height: "100%", paddingRight: 4 }}>
              <div className="alert alert-info">
                ℹ️ <b>Parallel va daraja guruhlari</b>: Jismoniy tarbiya kabi fanlarda 3-A va 3-B bir vaqtda bitta ustoz bilan o'tishi uchun "Parallel" yoqing. Ingliz tili kabi fanlarda bir nechta sinf o'quvchilari darajaga bo'linib, bir nechta ustoz parallel kirishi uchun "Daraja guruhlari"ni yoqing. Fan kunlar oralab (Du → Cho → Ju) o'tishi kerak bo'lsa "Ora kunda"ni yoqing. Har fanning ⚙️ tugmasidan qo'shimcha sozlamalarni oching.
              </div>

              <div className="card"><div className="card-body">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontWeight: 700 }}>
                    📚 {selectedClass?.name || "Sinf"} fanlari{" "}
                    <span className={`badge ${classLang === "ru" ? "badge-warning" : "badge-default"}`}>
                      {classLang === "ru" ? "🇷🇺 Rus tili" : "🇺🇿 O'zbek tili"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => normalizeAllSharedLevelGroups(true)}>🔄 Guruhlarni tenglashtirish</button>
                    <span className="badge badge-info">{assignments.length} fan · {totalHours} soat</span>
                  </div>
                </div>

                {langSubjects.length === 0 && (
                  <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                    ⚠️ {classLang === "ru"
                      ? "Ruscha fanlar hali qo'shilmagan. Fanlar bo'limida \"⚡ Standart fanlar (🇷🇺 Rus)\" tugmasini bosing."
                      : "O'zbekcha fanlar hali qo'shilmagan. Fanlar bo'limida standart fanlarni qo'shing."}
                  </div>
                )}

                {/* Ustunlar sarlavhasi — ixcham, faqat asosiy 4 ustun */}
                <div className="cs-row cs-head">
                  <div className="cs-col-check"></div>
                  <div className="cs-col-subject">Fan</div>
                  <div className="cs-col-hours">Soat</div>
                  <div className="cs-col-teacher">Ustoz</div>
                  <div className="cs-col-room">Xona</div>
                  <div className="cs-col-settings">Sozlamalar</div>
                </div>

                <div style={{ display: "flex", flexDirection: "column" }}>
                  {langSubjects.map(s => {
                    const checked = isChecked(s.id);
                    const a = getAssignment(s.id);
                    const availableTeachers = teachersForSubject(s.id);
                    const sharedLevelConfig = getSharedLevelConfig(s.id, a);
                    const levelGroups = makeLevelGroups(sharedLevelConfig.levelGroupCount || a.levelGroupCount || 3, sharedLevelConfig.levelGroups || a.levelGroups);
                    const sharedClassCount = a.levelGroupEnabled && a.levelGroupKey ? sameLevelGroupAssignments(s.id, a.levelGroupKey).length : 0;
                    const isOpen = openSettings === s.id;
                    const chips = checked ? activeChips(a, s) : [];
                    const hoursNow = Number(a.weeklyHours || s.weeklyHours || 1);
                    return (
                      <div key={s.id} className={`cs-item ${checked ? "" : "cs-item-off"} ${isOpen ? "cs-item-open" : ""}`}>
                        {/* ——— ASOSIY QATOR ——— */}
                        <div className="cs-row cs-body">
                          <div className="cs-col-check">
                            <input type="checkbox" checked={checked} onChange={() => toggleSubject(s.id)} />
                          </div>
                          <div className="cs-col-subject">
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span className="color-dot" style={{ background: s.color }} />
                              <b>{s.name}</b>
                              {chips.map((c, i) => (
                                <span key={i} className="cs-chip" style={{ background: c.bg, color: c.fg }}>{c.text}</span>
                              ))}
                              {sharedClassCount > 1 && (
                                <span className="cs-chip" style={{ background: "#ede9fe", color: "#5b21b6" }}>🔗 {sharedClassCount} sinf umumiy</span>
                              )}
                            </div>
                          </div>
                          <div className="cs-col-hours">
                            <input className="form-control" type="number" min="1" max="20" disabled={!checked}
                              value={a.weeklyHours ?? s.weeklyHours ?? 1}
                              onChange={e => updateAssignment(s.id, { weeklyHours: e.target.value })}
                              onBlur={e => {
                                const v = e.target.value;
                                if (v === "") { updateAssignment(s.id, { weeklyHours: s.weeklyHours || 1 }); return; }
                                const n = Math.max(1, Math.min(20, Number(v) || 1));
                                updateAssignment(s.id, { weeklyHours: n });
                              }} />
                          </div>
                          <div className="cs-col-teacher">
                            <select className="form-control" disabled={!checked || a.levelGroupEnabled} value={a.teacherId || ""} onChange={e => updateAssignment(s.id, { teacherId: e.target.value })}>
                              <option value="">— ustoz —</option>{availableTeachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </div>
                          <div className="cs-col-room">
                            <select className="form-control" disabled={!checked || a.levelGroupEnabled} value={a.roomId || ""} onChange={e => updateAssignment(s.id, { roomId: e.target.value })}>
                              <option value="">Xonasiz</option>{sortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                          </div>
                          <div className="cs-col-settings">
                            <button
                              className={`btn btn-sm ${isOpen ? "btn-primary" : "btn-secondary"}`}
                              disabled={!checked}
                              onClick={() => setOpenSettings(isOpen ? null : s.id)}
                              title="Qo'shimcha sozlamalar: asosiy fan, 2 soat blok, ora kunda, parallel, guruhga bo'lish, daraja guruhi"
                            >
                              ⚙️ Sozlamalar {isOpen ? "▲" : "▼"}
                            </button>
                          </div>
                        </div>

                        {/* ——— OCHILADIGAN SOZLAMALAR PANELI ——— */}
                        {checked && isOpen && (
                          <div className="cs-settings-panel">
                            {sharedClassCount > 1 && (
                              <div style={{ marginBottom: 10, background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 10, padding: 8, fontSize: 12, color: "#3730a3" }}>
                                🔗 Bu fan <b>{sharedClassCount} ta sinfga</b> umumiy (hovuz). Bu yerdagi <b>soat</b> va <b>barcha sozlamalar</b> avtomatik ravishda guruhdagi hamma sinfga bir xil yoziladi.
                              </div>
                            )}
                            {/* Tez almashtirgichlar qatori */}
                            <div className="cs-toggles">
                              <label className="cs-toggle" title="Asosiy fan — dars jadvalida yuqoriga (erta darslarga) qo'yiladi">
                                <input type="checkbox" checked={Boolean(a.isCore)} onChange={e => updateAssignment(s.id, { isCore: e.target.checked })} />
                                <span>⭐ Asosiy fan</span>
                              </label>
                              <label className="cs-toggle">
                                <input type="checkbox" checked={assignmentAllowsDouble(a)} onChange={e => updateAssignment(s.id, { allowDouble: e.target.checked })} />
                                <span>2 soat blok {assignmentAllowsDouble(a) && <em style={{ color: "var(--text-muted)", fontWeight: 400 }}>({hoursNow} soat → {Math.ceil(hoursNow / 2)} blok)</em>}</span>
                              </label>
                              <label className="cs-toggle" title="Dars kunlar oralab qo'yiladi: Dushanba → Chorshanba → Juma">
                                <input type="checkbox" checked={Boolean(a.spacedDays)} onChange={e => updateAssignment(s.id, { spacedDays: e.target.checked })} />
                                <span>📆 Ora kunda (kun oralab)</span>
                              </label>
                              <label className="cs-toggle" title="Parallel dars">
                                <input type="checkbox" disabled={a.levelGroupEnabled || a.weekAltEnabled} checked={Boolean(a.groupKey)} onChange={e => updateAssignment(s.id, { parallelEnabled: e.target.checked, weekAltEnabled: false, groupKey: e.target.checked ? (a.groupKey || `${getGradeFromClassName(selectedClass?.name)}-sinf ${s.name} parallel — ${selectedClass?.name || ""}`) : "" })} />
                                <span>🔁 Parallel dars</span>
                              </label>
                              <label className="cs-toggle" title="Sinfni 2 guruhga bo'lish">
                                <input type="checkbox" disabled={a.levelGroupEnabled || a.weekAltEnabled} checked={Boolean(a.splitEnabled)} onChange={e => updateAssignment(s.id, { splitEnabled: e.target.checked, weekAltEnabled: false })} />
                                <span>✂️ 2 guruhga bo'lish</span>
                              </label>
                              <label className="cs-toggle" title="Bir nechta sinfni daraja bo'yicha guruhlash">
                                <input type="checkbox" checked={Boolean(a.levelGroupEnabled)} onChange={e => updateAssignment(s.id, { levelGroupEnabled: e.target.checked, splitEnabled: false, weekAltEnabled: false, levelGroupKey: a.levelGroupKey || `${getGradeFromClassName(selectedClass?.name)}-sinf ${s.name} — ${selectedClass?.name || ""} guruhi` })} />
                                <span>🎯 Daraja guruhi (hovuz)</span>
                              </label>
                              <label className="cs-toggle" title="Butun sinf har hafta ikki fan o'rtasida navbatlashadi (juft/toq hafta)">
                                <input type="checkbox" disabled={a.levelGroupEnabled} checked={Boolean(a.weekAltEnabled)} onChange={e => updateAssignment(s.id, { weekAltEnabled: e.target.checked, splitEnabled: false, swapEnabled: false, parallelEnabled: false, groupKey: "", weekAltSubjectId: e.target.checked ? a.weekAltSubjectId : "", weekAltTeacherId: e.target.checked ? a.weekAltTeacherId : "" })} />
                                <span>⇄ Hafta almashinuvi (juft/toq)</span>
                              </label>
                            </div>

                            {/* Ora kunda tafsilotlari */}
                            {a.spacedDays && (
                              <div className="cs-detail" style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: "#9a3412", marginBottom: 6 }}>📆 Ora kunda (kun oralab)</div>
                                <div style={{ fontSize: 12, color: "#9a3412", lineHeight: 1.6 }}>
                                  Bu fan ketma-ket kunlarda takrorlanmaydi: <b>Dushanba → Chorshanba → Juma</b> tartibida joylashadi.
                                  {assignmentAllowsDouble(a) && <> "2 soat blok" yoqilgan — blok ichidagi 2 soat bitta kunda qoladi, oraliq bloklar orasida hisoblanadi.</>}
                                </div>
                                {hoursNow > 3 && !assignmentAllowsDouble(a) && (
                                  <div style={{ marginTop: 8, background: "#fff", border: "1px solid #fed7aa", borderRadius: 8, padding: 8, fontSize: 12, color: "#9a3412" }}>
                                    ⚠️ Haftalik soat <b>{hoursNow}</b> ta. 6 kunlik haftada to'liq oralab joylash faqat <b>3 soatgacha</b> mumkin. Generator qolgan soatlarni imkon qadar uzoq kunlarga tarqatadi.
                                  </div>
                                )}
                                <div style={{ marginTop: 8 }}>
                                  <button className="btn btn-secondary btn-sm" onClick={() => applySpacedToAllClasses(s.id, true)}>⚡ Barcha sinflarda shu fanga qo'llash</button>
                                </div>
                              </div>
                            )}

                            {/* Parallel dars tafsilotlari */}
                            {a.groupKey && !a.levelGroupEnabled && !a.splitEnabled && (
                              <div className="cs-detail" style={{ background: "#ecfdf5", border: "1px solid #a7f3d0" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: "#065f46", marginBottom: 4 }}>🔁 Parallel dars sozlamasi</div>
                                <input className="form-control" style={{ marginBottom: 8 }} placeholder="Guruh nomi, masalan: 3-sinf Jismoniy tarbiya" value={a.groupKey || ""} onChange={e => updateAssignment(s.id, { groupKey: e.target.value, parallelEnabled: Boolean(e.target.value) })} />
                                <div style={{ fontSize: 12, color: "#047857", marginBottom: 8 }}>
                                  Tanlangan sinflar <b>{teachers.find(t => t.id === a.teacherId)?.name || "ustoz tanlanmagan"}</b> bilan, bir vaqtda <b>{s.name}</b> o'qiydi. Ustoz/xona/soatni tepadagi asosiy qatordan tanlang.
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 150, overflowY: "auto" }}>
                                  {sameLangClasses.map(c => {
                                    const inGroup = classInParallel(c.id, s.id, a.groupKey);
                                    const isOwner = c.id === selectedClassId;
                                    return (
                                      <button type="button" key={c.id} disabled={isOwner}
                                        onClick={() => toggleClassInParallel(s.id, a.groupKey, a.teacherId, a.roomId, a.weeklyHours, c.id)}
                                        className={`btn btn-sm ${inGroup ? "btn-success" : "btn-secondary"}`}>
                                        {inGroup ? "✓ " : ""}{c.name}{isOwner ? " (asosiy)" : ""}
                                      </button>
                                    );
                                  })}
                                </div>
                                <div style={{ marginTop: 8 }}>
                                  <button className="btn btn-secondary btn-sm" onClick={() => autoParallelSameGrade(s.id)}>⚡ Shu sinfning barcha parallellarini birlashtirish</button>
                                </div>
                              </div>
                            )}

                            {/* 2 guruhga bo'lish / almashinuv */}
                            {a.splitEnabled && !a.levelGroupEnabled && (
                              <div className="cs-detail" style={{ background: "var(--content-bg)" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>✂️ 2 guruhga bo'lish</div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                  <input className="form-control" placeholder="1-guruh nomi" value={a.groupName1 || "1-guruh"} onChange={e => updateAssignment(s.id, { groupName1: e.target.value })} />
                                  <select className="form-control" disabled={a.swapEnabled} value={a.teacherId2 || ""} onChange={e => updateAssignment(s.id, { teacherId2: e.target.value })}>
                                    <option value="">— 2-guruh ustozi —</option>{availableTeachers.filter(t => t.id !== a.teacherId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                  </select>
                                  <select className="form-control" disabled={a.swapEnabled} value={a.roomId2 || ""} onChange={e => updateAssignment(s.id, { roomId2: e.target.value })}><option value="">2-guruh xonasi</option>{sortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                                </div>
                                <div style={{ marginTop: 10, background: "var(--card-bg)", border: "1px solid var(--card-border)", padding: 12, borderRadius: 10 }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                                    <input type="checkbox" checked={Boolean(a.swapEnabled)} onChange={e => updateAssignment(s.id, { swapEnabled: e.target.checked })} />
                                    🔄 Guruhlar har xil fan o'qiydi va keyingi soatda almashadi
                                  </label>
                                  {a.swapEnabled && (
                                    <>
                                      <div style={{ fontSize: 12, color: "var(--text-secondary)", margin: "8px 0" }}>
                                        1-guruh <b>{s.name}</b> (asosiy qatorda tanlangan ustoz/xona), 2-guruh esa quyidagi fanni o'qiydi. Keyingi soatda almashadi. <b>2-fanni alohida belgilamang</b> — soati shu yerdan olinadi.
                                      </div>
                                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 4 }}>
                                        <input className="form-control" placeholder="2-guruh nomi" value={a.groupName2 || "2-guruh"} onChange={e => updateAssignment(s.id, { groupName2: e.target.value })} />
                                        <select className="form-control" value={a.swapSubjectId || ""} onChange={e => updateAssignment(s.id, { swapSubjectId: e.target.value, swapTeacherId: "" })}>
                                          <option value="">— 2-fan —</option>
                                          {langSubjects.filter(x => x.id !== s.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                        </select>
                                        <select className="form-control" disabled={!a.swapSubjectId} value={a.swapTeacherId || ""} onChange={e => updateAssignment(s.id, { swapTeacherId: e.target.value })}>
                                          <option value="">— 2-fan ustozi —</option>
                                          {teachersForSubject(a.swapSubjectId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                        </select>
                                        <select className="form-control" value={a.swapRoomId || ""} onChange={e => updateAssignment(s.id, { swapRoomId: e.target.value })}>
                                          <option value="">2-fan xonasi: Xonasiz</option>{sortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                        </select>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Daraja guruhlari (hovuz) */}
                            {a.levelGroupEnabled && (
                              <div className="cs-detail" style={{ background: "var(--content-bg)", border: "1px solid var(--card-border)" }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                                  <div>
                                    <b>🎯 Daraja guruhlari</b>
                                    {sharedClassCount > 1 && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>Bu guruh {sharedClassCount} ta sinfga umumiy ulangan. Soat va sozlamalar bir joyda o'zgarsa, hammaga bir xil bo'ladi. Ustoz yuklamasida bu hovuz <b>1 marta</b> hisoblanadi.</div>}
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Guruhlar soni</span>
                                    <input className="form-control" style={{ width: 90 }} type="number" min="1" max="12"
                                      key={`lgc-${s.id}-${levelGroups.length}`}
                                      defaultValue={levelGroups.length}
                                      onBlur={e => changeLevelGroupCount(s.id, e.target.value)}
                                      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                                  </div>
                                </div>
                                <input className="form-control" style={{ marginBottom: 10 }} placeholder="Guruh kaliti, masalan: 5-sinf Ingliz tili" value={a.levelGroupKey || ""} onChange={e => updateAssignment(s.id, { levelGroupKey: e.target.value })} onBlur={() => normalizeAllSharedLevelGroups(false)} />
                                <div style={{ marginBottom: 12, background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 10, padding: 10 }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Qaysi sinflar shu guruhda? (tanlang)</div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 150, overflowY: "auto" }}>
                                    {sameLangClasses.map(c => {
                                      const inGroup = classInLevelGroup(c.id, s.id, a.levelGroupKey);
                                      const isOwner = c.id === selectedClassId;
                                      return (
                                        <button type="button" key={c.id} disabled={isOwner}
                                          onClick={() => toggleClassInLevelGroup(s.id, a.levelGroupKey, levelGroups, levelGroups.length, c.id)}
                                          className={`btn btn-sm ${inGroup ? "btn-primary" : "btn-secondary"}`}>
                                          {inGroup ? "✓ " : ""}{c.name}{isOwner ? " (asosiy)" : ""}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
                                    Tanlangan sinflar bir xil guruhlarga, bir xil ustozlarga, bir xil soatga va bir vaqtda biriktiriladi. Belgini olib tashlasangiz, sinf guruhdan chiqariladi.
                                  </div>
                                  <div style={{ marginTop: 8 }}>
                                    <button className="btn btn-secondary btn-sm" onClick={() => autoGroupSameGrade(s.id)}>⚡ Shu sinfning barcha parallellarini guruhlash</button>
                                  </div>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
                                  {levelGroups.map((g, i) => (
                                    <div key={i} style={{ border: "1px solid var(--card-border)", borderRadius: 10, padding: 10, background: "var(--card-bg)" }}>
                                      <input className="form-control" placeholder={`${i + 1}-guruh nomi`} value={g.name} onChange={e => updateLevelGroup(s.id, i, { name: e.target.value })} />
                                      <select className="form-control" style={{ marginTop: 8 }} value={g.teacherId || ""} onChange={e => updateLevelGroup(s.id, i, { teacherId: e.target.value })}>
                                        <option value="">— guruh ustozini tanlang —</option>
                                        {availableTeachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                      </select>
                                      <select className="form-control" style={{ marginTop: 8 }} value={g.roomId || ""} onChange={e => updateLevelGroup(s.id, i, { roomId: e.target.value })}>
                                        <option value="">Xonasiz</option>{sortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                      </select>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Hafta almashinuvi (juft/toq) — butun sinf, bo'linmaydi */}
                            {a.weekAltEnabled && (
                              <div className="cs-detail" style={{ background: "rgba(124,58,237,.06)", border: "1px solid rgba(124,58,237,.2)" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: "#6d28d9", marginBottom: 6 }}>⇄ Hafta almashinuvi (juft/toq hafta)</div>
                                <div style={{ fontSize: 12, color: "#6d28d9", marginBottom: 10 }}>
                                  Butun sinf birga o'tiradi (bo'linmaydi). Bir hafta <b>{s.name}</b>, keyingi hafta quyidagi fan. Asosiy fan ({s.name}) uchun ustoz/xona/soatni tepadagi asosiy qatordan tanlang.
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                  <div>
                                    <label className="form-label">Almashadigan fan</label>
                                    <select className="form-control" value={a.weekAltSubjectId || ""} onChange={e => updateAssignment(s.id, { weekAltSubjectId: e.target.value, weekAltTeacherId: "" })}>
                                      <option value="">— fan tanlang —</option>
                                      {langSubjects.filter(x => x.id !== s.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="form-label">Almashadigan fan ustozi</label>
                                    <select className="form-control" disabled={!a.weekAltSubjectId} value={a.weekAltTeacherId || ""} onChange={e => updateAssignment(s.id, { weekAltTeacherId: e.target.value })}>
                                      <option value="">— ustoz tanlang —</option>
                                      {teachersForSubject(a.weekAltSubjectId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                    </select>
                                  </div>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                                  <div>
                                    <label className="form-label">Almashadigan fan xonasi (ixtiyoriy)</label>
                                    <select className="form-control" value={a.weekAltRoomId || ""} onChange={e => updateAssignment(s.id, { weekAltRoomId: e.target.value })}>
                                      <option value="">Xonasiz</option>{sortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="form-label">Nechta soat navbatlanadi?</label>
                                    <input className="form-control" type="number" min="1" max={Number(a.weeklyHours || 1)}
                                      value={a.weekAltHours ?? 1}
                                      onChange={e => updateAssignment(s.id, { weekAltHours: e.target.value })}
                                      onBlur={e => {
                                        const v = e.target.value;
                                        const maxV = Math.max(1, Number(a.weeklyHours || 1));
                                        if (v === "") { updateAssignment(s.id, { weekAltHours: 1 }); return; }
                                        updateAssignment(s.id, { weekAltHours: Math.max(1, Math.min(maxV, Number(v) || 1)) });
                                      }} />
                                  </div>
                                </div>
                                {a.weekAltSubjectId && a.weekAltTeacherId && (
                                  <div style={{ marginTop: 10, background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 8, padding: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                                    {Number(a.weeklyHours || 1)} soatdan <b>{Math.max(1, Math.min(Number(a.weekAltHours || 1), Number(a.weeklyHours || 1)))}</b> soati navbatlanadi: bir hafta {s.name}, keyingi hafta <b>{subjectById(a.weekAltSubjectId)?.name}</b>. Qolgan {Math.max(0, Number(a.weeklyHours || 0) - Math.max(1, Math.min(Number(a.weekAltHours || 1), Number(a.weeklyHours || 1))))} soat oddiy {s.name}. Har ikki fan ustozi ham shu vaqtda band bo'ladi.
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div></div>

              <div className="card"><div className="card-body">
                <div style={{ fontWeight: 700, marginBottom: 4 }}>👨‍🏫 Ustoz yuklamasi</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
                  🏊 Hovuz (daraja guruhi) va 🔁 parallel darslar <b>1 marta</b> hisoblanadi — 3 ta sinf bitta hovuzda bo'lsa, ustozga 3 soat emas, <b>1 soat</b> yoziladi.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                  {teacherLoads.map(t => {
                    const max = Number(t.maxWeeklyHours || 40);
                    const over = t.load > max;
                    return <div key={t.id} style={{ border: "1px solid var(--card-border)", borderRadius: 10, padding: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{t.name}</div>
                      <div style={{ marginTop: 6 }}><span className={`badge ${over ? "badge-danger" : "badge-success"}`}>{t.load}/{max} soat</span></div>
                    </div>;
                  })}
                </div>
              </div></div>
            </div>
          </div>
        )}
      </div>

      {poolOpen && (() => {
        const poolSubject = subjectById(poolForm.subjectId);
        const poolLang = poolSubject ? subjectLangOf(poolSubject) : classLang;
        // Hovuzga faqat fan tiliga mos sinflar qo'shiladi (alifbo bo'yicha)
        const sortedC = sortByName(classes.filter(c => classLangOf(c) === poolLang));
        const subjTeachers = poolForm.subjectId
          ? sortByName(teachers.filter((t) => (Array.isArray(t.subjectIds) ? t.subjectIds : [t.subjectId]).includes(poolForm.subjectId)))
          : sortByName(teachers);
        return (
          <div onClick={() => setPoolOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card-bg,#fff)", borderRadius: 16, padding: 22, width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
              <h3 style={{ margin: "0 0 4px" }}>🏊 Hovuz (daraja guruhi) tez sozlash</h3>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                Bir nechta sinf birlashib, bir vaqtda bir necha ustoz (daraja) bilan o'qiydi. Masalan 3-A + 3-B Ingliz tili → 3 ustoz. Ustoz yuklamasiga bu hovuz 1 marta yoziladi.
              </div>

              <label className="form-label">Fan</label>
              <select className="form-control" value={poolForm.subjectId} onChange={(e) => setPoolForm({ ...poolForm, subjectId: e.target.value, classIds: [], teacherIds: [] })}>
                {sortedAllSubjects.map((s) => <option key={s.id} value={s.id}>{subjectLangOf(s) === "ru" ? "🇷🇺 " : "🇺🇿 "}{s.name}</option>)}
              </select>

              <label className="form-label" style={{ marginTop: 12, display: "block" }}>Haftalik soat</label>
              <input type="number" min="1" className="form-control" style={{ maxWidth: 120 }} value={poolForm.weeklyHours}
                onChange={(e) => setPoolForm({ ...poolForm, weeklyHours: e.target.value })}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v === "") return; // bo'sh qolsa yaratishda 1 bo'ladi
                  setPoolForm((p) => ({ ...p, weeklyHours: Math.max(1, Number(v) || 1) }));
                }} />

              <label className="form-label" style={{ marginTop: 12, display: "block" }}>Qaysi sinflar birlashadi? ({poolForm.classIds.length} tanlandi)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 130, overflowY: "auto", padding: 6, border: "1px solid var(--card-border,#e5e7eb)", borderRadius: 10 }}>
                {sortedC.length === 0 ? (
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    Bu fan tiliga ({poolLang === "ru" ? "🇷🇺 Rus" : "🇺🇿 O'zbek"}) mos sinf topilmadi
                  </span>
                ) : sortedC.map((c) => {
                  const on = poolForm.classIds.includes(c.id);
                  return <button key={c.id} type="button" onClick={() => togglePoolClass(c.id)} className={`btn btn-sm ${on ? "btn-success" : "btn-secondary"}`}>{on ? "✓ " : ""}{c.name}</button>;
                })}
              </div>

              <label className="form-label" style={{ marginTop: 12, display: "block" }}>Ustozlar (har biri — 1 daraja) ({poolForm.teacherIds.length} tanlandi)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 150, overflowY: "auto", padding: 6, border: "1px solid var(--card-border,#e5e7eb)", borderRadius: 10 }}>
                {subjTeachers.map((t) => {
                  const on = poolForm.teacherIds.includes(t.id);
                  const order = poolForm.teacherIds.indexOf(t.id);
                  return <button key={t.id} type="button" onClick={() => togglePoolTeacher(t.id)} className={`btn btn-sm ${on ? "btn-primary" : "btn-secondary"}`}>{on ? `${order + 1}-daraja: ` : ""}{t.name}</button>;
                })}
              </div>

              {poolForm.classIds.length >= 2 && poolForm.teacherIds.length >= 1 && (
                <div style={{ marginTop: 12, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 10, padding: 10, fontSize: 13, color: "#065f46" }}>
                  Natija: <b>{[...poolForm.classIds].sort((x, y) => cmpName(classes.find(c => c.id === x)?.name, classes.find(c => c.id === y)?.name)).map((id) => classes.find((c) => c.id === id)?.name).join(" + ")}</b> — {subjectById(poolForm.subjectId)?.name}, {poolForm.teacherIds.length} daraja, {poolForm.weeklyHours} soat. Ustozlar bir vaqtda o'qiydi.
                </div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
                <button className="btn btn-secondary" type="button" onClick={() => setPoolOpen(false)}>Bekor qilish</button>
                <button className="btn btn-primary" type="button" onClick={createPool}>Hovuzni yaratish</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ——— O'CHIRISH TASDIQ OYNASI ——— */}
      {clearOpen && (() => {
        const selCount = (classSubjects[selectedClassId] || []).length;
        const selHours = (classSubjects[selectedClassId] || []).reduce((sum, a) => sum + Number(a.weeklyHours || 0), 0);
        const filledClasses = Object.values(classSubjects || {}).filter(l => (l || []).length > 0).length;
        const totalSubjectRows = Object.values(classSubjects || {}).reduce((sum, l) => sum + (l || []).length, 0);
        const totalAllHours = Object.values(classSubjects || {}).reduce(
          (sum, l) => sum + (l || []).reduce((s2, a) => s2 + Number(a.weeklyHours || 0), 0), 0);
        return (
          <div onClick={closeClearDialog} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card-bg,#fff)", borderRadius: 16, padding: 22, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
              <h3 style={{ margin: "0 0 4px" }}>🗑 Fanlarni o'chirish</h3>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
                Haqiqatan ham o'chirasizmi? Bu amalni <b>ortga qaytarib bo'lmaydi</b>. Fanlar, soatlar, ustoz/xona biriktirmalari va daraja guruhlari (hovuzlar) o'chib ketadi.
              </div>

              {/* 1) Faqat tanlangan sinf */}
              <div style={{ border: "1px solid var(--card-border,#e5e7eb)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>1️⃣ Faqat shu sinfdan</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
                  <b>{selectedClass?.name || "Sinf"}</b> — {selCount} ta fan · {selHours} soat o'chiriladi. Boshqa sinflarga tegilmaydi.
                </div>
                <button
                  className="btn"
                  type="button"
                  style={{ background: "#f59e0b", borderColor: "#f59e0b", color: "#fff" }}
                  disabled={!selCount}
                  onClick={clearSelectedClass}
                >
                  🗑 {selectedClass?.name || "Sinf"} fanlarini o'chirish
                </button>
              </div>

              {/* 2) Barcha sinflar — ikki bosqichli tasdiq */}
              <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 4, color: "#991b1b" }}>2️⃣ Barcha sinflardan</div>
                <div style={{ fontSize: 13, color: "#991b1b", marginBottom: 10 }}>
                  <b>{filledClasses} ta sinf</b> · jami <b>{totalSubjectRows} ta fan</b> · {totalAllHours} soat butunlay o'chiriladi.
                </div>

                {!armAll ? (
                  <button
                    className="btn"
                    type="button"
                    style={{ background: "#dc2626", borderColor: "#dc2626", color: "#fff" }}
                    disabled={!totalSubjectRows}
                    onClick={() => setArmAll(true)}
                  >
                    🗑 Barcha sinflardan o'chirish
                  </button>
                ) : (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", marginBottom: 8 }}>
                      ⚠️ Oxirgi tasdiq: rostdan ham {filledClasses} ta sinfning barcha fanlari o'chirilsinmi?
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="btn"
                        type="button"
                        style={{ background: "#dc2626", borderColor: "#dc2626", color: "#fff" }}
                        onClick={clearAllClasses}
                      >
                        ✅ Ha, hammasini o'chir
                      </button>
                      <button className="btn btn-secondary" type="button" onClick={() => setArmAll(false)}>
                        ↩ Yo'q, bekor qilish
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
                <button className="btn btn-secondary" type="button" onClick={closeClearDialog}>Yopish</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
