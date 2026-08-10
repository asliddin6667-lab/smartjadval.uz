import { useMemo, useState } from "react";
import { DAYS, typeOfGroup } from "../utils/constants";
import {
  generateSchedule, isTeachingSlot, classHasLunchAt, classesHaveLunchAt, compactSchedule,
} from "../utils/scheduleGenerator";
import { exportColoredSchedule } from "../utils/coloredScheduleExport";
import {
  collectCardEntries, unitOf, resolveMove, applyActions, softWarnings, checkPlace,
  findAutoPartner, onlyBusyReasons, unitLabel, slotLabel,
} from "../utils/moveResolver";
import MoveResolveModal from "../components/MoveResolveModal";
import TeacherGrid from "../components/TeacherGrid";
import "../styles/scheduleGrid.css";

const FALLBACK_PALETTE = [
  "#2563eb", "#16a34a", "#7c3aed", "#0891b2", "#f97316",
  "#059669", "#e11d48", "#d97706", "#4f46e5", "#0d9488",
  "#c2410c", "#64748b", "#be123c", "#9333ea", "#0284c7",
];

const SWAP_CHIP = {
  marginTop: 4,
  display: "block",
  fontSize: 10.5,
  fontWeight: 800,
  lineHeight: 1.25,
  color: "#7c3aed",
  background: "rgba(124,58,237,.12)",
  border: "1px dashed rgba(124,58,237,.45)",
  borderRadius: 7,
  padding: "3px 6px",
};

function hashText(text = "") {
  return String(text).split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

function subjectColor(subject, index = 0) {
  return subject?.color || FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
}

function hexToRgb(hex = "#6366f1") {
  const cleaned = hex.replace("#", "");
  const full = cleaned.length === 3
    ? cleaned.split("").map((c) => c + c).join("")
    : cleaned;
  const value = parseInt(full, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function classIdsOf(lesson) {
  return Array.isArray(lesson?.classIds) ? lesson.classIds : [lesson?.classId].filter(Boolean);
}

function uniqBy(array, getKey) {
  const seen = new Set();
  return array.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Vaqt sloti shu sinfga tegishlimi? classIds bo'sh bo'lsa — barcha sinflarga tegishli
function slotAllowsClass(slot, classId) {
  const ids = Array.isArray(slot?.classIds) ? slot.classIds : [];
  return ids.length === 0 || ids.includes(classId);
}

export default function SchedulePage({
  classes = [],
  subjects = [],
  teachers = [],
  rooms = [],
  timeslots = [],
  lunchGroups = [],
  schedule = {},
  classSubjects = {},
  setSchedule,
  toast,
}) {
  const [gridMode, setGridMode] = useState("class"); // "class" | "teacher"
  const [selectedClass, setSelectedClass] = useState("all");
  const [viewMode, setViewMode] = useState("table");
  const [collapsed, setCollapsed] = useState({});
  const [manualCell, setManualCell] = useState(null); // { day, slotId, classId }
  const [manualForm, setManualForm] = useState({ subjectId: "", teacherId: "", roomId: "", altEnabled: false, altSubjectId: "", altTeacherId: "", lock: false });
  const [resolveData, setResolveData] = useState(null); // { classId, subjectId, name, placements }
  const [moveData, setMoveData] = useState(null);       // MoveResolveModal ma'lumoti
  const [drag, setDrag] = useState(null);               // { day, slotId, classId, unit }
  const [picked, setPicked] = useState(null);           // bosib tanlangan dars
  const active = drag || picked;                        // hozir ko'chirilayotgan dars
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genRound, setGenRound] = useState(0);
  const [genDone, setGenDone] = useState(false);

  const subjectMap = useMemo(() => new Map(subjects.map((s, i) => [s.id, { ...s, _colorIndex: i }])), [subjects]);
  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const roomMap = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  const sortedClasses = useMemo(() => [...classes].sort((a, b) => (
    String(a.name).localeCompare(String(b.name), "uz", { numeric: true })
  )), [classes]);

  const sortedTimeslots = useMemo(() => [...timeslots].sort((a, b) => (
    Number(a.lessonNumber || 0) - Number(b.lessonNumber || 0)
  )), [timeslots]);

  const visibleClasses = selectedClass === "all"
    ? sortedClasses
    : sortedClasses.filter((c) => c.id === selectedClass);

  // moveResolver uchun umumiy kontekst
  const ctx = { schedule, classes, subjects, teachers, rooms, timeslots: sortedTimeslots, lunchGroups, classSubjects };

  function getName(map, id, fallback = "—") {
    return map.get(id)?.name || fallback;
  }

  function getClassLessons(day, timeSlotId, classId) {
    const cell = schedule?.[day]?.[timeSlotId];
    if (!Array.isArray(cell)) return [];
    return cell.filter((lesson) => classIdsOf(lesson).includes(classId));
  }

  function groupLessons(lessons = []) {
    const grouped = new Map();
    lessons.forEach((lesson) => {
      const key = [lesson.subjectId, lesson.groupKey || "", lesson.blockIndex ?? ""].join("__");
      if (!grouped.has(key)) grouped.set(key, { ...lesson, parts: [] });
      grouped.get(key).parts.push(lesson);
    });
    return [...grouped.values()];
  }

  function lessonDetails(lesson) {
    const subject = subjectMap.get(lesson.subjectId);
    const subjectName = lesson.subjectName || subject?.name || "Fan";
    const color = subjectColor(subject, hashText(subjectName));
    const parts = lesson.parts?.length ? lesson.parts : [lesson];

    const uniqueClassNames = uniqBy(
      parts.flatMap((part) => classIdsOf(part).map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean)),
      (name) => name
    );

    return {
      subject,
      subjectName,
      color,
      bg: rgba(color, 0.10),
      border: rgba(color, 0.30),
      soft: rgba(color, 0.16),
      parts,
      uniqueClassNames,
    };
  }

  function renderLessonCard(lesson) {
    const detail = lessonDetails(lesson);
    const hasManyParts = detail.parts.length > 1;
    const isParallel = detail.uniqueClassNames.length > 1;
    const isAlt = lesson.alternating && lesson.altSubjectId;
    const altName = isAlt ? (subjectMap.get(lesson.altSubjectId)?.name || "Fan") : "";
    const altTeacher = isAlt && lesson.altTeacherId ? getName(teacherMap, lesson.altTeacherId, "") : "";

    return (
      <div
        className="pretty-lesson-card"
        style={{
          "--lesson-color": detail.color,
          "--lesson-bg": detail.bg,
          "--lesson-border": detail.border,
          "--lesson-soft": detail.soft,
        }}
      >
        <div className="pretty-lesson-title">
          {lesson.locked && <span title="Qulflangan">🔒 </span>}
          {detail.subjectName}
          {isAlt && <span className="pretty-alt-sep"> / {altName}</span>}
        </div>

        {hasManyParts ? (
          <div className="pretty-lesson-groups">
            {detail.parts.map((part, index) => {
              const teacher = getName(teacherMap, part.teacherId, "Ustoz tanlanmagan");
              const room = part.roomId ? getName(roomMap, part.roomId, "Xona") : "Xonasiz";
              return (
                <div className="pretty-group-line" key={`${part.teacherId}-${index}`}>
                  <span>{part.groupPart || part.groupName || `${index + 1}-guruh`}</span>
                  <b>{teacher}</b>
                  <em>{room}</em>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="pretty-lesson-meta">
            <span>👤 {getName(teacherMap, lesson.teacherId, "Ustoz tanlanmagan")}</span>
            <span>•</span>
            <span>{lesson.roomId ? getName(roomMap, lesson.roomId, "Xona") : "Xonasiz"}</span>
          </div>
        )}

        {isAlt && (
          <div className="pretty-alt-chip">
            ⇄ Juft/toq hafta almashinuvi{altTeacher ? ` · ${altName}: ${altTeacher}` : ""}
          </div>
        )}

        {isParallel && (
          <div className="pretty-parallel-chip">
            Parallel: {detail.uniqueClassNames.join(", ")}
          </div>
        )}
      </div>
    );
  }

  // ═══════════ DRAG & DROP (sinf setkasi) ═══════════

  function srcOf(day, slotId, classId, card) {
    const cell = schedule?.[day]?.[slotId] || [];
    const entries = collectCardEntries(cell, card);
    if (!entries.length) return null;
    return { day, slotId, classId, unit: unitOf(entries) };
  }

  function dragStart(e, day, slotId, classId, card) {
    const src = srcOf(day, slotId, classId, card);
    if (!src) return;
    // dataTransfer bo'sh bo'lsa ba'zi brauzerlar sudrashni boshlamaydi
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `${day}__${slotId}`);
    } catch { /* eski brauzerlar */ }
    setPicked(null);
    // DOM drag boshlanishida qayta chizilmasligi uchun keyingi kadrga suramiz
    setTimeout(() => setDrag(src), 0);
  }

  // Bosib tanlash — sudrash ishlamaganda ishonchli muqobil
  function togglePick(day, slotId, classId, card) {
    if (!setSchedule) return;
    const src = srcOf(day, slotId, classId, card);
    if (!src) return;
    if (picked && picked.day === day && picked.slotId === slotId
      && picked.unit.entries[0] === src.unit.entries[0]) {
      setPicked(null);
      return;
    }
    setPicked(src);
    toast?.("Dars tanlandi — endi qaysi katakka qo'yishni bosing", "success");
  }

  function isPickedCard(day, slotId, card) {
    if (!picked || picked.day !== day || picked.slotId !== slotId) return false;
    const cell = schedule?.[day]?.[slotId] || [];
    const entries = collectCardEntries(cell, card);
    return entries[0] === picked.unit.entries[0];
  }

  function clearActive() {
    setDrag(null);
    setPicked(null);
  }

  // Maqsad katak tahlili — 'self' | 'nt' | 'move' | 'swap' | 'no'
  function targetInfo(day, slot, cls) {
    if (!active) return null;
    if (active.day === day && active.slotId === slot.id) return { kind: "self" };
    if (!isTeachingSlot(slot)) return { kind: "nt" };
    if (!slotAllowsClass(slot, cls.id)) return { kind: "no" };

    const srcTs = sortedTimeslots.find((s) => s.id === active.slotId);
    const cards = groupLessons(getClassLessons(day, slot.id, cls.id));
    if (cards.length > 1) return { kind: "no", multi: true };

    const cell = schedule?.[day]?.[slot.id] || [];

    // 1) Shu sinfda dars turibdi — to'g'ridan-to'g'ri almashinuv
    if (cards.length === 1) {
      const partner = unitOf(collectCardEntries(cell, cards[0]));
      if (partner.entries.some((e) => active.unit.entries.includes(e))) return { kind: "self" };
      const a = checkPlace(ctx, active.unit, day, slot, new Set(partner.entries));
      const b = checkPlace(ctx, partner, active.day, srcTs, new Set(active.unit.entries));
      return (!a.length && !b.length) ? { kind: "swap", partner } : { kind: "no", partner };
    }

    // 2) Sinf uchun bo'sh — lekin ustoz/xona boshqa sinfda band bo'lishi mumkin
    const errs = checkPlace(ctx, active.unit, day, slot, new Set());
    if (!errs.length) return { kind: "move" };

    if (onlyBusyReasons(errs)) {
      const auto = findAutoPartner(ctx, active.unit, day, slot);
      if (auto) {
        const a = checkPlace(ctx, active.unit, day, slot, new Set(auto.entries));
        const b = checkPlace(ctx, auto, active.day, srcTs, new Set(active.unit.entries));
        if (!a.length && !b.length) return { kind: "swap", partner: auto, auto: true };
        return { kind: "no", partner: auto };
      }
    }
    return { kind: "no" };
  }

  // Ko'chirish paytida faqat manba sinf uchun bir marta hisoblanadi
  const activeMap = useMemo(() => {
    const map = new Map();
    if (!active) return map;
    const cls = classes.find((c) => c.id === active.classId);
    if (!cls) return map;
    DAYS.forEach((day) => {
      sortedTimeslots.forEach((slot) => {
        map.set(`${day}__${slot.id}`, targetInfo(day, slot, cls));
      });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, schedule, sortedTimeslots, classes]);

  function commitMove(day, slot, cls) {
    const src = active;
    if (!src || !setSchedule) return;
    if (src.day === day && src.slotId === slot.id) { clearActive(); return; }

    if (src.classId !== cls.id) {
      setMoveData({
        mode: "blocked",
        reasons: ["Darsni faqat o'z sinfi jadvalida ko'chiring."],
        suggestions: [],
      });
      clearActive();
      return;
    }

    const cards = groupLessons(getClassLessons(day, slot.id, cls.id));
    if (cards.length > 1) {
      setMoveData({
        mode: "blocked",
        reasons: ["Bu katakda bir nechta dars bor — avtomatik almashtirib bo'lmaydi. Avval birini o'chiring."],
        suggestions: [],
      });
      clearActive();
      return;
    }

    const cell = schedule?.[day]?.[slot.id] || [];
    const partnerUnit = cards.length === 1 ? unitOf(collectCardEntries(cell, cards[0])) : null;

    // autoSwap: maqsad katakni band qilib turgan dars avtomatik sherik bo'ladi
    const res = resolveMove(ctx, src, { day, slotId: slot.id, partnerUnit, autoSwap: true });
    const partner = res.partner || partnerUnit || null;
    const lockedTouched = Boolean(src.unit.locked || partner?.locked);
    const warnings = [
      ...softWarnings(ctx, src.unit, day),
      ...(res.mode === "swap" && partner ? softWarnings(ctx, partner, src.day) : []),
    ];

    if (res.ok && !lockedTouched && !warnings.length) {
      setSchedule(applyActions(schedule, res.actions));
      if (res.mode === "swap" && partner) {
        toast?.(
          `⇄ ${unitLabel(ctx, src.unit)} (${slotLabel(ctx, src.day, src.slotId)}) ↔ ` +
          `${unitLabel(ctx, partner)} (${slotLabel(ctx, day, slot.id)}) — o'rin almashdi ✓`,
          "success"
        );
      } else {
        toast?.(`Dars ${slotLabel(ctx, day, slot.id)} ga ko'chirildi ✓`, "success");
      }
    } else if (res.ok) {
      setMoveData({
        mode: "confirm",
        title: lockedTouched
          ? "Qulflangan dars o'zgaradi"
          : (res.mode === "swap" ? "Almashinuvni tasdiqlang" : "Ko'chirishni tasdiqlang"),
        actions: res.actions,
        warnings,
      });
    } else {
      setMoveData({ ...res, warnings });
    }
    clearActive();
  }

  function applyMoveActions(actions) {
    if (!setSchedule || !Array.isArray(actions)) return;
    setSchedule(applyActions(schedule, actions));
    setMoveData(null);
    toast?.("O'zgarish qo'llandi ✓", "success");
  }

  // ═══════════ QULFLASH ═══════════

  function toggleLock(day, slotId, card, value) {
    if (!setSchedule) return;
    const cell = schedule?.[day]?.[slotId] || [];
    const entries = collectCardEntries(cell, card);
    const next = { ...schedule, [day]: { ...(schedule?.[day] || {}) } };
    next[day][slotId] = cell.map((l) =>
      entries.includes(l) ? { ...l, locked: value, manual: value ? true : l.manual } : l
    );
    setSchedule(next);
    toast?.(value ? "Dars qulflandi 🔒" : "Qulf ochildi 🔓", "success");
  }

  function lockedCount() {
    let n = 0;
    DAYS.forEach((d) => sortedTimeslots.forEach((ts) => {
      (schedule?.[d]?.[ts.id] || []).forEach((l) => { if (l.locked) n += 1; });
    }));
    return n;
  }

  function unlockAll() {
    if (!setSchedule) return;
    const next = {};
    DAYS.forEach((day) => {
      next[day] = {};
      sortedTimeslots.forEach((ts) => {
        next[day][ts.id] = (schedule?.[day]?.[ts.id] || []).map((l) =>
          l.locked ? { ...l, locked: false } : l
        );
      });
    });
    setSchedule(next);
    toast?.("Barcha qulflar ochildi 🔓", "success");
  }

  // ═══════════ KATAK RENDERI ═══════════

  function renderCell(day, slot, cls) {
    const offDays = Array.isArray(cls?.offDays) ? cls.offDays : [];
    if (offDays.includes(day)) return <div className="pretty-empty-cell" style={{ color: "#b45309", fontWeight: 700 }}>Dam</div>;
    if (!slotAllowsClass(slot, cls.id)) return <div className="pretty-empty-cell">—</div>;
    if (!isTeachingSlot(slot)) {
      const label = slot.type === "lunch" ? "🍽️ Obed" : "Tanaffus";
      return <div className="pretty-empty-cell" style={{ color: "#6b7280", fontWeight: 700 }}>{label}</div>;
    }
    if (classHasLunchAt(slot, cls.id, lunchGroups, day)) {
      const lg = (lunchGroups || []).find(g =>
        (Array.isArray(g.classIds) ? g.classIds : []).includes(cls.id) &&
        (Array.isArray(g.timeslotIds) && g.timeslotIds.length
          ? g.timeslotIds.includes(slot.id) && (!Array.isArray(g.days) || !g.days.length || g.days.includes(day))
          : String(slot.startTime) < String(g.endTime) && String(slot.endTime) > String(g.startTime))
      );
      const tt = typeOfGroup(lg);
      return <div className="pretty-empty-cell" style={{ color: tt.color, fontWeight: 700 }}>{tt.icon} {tt.label}</div>;
    }

    const lessons = groupLessons(getClassLessons(day, slot.id, cls.id));

    if (!lessons.length) {
      if (setSchedule && !picked) {
        return (
          <button type="button" className="schd-add"
            onClick={(e) => { e.stopPropagation(); openManual(day, slot.id, cls.id); }}
            title="Qo'lda dars qo'shish">＋</button>
        );
      }
      return <div className="pretty-empty-cell">—</div>;
    }

    return (
      <div className="pretty-cell-stack">
        {lessons.map((lesson, i) => (
          <div
            key={i}
            className={`schd-card-wrap ${lesson.locked ? "schd-locked" : ""}`}
            draggable={Boolean(setSchedule)}
            style={isPickedCard(day, slot.id, lesson)
              ? { outline: "2px solid #7c3aed", outlineOffset: "1px", borderRadius: 10, cursor: "grab" }
              : (setSchedule ? { cursor: "grab" } : undefined)}
            title="Sudrab ko'chiring yoki bosib tanlang"
            onDragStart={(e) => dragStart(e, day, slot.id, cls.id, lesson)}
            onDragEnd={() => setDrag(null)}
            onClick={(e) => { e.stopPropagation(); togglePick(day, slot.id, cls.id, lesson); }}
          >
            {setSchedule && (
              <div className="schd-tools">
                <button type="button" title={lesson.locked ? "Qulfni ochish" : "Qulflash"}
                  onClick={(e) => { e.stopPropagation(); toggleLock(day, slot.id, lesson, !lesson.locked); }}>
                  {lesson.locked ? "🔒" : "🔓"}
                </button>
                <button type="button" className="schd-x" title="O'chirish"
                  onClick={(e) => { e.stopPropagation(); removeLessonCard(day, slot.id, cls.id, lesson); }}>✕</button>
              </div>
            )}
            {renderLessonCard(lesson)}
          </div>
        ))}
        {setSchedule && !picked && (
          <button type="button" className="schd-add schd-add-sm"
            onClick={(e) => { e.stopPropagation(); openManual(day, slot.id, cls.id); }}
            title="Yana dars qo'shish">＋</button>
        )}
      </div>
    );
  }

  // ═══════════ GENERATOR ═══════════

  function countPlacedUnits(sch) {
    let n = 0;
    DAYS.forEach((d) => sortedTimeslots.forEach((ts) => {
      if (!isTeachingSlot(ts)) return;
      const cell = sch?.[d]?.[ts.id] || [];
      const seen = new Set();
      cell.forEach((l) => classIdsOf(l).forEach((cid) => {
        const k = `${cid}__${l.subjectId}`;
        if (!seen.has(k)) { seen.add(k); n += 1; }
      }));
    }));
    return n;
  }

  // Sifat o'lchovi: oynalar (bo'sh oraliq darslar) soni — kam bo'lgani yaxshi
  function countGaps(sch) {
    let gaps = 0;
    classes.forEach((cls) => {
      const off = new Set(Array.isArray(cls.offDays) ? cls.offDays : []);
      DAYS.forEach((day) => {
        if (off.has(day)) return;
        let free = 0;
        let head = 0;
        sortedTimeslots.forEach((ts) => {
          if (!isTeachingSlot(ts)) return;
          if (!slotAllowsClass(ts, cls.id)) return;
          if (classHasLunchAt(ts, cls.id, lunchGroups, day)) return;
          const busy = (sch?.[day]?.[ts.id] || []).some((l) => classIdsOf(l).includes(cls.id));
          if (busy) head += free; else free += 1;
        });
        gaps += head;
      });
    });
    return gaps;
  }

  // Faqat qulflangan darslarni saqlab qoladigan "urug'" jadval
  function lockedSeed() {
    const seed = {};
    let has = false;
    DAYS.forEach((day) => {
      seed[day] = {};
      sortedTimeslots.forEach((ts) => {
        const keep = (schedule?.[day]?.[ts.id] || []).filter((l) => l && l.locked);
        seed[day][ts.id] = keep.map((l) => ({ ...l, manual: true, locked: true }));
        if (keep.length) has = true;
      });
    });
    return has ? seed : null;
  }

  async function handleGenerate() {
    if (!setSchedule || generating) return;

    let requiredTotal = 0;
    classes.forEach((c) => (classSubjects?.[c.id] || []).forEach((a) => {
      requiredTotal += Number(a.weeklyHours || 0);
      if (a.swapEnabled && a.swapSubjectId) requiredTotal += Number(a.weeklyHours || 0);
    }));

    const seed = lockedSeed();
    const keptLocked = lockedCount();

    setGenerating(true);
    setGenProgress(0);
    setGenRound(0);

    try {
      // Ko'p bosqichli qidiruv: har bir urinishdan eng yaxshisi saqlanadi.
      // Tanlov mezoni leksikografik — (1) joylangan soat, (2) oynalar soni.
      const MAX_ROUNDS = 30;
      const TIME_CAP_MS = 30000;
      const STALL_LIMIT = 6;     // yaxshilanmasa erta to'xtash
      const start = Date.now();

      let best = null;
      let bestPlaced = -1;
      let bestGaps = Infinity;
      let stall = 0;

      for (let r = 0; r < MAX_ROUNDS; r++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => setTimeout(res, 12));

        const cand = generateSchedule(
          classes, subjects, teachers, rooms, timeslots, classSubjects, lunchGroups, seed
        );
        const placed = countPlacedUnits(cand);
        const gaps = countGaps(cand);

        const better = placed > bestPlaced || (placed === bestPlaced && gaps < bestGaps);
        if (better) {
          bestPlaced = placed;
          bestGaps = gaps;
          best = cand;
          stall = 0;
        } else {
          stall += 1;
        }

        setGenProgress(requiredTotal > 0 ? Math.min(100, Math.round((bestPlaced / requiredTotal) * 100)) : 100);
        setGenRound(r + 1);

        if (requiredTotal > 0 && bestPlaced >= requiredTotal && bestGaps === 0) break;
        if (stall >= STALL_LIMIT && requiredTotal > 0 && bestPlaced >= requiredTotal) break;
        if (Date.now() - start > TIME_CAP_MS) break;
      }

      let finalSch = best || {};

      // Tushmagan soatlarni ko'chirish/almashtirish orqali to'ldirish
      if (requiredTotal > 0 && bestPlaced < requiredTotal) {
        const res = fillRemaining(finalSch, false);
        if (res.placed > 0) {
          finalSch = res.schedule;
          bestPlaced = countPlacedUnits(finalSch);
        }
      }

      // Yakuniy zichlash — "ora kunda" sozlamasi saqlanadi (classSubjects 5-argument)
      try {
        const compacted = compactSchedule(classes, timeslots, lunchGroups, finalSch, classSubjects);
        if (countPlacedUnits(compacted) >= bestPlaced && countGaps(compacted) <= countGaps(finalSch)) {
          finalSch = compacted;
        }
      } catch {
        /* zichlash ixtiyoriy — xato bo'lsa jadval o'z holicha qoladi */
      }

      setSchedule(finalSch);

      const lockNote = keptLocked > 0 ? ` · ${keptLocked} ta qulflangan dars saqlandi 🔒` : "";
      if (requiredTotal === 0 || bestPlaced >= requiredTotal) {
        toast?.(`Dars jadvali 100% tuzildi ✓${lockNote}`, "success");
      } else {
        toast?.(`Jadval tuzildi — ${requiredTotal - bestPlaced} soat tushmadi${lockNote}`, "warning");
      }

      setGenDone(true);
      await new Promise((res) => setTimeout(res, 1100));
    } finally {
      setGenerating(false);
      setGenDone(false);
    }
  }

  // ——— Qo'lda dars qo'shish / o'chirish va tushmagan soatlar ———

  function teachersForSubject(subjectId) {
    return teachers.filter((t) => {
      const ids = Array.isArray(t.subjectIds) ? t.subjectIds : (t.subjectId ? [t.subjectId] : []);
      return ids.includes(subjectId);
    });
  }

  function placedHours(classId, subjectId) {
    let count = 0;
    DAYS.forEach((day) => {
      sortedTimeslots.forEach((slot) => {
        const cell = schedule?.[day]?.[slot.id];
        if (Array.isArray(cell) && cell.some((l) => l.subjectId === subjectId && classIdsOf(l).includes(classId))) {
          count += 1;
        }
      });
    });
    return count;
  }

  function requiredHours(classId, subjectId) {
    const list = classSubjects?.[classId] || [];
    let req = 0;
    list.forEach((a) => {
      if (a.subjectId === subjectId) req += Number(a.weeklyHours || 0);
      if (a.swapEnabled && a.swapSubjectId === subjectId) req += Number(a.weeklyHours || 0);
    });
    return req;
  }

  function missingForClass(classId) {
    const list = classSubjects?.[classId] || [];
    const subjectIds = new Set();
    list.forEach((a) => {
      if (a.subjectId) subjectIds.add(a.subjectId);
      if (a.swapEnabled && a.swapSubjectId) subjectIds.add(a.swapSubjectId);
    });
    const result = [];
    subjectIds.forEach((sid) => {
      const need = requiredHours(classId, sid);
      const got = placedHours(classId, sid);
      if (need > 0 && got < need) {
        result.push({ subjectId: sid, name: subjectMap.get(sid)?.name || "Fan", missing: need - got, need, got });
      }
    });
    return result.sort((a, b) => b.missing - a.missing);
  }

  function conflictsAt(day, slotId, classId, teacherId, roomId) {
    const cell = schedule?.[day]?.[slotId];
    const warns = [];
    if (!Array.isArray(cell)) return warns;
    if (teacherId) {
      const tConf = cell.find((l) => l.teacherId === teacherId);
      if (tConf) {
        const where = classIdsOf(tConf).map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
        warns.push(`⚠️ Ustoz bu vaqtda band (parallel): ${getName(teacherMap, teacherId)} → ${where || "boshqa sinf"}`);
      }
      const t = teacherMap.get(teacherId);
      if (Array.isArray(t?.offDays) && t.offDays.includes(day)) {
        warns.push(`⛔ ${t.name}: ${day} — ustozning dam olish kuni, dars qo'yib bo'lmaydi`);
      }
    }
    if (roomId) {
      const rConf = cell.find((l) => l.roomId === roomId);
      if (rConf) warns.push(`⚠️ Xona bu vaqtda band: ${getName(roomMap, roomId)}`);
    }
    const classHas = cell.some((l) => classIdsOf(l).includes(classId));
    if (classHas) warns.push("ℹ️ Bu sinfda shu vaqtda dars bor (guruh sifatida qo'shilishi mumkin).");
    return warns;
  }

  function assignedTeacher(classId, subjectId) {
    const list = classSubjects?.[classId] || [];
    const a = list.find((x) => x.subjectId === subjectId);
    if (a?.levelGroupEnabled && a?.levelGroups?.length) return "";
    if (a?.teacherId) return a.teacherId;
    return "";
  }

  function levelGroupInfo(classId, subjectId) {
    const a = (classSubjects?.[classId] || []).find((x) => x.subjectId === subjectId);
    if (!a || !a.levelGroupEnabled || !(a.levelGroups?.length)) return null;
    const key = String(a.levelGroupKey || "").trim();
    const participating = classes
      .filter((c) => {
        const aa = (classSubjects?.[c.id] || []).find((x) => x.subjectId === subjectId);
        return aa && aa.levelGroupEnabled && String(aa.levelGroupKey || "").trim() === key;
      })
      .map((c) => c.id);
    return { groups: a.levelGroups, classIds: participating.length ? participating : [classId] };
  }

  function openManual(day, slotId, classId, presetSubjectId = "") {
    setManualForm({
      subjectId: presetSubjectId,
      teacherId: presetSubjectId ? assignedTeacher(classId, presetSubjectId) : "",
      roomId: "", altEnabled: false, altSubjectId: "", altTeacherId: "", lock: false,
    });
    setManualCell({ day, slotId, classId });
  }

  function groupConflictsAt(day, slotId, classIds, groups) {
    const cell = schedule?.[day]?.[slotId];
    const warns = [];
    if (!Array.isArray(cell)) return warns;
    (groups || []).forEach((g) => {
      if (!g.teacherId) return;
      const conf = cell.find((l) => l.teacherId === g.teacherId);
      if (conf) {
        const where = classIdsOf(conf).map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
        warns.push(`⚠️ ${getName(teacherMap, g.teacherId)} bu vaqtda band (parallel): ${where || "boshqa sinf"}`);
      }
      const t = teacherMap.get(g.teacherId);
      if (Array.isArray(t?.offDays) && t.offDays.includes(day)) {
        warns.push(`⛔ ${t.name}: ${day} — dam olish kuni`);
      }
    });
    const classHas = (classIds || []).some((cid) => cell.some((l) => classIdsOf(l).includes(cid)));
    if (classHas) warns.push("ℹ️ Tanlangan sinf(lar)da shu vaqtda dars bor.");
    return warns;
  }

  // ——— Tashxis va yechim tavsiyalari ———

  function globalMissing() {
    const bySubject = {};
    classes.forEach((cls) => {
      missingForClass(cls.id).forEach((mm) => {
        if (!bySubject[mm.subjectId]) bySubject[mm.subjectId] = { subjectId: mm.subjectId, name: mm.name, total: 0, classes: [] };
        bySubject[mm.subjectId].total += mm.missing;
        bySubject[mm.subjectId].classes.push(cls.name);
      });
    });
    return Object.values(bySubject).sort((a, b) => b.total - a.total);
  }

  function teacherClassCount(subjectId) {
    const map = {};
    const add = (id, name) => { if (!id) return; (map[id] = map[id] || new Set()).add(name); };
    classes.forEach((cls) => {
      (classSubjects?.[cls.id] || []).forEach((a) => {
        if (a.subjectId === subjectId) {
          add(a.teacherId, cls.name);
          add(a.teacherId2, cls.name);
          (a.levelGroups || []).forEach((g) => add(g.teacherId, cls.name));
        }
        if (a.swapEnabled && a.swapSubjectId === subjectId) add(a.swapTeacherId, cls.name);
      });
    });
    return map;
  }

  function suggestionsFor(subjectId) {
    const sugg = [];
    sugg.push("🔁 Bu fanni «Parallel» qiling — bir ustoz bir vaqtda bir nechta teng sinfga o'tadi (Jismoniy tarbiya, Musiqa kabi). Sinf fanlari → «Parallel dars»ni yoqing va parallel nomi yozing (masalan «1-sinf Jismoniy»).");
    const tc = teacherClassCount(subjectId);
    const overloaded = Object.entries(tc).filter(([, set]) => set.size >= 3).sort((a, b) => b[1].size - a[1].size);
    if (overloaded.length) {
      sugg.push(`👤 Yuklamasi ko'p ustoz: ${overloaded.slice(0, 3).map(([id, set]) => `${getName(teacherMap, id)} — ${set.size} ta sinfga dars beradi (${[...set].slice(0, 6).join(", ")}${set.size > 6 ? "…" : ""})`).join("; ")}. Bu fanga yana ustoz qo'shing yoki yukni bo'ling.`);
    }
    return sugg;
  }

  function capacityWarnings() {
    const warns = [];
    classes.forEach((cls) => {
      const perDay = sortedTimeslots.filter((ts) => isTeachingSlot(ts) && slotAllowsClass(ts, cls.id)).length;
      const offDays = Array.isArray(cls.offDays) ? cls.offDays : [];
      const avail = perDay * (DAYS.length - offDays.length);
      let total = 0;
      (classSubjects?.[cls.id] || []).forEach((a) => {
        total += Number(a.weeklyHours || 0);
        if (a.swapEnabled && a.swapSubjectId) total += Number(a.weeklyHours || 0);
      });
      if (total > avail) {
        warns.push(`${cls.name}: jami ${total} soat kerak, lekin bo'sh joy ${avail} ta (${DAYS.length - offDays.length} kun × ${perDay} dars). ${total - avail} soat sig'maydi — dars/kun sonini oshiring yoki soatni kamaytiring.`);
      }
    });
    return warns;
  }

  function findResolutionsFor(classId, subjectId, count) {
    const subjTeachers = teachersForSubject(subjectId);
    if (!subjTeachers.length) return [];
    const cls = classes.find((c) => c.id === classId);
    const classOff = new Set(Array.isArray(cls?.offDays) ? cls.offDays : []);
    const assigned = assignedTeacher(classId, subjectId);
    const ordered = subjTeachers.filter((t) => t.id === assigned);
    if (!ordered.length) return [];

    const result = [];
    const usedClassSlot = new Set();
    const usedTeacherSlot = new Set();
    for (const day of DAYS) {
      if (classOff.has(day)) continue;
      for (const ts of sortedTimeslots) {
        if (result.length >= count) return result;
        if (!isTeachingSlot(ts)) continue;
        if (!slotAllowsClass(ts, classId)) continue;
        if (classHasLunchAt(ts, classId, lunchGroups, day)) continue;
        const slotKey = `${day}__${ts.id}`;
        if (usedClassSlot.has(slotKey)) continue;
        const cell = schedule?.[day]?.[ts.id] || [];
        if (cell.some((l) => classIdsOf(l).includes(classId))) continue;
        for (const t of ordered) {
          const tOff = new Set(Array.isArray(t.offDays) ? t.offDays : []);
          if (tOff.has(day)) continue;
          if (cell.some((l) => l.teacherId === t.id)) continue;
          if (usedTeacherSlot.has(`${t.id}__${slotKey}`)) continue;
          const teacherTotal = teacherClassCountHours(t.id);
          if (teacherTotal + 1 > Number(t.maxWeeklyHours || 40)) continue;
          result.push({ day, slotId: ts.id, teacherId: t.id });
          usedClassSlot.add(slotKey);
          usedTeacherSlot.add(`${t.id}__${slotKey}`);
          break;
        }
      }
    }
    return result;
  }

  function teacherClassCountHours(teacherId) {
    let n = 0;
    DAYS.forEach((day) => {
      sortedTimeslots.forEach((ts) => {
        const cell = schedule?.[day]?.[ts.id] || [];
        if (cell.some((l) => l.teacherId === teacherId)) n += 1;
      });
    });
    return n;
  }

  function proposeResolution(classId, subjectId, name, missing) {
    const placements = findResolutionsFor(classId, subjectId, missing);
    if (!placements.length) {
      toast?.("Bo'sh ustoz yoki vaqt topilmadi — bu fanga yana ustoz qo'shing", "warning");
      return;
    }
    setResolveData({ classId, subjectId, name, placements });
  }

  function applyResolution() {
    if (!setSchedule || !resolveData) return;
    const { classId, subjectId, placements } = resolveData;
    const next = { ...schedule };
    placements.forEach(({ day, slotId, teacherId }) => {
      next[day] = { ...(next[day] || {}) };
      next[day][slotId] = [...(next[day][slotId] || []), {
        subjectId, classId, classIds: [classId], teacherId: teacherId || "", roomId: "",
        manual: true, locked: true,
      }];
    });
    setSchedule(next);
    setResolveData(null);
    toast?.(`${placements.length} ta dars joylashtirildi va qulflandi 🔒`, "success");
  }

  function fillRemaining(base, markManual = true) {
    const teachingSlots = sortedTimeslots.filter(isTeachingSlot);
    const next = {};
    DAYS.forEach((d) => {
      next[d] = {};
      sortedTimeslots.forEach((ts) => { next[d][ts.id] = [...((base?.[d]?.[ts.id]) || [])]; });
    });
    const tLoad = {};
    DAYS.forEach((d) => teachingSlots.forEach((ts) => next[d][ts.id].forEach((l) => { if (l.teacherId) tLoad[l.teacherId] = (tLoad[l.teacherId] || 0) + 1; })));

    const countCS = (cid, sid) => {
      let n = 0;
      DAYS.forEach((d) => teachingSlots.forEach((ts) => {
        if (next[d][ts.id].some((l) => l.subjectId === sid && classIdsOf(l).includes(cid))) n += 1;
      }));
      return n;
    };
    const freeSlot = (cid, teacherList, classOff) => {
      for (const day of DAYS) {
        if (classOff.has(day)) continue;
        for (const ts of teachingSlots) {
          if (!slotAllowsClass(ts, cid)) continue;
          if (classesHaveLunchAt(ts, [cid], lunchGroups, day)) continue;
          const cell = next[day][ts.id];
          if (cell.some((l) => classIdsOf(l).includes(cid))) continue;
          for (const t of teacherList) {
            const tOff = new Set(Array.isArray(t.offDays) ? t.offDays : []);
            if (tOff.has(day)) continue;
            if (cell.some((l) => l.teacherId === t.id)) continue;
            if ((tLoad[t.id] || 0) + 1 > Number(t.maxWeeklyHours || 40)) continue;
            return { day, tsId: ts.id, teacherId: t.id };
          }
        }
      }
      return null;
    };

    // Qulflangan dars HECH QACHON ko'chirilmaydi
    const isMovable = (l) => l && !l.locked && !l.manual && !l.groupPart && !l.groupKey
      && !l.levelGroupEnabled && !l.swap && classIdsOf(l).length === 1;
    const teacherOffHas = (tid, day) => {
      const tt = teachers.find((x) => x.id === tid);
      return tt && Array.isArray(tt.offDays) && tt.offDays.includes(day);
    };
    const findHomeForLesson = (l, exDay, exTs) => {
      const cid = classIdsOf(l)[0];
      const cObj = classes.find((c) => c.id === cid);
      const classOff2 = new Set(Array.isArray(cObj?.offDays) ? cObj.offDays : []);
      for (const day of DAYS) {
        if (classOff2.has(day)) continue;
        if (l.teacherId && teacherOffHas(l.teacherId, day)) continue;
        for (const ts of teachingSlots) {
          if (day === exDay && ts.id === exTs) continue;
          if (!slotAllowsClass(ts, cid)) continue;
          if (classesHaveLunchAt(ts, [cid], lunchGroups, day)) continue;
          const cell = next[day][ts.id];
          if (cell.some((x) => classIdsOf(x).includes(cid))) continue;
          if (l.teacherId && cell.some((x) => x.teacherId === l.teacherId)) continue;
          if (l.roomId && cell.some((x) => x.roomId === l.roomId)) continue;
          return { day, tsId: ts.id };
        }
      }
      return null;
    };
    const homeWithEvict = (l, exDay, exTs) => {
      const direct = findHomeForLesson(l, exDay, exTs);
      if (direct) return direct;
      const cid = classIdsOf(l)[0];
      const cObj = classes.find((c) => c.id === cid);
      const classOff2 = new Set(Array.isArray(cObj?.offDays) ? cObj.offDays : []);
      for (const day of DAYS) {
        if (classOff2.has(day)) continue;
        if (l.teacherId && teacherOffHas(l.teacherId, day)) continue;
        for (const ts of teachingSlots) {
          if (day === exDay && ts.id === exTs) continue;
          if (!slotAllowsClass(ts, cid)) continue;
          if (classesHaveLunchAt(ts, [cid], lunchGroups, day)) continue;
          const cell = next[day][ts.id];
          const classB = cell.find((x) => classIdsOf(x).includes(cid));
          const teacherB = l.teacherId ? cell.find((x) => x.teacherId === l.teacherId) : null;
          const roomB = l.roomId ? cell.find((x) => x.roomId === l.roomId) : null;
          const blockers = [...new Set([classB, teacherB, roomB].filter(Boolean))];
          if (blockers.length !== 1 || !isMovable(blockers[0])) continue;
          const h2 = findHomeForLesson(blockers[0], day, ts.id);
          if (!h2) continue;
          next[day][ts.id] = cell.filter((x) => x !== blockers[0]);
          next[h2.day][h2.tsId].push(blockers[0]);
          return { day, tsId: ts.id };
        }
      }
      return null;
    };
    const rearrangePlace = (cid, t, classOff) => {
      if ((tLoad[t.id] || 0) + 1 > Number(t.maxWeeklyHours || 40)) return null;
      const tOff = new Set(Array.isArray(t.offDays) ? t.offDays : []);
      for (const day of DAYS) {
        if (classOff.has(day) || tOff.has(day)) continue;
        for (const ts of teachingSlots) {
          if (!slotAllowsClass(ts, cid)) continue;
          if (classesHaveLunchAt(ts, [cid], lunchGroups, day)) continue;
          const cell = next[day][ts.id];
          if (cell.some((l) => l.teacherId === t.id)) continue;
          const blocker = cell.find((l) => classIdsOf(l).includes(cid));
          if (!blocker || !isMovable(blocker)) continue;
          const home = homeWithEvict(blocker, day, ts.id);
          if (!home) continue;
          next[day][ts.id] = (next[day][ts.id]).filter((x) => x !== blocker);
          next[home.day][home.tsId].push(blocker);
          return { day, tsId: ts.id, teacherId: t.id };
        }
      }
      return null;
    };

    let placed = 0;
    for (let pass = 0; pass < 4; pass++) {
      const before = placed;
      classes.forEach((cls) => {
        const classOff = new Set(Array.isArray(cls.offDays) ? cls.offDays : []);
        const subjectIds = new Set();
        (classSubjects?.[cls.id] || []).forEach((a) => {
          if (a.subjectId) subjectIds.add(a.subjectId);
          if (a.swapEnabled && a.swapSubjectId) subjectIds.add(a.swapSubjectId);
        });
        subjectIds.forEach((sid) => {
          const need = requiredHours(cls.id, sid);
          let have = countCS(cls.id, sid);
          if (have >= need) return;
          const assigned = assignedTeacher(cls.id, sid);
          const t = assigned ? teachers.find((x) => x.id === assigned) : null;
          if (!t || !teachersForSubject(sid).some((x) => x.id === assigned)) return;
          const teacherList = [t];
          let guard = 0;
          while (have < need && guard < 80) {
            guard += 1;
            let spot = freeSlot(cls.id, teacherList, classOff);
            if (!spot) spot = rearrangePlace(cls.id, t, classOff);
            if (!spot) break;
            next[spot.day][spot.tsId].push({ subjectId: sid, classId: cls.id, classIds: [cls.id], teacherId: spot.teacherId, roomId: "", manual: markManual });
            tLoad[spot.teacherId] = (tLoad[spot.teacherId] || 0) + 1;
            have += 1;
            placed += 1;
          }
        });
      });
      if (placed === before) break;
    }
    return { schedule: next, placed };
  }

  function resolveAll() {
    if (!setSchedule) return;
    const { schedule: filled, placed } = fillRemaining(schedule);
    if (placed === 0) {
      toast?.("Bo'sh ustoz yoki vaqt topilmadi — bu fanlarga yana ustoz qo'shing", "warning");
      return;
    }
    setSchedule(filled);
    toast?.(`${placed} ta soat avtomatik joylashtirildi ✓`, "success");
  }

  function addManualLesson() {
    if (!setSchedule || !manualCell) return;
    const { day, slotId, classId } = manualCell;
    if (!manualForm.subjectId) { toast?.("Fan tanlang", "warning"); return; }
    const remain = requiredHours(classId, manualForm.subjectId) - placedHours(classId, manualForm.subjectId);
    if (remain <= 0) {
      toast?.("Bu fan soatlari to'liq qo'yilgan — ortiqcha qo'shib bo'lmaydi", "warning");
      return;
    }

    const next = { ...schedule, [day]: { ...(schedule?.[day] || {}) } };
    const cell = next[day][slotId] || [];
    const lock = Boolean(manualForm.lock);

    const lgi = levelGroupInfo(classId, manualForm.subjectId);
    if (lgi) {
      const groupItems = lgi.groups.map((g) => ({
        subjectId: manualForm.subjectId,
        classId: lgi.classIds[0],
        classIds: lgi.classIds,
        teacherId: g.teacherId || "",
        roomId: g.roomId || "",
        groupPart: g.name,
        levelGroupEnabled: true,
        manual: true,
        locked: lock,
      }));
      next[day][slotId] = [...cell, ...groupItems];
    } else {
      next[day][slotId] = [...cell, {
        subjectId: manualForm.subjectId,
        classId,
        classIds: [classId],
        teacherId: manualForm.teacherId || "",
        roomId: manualForm.roomId || "",
        manual: true,
        locked: lock,
        ...(manualForm.altEnabled && manualForm.altSubjectId ? {
          alternating: true,
          altSubjectId: manualForm.altSubjectId,
          altTeacherId: manualForm.altTeacherId || "",
        } : {}),
      }];
    }
    setSchedule(next);
    setManualCell(null);
    toast?.(lock ? "Dars qo'shildi va qulflandi 🔒" : "Dars qo'lda qo'shildi ✓", "success");
  }

  function removeLessonCard(day, slotId, classId, cardLesson) {
    if (!setSchedule) return;
    const cell = schedule?.[day]?.[slotId] || [];
    const keyOf = (l) => [l.subjectId, l.groupKey || "", l.blockIndex ?? "", l.teacherId || ""].join("__");
    const cardKey = keyOf(cardLesson);
    const next = { ...schedule, [day]: { ...(schedule?.[day] || {}) } };
    next[day][slotId] = cell.filter((l) => !(keyOf(l) === cardKey && classIdsOf(l).includes(classId)));
    setSchedule(next);
    toast?.("Dars o'chirildi", "error");
  }

  function handleClear() {
    if (!setSchedule) return;
    const locked = lockedCount();
    const msg = locked > 0
      ? `Dars jadvalini tozalaysizmi? ${locked} ta qulflangan dars ham o'chadi.`
      : "Dars jadvalini tozalashni xohlaysizmi?";
    if (!confirm(msg)) return;
    setSchedule({});
    toast?.("Dars jadvali tozalandi", "success");
  }

  async function exportExcel() {
    const exportClasses = visibleClasses.length ? visibleClasses : sortedClasses;
    await exportColoredSchedule({
      classes: exportClasses,
      subjects,
      teachers,
      rooms,
      timeslots,
      lunchGroups,
      schedule,
      toast,
    });
  }

  const lockedTotal = setSchedule ? lockedCount() : 0;

  return (
    <div className="pretty-schedule-page">
      <div className="pretty-topbar">
        <div>
          <h1>Dars jadvali</h1>
          <p>Sinf yoki ustoz setkasida ishlang. Darsni tortib ko‘chiring, kerak bo‘lsa 🔒 qulflang.</p>
        </div>
      </div>

      <div className="sch-toolbar card">
        <style>{`
          .sch-toolbar{padding:14px 16px;border-radius:18px;margin-bottom:16px;}
          .pretty-alt-sep{opacity:.72;font-weight:600;}
          .pretty-alt-chip{margin-top:5px;font-size:11px;font-weight:700;color:#7c3aed;background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.25);border-radius:7px;padding:3px 8px;display:inline-block;line-height:1.3;}
          [data-theme="dark"] .pretty-alt-chip{color:#c4b5fd;background:rgba(124,58,237,.2);}
          .sch-toolbar-row{display:flex;align-items:stretch;gap:12px;flex-wrap:wrap;}
          .sch-field{display:flex;flex-direction:column;gap:6px;}
          .sch-field-label{font-size:12px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--text-muted,#94a3b8);padding-left:2px;}
          .sch-select-wrap{position:relative;display:flex;align-items:center;height:46px;min-width:250px;background:var(--card-bg,#fff);border:1.5px solid var(--card-border,#e2e8f0);border-radius:13px;transition:border-color .18s, box-shadow .18s;}
          .sch-select-wrap:hover{border-color:rgba(99,102,241,.55);}
          .sch-select-wrap:focus-within{border-color:#6366f1;box-shadow:0 0 0 4px rgba(99,102,241,.14);}
          .sch-select-wrap .sch-select-icon{position:absolute;left:13px;font-size:17px;pointer-events:none;}
          .sch-select-wrap select{appearance:none;-webkit-appearance:none;width:100%;height:100%;border:none;outline:none;background:transparent;font-size:15px;font-weight:700;color:var(--text-primary,#1e293b);padding:0 38px 0 40px;cursor:pointer;}
          .sch-select-wrap::after{content:"";position:absolute;right:15px;width:9px;height:9px;border-right:2.5px solid var(--text-muted,#94a3b8);border-bottom:2.5px solid var(--text-muted,#94a3b8);transform:rotate(45deg) translateY(-2px);pointer-events:none;}
          .sch-segment{display:flex;align-items:center;height:46px;padding:4px;gap:4px;background:var(--bg-secondary,#f1f5f9);border:1.5px solid var(--card-border,#e2e8f0);border-radius:13px;}
          .sch-segment button{height:100%;border:none;border-radius:10px;padding:0 16px;font-size:13.5px;font-weight:700;background:transparent;color:var(--text-secondary,#64748b);cursor:pointer;transition:all .18s;white-space:nowrap;}
          .sch-segment button:hover{color:var(--text-primary,#1e293b);}
          .sch-segment button.active{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;box-shadow:0 4px 12px rgba(99,102,241,.35);}
          .sch-actions{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;margin-left:auto;}
          .sch-btn{display:inline-flex;align-items:center;gap:7px;height:46px;padding:0 18px;border-radius:13px;border:1.5px solid transparent;font-size:14px;font-weight:700;cursor:pointer;transition:transform .15s, box-shadow .15s, filter .15s;white-space:nowrap;}
          .sch-btn:hover{transform:translateY(-1px);filter:brightness(1.05);}
          .sch-btn:active{transform:translateY(0);}
          .sch-btn:disabled{opacity:.6;cursor:not-allowed;transform:none;}
          .sch-btn-hero{background:linear-gradient(135deg,#16a34a,#059669);color:#fff;box-shadow:0 6px 16px rgba(22,163,74,.32);}
          .sch-btn-soft-green{background:rgba(22,163,74,.10);border-color:rgba(22,163,74,.28);color:#15803d;}
          .sch-btn-soft-blue{background:rgba(37,99,235,.10);border-color:rgba(37,99,235,.28);color:#1d4ed8;}
          .sch-btn-soft-gray{background:var(--bg-secondary,#f1f5f9);border-color:var(--card-border,#e2e8f0);color:var(--text-secondary,#475569);}
          .sch-btn-soft-red{background:rgba(220,38,38,.08);border-color:rgba(220,38,38,.28);color:#dc2626;}
          .sch-btn-soft-red:hover{background:rgba(220,38,38,.14);}
          [data-theme="dark"] .sch-btn-soft-green{color:#4ade80;}
          [data-theme="dark"] .sch-btn-soft-blue{color:#93c5fd;}
          [data-theme="dark"] .sch-btn-soft-red{color:#fca5a5;}
          @media (max-width: 900px){
            .sch-actions{margin-left:0;width:100%;}
            .sch-btn{flex:1;justify-content:center;padding:0 12px;}
            .sch-select-wrap{min-width:0;width:100%;}
            .sch-field{width:100%;}
            .sch-segment{width:100%;}
            .sch-segment button{flex:1;}
          }
        `}</style>

        <div className="sch-toolbar-row">
          <div className="sch-field">
            <span className="sch-field-label">Setka</span>
            <div className="schd-mode">
              <button type="button" className={gridMode === "class" ? "active" : ""} onClick={() => setGridMode("class")}>📚 Sinf setkasi</button>
              <button type="button" className={gridMode === "teacher" ? "active" : ""} onClick={() => setGridMode("teacher")}>👨‍🏫 Ustoz setkasi</button>
            </div>
          </div>

          {gridMode === "class" && (
            <>
              <div className="sch-field">
                <span className="sch-field-label">Sinf tanlang</span>
                <div className="sch-select-wrap">
                  <span className="sch-select-icon">🏫</span>
                  <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
                    <option value="all">Barcha sinflar</option>
                    {sortedClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="sch-field">
                <span className="sch-field-label">Ko‘rinish</span>
                <div className="sch-segment">
                  <button className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")} type="button">▦ Jadval</button>
                  <button className={viewMode === "compact" ? "active" : ""} onClick={() => setViewMode("compact")} type="button">▤ Karta</button>
                </div>
              </div>
            </>
          )}

          <div className="sch-actions">
            {setSchedule && (
              <button className="sch-btn sch-btn-hero" onClick={handleGenerate} type="button" disabled={generating}>
                {generating ? "⏳ Bajarilyapti…" : "⚡ Avtomatik jadval"}
              </button>
            )}
            {setSchedule && lockedTotal > 0 && (
              <button className="sch-btn sch-btn-soft-blue" onClick={unlockAll} type="button" title="Barcha qulflarni ochish">
                🔓 Qulflar ({lockedTotal})
              </button>
            )}
            <button className="sch-btn sch-btn-soft-green" onClick={exportExcel} type="button">📥 Excel</button>
            <button className="sch-btn sch-btn-soft-blue" onClick={() => window.print()} type="button">📄 PDF</button>
            <button className="sch-btn sch-btn-soft-gray" onClick={() => window.print()} type="button">🖨 Chop etish</button>
            {setSchedule && <button className="sch-btn sch-btn-soft-red" onClick={handleClear} type="button">🗑 Tozalash</button>}
          </div>
        </div>

        {picked && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "rgba(124,58,237,.10)", border: "1px solid rgba(124,58,237,.35)", borderRadius: 10, padding: "8px 12px", color: "#5b21b6", fontSize: 13, fontWeight: 600 }}>
            <span>✋ <b>{unitLabel(ctx, picked.unit)}</b> ({slotLabel(ctx, picked.day, picked.slotId)}) tanlandi — endi qo'yiladigan katakni bosing.</span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setPicked(null)}>Bekor qilish</button>
          </div>
        )}

        {setSchedule && lockedTotal > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-secondary)" }}>
            🔒 <b>{lockedTotal}</b> ta dars qulflangan — «⚡ Avtomatik jadval» bosilganda ular joyidan qimirlamaydi.
          </div>
        )}

        {generating && (
          <div className="gen-overlay">
            <style>{`
              .gen-overlay{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:rgba(15,18,34,.5);backdrop-filter:blur(6px);}
              .gen-spinner{width:62px;height:62px;border-radius:50%;border:4px solid rgba(255,255,255,.22);border-top-color:#ffffff;animation:gen-spin .8s linear infinite;}
              @keyframes gen-spin{to{transform:rotate(360deg)}}
              .gen-check{width:62px;height:62px;border-radius:50%;border:4px solid #22c55e;background:rgba(34,197,94,.15);display:flex;align-items:center;justify-content:center;color:#4ade80;font-size:30px;font-weight:900;animation:gen-pop .4s cubic-bezier(.2,1.6,.4,1) both;}
              @keyframes gen-pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
              .gen-text{color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.3px;text-shadow:0 2px 10px rgba(0,0,0,.35);}
              .gen-sub{margin-top:-10px;color:rgba(255,255,255,.7);font-size:13px;font-weight:600;}
            `}</style>
            {genDone ? <div className="gen-check">✓</div> : <div className="gen-spinner" />}
            <div className="gen-text">{genDone ? "Tayyor!" : "Bajarilyapti…"}</div>
            {!genDone && <div className="gen-sub">{genProgress}% · {genRound}-urinish</div>}
          </div>
        )}
      </div>

      {gridMode === "teacher" ? (
        <TeacherGrid
          classes={classes}
          subjects={subjects}
          teachers={teachers}
          rooms={rooms}
          timeslots={timeslots}
          lunchGroups={lunchGroups}
          schedule={schedule}
          classSubjects={classSubjects}
          setSchedule={setSchedule}
          toast={toast}
          onResolve={setMoveData}
        />
      ) : (
        <>
          {!visibleClasses.length && (
            <div className="card empty-state">
              <div className="empty-state__icon">📚</div>
              <p className="empty-state__message">Hali sinflar qo‘shilmagan.</p>
            </div>
          )}

          {setSchedule && (() => {
            const gm = globalMissing();
            const caps = capacityWarnings();
            if (!gm.length && !caps.length) {
              if (!visibleClasses.length) return null;
              const anyLessons = DAYS.some((d) => sortedTimeslots.some((s) => (schedule?.[d]?.[s.id] || []).length));
              if (!anyLessons) return null;
              return (
                <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 12, padding: "10px 14px", marginBottom: 14, color: "#065f46", fontWeight: 600 }}>
                  ✅ Barcha fan soatlari to'liq joylashtirildi (100%).
                </div>
              );
            }
            const totalMissing = gm.reduce((s, x) => s + x.total, 0);
            return (
              <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: "#9a3412" }}>
                    ⚠️ {totalMissing} soat to'liq joylashmadi — yechim tavsiyalari
                  </div>
                  <button type="button" className="btn btn-success" onClick={resolveAll}>
                    🔧 Hammasini bir bosishda hal qilish
                  </button>
                </div>

                {caps.length > 0 && (
                  <div style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, color: "#b91c1c", marginBottom: 4 }}>Sig'im yetishmasligi:</div>
                    {caps.map((w, i) => <div key={i} style={{ fontSize: 13, color: "#7f1d1d", marginTop: i ? 3 : 0 }}>• {w}</div>)}
                  </div>
                )}

                {gm.map((m) => (
                  <div key={m.subjectId} style={{ background: "#fff", border: "1px solid #fed7aa", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, color: "#9a3412" }}>
                      {m.name}: {m.total} soat tushmadi <span style={{ fontWeight: 400, color: "#a16207" }}>({m.classes.slice(0, 6).join(", ")}{m.classes.length > 6 ? "…" : ""})</span>
                    </div>
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                      {suggestionsFor(m.subjectId).map((s, i) => (
                        <div key={i} style={{ fontSize: 13, color: "#7c2d12" }}>{s}</div>
                      ))}
                    </div>
                  </div>
                ))}

                <div style={{ fontSize: 12, color: "#9a3412", marginTop: 4 }}>
                  Sozlagandan so'ng «⚡ Avtomatik jadval»ni qayta bosing. Yoki bo'sh katakdagi <b>＋</b> orqali qo'lda qo'shing.
                </div>
              </div>
            );
          })()}

          {visibleClasses.map((cls) => {
            const isCollapsed = collapsed[cls.id];
            const missing = setSchedule ? missingForClass(cls.id) : [];
            return (
              <section key={cls.id} className="pretty-class-section">
                <div className="pretty-class-header">
                  <h2>👥 {cls.name} sinf</h2>
                  <button
                    className="pretty-collapse"
                    type="button"
                    onClick={() => setCollapsed((prev) => ({ ...prev, [cls.id]: !prev[cls.id] }))}
                  >
                    {isCollapsed ? "⌄" : "⌃"}
                  </button>
                </div>

                {!isCollapsed && missing.length > 0 && (
                  <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 12px", margin: "0 0 10px" }}>
                    <div style={{ fontWeight: 700, color: "#92400e", marginBottom: 4 }}>⚠️ Bu sinfda tushmagan soatlar bor:</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {missing.map((m) => (
                        <span key={m.subjectId} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #fcd34d", borderRadius: 8, padding: "3px 8px", fontSize: 13, color: "#92400e" }}>
                          {m.name}: <b>{m.missing}</b> soat yetishmayapti ({m.got}/{m.need})
                          {setSchedule && (
                            <button type="button" onClick={() => proposeResolution(cls.id, m.subjectId, m.name, m.missing)}
                              className="btn btn-sm btn-primary" style={{ padding: "2px 8px", fontSize: 12 }}>
                              🔧 Hal qilish
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: "#92400e", marginTop: 6 }}>«🔧 Hal qilish» bo'sh ustozni topib joylashtiradi. Yoki bo'sh katakdagi <b>＋</b> orqali qo'lda qo'shing.</div>
                  </div>
                )}

                {!isCollapsed && (
                  <div className={`pretty-table-card ${viewMode === "compact" ? "compact" : ""}`}>
                    <div className="pretty-table-scroll">
                      <table className="pretty-schedule-table">
                        <thead>
                          <tr>
                            <th>Vaqt / Dars</th>
                            {DAYS.map((day) => <th key={day}>{day}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedTimeslots.filter((slot) => slotAllowsClass(slot, cls.id)).map((slot) => (
                            <tr key={slot.id}>
                              <td className="pretty-time-cell">
                                <strong>{isTeachingSlot(slot) ? `${slot.lessonNumber || ""}-dars` : (slot.title || (slot.type === "lunch" ? "Obed" : "Tanaffus"))}</strong>
                                <span>{slot.startTime || ""} - {slot.endTime || ""}</span>
                              </td>
                              {DAYS.map((day) => {
                                const info = active
                                  ? (active.classId === cls.id
                                    ? (activeMap.get(`${day}__${slot.id}`) || null)
                                    : { kind: "cross" })
                                  : null;
                                const kind = info?.kind || null;
                                const dropCls = (kind === "move" || kind === "swap")
                                  ? "schd-drop-ok"
                                  : ((kind === "no" || kind === "nt" || kind === "cross") ? "schd-drop-no" : "");
                                return (
                                  <td
                                    key={day}
                                    className={`pretty-day-cell ${dropCls}`}
                                    style={{
                                      ...(kind === "swap" ? { outline: "2px dashed rgba(124,58,237,.55)", outlineOffset: "-3px" } : null),
                                      ...(picked && kind && kind !== "self" && kind !== "cross" ? { cursor: "pointer" } : null),
                                    }}
                                    onDragOver={(e) => { if (drag && kind && kind !== "self" && kind !== "cross") e.preventDefault(); }}
                                    onDrop={(e) => { e.preventDefault(); if (drag) commitMove(day, slot, cls); }}
                                    onClick={() => { if (picked && kind && kind !== "self" && kind !== "cross") commitMove(day, slot, cls); }}
                                  >
                                    {renderCell(day, slot, cls)}
                                    {kind === "swap" && info?.partner && (
                                      <span style={SWAP_CHIP}>
                                        ⇄ {unitLabel(ctx, info.partner)} bilan almashadi
                                        {info.auto ? " (avtomatik)" : ""}
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}

      {moveData && (
        <MoveResolveModal
          data={moveData}
          timeslots={sortedTimeslots}
          classes={classes}
          subjects={subjects}
          teachers={teachers}
          onApply={applyMoveActions}
          onClose={() => setMoveData(null)}
        />
      )}

      {manualCell && (() => {
        const { day, slotId, classId } = manualCell;
        const slot = sortedTimeslots.find((s) => s.id === slotId);
        const cls = classes.find((c) => c.id === classId);
        const warns = conflictsAt(day, slotId, classId, manualForm.teacherId, manualForm.roomId);
        const subjTeachers = manualForm.subjectId ? teachersForSubject(manualForm.subjectId) : [];
        const remainingSubjects = missingForClass(classId);
        const lgi = manualForm.subjectId ? levelGroupInfo(classId, manualForm.subjectId) : null;
        const effectiveWarns = lgi ? groupConflictsAt(day, slotId, lgi.classIds, lgi.groups) : warns;
        const hasBlocker = effectiveWarns.some((w) => w.startsWith("⛔"));
        const hasParallel = effectiveWarns.some((w) => w.startsWith("⚠️"));
        return (
          <div onClick={() => setManualCell(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ background: "var(--card-bg, #fff)", borderRadius: 14, padding: 20, width: "100%", maxWidth: 460, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
              <h3 style={{ margin: "0 0 4px" }}>Qo'lda dars qo'shish</h3>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
                {cls?.name} · {day} · {slot?.lessonNumber}-dars
              </div>

              {remainingSubjects.length === 0 ? (
                <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 10, padding: 12, color: "#065f46", fontSize: 14 }}>
                  ✓ Bu sinfning barcha fan soatlari to'liq qo'yilgan. Qo'shimcha dars qo'shish shart emas.
                </div>
              ) : (
                <>
                  <label className="form-label">Fan (faqat tushmagan soatlar)</label>
                  <select className="form-control" value={manualForm.subjectId}
                    onChange={(e) => setManualForm({ ...manualForm, subjectId: e.target.value, teacherId: assignedTeacher(classId, e.target.value) })}>
                    <option value="">— fan tanlang —</option>
                    {remainingSubjects.map((m) => (
                      <option key={m.subjectId} value={m.subjectId}>{m.name} — {m.missing} soat qoldi</option>
                    ))}
                  </select>

                  {lgi ? (
                    <div style={{ marginTop: 12, background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 10, padding: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#3730a3", marginBottom: 6 }}>
                        🎯 Bu fan daraja guruhli — guruh ustozlari bilan qo'shiladi:
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {lgi.groups.map((g, i) => (
                          <div key={i} style={{ fontSize: 13 }}>
                            <b>{g.name}</b>: {getName(teacherMap, g.teacherId, "ustoz tanlanmagan")}
                          </div>
                        ))}
                      </div>
                      <div style={{ fontSize: 12, color: "#4338ca", marginTop: 6 }}>
                        Sinflar: {lgi.classIds.map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean).join(", ")}
                      </div>
                    </div>
                  ) : (
                    <>
                      <label className="form-label" style={{ marginTop: 10, display: "block" }}>Ustoz</label>
                      <select className="form-control" value={manualForm.teacherId} disabled={!manualForm.subjectId}
                        onChange={(e) => setManualForm({ ...manualForm, teacherId: e.target.value })}>
                        <option value="">— ustoz tanlang —</option>
                        {subjTeachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>

                      <label className="form-label" style={{ marginTop: 10, display: "block" }}>Xona (ixtiyoriy)</label>
                      <select className="form-control" value={manualForm.roomId}
                        onChange={(e) => setManualForm({ ...manualForm, roomId: e.target.value })}>
                        <option value="">Xonasiz</option>
                        {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>

                      <div style={{ marginTop: 14, padding: 12, background: "rgba(124,58,237,.06)", border: "1px solid rgba(124,58,237,.2)", borderRadius: 10 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#6d28d9" }}>
                          <input type="checkbox" checked={manualForm.altEnabled}
                            onChange={(e) => setManualForm({ ...manualForm, altEnabled: e.target.checked, altSubjectId: "", altTeacherId: "" })} />
                          ⇄ Bu dars boshqa fan bilan almashadi (juft/toq hafta)
                        </label>
                        {manualForm.altEnabled && (
                          <div style={{ marginTop: 10 }}>
                            <label className="form-label">Almashadigan fan</label>
                            <select className="form-control" value={manualForm.altSubjectId}
                              onChange={(e) => setManualForm({ ...manualForm, altSubjectId: e.target.value, altTeacherId: assignedTeacher(classId, e.target.value) })}>
                              <option value="">— fan tanlang —</option>
                              {subjects.filter((s) => s.id !== manualForm.subjectId).map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                            <label className="form-label" style={{ marginTop: 8, display: "block" }}>Almashadigan fan ustozi</label>
                            <select className="form-control" value={manualForm.altTeacherId} disabled={!manualForm.altSubjectId}
                              onChange={(e) => setManualForm({ ...manualForm, altTeacherId: e.target.value })}>
                              <option value="">— ustoz tanlang —</option>
                              {(manualForm.altSubjectId ? teachersForSubject(manualForm.altSubjectId) : []).map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                            {manualForm.altSubjectId && (
                              <div style={{ fontSize: 12, color: "#6d28d9", marginTop: 8, lineHeight: 1.5 }}>
                                Bu katakda ikki fan navbatlashadi: bir hafta <b>{subjectMap.get(manualForm.subjectId)?.name || "asosiy fan"}</b>, keyingi hafta <b>{subjectMap.get(manualForm.altSubjectId)?.name || "ikkinchi fan"}</b>. Butun sinf birga o'tiradi.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <label className="tgr-check">
                    <input type="checkbox" checked={manualForm.lock}
                      onChange={(e) => setManualForm({ ...manualForm, lock: e.target.checked })} />
                    🔒 Qulflab qo'yish — avtomatik jadval tuzilganda bu dars o'zgarmaydi
                  </label>

                  {effectiveWarns.length > 0 && (
                    <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 10 }}>
                      {effectiveWarns.map((w, i) => (
                        <div key={i} style={{ fontSize: 13, color: w.startsWith("ℹ️") ? "#92400e" : "#b91c1c", marginTop: i ? 4 : 0 }}>{w}</div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
                <button className="btn btn-secondary" type="button" onClick={() => setManualCell(null)}>Yopish</button>
                {remainingSubjects.length > 0 && (
                  <button className="btn btn-primary" type="button" disabled={!manualForm.subjectId || hasBlocker} onClick={addManualLesson}>
                    {hasBlocker ? "Qo'yib bo'lmaydi" : (hasParallel ? "Baribir qo'shish" : "Qo'shish")}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {resolveData && (() => {
        const cls = classes.find((c) => c.id === resolveData.classId);
        return (
          <div onClick={() => setResolveData(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ background: "var(--card-bg, #fff)", borderRadius: 14, padding: 20, width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
              <h3 style={{ margin: "0 0 4px" }}>🔧 Avtomatik hal qilish</h3>
              <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 12 }}>
                <b>{cls?.name}</b> — <b>{resolveData.name}</b>: {resolveData.placements.length} ta soat quyidagicha joylashtirilsinmi?
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {resolveData.placements.map((p, i) => {
                  const slot = sortedTimeslots.find((s) => s.id === p.slotId);
                  return (
                    <div key={i} style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#065f46" }}>
                      <b>{p.day}, {slot?.lessonNumber}-dars</b> — ustoz: {getName(teacherMap, p.teacherId)}
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 14 }}>
                Bu darslar bo'sh ustoz bilan qo'yiladi va qulflanadi 🔒 (qayta avtomatik tuzsangiz ham buzilmaydi).
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn btn-secondary" type="button" onClick={() => setResolveData(null)}>Bekor qilish</button>
                <button className="btn btn-success" type="button" onClick={applyResolution}>Tasdiqlash va qo'yish</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
