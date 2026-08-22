import { useEffect, useMemo, useState } from "react";
import {
  PRIMARY_SUBJECT_NAMES, MIDDLE_SUBJECT_NAMES, HIGH_SUBJECT_NAMES,
  PRIMARY_SUBJECT_NAMES_RU, MIDDLE_SUBJECT_NAMES_RU, HIGH_SUBJECT_NAMES_RU
} from "../utils/constants";
import { sortByName, cmpName } from "../utils/sortHelpers";
import { normName, buildCurriculumIndex, hoursFromRow, namesForGrade as curriculumNamesForGrade } from "../utils/curriculum";
import { getCachedCurriculum, fetchStandardHours } from "../services/standardHoursService";
import { removeSubjectLessons, removeClassesLessons } from "../utils/scheduleCleanup";
import "../styles/cs-mobile.css";

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
  "pairEnabled",
  "pairSubjectId",
  "pairTeacherId",
  "pairRoomId",
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

// Zaxira ro'yxatlar (reja qamramagan holatlar uchun)
function fallbackNamesForGrade(grade, lang = "uz") {
  if (lang === "ru") {
    if (grade >= 1 && grade <= 4) return PRIMARY_SUBJECT_NAMES_RU;
    if (grade >= 5 && grade <= 8) return MIDDLE_SUBJECT_NAMES_RU;
    return HIGH_SUBJECT_NAMES_RU;
  }
  if (grade >= 1 && grade <= 4) return PRIMARY_SUBJECT_NAMES;
  if (grade >= 5 && grade <= 8) return MIDDLE_SUBJECT_NAMES;
  return HIGH_SUBJECT_NAMES;
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
    // Bir vaqtda 2 fan — sinf ikkiga bo'linadi, har guruh o'z fanini o'qiydi
    pairEnabled: false,
    pairSubjectId: "",
    pairTeacherId: "",
    pairRoomId: "",
    // Parallel sinflar guruhi (bo'sh — faqat shu sinf)
    pairGroupKey: "",
  };
}

// ——— BIR VAQTDA 2 FAN + PARALLEL SINFLAR ———
// `pairGroupKey` bir nechta sinfni BITTA darsga bog'laydi: 1-guruh fani,
// ustozi, xonasi va soati hamma a'zoda BIR XIL bo'ladi (parallel dars),
// 2-guruh fani esa har sinfda BOSHQA bo'lishi mumkin.
// Diqqat: pairSubjectId/pairTeacherId/pairRoomId shu ro'yxatda YO'Q —
// ular aynan sinfga xos.
const PAIR_SHARED_FIELDS = [
  "weeklyHours",
  "teacherId",
  "roomId",
  "groupName1",
  "groupName2",
  "allowDouble",
  "isCore",
  "spacedDays",
];

function pickPairShared(obj = {}) {
  const out = {};
  PAIR_SHARED_FIELDS.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  });
  return out;
}

// Nechta sinf bitta guruhga kira oladi (joriy sinf + shuncha)
const PAIR_MAX_EXTRA = 2;

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

      // 3) Bir vaqtda 2 fan + parallel sinflar: 1-guruh ustozi hamma
      //    sinfga BIR VAQTDA kiradi — guruh bo'yicha 1 marta hisoblanadi.
      //    2-guruh ustozi esa har sinfda alohida (fani ham boshqa).
      const pairKey = a.pairEnabled ? String(a.pairGroupKey || "").trim() : "";
      if (pairKey) {
        const sig = `PP|${a.subjectId}|${pairKey}|${a.teacherId}`;
        if (a.teacherId && !parallelDone.has(sig)) {
          parallelDone.add(sig);
          add(a.teacherId, h);
        }
        if (a.pairTeacherId) add(a.pairTeacherId, h);
        return;
      }

      // 4) Oddiy dars
      add(a.teacherId, h);
      if (a.splitEnabled && a.teacherId2) add(a.teacherId2, h);
      // Bir vaqtda 2 fan — 2-fan ustozi ham aynan shu soatlarda band bo'ladi
      if (a.pairEnabled && a.pairTeacherId) add(a.pairTeacherId, h);
    });
  });

  return load;
}

export default function ClassSubjectsPage({ classes, subjects, teachers, rooms, classSubjects, setClassSubjects, schedule, setSchedule, toast }) {
  // Superadmin belgilagan standart soatlar (bulutdan; kelmasa — ichki reja)
  const [curriculum, setCurriculum] = useState(() => getCachedCurriculum());
  useEffect(() => {
    let alive = true;
    fetchStandardHours().then((res) => { if (alive && res?.data) setCurriculum(res.data); });
    return () => { alive = false; };
  }, []);
  const curriculumIndex = useMemo(() => ({
    uz: buildCurriculumIndex(curriculum.uz),
    ru: buildCurriculumIndex(curriculum.ru),
  }), [curriculum]);
  function curriculumRowFor(subjectName, lang) {
    return curriculumIndex[lang]?.get(normName(subjectName)) || null;
  }
  function curriculumHours(subjectName, grade, lang) {
    return hoursFromRow(curriculumRowFor(subjectName, lang), grade);
  }

  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id || "");
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolForm, setPoolForm] = useState({ subjectId: "", classIds: [], teacherIds: [], weeklyHours: 5 });
  // Qaysi fan qatorining ilg'or sozlamalari ochiq (subjectId)
  const [openSettings, setOpenSettings] = useState(null);
  // O'chirish tasdiq oynasi
  const [clearOpen, setClearOpen] = useState(false);
  // "Barcha sinflardan" tugmasi — ikkinchi bosishda o'chiradi (xatolik oldini olish)
  const [armAll, setArmAll] = useState(false);
  // "Standart soatlar" tasdiq oynasi (mavjud biriktirmalar almashadi — tasodifan bosilmasin)
  const [smartAllOpen, setSmartAllOpen] = useState(false);

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

  // ——— "Yetim" biriktirmalar ———
  // Fan "Fanlar" ro'yxatidan o'chirilgan, lekin classSubjects ichida yozuvi qolib ketgan.
  // Bunday yozuv shu sahifada KO'RINMAYDI (ro'yxat fanlar bo'yicha chiziladi), lekin
  // generator va "Vakant tahlili" uni hisoblab, "Noma'lum fan" nomi bilan soxta
  // vakant soat sifatida ko'rsatadi.
  const knownSubjectIds = new Set(subjects.map(s => s.id));
  const orphanInfo = (() => {
    let entries = 0, hours = 0;
    const classNames = [];
    for (const c of classes) {
      const list = Array.isArray(classSubjects[c.id]) ? classSubjects[c.id] : [];
      let n = 0;
      for (const a of list) {
        if (!a || !a.subjectId) continue;
        if (knownSubjectIds.has(a.subjectId)) continue;
        n += 1; hours += Number(a.weeklyHours || 0);
      }
      if (n) { entries += n; classNames.push(c.name || "?"); }
    }
    return { entries, hours, classNames };
  })();

  function cleanOrphanAssignments() {
    const next = {};
    for (const [clsId, list] of Object.entries(classSubjects || {})) {
      if (!Array.isArray(list)) continue;
      next[clsId] = list.filter(a => a && a.subjectId && knownSubjectIds.has(a.subjectId));
    }
    setClassSubjects(next);
    toast?.(`${orphanInfo.entries} ta yetim biriktirma tozalandi (${orphanInfo.hours} soat)`, "success");
  }

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
      // Fan ro'yxatdan chiqsa — jadvalda qolgan darslari ham ketishi kerak.
      // Aks holda o'chirilgan fan dars jadvalida "arvoh" bo'lib turaverardi.
      const cleaned = setSchedule ? removeSubjectLessons(schedule, selectedClassId, subjectId) : null;
      if (cleaned?.removed) {
        const name = subject?.name || "Fan";
        const msg = `"${name}" dars jadvalida ${cleaned.removed} ta darsda turibdi.
Fan bilan birga ular ham o'chsinmi?`;
        if (!confirm(msg)) return;
        setSchedule(cleaned.schedule);
      }
      saveAssignments(current.filter(a => a.subjectId !== subjectId));
      if (openSettings === subjectId) setOpenSettings(null);
      if (cleaned?.removed) toast?.(`Jadvaldan ${cleaned.removed} ta dars olib tashlandi`, "success");
    } else {
      // Ustoz avtomatik tanlanmaydi — foydalanuvchi o'zi tanlaydi
      saveAssignments([...current, makeAssignment(subject)]);
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
      // ——— Boshqa rejimga o'tilganda parallel guruh UZILADI ———
      // "Parallel dars", "2 guruhga bo'lish", "Daraja guruhi", "Hafta
      // almashinuvi" tugmalari pairEnabled: false yuboradi. Bog'langan
      // sinflar ham guruhdan chiqarilmasa — ular yolg'iz qolib, jadvalda
      // egasiz "2-guruh" darslari paydo bo'lardi.
      const dropKey = patch.pairEnabled === false ? String(a?.pairGroupKey || "").trim() : "";
      if (dropKey) {
        const cleared = { pairEnabled: false, pairGroupKey: "", pairSubjectId: "", pairTeacherId: "", pairRoomId: "" };
        const next = { ...classSubjects };
        Object.entries(next).forEach(([cid, list]) => {
          next[cid] = (list || []).map(x => {
            if (x.subjectId !== subjectId) return x;
            if (cid === selectedClassId) return { ...x, ...patch, ...cleared };
            if (x.pairEnabled && String(x.pairGroupKey || "").trim() === dropKey) return { ...x, ...cleared };
            return x;
          });
        });
        setClassSubjects(next);
        return;
      }

      // ——— Bir vaqtda 2 fan: parallel sinflar bilan bog'langan bo'lsa ———
      // 1-guruhga tegishli maydonlar (soat, ustoz, xona, guruh nomlari,
      // 2 soat blok, asosiy fan, ora kunda) guruhdagi hamma sinfga yoziladi.
      const linkKey = a?.pairEnabled ? String(a.pairGroupKey || "").trim() : "";
      const shared = linkKey ? pickPairShared(patch) : null;
      if (shared && Object.keys(shared).length) {
        const next = { ...classSubjects };
        Object.entries(next).forEach(([cid, list]) => {
          next[cid] = (list || []).map(x => {
            if (x.subjectId !== subjectId) return x;
            if (cid === selectedClassId) return { ...x, ...patch };
            if (x.pairEnabled && String(x.pairGroupKey || "").trim() === linkKey) {
              return { ...x, ...shared };
            }
            return x;
          });
        });
        setClassSubjects(next);
        return;
      }
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

  // ═══ BIR VAQTDA 2 FAN — PARALLEL SINFLAR ═══

  // Shu fan bo'yicha guruhga kirgan BOSHQA sinflar (alifbo tartibida)
  function pairMemberRows(subjectId, pairGroupKey) {
    const key = String(pairGroupKey || "").trim();
    if (!subjectId || !key) return [];
    const rows = [];
    sortedClasses.forEach((c) => {
      if (c.id === selectedClassId) return;
      const found = (classSubjects[c.id] || []).find(
        x => x.subjectId === subjectId && x.pairEnabled && String(x.pairGroupKey || "").trim() === key
      );
      if (found) rows.push({ cls: c, a: found });
    });
    return rows;
  }

  // "🧩 Bir vaqtda 2 fan" tugmasi. O'chirilganda bog'langan sinflar ham
  // guruhdan chiqadi — aks holda ular yolg'iz qolib, jadvalni buzardi.
  function togglePairMode(subjectId, on) {
    const a = getAssignment(subjectId);
    updateAssignment(subjectId, {
      pairEnabled: on,
      // Bir vaqtda 2 fan boshqa rejimlar bilan birga ishlamaydi
      splitEnabled: false,
      swapEnabled: false,
      weekAltEnabled: false,
      levelGroupEnabled: false,
      parallelEnabled: false,
      groupKey: "",
      pairSubjectId: on ? (a.pairSubjectId || "") : "",
      pairTeacherId: on ? (a.pairTeacherId || "") : "",
      pairRoomId: on ? (a.pairRoomId || "") : "",
      pairGroupKey: on ? String(a.pairGroupKey || "").trim() : "",
    });
  }

  // Guruhga yangi sinf qo'shish: 1-guruh sozlamalari nusxalanadi,
  // 2-guruh fanini foydalanuvchi o'zi tanlaydi.
  function addPairClass(subjectId, classId) {
    if (!classId) return;
    const current = classSubjects[selectedClassId] || [];
    const a = current.find(x => x.subjectId === subjectId);
    if (!a) return;
    const subject = subjectById(subjectId);
    const key = String(a.pairGroupKey || "").trim()
      || `${subject?.name || "Fan"} juftligi — ${selectedClass?.name || ""}`;

    const next = { ...classSubjects };
    next[selectedClassId] = current.map(x => x.subjectId === subjectId ? { ...x, pairGroupKey: key } : x);

    const list = next[classId] || [];
    const exist = list.find(x => x.subjectId === subjectId);
    const linked = {
      ...(exist || makeAssignment(subject)),
      subjectId,
      pairEnabled: true,
      pairGroupKey: key,
      // 1-guruh — guruhda umumiy
      weeklyHours: Number(a.weeklyHours || 1),
      teacherId: a.teacherId || "",
      roomId: a.roomId || "",
      groupName1: a.groupName1 || "1-guruh",
      groupName2: a.groupName2 || "2-guruh",
      allowDouble: Boolean(a.allowDouble),
      isCore: Boolean(a.isCore),
      spacedDays: Boolean(a.spacedDays),
      // Boshqa rejimlar o'chadi
      splitEnabled: false,
      swapEnabled: false,
      weekAltEnabled: false,
      levelGroupEnabled: false,
      parallelEnabled: false,
      groupKey: "",
      // 2-guruh — shu sinfning O'Z fani
      pairSubjectId: exist?.pairSubjectId || "",
      pairTeacherId: exist?.pairTeacherId || "",
      pairRoomId: exist?.pairRoomId || "",
    };
    next[classId] = exist
      ? list.map(x => x.subjectId === subjectId ? linked : x)
      : [...list, linked];
    setClassSubjects(next);
    toast?.(`${classes.find(c => c.id === classId)?.name || "Sinf"} guruhga qo'shildi — 2-guruh fanini tanlang`, "success");
  }

  // Sinfni guruhdan chiqarish. Fan sinfda QOLADI (oddiy dars bo'lib),
  // faqat parallel bog'lanish uziladi.
  function removePairClass(subjectId, classId, pairGroupKey) {
    const key = String(pairGroupKey || "").trim();
    const next = { ...classSubjects };
    next[classId] = (next[classId] || []).map(x => (
      x.subjectId === subjectId
        ? { ...x, pairEnabled: false, pairGroupKey: "", pairSubjectId: "", pairTeacherId: "", pairRoomId: "" }
        : x
    ));
    // Guruhda boshqa sinf qolmasa — joriy sinfning kaliti ham tozalanadi
    const left = Object.entries(next).filter(([cid, list]) => cid !== selectedClassId
      && (list || []).some(x => x.subjectId === subjectId && x.pairEnabled && String(x.pairGroupKey || "").trim() === key));
    if (!left.length) {
      next[selectedClassId] = (next[selectedClassId] || []).map(x => (
        x.subjectId === subjectId ? { ...x, pairGroupKey: "" } : x
      ));
    }
    setClassSubjects(next);
  }

  // Guruhdagi boshqa sinfning 2-guruh sozlamasini o'zgartirish
  function updatePairMember(subjectId, classId, patch) {
    const next = { ...classSubjects };
    next[classId] = (next[classId] || []).map(x => x.subjectId === subjectId ? { ...x, ...patch } : x);
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
     Soatlar superadminning 'Standart soatlar' sahifasidan keladi (bulut);
     bulut ochilmasa — kesh, u ham bo'lmasa ichki 2025-2026 TAYANCH O'QUV REJA.
     Reja qamramagan holatlarda eski usul (fanning o'z haftalik soati). */
  function planForClass(cls) {
    const lang = classLangOf(cls);
    const grade = getGradeFromClassName(cls?.name);

    if (grade >= 1 && grade <= 11 && (curriculum[lang] || []).length) {
      const rows = [];
      const usedRows = new Set();
      sortByName(subjects.filter(s => subjectLangOf(s) === lang)).forEach(s => {
        const hours = curriculumHours(s.name, grade, lang);
        if (hours == null) return;
        const row = curriculumRowFor(s.name, lang);
        if (usedRows.has(row.name)) return; // bir xil fanning ikkinchi varianti
        usedRows.add(row.name);
        rows.push({ subject: s, hours });
      });
      if (rows.length) {
        const missing = curriculumNamesForGrade(curriculum[lang], grade).filter(n => !usedRows.has(n));
        return { rows, missing, source: "reja" };
      }
    }

    // Zaxira usul — eski standart ro'yxatlar
    const names = fallbackNamesForGrade(grade, lang);
    const rows = sortByName(subjects.filter(s => names.includes(s.name) && subjectLangOf(s) === lang))
      .map(s => ({ subject: s, hours: Math.max(1, Number(s.weeklyHours || 1)) }));
    return { rows, missing: [], source: "standart" };
  }

  function assignmentsFromPlan(rows) {
    return rows.map(({ subject, hours }) => ({
      ...makeAssignment(subject), // ustoz bo'sh — o'zingiz tanlaysiz
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
    setSmartAllOpen(false);
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
    // Fanlar bilan birga shu sinfning jadvaldagi darslari ham ketadi
    const cleaned = setSchedule ? removeClassesLessons(schedule, [selectedClassId]) : null;
    if (cleaned?.removed) setSchedule(cleaned.schedule);
    setOpenSettings(null);
    closeClearDialog();
    const tail = cleaned?.removed ? ` (jadvaldan ${cleaned.removed} ta dars olindi)` : "";
    toast(`${selectedClass?.name || "Sinf"} — ${count} ta fan o'chirildi ✓${tail}`, "success");
  }

  // Barcha sinflardagi fanlarni o'chirish (ikki bosqichli tasdiq)
  function clearAllClasses() {
    const totalSubjects = Object.values(classSubjects || {}).reduce((sum, l) => sum + (l || []).length, 0);
    if (!totalSubjects) { toast("O'chiriladigan fan yo'q", "warning"); return; }
    const affected = Object.keys(classSubjects || {});
    setClassSubjects({});
    // Fanlarsiz jadval ma'nosini yo'qotadi — darslar ham tozalanadi
    const cleaned = setSchedule ? removeClassesLessons(schedule, affected) : null;
    if (cleaned?.removed) setSchedule(cleaned.schedule);
    setOpenSettings(null);
    closeClearDialog();
    const tail = cleaned?.removed ? ` (jadvaldan ${cleaned.removed} ta dars olindi)` : "";
    toast(`Barcha sinflardan ${totalSubjects} ta fan o'chirildi ✓${tail}`, "success");
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
      const base = idx >= 0 ? list[idx] : makeAssignment(subject);
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
        // "Bir vaqtda 2 fan" daraja guruhi bilan birga ishlamaydi
        pairEnabled: false,
        pairGroupKey: "",
        pairSubjectId: "",
        pairTeacherId: "",
        pairRoomId: "",
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
    // Parallel darsda bitta ustoz — asosiy sinfda tanlangan ustoz olinadi
    const ownerTeacherId = getAssignment(subjectId).teacherId || "";

    const next = { ...classSubjects };
    sameGradeClasses.forEach(c => {
      const list = next[c.id] || [];
      const idx = list.findIndex(a => a.subjectId === subjectId);
      const base = idx >= 0 ? list[idx] : makeAssignment(subject, ownerTeacherId);
      const updated = {
        ...base,
        parallelEnabled: true,
        groupKey: key,
        levelGroupEnabled: false,
        levelGroupKey: "",
        // "Bir vaqtda 2 fan" oddiy parallel dars bilan birga ishlamaydi
        pairEnabled: false,
        pairGroupKey: "",
        pairSubjectId: "",
        pairTeacherId: "",
        pairRoomId: "",
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
    if (a.pairEnabled) {
      const pairName = subjects.find((x) => x.id === a.pairSubjectId)?.name;
      chips.push({
        text: pairName ? `🧩 + ${pairName}` : "🧩 2 fan (fan tanlanmagan)",
        bg: "#e0e7ff", fg: "#4338ca",
      });
    }
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
          <button className="btn btn-success" onClick={() => setSmartAllOpen(true)} disabled={!classes.length || !subjects.length} title="Barcha sinflarga tayanch o'quv reja soatlarini qo'llash (tasdiq so'raladi)">⚡ Standart soatlar</button>
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
          <div className="cs-layout">
            <div className="card cs-classes-panel"><div className="card-body">
              <div className="cs-classes-title">🏫 Sinflar</div>
              <div className="cs-classes-list">
                {sortedClasses.map(c => {
                  const count = (classSubjects[c.id] || []).length;
                  return <button key={c.id} className={`cs-class-btn ${selectedClassId === c.id ? "active" : ""}`} onClick={() => setSelectedClassId(c.id)}>
                    <span className="cs-class-ic">🏫</span>
                    <span className="cs-class-name">{c.name}{classLangOf(c) === "ru" ? " 🇷🇺" : ""}</span>
                    <span className="cs-class-count">{count}</span>
                  </button>;
                })}
              </div>
              <div className="cs-classes-total">
                Tanlangan sinf jami: <b>{totalHours}</b> soat
              </div>
            </div></div>

            <div className="cs-main-panel">
              <div className="alert alert-info">
                ℹ️ <b>Parallel va daraja guruhlari</b>: Jismoniy tarbiya kabi fanlarda 3-A va 3-B bir vaqtda bitta ustoz bilan o'tishi uchun "Parallel" yoqing. Ingliz tili kabi fanlarda bir nechta sinf o'quvchilari darajaga bo'linib, bir nechta ustoz parallel kirishi uchun "Daraja guruhlari"ni yoqing. Fan kunlar oralab (Du → Cho → Ju) o'tishi kerak bo'lsa "Ora kunda"ni yoqing. Har fanning ⚙️ tugmasidan qo'shimcha sozlamalarni oching.
              </div>

              <div className="card"><div className="card-body">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
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

                {orphanInfo.entries > 0 && (
                  <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                    <div style={{ marginBottom: 8 }}>
                      ⚠️ <b>{orphanInfo.entries} ta biriktirma o'chirilgan fanga tegishli</b> ({orphanInfo.hours} soat).
                      Bu yozuvlar ro'yxatda ko'rinmaydi, lekin tahlilda «Noma'lum fan» bo'lib vakant soat sifatida chiqadi.
                      <div style={{ fontSize: 12, opacity: .85, marginTop: 4 }}>
                        Sinflar: {orphanInfo.classNames.join(", ")}
                      </div>
                    </div>
                    <button className="btn btn-danger btn-sm" onClick={cleanOrphanAssignments}>🧹 Tozalash</button>
                  </div>
                )}

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
                    // 2 guruhga bo'lish yoqilganda ustoz/xona asosiy qatorda emas,
                    // pastdagi guruh kartalarida tanlanadi — tepada faqat "—" turadi.
                    const splitMode = checked && Boolean(a.splitEnabled) && !a.levelGroupEnabled;
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
                            {splitMode ? (
                              <div className="cs-dash-box" title="Ustoz har bir guruh uchun pastdagi «✂️ 2 guruhga bo'lish» blokidan tanlanadi">—</div>
                            ) : (
                              <select className="form-control" disabled={!checked || a.levelGroupEnabled} value={a.teacherId || ""} onChange={e => updateAssignment(s.id, { teacherId: e.target.value })}>
                                <option value="">— ustoz —</option>{availableTeachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                            )}
                          </div>
                          <div className="cs-col-room">
                            {splitMode ? (
                              <div className="cs-dash-box" title="Xona har bir guruh uchun pastdagi «✂️ 2 guruhga bo'lish» blokidan tanlanadi">—</div>
                            ) : (
                              <select className="form-control" disabled={!checked || a.levelGroupEnabled} value={a.roomId || ""} onChange={e => updateAssignment(s.id, { roomId: e.target.value })}>
                                <option value="">Xonasiz</option>{sortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                              </select>
                            )}
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
                                <input type="checkbox" disabled={a.levelGroupEnabled || a.weekAltEnabled || a.pairEnabled} checked={Boolean(a.groupKey)} onChange={e => updateAssignment(s.id, { parallelEnabled: e.target.checked, weekAltEnabled: false, pairEnabled: false, groupKey: e.target.checked ? (a.groupKey || `${getGradeFromClassName(selectedClass?.name)}-sinf ${s.name} parallel — ${selectedClass?.name || ""}`) : "" })} />
                                <span>🔁 Parallel dars</span>
                              </label>
                              <label className="cs-toggle" title="Sinfni 2 guruhga bo'lish">
                                <input type="checkbox" disabled={a.levelGroupEnabled || a.weekAltEnabled || a.pairEnabled} checked={Boolean(a.splitEnabled)} onChange={e => updateAssignment(s.id, { splitEnabled: e.target.checked, weekAltEnabled: false, pairEnabled: false })} />
                                <span>✂️ 2 guruhga bo'lish</span>
                              </label>
                              <label className="cs-toggle" title="Bir nechta sinfni daraja bo'yicha guruhlash">
                                <input type="checkbox" checked={Boolean(a.levelGroupEnabled)} onChange={e => updateAssignment(s.id, { levelGroupEnabled: e.target.checked, splitEnabled: false, weekAltEnabled: false, pairEnabled: false, levelGroupKey: a.levelGroupKey || `${getGradeFromClassName(selectedClass?.name)}-sinf ${s.name} — ${selectedClass?.name || ""} guruhi` })} />
                                <span>🎯 Daraja guruhi (hovuz)</span>
                              </label>
                              <label className="cs-toggle" title="Sinf ikkiga bo'linadi va bir vaqtning o'zida ikki xil fan o'tadi (masalan: Ona tili + Rus tili)">
                                <input
                                  type="checkbox"
                                  disabled={a.levelGroupEnabled || a.weekAltEnabled || a.splitEnabled}
                                  checked={Boolean(a.pairEnabled)}
                                  onChange={e => togglePairMode(s.id, e.target.checked)}
                                />
                                <span>🧩 Bir vaqtda 2 fan</span>
                              </label>
                              <label className="cs-toggle" title="Butun sinf har hafta ikki fan o'rtasida navbatlashadi (juft/toq hafta)">
                                <input type="checkbox" disabled={a.levelGroupEnabled || a.pairEnabled} checked={Boolean(a.weekAltEnabled)} onChange={e => updateAssignment(s.id, { weekAltEnabled: e.target.checked, splitEnabled: false, swapEnabled: false, parallelEnabled: false, pairEnabled: false, groupKey: "", weekAltSubjectId: e.target.checked ? a.weekAltSubjectId : "", weekAltTeacherId: e.target.checked ? a.weekAltTeacherId : "" })} />
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
                                <div className="cs-split-groups">
                                  {/* ——— 1-guruh ——— */}
                                  <div className="cs-split-card cs-split-card-1">
                                    <div className="cs-split-head"><span className="cs-split-num">1</span> 1-guruh</div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">Guruh nomi</span>
                                      <input className="form-control" placeholder="1-guruh" value={a.groupName1 || "1-guruh"} onChange={e => updateAssignment(s.id, { groupName1: e.target.value })} />
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">👨‍🏫 Ustoz</span>
                                      <select className="form-control" value={a.teacherId || ""} onChange={e => updateAssignment(s.id, { teacherId: e.target.value })}>
                                        <option value="">— 1-guruh ustozi —</option>{availableTeachers.filter(t => t.id !== a.teacherId2).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                      </select>
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">🚪 Xona</span>
                                      <select className="form-control" value={a.roomId || ""} onChange={e => updateAssignment(s.id, { roomId: e.target.value })}>
                                        <option value="">Xonasiz</option>{sortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                      </select>
                                    </div>
                                  </div>

                                  {/* ——— 2-guruh ——— */}
                                  <div className="cs-split-card cs-split-card-2">
                                    <div className="cs-split-head"><span className="cs-split-num">2</span> 2-guruh</div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">Guruh nomi</span>
                                      <input className="form-control" placeholder="2-guruh" value={a.groupName2 || "2-guruh"} onChange={e => updateAssignment(s.id, { groupName2: e.target.value })} />
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">👨‍🏫 Ustoz</span>
                                      <select className="form-control" disabled={a.swapEnabled} value={a.teacherId2 || ""} onChange={e => updateAssignment(s.id, { teacherId2: e.target.value })}>
                                        <option value="">— 2-guruh ustozi —</option>{availableTeachers.filter(t => t.id !== a.teacherId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                      </select>
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">🚪 Xona</span>
                                      <select className="form-control" disabled={a.swapEnabled} value={a.roomId2 || ""} onChange={e => updateAssignment(s.id, { roomId2: e.target.value })}>
                                        <option value="">Xonasiz</option>{sortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                      </select>
                                    </div>
                                    {a.swapEnabled && (
                                      <div className="cs-split-note">🔄 Almashinuv yoqilgan — 2-guruh ustozi va xonasi quyidagi «2-fan» sozlamasidan olinadi.</div>
                                    )}
                                  </div>
                                </div>
                                <div style={{ marginTop: 10, background: "var(--card-bg)", border: "1px solid var(--card-border)", padding: 12, borderRadius: 10 }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                                    <input type="checkbox" checked={Boolean(a.swapEnabled)} onChange={e => updateAssignment(s.id, { swapEnabled: e.target.checked })} />
                                    🔄 Guruhlar har xil fan o'qiydi va keyingi soatda almashadi
                                  </label>
                                  {a.swapEnabled && (
                                    <>
                                      <div style={{ fontSize: 12, color: "var(--text-secondary)", margin: "8px 0" }}>
                                        1-guruh <b>{s.name}</b> (yuqoridagi 1-guruh kartasidagi ustoz/xona bilan), 2-guruh esa quyidagi fanni o'qiydi. Keyingi soatda almashadi. <b>2-fanni alohida belgilamang</b> — soati shu yerdan olinadi.
                                      </div>
                                      <div className="cs-grid-3" style={{ marginTop: 4 }}>
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

                            {/* ——— BIR VAQTDA 2 FAN ———
                                Sinf ikkiga bo'linadi: 1-guruh shu fanni,
                                2-guruh boshqa fanni AYNI PAYTDA o'qiydi.
                                Almashinuv yo'q — har guruh o'z fanida qoladi. */}
                            {a.pairEnabled && (
                              <div className="cs-detail cs-pair-detail">
                                <div className="cs-pair-top">
                                  <div>
                                    <div className="cs-pair-title">🧩 Bir vaqtda 2 fan</div>
                                    <div className="cs-pair-desc">
                                      Sinf ikkiga bo'linadi va <b>ayni bir soatda</b> ikki xil fan o'tadi:
                                      1-guruh <b>{s.name}</b>, 2-guruh esa quyida tanlangan fanni o'qiydi.
                                      Guruhlar almashmaydi, ikkala ustoz ham shu soatda band bo'ladi.
                                    </div>
                                  </div>
                                  <div className="cs-pair-badges">
                                    {(() => {
                                      const n = pairMemberRows(s.id, a.pairGroupKey).length;
                                      if (!n) return null;
                                      return <div className="cs-pair-badge cs-pair-badge-link">🔗 {n + 1} sinf parallel</div>;
                                    })()}
                                    <div className="cs-pair-badge">haftada {hoursNow} soat</div>
                                  </div>
                                </div>

                                {/* Ko'rgazmali sxema — jadvalda qanday ko'rinishi */}
                                <div className="cs-pair-preview">
                                  <div className="cs-pair-slot">🕘 bitta soat</div>
                                  <div className="cs-pair-mini cs-pair-mini-1">
                                    <span>{a.groupName1 || "1-guruh"}</span>
                                    <b>{s.name}</b>
                                    <em>{teachers.find(t => t.id === a.teacherId)?.name || "ustoz tanlanmagan"}</em>
                                  </div>
                                  <div className="cs-pair-plus">+</div>
                                  <div className="cs-pair-mini cs-pair-mini-2">
                                    <span>{a.groupName2 || "2-guruh"}</span>
                                    <b>{subjects.find(x => x.id === a.pairSubjectId)?.name || "2-fan tanlanmagan"}</b>
                                    <em>{teachers.find(t => t.id === a.pairTeacherId)?.name || "ustoz tanlanmagan"}</em>
                                  </div>
                                </div>

                                <div className="cs-split-groups" style={{ marginTop: 12 }}>
                                  {/* ——— 1-guruh ——— */}
                                  <div className="cs-split-card cs-split-card-1">
                                    <div className="cs-split-head"><span className="cs-split-num">1</span> {s.name}</div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">Guruh nomi</span>
                                      <input className="form-control" placeholder="1-guruh" value={a.groupName1 || "1-guruh"} onChange={e => updateAssignment(s.id, { groupName1: e.target.value })} />
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">👨‍🏫 Ustoz</span>
                                      <select className="form-control" value={a.teacherId || ""} onChange={e => updateAssignment(s.id, { teacherId: e.target.value })}>
                                        <option value="">— {s.name} ustozi —</option>
                                        {(() => {
                                          const busy = new Set([a.pairTeacherId, ...pairMemberRows(s.id, a.pairGroupKey).map(m => m.a.pairTeacherId)].filter(Boolean));
                                          return availableTeachers.filter(t => !busy.has(t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>);
                                        })()}
                                      </select>
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">🚪 Xona</span>
                                      <select className="form-control" value={a.roomId || ""} onChange={e => updateAssignment(s.id, { roomId: e.target.value })}>
                                        <option value="">Xonasiz</option>
                                        {(() => {
                                          const busy = new Set([a.pairRoomId, ...pairMemberRows(s.id, a.pairGroupKey).map(m => m.a.pairRoomId)].filter(Boolean));
                                          return sortedRooms.filter(r => !busy.has(r.id)).map(r => <option key={r.id} value={r.id}>{r.name}</option>);
                                        })()}
                                      </select>
                                    </div>
                                  </div>

                                  {/* ——— 2-guruh ——— */}
                                  <div className="cs-split-card cs-split-card-2">
                                    <div className="cs-split-head">
                                      <span className="cs-split-num">2</span>
                                      {subjects.find(x => x.id === a.pairSubjectId)?.name || "2-fan"}
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">Guruh nomi</span>
                                      <input className="form-control" placeholder="2-guruh" value={a.groupName2 || "2-guruh"} onChange={e => updateAssignment(s.id, { groupName2: e.target.value })} />
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">📚 Fan</span>
                                      <select className="form-control" value={a.pairSubjectId || ""} onChange={e => updateAssignment(s.id, { pairSubjectId: e.target.value, pairTeacherId: "" })}>
                                        <option value="">— 2-fanni tanlang —</option>
                                        {langSubjects.filter(x => x.id !== s.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                      </select>
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">👨‍🏫 Ustoz</span>
                                      <select className="form-control" disabled={!a.pairSubjectId} value={a.pairTeacherId || ""} onChange={e => updateAssignment(s.id, { pairTeacherId: e.target.value })}>
                                        <option value="">— 2-fan ustozi —</option>
                                        {teachersForSubject(a.pairSubjectId).filter(t => t.id !== a.teacherId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                      </select>
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">🚪 Xona</span>
                                      <select className="form-control" value={a.pairRoomId || ""} onChange={e => updateAssignment(s.id, { pairRoomId: e.target.value })}>
                                        <option value="">Xonasiz</option>
                                        {sortedRooms.filter(r => r.id !== a.roomId).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                      </select>
                                    </div>
                                  </div>
                                </div>

                                {/* ——— PARALLEL SINFLAR ———
                                    1-guruh fani bir nechta sinfda BITTA dars bo'lib,
                                    bitta ustozdan o'tadi; 2-guruh esa har sinfda
                                    O'Z fanini o'qiydi. Faqat shu rejimda ko'rinadi. */}
                                {(() => {
                                  const members = pairMemberRows(s.id, a.pairGroupKey);
                                  const used = new Set([selectedClassId, ...members.map(m => m.cls.id)]);
                                  const addable = sameLangClasses.filter(c => !used.has(c.id));
                                  const full = members.length >= PAIR_MAX_EXTRA;
                                  const g1Teacher = teachers.find(t => t.id === a.teacherId)?.name || "ustoz tanlanmagan";
                                  return (
                                    <div className="cs-pp">
                                      <div className="cs-pp-head">
                                        <div className="cs-pp-title">
                                          🔗 Parallel sinflar
                                          <span className="cs-pp-count">{members.length + 1} sinf</span>
                                        </div>
                                        <div className="cs-pp-desc">
                                          <b>{s.name}</b> (1-guruh) tanlangan sinflarda <b>bitta dars</b> bo'lib,
                                          ayni vaqtda va <b>bitta ustozdan</b> o'tadi. Har sinfning <b>2-guruhi</b> esa
                                          o'z fanini o'qiydi — fanlar sinfma-sinf har xil bo'lishi mumkin.
                                        </div>
                                      </div>

                                      <div className="cs-pp-list">
                                        {/* Joriy sinf — sozlamalari yuqoridagi ikki kartada */}
                                        <div className="cs-pp-card is-owner">
                                          <div className="cs-pp-card-head">
                                            <span className="cs-pp-cls">{selectedClass?.name || "Sinf"}</span>
                                            <span className="cs-pp-tag">shu sinf</span>
                                          </div>
                                          <div className="cs-pp-pairline">
                                            <span className="cs-pp-chip cs-pp-chip-1">1 · {s.name}</span>
                                            <span className="cs-pp-plus">+</span>
                                            <span className="cs-pp-chip cs-pp-chip-2">
                                              2 · {subjects.find(x => x.id === a.pairSubjectId)?.name || "fan tanlanmagan"}
                                            </span>
                                          </div>
                                          <div className="cs-pp-hint">Sozlamalari yuqoridagi ikki kartada</div>
                                        </div>

                                        {members.map(({ cls, a: m }) => (
                                          <div className="cs-pp-card" key={cls.id}>
                                            <div className="cs-pp-card-head">
                                              <span className="cs-pp-cls">{cls.name}</span>
                                              <span className="cs-pp-tag cs-pp-tag-link">🔗 parallel</span>
                                              <button
                                                type="button"
                                                className="cs-pp-remove"
                                                title="Guruhdan chiqarish"
                                                onClick={() => removePairClass(s.id, cls.id, a.pairGroupKey)}
                                              >✕</button>
                                            </div>
                                            <div className="cs-pp-pairline">
                                              <span className="cs-pp-chip cs-pp-chip-1">1 · {s.name}</span>
                                              <span className="cs-pp-plus">+</span>
                                              <span className="cs-pp-chip cs-pp-chip-2">
                                                2 · {subjects.find(x => x.id === m.pairSubjectId)?.name || "fan tanlanmagan"}
                                              </span>
                                            </div>
                                            <div className="cs-pp-fields">
                                              <label className="cs-pp-field">
                                                <span className="cs-split-label">📚 2-guruh fani</span>
                                                <select
                                                  className="form-control"
                                                  value={m.pairSubjectId || ""}
                                                  onChange={e => updatePairMember(s.id, cls.id, { pairSubjectId: e.target.value, pairTeacherId: "" })}
                                                >
                                                  <option value="">— fanni tanlang —</option>
                                                  {sortByName(subjects.filter(x => subjectLangOf(x) === classLangOf(cls) && x.id !== s.id))
                                                    .map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                                </select>
                                              </label>
                                              <label className="cs-pp-field">
                                                <span className="cs-split-label">👨‍🏫 Ustoz</span>
                                                <select
                                                  className="form-control"
                                                  disabled={!m.pairSubjectId}
                                                  value={m.pairTeacherId || ""}
                                                  onChange={e => updatePairMember(s.id, cls.id, { pairTeacherId: e.target.value })}
                                                >
                                                  <option value="">— ustozni tanlang —</option>
                                                  {(() => {
                                                    const busy = new Set([a.teacherId, a.pairTeacherId,
                                                      ...members.filter(x => x.cls.id !== cls.id).map(x => x.a.pairTeacherId)].filter(Boolean));
                                                    return teachersForSubject(m.pairSubjectId)
                                                      .filter(t => !busy.has(t.id))
                                                      .map(t => <option key={t.id} value={t.id}>{t.name}</option>);
                                                  })()}
                                                </select>
                                              </label>
                                              <label className="cs-pp-field">
                                                <span className="cs-split-label">🚪 Xona</span>
                                                <select
                                                  className="form-control"
                                                  value={m.pairRoomId || ""}
                                                  onChange={e => updatePairMember(s.id, cls.id, { pairRoomId: e.target.value })}
                                                >
                                                  <option value="">Xonasiz</option>
                                                  {(() => {
                                                    const busy = new Set([a.roomId, a.pairRoomId,
                                                      ...members.filter(x => x.cls.id !== cls.id).map(x => x.a.pairRoomId)].filter(Boolean));
                                                    return sortedRooms.filter(r => !busy.has(r.id))
                                                      .map(r => <option key={r.id} value={r.id}>{r.name}</option>);
                                                  })()}
                                                </select>
                                              </label>
                                            </div>
                                            <div className="cs-pp-shared">
                                              1-guruh: <b>{s.name}</b> · {g1Teacher} · haftada {hoursNow} soat
                                              <em> — {selectedClass?.name} bilan bir xil</em>
                                            </div>
                                          </div>
                                        ))}
                                      </div>

                                      <div className="cs-pp-add">
                                        {full ? (
                                          <span className="cs-pp-add-note">
                                            ✔ Guruh to'ldi — bir guruhga ko'pi bilan {PAIR_MAX_EXTRA + 1} ta sinf kiradi
                                          </span>
                                        ) : addable.length ? (
                                          <>
                                            <span className="cs-pp-add-label">➕ Parallel sinf qo'shish</span>
                                            <select
                                              className="form-control cs-pp-add-select"
                                              value=""
                                              onChange={e => addPairClass(s.id, e.target.value)}
                                            >
                                              <option value="">— sinfni tanlang —</option>
                                              {addable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                          </>
                                        ) : (
                                          <span className="cs-pp-add-note">Qo'shish uchun mos sinf yo'q</span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}

                                {/* Yetishmayotgan sozlamalar — generatsiyadan oldin ko'rinsin */}
                                {(() => {
                                  const warns = [];
                                  if (!a.pairSubjectId) warns.push("2-fan tanlanmagan");
                                  if (!a.teacherId) warns.push(`${s.name} uchun ustoz tanlanmagan`);
                                  if (a.pairSubjectId && !a.pairTeacherId) warns.push("2-fan ustozi tanlanmagan");
                                  if (a.pairTeacherId && a.pairTeacherId === a.teacherId) warns.push("ikkala guruhga bitta ustoz qo'yib bo'lmaydi");
                                  if (a.pairSubjectId && isChecked(a.pairSubjectId)) {
                                    warns.push(`«${subjects.find(x => x.id === a.pairSubjectId)?.name}» ro'yxatda alohida ham belgilangan — belgini olib tashlang`);
                                  }

                                  // ——— Parallel sinflar: hammasi BITTA soatda o'qiydi, resurs takrorlanmasin ———
                                  const here = selectedClass?.name || "shu sinf";
                                  const tSeen = new Map();
                                  const rSeen = new Map();
                                  if (a.teacherId) tSeen.set(a.teacherId, `${here} 1-guruhi`);
                                  if (a.pairTeacherId) tSeen.set(a.pairTeacherId, `${here} 2-guruhi`);
                                  if (a.roomId) rSeen.set(a.roomId, `${here} 1-guruhi`);
                                  if (a.pairRoomId) rSeen.set(a.pairRoomId, `${here} 2-guruhi`);
                                  pairMemberRows(s.id, a.pairGroupKey).forEach(({ cls, a: m }) => {
                                    const where = `${cls.name} 2-guruhi`;
                                    if (!m.pairSubjectId) warns.push(`${cls.name}: 2-guruh fani tanlanmagan`);
                                    else if (!m.pairTeacherId) warns.push(`${cls.name}: 2-guruh ustozi tanlanmagan`);
                                    if (m.pairSubjectId && (classSubjects[cls.id] || []).some(x => x.subjectId === m.pairSubjectId)) {
                                      warns.push(`${cls.name}: «${subjects.find(x => x.id === m.pairSubjectId)?.name}» ro'yxatda alohida ham belgilangan`);
                                    }
                                    if (m.pairTeacherId) {
                                      if (tSeen.has(m.pairTeacherId)) {
                                        warns.push(`${teachers.find(t => t.id === m.pairTeacherId)?.name || "Ustoz"} bir vaqtda ikki joyda: ${tSeen.get(m.pairTeacherId)} va ${where}`);
                                      } else tSeen.set(m.pairTeacherId, where);
                                    }
                                    if (m.pairRoomId) {
                                      if (rSeen.has(m.pairRoomId)) {
                                        warns.push(`${rooms.find(r => r.id === m.pairRoomId)?.name || "Xona"} xonasi bir vaqtda ikki guruhga berilgan: ${rSeen.get(m.pairRoomId)} va ${where}`);
                                      } else rSeen.set(m.pairRoomId, where);
                                    }
                                  });

                                  if (!warns.length) return null;
                                  return (
                                    <div className="cs-pair-warn">
                                      ⚠️ {warns.join(" · ")}
                                    </div>
                                  );
                                })()}

                                <div className="cs-split-note" style={{ marginTop: 10 }}>
                                  💡 <b>2-fanni ro'yxatdan alohida belgilamang</b> — uning soati va ustozi
                                  shu yerdan olinadi. Jadvalda bu dars bitta katakda ikki qator bo'lib
                                  ko'rinadi va ko'chirilganda ikkalasi birga ko'chadi.
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
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
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
                                <div className="cs-grid-2">
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
                                <div className="cs-grid-2" style={{ marginTop: 8 }}>
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
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
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

      {/* ——— "STANDART SOATLAR" TASDIQ OYNASI ——— */}
      {smartAllOpen && (() => {
        const filled = classes.filter((c) => (classSubjects?.[c.id] || []).length > 0);
        const filledHours = filled.reduce(
          (sum, c) => sum + (classSubjects[c.id] || []).reduce((s2, a) => s2 + Number(a.weeklyHours || 0), 0), 0);
        return (
          <div onClick={() => setSmartAllOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card-bg,#fff)", borderRadius: 16, padding: 22, width: "100%", maxWidth: 520, boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
              <h3 style={{ margin: "0 0 4px" }}>⚡ Standart soatlarni qo'llash</h3>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
                Barcha <b>{classes.length} ta sinfga</b> tayanch o'quv reja bo'yicha fanlar va haftalik soatlar biriktiriladi.
              </div>

              {filled.length > 0 && (
                <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 12, padding: "12px 14px", marginBottom: 14, fontSize: 13, lineHeight: 1.6, color: "#92400e" }}>
                  ⚠️ Hozir <b>{filled.length} ta sinfda</b> biriktirilgan fanlar bor ({filledHours} soat).
                  Qo'llansa, ular <b>o'chib, o'rniga standart soatlar</b> yoziladi — ustoz va xona tanlovlari ham yangilanadi.
                </div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button className="btn btn-secondary" type="button" onClick={() => setSmartAllOpen(false)}>↩ Bekor qilish</button>
                <button className="btn btn-success" type="button" onClick={applySmartForAllClasses}>✅ Ha, qo'llansin</button>
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
