import { useMemo, useState } from "react";
import { DAYS } from "../utils/constants";
import { replaceTeacher } from "../utils/replaceTeacher";
import {
  applyTeacherToClassSubjects,
  countTeacherInClassSubjects,
  classIdsWithTeacherInSubjects,
} from "../utils/replaceTeacherSubjects";
import { sortTeachers, cmpName } from "../utils/sortHelpers";
import { slotDisplayNumber } from "../utils/shiftSlots";

function classIdsOf(lesson) {
  return Array.isArray(lesson?.classIds) ? lesson.classIds : [lesson?.classId].filter(Boolean);
}

export default function TeacherReplacePage({
  classes = [],
  subjects = [],
  teachers = [],
  timeslots = [],
  lunchGroups = [],
  schedule = {},
  classSubjects = {},
  setSchedule,
  setClassSubjects,
  toast,
}) {
  const [oldTeacherId, setOldTeacherId] = useState("");
  const [newTeacherId, setNewTeacherId] = useState("");
  const [scope, setScope] = useState("all"); // "all" | "some"
  const [pickedClassIds, setPickedClassIds] = useState([]); // scope === "some"
  const [result, setResult] = useState(null);

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  const sortedTimeslots = useMemo(() => [...timeslots].sort((a, b) => (
    Number(a.lessonNumber || 0) - Number(b.lessonNumber || 0)
  )), [timeslots]);

  const subjName = (sid) => subjectMap.get(sid)?.name || "Fan";
  const teacherName = (tid) => teacherMap.get(tid)?.name || "—";
  const slotNum = (tsId) => slotDisplayNumber(sortedTimeslots.find((s) => s.id === tsId)) || "?";
  const clsNames = (ids) => (ids || []).map((id) => classMap.get(id)?.name).filter(Boolean).join(", ");

  // Ketgan ustozning jadvaldagi darslari (nechta va qaysi sinf/fan)
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

  // Ketgan ustoz "Sinf fanlari"da biriktirilgan sinflar
  const oldTeacherSubjClassIds = useMemo(
    () => classIdsWithTeacherInSubjects(classSubjects, oldTeacherId),
    [classSubjects, oldTeacherId]
  );

  // Sinf tanlash ro'yxati — jadval va sinf fanlari birlashtiriladi
  const oldTeacherClassIds = useMemo(() => {
    const set = new Set();
    oldTeacherLessons.forEach(({ lesson }) => classIdsOf(lesson).forEach((cid) => set.add(cid)));
    oldTeacherSubjClassIds.forEach((cid) => set.add(cid));
    return [...set]
      .filter((cid) => classMap.has(cid))
      .sort((a, b) => cmpName(classMap.get(a)?.name, classMap.get(b)?.name));
  }, [oldTeacherLessons, oldTeacherSubjClassIds, classMap]);

  // Ketgan ustozning sinf bo'yicha dars soni (chip yonida ko'rsatish uchun)
  function lessonCountForClass(cid) {
    return oldTeacherLessons.filter(({ lesson }) => classIdsOf(lesson).includes(cid)).length;
  }

  // Ro'yxatda ko'rinadigan ustozlar: jadvalda darsi bor YOKI sinf fanlariga biriktirilgan
  const teachersWithWork = useMemo(() => {
    const inSchedule = new Set();
    DAYS.forEach((day) => sortedTimeslots.forEach((ts) => {
      (schedule?.[day]?.[ts.id] || []).forEach((l) => { if (l.teacherId) inSchedule.add(l.teacherId); });
    }));
    return sortTeachers(teachers.filter((t) => (
      inSchedule.has(t.id) || countTeacherInClassSubjects({ classSubjects, oldTeacherId: t.id }) > 0
    )));
  }, [teachers, schedule, sortedTimeslots, classSubjects]);

  // Yangi o'qituvchi ro'yxati — alifbo bo'yicha
  const sortedTeachers = useMemo(() => sortTeachers(teachers), [teachers]);

  function totalTeacherLessons(tid) {
    let n = 0;
    DAYS.forEach((day) => sortedTimeslots.forEach((ts) => {
      (schedule?.[day]?.[ts.id] || []).forEach((l) => { if (l.teacherId === tid) n += 1; });
    }));
    return n;
  }

  function resetOld(v) {
    setOldTeacherId(v);
    setPickedClassIds([]);
    setScope("all");
    setResult(null);
  }

  function toggleClass(cid) {
    setPickedClassIds((prev) => prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]);
    setResult(null);
  }

  // Tanlangan sinflar bo'yicha (classId, subjectId) juftlari — jadval uchun
  function buildOnlyPairs() {
    if (scope === "all") return null;
    const pairs = [];
    const seen = new Set();
    oldTeacherLessons.forEach(({ lesson }) => {
      classIdsOf(lesson).forEach((cid) => {
        if (!pickedClassIds.includes(cid)) return;
        const key = `${cid}__${lesson.subjectId}`;
        if (seen.has(key)) return;
        seen.add(key);
        pairs.push({ classId: cid, subjectId: lesson.subjectId });
      });
    });
    return pairs;
  }

  // Sinf fanlari uchun qamrov (null = barcha sinflar)
  const csScopeClassIds = scope === "all" ? null : pickedClassIds;

  // Ko'chiriladigan darslar soni (tugma matni uchun)
  const targetCount = useMemo(() => {
    if (scope === "all") return oldTeacherLessons.length;
    return oldTeacherLessons.filter(({ lesson }) =>
      classIdsOf(lesson).some((cid) => pickedClassIds.includes(cid))).length;
  }, [scope, oldTeacherLessons, pickedClassIds]);

  // "Sinf fanlari"da nechta yozuv yangilanadi
  const csCount = useMemo(() => countTeacherInClassSubjects({
    classSubjects, oldTeacherId, classIds: csScopeClassIds,
  }), [classSubjects, oldTeacherId, scope, pickedClassIds]); // eslint-disable-line react-hooks/exhaustive-deps

  function preview() {
    if (!oldTeacherId || !newTeacherId) { toast?.("Eski va yangi o'qituvchini tanlang", "warning"); return; }
    if (oldTeacherId === newTeacherId) { toast?.("Eski va yangi o'qituvchi bir xil bo'lmasin", "warning"); return; }
    if (scope === "some" && pickedClassIds.length === 0) { toast?.("Kamida bitta sinf tanlang", "warning"); return; }
    const res = replaceTeacher({
      schedule, timeslots, teachers, classes,
      oldTeacherId, newTeacherId, lunchGroups,
      onlyClassSubjectIds: buildOnlyPairs(),
    });
    setResult(res);
    if (res.summary?.error) toast?.(res.summary.error, "warning");
  }

  function apply() {
    if (!result) return;

    // 1) Dars jadvali (schedule)
    if (setSchedule && result.schedule) setSchedule(result.schedule);

    // 2) Sinf fanlari (classSubjects) — ENG MUHIM QADAM.
    //    Bu qilinmasa, jadval qayta tuzilganda generator classSubjects'dan
    //    o'qib, darslarni yana eski ustozga qaytarib qo'yadi.
    let csChanged = 0;
    if (setClassSubjects) {
      const out = applyTeacherToClassSubjects({
        classSubjects, oldTeacherId, newTeacherId, classIds: csScopeClassIds,
      });
      csChanged = out.changed;
      if (csChanged > 0) setClassSubjects(out.classSubjects);
    }

    const s = result.summary || {};
    const swapped = s.swapped || 0;
    const moved = (s.inPlace || 0) + swapped;
    const csTxt = csChanged > 0 ? `, sinf fanlarida ${csChanged} yozuv yangilandi` : "";

    if (s.failed > 0) {
      toast?.(`${moved} dars o'tkazildi, ${s.failed} tasi eski ustozda qoldi${csTxt}`, "warning");
    } else if (moved === 0 && csChanged > 0) {
      toast?.(`Sinf fanlarida ${csChanged} yozuv yangi ustozga o'tkazildi ✓`, "success");
    } else {
      toast?.(`O'qituvchi almashtirildi ✓ (${s.inPlace} joyida, ${swapped} o'rin almashdi)${csTxt}`, "success");
    }

    // qayta boshlash
    setResult(null);
    setOldTeacherId("");
    setNewTeacherId("");
    setScope("all");
    setPickedClassIds([]);
  }

  const oldT = teacherMap.get(oldTeacherId);
  const newT = teacherMap.get(newTeacherId);
  const summary = result?.summary;

  // Yangi ustoz biriktirilmagan fanlar (ogohlantirish)
  const uncovered = useMemo(() => {
    if (!oldT || !newT) return [];
    const newSubj = new Set(Array.isArray(newT.subjectIds) ? newT.subjectIds : (newT.subjectId ? [newT.subjectId] : []));
    const usedSubjects = new Set();
    oldTeacherLessons.forEach(({ lesson }) => {
      if (scope === "all" || classIdsOf(lesson).some((cid) => pickedClassIds.includes(cid))) {
        usedSubjects.add(lesson.subjectId);
      }
    });
    // Sinf fanlaridagi fanlar ham hisobga olinadi (jadval hali tuzilmagan bo'lishi mumkin)
    Object.entries(classSubjects || {}).forEach(([cid, list]) => {
      if (scope === "some" && !pickedClassIds.includes(cid)) return;
      (list || []).forEach((a) => {
        const hit = a.teacherId === oldTeacherId || a.teacherId2 === oldTeacherId
          || a.swapTeacherId === oldTeacherId || a.weekAltTeacherId === oldTeacherId
          || (Array.isArray(a.levelGroups) && a.levelGroups.some((g) => g.teacherId === oldTeacherId));
        if (hit && a.subjectId) usedSubjects.add(a.subjectId);
      });
    });
    return [...usedSubjects].filter((sid) => !newSubj.has(sid));
  }, [oldT, newT, oldTeacherLessons, scope, pickedClassIds, classSubjects, oldTeacherId]);

  const canRun = targetCount > 0 || csCount > 0;

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
        .tr-hero-row{display:flex;align-items:center;gap:18px;position:relative;z-index:1;}
        .tr-hero-badge{flex-shrink:0;width:60px;height:60px;border-radius:18px;display:flex;align-items:center;justify-content:center;
          font-size:30px;background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 10px 26px rgba(99,102,241,.4);}
        .tr-hero h1{margin:0 0 4px;font-size:26px;font-weight:800;letter-spacing:-.5px;color:var(--text-primary,#0f172a);}
        .tr-hero p{margin:0;font-size:14px;line-height:1.5;color:var(--text-secondary,#475569);max-width:640px;}

        .tr-card{background:var(--card-bg,#fff);border:1px solid var(--card-border,#e2e8f0);border-radius:20px;padding:24px;margin-bottom:18px;
          box-shadow:0 1px 3px rgba(15,23,42,.04),0 8px 24px rgba(15,23,42,.04);}

        /* ——— Transfer oqimi (signature) ——— */
        .tr-flow{display:grid;grid-template-columns:1fr auto 1fr;align-items:stretch;gap:0;}
        .tr-slot{border:1.5px solid var(--card-border,#e2e8f0);border-radius:16px;padding:16px;background:var(--bg-secondary,#f8fafc);transition:border-color .18s,box-shadow .18s;}
        .tr-slot.from{border-top:3px solid #3b82f6;}
        .tr-slot.to{border-top:3px solid #10b981;}
        .tr-slot:focus-within{box-shadow:0 0 0 4px rgba(99,102,241,.1);}
        .tr-slot-label{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;margin-bottom:10px;}
        .tr-slot.from .tr-slot-label{color:#2563eb;}
        .tr-slot.to .tr-slot-label{color:#059669;}
        .tr-slot-dot{width:8px;height:8px;border-radius:50%;}
        .tr-slot.from .tr-slot-dot{background:#3b82f6;}
        .tr-slot.to .tr-slot-dot{background:#10b981;}
        .tr-select{width:100%;height:48px;border:1.5px solid var(--card-border,#e2e8f0);border-radius:12px;padding:0 14px;font-size:15px;font-weight:600;
          background:var(--card-bg,#fff);color:var(--text-primary,#1e293b);cursor:pointer;transition:border-color .15s;}
        .tr-select:hover{border-color:#a5b4fc;}
        .tr-select:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 4px rgba(99,102,241,.14);}
        .tr-arrow{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 18px;position:relative;}
        .tr-arrow-line{position:absolute;top:50%;left:0;right:0;height:2px;background:linear-gradient(90deg,#3b82f6,#8b5cf6,#10b981);opacity:.35;}
        .tr-arrow-badge{position:relative;z-index:1;width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;
          font-size:20px;color:#fff;background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 6px 18px rgba(99,102,241,.4);}
        @media(max-width:720px){
          .tr-flow{grid-template-columns:1fr;gap:14px;}
          .tr-arrow{padding:2px 0;transform:rotate(90deg);}
          .tr-arrow-line{display:none;}
        }

        /* ——— Sinf tanlash ——— */
        .tr-scope-wrap{margin-top:22px;padding-top:20px;border-top:1px dashed var(--card-border,#e2e8f0);}
        .tr-label{display:block;font-size:13px;font-weight:700;color:var(--text-secondary,#475569);margin-bottom:10px;}
        .tr-scope{display:flex;gap:10px;margin-bottom:14px;}
        .tr-scope button{flex:1;height:46px;border:1.5px solid var(--card-border,#e2e8f0);border-radius:13px;background:var(--bg-secondary,#f1f5f9);
          color:var(--text-secondary,#64748b);font-weight:700;font-size:14px;cursor:pointer;transition:all .16s;}
        .tr-scope button:hover{border-color:#a5b4fc;color:var(--text-primary,#1e293b);}
        .tr-scope button.on{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border-color:transparent;box-shadow:0 6px 16px rgba(99,102,241,.32);}
        .tr-classes{display:flex;flex-wrap:wrap;gap:9px;}
        .tr-chip{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:12px;border:1.5px solid var(--card-border,#e2e8f0);
          background:var(--card-bg,#fff);cursor:pointer;font-size:14px;font-weight:700;user-select:none;transition:all .15s;}
        .tr-chip:hover{border-color:#a5b4fc;transform:translateY(-1px);}
        .tr-chip.on{background:rgba(99,102,241,.12);border-color:#6366f1;color:#4338ca;}
        .tr-chip .tr-count{font-size:11.5px;font-weight:600;color:var(--text-muted,#94a3b8);}
        .tr-chip.on .tr-count{color:#6366f1;}

        .tr-warn{display:flex;gap:10px;background:#fff7ed;border:1px solid #fdba74;border-radius:13px;padding:12px 14px;font-size:13px;line-height:1.5;color:#9a3412;margin-top:16px;}
        .tr-warn-icon{flex-shrink:0;font-size:16px;line-height:1.3;}
        .tr-note{display:flex;gap:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:13px;padding:12px 14px;font-size:13px;line-height:1.5;color:#1e40af;margin-top:16px;}

        .tr-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px;}
        .tr-btn{display:inline-flex;align-items:center;gap:8px;height:48px;padding:0 26px;border-radius:13px;border:none;font-size:15px;font-weight:700;
          cursor:pointer;transition:transform .12s,filter .12s,box-shadow .12s;}
        .tr-btn:hover{transform:translateY(-1px);filter:brightness(1.05);}
        .tr-btn:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none;}
        .tr-btn-primary{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;box-shadow:0 6px 18px rgba(99,102,241,.32);}
        .tr-btn-success{background:linear-gradient(135deg,#16a34a,#059669);color:#fff;box-shadow:0 6px 18px rgba(22,163,74,.3);}
        .tr-btn-ghost{background:var(--bg-secondary,#f1f5f9);color:var(--text-secondary,#475569);}
        .tr-hint{font-size:13px;color:var(--text-muted,#94a3b8);text-align:right;margin-top:10px;}

        /* ——— Natija ——— */
        .tr-summary{background:linear-gradient(120deg,rgba(59,130,246,.08),rgba(99,102,241,.06));border:1px solid #bae6fd;border-radius:16px;padding:16px 18px;margin-bottom:16px;}
        .tr-summary-title{font-weight:800;font-size:16px;color:#075985;margin-bottom:12px;}
        .tr-stats{display:flex;flex-wrap:wrap;gap:9px;}
        .tr-stat{display:inline-flex;align-items:center;gap:5px;border-radius:10px;padding:6px 13px;font-weight:700;font-size:13.5px;}
        .tr-changes{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;padding-right:4px;}
        .tr-change{display:flex;gap:10px;align-items:center;font-size:14px;background:var(--bg-secondary,#f8fafc);border-radius:11px;padding:10px 13px;border:1px solid transparent;transition:border-color .15s;}
        .tr-change:hover{border-color:var(--card-border,#e2e8f0);}
        .tr-change-icon{flex-shrink:0;width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;}
        .tr-change-icon.inplace{background:#dcfce7;color:#166534;}
        .tr-change-icon.swapped{background:#dbeafe;color:#1e40af;}
        .tr-change b{white-space:nowrap;}
        .tr-change .tr-where{color:var(--text-secondary,#64748b);font-size:13px;}
        .tr-sub{font-size:13px;font-weight:800;color:var(--text-secondary,#475569);margin:18px 0 8px;text-transform:uppercase;letter-spacing:.3px;}
        .tr-others{background:#fefce8;border:1px solid #fde68a;border-radius:12px;padding:12px 14px;}
        .tr-others div{font-size:13px;color:#713f12;line-height:1.6;}
        .tr-fail{background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;margin-top:12px;}
        .tr-fail div{font-size:13px;color:#7f1d1d;line-height:1.6;}

        /* ——— Empty state: 3 qadam ——— */
        .tr-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:2px;}
        @media(max-width:720px){.tr-steps{grid-template-columns:1fr;}}
        .tr-step{position:relative;background:var(--card-bg,#fff);border:1px solid var(--card-border,#e2e8f0);border-radius:18px;padding:22px 20px;
          box-shadow:0 1px 3px rgba(15,23,42,.03);}
        .tr-step-num{width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;
          color:#fff;margin-bottom:14px;}
        .tr-step:nth-child(1) .tr-step-num{background:linear-gradient(135deg,#3b82f6,#6366f1);}
        .tr-step:nth-child(2) .tr-step-num{background:linear-gradient(135deg,#8b5cf6,#a855f7);}
        .tr-step:nth-child(3) .tr-step-num{background:linear-gradient(135deg,#10b981,#059669);}
        .tr-step h4{margin:0 0 6px;font-size:15px;font-weight:700;color:var(--text-primary,#1e293b);}
        .tr-step p{margin:0;font-size:13px;line-height:1.55;color:var(--text-secondary,#64748b);}
      `}</style>

      <div className="tr-hero">
        <div className="tr-hero-row">
          <div className="tr-hero-badge">🔄</div>
          <div>
            <h1>O'qituvchini almashtirish</h1>
            <p>Ketgan o'qituvchining darslarini yangi o'qituvchiga o'tkazadi — dars jadvalida ham, <b>Sinf fanlarida</b> ham. Yangi ustoz band bo'lgan soatlarda dars sinfning boshqa darsi bilan o'rin almashtiriladi, jadvalda bo'sh katak qolmaydi.</p>
          </div>
        </div>
      </div>

      <div className="tr-card">
        <div className="tr-flow">
          <div className="tr-slot from">
            <div className="tr-slot-label"><span className="tr-slot-dot" /> Ketgan o'qituvchi</div>
            <select className="tr-select" value={oldTeacherId} onChange={(e) => resetOld(e.target.value)}>
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

        {oldTeacherId && oldTeacherClassIds.length > 0 && (
          <div className="tr-scope-wrap">
            <label className="tr-label">Qaysi sinflardagi darslar ko'chirilsin?</label>
            <div className="tr-scope">
              <button type="button" className={scope === "all" ? "on" : ""} onClick={() => { setScope("all"); setResult(null); }}>
                Barcha sinflar ({oldTeacherClassIds.length})
              </button>
              <button type="button" className={scope === "some" ? "on" : ""} onClick={() => { setScope("some"); setResult(null); }}>
                Tanlangan sinflar
              </button>
            </div>

            {scope === "some" && (
              <div className="tr-classes">
                {oldTeacherClassIds.map((cid) => {
                  const on = pickedClassIds.includes(cid);
                  const n = lessonCountForClass(cid);
                  return (
                    <div key={cid} className={`tr-chip ${on ? "on" : ""}`} onClick={() => toggleClass(cid)}>
                      <span>{on ? "☑" : "☐"}</span>
                      <span>{classMap.get(cid)?.name || cid}</span>
                      <span className="tr-count">{n > 0 ? `${n} dars` : "sinf fanlarida"}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {oldTeacherId && newTeacherId && csCount > 0 && (
          <div className="tr-note">
            <span className="tr-warn-icon">🔗</span>
            <span>
              <b>Sinf fanlari</b> ham yangilanadi: {csCount} ta yozuvda ustoz almashtiriladi.
              Shu tufayli jadvalni qaytadan tuzganingizda dars eski ustozga qaytmaydi.
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

        {oldTeacherId && newTeacherId && !canRun && (
          <div className="tr-hint">Ko'chiradigan dars yo'q — sinf tanlang.</div>
        )}
      </div>

      {result && summary && !summary.error && (
        <div className="tr-card">
          <div className="tr-summary">
            <div className="tr-summary-title">
              Natija: {summary.totalLessons} ta dars{csCount > 0 ? ` · ${csCount} ta sinf fani yozuvi` : ""}
            </div>
            <div className="tr-stats">
              <span className="tr-stat" style={{ background: "#dcfce7", color: "#166534" }}>✓ {summary.inPlace} o'z joyida</span>
              {summary.swapped > 0 && <span className="tr-stat" style={{ background: "#dbeafe", color: "#1e40af" }}>⇄ {summary.swapped} o'rin almashdi</span>}
              {summary.failed > 0 && <span className="tr-stat" style={{ background: "#fee2e2", color: "#991b1b" }}>✕ {summary.failed} eski ustozda qoldi</span>}
              {csCount > 0 && <span className="tr-stat" style={{ background: "#ede9fe", color: "#5b21b6" }}>🔗 {csCount} sinf fani yangilanadi</span>}
            </div>
          </div>

          {result.changes.length > 0 && (
            <>
              <div className="tr-sub">O'zgarishlar:</div>
              <div className="tr-changes">
                {result.changes.map((c, i) => {
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

          {result.movedOthers.length > 0 && (
            <>
              <div className="tr-sub">O'rin almashgan darslar (bo'sh katak qolmasligi uchun):</div>
              <div className="tr-others">
                {result.movedOthers.map((m, i) => (
                  <div key={i}>• {clsNames(m.classIds)} {subjName(m.subjectId)} ({teacherName(m.teacherId)}): {m.from.day} {slotNum(m.from.tsId)}-dars → {m.to.day} {slotNum(m.to.tsId)}-dars</div>
                ))}
              </div>
            </>
          )}

          {result.failed.length > 0 && (
            <div className="tr-fail">
              <div style={{ fontWeight: 700, marginBottom: 4 }}>O'tkazib bo'lmagan darslar (mos o'rin almashuv topilmadi — eski ustoz nomida joyida qoladi):</div>
              {result.failed.map((f, i) => (
                <div key={i}>• {clsNames(f.classIds)} {subjName(f.subjectId)} — {f.at.day} {slotNum(f.at.tsId)}-dars</div>
              ))}
            </div>
          )}

          <div className="tr-actions" style={{ marginTop: 18 }}>
            <button type="button" className="tr-btn tr-btn-ghost" onClick={() => setResult(null)}>Qaytish</button>
            <button type="button" className="tr-btn tr-btn-success" onClick={apply}>Tasdiqlash va qo'llash</button>
          </div>
        </div>
      )}

      {!oldTeacherId && (
        <div className="tr-steps">
          <div className="tr-step">
            <div className="tr-step-num">1</div>
            <h4>Ketgan o'qituvchini tanlang</h4>
            <p>Maktabdan ketgan yoki darslari boshqaga o'tishi kerak bo'lgan o'qituvchini ro'yxatdan tanlang.</p>
          </div>
          <div className="tr-step">
            <div className="tr-step-num">2</div>
            <h4>Yangi o'qituvchini tanlang</h4>
            <p>Darslar kimga o'tkazilishini belgilang. Fanlar mos kelmasa, ogohlantirish ko'rsatiladi.</p>
          </div>
          <div className="tr-step">
            <div className="tr-step-num">3</div>
            <h4>Ko'ring va qo'llang</h4>
            <p>Jadval bilan birga Sinf fanlari ham yangilanadi — jadvalni qayta tuzganda eski ustoz qaytmaydi.</p>
          </div>
        </div>
      )}
    </div>
  );
}
