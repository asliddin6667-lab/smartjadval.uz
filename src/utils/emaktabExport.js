// =====================================================================
//  eMAKTAB (kundalik.com) EKSPORTI
//
//  Smartjadval'dagi tayyor jadvalni eMaktab «Darslar jadvali sxemasi»
//  setkasiga tushadigan ko'rinishga aylantiradi.
//
//  NIMA UCHUN JSON, to'g'ridan-to'g'ri API emas?
//  eMaktab sessiyasi cookie bilan ishlaydi va boshqa domendan (smartjadval.uz)
//  so'rov yuborib bo'lmaydi — CORS ruxsat bermaydi. Shuning uchun ko'chirish
//  ikki bosqichli: bu yerda JSON tayyorlanadi, uni esa foydalanuvchining
//  brauzerida, eMaktab sahifasining O'ZIDA ishlaydigan ko'prik skripti
//  (public/emaktab-bridge.user.js) setkaga joylashtiradi.
//
//  ⚠️ Chiqadigan JSON shakli ko'prik skripti bilan SHARTNOMA — maydon
//  nomini o'zgartirsangiz, skriptdagi `V` (versiya) tekshiruvini ham
//  oshiring, aks holda eski skript yangi faylni jimgina noto'g'ri o'qiydi.
// =====================================================================
import { DAYS } from "./constants.js";
import { isTeachingSlot, classIdsOf } from "./scheduleCore.js";
import { parseClassName } from "./emaktabNames.js";

// 2 — paketga `emaktab` id xaritasi qo'shildi (ko'prik nomlarni taxmin
// qilmay, to'g'ridan-to'g'ri id bilan ishlaydi). Ko'prik 1-versiyani ham
// qabul qiladi: u holda eski, nom bo'yicha moslashtirish ishlaydi.
export const EMAKTAB_FORMAT_VERSION = 2;

// eMaktab setkasidagi ustunlar: Dush Sesh Chor Pay Jum Shan Yak.
// DAYS ("Dushanba"…"Shanba") shu tartibda, ya'ni kun raqami = indeks + 1.
export const EMAKTAB_DAY_NAMES = ["Dush", "Sesh", "Chor", "Pay", "Jum", "Shan", "Yak"];

function timeToMinutes(t) {
  const [h, m] = String(t || "00:00").split(":").map(Number);
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

// Sinfga tegishli DARS vaqtlari (obed/tanaffus tashlanadi), vaqt bo'yicha tartibda.
// `classIds` bo'sh vaqt — butun maktabga tegishli deb olinadi (smenasiz maktablar).
function slotsOfClass(timeslots, classId) {
  return timeslots
    .filter((ts) => {
      if (!isTeachingSlot(ts)) return false;
      const ids = Array.isArray(ts.classIds) ? ts.classIds : [];
      return !ids.length || ids.includes(classId);
    })
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
}

// Soat raqami — eMaktab setkasidagi QATOR raqami.
//   "smena"  — smena ichidagi raqam (2-smena ham 1-dan boshlanadi)
//   "umumiy" — maktab bo'ylab uzluksiz raqam (2-smena 7, 8, 9…)
//   "tartib" — sinfning o'z vaqtlari bo'yicha ketma-ket 1, 2, 3…
function lessonNoOf(ts, index, mode) {
  if (mode === "tartib") return index + 1;
  if (mode === "umumiy") return Number(ts.lessonNumber) || index + 1;
  return Number(ts.shiftLessonNumber) || Number(ts.lessonNumber) || index + 1;
}

// =====================================================================
//  ASOSIY: jadvaldan eMaktab paketini yasash
// =====================================================================
export function buildEmaktabPayload({
  classes = [],
  subjects = [],
  teachers = [],
  rooms = [],
  timeslots = [],
  schedule = {},
  settings = {},
  classIds = null,        // null = hamma sinf
  numbering = "smena",    // "smena" | "umumiy" | "tartib"
  includeRooms = true,
  quarter = "",           // "1 chorak" — faqat eslatma sifatida yoziladi
} = {}) {
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const wanted = classIds ? new Set(classIds) : null;
  const targetClasses = classes
    .filter((c) => !wanted || wanted.has(c.id))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "uz", { numeric: true }));

  const fanNomlari = new Set();
  const ustozNomlari = new Set();
  const xonaNomlari = new Set();

  const sinflar = targetClasses.map((cls) => {
    const slots = slotsOfClass(timeslots, cls.id);
    const noById = new Map();
    slots.forEach((ts, i) => noById.set(ts.id, lessonNoOf(ts, i, numbering)));

    const darslar = [];
    DAYS.forEach((day, dayIdx) => {
      slots.forEach((ts) => {
        const all = schedule?.[day]?.[ts.id] || [];
        const mine = all.filter((l) => classIdsOf(l).includes(cls.id));
        if (!mine.length) return;
        // Guruhli darslar bitta katakda turadi — barqaror tartib uchun
        // guruh nomi bo'yicha saralanadi (eksport har safar bir xil chiqsin).
        const sorted = [...mine].sort((a, b) =>
          String(a.groupPart || "").localeCompare(String(b.groupPart || ""), "uz", { numeric: true })
        );
        sorted.forEach((l) => {
          const fan = subjectById.get(l.subjectId)?.name || "";
          const ustoz = teacherById.get(l.teacherId)?.name || "";
          const xona = includeRooms ? (roomById.get(l.roomId)?.name || "") : "";
          if (!fan) return;                       // fani yo'q dars — tashlanadi
          fanNomlari.add(fan);
          if (ustoz) ustozNomlari.add(ustoz);
          if (xona) xonaNomlari.add(xona);
          darslar.push({
            kun: dayIdx + 1,
            soat: noById.get(ts.id) || 0,
            fan,
            ustoz,
            xona,
            guruh: sorted.length > 1 ? String(l.groupPart || "") : "",
            boshlanish: ts.startTime || "",
            tugash: ts.endTime || "",
          });
        });
      });
    });

    darslar.sort((a, b) => a.kun - b.kun || a.soat - b.soat || a.guruh.localeCompare(b.guruh));
    const parsed = parseClassName(cls.name);
    return {
      nom: cls.name,
      daraja: parsed.daraja,
      harf: parsed.harf.toUpperCase(),
      darslar,
    };
  });

  // ——— eMaktab id xaritasi ———
  // Ma'lumot eMaktab'dan import qilingan bo'lsa har yozuvda `emaktabId`
  // turadi. Uni nom bo'yicha xaritaga yig'amiz — ko'prik shu bilan
  // taqqoslashni BUTUNLAY chetlab o'tadi (nom bir xil yozilmasa ham).
  const idMap = (rows, names) => {
    const out = {};
    rows.forEach((r) => {
      if (r?.emaktabId && names.has(r.name)) out[r.name] = String(r.emaktabId);
    });
    return out;
  };
  const sinfNomlari = new Set(sinflar.map((s) => s.nom));

  return {
    v: EMAKTAB_FORMAT_VERSION,
    manba: "smartjadval.uz",
    sana: new Date().toISOString(),
    maktab: String(settings?.schoolName || ""),
    oquvYili: String(settings?.academicYear || ""),
    chorak: String(quarter || ""),
    raqamlash: numbering,
    kunlar: DAYS,
    sinflar,
    // Ko'prik skripti shu ro'yxatlar bo'yicha eMaktab'dagi nomlarga
    // moslashtirish jadvalini tuzadi (va topilmaganini so'raydi).
    fanlar: [...fanNomlari].sort((a, b) => a.localeCompare(b, "uz")),
    ustozlar: [...ustozNomlari].sort((a, b) => a.localeCompare(b, "uz")),
    xonalar: [...xonaNomlari].sort((a, b) => a.localeCompare(b, "uz", { numeric: true })),

    emaktab: {
      fanlar: idMap(subjects, fanNomlari),
      ustozlar: idMap(teachers, ustozNomlari),
      xonalar: idMap(rooms, xonaNomlari),
      sinflar: idMap(classes, sinfNomlari),
    },
  };
}

// Paketning nechta nomi eMaktab id'si bilan ta'minlangan? UI shuni
// ko'rsatadi: 100% bo'lsa yuklashda taxmin umuman ishlatilmaydi.
export function idCoverage(payload) {
  const e = payload?.emaktab || {};
  const hisob = (nomlar, xarita) => {
    const jami = (nomlar || []).length;
    const bor = (nomlar || []).filter((n) => xarita && xarita[n]).length;
    return { jami, bor, foiz: jami ? Math.round((bor / jami) * 100) : 100 };
  };
  return {
    fanlar: hisob(payload?.fanlar, e.fanlar),
    ustozlar: hisob(payload?.ustozlar, e.ustozlar),
    sinflar: hisob((payload?.sinflar || []).map((s) => s.nom), e.sinflar),
  };
}

// ——— Qisqa statistika (UI da ko'rsatish uchun) ———
export function payloadStats(payload) {
  const sinflar = payload?.sinflar || [];
  const darslar = sinflar.reduce((n, s) => n + s.darslar.length, 0);
  const bosh = sinflar.filter((s) => !s.darslar.length).map((s) => s.nom);
  const ustozsiz = sinflar.reduce(
    (n, s) => n + s.darslar.filter((d) => !d.ustoz).length, 0
  );
  return {
    sinflar: sinflar.length,
    darslar,
    boshSinflar: bosh,
    ustozsiz,
    fanlar: (payload?.fanlar || []).length,
    ustozlar: (payload?.ustozlar || []).length,
  };
}

// ——— Fayl nomi: "3-B_1-chorak_2026-09-18.json" ———
export function payloadFileName(payload) {
  const sinflar = payload?.sinflar || [];
  const qism = sinflar.length === 1 ? sinflar[0].nom : `${sinflar.length}-sinf`;
  const chorak = payload?.chorak ? `_${payload.chorak.replace(/\s+/g, "-")}` : "";
  const sana = new Date().toISOString().slice(0, 10);
  return `emaktab_${qism}${chorak}_${sana}.json`
    .replace(/[\\/:*?"<>|]/g, "-");
}
