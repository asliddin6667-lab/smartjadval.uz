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
import { slotDisplayNumber } from "./shiftSlots";

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
  return `${day} ${slotDisplayNumber(ts) ?? "?"}-dars`;
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
    // Ustoz setkasida qulflangan soat — bu katakka dars qo'yilmaydi
    const bs = t?.blockedSlots;
    if (bs && Array.isArray(bs[day]) && bs[day].includes(slot.id)) {
      errs.push({ code: "TEACHER_BLOCKED", msg: `${tName(tid)}: bu soat Ustoz setkasida qulflangan — dars qo'yilmaydi` });
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

// ═══════════════════════════════════════════════════════════════════
// SMART MINIMAL SWAP
// Foydalanuvchi tanlagan A ↔ B almashinuvi MAJBURIY saqlanadi.
// To'siq darslar minimal cost bilan zanjirli ko'chiriladi (chuqurlik ≤ 5),
// affected sinf-kunlarda YANGI bo'sh soat paydo bo'lmaydi, locked darsga
// tegilmaydi. Qidiruv vaqtinchalik nusxada (applyActions — pure) boradi,
// original jadval o'zgarmaydi — ALL OR NOTHING.
// Cost: qo'shimcha dars = +10, boshqa kunga = +20, shu kun ichida = +5,
// yangi ustoz jadvali = +5, yangi sinf = +10. Hard constraint = INVALID.
// ═══════════════════════════════════════════════════════════════════
const SMART_MAX_DEPTH = 5;
const SMART_MAX_STATES = 600;
const SMART_CANDS = 8;

let smartUidSeq = 1;
const smartUidMap = new WeakMap();
function smartUid(lesson) {
  if (!smartUidMap.has(lesson)) smartUidMap.set(lesson, smartUidSeq++);
  return smartUidMap.get(lesson);
}

function teachingSorted(ctx) {
  return [...(ctx.timeslots || [])]
    .filter(isTeachingSlot)
    .sort((a, b) => Number(a.lessonNumber || 0) - Number(b.lessonNumber || 0));
}

// Sinf-kun "oyna" bahosi: bosh bo'shliq + ichki bo'shliqlar soni.
// 0 = darslar 1-ruxsat etilgan slotdan boshlab uzluksiz.
function classGapScore(ctx, sch, classId, day) {
  const cls = (ctx.classes || []).find((c) => c.id === classId);
  if (Array.isArray(cls?.offDays) && cls.offDays.includes(day)) return 0;
  const slots = teachingSorted(ctx).filter(
    (s) => slotAllowsClass(s, classId) && !classHasLunchAt(s, classId, ctx.lunchGroups, day)
  );
  const busy = [];
  slots.forEach((s, i) => {
    const cell = sch?.[day]?.[s.id] || [];
    if (cell.some((l) => classIdsOf(l).includes(classId))) busy.push(i);
  });
  if (!busy.length) return 0;
  const first = busy[0];
  const last = busy[busy.length - 1];
  return first + (last - first + 1 - busy.length);
}

function movesToActions(moves) {
  return moves.map((m) => ({
    entries: m.unit.entries, fromDay: m.fromDay, fromSlotId: m.fromSlotId, toDay: m.toDay, toSlotId: m.toSlotId,
  }));
}

// Spec bo'yicha cost modeli
function smartCost(src, partner, moves) {
  const affT = new Set([...src.unit.teacherIds, ...(partner ? partner.teacherIds : [])]);
  const affC = new Set([...src.unit.classIds, ...(partner ? partner.classIds : [])]);
  let cost = 0;
  moves.forEach((m) => {
    cost += 10;
    cost += m.fromDay === m.toDay ? 5 : 20;
    if (m.unit.teacherIds.some((t) => !affT.has(t))) cost += 5;
    m.unit.teacherIds.forEach((t) => affT.add(t));
    m.unit.classIds.forEach((c) => {
      if (!affC.has(c)) { cost += 10; affC.add(c); }
    });
  });
  return cost;
}

function smartStateHash(moves) {
  return moves
    .map((m) => `${smartUid(m.unit.entries[0])}@${m.toDay}#${m.toSlotId}`)
    .sort()
    .join("|");
}

// Unit hozir temp jadvalning qayerida turibdi (entries identity bo'yicha)
function findUnitLocation(sch, unit) {
  const probe = unit.entries[0];
  for (const day of DAYS) {
    const dayObj = sch?.[day] || {};
    for (const sid of Object.keys(dayObj)) {
      if ((dayObj[sid] || []).includes(probe)) return { day, slotId: sid };
    }
  }
  return null;
}

// Joylashtirilgan birliklar bilan to'qnashayotgan kartalar (unique)
function smartConflicts(tempCtx, placedUnits) {
  const found = [];
  const seen = new Set();
  for (const p of placedUnits) {
    const slot = (tempCtx.timeslots || []).find((s) => s.id === p.slotId);
    if (!slot) continue;
    const cards = conflictingCards(tempCtx, p.unit, p.day, slot, new Set());
    for (const c of cards) {
      const k = smartUid(c.entries[0]);
      if (seen.has(k)) continue;
      seen.add(k);
      found.push(c);
    }
  }
  return found;
}

// Nomzod slotlar: avval shu kun (eng yaqin soat), keyin boshqa kunlar
function smartCandidates(tempCtx, fromDay, fromSlotId) {
  const ts = teachingSorted(tempCtx);
  const fromNum = Number((tempCtx.timeslots || []).find((s) => s.id === fromSlotId)?.lessonNumber || 0);
  const dayIdx = DAYS.indexOf(fromDay);
  const list = [];
  DAYS.forEach((day, di) => {
    ts.forEach((slot) => {
      if (day === fromDay && slot.id === fromSlotId) return;
      list.push({
        day, slot,
        w: Math.abs(di - dayIdx) * 100 + Math.abs(Number(slot.lessonNumber || 0) - fromNum),
      });
    });
  });
  list.sort((a, b) => a.w - b.w);
  return list;
}

// Bitta sinf-kundagi birinchi bo'shliqni keyingi darsni oldinga tortib yopish
function smartPullForward(tempCtx, tempSch, classId, day, fixedUids) {
  const slots = teachingSorted(tempCtx).filter(
    (s) => slotAllowsClass(s, classId) && !classHasLunchAt(s, classId, tempCtx.lunchGroups, day)
  );
  const busy = slots.map((s) => ({
    slot: s,
    cell: (tempSch?.[day]?.[s.id] || []).filter((l) => classIdsOf(l).includes(classId)),
  }));
  let gapIdx = -1;
  for (let i = 0; i < busy.length; i++) {
    const laterBusy = busy.slice(i + 1).some((b) => b.cell.length);
    if (!busy[i].cell.length && laterBusy) { gapIdx = i; break; }
  }
  if (gapIdx === -1) return null;
  const target = busy[gapIdx].slot;
  for (let j = gapIdx + 1; j < busy.length; j++) {
    if (!busy[j].cell.length) continue;
    const head = busy[j].cell[0];
    const unit = unitOf(collectCardEntries(tempSch?.[day]?.[busy[j].slot.id] || [], head));
    if (!unit.entries.length || unit.locked) continue;
    if (fixedUids.has(smartUid(unit.entries[0]))) continue; // A/B joyidan qimirlamaydi
    const errs = checkPlace(tempCtx, unit, day, target, new Set());
    if (errs.length) continue;
    return { unit, fromDay: day, fromSlotId: busy[j].slot.id, toDay: day, toSlotId: target.id };
  }
  return null;
}

// Ta'sirlangan barcha sinf-kunlarda oyna qolmaguncha ta'mirlash.
// Yopib bo'lmasa — variant INVALID (null).
function smartRepairGaps(ctx, baseActions, moves, fixedUids, origGapOf) {
  const all = [...moves];
  for (let guard = 0; guard < 24; guard++) {
    const tempSch = applyActions(ctx.schedule, [...baseActions, ...movesToActions(all)]);
    const tempCtx = { ...ctx, schedule: tempSch };

    const pairs = new Set();
    [...baseActions, ...movesToActions(all)].forEach((a) => {
      const cids = new Set();
      a.entries.forEach((l) => classIdsOf(l).forEach((c) => cids.add(c)));
      cids.forEach((c) => { pairs.add(`${c}\u0001${a.fromDay}`); pairs.add(`${c}\u0001${a.toDay}`); });
    });

    let bad = null;
    for (const key of pairs) {
      const [cid, day] = key.split("\u0001");
      if (classGapScore(ctx, tempSch, cid, day) > origGapOf(cid, day)) { bad = { cid, day }; break; }
    }
    if (!bad) return all;

    const fix = smartPullForward(tempCtx, tempSch, bad.cid, bad.day, fixedUids);
    if (!fix) return null;
    all.push(fix);
  }
  return null;
}

// Asosiy qidiruv: best-first, visited-state, ALL OR NOTHING.
// src = { day, slotId, unit }, dst = { day, slotId }, partner — dst dagi karta.
// Natija: suggestion obyekti yoki null.
function smartPlanCore(ctx, src, dst, partner) {
  const dstTs = (ctx.timeslots || []).find((s) => s.id === dst.slotId);
  const srcTs = (ctx.timeslots || []).find((s) => s.id === src.slotId);
  if (!dstTs || !srcTs) return null;
  if (!isTeachingSlot(dstTs) || !isTeachingSlot(srcTs)) return null;

  // Bandlikdan BOSHQA xato bo'lsa (smena, dam kuni, obed) — yechim yo'q
  const aHard = checkPlace(ctx, src.unit, dst.day, dstTs, partner ? new Set(partner.entries) : new Set())
    .filter((e) => !BUSY_CODES.includes(e.code));
  if (aHard.length) return null;
  if (partner) {
    const bHard = checkPlace(ctx, partner, src.day, srcTs, new Set(src.unit.entries))
      .filter((e) => !BUSY_CODES.includes(e.code));
    if (bHard.length) return null;
  }

  // PRIMARY — o'zgarmas harakat(lar): A → dst, sherik bo'lsa B → src
  const baseActions = [
    { entries: src.unit.entries, fromDay: src.day, fromSlotId: src.slotId, toDay: dst.day, toSlotId: dst.slotId },
  ];
  if (partner) {
    baseActions.push(
      { entries: partner.entries, fromDay: dst.day, fromSlotId: dst.slotId, toDay: src.day, toSlotId: src.slotId }
    );
  }
  const fixedUids = new Set([smartUid(src.unit.entries[0])]);
  if (partner) fixedUids.add(smartUid(partner.entries[0]));

  const origGapCache = new Map();
  const origGapOf = (cid, day) => {
    const k = `${cid}\u0001${day}`;
    if (!origGapCache.has(k)) origGapCache.set(k, classGapScore(ctx, ctx.schedule, cid, day));
    return origGapCache.get(k);
  };

  const visited = new Set();
  let states = 0;
  let best = null;
  const queue = [{ moves: [], cost: 0 }];

  while (queue.length && states < SMART_MAX_STATES) {
    queue.sort((a, b) => a.cost - b.cost);
    const node = queue.shift();
    states += 1;
    if (best && node.cost >= best.cost) break; // qolganlari baribir qimmatroq

    const tempSch = applyActions(ctx.schedule, [...baseActions, ...movesToActions(node.moves)]);
    const tempCtx = { ...ctx, schedule: tempSch };

    const placed = [
      { unit: src.unit, day: dst.day, slotId: dst.slotId },
      ...(partner ? [{ unit: partner, day: src.day, slotId: src.slotId }] : []),
      ...node.moves.map((m) => ({ unit: m.unit, day: m.toDay, slotId: m.toSlotId })),
    ];
    const movedUids = new Set(node.moves.map((m) => smartUid(m.unit.entries[0])));
    const conflicts = smartConflicts(tempCtx, placed);

    if (!conflicts.length) {
      // Konfliktsiz holat — endi oynalarni ta'mirlaymiz (temp ustida)
      const repaired = smartRepairGaps(ctx, baseActions, node.moves, fixedUids, origGapOf);
      if (repaired) {
        const cost = smartCost(src, partner, repaired);
        if (!best || cost < best.cost) best = { moves: repaired, cost };
        if (best.cost === 0) break;
      }
      continue;
    }

    if (node.moves.length >= SMART_MAX_DEPTH) continue;

    const c = conflicts[0];
    const cu = smartUid(c.entries[0]);
    // Locked/swap-juft darsga tegilmaydi; A/B va allaqachon ko'chirilganlar qayta ko'chmaydi
    if (c.locked || c.swap || fixedUids.has(cu) || movedUids.has(cu)) continue;

    const loc = findUnitLocation(tempSch, c);
    if (!loc) continue;

    let added = 0;
    for (const cand of smartCandidates(tempCtx, loc.day, loc.slotId)) {
      if (added >= SMART_CANDS) break;
      const errs = checkPlace(tempCtx, c, cand.day, cand.slot, new Set());
      if (errs.length && !onlyBusyReasons(errs)) continue;            // hard xato — mumkin emas
      if (errs.length && node.moves.length + 1 >= SMART_MAX_DEPTH) continue; // zanjirga chuqurlik qolmadi
      const moves = [...node.moves, {
        unit: c, fromDay: loc.day, fromSlotId: loc.slotId, toDay: cand.day, toSlotId: cand.slot.id,
      }];
      const h = smartStateHash(moves);
      if (visited.has(h)) continue;
      visited.add(h);
      queue.push({ moves, cost: smartCost(src, partner, moves) + (errs.length ? 1 : 0) });
      added += 1;
    }
  }

  if (!best) return null;

  const extra = best.moves;
  const lines = extra.map((m) =>
    `${unitLabel(ctx, m.unit)}: ${slotLabel(ctx, m.fromDay, m.fromSlotId)} → ${slotLabel(ctx, m.toDay, m.toSlotId)}`
  );
  const affC = new Set([...src.unit.classIds, ...(partner ? partner.classIds : [])]);
  extra.forEach((m) => m.unit.classIds.forEach((cc) => affC.add(cc)));
  const primaryCount = partner ? 2 : 1;
  const head = partner
    ? `⇄ Aynan joy almashtirish: ${unitLabel(ctx, src.unit)} (${slotLabel(ctx, src.day, src.slotId)}) ↔ ` +
      `${unitLabel(ctx, partner)} (${slotLabel(ctx, dst.day, dst.slotId)})`
    : `➜ Bu darsni ${slotLabel(ctx, dst.day, dst.slotId)} ga qo'yish (to'siqlar minimal suriladi)`;

  return {
    type: "smart",
    changes: primaryCount + extra.length,
    lockedInvolved: Boolean(src.unit.locked || (partner && partner.locked)),
    label:
      head +
      (lines.length ? ` · Qo'shimcha minimal o'zgarishlar: ${lines.join("; ")}` : "") +
      ` · Jami: ${primaryCount} ta asosiy + ${extra.length} ta qo'shimcha dars, ${affC.size} ta sinf, bo'sh soat qolmaydi`,
    actions: [...baseActions, ...movesToActions(extra)],
  };
}

// A ↔ B majburiy almashinuv (sherik bilan)
export function smartSwapPlan(ctx, src, dst, partner) {
  return partner ? smartPlanCore(ctx, src, dst, partner) : null;
}

// A → dst majburiy ko'chirish — to'siqlar (bir nechta bo'lsa ham) zanjirli suriladi
export function smartMovePlan(ctx, src, dst) {
  return smartPlanCore(ctx, src, dst, null);
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
    // SMART MINIMAL SWAP: A ↔ B majburiy — to'siqlar zanjirli surib yechiladi.
    // Valid plan topilsa modal ko'rsatilmaydi — darhol qo'llanadi (ok: true).
    const smart = smartSwapPlan(ctx, src, dst, partner);
    if (smart) {
      return {
        ok: true, mode: "smart", auto, partner,
        actions: smart.actions,
        smart: { extra: smart.changes - 2, label: smart.label },
      };
    }
    return buildSuggestions(ctx, src, dst, reasonObjs.length ? reasonObjs : moveErrs);
  }

  // SMART MINIMAL MOVE: sherik topilmasa ham (bir nechta to'siq — parallel
  // darslar) A majburiy dst ga qo'yiladi, to'siqlar zanjirli suriladi.
  // Valid plan topilsa modal ko'rsatilmaydi — darhol qo'llanadi (ok: true).
  const smartM = smartMovePlan(ctx, src, dst);
  if (smartM) {
    return {
      ok: true, mode: "smart", partner: null,
      actions: smartM.actions,
      smart: { extra: smartM.changes - 1, label: smartM.label },
    };
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
    ["NOT_TEACHING", "SHIFT", "CLASS_OFF", "TEACHER_OFF", "TEACHER_BLOCKED", "LUNCH", "NO_SLOT"].includes(r.code)
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
              label: `${unitLabel(ctx, b)} darsini ${slotLabel(ctx, h.day, h.slotId)}ga surib, joy ochish (${slotLabel(ctx, src.day, src.slotId)} bo'sh qoladi)`,
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
  const RANK = { smart: 0, swap: 1, rotate: 2, chain: 3, alt: 4 };
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