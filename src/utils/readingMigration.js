// =====================================================================
//  «ALIFBE» → «O'QISH» / «ЧТЕНИЕ» (2–4 SINFLAR) — BIR MARTALIK KO'CHIRISH
//
//  «Alifbe» («Азбука» / «Букварь») faqat 1-sinf fani. 2–4 sinflarda
//  uning o'rniga o'zbek sinfida «O'qish», rus sinfida «Чтение» bo'ladi.
//  Ko'p maktab jadvalni tuzib bo'lgan va 2–4 sinflarda Alifbe yoqilib
//  qolgan — shu funksiya ularni joyida almashtiradi:
//
//    • «Sinf fanlari» yozuvi — fan id'si almashadi, qolgan HAMMA sozlama
//      (soat, ustoz, xona, guruhlar, blok) saqlanadi;
//    • joriy dars jadvali — shu sinflardagi Alifbe darslari o'sha
//      katakda O'qish/Чтение bo'lib qoladi (jadvalni qayta tuzish shart emas);
//    • ustoz kartochkasi — yangi fan ustozning fanlariga qo'shiladi
//      (aks holda fan qatoridagi ro'yxatda ustoz ko'rinmay qolardi);
//    • maqsad fan maktabda bo'lmasa — yaratiladi.
//
//  1-sinf va saqlangan jadval nusxalariga TEGILMAYDI.
//  Chaqiruvchi: App.jsx (settings.migrations.alifbeReading bayrog'i bilan
//  bir marta). Funksiya sof — kirishni o'zgartirmaydi.
// =====================================================================

import { normName, isFirstGradeOnlyName } from "./curriculum";
import { classLangOf, subjectLangOf, subjectFitsLang } from "./eduLang";
import { genId } from "./helpers";

// 2–4 sinflarda Alifbe o'rnidagi fan nomi — sinf tiliga qarab
export const READING_NAMES = { uz: "O'qish", ru: "Чтение" };
export const READING_GRADES = [2, 3, 4];

// Ustuvor nomlar: avval aynan «O'qish»/«Чтение», keyin rasmiy nomlar
const READING_ALIASES = {
  uz: ["O'qish", "O'qish savodxonligi"],
  ru: ["Чтение", "Литературное чтение", "Грамотность чтения"],
};

export function isReadingName(name) {
  const k = normName(name);
  return k === normName(READING_NAMES.uz) || k === normName(READING_NAMES.ru);
}

function gradeOf(name) {
  const m = String(name || "").match(/^\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

// Sinf tiliga mos o'qish fani: avval aynan shu tildagi, keyin «umumiy»
// (both); nomlar ustuvorlik tartibida. Topilmasa — null.
export function findReadingSubject(subjects, lang) {
  const list = Array.isArray(subjects) ? subjects : [];
  for (const nom of READING_ALIASES[lang] || READING_ALIASES.uz) {
    const k = normName(nom);
    const mos = list.filter((s) => normName(s?.name) === k && subjectFitsLang(s, lang));
    if (mos.length) return mos.find((s) => subjectLangOf(s) === lang) || mos[0];
  }
  return null;
}

// Yozuvdagi fanga ishora qiluvchi maydonlar (asosiy + guruh fanlari)
const SUBJECT_KEYS = ["subjectId", "pairSubjectId", "swapSubjectId", "weekAltSubjectId", "altSubjectId"];
// Yozuvdagi ustozlar — yangi fan ularning kartochkasiga qo'shiladi
const TEACHER_KEYS = ["teacherId", "teacherId2", "swapNextTeacherId", "altTeacherId"];

export function migrateAlifbeToReading({ classes, subjects, teachers, classSubjects, schedule, uid }) {
  const alifbeIds = new Set((subjects || []).filter((s) => isFirstGradeOnlyName(s?.name)).map((s) => s.id));
  const empty = { changed: false };
  if (!alifbeIds.size) return empty;

  const nextSubjects = [...(subjects || [])];
  const created = [];
  const targetFor = new Map();   // lang → fan
  const target = (lang, sample) => {
    if (targetFor.has(lang)) return targetFor.get(lang);
    let s = findReadingSubject(nextSubjects, lang);
    if (!s) {
      s = {
        id: genId(),
        name: READING_NAMES[lang] || READING_NAMES.uz,
        weeklyHours: Number(sample?.weeklyHours) || 3,
        color: sample?.color,
        type: "Oddiy",
        allowDouble: false,
        lang,
        source: "custom",
        ownerId: uid || null,
        createdAt: Date.now(),
      };
      nextSubjects.push(s);
      created.push(s);
    }
    targetFor.set(lang, s);
    return s;
  };
  const subjById = new Map((subjects || []).map((s) => [s.id, s]));

  // Qaysi sinfda qaysi fan maqsad: classId → targetId
  const classTarget = new Map();
  (classes || []).forEach((c) => {
    if (!READING_GRADES.includes(gradeOf(c?.name))) return;
    const list = classSubjects?.[c.id] || [];
    const has = list.some((a) => SUBJECT_KEYS.some((k) => alifbeIds.has(a?.[k]))
      || (Array.isArray(a?.pairExtra) && a.pairExtra.some((g) => alifbeIds.has(g?.subjectId))));
    // Jadvalda Alifbe darsi qolgan bo'lsa ham sinf qamrovga olinadi
    if (!has && !scheduleHasAlifbe(schedule, c.id, alifbeIds)) return;
    const lang = classLangOf(c);
    const sample = subjById.get(list.find((a) => alifbeIds.has(a?.subjectId))?.subjectId);
    classTarget.set(c.id, target(lang, sample).id);
  });
  if (!classTarget.size) return empty;

  // ——— Sinf fanlari ———
  const teacherAdd = new Map();  // teacherId → Set(fanId)
  const noteTeacher = (tid, sid) => {
    if (!tid) return;
    if (!teacherAdd.has(tid)) teacherAdd.set(tid, new Set());
    teacherAdd.get(tid).add(sid);
  };
  let rows = 0;
  let merged = 0;
  const nextCS = { ...(classSubjects || {}) };
  classTarget.forEach((tId, classId) => {
    const list = nextCS[classId] || [];
    const hasTarget = list.some((a) => a?.subjectId === tId);
    const out = [];
    list.forEach((a) => {
      if (!a) { out.push(a); return; }
      if (alifbeIds.has(a.subjectId) && hasTarget) {
        // O'qish allaqachon yoqilgan — Alifbe ortiqcha, olib tashlanadi
        merged += 1;
        return;
      }
      let b = a;
      SUBJECT_KEYS.forEach((k) => {
        if (alifbeIds.has(b[k])) b = { ...b, [k]: tId };
      });
      if (Array.isArray(b.pairExtra) && b.pairExtra.some((g) => alifbeIds.has(g?.subjectId))) {
        b = { ...b, pairExtra: b.pairExtra.map((g) => (alifbeIds.has(g?.subjectId) ? { ...g, subjectId: tId } : g)) };
      }
      if (b !== a) {
        rows += 1;
        TEACHER_KEYS.forEach((k) => noteTeacher(b[k], tId));
        (Array.isArray(b.levelGroups) ? b.levelGroups : []).forEach((g) => noteTeacher(g?.teacherId, tId));
        if (b.pairSubjectId === tId) noteTeacher(b.pairTeacherId, tId);
        if (b.swapSubjectId === tId) noteTeacher(b.swapTeacherId, tId);
        (b.pairExtra || []).forEach((g) => { if (g?.subjectId === tId) noteTeacher(g.teacherId, tId); });
      }
      out.push(b);
    });
    nextCS[classId] = out;
  });

  // ——— Joriy dars jadvali ———
  let lessons = 0;
  const nextSchedule = {};
  Object.entries(schedule || {}).forEach(([day, slots]) => {
    const ds = {};
    Object.entries(slots || {}).forEach(([ts, list]) => {
      ds[ts] = Array.isArray(list) ? list.map((l) => {
        if (!l) return l;
        const cid = [l.classId, ...(Array.isArray(l.classIds) ? l.classIds : [])].find((id) => classTarget.has(id));
        if (!cid) return l;
        const tId = classTarget.get(cid);
        let m = l;
        SUBJECT_KEYS.forEach((k) => { if (alifbeIds.has(m[k])) m = { ...m, [k]: tId }; });
        if (m !== l) {
          lessons += 1;
          noteTeacher(m.teacherId, tId);
          noteTeacher(m.teacherId2, tId);
        }
        return m;
      }) : list;
    });
    nextSchedule[day] = ds;
  });

  // ——— Ustoz kartochkalari ———
  let teachersTouched = 0;
  const nextTeachers = (teachers || []).map((t) => {
    const add = teacherAdd.get(t.id);
    if (!add) return t;
    const cur = Array.isArray(t.subjectIds) ? t.subjectIds : (t.subjectId ? [t.subjectId] : []);
    const all = [...new Set([...cur, ...add])];
    if (all.length === cur.length) return t;
    teachersTouched += 1;
    return { ...t, subjectIds: all };
  });

  const changed = rows > 0 || merged > 0 || lessons > 0 || created.length > 0 || teachersTouched > 0;
  return {
    changed,
    subjects: nextSubjects,
    teachers: nextTeachers,
    classSubjects: nextCS,
    schedule: lessons ? nextSchedule : schedule,
    stats: { classes: classTarget.size, rows, merged, lessons, created: created.map((s) => s.name), teachers: teachersTouched },
  };
}

function scheduleHasAlifbe(schedule, classId, alifbeIds) {
  for (const slots of Object.values(schedule || {})) {
    for (const list of Object.values(slots || {})) {
      if (!Array.isArray(list)) continue;
      for (const l of list) {
        if (!l || !alifbeIds.has(l.subjectId)) continue;
        if (l.classId === classId || (Array.isArray(l.classIds) && l.classIds.includes(classId))) return true;
      }
    }
  }
  return false;
}
