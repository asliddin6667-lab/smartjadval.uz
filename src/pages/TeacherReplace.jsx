import { useMemo, useState } from "react";
import { DAYS } from "../utils/constants";
import {
  countTeacherInClassSubjects,
  pairsWithTeacherInSubjects,
  pairKey,
} from "../utils/replaceTeacherSubjects";
import {
  todayISO, isoAddDays, daysInclusive, fmtDate,
  makeSubstitution, applySubstitution, revertSubstitution,
  SUB_STATUS, isLive,
} from "../utils/teacherSubstitutions";
import { sortTeachers, cmpName } from "../utils/sortHelpers";
import { slotDisplayNumber } from "../utils/shiftSlots";

// =====================================================================
//  USTOZ ALMASHTIRISH SAHIFASI
//
//  Oqim:  ketgan ustoz → yangi ustoz → qaysi SINF va FAN → qancha MUDDAT
//         → ko'rish → tasdiqlash.
//
//  • Sinf ichida FAN tanlanadi: bitta ustoz 7-A da ham matematika, ham
//    informatika o'qitsa — faqat kerakli fan ko'chiriladi.
//  • Muddat: "Doimiy" (ustoz butunlay ketdi) yoki "Vaqtincha" (sanadan
//    sanagacha). Vaqtinchalik almashtirish muddati tugagach darslar ESKI
//    ustozga o'zi qaytadi — [teacherSubstitutions.js](../utils/teacherSubstitutions.js),
//    qaytarishni App.jsx dagi avtomatik tekshiruv bajaradi.
//  • Har bir almashtirish `substitutions` ro'yxatida yozuv sifatida
//    qoladi: pastdagi "Amaldagi almashtirishlar" bo'limida ko'rinadi,
//    qo'lda qaytarish / bekor qilish / muddatini o'zgartirish mumkin.
// =====================================================================

function classIdsOf(lesson) {
  return Array.isArray(lesson?.classIds) ? lesson.classIds : [lesson?.classId].filter(Boolean);
}

// Tez tanlovlar — boshlanish sanasidan boshlab necha kun
const PRESETS = [
  { label: "3 kun", days: 3 },
  { label: "1 hafta", days: 7 },
  { label: "2 hafta", days: 14 },
  { label: "1 oy", days: 30 },
];

export default function TeacherReplacePage({
  classes = [],
  subjects = [],
  teachers = [],
  timeslots = [],
  lunchGroups = [],
  schedule = {},
  classSubjects = {},
  substitutions = [],
  setSchedule,
  setClassSubjects,
  setSubstitutions,
  toast,
}) {
  const today = todayISO();

  const [oldTeacherId, setOldTeacherId] = useState("");
  const [newTeacherId, setNewTeacherId] = useState("");
  const [scope, setScope] = useState("all");        // "all" | "some"
  const [picked, setPicked] = useState([]);         // tanlangan (sinf, fan) kalitlari
  const [mode, setMode] = useState("temporary");    // "temporary" | "permanent"
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(isoAddDays(today, 6));
  const [result, setResult] = useState(null);       // oldindan ko'rish natijasi
  const [showHistory, setShowHistory] = useState(false);
  const [confirmId, setConfirmId] = useState("");   // ro'yxatdagi yozuv uchun tasdiq

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  const sortedTimeslots = useMemo(() => [...timeslots].sort((a, b) => (
    Number(a.lessonNumber || 0) - Number(b.lessonNumber || 0)
  )), [timeslots]);

  const subjName = (sid) => subjectMap.get(sid)?.name || "Fan";
  const teacherName = (tid) => teacherMap.get(tid)?.name || "—";
  const className = (cid) => classMap.get(cid)?.name || cid;
  const slotNum = (tsId) => slotDisplayNumber(sortedTimeslots.find((s) => s.id === tsId)) || "?";
  const clsNames = (ids) => (ids || []).map((id) => classMap.get(id)?.name).filter(Boolean).join(", ");

  // ——— Ketgan ustozning jadvaldagi darslari ———
  const oldTeacherLessons = useMemo(() => {
    if (!oldTeacherId) return [];
    const out = [];
    DAYS.forEach((day) => sortedTimeslots.forEach((ts) => {
      (schedule?.[day]?.[ts.id] || []).forEach((l) => {
        if (l.teacherId === oldTeacherId) out.push({ day, tsId: ts.id, lesson: l });
      });
    }));
    return out;
  }, [oldTeacherId, schedule, sortedTimeslots]);

  // ——— Sinf → fanlar daraxti (jadval ∪ sinf fanlari) ———
  const classGroups = useMemo(() => {
    if (!oldTeacherId) return [];
    const byPair = new Map();
    oldTeacherLessons.forEach(({ lesson }) => classIdsOf(lesson).forEach((cid) => {
      const k = pairKey(cid, lesson.subjectId);
      const e = byPair.get(k) || { key: k, classId: cid, subjectId: lesson.subjectId, lessons: 0, inCs: false };
      e.lessons += 1;
      byPair.set(k, e);
    }));
    pairsWithTeacherInSubjects(classSubjects, oldTeacherId).forEach((p) => {
      const k = pairKey(p.classId, p.subjectId);
      const e = byPair.get(k) || { key: k, classId: p.classId, subjectId: p.subjectId, lessons: 0, inCs: false };
      e.inCs = true;
      byPair.set(k, e);
    });
    const byClass = new Map();
    byPair.forEach((e) => {
      if (!classMap.has(e.classId)) return;
      const g = byClass.get(e.classId) || { classId: e.classId, name: className(e.classId), pairs: [], lessons: 0 };
      g.pairs.push(e);
      g.lessons += e.lessons;
      byClass.set(e.classId, g);
    });
    return [...byClass.values()]
      .sort((a, b) => cmpName(a.name, b.name))
      .map((g) => ({ ...g, pairs: g.pairs.sort((a, b) => cmpName(subjName(a.subjectId), subjName(b.subjectId))) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldTeacherId, oldTeacherLessons, classSubjects, classMap, subjectMap]);

  const allPairs = useMemo(() => classGroups.flatMap((g) => g.pairs), [classGroups]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);

  // Tanlangan (sinf, fan) juftlari — null = hammasi
  const effectivePairs = useMemo(() => {
    if (scope === "all") return null;
    return allPairs.filter((p) => pickedSet.has(p.key)).map((p) => ({ classId: p.classId, subjectId: p.subjectId }));
  }, [scope, allPairs, pickedSet]);

  const nothingPicked = scope === "some" && picked.length === 0;

  // Ko'chiriladigan darslar soni
  const targetCount = useMemo(() => {
    if (scope === "all") return oldTeacherLessons.length;
    if (nothingPicked) return 0;
    return oldTeacherLessons.filter(({ lesson }) =>
      classIdsOf(lesson).some((cid) => pickedSet.has(pairKey(cid, lesson.subjectId)))).length;
  }, [scope, nothingPicked, oldTeacherLessons, pickedSet]);

  // "Sinf fanlari"da nechta yozuv yangilanadi
  const csCount = useMemo(() => {
    if (nothingPicked) return 0;
    return countTeacherInClassSubjects({ classSubjects, oldTeacherId, pairs: effectivePairs });
  }, [classSubjects, oldTeacherId, effectivePairs, nothingPicked]);

  // ——— Ro'yxatlar ———
  const teachersWithWork = useMemo(() => {
    const inSchedule = new Set();
    DAYS.forEach((day) => sortedTimeslots.forEach((ts) => {
      (schedule?.[day]?.[ts.id] || []).forEach((l) => { if (l.teacherId) inSchedule.add(l.teacherId); });
    }));
    return sortTeachers(teachers.filter((t) => (
      inSchedule.has(t.id) || countTeacherInClassSubjects({ classSubjects, oldTeacherId: t.id }) > 0
    )));
  }, [teachers, schedule, sortedTimeslots, classSubjects]);

  const sortedTeachers = useMemo(() => sortTeachers(teachers), [teachers]);

  function totalTeacherLessons(tid) {
    let n = 0;
    DAYS.forEach((day) => sortedTimeslots.forEach((ts) => {
      (schedule?.[day]?.[ts.id] || []).forEach((l) => { if (l.teacherId === tid) n += 1; });
    }));
    return n;
  }

  // ——— Tanlov amallari ———
  function resetForm() {
    setOldTeacherId("");
    setNewTeacherId("");
    setScope("all");
    setPicked([]);
    setResult(null);
  }

  function chooseOld(v) {
    setOldTeacherId(v);
    setPicked([]);
    setScope("all");
    setResult(null);
  }

  function togglePair(key) {
    setPicked((prev) => prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]);
    setResult(null);
  }

  function toggleClassAll(g) {
    const keys = g.pairs.map((p) => p.key);
    const allOn = keys.every((k) => pickedSet.has(k));
    setPicked((prev) => allOn ? prev.filter((k) => !keys.includes(k)) : [...new Set([...prev, ...keys])]);
    setResult(null);
  }

  function applyPreset(days) {
    const start = startDate || today;
    setEndDate(isoAddDays(start, days - 1));
    setResult(null);
  }

  // ——— Muddat tekshiruvi ———
  const dateError = mode !== "temporary" ? "" :
    (!startDate || !endDate) ? "Boshlanish va tugash sanasini kiriting" :
    endDate < startDate ? "Tugash sanasi boshlanishdan oldin bo'lmasin" :
    endDate < today ? "Tugash sanasi o'tib ketgan — bugundan keyingi sana tanlang" : "";
  const isScheduled = mode === "temporary" && !dateError && startDate > today;
  const durationDays = mode === "temporary" && !dateError ? daysInclusive(startDate, endDate) : 0;
  const revertOn = mode === "temporary" && !dateError ? isoAddDays(endDate, 1) : "";

  // ——— Ogohlantirishlar ———
  const oldT = teacherMap.get(oldTeacherId);
  const newT = teacherMap.get(newTeacherId);

  const uncovered = useMemo(() => {
    if (!oldT || !newT) return [];
    const newSubj = new Set(Array.isArray(newT.subjectIds) ? newT.subjectIds : (newT.subjectId ? [newT.subjectId] : []));
    const used = new Set(
      (scope === "all" ? allPairs : allPairs.filter((p) => pickedSet.has(p.key))).map((p) => p.subjectId)
    );
    return [...used].filter((sid) => sid && !newSubj.has(sid));
  }, [oldT, newT, scope, allPairs, pickedSet]);

  // Shu ustoz uchun allaqachon amaldagi/rejalashtirilgan yozuv bormi?
  const liveForOld = useMemo(() => (
    (substitutions || []).filter((s) => s.oldTeacherId === oldTeacherId && (isLive(s) || s.status === SUB_STATUS.SCHEDULED))
  ), [substitutions, oldTeacherId]);

  const canRun = !nothingPicked && (targetCount > 0 || csCount > 0) && !dateError;

  // ——— Oldindan ko'rish ———
  function buildDraft() {
    return makeSubstitution({
      oldTeacherId, newTeacherId, mode, startDate, endDate, pairs: effectivePairs, today,
    });
  }

  function preview() {
    if (!oldTeacherId || !newTeacherId) { toast?.("Eski va yangi o'qituvchini tanlang", "warning"); return; }
    if (oldTeacherId === newTeacherId) { toast?.("Eski va yangi o'qituvchi bir xil bo'lmasin", "warning"); return; }
    if (nothingPicked) { toast?.("Kamida bitta sinf va fan tanlang", "warning"); return; }
    if (dateError) { toast?.(dateError, "warning"); return; }
    const draft = buildDraft();
    const out = applySubstitution({ sub: draft, schedule, classSubjects, timeslots, teachers, classes, lunchGroups });
    if (!out.ok) { toast?.(out.error || "Xatolik", "warning"); return; }
    setResult({ draft, out });
  }

  // ——— Qo'llash ———
  function apply() {
    if (!result) return;
    const draft = buildDraft();

    // Boshlanish sanasi kelajakda — hozir hech narsa o'zgarmaydi,
    // yozuv saqlanadi, App.jsx o'sha kuni o'zi qo'llaydi.
    if (draft.status === SUB_STATUS.SCHEDULED) {
      setSubstitutions?.([draft, ...(substitutions || [])]);
      toast?.(`Rejalashtirildi: ${fmtDate(draft.startDate)} kuni darslar ${teacherName(newTeacherId)}ga o'tadi, ${fmtDate(revertOn)} kuni ${teacherName(oldTeacherId)}ga qaytadi ✓`, "success");
      resetForm();
      return;
    }

    // Joriy ma'lumot bo'yicha qayta hisoblaymiz (ko'rishdan keyin jadval o'zgargan bo'lishi mumkin)
    const out = applySubstitution({ sub: draft, schedule, classSubjects, timeslots, teachers, classes, lunchGroups });
    if (!out.ok) { toast?.(out.error || "Xatolik", "warning"); return; }

    setSchedule?.(out.schedule);
    if (out.sub.applied?.cs > 0) setClassSubjects?.(out.classSubjects);
    setSubstitutions?.([out.sub, ...(substitutions || [])]);

    const a = out.sub.applied || {};
    const moved = (a.inPlace || 0) + (a.swapped || 0);
    const csTxt = a.cs > 0 ? `, sinf fanlarida ${a.cs} yozuv` : "";
    const tail = draft.mode === "temporary" ? ` · ${fmtDate(revertOn)} kuni eski ustozga qaytadi` : "";
    if (a.failed > 0) {
      toast?.(`${moved} dars o'tkazildi, ${a.failed} tasi eski ustozda qoldi${csTxt}${tail}`, "warning");
    } else if (moved === 0 && a.cs > 0) {
      toast?.(`Sinf fanlarida ${a.cs} yozuv yangi ustozga o'tkazildi ✓${tail}`, "success");
    } else {
      toast?.(`O'qituvchi almashtirildi ✓ (${a.inPlace} joyida, ${a.swapped} o'rin almashdi)${csTxt}${tail}`, "success");
    }
    resetForm();
  }

  // ——— Ro'yxat amallari ———
  function revertNow(sub) {
    const r = revertSubstitution({ sub, schedule, classSubjects });
    setSchedule?.(r.schedule);
    if (r.summary.cs > 0) setClassSubjects?.(r.classSubjects);
    setSubstitutions?.((substitutions || []).map((s) => (s.id === sub.id ? r.sub : s)));
    setConfirmId("");
    const s = r.summary;
    const issues = [];
    if (s.conflicts > 0) issues.push(`${s.conflicts} soatda ustoz ziddiyati`);
    if (s.missing > 0) issues.push(`${s.missing} dars topilmadi`);
    toast?.(
      `Darslar ${teacherName(sub.oldTeacherId)}ga qaytarildi (${s.renamed + s.movedBack} dars${s.cs ? `, ${s.cs} sinf fani` : ""})`
        + (issues.length ? ` — ${issues.join(", ")}, jadvalni tekshiring` : " ✓"),
      issues.length ? "warning" : "success"
    );
  }

  function removeSub(sub) {
    setSubstitutions?.((substitutions || []).filter((s) => s.id !== sub.id));
    setConfirmId("");
  }

  function patchSub(sub, patch) {
    setSubstitutions?.((substitutions || []).map((s) => (s.id === sub.id ? { ...s, ...patch } : s)));
  }

  function describeScope(sub) {
    if (!sub.pairs || !sub.pairs.length) return "Barcha darslar";
    const byClass = new Map();
    sub.pairs.forEach((p) => {
      const list = byClass.get(p.classId) || [];
      list.push(subjName(p.subjectId));
      byClass.set(p.classId, list);
    });
    return [...byClass.entries()]
      .sort((a, b) => cmpName(className(a[0]), className(b[0])))
      .map(([cid, list]) => `${className(cid)}: ${list.join(", ")}`)
      .join(" · ");
  }

  const liveSubs = useMemo(() => (
    [...(substitutions || [])]
      .filter((s) => isLive(s) || s.status === SUB_STATUS.SCHEDULED)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
  ), [substitutions]);
  const historySubs = useMemo(() => (
    [...(substitutions || [])]
      .filter((s) => s.status === SUB_STATUS.REVERTED)
      .sort((a, b) => String(b.revertedAt || b.createdAt || "").localeCompare(String(a.revertedAt || a.createdAt || "")))
  ), [substitutions]);

  const activeCount = liveSubs.filter((s) => s.status === SUB_STATUS.ACTIVE).length;
  const scheduledCount = liveSubs.filter((s) => s.status === SUB_STATUS.SCHEDULED).length;

  const preview_ = result?.out?.preview;
  const summary = preview_?.summary;

  return (
    <div className="tr-page">
      <style>{`
        .tr-page{max-width:none;width:100%;}

        /* ——— Hero ——— */
        .tr-hero{position:relative;overflow:hidden;border-radius:22px;padding:26px 28px;margin-bottom:22px;
          background:linear-gradient(120deg,rgba(99,102,241,.14),rgba(139,92,246,.12) 55%,rgba(16,185,129,.10));
          border:1px solid rgba(99,102,241,.18);}
        .tr-hero::after{content:"";position:absolute;right:-40px;top:-40px;width:220px;height:220px;border-radius:50%;
          background:radial-gradient(circle,rgba(139,92,246,.18),transparent 70%);pointer-events:none;}
        .tr-hero-row{display:flex;align-items:center;gap:18px;position:relative;z-index:1;flex-wrap:wrap;}
        .tr-hero-badge{flex-shrink:0;width:60px;height:60px;border-radius:18px;display:flex;align-items:center;justify-content:center;
          font-size:30px;background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 10px 26px rgba(99,102,241,.4);}
        .tr-hero h1{margin:0 0 4px;font-size:26px;font-weight:800;letter-spacing:-.5px;color:var(--text-primary,#0f172a);}
        .tr-hero p{margin:0;font-size:14px;line-height:1.5;color:var(--text-secondary,#475569);max-width:680px;}
        .tr-hero-text{flex:1;min-width:260px;}
        .tr-hero-pills{display:flex;gap:8px;flex-wrap:wrap;}
        .tr-pill{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;font-size:12.5px;font-weight:800;
          background:var(--card-bg,#fff);border:1px solid var(--card-border,#e2e8f0);color:var(--text-secondary,#475569);box-shadow:0 2px 8px rgba(15,23,42,.05);}
        .tr-pill i{width:8px;height:8px;border-radius:50%;display:inline-block;}
        .tr-pill.active i{background:#10b981;box-shadow:0 0 0 4px rgba(16,185,129,.18);}
        .tr-pill.sched i{background:#3b82f6;box-shadow:0 0 0 4px rgba(59,130,246,.18);}

        .tr-card{background:var(--card-bg,#fff);border:1px solid var(--card-border,#e2e8f0);border-radius:20px;padding:24px;margin-bottom:18px;
          box-shadow:0 1px 3px rgba(15,23,42,.04),0 8px 24px rgba(15,23,42,.04);}

        /* ——— Transfer oqimi ——— */
        .tr-flow{display:grid;grid-template-columns:1fr auto 1fr;align-items:stretch;gap:0;}
        .tr-slot{border:1.5px solid var(--card-border,#e2e8f0);border-radius:16px;padding:16px;background:var(--content-bg,#f8fafc);transition:border-color .18s,box-shadow .18s;}
        .tr-slot.from{border-top:3px solid #3b82f6;}
        .tr-slot.to{border-top:3px solid #10b981;}
        .tr-slot:focus-within{box-shadow:0 0 0 4px rgba(99,102,241,.1);}
        .tr-slot-label{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;margin-bottom:10px;}
        .tr-slot.from .tr-slot-label{color:#2563eb;}
        .tr-slot.to .tr-slot-label{color:#059669;}
        .tr-slot-dot{width:8px;height:8px;border-radius:50%;}
        .tr-slot.from .tr-slot-dot{background:#3b82f6;}
        .tr-slot.to .tr-slot-dot{background:#10b981;}
        .tr-select,.tr-date{width:100%;height:48px;border:1.5px solid var(--card-border,#e2e8f0);border-radius:12px;padding:0 14px;font-size:15px;font-weight:600;
          background:var(--card-bg,#fff);color:var(--text-primary,#1e293b);cursor:pointer;transition:border-color .15s;}
        .tr-select:hover,.tr-date:hover{border-color:#a5b4fc;}
        .tr-select:focus,.tr-date:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 4px rgba(99,102,241,.14);}
        body.dark-mode .tr-date{color-scheme:dark;}
        .tr-arrow{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 18px;position:relative;}
        .tr-arrow-line{position:absolute;top:50%;left:0;right:0;height:2px;background:linear-gradient(90deg,#3b82f6,#8b5cf6,#10b981);opacity:.35;}
        .tr-arrow-badge{position:relative;z-index:1;width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;
          font-size:20px;color:#fff;background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 6px 18px rgba(99,102,241,.4);}
        @media(max-width:720px){
          .tr-flow{grid-template-columns:1fr;gap:14px;}
          .tr-arrow{padding:2px 0;transform:rotate(90deg);}
          .tr-arrow-line{display:none;}
        }

        /* ——— Bo'limlar ——— */
        .tr-section{margin-top:22px;padding-top:20px;border-top:1px dashed var(--card-border,#e2e8f0);}
        .tr-section-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;}
        .tr-step-badge{width:26px;height:26px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:800;color:#fff;
          background:linear-gradient(135deg,#6366f1,#8b5cf6);flex-shrink:0;}
        .tr-label{font-size:14px;font-weight:800;color:var(--text-primary,#1e293b);}
        .tr-label-sub{font-size:12.5px;color:var(--text-muted,#94a3b8);font-weight:600;}

        /* Segment tugmalar */
        .tr-seg{display:flex;gap:8px;background:var(--content-bg,#f1f5f9);padding:5px;border-radius:15px;border:1px solid var(--card-border,#e2e8f0);}
        .tr-seg button{flex:1;min-height:44px;border:none;border-radius:11px;background:transparent;color:var(--text-secondary,#64748b);font-weight:700;font-size:14px;
          cursor:pointer;transition:all .16s;display:flex;align-items:center;justify-content:center;gap:8px;padding:6px 12px;}
        .tr-seg button:hover{color:var(--text-primary,#1e293b);}
        .tr-seg button.on{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;box-shadow:0 6px 16px rgba(99,102,241,.32);}
        .tr-seg button small{font-weight:600;opacity:.75;font-size:12px;}

        /* Sinf → fan kartalari */
        .tr-cls-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:14px;}
        .tr-cls{border:1.5px solid var(--card-border,#e2e8f0);border-radius:16px;background:var(--card-bg,#fff);overflow:hidden;transition:border-color .15s,box-shadow .15s;}
        .tr-cls.some{border-color:#a5b4fc;}
        .tr-cls.full{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.12);}
        .tr-cls-head{display:flex;align-items:center;gap:10px;padding:11px 13px;background:var(--content-bg,#f8fafc);border-bottom:1px solid var(--card-border,#e2e8f0);cursor:pointer;user-select:none;}
        .tr-cls-head:hover{background:rgba(99,102,241,.06);}
        .tr-check{width:20px;height:20px;border-radius:6px;border:2px solid #cbd5e1;display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:#fff;flex-shrink:0;transition:all .12s;background:transparent;}
        .tr-check.on{background:#6366f1;border-color:#6366f1;}
        .tr-check.half{background:#a5b4fc;border-color:#a5b4fc;}
        .tr-cls-name{font-weight:800;font-size:15px;color:var(--text-primary,#1e293b);flex:1;}
        .tr-cls-count{font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);}
        .tr-subjs{display:flex;flex-wrap:wrap;gap:7px;padding:11px 12px;}
        .tr-subj{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:10px;border:1.5px solid var(--card-border,#e2e8f0);
          background:var(--card-bg,#fff);cursor:pointer;font-size:13px;font-weight:700;color:var(--text-secondary,#475569);user-select:none;transition:all .13s;}
        .tr-subj:hover{border-color:#a5b4fc;transform:translateY(-1px);}
        .tr-subj.on{background:rgba(99,102,241,.12);border-color:#6366f1;color:#4338ca;}
        body.dark-mode .tr-subj.on{color:#c7d2fe;}
        .tr-subj .tr-n{font-size:11px;font-weight:700;color:var(--text-muted,#94a3b8);}
        .tr-subj.on .tr-n{color:#6366f1;}
        body.dark-mode .tr-subj.on .tr-n{color:#a5b4fc;}
        .tr-pick-bar{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:13px;color:var(--text-secondary,#64748b);flex-wrap:wrap;}
        .tr-link{background:none;border:none;color:#6366f1;font-weight:700;cursor:pointer;font-size:13px;padding:0;}
        .tr-link:hover{text-decoration:underline;}

        /* Muddat */
        .tr-dates{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px;}
        @media(max-width:560px){.tr-dates{grid-template-columns:1fr;}}
        .tr-field label{display:block;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;color:var(--text-muted,#94a3b8);margin-bottom:7px;}
        .tr-presets{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center;}
        .tr-presets span{font-size:12.5px;color:var(--text-muted,#94a3b8);font-weight:600;}
        .tr-preset{padding:7px 13px;border-radius:999px;border:1.5px solid var(--card-border,#e2e8f0);background:var(--card-bg,#fff);font-size:12.5px;font-weight:700;
          color:var(--text-secondary,#475569);cursor:pointer;transition:all .13s;}
        .tr-preset:hover{border-color:#a5b4fc;color:#4338ca;}
        .tr-timeline{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:8px;margin-top:16px;padding:14px 16px;border-radius:14px;
          background:linear-gradient(120deg,rgba(59,130,246,.08),rgba(16,185,129,.08));border:1px solid rgba(99,102,241,.18);}
        @media(max-width:720px){.tr-timeline{grid-template-columns:1fr;}.tr-tl-arrow{display:none;}}
        .tr-tl{display:flex;flex-direction:column;gap:3px;}
        .tr-tl b{font-size:14px;color:var(--text-primary,#1e293b);}
        .tr-tl span{font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;letter-spacing:.3px;}
        .tr-tl-arrow{color:#a5b4fc;font-size:18px;}
        .tr-tl.end b{color:#059669;}
        .tr-tl.back b{color:#2563eb;}

        /* Eslatmalar */
        .tr-warn{display:flex;gap:10px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.40);border-radius:13px;padding:12px 14px;font-size:13px;line-height:1.5;color:#b45309;margin-top:16px;}
        .tr-warn-icon{flex-shrink:0;font-size:16px;line-height:1.3;}
        .tr-note{display:flex;gap:10px;background:rgba(59,130,246,.09);border:1px solid rgba(59,130,246,.30);border-radius:13px;padding:12px 14px;font-size:13px;line-height:1.5;color:#1d4ed8;margin-top:16px;}
        body.dark-mode .tr-note{color:#93c5fd;}
        body.dark-mode .tr-warn{color:#fcd34d;}
        .tr-err{display:flex;gap:10px;background:rgba(239,68,68,.09);border:1px solid rgba(239,68,68,.35);border-radius:13px;padding:12px 14px;font-size:13px;line-height:1.5;color:#b91c1c;margin-top:12px;}
        body.dark-mode .tr-err{color:#fca5a5;}

        .tr-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap;}
        .tr-btn{display:inline-flex;align-items:center;gap:8px;height:48px;padding:0 26px;border-radius:13px;border:none;font-size:15px;font-weight:700;
          cursor:pointer;transition:transform .12s,filter .12s,box-shadow .12s;}
        .tr-btn:hover{transform:translateY(-1px);filter:brightness(1.05);}
        .tr-btn:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none;}
        .tr-btn-primary{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;box-shadow:0 6px 18px rgba(99,102,241,.32);}
        .tr-btn-success{background:linear-gradient(135deg,#16a34a,#059669);color:#fff;box-shadow:0 6px 18px rgba(22,163,74,.3);}
        .tr-btn-ghost{background:var(--content-bg,#f1f5f9);color:var(--text-secondary,#475569);}
        .tr-btn-sm{height:38px;padding:0 16px;font-size:13.5px;border-radius:11px;}
        .tr-btn-danger{background:rgba(239,68,68,.10);color:#b91c1c;}
        body.dark-mode .tr-btn-danger{color:#fca5a5;}
        .tr-btn-blue{background:rgba(59,130,246,.12);color:#1d4ed8;}
        body.dark-mode .tr-btn-blue{color:#93c5fd;}
        .tr-hint{font-size:13px;color:var(--text-muted,#94a3b8);text-align:right;margin-top:10px;}

        /* ——— Natija ——— */
        .tr-summary{background:linear-gradient(120deg,rgba(59,130,246,.08),rgba(99,102,241,.06));border:1px solid rgba(59,130,246,.25);border-radius:16px;padding:16px 18px;margin-bottom:16px;}
        .tr-summary-title{font-weight:800;font-size:16px;color:var(--text-primary,#075985);margin-bottom:12px;}
        .tr-stats{display:flex;flex-wrap:wrap;gap:9px;}
        .tr-stat{display:inline-flex;align-items:center;gap:5px;border-radius:10px;padding:6px 13px;font-weight:700;font-size:13.5px;}
        .tr-changes{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;padding-right:4px;}
        .tr-change{display:flex;gap:10px;align-items:center;font-size:14px;background:var(--content-bg,#f8fafc);border-radius:11px;padding:10px 13px;border:1px solid transparent;transition:border-color .15s;flex-wrap:wrap;}
        .tr-change:hover{border-color:var(--card-border,#e2e8f0);}
        .tr-change-icon{flex-shrink:0;width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;}
        .tr-change-icon.inplace{background:rgba(34,197,94,.15);color:#15803d;}
        .tr-change-icon.swapped{background:rgba(59,130,246,.15);color:#1d4ed8;}
        .tr-change b{white-space:nowrap;color:var(--text-primary,#1e293b);}
        .tr-change .tr-where{color:var(--text-secondary,#64748b);font-size:13px;}
        .tr-sub{font-size:13px;font-weight:800;color:var(--text-secondary,#475569);margin:18px 0 8px;text-transform:uppercase;letter-spacing:.3px;}
        .tr-others{background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.35);border-radius:12px;padding:12px 14px;}
        .tr-others div{font-size:13px;color:#92400e;line-height:1.6;}
        body.dark-mode .tr-others div{color:#fcd34d;}
        .tr-fail{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:12px;padding:12px 14px;margin-top:12px;}
        .tr-fail div{font-size:13px;color:#991b1b;line-height:1.6;}
        body.dark-mode .tr-fail div{color:#fca5a5;}

        /* ——— Amaldagi almashtirishlar ro'yxati ——— */
        .tr-list-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;}
        .tr-list-head h3{margin:0;font-size:17px;font-weight:800;color:var(--text-primary,#1e293b);}
        .tr-list{display:flex;flex-direction:column;gap:10px;}
        .tr-item{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:start;padding:14px 16px;border-radius:15px;border:1.5px solid var(--card-border,#e2e8f0);background:var(--card-bg,#fff);transition:border-color .15s;}
        .tr-item:hover{border-color:#a5b4fc;}
        .tr-item.active{border-left:4px solid #10b981;}
        .tr-item.scheduled{border-left:4px solid #3b82f6;}
        .tr-item.done{border-left:4px solid #8b5cf6;}
        .tr-item.reverted{border-left:4px solid #94a3b8;opacity:.85;}
        @media(max-width:720px){.tr-item{grid-template-columns:1fr;}}
        .tr-status{display:inline-flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:120px;}
        .tr-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;}
        .tr-badge.active{background:rgba(16,185,129,.14);color:#047857;}
        .tr-badge.scheduled{background:rgba(59,130,246,.14);color:#1d4ed8;}
        .tr-badge.done{background:rgba(139,92,246,.14);color:#6d28d9;}
        .tr-badge.reverted{background:rgba(148,163,184,.18);color:#475569;}
        body.dark-mode .tr-badge.active{color:#6ee7b7;}
        body.dark-mode .tr-badge.scheduled{color:#93c5fd;}
        body.dark-mode .tr-badge.done{color:#c4b5fd;}
        body.dark-mode .tr-badge.reverted{color:#cbd5e1;}
        .tr-left{font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);}
        .tr-item-main{min-width:0;}
        .tr-who{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;color:var(--text-primary,#1e293b);flex-wrap:wrap;}
        .tr-who .arr{color:#8b5cf6;}
        .tr-meta{margin-top:5px;font-size:13px;color:var(--text-secondary,#64748b);line-height:1.55;}
        .tr-meta b{color:var(--text-primary,#1e293b);font-weight:700;}
        .tr-item-actions{display:flex;flex-direction:column;gap:8px;align-items:stretch;min-width:150px;}
        .tr-inline-date{display:flex;flex-direction:column;gap:4px;}
        .tr-inline-date label{font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text-muted,#94a3b8);letter-spacing:.3px;}
        .tr-inline-date input{height:38px;border:1.5px solid var(--card-border,#e2e8f0);border-radius:10px;padding:0 10px;font-size:13.5px;font-weight:600;background:var(--card-bg,#fff);color:var(--text-primary,#1e293b);}
        body.dark-mode .tr-inline-date input{color-scheme:dark;}
        .tr-confirm{display:flex;gap:6px;align-items:center;font-size:13px;font-weight:700;color:var(--text-secondary,#475569);flex-wrap:wrap;}
        .tr-empty{padding:26px;text-align:center;color:var(--text-muted,#94a3b8);font-size:14px;border:1.5px dashed var(--card-border,#e2e8f0);border-radius:14px;}

        /* ——— Empty state: qadamlar ——— */
        .tr-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:2px;}
        @media(max-width:980px){.tr-steps{grid-template-columns:repeat(2,1fr);}}
        @media(max-width:560px){.tr-steps{grid-template-columns:1fr;}}
        .tr-step{position:relative;background:var(--card-bg,#fff);border:1px solid var(--card-border,#e2e8f0);border-radius:18px;padding:22px 20px;
          box-shadow:0 1px 3px rgba(15,23,42,.03);}
        .tr-step-num{width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;
          color:#fff;margin-bottom:14px;}
        .tr-step:nth-child(1) .tr-step-num{background:linear-gradient(135deg,#3b82f6,#6366f1);}
        .tr-step:nth-child(2) .tr-step-num{background:linear-gradient(135deg,#8b5cf6,#a855f7);}
        .tr-step:nth-child(3) .tr-step-num{background:linear-gradient(135deg,#f59e0b,#f97316);}
        .tr-step:nth-child(4) .tr-step-num{background:linear-gradient(135deg,#10b981,#059669);}
        .tr-step h4{margin:0 0 6px;font-size:15px;font-weight:700;color:var(--text-primary,#1e293b);}
        .tr-step p{margin:0;font-size:13px;line-height:1.55;color:var(--text-secondary,#64748b);}
      `}</style>

      <div className="tr-hero">
        <div className="tr-hero-row">
          <div className="tr-hero-badge">🔄</div>
          <div className="tr-hero-text">
            <h1>O'qituvchini almashtirish</h1>
            <p>
              Ketgan yoki vaqtincha yo'q o'qituvchining darslarini boshqa o'qituvchiga o'tkazadi — dars jadvalida ham, <b>Sinf fanlarida</b> ham.
              Sinf ichida qaysi <b>fan</b> ko'chishini tanlaysiz. <b>Vaqtincha</b> almashtirsangiz, muddat tugagach darslar eski ustozga o'zi qaytadi.
            </p>
          </div>
          {(activeCount > 0 || scheduledCount > 0) && (
            <div className="tr-hero-pills">
              {activeCount > 0 && <span className="tr-pill active"><i />{activeCount} ta amalda</span>}
              {scheduledCount > 0 && <span className="tr-pill sched"><i />{scheduledCount} ta rejalashtirilgan</span>}
            </div>
          )}
        </div>
      </div>

      <div className="tr-card">
        {/* ——— 1-2: kim → kimga ——— */}
        <div className="tr-flow">
          <div className="tr-slot from">
            <div className="tr-slot-label"><span className="tr-slot-dot" /> Ketgan o'qituvchi</div>
            <select className="tr-select" value={oldTeacherId} onChange={(e) => chooseOld(e.target.value)}>
              <option value="">— tanlang —</option>
              {teachersWithWork.map((t) => {
                const n = totalTeacherLessons(t.id);
                const cs = countTeacherInClassSubjects({ classSubjects, oldTeacherId: t.id });
                const info = n > 0 ? `${n} dars` : `${cs} fan (jadvalsiz)`;
                return <option key={t.id} value={t.id}>{t.name} ({info})</option>;
              })}
            </select>
          </div>

          <div className="tr-arrow">
            <div className="tr-arrow-line" />
            <div className="tr-arrow-badge">→</div>
          </div>

          <div className="tr-slot to">
            <div className="tr-slot-label"><span className="tr-slot-dot" /> Yangi o'qituvchi</div>
            <select className="tr-select" value={newTeacherId} onChange={(e) => { setNewTeacherId(e.target.value); setResult(null); }}>
              <option value="">— tanlang —</option>
              {sortedTeachers.filter((t) => t.id !== oldTeacherId).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        {oldTeacherId && liveForOld.length > 0 && (
          <div className="tr-note">
            <span className="tr-warn-icon">ℹ️</span>
            <span>
              Bu o'qituvchi uchun {liveForOld.length} ta amaldagi/rejalashtirilgan almashtirish bor (pastdagi ro'yxatga qarang).
              Yangi almashtirish faqat hozir unda qolgan darslarga qo'llanadi.
            </span>
          </div>
        )}

        {/* ——— 3: sinf va fan ——— */}
        {oldTeacherId && classGroups.length > 0 && (
          <div className="tr-section">
            <div className="tr-section-head">
              <span className="tr-step-badge">1</span>
              <span className="tr-label">Qaysi sinf va fanlardagi darslar ko'chirilsin?</span>
              <span className="tr-label-sub">{classGroups.length} sinf · {allPairs.length} fan · {oldTeacherLessons.length} dars</span>
            </div>
            <div className="tr-seg">
              <button type="button" className={scope === "all" ? "on" : ""} onClick={() => { setScope("all"); setResult(null); }}>
                Barcha darslar <small>({oldTeacherLessons.length})</small>
              </button>
              <button type="button" className={scope === "some" ? "on" : ""} onClick={() => { setScope("some"); setResult(null); }}>
                Tanlab olish {scope === "some" && picked.length > 0 && <small>({picked.length} fan)</small>}
              </button>
            </div>

            {scope === "some" && (
              <>
                <div className="tr-cls-grid">
                  {classGroups.map((g) => {
                    const onCount = g.pairs.filter((p) => pickedSet.has(p.key)).length;
                    const state = onCount === 0 ? "" : onCount === g.pairs.length ? "full" : "some";
                    return (
                      <div key={g.classId} className={`tr-cls ${state}`}>
                        <div className="tr-cls-head" onClick={() => toggleClassAll(g)} title="Sinfdagi barcha fanlarni tanlash">
                          <span className={`tr-check ${state === "full" ? "on" : state === "some" ? "half" : ""}`}>
                            {state === "full" ? "✓" : state === "some" ? "–" : ""}
                          </span>
                          <span className="tr-cls-name">{g.name}</span>
                          <span className="tr-cls-count">{g.lessons > 0 ? `${g.lessons} dars` : "sinf fanlarida"}</span>
                        </div>
                        <div className="tr-subjs">
                          {g.pairs.map((p) => {
                            const on = pickedSet.has(p.key);
                            return (
                              <div key={p.key} className={`tr-subj ${on ? "on" : ""}`} onClick={() => togglePair(p.key)}>
                                <span>{on ? "☑" : "☐"}</span>
                                <span>{subjName(p.subjectId)}</span>
                                <span className="tr-n">{p.lessons > 0 ? `${p.lessons} soat` : "jadvalsiz"}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="tr-pick-bar">
                  <span>Tanlangan: <b>{picked.length}</b> / {allPairs.length} fan · <b>{targetCount}</b> dars</span>
                  <button type="button" className="tr-link" onClick={() => { setPicked(allPairs.map((p) => p.key)); setResult(null); }}>Hammasini tanlash</button>
                  {picked.length > 0 && <button type="button" className="tr-link" onClick={() => { setPicked([]); setResult(null); }}>Tozalash</button>}
                </div>
              </>
            )}
          </div>
        )}

        {/* ——— 4: muddat ——— */}
        {oldTeacherId && newTeacherId && (
          <div className="tr-section">
            <div className="tr-section-head">
              <span className="tr-step-badge">2</span>
              <span className="tr-label">Qancha muddatga?</span>
            </div>
            <div className="tr-seg">
              <button type="button" className={mode === "temporary" ? "on" : ""} onClick={() => { setMode("temporary"); setResult(null); }}>
                ⏳ Vaqtincha <small>sanadan sanagacha</small>
              </button>
              <button type="button" className={mode === "permanent" ? "on" : ""} onClick={() => { setMode("permanent"); setResult(null); }}>
                ♾️ Doimiy <small>to'liq o'tkazish</small>
              </button>
            </div>

            {mode === "temporary" ? (
              <>
                <div className="tr-dates">
                  <div className="tr-field">
                    <label>Boshlanish sanasi</label>
                    <input
                      type="date" className="tr-date" value={startDate}
                      onChange={(e) => { setStartDate(e.target.value); setResult(null); }}
                    />
                  </div>
                  <div className="tr-field">
                    <label>Tugash sanasi (shu kun ham kiradi)</label>
                    <input
                      type="date" className="tr-date" value={endDate} min={startDate || undefined}
                      onChange={(e) => { setEndDate(e.target.value); setResult(null); }}
                    />
                  </div>
                </div>
                <div className="tr-presets">
                  <span>Tez tanlash:</span>
                  {PRESETS.map((p) => (
                    <button key={p.days} type="button" className="tr-preset" onClick={() => applyPreset(p.days)}>{p.label}</button>
                  ))}
                </div>

                {dateError ? (
                  <div className="tr-err"><span className="tr-warn-icon">⛔</span><span>{dateError}</span></div>
                ) : (
                  <div className="tr-timeline">
                    <div className="tr-tl">
                      <span>{isScheduled ? "Boshlanadi" : "Boshlanadi (bugundan)"}</span>
                      <b>{fmtDate(startDate)}</b>
                    </div>
                    <div className="tr-tl-arrow">→</div>
                    <div className="tr-tl end">
                      <span>{teacherName(newTeacherId)} o'qitadi</span>
                      <b>{durationDays} kun · {fmtDate(endDate)} gacha</b>
                    </div>
                    <div className="tr-tl-arrow">→</div>
                    <div className="tr-tl back">
                      <span>Eski ustozga qaytadi</span>
                      <b>{fmtDate(revertOn)} · {teacherName(oldTeacherId)}</b>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="tr-note">
                <span className="tr-warn-icon">♾️</span>
                <span>
                  Darslar <b>{teacherName(newTeacherId)}</b>ga butunlay o'tadi. Avtomatik qaytish yo'q, lekin pastdagi ro'yxatdan istalgan vaqt
                  qo'lda ortga qaytarish mumkin.
                </span>
              </div>
            )}
          </div>
        )}

        {/* ——— Eslatmalar ——— */}
        {oldTeacherId && newTeacherId && csCount > 0 && (
          <div className="tr-note">
            <span className="tr-warn-icon">🔗</span>
            <span>
              <b>Sinf fanlari</b> ham yangilanadi: {csCount} ta yozuvda ustoz almashtiriladi.
              Shu tufayli jadvalni qaytadan tuzganingizda dars eski ustozga qaytmaydi{mode === "temporary" ? " — muddat tugagach u ham eskiga qaytariladi" : ""}.
            </span>
          </div>
        )}

        {uncovered.length > 0 && (
          <div className="tr-warn">
            <span className="tr-warn-icon">⚠️</span>
            <span>Yangi o'qituvchi ba'zi fanlarga biriktirilmagan ({uncovered.map(subjName).join(", ")}). Almashtirish baribir bajariladi, lekin O'qituvchilar bo'limidan bu fanlarni unga qo'shib qo'yish tavsiya etiladi.</span>
          </div>
        )}

        {oldTeacherId && newTeacherId && (
          <div className="tr-actions">
            <button type="button" className="tr-btn tr-btn-primary" onClick={preview} disabled={!canRun}>
              👁 Ko'rish ({targetCount} dars{csCount > 0 ? ` · ${csCount} fan` : ""})
            </button>
          </div>
        )}

        {oldTeacherId && newTeacherId && !canRun && !dateError && (
          <div className="tr-hint">{nothingPicked ? "Kamida bitta sinf va fan tanlang." : "Ko'chiradigan dars yo'q."}</div>
        )}
      </div>

      {/* ——— Oldindan ko'rish natijasi ——— */}
      {result && summary && !summary.error && (
        <div className="tr-card">
          <div className="tr-summary">
            <div className="tr-summary-title">
              Natija: {summary.totalLessons} ta dars{csCount > 0 ? ` · ${csCount} ta sinf fani yozuvi` : ""}
              {mode === "temporary" && !isScheduled && ` · ${fmtDate(startDate)} – ${fmtDate(endDate)}`}
            </div>
            <div className="tr-stats">
              <span className="tr-stat" style={{ background: "rgba(34,197,94,.15)", color: "#15803d" }}>✓ {summary.inPlace} o'z joyida</span>
              {summary.swapped > 0 && <span className="tr-stat" style={{ background: "rgba(59,130,246,.15)", color: "#1d4ed8" }}>⇄ {summary.swapped} o'rin almashdi</span>}
              {summary.failed > 0 && <span className="tr-stat" style={{ background: "rgba(239,68,68,.14)", color: "#b91c1c" }}>✕ {summary.failed} eski ustozda qoldi</span>}
              {csCount > 0 && <span className="tr-stat" style={{ background: "rgba(139,92,246,.15)", color: "#6d28d9" }}>🔗 {csCount} sinf fani yangilanadi</span>}
              {mode === "temporary" && <span className="tr-stat" style={{ background: "rgba(16,185,129,.14)", color: "#047857" }}>⏳ {durationDays} kun · {fmtDate(revertOn)} kuni qaytadi</span>}
              {mode === "permanent" && <span className="tr-stat" style={{ background: "rgba(139,92,246,.15)", color: "#6d28d9" }}>♾️ doimiy</span>}
            </div>
          </div>

          {isScheduled && (
            <div className="tr-note" style={{ marginTop: 0, marginBottom: 14 }}>
              <span className="tr-warn-icon">📅</span>
              <span>
                Boshlanish sanasi kelajakda — <b>hozir jadval o'zgarmaydi</b>. Almashtirish {fmtDate(startDate)} kuni ilova ochilganda
                o'zi qo'llanadi (quyidagi ko'rinish taxminiy: o'sha kungi jadval bo'yicha qayta hisoblanadi).
              </span>
            </div>
          )}

          {preview_.changes.length > 0 && (
            <>
              <div className="tr-sub">O'zgarishlar:</div>
              <div className="tr-changes">
                {preview_.changes.map((c, i) => {
                  const isInPlace = c.kind === "inPlace";
                  const label = `${clsNames(c.classIds)} ${subjName(c.subjectId)}`;
                  const fromTxt = `${c.from.day} ${slotNum(c.from.tsId)}-dars`;
                  const toTxt = `${c.to.day} ${slotNum(c.to.tsId)}-dars`;
                  return (
                    <div key={i} className="tr-change">
                      <span className={`tr-change-icon ${isInPlace ? "inplace" : "swapped"}`}>{isInPlace ? "✓" : "⇄"}</span>
                      <b>{label}</b>
                      <span className="tr-where">{isInPlace ? `${toTxt} (joyida qoldi)` : `${fromTxt} ⇄ ${toTxt} (o'rin almashdi)`}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {preview_.movedOthers.length > 0 && (
            <>
              <div className="tr-sub">O'rin almashgan darslar (bo'sh katak qolmasligi uchun):</div>
              <div className="tr-others">
                {preview_.movedOthers.map((m, i) => (
                  <div key={i}>• {clsNames(m.classIds)} {subjName(m.subjectId)} ({teacherName(m.teacherId)}): {m.from.day} {slotNum(m.from.tsId)}-dars → {m.to.day} {slotNum(m.to.tsId)}-dars</div>
                ))}
              </div>
            </>
          )}

          {preview_.failed.length > 0 && (
            <div className="tr-fail">
              <div style={{ fontWeight: 700, marginBottom: 4 }}>O'tkazib bo'lmagan darslar (mos o'rin almashuv topilmadi — eski ustoz nomida joyida qoladi):</div>
              {preview_.failed.map((f, i) => (
                <div key={i}>• {clsNames(f.classIds)} {subjName(f.subjectId)} — {f.at.day} {slotNum(f.at.tsId)}-dars</div>
              ))}
            </div>
          )}

          <div className="tr-actions" style={{ marginTop: 18 }}>
            <button type="button" className="tr-btn tr-btn-ghost" onClick={() => setResult(null)}>Qaytish</button>
            <button type="button" className="tr-btn tr-btn-success" onClick={apply}>
              {isScheduled ? "📅 Rejalashtirish" : mode === "temporary" ? "⏳ Vaqtincha qo'llash" : "Tasdiqlash va qo'llash"}
            </button>
          </div>
        </div>
      )}

      {/* ——— Qadamlar (hali hech narsa tanlanmagan) ——— */}
      {!oldTeacherId && (
        <div className="tr-steps" style={{ marginBottom: 18 }}>
          <div className="tr-step">
            <div className="tr-step-num">1</div>
            <h4>Ustozlarni tanlang</h4>
            <p>Ketgan (yoki vaqtincha yo'q) o'qituvchini va darslar kimga o'tishini belgilang.</p>
          </div>
          <div className="tr-step">
            <div className="tr-step-num">2</div>
            <h4>Sinf va fanni tanlang</h4>
            <p>Barcha darslar yoki faqat kerakli sinflardagi kerakli fanlar — masalan, 7-A da faqat matematika.</p>
          </div>
          <div className="tr-step">
            <div className="tr-step-num">3</div>
            <h4>Muddatni belgilang</h4>
            <p>Sanadan sanagacha (kasallik, ta'til) yoki doimiy. Muddat tugagach darslar eski ustozga o'zi qaytadi.</p>
          </div>
          <div className="tr-step">
            <div className="tr-step-num">4</div>
            <h4>Ko'ring va qo'llang</h4>
            <p>Jadval bilan birga Sinf fanlari ham yangilanadi — jadvalni qayta tuzganda eski ustoz qaytmaydi.</p>
          </div>
        </div>
      )}

      {/* ——— Amaldagi almashtirishlar ——— */}
      <div className="tr-card">
        <div className="tr-list-head">
          <h3>Amaldagi va rejalashtirilgan almashtirishlar {liveSubs.length > 0 && `(${liveSubs.length})`}</h3>
          {historySubs.length > 0 && (
            <button type="button" className="tr-link" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "Tarixni yashirish" : `Tarix (${historySubs.length})`}
            </button>
          )}
        </div>

        {liveSubs.length === 0 && (!showHistory || historySubs.length === 0) && (
          <div className="tr-empty">
            Hozircha amaldagi almashtirish yo'q. Vaqtinchalik almashtirish qo'llansa, shu yerda muddati va qaytish sanasi ko'rinadi.
          </div>
        )}

        <div className="tr-list">
          {[...liveSubs, ...(showHistory ? historySubs : [])].map((sub) => {
            const st = sub.status;
            const a = sub.applied || {};
            const r = sub.reverted || {};
            const left = st === SUB_STATUS.ACTIVE && sub.endDate ? daysInclusive(today, sub.endDate) : 0;
            const until = st === SUB_STATUS.SCHEDULED ? daysInclusive(today, sub.startDate) - 1 : 0;
            const confirming = confirmId === sub.id;
            return (
              <div key={sub.id} className={`tr-item ${st}`}>
                <div className="tr-status">
                  <span className={`tr-badge ${st}`}>
                    {st === SUB_STATUS.ACTIVE && "● Amalda"}
                    {st === SUB_STATUS.SCHEDULED && "📅 Rejada"}
                    {st === SUB_STATUS.DONE && "♾️ Doimiy"}
                    {st === SUB_STATUS.REVERTED && "↩ Qaytarilgan"}
                  </span>
                  {st === SUB_STATUS.ACTIVE && <span className="tr-left">{left > 0 ? `${left} kun qoldi` : "bugun oxirgi kun"}</span>}
                  {st === SUB_STATUS.SCHEDULED && <span className="tr-left">{until > 0 ? `${until} kundan keyin` : "bugun boshlanadi"}</span>}
                  {st === SUB_STATUS.REVERTED && sub.revertedAt && <span className="tr-left">{fmtDate(String(sub.revertedAt).slice(0, 10))}</span>}
                </div>

                <div className="tr-item-main">
                  <div className="tr-who">
                    <span>{teacherName(sub.oldTeacherId)}</span>
                    <span className="arr">→</span>
                    <span>{teacherName(sub.newTeacherId)}</span>
                  </div>
                  <div className="tr-meta">
                    {sub.mode === "temporary" ? (
                      <div>
                        <b>Vaqtincha:</b> {fmtDate(sub.startDate)} – {fmtDate(sub.endDate)} ({daysInclusive(sub.startDate, sub.endDate)} kun)
                        {st !== SUB_STATUS.REVERTED && <> · qaytadi: <b>{fmtDate(isoAddDays(sub.endDate, 1))}</b></>}
                      </div>
                    ) : (
                      <div><b>Doimiy</b> · {fmtDate(sub.startDate)} dan</div>
                    )}
                    <div><b>Qamrov:</b> {describeScope(sub)}</div>
                    {(st === SUB_STATUS.ACTIVE || st === SUB_STATUS.DONE) && (
                      <div>
                        <b>Qo'llandi:</b> {a.total || 0} dars ({a.inPlace || 0} joyida{a.swapped ? `, ${a.swapped} o'rin almashdi` : ""}{a.failed ? `, ${a.failed} qolib ketdi` : ""})
                        {a.cs ? ` · ${a.cs} sinf fani` : ""}
                      </div>
                    )}
                    {st === SUB_STATUS.REVERTED && (
                      <div>
                        {sub.skipped ? (
                          <><b>Qo'llanmadi:</b> muddati ilova ochilmasdan o'tib ketgan</>
                        ) : (
                          <>
                            <b>Qaytarildi:</b> {(r.renamed || 0) + (r.movedBack || 0)} dars{r.movedBack ? ` (${r.movedBack} tasi o'rniga qaytdi)` : ""}
                            {r.cs ? ` · ${r.cs} sinf fani` : ""}
                            {r.conflicts ? ` · ⚠️ ${r.conflicts} soatda ziddiyat` : ""}
                            {r.missing ? ` · ${r.missing} dars topilmadi` : ""}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="tr-item-actions">
                  {st === SUB_STATUS.SCHEDULED && (
                    <>
                      <div className="tr-inline-date">
                        <label>Boshlanish</label>
                        <input type="date" value={sub.startDate} onChange={(e) => {
                          const v = e.target.value;
                          if (!v) return;
                          patchSub(sub, { startDate: v, endDate: sub.endDate && sub.endDate < v ? v : sub.endDate });
                        }} />
                      </div>
                      <div className="tr-inline-date">
                        <label>Tugash</label>
                        <input type="date" value={sub.endDate} min={sub.startDate} onChange={(e) => {
                          const v = e.target.value;
                          if (!v || v < sub.startDate) return;
                          patchSub(sub, { endDate: v });
                        }} />
                      </div>
                      {confirming ? (
                        <div className="tr-confirm">
                          Bekor qilinsinmi?
                          <button type="button" className="tr-btn tr-btn-sm tr-btn-danger" onClick={() => removeSub(sub)}>Ha</button>
                          <button type="button" className="tr-btn tr-btn-sm tr-btn-ghost" onClick={() => setConfirmId("")}>Yo'q</button>
                        </div>
                      ) : (
                        <button type="button" className="tr-btn tr-btn-sm tr-btn-danger" onClick={() => setConfirmId(sub.id)}>Bekor qilish</button>
                      )}
                    </>
                  )}

                  {st === SUB_STATUS.ACTIVE && (
                    <>
                      <div className="tr-inline-date">
                        <label>Tugash sanasi</label>
                        <input type="date" value={sub.endDate} min={sub.startDate} onChange={(e) => {
                          const v = e.target.value;
                          if (!v || v < sub.startDate) return;
                          patchSub(sub, { endDate: v });
                        }} />
                      </div>
                      {confirming ? (
                        <div className="tr-confirm">
                          Hozir qaytarilsinmi?
                          <button type="button" className="tr-btn tr-btn-sm tr-btn-blue" onClick={() => revertNow(sub)}>Ha</button>
                          <button type="button" className="tr-btn tr-btn-sm tr-btn-ghost" onClick={() => setConfirmId("")}>Yo'q</button>
                        </div>
                      ) : (
                        <button type="button" className="tr-btn tr-btn-sm tr-btn-blue" onClick={() => setConfirmId(sub.id)}>↩ Hozir qaytarish</button>
                      )}
                    </>
                  )}

                  {st === SUB_STATUS.DONE && (
                    confirming ? (
                      <div className="tr-confirm">
                        Eski ustozga qaytarilsinmi?
                        <button type="button" className="tr-btn tr-btn-sm tr-btn-blue" onClick={() => revertNow(sub)}>Ha</button>
                        <button type="button" className="tr-btn tr-btn-sm tr-btn-ghost" onClick={() => setConfirmId("")}>Yo'q</button>
                      </div>
                    ) : (
                      <button type="button" className="tr-btn tr-btn-sm tr-btn-blue" onClick={() => setConfirmId(sub.id)}>↩ Ortga qaytarish</button>
                    )
                  )}

                  {st === SUB_STATUS.REVERTED && (
                    <button type="button" className="tr-btn tr-btn-sm tr-btn-ghost" onClick={() => removeSub(sub)}>O'chirish</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
