// ═══════════════════════════════════════════════════════════════════
// MOVE RESOLVER — darslarni ko'chirish/almashtirish yagona dvigateli
// Sinf setkasi va Ustoz setkasi ikkalasi ham shu moduldan foydalanadi.
//
// Hard cheklovlar: ustoz/sinf dam kuni, obed, smena (timeslot.classIds),
// ustoz/sinf/xona bandligi.
//
// YANGI: avtomatik "sinf-tomon almashinuvi" — ustoz setkasida maqsad katak
// bo'sh ko'rinsa ham, o'sha sinfda boshqa ustozning darsi bo'lsa, ikki dars
// AVTOMATIK o'rin almashadi (bo'sh katak qolmaydi). Almashinuv imkonsiz
// bo'lsa — tartiblangan yechimlar: to'g'ri swap → to'siqni surish (zanjir)
// → uch tomonlama aylanma almashinuv → muqobil bo'sh kataklar.
// ═══════════════════════════════════════════════════════════════════
import { DAYS } from "./constants";
import { isTeachingSlot, classHasLunchAt } from "./scheduleGenerator";

export function classIdsOf(lesson) {
  return Array.isArray(lesson?.classIds) ? lesson.classIds : [lesson?.classId].filter(Boolean);
}

// Darsda band bo'ladigan barcha ustozlar (juft/toq almashinuvida ikkalasi ham)
export function teacherIdsOf(lesson) {
  const ids = [];
  if (lesson?.teacherId) ids.push(lesson.teacherId);
  if (lesson?.alternating && lesson?.altTeacherId) ids.push(lesson.altTeacherId);
  return ids;
}

export function slotAllowsClass(slot, classId) {
  const ids = Array.isArray(slot?.classIds) ? slot.classIds : [];
  return ids.length === 0 || ids.includes(classId);
}

// Bitta "karta" — Schedule.jsx dagi groupLessons kaliti bilan bir xil
export function sameCard(a, b) {
  return (
    a.subjectId === b.subjectId &&
    (a.groupKey || "") === (b.groupKey || "") &&
    String(a.blockIndex ?? "") === String(b.blockIndex ?? "")
  );
}

// Katakdan kartaning barcha qismlarini (guruh/daraja guruh entrylarini) yig'adi
export function collectCardEntries(cell = [], card, classId = null) {
  return (Array.isArray(cell) ? cell : []).filter(
    (l) => l && sameCard(l, card) && (!classId || classIdsOf(l).includes(classId))
  );
}

// Entrylar to'plamidan "birlik" yasaydi — validatsiya shu birlik ustida ishlaydi
export function unitOf(entries = []) {
  const cSet = new Set();
  const tSet = new Set();
  const rSet = new Set();
  let locked = false;
  let manual = false;
  let swap = false;
  entries.forEach((l) => {
    classIdsOf(l).forEach((c) => cSet.add(c));
    teacherIdsOf(l).forEach((t) => tSet.add(t));
    if (l.roomId) rSet.add(l.roomId);
    if (l.locked) locked = true;
    if (l.manual) manual = true;
    if (l.swap) swap = true;
  });
  return {
    entries,
    classIds: [...cSet],
    teacherIds: [...tSet],
    roomIds: [...rSet],
    subjectId: entries[0]?.subjectId || "",
    locked,
    manual,
    swap,
  };
}

// ═══ NOM YORLIQLARI (xabarlar uchun) ═══
export function classNamesOf(ctx, unit) {
  const names = (unit?.classIds || [])
    .map((id) => (ctx.classes || []).find((c) => c.id === id)?.name)
    .filter(Boolean);
  return names.length ? names.join(", ") : "sinf";
}

export function subjectNameOf(ctx, unit) {
  const sid = unit?.subjectId;
  const s = (ctx.subjects || []).find((x) => x.id === sid);
  return s?.name || unit?.entries?.[0]?.subjectName || "Fan";
}

export function teacherNamesOf(ctx, unit) {
  const names = (unit?.teacherIds || [])
    .map((id) => (ctx.teachers || []).find((t) => t.id === id)?.name)
    .filter(Boolean);
  return names.join(", ");
}

// «8-A · Matematika»
export function unitLabel(ctx, unit) {
  return `${classNamesOf(ctx, unit)} · ${subjectNameOf(ctx, unit)}`;
}

// «Dushanba 2-dars»
export function slotLabel(ctx, day, slotId) {
  const ts = (ctx.timeslots || []).find((s) => s.id === slotId);
  return `${day} ${ts?.lessonNumber ?? "?"}-dars`;
}

// ═══ ASOSIY VALIDATSIYA ═══
// unit'ni (day, slot) ga qo'yish mumkinmi? ignore — hisobga olinmaydigan
// entrylar (masalan, swap sherigi — u baribir ketadi).
export function checkPlace(ctx, unit, day, slot, ignore = new Set()) {
  const { schedule, classes, teachers, lunchGroups } = ctx;
  const errs = [];
  const clsName = (id) => classes.find((c) => c.id === id)?.name || "sinf";
  const tName = (id) => teachers.find((t) => t.id === id)?.name || "ustoz";

  if (!slot) return [{ code: "NO_SLOT", msg: "Vaqt sloti topilmadi" }];
  if (!isTeachingSlot(slot)) {
    return [{
      code: "NOT_TEACHING",
      msg: slot.type === "lunch" ? "Bu vaqt — obed, dars qo'yilmaydi" : "Bu vaqt — tanaffus, dars qo'yilmaydi",
    }];
  }

  unit.classIds.forEach((cid) => {
    if (!slotAllowsClass(slot, cid)) {
      errs.push({ code: "SHIFT", msg: `${clsName(cid)}: bu vaqt boshqa smenaga tegishli` });
    }
    const cls = classes.find((c) => c.id === cid);
    if (Array.isArray(cls?.offDays) && cls.offDays.includes(day)) {
      errs.push({ code: "CLASS_OFF", msg: `${clsName(cid)}: ${day} — sinfning dam kuni` });
    }
    if (classHasLunchAt(slot, cid, lunchGroups, day)) {
      errs.push({ code: "LUNCH", msg: `${clsName(cid)}: bu vaqt — obed/dam olish vaqti` });
    }
  });

  unit.teacherIds.forEach((tid) => {
    const t = teachers.find((x) => x.id === tid);
    if (Array.isArray(t?.offDays) && t.offDays.includes(day)) {
      errs.push({ code: "TEACHER_OFF", msg: `${tName(tid)}: ${day} — ustozning dam olish kuni` });
    }
  });

  const cell = schedule?.[day]?.[slot.id] || [];
  cell.forEach((l) => {
    if (ignore.has(l) || unit.entries.includes(l)) return;
    const lc = classIdsOf(l);
    if (unit.classIds.some((c) => lc.includes(c))) {
      errs.push({ code: "CLASS_BUSY", msg: `${lc.map(clsName).join(", ")}: bu vaqtda sinfda boshqa dars bor`, lesson: l });
    }
    const lt = teacherIdsOf(l);
    unit.teacherIds.forEach((tid) => {
      if (lt.includes(tid)) {
        errs.push({ code: "TEACHER_BUSY", msg: `${tName(tid)} bu vaqtda band: ${lc.map(clsName).join(", ")}`, lesson: l });
      }
    });
    unit.roomIds.forEach((rid) => {
      if (l.roomId === rid) errs.push({ code: "ROOM_BUSY", msg: "Xona bu vaqtda band", lesson: l });
    });
  });

  const seen = new Set();
  return errs.filter((e) => {
    if (seen.has(e.msg)) return false;
    seen.add(e.msg);
    return true;
  });
}

// Faqat bandlik sabab bo'lsa — almashtirish orqali hal qilsa bo'ladi
const BUSY_CODES = ["CLASS_BUSY", "TEACHER_BUSY", "ROOM_BUSY"];
export function onlyBusyReasons(errs = []) {
  return errs.length > 0 && errs.every((e) => BUSY_CODES.includes(e.code));
}

// Maqsad katakdagi unit bilan to'qnashadigan kartalar (birliklar) ro'yxati
export function conflictingCards(ctx, unit, day, slot, ignore = new Set()) {
  const cell = ctx.schedule?.[day]?.[slot.id] || [];
  const cards = new Map();
  cell.forEach((l) => {
    if (ignore.has(l) || unit.entries.includes(l)) return;
    const conflicts =
      classIdsOf(l).some((c) => unit.classIds.includes(c)) ||
      teacherIdsOf(l).some((t) => unit.teacherIds.includes(t)) ||
      (l.roomId && unit.roomIds.includes(l.roomId));
    if (!conflicts) return;
    const k = [l.subjectId, l.groupKey || "", l.blockIndex ?? ""].join("__");
    if (!cards.has(k)) cards.set(k, []);
    cards.get(k).push(l);
  });
  return [...cards.values()].map(unitOf);
}

// ═══ AVTOMATIK SHERIK ═══
// Maqsad katakda ustozning darsi ko'rinmasa ham, o'sha sinfni band qilib
// turgan YAGONA kartani topadi — shu karta bilan avtomatik almashtiriladi.
export function findAutoPartner(ctx, unit, day, slot) {
  if (!slot || !isTeachingSlot(slot)) return null;
  const blockers = conflictingCards(ctx, unit, day, slot, new Set());
  return blockers.length === 1 ? blockers[0] : null;
}

// Unit uchun to'liq bo'sh muqobil kataklar
export function findAlternatives(ctx, unit, exclude = null, limit = 6, ignore = new Set()) {
  const ts = [...(ctx.timeslots || [])].sort(
    (a, b) => Number(a.lessonNumber || 0) - Number(b.lessonNumber || 0)
  );
  const out = [];
  for (const day of DAYS) {
    for (const slot of ts) {
      if (!isTeachingSlot(slot)) continue;
      if (exclude && exclude.day === day && exclude.slotId === slot.id) continue;
      const errs = checkPlace(ctx, unit, day, slot, ignore);
      if (!errs.length) {
        out.push({ day, slotId: slot.id, lessonNumber: slot.lessonNumber });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

// ═══ YUMSHOQ OGOHLANTIRISHLAR (bloklamaydi) ═══
export function softWarnings(ctx, unit, day) {
  const warns = [];
  if (unit.classIds.length > 1) {
    warns.push("Bu parallel/guruh dars — barcha ishtirokchi sinflarda birga ko'chadi.");
  }
  const anyDouble = unit.entries.some((l) => Number(l.blockSize) === 2);
  if (anyDouble) {
    warns.push("Bu juft (2 soatlik) darsning bir qismi — ikkinchi qismi joyida qoladi.");
  }
  // "Ora kunda": qo'shni kunda shu fan bo'lsa oraliq buziladi
  const dIdx = DAYS.indexOf(day);
  const cs = ctx.classSubjects || {};
  unit.classIds.forEach((cid) => {
    const a = (cs[cid] || []).find((x) => x.subjectId === unit.subjectId);
    if (!a || !a.spacedDays) return;
    [dIdx - 1, dIdx + 1].forEach((nd) => {
      if (nd < 0 || nd >= DAYS.length) return;
      const nday = DAYS[nd];
      const has = (ctx.timeslots || []).some((s) => {
        const cell = ctx.schedule?.[nday]?.[s.id] || [];
        return cell.some(
          (l) => l.subjectId === unit.subjectId && classIdsOf(l).includes(cid) && !unit.entries.includes(l)
        );
      });
      if (has) warns.push(`«Ora kunda» sozlamasi: ${nday} kuni ham shu fan bor — kun oralig'i buziladi.`);
    });
  });
  return [...new Set(warns)];
}

// ═══ HARAKATLARNI QO'LLASH (pure — yangi schedule qaytaradi) ═══
// actions: [{ entries, fromDay, fromSlotId, toDay, toSlotId }]
export function applyActions(schedule, actions) {
  const next = {};
  Object.keys(schedule || {}).forEach((day) => {
    next[day] = {};
    Object.keys(schedule[day] || {}).forEach((sid) => {
      next[day][sid] = [...(schedule[day][sid] || [])];
    });
  });
  (Array.isArray(actions) ? actions : []).forEach(({ entries, fromDay, fromSlotId, toDay, toSlotId }) => {
    if (!next[fromDay]) next[fromDay] = {};
    if (!Array.isArray(next[fromDay][fromSlotId])) next[fromDay][fromSlotId] = [];
    next[fromDay][fromSlotId] = next[fromDay][fromSlotId].filter((l) => !entries.includes(l));
    if (!next[toDay]) next[toDay] = {};
    if (!Array.isArray(next[toDay][toSlotId])) next[toDay][toSlotId] = [];
    next[toDay][toSlotId] = [...next[toDay][toSlotId], ...entries];
  });
  return next;
}

// ═══ ALMASHINUVNI TEKSHIRISH ═══
// A (src) ↔ B (partner) — ikkala yo'nalish ham mustaqil tekshiriladi
export function checkSwap(ctx, src, dst, partner) {
  const dstTs = (ctx.timeslots || []).find((s) => s.id === dst.slotId);
  const srcTs = (ctx.timeslots || []).find((s) => s.id === src.slotId);
  const aErrs = checkPlace(ctx, src.unit, dst.day, dstTs, new Set(partner.entries));
  const bErrs = checkPlace(ctx, partner, src.day, srcTs, new Set(src.unit.entries));
  return { ok: !aErrs.length && !bErrs.length, aErrs, bErrs };
}

// ═══ ASOSIY KIRISH NUQTASI ═══
// src = { day, slotId, unit }
// dst = { day, slotId, partnerUnit|null, autoSwap?: true }
// Natija: { ok, mode: 'move'|'swap'|'blocked', actions?, partner?, auto?, reasons?, suggestions? }
export function resolveMove(ctx, src, dst) {
  const dstTs = (ctx.timeslots || []).find((s) => s.id === dst.slotId);
  const srcTs = (ctx.timeslots || []).find((s) => s.id === src.slotId);
  let partner = dst.partnerUnit || null;
  let auto = false;
  const autoSwap = dst.autoSwap !== false;

  // Sherik ko'rsatilmagan bo'lsa — avval oddiy ko'chirishni sinaymiz
  let moveErrs = [];
  if (!partner) {
    moveErrs = checkPlace(ctx, src.unit, dst.day, dstTs, new Set());
    if (!moveErrs.length) {
      return {
        ok: true,
        mode: "move",
        actions: [
          { entries: src.unit.entries, fromDay: src.day, fromSlotId: src.slotId, toDay: dst.day, toSlotId: dst.slotId },
        ],
      };
    }
    // Faqat bandlik to'sqinlik qilsa — sinf tomonidagi darsni sherik qilib olamiz
    if (autoSwap && onlyBusyReasons(moveErrs)) {
      const found = findAutoPartner(ctx, src.unit, dst.day, dstTs);
      if (found) {
        partner = found;
        auto = true;
      }
    }
  }

  if (partner) {
    const { ok, aErrs, bErrs } = checkSwap(ctx, src, dst, partner);
    if (ok) {
      return {
        ok: true,
        mode: "swap",
        auto,
        partner,
        actions: [
          { entries: src.unit.entries, fromDay: src.day, fromSlotId: src.slotId, toDay: dst.day, toSlotId: dst.slotId },
          { entries: partner.entries, fromDay: dst.day, fromSlotId: dst.slotId, toDay: src.day, toSlotId: src.slotId },
        ],
      };
    }
    const reasonObjs = [...aErrs, ...bErrs];
    return buildSuggestions(ctx, src, dst, reasonObjs.length ? reasonObjs : moveErrs);
  }

  return buildSuggestions(ctx, src, dst, moveErrs);
}

// ═══ UCH TOMONLAMA AYLANMA ALMASHINUV ═══
// A → dst, B (dst dagi to'siq) → uchinchi katak, C (u yerdagi dars) → A ning joyi
function tryRotations(ctx, src, dst, b, limit = 3) {
  const out = [];
  const dstTs = (ctx.timeslots || []).find((s) => s.id === dst.slotId);
  const srcTs = (ctx.timeslots || []).find((s) => s.id === src.slotId);
  if (!dstTs || !srcTs) return out;

  // A maqsad katakka (B ketgandan keyin) tushishi shart
  if (checkPlace(ctx, src.unit, dst.day, dstTs, new Set(b.entries)).length) return out;

  const ts = [...(ctx.timeslots || [])].sort(
    (a, z) => Number(a.lessonNumber || 0) - Number(z.lessonNumber || 0)
  );

  for (const day of DAYS) {
    for (const slot of ts) {
      if (!isTeachingSlot(slot)) continue;
      if (day === dst.day && slot.id === dst.slotId) continue;
      if (day === src.day && slot.id === src.slotId) continue;

      const blockers = conflictingCards(ctx, b, day, slot, new Set());
      if (blockers.length !== 1) continue;
      const c = blockers[0];
      if (c.locked) continue;
      if (c.entries.some((e) => src.unit.entries.includes(e) || b.entries.includes(e))) continue;

      // B → (day, slot), C ketadi
      if (checkPlace(ctx, b, day, slot, new Set(c.entries)).length) continue;
      // C → A ning joyi (A ketadi)
      if (checkPlace(ctx, c, src.day, srcTs, new Set(src.unit.entries)).length) continue;

      out.push({
        type: "rotate",
        lockedInvolved: Boolean(b.locked || c.locked),
        changes: 3,
        label:
          `Uch tomonlama almashinuv: ${unitLabel(ctx, src.unit)} → ${slotLabel(ctx, dst.day, dst.slotId)}, ` +
          `${unitLabel(ctx, b)} → ${day} ${slot.lessonNumber}-dars, ` +
          `${unitLabel(ctx, c)} → ${slotLabel(ctx, src.day, src.slotId)}`,
        actions: [
          { entries: c.entries, fromDay: day, fromSlotId: slot.id, toDay: src.day, toSlotId: src.slotId },
          { entries: b.entries, fromDay: dst.day, fromSlotId: dst.slotId, toDay: day, toSlotId: slot.id },
          { entries: src.unit.entries, fromDay: src.day, fromSlotId: src.slotId, toDay: dst.day, toSlotId: dst.slotId },
        ],
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// Qo'yib bo'lmaganda — minimal o'zgarishli yechimlar ro'yxati
function buildSuggestions(ctx, src, dst, reasonObjs) {
  const suggestions = [];
  const dstTs = (ctx.timeslots || []).find((s) => s.id === dst.slotId);
  const srcTs = (ctx.timeslots || []).find((s) => s.id === src.slotId);

  const hardStop = reasonObjs.some((r) =>
    ["NOT_TEACHING", "SHIFT", "CLASS_OFF", "TEACHER_OFF", "LUNCH", "NO_SLOT"].includes(r.code)
  );

  if (!hardStop && dstTs && srcTs) {
    const blockers = conflictingCards(ctx, src.unit, dst.day, dstTs, new Set());

    if (blockers.length === 1) {
      const b = blockers[0];

      // 1) To'g'ridan-to'g'ri o'zaro almashtirish
      const { ok, aErrs } = checkSwap(ctx, src, dst, b);
      if (ok) {
        suggestions.push({
          type: "swap",
          lockedInvolved: b.locked,
          changes: 2,
          label: `O'zaro almashtirish: ${unitLabel(ctx, src.unit)} (${slotLabel(ctx, src.day, src.slotId)}) ↔ ${unitLabel(ctx, b)} (${slotLabel(ctx, dst.day, dst.slotId)})`,
          actions: [
            { entries: src.unit.entries, fromDay: src.day, fromSlotId: src.slotId, toDay: dst.day, toSlotId: dst.slotId },
            { entries: b.entries, fromDay: dst.day, fromSlotId: dst.slotId, toDay: src.day, toSlotId: src.slotId },
          ],
        });
      } else {
        // 2) To'siqni bo'sh katakka surib, joy ochish (zanjir, chuqurlik 2)
        if (!aErrs.length && !b.locked && !b.swap) {
          const homes = findAlternatives(ctx, b, { day: dst.day, slotId: dst.slotId }, 3, new Set(src.unit.entries));
          homes.forEach((h) => {
            suggestions.push({
              type: "chain",
              changes: 2,
              label: `${unitLabel(ctx, b)} darsini ${h.day} ${h.lessonNumber}-darsga surib, joy ochish (${slotLabel(ctx, src.day, src.slotId)} bo'sh qoladi)`,
              actions: [
                { entries: b.entries, fromDay: dst.day, fromSlotId: dst.slotId, toDay: h.day, toSlotId: h.slotId },
                { entries: src.unit.entries, fromDay: src.day, fromSlotId: src.slotId, toDay: dst.day, toSlotId: dst.slotId },
              ],
            });
          });
        }
        // 3) Uch tomonlama aylanma almashinuv
        if (!b.locked) {
          tryRotations(ctx, src, dst, b, 2).forEach((r) => suggestions.push(r));
        }
      }
    } else if (blockers.length > 1) {
      // Bir nechta to'siq — har birining nomini ko'rsatamiz (foydalanuvchi bilib tursin)
      reasonObjs.push({
        code: "MULTI",
        msg: `Maqsad katakda ${blockers.length} ta to'siq dars bor: ${blockers.map((x) => unitLabel(ctx, x)).join("; ")}`,
      });
    }
  }

  // 4) Ko'chirilayotgan dars uchun muqobil bo'sh kataklar
  findAlternatives(ctx, src.unit, { day: src.day, slotId: src.slotId }, 5).forEach((h) => {
    suggestions.push({
      type: "alt",
      changes: 1,
      label: `Bu darsni ${h.day} ${h.lessonNumber}-darsga qo'yish`,
      actions: [
        { entries: src.unit.entries, fromDay: src.day, fromSlotId: src.slotId, toDay: h.day, toSlotId: h.slotId },
      ],
    });
  });

  // Tartib: avval foydalanuvchi mo'ljallagan katakni saqlaydigan yechimlar
  const RANK = { swap: 0, rotate: 1, chain: 2, alt: 3 };
  suggestions.sort((x, y) => {
    const r = (RANK[x.type] ?? 9) - (RANK[y.type] ?? 9);
    return r !== 0 ? r : x.changes - y.changes;
  });
  return {
    ok: false,
    mode: "blocked",
    reasons: [...new Set(reasonObjs.map((r) => r.msg))],
    suggestions: suggestions.slice(0, 6),
  };
}