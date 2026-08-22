// Jadval tahlili Excel eksporti — sinflar va o'qituvchilar bo'yicha soatlar tahlili.
// Excel bo'limidan (ImportExport.jsx) chaqiriladi.
//
// 1-varaq "Sinflar tahlili": umumiy statistika + har sinf uchun
//   Fan | Ustoz | Joylashgan | Kerakli | Holat jadvali va Jami qatori.
// 2-varaq "O'qituvchilar tahlili": O'qituvchi | Fanlar | Kiradigan sinflar |
//   Sinflar soni | Jadvaldagi soat | Maksimal soat | Yuklama % | Holat.

import { DAYS } from './constants';
import { loadStyledXLSX } from './excelUtils';
import { isTeachingSlot } from './scheduleGenerator';

function lessonClassIds(lesson) {
  return Array.isArray(lesson.classIds) ? lesson.classIds : [lesson.classId].filter(Boolean);
}

function safeFileDate() {
  return new Date().toISOString().slice(0, 10);
}

// Sinf/ustoz nomlarini tabiiy tartibda (1-A, 2-A, 10-A) saralash
function natCmp(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'uz', { numeric: true, sensitivity: 'base' });
}

// Ranglar
const C_TITLE = { bg: '4338CA', fg: 'FFFFFF' };   // to'q ko'k — bosh sarlavha
const C_BLOCK = { bg: '4F46E5', fg: 'FFFFFF' };   // ko'k — sinf bloki sarlavhasi
const C_HEAD = { bg: 'E0E7FF', fg: '312E81' };    // och ko'k — ustun sarlavhalari
const C_SUM = { bg: 'CFFAFE', fg: '0E4C5C' };     // havorang — statistika sarlavhasi
const C_OK = { bg: 'D1FAE5', fg: '065F46' };      // yashil — to'liq / normal
const C_BAD = { bg: 'FEE2E2', fg: 'B91C1C' };     // qizil — kam / oshib ketgan
const C_WARN = { bg: 'FEF3C7', fg: '92400E' };    // sariq — ortiqcha / yuqori yuklama
const C_MUTE = { bg: 'F1F5F9', fg: '64748B' };    // kulrang — ma'lumot yo'q
const C_TOTAL = { bg: 'E2E8F0', fg: '1E293B' };   // Jami qatori
const ZEBRA = 'F8FAFC';                            // zebra qator foni
const WHITE = 'FFFFFF';

export async function exportAnalysisExcel({
  classes = [],
  subjects = [],
  teachers = [],
  timeslots = [],
  schedule = {},
  classSubjects = {},
  toast,
}) {
  try {
    if (!classes.length) {
      toast?.("Avval sinf qo'shing", 'warning');
      return;
    }
    const hasCS = Object.keys(classSubjects || {}).some((k) => (classSubjects[k] || []).length);
    if (!hasCS) {
      toast?.("Sinf fanlari topilmadi — avval «Sinf fanlari» bo'limini to'ldiring", 'warning');
      return;
    }

    const XLSX = await loadStyledXLSX();
    const sortedTimeslots = [...timeslots].sort(
      (a, b) => Number(a.lessonNumber || 0) - Number(b.lessonNumber || 0)
    );
    const teachingSlots = sortedTimeslots.filter(isTeachingSlot);
    const sortedClasses = [...classes].sort((a, b) => natCmp(a.name, b.name));

    const subjName = (id) => subjects.find((s) => s.id === id)?.name || 'Fan';
    const teacherById = new Map(teachers.map((t) => [t.id, t]));
    const classById = new Map(classes.map((c) => [c.id, c]));
    const teacherName = (id) => teacherById.get(id)?.name || '';
    const className = (id) => classById.get(id)?.name || '';

    // =====================================================================
    // Jadvalni BIR marta o'qib indeks quramiz (tez va aniq)
    // =====================================================================
    // key: `${classId}|${subjectId}` -> { slots:Set, teachers:Set }
    const cellIdx = new Map();
    // key: teacherId -> { hours, classes:Set, subjects:Set }
    const tchIdx = new Map();

    DAYS.forEach((day) => {
      teachingSlots.forEach((ts) => {
        const cell = schedule?.[day]?.[ts.id];
        if (!Array.isArray(cell)) return;
        const slotKey = `${day}|${ts.id}`;
        cell.forEach((l) => {
          if (!l) return;
          const cids = lessonClassIds(l);
          cids.forEach((cid) => {
            const k = `${cid}|${l.subjectId}`;
            let e = cellIdx.get(k);
            if (!e) { e = { slots: new Set(), teachers: new Set() }; cellIdx.set(k, e); }
            e.slots.add(slotKey);
            if (l.teacherId) e.teachers.add(l.teacherId);
          });
          if (l.teacherId) {
            let te = tchIdx.get(l.teacherId);
            if (!te) { te = { hours: 0, classes: new Set(), subjects: new Set() }; tchIdx.set(l.teacherId, te); }
            te.hours += 1;
            if (l.subjectId) te.subjects.add(l.subjectId);
            cids.forEach((cid) => te.classes.add(cid));
          }
        });
      });
    });

    // Sinf uchun shu fan bo'yicha joylashgan soatlar (bir slot = 1 soat)
    const placedHours = (classId, subjectId) => cellIdx.get(`${classId}|${subjectId}`)?.slots.size || 0;

    // Sinf uchun shu fan bo'yicha kerakli soatlar (swap bilan)
    const requiredHours = (classId, subjectId) => {
      let req = 0;
      (classSubjects?.[classId] || []).forEach((a) => {
        if (a.subjectId === subjectId) req += Number(a.weeklyHours || 0);
        if (a.swapEnabled && a.swapSubjectId === subjectId) req += Number(a.weeklyHours || 0);
        if (a.pairEnabled && a.pairSubjectId === subjectId) req += Number(a.weeklyHours || 0);
      });
      return req;
    };

    // Sinf fanlari sozlamasidan ustoz indeksi: teacherId -> { classes:Set, subjects:Set }
    const csIdx = new Map();
    Object.keys(classSubjects || {}).forEach((cid) => {
      (classSubjects[cid] || []).forEach((a) => {
        const ids = new Set();
        if (a.teacherId) ids.add(a.teacherId);
        if (a.swapTeacherId) ids.add(a.swapTeacherId);
        if (a.pairEnabled && a.pairTeacherId) ids.add(a.pairTeacherId);
        if (Array.isArray(a.teacherIds)) a.teacherIds.forEach((x) => x && ids.add(x));
        if (Array.isArray(a.groups)) a.groups.forEach((g) => g?.teacherId && ids.add(g.teacherId));
        ids.forEach((tid) => {
          let e = csIdx.get(tid);
          if (!e) { e = { classes: new Set(), subjects: new Set() }; csIdx.set(tid, e); }
          e.classes.add(cid);
          if (a.subjectId) e.subjects.add(a.subjectId);
          if (a.swapEnabled && a.swapSubjectId) e.subjects.add(a.swapSubjectId);
          if (a.pairEnabled && a.pairSubjectId) e.subjects.add(a.pairSubjectId);
        });
      });
    });

    // Sinf fanlari sozlamasidan ustoz(lar)ni olish (jadvalda hali bo'lmasa — zaxira manba)
    const assignedTeacherIds = (classId, subjectId) => {
      const out = new Set();
      (classSubjects?.[classId] || []).forEach((a) => {
        const match = a.subjectId === subjectId || (a.swapEnabled && a.swapSubjectId === subjectId)
          || (a.pairEnabled && a.pairSubjectId === subjectId);
        if (!match) return;
        if (a.teacherId) out.add(a.teacherId);
        if (Array.isArray(a.teacherIds)) a.teacherIds.forEach((x) => x && out.add(x));
        if (Array.isArray(a.groups)) a.groups.forEach((g) => g?.teacherId && out.add(g.teacherId));
        if (a.swapEnabled && a.swapSubjectId === subjectId && a.swapTeacherId) out.add(a.swapTeacherId);
        if (a.pairEnabled && a.pairSubjectId === subjectId && a.pairTeacherId) out.add(a.pairTeacherId);
      });
      return [...out];
    };

    // Sinf + fan uchun ustoz nomlari: avval jadvaldan, bo'lmasa sozlamadan
    const teachersForCell = (classId, subjectId) => {
      const fromSchedule = [...(cellIdx.get(`${classId}|${subjectId}`)?.teachers || [])];
      const ids = fromSchedule.length ? fromSchedule : assignedTeacherIds(classId, subjectId);
      const names = ids.map(teacherName).filter(Boolean).sort(natCmp);
      return names.length ? names.join(', ') : '—';
    };

    // Sinfning barcha fanlari (asosiy + swap)
    const classSubjectIds = (classId) => {
      const ids = new Set();
      (classSubjects?.[classId] || []).forEach((a) => {
        if (a.subjectId) ids.add(a.subjectId);
        if (a.swapEnabled && a.swapSubjectId) ids.add(a.swapSubjectId);
        if (a.pairEnabled && a.pairSubjectId) ids.add(a.pairSubjectId);
      });
      // Jadvalda bor, lekin sozlamada yo'q fanlar ham ko'rinsin
      cellIdx.forEach((_v, k) => {
        const [cid, sid] = k.split('|');
        if (cid === String(classId) && sid && sid !== 'undefined') ids.add(sid);
      });
      return [...ids];
    };

    // O'qituvchi fanlari: profil + jadval + sinf fanlari sozlamasi
    const teacherSubjectNames = (t) => {
      const ids = new Set(Array.isArray(t.subjectIds) ? t.subjectIds : (t.subjectId ? [t.subjectId] : []));
      (tchIdx.get(t.id)?.subjects || new Set()).forEach((x) => ids.add(x));
      if (!ids.size) (csIdx.get(t.id)?.subjects || new Set()).forEach((x) => ids.add(x));
      const names = [...ids].map(subjName).filter(Boolean);
      return [...new Set(names)].sort(natCmp).join(', ') || '—';
    };

    // O'qituvchi kiradigan sinflar — avval jadvaldan, bo'lmasa sozlamadan
    const teacherClassInfo = (t) => {
      let ids = new Set(tchIdx.get(t.id)?.classes || []);
      if (!ids.size) ids = new Set(csIdx.get(t.id)?.classes || []);
      const names = [...ids].map(className).filter(Boolean).sort(natCmp);
      return { text: names.length ? names.join(', ') : '—', count: names.length };
    };

    // ——— Umumiy statistika ———
    let totalPlaced = 0;
    let totalRequired = 0;
    const classData = sortedClasses.map((cls) => {
      const rows = classSubjectIds(cls.id)
        .map((sid) => {
          const got = placedHours(cls.id, sid);
          const need = requiredHours(cls.id, sid);
          return { name: subjName(sid), ustoz: teachersForCell(cls.id, sid), got, need };
        })
        .filter((r) => r.got > 0 || r.need > 0)
        .sort((a, b) => natCmp(a.name, b.name));
      const got = rows.reduce((s, x) => s + x.got, 0);
      const need = rows.reduce((s, x) => s + x.need, 0);
      totalPlaced += got;
      totalRequired += need;
      return { cls, rows, got, need };
    });
    const fillPct = totalRequired > 0 ? Math.round((totalPlaced / totalRequired) * 100) : 100;

    // =====================================================================
    // 1-VARAQ: Sinflar tahlili  (Fan | Ustoz | Joylashgan | Kerakli | Holat)
    // =====================================================================
    const aoa1 = [];
    const styles1 = [];
    const rowHpt1 = [];
    const zebra1 = new Set();
    const COLS1 = 5;
    const put1 = (row, hpt = 20) => { aoa1.push(row); rowHpt1.push(hpt); return aoa1.length - 1; };
    const mark1 = (r, c, color, opts = {}) => styles1.push({ r, c, color, ...opts });
    const blank1 = (h = 8) => put1(['', '', '', '', ''], h);

    let R = put1([`Jadval tahlili — sinflar bo'yicha (${safeFileDate()})`, '', '', '', ''], 34);
    for (let c = 0; c < COLS1; c++) mark1(R, c, C_TITLE, { sz: 16, merge: c === 0 ? COLS1 : 0 });

    blank1(8);

    R = put1(['Sinflar', "O'qituvchilar", 'Fanlar', 'Joylashgan soat', "To'ldirish"], 22);
    for (let c = 0; c < COLS1; c++) mark1(R, c, C_SUM, { sz: 11 });
    R = put1([
      sortedClasses.length,
      teachers.length,
      subjects.length,
      `${totalPlaced} / ${totalRequired}`,
      `${fillPct}%`,
    ], 26);
    for (let c = 0; c < COLS1; c++) mark1(R, c, fillPct >= 100 ? C_OK : C_WARN, { sz: 13 });

    blank1(12);

    classData.forEach(({ cls, rows, got, need }) => {
      const pct = need > 0 ? Math.round((got / need) * 100) : 100;
      R = put1([`${cls.name} sinf — Jami: ${got}/${need} soat (${pct}%)`, '', '', '', ''], 28);
      for (let c = 0; c < COLS1; c++) mark1(R, c, C_BLOCK, { sz: 13, merge: c === 0 ? COLS1 : 0 });

      R = put1(['Fan', 'Ustoz', 'Joylashgan', 'Kerakli', 'Holat'], 22);
      for (let c = 0; c < COLS1; c++) mark1(R, c, C_HEAD, { sz: 11 });

      rows.forEach(({ name, ustoz, got: g, need: n }, i) => {
        let holat; let hc;
        if (n === 0) { holat = 'Rejada yo‘q'; hc = C_MUTE; }
        else if (g === n) { holat = "To'liq"; hc = C_OK; }
        else if (g < n) { holat = `${n - g} soat kam`; hc = C_BAD; }
        else { holat = `${g - n} soat ortiqcha`; hc = C_WARN; }
        R = put1([name, ustoz, g, n, holat], ustoz.length > 34 ? 30 : 21);
        if (i % 2 === 1) zebra1.add(R);
        mark1(R, 0, null, { left: true, bold: true });
        mark1(R, 1, null, { left: true, muted: ustoz === '—' });
        mark1(R, 4, hc);
      });

      R = put1(['Jami', '', got, need, need > 0 ? `${pct}%` : '—'], 24);
      for (let c = 0; c < COLS1; c++) mark1(R, c, C_TOTAL, { bold: true, left: c === 0 });

      blank1(12);
    });

    // =====================================================================
    // 2-VARAQ: O'qituvchilar tahlili
    // =====================================================================
    const aoa2 = [];
    const styles2 = [];
    const rowHpt2 = [];
    const zebra2 = new Set();
    const COLS2 = 8;
    const put2 = (row, hpt = 20) => { aoa2.push(row); rowHpt2.push(hpt); return aoa2.length - 1; };
    const mark2 = (r, c, color, opts = {}) => styles2.push({ r, c, color, ...opts });
    const empty2 = ['', '', '', '', '', '', '', ''];

    R = put2([`Jadval tahlili — o'qituvchilar bo'yicha (${safeFileDate()})`, ...empty2.slice(1)], 34);
    for (let c = 0; c < COLS2; c++) mark2(R, c, C_TITLE, { sz: 16, merge: c === 0 ? COLS2 : 0 });

    put2([...empty2], 8);

    const headRow2 = put2([
      "O'qituvchi", 'Fanlar', 'Kiradigan sinflar', 'Sinflar soni',
      'Jadvaldagi soat', 'Maksimal soat', 'Yuklama %', 'Holat',
    ], 26);
    for (let c = 0; c < COLS2; c++) mark2(headRow2, c, C_HEAD, { sz: 11 });

    const sortedTeachers = [...teachers].sort((a, b) => natCmp(a.name, b.name));
    let sumHours = 0;
    let sumMax = 0;
    let lastTeacherRow = headRow2;

    sortedTeachers.forEach((t, i) => {
      const hours = tchIdx.get(t.id)?.hours || 0;
      const max = Number(t.maxWeeklyHours || 28);
      const pct = max > 0 ? Math.round((hours / max) * 100) : 0;
      const info = teacherClassInfo(t);
      const fanlar = teacherSubjectNames(t);
      sumHours += hours;
      sumMax += max;

      let holat; let hc; let pc;
      if (hours === 0) { holat = 'Darsi yo‘q'; hc = C_MUTE; pc = C_MUTE; }
      else if (hours > max) { holat = 'Oshib ketgan'; hc = C_BAD; pc = C_BAD; }
      else if (pct >= 90) { holat = 'Yuqori yuklama'; hc = C_WARN; pc = C_WARN; }
      else { holat = 'Normal'; hc = C_OK; pc = C_OK; }

      const longest = Math.max(fanlar.length, info.text.length);
      R = put2([t.name, fanlar, info.text, info.count, hours, max, `${pct}%`, holat],
        longest > 70 ? 40 : longest > 36 ? 30 : 21);
      lastTeacherRow = R;
      if (i % 2 === 1) zebra2.add(R);
      mark2(R, 0, null, { left: true, bold: true });
      mark2(R, 1, null, { left: true, muted: fanlar === '—' });
      mark2(R, 2, null, { left: true, muted: info.text === '—' });
      mark2(R, 6, pc);
      mark2(R, 7, hc);
    });

    const sumPct = sumMax > 0 ? Math.round((sumHours / sumMax) * 100) : 0;
    R = put2(['Jami', '', '', sortedTeachers.length, sumHours, sumMax, `${sumPct}%`, ''], 26);
    for (let c = 0; c < COLS2; c++) mark2(R, c, C_TOTAL, { bold: true, left: c === 0 });

    // ——— Varaq yaratish va uslublash ———
    const thin = { style: 'thin', color: { rgb: 'CBD5E1' } };
    const border = { top: thin, bottom: thin, left: thin, right: thin };

    const buildSheet = (aoa, styleList, rowHpt, colWidths, zebraRows, autofilter) => {
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const range = XLSX.utils.decode_range(ws['!ref']);
      const styleMap = new Map();
      styleList.forEach((s) => styleMap.set(`${s.r}|${s.c}`, s));

      for (let r = range.s.r; r <= range.e.r; r++) {
        const rowHasContent = aoa[r] && aoa[r].some((v) => v !== '' && v !== null && v !== undefined);
        const zb = zebraRows.has(r) ? ZEBRA : WHITE;
        for (let c = range.s.c; c <= range.e.c; c++) {
          const ref = XLSX.utils.encode_cell({ r, c });
          if (!ws[ref]) ws[ref] = { t: 's', v: '' };
          const st = styleMap.get(`${r}|${c}`);
          if (st) {
            const { color, sz = 11, bold = false, left = false, muted = false } = st;
            ws[ref].s = {
              alignment: { horizontal: left ? 'left' : 'center', vertical: 'center', wrapText: true, indent: left ? 1 : 0 },
              border,
              font: {
                name: 'Calibri',
                bold: bold || !!color,
                sz,
                color: { rgb: color ? color.fg : (muted ? '94A3B8' : '1F2937') },
              },
              fill: { patternType: 'solid', fgColor: { rgb: color ? color.bg : zb } },
            };
          } else if (rowHasContent) {
            ws[ref].s = {
              alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
              border,
              font: { name: 'Calibri', sz: 11, color: { rgb: '1F2937' } },
              fill: { patternType: 'solid', fgColor: { rgb: zb } },
            };
          } else {
            // Bo'sh ajratuvchi qator — chegarasiz, toza
            ws[ref].s = {
              alignment: { horizontal: 'center', vertical: 'center' },
              font: { name: 'Calibri', sz: 11 },
              fill: { patternType: 'solid', fgColor: { rgb: WHITE } },
            };
          }
        }
      }

      const merges = [];
      styleList.forEach(({ r, c, merge = 0 }) => {
        if (merge > 1) merges.push({ s: { r, c }, e: { r, c: c + merge - 1 } });
      });
      ws['!merges'] = merges;
      ws['!cols'] = colWidths;
      ws['!rows'] = rowHpt.map((h) => ({ hpt: h }));
      if (autofilter) ws['!autofilter'] = { ref: autofilter };
      return ws;
    };

    const ws1 = buildSheet(
      aoa1, styles1, rowHpt1,
      [{ wch: 30 }, { wch: 34 }, { wch: 13 }, { wch: 11 }, { wch: 18 }],
      zebra1, null
    );
    const ws2 = buildSheet(
      aoa2, styles2, rowHpt2,
      [{ wch: 28 }, { wch: 40 }, { wch: 44 }, { wch: 12 }, { wch: 15 }, { wch: 14 }, { wch: 11 }, { wch: 17 }],
      zebra2,
      `${XLSX.utils.encode_cell({ r: headRow2, c: 0 })}:${XLSX.utils.encode_cell({ r: lastTeacherRow, c: COLS2 - 1 })}`
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Sinflar tahlili');
    XLSX.utils.book_append_sheet(wb, ws2, "O'qituvchilar tahlili");
    XLSX.writeFile(wb, `jadval_tahlili_${safeFileDate()}.xlsx`);
    toast?.('Jadval tahlili Excelga yuklandi ✓', 'success');
  } catch (e) {
    toast?.(e.message || 'Excel eksportda xatolik', 'error');
  }
}