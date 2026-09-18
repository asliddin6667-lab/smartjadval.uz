// =====================================================================
//  eMAKTABDAN MA'LUMOT IMPORTI
//
//  Ko'prik skriptining «📥 Yig'ish» tugmasi bergan faylni Smartjadval
//  ma'lumotiga BIRLASHTIRADI: sinflar, fanlar, ustozlar, xonalar.
//
//  NEGA KERAK: nomlarni taxmin bilan solishtirish har doim xato manbai
//  edi — «Математика» ↔ «Matematika», ustoz ismining ikki xil yozilishi
//  va h.k. Import qilingandan keyin har bir yozuvda eMaktab'ning O'Z
//  `emaktabId` si turadi va yuklashda taqqoslash umuman bajarilmaydi.
//
//  Ikkinchi foyda: eMaktab har fanga FAQAT biriktirilgan ustozni qabul
//  qiladi. Shu ro'yxat («qaysi ustoz qaysi fanni bera oladi») bu yerda
//  ustozning `subjectIds` iga tushadi, ya'ni cheklov jadval TUZAYOTGANDA
//  ko'rinadi — yuklash paytida emas.
//
//  ⚠️ HECH NARSA O'CHIRILMAYDI. Faqat qo'shiladi va to'ldiriladi:
//  maktabning Smartjadval'dagi sozlamalari (soatlar, guruhlar, smenalar)
//  joyida qoladi. Ustozning fanlari ham BIRLASHTIRILADI, almashtirilmaydi
//  — aks holda maktab qo'lda kiritgan fan jimgina yo'qolardi.
// =====================================================================
import { SUBJECT_COLORS } from "./constants.js";
import { normKey, classKey, sameTeacher } from "./emaktabNames.js";

// Id barqaror bo'lishi SHART: qayta import qilinganda ayni yozuv
// topilsin, yangisi yaratilmasin.
const idOf = (tur, emaktabId) => `emk_${tur}_${emaktabId}`;

function validate(data) {
  if (!data || typeof data !== "object") throw new Error("fayl o'qilmadi");
  if (!data.sj_emaktab_malumot) throw new Error("bu eMaktab ma'lumot fayli emas");
  if (!Array.isArray(data.fanlar) || !data.fanlar.length) {
    throw new Error("faylda fanlar yo'q");
  }
}

// ——— Mavjud yozuvni topish: avval id, keyin nom ———
function findExisting(list, emaktabId, nom, tur) {
  const byId = list.find((x) => x.emaktabId && String(x.emaktabId) === String(emaktabId));
  if (byId) return byId;
  if (tur === "sinf") {
    const k = classKey(nom);
    return list.find((x) => !x.emaktabId && classKey(x.name) === k) || null;
  }
  if (tur === "ustoz") {
    return list.find((x) => !x.emaktabId && sameTeacher(x.name, nom)) || null;
  }
  const k = normKey(nom);
  return list.find((x) => !x.emaktabId && normKey(x.name) === k) || null;
}

// =====================================================================
//  ASOSIY: birlashtirish
//
//  Qaytadi: { classes, subjects, teachers, rooms, hisobot }
//  Kirish massivlariga TEGILMAYDI — yangi massivlar qaytadi.
// =====================================================================
export function mergeEmaktabData({
  data,
  classes = [],
  subjects = [],
  teachers = [],
  rooms = [],
} = {}) {
  validate(data);
  const now = Date.now();
  const hisobot = {
    sinf: { yangi: 0, boglandi: 0 },
    fan: { yangi: 0, boglandi: 0 },
    ustoz: { yangi: 0, boglandi: 0 },
    xona: { yangi: 0, boglandi: 0 },
    ogohlar: [],
  };

  // ——— 1. FANLAR (birinchi: ustozlar shularga bog'lanadi) ———
  const nextSubjects = [...subjects];
  const subjectByEmk = new Map();     // eMaktab fan id → Smartjadval fan id
  (data.fanlar || []).forEach((f, i) => {
    if (!f || !f.id || !f.nom) return;
    const bor = findExisting(nextSubjects, f.id, f.nom, "fan");
    if (bor) {
      const idx = nextSubjects.indexOf(bor);
      nextSubjects[idx] = { ...bor, emaktabId: String(f.id) };
      subjectByEmk.set(String(f.id), bor.id);
      if (!bor.emaktabId) hisobot.fan.boglandi++;
    } else {
      const id = idOf("sub", f.id);
      nextSubjects.push({
        id,
        name: f.nom,
        weeklyHours: 1,                 // soatni maktab o'zi belgilaydi
        type: "Oddiy",
        color: SUBJECT_COLORS[i % SUBJECT_COLORS.length],
        allowDouble: false,
        emaktabId: String(f.id),
        createdAt: now,
      });
      subjectByEmk.set(String(f.id), id);
      hisobot.fan.yangi++;
    }
  });

  // ——— 2. USTOZLAR ———
  //
  //  ⚠️ eMAKTABNING FAN BIRIKTIRUVI KO'PINCHA MA'LUMOT EMAS.
  //  Sinov maktabida (18.09.2026) `tlfe` HAR BIR fanga 76 ustozning
  //  hammasini qaytardi, ya'ni maktab biriktiruvni umuman cheklamagan.
  //  Bunday ro'yxatni `subjectIds` ga yozish ZARARLI bo'lardi: har bir
  //  ustoz 66 fan beradigan bo'lib ko'rinar va «Sinf fanlari» dagi
  //  foydali filtr butunlay buzilardi.
  //
  //  Shuning uchun ro'yxat faqat TANLOVCHAN bo'lganda ishlatiladi —
  //  ya'ni ustoz fanlarning yarmidan kamiga biriktirilgan bo'lsa.
  //  Aks holda `subjectIds` ga TEGILMAYDI (maktabning o'z sozlamasi
  //  qoladi), `emaktabSubjectIds` esa baribir yoziladi — u yuklashda
  //  «bu ustozni eMaktab shu fanga qabul qiladimi?» degan savolga javob.
  const TANLOVCHAN = 0.5;
  const jamiFan = (data.fanlar || []).length;
  let cheklanmagan = 0;

  const nextTeachers = [...teachers];
  (data.ustozlar || []).forEach((u) => {
    if (!u || !u.id || !u.nom) return;
    // eMaktab ruxsat bergan fanlar — Smartjadval id'lariga o'giriladi
    const emkFanlar = (u.fanIdlari || [])
      .map((fid) => subjectByEmk.get(String(fid)))
      .filter(Boolean);
    const tanlovchan = jamiFan > 0 && emkFanlar.length > 0
      && emkFanlar.length < jamiFan * TANLOVCHAN;
    if (!tanlovchan) cheklanmagan++;

    const bor = findExisting(nextTeachers, u.id, u.nom, "ustoz");
    if (bor) {
      const idx = nextTeachers.indexOf(bor);
      // BIRLASHTIRISH: maktab qo'lda qo'shgan fan yo'qolmasin
      const eski = Array.isArray(bor.subjectIds)
        ? bor.subjectIds
        : [bor.subjectId].filter(Boolean);
      // Fanlar faqat TANLOVCHAN ro'yxatda birlashtiriladi (yuqoriga qarang)
      const birlashgan = tanlovchan ? [...new Set([...eski, ...emkFanlar])] : eski;
      nextTeachers[idx] = {
        ...bor,
        emaktabId: String(u.id),
        emaktabSubjectIds: emkFanlar,   // eMaktab qabul qiladigan ro'yxat
        subjectIds: birlashgan,
        subjectId: bor.subjectId || birlashgan[0] || "",
      };
      if (!bor.emaktabId) hisobot.ustoz.boglandi++;
      // Smartjadval'da bor, lekin eMaktab qabul qilmaydigan fanlar —
      // aynan shular yuklashda «ustozsiz» bo'lib qoladi. Cheklanmagan
      // ro'yxatda bunday hol bo'lmaydi, shuning uchun tekshirmaymiz.
      if (tanlovchan) {
        const ortiqcha = eski.filter((sid) => !emkFanlar.includes(sid));
        const nomlar = ortiqcha
          .map((sid) => nextSubjects.find((s) => s.id === sid)?.name)
          .filter(Boolean);
        if (nomlar.length) {
          hisobot.ogohlar.push(
            `${u.nom}: eMaktab ${nomlar.join(", ")} faniga biriktirmagan — o'sha darslar ustozsiz ketadi`
          );
        }
      }
    } else {
      nextTeachers.push({
        id: idOf("teacher", u.id),
        name: u.nom,
        // Cheklanmagan ro'yxatda fan yozilmaydi: «hamma hamma fanni
        // beradi» degan yolg'on ma'lumotdan ko'ra bo'sh qolgani yaxshi —
        // maktab «Sinf fanlari» da o'zi biriktiradi.
        subjectId: tanlovchan ? (emkFanlar[0] || "") : "",
        subjectIds: tanlovchan ? emkFanlar : [],
        emaktabId: String(u.id),
        emaktabSubjectIds: emkFanlar,
        maxWeeklyHours: 30,
        status: "Bo'sh",
        createdAt: now,
      });
      hisobot.ustoz.yangi++;
    }
  });

  // ——— 3. SINFLAR ———
  const nextClasses = [...classes];
  (data.sinflar || []).forEach((c) => {
    if (!c || !c.id || !c.nom) return;
    const bor = findExisting(nextClasses, c.id, c.nom, "sinf");
    if (bor) {
      const idx = nextClasses.indexOf(bor);
      nextClasses[idx] = { ...bor, emaktabId: String(c.id) };
      if (!bor.emaktabId) hisobot.sinf.boglandi++;
    } else {
      nextClasses.push({
        id: idOf("class", c.id),
        name: c.nom,
        studentCount: 0,
        emaktabId: String(c.id),
        createdAt: now,
      });
      hisobot.sinf.yangi++;
    }
  });

  // ——— 4. XONALAR ———
  const nextRooms = [...rooms];
  (data.xonalar || []).forEach((x) => {
    if (!x || !x.id || !x.nom) return;
    const bor = findExisting(nextRooms, x.id, x.nom, "xona");
    if (bor) {
      const idx = nextRooms.indexOf(bor);
      nextRooms[idx] = { ...bor, emaktabId: String(x.id) };
      if (!bor.emaktabId) hisobot.xona.boglandi++;
    } else {
      nextRooms.push({
        id: idOf("room", x.id),
        name: x.nom,
        capacity: 30,
        type: "Oddiy",
        emaktabId: String(x.id),
        createdAt: now,
      });
      hisobot.xona.yangi++;
    }
  });

  if (!(data.sinflar || []).length) {
    hisobot.ogohlar.push("Faylda sinflar yo'q — ko'prik ularni ololmagan (sinflar allaqachon Smartjadval'da bo'lsa muammo emas)");
  }
  if (cheklanmagan) {
    hisobot.cheklanmagan = cheklanmagan;
    hisobot.ogohlar.push(
      `${cheklanmagan} ustozda eMaktab fan biriktiruvi cheklanmagan (deyarli hamma fanga ruxsat) — `
      + "ularning fanlariga tegilmadi, «Sinf fanlari» da o'zingiz belgilaysiz"
    );
  }

  // ——— eMAKTABDA TOPILMAGANLAR ———
  //
  //  Eng amaliy ro'yxat shu: Smartjadval'da bor, lekin eMaktab'da mos
  //  yozuvi yo'q ustozlar/fanlar. Ularning darslari yuklashda ustozsiz
  //  (yoki umuman) tushmaydi, va buni OLDINDAN bilish kerak — yuklash
  //  jurnalidan keyin emas. Sabab odatda ism/nom farqi bo'ladi
  //  (masalan «Roziyeva Nilufar» ↔ «Yo'ldashaliyeva Nilufar»).
  hisobot.bogliqmas = {
    ustozlar: nextTeachers.filter((t) => !t.emaktabId).map((t) => t.name),
    fanlar: nextSubjects.filter((s) => !s.emaktabId).map((s) => s.name),
    sinflar: nextClasses.filter((c) => !c.emaktabId).map((c) => c.name),
  };

  return {
    classes: nextClasses,
    subjects: nextSubjects,
    teachers: nextTeachers,
    rooms: nextRooms,
    hisobot,
  };
}

// ——— Qisqa xulosa matni (toast uchun) ———
export function importSummary(hisobot) {
  const q = (h) => `${h.yangi} yangi, ${h.boglandi} bog'landi`;
  return `Fanlar: ${q(hisobot.fan)} · Ustozlar: ${q(hisobot.ustoz)} · `
    + `Sinflar: ${q(hisobot.sinf)} · Xonalar: ${q(hisobot.xona)}`;
}
