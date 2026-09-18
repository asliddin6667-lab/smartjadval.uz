import { useEffect, useMemo, useState } from "react";
import {
  PRIMARY_SUBJECT_NAMES, MIDDLE_SUBJECT_NAMES, HIGH_SUBJECT_NAMES,
  PRIMARY_SUBJECT_NAMES_RU, MIDDLE_SUBJECT_NAMES_RU, HIGH_SUBJECT_NAMES_RU
} from "../utils/constants";
import { sortByName, cmpName } from "../utils/sortHelpers";
import { normName, buildCurriculumIndex, hoursFromRow, namesForGrade as curriculumNamesForGrade } from "../utils/curriculum";
import { getCachedCurriculum, fetchStandardHours } from "../services/standardHoursService";
import { removeSubjectLessons, removeClassesLessons, removeAssignmentsLessons } from "../utils/scheduleCleanup";
import { LANG_BOTH, classLangOf, subjectLangOf, subjectFitsLang, langIcon, langLabel } from "../utils/eduLang";
import {
  PAIR_MAX_EXTRA, PAIR_MAX_GROUPS, PAIR_MAX_EXTRA_GROUPS,
  makePairGroup, normalizePairExtra, pairSideGroups, pairSideSlots,
  pairCardKey, pairTeacherIds, pairAlignSlots,
} from "../utils/pairGroups";
// Fan almashinuvi: 2-soatda ustoz/xona boshqa bo'lishi mumkin
import { swapActive, swapSides, swapTeacherHours } from "../utils/swapGroups";
// Standart soatlar qo'llanganda fanlarni sinf rahbariga biriktirish uchun
import { homeroomIdOf } from "../utils/homeroom";
import { homeroomTakesSubject } from "../utils/homeroomSubjects";
import { isFixedMondaySubject } from "../utils/scheduleCore";
import "../styles/cs-mobile.css";

function teacherSubjectIds(teacher) {
  return Array.isArray(teacher.subjectIds) ? teacher.subjectIds : (teacher.subjectId ? [teacher.subjectId] : []);
}

function getGradeFromClassName(name = "") {
  const match = String(name).match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

// Sinf va fanning ta'lim tili — yordamchilar utils/eduLang.js da.
// Fan tili "both" bo'lsa u UMUMIY: uz va ru sinfida BITTA fan bo'lib ko'rinadi.

// ——— Hovuz (daraja guruhi) a'zolari uchun UMUMIY maydonlar ———
// Bir joyda o'zgarsa — guruhdagi barcha sinflarda bir xil bo'ladi.
// Diqqat: levelGroupEnabled shu ro'yxatda YO'Q — bitta sinfni guruhdan
// chiqarish boshqalarni o'chirib yubormasligi kerak.
const POOL_SHARED_FIELDS = [
  "weeklyHours",
  "allowDouble",
  "allowQuad",
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
    // Almashgandan keyingi (2-) soat ustozi/xonasi — [swapGroups.js](../utils/swapGroups.js)
    swapAltTeachers: false,
    swapNextTeacherId: "",
    swapNextRoomId: "",
    swapNextTeacher2Id: "",
    swapNextRoom2Id: "",
    groupName1: "1-guruh",
    groupName2: "2-guruh",
    levelGroupEnabled: false,
    levelGroupKey: "",
    // "2 soat blok" — fan qo'shilganda HAR DOIM o'chiq.
    // Faqat foydalanuvchi ⚙️ Sozlamalardan o'zi yoqsa ishlaydi.
    allowDouble: false,
    // "4 soat blok" — faqat superadmin ko'radigan sozlama
    allowQuad: false,
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
    // 2-guruh ham parallel sinflarda UMUMIY bo'lsinmi
    pairShare2: false,
    // 3-guruh, 4-guruh… (bir vaqtda 3+ fan)
    pairExtra: [],
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
  "allowQuad",
  "isCore",
  "spacedDays",
  // Guruh tuzilishi: 2-guruh umumiymi — bu ham hamma a'zoda bir xil
  "pairShare2",
];

// 2-guruh qiymatlari — faqat `pairShare2` yoqilganda umumiy bo'ladi
const PAIR_SECOND_FIELDS = ["pairSubjectId", "pairTeacherId", "pairRoomId"];

function pickPairShared(patch = {}, row = {}) {
  const out = {};
  PAIR_SHARED_FIELDS.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(patch, k)) out[k] = patch[k];
  });
  const share2 = Object.prototype.hasOwnProperty.call(patch, "pairShare2")
    ? patch.pairShare2
    : row.pairShare2;
  if (share2) {
    PAIR_SECOND_FIELDS.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(patch, k)) out[k] = patch[k];
    });
  }
  return out;
}

// Guruh tuzilishini (gid / nom / umumiylik) a'zo sinfga ko'chirish.
// UMUMIY guruhning qiymatlari ham nusxalanadi, aks holda sinf o'zinikini
// saqlab qoladi; yangi guruhda esa fan taklif qilinadi, ustoz/xona bo'sh
// (bir ustoz bir vaqtda ikki guruhga kira olmaydi).
function mergePairExtra(ownerExtra, memberExtra) {
  const own = normalizePairExtra(ownerExtra);
  const mineById = new Map(normalizePairExtra(memberExtra).map((g) => [g.gid, g]));
  return own.map((g) => {
    if (g.shared) return { ...g };
    const mine = mineById.get(g.gid);
    if (mine) return { ...g, subjectId: mine.subjectId, teacherId: mine.teacherId, roomId: mine.roomId };
    return { ...g, subjectId: g.subjectId, teacherId: "", roomId: "" };
  });
}

// Bir vaqtda 2 fan rejimi o'chirilganda / sinf guruhdan chiqarilganda
const PAIR_CLEARED = {
  pairEnabled: false,
  pairGroupKey: "",
  pairSubjectId: "",
  pairTeacherId: "",
  pairRoomId: "",
  pairShare2: false,
  pairExtra: [],
};

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

  Object.entries(classSubjects || {}).forEach(([classId, list]) => {
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

      // 3) Bir vaqtda bir nechta fan (+ parallel sinflar).
      //    Kartadagi guruhlar AYNI SOATDA o'qiydi va parallel sinflar bitta
      //    kartani baham ko'radi — shuning uchun HAR BIR USTOZ kartada
      //    BIR MARTA sanaladi (nechta guruhda va nechta sinfda tursa ham).
      if (a.pairEnabled) {
        const card = pairCardKey(a, classId);
        pairTeacherIds(a).forEach((tid) => {
          const sig = `${card}|${tid}`;
          if (parallelDone.has(sig)) return;
          parallelDone.add(sig);
          add(tid, h);
        });
        return;
      }

      // 4) Fan almashinuvi — guruhlar keyingi soatda o'rin almashadi.
      //    Blok soni = `h`. Ustoz blokning IKKALA soatida ham tursa
      //    (2-soatga alohida ustoz tanlanmagan) — `h × 2` soat, faqat
      //    bitta soatida tursa — `h` soat
      //    ([swapGroups.js](../utils/swapGroups.js)).
      if (swapActive(a)) {
        swapTeacherHours(a, h).forEach((hh, tid) => add(tid, hh));
        return;
      }

      // 5) Oddiy dars
      add(a.teacherId, h);
      if (a.splitEnabled && a.teacherId2) add(a.teacherId2, h);
    });
  });

  return load;
}

export default function ClassSubjectsPage({ classes, subjects, teachers, setTeachers, rooms, classSubjects, setClassSubjects, schedule, setSchedule, toast, currentUser }) {
  // "4 soat blok" — FAQAT superadmin uchun. Boshqa rollarda bu sozlama
  // umuman ko'rinmaydi (mavjud yozuvda yoqilgan bo'lsa ham tegilmaydi).
  const isSuperadmin = currentUser?.role === "superadmin";
  // Superadmin belgilagan standart soatlar (bulutdan; kelmasa — ichki reja)
  const [curriculum, setCurriculum] = useState(() => getCachedCurriculum());
  useEffect(() => {
    let alive = true;
    fetchStandardHours().then((res) => { if (alive && res?.data) setCurriculum(res.data); });
    return () => { alive = false; };
  }, []);
  // ⚠️ HAR BIR INDEKS IKKINCHI TILNI HAM BILADI. Maktabning fanlar
  //  ro'yxati aralash nomlangan bo'lishi odatiy hol (eMaktabdan
  //  import qilinganlari ruscha). Busiz rejaning yarmi tushmay qolardi
  //  va rus sinfi o'zbek sinfidan kam soat olardi.
  const curriculumIndex = useMemo(() => ({
    uz: buildCurriculumIndex(curriculum.uz, curriculum.ru),
    ru: buildCurriculumIndex(curriculum.ru, curriculum.uz),
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
  // Umumiy ("both") fan ikkala tildagi sinfda ham chiqadi — qo'lda qo'shilgan
  // bitta fan uz sinfida ham, ru sinfida ham aynan shu ID bilan ko'rinadi,
  // shuning uchun unga biriktirilgan ustoz ham ikkalasida bir xil bo'ladi.
  const langSubjects = sortByName(subjects.filter(s => subjectFitsLang(s, classLang)));

  // ——— «Boshqa tildagi» biriktirmalar ———
  // Ro'yxat sinf tiliga MOS fanlar bo'yicha chiziladi. Agar biriktirma boshqa
  // tildagi fanga tegishli bo'lsa (masalan rus sinfiga qo'lda o'zbekcha fan
  // qo'shilgan), qator umuman ko'rinmasdi: fan dars jadvalida va tahlilda
  // soati bilan turaverar, lekin bu sahifadan o'chirib bo'lmasdi.
  // Shuning uchun shu sinfda biriktirmasi BOR fan tilidan qat'i nazar
  // ro'yxatga qo'shiladi (tepada, ogohlantirish nishoni bilan).
  const assignedSubjectIds = new Set(assignments.map(a => a?.subjectId).filter(Boolean));
  const offLangSubjects = sortByName(
    subjects.filter(s => assignedSubjectIds.has(s.id) && !subjectFitsLang(s, classLang))
  );
  const listSubjects = offLangSubjects.length ? [...offLangSubjects, ...langSubjects] : langSubjects;

  // Tanlangan sinf bilan bir tildagi sinflar (parallel/hovuz/nusxalash faqat shular orasida)
  const sameLangClasses = sortByName(classes.filter(c => classLangOf(c) === classLang));

  // Fan qaysi sinflar bilan bog'lana oladi (parallel dars / hovuz / parallel sinflar).
  // Umumiy fan uchun til cheklovi yo'q.
  function classesForSubject(s) {
    return subjectLangOf(s) === LANG_BOTH ? sortedClasses : sameLangClasses;
  }

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
    const dropped = [];
    for (const [clsId, list] of Object.entries(classSubjects || {})) {
      if (!Array.isArray(list)) continue;
      next[clsId] = list.filter((a) => {
        const keep = Boolean(a && a.subjectId && knownSubjectIds.has(a.subjectId));
        if (!keep && a?.subjectId) dropped.push({ classId: clsId, subjectId: a.subjectId });
        return keep;
      });
    }
    // Biriktirma ketsa ham dars jadvalda qolib, soat sifatida hisoblanaverardi.
    const cleaned = setSchedule ? removeAssignmentsLessons(schedule, dropped) : null;
    if (cleaned?.removed) setSchedule(cleaned.schedule);
    setClassSubjects(next);
    const tail = cleaned?.removed ? ` · jadvaldan ${cleaned.removed} ta dars olib tashlandi` : "";
    toast?.(`${orphanInfo.entries} ta yetim biriktirma tozalandi (${orphanInfo.hours} soat)${tail}`, "success");
  }

  // ——— Sinf tiliga mos kelmaydigan biriktirmalar (barcha sinflar bo'yicha) ———
  // Fan mavjud, lekin tili sinf tilidan boshqa. Bunday yozuv shu sahifada
  // faqat tanlangan sinfda ko'rinadi, shuning uchun umumiy ogohlantirish
  // qaysi sinflarda qolib ketganini aytadi.
  const langMismatch = (() => {
    const pairs = [];
    let hours = 0;
    const classNames = [];
    for (const c of classes) {
      const list = Array.isArray(classSubjects[c.id]) ? classSubjects[c.id] : [];
      let n = 0;
      for (const a of list) {
        if (!a?.subjectId) continue;
        const s = subjects.find(x => x.id === a.subjectId);
        if (!s || subjectFitsLang(s, classLangOf(c))) continue;
        n += 1;
        hours += Number(a.weeklyHours || 0);
        pairs.push({ classId: c.id, subjectId: a.subjectId });
      }
      if (n) classNames.push(c.name || "?");
    }
    return { pairs, entries: pairs.length, hours, classNames };
  })();

  function cleanLangMismatch() {
    if (!langMismatch.entries) return;
    // Ba'zi maktabda bunday biriktirma ATAYLAB qo'yilgan bo'lishi mumkin
    // (masalan rus sinfida "Ona tili va adabiyot"), shuning uchun tasdiq so'raladi.
    const msg = `${langMismatch.entries} ta biriktirma va ularning dars jadvalidagi darslari o'chiriladi (${langMismatch.hours} soat).
Sinflar: ${langMismatch.classNames.join(", ")}
Davom etamizmi?`;
    if (!confirm(msg)) return;
    const drop = new Map(); // classId -> Set(subjectId)
    langMismatch.pairs.forEach(({ classId, subjectId }) => {
      if (!drop.has(classId)) drop.set(classId, new Set());
      drop.get(classId).add(subjectId);
    });
    const next = { ...classSubjects };
    drop.forEach((sids, clsId) => {
      next[clsId] = (classSubjects[clsId] || []).filter(a => !sids.has(a?.subjectId));
    });
    const cleaned = setSchedule ? removeAssignmentsLessons(schedule, langMismatch.pairs) : null;
    if (cleaned?.removed) setSchedule(cleaned.schedule);
    setClassSubjects(next);
    const tail = cleaned?.removed ? ` · jadvaldan ${cleaned.removed} ta dars olib tashlandi` : "";
    toast?.(`${langMismatch.entries} ta mos kelmaydigan biriktirma o'chirildi (${langMismatch.hours} soat)${tail}`, "success");
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
  // "4 soat blok" — faqat superadmin yoqadi (pastdagi `isSuperadmin`).
  function assignmentAllowsQuad(a) { return Boolean(a?.allowQuad); }
  // Haftalik soat qanday bloklarga bo'linishini ko'rsatadi: "4+2", "4+1+1"...
  // Mantiq scheduleGenerator.js dagi splitHoursToBlocks bilan bir xil.
  function describeBlocks(hours, allowDouble, allowQuad) {
    let rest = Math.max(0, Number(hours || 0));
    const parts = [];
    if (allowQuad) while (rest >= 4) { parts.push(4); rest -= 4; }
    if (allowDouble) while (rest >= 2) { parts.push(2); rest -= 2; }
    while (rest > 0) { parts.push(1); rest -= 1; }
    return parts.join(" + ");
  }

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
        const next = { ...classSubjects };
        Object.entries(next).forEach(([cid, list]) => {
          next[cid] = (list || []).map(x => {
            if (x.subjectId !== subjectId) return x;
            if (cid === selectedClassId) return { ...x, ...patch, ...PAIR_CLEARED };
            if (x.pairEnabled && String(x.pairGroupKey || "").trim() === dropKey) return { ...x, ...PAIR_CLEARED };
            return x;
          });
        });
        setClassSubjects(next);
        return;
      }

      // ——— Bir vaqtda bir nechta fan: parallel sinflar bilan bog'langan ———
      // 1-guruhga tegishli maydonlar (soat, ustoz, xona, guruh nomlari,
      // 2 soat blok, asosiy fan, ora kunda) guruhdagi hamma sinfga yoziladi.
      // 2-guruh qiymatlari esa faqat u UMUMIY bo'lganda ko'chadi.
      const linkKey = a?.pairEnabled ? String(a.pairGroupKey || "").trim() : "";
      const shared = linkKey ? pickPairShared(patch, { ...a, ...patch }) : null;
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

  // ——— GURUH AMALLARI (2-, 3-, 4-… guruh) ———
  // Guruh tuzilishi kartadagi BARCHA sinfda bir xil turishi shart, shuning
  // uchun har qanday o'zgarish guruhning hamma a'zosiga yoziladi.
  function eachPairRow(subjectId, pairGroupKey, fn) {
    const key = String(pairGroupKey || "").trim();
    const next = { ...classSubjects };
    Object.entries(next).forEach(([cid, list]) => {
      const isOwner = cid === selectedClassId;
      if (!isOwner && !key) return;
      next[cid] = (list || []).map(x => {
        if (x.subjectId !== subjectId) return x;
        if (!isOwner && !(x.pairEnabled && String(x.pairGroupKey || "").trim() === key)) return x;
        return fn(x, cid, isOwner) || x;
      });
    });
    setClassSubjects(next);
  }

  // 2-guruh ham parallel sinflarda UMUMIY bo'lsinmi (bitta dars, bitta ustoz)
  function togglePairShare2(subjectId, on) {
    const a = getAssignment(subjectId);
    if (!a) return;
    eachPairRow(subjectId, a.pairGroupKey, (x, cid, isOwner) => {
      if (isOwner) return { ...x, pairShare2: on };
      return on
        // Umumiy: fan, ustoz va xona asosiy sinfdan olinadi
        ? { ...x, pairShare2: true, pairSubjectId: a.pairSubjectId || "", pairTeacherId: a.pairTeacherId || "", pairRoomId: a.pairRoomId || "" }
        // Alohida: fan qoladi, ustoz/xona tozalanadi — bitta ustoz
        // bir vaqtda ikki sinfda tura olmaydi
        : { ...x, pairShare2: false, pairTeacherId: "", pairRoomId: "" };
    });
  }

  // Yangi guruh qo'shish (3-guruh, 4-guruh…)
  function addPairGroup(subjectId) {
    const a = getAssignment(subjectId);
    if (!a) return;
    const cur = normalizePairExtra(a.pairExtra);
    if (cur.length >= PAIR_MAX_EXTRA_GROUPS) return;
    const fresh = makePairGroup(cur.length + 3);
    eachPairRow(subjectId, a.pairGroupKey, (x) => ({
      ...x,
      pairExtra: [...normalizePairExtra(x.pairExtra), { ...fresh }],
    }));
  }

  function removePairGroup(subjectId, gid) {
    const a = getAssignment(subjectId);
    if (!a) return;
    eachPairRow(subjectId, a.pairGroupKey, (x) => ({
      ...x,
      pairExtra: normalizePairExtra(x.pairExtra).filter(g => g.gid !== gid),
    }));
  }

  // Guruh sozlamasini o'zgartirish. Nom va "umumiy" bayrog'i — hamma
  // sinfda bir xil; fan/ustoz/xona esa umumiy guruhda hammaga, aks holda
  // faqat `classId` sinfiga yoziladi.
  function updatePairGroup(subjectId, gid, patch, classId = selectedClassId) {
    const a = getAssignment(subjectId);
    if (!a) return;
    const owner = normalizePairExtra(a.pairExtra).find(g => g.gid === gid);
    const structural = {};
    if (Object.prototype.hasOwnProperty.call(patch, "name")) structural.name = patch.name;
    const isShared = Boolean(owner?.shared);
    eachPairRow(subjectId, a.pairGroupKey, (x, cid) => {
      const list = normalizePairExtra(x.pairExtra);
      const idx = list.findIndex(g => g.gid === gid);
      if (idx < 0) return x;
      const values = (cid === classId || isShared) ? patch : {};
      list[idx] = { ...list[idx], ...values, ...structural };
      return { ...x, pairExtra: list };
    });
  }

  // Guruhni umumiy (parallel sinflarda BITTA dars) qilish yoki ajratish
  function togglePairGroupShared(subjectId, gid, on) {
    const a = getAssignment(subjectId);
    if (!a) return;
    const owner = normalizePairExtra(a.pairExtra).find(g => g.gid === gid);
    eachPairRow(subjectId, a.pairGroupKey, (x, cid, isOwner) => {
      const list = normalizePairExtra(x.pairExtra);
      const idx = list.findIndex(g => g.gid === gid);
      if (idx < 0) return x;
      list[idx] = on
        ? { ...list[idx], shared: true, subjectId: owner?.subjectId || "", teacherId: owner?.teacherId || "", roomId: owner?.roomId || "" }
        : { ...list[idx], shared: false, ...(isOwner ? {} : { teacherId: "", roomId: "" }) };
      return { ...x, pairExtra: list };
    });
  }

  // "🧩 Bir vaqtda 2 fan" tugmasi. O'chirilganda bog'langan sinflar ham
  // guruhdan chiqadi — aks holda ular yolg'iz qolib, jadvalni buzardi.
  function togglePairMode(subjectId, on) {
    const a = getAssignment(subjectId);
    if (!a) return;
    const patch = {
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
      pairShare2: on ? Boolean(a.pairShare2) : false,
      pairExtra: on ? normalizePairExtra(a.pairExtra) : [],
      pairGroupKey: on ? String(a.pairGroupKey || "").trim() : "",
    };
    // ——— Oddiy parallel dars guruhi YO'QOLMAYDI ———
    // Rejim yoqilganda `groupKey` tozalanadi (ikkalasi birga ishlamaydi),
    // lekin unga bog'langan sinflar shu yerda `pairGroupKey` ga ko'chadi —
    // foydalanuvchi parallel guruhni qaytadan yig'masin.
    const gk = String(a.groupKey || "").trim();
    const carry = on && gk
      ? sortedClasses
        .filter(c => c.id !== selectedClassId && classInParallel(c.id, subjectId, gk))
        .slice(0, PAIR_MAX_EXTRA)
        .map(c => c.id)
      : [];
    if (carry.length) {
      linkPairClasses(subjectId, carry, patch);
      toast?.(`Parallel guruh saqlandi — ${carry.length + 1} ta sinf bitta kartada`, "success");
      return;
    }
    updateAssignment(subjectId, patch);
  }

  // Guruhga sinf(lar) qo'shish: 1-guruh sozlamalari nusxalanadi,
  // 2-guruh fanini foydalanuvchi o'zi tanlaydi. Bir nechta sinf BITTA
  // o'tishda bog'lanadi — sikl ichida `setClassSubjects` chaqirilsa,
  // har qadam ESKI holatdan boshlanib, oldingi bog'lanish yo'qolardi.
  // Qaytaradi: bog'langan sinflar soni.
  // `ownerPatch` — asosiy sinf qatoriga AYNI o'tishda qo'llanadigan
  // o'zgarish (masalan rejimni yoqish). Ikki marta `setClassSubjects`
  // chaqirib bo'lmaydi: ikkinchisi eski holatdan hisoblanadi.
  function linkPairClasses(subjectId, classIds, ownerPatch = null) {
    const ids = [...new Set((classIds || []).filter(cid => cid && cid !== selectedClassId))];
    const current = classSubjects[selectedClassId] || [];
    const found = current.find(x => x.subjectId === subjectId);
    if (!found) return 0;
    const a = ownerPatch ? { ...found, ...ownerPatch } : found;
    const subject = subjectById(subjectId);
    const key = String(a.pairGroupKey || "").trim()
      || `${subject?.name || "Fan"} juftligi — ${selectedClass?.name || ""}`;

    const next = { ...classSubjects };
    next[selectedClassId] = current.map(x => x.subjectId === subjectId ? { ...x, ...(ownerPatch || {}), pairGroupKey: key } : x);

    ids.forEach((classId) => {
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
        allowQuad: Boolean(a.allowQuad),
        isCore: Boolean(a.isCore),
        spacedDays: Boolean(a.spacedDays),
        // Boshqa rejimlar o'chadi
        splitEnabled: false,
        swapEnabled: false,
        weekAltEnabled: false,
        levelGroupEnabled: false,
        parallelEnabled: false,
        groupKey: "",
        // 2-guruh: UMUMIY bo'lsa asosiy sinfdan nusxalanadi, aks holda
        // shu sinfning O'Z fani (fanni foydalanuvchi tanlaydi)
        pairShare2: Boolean(a.pairShare2),
        pairSubjectId: a.pairShare2 ? (a.pairSubjectId || "") : (exist?.pairSubjectId || ""),
        pairTeacherId: a.pairShare2 ? (a.pairTeacherId || "") : (exist?.pairTeacherId || ""),
        pairRoomId: a.pairShare2 ? (a.pairRoomId || "") : (exist?.pairRoomId || ""),
        // 3-guruh, 4-guruh… — tuzilishi bir xil, qiymatlari umumiylikka qarab
        pairExtra: mergePairExtra(a.pairExtra, exist?.pairExtra),
      };
      next[classId] = exist
        ? list.map(x => x.subjectId === subjectId ? linked : x)
        : [...list, linked];
    });
    setClassSubjects(next);
    return ids.length;
  }

  function addPairClass(subjectId, classId) {
    if (!classId) return;
    const a = getAssignment(subjectId);
    if (!a) return;
    if (!linkPairClasses(subjectId, [classId])) return;
    const need = pairSideSlots(a).filter(g => !g.shared).length;
    toast?.(
      need
        ? `${classes.find(c => c.id === classId)?.name || "Sinf"} guruhga qo'shildi — o'z guruh fanlarini tanlang`
        : `${classes.find(c => c.id === classId)?.name || "Sinf"} guruhga qo'shildi`,
      "success"
    );
  }

  // ——— «🔁 Parallel dars» — «bir vaqtda bir nechta fan» YOQILGANDA ———
  // Oddiy parallel dars (`groupKey`) bitta fanni bir nechta sinfga beradi;
  // bu yerda esa butun KARTA (barcha guruhlari bilan) bog'lanadi, ya'ni
  // `pairGroupKey`. Shuning uchun tugma o'chirilmaydi — u shunchaki boshqa
  // mexanizmga ulanadi.
  //
  // ⚠️ IKKI KIRISH YO'LI — IKKI XIL NATIJA (ataylab):
  //   • shu tugma          → HAMMA guruh UMUMIY: uchala fan ham tanlangan
  //                          sinflarda bir xil dars, bitta ustozdan;
  //   • «➕ Parallel sinf   → faqat 1-guruh umumiy, 2-guruh va keyingilari
  //     qo'shish» ro'yxati    har sinfda ALOHIDA tanlanadi.
  // Foydalanuvchi keyin har guruhning «🔗 Parallel sinflarda umumiy»
  // belgisi bilan istaganini o'zgartira oladi.

  // Kartaning hamma guruhini «umumiy» qiladigan patch
  function shareAllPatch(a) {
    return {
      pairShare2: true,
      pairExtra: normalizePairExtra(a.pairExtra).map(g => ({ ...g, shared: true })),
    };
  }

  function togglePairParallel(subjectId, on) {
    const a = getAssignment(subjectId);
    if (!a) return;
    if (!on) { unlinkPairGroup(subjectId); return; }
    // Sinflarni tugma emas, FOYDALANUVCHI tanlaydi: kalit ochiladi va
    // tugma ostida sinflar ro'yxati chiqadi (`togglePairClass`).
    linkPairClasses(subjectId, [], shareAllPatch(a));
  }

  // Shu fan bo'yicha sinf kartaga bog'langanmi
  function classInPairGroup(classId, subjectId, key) {
    const k = String(key || "").trim();
    if (!k) return false;
    return (classSubjects[classId] || []).some(x => (
      x.subjectId === subjectId && x.pairEnabled && String(x.pairGroupKey || "").trim() === k
    ));
  }

  // Sinflar ro'yxatidagi bosish: bog'lash / guruhdan chiqarish.
  // Bu yo'l «🔁 Parallel dars» tugmasiga tegishli, shuning uchun yangi
  // sinf HAMMA guruhi umumiy holda qo'shiladi.
  function togglePairClass(subjectId, classId) {
    const a = getAssignment(subjectId);
    if (!a || !classId || classId === selectedClassId) return;
    const key = String(a.pairGroupKey || "").trim();
    if (classInPairGroup(classId, subjectId, key)) {
      // Kalit SAQLANADI — ro'yxat ochiq qoladi, oxirgi sinf olib
      // tashlansa ham tugma o'chib qolmaydi
      const next = { ...classSubjects };
      next[classId] = (next[classId] || []).map(x => (
        x.subjectId === subjectId ? { ...x, ...PAIR_CLEARED } : x
      ));
      setClassSubjects(next);
      return;
    }
    if (pairMemberRows(subjectId, key).length >= PAIR_MAX_EXTRA) {
      toast?.(`Guruh to'ldi — bir kartaga ko'pi bilan ${PAIR_MAX_EXTRA + 1} ta sinf kiradi`, "warning");
      return;
    }
    linkPairClasses(subjectId, [classId], shareAllPatch(a));
  }

  // Shu darajadagi sinflarni (11-A, 11-B, 11-V…) bitta kartaga bog'laydi.
  // `shareAll` — hamma guruhni umumiy qilib bog'lash. Qaytaradi: qo'shilgan
  // sinflar soni.
  function autoPairParallelSameGrade(subjectId, { silent = false, shareAll = false } = {}) {
    const a = getAssignment(subjectId);
    if (!a || !selectedClass) return 0;
    const subject = subjectById(subjectId);
    const grade = getGradeFromClassName(selectedClass.name);
    const members = pairMemberRows(subjectId, a.pairGroupKey);
    const used = new Set([selectedClassId, ...members.map(m => m.cls.id)]);
    const room = Math.max(0, PAIR_MAX_EXTRA - members.length);
    const cand = classesForSubject(subject)
      .filter(c => !used.has(c.id) && getGradeFromClassName(c.name) === grade)
      .slice(0, room);
    if (!cand.length) {
      if (!silent) {
        toast?.(
          room
            ? `${grade}-sinfda bog'lanmagan boshqa parallel sinf yo'q`
            : `Guruh to'ldi — bir kartaga ko'pi bilan ${PAIR_MAX_EXTRA + 1} ta sinf kiradi`,
          "warning"
        );
      }
      return 0;
    }
    linkPairClasses(subjectId, cand.map(c => c.id), shareAll ? shareAllPatch(a) : null);
    toast?.(
      shareAll
        ? `${grade}-sinf — ${cand.length} ta parallel sinf bog'landi, hamma fan umumiy ✓`
        : `${grade}-sinf ${subject?.name || "fan"} — ${cand.length} ta parallel sinf bog'landi ✓`,
      "success"
    );
    return cand.length;
  }

  // Kartani parallel sinflardan uzish. A'zo sinflarda fan QOLADI (oddiy
  // dars bo'lib), faqat bog'lanish va guruh sozlamalari tozalanadi.
  // «Umumiy» belgilari ham nolga qaytadi: parallel sinf qolmagach ular
  // ma'nosiz, lekin qolib ketsa keyingi qo'lda qo'shilgan sinf 2-guruhni
  // tanlay olmay qolardi (tugma bosilgandagi holat yopishib qolardi).
  function unlinkPairGroup(subjectId) {
    const a = getAssignment(subjectId);
    const key = String(a?.pairGroupKey || "").trim();
    const reset = {
      pairGroupKey: "",
      pairShare2: false,
      pairExtra: normalizePairExtra(a?.pairExtra).map(g => ({ ...g, shared: false })),
    };
    const next = { ...classSubjects };
    Object.entries(next).forEach(([cid, list]) => {
      next[cid] = (list || []).map(x => {
        if (x.subjectId !== subjectId) return x;
        if (cid === selectedClassId) return { ...x, ...reset };
        if (key && x.pairEnabled && String(x.pairGroupKey || "").trim() === key) return { ...x, ...PAIR_CLEARED };
        return x;
      });
    });
    setClassSubjects(next);
  }

  // Sinfni guruhdan chiqarish. Fan sinfda QOLADI (oddiy dars bo'lib),
  // faqat parallel bog'lanish uziladi.
  function removePairClass(subjectId, classId, pairGroupKey) {
    const key = String(pairGroupKey || "").trim();
    const next = { ...classSubjects };
    next[classId] = (next[classId] || []).map(x => (
      x.subjectId === subjectId ? { ...x, ...PAIR_CLEARED } : x
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
      sortByName(subjects.filter(s => subjectFitsLang(s, lang))).forEach(s => {
        const hours = curriculumHours(s.name, grade, lang);
        if (hours == null) return;
        const row = curriculumRowFor(s.name, lang);
        if (usedRows.has(row.name)) return; // bir xil fanning ikkinchi varianti
        usedRows.add(row.name);
        rows.push({ subject: s, hours });
      });
      if (rows.length) {
        const missing = curriculumNamesForGrade(curriculum[lang], grade).filter(n => !usedRows.has(n));
        return { rows: withHomeroomHour(rows, grade, lang), missing, source: "reja" };
      }
    }

    // Zaxira usul — eski standart ro'yxatlar
    const names = fallbackNamesForGrade(grade, lang);
    const rows = sortByName(subjects.filter(s => names.includes(s.name) && subjectFitsLang(s, lang)))
      .map(s => ({ subject: s, hours: Math.max(1, Number(s.weeklyHours || 1)) }));
    return { rows: withHomeroomHour(rows, grade, lang), missing: [], source: "standart" };
  }

  /* ——— «Kelajak soati» rejaga o'zi qo'shiladi ———
     U tayanch o'quv rejada YO'Q (vazirlik ro'yxatida fan sifatida
     turmaydi), lekin maktabda 1-sinfdan 11-sinfgacha har sinfda bo'ladi
     va sinf rahbarida turadi. Reja qo'llanganda sinf fanlari butunlay
     almashadi — qatorni o'zimiz qo'shmasak, «Kelajak soati» har safar
     o'chib ketardi.
     Fanlar bo'limida bunday fan bo'lmasa — qo'shadigan narsa yo'q. */
  function withHomeroomHour(rows, grade, lang) {
    if (!(grade >= 1 && grade <= 11)) return rows;
    if (rows.some(r => isFixedMondaySubject(r.subject))) return rows;
    const s = subjects.find(x => isFixedMondaySubject(x) && subjectFitsLang(x, lang));
    if (!s) return rows;
    return [...rows, { subject: s, hours: Math.max(1, Number(s.weeklyHours || 1)) }]
      .sort((a, b) => cmpName(a.subject?.name, b.subject?.name));
  }

  /* ——— SINF RAHBARI KIM? ———
     Avval «Sinflar» bo'limida qo'lda belgilangani (`headTeacherId`),
     bo'lmasa boshlang'ich sinf uchun avtomatik aniqlangani
     (`homeroomIdOf` — eng ko'p fan bergan ustoz), u ham bo'lmasa eski
     MATN maydoni (`headTeacher`) ustoz ismi bilan solishtiriladi. */
  function headTeacherIdOf(cls) {
    const byId = homeroomIdOf(cls, classSubjects);
    if (byId) return byId;
    const nm = normName(cls?.headTeacher);
    return nm ? (teachers.find(t => normName(t.name) === nm)?.id || "") : "";
  }

  /* ——— Reja qatorlari → sinf fanlari ———
     Sinf rahbari o'zi beradigan fanlarga ustoz AVTOMATIK qo'yiladi:
     1–4 sinfning chet tili, jismoniy tarbiya va informatikadan boshqa
     hamma fani + har sinfdagi «Kelajak soati»
     ([homeroomSubjects.js](../utils/homeroomSubjects.js)).
     Qolgan fanlarda ustoz bo'sh qoladi — o'zingiz tanlaysiz. */
  function assignmentsFromPlan(rows, cls) {
    const headId = headTeacherIdOf(cls);
    const grade = getGradeFromClassName(cls?.name);
    const headSubjectIds = [];
    const list = rows.map(({ subject, hours }) => {
      const mine = Boolean(headId) && homeroomTakesSubject(subject, grade);
      if (mine) headSubjectIds.push(subject.id);
      return {
        ...makeAssignment(subject, mine ? headId : ""),
        weeklyHours: hours,
      };
    });
    return { list, headId, headSubjectIds };
  }

  /* ⚠️ USTOZ KARTOCHKASIDA FAN YOQILMASA — BIRIKTIRMA KO'RINMAY QOLADI.
     Fan qatoridagi ustoz ro'yxati `teachersForSubject()` bilan, ya'ni
     ustozning O'Z fanlari (`subjectIds`) bo'yicha filtrlanadi. Sinf
     rahbariga «Matematika» qo'yilsa-yu, ustozda o'sha fan yoqilmagan
     bo'lsa — u ro'yxatda umuman chiqmaydi va tanlov bo'sh ko'rinadi.
     Shuning uchun avtomatik biriktirilgan fanlar ustozga ham yoziladi.
     `addMap` — Map(ustozId → Set(fanId)). */
  function enableTeacherSubjects(addMap) {
    if (!setTeachers || !addMap.size) return 0;
    let touched = 0;
    const next = teachers.map(t => {
      const add = addMap.get(t.id);
      if (!add || !add.size) return t;
      const cur = teacherSubjectIds(t);
      const merged = [...new Set([...cur, ...add])];
      if (merged.length === cur.length) return t;
      touched += 1;
      return { ...t, subjectIds: merged };
    });
    if (touched) setTeachers(next);
    return touched;
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
    const { list, headId, headSubjectIds } = assignmentsFromPlan(rows, selectedClass);
    const next = { ...classSubjects };
    next[selectedClassId] = list;
    setClassSubjects(next);
    if (headId && headSubjectIds.length) {
      enableTeacherSubjects(new Map([[headId, new Set(headSubjectIds)]]));
    }
    setOpenSettings(null);

    // Sinf rahbari haqidagi xabar asosiy toastga qo'shiladi — uchta
    // ketma-ket bildirishnoma o'qilmaydi
    const headName = teachers.find(t => t.id === headId)?.name || "";
    const headPart = headSubjectIds.length
      ? ` · ${headSubjectIds.length} fan rahbarga (${headName})`
      : "";

    const total = rows.reduce((sum, r) => sum + r.hours, 0);
    if (missing.length) {
      toast(`${selectedClass.name}: ${rows.length} fan · ${total} soat ✓${headPart} — Fanlar bo'limida yo'q: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` va yana ${missing.length - 3} ta` : ""}`, "warning");
    } else {
      toast(`${selectedClass.name}: ${rows.length} fan · ${total} soat biriktirildi ✓${headPart}${source === "reja" ? " (tayanch o'quv reja)" : ""}`, "success");
    }

    // Rahbarsiz sinfda fanlar ustozsiz qoladi — buni aytmasak,
    // foydalanuvchi «nega biriktirilmadi?» deb qoladi
    if (!headId) {
      toast(`${selectedClass.name}: sinf rahbari belgilanmagan — «Sinflar» bo'limida tanlab, qayta qo'llang`, "warning");
    }
  }

  function applySmartForAllClasses() {
    setSmartAllOpen(false);
    const next = { ...classSubjects };
    let done = 0, totalHoursAll = 0;
    let missingRu = false, missingUz = false;
    const missingNames = new Set();
    // Sinf rahbariga biriktirilgan fanlar — Map(ustozId → Set(fanId)).
    // Hammasi yig'ilib, oxirida BITTA `setTeachers` bilan yoziladi.
    const headAdd = new Map();
    let headRows = 0;
    const noHead = [];

    classes.forEach(cls => {
      const { rows, missing } = planForClass(cls);
      if (!rows.length) {
        if (classLangOf(cls) === "ru") missingRu = true; else missingUz = true;
        return; // fanlar hali qo'shilmagan tildagi sinfga tegmaymiz
      }
      const { list, headId, headSubjectIds } = assignmentsFromPlan(rows, cls);
      next[cls.id] = list;
      if (headId && headSubjectIds.length) {
        if (!headAdd.has(headId)) headAdd.set(headId, new Set());
        const set = headAdd.get(headId);
        headSubjectIds.forEach(id => set.add(id));
        headRows += headSubjectIds.length;
      } else if (!headId) {
        noHead.push(cls.name);
      }
      done += 1;
      totalHoursAll += rows.reduce((sum, r) => sum + r.hours, 0);
      missing.forEach(n => missingNames.add(n));
    });

    setClassSubjects(next);
    enableTeacherSubjects(headAdd);
    setOpenSettings(null);

    // Sinf rahbari haqidagi hisob asosiy toastga qo'shiladi
    const headPart = headRows ? ` · rahbarlarga ${headRows} fan` : "";

    if (missingRu) toast("Rus sinflari o'tkazib yuborildi: Fanlar bo'limida ruscha standart fanlarni qo'shing", "warning");
    else if (missingUz) toast("O'zbek sinflari o'tkazib yuborildi: Fanlar bo'limida standart fanlarni qo'shing", "warning");
    else if (missingNames.size) {
      const list = [...missingNames];
      toast(`${done} ta sinfga · jami ${totalHoursAll} soat biriktirildi ✓${headPart} — Fanlar bo'limida yo'q: ${list.slice(0, 3).join(", ")}${list.length > 3 ? ` va yana ${list.length - 3} ta` : ""}`, "warning");
    } else {
      toast(`${done} ta sinfga tayanch o'quv reja bo'yicha ${totalHoursAll} soat biriktirildi ✓${headPart}`, "success");
    }

    // Rahbarsiz sinflarda fanlar ustozsiz qoldi — alohida aytiladi,
    // aks holda «nega ustoz qo'yilmadi?» degan savol tug'iladi
    if (noHead.length) {
      toast(`Sinf rahbari belgilanmagan: ${noHead.slice(0, 5).join(", ")}${noHead.length > 5 ? ` va yana ${noHead.length - 5} ta` : ""} — «Sinflar» bo'limida tanlab, qayta qo'llang`, "warning");
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
    const sameGradeClasses = classesForSubject(subject).filter(c => getGradeFromClassName(c.name) === grade);
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
    const sameGradeClasses = classesForSubject(subject).filter(c => getGradeFromClassName(c.name) === grade);
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
    if (assignmentAllowsQuad(a)) chips.push({ text: "🧱 4 soat blok", bg: "#ede9fe", fg: "#5b21b6" });
    if (assignmentAllowsDouble(a) && !assignmentAllowsQuad(a)) chips.push({ text: "2 soat blok", bg: "#e0e7ff", fg: "#3730a3" });
    if (a.spacedDays) chips.push({ text: "📆 Ora kunda", bg: "#ffedd5", fg: "#9a3412" });
    if (a.groupKey && !a.levelGroupEnabled) chips.push({ text: "🔁 Parallel", bg: "#d1fae5", fg: "#065f46" });
    if (a.splitEnabled && !a.levelGroupEnabled) chips.push({ text: a.swapEnabled ? "🔄 Almashinuv" : "✂️ 2 guruh", bg: "#fce7f3", fg: "#9d174d" });
    if (a.pairEnabled) {
      // Bir vaqtda 2, 3, 4… fan — hammasi bitta soatda
      const names = pairSideGroups(a)
        .map((g) => subjects.find((x) => x.id === g.subjectId)?.name)
        .filter(Boolean);
      chips.push({
        text: names.length ? `🧩 + ${names.join(" + ")}` : "🧩 2 fan (fan tanlanmagan)",
        bg: "#e0e7ff", fg: "#4338ca",
      });
      // Karta boshqa sinflar bilan bog'langan (pairGroupKey)
      if (String(a.pairGroupKey || "").trim()) {
        chips.push({ text: "🔁 Parallel sinflar", bg: "#d1fae5", fg: "#065f46" });
      }
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

                {langMismatch.entries > 0 && (
                  <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                    <div style={{ marginBottom: 8 }}>
                      ⚠️ <b>{langMismatch.entries} ta biriktirma sinf ta'lim tiliga mos kelmaydi</b> ({langMismatch.hours} soat).
                      Bunday fan pastdagi ro'yxatda «boshqa til» nishoni bilan tepada turadi — belgini olib tashlab
                      o'chirsangiz, dars jadvalidagi darslari ham ketadi.
                      <div style={{ fontSize: 12, opacity: .85, marginTop: 4 }}>
                        Sinflar: {langMismatch.classNames.join(", ")}
                      </div>
                      <div style={{ fontSize: 12, opacity: .85, marginTop: 4 }}>
                        Fan haqiqatan kerak bo'lsa — «Fanlar» bo'limida uning tilini «🌐 Umumiy» qilib belgilang.
                      </div>
                    </div>
                    <button className="btn btn-danger btn-sm" onClick={cleanLangMismatch}>🧹 Hammasini o'chirish</button>
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
                  {listSubjects.map(s => {
                    const checked = isChecked(s.id);
                    // Fan sinf tiliga mos kelmaydi — faqat biriktirmasi borligi uchun ko'rinadi
                    const offLang = !subjectFitsLang(s, classLang);
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
                              {offLang && (
                                <span
                                  className="cs-chip"
                                  style={{ background: "#fee2e2", color: "#991b1b" }}
                                  title={`Bu fan ${langLabel(subjectLangOf(s))} tili uchun, sinf esa ${langLabel(classLang)} tilida o'qiydi. Belgini olib tashlasangiz — biriktirma va dars jadvalidagi darslari o'chadi.`}
                                >
                                  ⚠️ boshqa til · {langIcon(subjectLangOf(s))}
                                </span>
                              )}
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
                                <span>2 soat blok {assignmentAllowsDouble(a) && !assignmentAllowsQuad(a) && <em style={{ color: "var(--text-muted)", fontWeight: 400 }}>({hoursNow} soat → {Math.ceil(hoursNow / 2)} blok)</em>}</span>
                              </label>
                              {isSuperadmin && (
                                <label className="cs-toggle" title="Fan bir kunda KETMA-KET 4 soat tushadi. Qolgan soatlar «2 soat blok» yoqilgan bo'lsa juftlanadi, aks holda bittalab joylanadi.">
                                  <input type="checkbox" checked={assignmentAllowsQuad(a)} onChange={e => updateAssignment(s.id, { allowQuad: e.target.checked })} />
                                  <span>🧱 4 soat blok {assignmentAllowsQuad(a) && <em style={{ color: "var(--text-muted)", fontWeight: 400 }}>({hoursNow} soat → {describeBlocks(hoursNow, assignmentAllowsDouble(a), true)})</em>}</span>
                                </label>
                              )}
                              <label className="cs-toggle" title="Dars kunlar oralab qo'yiladi: Dushanba → Chorshanba → Juma">
                                <input type="checkbox" checked={Boolean(a.spacedDays)} onChange={e => updateAssignment(s.id, { spacedDays: e.target.checked })} />
                                <span>📆 Ora kunda (kun oralab)</span>
                              </label>
                              {/* «Parallel dars» IKKI mexanizmga ulanadi:
                                  oddiy holatda `groupKey` (bitta fan bir necha
                                  sinfga), «bir vaqtda bir nechta fan» yoqilganda
                                  esa `pairGroupKey` — butun karta o'z guruhlari
                                  bilan boshqa sinflarga bog'lanadi. */}
                              <label className="cs-toggle" title={a.pairEnabled
                                ? "Bosilganda sinflar ro'yxati chiqadi — kartani qaysi sinflar bilan bo'lishishni o'zingiz tanlaysiz. Tanlangan sinflarda kartadagi HAMMA fan umumiy bo'ladi (har sinfda boshqa fan kerak bo'lsa: pastdagi «➕ Parallel sinf qo'shish»)"
                                : "Parallel dars"}>
                                <input type="checkbox" disabled={a.levelGroupEnabled || a.weekAltEnabled}
                                  checked={a.pairEnabled ? Boolean(String(a.pairGroupKey || "").trim()) : Boolean(a.groupKey)}
                                  onChange={e => (a.pairEnabled
                                    ? togglePairParallel(s.id, e.target.checked)
                                    : updateAssignment(s.id, { parallelEnabled: e.target.checked, weekAltEnabled: false, pairEnabled: false, groupKey: e.target.checked ? (a.groupKey || `${getGradeFromClassName(selectedClass?.name)}-sinf ${s.name} parallel — ${selectedClass?.name || ""}`) : "" }))} />
                                <span>🔁 Parallel dars{a.pairEnabled ? " (boshqa sinflar bilan)" : ""}</span>
                              </label>
                              <label className="cs-toggle" title="Sinfni 2 guruhga bo'lish">
                                <input type="checkbox" disabled={a.levelGroupEnabled || a.weekAltEnabled || a.pairEnabled} checked={Boolean(a.splitEnabled)} onChange={e => updateAssignment(s.id, { splitEnabled: e.target.checked, weekAltEnabled: false, pairEnabled: false })} />
                                <span>✂️ 2 guruhga bo'lish</span>
                              </label>
                              <label className="cs-toggle" title="Bir nechta sinfni daraja bo'yicha guruhlash">
                                <input type="checkbox" checked={Boolean(a.levelGroupEnabled)} onChange={e => updateAssignment(s.id, { levelGroupEnabled: e.target.checked, splitEnabled: false, weekAltEnabled: false, pairEnabled: false, levelGroupKey: a.levelGroupKey || `${getGradeFromClassName(selectedClass?.name)}-sinf ${s.name} — ${selectedClass?.name || ""} guruhi` })} />
                                <span>🎯 Daraja guruhi (hovuz)</span>
                              </label>
                              <label className="cs-toggle" title="Sinf 2, 3, 4… guruhga bo'linadi va bir vaqtning o'zida har guruh o'z fanini o'qiydi (masalan: Ona tili + Rus tili + SAT)">
                                <input
                                  type="checkbox"
                                  disabled={a.levelGroupEnabled || a.weekAltEnabled || a.splitEnabled}
                                  checked={Boolean(a.pairEnabled)}
                                  onChange={e => togglePairMode(s.id, e.target.checked)}
                                />
                                <span>🧩 Bir vaqtda bir nechta fan</span>
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
                                  {classesForSubject(s).map(c => {
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
                            {/* 🔁 Parallel dars — «bir vaqtda bir nechta fan» yoqilganda.
                                Sinflarni TUGMA emas, foydalanuvchi shu yerda tanlaydi. */}
                            {a.pairEnabled && String(a.pairGroupKey || "").trim() && (() => {
                              const pkey = String(a.pairGroupKey || "").trim();
                              const linked = pairMemberRows(s.id, pkey);
                              const full = linked.length >= PAIR_MAX_EXTRA;
                              return (
                                <div className="cs-detail" style={{ background: "#ecfdf5", border: "1px solid #a7f3d0" }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: "#065f46", marginBottom: 4 }}>
                                    🔁 Qaysi sinflar bilan parallel?{" "}
                                    <span style={{ fontWeight: 400 }}>({linked.length + 1} sinf)</span>
                                  </div>
                                  <div style={{ fontSize: 12, color: "#047857", marginBottom: 8 }}>
                                    Tanlangan sinflar shu kartani baham ko'radi: hamma guruh AYNI SOATDA
                                    va <b>hamma fan umumiy</b> — har sinfda bir xil dars, bitta ustoz.
                                    Biror guruh sinfma-sinf boshqa fan bo'lishi kerak bo'lsa, o'sha guruh
                                    kartasidagi «🔗 Parallel sinflarda umumiy» belgisini o'chiring.
                                  </div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 150, overflowY: "auto" }}>
                                    {classesForSubject(s).map(c => {
                                      const isOwner = c.id === selectedClassId;
                                      const inGroup = !isOwner && classInPairGroup(c.id, s.id, pkey);
                                      return (
                                        <button type="button" key={c.id}
                                          disabled={isOwner || (full && !inGroup)}
                                          onClick={() => togglePairClass(s.id, c.id)}
                                          className={`btn btn-sm ${inGroup ? "btn-success" : "btn-secondary"}`}>
                                          {inGroup ? "✓ " : ""}{c.name}{isOwner ? " (asosiy)" : ""}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                    <button className="btn btn-secondary btn-sm"
                                      onClick={() => autoPairParallelSameGrade(s.id, { shareAll: true })}>
                                      ⚡ Shu sinfning barcha parallellari
                                    </button>
                                    {full && <span style={{ fontSize: 12, color: "#047857" }}>✔ Ko'pi bilan {PAIR_MAX_EXTRA + 1} ta sinf</span>}
                                    {!linked.length && <span style={{ fontSize: 12, color: "#b45309" }}>⚠️ Hali sinf tanlanmadi</span>}
                                  </div>
                                </div>
                              );
                            })()}

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
                                    {/* Almashinuvda ustoz/xona SOATMA-SOAT tanlanadi —
                                        pastdagi «almashinuv jadvali»da */}
                                    {!a.swapEnabled ? (
                                      <>
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
                                      </>
                                    ) : (
                                      <div className="cs-split-note">🔄 Ustoz va xona pastdagi <b>almashinuv jadvalidan</b> tanlanadi.</div>
                                    )}
                                  </div>

                                  {/* ——— 2-guruh ——— */}
                                  <div className="cs-split-card cs-split-card-2">
                                    <div className="cs-split-head"><span className="cs-split-num">2</span> 2-guruh</div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">Guruh nomi</span>
                                      <input className="form-control" placeholder="2-guruh" value={a.groupName2 || "2-guruh"} onChange={e => updateAssignment(s.id, { groupName2: e.target.value })} />
                                    </div>
                                    {!a.swapEnabled ? (
                                      <>
                                        <div className="cs-split-field">
                                          <span className="cs-split-label">👨‍🏫 Ustoz</span>
                                          <select className="form-control" value={a.teacherId2 || ""} onChange={e => updateAssignment(s.id, { teacherId2: e.target.value })}>
                                            <option value="">— 2-guruh ustozi —</option>{availableTeachers.filter(t => t.id !== a.teacherId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                          </select>
                                        </div>
                                        <div className="cs-split-field">
                                          <span className="cs-split-label">🚪 Xona</span>
                                          <select className="form-control" value={a.roomId2 || ""} onChange={e => updateAssignment(s.id, { roomId2: e.target.value })}>
                                            <option value="">Xonasiz</option>{sortedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                          </select>
                                        </div>
                                      </>
                                    ) : (
                                      <div className="cs-split-note">🔄 Bu guruh 1-soatda <b>2-fanni</b> o'qiydi — ustoz/xona pastdagi jadvalda.</div>
                                    )}
                                  </div>
                                </div>
                                {/* ——— FAN ALMASHINUVI ———
                                    Ikki guruh har xil fan o'qiydi va KEYINGI SOATDA
                                    o'rin almashadi. Ustoz har soat uchun alohida
                                    tanlanishi mumkin — model [swapGroups.js](../utils/swapGroups.js) da. */}
                                <div className={`cs-swap ${a.swapEnabled ? "is-on" : ""}`}>
                                  <label className="cs-swap-toggle">
                                    <input type="checkbox" checked={Boolean(a.swapEnabled)} onChange={e => updateAssignment(s.id, { swapEnabled: e.target.checked })} />
                                    <span>
                                      🔄 Guruhlar har xil fan o'qiydi va keyingi soatda almashadi
                                      <em>Dars 2 soatlik blok bo'lib tushadi: 1-soatda guruhlar har xil fan o'qiydi, 2-soatda o'rin almashadi.</em>
                                    </span>
                                  </label>

                                  {a.swapEnabled && (() => {
                                    const altOn = Boolean(a.swapAltTeachers);
                                    const { main, second } = swapSides(a);
                                    const nameA = s.name;
                                    const nameB = subjects.find(x => x.id === a.swapSubjectId)?.name || "2-fan";
                                    const tName = (id) => teachers.find(t => t.id === id)?.name || "";
                                    const rName = (id) => rooms.find(r => r.id === id)?.name || "";
                                    // Har SOATDA ikkala guruh AYNI VAQTDA o'qiydi:
                                    // ustoz ham, xona ham takrorlanmasligi kerak.
                                    const hours = [
                                      {
                                        n: 1, tag: "Boshlanishi",
                                        groups: [
                                          { g: 1, subjectId: a.subjectId, subject: nameA, teacherId: main.r1.teacherId, roomId: main.r1.roomId, tKey: "teacherId", rKey: "roomId", editable: true },
                                          { g: 2, subjectId: a.swapSubjectId, subject: nameB, teacherId: second.r1.teacherId, roomId: second.r1.roomId, tKey: "swapTeacherId", rKey: "swapRoomId", editable: true },
                                        ],
                                      },
                                      {
                                        n: 2, tag: "Guruhlar almashdi",
                                        groups: [
                                          { g: 1, subjectId: a.swapSubjectId, subject: nameB, teacherId: second.r2.teacherId, roomId: second.r2.roomId, tKey: "swapNextTeacher2Id", rKey: "swapNextRoom2Id", editable: altOn, baseT: second.r1.teacherId, baseR: second.r1.roomId },
                                          { g: 2, subjectId: a.subjectId, subject: nameA, teacherId: main.r2.teacherId, roomId: main.r2.roomId, tKey: "swapNextTeacherId", rKey: "swapNextRoomId", editable: altOn, baseT: main.r1.teacherId, baseR: main.r1.roomId },
                                        ],
                                      },
                                    ];
                                    return (
                                      <div className="cs-swap-body">
                                        {/* Ikki fan */}
                                        <div className="cs-swap-subjects">
                                          <div className="cs-swap-subject">
                                            <span className="cs-swap-badge">1-fan</span>
                                            <div className="cs-swap-subject-name">{nameA}</div>
                                          </div>
                                          <span className="cs-swap-x">↔</span>
                                          <div className="cs-swap-subject">
                                            <span className="cs-swap-badge cs-swap-badge-2">2-fan</span>
                                            <select className="form-control" value={a.swapSubjectId || ""}
                                              onChange={e => updateAssignment(s.id, { swapSubjectId: e.target.value, swapTeacherId: "", swapNextTeacher2Id: "" })}>
                                              <option value="">— 2-fanni tanlang —</option>
                                              {langSubjects.filter(x => x.id !== s.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                            </select>
                                          </div>
                                        </div>
                                        <div className="cs-swap-hint">⚠️ 2-fanni ro'yxatda ALOHIDA belgilamang — soati shu yerdan olinadi.</div>

                                        {/* Almashgandan keyin ustoz o'zgaradimi */}
                                        <label className={`cs-swap-alt ${altOn ? "is-on" : ""}`}>
                                          <input type="checkbox" checked={altOn} onChange={e => updateAssignment(s.id, e.target.checked
                                            ? { swapAltTeachers: true }
                                            : { swapAltTeachers: false, swapNextTeacherId: "", swapNextRoomId: "", swapNextTeacher2Id: "", swapNextRoom2Id: "" })} />
                                          <span>
                                            🔀 Almashgandan keyin ustoz (va xona) boshqa bo'lsin
                                            <em>Masalan 1-guruh 1-soatda {nameA}ni bir ustozdan, 2-soatda {nameB}ni BOSHQA ustozdan o'qiydi.</em>
                                          </span>
                                        </label>

                                        {/* Ikki soatlik oqim */}
                                        <div className="cs-swap-flow">
                                          {hours.map((h, hi) => {
                                            const dupT = h.groups[0].teacherId && h.groups[0].teacherId === h.groups[1].teacherId;
                                            const dupR = h.groups[0].roomId && h.groups[0].roomId === h.groups[1].roomId;
                                            return (
                                              <div key={h.n} className={`cs-swap-hour cs-swap-hour-${h.n}`}>
                                                <div className="cs-swap-hour-head">
                                                  <span className="cs-swap-hour-num">{h.n}</span>
                                                  {h.n}-soat
                                                  <span className="cs-swap-hour-tag">{h.tag}</span>
                                                </div>
                                                {h.groups.map((g) => {
                                                  const other = h.groups[g.g === 1 ? 1 : 0];
                                                  return (
                                                    <div key={g.g} className={`cs-swap-group cs-swap-group-${g.g}`}>
                                                      <div className="cs-swap-group-top">
                                                        <span className="cs-swap-gnum">{g.g}</span>
                                                        <span className="cs-swap-gname">{g.g === 1 ? (a.groupName1 || "1-guruh") : (a.groupName2 || "2-guruh")}</span>
                                                        <span className="cs-swap-gsubject">{g.subject}</span>
                                                      </div>
                                                      {g.editable ? (
                                                        <div className="cs-swap-fields">
                                                          <select className="form-control" disabled={!g.subjectId} value={a[g.tKey] || ""}
                                                            onChange={e => updateAssignment(s.id, { [g.tKey]: e.target.value })}>
                                                            <option value="">{hi === 0 ? "— ustoz —" : `1-soatdagi ustoz${g.baseT ? `: ${tName(g.baseT)}` : ""}`}</option>
                                                            {teachersForSubject(g.subjectId).filter(t => t.id !== other.teacherId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                                          </select>
                                                          <select className="form-control" value={a[g.rKey] || ""}
                                                            onChange={e => updateAssignment(s.id, { [g.rKey]: e.target.value })}>
                                                            <option value="">{hi === 0 ? "Xonasiz" : (g.baseR ? `1-soatdagi xona: ${rName(g.baseR)}` : "Xonasiz")}</option>
                                                            {sortedRooms.filter(r => r.id !== other.roomId).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                                          </select>
                                                        </div>
                                                      ) : (
                                                        <div className="cs-swap-static">
                                                          👨‍🏫 {tName(g.teacherId) || "— ustoz tanlanmagan —"}
                                                          {g.roomId ? ` · 🚪 ${rName(g.roomId)}` : ""}
                                                          <em>1-soatdagi ustoz davom etadi</em>
                                                        </div>
                                                      )}
                                                    </div>
                                                  );
                                                })}
                                                {(dupT || dupR) && (
                                                  <div className="cs-swap-warn">
                                                    ⚠️ {dupT ? "Bir soatda ikkala guruhga BIR ustoz qo'yilgan" : "Ikkala guruh BIR xonada"} — guruhlar ayni vaqtda o'qiydi, bu mumkin emas.
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>

                                        {/* USTOZ SOATI — blokdagi soatlari bo'yicha.
                                            Ikkala soatda ham o'zi turgan ustoz 1-soatda bir
                                            guruhga, 2-soatda ikkinchisiga kiradi: soati ikki
                                            barobar ([swapGroups.js](../utils/swapGroups.js)). */}
                                        <div className="cs-swap-hours">
                                          <span className="cs-swap-hours-title">⏱ Ustoz soati (haftasiga):</span>
                                          {[...swapTeacherHours(a, Number(a.weeklyHours || 0))].map(([tid, hh]) => (
                                            <span key={tid} className="cs-swap-hours-item"><b>{tName(tid) || "— ustoz —"}</b> {hh} soat</span>
                                          ))}
                                          <em>
                                            Blokning IKKALA soatida ham turgan ustoz {Number(a.weeklyHours || 0) * 2} soat oladi
                                            (1-soatda bir guruhga, 2-soatda ikkinchisiga kiradi); faqat bitta soatida
                                            turgani — {Number(a.weeklyHours || 0)} soat.
                                          </em>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            )}

                            {/* ——— BIR VAQTDA BIR NECHTA FAN ———
                                Sinf 2, 3, 4… guruhga bo'linadi va har guruh
                                AYNI PAYTDA o'z fanini o'qiydi. Almashinuv yo'q.
                                Har bir guruhni parallel sinflarda UMUMIY
                                (bitta dars, bitta ustoz) qilish mumkin. */}
                            {a.pairEnabled && (() => {
                              const members = pairMemberRows(s.id, a.pairGroupKey);
                              const slots = pairSideSlots(a);
                              const extras = normalizePairExtra(a.pairExtra);
                              const groupCount = 1 + slots.length;

                              // ——— BIR VAQTDA BAND RESURSLAR ———
                              // Kartadagi hamma guruh AYNI SOATDA o'qiydi, shuning
                              // uchun ustoz ham, xona ham butun karta bo'ylab
                              // takrorlanmasligi kerak. Umumiy guruh — bitta "slot".
                              const slotKey = (gid, shared, classId) => (shared ? `S|${gid}` : `C|${classId}|${gid}`);
                              // A'zo sinf guruhlari asosiy sinf tuzilishi bo'yicha o'qiladi
                              const slotsOf = (row) => (row === a ? slots : pairAlignSlots(a, row));
                              const rowSlots = (classId, row) => slotsOf(row).map(g => ({
                                key: slotKey(g.gid, g.shared, classId),
                                teacherId: g.teacherId, roomId: g.roomId,
                              }));
                              const allSlots = [
                                { key: "S|g1", teacherId: a.teacherId, roomId: a.roomId },
                                ...rowSlots(selectedClassId, a),
                                ...members.flatMap(m => rowSlots(m.cls.id, m.a)),
                              ];
                              const busyT = (key) => new Set(allSlots.filter(x => x.key !== key).map(x => x.teacherId).filter(Boolean));
                              const busyR = (key) => new Set(allSlots.filter(x => x.key !== key).map(x => x.roomId).filter(Boolean));
                              // BIR XIL FAN bir nechta guruhda turishi MUMKIN —
                              // masalan 1-guruh Fizika (Asilbek), 3-guruh Fizika
                              // (boshqa ustoz). Shuning uchun fan ro'yxati
                              // filtrlanmaydi; faqat USTOZ va XONA takrorlanmaydi
                              // (ular bir vaqtda ikki joyda tura olmaydi).

                              // ——— GURUH SOZLAMASINI YOZISH ———
                              // 2-guruh eski maydonlarda (pairSubjectId…), 3-guruhdan
                              // boshlab `pairExtra` massivida yashaydi.
                              const setGroup = (g, patch, classId = selectedClassId) => {
                                if (g.isSecond) {
                                  const p = {};
                                  if ("name" in patch) p.groupName2 = patch.name;
                                  if ("subjectId" in patch) { p.pairSubjectId = patch.subjectId; p.pairTeacherId = ""; }
                                  if ("teacherId" in patch) p.pairTeacherId = patch.teacherId;
                                  if ("roomId" in patch) p.pairRoomId = patch.roomId;
                                  if (classId === selectedClassId) updateAssignment(s.id, p);
                                  else updatePairMember(s.id, classId, p);
                                } else {
                                  const p = { ...patch };
                                  if ("subjectId" in patch) p.teacherId = "";
                                  updatePairGroup(s.id, g.gid, p, classId);
                                }
                              };
                              const setShared = (g, on) => {
                                if (g.isSecond) togglePairShare2(s.id, on);
                                else togglePairGroupShared(s.id, g.gid, on);
                              };

                              const nameOfSubject = (id) => subjects.find(x => x.id === id)?.name || "";
                              const nameOfTeacher = (id) => teachers.find(t => t.id === id)?.name || "";
                              const nameOfRoom = (id) => rooms.find(r => r.id === id)?.name || "";

                              // ——— GURUH KARTASI (2-guruhdan boshlab) ———
                              const renderGroupCard = (g, i) => {
                                const num = i + 2;
                                const key = slotKey(g.gid, g.shared, selectedClassId);
                                const bt = busyT(key);
                                const br = busyR(key);
                                return (
                                  <div className={`cs-split-card ${g.isSecond ? "cs-split-card-2" : "cs-split-card-x"}`} key={g.gid}>
                                    <div className="cs-split-head">
                                      <span className="cs-split-num">{num}</span>
                                      <span className="cs-split-headname">{nameOfSubject(g.subjectId) || `${num}-fan`}</span>
                                      {g.shared && <span className="cs-split-sharetag">🔗 umumiy</span>}
                                      {!g.isSecond && (
                                        <button
                                          type="button"
                                          className="cs-split-x"
                                          title="Guruhni o'chirish"
                                          onClick={() => removePairGroup(s.id, g.gid)}
                                        >✕</button>
                                      )}
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">Guruh nomi</span>
                                      <input
                                        className="form-control"
                                        placeholder={`${num}-guruh`}
                                        value={g.name}
                                        onChange={e => setGroup(g, { name: e.target.value })}
                                      />
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">📚 Fan</span>
                                      <select
                                        className="form-control"
                                        value={g.subjectId || ""}
                                        onChange={e => setGroup(g, { subjectId: e.target.value })}
                                      >
                                        <option value="">— fanni tanlang —</option>
                                        {langSubjects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                      </select>
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">👨‍🏫 Ustoz</span>
                                      <select
                                        className="form-control"
                                        disabled={!g.subjectId}
                                        value={g.teacherId || ""}
                                        onChange={e => setGroup(g, { teacherId: e.target.value })}
                                      >
                                        <option value="">— ustozni tanlang —</option>
                                        {teachersForSubject(g.subjectId).filter(t => !bt.has(t.id))
                                          .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                      </select>
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">🚪 Xona</span>
                                      <select
                                        className="form-control"
                                        value={g.roomId || ""}
                                        onChange={e => setGroup(g, { roomId: e.target.value })}
                                      >
                                        <option value="">Xonasiz</option>
                                        {sortedRooms.filter(r => !br.has(r.id))
                                          .map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                      </select>
                                    </div>
                                    <label className={`cs-split-share ${g.shared ? "is-on" : ""}`}>
                                      <input
                                        type="checkbox"
                                        checked={Boolean(g.shared)}
                                        onChange={e => setShared(g, e.target.checked)}
                                      />
                                      <span>
                                        🔗 Parallel sinflarda umumiy
                                        <em>
                                          {g.shared
                                            ? " — bu guruh barcha parallel sinflarga BITTA dars"
                                            : " — har sinf o'z fanini o'qiydi"}
                                        </em>
                                      </span>
                                    </label>
                                  </div>
                                );
                              };

                              return (
                              <div className="cs-detail cs-pair-detail">
                                <div className="cs-pair-top">
                                  <div>
                                    <div className="cs-pair-title">🧩 Bir vaqtda {groupCount} fan</div>
                                    <div className="cs-pair-desc">
                                      Sinf <b>{groupCount} guruhga</b> bo'linadi va <b>ayni bir soatda</b> har guruh
                                      o'z fanini o'qiydi: 1-guruh <b>{s.name}</b>, qolganlari quyida tanlangan fanlarni.
                                      Guruhlar almashmaydi, hamma ustoz shu soatda band bo'ladi.
                                    </div>
                                  </div>
                                  <div className="cs-pair-badges">
                                    {members.length > 0 && (
                                      <div className="cs-pair-badge cs-pair-badge-link">🔗 {members.length + 1} sinf parallel</div>
                                    )}
                                    <div className="cs-pair-badge">haftada {hoursNow} soat</div>
                                  </div>
                                </div>

                                {/* Ko'rgazmali sxema — jadvalda qanday ko'rinishi */}
                                <div className="cs-pair-preview">
                                  <div className="cs-pair-slot">🕘 bitta soat</div>
                                  <div className="cs-pair-minis">
                                    <div className="cs-pair-mini cs-pair-mini-1">
                                      <span>{a.groupName1 || "1-guruh"}{members.length > 0 ? " · 🔗" : ""}</span>
                                      <b>{s.name}</b>
                                      <em>{nameOfTeacher(a.teacherId) || "ustoz tanlanmagan"}</em>
                                    </div>
                                    {slots.map((g, i) => (
                                      <div className={`cs-pair-mini ${i === 0 ? "cs-pair-mini-2" : "cs-pair-mini-x"}`} key={g.gid}>
                                        <span>{g.name}{g.shared && members.length > 0 ? " · 🔗" : ""}</span>
                                        <b>{nameOfSubject(g.subjectId) || "fan tanlanmagan"}</b>
                                        <em>{nameOfTeacher(g.teacherId) || "ustoz tanlanmagan"}</em>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div className="cs-split-groups" style={{ marginTop: 12 }}>
                                  {/* ——— 1-guruh: qatorning o'z fani, parallel sinflarda DOIM umumiy ——— */}
                                  <div className="cs-split-card cs-split-card-1">
                                    <div className="cs-split-head">
                                      <span className="cs-split-num">1</span>
                                      <span className="cs-split-headname">{s.name}</span>
                                      {members.length > 0 && <span className="cs-split-sharetag">🔗 umumiy</span>}
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">Guruh nomi</span>
                                      <input className="form-control" placeholder="1-guruh" value={a.groupName1 || "1-guruh"} onChange={e => updateAssignment(s.id, { groupName1: e.target.value })} />
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">👨‍🏫 Ustoz</span>
                                      <select className="form-control" value={a.teacherId || ""} onChange={e => updateAssignment(s.id, { teacherId: e.target.value })}>
                                        <option value="">— {s.name} ustozi —</option>
                                        {(() => {
                                          const bt = busyT("S|g1");
                                          return availableTeachers.filter(t => !bt.has(t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>);
                                        })()}
                                      </select>
                                    </div>
                                    <div className="cs-split-field">
                                      <span className="cs-split-label">🚪 Xona</span>
                                      <select className="form-control" value={a.roomId || ""} onChange={e => updateAssignment(s.id, { roomId: e.target.value })}>
                                        <option value="">Xonasiz</option>
                                        {(() => {
                                          const br = busyR("S|g1");
                                          return sortedRooms.filter(r => !br.has(r.id)).map(r => <option key={r.id} value={r.id}>{r.name}</option>);
                                        })()}
                                      </select>
                                    </div>
                                    <div className="cs-split-share is-fixed">
                                      <span>🔒 1-guruh parallel sinflarda har doim umumiy</span>
                                    </div>
                                  </div>

                                  {/* ——— 2-guruh, 3-guruh, 4-guruh… ——— */}
                                  {slots.map(renderGroupCard)}
                                </div>

                                {/* ➕ Yana fan (guruh) qo'shish */}
                                <div className="cs-group-add">
                                  {extras.length < PAIR_MAX_EXTRA_GROUPS ? (
                                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => addPairGroup(s.id)}>
                                      ➕ Yana fan qo'shish ({groupCount + 1}-guruh)
                                    </button>
                                  ) : (
                                    <span className="cs-pp-add-note">✔ Ko'pi bilan {PAIR_MAX_GROUPS} ta guruh</span>
                                  )}
                                  <span className="cs-group-add-note">
                                    Har bir guruhni alohida «🔗 Parallel sinflarda umumiy» qilish mumkin
                                  </span>
                                </div>

                                {/* ——— PARALLEL SINFLAR ———
                                    UMUMIY guruhlar tanlangan sinflarda BITTA dars bo'lib,
                                    bitta ustozdan o'tadi; qolgan guruhlarda esa har sinf
                                    O'Z fanini o'qiydi. */}
                                {(() => {
                                  const used = new Set([selectedClassId, ...members.map(m => m.cls.id)]);
                                  const addable = classesForSubject(s).filter(c => !used.has(c.id));
                                  const full = members.length >= PAIR_MAX_EXTRA;
                                  const sharedSlots = slots.filter(g => g.shared);
                                  const ownSlots = slots.filter(g => !g.shared);
                                  const g1Teacher = nameOfTeacher(a.teacherId) || "ustoz tanlanmagan";
                                  const chipsFor = (row) => (
                                    <div className="cs-pp-pairline">
                                      <span className="cs-pp-chip cs-pp-chip-1">1 · {s.name}</span>
                                      {slotsOf(row).map((g, i) => (
                                        <span className="cs-pp-chipwrap" key={g.gid}>
                                          <span className="cs-pp-plus">+</span>
                                          <span className={`cs-pp-chip ${i === 0 ? "cs-pp-chip-2" : "cs-pp-chip-x"}${g.shared ? " is-shared" : ""}`}>
                                            {i + 2} · {nameOfSubject(g.subjectId) || "fan tanlanmagan"}{g.shared ? " 🔗" : ""}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  );
                                  return (
                                    <div className="cs-pp">
                                      <div className="cs-pp-head">
                                        <div className="cs-pp-title">
                                          🔗 Parallel sinflar
                                          <span className="cs-pp-count">{members.length + 1} sinf</span>
                                        </div>
                                        <div className="cs-pp-desc">
                                          <b>{s.name}</b> (1-guruh) tanlangan sinflarda <b>bitta dars</b> bo'lib,
                                          ayni vaqtda va <b>bitta ustozdan</b> o'tadi.
                                          {sharedSlots.length > 0 && (
                                            <>
                                              {" "}Shuningdek <b>{sharedSlots.map(g => nameOfSubject(g.subjectId) || g.name).join(", ")}</b>
                                              {" "}guruhi ham umumiy — u ham hamma sinfga bitta dars.
                                            </>
                                          )}
                                          {ownSlots.length > 0 && (
                                            <>
                                              {" "}Qolgan guruhlarda ({ownSlots.map(g => g.name).join(", ")}) esa har sinf
                                              o'z fanini o'qiydi — fanlar sinfma-sinf har xil bo'lishi mumkin.
                                            </>
                                          )}
                                        </div>
                                      </div>

                                      {/* Guruhi sozlanmagan sinf kartadan TUSHIB QOLADI:
                                          generator uni alohida oddiy dars deb joylashtiradi,
                                          parallel bo'lmaydi va ustoz soati ikkilanadi. */}
                                      {(() => {
                                        const rows = [
                                          { name: selectedClass?.name || "Shu sinf", row: a },
                                          ...members.map(m => ({ name: m.cls.name, row: m.a })),
                                        ];
                                        const out = rows.filter(({ row }) => {
                                          const g2 = slotsOf(row).find(g => g.isSecond);
                                          return g2 && !g2.shared && (!g2.subjectId || !g2.teacherId);
                                        }).map(x => x.name);
                                        // 3-guruh va undan keyingilari: yarim sozlangani jadvalga chiqmaydi
                                        const half = [];
                                        rows.forEach(({ name, row }) => {
                                          slotsOf(row).forEach(g => {
                                            if (g.isSecond || g.shared) return;
                                            if (!g.subjectId && !g.teacherId) return;
                                            if (!g.subjectId || !g.teacherId) half.push(`${name} · ${g.name}`);
                                          });
                                        });
                                        if (!out.length && !half.length) return null;
                                        return (
                                          <div className="cs-pair-warn">
                                            {out.length > 0 && (
                                              <>⚠️ <b>{out.join(", ")}</b> — 2-guruh fani yoki ustozi tanlanmagan.
                                                Bunday sinf umumiy kartaga qo'shilmaydi: darsi alohida joylashadi.</>
                                            )}
                                            {out.length > 0 && half.length > 0 && <br />}
                                            {half.length > 0 && (
                                              <>⚠️ {half.join(" · ")} — fan yoki ustoz tanlanmagan, bu guruh jadvalga chiqmaydi.</>
                                            )}
                                          </div>
                                        );
                                      })()}

                                      <div className="cs-pp-list">
                                        {/* Joriy sinf — sozlamalari yuqoridagi kartalarda */}
                                        <div className="cs-pp-card is-owner">
                                          <div className="cs-pp-card-head">
                                            <span className="cs-pp-cls">{selectedClass?.name || "Sinf"}</span>
                                            <span className="cs-pp-tag">shu sinf</span>
                                          </div>
                                          {chipsFor(a)}
                                          <div className="cs-pp-hint">Sozlamalari yuqoridagi guruh kartalarida</div>
                                        </div>

                                        {members.map(({ cls, a: m }) => {
                                          const mSlots = slotsOf(m);
                                          const own = mSlots.filter(g => !g.shared);
                                          return (
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
                                              {chipsFor(m)}
                                              {own.length === 0 ? (
                                                <div className="cs-pp-hint">
                                                  Barcha guruhlar umumiy — bu sinfda alohida sozlash kerak emas
                                                </div>
                                              ) : own.map((g) => {
                                                const num = mSlots.indexOf(g) + 2;
                                                const key = slotKey(g.gid, false, cls.id);
                                                const bt = busyT(key);
                                                const br = busyR(key);
                                                return (
                                                  <div className="cs-pp-groupbox" key={g.gid}>
                                                    <div className="cs-pp-groupname">
                                                      <span className="cs-split-num">{num}</span> {g.name}
                                                    </div>
                                                    <div className="cs-pp-fields">
                                                      <label className="cs-pp-field">
                                                        <span className="cs-split-label">📚 Fan</span>
                                                        <select
                                                          className="form-control"
                                                          value={g.subjectId || ""}
                                                          onChange={e => setGroup(g, { subjectId: e.target.value }, cls.id)}
                                                        >
                                                          <option value="">— fanni tanlang —</option>
                                                          {sortByName(subjects.filter(x => subjectFitsLang(x, classLangOf(cls))))
                                                            .map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                                        </select>
                                                      </label>
                                                      <label className="cs-pp-field">
                                                        <span className="cs-split-label">👨‍🏫 Ustoz</span>
                                                        <select
                                                          className="form-control"
                                                          disabled={!g.subjectId}
                                                          value={g.teacherId || ""}
                                                          onChange={e => setGroup(g, { teacherId: e.target.value }, cls.id)}
                                                        >
                                                          <option value="">— ustozni tanlang —</option>
                                                          {teachersForSubject(g.subjectId).filter(t => !bt.has(t.id))
                                                            .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                                        </select>
                                                      </label>
                                                      <label className="cs-pp-field">
                                                        <span className="cs-split-label">🚪 Xona</span>
                                                        <select
                                                          className="form-control"
                                                          value={g.roomId || ""}
                                                          onChange={e => setGroup(g, { roomId: e.target.value }, cls.id)}
                                                        >
                                                          <option value="">Xonasiz</option>
                                                          {sortedRooms.filter(r => !br.has(r.id))
                                                            .map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                                        </select>
                                                      </label>
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                              <div className="cs-pp-shared">
                                                1-guruh: <b>{s.name}</b> · {g1Teacher} · haftada {hoursNow} soat
                                                <em> — {selectedClass?.name} bilan bir xil</em>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>

                                      <div className="cs-pp-add">
                                        {full ? (
                                          <span className="cs-pp-add-note">
                                            ✔ Guruh to'ldi — bir guruhga ko'pi bilan {PAIR_MAX_EXTRA + 1} ta sinf kiradi
                                          </span>
                                        ) : addable.length ? (
                                          <>
                                            <span className="cs-pp-add-label" title="Bu yerdan qo'shilgan sinfda 2-guruh va keyingilari ALOHIDA tanlanadi (1-guruh baribir umumiy)">➕ Parallel sinf qo'shish</span>
                                            <select
                                              className="form-control cs-pp-add-select"
                                              value=""
                                              onChange={e => addPairClass(s.id, e.target.value)}
                                            >
                                              <option value="">— sinfni tanlang —</option>
                                              {addable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                            <button type="button" className="btn btn-secondary btn-sm"
                                              onClick={() => autoPairParallelSameGrade(s.id)}
                                              title="Shu darajadagi barcha parallel sinflarni (masalan 11-A, 11-B, 11-V) bitta kartaga bog'lash">
                                              ⚡ Barcha parallellarini bog'lash
                                            </button>
                                            {/* Ikki kirish yo'lining farqi ko'rinib tursin */}
                                            <span className="cs-pp-add-hint">
                                              Bu yerdan qo'shilgan sinfda <b>2-guruh va keyingilari alohida</b> tanlanadi
                                              (1-guruh baribir umumiy). Kartadagi hamma fan bir xil bo'lishi kerak bo'lsa —
                                              tepadagi «🔁 Parallel dars» ro'yxatidan qo'shing.
                                            </span>
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
                                  if (!a.teacherId) warns.push(`${s.name} uchun ustoz tanlanmagan`);
                                  if (!a.pairSubjectId) warns.push("2-fan tanlanmagan");

                                  // Kartadagi hamma guruh bir vaqtda o'qiydi — ustoz
                                  // ham, xona ham takrorlanmasligi shart.
                                  const tSeen = new Map();
                                  const rSeen = new Map();
                                  const seenSlot = new Set();
                                  const here = selectedClass?.name || "shu sinf";
                                  if (a.teacherId) tSeen.set(a.teacherId, `${here} 1-guruhi`);
                                  if (a.roomId) rSeen.set(a.roomId, `${here} 1-guruhi`);

                                  const checkRow = (clsName, classId, row) => {
                                    slotsOf(row).forEach((g, i) => {
                                      const num = i + 2;
                                      const key = slotKey(g.gid, g.shared, classId);
                                      if (seenSlot.has(key)) return;
                                      seenSlot.add(key);
                                      const where = g.shared ? `${g.name} (umumiy)` : `${clsName} ${g.name}`;
                                      if (!g.subjectId) {
                                        if (num > 2) warns.push(`${where}: fan tanlanmagan`);
                                        else if (classId !== selectedClassId) warns.push(`${where}: fan tanlanmagan`);
                                        return;
                                      }
                                      if (!g.teacherId) warns.push(`${where}: ustoz tanlanmagan`);
                                      // Bir xil fan bir nechta guruhda turishi MUMKIN
                                      // (boshqa ustoz kiradi) — bu xato emas.
                                      // Faqat kartadan TASHQARIDA alohida belgilangan
                                      // bo'lsa ogohlantiramiz: soat ikki marta sanaladi.
                                      if (g.subjectId !== s.id
                                        && (classSubjects[classId] || []).some(x => x.subjectId === g.subjectId)) {
                                        warns.push(`${clsName}: «${nameOfSubject(g.subjectId)}» ro'yxatda alohida ham belgilangan — belgini olib tashlang`);
                                      }
                                      if (g.teacherId) {
                                        if (tSeen.has(g.teacherId)) {
                                          warns.push(`${nameOfTeacher(g.teacherId) || "Ustoz"} bir vaqtda ikki joyda: ${tSeen.get(g.teacherId)} va ${where}`);
                                        } else tSeen.set(g.teacherId, where);
                                      }
                                      if (g.roomId) {
                                        if (rSeen.has(g.roomId)) {
                                          warns.push(`${nameOfRoom(g.roomId) || "Xona"} xonasi bir vaqtda ikki guruhga berilgan: ${rSeen.get(g.roomId)} va ${where}`);
                                        } else rSeen.set(g.roomId, where);
                                      }
                                    });
                                  };
                                  checkRow(here, selectedClassId, a);
                                  members.forEach(({ cls, a: m }) => checkRow(cls.name, cls.id, m));

                                  if (!warns.length) return null;
                                  return (
                                    <div className="cs-pair-warn">
                                      ⚠️ {warns.join(" · ")}
                                    </div>
                                  );
                                })()}

                                <div className="cs-split-note" style={{ marginTop: 10 }}>
                                  💡 <b>Guruh fanlarini ro'yxatdan alohida belgilamang</b> — ularning soati va
                                  ustozi shu yerdan olinadi. Jadvalda bu dars bitta katakda bir nechta qator
                                  bo'lib ko'rinadi va ko'chirilganda hammasi birga ko'chadi.
                                </div>
                              </div>
                              );
                            })()}

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
                                    {classesForSubject(s).map(c => {
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
        // Hovuzga faqat fan tiliga mos sinflar qo'shiladi (alifbo bo'yicha).
        // Umumiy fan uchun barcha sinflar ochiq.
        const sortedC = poolLang === LANG_BOTH ? sortedClasses : sortByName(classes.filter(c => classLangOf(c) === poolLang));
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
                {sortedAllSubjects.map((s) => <option key={s.id} value={s.id}>{langIcon(subjectLangOf(s))} {s.name}</option>)}
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
                    Bu fan tiliga ({langLabel(poolLang)}) mos sinf topilmadi
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

              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "12px 14px", marginBottom: 14, fontSize: 13, lineHeight: 1.6, color: "#1e40af" }}>
                🎓 <b>1–4 sinfda</b> fanlar <b>sinf rahbariga</b> avtomatik biriktiriladi —
                chet tili, jismoniy tarbiya va informatikadan tashqari (ular mutaxassis ustozniki).
                <b> «Kelajak soati»</b> esa 1–11 sinfda sinf rahbarida bo'ladi.
                Biriktirilgan fanlar ustozning o'z fanlari ro'yxatiga ham qo'shiladi.
                Rahbari belgilanmagan sinfda ustoz bo'sh qoladi.
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
