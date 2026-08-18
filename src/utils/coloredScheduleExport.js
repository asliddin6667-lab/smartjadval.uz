// Rangli dars jadvali Excel eksporti — UMUMIY MODUL.
// Ikkala joydan chaqiriladi:
//   1) Excel bo'limi (ImportExport.jsx) — "🎨 Rangli jadval" tugmasi
//   2) Dars jadvali sahifasi (Schedule.jsx) — "📥 Excel" tugmasi
//
// Format talablari:
//   - HAR SMENA — ALOHIDA LIST (varaq). Listda faqat o'sha smenaning sinflari
//     va o'sha smenaning dars vaqtlari bo'ladi (bo'sh ustunlar chiqmaydi)
//   - HAR SINF — BITTA USTUN. Xona uchun alohida ustun YO'Q: xona raqami
//     fan nomi yonida qavs ichida, o'qituvchi bilan bitta katakda turadi:
//         Matematika (12)
//         Aliyev Ali
//   - Sinf ustunlari qalin vertikal chiziq bilan bir-biridan ajratiladi
//   - Dars raqami smena ichidagi tartib bilan: 1-dars, 2-dars … (global emas)
//   - Bo'sh kataklar ichi ko'rinmaydi (oq fon), faqat sinf ajratkichi chiziladi
//   - Butunlay bo'sh soat qatorlari chiqmaydi
//   - Har kun boshida rangli ajratuvchi qator, kun nomi KATTA shriftda
//   - Kun nomi chap chekkada VERTIKAL (qiya) yozuvda ham chiqadi
//   - Obed/Tanaffus qatorlari faqat darslar orasida bo'lsa chiqadi
//   - Chop etishga tayyor: sarlavha bandi, tor chekkalar, har betda takrorlanadigan
//     sarlavha qatorlari (Print_Titles)

import { DAYS } from './constants';
import { loadStyledXLSX, hexToExcelRGB, readableTextRGB } from './excelUtils';
import { isTeachingSlot, classHasLunchAt } from './scheduleGenerator';

// ——— Chegara va rang palitrasi ———
const HAIR = { style: 'thin', color: { rgb: 'CBD5E1' } };   // ichki nozik chiziq
const SEP = { style: 'medium', color: { rgb: '1E293B' } };  // sinf ajratkichi
const TITLE_BG = '0F172A';   // sarlavha bandi — to'q ko'k
const SUB_BG = '1D4ED8';     // ostki sarlavha
const DAY_BG = '4338CA';     // kun ajratuvchi qator
const LEAD_BG = 'F1F5F9';    // Soat / Vaqt ustunlari foni

// Sinf sarlavhalari — navbat bilan almashadigan to'q ranglar
const CLASS_HEADS = [
  { bg: '1E40AF', fg: 'FFFFFF' },
  { bg: '047857', fg: 'FFFFFF' },
  { bg: 'B45309', fg: 'FFFFFF' },
  { bg: '7E22CE', fg: 'FFFFFF' },
  { bg: 'BE123C', fg: 'FFFFFF' },
  { bg: '0E7490', fg: 'FFFFFF' },
];

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
function buildSheet(XLSX, {
  classes, timeslots, subjects, teachers, rooms, lunchGroups, schedule,
  title, subtitle,
}) {
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

  const LEAD = 3;                             // Kun | Soat | Vaqt
  const HEAD_ROWS = 3;                        // sarlavha + ostki sarlavha + ustun nomlari
  const totalCols = LEAD + classes.length;    // har sinf — BITTA ustun
  const aoa = [];
  const merges = [];
  const fills = [];          // fan/label kataklari { r, c, bg, fg }
  const bandRows = [];       // Obed/Tanaffus/Uyqu bandlari { r, bg, fg }
  const dayHeaderRows = [];  // kun ajratuvchi rangli qatorlar { r }
  const dayLabelSpans = [];  // chap chekkadagi vertikal kun yozuvi { start, end }
  const rowHpt = [];         // qator balandliklari

  // 0-qator: maktab nomi / hujjat sarlavhasi (butun en bo'ylab)
  const titleRow = new Array(totalCols).fill('');
  titleRow[0] = title;
  aoa.push(titleRow);
  rowHpt.push(34);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });

  // 1-qator: smena nomi / o'quv yili
  const subRow = new Array(totalCols).fill('');
  subRow[0] = subtitle;
  aoa.push(subRow);
  rowHpt.push(22);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } });

  // 2-qator: ustun nomlari — Kun | Soat | Vaqt | <sinflar>
  aoa.push(['Kun', 'Soat', 'Vaqt', ...classes.map((c) => c.name)]);
  rowHpt.push(28);

  let r = HEAD_ROWS;
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
        rowHpt.push(22);
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
            const room = getRoom(l.roomId)?.name || '';
            const gp = (sorted.length > 1 && l.groupPart) ? l.groupPart + ': ' : '';
            // BITTA KATAK: 1-satr — fan (+ xona qavs ichida), 2-satr — o'qituvchi
            const head = gp + (subj?.name || '') + (room ? ` (${room})` : '');
            return { text: tName ? head + '\n' + tName : head, fill: subjColor(l) };
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
          const col = LEAD + ci;
          if (p.kind === 'lessons') {
            if (sub < p.items.length) {
              row[col] = p.items[sub].text;
              fills.push({ r: blockStart + sub, c: col, ...p.items[sub].fill });
            }
          } else if (sub === 0 && p.kind === 'label') {
            row[col] = p.text;
            fills.push({ r: blockStart, c: col, ...p.fill });
          }
        });
        aoa.push(row);
        rowHpt.push(maxG > 1 ? 34 : 40);
      }

      if (maxG > 1) {
        merges.push({ s: { r: blockStart, c: 1 }, e: { r: blockStart + maxG - 1, c: 1 } });
        merges.push({ s: { r: blockStart, c: 2 }, e: { r: blockStart + maxG - 1, c: 2 } });
      }
      plans.forEach((p, ci) => {
        const col = LEAD + ci;
        if (maxG <= 1) return;
        const gc = p.kind === 'lessons' ? p.items.length : 1;
        if (p.kind !== 'lessons' || gc <= 1) {
          // bo'sh katak yoki bitta dars — butun blok bo'ylab yagona katak
          merges.push({ s: { r: blockStart, c: col }, e: { r: blockStart + maxG - 1, c: col } });
        } else if (gc < maxG) {
          merges.push({ s: { r: blockStart + gc, c: col }, e: { r: blockStart + maxG - 1, c: col } });
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
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cell = (R, C) => {
    const ref = XLSX.utils.encode_cell({ r: R, c: C });
    if (!ws[ref]) ws[ref] = { t: 's', v: '' };
    return ws[ref];
  };
  const mid = { horizontal: 'center', vertical: 'center', wrapText: true };

  // Baza uslub: jadval oq fonda, gorizontal setka chizilmaydi.
  // Sinf ustunlari esa har doim qalin vertikal chiziq bilan ajratiladi —
  // katak bo'sh bo'lsa ham ustun chegarasi ko'rinib turadi.
  for (let R = HEAD_ROWS; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      cell(R, C).s = {
        alignment: mid,
        font: { sz: 11 },
        fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
        border: C >= LEAD ? { left: SEP, right: SEP } : {},
      };
    }
  }

  // 0-qator — hujjat sarlavhasi (to'q ko'k fon, katta oq shrift)
  for (let C = range.s.c; C <= range.e.c; C++) {
    cell(0, C).s = {
      alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
      font: { bold: true, sz: 18, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: TITLE_BG } },
    };
  }
  // 1-qator — ostki sarlavha (smena, o'quv yili)
  for (let C = range.s.c; C <= range.e.c; C++) {
    cell(1, C).s = {
      alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
      font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: SUB_BG } },
    };
  }
  // 2-qator — ustun nomlari. Kun/Soat/Vaqt to'q kulrang, har sinf o'z rangida.
  for (let C = 0; C < LEAD; C++) {
    cell(2, C).s = {
      alignment: mid,
      border: { top: SEP, bottom: SEP, left: HAIR, right: HAIR },
      font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '334155' } },
    };
  }
  classes.forEach((_, ci) => {
    const head = CLASS_HEADS[ci % CLASS_HEADS.length];
    cell(2, LEAD + ci).s = {
      alignment: mid,
      border: { top: SEP, bottom: SEP, left: SEP, right: SEP },
      font: { bold: true, sz: 13, color: { rgb: head.fg } },
      fill: { patternType: 'solid', fgColor: { rgb: head.bg } },
    };
  });

  // Soat va Vaqt ustunlari — chegarali, och fonda
  for (let R = HEAD_ROWS; R <= range.e.r; R++) {
    for (let C = 1; C <= 2; C++) {
      cell(R, C).s = {
        alignment: mid,
        border: { top: HAIR, bottom: HAIR, left: HAIR, right: SEP },
        font: { bold: true, sz: 11, color: { rgb: '1F2937' } },
        fill: { patternType: 'solid', fgColor: { rgb: LEAD_BG } },
      };
    }
  }

  // Chap chekkadagi VERTIKAL kun yozuvi (och sariq, 90° buralgan, katta shrift)
  dayLabelSpans.forEach(({ start, end }) => {
    for (let R = start; R <= end; R++) {
      cell(R, 0).s = {
        alignment: { horizontal: 'center', vertical: 'center', textRotation: 90, wrapText: false },
        border: { top: HAIR, bottom: HAIR, left: SEP, right: SEP },
        font: { bold: true, sz: 14, color: { rgb: '92400E' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'FDE68A' } },
      };
    }
  });

  // Dars kataklari — fan rangida, ustun ajratkichi saqlanadi
  fills.forEach(({ r: R, c: C, bg, fg }) => {
    cell(R, C).s = {
      alignment: mid,
      border: { top: HAIR, bottom: HAIR, left: SEP, right: SEP },
      font: { bold: true, sz: 11, color: { rgb: fg } },
      fill: { patternType: 'solid', fgColor: { rgb: bg } },
    };
  });

  // Obed / Tanaffus / Uyqu bandlari (butun en bo'ylab)
  bandRows.forEach(({ r: R, bg, fg }) => {
    for (let C = LEAD; C <= range.e.c; C++) {
      cell(R, C).s = {
        alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
        border: { top: HAIR, bottom: HAIR, left: SEP, right: SEP },
        font: { bold: true, sz: 12, color: { rgb: fg } },
        fill: { patternType: 'solid', fgColor: { rgb: bg } },
      };
    }
  });

  // KUN AJRATUVCHI QATORLAR — to'q ko'k fon, oq KATTA shrift (butun en bo'ylab)
  dayHeaderRows.forEach(({ r: R }) => {
    for (let C = range.s.c; C <= range.e.c; C++) {
      cell(R, C).s = {
        alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
        border: { top: SEP, bottom: SEP },
        font: { bold: true, sz: 16, color: { rgb: 'FFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: DAY_BG } },
      };
    }
  });

  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 5 },
    { wch: 6 },
    { wch: 12 },
    ...classes.map((c) => ({ wch: Math.min(Math.max(String(c.name).length + 6, 19), 24) })),
  ];
  ws['!rows'] = rowHpt.map((h) => ({ hpt: h }));
  // Eslatma: xlsx-js-style muzlatilgan panellarni (`!freeze`) YOZMAYDI — shuning
  // uchun sarlavha qatorlari o'rniga Print_Titles bilan har betda takrorlanadi.
  // Chop etish: tor chekkalar — bir betga ko'proq sinf sig'adi
  ws['!margins'] = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 };
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
  schoolName = '',
  academicYear = '',
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
    const title = String(schoolName || '').trim().toUpperCase() || 'DARS JADVALI';
    const names = [];
    let added = 0;

    groups.forEach((g) => {
      const parts = [g.name];
      if (academicYear) parts.push(`${academicYear} o'quv yili`);
      const ws = buildSheet(XLSX, {
        classes: g.classes,
        timeslots: g.slots,
        subjects, teachers, rooms, lunchGroups, schedule,
        title,
        subtitle: parts.join(' · '),
      });
      if (!ws) return;
      const name = sheetName(g.name, used);
      XLSX.utils.book_append_sheet(wb, ws, name);
      // Har bosma betda sarlavha qatorlari (1-3) qayta chiqsin
      names.push({
        Name: '_xlnm.Print_Titles',
        Sheet: added,
        Ref: `'${name.replace(/'/g, "''")}'!$1:$3`,
      });
      added += 1;
    });

    if (!added) {
      toast?.('Avval dars jadvalini yarating', 'warning');
      return;
    }

    wb.Workbook = { ...(wb.Workbook || {}), Names: names };
    XLSX.writeFile(wb, `dars_jadvali_rangli_${safeFileDate()}.xlsx`);
    toast?.(added > 1 ? `Excelga yuklandi — ${added} ta smena listi ✓` : 'Rangli jadval Excelga yuklandi ✓', 'success');
  } catch (e) {
    toast?.(e.message || 'Excel eksportda xatolik', 'error');
  }
}
