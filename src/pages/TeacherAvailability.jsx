import { Fragment, useMemo, useState } from "react";
import { DAYS } from "../utils/constants";
import { isTeachingSlot } from "../utils/scheduleGenerator";
import { groupSlotsByShift, shiftSlotNumbers } from "../utils/shiftSlots";
import "../styles/teacherAvailability.css";

// ————————————————————————————————————————————————————————————
// USTOZ SETKASI
// Har bir ustoz uchun hafta × dars soati setkasi:
//  · Dam olish kuni (Teachers sahifasida belgilangan) — butun ustun yopiq
//  · Qolgan kataklarni 🔒 qulflash / 🔓 ochish mumkin
//  · Qulflangan katakka avtomatik generator hech qachon dars qo'ymaydi
//  · Qo'lda (manual) qo'yilgan darslar bundan mustasno
// Ma'lumot ustoz obyektida saqlanadi:
//   teacher.blockedSlots = { [kun]: [timeslotId, ...] }
// ————————————————————————————————————————————————————————————

const collator = new Intl.Collator(["uz", "ru"], { numeric: true, sensitivity: "base" });

function classIdsOf(lesson) {
  return Array.isArray(lesson?.classIds) ? lesson.classIds : [lesson?.classId].filter(Boolean);
}

function normalizeBlocked(bs) {
  const out = {};
  if (bs && typeof bs === "object") {
    DAYS.forEach((day) => {
      if (Array.isArray(bs[day]) && bs[day].length) out[day] = [...bs[day]];
    });
  }
  return out;
}

export default function TeacherAvailabilityPage({
  teachers = [],
  setTeachers,
  timeslots = [],
  shifts = [],
  classes = [],
  subjects = [],
  classSubjects = {},
  schedule = {},
  toast,
}) {
  const sortedTeachers = useMemo(
    () => [...teachers].sort((a, b) => collator.compare(a?.name || "", b?.name || "")),
    [teachers]
  );
  const [teacherId, setTeacherId] = useState("");
  const teacher = useMemo(
    () => teachers.find((t) => t.id === teacherId) || null,
    [teachers, teacherId]
  );

  const sortedTs = useMemo(
    () => [...timeslots].sort((a, b) => Number(a.lessonNumber) - Number(b.lessonNumber)),
    [timeslots]
  );
  const teachingTs = useMemo(() => sortedTs.filter(isTeachingSlot), [sortedTs]);

  // ——— SMENALAR ———
  // Setka smenalarga bo'linadi va har smena o'z ichida 1-dars, 2-dars … deb
  // raqamlanadi (ichkarida global lessonNumber saqlanib qoladi).
  const slotGroups = useMemo(() => groupSlotsByShift(timeslots, shifts), [timeslots, shifts]);
  const slotNumById = useMemo(() => shiftSlotNumbers(slotGroups), [slotGroups]);
  const slotNum = (ts) => slotNumById.get(ts.id) ?? ts.lessonNumber;

  const offDays = useMemo(
    () => new Set(Array.isArray(teacher?.offDays) ? teacher.offDays : []),
    [teacher]
  );
  const blocked = useMemo(() => normalizeBlocked(teacher?.blockedSlots), [teacher]);

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  // Joriy jadvaldagi shu ustozning darslari: `${kun}|${tsId}` -> [dars, ...]
  const lessonMap = useMemo(() => {
    const map = new Map();
    if (!teacher) return map;
    DAYS.forEach((day) => {
      sortedTs.forEach((ts) => {
        const cell = schedule?.[day]?.[ts.id];
        if (!Array.isArray(cell)) return;
        const mine = cell.filter(
          (l) => l && (l.teacherId === teacher.id || (l.alternating && l.altTeacherId === teacher.id))
        );
        if (mine.length) map.set(`${day}|${ts.id}`, mine);
      });
    });
    return map;
  }, [teacher, schedule, sortedTs]);

  const isBlocked = (day, tsId) => Array.isArray(blocked[day]) && blocked[day].includes(tsId);

  function saveBlocked(next) {
    if (!teacher || !setTeachers) return;
    const clean = normalizeBlocked(next);
    setTeachers(teachers.map((t) => (t.id === teacher.id ? { ...t, blockedSlots: clean } : t)));
  }

  function toggleSlot(day, tsId) {
    if (!teacher) return;
    if (offDays.has(day)) return;
    const cur = Array.isArray(blocked[day]) ? [...blocked[day]] : [];
    const idx = cur.indexOf(tsId);
    if (idx >= 0) {
      cur.splice(idx, 1);
    } else {
      cur.push(tsId);
      if (lessonMap.has(`${day}|${tsId}`)) {
        toast?.(
          "Bu katakda hozir dars bor. Qulf yangi joylashuvlarga ta'sir qiladi — jadval qayta tuzilganda bu katak bo'sh qoladi.",
          "warning"
        );
      }
    }
    saveBlocked({ ...blocked, [day]: cur });
  }

  function toggleDay(day) {
    if (!teacher || offDays.has(day)) return;
    const ids = teachingTs.map((ts) => ts.id);
    const cur = Array.isArray(blocked[day]) ? blocked[day] : [];
    const allLocked = ids.length > 0 && ids.every((id) => cur.includes(id));
    const next = { ...blocked, [day]: allLocked ? [] : ids };
    if (!allLocked) {
      const hasLessons = ids.some((id) => lessonMap.has(`${day}|${id}`));
      if (hasLessons) {
        toast?.("Bu kunda ustozning darslari bor — jadval qayta tuzilganda ular boshqa joyga ko'chadi.", "warning");
      }
    }
    saveBlocked(next);
  }

  function clearAll() {
    if (!teacher) return;
    saveBlocked({});
    toast?.("Barcha qulflar ochildi", "success");
  }

  // ——— Statistika: talab qilinadigan soat (hovuz/parallel dedup bilan) ———
  const requiredHours = useMemo(() => {
    if (!teacher) return 0;
    const tid = teacher.id;
    let total = 0;
    const seen = new Set();
    classes.forEach((cls) => {
      (classSubjects[cls.id] || []).forEach((a) => {
        if (!a || !a.subjectId) return;
        const wh = Number(a.weeklyHours || 0);
        if (!wh) return;
        // Daraja guruhi (hovuz): bir guruh — bir marta
        if (a.levelGroupEnabled && a.levelGroupKey) {
          if ((a.levelGroups || []).some((g) => g && g.teacherId === tid)) {
            const key = `L|${a.subjectId}|${a.levelGroupKey}`;
            if (!seen.has(key)) { seen.add(key); total += wh; }
          }
          return;
        }
        // Parallel guruh (groupKey): bir guruh — bir marta
        if (a.groupKey) {
          if (a.teacherId === tid) {
            const key = `G|${a.subjectId}|${a.teacherId}|${a.roomId || ""}|${a.groupKey}`;
            if (!seen.has(key)) { seen.add(key); total += wh; }
          }
          return;
        }
        // Almashinuv (2 fan bitta vaqtda) — ikkala ustoz ham band
        if (a.splitEnabled && a.swapEnabled) {
          if (a.teacherId === tid || a.swapTeacherId === tid) total += wh;
          return;
        }
        // Hafta almashinuvi (juft/toq)
        if (a.weekAltEnabled) {
          const altH = Math.max(1, Math.min(Number(a.weekAltHours || 1), wh));
          if (a.teacherId === tid) total += wh;
          else if (a.weekAltTeacherId === tid) total += altH;
          return;
        }
        if (a.teacherId === tid) total += wh;
        if (a.splitEnabled && a.teacherId2 === tid) total += wh;
      });
    });
    return total;
  }, [teacher, classes, classSubjects]);

  const stats = useMemo(() => {
    if (!teacher) return { locked: 0, available: 0, totalCells: 0 };
    let locked = 0;
    let available = 0;
    let totalCells = 0;
    DAYS.forEach((day) => {
      if (offDays.has(day)) return;
      teachingTs.forEach((ts) => {
        totalCells += 1;
        if (isBlocked(day, ts.id)) locked += 1;
        else available += 1;
      });
    });
    return { locked, available, totalCells };
  }, [teacher, offDays, teachingTs, blocked]);

  const notEnough = teacher && requiredHours > 0 && stats.available < requiredHours;

  function lessonLabel(l) {
    const subj = subjectById.get(l.subjectId)?.name || l.subjectId;
    const cls = classIdsOf(l)
      .map((cid) => classById.get(cid)?.name || cid)
      .join(", ");
    return `${subj} · ${cls}`;
  }

  return (
    <div className="tav-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">🔒 Ustoz setkasi</h1>
          <p className="tav-subtitle">
            Ustozning band soatlarini qulflang — avtomatik jadval tuzishda bu kataklarga dars qo'yilmaydi.
            Dam olish kunlari Ustozlar sahifasida belgilanadi.
          </p>
        </div>
      </div>

      <div className="card tav-card">
        <div className="tav-toolbar">
          <label className="tav-select-label">
            Ustoz:
            <select
              className="tav-select"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
            >
              <option value="">— Ustozni tanlang —</option>
              {sortedTeachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          {teacher && (
            <button className="btn tav-btn-clear" type="button" onClick={clearAll}>
              🔓 Hammasini ochish
            </button>
          )}
        </div>

        {!teacher && (
          <div className="tav-empty">
            Setkani ko'rish va tahrirlash uchun ustozni tanlang.
          </div>
        )}

        {teacher && !teachingTs.length && (
          <div className="tav-empty">Avval Dars vaqtlari sahifasida soatlarni kiriting.</div>
        )}

        {teacher && teachingTs.length > 0 && (
          <>
            <div className="tav-stats">
              <div className="tav-stat">
                <span className="tav-stat-num">{requiredHours}</span>
                <span className="tav-stat-label">Talab qilinadigan soat</span>
              </div>
              <div className="tav-stat">
                <span className="tav-stat-num">{stats.available}</span>
                <span className="tav-stat-label">Ochiq katak</span>
              </div>
              <div className="tav-stat">
                <span className="tav-stat-num">{stats.locked}</span>
                <span className="tav-stat-label">Qulflangan katak</span>
              </div>
              {offDays.size > 0 && (
                <div className="tav-stat">
                  <span className="tav-stat-num">{[...offDays].length}</span>
                  <span className="tav-stat-label">Dam olish kuni</span>
                </div>
              )}
            </div>

            {notEnough && (
              <div className="tav-warning">
                ⚠️ Ochiq kataklar ({stats.available}) talab qilinadigan soatdan ({requiredHours}) kam —
                jadval tuzishda ba'zi darslar joylashmasligi yoki boshqa ustozga o'tishi mumkin.
              </div>
            )}

            <div className="tav-grid-wrap">
              <table className="tav-table">
                <thead>
                  <tr>
                    <th className="tav-th-slot">Soat</th>
                    {DAYS.map((day) => {
                      const off = offDays.has(day);
                      const ids = teachingTs.map((ts) => ts.id);
                      const cur = Array.isArray(blocked[day]) ? blocked[day] : [];
                      const allLocked = !off && ids.length > 0 && ids.every((id) => cur.includes(id));
                      return (
                        <th key={day} className={off ? "tav-th-off" : ""}>
                          <div className="tav-th-day">{day}</div>
                          {off ? (
                            <div className="tav-th-note">Dam olish</div>
                          ) : (
                            <button
                              className="tav-day-btn"
                              type="button"
                              onClick={() => toggleDay(day)}
                              title={allLocked ? "Kunni ochish" : "Butun kunni qulflash"}
                            >
                              {allLocked ? "🔓 Ochish" : "🔒 Qulflash"}
                            </button>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {slotGroups.map((g) => (
                    <Fragment key={g.id}>
                      {slotGroups.length > 1 && (
                        <tr className="tav-row-shift">
                          <td colSpan={DAYS.length + 1} className="tav-td-shift">
                            🕐 {g.name} · {g.range}
                          </td>
                        </tr>
                      )}
                      {g.slots.map((ts) => {
                        if (!isTeachingSlot(ts)) {
                          return (
                            <tr key={ts.id} className="tav-row-break">
                              <td className="tav-td-slot">
                                {ts.type === "lunch" ? "🍽" : "☕"} {ts.startTime}–{ts.endTime}
                              </td>
                              <td colSpan={DAYS.length} className="tav-td-break">
                                {ts.type === "lunch" ? "Obed" : "Tanaffus"}
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={ts.id}>
                            <td className="tav-td-slot">
                              <b>{slotNum(ts)}-dars</b>
                              <span className="tav-td-time">{ts.startTime}–{ts.endTime}</span>
                            </td>
                            {DAYS.map((day) => {
                              if (offDays.has(day)) {
                                return <td key={day} className="tav-cell tav-cell-off">—</td>;
                              }
                              const lockedCell = isBlocked(day, ts.id);
                              const lessons = lessonMap.get(`${day}|${ts.id}`) || [];
                              return (
                                <td
                                  key={day}
                                  className={
                                    "tav-cell " +
                                    (lockedCell ? "tav-cell-locked" : "tav-cell-open") +
                                    (lessons.length ? " tav-cell-haslesson" : "")
                                  }
                                  onClick={() => toggleSlot(day, ts.id)}
                                  title={lockedCell ? "Ochish uchun bosing" : "Qulflash uchun bosing"}
                                >
                                  <div className="tav-cell-top">
                                    <span className="tav-lock-icon">{lockedCell ? "🔒" : "🔓"}</span>
                                    {lockedCell && <span className="tav-lock-text">Qulflangan</span>}
                                  </div>
                                  {lessons.map((l, i) => (
                                    <div key={i} className="tav-lesson-chip">
                                      {lessonLabel(l)}
                                    </div>
                                  ))}
                                  {lockedCell && lessons.length > 0 && (
                                    <div className="tav-lesson-note">Qayta tuzishda ko'chadi</div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="tav-legend">
              <span><span className="tav-dot tav-dot-open" /> Ochiq — dars qo'yilishi mumkin</span>
              <span><span className="tav-dot tav-dot-locked" /> Qulflangan — dars qo'yilmaydi</span>
              <span><span className="tav-dot tav-dot-off" /> Dam olish kuni</span>
              <span className="tav-legend-note">
                Eslatma: qo'lda (manual) qo'yilgan va 🔒 qulflangan darslar generator uchun mustasno.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
