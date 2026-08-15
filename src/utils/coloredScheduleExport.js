// Rangli dars jadvali Excel eksporti — UMUMIY MODUL.
// Ikkala joydan chaqiriladi:
//   1) Excel bo'limi (ImportExport.jsx) — "🎨 Rangli jadval" tugmasi
//   2) Dars jadvali sahifasi (Schedule.jsx) — "📥 Excel" tugmasi
//
// Format talablari:
//   - HAR SMENA — ALOHIDA LIST (varaq). Listda faqat o'sha smenaning sinflari
//     va o'sha smenaning dars vaqtlari bo'ladi (bo'sh ustunlar chiqmaydi)
//   - Dars raqami smena ichidagi tartib bilan: 1-dars, 2-dars … (global emas)
//   - Bo'sh kataklar KO'RINMAYDI (chegarasiz, oq fon — setka chizilmaydi)
//   - Butunlay bo'sh soat qatorlari chiqmaydi
//   - Har kun boshida rangli ajratuvchi qator, kun nomi KATTA shriftda
//   - Kun nomi chap chekkada VERTIKAL (qiya) yozuvda ham chiqadi
//   - Obed/Tanaffus qatorlari faqat darslar orasida bo'lsa chiqadi
//   - Har fan o'z rangida, guruhli darslar kichik qatorlarga bo'linadi

import { DAYS } from './constants';
import { loadStyledXLSX, hexToExcelRGB, readableTextRGB } from './excelUtils';
import { isTeachingSlot, classHasLunchAt } from './scheduleGenerator';

function lessonClassIds(lesson) {
  return Array.isArray(lesson.classIds) ? lesson.classIds : [lesson.classId].filter(Boolean);
}

function safeFileDate() {
  return new Date().toISOString().slice(0, 10);
}

function slotClassIds(ts) {
  return Array.isArray(ts?.classIds) ? ts.classIds : [];
}

function sortClasses(list) {
  return [...list].sort((a, b) => String(a.name).localeCompare(String(b.name), 'uz', { numeric: true }));
}

// Excel varaq nomi: 31 belgi, taqiqlangan belgilarsiz, takrorlanmaydigan
function sheetName(raw, used) {
  let name = String(raw || 'Jadval').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Jadval';
  let base = name;
  let n = 2;
  while (used.has(name)) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
    n += 1;
  }
  used.add(name);
  return name;
}

// ——— Smenalarga bo'lish ———
// Har smena uchun: o'sha smena sinflari + o'sha smena vaqtlari.
// Smenaga tegishli bo'lmagan umumiy vaqtlar (obed/tanaffus) har bir listga
// qo'shiladi, agar ular shu listning sinflariga tegishli bo'lsa.
function buildGroups(classes, timeslots) {
  const byShift = new Map();
  timeslots.forEach((ts) => {
    if (!ts?.shiftId) return;
    if (!byShift.has(ts.shiftId)) {
      byShift.set(ts.shiftId, { id: ts.shiftId, name: ts.shiftName || 'Smena', slots: [] });
    }
    byShift.get(ts.shiftId).slots.push(ts);
  });

  const groups = [];
  const covered = new Set();

  for (const sh of byShift.values()) {
    const ids = new Set();
    sh.slots.forEach((ts) => slotClassIds(ts).forEach((id) => ids.add(id)));
    const cls = ids.size ? classes.filter((c) => ids.has(c.id)) : [...classes];
    if (!cls.length) continue;
    cls.forEach((c) => covered.add(c.id));
    const clsIds = new Set(cls.map((c) => c.id));
    // shu smenaning vaqtlari + shu sinflarga tegishli umumiy vaqtlar
    const slots = timeslots.filter((ts) => {
      if (ts.shiftId === sh.id) return true;
      if (ts.shiftId) return false;
      const ids2 = slotClassIds(ts);
      return !ids2.length || ids2.some((id) => clsIds.has(id));
    });
    groups.push({ name: sh.name, classes: sortClasses(cls), slots });
  }

  // Hech qaysi smenaga kirmagan sinflar
  const rest = classes.filter((c) => !covered.has(c.id));
  if (rest.length) {
    const restIds = new Set(rest.map((c) => c.id));
    const slots = timeslots.filter((ts) => {
      if (ts.shiftId) {
        return slotClassIds(ts).some((id) => restIds.has(id));
      }
      const ids2 = slotClassIds(ts);
      return !ids2.length || ids2.some((id) => restIds.has(id));
    });
    groups.push({ name: groups.length ? 'Boshqa sinflar' : 'Dars jadvali', classes: sortClasses(rest), slots });
  }

  if (!groups.length) {
    groups.push({ name: 'Dars jadvali', classes: sortClasses(classes), slots: [...timeslots] });
  }
  return groups;
}

// ——— Bitta varaq (bitta smena) yasash ———
// Dars bo'lmasa null qaytaradi (bo'sh varaq qo'shilmaydi).
function buildSheet(XLSX, { classes, timeslots, subjects, teachers, rooms, lunchGroups, schedule }) {
  const sortedTimeslots = [...timeslots].sort(
    (a, b) => Number(a.lessonNumber || 0) - Number(b.lessonNumber || 0)
  );
  if (!classes.length || !sortedTimeslots.length) return null;

  // Dars raqami — SHU LIST ichidagi tartib bo'yicha: 1, 2, 3 …
  const numById = new Map();
  sortedTimeslots.forEach((ts, i) => numById.set(ts.id, ts.shiftLessonNumber || i + 1));
  const numOf = (ts) => numById.get(ts.id) ?? (ts.lessonNumber || '');

  const getSubject = (id) => subjects.find((s) => s.id === id);
  const getTeacher = (id) => teachers.find((t) => t.id === id);
  const getRoom = (id) => rooms.find((r) => r.id === id);
  const lessonsAt = (day, ts, cls) =>
    (schedule?.[day]?.[ts.id] || []).filter((l) => lessonClassIds(l).includes(cls.id));
  const subjColor = (l) => {
    const bg = hexToExcelRGB(getSubject(l.subjectId)?.color);
    return bg ? { bg, fg: readableTextRGB(bg) } : { bg: 'BDD7EE', fg: '1F2937' };
  };
  const bandColor = (ts) => {
    const t = String(ts.title || '').toLowerCase();
    if (t.includes('uyqu') || t.includes('uxla')) return { bg: 'F8CBAD', fg: '7C2D12' };
    return { bg: '13A05A', fg: 'FFFFFF' };
  };

  const anyLesson = DAYS.some((day) =>
    sortedTimeslots.some((ts) => classes.some((cls) => lessonsAt(day, ts, cls).length > 0))
  );
  if (!anyLesson) return null;

  const LEAD = 3; // Kun | Soat | Vaqt
  const totalCols = LEAD + classes.length * 2;
  const aoa = [];
  const merges = [];
  const fills = [];          // fan/xona/label kataklari { r, c, bg, fg }
  const bandRows = [];       // Obed/Tanaffus/Uyqu bandlari { r, bg, fg }
  const dayHeaderRows = [];  // kun ajratuvchi rangli qatorlar { r }
  const dayLabelSpans = [];  // chap chekkadagi vertikal kun yozuvi { start, end }
  const rowHpt = [];         // qator balandliklari

  // 2 qatorli sarlavha: Kun | Soat | Vaqt | [har sinf: Fan/O'qituvchi | Auditoriya]
  const h0 = ['Kun', 'Soat', 'Vaqt'];
  const h1 = ['', '', ''];
  classes.forEach((c) => {
    h0.push(c.name, '');
    h1.push("Fan / O'qituvchi", 'Auditoriya');
  });
  aoa.push(h0, h1);
  rowHpt.push(24, 24);
  for (let c = 0; c < LEAD; c++) merges.push({ s: { r: 0, c }, e: { r: 1, c } });
  classes.forEach((_, ci) => {
    const col = LEAD + ci * 2;
    merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + 1 } });
  });

  let r = 2;
  DAYS.forEach((day) => {
    // Shu kunda qaysi soatlarda dars bor / obed belgisi bor
    const hasLesson = sortedTimeslots.map(
      (ts) => isTeachingSlot(ts) && classes.some((cls) => lessonsAt(day, ts, cls).length > 0)
    );
    if (!hasLesson.some(Boolean)) return; // kun butunlay bo'sh — chiqarilmaydi
    const hasLunchLabel = sortedTimeslots.map(
      (ts) => isTeachingSlot(ts) && classes.some((cls) => classHasLunchAt(ts, cls.id, lunchGroups, day))
    );
    let firstIdx = -1;
    let lastIdx = -1;
    hasLesson.forEach((h, i) => {
      if (h) {
        if (firstIdx < 0) firstIdx = i;
        lastIdx = i;
      }
    });

    // KUN AJRATUVCHI QATOR — rangli, kun nomi katta shriftda
    const dayRow = new Array(totalCols).fill('');
    dayRow[0] = day;
    aoa.push(dayRow);
    rowHpt.push(30);
    merges.push({ s: { r, c: 0 }, e: { r, c: totalCols - 1 } });
    dayHeaderRows.push({ r });
    r += 1;

    const daySlotsStart = r; // vertikal kun yozuvi shu qatordan boshlanadi

    sortedTimeslots.forEach((ts, i) => {
      const teaching = isTeachingSlot(ts);
      const timeLabel = `${ts.startTime || ''}${ts.endTime ? '-' + ts.endTime : ''}`;

      // Obed/Tanaffus turidagi vaqt — faqat darslar ORASIDA bo'lsa chiqadi
      if (!teaching) {
        if (i <= firstIdx || i >= lastIdx) return;
        const row = new Array(totalCols).fill('');
        row[1] = numOf(ts);
        row[2] = timeLabel;
        row[LEAD] = ts.title || (ts.type === 'lunch' ? 'Tushlik vaqti' : 'Tanaffus');
        aoa.push(row);
        rowHpt.push(24);
        merges.push({ s: { r, c: LEAD }, e: { r, c: totalCols - 1 } });
        bandRows.push({ r, ...bandColor(ts) });
        r += 1;
        return;
      }

      // Dars qo'yilmagan soat qatori chiqarilmaydi.
      // Istisno: sinf obedi belgisi bo'lsa va u darslar orasida tursa — ko'rsatiladi.
      const showLunchOnly = hasLunchLabel[i] && i > firstIdx && i < lastIdx;
      if (!hasLesson[i] && !showLunchOnly) return;

      const plans = classes.map((cls) => {
        const offDays = Array.isArray(cls.offDays) ? cls.offDays : [];
        if (offDays.includes(day)) return { kind: 'label', text: 'Dam', fill: { bg: 'FEF3C7', fg: 'B45309' } };
        if (classHasLunchAt(ts, cls.id, lunchGroups, day)) return { kind: 'label', text: 'Obed', fill: { bg: 'FDE68A', fg: '92400E' } };
        const ls = lessonsAt(day, ts, cls);
        if (!ls.length) return { kind: 'empty' };
        const sorted = [...ls].sort((a, b) =>
          String(a.groupPart || '').localeCompare(String(b.groupPart || ''), 'uz', { numeric: true })
        );
        return {
          kind: 'lessons',
          items: sorted.map((l) => {
            const subj = getSubject(l.subjectId);
            const tName = getTeacher(l.teacherId)?.name || '';
            const gp = (sorted.length > 1 && l.groupPart) ? l.groupPart + ': ' : '';
            return {
              fan: gp + (subj?.name || '') + (tName ? '\n' + tName : ''),
              room: getRoom(l.roomId)?.name || '',
              fill: subjColor(l),
            };
          }),
        };
      });

      const counts = plans.map((p) => (p.kind === 'lessons' ? p.items.length : 1));
      const maxG = Math.max(1, ...counts);
      const blockStart = r;

      for (let sub = 0; sub < maxG; sub++) {
        const row = new Array(totalCols).fill('');
        if (sub === 0) {
          row[1] = numOf(ts);
          row[2] = timeLabel;
        }
        plans.forEach((p, ci) => {
          const colFan = LEAD + ci * 2;
          const colRoom = colFan + 1;
          if (p.kind === 'lessons') {
            if (sub < p.items.length) {
              row[colFan] = p.items[sub].fan;
              row[colRoom] = p.items[sub].room;
              fills.push({ r: blockStart + sub, c: colFan, ...p.items[sub].fill });
              fills.push({ r: blockStart + sub, c: colRoom, bg: 'FFFFFF', fg: '1F2937' });
            }
          } else if (sub === 0 && p.kind === 'label') {
            row[colFan] = p.text;
            fills.push({ r: blockStart, c: colFan, ...p.fill });
            fills.push({ r: blockStart, c: colRoom, ...p.fill });
          }
        });
        aoa.push(row);
        rowHpt.push(42);
      }

      if (maxG > 1) {
        merges.push({ s: { r: blockStart, c: 1 }, e: { r: blockStart + maxG - 1, c: 1 } });
        merges.push({ s: { r: blockStart, c: 2 }, e: { r: blockStart + maxG - 1, c: 2 } });
      }
      plans.forEach((p, ci) => {
        const colFan = LEAD + ci * 2;
        const colRoom = colFan + 1;
        const gc = p.kind === 'lessons' ? p.items.length : 1;
        if (p.kind === 'empty' && maxG > 1) {
          // bo'sh katak — butun blok bo'ylab bitta ko'rinmas katak
          merges.push({ s: { r: blockStart, c: colFan }, e: { r: blockStart + maxG - 1, c: colFan } });
          merges.push({ s: { r: blockStart, c: colRoom }, e: { r: blockStart + maxG - 1, c: colRoom } });
        } else if (gc <= 1 && p.kind !== 'empty' && maxG > 1) {
          merges.push({ s: { r: blockStart, c: colFan }, e: { r: blockStart + maxG - 1, c: colFan } });
          merges.push({ s: { r: blockStart, c: colRoom }, e: { r: blockStart + maxG - 1, c: colRoom } });
        } else if (gc > 1 && gc < maxG) {
          merges.push({ s: { r: blockStart + gc, c: colFan }, e: { r: blockStart + maxG - 1, c: colFan } });
          merges.push({ s: { r: blockStart + gc, c: colRoom }, e: { r: blockStart + maxG - 1, c: colRoom } });
        }
      });
      r += maxG;
    });

    // Chap chekkadagi VERTIKAL kun yozuvi (kunning barcha soat qatorlari bo'ylab)
    if (r > daySlotsStart) {
      if (r - 1 > daySlotsStart) {
        merges.push({ s: { r: daySlotsStart, c: 0 }, e: { r: r - 1, c: 0 } });
      }
      aoa[daySlotsStart][0] = day;
      dayLabelSpans.push({ start: daySlotsStart, end: r - 1 });
    }
  });

  // ——— Uslublar ———
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const thin = { style: 'thin', color: { rgb: '9CA3AF' } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const range = XLSX.utils.decode_range(ws['!ref']);

  // Baza uslub — CHEGARASIZ, oq fon (bo'sh kataklar ko'rinmaydi, setka yo'q)
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const ref = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      ws[ref].s = { alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, font: { sz: 11 }, fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } } };
    }
  }

  // Sarlavha 0-qatori (havorang)
  for (let C = range.s.c; C <= range.e.c; C++) {
    const ref = XLSX.utils.encode_cell({ r: 0, c: C });
    ws[ref].s = { alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border, font: { bold: true, sz: 12, color: { rgb: '0F3D5C' } }, fill: { patternType: 'solid', fgColor: { rgb: '35E0F2' } } };
  }
  // 1-qator: Kun/Soat/Vaqt (havorang) + sub-sarlavhalar (sariq)
  for (let C = 0; C < LEAD; C++) {
    const ref = XLSX.utils.encode_cell({ r: 1, c: C });
    if (!ws[ref]) ws[ref] = { t: 's', v: '' };
    ws[ref].s = { alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border, font: { bold: true, sz: 12, color: { rgb: '0F3D5C' } }, fill: { patternType: 'solid', fgColor: { rgb: '35E0F2' } } };
  }
  for (let C = LEAD; C <= range.e.c; C++) {
    const ref = XLSX.utils.encode_cell({ r: 1, c: C });
    if (!ws[ref]) ws[ref] = { t: 's', v: '' };
    ws[ref].s = { alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border, font: { bold: true, sz: 11, color: { rgb: '7A6A00' } }, fill: { patternType: 'solid', fgColor: { rgb: 'FFF200' } } };
  }

  // Soat va Vaqt ustunlari — chegarali (sarlavhadan pastdagi barcha qatorlar)
  for (let R = 2; R <= range.e.r; R++) {
    for (let C = 1; C <= 2; C++) {
      const ref = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      ws[ref].s = { alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border, font: { bold: true, sz: 11, color: { rgb: '1F2937' } }, fill: { patternType: 'solid', fgColor: { rgb: 'F8FAFC' } } };
    }
  }

  // Chap chekkadagi VERTIKAL kun yozuvi (och sariq, 90° buralgan, katta shrift)
  dayLabelSpans.forEach(({ start, end }) => {
    for (let R = start; R <= end; R++) {
      const ref = XLSX.utils.encode_cell({ r: R, c: 0 });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      ws[ref].s = { alignment: { horizontal: 'center', vertical: 'center', textRotation: 90, wrapText: false }, border, font: { bold: true, sz: 14, color: { rgb: '92400E' } }, fill: { patternType: 'solid', fgColor: { rgb: 'FDE68A' } } };
    }
  });

  // Fan / xona / label kataklari (rangli, chegarali)
  fills.forEach(({ r: R, c: C, bg, fg }) => {
    const ref = XLSX.utils.encode_cell({ r: R, c: C });
    if (!ws[ref]) ws[ref] = { t: 's', v: '' };
    ws[ref].s = { alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border, font: { bold: true, sz: 11, color: { rgb: fg } }, fill: { patternType: 'solid', fgColor: { rgb: bg } } };
  });

  // Obed / Tanaffus / Uyqu bandlari (butun en bo'ylab)
  bandRows.forEach(({ r: R, bg, fg }) => {
    for (let C = LEAD; C <= range.e.c; C++) {
      const ref = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      ws[ref].s = { alignment: { horizontal: 'center', vertical: 'center', wrapText: false }, border, font: { bold: true, sz: 14, color: { rgb: fg } }, fill: { patternType: 'solid', fgColor: { rgb: bg } } };
    }
  });

  // KUN AJRATUVCHI QATORLAR — to'q ko'k fon, oq KATTA shrift (butun en bo'ylab)
  dayHeaderRows.forEach(({ r: R }) => {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const ref = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      ws[ref].s = { alignment: { horizontal: 'center', vertical: 'center', wrapText: false }, border, font: { bold: true, sz: 16, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '4338CA' } } };
    }
  });

  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 6 },
    { wch: 6 },
    { wch: 13 },
    ...classes.flatMap((c) => [
      { wch: Math.min(Math.max(String(c.name).length + 2, 20), 26) },
      { wch: 14 },
    ]),
  ];
  ws['!rows'] = rowHpt.map((h) => ({ hpt: h }));
  ws['!freeze'] = { xSplit: 3, ySplit: 2 };
  return ws;
}

export async function exportColoredSchedule({
  classes = [],
  subjects = [],
  teachers = [],
  rooms = [],
  timeslots = [],
  lunchGroups = [],
  schedule = {},
  toast,
}) {
  try {
    if (!classes.length) {
      toast?.("Avval sinf qo'shing", 'warning');
      return;
    }
    const hasAnyLesson = DAYS.some((day) =>
      timeslots.some((ts) => (schedule?.[day]?.[ts.id] || []).length > 0)
    );
    if (!hasAnyLesson) {
      toast?.('Avval dars jadvalini yarating', 'warning');
      return;
    }

    const XLSX = await loadStyledXLSX();
    const wb = XLSX.utils.book_new();
    const used = new Set();
    const groups = buildGroups(classes, timeslots);
    let added = 0;

    groups.forEach((g) => {
      const ws = buildSheet(XLSX, {
        classes: g.classes,
        timeslots: g.slots,
        subjects, teachers, rooms, lunchGroups, schedule,
      });
      if (!ws) return;
      XLSX.utils.book_append_sheet(wb, ws, sheetName(g.name, used));
      added += 1;
    });

    if (!added) {
      toast?.('Avval dars jadvalini yarating', 'warning');
      return;
    }

    XLSX.writeFile(wb, `dars_jadvali_rangli_${safeFileDate()}.xlsx`);
    toast?.(added > 1 ? `Excelga yuklandi — ${added} ta smena listi ✓` : 'Rangli jadval Excelga yuklandi ✓', 'success');
  } catch (e) {
    toast?.(e.message || 'Excel eksportda xatolik', 'error');
  }
}