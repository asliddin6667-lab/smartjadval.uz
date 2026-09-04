// ═══════════════════════════════════════════════════════════════════
//  USTOZLAR SETKASI — EXCEL EKSPORTI
//
//  Ikki joydan chaqiriladi:
//    1) Dars jadvali → «Ustoz setkasi» (TeacherGrid.jsx) — «📥 Excel»
//       tugmalari: joriy ustoz yoki barcha ustozlar
//    2) Excel bo'limi (ImportExport.jsx) — «Ustozlar setkasi» kartasi
//
//  HAR BIR USTOZ O'ZINI TANLAB KO'RA OLADI — Excelda uchta yo'l bilan:
//    • HAR USTOZ — ALOHIDA VARAQ (list). Varaq yorlig'ini bosish = tanlash.
//    • «📋 Ustozlar» varag'i — ro'yxat, har qatordan o'z varag'iga HAVOLA
//      (ism bosilsa o'sha ustoz setkasi ochiladi) + ustunlarda avtofiltr.
//    • «🔎 Barcha darslar» varag'i — yassi ro'yxat, sarlavhada AVTOFILTR:
//      «Ustoz» ustunidan o'zini belgilaydi va faqat o'z darslarini ko'radi.
//
//  ⚠️ Nega ochiluvchi ro'yxat (data validation) emas: `xlsx-js-style`
//     yozuvchisida data validation kodi UMUMAN YO'Q — yozilmay, jimgina
//     yo'qolib ketardi. Avtofiltr esa yoziladi va Excelning O'ZI tanlash
//     ro'yxatini chiqaradi.
//
//  Ustozning darsi = katakda `teacherIdsOf(l)` ichida shu ustoz bo'lgan
//  yozuvlar (juft/toq almashinuvida ikkinchi ustoz ham). Kartaga guruhlash
//  `sameCard` bilan — ekrandagi setka bilan AYNI qoida.
// ═══════════════════════════════════════════════════════════════════

import { DAYS } from './constants';
import { loadStyledXLSX, hexToExcelRGB, readableTextRGB } from './excelUtils';
import { isTeachingSlot } from './scheduleGenerator';
import { groupSlotsByShift, shiftSlotNumbers } from './shiftSlots';
import { teacherIdsOf, classIdsOf, sameCard } from './moveResolver';
import { teacherAssignments, placedSubjectHours } from './teacherAssignments';

// ——— Chegaralar ———
const HAIR = { style: 'thin', color: { rgb: 'CBD5E1' } };
const SEP = { style: 'medium', color: { rgb: '1E293B' } };
const SOFT = { style: 'thin', color: { rgb: '94A3B8' } };

// ——— Palitra ———
const TITLE_BG = '0F172A';   // maktab nomi
const SUB_BG = '1D4ED8';     // hujjat turi
const NAME_BG = '4338CA';    // ustoz ismi bandi
const META_BG = 'EEF2FF';    // fanlar / jami soat qatori
const META_FG = '3730A3';
const HEAD_BG = '334155';    // Soat / Vaqt sarlavhasi
const LEAD_BG = 'F1F5F9';    // Soat / Vaqt ustunlari
const SHIFT_BG = 'E0E7FF';   // smena ajratkichi
const SHIFT_FG = '312E81';
const TOTAL_BG = 'C7D2FE';   // «Jami» qatori
const TOTAL_FG = '1E1B4B';
const OFF_BG = 'FEF3C7';     // dam olish kuni
const OFF_FG = 'B45309';
const LOCK_BG = 'FEE2E2';    // qulflangan soat
const LOCK_FG = 'B91C1C';
const BAND_BG = '13A05A';    // obed / tanaffus
const BAND_FG = 'FFFFFF';
const FREE_BG = 'FFFFFF';    // bo'sh soat
const LINK_FG = '1D4ED8';

// Kun sarlavhalari — har kun o'z rangida
const DAY_HEADS = [
  { bg: '1E40AF', fg: 'FFFFFF' },
  { bg: '047857', fg: 'FFFFFF' },
  { bg: 'B45309', fg: 'FFFFFF' },
  { bg: '7E22CE', fg: 'FFFFFF' },
  { bg: 'BE123C', fg: 'FFFFFF' },
  { bg: '0E7490', fg: 'FFFFFF' },
];

const MID = { horizontal: 'center', vertical: 'center', wrapText: true };
const LEFT = { horizontal: 'left', vertical: 'center', wrapText: true };

const INDEX_SHEET = '📋 Ustozlar';
const FLAT_SHEET = '🔎 Barcha darslar';

function safeFileDate() {
  return new Date().toISOString().slice(0, 10);
}

// Fayl nomi uchun xavfsiz bo'lak: "Abdurasulov Asilbek" → "abdurasulov_asilbek"
function fileSlug(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[‘’`']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'ustoz';
}

// Excel varaq nomi: 31 belgi, taqiqlangan belgilarsiz, takrorlanmaydigan
function sheetName(raw, used) {
  const base = String(raw || 'Ustoz').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Ustoz';
  let name = base;
  let n = 2;
  while (used.has(name)) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
    n += 1;
  }
  used.add(name);
  return name;
}

// Ichki havola manzili: varaq nomidagi apostrof IKKILANADI ('')
function sheetRef(name) {
  return `#'${String(name).replace(/'/g, "''")}'!A1`;
}

function timeLabel(ts) {
  return `${ts?.startTime || ''}${ts?.endTime ? '-' + ts.endTime : ''}`;
}

// ═══════════════════════════════════════════════════════════════════
//  Bitta ustozning haftalik ma'lumoti (setka + reja)
// ═══════════════════════════════════════════════════════════════════
function teacherModel({ teacher, classes, subjects, rooms, timeslots, shifts, schedule, classSubjects }) {
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));
  const classMap = new Map(classes.map((c) => [c.id, c]));
  const roomMap = new Map(rooms.map((r) => [r.id, r]));

  const slotGroups = groupSlotsByShift(timeslots, shifts);
  const slotNumById = shiftSlotNumbers(slotGroups);
  const sortedTimeslots = [...timeslots].sort(
    (a, b) => Number(a.lessonNumber || 0) - Number(b.lessonNumber || 0)
  );

  const offDays = new Set(Array.isArray(teacher.offDays) ? teacher.offDays : []);
  const blocked = teacher.blockedSlots && typeof teacher.blockedSlots === 'object' ? teacher.blockedSlots : {};
  const isBlocked = (day, slotId) => Array.isArray(blocked[day]) && blocked[day].includes(slotId);

  // Katakdagi ustoz darslari — kartaga guruhlangan (ekrandagi setka bilan bir xil)
  function cardsAt(day, slotId) {
    const cell = schedule?.[day]?.[slotId];
    if (!Array.isArray(cell)) return [];
    const mine = cell.filter((l) => teacherIdsOf(l).includes(teacher.id));
    const groups = [];
    mine.forEach((l) => {
      const g = groups.find((entries) => sameCard(entries[0], l));
      if (g) g.push(l); else groups.push([l]);
    });
    return groups.map((entries) => entries[0]);
  }

  const cardInfo = (l) => {
    const classNames = classIdsOf(l).map((id) => classMap.get(id)?.name).filter(Boolean).join(', ') || '—';
    const subject = subjectMap.get(l.subjectId)?.name || l.subjectName || 'Fan';
    const room = l.roomId ? (roomMap.get(l.roomId)?.name || 'Xona') : '';
    const bg = hexToExcelRGB(subjectMap.get(l.subjectId)?.color);
    return {
      classNames,
      subject,
      room,
      groupPart: l.groupPart || '',
      bg: bg || 'BDD7EE',
      fg: bg ? readableTextRGB(bg) : '1F2937',
    };
  };

  // Kun bo'yicha va jami joylashgan soat
  const perDay = DAYS.map((day) =>
    sortedTimeslots.reduce((n, ts) => n + (isTeachingSlot(ts) && cardsAt(day, ts.id).length ? 1 : 0), 0)
  );
  const total = perDay.reduce((a, b) => a + b, 0);

  // Reja: sinf + fan qatorlari (yagona manbadan — teacherAssignments.js)
  const plan = teacherAssignments({ teacherId: teacher.id, classes, classSubjects, subjects })
    .map((a) => ({ ...a, got: placedSubjectHours(schedule, sortedTimeslots, a.classId, a.subjectId) }));

  const subjectNames = [...new Set(plan.map((p) => p.subjectName))];

  return {
    teacher, slotGroups, slotNumById, offDays, isBlocked,
    cardsAt, cardInfo, perDay, total, plan, subjectNames,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  BITTA USTOZ VARAG'I
// ═══════════════════════════════════════════════════════════════════
function buildTeacherSheet(XLSX, model, { title, subtitle, backSheet }) {
  const {
    teacher, slotGroups, slotNumById, offDays, isBlocked,
    cardsAt, cardInfo, perDay, total, plan, subjectNames,
  } = model;

  const LEAD = 2;                       // Soat | Vaqt
  const COLS = LEAD + DAYS.length;      // 8
  const HEAD_ROWS = 5;

  const aoa = [];
  const merges = [];
  const hpt = [];
  const styles = new Map();
  const links = [];
  const put = (r, c, s) => styles.set(`${r}:${c}`, s);
  const row = () => new Array(COLS).fill('');

  // ——— 0: maktab nomi ———
  const r0 = row(); r0[0] = title;
  aoa.push(r0); hpt.push(34);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COLS - 1 } });

  // ——— 1: hujjat turi / o'quv yili ———
  const r1 = row(); r1[0] = subtitle;
  aoa.push(r1); hpt.push(22);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: COLS - 1 } });

  // ——— 2: ustoz ismi (+ ro'yxatga qaytish havolasi) ———
  const r2 = row();
  r2[0] = `👨‍🏫  ${teacher.name}`;
  const hasBack = Boolean(backSheet);
  if (hasBack) {
    r2[COLS - 2] = "◀ Ro'yxat";
    merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: COLS - 3 } });
    merges.push({ s: { r: 2, c: COLS - 2 }, e: { r: 2, c: COLS - 1 } });
    links.push({ r: 2, c: COLS - 2, target: sheetRef(backSheet), tip: "Ustozlar ro'yxatiga qaytish" });
  } else {
    merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: COLS - 1 } });
  }
  aoa.push(r2); hpt.push(32);

  // ——— 3: fanlar · jami soat · dam olish ———
  const metaParts = [];
  if (subjectNames.length) metaParts.push(`Fanlari: ${subjectNames.join(', ')}`);
  metaParts.push(`Haftalik joylashgan: ${total} soat`);
  if (offDays.size) metaParts.push(`Dam olish: ${[...offDays].join(', ')}`);
  if (teacher.phone) metaParts.push(`Tel: ${teacher.phone}`);
  const r3 = row(); r3[0] = metaParts.join('   ·   ');
  aoa.push(r3); hpt.push(22);
  merges.push({ s: { r: 3, c: 0 }, e: { r: 3, c: COLS - 1 } });

  // ——— 4: ustun nomlari ———
  aoa.push(['Soat', 'Vaqt', ...DAYS]);
  hpt.push(28);

  // ——— Setka ———
  // Har smenada oxirgi DARS bo'lgan soatgacha ko'rsatiladi: keyingi bo'sh
  // qatorlar chiqarilmasa varaq ixcham va o'qiladigan bo'ladi.
  let r = HEAD_ROWS;
  const shiftRows = [];

  const busyIn = (g) => {
    let last = -1;
    g.slots.forEach((ts, i) => {
      if (isTeachingSlot(ts) && DAYS.some((d) => cardsAt(d, ts.id).length)) last = i;
    });
    return last;
  };
  const anyBusy = slotGroups.some((g) => busyIn(g) >= 0);

  slotGroups.forEach((g) => {
    const last = busyIn(g);
    // Darsi umuman yo'q ustozda ham setka ko'rinsin — u holda hamma soat chiqadi
    const slots = anyBusy ? (last < 0 ? [] : g.slots.slice(0, last + 1)) : g.slots;
    if (!slots.length) return;

    if (slotGroups.length > 1) {
      const band = row();
      band[0] = `🕐 ${g.name} · ${g.range}`;
      aoa.push(band); hpt.push(24);
      merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } });
      shiftRows.push(r);
      r += 1;
    }

    slots.forEach((ts) => {
      const line = row();
      const num = slotNumById.get(ts.id) ?? ts.lessonNumber ?? '';

      // Obed / tanaffus — butun en bo'ylab band
      if (!isTeachingSlot(ts)) {
        line[0] = num;
        line[1] = timeLabel(ts);
        line[LEAD] = ts.title || (ts.type === 'lunch' ? '🍽️ Tushlik vaqti' : 'Tanaffus');
        aoa.push(line); hpt.push(20);
        merges.push({ s: { r, c: LEAD }, e: { r, c: COLS - 1 } });
        put(r, 0, {
          alignment: MID, border: { top: HAIR, bottom: HAIR, left: SEP, right: SOFT },
          font: { bold: true, sz: 11, color: { rgb: '1F2937' } },
          fill: { patternType: 'solid', fgColor: { rgb: LEAD_BG } },
        });
        put(r, 1, {
          alignment: MID, border: { top: HAIR, bottom: HAIR, left: SOFT, right: SEP },
          font: { bold: true, sz: 11, color: { rgb: '1F2937' } },
          fill: { patternType: 'solid', fgColor: { rgb: LEAD_BG } },
        });
        for (let c = LEAD; c < COLS; c++) {
          put(r, c, {
            alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
            border: { top: HAIR, bottom: HAIR, left: SEP, right: SEP },
            font: { bold: true, sz: 11, color: { rgb: BAND_FG } },
            fill: { patternType: 'solid', fgColor: { rgb: BAND_BG } },
          });
        }
        r += 1;
        return;
      }

      line[0] = `${num}-dars`;
      line[1] = timeLabel(ts);

      let maxLines = 1;
      DAYS.forEach((day, di) => {
        const c = LEAD + di;
        if (offDays.has(day)) {
          line[c] = '🌙 Dam olish';
          put(r, c, {
            alignment: MID, border: { top: HAIR, bottom: HAIR, left: SEP, right: SEP },
            font: { bold: true, sz: 11, color: { rgb: OFF_FG } },
            fill: { patternType: 'solid', fgColor: { rgb: OFF_BG } },
          });
          return;
        }
        const cards = cardsAt(day, ts.id);
        if (!cards.length) {
          if (isBlocked(day, ts.id)) {
            line[c] = '🔒 Qulflangan';
            put(r, c, {
              alignment: MID, border: { top: HAIR, bottom: HAIR, left: SEP, right: SEP },
              font: { bold: true, sz: 10.5, color: { rgb: LOCK_FG } },
              fill: { patternType: 'solid', fgColor: { rgb: LOCK_BG } },
            });
          } else {
            put(r, c, {
              alignment: MID, border: { top: HAIR, bottom: HAIR, left: SEP, right: SEP },
              font: { sz: 11, color: { rgb: '94A3B8' } },
              fill: { patternType: 'solid', fgColor: { rgb: FREE_BG } },
            });
          }
          return;
        }
        // Katakda: 1-satr — sinf(lar), 2-satr — fan, 3-satr — xona (+ guruh)
        const infos = cards.map(cardInfo);
        const text = infos
          .map((it) => {
            const third = [it.room || 'Xonasiz', it.groupPart].filter(Boolean).join(' · ');
            return `${it.classNames}\n${it.subject}\n${third}`;
          })
          .join('\n');
        line[c] = text;
        maxLines = Math.max(maxLines, text.split('\n').length);
        put(r, c, {
          alignment: MID, border: { top: HAIR, bottom: HAIR, left: SEP, right: SEP },
          font: { bold: true, sz: 10.5, color: { rgb: infos[0].fg } },
          fill: { patternType: 'solid', fgColor: { rgb: infos[0].bg } },
        });
      });

      aoa.push(line);
      hpt.push(Math.min(14 + maxLines * 13.5, 108));
      put(r, 0, {
        alignment: MID, border: { top: HAIR, bottom: HAIR, left: SEP, right: SOFT },
        font: { bold: true, sz: 11.5, color: { rgb: '0F172A' } },
        fill: { patternType: 'solid', fgColor: { rgb: LEAD_BG } },
      });
      put(r, 1, {
        alignment: MID, border: { top: HAIR, bottom: HAIR, left: SOFT, right: SEP },
        font: { bold: true, sz: 10.5, color: { rgb: '475569' } },
        fill: { patternType: 'solid', fgColor: { rgb: LEAD_BG } },
      });
      r += 1;
    });
  });

  // ——— «JAMI» qatori: kun bo'yicha soat ———
  const totalRow = row();
  totalRow[0] = 'JAMI';
  totalRow[1] = `${total} soat`;
  DAYS.forEach((_, di) => { totalRow[LEAD + di] = perDay[di]; });
  aoa.push(totalRow); hpt.push(26);
  for (let c = 0; c < COLS; c++) {
    put(r, c, {
      alignment: MID,
      border: { top: SEP, bottom: SEP, left: c >= LEAD ? SEP : SOFT, right: c >= LEAD ? SEP : SOFT },
      font: { bold: true, sz: 12, color: { rgb: TOTAL_FG } },
      fill: { patternType: 'solid', fgColor: { rgb: TOTAL_BG } },
    });
  }
  r += 1;

  // ——— Bo'sh ajratkich ———
  aoa.push(row()); hpt.push(12); r += 1;

  // ——— REJA JADVALI: sinf · fan · reja · joylashgan · holat ———
  const planHead = row();
  planHead[0] = 'Sinf'; planHead[2] = 'Fan'; planHead[4] = 'Reja';
  planHead[5] = 'Joylashgan'; planHead[6] = 'Holat';
  aoa.push(planHead); hpt.push(24);
  merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
  merges.push({ s: { r, c: 2 }, e: { r, c: 3 } });
  merges.push({ s: { r, c: 6 }, e: { r, c: 7 } });
  for (let c = 0; c < COLS; c++) {
    put(r, c, {
      alignment: MID, border: { top: SEP, bottom: SEP, left: SOFT, right: SOFT },
      font: { bold: true, sz: 11.5, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: HEAD_BG } },
    });
  }
  r += 1;

  if (!plan.length) {
    const none = row();
    none[0] = "Bu ustozga «Sinf fanlari» bo'limida fan biriktirilmagan.";
    aoa.push(none); hpt.push(22);
    merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } });
    for (let c = 0; c < COLS; c++) {
      put(r, c, {
        alignment: LEFT, border: { top: HAIR, bottom: HAIR, left: SOFT, right: SOFT },
        font: { italic: true, sz: 11, color: { rgb: '64748B' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'F8FAFC' } },
      });
    }
    r += 1;
  } else {
    plan.forEach((p) => {
      const left = Math.max(0, Number(p.need || 0) - Number(p.got || 0));
      const state = left > 0 ? `${left} soat qoldi` : "✓ to'liq";
      const roles = p.roles.length > 1 || !p.simple ? ` (${p.roles.join(', ')})` : '';
      const line = row();
      line[0] = p.className;
      line[2] = p.subjectName + roles;
      line[4] = Number(p.need || 0);
      line[5] = Number(p.got || 0);
      line[6] = state;
      aoa.push(line); hpt.push(20);
      merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
      merges.push({ s: { r, c: 2 }, e: { r, c: 3 } });
      merges.push({ s: { r, c: 6 }, e: { r, c: 7 } });
      const stateBg = left > 0 ? 'FEF2F2' : 'F0FDF4';
      const stateFg = left > 0 ? 'B91C1C' : '15803D';
      for (let c = 0; c < COLS; c++) {
        const isState = c >= 6;
        put(r, c, {
          alignment: c === 2 || c === 3 ? LEFT : MID,
          border: { top: HAIR, bottom: HAIR, left: SOFT, right: SOFT },
          font: { bold: c < 2 || isState, sz: 11, color: { rgb: isState ? stateFg : '1F2937' } },
          fill: { patternType: 'solid', fgColor: { rgb: isState ? stateBg : 'FFFFFF' } },
        });
      }
      r += 1;
    });
  }

  // ═══ Uslublarni qo'llash ═══
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cell = (R, C) => {
    const ref = XLSX.utils.encode_cell({ r: R, c: C });
    if (!ws[ref]) ws[ref] = { t: 's', v: '' };
    return ws[ref];
  };

  // 0 — maktab nomi
  for (let c = 0; c < COLS; c++) {
    cell(0, c).s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { bold: true, sz: 18, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: TITLE_BG } },
    };
  }
  // 1 — hujjat turi
  for (let c = 0; c < COLS; c++) {
    cell(1, c).s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: SUB_BG } },
    };
  }
  // 2 — ustoz ismi (+ havola)
  for (let c = 0; c < COLS; c++) {
    const isLink = hasBack && c >= COLS - 2;
    cell(2, c).s = {
      alignment: { horizontal: isLink ? 'center' : 'left', vertical: 'center', indent: isLink ? 0 : 1 },
      font: { bold: true, sz: isLink ? 11 : 16, underline: isLink, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: NAME_BG } },
    };
  }
  // 3 — meta
  for (let c = 0; c < COLS; c++) {
    cell(3, c).s = {
      alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
      font: { bold: true, sz: 11, color: { rgb: META_FG } },
      fill: { patternType: 'solid', fgColor: { rgb: META_BG } },
    };
  }
  // 4 — ustun nomlari
  for (let c = 0; c < LEAD; c++) {
    cell(4, c).s = {
      alignment: MID, border: { top: SEP, bottom: SEP, left: SEP, right: SOFT },
      font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: HEAD_BG } },
    };
  }
  DAYS.forEach((_, di) => {
    const h = DAY_HEADS[di % DAY_HEADS.length];
    cell(4, LEAD + di).s = {
      alignment: MID, border: { top: SEP, bottom: SEP, left: SEP, right: SEP },
      font: { bold: true, sz: 13, color: { rgb: h.fg } },
      fill: { patternType: 'solid', fgColor: { rgb: h.bg } },
    };
  });
  // Smena ajratkichlari
  shiftRows.forEach((R) => {
    for (let c = 0; c < COLS; c++) {
      cell(R, c).s = {
        alignment: { horizontal: 'center', vertical: 'center' },
        border: { top: SEP, bottom: SEP },
        font: { bold: true, sz: 12, color: { rgb: SHIFT_FG } },
        fill: { patternType: 'solid', fgColor: { rgb: SHIFT_BG } },
      };
    }
  });
  // Setka va reja kataklari
  styles.forEach((s, key) => {
    const [R, C] = key.split(':').map(Number);
    cell(R, C).s = s;
  });
  // Uslubsiz qolgan kataklar — oq fon (Excelning kulrang setkasi ko'rinmasin)
  for (let R = HEAD_ROWS; R <= range.e.r; R++) {
    for (let C = 0; C < COLS; C++) {
      const ref = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[ref] && ws[ref].s) continue;
      cell(R, C).s = { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } } };
    }
  }
  // Havolalar
  links.forEach(({ r: R, c: C, target, tip }) => {
    cell(R, C).l = { Target: target, Tooltip: tip };
  });

  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 10 }, { wch: 13 }, ...DAYS.map(() => ({ wch: 25 }))];
  ws['!rows'] = hpt.map((h) => ({ hpt: h }));
  ws['!margins'] = { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 };
  return ws;
}

// ═══════════════════════════════════════════════════════════════════
//  «📋 Ustozlar» — ro'yxat + har qatordan o'z varag'iga havola
// ═══════════════════════════════════════════════════════════════════
function buildIndexSheet(XLSX, rows, { title, subtitle }) {
  const COLS = 4 + DAYS.length;  // № | Ustoz | Fanlari | <kunlar> | Jami
  const aoa = [];
  const hpt = [];
  const merges = [];
  const links = [];
  const blank = () => new Array(COLS).fill('');

  const t = blank(); t[0] = title;
  aoa.push(t); hpt.push(32);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COLS - 1 } });

  const s = blank(); s[0] = subtitle;
  aoa.push(s); hpt.push(22);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: COLS - 1 } });

  aoa.push(['№', 'Ustoz', 'Fanlari', ...DAYS, 'Jami soat']);
  hpt.push(26);

  rows.forEach((row, i) => {
    aoa.push([i + 1, row.name, row.subjects, ...row.perDay, row.total]);
    hpt.push(20);
    if (row.sheet) links.push({ r: 3 + i, c: 1, target: sheetRef(row.sheet), tip: `${row.name} — setkasini ochish` });
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const cell = (R, C) => {
    const ref = XLSX.utils.encode_cell({ r: R, c: C });
    if (!ws[ref]) ws[ref] = { t: 's', v: '' };
    return ws[ref];
  };

  for (let c = 0; c < COLS; c++) {
    cell(0, c).s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { bold: true, sz: 17, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: TITLE_BG } },
    };
    cell(1, c).s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { bold: true, sz: 11.5, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: SUB_BG } },
    };
    const isDayCol = c >= 3 && c < 3 + DAYS.length;
    cell(2, c).s = {
      alignment: MID, border: { top: SEP, bottom: SEP, left: SOFT, right: SOFT },
      font: { bold: true, sz: 11.5, color: { rgb: 'FFFFFF' } },
      fill: {
        patternType: 'solid',
        fgColor: { rgb: isDayCol ? DAY_HEADS[(c - 3) % DAY_HEADS.length].bg : HEAD_BG },
      },
    };
  }

  rows.forEach((row, i) => {
    const R = 3 + i;
    const zebra = i % 2 ? 'F8FAFC' : 'FFFFFF';
    for (let c = 0; c < COLS; c++) {
      const isName = c === 1;
      const isTotal = c === COLS - 1;
      cell(R, c).s = {
        alignment: c === 1 || c === 2 ? LEFT : MID,
        border: { top: HAIR, bottom: HAIR, left: SOFT, right: SOFT },
        font: {
          bold: isName || isTotal,
          sz: 11,
          underline: isName && Boolean(row.sheet),
          color: { rgb: isName ? LINK_FG : (isTotal ? TOTAL_FG : '1F2937') },
        },
        fill: { patternType: 'solid', fgColor: { rgb: isTotal ? TOTAL_BG : zebra } },
      };
    }
  });

  links.forEach(({ r: R, c: C, target, tip }) => { cell(R, C).l = { Target: target, Tooltip: tip }; });

  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 34 }, ...DAYS.map(() => ({ wch: 11 })), { wch: 12 }];
  ws['!rows'] = hpt.map((h) => ({ hpt: h }));
  if (rows.length) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2 + rows.length, c: COLS - 1 } }),
    };
  }
  ws['!margins'] = { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 };
  return ws;
}

// ═══════════════════════════════════════════════════════════════════
//  «🔎 Barcha darslar» — yassi ro'yxat + AVTOFILTR
//  Ustoz «Ustoz» ustunidagi ▼ filtrdan o'zini belgilaydi va faqat o'z
//  darslarini ko'radi (Excelning o'z tanlash ro'yxati).
// ═══════════════════════════════════════════════════════════════════
function buildFlatSheet(XLSX, records, { title, subtitle }) {
  const HEADERS = ['Ustoz', 'Kun', 'Soat', 'Vaqt', 'Sinf', 'Fan', 'Xona', 'Guruh', 'Smena'];
  const COLS = HEADERS.length;
  const aoa = [];
  const hpt = [];
  const merges = [];
  const blank = () => new Array(COLS).fill('');

  const t = blank(); t[0] = title;
  aoa.push(t); hpt.push(32);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COLS - 1 } });

  const s = blank(); s[0] = subtitle;
  aoa.push(s); hpt.push(22);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: COLS - 1 } });

  aoa.push([...HEADERS]);
  hpt.push(26);

  records.forEach((rec) => {
    aoa.push([rec.teacher, rec.day, rec.num, rec.time, rec.classes, rec.subject, rec.room, rec.group, rec.shift]);
    hpt.push(18);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const cell = (R, C) => {
    const ref = XLSX.utils.encode_cell({ r: R, c: C });
    if (!ws[ref]) ws[ref] = { t: 's', v: '' };
    return ws[ref];
  };

  for (let c = 0; c < COLS; c++) {
    cell(0, c).s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { bold: true, sz: 17, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: TITLE_BG } },
    };
    cell(1, c).s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { bold: true, sz: 11.5, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: SUB_BG } },
    };
    cell(2, c).s = {
      alignment: MID, border: { top: SEP, bottom: SEP, left: SOFT, right: SOFT },
      font: { bold: true, sz: 11.5, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: c === 0 ? NAME_BG : HEAD_BG } },
    };
  }

  records.forEach((rec, i) => {
    const R = 3 + i;
    const zebra = i % 2 ? 'F8FAFC' : 'FFFFFF';
    for (let c = 0; c < COLS; c++) {
      cell(R, c).s = {
        alignment: c === 0 || c === 4 || c === 5 ? LEFT : MID,
        border: { top: HAIR, bottom: HAIR, left: SOFT, right: SOFT },
        font: { bold: c === 0, sz: 11, color: { rgb: '1F2937' } },
        fill: { patternType: 'solid', fgColor: { rgb: c === 0 ? 'EEF2FF' : zebra } },
      };
    }
  });

  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 28 }, { wch: 13 }, { wch: 9 }, { wch: 13 },
    { wch: 22 }, { wch: 22 }, { wch: 13 }, { wch: 13 }, { wch: 16 },
  ];
  ws['!rows'] = hpt.map((h) => ({ hpt: h }));
  if (records.length) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2 + records.length, c: COLS - 1 } }),
    };
  }
  ws['!margins'] = { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 };
  return ws;
}

// ═══════════════════════════════════════════════════════════════════
//  ASOSIY EKSPORT
//  `teacherId` berilsa — FAQAT o'sha ustozning bitta varag'i.
//  Berilmasa — «📋 Ustozlar» + «🔎 Barcha darslar» + har ustozga varaq.
// ═══════════════════════════════════════════════════════════════════
export async function exportTeacherGrids({
  teachers = [],
  classes = [],
  subjects = [],
  rooms = [],
  timeslots = [],
  shifts = [],
  schedule = {},
  classSubjects = {},
  settings = {},
  schoolName = '',
  teacherId = null,
  toast,
}) {
  try {
    if (!teachers.length) {
      toast?.("Avval o'qituvchi qo'shing", 'warning');
      return;
    }
    if (!timeslots.length) {
      toast?.('Avval dars vaqtlarini sozlang', 'warning');
      return;
    }

    const XLSX = await loadStyledXLSX();
    const title = String(settings.schoolName || schoolName || '').trim().toUpperCase() || 'DARS JADVALI';
    const year = settings.academicYear ? ` · ${settings.academicYear} o'quv yili` : '';

    const single = teacherId ? teachers.find((t) => t.id === teacherId) : null;
    if (teacherId && !single) {
      toast?.('Ustoz topilmadi', 'warning');
      return;
    }

    const list = single
      ? [single]
      : [...teachers].sort((a, b) => String(a.name).localeCompare(String(b.name), 'uz'));

    const models = list.map((t) =>
      teacherModel({ teacher: t, classes, subjects, rooms, timeslots, shifts, schedule, classSubjects })
    );

    const wb = XLSX.utils.book_new();
    const used = new Set();
    const names = [];

    // ——— Bitta ustoz: yagona varaq ———
    if (single) {
      const ws = buildTeacherSheet(XLSX, models[0], {
        title,
        subtitle: `USTOZ HAFTALIK DARS SETKASI${year}`,
        backSheet: null,
      });
      const name = sheetName(single.name, used);
      XLSX.utils.book_append_sheet(wb, ws, name);
      names.push({ Name: '_xlnm.Print_Titles', Sheet: 0, Ref: `'${name.replace(/'/g, "''")}'!$1:$5` });
      wb.Workbook = { ...(wb.Workbook || {}), Names: names };
      XLSX.writeFile(wb, `ustoz_setkasi_${fileSlug(single.name)}_${safeFileDate()}.xlsx`);
      toast?.(`${single.name} — setkasi Excelga yuklandi ✓`, 'success');
      return;
    }

    // ——— Barcha ustozlar ———
    // Varaq nomlari OLDIN band qilinadi: indeks varag'idagi havolalar
    // aynan shu nomlarga ishora qilishi kerak.
    used.add(INDEX_SHEET);
    used.add(FLAT_SHEET);
    const planned = models.map((m) => ({
      m,
      sheet: (m.total > 0 || m.plan.length > 0) ? sheetName(m.teacher.name, used) : '',
    }));

    // 1) Indeks varag'i
    XLSX.utils.book_append_sheet(
      wb,
      buildIndexSheet(
        XLSX,
        planned.map(({ m, sheet }) => ({
          name: m.teacher.name,
          subjects: m.subjectNames.join(', '),
          perDay: m.perDay,
          total: m.total,
          sheet,
        })),
        {
          title,
          subtitle: `USTOZLAR SETKASI — RO'YXAT${year}   ·   Ustoz ismini bosing, setkasi ochiladi`,
        },
      ),
      INDEX_SHEET,
    );

    // 2) Yassi ro'yxat (avtofiltr bilan)
    const records = [];
    planned.forEach(({ m }) => {
      m.slotGroups.forEach((g) => {
        g.slots.forEach((ts) => {
          if (!isTeachingSlot(ts)) return;
          DAYS.forEach((day) => {
            m.cardsAt(day, ts.id).forEach((l) => {
              const info = m.cardInfo(l);
              records.push({
                teacher: m.teacher.name,
                day,
                num: m.slotNumById.get(ts.id) ?? ts.lessonNumber ?? '',
                time: timeLabel(ts),
                classes: info.classNames,
                subject: info.subject,
                room: info.room || 'Xonasiz',
                group: info.groupPart || '—',
                shift: g.name,
              });
            });
          });
        });
      });
    });
    const dayIdx = new Map(DAYS.map((d, i) => [d, i]));
    records.sort((a, b) =>
      String(a.teacher).localeCompare(String(b.teacher), 'uz')
      || (dayIdx.get(a.day) - dayIdx.get(b.day))
      || (Number(a.num) - Number(b.num))
    );
    XLSX.utils.book_append_sheet(
      wb,
      buildFlatSheet(XLSX, records, {
        title,
        subtitle: `BARCHA DARSLAR${year}   ·   «Ustoz» ustunidagi ▼ filtrdan o'zingizni tanlang`,
      }),
      FLAT_SHEET,
    );

    // 3) Har ustozga alohida varaq
    let sheetIdx = 2;  // 0 — indeks, 1 — yassi ro'yxat
    planned.forEach(({ m, sheet }) => {
      if (!sheet) return;
      XLSX.utils.book_append_sheet(
        wb,
        buildTeacherSheet(XLSX, m, {
          title,
          subtitle: `USTOZ HAFTALIK DARS SETKASI${year}`,
          backSheet: INDEX_SHEET,
        }),
        sheet,
      );
      names.push({
        Name: '_xlnm.Print_Titles',
        Sheet: sheetIdx,
        Ref: `'${sheet.replace(/'/g, "''")}'!$1:$5`,
      });
      sheetIdx += 1;
    });

    wb.Workbook = { ...(wb.Workbook || {}), Names: names };
    XLSX.writeFile(wb, `ustozlar_setkasi_${safeFileDate()}.xlsx`);
    toast?.(
      `Ustozlar setkasi Excelga yuklandi — ${sheetIdx - 2} ta ustoz varag'i ✓`,
      'success',
    );
  } catch (e) {
    toast?.(e.message || 'Excel eksportda xatolik', 'error');
  }
}
