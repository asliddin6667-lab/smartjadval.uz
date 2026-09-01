import { useMemo, useRef, useState } from "react";
import { DAYS, typeOfGroup } from "../utils/constants";
import {
  generateSchedule, budgetFor, isTeachingSlot, classHasLunchAt, classesHaveLunchAt, compactSchedule,
  isFixedMondaySubject, QUAD_SIZE,
} from "../utils/scheduleGenerator";
import { exportColoredSchedule } from "../utils/coloredScheduleExport";
import {
  collectCardEntries, unitOf, resolveMove, applyActions, softWarnings, checkPlace,
  findAutoPartner, onlyBusyReasons, unitLabel, slotLabel, superviseMoveWarnings,
  cellsAt, teacherIdsOf,
} from "../utils/moveResolver";
import { slotDisplayNumber } from "../utils/shiftSlots";
import { pairSideGroups, pairAllGroups, pairCardKey } from "../utils/pairGroups";
import { swapActive, swapTeachersOfSubject, swapRoomHours } from "../utils/swapGroups";
import { buildTeacherStreams, supervisionRows, findSupervisionGaps } from "../utils/homeroom";
import { buildSubjectConflicts } from "../utils/subjectConflicts";
import { parallelDaysOn, buildParallelIndex, parallelMismatch } from "../utils/parallelDays";
import MoveResolveModal from "../components/MoveResolveModal";
import SaveScheduleModal from "../components/SaveScheduleModal";
import TeacherGrid from "../components/TeacherGrid";
import { countLessons, upsertSaved } from "../utils/savedSchedules";
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

// Karta kaliti — sanoq YOZUV emas, KARTA bo‘yicha ketadi: guruhli fan, daraja
// guruhlari va «bir vaqtda bir nechta fan» bitta katakda bir nechta yozuv bo‘lsa
// ham ekranda BITTA karta bo‘lib turadi (kalit `groupLessons` bilan bir xil,
// ustiga sinflar ro‘yxati qo‘shiladi — birga o‘qiydigan karta bitta sanaladi).
function cardKeyOf(l) {
  const base = l.pairKey
    ? ["pair", l.pairKey, l.blockIndex ?? ""].join("__")
    : [l.subjectId, l.groupKey || "", l.blockIndex ?? ""].join("__");
  return `${base}##${classIdsOf(l).slice().sort().join("|")}`;
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

// Blok (2 soat) darsning bir bo'lagimi? Bunday darslar alohida ko'chirilmaydi —
// aks holda blok ikkiga bo'linib qoladi.
function isBlockPart(lesson) {
  return Number(lesson?.blockSize || 1) > 1;
}

// Guruh sozlamasi topilmagan fan — oddiy dars, katakda bitta yozuv
const PLAIN_PLAN = { kind: "free", need: 1, groups: [], row: null };

// KARTA kaliti — [moveResolver.js](../utils/moveResolver.js) dagi `sameCard`
// bilan AYNI qoida: «bir vaqtda bir nechta fan» guruhlarini `pairKey`
// bog'laydi (ularning sinflari har xil bo'lishi mumkin, shuning uchun sinf
// solishtirilmaydi), qolgan darslar esa fan + parallel kaliti + blok indeksi
// + sinflar bo'yicha birlashadi. Ikki joyda ajralib ketmasin: ajralsa
// guruhlar «boshqa karta» bo'lib ko'rinadi va yarim karta topilmay qoladi.
function partCardKey(l) {
  return l?.pairKey
    ? `P|${l.pairKey}|${l.blockIndex ?? ""}`
    : `${l?.subjectId || ""}|${l?.groupKey || ""}|${l?.blockIndex ?? ""}|${classIdsOf(l).slice().sort().join("~")}`;
}

export default function SchedulePage({
  classes = [],
  subjects = [],
  teachers = [],
  rooms = [],
  timeslots = [],
  shifts = [],
  lunchGroups = [],
  schedule = {},
  classSubjects = {},
  settings = {},
  savedSchedules = [],
  setSavedSchedules,
  setSchedule,
  setActivePage,
  toast,
}) {
  const [saveOpen, setSaveOpen] = useState(false);   // «💾 Saqlash» oynasi
  const [gridMode, setGridMode] = useState("class"); // "class" | "teacher"
  const [selectedClass, setSelectedClass] = useState("all");
  const [viewMode, setViewMode] = useState("table");
  const [collapsed, setCollapsed] = useState({});
  const [manualCell, setManualCell] = useState(null); // { day, slotId, classId }
  const [manualForm, setManualForm] = useState({ subjectId: "", teacherId: "", roomId: "", altEnabled: false, altSubjectId: "", altTeacherId: "", lock: false });
  const [resolveData, setResolveData] = useState(null); // { classId, subjectId, name, placements, moves }
  const [moveData, setMoveData] = useState(null);       // MoveResolveModal ma'lumoti
  const [drag, setDrag] = useState(null);               // { day, slotId, classId, unit }
  const [picked, setPicked] = useState(null);           // bosib tanlangan dars
  const active = drag || picked;                        // hozir ko'chirilayotgan dars
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genRound, setGenRound] = useState(0);
  const [genDone, setGenDone] = useState(false);
  const [genElapsed, setGenElapsed] = useState(0);   // sekundomer (soniya)
  const [compacting, setCompacting] = useState(false); // «Oynani yopish» ishlayapti
  const genTimerRef = useRef(null);

  const subjectMap = useMemo(() => new Map(subjects.map((s, i) => [s.id, { ...s, _colorIndex: i }])), [subjects]);
  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const roomMap = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  // Bir kunga tushmaydigan fanlar (Algebra ↔ Geometriya) — ro'yxat
  // [subjectConflicts.js](../utils/subjectConflicts.js) da.
  const conflictOf = useMemo(() => buildSubjectConflicts(subjects), [subjects]);

  const sortedClasses = useMemo(() => [...classes].sort((a, b) => (
    String(a.name).localeCompare(String(b.name), "uz", { numeric: true })
  )), [classes]);

  const sortedTimeslots = useMemo(() => [...timeslots].sort((a, b) => (
    Number(a.lessonNumber || 0) - Number(b.lessonNumber || 0)
  )), [timeslots]);

  const visibleClasses = selectedClass === "all"
    ? sortedClasses
    : sortedClasses.filter((c) => c.id === selectedClass);

  // ═══════════ PARALLEL SINFLAR — BIR KUNDA BIR XIL FAN ═══════════
  // 10-A, 10-B, 10-V bir darajaning sinflari: imkon qadar bir kunda bir
  // xil fanlarni o'qishsin. Qoida YUMSHOQ — joy topilmasa dars boshqa
  // kunga tushaveradi, hech narsa taqiqlanmaydi.
  const parOn = parallelDaysOn(settings);
  const parIndex = useMemo(() => buildParallelIndex(classes, parOn), [classes, parOn]);
  // sinf id → parallel hamrohlari (o'zidan tashqari)
  const parMates = useMemo(() => {
    const m = new Map();
    parIndex.classIds.forEach((ids) => {
      ids.forEach((cid) => m.set(cid, ids.filter((x) => x !== cid)));
    });
    return m;
  }, [parIndex]);
  // moveResolver uchun umumiy kontekst
  const ctx = { schedule, classes, subjects, teachers, rooms, timeslots: sortedTimeslots, lunchGroups, classSubjects };

  function getName(map, id, fallback = "—") {
    return map.get(id)?.name || fallback;
  }

  // ═══════════ KARTA TO'LIQMI? — GURUH-HISOBLI SANOQ ═══════════
  // ⚠️ Guruhli dars bitta katakda BIR NECHTA yozuv bo'lib turadi:
  // «2 guruhga bo'lish» — ikki ustoz, daraja guruhlari — har daraja,
  // «bir vaqtda bir nechta fan» — har guruh. Ilgari sanoq faqat
  // «bu katakda shu fan bormi?» deb qarardi, shuning uchun 2-guruh yozuvi
  // tushib qolsa ham foiz 100% ko'rinardi, ustozning soati esa JIMGINA
  // yo'qolardi (3-V · Ingliz tili: 6 katak bor edi, lekin ikkitasida faqat
  // 1-guruh turardi — 2-guruh ustozi 2 soatdan ayrilgan).
  //
  // Endi qoida bitta: YARIM KARTA — SOAT EMAS. Shu qoidaga
  // `countPlacedUnits`, `placedHours`, `fillRemaining` va ekrandagi
  // «🧩 yarim tushgan darslar» ro'yxati birdek tayanadi.
  //
  // Reja generatordagi TIKLANISH qoidalarini takrorlaydi: takroriy ustozli
  // daraja tashlanadi (`cleanLevelGroups`), ikkala guruhga bir xil ustoz
  // qo'yilgan «bo'linish» esa oddiy dars deb qaraladi.
  const cardPlanIdx = useMemo(() => {
    const idx = new Map();
    classes.forEach((cls) => {
      const bySubject = new Map();
      const put = (sid, plan) => { if (sid && !bySubject.has(sid)) bySubject.set(sid, plan); };
      (classSubjects?.[cls.id] || []).forEach((a) => {
        if (!a) return;
        if (a.pairEnabled) {
          const groups = pairAllGroups(a)
            .filter((g) => g.subjectId && g.teacherId)
            .map((g) => ({ name: g.name, teacherId: g.teacherId, roomId: g.roomId || "", subjectId: g.subjectId, shared: g.shared }));
          const plan = { kind: "pair", need: Math.max(1, groups.length), groups, row: a };
          groups.forEach((g) => put(g.subjectId, plan));
          return;
        }
        if (a.levelGroupEnabled && Array.isArray(a.levelGroups) && a.levelGroups.length) {
          const seen = new Set();
          const groups = [];
          a.levelGroups.forEach((g, i) => {
            if (!g?.teacherId || seen.has(g.teacherId)) return;
            seen.add(g.teacherId);
            groups.push({ name: g.name || `${i + 1}-guruh`, teacherId: g.teacherId, roomId: g.roomId || "", subjectId: a.subjectId });
          });
          put(a.subjectId, { kind: "level", need: Math.max(1, groups.length), groups, row: a });
          return;
        }
        if (a.splitEnabled && a.teacherId2 && a.teacherId2 !== a.teacherId) {
          put(a.subjectId, {
            kind: "split", need: 2, row: a,
            groups: [
              { name: a.groupName1 || "1-guruh", teacherId: a.teacherId, roomId: a.roomId || "", subjectId: a.subjectId },
              { name: a.groupName2 || "2-guruh", teacherId: a.teacherId2, roomId: a.roomId2 || "", subjectId: a.subjectId },
            ],
          });
          return;
        }
        put(a.subjectId, {
          kind: "plain", need: 1, row: a,
          groups: [{ name: "", teacherId: a.teacherId || "", roomId: a.roomId || "", subjectId: a.subjectId }],
        });
      });
      idx.set(cls.id, bySubject);
    });
    return idx;
  }, [classes, classSubjects]);

  function cardPlan(classId, subjectId) {
    return cardPlanIdx.get(classId)?.get(subjectId) || PLAIN_PLAN;
  }

  // Katakdagi BITTA sinfning kartalari: kalit → yozuvlar ro'yxati
  function cardsOfClass(cell, classId) {
    const map = new Map();
    (Array.isArray(cell) ? cell : []).forEach((l) => {
      if (!l || !classIdsOf(l).includes(classId)) return;
      const key = partCardKey(l);
      const arr = map.get(key);
      if (arr) arr.push(l);
      else map.set(key, [l]);
    });
    return map;
  }

  // Kartada yetishmayotgan guruhlar. Bo'sh massiv — karta TO'LIQ.
  // Guruhni USTOZ ajratadi: bir kartada bir ustoz ikki guruhda tura olmaydi
  // (bu qoida generatorda ham, UI tekshiruvlarida ham bir xil).
  function cardGaps(classId, parts) {
    const plan = cardPlan(classId, parts?.[0]?.subjectId);
    if (plan.need <= 1 || plan.groups.length <= 1) return [];
    const have = new Set();
    parts.forEach((p) => { if (p?.teacherId) have.add(p.teacherId); });
    return plan.groups.filter((g) => g.teacherId && !have.has(g.teacherId));
  }

  // Katakda shu sinfning shu fani TO'LIQ turibdimi? (yarim karta — yo'q)
  function cellHasFullSubject(cell, classId, subjectId) {
    let ok = false;
    cardsOfClass(cell, classId).forEach((parts) => {
      if (ok || !parts.some((p) => p.subjectId === subjectId)) return;
      if (!cardGaps(classId, parts).length) ok = true;
    });
    return ok;
  }

  // Jadvaldagi barcha YARIM kartalar. Bitta karta bir nechta sinfga tegishli
  // bo'lsa (daraja guruhi, parallel sinflar) — ro'yxatga BIR MARTA tushadi.
  function findPartialCards(sch = schedule) {
    const out = [];
    const seen = new Set();
    DAYS.forEach((day) => sortedTimeslots.forEach((slot) => {
      if (!isTeachingSlot(slot)) return;
      const cell = sch?.[day]?.[slot.id] || [];
      if (!cell.length) return;
      const cids = new Set();
      cell.forEach((l) => classIdsOf(l).forEach((c) => cids.add(c)));
      cids.forEach((cid) => {
        cardsOfClass(cell, cid).forEach((parts, key) => {
          const gaps = cardGaps(cid, parts);
          if (!gaps.length) return;
          const uniq = `${day}|${slot.id}|${key}`;
          if (seen.has(uniq)) return;
          seen.add(uniq);
          out.push({
            day, slotId: slot.id, classId: cid, key, parts, gaps,
            plan: cardPlan(cid, parts[0]?.subjectId),
            className: classes.find((c) => c.id === cid)?.name || "Sinf",
            subjectName: subjectMap.get(parts[0]?.subjectId)?.name || "Fan",
            lessonNumber: slotDisplayNumber(slot) ?? "?",
          });
        });
      });
    }));
    return out;
  }

  // Ustoz setkasida (teacher.blockedSlots) shu katak qulflanganmi?
  // Qulflangan katakka avtomatik joylashtirish yo'llari dars qo'ymaydi;
  // qo'lda qo'shishda esa faqat ogohlantiriladi (foydalanuvchi o'zi hal qiladi).
  function teacherBlockedAt(teacherId, day, slotId) {
    if (!teacherId) return false;
    const bs = teacherMap.get(teacherId)?.blockedSlots;
    return Boolean(bs && Array.isArray(bs[day]) && bs[day].includes(slotId));
  }

  // ——— KELAJAK SOATI ———
  // Bu fan HAR DOIM dushanbaning 1-darsida turadi: avtomatik to'ldirish ham,
  // qo'lda qo'shish ham uni boshqa katakka qo'ymaydi.
  function isFixedMondaySubjectId(sid) {
    return isFixedMondaySubject(subjectMap.get(sid));
  }
  function firstSlotIdOf(classId, day) {
    const list = sortedTimeslots.filter((ts) => isTeachingSlot(ts) && slotAllowsClass(ts, classId)
      && !classHasLunchAt(ts, classId, lunchGroups, day));
    return list[0]?.id || null;
  }

  function getClassLessons(day, timeSlotId, classId) {
    const cell = schedule?.[day]?.[timeSlotId];
    if (!Array.isArray(cell)) return [];
    return cell.filter((lesson) => classIdsOf(lesson).includes(classId));
  }

  function groupLessons(lessons = []) {
    const grouped = new Map();
    lessons.forEach((lesson) => {
      // "Bir vaqtda 2 fan" — ikki HAR XIL fan bitta katakda, bitta karta
      // bo'lib turadi (`pairKey` ularni bog'laydi).
      const key = lesson.pairKey
        ? ["pair", lesson.pairKey, lesson.blockIndex ?? ""].join("__")
        : [lesson.subjectId, lesson.groupKey || "", lesson.blockIndex ?? ""].join("__");
      if (!grouped.has(key)) grouped.set(key, { ...lesson, parts: [] });
      grouped.get(key).parts.push(lesson);
    });
    return [...grouped.values()];
  }

  function lessonDetails(lesson) {
    const subject = subjectMap.get(lesson.subjectId);
    const baseName = lesson.subjectName || subject?.name || "Fan";
    const color = subjectColor(subject, hashText(baseName));
    const parts = lesson.parts?.length ? lesson.parts : [lesson];

    // ——— BIR VAQTDA 2 FAN ———
    // Kartada ikkala fan nomi ko'rinadi: «Ona tili / Rus tili»
    // Bir xil fan bir nechta guruhda bo'lishi mumkin (boshqa-boshqa ustoz),
    // shuning uchun mezon — fanlar soni emas, kartadagi guruhlar soni.
    const isPair = Boolean(lesson.pairKey) && parts.length > 1;
    const subjectName = isPair
      ? uniqBy(parts.map((p) => subjectMap.get(p.subjectId)?.name || "Fan"), (n) => n).join(" / ")
      : baseName;

    const uniqueClassNames = uniqBy(
      parts.flatMap((part) => classIdsOf(part).map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean)),
      (name) => name
    );

    return {
      subject,
      subjectName,
      isPair,
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
    const isBlock = Number(lesson.blockSize || 1) > 1;

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
          {isBlock && (
            <span title={`${Number(lesson.blockSize)} soat blok — barcha soatlari birga ko'chadi`} style={{ fontSize: 10.5, fontWeight: 800, marginLeft: 6, opacity: .75 }}>
              ⛓ {Number(lesson.blockIndex || 0) + 1}/{Number(lesson.blockSize || 2)}
            </span>
          )}
        </div>

        {hasManyParts ? (
          <div className="pretty-lesson-groups">
            {detail.parts.map((part, index) => {
              const teacher = getName(teacherMap, part.teacherId, "Ustoz tanlanmagan");
              const room = part.roomId ? getName(roomMap, part.roomId, "Xona") : "Xonasiz";
              // Bir vaqtda 2 fan bo'lsa — har guruh o'z fani bilan ko'rinadi
              const partSubject = detail.isPair
                ? (subjectMap.get(part.subjectId)?.name || "Fan")
                : "";
              return (
                <div
                  className={`pretty-group-line${partSubject ? " with-subject" : ""}`}
                  key={`${part.teacherId}-${index}`}
                >
                  <span>{part.groupPart || part.groupName || `${index + 1}-guruh`}</span>
                  {partSubject && <i>{partSubject}</i>}
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

        {detail.isPair && (
          <div className="pretty-pair-chip">
            🧩 Bir vaqtda {detail.parts.length} dars — sinf {detail.parts.length} guruhga bo'linadi
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
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `${day}__${slotId}`);
    } catch { /* eski brauzerlar */ }
    setPicked(null);
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

    const res = resolveMove(ctx, src, { day, slotId: slot.id, partnerUnit, autoSwap: true });
    const partner = res.partner || partnerUnit || null;
    const lockedTouched = Boolean(src.unit.locked || partner?.locked);
    const warnings = [
      ...softWarnings(ctx, src.unit, day),
      ...(res.mode === "swap" && partner ? softWarnings(ctx, partner, src.day) : []),
      // Ko'chirish 1–4 sinfda bolani ustozsiz qoldirmaydimi?
      ...(res.ok ? superviseMoveWarnings(ctx, res.actions) : []),
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
    next[day][slotId] = cell.map((l) => (entries.includes(l) ? setLock(l, value) : l));
    setSchedule(next);
    toast?.(value ? "Dars qulflandi 🔒" : "Qulf ochildi 🔓", "success");
  }

  // Qulflangan dars zichlash va avtomatik to‘ldirishdan ham himoyalanishi kerak —
  // buni `manual` bayrog‘i beradi. Lekin qulf OCHILGANDA o‘sha bayroq qolib ketsa,
  // dars boshqa qimirlamay qolardi (zichlash ham, `fillRemaining` ham manual darsga
  // tegmaydi). Shuning uchun qulf uchun qo‘yilgan `manual` alohida belgilanadi
  // (`lockManual`) va qulf ochilganda qaytarib olinadi.
  function setLock(l, value) {
    if (value) {
      if (l.manual) return { ...l, locked: true };
      return { ...l, locked: true, manual: true, lockManual: true };
    }
    const { lockManual, ...rest } = l;
    return lockManual ? { ...rest, locked: false, manual: false } : { ...rest, locked: false };
  }

  // Sanoq KARTA bo‘yicha: ekranda bitta karta bo‘lib turgan guruhli dars
  // (daraja guruhlari, guruhli fan, «bir vaqtda bir nechta fan») bir marta sanaladi.
  function lockedCount() {
    let n = 0;
    DAYS.forEach((d) => sortedTimeslots.forEach((ts) => {
      const cell = schedule?.[d]?.[ts.id] || [];
      if (!cell.length) return;
      const seen = new Set();
      cell.forEach((l) => {
        if (!l.locked) return;
        const key = cardKeyOf(l);
        if (seen.has(key)) return;
        seen.add(key);
        n += 1;
      });
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
          l.locked ? setLock(l, false) : l
        );
      });
    });
    setSchedule(next);
    toast?.("Barcha qulflar ochildi 🔓", "success");
  }

  // ——— BUTUN SINFNI BIR BOSISHDA QULFLASH ———
  // `classId === "all"` bo‘lsa — jadvaldagi HAMMA dars. Birga o‘qiydigan dars
  // (🔁 parallel dars, daraja guruhlari, parallel sinflar) bitta yozuvda bir
  // nechta sinfni saqlaydi — u qulflansa sherik sinfda ham qulflanadi, chunki
  // ular ayni soatda birga o‘qiydi. Shuning uchun soni alohida sanaladi va
  // xabarda ko‘rsatiladi.

  function classLockStats(classId) {
    let total = 0;
    let locked = 0;
    DAYS.forEach((day) => sortedTimeslots.forEach((ts) => {
      const cell = schedule?.[day]?.[ts.id] || [];
      if (!cell.length) return;
      const seen = new Map();
      cell.forEach((l) => {
        if (classId !== "all" && !classIdsOf(l).includes(classId)) return;
        const key = cardKeyOf(l);
        seen.set(key, (seen.get(key) || false) || Boolean(l.locked));
      });
      seen.forEach((isLocked) => { total += 1; if (isLocked) locked += 1; });
    }));
    return { total, locked };
  }

  function toggleClassLock(classId, value) {
    if (!setSchedule) return;
    const next = {};
    let n = 0;       // o‘zgargan KARTA soni
    let shared = 0;  // shundan sherik sinflar bilan umumiy
    DAYS.forEach((day) => {
      next[day] = { ...(schedule?.[day] || {}) };
      sortedTimeslots.forEach((ts) => {
        const cell = schedule?.[day]?.[ts.id] || [];
        if (!cell.length) { next[day][ts.id] = cell; return; }
        const seen = new Set();
        next[day][ts.id] = cell.map((l) => {
          if (classId !== "all" && !classIdsOf(l).includes(classId)) return l;
          if (Boolean(l.locked) === value) return l;
          const key = cardKeyOf(l);
          if (!seen.has(key)) {
            seen.add(key);
            n += 1;
            if (classIdsOf(l).length > 1) shared += 1;
          }
          return setLock(l, value);
        });
      });
    });
    if (!n) return;
    setSchedule(next);
    const who = classId === "all"
      ? "Jadval"
      : (classes.find((c) => c.id === classId)?.name || "Sinf");
    const note = shared > 0 ? ` · ${shared} tasi sherik sinflar bilan umumiy` : "";
    toast?.(value
      ? `${who}: ${n} ta dars qulflandi 🔒${note}`
      : `${who}: ${n} ta qulf ochildi 🔓${note}`, "success");
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

  // Joylashgan soatlar. YARIM KARTA SANALMAYDI: guruh yozuvi yetishmayotgan
  // katak «joylashgan soat» emas — aks holda 2-guruh ustozi tushib qolganda
  // ham foiz 100% ko'rinar va soat jimgina yo'qolardi.
  function countPlacedUnits(sch) {
    let n = 0;
    DAYS.forEach((d) => sortedTimeslots.forEach((ts) => {
      if (!isTeachingSlot(ts)) return;
      const cell = sch?.[d]?.[ts.id] || [];
      if (!cell.length) return;
      const cids = new Set();
      cell.forEach((l) => classIdsOf(l).forEach((cid) => cids.add(cid)));
      cids.forEach((cid) => {
        const seen = new Set();
        cardsOfClass(cell, cid).forEach((parts) => {
          if (cardGaps(cid, parts).length) return;
          parts.forEach((p) => {
            if (!p.subjectId || seen.has(p.subjectId)) return;
            seen.add(p.subjectId);
            n += 1;
          });
        });
      });
    }));
    return n;
  }

  // Sifat o'lchovi: oynalar (kun o'rtasidagi bo'sh darslar) soni — kam bo'lgani yaxshi
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

  // Sifat o'lchovi: kunlik yuk notekisligi (kam bo'lgani yaxshi).
  // Me'yor kunning SIG'IMIGA moslanadi: qisqartirilgan kunga (obed/"dam olish"
  // guruhi yoki smena sozlamasi tufayli) teng ulush shunchaki sig'maydi.
  function countImbalance(sch) {
    let dev = 0;
    classes.forEach((cls) => {
      const off = new Set(Array.isArray(cls.offDays) ? cls.offDays : []);
      const usable = DAYS.filter((d) => !off.has(d));
      if (!usable.length) return;
      const slotsOfDay = (day) => sortedTimeslots.filter((ts) => isTeachingSlot(ts) &&
        slotAllowsClass(ts, cls.id) && !classHasLunchAt(ts, cls.id, lunchGroups, day));
      const caps = usable.map((day) => slotsOfDay(day).length);
      const counts = usable.map((day) => slotsOfDay(day).reduce((n, ts) => (
        (sch?.[day]?.[ts.id] || []).some((l) => classIdsOf(l).includes(cls.id)) ? n + 1 : n
      ), 0));
      const total = counts.reduce((a, b) => a + b, 0);
      // "suv to'ldirish": sig'imi yetmagan kun to'ladi, qolgani qayta bo'linadi
      const share = new Array(caps.length).fill(0);
      let rest = total;
      let open = caps.map((c, i) => i).filter((i) => caps[i] > 0);
      while (open.length) {
        const per = rest / open.length;
        const full = open.filter((i) => caps[i] <= per);
        if (!full.length) { open.forEach((i) => { share[i] = per; }); break; }
        full.forEach((i) => { share[i] = caps[i]; rest -= caps[i]; });
        open = open.filter((i) => !full.includes(i));
      }
      counts.forEach((n, i) => {
        const lo = Math.floor(share[i] + 1e-9);
        const hi = Math.ceil(share[i] - 1e-9);
        dev += n > hi ? n - hi : (n < lo ? lo - n : 0);
      });
    });
    return dev;
  }

  // Sifat o'lchovi: bir kunda bir fan limitidan oshgan holatlar
  function countOverCap(sch) {
    let over = 0;
    classes.forEach((cls) => {
      const subjectIds = new Set();
      (classSubjects?.[cls.id] || []).forEach((a) => {
        if (a.subjectId) subjectIds.add(a.subjectId);
        if (a.swapEnabled && a.swapSubjectId) subjectIds.add(a.swapSubjectId);
        pairSideGroups(a).forEach((g) => subjectIds.add(g.subjectId));
      });
      subjectIds.forEach((sid) => {
        const cap = subjectDayCap(cls.id, sid);
        DAYS.forEach((day) => {
          let n = 0;
          sortedTimeslots.forEach((ts) => {
            if (!isTeachingSlot(ts)) return;
            if ((sch?.[day]?.[ts.id] || []).some((l) => l.subjectId === sid && classIdsOf(l).includes(cls.id))) n += 1;
          });
          if (n > cap) over += n - cap;
        });
      });
    });
    return over;
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

  // Yakuniy zichlash — kun o'rtasida bo'sh soat qolmasligi uchun bir necha marta
  // ishlatiladi. MUHIM: oyna kamaysa natija QABUL QILINADI; "bir kunda bir fan"
  // limiti ikkinchi darajali mezon (ilgari u tufayli zichlash butunlay rad
  // etilar va ekranda oynali jadval qolib ketardi).
  //
  // `opts.hard` — MAJBURIY rejim: oyna nolga tushmaguncha to'xtamaydi.
  // Bir urinish natija bermasa ham taslim bo'lmaydi: `spin` boshqa yo'ldan
  // yurishga majbur qiladi, shuning uchun keyingi urinish AYNAN o'sha
  // natijani qaytarmaydi. Oddiy (hard bo'lmagan) rejim avvalgidek —
  // birinchi yaxshilanmagan urinishda to'xtaydi, chunki u generatsiya
  // sikli ichida chaqiriladi va vaqtni ushlab qolmasligi kerak.
  // `opts.parallel === false` — parallel moslikni BUTUNLAY o'chirib zichlash.
  // Oyna moslikdan MUHIMROQ: oyna qolib ketsa, moslikdan voz kechiladi.
  function compactUntilClean(startSch, minPlaced, opts = {}) {
    const hard = Boolean(opts.hard);
    const rounds = opts.rounds ?? (hard ? 8 : 4);
    const budgetMs = opts.budgetMs ?? 2500;
    const par = opts.parallel === false ? false : parOn;
    let best = startSch;
    let bestGaps = countGaps(best);
    let bestOver = countOverCap(best);
    let bestBal = countImbalance(best);
    for (let k = 0; k < rounds; k++) {
      // Oyna yopilgan bo'lsa qayta urinishning ma'nosi yo'q. Vaqt chegarasi
      // zichlash dvigatelining O'ZIDA (`budgetMs`) — bu yerda soat o'qilmaydi,
      // chunki funksiya render oqimidan ham chaqiriladi.
      if (k > 0 && bestGaps === 0) break;
      let next;
      try {
        next = compactSchedule(
          classes, timeslots, lunchGroups, best, classSubjects, teachers, subjects, rooms,
          hard ? { hard: true, spin: k, budgetMs, parallelDays: par } : { parallelDays: par },
        );
      } catch {
        break;
      }
      if (!next) break;
      if (countPlacedUnits(next) < minPlaced) break;
      const gAfter = countGaps(next);
      const overAfter = countOverCap(next);
      const balAfter = countImbalance(next);
      if (gAfter < bestGaps || (gAfter === bestGaps && overAfter <= bestOver && balAfter < bestBal)) {
        best = next;
        bestGaps = gAfter;
        bestOver = overAfter;
        bestBal = balAfter;
      } else if (!hard) {
        break;
      }
    }
    return best;
  }

  async function handleGenerate() {
    if (!setSchedule || generating) return;

    let requiredTotal = 0;
    classes.forEach((c) => (classSubjects?.[c.id] || []).forEach((a) => {
      if (a.pairEnabled) {
        // `countPlacedUnits` sinf+fan bo'yicha sanaydi: takroriy fan 1 marta
        const uniq = new Set(pairAllGroups(a).map((g) => g.subjectId).filter(Boolean));
        requiredTotal += Math.max(1, uniq.size) * Number(a.weeklyHours || 0);
        return;
      }
      requiredTotal += Number(a.weeklyHours || 0);
      if (a.swapEnabled && a.swapSubjectId) requiredTotal += Number(a.weeklyHours || 0);
    }));

    const seed = lockedSeed();
    const keptLocked = lockedCount();

    setGenerating(true);
    setGenProgress(0);
    setGenRound(0);
    setGenElapsed(0);

    // Sekundomer — ekranda real vaqtda sanaladi
    const t0 = Date.now();
    if (genTimerRef.current) clearInterval(genTimerRef.current);
    genTimerRef.current = setInterval(() => setGenElapsed((Date.now() - t0) / 1000), 100);
    const stopTimer = () => {
      if (genTimerRef.current) { clearInterval(genTimerRef.current); genTimerRef.current = null; }
    };

    try {
      // ——— IKKI BOSQICHLI QIDIRUV ———
      // 1) TEZKOR: past byudjetli bir necha urinish. Har urinishda BARCHA
      //    qoidalar (ustoz/sinf/xona bandligi, dam kuni, obed, smena, bloklar)
      //    to'liq tekshiriladi — faqat izlash vaqti qisqa. Ko'p maktabda
      //    100% shu yerda chiqadi va jadval 1–2 soniyada tayyor bo'ladi.
      // 2) CHUQUR: faqat tezkor bosqich kamchilik qoldirsa ishga tushadi —
      //    to'liq byudjet bilan, eng yaxshi natija ustiga qurib boradi.
      // Tanlov mezoni leksikografik (o'zgarmagan):
      // (1) joylangan soat, (2) KUN O'RTASIDAGI OYNA, (3) kunlik yuk
      // notekisligi, (4) bir kunda bir fan limitidan oshish.
      const fastB = budgetFor(requiredTotal, "fast");
      const deepB = budgetFor(requiredTotal, "deep");
      const FAST_ROUNDS = 6;      // 6 ta strategiya — har biri bir marta
      const MAX_ROUNDS = 24;
      // Ustoz sig'imi yetmasa — 100% natija MUMKIN EMAS (bitta ustoz bir vaqtda
      // ikki sinfda tura olmaydi). Bunday ma'lumotda uzoq qidirish vaqtni behuda
      // sarflaydi: qisqa chegara qo'yamiz va sababni ro'yxatda ko'rsatamiz.
      const hardBlocked = teacherLoadRows().some((r) => r.overSlots);
      // Vaqt chegarasi maktab hajmiga moslashadi (avval hammaga 45 s edi)
      const TIME_CAP_MS = Math.min(
        hardBlocked ? 10000 : 30000,
        Math.max(9000, Math.min(30000, 6000 + requiredTotal * 9)),
      );
      const STALL_LIMIT = 4;
      const start = Date.now();

      let best = null;
      let bestPlaced = -1;
      let bestOver = Infinity;
      let bestGaps = Infinity;
      let bestBal = Infinity;
      let bestAlign = Infinity;
      let bestStrategy = 0;
      let stall = 0;

      // Parallel moslik — sifat mezonlaridan KEYIN: moslik uchun oyna ham,
      // notekis yuk ham qabul qilinmaydi (generatordagi `betterResult` bilan
      // ayni tartib).
      const betterThan = (placed, over, gaps, bal, align) => {
        if (placed !== bestPlaced) return placed > bestPlaced;
        if (gaps !== bestGaps) return gaps < bestGaps;
        if (bal !== bestBal) return bal < bestBal;
        if (align !== bestAlign) return align < bestAlign;
        return over < bestOver;
      };

      for (let r = 0; r < MAX_ROUNDS; r++) {
        // Brauzerga chizish imkoni beramiz — sekundomer, foiz va urinish
        // raqami har urinishdan oldin ekranga chiqadi (rAF paintdan oldin,
        // setTimeout esa paintdan keyin ishlaydi).
        setGenElapsed((Date.now() - t0) / 1000);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));

        const fast = r < FAST_ROUNDS;
        const b = fast ? fastB : deepB;
        // Tezkor bosqichda strategiyalar navbatma-navbat (xilma-xillik),
        // chuqur bosqichda esa g'olib strategiya boshqa seed bilan qayta uriniladi.
        // MUHIM: har uchinchi chuqur urinishda BOSHQA strategiya sinaladi —
        // aks holda qidiruv bitta "cho'qqi"da qotib qoladi va 100% chiqmagan
        // ma'lumotda urinishlar bir xil natijani takrorlab yuraveradi.
        const strategy = fast
          ? r % 6
          : (r % 3 === 2 ? (bestStrategy + 1 + Math.floor(r / 3)) % 6 : bestStrategy);
        const raw = generateSchedule(
          classes, subjects, teachers, rooms, timeslots, classSubjects, lunchGroups, seed,
          { solveMs: b.solveMs, compactMs: b.compactMs, polishMs: b.polishMs, strategy, quiet: true, parallelDays: parOn }
        );
        // Har bir nomzod darhol zichlanadi: oyna kamaysa — aynan shu variant
        // saqlanadi. Zichlash ~0.1 s turadi, lekin tanlov sifati sezilarli oshadi
        // (sinovda eng yaxshi natijadagi oynalar 13 tadan 9 taga tushdi).
        let cand = raw;
        try {
          const packed = compactSchedule(classes, timeslots, lunchGroups, raw, classSubjects, teachers, subjects, rooms, { parallelDays: parOn });
          if (packed && countPlacedUnits(packed) >= countPlacedUnits(raw)) {
            const gp = countGaps(packed);
            const gr = countGaps(raw);
            // Oyna teng bo'lsa ham kunlik yuk tekisroq bo'lsa — zichlangani olinadi
            if (gp < gr || (gp === gr && countImbalance(packed) < countImbalance(raw))) cand = packed;
          }
        } catch { /* zichlash ixtiyoriy — xato bo'lsa asl nomzod qoladi */ }
        const placed = countPlacedUnits(cand);
        const over = countOverCap(cand);
        const gaps = countGaps(cand);
        const bal = countImbalance(cand);
        const align = parallelMismatch(cand, classes, subjects, parOn);

        if (betterThan(placed, over, gaps, bal, align)) {
          bestPlaced = placed;
          bestOver = over;
          bestGaps = gaps;
          bestBal = bal;
          bestAlign = align;
          bestStrategy = strategy;
          best = cand;
          stall = 0;
        } else {
          stall += 1;
        }

        setGenProgress(requiredTotal > 0 ? Math.min(100, Math.round((bestPlaced / requiredTotal) * 100)) : 100);
        setGenRound(r + 1);

        if (requiredTotal === 0) break;
        const elapsed = Date.now() - start;
        const full = bestPlaced >= requiredTotal;
        // Mukammal natija — darhol to'xtaymiz. Parallel moslik hali to'liq
        // emas bo'lsa yana ikki urinish beriladi (ko'pi bilan), chunki u
        // ko'pincha obyektiv sabablarga ko'ra 100% bo'la olmaydi —
        // vaqtni cheksiz sarflash noto'g'ri bo'lardi.
        if (full && bestGaps === 0 && bestBal === 0 && (bestAlign === 0 || stall >= 2)) break;
        // Hammasi joylashdi va oyna yo'q, LEKIN kunlik yuk hali notekis
        // (bir kun 3 soat, boshqa kun 6 soat). Teng taqsimot ham majburiy
        // talab, shuning uchun bu yerda to'xtamaymiz — yaxshilanish uzoq
        // to'xtaganda yoki vaqt tugay deganda chiqamiz.
        if (full && bestGaps === 0 && (stall >= STALL_LIMIT + 4 || elapsed > TIME_CAP_MS * 0.85)) break;
        // Ma'lumotdagi ziddiyat tufayli to'liq natija bo'lmasa — ortiqcha kutmaymiz
        if (hardBlocked && !fast && stall >= 2) break;
        // Chuqur bosqichda yaxshilanish to'xtadi.
        // MUHIM: kun o'rtasida bo'sh soat (oyna) qolgan bo'lsa — to'xtamaymiz,
        // vaqt tugagunicha oynasiz variant qidiriladi.
        if (!fast && stall >= (bestGaps === 0 && bestBal === 0 ? STALL_LIMIT : STALL_LIMIT + 2)) break;
        if (elapsed > TIME_CAP_MS) break;
        // Tezkor bosqich tugadi, lekin chuqur urinishga vaqt qolmadi
        if (r + 1 === FAST_ROUNDS && elapsed > TIME_CAP_MS * 0.6) break;
      }

      let finalSch = best || {};

      // Tushmagan soatlarni ko'chirish/almashtirish orqali to'ldirish.
      // Bu bosqich qulflangan seeddan kelgan YARIM kartalarni ham
      // to'g'rilaydi (guruh yozuvi yetishmayotgan katak — 0-bosqich).
      if (requiredTotal > 0 && bestPlaced < requiredTotal) {
        const res = fillRemaining(finalSch, false);
        if (res.placed > 0 || res.repaired > 0 || res.moved > 0) {
          finalSch = res.schedule;
          bestPlaced = countPlacedUnits(finalSch);
        }
      }

      // ——— YAKUNIY ZICHLASH: OYNA QOLMASLIGI KAFOLATI ———
      // MAJBURIY rejim: oyna qolgan bo'lsa bir necha marta, har safar
      // boshqa yo'ldan va kattaroq byudjet bilan qayta uriniladi.
      // Oyna allaqachon 0 bo'lsa — bitta yengil urinish bilan cheklanadi,
      // ya'ni tayyor jadval uchun vaqt behuda sarflanmaydi.
      finalSch = compactUntilClean(finalSch, bestPlaced, { hard: true, rounds: 4, budgetMs: 1500 });

      // ⚠️ OYNA — MOSLIKDAN MUHIMROQ. Oyna baribir qolgan bo'lsa, parallel
      // moslikni BUTUNLAY o'chirib qayta zichlaymiz: moslik mukofoti
      // zichlashni mahalliy "cho'qqi"da ushlab qolgan bo'lishi mumkin.
      // Natija yaxshilansagina qabul qilinadi, ya'ni bu bosqich hech narsani
      // yomonlashtira olmaydi.
      if (parOn && countGaps(finalSch) > 0) {
        const plain = compactUntilClean(
          finalSch, bestPlaced, { hard: true, rounds: 6, budgetMs: 2200, parallel: false },
        );
        if (countGaps(plain) < countGaps(finalSch)) finalSch = plain;
      }

      setSchedule(finalSch);

      const secs = (Date.now() - t0) / 1000;
      stopTimer();
      setGenElapsed(secs);

      const lockNote = keptLocked > 0 ? ` · ${keptLocked} ta qulflangan dars saqlandi 🔒` : "";
      const gapNote = countGaps(finalSch) > 0 ? ` · ⚠️ ${countGaps(finalSch)} ta bo'sh soat qoldi` : "";
      const timeNote = ` · ⏱ ${secs.toFixed(1)} s`;
      if (requiredTotal === 0 || bestPlaced >= requiredTotal) {
        toast?.(`Dars jadvali 100% tuzildi ✓${lockNote}${gapNote}${timeNote}`, gapNote ? "warning" : "success");
      } else {
        toast?.(`Jadval tuzildi — ${requiredTotal - bestPlaced} soat tushmadi${lockNote}${gapNote}${timeNote}`, "warning");
      }

      setGenDone(true);
      await new Promise((res) => setTimeout(res, 900));
    } finally {
      stopTimer();
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

  // Shu sinfda shu fandan nechta soat TO'LIQ turibdi. Yarim karta (guruh
  // yozuvi yetishmayotgan katak) sanalmaydi — u «tushmagan soat» hisoblanadi
  // va «🧩 yarim tushgan darslar» ro'yxatiga chiqadi.
  function placedHours(classId, subjectId) {
    let count = 0;
    DAYS.forEach((day) => {
      sortedTimeslots.forEach((slot) => {
        const cell = schedule?.[day]?.[slot.id];
        if (Array.isArray(cell) && cell.length && cellHasFullSubject(cell, classId, subjectId)) count += 1;
      });
    });
    return count;
  }

  function requiredHours(classId, subjectId) {
    const list = classSubjects?.[classId] || [];
    let req = 0;
    list.forEach((a) => {
      if (a.pairEnabled) {
        // Kartadagi guruhlar AYNI SOATDA o'qiydi. Bir xil fan bir nechta
        // guruhda bo'lsa ham, sinf setkasida u `weeklyHours` ta soat
        // egallaydi — shuning uchun BIR MARTA sanaladi.
        if (pairAllGroups(a).some((g) => g.subjectId === subjectId)) req += Number(a.weeklyHours || 0);
        return;
      }
      if (a.subjectId === subjectId) req += Number(a.weeklyHours || 0);
      if (a.swapEnabled && a.swapSubjectId === subjectId) req += Number(a.weeklyHours || 0);
    });
    return req;
  }

  // ——— BIR KUNDA BIR FAN NECHA SOAT BO'LISHI MUMKIN? ———
  // "4 soat blok" yoqilgan bo'lsa — 4 soat, "2 soat blok"da — 2 soat,
  // aks holda 1 soat.
  // Agar haftalik soat kunlarga sig'masa, limit avtomatik oshadi
  // (masalan 8 soat / 6 kun => kuniga 2 soat).
  function usableDaysOf(classId) {
    const cls = classes.find((c) => c.id === classId);
    const off = Array.isArray(cls?.offDays) ? cls.offDays : [];
    return Math.max(1, DAYS.length - off.length);
  }

  function subjectDayCap(classId, subjectId) {
    const list = classSubjects?.[classId] || [];
    const a = list.find((x) => x.subjectId === subjectId)
      || list.find((x) => x.swapEnabled && x.swapSubjectId === subjectId)
      || list.find((x) => pairSideGroups(x).some((g) => g.subjectId === subjectId));
    const need = requiredHours(classId, subjectId);
    const base = a && a.allowQuad
      ? 4
      : a && (a.allowDouble || (a.swapEnabled && a.swapSubjectId === subjectId)) ? 2 : 1;
    return Math.max(base, Math.ceil(need / usableDaysOf(classId)) || 1);
  }

  // ——— BIR KUNGA TUSHMAYDIGAN FANLAR ———
  // Algebra va Geometriya bitta sinfda BIR KUNDA o'qitilmaydi. Shu kunda
  // `subjectId` bilan ziddiyatli fan turgan bo'lsa `true` qaytadi.
  // `work` — tekshirilayotgan jadval, `skip` — hisobga olinmaydigan yozuvlar
  // (ko'chirilayotgan darsning o'zi).
  function dayHasConflict(work, classId, subjectId, day, skip = null) {
    const foes = conflictOf.get(subjectId);
    if (!foes || !foes.size) return false;
    return sortedTimeslots.some((ts) => (work?.[day]?.[ts.id] || []).some((l) => (
      l && (foes.has(l.subjectId) || (l.alternating && foes.has(l.altSubjectId)))
      && classIdsOf(l).includes(classId) && !(skip && skip.has(l))
    )));
  }

  function missingForClass(classId) {
    const list = classSubjects?.[classId] || [];
    const subjectIds = new Set();
    list.forEach((a) => {
      if (a.subjectId) subjectIds.add(a.subjectId);
      if (a.swapEnabled && a.swapSubjectId) subjectIds.add(a.swapSubjectId);
      pairSideGroups(a).forEach((g) => subjectIds.add(g.subjectId));
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

  // ═══ QO'LDA DARS QO'SHISH: BO'SH VAQT, BO'SH USTOZ ═══
  // Bo'sh katakka bosilganda ochiladigan oyna shu yordamchilarga tayanadi.
  // Qoida: fanlar — FAQAT shu sinfda yoqilganlari, ustozlar — FAQAT shu fanni
  // beradiganlari va aynan SHU VAQTDA bo'sh bo'lganlari.

  // (kun, slot) VAQTIDA band bo'lgan barcha darslar. Ikki smena bir xil soatda
  // o'tishi mumkin (slot id boshqa, vaqti bir xil) — shuning uchun ustoz va
  // xona bandligi slot emas, VAQT bo'yicha o'qiladi.
  function cellAtTime(day, slotId) {
    const slot = sortedTimeslots.find((s) => s.id === slotId);
    if (!slot) return Array.isArray(schedule?.[day]?.[slotId]) ? schedule[day][slotId] : [];
    return cellsAt(ctx, day, slot);
  }

  function whereOf(lesson) {
    return classIdsOf(lesson)
      .map((id) => classes.find((c) => c.id === id)?.name)
      .filter(Boolean)
      .join(", ");
  }

  // Ustoz shu vaqtda NEGA bo'sh emas? Bo'sh bo'lsa — bo'sh satr qaytadi.
  function teacherBusyReason(teacherId, day, slotId) {
    if (!teacherId) return "";
    const t = teacherMap.get(teacherId);
    if (!t) return "topilmadi";
    if (Array.isArray(t.offDays) && t.offDays.includes(day)) return "dam olish kuni";
    if (teacherBlockedAt(teacherId, day, slotId)) return "setkada qulflangan";
    const busy = cellAtTime(day, slotId).find((l) => teacherIdsOf(l).includes(teacherId));
    if (busy) {
      const where = whereOf(busy);
      const sname = subjectMap.get(busy.subjectId)?.name || "dars";
      return where ? `${where} — ${sname}` : sname;
    }
    return "";
  }

  function roomBusyReason(roomId, day, slotId) {
    if (!roomId) return "";
    const busy = cellAtTime(day, slotId).find((l) => l.roomId === roomId);
    return busy ? (whereOf(busy) || "band") : "";
  }

  // Shu fanni SHU SINFDA beradigan ustozlar — guruhlar va almashinuv bilan
  // birga (bo'lingan guruh, daraja guruhi, «bir vaqtda bir nechta fan»).
  function classTeacherIdsFor(classId, subjectId) {
    const out = [];
    const push = (id) => { if (id && !out.includes(id)) out.push(id); };
    (classSubjects?.[classId] || []).forEach((a) => {
      if (a.subjectId === subjectId) {
        push(a.teacherId);
        if (a.splitEnabled) push(a.teacherId2);
        if (a.levelGroupEnabled) (a.levelGroups || []).forEach((g) => push(g.teacherId));
      }
      // Almashinuvda 2-soat ustozi boshqa bo'lishi mumkin — ikkalasi ham
      // shu fanni SHU SINFDA beradi.
      if (a.swapEnabled && a.swapSubjectId) swapTeachersOfSubject(a, subjectId).forEach(push);
      if (a.weekAltEnabled && a.weekAltSubjectId === subjectId) push(a.weekAltTeacherId);
      pairAllGroups(a).forEach((g) => { if (g.subjectId === subjectId) push(g.teacherId); });
    });
    return out;
  }

  // Fan uchun ustozlar ro'yxati. Uch to'plam qaytadi:
  //   ownFree   — SHU SINFGA shu fanni beradigan va shu vaqtda BO'SH ustozlar,
  //   otherFree — shu fandan boshqa bo'sh ustozlar (almashtirish uchun zaxira),
  //   busy      — band bo'lgani uchun ro'yxatga CHIQMAYDIGANLAR (sababi bilan).
  // Oynada avval faqat sinfning o'z ustozi ko'rsatiladi; u band bo'lsagina
  // zaxira ro'yxati ochiladi — begona ustoz bekorga ko'rinmaydi.
  function teacherChoices(classId, subjectId, day, slotId) {
    if (!subjectId) return { ownFree: [], otherFree: [], free: [], busy: [], hasOwn: false };
    const own = classTeacherIdsFor(classId, subjectId);
    const ids = uniqBy([...own, ...teachersForSubject(subjectId).map((t) => t.id)], (id) => id);
    const ownFree = [];
    const otherFree = [];
    const busy = [];
    ids.forEach((id) => {
      const t = teacherMap.get(id);
      if (!t) return;
      const reason = teacherBusyReason(id, day, slotId);
      const row = { id, name: t.name, own: own.includes(id), reason };
      if (reason) busy.push(row);
      else if (row.own) ownFree.push(row);
      else otherFree.push(row);
    });
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), "uz");
    ownFree.sort(byName);
    otherFree.sort(byName);
    busy.sort((a, b) => (Number(b.own) - Number(a.own)) || byName(a, b));
    // Ko'rsatiladigan ro'yxat: o'z ustozi bo'sh bo'lsa — faqat u
    const free = ownFree.length ? ownFree : otherFree;
    return { ownFree, otherFree, free, busy, hasOwn: own.length > 0 };
  }

  // Shu vaqtda bo'sh xonalar (band bo'lgani ro'yxatga chiqmaydi)
  function roomChoices(day, slotId) {
    const free = [];
    let busyCount = 0;
    rooms.forEach((r) => {
      if (roomBusyReason(r.id, day, slotId)) busyCount += 1;
      else free.push(r);
    });
    return { free, busyCount };
  }

  // Fan shu kunda sinfda necha marta turibdi (kunlik me'yorni tekshirish uchun)
  function subjectDayCount(classId, subjectId, day) {
    let n = 0;
    sortedTimeslots.forEach((slot) => {
      const cell = schedule?.[day]?.[slot.id];
      if (Array.isArray(cell) && cell.some((l) => l.subjectId === subjectId && classIdsOf(l).includes(classId))) n += 1;
    });
    return n;
  }

  // Sinfda YOQILGAN barcha fanlar. Soati to'liq qo'yilgan fan ham ro'yxatda
  // qoladi — direktor ortiqcha dars (almashtirish, to'garak) qo'ya olishi
  // kerak; ro'yxatda esa «soati to'liq» deb belgilanadi. Sinfda umuman
  // yoqilmagan fan bu yerga TUSHMAYDI.
  function classSubjectChoices(classId, day, slotId) {
    const ids = [];
    const push = (id) => { if (id && !ids.includes(id)) ids.push(id); };
    (classSubjects?.[classId] || []).forEach((a) => {
      push(a.subjectId);
      if (a.swapEnabled) push(a.swapSubjectId);
      if (a.weekAltEnabled) push(a.weekAltSubjectId);
      pairAllGroups(a).forEach((g) => push(g.subjectId));
    });
    return ids
      .map((sid) => {
        const need = requiredHours(classId, sid);
        const got = placedHours(classId, sid);
        const { free, busy, ownFree } = teacherChoices(classId, sid, day, slotId);
        return {
          subjectId: sid,
          name: subjectMap.get(sid)?.name || "Fan",
          need,
          got,
          missing: Math.max(0, need - got),
          freeCount: free.length,
          ownFreeCount: ownFree.length,
          busyCount: busy.length,
        };
      })
      .sort((a, b) => (
        (Number(b.missing > 0) - Number(a.missing > 0))
        || (Number(b.freeCount > 0) - Number(a.freeCount > 0))
        || (b.missing - a.missing)
        || String(a.name).localeCompare(String(b.name), "uz")
      ));
  }

  // Fan tanlanganda ustoz o'zi tanlanadi — FAQAT sinfning O'Z ustozi.
  // ⚠️ Ilgari o'z ustozi band bo'lsa shu fandan bo'sh BOSHQA ustoz avtomatik
  // qo'yilardi: direktor darsni bilmagan holda begona ustozga yozib yuborardi.
  // Endi bunday holatda maydon BO'SH qoladi — zaxira ustozlar ro'yxati oynada
  // ko'rinadi, lekin tanlash ONGLI bo'ladi.
  function pickFreeTeacher(classId, subjectId, day, slotId) {
    if (!subjectId) return "";
    const assigned = assignedTeacher(classId, subjectId);
    if (assigned && !teacherBusyReason(assigned, day, slotId)) return assigned;
    return teacherChoices(classId, subjectId, day, slotId).ownFree[0]?.id || "";
  }

  function conflictsAt(day, slotId, classId, teacherId, roomId) {
    const cell = cellAtTime(day, slotId);        // ustoz/xona — VAQT bo'yicha
    const own = schedule?.[day]?.[slotId] || []; // sinf — o'z katagi bo'yicha
    const warns = [];
    if (teacherId) {
      const tConf = cell.find((l) => teacherIdsOf(l).includes(teacherId));
      if (tConf) {
        const where = classIdsOf(tConf).map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
        warns.push(`⚠️ Ustoz bu vaqtda band (parallel): ${getName(teacherMap, teacherId)} → ${where || "boshqa sinf"}`);
      }
      const t = teacherMap.get(teacherId);
      if (Array.isArray(t?.offDays) && t.offDays.includes(day)) {
        warns.push(`⛔ ${t.name}: ${day} — ustozning dam olish kuni, dars qo'yib bo'lmaydi`);
      }
      if (teacherBlockedAt(teacherId, day, slotId)) {
        warns.push(`⚠️ ${getName(teacherMap, teacherId)}: bu soat Ustoz setkasida qulflangan — qo'lda qo'shsangiz shu dars mustasno sifatida qoladi`);
      }
    }
    if (roomId) {
      const rConf = cell.find((l) => l.roomId === roomId);
      if (rConf) warns.push(`⚠️ Xona bu vaqtda band: ${getName(roomMap, roomId)}`);
    }
    const classHas = own.some((l) => classIdsOf(l).includes(classId));
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

  // ——— QO'LDA QO'SHISHDA GURUHLI DARS ———
  // ⚠️ Ilgari qo'lda qo'shilgan dars HAR DOIM bitta yozuv bo'lib tushardi.
  // «2 guruhga bo'lish» yoqilgan fanda bu 2-guruh ustozining soatini
  // jimgina yo'qotardi: katakda faqat 1-guruh turar, hisoblagich esa uni
  // to'liq soat deb sanardi. Endi karta sozlamadagi HAMMA guruhi bilan
  // birga qo'shiladi (daraja guruhlari, bo'linish va «bir vaqtda bir nechta
  // fan» uchun bir xil).
  function manualGroupInfo(classId, subjectId) {
    if (!subjectId) return null;
    const plan = cardPlan(classId, subjectId);
    const a = plan.row;
    if (!a || plan.need <= 1 || plan.groups.length <= 1) return null;

    const matesBy = (pick) => classes
      .filter((c) => (classSubjects?.[c.id] || []).some(pick))
      .map((c) => c.id);

    if (plan.kind === "level") {
      const key = String(a.levelGroupKey || "").trim();
      const mates = key
        ? matesBy((x) => x.subjectId === subjectId && x.levelGroupEnabled && String(x.levelGroupKey || "").trim() === key)
        : [];
      return {
        kind: "level", plan, groups: plan.groups, groupKey: key,
        classIds: mates.length ? mates : [classId],
      };
    }
    if (plan.kind === "split") {
      return { kind: "split", plan, groups: plan.groups, classIds: [classId] };
    }
    // «Bir vaqtda bir nechta fan»: kalit generatordagi bilan AYNI shaklda
    // yasaladi — aks holda karta bo'linib, guruhlar ajralib ketadi.
    const pgKey = String(a.pairGroupKey || "").trim();
    const mates = pgKey
      ? matesBy((x) => x.pairEnabled && String(x.pairGroupKey || "").trim() === pgKey && x.subjectId === a.subjectId)
      : [];
    return {
      kind: "pair", plan, groups: plan.groups,
      classIds: mates.length ? mates : [classId],
      pairKey: pgKey ? `PG__${pgKey}__${a.subjectId}` : `${classId}__${a.subjectId}__${a.pairSubjectId || ""}`,
    };
  }

  function openManual(day, slotId, classId, presetSubjectId = "") {
    setManualForm({
      subjectId: presetSubjectId,
      teacherId: presetSubjectId ? pickFreeTeacher(classId, presetSubjectId, day, slotId) : "",
      roomId: "", altEnabled: false, altSubjectId: "", altTeacherId: "", lock: false,
    });
    setManualCell({ day, slotId, classId });
  }

  function groupConflictsAt(day, slotId, classIds, groups) {
    const cell = cellAtTime(day, slotId);
    const own = schedule?.[day]?.[slotId] || [];
    const warns = [];
    (groups || []).forEach((g) => {
      if (!g.teacherId) return;
      const conf = cell.find((l) => teacherIdsOf(l).includes(g.teacherId));
      if (conf) {
        const where = classIdsOf(conf).map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
        warns.push(`⚠️ ${getName(teacherMap, g.teacherId)} bu vaqtda band (parallel): ${where || "boshqa sinf"}`);
      }
      const t = teacherMap.get(g.teacherId);
      if (Array.isArray(t?.offDays) && t.offDays.includes(day)) {
        warns.push(`⛔ ${t.name}: ${day} — dam olish kuni`);
      }
      if (teacherBlockedAt(g.teacherId, day, slotId)) {
        warns.push(`⚠️ ${getName(teacherMap, g.teacherId)}: bu soat Ustoz setkasida qulflangan`);
      }
    });
    const classHas = (classIds || []).some((cid) => own.some((l) => classIdsOf(l).includes(cid)));
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
        if (a.swapEnabled && a.swapSubjectId) swapTeachersOfSubject(a, subjectId).forEach((tid) => add(tid, cls.name));
        pairSideGroups(a).forEach((g) => { if (g.subjectId === subjectId) add(g.teacherId, cls.name); });
      });
    });
    return map;
  }

  function suggestionsFor(subjectId) {
    const sugg = [];
    // Shu fanni o'qitadigan ustozlardan birortasining sig'imi yetmayaptimi?
    // Agar shunday bo'lsa — asl sabab shu, umumiy maslahatlar keyin keladi.
    teacherLoadRows()
      .filter((r) => (r.overSlots || r.overLimit) && r.subjectIds.has(subjectId))
      .slice(0, 2)
      .forEach((r) => {
        if (r.overSlots) {
          sugg.push("⛔ Asosiy sabab — " + r.name + ": " + r.hours + " soat kerak, bo'sh soat " + r.avail
            + " ta (" + (r.hours - r.avail) + " soat ortiqcha). Bitta ustoz bir vaqtda ikki sinfda tura olmaydi —"
            + " shu fanga ikkinchi ustoz qo'shing yoki soatni kamaytiring.");
        } else {
          sugg.push("⛔ " + r.name + ": yuklama " + r.hours + " soat, «maksimal haftalik soat» esa " + r.max
            + ". Limitni oshiring yoki yukni boshqa ustozga bo'ling.");
        }
      });
    sugg.push("🔁 Bu fanni «Parallel» qiling — bir ustoz bir vaqtda bir nechta teng sinfga o'tadi (Jismoniy tarbiya, Musiqa kabi). Sinf fanlari → «Parallel dars»ni yoqing va parallel nomi yozing (masalan «1-sinf Jismoniy»).");
    const tc = teacherClassCount(subjectId);
    const overloaded = Object.entries(tc).filter(([, set]) => set.size >= 3).sort((a, b) => b[1].size - a[1].size);
    if (overloaded.length) {
      sugg.push(`👤 Yuklamasi ko'p ustoz: ${overloaded.slice(0, 3).map(([id, set]) => `${getName(teacherMap, id)} — ${set.size} ta sinfga dars beradi (${[...set].slice(0, 6).join(", ")}${set.size > 6 ? "…" : ""})`).join("; ")}. Bu fanga yana ustoz qo'shing yoki yukni bo'ling.`);
    }
    return sugg;
  }

  // ——— USTOZ SIG'IMI (eng ko'p uchraydigan "soat tushmadi" sababi) ———
  // Ustoz bir vaqtda faqat bitta sinfda bo'la oladi. Shuning uchun uning
  // haftalik dars soati o'z smenasidagi bo'sh slotlardan KO'P bo'lsa, jadval
  // hech qanday algoritm bilan to'liq chiqmaydi — bu ma'lumotdagi ziddiyat.
  // Parallel (daraja guruhi) va «Parallel sinflar» darslari BIR MARTA sanaladi:
  // ular bir vaqtda bir nechta sinfga o'tiladi.
  // Hisoblash mantiqi [homeroom.js](../utils/homeroom.js) dagi
  // `buildTeacherStreams` da yashaydi — u nazorat qoidasida ham ishlatiladi,
  // shuning uchun ikki joyda takrorlanmasin (ajralib ketsa soat ikkilanadi).
  function computeTeacherLoadRows() {
    const rows = [];
    buildTeacherStreams(classes, classSubjects).forEach((info, tid) => {
      const t = teacherMap.get(tid);
      const hours = info.total;
      const off = new Set(Array.isArray(t?.offDays) ? t.offDays : []);
      const bs = t?.blockedSlots && typeof t.blockedSlots === "object" ? t.blockedSlots : {};
      let avail = 0;
      DAYS.forEach((day) => {
        if (off.has(day)) return;
        const bl = new Set(Array.isArray(bs[day]) ? bs[day] : []);
        sortedTimeslots.forEach((ts) => {
          if (!isTeachingSlot(ts) || bl.has(ts.id)) return;
          // Ustoz shu soatda kamida bitta o'z sinfiga dars bera oladimi?
          const ok = [...info.classIds].some((cid) => {
            const c = classes.find((x) => x.id === cid);
            if (Array.isArray(c?.offDays) && c.offDays.includes(day)) return false;
            return slotAllowsClass(ts, cid) && !classHasLunchAt(ts, cid, lunchGroups, day);
          });
          if (ok) avail += 1;
        });
      });
      const max = Number(t?.maxWeeklyHours || 0);
      rows.push({
        id: tid,
        name: getName(teacherMap, tid),
        hours,
        avail,
        max,
        classNames: [...info.classIds].map((cid) => classes.find((c) => c.id === cid)?.name).filter(Boolean),
        subjectIds: info.subjectIds,
        overSlots: hours > avail,
        overLimit: max > 0 && hours > max,
      });
    });
    return rows.sort((a, b) => (b.hours - b.avail) - (a.hours - a.avail));
  }

  // Natija render davomida bir marta hisoblanadi (ro'yxatda ko'p marta kerak).
  const teacherLoadCache = useMemo(
    () => computeTeacherLoadRows(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [classes, classSubjects, teachers, sortedTimeslots, lunchGroups],
  );
  const teacherLoadRows = () => teacherLoadCache;

  // ——— XONA SIG'IMI ———
  // Xona ham ustoz kabi bir vaqtda faqat BITTA darsni sig'diradi. Bitta
  // xonaga biriktirilgan haftalik soat, o'sha xonani ishlatadigan sinflarning
  // bo'sh slotlaridan ko'p bo'lsa — ortiqcha soat HECH QANDAY jadvalga
  // tushmaydi. Bu ma'lumotdagi ziddiyat, algoritm uni yecha olmaydi.
  //
  // Dedup ustozdagi bilan AYNI qoida bo'yicha (CLAUDE.md): birga o'qiydigan
  // sinflar bitta xonani BIR MARTA band qiladi.
  //   🔁 parallel dars → groupKey, daraja guruhlari → levelGroupKey + xona,
  //   parallel sinflar → pairCardKey + xona.
  function computeRoomLoadRows() {
    const streams = new Map();   // roomId → Map(oqim kaliti → { hours, classIds })
    const add = (rid, key, hours, classId) => {
      const h = Number(hours || 0);
      if (!rid || h <= 0) return;
      let e = streams.get(rid);
      if (!e) streams.set(rid, (e = new Map()));
      let st = e.get(key);
      if (!st) e.set(key, (st = { hours: 0, classIds: new Set() }));
      // Ayni oqim bir necha sinfdan kelsa — soat eng kattasi bo'yicha, bir marta
      st.hours = Math.max(st.hours, h);
      if (classId) st.classIds.add(classId);
    };

    classes.forEach((cls) => {
      (classSubjects?.[cls.id] || []).forEach((a, idx) => {
        if (!a) return;
        const h = Number(a.weeklyHours || 0);
        const lg = String(a.levelGroupKey || "").trim();
        const gk = String(a.groupKey || "").trim();
        const realSplit = Boolean(a.splitEnabled && a.teacherId2 && a.teacherId2 !== a.teacherId);

        if (a.levelGroupEnabled && a.levelGroups?.length) {
          const base = lg ? `LG|${lg}|${a.subjectId}` : `LGC|${cls.id}|${idx}`;
          a.levelGroups.forEach((g) => add(g?.roomId, `${base}|${g?.roomId}`, h, cls.id));
        } else if (a.pairEnabled) {
          const card = pairCardKey(a, cls.id);
          pairAllGroups(a).forEach((g) => add(g.roomId, `${card}|${g.roomId}`, h, cls.id));
        } else if (gk && !realSplit) {
          add(a.roomId, `G|${a.subjectId}|${a.roomId}|${gk}`, h, cls.id);
        } else if (swapActive(a)) {
          // Fan almashinuvi: blok 2 soat, xona blokning nechta soatida band
          // bo'lsa — shuncha ([swapGroups.js](../utils/swapGroups.js)).
          swapRoomHours(a, h).forEach((hh, rid) => add(rid, `SW|${cls.id}|${idx}|${rid}`, hh, cls.id));
        } else {
          add(a.roomId, `C|${cls.id}|${idx}`, h, cls.id);
          if (realSplit) add(a.roomId2, `C2|${cls.id}|${idx}`, h, cls.id);
        }
      });
    });

    const rows = [];
    streams.forEach((e, rid) => {
      let hours = 0;
      const classIds = new Set();
      e.forEach((st) => { hours += st.hours; st.classIds.forEach((c) => classIds.add(c)); });
      // Xonaning o'z dam kuni yo'q — u faqat o'zini ishlatadigan sinflar
      // dars qilayotgan soatda band bo'la oladi.
      let avail = 0;
      DAYS.forEach((day) => {
        sortedTimeslots.forEach((ts) => {
          if (!isTeachingSlot(ts)) return;
          const ok = [...classIds].some((cid) => {
            const c = classes.find((x) => x.id === cid);
            if (Array.isArray(c?.offDays) && c.offDays.includes(day)) return false;
            return slotAllowsClass(ts, cid) && !classHasLunchAt(ts, cid, lunchGroups, day);
          });
          if (ok) avail += 1;
        });
      });
      rows.push({
        id: rid,
        name: getName(roomMap, rid),
        hours,
        avail,
        classNames: [...classIds].map((cid) => classes.find((c) => c.id === cid)?.name).filter(Boolean),
        overSlots: hours > avail,
      });
    });
    return rows.sort((a, b) => (b.hours - b.avail) - (a.hours - a.avail));
  }

  const roomLoadCache = useMemo(
    () => computeRoomLoadRows(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [classes, classSubjects, rooms, sortedTimeslots, lunchGroups],
  );

  // Xona sig'imi ogohlantirishlari. Ustoznikidagi kabi bu ham BASHORAT:
  // jadval 100% chiqqan bo'lsa bashorat amalda rad etilgan — ko'rsatilmaydi.
  function roomCapacityWarnings(scheduleComplete = false) {
    if (scheduleComplete) return [];
    return roomLoadCache
      .filter((r) => r.overSlots)
      .slice(0, 6)
      .map((r) => {
        const where = r.classNames.slice(0, 5).join(", ") + (r.classNames.length > 5 ? "…" : "");
        return `🚪 ${r.name}: bu xonaga haftada ${r.hours} soat dars biriktirilgan, lekin xonada atigi ${r.avail} ta dars soati bor — ${r.hours - r.avail} soat HECH QANDAY jadvalga sig'maydi (${where}). Bir xona bir vaqtda bitta darsni sig'diradi: shu fanlarning bir qismini boshqa (bo'sh) xonaga ko'chiring.`;
      });
  }

  // Deyarli har soati band ustozlar — kun o'rtasidagi oynaning asosiy sababi:
  // bunday ustozning darsini boshqa soatga surib bo'lmaydi, chunki u soatda
  // boshqa sinfda dars berayotgan bo'ladi.
  function tightTeachers() {
    return teacherLoadRows()
      .filter((r) => r.avail > 0 && r.hours / r.avail >= 0.8)
      .slice(0, 4);
  }

  // Ustoz sig'imi bo'yicha ogohlantirishlar (matn ko'rinishida)
  // `scheduleComplete` — jadval ALLAQACHON to'liq chiqqan bo'lsa, "smenaga
  // sig'maydi" degan BASHORAT amalda rad etilgan: uni ko'rsatish faqat
  // chalg'itadi. «Maksimal haftalik soat» limiti esa jadvaldan qat'i nazar
  // buzilgan bo'lishi mumkin — u har doim ko'rinadi.
  function teacherCapacityWarnings(scheduleComplete = false) {
    return teacherLoadRows()
      .filter((r) => (r.overSlots && !scheduleComplete) || r.overLimit)
      .slice(0, 6)
      .map((r) => {
        const where = r.classNames.slice(0, 5).join(", ") + (r.classNames.length > 5 ? "…" : "");
        if (r.overSlots && !scheduleComplete) {
          return `👤 ${r.name}: haftada ${r.hours} soat dars berishi kerak, lekin uning smenasida atigi ${r.avail} ta dars soati bor — ${r.hours - r.avail} soat HECH QANDAY jadvalga sig'maydi (${where}). Yechim: shu fanlarga ikkinchi ustoz qo'ying yoki soatni kamaytiring.`;
        }
        return `👤 ${r.name}: ${r.hours} soat yuklama, lekin «maksimal haftalik soat» ${r.max} qilib belgilangan (${where}). Limitni oshiring yoki yukni bo'ling.`;
      });
  }

  // ——— NAZORAT SIG'IMI (1–4 sinf) ———
  // «Rahbar boshqa sinfga kirib ketganda bu sinfda boshqa ustozning darsi
  // tursin» qoidasi JISMONAN bajarilishi uchun:
  //     rahbarning tashqi soati  ≤  sinfdagi begona ustoz soati
  // Chap tomon katta bo'lsa hech qanday algoritm yordam bera olmaydi —
  // o'rniga qo'yadigan dars shunchaki YO'Q. Buni oldindan aytish kerak,
  // aks holda foydalanuvchi sababini bilmay generatsiyani qayta-qayta bosadi.
  const superviseCache = useMemo(
    () => supervisionRows({ classes, classSubjects, timeslots: sortedTimeslots, lunchGroups }),
    [classes, classSubjects, sortedTimeslots, lunchGroups],
  );

  function supervisionCapacityWarnings() {
    // Rahbarning tashqi soati sinfdagi begona ustoz soatidan ko'p bo'lsa,
    // ortiqcha soatlar faqat sinf kunini ERTA TUGATISH bilan qoplanadi.
    // Bu imkonsiz emas, lekin jadvalni sezilarli toraytiradi — shuning
    // uchun ogohlantiramiz, taqiqlamaymiz.
    return superviseCache
      .filter((r) => r.riskHours > 0)
      .sort((a, b) => b.riskHours - a.riskHours)
      .slice(0, 5)
      .map((r) => {
        const name = getName(teacherMap, r.teacherId);
        const where = r.outClassIds
          .map((cid) => classes.find((c) => c.id === cid)?.name)
          .filter(Boolean).slice(0, 5).join(", ");
        return `🧒 ${r.className}: sinf rahbari (${name}${r.auto ? ", avtomatik aniqlandi" : ""}) boshqa sinflarda ${r.outHours} soat dars beradi${where ? ` (${where})` : ""}, lekin ${r.className} da boshqa ustoz kiradigan fan atigi ${r.coverHours} soat. Qolgan ${r.riskHours} soatda ${r.className} ning darsi ALLAQACHON tugagan bo'lishi kerak, aks holda bolalar ustozsiz qoladi. Erkinroq jadval uchun ${r.className} ga yana bir fan ustozini biriktiring yoki rahbarning tashqi soatini kamaytiring.`;
      });
  }

  // Tayyor jadvaldagi HAQIQIY buzilishlar (qo'lda ko'chirishdan keyin ham
  // qayta hisoblanadi — shuning uchun `schedule` bog'liqliklar ichida)
  const superviseGaps = useMemo(
    () => findSupervisionGaps({
      classes, classSubjects, teachers, timeslots: sortedTimeslots, lunchGroups, schedule,
    }),
    [classes, classSubjects, teachers, sortedTimeslots, lunchGroups, schedule],
  );

  // ——— BIR KUNGA TUSHGAN ZIDDIYATLI FANLAR ———
  // Generator, zichlash va zaxira to'ldirgich bunday holatni YARATMAYDI,
  // lekin qo'lda ko'chirish (yoki eski jadval) keltirib chiqarishi mumkin —
  // shuning uchun ekranda ko'rinib tursin.
  const conflictViolations = useMemo(() => {
    if (!conflictOf.size) return [];
    const out = [];
    classes.forEach((cls) => {
      DAYS.forEach((day) => {
        const found = new Set();
        sortedTimeslots.forEach((ts) => {
          (schedule?.[day]?.[ts.id] || []).forEach((l) => {
            if (!l || !classIdsOf(l).includes(cls.id)) return;
            if (l.subjectId) found.add(l.subjectId);
            if (l.alternating && l.altSubjectId) found.add(l.altSubjectId);
          });
        });
        const ids = [...found];
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const set = conflictOf.get(ids[i]);
            if (!set || !set.has(ids[j])) continue;
            out.push({
              className: cls.name,
              day,
              text: `${subjectMap.get(ids[i])?.name || "?"} + ${subjectMap.get(ids[j])?.name || "?"}`,
            });
          }
        }
      });
    });
    return out;
  }, [schedule, classes, sortedTimeslots, conflictOf, subjectMap]);

  // ——— YARIM TUSHGAN DARSLAR ———
  // Katakda guruhli darsning bir qismi yo'q (masalan 2-guruh ustozi).
  // Bu soat endi «joylashgan» deb sanalmaydi, lekin foydalanuvchi AYNAN
  // qaysi katak ekanini ko'rishi kerak — aks holda «tushmagan soat» qayerdan
  // chiqqani tushunarsiz bo'ladi.
  const partialCards = useMemo(
    () => (setSchedule ? findPartialCards(schedule) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedule, classes, classSubjects, sortedTimeslots, setSchedule],
  );

  // ——— USTOZ SOATI: REJA ↔ SETKA ———
  // «Sinf fanlari»da biriktirilgan soat bilan jadvalda HAQIQATAN turgan soat
  // bir xil bo'lishi kerak. Farq chiqsa — soat yo'qolgan (yarim karta,
  // qo'lda o'chirish, tushmagan blok) yoki ortiqcha dars qo'shilgan.
  // Ustoz bir vaqtda faqat bitta joyda bo'la oladi, shuning uchun setkadagi
  // soat = u band bo'lgan KATAKLAR soni (parallel dars, daraja guruhi va
  // parallel sinflar shu sababli o'z-o'zidan bir marta sanaladi).
  //
  // «Fan almashinuvi» ham shu ro'yxatga kiradi: reja soati endi ustoz
  // blokning nechta soatida turishini hisobga oladi
  // ([swapGroups.js](../utils/swapGroups.js)), ya'ni setkadagi katak soni
  // bilan mos tushadi. «Hafta almashinuvi» esa chetda qoladi — u yerda
  // juft/toq hafta navbatlashadi.
  const teacherHourRows = useMemo(() => {
    const skip = new Set();
    classes.forEach((cls) => (classSubjects?.[cls.id] || []).forEach((a) => {
      if (!a) return;
      if (a.weekAltEnabled) { [a.teacherId, a.weekAltTeacherId].forEach((t) => t && skip.add(t)); }
    }));
    const cells = new Map();   // teacherId → band kataklar soni
    DAYS.forEach((d) => sortedTimeslots.forEach((ts) => {
      if (!isTeachingSlot(ts)) return;
      const cell = schedule?.[d]?.[ts.id] || [];
      if (!cell.length) return;
      const here = new Set();
      cell.forEach((l) => { if (l.teacherId) here.add(l.teacherId); });
      here.forEach((tid) => cells.set(tid, (cells.get(tid) || 0) + 1));
    }));
    const rows = [];
    buildTeacherStreams(classes, classSubjects).forEach((info, tid) => {
      if (skip.has(tid)) return;
      const planned = Number(info.total || 0);
      const done = cells.get(tid) || 0;
      if (planned === done) return;
      rows.push({ id: tid, name: getName(teacherMap, tid), planned, done, diff: done - planned });
    });
    return rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, classes, classSubjects, teachers, sortedTimeslots]);

  function capacityWarnings(scheduleComplete = false) {
    // Avval ustoz sig'imi: bu "soat tushmadi"ning eng ko'p uchraydigan sababi
    const warns = [
      ...teacherCapacityWarnings(scheduleComplete),
      ...roomCapacityWarnings(scheduleComplete),
      ...supervisionCapacityWarnings(),
    ];
    // ——— BIR KUNGA TUSHMAYDIGAN FANLAR: kun yetadimi? ———
    // Algebra 4 kun + Geometriya 3 kun = 7 kun kerak, lekin haftada 6 kun —
    // bunda soat ALBATTA tushmaydi, sababini oldindan aytib qo'yamiz.
    if (conflictOf.size) {
      classes.forEach((cls) => {
        const ids = [...new Set((classSubjects?.[cls.id] || []).map((a) => a.subjectId).filter(Boolean))];
        const days = usableDaysOf(cls.id);
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const set = conflictOf.get(ids[i]);
            if (!set || !set.has(ids[j])) continue;
            const dA = Math.ceil(requiredHours(cls.id, ids[i]) / Math.max(1, subjectDayCap(cls.id, ids[i])));
            const dB = Math.ceil(requiredHours(cls.id, ids[j]) / Math.max(1, subjectDayCap(cls.id, ids[j])));
            if (dA + dB > days) {
              const nA = subjectMap.get(ids[i])?.name || "?";
              const nB = subjectMap.get(ids[j])?.name || "?";
              warns.push(`${cls.name}: ${nA} va ${nB} bir kunga tushmasligi kerak, lekin ular uchun kamida ${dA} + ${dB} = ${dA + dB} kun kerak — sinfda esa atigi ${days} ish kuni bor. ${dA + dB - days} kunlik soat tushmaydi: soatni kamaytiring, «2 soat blok»ni yoqing yoki sinfning dam kunini oling.`);
            }
          }
        }
      });
    }
    // Sinf sig'imi ham BASHORAT — jadval to'liq chiqqan bo'lsa, u rad etilgan.
    if (!scheduleComplete) {
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
    }
    // ——— 4 SOAT BLOK: kunda ketma-ket 4 soat bormi? ———
    // Blok hech qachon bo'linmaydi, shuning uchun sinf kunida 4 ta dars
    // bo'lmasa bu soatlar umuman tushmaydi — sababi ko'rinib tursin.
    classes.forEach((cls) => {
      const perDay = sortedTimeslots.filter((ts) => isTeachingSlot(ts) && slotAllowsClass(ts, cls.id)).length;
      (classSubjects?.[cls.id] || []).forEach((a) => {
        if (!a?.allowQuad) return;
        const sName = subjectMap.get(a.subjectId)?.name || "Fan";
        const h = Number(a.weeklyHours || 0);
        if (h < 4) {
          warns.push(`⚠️ ${cls.name} · ${sName}: «4 soat blok» yoqilgan, lekin haftalik soat ${h} ta — blok yig'ilmaydi. Soatni 4 yoki undan ko'p qiling.`);
          return;
        }
        if (perDay < 4) {
          warns.push(`⛔ ${cls.name} · ${sName}: «4 soat blok» uchun kunda ketma-ket 4 ta dars kerak, lekin sinfda kuniga ${perDay} ta dars bor. Bu soatlar tushmaydi.`);
        }
      });
    });
    // ——— «Kelajak soati» faqat DUSHANBA bo'ladi ———
    // Agar ustoz (yoki sinf) aynan dushanbada dam olsa, bu soat hech qanday
    // jadvalga tushmaydi. Sabab ko'rinmasa, foydalanuvchi generatsiyani
    // qayta-qayta bosib, vaqtini behuda sarflaydi.
    classes.forEach((cls) => {
      const clsOff = Array.isArray(cls.offDays) ? cls.offDays : [];
      (classSubjects?.[cls.id] || []).forEach((a) => {
        const subj = subjectMap.get(a.subjectId);
        if (!subj || !isFixedMondaySubject(subj)) return;
        if (Number(a.weeklyHours || 0) <= 0) return;
        if (clsOff.includes("Dushanba")) {
          warns.push(`⛔ ${cls.name} · ${subj.name}: bu fan faqat DUSHANBA, 1-darsda bo'ladi, lekin sinfning dam kuni — dushanba. Bu soat hech qachon tushmaydi.`);
          return;
        }
        const tIds = a.levelGroupEnabled && a.levelGroups?.length
          ? a.levelGroups.map((g) => g.teacherId)
          : [a.teacherId, a.splitEnabled ? a.teacherId2 : null];
        tIds.filter(Boolean).forEach((tid) => {
          const t = teacherMap.get(tid);
          if (!t || !Array.isArray(t.offDays) || !t.offDays.includes("Dushanba")) return;
          warns.push(`⛔ ${cls.name} · ${subj.name}: bu fan faqat DUSHANBA bo'ladi, lekin ${t.name} dushanbada dam oladi. Boshqa ustoz tanlang yoki ustozning dam kunini o'zgartiring.`);
        });
      });
    });
    // ——— GURUHLI DARSLARDAGI TAKRORLANISH ———
    // Guruhlar AYNI VAQTDA o'qiydi: bitta ustoz ham, bitta xona ham ikki
    // guruhga yeta olmaydi. Generator bunday darsni endi yo'qotmaydi
    // (takroriy xona olib tashlanadi, takroriy ustoz e'tiborsiz qoladi),
    // lekin ma'lumotni to'g'rilash baribir kerak.
    classes.forEach((cls) => {
      (classSubjects?.[cls.id] || []).forEach((a) => {
        const sName = subjectMap.get(a.subjectId)?.name || "Fan";
        if (a.levelGroupEnabled && Array.isArray(a.levelGroups)) {
          const tSeen = new Set();
          const rSeen = new Set();
          a.levelGroups.forEach((g) => {
            if (g?.teacherId && tSeen.has(g.teacherId)) {
              warns.push(`⚠️ ${cls.name} · ${sName}: «${g.name || "daraja"}» guruhiga oldingi daraja bilan BIR XIL ustoz (${getName(teacherMap, g.teacherId)}) qo'yilgan — bu daraja hisobga olinmaydi.`);
            } else if (g?.teacherId) tSeen.add(g.teacherId);
            if (g?.roomId && rSeen.has(g.roomId)) {
              warns.push(`⚠️ ${cls.name} · ${sName}: «${g.name || "daraja"}» guruhiga oldingi daraja bilan BIR XIL xona (${getName(roomMap, g.roomId)}) qo'yilgan — bu guruh xonasiz joylanadi.`);
            } else if (g?.roomId) rSeen.add(g.roomId);
          });
        }
        if (a.splitEnabled && a.teacherId2 && a.teacherId2 === a.teacherId) {
          warns.push(`⚠️ ${cls.name} · ${sName}: 1- va 2-guruhga bir xil ustoz (${getName(teacherMap, a.teacherId)}) qo'yilgan — dars bo'linmagan (butun sinf) deb joylanadi.`);
        }
        if (a.splitEnabled && a.roomId && a.roomId2 && a.roomId === a.roomId2) {
          warns.push(`⚠️ ${cls.name} · ${sName}: ikkala guruhga bir xil xona (${getName(roomMap, a.roomId)}) qo'yilgan — 2-guruh xonasiz joylanadi.`);
        }
        if (a.pairEnabled) {
          // Guruhlar AYNI SOATDA o'qiydi: ustoz ham, xona ham takrorlanmasin
          const tSeen = new Map();
          const rSeen = new Map();
          if (a.teacherId) tSeen.set(a.teacherId, a.groupName1 || "1-guruh");
          if (a.roomId) rSeen.set(a.roomId, a.groupName1 || "1-guruh");
          pairSideGroups(a).forEach((g) => {
            if (g.teacherId) {
              if (tSeen.has(g.teacherId)) {
                warns.push(`⛔ ${cls.name} · ${sName}: «bir vaqtda bir nechta fan»da ${getName(teacherMap, g.teacherId)} ikki guruhga (${tSeen.get(g.teacherId)} va ${g.name}) qo'yilgan — bunday dars joylashmaydi.`);
              } else tSeen.set(g.teacherId, g.name);
            }
            if (g.roomId) {
              if (rSeen.has(g.roomId)) {
                warns.push(`⚠️ ${cls.name} · ${sName}: ${getName(roomMap, g.roomId)} xonasi ikki guruhga (${rSeen.get(g.roomId)} va ${g.name}) qo'yilgan — ${g.name} xonasiz joylanadi.`);
              } else rSeen.set(g.roomId, g.name);
            }
            if (!g.teacherId) {
              warns.push(`⛔ ${cls.name} · ${sName}: «${g.name}» uchun ustoz tanlanmagan — bu guruh jadvalga tushmaydi.`);
            }
          });
        }
      });
    });
    return warns;
  }

  // ═══════════ TUSHMAGAN SOAT UCHUN YECHIM REJASI ═══════════
  // Uch bosqichli qidiruv:
  //   1) mutlaqo bo'sh katak (sinf ham, ustoz ham bo'sh)
  //   2) sinf bo'sh, lekin ustoz boshqa sinfda band → o'sha darsni boshqa soatga surish
  //   3) sinfda dars bor → o'sha darsni boshqa soatga surib, joy bo'shatish
  // 2 va 3-bosqichda boshqa dars ko'chiriladi, shuning uchun foydalanuvchidan
  // ALBATTA tasdiq so'raladi (modal oynada nima ko'chishi aniq yozib beriladi).
  // Ustoz setkasida qulflangan kataklar barcha bosqichlarda chetlab o'tiladi.

  function slotNumOf(slotId) {
    return slotDisplayNumber(sortedTimeslots.find((s) => s.id === slotId)) ?? "?";
  }

  function lessonTitle(l) {
    const sName = subjectMap.get(l.subjectId)?.name || "Fan";
    const cNames = classIdsOf(l).map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
    const tName = l.teacherId ? getName(teacherMap, l.teacherId, "") : "";
    return `${cNames || "Sinf"} — ${sName}${tName ? ` (${tName})` : ""}`;
  }

  // Ko'chirish mumkin bo'lgan dars: qulflanmagan, qo'lda qo'yilmagan, guruhli emas,
  // parallel emas, hafta almashinuvi emas va 2 soat blokning bo'lagi emas.
  function isMovableLesson(l) {
    return Boolean(l) && !l.locked && !l.manual && !l.groupPart && !l.groupKey
      && !l.levelGroupEnabled && !l.swap && !l.alternating && !isBlockPart(l)
      && classIdsOf(l).length === 1;
  }

  // Parallel hamrohlari (10-A uchun 10-B, 10-V) shu kuni shu fanni olayaptimi?
  function parMatchOn(work, classId, subjectId, day) {
    if (!parOn || !subjectId) return false;
    const mates = parMates.get(classId);
    if (!mates || !mates.length) return false;
    return sortedTimeslots.some((ts) => (work?.[day]?.[ts.id] || []).some(
      (l) => l.subjectId === subjectId && classIdsOf(l).some((cid) => mates.includes(cid)),
    ));
  }

  // Sinfning shu kundagi darslari ketma-ketmi? Yangi dars kun oxiriga qo'yilsa
  // oyna paydo bo'lmaydi — shuning uchun bo'sh kataklar shunga qarab tanlanadi.
  function dayLoadOf(work, classId, day) {
    return sortedTimeslots.reduce((n, ts) => (
      isTeachingSlot(ts) && (work?.[day]?.[ts.id] || []).some((l) => classIdsOf(l).includes(classId)) ? n + 1 : n
    ), 0);
  }

  // Kunlar kam yuklanganidan boshlab tartiblanadi — yangi soatlar bir kunga
  // to'planib qolmasin.
  //
  // ⚠️ `subjectId` berilsa parallel sinfdagi moslik faqat TENG YUKLI kunlar
  // orasida hal qiladi. Ilgari mos kun 1.5 dars "yengilroq" sanalardi va
  // shu sababli yangi dars TO'LAROQ kunga tushib, oyna ochilardi. Kun yuki
  // — oynasizlikning kafolati, moslik esa undan past turadi.
  function daysByLoad(work, classId, subjectId = "") {
    const keyed = DAYS.map((day) => ({
      day,
      load: dayLoadOf(work, classId, day),
      par: parMatchOn(work, classId, subjectId, day) ? 0 : 1,
    }));
    keyed.sort((a, b) => (a.load - b.load) || (a.par - b.par));
    return keyed.map((x) => x.day);
  }

  function planResolutions(classId, subjectId, count) {
    const teachingSlots = sortedTimeslots.filter(isTeachingSlot);
    const work = {};
    DAYS.forEach((d) => {
      work[d] = {};
      sortedTimeslots.forEach((ts) => { work[d][ts.id] = [...((schedule?.[d]?.[ts.id]) || [])]; });
    });

    const cls = classes.find((c) => c.id === classId);
    const classOff = new Set(Array.isArray(cls?.offDays) ? cls.offDays : []);

    // ⚠️ Bu yo'l ilgari HAR DOIM bitta yozuv qo'yardi — «2 guruhga bo'lish»
    // yoqilgan fanda 2-guruh ustozi yo'qolib, katak YARIM tushardi (soat esa
    // to'liq sanalardi). Endi karta sozlamadagi hamma guruhi bilan rejaga
    // kiradi: joy HAR BIR guruh ustozi bo'sh bo'lgandagina tanlanadi.
    // «Bir vaqtda bir nechta fan» va «fan almashinuvi» bu yerda ham
    // chetlab o'tiladi (soat hisobi boshqacha).
    const plan = cardPlan(classId, subjectId);
    if (plan.row?.pairEnabled || plan.row?.swapEnabled) return { placements: [], moves: [] };
    const groups = (plan.groups || []).filter((g) => g.teacherId);
    const okSubjT = new Set(teachersForSubject(subjectId).map((t) => t.id));
    if (!groups.length || groups.some((g) => !okSubjT.has(g.teacherId) || !teacherMap.get(g.teacherId))) {
      return { placements: [], moves: [] };
    }
    const gTeacherIds = groups.map((g) => g.teacherId);
    const teacherId = gTeacherIds[0];
    const tOff = new Set(gTeacherIds.flatMap((id) => {
      const t = teacherMap.get(id);
      return Array.isArray(t?.offDays) ? t.offDays : [];
    }));
    const lgi = plan.kind === "level" ? levelGroupInfo(classId, subjectId) : null;
    const targetClassIds = lgi?.classIds?.length ? lgi.classIds : [classId];
    const cap = subjectDayCap(classId, subjectId);

    const slotUsable = (cid, day, ts) => isTeachingSlot(ts)
      && slotAllowsClass(ts, cid)
      && !classHasLunchAt(ts, cid, lunchGroups, day);
    const classFree = (cid, day, tsId) => !(work[day][tsId] || []).some((l) => classIdsOf(l).includes(cid));
    const teacherFree = (tid, day, tsId) => !tid
      || !(work[day][tsId] || []).some((l) => l.teacherId === tid || l.altTeacherId === tid);
    const roomFree = (rid, day, tsId) => !rid || !(work[day][tsId] || []).some((l) => l.roomId === rid);
    const subjOnDay = (cid, sid, day) => teachingSlots.reduce((n, ts) => (
      (work[day][ts.id] || []).some((l) => l.subjectId === sid && classIdsOf(l).includes(cid)) ? n + 1 : n
    ), 0);
    const teacherLoad = (tid) => DAYS.reduce((n, day) => n + teachingSlots.reduce((m, ts) => (
      (work[day][ts.id] || []).some((l) => l.teacherId === tid) ? m + 1 : m
    ), 0), 0);

    // Ko'chirilayotgan dars uchun yangi joy
    const homeFor = (l, exDay, exTsId) => {
      const cid = classIdsOf(l)[0];
      const c2 = classes.find((c) => c.id === cid);
      const off2 = new Set(Array.isArray(c2?.offDays) ? c2.offDays : []);
      const t2 = teacherMap.get(l.teacherId);
      const tOff2 = new Set(Array.isArray(t2?.offDays) ? t2.offDays : []);
      const cap2 = subjectDayCap(cid, l.subjectId);
      for (const day of daysByLoad(work, cid, l.subjectId)) {
        if (off2.has(day) || tOff2.has(day)) continue;
        if (subjOnDay(cid, l.subjectId, day) >= cap2) continue;
        if (dayHasConflict(work, cid, l.subjectId, day, new Set([l]))) continue;
        for (const ts of teachingSlots) {
          if (day === exDay && ts.id === exTsId) continue;
          if (!slotUsable(cid, day, ts)) continue;
          if (!classFree(cid, day, ts.id)) continue;
          if (!teacherFree(l.teacherId, day, ts.id)) continue;
          if (l.teacherId && teacherBlockedAt(l.teacherId, day, ts.id)) continue;
          if (!roomFree(l.roomId, day, ts.id)) continue;
          return { day, tsId: ts.id };
        }
      }
      return null;
    };

    const placements = [];
    const moves = [];

    // Kartaning HAMMA guruhi bitta katakka tushadi. Xona takrorlanmasin:
    // guruhlar ayni soatda o'qiydi, bitta xona ikkinchisiga yetmaydi.
    const buildEntries = (day, tsId) => {
      const seenR = new Set((work[day][tsId] || []).map((l) => l.roomId).filter(Boolean));
      return groups.map((g) => {
        const roomFreeNow = Boolean(g.roomId) && !seenR.has(g.roomId);
        if (roomFreeNow) seenR.add(g.roomId);
        const e = {
          subjectId, classId: targetClassIds[0], classIds: [...targetClassIds],
          teacherId: g.teacherId, roomId: roomFreeNow ? g.roomId : "",
          manual: true, locked: true,
        };
        if (groups.length > 1) e.groupPart = g.name || "";
        if (plan.kind === "split") e.splitEnabled = true;
        if (plan.kind === "level") {
          e.levelGroupEnabled = true;
          const key = String(plan.row?.levelGroupKey || "").trim();
          if (key) e.groupKey = key;
        }
        return e;
      });
    };
    const doPlace = (day, tsId) => {
      const entries = buildEntries(day, tsId);
      work[day][tsId] = [...(work[day][tsId] || []), ...entries];
      placements.push({ day, slotId: tsId, teacherId, teacherIds: [...gTeacherIds], entries });
    };
    const doMove = (l, fromDay, fromTsId, to) => {
      work[fromDay][fromTsId] = work[fromDay][fromTsId].filter((x) => x !== l);
      work[to.day][to.tsId] = [...(work[to.day][to.tsId] || []), l];
      moves.push({ lesson: l, fromDay, fromSlotId: fromTsId, toDay: to.day, toSlotId: to.tsId, label: lessonTitle(l) });
    };

    // Karta bo'ylab tekshiruvlar: guruhlar ayni soatda o'qiydi, shuning
    // uchun HAR BIR guruh ustozi (va xonasi) bo'sh bo'lishi shart.
    const groupsFree = (day, tsId) => gTeacherIds.every((id) => teacherFree(id, day, tsId))
      && groups.every((g) => roomFree(g.roomId, day, tsId));
    const groupsBlocked = (day, tsId) => gTeacherIds.some((id) => teacherBlockedAt(id, day, tsId));
    const groupsBusyHere = (day, tsId) => (work[day][tsId] || []).filter(
      (l) => gTeacherIds.some((id) => l.teacherId === id || l.altTeacherId === id)
    );
    const loadFull = () => gTeacherIds.some((id) => (
      teacherLoad(id) + 1 > Number(teacherMap.get(id)?.maxWeeklyHours || 40)
    ));

    for (let n = 0; n < count; n++) {
      if (loadFull()) break;
      let done = false;

      // 1-bosqich — hech kimni bezovta qilmasdan
      for (const day of daysByLoad(work, classId, subjectId)) {
        if (done) break;
        if (classOff.has(day) || tOff.has(day)) continue;
        if (subjOnDay(classId, subjectId, day) >= cap) continue;
        if (dayHasConflict(work, classId, subjectId, day)) continue;
        for (const ts of teachingSlots) {
          if (!slotUsable(classId, day, ts)) continue;
          if (!classFree(classId, day, ts.id)) continue;
          if (!groupsFree(day, ts.id)) continue;
          if (groupsBlocked(day, ts.id)) continue;
          doPlace(day, ts.id);
          done = true;
          break;
        }
      }
      if (done) continue;

      // 2-bosqich — ustoz o'sha soatda boshqa sinfda band: o'sha darsni surish
      for (const day of daysByLoad(work, classId, subjectId)) {
        if (done) break;
        if (classOff.has(day) || tOff.has(day)) continue;
        if (subjOnDay(classId, subjectId, day) >= cap) continue;
        if (dayHasConflict(work, classId, subjectId, day)) continue;
        for (const ts of teachingSlots) {
          if (!slotUsable(classId, day, ts)) continue;
          if (!classFree(classId, day, ts.id)) continue;
          if (groupsBlocked(day, ts.id)) continue;
          if (!groups.every((g) => roomFree(g.roomId, day, ts.id))) continue;
          const busy = groupsBusyHere(day, ts.id);
          if (busy.length !== 1 || !isMovableLesson(busy[0])) continue;
          const home = homeFor(busy[0], day, ts.id);
          if (!home) continue;
          doMove(busy[0], day, ts.id, home);
          doPlace(day, ts.id);
          done = true;
          break;
        }
      }
      if (done) continue;

      // 3-bosqich — sinfda dars bor: uni boshqa soatga surib joy ochish
      for (const day of daysByLoad(work, classId, subjectId)) {
        if (done) break;
        if (classOff.has(day) || tOff.has(day)) continue;
        if (subjOnDay(classId, subjectId, day) >= cap) continue;
        if (dayHasConflict(work, classId, subjectId, day)) continue;
        for (const ts of teachingSlots) {
          if (!slotUsable(classId, day, ts)) continue;
          if (!groupsFree(day, ts.id)) continue;
          if (groupsBlocked(day, ts.id)) continue;
          const here = (work[day][ts.id] || []).filter((l) => classIdsOf(l).includes(classId));
          if (here.length !== 1 || !isMovableLesson(here[0])) continue;
          const home = homeFor(here[0], day, ts.id);
          if (!home) continue;
          doMove(here[0], day, ts.id, home);
          doPlace(day, ts.id);
          done = true;
          break;
        }
      }
      if (!done) break;
    }

    return { placements, moves };
  }

  function proposeResolution(classId, subjectId, name, missing) {
    const { placements, moves } = planResolutions(classId, subjectId, missing);
    if (!placements.length) {
      toast?.("Bo'sh soat ham, ko'chirish yo'li ham topilmadi — bu fanga yana ustoz qo'shing yoki soatni kamaytiring", "warning");
      return;
    }
    setResolveData({ classId, subjectId, name, placements, moves });
  }

  function applyResolution() {
    if (!setSchedule || !resolveData) return;
    const { classId, subjectId, placements, moves } = resolveData;
    const next = {};
    DAYS.forEach((d) => {
      next[d] = {};
      sortedTimeslots.forEach((ts) => { next[d][ts.id] = [...((schedule?.[d]?.[ts.id]) || [])]; });
    });

    // 1) Avval kelishilgan ko'chirishlar
    (moves || []).forEach((m) => {
      const from = next[m.fromDay]?.[m.fromSlotId];
      if (!Array.isArray(from)) return;
      if (!from.includes(m.lesson)) return; // jadval o'zgargan — bu ko'chirish o'tkazib yuboriladi
      next[m.fromDay][m.fromSlotId] = from.filter((x) => x !== m.lesson);
      next[m.toDay][m.toSlotId] = [...(next[m.toDay][m.toSlotId] || []), m.lesson];
    });

    // 2) Keyin yangi darslar. Guruhli fanda karta HAMMA guruhi bilan
    //    tushadi (`entries`) — yarim karta yaratilmaydi. Xona ko'chirishlardan
    //    keyin band bo'lib qolgan bo'lishi mumkin, shuning uchun qayta
    //    tekshiriladi: bandi olib tashlanadi, dars xonasiz joylanadi.
    placements.forEach(({ day, slotId, teacherId, entries }) => {
      const cell = next[day][slotId] || [];
      const items = (entries?.length ? entries : [{
        subjectId, classId, classIds: [classId], teacherId: teacherId || "", roomId: "",
        manual: true, locked: true,
      }]).map((e) => (
        e.roomId && cell.some((l) => l.roomId === e.roomId) ? { ...e, roomId: "" } : { ...e }
      ));
      next[day][slotId] = [...cell, ...items];
    });

    setSchedule(next);
    setResolveData(null);
    const moveNote = moves?.length ? ` · ${moves.length} ta dars ko'chirildi` : "";
    toast?.(`${placements.length} ta dars joylashtirildi va qulflandi 🔒${moveNote}`, "success");
  }

  function fillRemaining(base, markManual = true) {
    const teachingSlots = sortedTimeslots.filter(isTeachingSlot);
    const next = {};
    DAYS.forEach((d) => {
      next[d] = {};
      sortedTimeslots.forEach((ts) => { next[d][ts.id] = [...((base?.[d]?.[ts.id]) || [])]; });
    });
    const tLoad = {};
    const recountLoad = () => {
      Object.keys(tLoad).forEach((k) => { delete tLoad[k]; });
      DAYS.forEach((d) => teachingSlots.forEach((ts) => next[d][ts.id].forEach((l) => { if (l.teacherId) tLoad[l.teacherId] = (tLoad[l.teacherId] || 0) + 1; })));
    };
    recountLoad();

    // Soat sanog'i TO'LIQ kartalar bo'yicha: guruh yozuvi yetishmayotgan
    // katak «joylashgan» hisoblanmaydi (quyidagi to'g'rilash bosqichi uni
    // yo yopadi, yo butun kartani boshqa soatga ko'chiradi).
    const countCS = (cid, sid) => {
      let n = 0;
      DAYS.forEach((d) => teachingSlots.forEach((ts) => {
        if (cellHasFullSubject(next[d][ts.id], cid, sid)) n += 1;
      }));
      return n;
    };
    // Bir kunda shu fan nechta? (kunlik limit uchun)
    const subjOnDay = (cid, sid, day) => teachingSlots.reduce((n, ts) => (
      next[day][ts.id].some((l) => l.subjectId === sid && classIdsOf(l).includes(cid)) ? n + 1 : n
    ), 0);

    // ═══════════ DARS SHABLONI ═══════════
    // ⚠️ Ilgari bu funksiya darsni «shundoq» qo'yardi:
    //     { subjectId, classId, teacherId, roomId: "" }
    // Natijada 2 guruhga bo'lingan fan yolg'iz, XONASIZ va BLOKSIZ tushib,
    // ekranda «Ingliz tili — 1-guruh ustozi • Xonasiz» bo'lib qolardi
    // (2-guruh ustozi butunlay yo'qolardi). Endi dars sinf fanidagi
    // sozlama qanday bo'lsa shunday tug'iladi: har guruhning O'Z ustozi
    // va xonasi, parallel sinflar va blok uzunligi bilan.
    //
    // Qaytadi: { a, sid, classIds, parts[], plain?, noBlock? }
    //   `parts` — BITTA katakka tushadigan yozuvlar (guruhlar ayni soatda).
    const dedupeRooms = (parts) => {
      // Guruhlar bir vaqtda o'qiydi — bitta xona ikki guruhga yetmaydi.
      // Takroriysi xonasiz qoladi (generatordagi `dedupeRooms` bilan bir xil).
      const seen = new Set();
      parts.forEach((p) => {
        if (!p.roomId || seen.has(p.roomId)) p.roomId = "";
        else seen.add(p.roomId);
      });
      return parts;
    };
    const fillTemplate = (cls, sid) => {
      const a = (classSubjects?.[cls.id] || []).find((x) => x.subjectId === sid);
      if (!a) return null;
      // Bu ikkisiga TEGILMAYDI: «bir vaqtda bir nechta fan»da sinf guruhlarga
      // bo'lingan, «fan almashinuvi»da esa soat hisobi boshqacha — yolg'iz
      // dars qo'yish jadvalni buzadi. Ular «tushmadi» ro'yxatida qoladi.
      if (a.pairEnabled || a.swapEnabled) return null;

      // 1) DARAJA GURUHLARI — har guruh o'z ustozi bilan, ayni soatda
      if (a.levelGroupEnabled) {
        const info = levelGroupInfo(cls.id, sid);
        const seenT = new Set();
        const parts = [];
        (info?.groups || []).forEach((g, i) => {
          if (!g?.teacherId || seenT.has(g.teacherId)) return;
          seenT.add(g.teacherId);
          parts.push({
            teacherId: g.teacherId, roomId: g.roomId || "",
            groupPart: g.name || `${i + 1}-guruh`,
            levelGroupEnabled: true, groupKey: String(a.levelGroupKey || "").trim(),
          });
        });
        if (!parts.length) return null;
        return { a, sid, classIds: [...(info?.classIds || [cls.id])], parts: dedupeRooms(parts) };
      }

      // 2) 2 GURUHGA BO'LISH — ikki ustoz, ikki xona, BITTA katakda
      if (a.splitEnabled && a.teacherId2 && a.teacherId2 !== a.teacherId) {
        return {
          a, sid, classIds: [cls.id],
          parts: dedupeRooms([
            { teacherId: a.teacherId, roomId: a.roomId || "", groupPart: a.groupName1 || "1-guruh", splitEnabled: true },
            { teacherId: a.teacherId2, roomId: a.roomId2 || "", groupPart: a.groupName2 || "2-guruh", splitEnabled: true },
          ]),
        };
      }

      // 3) HAFTA ALMASHINUVI (juft/toq) — bitta yozuv, ichida ikkinchi fan.
      //    Blok qilinmaydi: almashinuv haftalik, bloklash ma'nosiz.
      if (a.weekAltEnabled && a.weekAltSubjectId && a.weekAltTeacherId) {
        if (!a.teacherId) return null;
        return {
          a, sid, classIds: [cls.id], noBlock: true,
          parts: [{
            teacherId: a.teacherId, roomId: a.roomId || "",
            alternating: true, altSubjectId: a.weekAltSubjectId,
            altTeacherId: a.weekAltTeacherId, altRoomId: a.weekAltRoomId || "",
          }],
        };
      }

      if (!a.teacherId) return null;

      // 4) PARALLEL DARS — guruhdagi sinflar BITTA darsni baham ko'radi.
      //    `groupKey` yozilishi SHART: ustoz soati aks holda har sinfda
      //    qayta sanaladi (CLAUDE.md — «USTOZ SOATI KARTADA BIR MARTA»).
      const gk = String(a.groupKey || "").trim();
      if (gk) {
        const mates = classes.filter((c) => {
          const aa = (classSubjects?.[c.id] || []).find((x) => x.subjectId === sid);
          return aa && String(aa.groupKey || "").trim() === gk
            && aa.teacherId === a.teacherId && (aa.roomId || "") === (a.roomId || "");
        }).map((c) => c.id);
        return {
          a, sid, classIds: mates.length ? mates : [cls.id],
          parts: [{ teacherId: a.teacherId, roomId: a.roomId || "", groupKey: gk }],
        };
      }

      // 5) ODDIY DARS — endi XONASI bilan
      return { a, sid, classIds: [cls.id], plain: true, parts: [{ teacherId: a.teacherId, roomId: a.roomId || "" }] };
    };

    // Blok bo'laklarini bog'lash mumkinmi. Ikki dars ketma-ket bo'lsa —
    // ha; orada obed/tanaffus bo'lsa ham ha (generatordagi `blockLink`
    // bilan bir xil qoida). Lekin uzilish 60 daqiqadan uzun bo'lsa —
    // YO'Q: smena almashinuvidagi katta tanaffus blokni ikkiga cho'zib
    // yuborardi.
    const toMin = (v) => {
      const [h, m] = String(v || "").split(":");
      const n = Number(h) * 60 + Number(m);
      return Number.isFinite(n) ? n : NaN;
    };
    const blockLinkOk = (prev, cur) => {
      if (Number(cur.lessonNumber) === Number(prev.lessonNumber) + 1) return true;
      const gap = toMin(cur.startTime) - toMin(prev.endTime);
      return Number.isFinite(gap) && gap >= 0 && gap <= 60;
    };

    // Shablon uchun joy: blok bo'lsa KETMA-KET kataklar, guruhli bo'lsa
    // HAR BIR ustoz va HAR BIR xona bo'sh bo'lishi shart.
    const spotFor = (tpl, size) => {
      const { sid } = tpl;
      const ksFix = isFixedMondaySubjectId(sid);
      if (ksFix && size > 1) return null;
      const cids = tpl.classIds;
      if (!cids.length) return null;
      const allT = [...new Set(tpl.parts.flatMap((p) => [p.teacherId, p.altTeacherId]).filter(Boolean))];
      const rids = [...new Set(tpl.parts.flatMap((p) => [p.roomId, p.altRoomId]).filter(Boolean))];
      const offOf = new Map();
      for (const id of allT) {
        const tt = teacherMap.get(id);
        if (!tt) return null;
        if ((tLoad[id] || 0) + size > Number(tt.maxWeeklyHours || 40)) return null;
        offOf.set(id, new Set(Array.isArray(tt.offDays) ? tt.offDays : []));
      }
      const classOffs = cids.map((cid) => new Set(classes.find((c) => c.id === cid)?.offDays || []));

      for (const day of daysByLoad(next, cids[0], sid)) {
        if (ksFix && day !== "Dushanba") continue;
        if (classOffs.some((s) => s.has(day))) continue;
        if (allT.some((id) => offOf.get(id).has(day))) continue;
        // Kunlik fan limiti — blok butunligicha sig'ishi kerak
        if (cids.some((cid) => subjOnDay(cid, sid, day) + size > subjectDayCap(cid, sid))) continue;
        if (cids.some((cid) => dayHasConflict(next, cid, sid, day))) continue;
        for (let i = 0; i + size <= teachingSlots.length; i++) {
          let ok = true;
          for (let o = 0; o < size && ok; o++) {
            const ts = teachingSlots[i + o];
            if (o > 0 && !blockLinkOk(teachingSlots[i + o - 1], ts)) { ok = false; break; }
            if (ksFix && ts.id !== firstSlotIdOf(cids[0], day)) { ok = false; break; }
            const cell = next[day][ts.id];
            for (const cid of cids) {
              if (!slotAllowsClass(ts, cid)
                || classesHaveLunchAt(ts, [cid], lunchGroups, day)
                || cell.some((l) => classIdsOf(l).includes(cid))) { ok = false; break; }
            }
            if (!ok) break;
            for (const id of allT) {
              if (teacherBlockedAt(id, day, ts.id)
                || cell.some((l) => l.teacherId === id || l.altTeacherId === id)) { ok = false; break; }
            }
            if (!ok) break;
            for (const rid of rids) {
              if (cell.some((l) => l.roomId === rid || l.altRoomId === rid)) { ok = false; break; }
            }
          }
          if (ok) return { day, slotIds: Array.from({ length: size }, (_, o) => teachingSlots[i + o].id) };
        }
      }
      return null;
    };

    // Shablonni jadvalga yozish. Blok bo'lsa `blockSize`/`blockIndex`
    // qo'yiladi — busiz zichlash uni ikkiga bo'lib yuborardi.
    const placeTemplate = (tpl, spot, size) => {
      spot.slotIds.forEach((slotId, o) => {
        tpl.parts.forEach((p) => {
          const lesson = {
            subjectId: tpl.sid, classId: tpl.classIds[0], classIds: [...tpl.classIds],
            teacherId: p.teacherId, roomId: p.roomId || "", manual: markManual,
          };
          if (p.groupPart) lesson.groupPart = p.groupPart;
          if (p.splitEnabled) lesson.splitEnabled = true;
          if (p.levelGroupEnabled) lesson.levelGroupEnabled = true;
          if (p.groupKey) lesson.groupKey = p.groupKey;
          if (p.alternating) {
            lesson.alternating = true;
            lesson.altSubjectId = p.altSubjectId;
            lesson.altTeacherId = p.altTeacherId;
            lesson.altRoomId = p.altRoomId || "";
          }
          if (size > 1) { lesson.blockSize = size; lesson.blockIndex = o; }
          next[spot.day][slotId].push(lesson);
        });
      });
      // Ustoz yuklamasi: kartada har ustoz BIR MARTA sanaladi
      const counted = new Set();
      tpl.parts.forEach((p) => {
        if (!p.teacherId || counted.has(p.teacherId)) return;
        counted.add(p.teacherId);
        tLoad[p.teacherId] = (tLoad[p.teacherId] || 0) + size;
      });
    };

    // Qulflangan, qo'lda qo'yilgan, guruhli va BLOK darslar HECH QACHON ko'chirilmaydi
    const isMovable = (l) => l && !l.locked && !l.manual && !l.groupPart && !l.groupKey
      && !l.levelGroupEnabled && !l.swap && !l.alternating && !isBlockPart(l)
      && !l.fixedMonday && !isFixedMondaySubjectId(l.subjectId)
      && classIdsOf(l).length === 1;
    const teacherOffHas = (tid, day) => {
      const tt = teachers.find((x) => x.id === tid);
      return tt && Array.isArray(tt.offDays) && tt.offDays.includes(day);
    };
    const findHomeForLesson = (l, exDay, exTs) => {
      if (l?.fixedMonday || isFixedMondaySubjectId(l?.subjectId)) return null;
      const cid = classIdsOf(l)[0];
      const cObj = classes.find((c) => c.id === cid);
      const classOff2 = new Set(Array.isArray(cObj?.offDays) ? cObj.offDays : []);
      const cap2 = subjectDayCap(cid, l.subjectId);
      for (const day of daysByLoad(next, cid, l.subjectId)) {
        if (classOff2.has(day)) continue;
        if (l.teacherId && teacherOffHas(l.teacherId, day)) continue;
        if (subjOnDay(cid, l.subjectId, day) >= cap2) continue;
        if (dayHasConflict(next, cid, l.subjectId, day, new Set([l]))) continue;
        for (const ts of teachingSlots) {
          if (day === exDay && ts.id === exTs) continue;
          if (!slotAllowsClass(ts, cid)) continue;
          if (classesHaveLunchAt(ts, [cid], lunchGroups, day)) continue;
          if (l.teacherId && teacherBlockedAt(l.teacherId, day, ts.id)) continue;
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
      const cap2 = subjectDayCap(cid, l.subjectId);
      for (const day of daysByLoad(next, cid, l.subjectId)) {
        if (classOff2.has(day)) continue;
        if (l.teacherId && teacherOffHas(l.teacherId, day)) continue;
        if (subjOnDay(cid, l.subjectId, day) >= cap2) continue;
        if (dayHasConflict(next, cid, l.subjectId, day, new Set([l]))) continue;
        for (const ts of teachingSlots) {
          if (day === exDay && ts.id === exTs) continue;
          if (!slotAllowsClass(ts, cid)) continue;
          if (classesHaveLunchAt(ts, [cid], lunchGroups, day)) continue;
          if (l.teacherId && teacherBlockedAt(l.teacherId, day, ts.id)) continue;
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
    const rearrangePlace = (cid, sid, t, classOff) => {
      if ((tLoad[t.id] || 0) + 1 > Number(t.maxWeeklyHours || 40)) return null;
      const tOff = new Set(Array.isArray(t.offDays) ? t.offDays : []);
      const cap = subjectDayCap(cid, sid);
      for (const day of daysByLoad(next, cid, sid)) {
        if (classOff.has(day) || tOff.has(day)) continue;
        if (subjOnDay(cid, sid, day) >= cap) continue;
        if (dayHasConflict(next, cid, sid, day)) continue;
        for (const ts of teachingSlots) {
          if (!slotAllowsClass(ts, cid)) continue;
          if (classesHaveLunchAt(ts, [cid], lunchGroups, day)) continue;
          if (teacherBlockedAt(t.id, day, ts.id)) continue;
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

    // ═══════════ 0-BOSQICH: YARIM KARTALARNI TO'G'RILASH ═══════════
    // Guruh yozuvi yetishmayotgan karta — sinfning bir guruhi USTOZSIZ
    // qolgani demakdir (3-V · Ingliz tili: katakda faqat 1-guruh turgan,
    // 2-guruh ustozi yo'q). Uch qadam:
    //   1) JOYIDA to'ldirish — yetishmagan guruh ustozi shu soatda bo'sh bo'lsa;
    //   2) butun kartani (blok bo'laklari bilan birga) BOSHQA soatga ko'chirish;
    //      yangi joy TOPILGANDAN keyingina eskisi bo'shatiladi — soat yo'qolmaydi;
    //   3) iloji bo'lmasa — TEGILMAYDI: dars o'chirilmaydi, lekin soat
    //      «tushmadi» bo'lib sanaladi va ekranda ro'yxatga chiqadi.
    // «Bir vaqtda bir nechta fan» kartasi faqat 1-qadamda qatnashadi —
    // u bir nechta sinfni bog'laydi, ko'chirish guruhdoshlarni qo'zg'atardi.
    let repaired = 0;
    let moved = 0;
    let stuck = 0;
    // To'g'rilab bo'lmagan yarim karta katakni BAND qilib turibdi. Uning
    // fanini quyidagi to'ldirgich ham chetlab o'tadi — aks holda o'sha soat
    // IKKINCHI marta, boshqa katakka qo'yilib, sinfda ortiqcha dars paydo
    // bo'lardi. Dars o'chirilmaydi: qaysi birini yo'qotishni foydalanuvchi
    // o'zi hal qiladi (kartadagi ✕ tugmasi butun kartani oladi).
    const stuckKeys = new Set();

    const repairInPlace = (pc) => {
      const cell = next[pc.day][pc.slotId];
      const base = pc.parts[0];
      const pgKey = String(pc.plan.row?.pairGroupKey || "").trim();
      const adds = [];
      for (const g of pc.gaps) {
        const t = teacherMap.get(g.teacherId);
        if (!t) return false;
        if (Array.isArray(t.offDays) && t.offDays.includes(pc.day)) return false;
        if (teacherBlockedAt(g.teacherId, pc.day, pc.slotId)) return false;
        if (cell.some((l) => l.teacherId === g.teacherId || l.altTeacherId === g.teacherId)) return false;
        if (adds.some((x) => x.teacherId === g.teacherId)) return false;
        // Parallel sinflardagi UMUMIY guruhni bu yerda tiklab bo'lmaydi —
        // uning yozuvi guruhdagi barcha sinfga tegishli.
        if (pc.plan.kind === "pair" && g.shared && pgKey) return false;
        // Guruhlar ayni soatda o'qiydi: band xona ikkinchi guruhga yetmaydi
        const roomFree = Boolean(g.roomId)
          && !cell.some((l) => l.roomId === g.roomId || l.altRoomId === g.roomId)
          && !adds.some((x) => x.roomId === g.roomId);
        const e = {
          subjectId: g.subjectId || base.subjectId,
          classId: base.classId || pc.classId,
          classIds: [...classIdsOf(base)],
          teacherId: g.teacherId,
          roomId: roomFree ? g.roomId : "",
          groupPart: g.name || "",
          manual: Boolean(base.manual),
          locked: Boolean(base.locked),
        };
        if (base.lockManual) e.lockManual = true;
        if (pc.plan.kind === "level") {
          e.levelGroupEnabled = true;
          if (base.groupKey) e.groupKey = base.groupKey;
        }
        if (pc.plan.kind === "split") e.splitEnabled = true;
        if (pc.plan.kind === "pair") {
          e.splitEnabled = true;
          e.pairEnabled = true;
          if (base.pairKey) e.pairKey = base.pairKey;
          if (!g.shared) e.classIds = [pc.classId];
        }
        // Blok belgilari AYNAN ko'chiriladi. ⚠️ Faqat `blockSize > 1` da
        // ko'chirish yetmaydi: generator oddiy darsga ham `blockSize: 1`,
        // `blockIndex: 0` yozadi, karta kaliti esa (`partCardKey`) blok
        // indeksini hisobga oladi — qiymatlar farq qilsa yangi yozuv
        // AYRIM karta bo'lib qolar va katak baribir «yarim» ko'rinardi.
        if (base.blockSize !== undefined) e.blockSize = base.blockSize;
        if (base.blockIndex !== undefined) e.blockIndex = base.blockIndex;
        adds.push(e);
      }
      if (!adds.length) return false;
      next[pc.day][pc.slotId] = [...cell, ...adds];
      return true;
    };

    // Karta va uning blok bo'laklari (ayni kunda) — hammasi birga ko'chadi
    const cardFamily = (pc) => {
      const base = pc.parts[0];
      const size = Number(base.blockSize || 1);
      if (size <= 1) return [{ slotId: pc.slotId, parts: pc.parts }];
      const cidsKey = classIdsOf(base).slice().sort().join("~");
      const fam = [];
      teachingSlots.forEach((ts) => {
        const parts = next[pc.day][ts.id].filter((l) => (
          Number(l.blockSize || 1) === size
          && (base.pairKey
            ? l.pairKey === base.pairKey
            : (l.subjectId === base.subjectId
              && (l.groupKey || "") === (base.groupKey || "")
              && classIdsOf(l).slice().sort().join("~") === cidsKey))
        ));
        if (parts.length) fam.push({ slotId: ts.id, parts });
      });
      return fam.length ? fam : [{ slotId: pc.slotId, parts: pc.parts }];
    };

    const relocateCard = (pc) => {
      const base = pc.parts[0];
      if (base.locked || pc.plan.kind === "pair") return false;
      const cls = classes.find((c) => c.id === pc.classId);
      const tpl = cls ? fillTemplate(cls, base.subjectId) : null;
      if (!tpl) return false;
      const fam = cardFamily(pc);
      // Joy AVVAL topiladi: topilmasa eski dars o'z o'rnida qoladi
      const spot = spotFor(tpl, fam.length);
      if (!spot) return false;
      fam.forEach((f) => {
        next[pc.day][f.slotId] = next[pc.day][f.slotId].filter((l) => !f.parts.includes(l));
      });
      placeTemplate(tpl, spot, fam.length);
      return true;
    };

    findPartialCards(next).forEach((pc) => {
      // Ro'yxat tuzilgandan keyin katak o'zgargan bo'lishi mumkin — qayta tekshiramiz
      const still = next[pc.day][pc.slotId].filter((l) => pc.parts.includes(l));
      if (!still.length) return;
      if (cardGaps(pc.classId, still).length === 0) return;
      if (repairInPlace(pc)) { repaired += 1; return; }
      if (relocateCard(pc)) { moved += 1; return; }
      stuck += 1;
      classIdsOf(pc.parts[0]).forEach((cid) => stuckKeys.add(`${cid}|${pc.parts[0].subjectId}`));
    });
    if (repaired || moved) recountLoad();

    let placed = 0;
    for (let pass = 0; pass < 4; pass++) {
      const before = placed;
      classes.forEach((cls) => {
        const classOff = new Set(Array.isArray(cls.offDays) ? cls.offDays : []);
        const subjectIds = new Set();
        (classSubjects?.[cls.id] || []).forEach((a) => {
          // «Bir vaqtda bir nechta fan» va «fan almashinuvi» darslari qo'lda
          // to'ldirilmaydi — sinf guruhlarga bo'lingan, yolg'iz dars
          // qo'yish jadvalni buzadi. Ular «tushmadi» ro'yxatida qoladi.
          if (a.pairEnabled || a.swapEnabled) return;
          if (a.subjectId) subjectIds.add(a.subjectId);
        });
        subjectIds.forEach((sid) => {
          // To'g'rilanmagan yarim karta o'sha soatni band qilib turibdi —
          // ustiga yana dars qo'ysak sinfda ortiqcha soat paydo bo'ladi.
          if (stuckKeys.has(`${cls.id}|${sid}`)) return;
          let guard = 0;
          while (guard < 80) {
            guard += 1;
            if (countCS(cls.id, sid) >= requiredHours(cls.id, sid)) break;
            const tpl = fillTemplate(cls, sid);
            if (!tpl) break;
            // Faqat soati HAQIQATAN kam sinflar uchun joylanadi — parallel
            // darsda guruhdoshlarning bir qismi to'liq bo'lishi mumkin.
            tpl.classIds = tpl.classIds.filter((cid) => countCS(cid, sid) < requiredHours(cid, sid));
            if (!tpl.classIds.includes(cls.id)) break;
            // Har bir guruh ustozi shu fanga biriktirilganmi
            const okT = new Set(teachersForSubject(sid).map((x) => x.id));
            if (tpl.parts.some((p) => !p.teacherId || !okT.has(p.teacherId))) break;

            // Blok uzunligi: 4 → 2 → 1. Butun blok sig'masa kichrayadi —
            // guruhlar va xonalar HAR HOLDA saqlanadi (ilgari ikkalasi ham
            // yo'qolardi).
            const rem = requiredHours(cls.id, sid) - countCS(cls.id, sid);
            const sizes = [];
            if (!tpl.noBlock) {
              if (tpl.a.allowQuad && rem >= QUAD_SIZE) sizes.push(QUAD_SIZE);
              if (tpl.a.allowDouble && rem >= 2) sizes.push(2);
            }
            sizes.push(1);

            let put = 0;
            for (const size of sizes) {
              const spot = spotFor(tpl, size);
              if (!spot) continue;
              placeTemplate(tpl, spot, size);
              put = size;
              break;
            }

            // Oddiy (guruhsiz, bloksiz) dars uchun eski zaxira yo'l:
            // to'sib turgan darsni boshqa katakka surib joy ochamiz.
            if (!put && tpl.plain) {
              const t = teachers.find((x) => x.id === tpl.parts[0].teacherId);
              const spot = t ? rearrangePlace(cls.id, sid, t, classOff) : null;
              if (spot) {
                const rid = tpl.parts[0].roomId;
                const cell = next[spot.day][spot.tsId];
                next[spot.day][spot.tsId].push({
                  subjectId: sid, classId: cls.id, classIds: [cls.id],
                  teacherId: spot.teacherId,
                  roomId: rid && !cell.some((l) => l.roomId === rid) ? rid : "",
                  manual: markManual,
                });
                tLoad[spot.teacherId] = (tLoad[spot.teacherId] || 0) + 1;
                put = 1;
              }
            }

            if (!put) break;
            placed += put;
          }
        });
      });
      if (placed === before) break;
    }
    return { schedule: next, placed, repaired, moved, stuck };
  }

  function resolveAll() {
    if (!setSchedule) return;
    const { schedule: filled, placed, repaired, moved, stuck } = fillRemaining(schedule);
    if (placed === 0 && repaired === 0 && moved === 0) {
      toast?.(stuck > 0
        ? `${stuck} ta yarim karta to'ldirilmadi — guruh ustozi o'sha soatda band. Darsni qo'lda ko'chiring yoki ustoz qo'shing`
        : "Bo'sh ustoz yoki vaqt topilmadi — bu fanlarga yana ustoz qo'shing", "warning");
      return;
    }
    // To'ldirgandan keyin darhol zichlaymiz — oyna qolmasin
    setSchedule(compactUntilClean(filled, countPlacedUnits(filled), {
      hard: true, rounds: 3, budgetMs: 1400,
    }));
    const bits = [];
    if (placed) bits.push(`${placed} ta soat joylashtirildi`);
    if (repaired) bits.push(`${repaired} ta yarim karta to'ldirildi`);
    if (moved) bits.push(`${moved} ta karta boshqa soatga ko'chirildi`);
    const tail = stuck ? ` · ⚠️ ${stuck} tasiga guruh ustozi topilmadi` : "";
    toast?.(`${bits.join(", ")} ✓${tail}`, stuck ? "warning" : "success");
  }

  // ——— «🧲 OYNANI YOPISH» — MAJBURIY, OYNA NOLGA TUSHGUNCHA ———
  // Bir marta zichlab qo'ya qolmaydi: oyna qolsa TO'XTAMAYDI — har urinishda
  // boshqa yo'ldan boradi (`spin`) va byudjet oshib boradi, ya'ni qidiruv
  // chuqurlashadi. To'xtash sharti faqat ikkitasi: oyna 0 yoki vaqt tugadi.
  // Sikl `async` — har urinishdan oldin brauzerga chizish imkoni beriladi,
  // shuning uchun tugma "⏳ Yopilyapti…" holatida ko'rinadi va ilova
  // qotib qolmaydi. Soat YO'QOLMAYDI: joylangan darslar soni kamaysa
  // natija qabul qilinmaydi.
  async function compactNow() {
    if (!setSchedule || compacting) return;
    const minPlaced = countPlacedUnits(schedule);
    const before = countGaps(schedule);
    if (before === 0) { toast?.("Kun o'rtasida bo'sh soat yo'q ✓", "success"); return; }

    setCompacting(true);
    const t0 = Date.now();
    const TIME_CAP_MS = 15000;   // qattiq chegara — brauzer kutib qolmasin
    let best = schedule;
    let bestGaps = before;
    let bestBal = countImbalance(best);
    let stall = 0;
    try {
      for (let k = 0; k < 12; k++) {
        // Brauzer ekranni yangilab ulgursin (rAF paintdan oldin, setTimeout keyin)
        await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
        if (Date.now() - t0 > TIME_CAP_MS) break;

        let next;
        try {
          next = compactSchedule(
            classes, timeslots, lunchGroups, best, classSubjects, teachers, subjects, rooms,
            // Tugmaning VAZIFASI — oynani yopish. Dastlabki ikki urinish
            // parallel moslikni saqlashga harakat qiladi, keyingilarida esa
            // u BUTUNLAY o'chadi: oyna moslikdan muhimroq.
            { hard: true, spin: k, budgetMs: 900 + k * 500, parallelDays: parOn && k < 2 },
          );
        } catch {
          break;
        }
        if (!next || countPlacedUnits(next) < minPlaced) break;

        const g = countGaps(next);
        const bal = countImbalance(next);
        if (g < bestGaps || (g === bestGaps && bal < bestBal)) {
          best = next;
          bestGaps = g;
          bestBal = bal;
          stall = 0;
        } else {
          stall += 1;
        }
        if (bestGaps === 0) break;
        // Ketma-ket 3 urinish hech narsa bermadi — bu ma'lumotda oyna
        // yopilmaydi (ustoz sig'imi/dam kuni). Behuda kutmaymiz.
        if (stall >= 3) break;
      }

      setSchedule(best);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (bestGaps === 0) {
        toast?.(`Oynalar to'liq yopildi — ${before} ta bo'sh soat ketdi ✓ · ⏱ ${secs} s`, "success");
      } else if (bestGaps < before) {
        toast?.(
          `${before - bestGaps} ta oyna yopildi, ${bestGaps} tasi qoldi — yana bosing yoki ustoz bandligini tekshiring · ⏱ ${secs} s`,
          "warning",
        );
      } else {
        toast?.(`${bestGaps} ta bo'sh soatni yopib bo'lmadi — ustoz bandligi yoki dam kuni to'sqinlik qilyapti`, "warning");
      }
    } finally {
      setCompacting(false);
    }
  }

  function addManualLesson() {
    if (!setSchedule || !manualCell) return;
    const { day, slotId, classId } = manualCell;
    if (!manualForm.subjectId) { toast?.("Fan tanlang", "warning"); return; }
    // Soati to'liq qo'yilgan fan ham qo'shilaveradi (almashtirish darsi,
    // qo'shimcha mashg'ulot va h.k.) — faqat ortiqcha ekani xabar qilinadi.
    const remain = requiredHours(classId, manualForm.subjectId) - placedHours(classId, manualForm.subjectId);
    if (isFixedMondaySubjectId(manualForm.subjectId)
      && (day !== "Dushanba" || slotId !== firstSlotIdOf(classId, day))) {
      toast?.("Kelajak soati faqat dushanbaning 1-darsiga qo'yiladi", "warning");
      return;
    }

    const next = { ...schedule, [day]: { ...(schedule?.[day] || {}) } };
    const cell = next[day][slotId] || [];
    const lock = Boolean(manualForm.lock);

    // Guruhli fan — HAMMA guruhi bilan birga (yarim karta tug'ilmasin)
    const gi = manualGroupInfo(classId, manualForm.subjectId);
    if (gi) {
      // Guruhlar ayni soatda o'qiydi: bitta xona ikki guruhga yetmaydi
      const seenRooms = new Set(cell.map((l) => l.roomId).filter(Boolean));
      const groupItems = gi.groups.map((g) => {
        const roomFree = Boolean(g.roomId) && !seenRooms.has(g.roomId);
        if (roomFree) seenRooms.add(g.roomId);
        const item = {
          subjectId: g.subjectId || manualForm.subjectId,
          classId: gi.classIds[0],
          classIds: [...gi.classIds],
          teacherId: g.teacherId || "",
          roomId: roomFree ? g.roomId : "",
          groupPart: g.name,
          manual: true,
          locked: lock,
        };
        if (gi.kind === "level") {
          item.levelGroupEnabled = true;
          if (gi.groupKey) item.groupKey = gi.groupKey;
        }
        if (gi.kind === "split") item.splitEnabled = true;
        if (gi.kind === "pair") {
          item.splitEnabled = true;
          item.pairEnabled = true;
          item.pairKey = gi.pairKey;
          if (!g.shared) item.classIds = [classId];
        }
        return item;
      });
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
    const gNote = gi ? ` · ${gi.groups.length} ta guruh birga` : "";
    if (remain <= 0) {
      const sname = subjectMap.get(manualForm.subjectId)?.name || "Fan";
      toast?.(`${sname}: soati to'liq edi — ORTIQCHA dars qo'shildi${lock ? " 🔒" : ""}${gNote}`, "warning");
    } else {
      toast?.(`${lock ? "Dars qo'shildi va qulflandi 🔒" : "Dars qo'lda qo'shildi ✓"}${gNote}`, "success");
    }
  }

  // ⚠️ Kalitga ILGARI `teacherId` ham kirardi — shu sababli guruhli darsning
  // faqat BITTA bo'lagi o'char, ikkinchi guruh katakda yolg'iz qolib ketardi
  // (aynan shu «yarim karta» soatni jimgina yo'qotardi). Endi karta bo'laklari
  // `collectCardEntries` bilan yig'iladi — qulflash ham shu qoidada.
  function removeLessonCard(day, slotId, classId, cardLesson) {
    if (!setSchedule) return;
    const cell = schedule?.[day]?.[slotId] || [];
    const entries = collectCardEntries(cell, cardLesson, classId);
    if (!entries.length) return;
    const next = { ...schedule, [day]: { ...(schedule?.[day] || {}) } };
    next[day][slotId] = cell.filter((l) => !entries.includes(l));
    setSchedule(next);
    toast?.(entries.length > 1 ? `Dars o'chirildi (${entries.length} ta guruh)` : "Dars o'chirildi", "error");
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

  // ——— Jadvalni nom bilan saqlash ———
  // Nusxa `savedSchedules` ro'yxatiga tushadi va "Saqlangan jadvallar"
  // bo'limida ko'rinadi. Joriy jadvalga tegilmaydi.
  function handleSaveSchedule(name, overwriteId) {
    if (!setSavedSchedules) return;
    setSavedSchedules(upsertSaved(savedSchedules, { name, overwriteId, schedule, classes }));
    setSaveOpen(false);
    toast?.(
      overwriteId
        ? `«${name}» yangilandi ✓`
        : `«${name}» saqlandi ✓ — «Saqlangan jadvallar» bo'limida`,
      "success"
    );
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
      schoolName: settings?.schoolName,
      academicYear: settings?.academicYear,
      toast,
    });
  }

  const lockedTotal = setSchedule ? lockedCount() : 0;
  // Tanlangan sinf (yoki "Barcha sinflar") bo‘yicha qulf holati
  const classLock = setSchedule && gridMode === "class"
    ? classLockStats(selectedClass)
    : { total: 0, locked: 0 };
  const classLockAll = selectedClass === "all";
  // "Barcha sinflar"da ochish uchun allaqachon «🔓 Qulflar» tugmasi bor —
  // takrorlamaymiz, u holatda faqat qulflash varianti ko‘rsatiladi.
  const classLockShow = classLock.total > 0 && (!classLockAll || classLock.locked < classLock.total);
  const classLockValue = classLock.locked < classLock.total;
  const gapTotal = setSchedule ? countGaps(schedule) : 0;
  const lessonTotal = countLessons(schedule);

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
          .sch-toolbar{padding:16px 18px;border-radius:20px;margin-bottom:16px;border:1px solid rgba(226,232,240,.9);box-shadow:0 10px 34px rgba(15,23,42,.07);}
          .pretty-alt-sep{opacity:.72;font-weight:600;}
          .pretty-alt-chip{margin-top:5px;font-size:11px;font-weight:700;color:#7c3aed;background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.25);border-radius:7px;padding:3px 8px;display:inline-block;line-height:1.3;}
          [data-theme="dark"] .pretty-alt-chip{color:#c4b5fd;background:rgba(124,58,237,.2);}
          .sch-toolbar-row{display:flex;align-items:stretch;gap:14px;flex-wrap:wrap;}
          .sch-field{display:flex;flex-direction:column;gap:6px;}
          .sch-field-label{font-size:11.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--text-muted,#94a3b8);padding-left:2px;}
          .sch-select-wrap{position:relative;display:flex;align-items:center;height:46px;min-width:250px;background:var(--card-bg,#fff);border:1.5px solid var(--card-border,#e2e8f0);border-radius:14px;transition:border-color .18s, box-shadow .18s;}
          .sch-select-wrap:hover{border-color:rgba(99,102,241,.55);}
          .sch-select-wrap:focus-within{border-color:#6366f1;box-shadow:0 0 0 4px rgba(99,102,241,.14);}
          .sch-select-wrap .sch-select-icon{position:absolute;left:13px;font-size:17px;pointer-events:none;}
          .sch-select-wrap select{appearance:none;-webkit-appearance:none;width:100%;height:100%;border:none;outline:none;background:transparent;font-size:15px;font-weight:700;color:var(--text-primary,#1e293b);padding:0 38px 0 40px;cursor:pointer;}
          .sch-select-wrap::after{content:"";position:absolute;right:15px;width:9px;height:9px;border-right:2.5px solid var(--text-muted,#94a3b8);border-bottom:2.5px solid var(--text-muted,#94a3b8);transform:rotate(45deg) translateY(-2px);pointer-events:none;}
          .sch-segment{display:flex;align-items:center;height:46px;padding:4px;gap:4px;background:var(--bg-secondary,#f1f5f9);border:1.5px solid var(--card-border,#e2e8f0);border-radius:14px;}
          .sch-segment button{height:100%;border:none;border-radius:11px;padding:0 16px;font-size:13.5px;font-weight:700;background:transparent;color:var(--text-secondary,#64748b);cursor:pointer;transition:all .18s;white-space:nowrap;}
          .sch-segment button:hover{color:var(--text-primary,#1e293b);}
          .sch-segment button.active{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;box-shadow:0 4px 12px rgba(99,102,241,.35);}
          .sch-actions{display:flex;align-items:flex-end;gap:9px;flex-wrap:wrap;margin-left:auto;}
          .sch-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:46px;padding:0 19px;border-radius:14px;border:1.5px solid transparent;font-size:14px;font-weight:750;font-family:inherit;cursor:pointer;transition:transform .18s ease, box-shadow .18s ease, background .18s ease, border-color .18s ease;white-space:nowrap;}
          .sch-btn:hover{transform:translateY(-2px);}
          .sch-btn:active{transform:translateY(0) scale(.98);}
          .sch-btn:disabled{opacity:.6;cursor:not-allowed;transform:none;box-shadow:none;}
          .sch-btn-hero{background:linear-gradient(135deg,#10b981 0%,#059669 55%,#047857 100%);color:#fff;box-shadow:0 8px 20px rgba(5,150,105,.32), inset 0 1px 0 rgba(255,255,255,.28);}
          .sch-btn-hero:hover{box-shadow:0 12px 28px rgba(5,150,105,.42), inset 0 1px 0 rgba(255,255,255,.28);}
          .sch-btn-soft-green{background:var(--card-bg,#fff);border-color:rgba(22,163,74,.3);color:#15803d;box-shadow:0 2px 8px rgba(15,23,42,.05);}
          .sch-btn-soft-green:hover{background:rgba(22,163,74,.08);border-color:rgba(22,163,74,.5);box-shadow:0 8px 18px rgba(22,163,74,.16);}
          .sch-btn-soft-blue{background:var(--card-bg,#fff);border-color:rgba(37,99,235,.3);color:#1d4ed8;box-shadow:0 2px 8px rgba(15,23,42,.05);}
          .sch-btn-soft-blue:hover{background:rgba(37,99,235,.08);border-color:rgba(37,99,235,.5);box-shadow:0 8px 18px rgba(37,99,235,.16);}
          .sch-btn-soft-gray{background:var(--card-bg,#fff);border-color:var(--card-border,#e2e8f0);color:var(--text-secondary,#475569);box-shadow:0 2px 8px rgba(15,23,42,.05);}
          .sch-btn-soft-gray:hover{background:var(--bg-secondary,#f1f5f9);border-color:#c7d2e2;box-shadow:0 8px 18px rgba(15,23,42,.10);}
          .sch-btn-save{background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;box-shadow:0 6px 16px rgba(79,70,229,.3), inset 0 1px 0 rgba(255,255,255,.25);}
          .sch-btn-save:hover{box-shadow:0 10px 24px rgba(79,70,229,.4), inset 0 1px 0 rgba(255,255,255,.25);}
          .sch-btn-soft-red{background:var(--card-bg,#fff);border-color:rgba(220,38,38,.3);color:#dc2626;box-shadow:0 2px 8px rgba(15,23,42,.05);}
          .sch-btn-soft-red:hover{background:rgba(220,38,38,.08);border-color:rgba(220,38,38,.5);box-shadow:0 8px 18px rgba(220,38,38,.16);}
          [data-theme="dark"] .sch-btn-soft-green{background:transparent;color:#4ade80;}
          [data-theme="dark"] .sch-btn-soft-blue{background:transparent;color:#93c5fd;}
          [data-theme="dark"] .sch-btn-soft-gray{background:transparent;}
          [data-theme="dark"] .sch-btn-soft-red{background:transparent;color:#fca5a5;}
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
            {setSchedule && gapTotal > 0 && (
              <button
                className="sch-btn sch-btn-soft-blue"
                onClick={compactNow}
                type="button"
                disabled={compacting}
                title="Kun o'rtasidagi bo'sh soatlarni majburiy yopish — oyna nolga tushmaguncha qidiriladi"
              >
                {compacting ? "⏳ Yopilyapti…" : `🧲 Oynani yopish (${gapTotal})`}
              </button>
            )}
            {setSchedule && lockedTotal > 0 && (
              <button className="sch-btn sch-btn-soft-blue" onClick={unlockAll} type="button" title="Barcha qulflarni ochish">
                🔓 Qulflar ({lockedTotal})
              </button>
            )}
            {classLockShow && (
              <button
                className="sch-btn sch-btn-soft-blue"
                onClick={() => toggleClassLock(selectedClass, classLockValue)}
                type="button"
                title={classLockValue
                  ? `${classLockAll ? "Jadvaldagi barcha darsni" : "Tanlangan sinfning barcha darsini"} qulflash — «⚡ Avtomatik jadval» bosilganda ular joyidan qimirlamaydi`
                  : "Tanlangan sinfning barcha qulfini ochish"}
              >
                {classLockValue
                  ? `🔒 ${classLockAll ? "Hammasini" : "Sinfni"} qulflash (${classLock.total - classLock.locked})`
                  : `🔓 Sinf qulfini ochish (${classLock.locked})`}
              </button>
            )}
            {setSavedSchedules && (
              <button
                className="sch-btn sch-btn-save"
                onClick={() => setSaveOpen(true)}
                type="button"
                disabled={!lessonTotal}
                title={lessonTotal ? "Jadvalni nom bilan saqlash" : "Jadval bo'sh"}
              >
                💾 Saqlash
              </button>
            )}
            {setSavedSchedules && setActivePage && savedSchedules.length > 0 && (
              <button
                className="sch-btn sch-btn-soft-gray"
                onClick={() => setActivePage("savedSchedules")}
                type="button"
                title="Saqlangan jadvallar ro'yxati"
              >
                🗂 Saqlanganlar ({savedSchedules.length})
              </button>
            )}
            <button className="sch-btn sch-btn-soft-green" onClick={exportExcel} type="button">📥 Excel</button>
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
              .gen-time{margin-top:-6px;color:#ffffff;font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:1px;text-shadow:0 2px 14px rgba(0,0,0,.4);}
              .gen-time small{font-size:14px;font-weight:700;opacity:.75;margin-left:3px;}
            `}</style>
            {genDone ? <div className="gen-check">✓</div> : <div className="gen-spinner" />}
            <div className="gen-text">{genDone ? "Tayyor!" : "Bajarilyapti…"}</div>
            <div className="gen-sub">{genDone ? `${genProgress}% · ${genRound} ta urinish` : `${genProgress}% · ${genRound}-urinish`}</div>
            <div className="gen-time">{genElapsed.toFixed(1)}<small>s</small></div>
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
          shifts={shifts}
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

          {setSchedule && visibleClasses.length > 0 && (() => {
            const gm = globalMissing();
            const totalMissing = gm.reduce((s, x) => s + x.total, 0);
            const anyLessons = DAYS.some((d) => sortedTimeslots.some((s) => (schedule?.[d]?.[s.id] || []).length));
            // Jadval chiqqan va birorta soat tushmay qolmagan — demak sig'im
            // yetgan. Shunda «sig'maydi» degan BASHORATLAR ko'rsatilmaydi:
            // ular amalda rad etilgan va faqat chalg'itadi.
            // Yarim karta qolgan bo'lsa jadval TO'LIQ emas — guruhning bir
            // qismi ustozsiz turibdi, buni «100%» deb ko'rsatib bo'lmaydi.
            const complete = anyLessons && totalMissing === 0 && partialCards.length === 0;
            const caps = capacityWarnings(complete);
            if (!anyLessons && !gm.length && !caps.length && !superviseGaps.length
              && !partialCards.length && !teacherHourRows.length
              && !conflictViolations.length) return null;
            return (
              <>
                {/* 0) YARIM TUSHGAN DARSLAR — guruh yozuvi yetishmayotgan katak.
                    Bu soat «joylashgan» deb sanalmaydi (aks holda 2-guruh
                    ustozi yo'qolganda ham foiz 100% ko'rinardi). */}
                {partialCards.length > 0 && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                      <div style={{ fontWeight: 800, fontSize: 16, color: "#991b1b" }}>
                        🧩 {partialCards.length} ta dars YARIM tushgan — guruh ustozi yo'q
                      </div>
                      <button type="button" className="btn btn-success" onClick={resolveAll}>
                        🔧 To'g'rilash
                      </button>
                    </div>
                    <div style={{ fontSize: 12.5, color: "#b91c1c", marginBottom: 8 }}>
                      Bu kataklarda guruhli darsning bir qismi yo'q — ya'ni sinfning bir guruhi
                      o'sha soatda <b>ustozsiz</b> qoladi. Shuning uchun ular to'liq soat deb
                      sanalmaydi va «tushmagan soat» ro'yxatiga kiradi.
                      «🔧 To'g'rilash» avval yetishmagan guruhni <b>joyida</b> to'ldiradi;
                      ustoz o'sha soatda band bo'lsa — butun kartani boshqa soatga ko'chiradi.
                    </div>
                    {partialCards.slice(0, 10).map((pc, i) => (
                      <div key={i} style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: 10, padding: 10, marginBottom: 6 }}>
                        <div style={{ fontWeight: 700, color: "#991b1b", fontSize: 13.5 }}>
                          {pc.className} · {pc.subjectName} — {pc.day}, {pc.lessonNumber}-dars
                        </div>
                        <div style={{ fontSize: 12.5, color: "#7f1d1d", marginTop: 4 }}>
                          Yetishmayapti: {pc.gaps.map((g) => `${g.name || "guruh"} — ${getName(teacherMap, g.teacherId, "ustoz tanlanmagan")}`).join(", ")}
                          {pc.gaps.some((g) => g.teacherId && teacherBusyReason(g.teacherId, pc.day, pc.slotId))
                            && ` · sabab: ${pc.gaps.map((g) => teacherBusyReason(g.teacherId, pc.day, pc.slotId)).filter(Boolean).join("; ")}`}
                        </div>
                      </div>
                    ))}
                    {partialCards.length > 10 && (
                      <div style={{ fontSize: 12.5, color: "#991b1b" }}>… yana {partialCards.length - 10} ta</div>
                    )}
                  </div>
                )}

                {/* 1) HAQIQATAN tushmagan soat — «joylashmadi» faqat shu yerda */}
                {totalMissing > 0 && (
                  <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                      <div style={{ fontWeight: 800, fontSize: 16, color: "#9a3412" }}>
                        ⚠️ {totalMissing} soat to'liq joylashmadi — yechim tavsiyalari
                      </div>
                      <button type="button" className="btn btn-success" onClick={resolveAll}>
                        🔧 Hammasini bir bosishda hal qilish
                      </button>
                    </div>

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
                )}

                {/* 2) Hammasi joylashgan — yashil xabar (ogohlantirish bo'lsa ham) */}
                {complete && (
                  <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 12, padding: "10px 14px", marginBottom: 14, color: "#065f46", fontWeight: 600 }}>
                    ✅ Barcha fan soatlari to'liq joylashtirildi (100%).
                    {teacherHourRows.length === 0 && " Har bir ustozning rejadagi soati setkada ham to'liq."}
                  </div>
                )}

                {/* 2a) USTOZ SOATI: REJA ↔ SETKA
                    Sinf bo'yicha hisob to'g'ri chiqib, ustozning soati kam
                    bo'lib qolishi mumkin (yarim karta, qo'lda o'chirilgan
                    guruh). Shuning uchun tekshiruv ustoz tomonidan ham
                    takrorlanadi — soat jimgina yo'qolmasin. */}
                {anyLessons && teacherHourRows.length > 0 && (
                  <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                    <div style={{ fontWeight: 800, color: "#9a3412", marginBottom: 4 }}>
                      👤 {teacherHourRows.length} ta ustozda reja va setka mos kelmadi
                    </div>
                    <div style={{ fontSize: 12.5, color: "#b45309", marginBottom: 8 }}>
                      «Sinf fanlari»da biriktirilgan soat bilan jadvalda haqiqatan turgan soat
                      solishtirildi. Kam bo'lsa — o'sha soat tushmagan yoki guruh yozuvi
                      yo'qolgan; ko'p bo'lsa — qo'lda ortiqcha dars qo'shilgan.
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {teacherHourRows.slice(0, 14).map((r) => (
                        <span key={r.id} style={{ background: "#fff", border: "1px solid #fed7aa", borderRadius: 8, padding: "3px 8px", fontSize: 13, color: "#9a3412" }}>
                          {r.name}: rejada <b>{r.planned}</b>, setkada <b>{r.done}</b>
                          {" "}({r.diff > 0 ? `+${r.diff} ortiqcha` : `${-r.diff} soat tushmadi`})
                        </span>
                      ))}
                      {teacherHourRows.length > 14 && <span style={{ fontSize: 13, color: "#9a3412" }}>… yana {teacherHourRows.length - 14} ta</span>}
                    </div>
                  </div>
                )}

                {/* 2b) BOLA NAZORATSIZ QOLGAN SOATLAR (1–4 sinf)
                    Sinf katagi bo'sh, lekin kun tugamagan va aynan o'sha
                    soatda sinf rahbari boshqa sinfda dars bermoqda. */}
                {superviseGaps.length > 0 && (() => {
                  const byClass = new Map();
                  superviseGaps.forEach((g) => {
                    const key = `${g.classId}|${g.teacherId}`;
                    let e = byClass.get(key);
                    if (!e) byClass.set(key, (e = { className: g.className, teacherName: g.teacherName, items: [] }));
                    e.items.push(g);
                  });
                  return (
                    <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                      <div style={{ fontWeight: 800, color: "#991b1b", marginBottom: 4 }}>
                        🧒 {superviseGaps.length} soat bola nazoratsiz qoladi
                      </div>
                      <div style={{ fontSize: 12.5, color: "#b91c1c", marginBottom: 8 }}>
                        Sinf rahbari boshqa sinfda dars berayotgan paytda bu sinfning katagi bo'sh qolgan.
                        O'sha katakka boshqa ustozning darsini ko'chiring yoki <b>＋</b> orqali qo'shing.
                      </div>
                      {[...byClass.values()].slice(0, 8).map((e, i) => (
                        <div key={i} style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: 10, padding: 10, marginBottom: 6 }}>
                          <div style={{ fontWeight: 700, color: "#991b1b", fontSize: 13.5 }}>
                            {e.className} · rahbar: {e.teacherName || "—"}
                          </div>
                          <div style={{ fontSize: 12.5, color: "#7f1d1d", marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {e.items.slice(0, 12).map((g, k) => (
                              <span key={k} style={{ background: "#fee2e2", borderRadius: 6, padding: "2px 6px" }}>
                                {g.day}, {g.lessonNumber}-dars
                                {g.busyIn.length ? ` → ${g.busyIn.join(", ")}` : ""}
                              </span>
                            ))}
                            {e.items.length > 12 && <span>… yana {e.items.length - 12} ta</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* 2c) BIR KUNGA TUSHGAN ZIDDIYATLI FANLAR (Algebra + Geometriya)
                    Avtomatik tuzishda bunday bo'lmaydi — qo'lda ko'chirishdan
                    keyin paydo bo'lishi mumkin. */}
                {conflictViolations.length > 0 && (
                  <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                    <div style={{ fontWeight: 800, color: "#9a3412", marginBottom: 4 }}>
                      📚 {conflictViolations.length} ta sinf-kunda birga tushmasligi kerak bo'lgan fanlar bor
                    </div>
                    <div style={{ fontSize: 12.5, color: "#c2410c", marginBottom: 8 }}>
                      Bu fanlar bitta sinfda bir kunda o'qitilmaydi. Birini boshqa kunga ko'chiring.
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {conflictViolations.slice(0, 20).map((v, i) => (
                        <span key={i} style={{ background: "#ffedd5", borderRadius: 6, padding: "3px 7px", fontSize: 12.5, color: "#7c2d12" }}>
                          {v.className} · {v.day}: {v.text}
                        </span>
                      ))}
                      {conflictViolations.length > 20 && <span style={{ fontSize: 12.5, color: "#9a3412" }}>… yana {conflictViolations.length - 20} ta</span>}
                    </div>
                  </div>
                )}

                {/* 3) Sozlama ogohlantirishlari — ALOHIDA quti, tushmagan soatdan mustaqil */}
                {caps.length > 0 && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                    <div style={{ fontWeight: 800, color: "#92400e", marginBottom: 6 }}>
                      {totalMissing > 0
                        ? "Mumkin bo'lgan sabablar (sozlamalarda):"
                        : "⚠️ Sozlamalarda e'tibor beradigan joylar — jadval baribir to'liq chiqdi:"}
                    </div>
                    {caps.map((w, i) => <div key={i} style={{ fontSize: 13, color: "#78350f", marginTop: i ? 4 : 0 }}>• {w}</div>)}
                  </div>
                )}
              </>
            );
          })()}

          {setSchedule && gapTotal > 0 && (() => {
            const tight = tightTeachers();
            return (
              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <div style={{ fontWeight: 800, color: "#1e40af", fontSize: 15 }}>
                  🧲 {gapTotal} ta oyna (kun o'rtasidagi bo'sh soat) qoldi
                </div>
                <div style={{ fontSize: 13, color: "#1e3a8a", marginTop: 6 }}>
                  Yuqoridagi «🧲 Oynani yopish» tugmasini bosing — jadval oyna nolga tushmaguncha
                  qayta-qayta zichlanadi (har urinishda boshqa yo'ldan boradi). Soat yo'qolmaydi,
                  ustoz/xona bandligi va dam kunlari saqlanadi. Bir bosishda hammasi yopilmasa —
                  yana bosing.
                </div>
                {tight.length > 0 && (
                  <div style={{ fontSize: 13, color: "#1e3a8a", marginTop: 6 }}>
                    Sabab: quyidagi ustozlarning deyarli har soati band, shuning uchun ularning darsini
                    boshqa soatga surib bo'lmaydi —{" "}
                    {tight.map((r) => `${r.name} (${r.hours}/${r.avail} soat)`).join(", ")}.
                    {" "}Shu ustozlarning fanlariga yordamchi ustoz qo'shsangiz, oynalar yo'qoladi.
                  </div>
                )}
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
                    <div style={{ fontSize: 12, color: "#92400e", marginTop: 6 }}>«🔧 Hal qilish» bo'sh soat topadi; topilmasa boshqa darsni surish rejasini ko'rsatib, tasdiqlashingizni so'raydi.</div>
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
                                <strong>{isTeachingSlot(slot) ? `${slotDisplayNumber(slot) || ""}-dars` : (slot.title || (slot.type === "lunch" ? "Obed" : "Tanaffus"))}</strong>
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
        // Fanlar — FAQAT shu sinfda yoqilganlari; ustozlar/xonalar — FAQAT
        // aynan shu VAQTDA bo'sh bo'lganlari (bandlari ro'yxatga chiqmaydi).
        const subjRows = classSubjectChoices(classId, day, slotId);
        const pickedRow = subjRows.find((r) => r.subjectId === manualForm.subjectId) || null;
        const tc = teacherChoices(classId, manualForm.subjectId, day, slotId);
        const rc = roomChoices(day, slotId);
        const altTc = teacherChoices(classId, manualForm.altSubjectId, day, slotId);
        const freeNow = new Set();
        subjRows.forEach((r) => {
          const c = teacherChoices(classId, r.subjectId, day, slotId);
          [...c.ownFree, ...c.otherFree].forEach((t) => freeNow.add(t.id));
        });
        // Guruhli fan bitta yozuv bo'lib tushmaydi — karta HAMMA guruhi bilan
        // qo'shiladi, shuning uchun bandlik ham har guruh ustozi bo'yicha
        // tekshiriladi.
        const gi = manualForm.subjectId ? manualGroupInfo(classId, manualForm.subjectId) : null;
        const effectiveWarns = gi ? groupConflictsAt(day, slotId, gi.classIds, gi.groups) : warns;
        const hasBlocker = effectiveWarns.some((w) => w.startsWith("⛔"));
        const hasParallel = effectiveWarns.some((w) => w.startsWith("⚠️"));
        // Ma'lumot uchun eslatmalar — taqiqlamaydi, faqat ogohlantiradi
        const notes = [];
        if (pickedRow && pickedRow.missing === 0) {
          notes.push(`ℹ️ ${pickedRow.name}: haftalik ${pickedRow.need} soat allaqachon to'liq qo'yilgan — bu dars ORTIQCHA bo'ladi.`);
        }
        if (manualForm.subjectId) {
          const cap = subjectDayCap(classId, manualForm.subjectId);
          const today = subjectDayCount(classId, manualForm.subjectId, day);
          if (today >= cap) notes.push(`ℹ️ Bu fan ${day} kuni allaqachon ${today} soat turibdi (kunlik me'yor — ${cap}).`);
          // Bir kunga tushmaydigan fanlar (Algebra ↔ Geometriya) — taqiqlamaydi
          const foes = conflictOf.get(manualForm.subjectId);
          if (foes && foes.size) {
            const here = new Set();
            sortedTimeslots.forEach((ts) => (schedule?.[day]?.[ts.id] || []).forEach((l) => {
              if (l && foes.has(l.subjectId) && classIdsOf(l).includes(classId)) here.add(l.subjectId);
            }));
            here.forEach((fid) => notes.push(
              `⚠️ ${day} kuni bu sinfda ${subjectMap.get(fid)?.name || "fan"} bor — bu ikki fan bir kunga tushmasligi kerak.`
            ));
          }
          // «Fan almashinuvi» — YAGONA holat: dars bitta yozuv bo'lib tushadi
          // (guruhlar keyingi soatda almashadi, buni qo'lda qurib bo'lmaydi).
          // Qolgan guruhli sozlamalar endi to'liq karta bo'lib qo'shiladi.
          const sw = (classSubjects?.[classId] || []).find((a) => (
            a.swapEnabled && (a.subjectId === manualForm.subjectId || a.swapSubjectId === manualForm.subjectId)
          ));
          if (sw) {
            notes.push("ℹ️ Bu fan sozlamasida «fan almashinuvi» yoqilgan — qo'lda qo'shilgan dars faqat BITTA guruh sifatida tushadi.");
          }
        }
        const shownWarns = [...effectiveWarns, ...notes];
        return (
          <div onClick={() => setManualCell(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ background: "var(--card-bg, #fff)", borderRadius: 14, padding: 20, width: "100%", maxWidth: 460, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
              <h3 style={{ margin: "0 0 4px" }}>Qo'lda dars qo'shish</h3>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
                {cls?.name} · {day} · {slotDisplayNumber(slot)}-dars
                {slot?.startTime && slot?.endTime ? ` · ${slot.startTime}–${slot.endTime}` : ""}
              </div>

              {subjRows.length === 0 ? (
                <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 10, padding: 12, color: "#9a3412", fontSize: 14 }}>
                  Bu sinfga hali fan biriktirilmagan — avval «Sinf fanlari» bo'limida fan qo'shing.
                </div>
              ) : (
                <>
                  <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 10, padding: "8px 10px", color: "#065f46", fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
                    🟢 Bu vaqtda bo'sh: {freeNow.size} ta ustoz · {rc.free.length} ta xona
                  </div>

                  <label className="form-label">Fan — faqat shu sinfda yoqilganlari</label>
                  <select className="form-control" value={manualForm.subjectId}
                    onChange={(e) => setManualForm({
                      ...manualForm,
                      subjectId: e.target.value,
                      teacherId: pickFreeTeacher(classId, e.target.value, day, slotId),
                    })}>
                    <option value="">— fan tanlang —</option>
                    {subjRows.map((m) => (
                      <option key={m.subjectId} value={m.subjectId}>
                        {m.name} — {m.missing > 0 ? `${m.missing} soat qoldi` : "soati to'liq"}
                        {m.ownFreeCount > 0
                          ? ` · ustozi bo'sh (${m.ownFreeCount})`
                          : m.freeCount > 0
                            ? ` · ustozi band, ${m.freeCount} ta almashtiruvchi bor`
                            : " · bo'sh ustoz yo'q"}
                      </option>
                    ))}
                  </select>

                  {gi ? (
                    <div style={{ marginTop: 12, background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 10, padding: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#3730a3", marginBottom: 6 }}>
                        {gi.kind === "level" ? "🎯 Bu fan daraja guruhli" : gi.kind === "split" ? "✂️ Bu fan 2 guruhga bo'lingan" : "🧩 Bu soatda bir nechta guruh o'qiydi"}
                        {" "}— karta HAMMA guruhi bilan birga qo'shiladi:
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {gi.groups.map((g, i) => {
                          const why = teacherBusyReason(g.teacherId, day, slotId);
                          const gSubj = gi.kind === "pair" ? subjectMap.get(g.subjectId)?.name : "";
                          return (
                            <div key={i} style={{ fontSize: 13 }}>
                              <b>{g.name}</b>{gSubj ? ` · ${gSubj}` : ""}: {getName(teacherMap, g.teacherId, "ustoz tanlanmagan")}
                              {g.teacherId && (
                                <span style={{ color: why ? "#b91c1c" : "#047857", fontWeight: 700 }}>
                                  {why ? ` · band (${why})` : " · bo'sh ✓"}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 12, color: "#4338ca", marginTop: 6 }}>
                        Sinflar: {gi.classIds.map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean).join(", ")}
                      </div>
                      <div style={{ fontSize: 12, color: "#4338ca", marginTop: 4 }}>
                        Guruh ustozi band bo'lsa dars baribir qo'shiladi, lekin o'sha ustoz
                        bir vaqtda ikki sinfda turib qoladi (yuqoridagi ⚠️ ogohlantirishlarga
                        qarang) — avval uning vaqtini bo'shating.
                      </div>
                    </div>
                  ) : (
                    <>
                      <label className="form-label" style={{ marginTop: 10, display: "block" }}>
                        Ustoz — bu vaqtda bo'sh bo'lganlari
                      </label>
                      <select className="form-control" value={manualForm.teacherId} disabled={!manualForm.subjectId}
                        onChange={(e) => setManualForm({ ...manualForm, teacherId: e.target.value })}>
                        <option value="">{tc.free.length ? "— ustoz tanlang —" : "— ustozsiz —"}</option>
                        {tc.ownFree.length > 0 ? (
                          <optgroup label="Shu sinf ustozi">
                            {tc.ownFree.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </optgroup>
                        ) : tc.otherFree.length > 0 && (
                          <optgroup label={tc.hasOwn ? "Almashtirish — sinf ustozi band" : "Shu fandan bo'sh ustozlar"}>
                            {tc.otherFree.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </optgroup>
                        )}
                      </select>
                      {manualForm.subjectId && tc.ownFree.length === 0 && tc.otherFree.length > 0 && (
                        <div style={{ fontSize: 12.5, color: "#b45309", marginTop: 6, lineHeight: 1.5 }}>
                          ⚠️ Sinfning o'z ustozi bu vaqtda band — ro'yxatda shu fandan bo'sh boshqa ustozlar turibdi.
                        </div>
                      )}
                      {manualForm.subjectId && tc.free.length === 0 && (
                        <div style={{ fontSize: 12.5, color: "#b91c1c", marginTop: 6, lineHeight: 1.5 }}>
                          ⛔ Bu fandan shu vaqtda bo'sh ustoz yo'q — hamma ustoz band yoki dam olmoqda.
                        </div>
                      )}
                      {manualForm.subjectId && tc.busy.length > 0 && (
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.5 }}>
                          Band bo'lgani uchun ro'yxatga chiqmadi: {tc.busy.map((b) => `${b.name} (${b.reason})`).join(" · ")}
                        </div>
                      )}

                      <label className="form-label" style={{ marginTop: 10, display: "block" }}>
                        Xona (ixtiyoriy) — bu vaqtda bo'shlari
                      </label>
                      <select className="form-control" value={manualForm.roomId}
                        onChange={(e) => setManualForm({ ...manualForm, roomId: e.target.value })}>
                        <option value="">Xonasiz</option>
                        {rc.free.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      {rc.busyCount > 0 && (
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
                          {rc.busyCount} ta xona bu vaqtda band — ro'yxatda yo'q.
                        </div>
                      )}

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
                              onChange={(e) => setManualForm({
                                ...manualForm,
                                altSubjectId: e.target.value,
                                altTeacherId: pickFreeTeacher(classId, e.target.value, day, slotId),
                              })}>
                              <option value="">— fan tanlang —</option>
                              {subjRows.filter((m) => m.subjectId !== manualForm.subjectId).map((m) => (
                                <option key={m.subjectId} value={m.subjectId}>
                                  {m.name}{m.freeCount > 0 ? ` · ${m.freeCount} ta bo'sh ustoz` : " · bo'sh ustoz yo'q"}
                                </option>
                              ))}
                            </select>
                            <label className="form-label" style={{ marginTop: 8, display: "block" }}>
                              Almashadigan fan ustozi — bo'shlari
                            </label>
                            <select className="form-control" value={manualForm.altTeacherId} disabled={!manualForm.altSubjectId}
                              onChange={(e) => setManualForm({ ...manualForm, altTeacherId: e.target.value })}>
                              <option value="">{altTc.free.length ? "— ustoz tanlang —" : "— ustozsiz —"}</option>
                              {altTc.free.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}{t.own ? "" : " · almashtirish"}
                                </option>
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

                  {shownWarns.length > 0 && (
                    <div style={{
                      marginTop: 12,
                      background: hasBlocker || hasParallel ? "#fef2f2" : "#fffbeb",
                      border: `1px solid ${hasBlocker || hasParallel ? "#fecaca" : "#fde68a"}`,
                      borderRadius: 10, padding: 10,
                    }}>
                      {shownWarns.map((w, i) => (
                        <div key={i} style={{ fontSize: 13, color: w.startsWith("ℹ️") ? "#92400e" : "#b91c1c", marginTop: i ? 4 : 0 }}>{w}</div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
                <button className="btn btn-secondary" type="button" onClick={() => setManualCell(null)}>Yopish</button>
                {subjRows.length > 0 && (
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
        const moves = resolveData.moves || [];
        return (
          <div onClick={() => setResolveData(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ background: "var(--card-bg, #fff)", borderRadius: 14, padding: 20, width: "100%", maxWidth: 540, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
              <h3 style={{ margin: "0 0 4px" }}>🔧 Yechim taklifi</h3>
              <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 12 }}>
                <b>{cls?.name}</b> — <b>{resolveData.name}</b>: {resolveData.placements.length} ta soat quyidagicha joylashtirilsinmi?
              </div>

              {moves.length > 0 && (
                <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontWeight: 800, color: "#9a3412", marginBottom: 6, fontSize: 13.5 }}>
                    ⚠️ Bo'sh soat topilmadi — {moves.length} ta mavjud dars boshqa soatga ko'chiriladi:
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {moves.map((m, i) => (
                      <div key={i} style={{ background: "#fff", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#7c2d12", lineHeight: 1.5 }}>
                        <b>{m.label}</b><br />
                        {m.fromDay}, {slotNumOf(m.fromSlotId)}-dars <b>→</b> {m.toDay}, {slotNumOf(m.toSlotId)}-dars
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: "#9a3412", marginTop: 8 }}>
                    Ko'chirilgan darslarning ustozi va sinfi yangi soatda bo'sh ekani tekshirildi — hech qanday to'qnashuv yuzaga kelmaydi.
                  </div>
                </div>
              )}

              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6, color: "var(--text-secondary)" }}>Yangi qo'yiladigan darslar:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {resolveData.placements.map((p, i) => (
                  <div key={i} style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#065f46" }}>
                    <b>{p.day}, {slotNumOf(p.slotId)}-dars</b> — {resolveData.name}, ustoz:{" "}
                    {(p.teacherIds?.length ? p.teacherIds : [p.teacherId]).map((id) => getName(teacherMap, id)).join(" + ")}
                    {p.entries?.length > 1 ? ` (${p.entries.length} ta guruh birga)` : ""}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 14 }}>
                Yangi darslar qulflanadi 🔒 — qayta avtomatik tuzganingizda ham joyidan qimirlamaydi.
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn btn-secondary" type="button" onClick={() => setResolveData(null)}>Bekor qilish</button>
                <button className="btn btn-success" type="button" onClick={applyResolution}>
                  {moves.length > 0 ? "Ha, ko'chirilsin va qo'yilsin" : "Tasdiqlash va qo'yish"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {saveOpen && (
        <SaveScheduleModal
          savedSchedules={savedSchedules}
          lessonCount={lessonTotal}
          onSave={handleSaveSchedule}
          onCancel={() => setSaveOpen(false)}
        />
      )}
    </div>
  );
}
