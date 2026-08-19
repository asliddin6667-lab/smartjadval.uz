// ————————————————————————————————————————————————————————————
// DARS SOATLARINI SMENALARGA BO'LISH (ko'rsatish uchun)
// Ichkarida timeslot.lessonNumber GLOBAL va uzluksiz bo'ladi — generator,
// jadval kalitlari va saqlash shunga tayanadi. Ekranda esa har smena o'z
// ichida 1-dars, 2-dars … deb ko'rsatiladi.
// Xuddi shu qoida: TimeSlots, LunchGroups va rangli eksportda ham ishlatiladi.
// ————————————————————————————————————————————————————————————

export const NO_SHIFT = "__no_shift__";

function timeToMin(t) {
  const [h, m] = String(t || "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Vaqtlarni smenalarga bo'ladi: [{ id, name, range, slots: [...] }]
// Smenalar tartibi — `shifts` ro'yxati bo'yicha, so'ng smenasiz vaqtlar.
export function groupSlotsByShift(timeslots = [], shifts = [], noShiftName = "Dars soatlari") {
  const sorted = [...timeslots].sort(
    (a, b) => Number(a.lessonNumber || 0) - Number(b.lessonNumber || 0)
  );
  const map = new Map();
  const none = [];
  sorted.forEach((t) => {
    if (t.shiftId) {
      if (!map.has(t.shiftId)) {
        const sh = (shifts || []).find((s) => s.id === t.shiftId);
        map.set(t.shiftId, {
          id: t.shiftId,
          name: t.shiftName || sh?.name || "Smena",
          slots: [],
        });
      }
      map.get(t.shiftId).slots.push(t);
    } else {
      none.push(t);
    }
  });

  const out = [];
  (shifts || []).forEach((sh) => {
    if (map.has(sh.id)) { out.push(map.get(sh.id)); map.delete(sh.id); }
  });
  map.forEach((g) => out.push(g));
  if (none.length) {
    out.push({ id: NO_SHIFT, name: out.length ? "Smenasiz vaqtlar" : noShiftName, slots: none });
  }

  out.forEach((g) => {
    if (!g.slots.length) { g.range = "—"; return; }
    const first = [...g.slots].sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime))[0];
    const last = [...g.slots].sort((a, b) => timeToMin(b.endTime) - timeToMin(a.endTime))[0];
    g.range = `${first.startTime}–${last.endTime}`;
  });
  return out;
}

// timeslotId -> smena ichidagi raqam (1, 2, 3 …)
export function shiftSlotNumbers(groups = []) {
  const m = new Map();
  groups.forEach((g) =>
    g.slots.forEach((ts, i) => m.set(ts.id, Number(ts.shiftLessonNumber) || i + 1))
  );
  return m;
}

// Bitta vaqtning ekranda ko'rinadigan raqami: smena ichki raqami bo'lsa — o'sha,
// aks holda global tartib (smenasiz maktabda ikkisi bir xil).
export function slotDisplayNumber(ts) {
  return Number(ts?.shiftLessonNumber) || Number(ts?.lessonNumber) || null;
}
