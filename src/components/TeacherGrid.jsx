// ═══════════════════════════════════════════════════════════════════
// USTOZ SETKASI — ustozni tanlab, uning hafta jadvalini ko'rish/tahrirlash.
//  • Bo'sh kataklar ＋ bilan ko'rinadi (qo'lda dars qo'shish)
//  • Dam olish kunlari butun ustun bloklanadi (dars qo'yib bo'lmaydi)
//  • Darsni tortib boshqa katakka tashlaganda:
//      – katak butunlay bo'sh bo'lsa → ko'chadi
//      – o'sha SINFda boshqa dars bo'lsa (boshqa ustozniki bo'lsa ham)
//        → ikki dars AVTOMATIK o'rin almashadi, bo'sh katak qolmaydi
//      – almashib bo'lmasa → sabab va tartiblangan yechimlar modali
//  • Har bir darsni 🔒 qulflash (avtomatik jadval tuzganda o'zgarmaydi)
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { DAYS } from "../utils/constants";
import { isTeachingSlot } from "../utils/scheduleGenerator";
import {
  classIdsOf, teacherIdsOf, collectCardEntries, unitOf, resolveMove, applyActions,
  softWarnings, checkPlace, findAutoPartner, onlyBusyReasons, unitLabel, slotLabel,
} from "../utils/moveResolver";

const cardKeyOf = (l) => [l.subjectId, l.groupKey || "", l.blockIndex ?? ""].join("__");

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

export default function TeacherGrid({
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
  onResolve,        // (data) => void — MoveResolveModal ni ochadi
}) {
  const [teacherId, setTeacherId] = useState(teachers[0]?.id || "");
  const [drag, setDrag] = useState(null);
  const [picked, setPicked] = useState(null);   // bosib tanlangan dars (drag ishlamasa)
  const active = drag || picked;                // hozir ko'chirilayotgan dars
  const [addCell, setAddCell] = useState(null);   // { day, slotId }
  const [form, setForm] = useState({ classId: "", subjectId: "", roomId: "", lock: true });

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const roomMap = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  const sortedTeachers = useMemo(
    () => [...teachers].sort((a, b) => String(a.name).localeCompare(String(b.name), "uz")),
    [teachers]
  );
  const sortedTimeslots = useMemo(
    () => [...timeslots].sort((a, b) => Number(a.lessonNumber || 0) - Number(b.lessonNumber || 0)),
    [timeslots]
  );

  const teacher = teachers.find((t) => t.id === teacherId) || null;
  const offDays = new Set(Array.isArray(teacher?.offDays) ? teacher.offDays : []);

  // ——— USTOZ SETKASI: qulflangan soatlar (teacher.blockedSlots) ———
  // Bu kataklar "Ustoz setkasi" sahifasida boshqariladi; shu yerda faqat
  // ko'rsatiladi va ularga dars qo'yish/ko'chirish taqiqlanadi.
  const blockedSlots = teacher?.blockedSlots && typeof teacher.blockedSlots === "object"
    ? teacher.blockedSlots : {};
  const isBlockedCell = (day, slotId) =>
    Array.isArray(blockedSlots[day]) && blockedSlots[day].includes(slotId);
  const blockedTotal = DAYS.reduce((n, day) => {
    if (offDays.has(day)) return n;
    const list = Array.isArray(blockedSlots[day]) ? blockedSlots[day] : [];
    return n + list.filter((sid) => sortedTimeslots.some((ts) => ts.id === sid && isTeachingSlot(ts))).length;
  }, 0);

  const ctx = {
    schedule, classes, subjects, teachers, rooms,
    timeslots: sortedTimeslots, lunchGroups, classSubjects,
  };

  // ——— Ustozning biriktirilgan sinf+fan juftliklari va soatlari ———
  const assignments = useMemo(() => {
    if (!teacherId) return [];
    const out = [];
    classes.forEach((cls) => {
      (classSubjects?.[cls.id] || []).forEach((a) => {
        if (!a?.subjectId) return;
        const roles = [];
        if (a.teacherId === teacherId) roles.push("asosiy");
        if (a.teacherId2 === teacherId) roles.push("2-guruh");
        if (a.swapEnabled && a.swapTeacherId === teacherId) roles.push("almashinuv");
        if (a.weekAltEnabled && a.weekAltTeacherId === teacherId) roles.push("juft/toq");
        if ((a.levelGroups || []).some((g) => g.teacherId === teacherId)) roles.push("daraja guruhi");
        if (!roles.length) return;
        const simple = a.teacherId === teacherId && !a.levelGroupEnabled && !a.splitEnabled && !a.swapEnabled;
        out.push({
          classId: cls.id,
          className: cls.name,
          subjectId: a.subjectId,
          subjectName: subjectMap.get(a.subjectId)?.name || "Fan",
          need: Number(a.weeklyHours || 0),
          roomId: a.roomId || "",
          roles,
          simple,
        });
      });
    });
    return out.sort((a, b) => String(a.className).localeCompare(String(b.className), "uz", { numeric: true }));
  }, [teacherId, classes, classSubjects, subjectMap]);

  function placedHours(classId, subjectId) {
    let n = 0;
    DAYS.forEach((day) => {
      sortedTimeslots.forEach((slot) => {
        const cell = schedule?.[day]?.[slot.id];
        if (Array.isArray(cell) && cell.some((l) => l.subjectId === subjectId && classIdsOf(l).includes(classId))) n += 1;
      });
    });
    return n;
  }

  const load = useMemo(() => {
    const rows = assignments.map((a) => ({ ...a, got: placedHours(a.classId, a.subjectId) }));
    const total = DAYS.reduce((sum, day) => sum + sortedTimeslots.reduce((s, slot) => {
      const cell = schedule?.[day]?.[slot.id] || [];
      return s + (cell.some((l) => teacherIdsOf(l).includes(teacherId)) ? 1 : 0);
    }, 0), 0);
    return { rows, total };
  }, [assignments, schedule, sortedTimeslots, teacherId]);

  // ——— Katakdagi ustoz darslari (karta bo'yicha guruhlangan) ———
  function cardsAt(day, slotId) {
    const cell = schedule?.[day]?.[slotId];
    if (!Array.isArray(cell)) return [];
    const mine = cell.filter((l) => teacherIdsOf(l).includes(teacherId));
    const map = new Map();
    mine.forEach((l) => {
      const k = cardKeyOf(l);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(l);
    });
    return [...map.values()].map((entries) => ({ entries, head: entries[0] }));
  }

  // Katak holati: 'off' | 'nonteaching' | 'free' | 'busy'
  function cellState(day, slot) {
    if (offDays.has(day)) return "off";
    if (!isTeachingSlot(slot)) return "nonteaching";
    if (cardsAt(day, slot.id).length) return "busy";
    return isBlockedCell(day, slot.id) ? "blocked" : "free";
  }

  // ═══ KO'CHIRISH: sudrash (drag) va bosib tanlash (pick) ═══
  function unitAt(day, slot, card) {
    const cell = schedule?.[day]?.[slot.id] || [];
    const entries = collectCardEntries(cell, card.head);
    return { day, slotId: slot.id, unit: unitOf(entries) };
  }

  function dragStart(e, day, slot, card) {
    const src = unitAt(day, slot, card);
    // Ba'zi brauzerlar dataTransfer bo'sh bo'lsa drag'ni boshlamaydi
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `${day}__${slot.id}`);
    } catch { /* eski brauzerlar */ }
    setPicked(null);
    // setState'ni keyingi kadrga suramiz — aks holda DOM drag boshlanishida
    // qayta chizilib, brauzer sudrashni bekor qiladi
    setTimeout(() => setDrag(src), 0);
  }

  function isPickedCard(day, slot, card) {
    if (!picked) return false;
    return picked.day === day && picked.slotId === slot.id && picked.unit.entries[0] === card.head;
  }

  // Kartani bosib tanlash / tanlovni bekor qilish
  function togglePick(day, slot, card) {
    if (!setSchedule) return;
    const src = unitAt(day, slot, card);
    if (picked && picked.day === day && picked.slotId === slot.id
      && picked.unit.entries[0] === src.unit.entries[0]) {
      setPicked(null);
      return;
    }
    setPicked(src);
    toast?.("Dars tanlandi — endi qaysi katakka qo'yishni bosing", "success");
  }

  // Maqsad katak tahlili — 'self' | 'off' | 'nt' | 'move' | 'swap' | 'no'
  function targetInfo(day, slot) {
    if (!active) return null;
    if (active.day === day && active.slotId === slot.id) return { kind: "self" };
    if (offDays.has(day)) return { kind: "off" };
    if (isBlockedCell(day, slot.id)) return { kind: "blocked" };
    if (!isTeachingSlot(slot)) return { kind: "nt" };

    const srcTs = sortedTimeslots.find((s) => s.id === active.slotId);
    const mine = cardsAt(day, slot.id);
    if (mine.length > 1) return { kind: "no", multi: true };

    const cell = schedule?.[day]?.[slot.id] || [];

    // 1) Ustozning o'z darsi turibdi — to'g'ridan-to'g'ri almashinuv
    if (mine.length === 1) {
      const partner = unitOf(collectCardEntries(cell, mine[0].head));
      const a = checkPlace(ctx, active.unit, day, slot, new Set(partner.entries));
      const b = checkPlace(ctx, partner, active.day, srcTs, new Set(active.unit.entries));
      return (!a.length && !b.length) ? { kind: "swap", partner } : { kind: "no", partner };
    }

    // 2) Katak ustoz uchun bo'sh — lekin sinf band bo'lishi mumkin
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

  // Ko'chirish paytida butun setka bo'yicha bir marta hisoblanadi
  const activeMap = useMemo(() => {
    const map = new Map();
    if (!active) return map;
    DAYS.forEach((day) => {
      sortedTimeslots.forEach((slot) => {
        map.set(`${day}__${slot.id}`, targetInfo(day, slot));
      });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, schedule, teacherId, sortedTimeslots]);

  function commitMove(day, slot) {
    const src = active;
    if (!src || !setSchedule) return;
    if (src.day === day && src.slotId === slot.id) { clearActive(); return; }

    const mine = cardsAt(day, slot.id);
    if (mine.length > 1) {
      onResolve?.({
        mode: "blocked",
        reasons: ["Bu katakda ustozning bir nechta darsi bor — avtomatik almashtirib bo'lmaydi. Avval birini o'chiring."],
        suggestions: [],
      });
      clearActive();
      return;
    }

    const cell = schedule?.[day]?.[slot.id] || [];
    const partnerUnit = mine.length === 1 ? unitOf(collectCardEntries(cell, mine[0].head)) : null;

    // autoSwap: maqsad katakda sinfni band qilib turgan dars bo'lsa — u sherik bo'ladi
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
      onResolve?.({
        mode: "confirm",
        title: lockedTouched
          ? "Qulflangan dars o'zgaradi"
          : (res.mode === "swap" ? "Almashinuvni tasdiqlang" : "Ko'chirishni tasdiqlang"),
        actions: res.actions,
        warnings,
      });
    } else {
      onResolve?.({ ...res, warnings });
    }
    clearActive();
  }


  function clearActive() {
    setDrag(null);
    setPicked(null);
  }

  // ——— Qulflash ———
  function setLock(day, slotId, card, value) {
    if (!setSchedule) return;
    const cell = schedule?.[day]?.[slotId] || [];
    const entries = collectCardEntries(cell, card.head);
    const next = { ...schedule, [day]: { ...(schedule?.[day] || {}) } };
    next[day][slotId] = cell.map((l) =>
      entries.includes(l) ? { ...l, locked: value, manual: value ? true : l.manual } : l
    );
    setSchedule(next);
    toast?.(value ? "Dars qulflandi 🔒" : "Qulf ochildi 🔓", "success");
  }

  function lockAll(value) {
    if (!setSchedule) return;
    let n = 0;
    const next = {};
    DAYS.forEach((day) => {
      next[day] = {};
      sortedTimeslots.forEach((slot) => {
        const cell = schedule?.[day]?.[slot.id] || [];
        next[day][slot.id] = cell.map((l) => {
          if (!teacherIdsOf(l).includes(teacherId)) return l;
          n += 1;
          return { ...l, locked: value, manual: value ? true : l.manual };
        });
      });
    });
    setSchedule(next);
    toast?.(value ? `${n} ta dars qulflandi 🔒` : `${n} ta darsning qulfi ochildi 🔓`, "success");
  }

  function removeCard(day, slotId, card) {
    if (!setSchedule) return;
    const cell = schedule?.[day]?.[slotId] || [];
    const entries = collectCardEntries(cell, card.head);
    const next = { ...schedule, [day]: { ...(schedule?.[day] || {}) } };
    next[day][slotId] = cell.filter((l) => !entries.includes(l));
    setSchedule(next);
    toast?.("Dars o'chirildi", "error");
  }

  // ——— Qo'lda dars qo'shish ———
  function openAdd(day, slotId) {
    setForm({ classId: "", subjectId: "", roomId: "", lock: true });
    setAddCell({ day, slotId });
  }

  const addOptions = useMemo(() => {
    if (!addCell) return [];
    return load.rows
      .filter((r) => r.simple && r.got < r.need)
      .map((r) => ({ ...r, key: `${r.classId}__${r.subjectId}` }));
  }, [addCell, load.rows]);

  const addPreview = useMemo(() => {
    if (!addCell || !form.classId || !form.subjectId) return null;
    const slot = sortedTimeslots.find((s) => s.id === addCell.slotId);
    const unit = unitOf([{
      subjectId: form.subjectId, classId: form.classId, classIds: [form.classId],
      teacherId, roomId: form.roomId || "",
    }]);
    const errs = checkPlace(ctx, unit, addCell.day, slot, new Set());
    return { errs, warns: softWarnings(ctx, unit, addCell.day), slot };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addCell, form, teacherId, schedule]);

  function addLesson() {
    if (!setSchedule || !addCell || !form.classId || !form.subjectId) return;
    const { day, slotId } = addCell;
    const next = { ...schedule, [day]: { ...(schedule?.[day] || {}) } };
    next[day][slotId] = [...(next[day][slotId] || []), {
      subjectId: form.subjectId,
      classId: form.classId,
      classIds: [form.classId],
      teacherId,
      roomId: form.roomId || "",
      manual: true,
      locked: Boolean(form.lock),
    }];
    setSchedule(next);
    setAddCell(null);
    toast?.(form.lock ? "Dars qo'shildi va qulflandi 🔒" : "Dars qo'shildi ✓", "success");
  }

  if (!sortedTeachers.length) {
    return (
      <div className="card empty-state">
        <div className="empty-state__icon">👨‍🏫</div>
        <p className="empty-state__message">Hali ustozlar qo'shilmagan.</p>
      </div>
    );
  }

  return (
    <div className="tgr-wrap">
      <div className="tgr-head card">
        <div className="tgr-field">
          <span className="tgr-label">Ustozni tanlang</span>
          <div className="tgr-select">
            <span className="tgr-select-icon">👨‍🏫</span>
            <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              {sortedTeachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        {setSchedule && (
          <div className="tgr-head-actions">
            <button type="button" className="tgr-btn tgr-btn-lock" onClick={() => lockAll(true)}>🔒 Barchasini qulflash</button>
            <button type="button" className="tgr-btn tgr-btn-unlock" onClick={() => lockAll(false)}>🔓 Qulfni ochish</button>
          </div>
        )}
      </div>

      {teacher && (
        <div className="tgr-main">
          <div className="tgr-table-card">
            {offDays.size > 0 && (
              <div className="tgr-offnote">
                🌙 Dam olish kunlari: <b>{[...offDays].join(", ")}</b> — bu kunlarga dars qo'yib bo'lmaydi.
              </div>
            )}
            {blockedTotal > 0 && (
              <div className="tgr-offnote">
                🔒 Ustoz setkasida <b>{blockedTotal}</b> ta soat qulflangan — u kataklarga dars qo'yilmaydi.
                Qulflarni «Ustoz setkasi» sahifasida boshqarasiz.
              </div>
            )}
            {picked && (
              <div className="tgr-offnote" style={{ background: "rgba(124,58,237,.14)", borderColor: "rgba(124,58,237,.45)", color: "#5b21b6", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span>✋ <b>{unitLabel(ctx, picked.unit)}</b> ({slotLabel(ctx, picked.day, picked.slotId)}) tanlandi — endi qo'yiladigan katakni bosing.</span>
                <button type="button" className="tgr-btn" onClick={() => setPicked(null)}>Bekor qilish</button>
              </div>
            )}
            <div className="tgr-offnote" style={{ background: "rgba(124,58,237,.08)", borderColor: "rgba(124,58,237,.28)", color: "#6d28d9" }}>
              ✋ Darsni <b>bosib tanlang</b>, so'ng qo'yiladigan katakni bosing (yoki sichqoncha bilan sudrang).
              ⇄ Darsni tortib boshqa katakka tashlang — o'sha sinfda dars bo'lsa (boshqa ustozniki bo'lsa ham)
              ikkalasi <b>avtomatik o'rin almashadi</b>, bo'sh katak qolmaydi. Almashib bo'lmasa — sabab va yechimlar ko'rsatiladi.
            </div>
            <div className="tgr-scroll">
              <table className="tgr-table">
                <thead>
                  <tr>
                    <th>Vaqt / Dars</th>
                    {DAYS.map((day) => (
                      <th key={day} className={offDays.has(day) ? "tgr-off-col" : ""}>
                        {day}
                        {offDays.has(day) && <span className="tgr-off-badge">Dam olish</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedTimeslots.map((slot) => (
                    <tr key={slot.id}>
                      <td className="tgr-time">
                        <strong>
                          {isTeachingSlot(slot)
                            ? `${slot.lessonNumber || ""}-dars`
                            : (slot.title || (slot.type === "lunch" ? "Obed" : "Tanaffus"))}
                        </strong>
                        <span>{slot.startTime || ""} - {slot.endTime || ""}</span>
                      </td>
                      {DAYS.map((day) => {
                        const state = cellState(day, slot);
                        const info = active ? (activeMap.get(`${day}__${slot.id}`) || null) : null;
                        const kind = info?.kind || null;
                        const cls = [
                          "tgr-cell",
                          state === "off" || state === "blocked" ? "tgr-cell-off" : "",
                          state === "nonteaching" ? "tgr-cell-nt" : "",
                          kind === "move" || kind === "swap" ? "tgr-drop-ok" : "",
                          kind === "no" || kind === "nt" ? "tgr-drop-no" : "",
                          kind === "off" || kind === "blocked" ? "tgr-drop-blocked" : "",
                        ].filter(Boolean).join(" ");
                        return (
                          <td
                            key={day}
                            className={cls}
                            style={{
                              ...(kind === "swap" ? { outline: "2px dashed rgba(124,58,237,.55)", outlineOffset: "-3px" } : null),
                              ...(picked && kind && kind !== "self" ? { cursor: "pointer" } : null),
                            }}
                            onDragOver={(e) => { if (drag && kind && kind !== "self") e.preventDefault(); }}
                            onDrop={(e) => { e.preventDefault(); if (drag) commitMove(day, slot); }}
                            onClick={() => { if (picked && kind && kind !== "self") commitMove(day, slot); }}
                          >
                            {state === "off" && <div className="tgr-blocked">🌙 Dam</div>}
                            {state === "blocked" && <div className="tgr-blocked">🔒 Qulflangan soat</div>}
                            {state === "nonteaching" && (
                              <div className="tgr-blocked">{slot.type === "lunch" ? "🍽️ Obed" : "Tanaffus"}</div>
                            )}
                            {(state === "free" || state === "busy") && (
                              <>
                                {cardsAt(day, slot.id).map((card, i) => {
                                  const l = card.head;
                                  const subj = subjectMap.get(l.subjectId)?.name || l.subjectName || "Fan";
                                  const clsNames = classIdsOf(l).map((id) => classMap.get(id)?.name).filter(Boolean).join(", ");
                                  return (
                                    <div
                                      key={i}
                                      className={`tgr-card ${l.locked ? "tgr-card-locked" : ""}`}
                                      draggable={Boolean(setSchedule)}
                                      style={isPickedCard(day, slot, card)
                                        ? { outline: "2px solid #7c3aed", outlineOffset: "1px", cursor: "grab" }
                                        : (setSchedule ? { cursor: "grab" } : undefined)}
                                      title="Sudrab ko'chiring yoki bosib tanlang"
                                      onDragStart={(e) => dragStart(e, day, slot, card)}
                                      onDragEnd={() => setDrag(null)}
                                      onClick={(e) => { e.stopPropagation(); togglePick(day, slot, card); }}
                                    >
                                      <div className="tgr-card-top">
                                        <span className="tgr-card-cls">{clsNames || "—"}</span>
                                        {setSchedule && (
                                          <span className="tgr-card-tools">
                                            <button type="button" title={l.locked ? "Qulfni ochish" : "Qulflash"}
                                              onClick={(e) => { e.stopPropagation(); setLock(day, slot.id, card, !l.locked); }}>
                                              {l.locked ? "🔒" : "🔓"}
                                            </button>
                                            <button type="button" title="O'chirish" className="tgr-x"
                                              onClick={(e) => { e.stopPropagation(); removeCard(day, slot.id, card); }}>✕</button>
                                          </span>
                                        )}
                                      </div>
                                      <div className="tgr-card-subj">{subj}</div>
                                      <div className="tgr-card-room">
                                        {l.roomId ? (roomMap.get(l.roomId)?.name || "Xona") : "Xonasiz"}
                                        {l.manual ? " · ✋" : ""}
                                      </div>
                                    </div>
                                  );
                                })}

                                {kind === "swap" && info?.partner && (
                                  <span style={SWAP_CHIP}>
                                    ⇄ {unitLabel(ctx, info.partner)} bilan almashadi
                                    {info.auto ? " (sinf tomonidan)" : ""}
                                  </span>
                                )}

                                {setSchedule && !picked && (
                                  <button type="button" className="tgr-add"
                                    onClick={(e) => { e.stopPropagation(); openAdd(day, slot.id); }}
                                    title="Qo'lda dars qo'shish">＋</button>
                                )}
                              </>
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

          <aside className="tgr-side">
            <div className="tgr-side-head">
              <div className="tgr-side-name">{teacher.name}</div>
              <div className="tgr-side-total">Jami joylangan: <b>{load.total}</b> soat</div>
            </div>
            {load.rows.length === 0 ? (
              <div className="tgr-side-empty">Bu ustozga fan biriktirilmagan.</div>
            ) : (
              <div className="tgr-side-list">
                {load.rows.map((r, i) => {
                  const left = Math.max(0, r.need - r.got);
                  return (
                    <div key={i} className={`tgr-side-row ${left > 0 ? "tgr-side-row-left" : ""}`}>
                      <div className="tgr-side-row-top">
                        <b>{r.className}</b> · {r.subjectName}
                      </div>
                      <div className="tgr-side-row-meta">
                        {r.got}/{r.need} soat
                        {left > 0 ? <span className="tgr-left">{left} qoldi</span> : <span className="tgr-done">✓ to'liq</span>}
                      </div>
                      {r.roles.length > 1 || !r.simple ? (
                        <div className="tgr-side-role">{r.roles.join(", ")}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="tgr-side-tip">
              Bo'sh katakdagi <b>＋</b> orqali dars qo'shing, so'ng <b>🔒 Barchasini qulflash</b>ni bosing —
              avtomatik jadval tuzganda bu darslar joyidan qimirlamaydi.
            </div>
          </aside>
        </div>
      )}

      {addCell && (
        <div className="mvr-overlay" onClick={() => setAddCell(null)}>
          <div className="mvr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mvr-head mvr-head-add">
              <span className="mvr-head-icon">✋</span>
              <div>
                <div className="mvr-title">Qo'lda dars qo'shish</div>
                <div className="mvr-sub">
                  {teacher?.name} · {addCell.day} · {addPreview?.slot?.lessonNumber}-dars
                </div>
              </div>
            </div>
            <div className="mvr-body">
              {addOptions.length === 0 ? (
                <div className="mvr-none">
                  Bu ustozning barcha oddiy fan soatlari to'liq joylangan (yoki fanlari guruh/daraja
                  guruhli — ular sinf setkasidan qo'yiladi).
                </div>
              ) : (
                <>
                  <label className="form-label">Sinf va fan (faqat tushmagan soatlar)</label>
                  <select className="form-control" value={`${form.classId}__${form.subjectId}`}
                    onChange={(e) => {
                      const [cid, sid] = e.target.value.split("__");
                      const opt = addOptions.find((o) => o.classId === cid && o.subjectId === sid);
                      setForm({ ...form, classId: cid || "", subjectId: sid || "", roomId: opt?.roomId || "" });
                    }}>
                    <option value="__">— tanlang —</option>
                    {addOptions.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.className} · {o.subjectName} — {o.need - o.got} soat qoldi
                      </option>
                    ))}
                  </select>

                  <label className="form-label" style={{ marginTop: 10, display: "block" }}>Xona (ixtiyoriy)</label>
                  <select className="form-control" value={form.roomId}
                    onChange={(e) => setForm({ ...form, roomId: e.target.value })}>
                    <option value="">Xonasiz</option>
                    {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>

                  <label className="tgr-check">
                    <input type="checkbox" checked={form.lock}
                      onChange={(e) => setForm({ ...form, lock: e.target.checked })} />
                    🔒 Darhol qulflab qo'yish (avtomatik jadvalda o'zgarmaydi)
                  </label>

                  {addPreview && addPreview.errs.length > 0 && (
                    <div className="mvr-reasons">
                      {addPreview.errs.map((e, i) => <div className="mvr-reason" key={i}>• {e.msg}</div>)}
                    </div>
                  )}
                  {addPreview && !addPreview.errs.length && addPreview.warns.length > 0 && (
                    <div className="mvr-warns">
                      {addPreview.warns.map((w, i) => <div className="mvr-warn" key={i}>⚠️ {w}</div>)}
                    </div>
                  )}
                  {addPreview && !addPreview.errs.length && !addPreview.warns.length && form.subjectId && (
                    <div className="mvr-okline">✓ Bu katakka qo'yish mumkin — hech qanday to'qnashuv yo'q.</div>
                  )}
                </>
              )}
            </div>
            <div className="mvr-foot">
              <button type="button" className="mvr-btn mvr-btn-ghost" onClick={() => setAddCell(null)}>Yopish</button>
              {addOptions.length > 0 && (
                <button type="button" className="mvr-btn mvr-btn-primary"
                  disabled={!form.subjectId || Boolean(addPreview?.errs?.length)}
                  onClick={addLesson}>
                  Qo'shish
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
