// =====================================================================
//  ZICHLAGICH («Oynani yopish») + YORDAMCHILARNI QAYTA EKSPORT
//
//  Ilgari bu faylda butun dvigatel turardi (~5800 qator). Endi:
//    • yordamchilar -> src/utils/scheduleCore.js
//    • dvigatel     -> src/engine/scheduleEngine.js (serverdan yuklanadi)
//    • zichlagich   -> shu yerda qoladi
//
//  Zichlagich ataylab brauzerda qoldirildi: u generatsiya siklida HAR
//  RAUNDDA chaqiriladi va «Oynani yopish» tugmasi ostida turadi —
//  serverga chiqarilsa har bosishda 200 KB jadval u yoqqa-bu yoqqa
//  yurardi.
//
//  Eski import yo’llari buzilmasin uchun yordamchilar shu yerdan ham
//  qayta eksport qilinadi.
// =====================================================================
import { DAYS } from "./constants.js";
import { buildSubjectConflicts } from "./subjectConflicts.js";
import { buildParallelIndex } from "./parallelDays.js";
import {
  isTeachingSlot, BRIDGE_MAX_GAP, toMinutes, buildTimeBuckets, classHasLunchAt,
  classIdsOf, QUAD_SIZE, fixedMondaySubjectIds,
} from "./scheduleCore.js";

export * from "./scheduleCore.js";

export function compactSchedule(
  classes = [], timeslots = [], lunchGroups = [], schedule = {}, classSubjects = {}, teachers = [],
  subjects = [], rooms = null, options = {}
) {
  // ——— REJIM ———
  // `hard: true` — «🧲 Oynani yopish» tugmasi va generatsiyaning YAKUNIY
  // bosqichi uchun: oyna NOLGA tushmaguncha qo'shimcha, ancha kuchli
  // bosqichlar ishlaydi (butun kunni qayta yechish, darsni boshqa kunga
  // surib chiqarish). Nomzod tanlashdagi oddiy chaqiruvlarda bu bosqich
  // umuman yoqilmaydi — generatsiya tezligi o'zgarmaydi.
  // `spin` — bir xil jadvalni QAYTA zichlaganda boshqa yo'ldan borish uchun
  // (domen va tartib aylantiriladi). Busiz takroriy chaqiruv aynan o'sha
  // natijani qaytarardi va "yana urinish" ma'nosiz bo'lardi.
  const opt = options && typeof options === "object" ? options : {};
  const HARD = Boolean(opt.hard);
  const SPIN = Math.max(0, Math.floor(Number(opt.spin) || 0));
  const HARD_MS = Math.max(600, Math.min(12000, Number(opt.budgetMs) || 2500));
  const rot = (arr) => {
    if (!SPIN || arr.length < 2) return arr;
    const k = SPIN % arr.length;
    return k ? arr.slice(k).concat(arr.slice(0, k)) : arr;
  };
  // KELAJAK SOATI: nom bo'yicha aniqlanadi — eski jadvallarda `fixedMonday`
  // belgisi bo'lmasligi mumkin, lekin baribir joyidan qo'zg'almasligi kerak.
  const fixedMondayIds = fixedMondaySubjectIds(subjects);
  // O'chirilgan xona darslarni bloklamasin
  const roomOk = Array.isArray(rooms) && rooms.length ? new Set(rooms.map((r) => r?.id).filter(Boolean)) : null;
  const liveRoom = (id) => (id && (!roomOk || roomOk.has(id)) ? id : "");
  const D = DAYS.length;
  const allTs = [...timeslots].sort((a, b) => Number(a.lessonNumber) - Number(b.lessonNumber));
  const teachingTs = allTs.filter(isTeachingSlot);
  const T = teachingTs.length;
  if (!classes.length || !T) return schedule;
  const DT = D * T;
  const C = classes.length;
  const cIdxOf = new Map(classes.map((c, i) => [c.id, i]));
  const allIdxById = new Map(allTs.map((ts, i) => [ts.id, i]));
  const teachIdxById = new Map(teachingTs.map((ts, i) => [ts.id, i]));
  const nextConsecutive = new Array(Math.max(0, T - 1)).fill(false);
  for (let i = 0; i < T - 1; i++) {
    nextConsecutive[i] = allIdxById.get(teachingTs[i + 1].id) === allIdxById.get(teachingTs[i].id) + 1;
  }
  // Blok obed/tanaffusdan oshib o'tishi mumkin — qoida generatordagi bilan
  // bir xil, aks holda zichlash bunday blokni ikkiga bo'lib yuborardi.
  const blockLink = new Uint8Array(Math.max(0, T - 1));
  for (let i = 0; i < T - 1; i++) {
    if (nextConsecutive[i]) { blockLink[i] = 1; continue; }
    const gap = toMinutes(teachingTs[i + 1].startTime) - toMinutes(teachingTs[i].endTime);
    blockLink[i] = gap >= 0 && gap <= BRIDGE_MAX_GAP ? 2 : 0;
  }
  const linkOk = (i) => blockLink[i] > 0;
  // Zichlashda ham ustoz/xona bandligi vaqt bandi bo'yicha tekshiriladi
  const { bucketOf: tsBucket, count: TB } = buildTimeBuckets(teachingTs);
  const DTB = D * TB;
  const tbOff = (d, i) => d * TB + tsBucket[i];

  // ——— USTOZ UCHUN YOPIQ KATAKLAR ———
  // Ikki manba: ustoz setkasidagi qulflangan soatlar (`blockedSlots`) VA
  // ustozning DAM KUNI (`offDays`).
  // ⚠️ Dam kuni ilgari zichlashda umuman tekshirilmasdi: generator uni
  // hurmat qilardi, lekin keyingi zichlash darsni ustozning dam kuniga
  // ko'chirib yuborishi mumkin edi (sinovda 24 sinfli maktabda 18 ta
  // buzilish). Endi dam kuni butunlay yopiq katak sifatida qaraladi.
  const tBlockedMap = new Map(); // teacherId -> Uint8Array(DT)
  (Array.isArray(teachers) ? teachers : []).forEach((t) => {
    if (!t || !t.id) return;
    const bs = t.blockedSlots && typeof t.blockedSlots === "object" ? t.blockedSlots : null;
    const off = new Set(Array.isArray(t.offDays) ? t.offDays : []);
    if (!bs && !off.size) return;
    const g = new Uint8Array(DT);
    let any = false;
    DAYS.forEach((day, d) => {
      if (off.has(day)) {
        for (let i = 0; i < T; i++) g[d * T + i] = 1;
        any = true;
        return;
      }
      const list = bs && Array.isArray(bs[day]) ? bs[day] : [];
      list.forEach((sid) => {
        const i = teachIdxById.get(sid);
        if (i !== undefined) { g[d * T + i] = 1; any = true; }
      });
    });
    if (any) tBlockedMap.set(t.id, g);
  });

  // Bir kunga tushmaydigan fanlar (Algebra ↔ Geometriya) — zichlash ham
  // shu qoidaga bo'ysunadi, aks holda generator to'g'ri qo'ygan darsni
  // keyingi zichlash bosqichi ziddiyatli kunga ko'chirib yuborardi.
  const conflictOf = buildSubjectConflicts(subjects);
  const anyConflict = conflictOf.size > 0;

  // "Ora kunda", "Asosiy fan" va haftalik soat ma'lumotlari
  const spacedSet = new Set();
  const coreSet = new Set();
  const hoursMap = new Map(); // `${cid}|${subjectId}` -> haftalik soat
  const doubleSet = new Set(); // 2 soat blok yoqilgan sinf+fan
  const quadSet = new Set();   // 4 soat blok yoqilgan sinf+fan
  Object.entries(classSubjects || {}).forEach(([cid, list]) => {
    (Array.isArray(list) ? list : []).forEach((a) => {
      if (!a || !a.subjectId) return;
      if (a.spacedDays) spacedSet.add(`${cid}|${a.subjectId}`);
      if (a.isCore) coreSet.add(`${cid}|${a.subjectId}`);
      if (a.allowDouble) doubleSet.add(`${cid}|${a.subjectId}`);
      if (a.allowQuad) quadSet.add(`${cid}|${a.subjectId}`);
      const k = `${cid}|${a.subjectId}`;
      hoursMap.set(k, (hoursMap.get(k) || 0) + Number(a.weeklyHours || 0));
      if (a.swapEnabled && a.swapSubjectId) {
        const k2 = `${cid}|${a.swapSubjectId}`;
        hoursMap.set(k2, (hoursMap.get(k2) || 0) + Number(a.weeklyHours || 0));
      }
      // Bir vaqtda 2 fan — 2-fan ham shu sinfning fanlari qatorida
      if (a.pairEnabled && a.pairSubjectId) {
        const k3 = `${cid}|${a.pairSubjectId}`;
        hoursMap.set(k3, (hoursMap.get(k3) || 0) + Number(a.weeklyHours || 0));
      }
    });
  });

  // Sinf uchun yopiq kataklar: obed, smena (classIds), dam kuni
  const blocked = new Uint8Array(C * DT);
  classes.forEach((c, ci) => {
    const off = new Set(Array.isArray(c.offDays) ? c.offDays : []);
    DAYS.forEach((day, d) => {
      teachingTs.forEach((ts, i) => {
        const allowed = Array.isArray(ts.classIds) ? ts.classIds : [];
        const bad = off.has(day) ||
          (allowed.length && !allowed.includes(c.id)) ||
          classHasLunchAt(ts, c.id, lunchGroups, day);
        if (bad) blocked[ci * DT + d * T + i] = 1;
      });
    });
  });

  // FAQAT obed kataklari: blok ular ustidan oshib o'tishi mumkin, smena
  // chegarasi va dam kuni ustidan esa — YO'Q (u haqiqiy uzilish).
  const lunchOnly = new Uint8Array(C * DT);
  classes.forEach((c, ci) => {
    DAYS.forEach((day, d) => {
      teachingTs.forEach((ts, i) => {
        if (classHasLunchAt(ts, c.id, lunchGroups, day)) lunchOnly[ci * DT + d * T + i] = 1;
      });
    });
  });
  // Birlik bo'laklarining `i` ga nisbatan o'rinlari (obed sakralgan bo'lsa).
  const uSlotAt = (u, o) => u.i + (u.offs ? u.offs[o] : o);

  const slotRank = new Int16Array(C * DT).fill(-1);
  for (let ci = 0; ci < C; ci++) {
    for (let d = 0; d < D; d++) {
      const base = ci * DT + d * T;
      let r = 0;
      for (let k = 0; k < T; k++) {
        if (blocked[base + k]) continue;
        slotRank[base + k] = r;
        r += 1;
      }
    }
  }

  // Ishlatiladigan kunlar soni (kunlik fan limitini hisoblash uchun)
  const usableDays = new Int16Array(C);
  for (let ci = 0; ci < C; ci++) {
    let ud = 0;
    for (let d = 0; d < D; d++) {
      let cap = 0;
      for (let k = 0; k < T; k++) if (!blocked[ci * DT + d * T + k]) cap += 1;
      if (cap > 0) ud += 1;
    }
    usableDays[ci] = ud;
  }

  // ——— Darslarni "birlik"larga ajratamiz ———
  const units = [];
  // "Bir vaqtda 2 fan" ikki (ba'zan uch) yozuvdan iborat: 1-guruh fani va
  // har sinfning 2-guruh fani. Ular BITTA soatda turishi SHART, shuning uchun
  // zichlashda ham bitta birlik bo'lib ko'chadi — `pairKey` ularni bog'laydi.
  // Busiz har yozuv alohida ko'chib, juft dars bo'linib ketardi.
  const baseKeyOf = (l) => (l.pairKey
    ? `PAIR|${l.pairKey}`
    : l.swap
      ? `SWAP|${classIdsOf(l).slice().sort().join("+")}`
      : `${l.subjectId}|${l.groupKey || ""}|${classIdsOf(l).slice().sort().join("+")}`);
  const perDay = [];
  for (let d = 0; d < D; d++) {
    const day = DAYS[d];
    const rows = [];
    for (let i = 0; i < T; i++) {
      const cell = schedule?.[day]?.[teachingTs[i].id];
      const map = new Map();
      if (Array.isArray(cell)) {
        for (const l of cell) {
          if (!l) continue;
          const k = `${baseKeyOf(l)}|${l.blockIndex ?? "-"}`;
          let g = map.get(k);
          if (!g) map.set(k, (g = { base: baseKeyOf(l), bi: l.blockIndex ?? -1, entries: [] }));
          g.entries.push(l);
        }
      }
      rows.push(map);
    }
    perDay.push(rows);
  }
  const consumed = new Set();
  for (let d = 0; d < D; d++) {
    for (let i = 0; i < T; i++) {
      for (const [k, g] of perDay[d][i]) {
        const tag = `${d}|${i}|${k}`;
        if (consumed.has(tag)) continue;
        // Blok (2 yoki 4 soat) BUTUN birlik bo'lib ko'chadi: blockIndex
        // 0, 1, 2, … qismlari ketma-ket kataklardan yig'iladi. Uzunlik
        // qat'iy emas — 4 soatlik blok ham shu yerda butun qoladi.
        const parts = [g];
        const offs = [0];
        let len = 1;
        let jumped = false;
        if (g.bi === 0) {
          // Blokning bo'lagi obed katagining NARIGI tomonida turishi mumkin
          // («4-dars → obed → 6-dars»). Bunday katak o'tkazib yuboriladi,
          // aks holda zichlash blokni ikkiga bo'lib yuborardi.
          const gcIdxs = [...new Set(g.entries.flatMap((l) => classIdsOf(l)))]
            .map((cid) => cIdxOf.get(cid)).filter((x) => x !== undefined);
          const lunchHere = (k) => gcIdxs.length > 0
            && gcIdxs.every((ci) => lunchOnly[ci * DT + d * T + k]);
          let cur = i;
          for (;;) {
            let nx = cur + 1;
            while (nx < T && lunchHere(nx)) { nx += 1; jumped = true; }
            if (nx >= T) break;
            let linked = true;
            for (let x = cur; x < nx; x++) if (!linkOk(x)) { linked = false; break; }
            if (!linked) break;
            let next = null;
            let nextKey = "";
            for (const [k2, g2] of perDay[d][nx]) {
              if (g2.base === g.base && g2.bi === len) { next = g2; nextKey = k2; break; }
            }
            if (!next) break;
            parts.push(next);
            offs.push(nx - i);
            consumed.add(`${d}|${nx}|${nextKey}`);
            len += 1;
            cur = nx;
          }
        }
        // Obed ustidan o'tgan blok joyidan qo'zg'almaydi: uni ko'chirish
        // uchun narigi tomonda ham xuddi shunday obed kerak bo'lardi.
        const jumpOffs = jumped && parts.length === offs.length ? offs : null;
        const entries = parts.flatMap((x) => x.entries);
        const cSet = new Set();
        const tSet = new Set();
        const rSet = new Set();
        let locked = false;
        let spaced = false;
        let core = false;
        for (const l of entries) {
          classIdsOf(l).forEach((cid) => {
            cSet.add(cid);
            if (spacedSet.has(`${cid}|${l.subjectId}`)) spaced = true;
            if (coreSet.has(`${cid}|${l.subjectId}`)) core = true;
          });
          if (l.teacherId) tSet.add(l.teacherId);
          if (l.altTeacherId) tSet.add(l.altTeacherId);
          if (liveRoom(l.roomId)) rSet.add(l.roomId);
          if (l.manual) locked = true;
          // KELAJAK SOATI: dushanba 1-darsga biriktirilgan — zichlashda qo'zg'almaydi
          if (l.fixedMonday || fixedMondayIds.has(l.subjectId)) locked = true;
        }
        const cIdxs = [...cSet].map((cid) => cIdxOf.get(cid)).filter((x) => x !== undefined);
        if (!cIdxs.length) locked = true;
        const subjectId = entries[0]?.subjectId || "";
        // Kunlik fan limiti: blok o'lchami yoki soat/kun nisbati.
        // Juft darsda (va almashinuvda) bitta birlik ichida BIR NECHTA fan
        // bo'ladi — limit shuning uchun (sinf + fan) juftligi bo'yicha yuriladi,
        // aks holda 2-guruh fani umuman hisobga olinmay qolardi.
        const capFor = (cid, ci, sid) => {
          let cap = len;
          if (doubleSet.has(`${cid}|${sid}`)) cap = Math.max(cap, 2);
          if (quadSet.has(`${cid}|${sid}`)) cap = Math.max(cap, QUAD_SIZE);
          const h = hoursMap.get(`${cid}|${sid}`) || 0;
          const ud = Math.max(1, usableDays[ci] || 1);
          if (h > 0) cap = Math.max(cap, Math.ceil(h / ud));
          return cap;
        };
        const subjKeys = [];
        const seenSubjKey = new Set();
        for (const l of entries) {
          if (!l.subjectId) continue;
          for (const cid of classIdsOf(l)) {
            const ci = cIdxOf.get(cid);
            if (ci === undefined) continue;
            const k = `${ci}|${l.subjectId}`;
            if (seenSubjKey.has(k)) continue;
            seenSubjKey.add(k);
            subjKeys.push({ ci, subjectId: l.subjectId, cap: capFor(cid, ci, l.subjectId) });
          }
        }
        let cap = len;
        for (const sk of subjKeys) if (sk.subjectId === subjectId) cap = Math.max(cap, sk.cap);
        units.push({
          d, i, len, offs: jumpOffs, locked: locked || Boolean(jumpOffs),
          entries, spaced, core, cap, subjKeys,
          parts: parts.map((x) => x.entries),
          cIdxs, tids: [...tSet], rids: [...rSet],
          subjectId,
        });
      }
    }
  }

  // ——— Bandlik jadvallari ———
  const classGrid = new Uint8Array(C * DT);
  const tGrid = new Map();
  const rGrid = new Map();
  const gridOf = (map, id) => {
    let g = map.get(id);
    if (!g) { g = new Uint8Array(DTB); map.set(id, g); }
    return g;
  };
  const classDayCount = new Int16Array(C * D);
  const subjDay = new Map(); // `${ci}|${d}|${subjectId}` -> soni
  // ——— PARALLEL SINFLAR: bir kunda bir xil fan ———
  // Zichlash darsni boshqa kunga ko'chirib moslikni buzmasin. Oyna baribir
  // ustun (u alohida solishtiriladi) — bu faqat TENG variantlarni ajratadi.
  const cPar = buildParallelIndex(classes, opt.parallelDays !== false);
  const cParOn = cPar.enabled;
  const cGradeIdx = cPar.idxArr;
  // `${g}|${d}|${subjectId}` -> shu kuni fanni oladigan SINFLAR soni
  const gradeSubjDay = new Map();
  const bumpSubj = (u, d, sign) => {
    for (const sk of u.subjKeys) {
      const k = `${sk.ci}|${d}|${sk.subjectId}`;
      const before = subjDay.get(k) || 0;
      const after = before + sign * u.len;
      subjDay.set(k, after);
      if (!cParOn) continue;
      const g = cGradeIdx[sk.ci];
      if (g < 0) continue;
      const gk = `${g}|${d}|${sk.subjectId}`;
      if (before <= 0 && after > 0) gradeSubjDay.set(gk, (gradeSubjDay.get(gk) || 0) + 1);
      else if (before > 0 && after <= 0) gradeSubjDay.set(gk, (gradeSubjDay.get(gk) || 0) - 1);
    }
  };
  const setBits = (u, d, i, val) => {
    for (let o = 0; o < u.len; o++) {
      const k = i + (u.offs ? u.offs[o] : o);
      const off = d * T + k;
      const toff = tbOff(d, k);
      for (const ci of u.cIdxs) classGrid[ci * DT + off] = val;
      for (const id of u.tids) gridOf(tGrid, id)[toff] = val;
      for (const id of u.rids) gridOf(rGrid, id)[toff] = val;
    }
    const delta = val ? u.len : -u.len;
    for (const ci of u.cIdxs) classDayCount[ci * D + d] += delta;
  };
  units.forEach((u) => { setBits(u, u.d, u.i, 1); bumpSubj(u, u.d, +1); });

  // Kun ichida qayta tartiblashda kun darajasidagi limitlar o'zgarmaydi
  let rearrange = false;
  const fits = (u, d, i) => {
    // Bir kunda bir fan limiti (o'z hissasini chiqarib tashlaydi)
    if (!rearrange) {
      for (const sk of u.subjKeys) {
        let n = subjDay.get(`${sk.ci}|${d}|${sk.subjectId}`) || 0;
        if (d === u.d) n -= u.len;
        if (n + u.len > sk.cap) return false;
      }
    }
    // Bir kunga tushmaydigan fanlar. O'Z kunida qolish HAR DOIM mumkin:
    // aks holda jadvalda allaqachon mavjud ziddiyat (qo'lda qo'yilgan dars)
    // birlikni umuman qimirlata olmas va soat yo'qolib ketardi.
    if (anyConflict && d !== u.d) {
      for (const sk of u.subjKeys) {
        const foes = conflictOf.get(sk.subjectId);
        if (!foes) continue;
        for (const fid of foes) {
          // Ziddiyatli fan shu birlikning O'ZIDA bo'lsa — ayni soatda
          // o'qiladi, ajratib bo'lmaydi.
          if (u.subjKeys.some((x) => x.ci === sk.ci && x.subjectId === fid)) continue;
          if ((subjDay.get(`${sk.ci}|${d}|${fid}`) || 0) > 0) return false;
        }
      }
    }
    for (let o = 0; o < u.len; o++) {
      if (o > 0 && !linkOk(i + o - 1)) return false;
      const off = d * T + i + o;
      const toff = tbOff(d, i + o);
      for (const ci of u.cIdxs) if (blocked[ci * DT + off] || classGrid[ci * DT + off]) return false;
      for (const id of u.tids) {
        if (gridOf(tGrid, id)[toff]) return false;
        const bg = tBlockedMap.get(id);
        if (bg && bg[off]) return false;
      }
      for (const id of u.rids) if (gridOf(rGrid, id)[toff]) return false;
    }
    return true;
  };
  units.forEach((u) => {
    const dom = [];
    for (let d = 0; d < D; d++) {
      for (let i = 0; i + u.len <= T; i++) {
        let ok = true;
        for (let o = 0; o < u.len && ok; o++) {
          if (o > 0 && !linkOk(i + o - 1)) ok = false;
          for (const ci of u.cIdxs) if (blocked[ci * DT + d * T + i + o]) { ok = false; break; }
          if (!ok) break;
          for (const id of u.tids) {
            const bg = tBlockedMap.get(id);
            if (bg && bg[d * T + i + o]) { ok = false; break; }
          }
        }
        if (ok) dom.push({ d, i });
      }
    }
    u.domain = dom;
  });

  const BAL_W = 900;
  const REPEAT_W = 45;
  const SPACED_W = 600;
  const CORE_W = 420;
  // Parallel moslik — kunlik yuk tengligidan (BAL_W) yengil
  const PARALLEL_C_W = 200;

  // Kunlik me'yor: sinfning haftalik soati ish kunlariga teng bo'linadi
  // (24 soat / 6 kun => kuniga aynan 4 ta).
  // Me'yor har kun uchun alohida — qisqartirilgan kunlar hisobga olinadi
  // (generatordagi bilan bir xil "suv to'ldirish" usuli).
  const balLo = new Int16Array(C * D);
  const balHi = new Int16Array(C * D);
  const dayUsable = new Uint8Array(C * D);
  const dayCap = new Int16Array(C * D);
  for (let ci = 0; ci < C; ci++) {
    const pool = [];
    let total = 0;
    for (let d = 0; d < D; d++) {
      let cap = 0;
      const cBase = ci * DT + d * T;
      for (let k = 0; k < T; k++) if (!blocked[cBase + k]) cap += 1;
      dayCap[ci * D + d] = cap;
      if (cap > 0) { dayUsable[ci * D + d] = 1; pool.push(d); }
      total += classDayCount[ci * D + d];
    }
    if (!pool.length) continue;
    const share = new Float64Array(D);
    let rest = total;
    let open = pool.slice();
    while (open.length) {
      const per = rest / open.length;
      const full = open.filter((d) => dayCap[ci * D + d] <= per);
      if (!full.length) { open.forEach((d) => { share[d] = per; }); break; }
      full.forEach((d) => { share[d] = dayCap[ci * D + d]; rest -= share[d]; });
      open = open.filter((d) => !full.includes(d));
    }
    pool.forEach((d) => {
      balLo[ci * D + d] = Math.floor(share[d] + 1e-9);
      balHi[ci * D + d] = Math.ceil(share[d] - 1e-9);
    });
  }

  // Taqqoslash LEKSIKOGRAFIK: avval oynalar soni, keyin me'yordan chetlanish
  let _gap = 0;
  const costOf = (cIdxs) => {
    let cost = 0;
    let gaps = 0;
    for (const ci of cIdxs) {
      for (let d = 0; d < D; d++) {
        const cBase = ci * DT + d * T;
        let free = 0;
        let head = 0;
        for (let k = 0; k < T; k++) {
          if (blocked[cBase + k]) continue;
          if (classGrid[cBase + k]) head += free;
          else free += 1;
        }
        gaps += head;
        if (dayUsable[ci * D + d]) {
          const n = classDayCount[ci * D + d];
          const hiD = balHi[ci * D + d];
          const loD = balLo[ci * D + d];
          const dev = n > hiD ? n - hiD : (n < loD ? loD - n : 0);
          cost += dev * dev * BAL_W;
        }
      }
    }
    _gap = gaps;
    return cost;
  };
  const gapsOf = (cIdxs) => {
    let gaps = 0;
    for (const ci of cIdxs) {
      for (let d = 0; d < D; d++) {
        const cBase = ci * DT + d * T;
        let free = 0;
        let head = 0;
        for (let k = 0; k < T; k++) {
          if (blocked[cBase + k]) continue;
          if (classGrid[cBase + k]) head += free;
          else free += 1;
        }
        gaps += head;
      }
    }
    return gaps;
  };
  const dayGapOf = (ci, d) => {
    const cBase = ci * DT + d * T;
    let free = 0;
    let gap = 0;
    for (let k = 0; k < T; k++) {
      if (blocked[cBase + k]) continue;
      if (classGrid[cBase + k]) gap += free;
      else free += 1;
    }
    return gap;
  };
  const repeatAt = (u, dd, oldD) => {
    if (!u.subjectId) return 0;
    let c = 0;
    for (const ci of u.cIdxs) {
      let n = subjDay.get(`${ci}|${dd}|${u.subjectId}`) || 0;
      if (dd === oldD) n -= u.len;
      if (n > 0) c += n * REPEAT_W;
    }
    return c;
  };
  const spacedAt = (u, dd, oldD) => {
    if (!u.spaced || !u.subjectId) return 0;
    let c = 0;
    for (const ci of u.cIdxs) {
      for (let k = -1; k <= 1; k++) {
        const nd = dd + k;
        if (nd < 0 || nd >= D) continue;
        let n = subjDay.get(`${ci}|${nd}|${u.subjectId}`) || 0;
        if (nd === oldD) n -= u.len;
        if (n > 0) c += k === 0 ? n * SPACED_W * 2 : SPACED_W;
      }
    }
    return c;
  };
  // Parallel sinflar mukofoti: shu kunda darajadagi BOSHQA sinf ayni fanni
  // olayotgan bo'lsa — narx kamayadi. Faqat mukofot, jarima yo'q.
  const parallelAt = (u, dd, oldD) => {
    if (!cParOn || !u.subjectId) return 0;
    let c = 0;
    for (const ci of u.cIdxs) {
      const g = cGradeIdx[ci];
      if (g < 0) continue;
      // Kvotadan oshgan kunga tortmaymiz — narigi kunda oyna ochiladi
      // (`setBits` `classDayCount` ni allaqachon yangilagan).
      if (classDayCount[ci * D + dd] > balHi[ci * D + dd]) continue;
      const cur = subjDay.get(`${ci}|${dd}|${u.subjectId}`) || 0;
      const own = dd === oldD ? cur - u.len : cur;
      if (own > 0) continue;   // sinf shu kuni bu fanni allaqachon oladi
      const gCur = gradeSubjDay.get(`${g}|${dd}|${u.subjectId}`) || 0;
      const mates = gCur - (cur > 0 ? 1 : 0);   // o'z sinfining hissasi chiqariladi
      if (mates > 0) c -= Math.min(mates, cPar.sizes[g] - 1) * PARALLEL_C_W;
    }
    return c;
  };
  const coreAt = (u, d, i) => {
    let c = 0;
    for (const ci of u.cIdxs) {
      const r = slotRank[ci * DT + d * T + i];
      if (r < 0) continue;
      if (u.core) c += r * CORE_W;
      else if (r < 3) c += (3 - r) * 30;
    }
    return c;
  };
  const unionArr = (a, b) => {
    const seen = new Set(a);
    const res = [...a];
    for (const x of b) if (!seen.has(x)) { seen.add(x); res.push(x); }
    return res;
  };

  const movableAll = units.filter((u) => !u.locked && u.domain.length > 1);
  // `rot` — takroriy chaqiruvda (spin) tartib aylanadi: shu tufayli
  // «yana urinish» boshqa yechimga olib boradi. Asosiy fanlar baribir
  // oldinda qoladi — aylantirish har guruh ICHIDA bo'ladi.
  const movable = [
    ...rot(movableAll.filter((u) => u.core)),
    ...rot(movableAll.filter((u) => !u.core)),
  ];
  const stop = Date.now() + 2500;
  for (let round = 0; round < 12 && Date.now() < stop; round++) {
    let moved = 0;
    for (const u of movable) {
      if (Date.now() > stop) break;
      const oldD = u.d;
      const oldI = u.i;
      const base = costOf(u.cIdxs) + repeatAt(u, oldD, oldD) + spacedAt(u, oldD, oldD) + coreAt(u, oldD, oldI) + parallelAt(u, oldD, oldD);
      const baseGap = _gap;
      setBits(u, oldD, oldI, 0);
      let bd = -1;
      let bi = -1;
      let bc = base;
      let bg = baseGap;
      for (const cand of u.domain) {
        if (cand.d === oldD && cand.i === oldI) continue;
        if (!fits(u, cand.d, cand.i)) continue;
        setBits(u, cand.d, cand.i, 1);
        const c = costOf(u.cIdxs) + repeatAt(u, cand.d, oldD) + spacedAt(u, cand.d, oldD) + coreAt(u, cand.d, cand.i) + parallelAt(u, cand.d, oldD);
        const g = _gap;
        setBits(u, cand.d, cand.i, 0);
        if (g < bg || (g === bg && c < bc)) { bg = g; bc = c; bd = cand.d; bi = cand.i; }
      }
      if (bd >= 0) {
        setBits(u, bd, bi, 1);
        bumpSubj(u, oldD, -1);
        bumpSubj(u, bd, +1);
        u.d = bd;
        u.i = bi;
        moved += 1;
      } else {
        setBits(u, oldD, oldI, 1);
      }
    }
    if (!moved) break;
  }

  // ——— PREFIKS QAYTA YIG'ISH: kun o'rtasida oyna qolmasin ———
  const prefixRebuild = (ci, d) => {
    if (dayGapOf(ci, d) === 0) return false;
    const movers = units.filter((u) => !u.locked && u.d === d && u.cIdxs.includes(ci));
    if (!movers.length) return false;
    let uni = [];
    for (const u of movers) uni = unionArr(uni, u.cIdxs);
    const gapBefore = gapsOf(uni);
    const saved = movers.map((u) => ({ u, i: u.i }));
    const cnt = classDayCount[ci * D + d];
    rearrange = true;
    movers.forEach((u) => setBits(u, d, u.i, 0));
    const cBase = ci * DT + d * T;
    const U = [];
    for (let k = 0; k < T; k++) if (!blocked[cBase + k]) U.push(k);
    const targets = U.slice(0, Math.min(U.length, cnt)).filter((k) => !classGrid[cBase + k]);
    const tset = new Set(targets);
    const order = [...movers].sort((a, b) => b.len - a.len);
    const used = new Set();
    const live = new Set();
    let nodes = 0;
    const solve = (idx) => {
      if (idx >= order.length) return true;
      if (nodes++ > 3000) return false;
      const u = order[idx];
      for (const k of targets) {
        if (used.has(k)) continue;
        if (k + u.len > T) continue;
        let ok = true;
        for (let o = 1; o < u.len; o++) {
          if (!tset.has(k + o) || used.has(k + o) || !linkOk(k + o - 1)) { ok = false; break; }
        }
        if (!ok) continue;
        if (!fits(u, d, k)) continue;
        setBits(u, d, k, 1);
        live.add(u);
        for (let o = 0; o < u.len; o++) used.add(k + o);
        u.i = k;
        if (solve(idx + 1)) return true;
        setBits(u, d, k, 0);
        live.delete(u);
        for (let o = 0; o < u.len; o++) used.delete(k + o);
      }
      return false;
    };
    const done = solve(0);
    if (done && gapsOf(uni) < gapBefore) { rearrange = false; return true; }
    for (const u of live) setBits(u, d, u.i, 0);
    live.clear();
    for (const s of saved) { s.u.i = s.i; setBits(s.u, d, s.i, 1); }
    rearrange = false;
    return false;
  };

  // ——— OYNANI ZANJIR BILAN YOPISH (ikki soat ustunini almashtirish) ———
  // Bo'sh katakka keyingi darsni tortib bo'lmasa (ustoz o'sha soatda boshqa
  // sinfda band), ikkala soatdagi bir-biriga bog'liq barcha darslar birgalikda
  // o'rin almashadi — boshqa sinflarda yangi oyna paydo bo'lmaydi.
  const unitsAt = (d, k) => units.filter((u) => {
    if (u.d !== d) return false;
    if (!u.offs) return k >= u.i && k < u.i + u.len;
    for (let o = 0; o < u.len; o++) if (uSlotAt(u, o) === k) return true;
    return false;
  });
  const resOfUnit = (u) => [
    ...u.tids.map((x) => "T" + x),
    ...u.rids.map((x) => "R" + x),
    ...u.cIdxs.map((x) => "C" + x),
  ];
  const chainSwap = (d, i, j) => {
    const chain = new Set();
    const queue = [];
    const add = (u) => { if (!chain.has(u)) { chain.add(u); queue.push(u); } };
    unitsAt(d, i).forEach(add);
    unitsAt(d, j).forEach(add);
    if (!chain.size) return false;
    while (queue.length) {
      const u = queue.pop();
      if (u.locked || u.len !== 1) return false;
      if (chain.size > 14) return false;
      const target = u.i === i ? j : i;
      const res = new Set(resOfUnit(u));
      for (const v of unitsAt(d, target)) {
        if (resOfUnit(v).some((r) => res.has(r))) add(v);
      }
    }
    for (const u of chain) {
      if (u.locked || u.len !== 1) return false;
      const t = u.i === i ? j : i;
      if (!u.domain.some((c) => c.d === d && c.i === t)) return false;
    }
    let uni = [];
    for (const u of chain) uni = unionArr(uni, u.cIdxs);
    const before = gapsOf(uni);
    const saved = [...chain].map((u) => ({ u, from: u.i }));
    rearrange = true;
    saved.forEach(({ u, from }) => setBits(u, d, from, 0));
    const done = [];
    let ok = true;
    for (const m of saved) {
      const t = m.from === i ? j : i;
      if (!fits(m.u, d, t)) { ok = false; break; }
      setBits(m.u, d, t, 1);
      m.u.i = t;
      done.push(m);
    }
    if (ok && gapsOf(uni) >= before) ok = false;
    if (!ok) {
      for (const m of done) setBits(m.u, d, m.u.i, 0);
      for (const m of saved) { m.u.i = m.from; setBits(m.u, d, m.from, 1); }
      rearrange = false;
      return false;
    }
    rearrange = false;
    return true;
  };

  const gapChainFix = (ci, d) => {
    let n = 0;
    let guard = 0;
    while (dayGapOf(ci, d) > 0 && guard < 6) {
      guard += 1;
      const cBase = ci * DT + d * T;
      let hole = -1;
      let lastOcc = -1;
      for (let k = 0; k < T; k++) {
        if (blocked[cBase + k]) continue;
        if (classGrid[cBase + k]) lastOcc = k;
        else if (hole < 0) hole = k;
      }
      if (hole < 0 || lastOcc < hole) break;
      const list = units
        .filter((u) => !u.locked && u.d === d && u.cIdxs.includes(ci) && u.i > hole)
        .sort((a, b) => a.i - b.i);
      let ok = false;
      for (const u of list) { if (chainSwap(d, hole, u.i)) { ok = true; n += 1; break; } }
      if (!ok) break;
    }
    return n;
  };

  const pullStop = Date.now() + 1500;
  for (let ci = 0; ci < C && Date.now() < pullStop; ci++) {
    for (let d = 0; d < D; d++) { prefixRebuild(ci, d); gapChainFix(ci, d); }
  }

  // ——— OYNA TO'LDIRISH: kun boshidagi bo'sh katakka keyingi darsni tortish ———
  const swapUnits = (a, b) => {
    const ad = a.d, ai = a.i, bd = b.d, bi = b.i;
    setBits(a, ad, ai, 0);
    setBits(b, bd, bi, 0);
    let ok = false;
    if (fits(a, bd, bi)) {
      setBits(a, bd, bi, 1);
      if (fits(b, ad, ai)) {
        setBits(b, ad, ai, 1);
        ok = true;
      } else {
        setBits(a, bd, bi, 0);
      }
    }
    if (!ok) {
      setBits(a, ad, ai, 1);
      setBits(b, bd, bi, 1);
      return false;
    }
    bumpSubj(a, ad, -1); bumpSubj(a, bd, +1);
    bumpSubj(b, bd, -1); bumpSubj(b, ad, +1);
    a.d = bd; a.i = bi;
    b.d = ad; b.i = ai;
    return true;
  };
  const pullStop2 = Date.now() + 900;
  for (let ci = 0; ci < C && Date.now() < pullStop2; ci++) {
    for (let d = 0; d < D; d++) {
      let guard = 0;
      while (guard < 8) {
        guard += 1;
        const cBase = ci * DT + d * T;
        let hole = -1;
        let lastOcc = -1;
        for (let k = 0; k < T; k++) {
          if (blocked[cBase + k]) continue;
          if (classGrid[cBase + k]) lastOcc = k;
          else if (hole < 0) hole = k;
        }
        if (hole < 0 || lastOcc < hole) break;
        const list = units
          .filter((u) => !u.locked && u.d === d && u.cIdxs.includes(ci) && u.i > hole)
          .sort((a, b) => a.i - b.i);
        let moved = false;
        for (const u of list) {
          const oldD = u.d;
          const oldI = u.i;
          setBits(u, oldD, oldI, 0);
          if (fits(u, d, hole)) {
            setBits(u, d, hole, 1);
            u.i = hole;
            moved = true;
            break;
          }
          setBits(u, oldD, oldI, 1);
          // To'siq boshqa sinf darsi bo'lsa — o'rin almashtirib ko'ramiz
          const blocker = units.find((v) => v !== u && !v.locked && v.d === d && v.len === u.len
            && v.i === hole && !v.cIdxs.includes(ci));
          if (blocker && swapUnits(u, blocker)) { moved = true; break; }
        }
        if (!moved) break;
      }
    }
  }

  // ——— KUNLAR ARO KO'CHIRISH: oynani boshqa kundagi dars bilan to'ldirish ———
  // Kun boshida yoki o'rtasida bo'sh katak qolsa, uni SHU kundagi dars bilan
  // to'ldirib bo'lmasligi mumkin (ustoz o'sha soatda boshqa sinfda band).
  // Bunday holda BOSHQA KUNdagi dars tortib olinadi; katakni bitta birlik
  // to'sib tursa — avval o'sha birlik boshqa joyga suriladi (ejection).
  // Qabul mezoni: ta'sirlangan sinflarda oyna soni QAT'IY kamayishi shart,
  // shuning uchun bu bosqich hech qachon yangi oyna yaratmaydi.
  const unitsBlocking = (u, d, i) => {
    const res = new Set(resOfUnit(u));
    const out = new Set();
    for (let o = 0; o < u.len; o++) {
      for (const v of unitsAt(d, i + o)) {
        if (v === u) continue;
        if (resOfUnit(v).some((r) => res.has(r))) out.add(v);
      }
    }
    return [...out];
  };

  const firstHoleOf = (ci, d) => {
    const cBase = ci * DT + d * T;
    let hole = -1;
    let lastOcc = -1;
    for (let k = 0; k < T; k++) {
      if (blocked[cBase + k]) continue;
      if (classGrid[cBase + k]) lastOcc = k;
      else if (hole < 0) hole = k;
    }
    return hole >= 0 && lastOcc > hole ? hole : -1;
  };

  // Ikkilamchi mezon: darslar kun boshiga qanchalik yaqin (oyna teng bo'lganda
  // shu ko'rsatkich yaxshilansa ham ko'chirish qabul qilinadi — shu tufayli
  // qidiruv "tekis joy"da qotib qolmaydi va keyingi qadamda oyna yopiladi).
  const tailOf = (cIdxs) => {
    let sum = 0;
    for (const ci of cIdxs) {
      for (let d = 0; d < D; d++) {
        const cBase = ci * DT + d * T;
        for (let k = T - 1; k >= 0; k--) {
          if (blocked[cBase + k]) continue;
          if (classGrid[cBase + k]) { sum += k + 1; break; }
        }
      }
    }
    return sum;
  };

  const transplant = (ci, d, hole, stopAt) => {
    const cands = units
      .filter((u) => !u.locked && u.cIdxs.includes(ci) && !(u.d === d && u.i <= hole && hole < u.i + u.len))
      .sort((a, b) => (b.d === d ? 1 : 0) - (a.d === d ? 1 : 0) || b.i - a.i);
    for (const u of cands) {
      if (Date.now() > stopAt) return false;
      if (hole + u.len > T) continue;
      const oldD = u.d;
      const oldI = u.i;
      const blockers = unitsBlocking(u, d, hole);
      const v = blockers.length === 1 && !blockers[0].locked && blockers[0].domain.length > 1 ? blockers[0] : null;
      const uni = v ? unionArr(u.cIdxs, v.cIdxs) : u.cIdxs;
      const before = gapsOf(uni);
      const tailBefore = tailOf(uni);
      const better = () => { const g = gapsOf(uni); return g < before || (g === before && tailOf(uni) < tailBefore); };
      setBits(u, oldD, oldI, 0);
      // 1) to'g'ridan-to'g'ri
      if (fits(u, d, hole)) {
        setBits(u, d, hole, 1);
        if (better()) {
          bumpSubj(u, oldD, -1); bumpSubj(u, d, +1);
          u.d = d; u.i = hole;
          return true;
        }
        setBits(u, d, hole, 0);
      }
      // 2) to'siqni surib
      if (v) {
        const vd = v.d;
        const vi = v.i;
        setBits(v, vd, vi, 0);
        for (const cand of v.domain) {
          if (cand.d === vd && cand.i === vi) continue;
          if (!fits(v, cand.d, cand.i)) continue;
          setBits(v, cand.d, cand.i, 1);
          if (fits(u, d, hole)) {
            setBits(u, d, hole, 1);
            if (better()) {
              bumpSubj(v, vd, -1); bumpSubj(v, cand.d, +1);
              v.d = cand.d; v.i = cand.i;
              bumpSubj(u, oldD, -1); bumpSubj(u, d, +1);
              u.d = d; u.i = hole;
              return true;
            }
            setBits(u, d, hole, 0);
          }
          setBits(v, cand.d, cand.i, 0);
        }
        setBits(v, vd, vi, 1);
      }
      setBits(u, oldD, oldI, 1);
    }
    return false;
  };

  const transplantPass = (ms) => {
    const stopAt = Date.now() + Math.max(0, ms);
    let fixed = 0;
    for (let ci = 0; ci < C; ci++) {
      for (let d = 0; d < D; d++) {
        let guard = 0;
        while (guard < 8 && Date.now() < stopAt) {
          guard += 1;
          const hole = firstHoleOf(ci, d);
          if (hole < 0) break;
          if (!transplant(ci, d, hole, stopAt)) break;
          fixed += 1;
        }
      }
      if (Date.now() > stopAt) break;
    }
    return fixed;
  };
  const tpBudget = Math.max(500, Math.min(2200, C * 60));
  transplantPass(tpBudget);

  // ——— ASOSIY FANLARNI KUN BOSHIGA TARTIBLASH ———
  const coreStop = Date.now() + 1200;
  for (let round = 0; round < 6 && Date.now() < coreStop; round++) {
    let swapped = 0;
    for (let ci = 0; ci < C; ci++) {
      for (let d = 0; d < D; d++) {
        if (Date.now() > coreStop) break;
        let guard = 0;
        let again = true;
        while (again && guard < 8) {
          guard += 1;
          again = false;
          const list = units
            .filter((u) => !u.locked && u.d === d && u.cIdxs.includes(ci))
            .sort((a, b) => a.i - b.i);
          outer:
          for (let x = 0; x < list.length; x++) {
            const a = list[x];
            if (a.core) continue;
            let coreLater = false;
            for (let y = x + 1; y < list.length; y++) {
              if (list[y].core) { coreLater = true; break; }
            }
            if (!coreLater) continue;
            for (let y = x + 1; y < list.length; y++) {
              const b = list[y];
              if (!b.core) continue;
              if (a.len !== b.len) continue;
              const ad = a.d, ai = a.i, bd2 = b.d, bi2 = b.i;
              const uni = unionArr(a.cIdxs, b.cIdxs);
              // 1-strategiya: to'g'ridan-to'g'ri o'rin almashtirish
              setBits(a, ad, ai, 0);
              setBits(b, bd2, bi2, 0);
              let ok = false;
              if (fits(a, bd2, bi2)) {
                setBits(a, bd2, bi2, 1);
                if (fits(b, ad, ai)) {
                  setBits(b, ad, ai, 1);
                  ok = true;
                } else {
                  setBits(a, bd2, bi2, 0);
                }
              }
              if (ok) {
                bumpSubj(a, ad, -1);
                bumpSubj(a, bd2, +1);
                bumpSubj(b, bd2, -1);
                bumpSubj(b, ad, +1);
                a.d = bd2;
                a.i = bi2;
                b.d = ad;
                b.i = ai;
                swapped += 1;
                again = true;
                break outer;
              }
              setBits(a, ad, ai, 1);
              setBits(b, bd2, bi2, 1);
              // 2-strategiya: oddiy fanni boshqa katakka ko'chirib (evict),
              // asosiy fanni bo'shagan erta o'ringa qo'yamiz
              const evBefore = costOf(uni) + repeatAt(a, ad, ad) + spacedAt(a, ad, ad) + parallelAt(a, ad, ad);
              const evGap = _gap;
              let evicted = false;
              for (const cand of a.domain) {
                if (cand.d === ad && cand.i === ai) continue;
                setBits(a, ad, ai, 0);
                setBits(b, bd2, bi2, 0);
                let ok2 = false;
                if (fits(b, ad, ai)) {
                  setBits(b, ad, ai, 1);
                  if (fits(a, cand.d, cand.i)) {
                    setBits(a, cand.d, cand.i, 1);
                    const evAfter = costOf(uni) + repeatAt(a, cand.d, ad) + spacedAt(a, cand.d, ad) + parallelAt(a, cand.d, ad);
                    ok2 = _gap <= evGap && evAfter <= evBefore + BAL_W;
                    if (!ok2) {
                      setBits(a, cand.d, cand.i, 0);
                      setBits(b, ad, ai, 0);
                    }
                  } else {
                    setBits(b, ad, ai, 0);
                  }
                }
                if (ok2) {
                  bumpSubj(a, ad, -1);
                  bumpSubj(a, cand.d, +1);
                  a.d = cand.d;
                  a.i = cand.i;
                  b.d = ad;
                  b.i = ai;
                  evicted = true;
                  break;
                }
                setBits(a, ad, ai, 1);
                setBits(b, bd2, bi2, 1);
              }
              if (evicted) {
                swapped += 1;
                again = true;
                break outer;
              }
            }
          }
        }
      }
    }
    if (!swapped) break;
  }

  // ——— Yakuniy prefiks qayta yig'ish (oyna qolmasligi kafolati) ———
  const finalStop = Date.now() + 1800;
  for (let pass = 0; pass < 4; pass++) {
    let any = false;
    for (let ci = 0; ci < C && Date.now() < finalStop; ci++) {
      for (let d = 0; d < D; d++) {
        if (prefixRebuild(ci, d)) any = true;
        if (gapChainFix(ci, d)) any = true;
      }
    }
    if (transplantPass(Math.round(tpBudget / 2))) any = true;
    if (!any) break;
  }

  // ══════════════════════════════════════════════════════════════
  //  MAJBURIY OYNA YOPISH  (faqat `hard` rejimda)
  //  «🧲 Oynani yopish» tugmasi va generatsiyaning yakuniy bosqichi shu
  //  yerga tushadi. Yuqoridagi bosqichlar "yaxshilash" bo'lsa, bu yerdagi
  //  sikl MAQSADGA qarab ishlaydi: oyna nolga tushmaguncha yoki vaqt
  //  tugamaguncha to'xtamaydi va har raundda kuchliroq vositaga o'tadi.
  // ══════════════════════════════════════════════════════════════
  const allCIdxs = [];
  for (let ci = 0; ci < C; ci++) allCIdxs.push(ci);
  const totalGaps = () => gapsOf(allCIdxs);
  const dayGapsOf = (d) => {
    let g = 0;
    for (let ci = 0; ci < C; ci++) g += dayGapOf(ci, d);
    return g;
  };
  const rotBy = (arr, k) => {
    if (arr.length < 2) return arr;
    const n = ((k % arr.length) + arr.length) % arr.length;
    return n ? arr.slice(n).concat(arr.slice(0, n)) : arr;
  };

  // ——— BUTUN KUNNI QAYTA YECHISH ———
  // `prefixRebuild` bitta sinfni yig'adi va yo'lni BOSHQA sinfning darsi
  // to'sib tursa taslim bo'ladi — aynan shu sababli ekranda oyna qolib
  // ketardi. Bu yerda kun BUTUNLIGICHA yechiladi: har sinf uchun maqsad
  // kataklar — kunning DASTLABKI n ta ochiq katagi (n = o'sha kundagi dars
  // soni). Yechim topilsa, o'sha kunda HECH BIR sinfda oyna qolmaydi:
  // har sinfning darslari aynan prefiksni to'ldiradi. Ustoz/xona/sinf
  // bandligi va ustoz setkasidagi qulflar `fits()` orqali saqlanadi.
  const dayFullSolve = (d, stopAt, spin) => {
    if (dayGapsOf(d) === 0) return false;
    const dayUnits = units.filter((u) => u.d === d);
    const movers = dayUnits.filter((u) => !u.locked);
    if (!movers.length) return false;

    const targets = [];
    for (let ci = 0; ci < C; ci++) {
      const cBase = ci * DT + d * T;
      const open = [];
      for (let k = 0; k < T; k++) if (!blocked[cBase + k]) open.push(k);
      targets.push(new Set(open.slice(0, classDayCount[ci * D + d])));
    }
    // Qulflangan (yoki obed ustidan o'tgan) dars prefiksdan tashqarida
    // bo'lsa — bu kunni to'liq yechib bo'lmaydi, uni qo'zg'atishga
    // haqqimiz yo'q. U holda boshqa vositalar (pushOut) ishga tushadi.
    for (const u of dayUnits) {
      if (!u.locked) continue;
      for (const ci of u.cIdxs) {
        for (let o = 0; o < u.len; o++) if (!targets[ci].has(uSlotAt(u, o))) return false;
      }
    }

    // Domenlar statik: maqsad kataklar + blok bog'lanishi + ustoz qulflari
    const doms = movers.map((u) => {
      const list = [];
      for (let k = 0; k + u.len <= T; k++) {
        let ok = true;
        for (let o = 0; o < u.len; o++) {
          if (o > 0 && !linkOk(k + o - 1)) { ok = false; break; }
          for (const ci of u.cIdxs) if (!targets[ci].has(k + o)) { ok = false; break; }
          if (!ok) break;
          for (const id of u.tids) {
            const bg = tBlockedMap.get(id);
            if (bg && bg[d * T + k + o]) { ok = false; break; }
          }
          if (!ok) break;
        }
        if (ok) list.push(k);
      }
      return rotBy(list, spin);
    });
    if (doms.some((x) => !x.length)) return false;

    const saved = movers.map((u) => ({ u, i: u.i }));
    rearrange = true;
    movers.forEach((u) => setBits(u, d, u.i, 0));

    // ——— QIDIRUV: DINAMIK MRV + OLDINDAN TEKSHIRISH ———
    // Bir kunda 80 ga yaqin "o'zgaruvchi" bo'ladi. Oddiy (qat'iy tartibli)
    // backtracking bunday o'lchamda deyarli har doim tugun chegarasiga
    // urilardi — sinovda 33 000 marta chegara, atigi 3 marta yechim.
    // Endi har qadamda:
    //   • eng KAM variantli birlik tanlanadi (MRV) — qiyin joy oldin hal
    //     bo'ladi, shuning uchun xato tanlov ildizga yaqin sezildi;
    //   • biror birlikning varianti UMUMAN qolmasa, shox darhol kesiladi
    //     (oldindan tekshirish) — bu tugunlar sonini bir necha barobar
    //     kamaytiradi;
    //   • yagona variantli birlik darhol qo'yiladi (majburiy tanlov).
    const nodeCap = Math.max(1500, Math.min(20000, movers.length * 120));
    const left = new Set(movers.map((_, x) => x));
    let nodes = 0;
    const solve = () => {
      if (!left.size) return true;
      nodes += 1;
      if (nodes > nodeCap) return false;
      if ((nodes & 63) === 0 && Date.now() > stopAt) return false;
      let pick = -1;
      let vals = null;
      for (const oi of left) {
        const u = movers[oi];
        const ok = [];
        for (const k of doms[oi]) if (fits(u, d, k)) ok.push(k);
        if (!ok.length) return false;               // o'lik shox — darhol orqaga
        if (!vals || ok.length < vals.length) { pick = oi; vals = ok; }
        if (vals.length === 1) break;               // majburiy tanlov
      }
      const u = movers[pick];
      const keep = u.i;
      left.delete(pick);
      for (const k of vals) {
        setBits(u, d, k, 1);
        u.i = k;
        if (solve()) return true;
        setBits(u, d, k, 0);
      }
      u.i = keep;
      left.add(pick);
      return false;
    };
    if (solve()) { rearrange = false; return true; }
    saved.forEach((s) => { s.u.i = s.i; setBits(s.u, d, s.i, 1); });
    rearrange = false;
    return false;
  };

  // ——— DARSNI BOSHQA KUNGA SURIB CHIQARISH ———
  // Oynani SHU kundagi dars bilan to'ldirib bo'lmasa (ustoz o'sha soatda
  // boshqa sinfda band va zanjir ham yordam bermasa), teskarisini qilamiz:
  // oynadan KEYINGI darsni butunlay boshqa kunga olib chiqamiz — kun
  // qisqaradi va oyna yopiladi. Qabul mezoni qat'iy: ta'sirlangan
  // sinflarda oyna soni KAMAYISHI shart, ya'ni bu qadam hech qachon
  // yangi oyna yaratmaydi. Kunlik yuk tengligi bu yerda ikkinchi darajali
  // (ustuvorlik: joylangan soat → oyna → kunlik yuk).
  const pushOut = (ci, d, stopAt) => {
    const hole = firstHoleOf(ci, d);
    if (hole < 0) return false;
    const list = units
      .filter((u) => !u.locked && u.d === d && u.cIdxs.includes(ci) && u.i > hole)
      .sort((a, b) => b.i - a.i);
    for (const u of list) {
      if (Date.now() > stopAt) return false;
      const before = gapsOf(u.cIdxs);
      const oldD = u.d;
      const oldI = u.i;
      setBits(u, oldD, oldI, 0);
      let bd = -1;
      let bi = -1;
      let bg = before;
      for (const cand of u.domain) {
        if (cand.d === oldD) continue;
        if (!fits(u, cand.d, cand.i)) continue;
        setBits(u, cand.d, cand.i, 1);
        const g = gapsOf(u.cIdxs);
        setBits(u, cand.d, cand.i, 0);
        if (g < bg) { bg = g; bd = cand.d; bi = cand.i; if (!bg) break; }
      }
      if (bd >= 0) {
        setBits(u, bd, bi, 1);
        bumpSubj(u, oldD, -1);
        bumpSubj(u, bd, +1);
        u.d = bd;
        u.i = bi;
        return true;
      }
      setBits(u, oldD, oldI, 1);
    }
    return false;
  };

  // ——— KUNNI QISQARTIRIB QAYTA YECHISH (oxirgi va eng kuchli chora) ———
  // Ba'zan oyna PRINSIPIAL yopilmaydi: kun boshidagi soatlarga hamma sinf
  // birdan tiqiladi va ustozlar yetmaydi (masalan 28 sinf × 4 ta birinchi
  // soat, lekin ustozlar soni undan kam). Bunday holda darslarni kunlarga
  // TENG bo'lish shartining o'zi oynani majburlab qo'yadi.
  // Yechim: shu kundagi bitta darsni boshqa kunga olib chiqamiz (kun bir
  // soatga qisqaradi) va IKKALA kunni butunlay qayta yechamiz. Natija
  // faqat umumiy oyna KAMAYGANDA qabul qilinadi — aks holda hamma narsa
  // aynan joyiga qaytariladi (`snapshot`/`restoreSnap`).
  const snapshot = () => units.map((u) => ({ u, d: u.d, i: u.i }));
  const restoreSnap = (snap) => {
    units.forEach((u) => { setBits(u, u.d, u.i, 0); bumpSubj(u, u.d, -1); });
    snap.forEach((s) => { s.u.d = s.d; s.u.i = s.i; });
    units.forEach((u) => { setBits(u, u.d, u.i, 1); bumpSubj(u, u.d, +1); });
  };
  const shrinkAndSolve = (ci, d, stopAt, spin) => {
    if (dayGapOf(ci, d) === 0) return false;
    const before = totalGaps();
    const cands = units
      .filter((u) => !u.locked && u.d === d && u.cIdxs.includes(ci))
      .sort((a, b) => b.i - a.i)
      .slice(0, 3);   // kunning oxirgi darslari — ularni olib chiqish arzon
    for (const u of cands) {
      let tries = 0;
      for (const cand of u.domain) {
        if (Date.now() > stopAt) return false;
        if (cand.d === d) continue;
        if (!fits(u, cand.d, cand.i)) continue;
        if ((tries += 1) > 40) break;
        const snap = snapshot();
        const oldD = u.d;
        setBits(u, oldD, u.i, 0);
        bumpSubj(u, oldD, -1);
        setBits(u, cand.d, cand.i, 1);
        bumpSubj(u, cand.d, +1);
        u.d = cand.d;
        u.i = cand.i;
        dayFullSolve(oldD, stopAt, spin);
        dayFullSolve(cand.d, stopAt, spin);
        if (totalGaps() < before) return true;
        restoreSnap(snap);
      }
    }
    return false;
  };

  // ——— SILKITISH ———
  // Tuzatish bosqichlari mahalliy "cho'qqi"da qotib qolishi mumkin: hamma
  // qadam natijasiz, lekin jadval baribir oynali. Shunda bir necha darsni
  // ATAYLAB tasodifiy joyga ko'chiramiz va tuzatishni qaytadan yuritamiz.
  // Vaqtincha yomonlashishga ruxsat beriladi, chunki ENG YAXSHI holat
  // alohida saqlanadi va sikl oxirida tiklanadi.
  const kick = (n) => {
    const pool = units.filter((u) => !u.locked && u.domain.length > 1);
    if (!pool.length) return;
    for (let x = 0; x < n; x++) {
      const u = pool[Math.floor(Math.random() * pool.length)];
      const c = u.domain[Math.floor(Math.random() * u.domain.length)];
      if (!c || (c.d === u.d && c.i === u.i)) continue;
      const oldD = u.d;
      const oldI = u.i;
      setBits(u, oldD, oldI, 0);
      if (fits(u, c.d, c.i)) {
        setBits(u, c.d, c.i, 1);
        bumpSubj(u, oldD, -1);
        bumpSubj(u, c.d, +1);
        u.d = c.d;
        u.i = c.i;
      } else {
        setBits(u, oldD, oldI, 1);
      }
    }
  };

  if (HARD && totalGaps() > 0) {
    const hardStop = Date.now() + HARD_MS;
    const daySlice = Math.max(150, Math.round(HARD_MS / (D * 3)));
    let stall = 0;
    let lastGaps = totalGaps();
    let bestGaps = lastGaps;
    let bestSnap = snapshot();
    for (let round = 0; round < 40 && Date.now() < hardStop; round++) {
      if (lastGaps === 0) break;
      let any = false;

      // 1) eng kuchli qadam — kunni butunlay qayta yechish
      for (let d = 0; d < D && Date.now() < hardStop; d++) {
        if (dayGapsOf(d) === 0) continue;
        if (dayFullSolve(d, Math.min(hardStop, Date.now() + daySlice), SPIN + round)) any = true;
      }

      // 2) sinfma-sinf: prefiks yig'ish + zanjirli almashtirish
      for (const ci of rotBy(allCIdxs, SPIN + round)) {
        if (Date.now() > hardStop) break;
        for (let d = 0; d < D; d++) {
          if (dayGapOf(ci, d) === 0) continue;
          if (prefixRebuild(ci, d)) any = true;
          if (gapChainFix(ci, d)) any = true;
        }
      }

      // 3) boshqa kundagi darsni oynaga tortib olish
      if (totalGaps() > 0 && Date.now() < hardStop) {
        if (transplantPass(Math.max(200, Math.min(tpBudget, hardStop - Date.now())))) any = true;
      }

      // 4) darsni boshqa kunga surib chiqarish (oyna darhol kamayadigan holat)
      if (totalGaps() > 0) {
        for (const ci of rotBy(allCIdxs, SPIN + round)) {
          if (Date.now() > hardStop) break;
          for (let d = 0; d < D; d++) {
            let guard = 0;
            while (guard < 6 && dayGapOf(ci, d) > 0 && Date.now() < hardStop) {
              guard += 1;
              if (!pushOut(ci, d, hardStop)) break;
              any = true;
            }
          }
        }
      }

      // 5) OXIRGI CHORA — kunni qisqartirib ikkala kunni qayta yechish.
      // Qimmat, shuning uchun faqat yuqoridagi bosqichlar oyna sonini
      // KAMAYTIRA olmaganda ishga tushadi (shunchaki "qimirlatish" mezon emas).
      if (totalGaps() >= lastGaps && totalGaps() > 0) {
        for (const ci of rotBy(allCIdxs, SPIN + round)) {
          if (Date.now() > hardStop) break;
          for (let d = 0; d < D && Date.now() < hardStop; d++) {
            let guard = 0;
            while (guard < 4 && dayGapOf(ci, d) > 0 && Date.now() < hardStop) {
              guard += 1;
              if (!shrinkAndSolve(ci, d, hardStop, SPIN + round)) break;
              any = true;
            }
          }
        }
      }

      // To'xtash mezoni — OYNA SONI, bosqichlarning "qimirladi" bayrog'i emas.
      // Ilgari har qanday ko'chirish `any` ni yoqar va sikl hech qanday
      // natijasiz butun byudjetni yeb qo'yardi (sinovda 17 soniya).
      const nowGaps = totalGaps();
      if (nowGaps < bestGaps) { bestGaps = nowGaps; bestSnap = snapshot(); }
      if (nowGaps < lastGaps) { lastGaps = nowGaps; stall = 0; continue; }
      stall += 1;
      // Hech narsa qimirlamagan bo'lsa silkitishning ham foydasi kam
      if (!any && stall >= 2) break;
      if (stall >= 3 || Date.now() > hardStop) break;
      kick(3 + stall * 4);
      lastGaps = totalGaps();
    }
    // Sikl silkitishdan keyin yomonroq holatda tugagan bo'lishi mumkin —
    // ekranga HAR DOIM eng yaxshi variant chiqadi.
    if (totalGaps() > bestGaps) restoreSnap(bestSnap);
  }

  // ——— Yangi jadvalni yig'amiz ———
  const out = {};
  DAYS.forEach((day) => {
    out[day] = {};
    allTs.forEach((ts) => { out[day][ts.id] = []; });
  });
  DAYS.forEach((day) => {
    allTs.forEach((ts) => {
      if (isTeachingSlot(ts)) return;
      const cell = schedule?.[day]?.[ts.id];
      if (Array.isArray(cell) && cell.length) out[day][ts.id] = [...cell];
    });
  });
  units.forEach((u) => {
    const day = DAYS[u.d];
    u.parts.forEach((entries, o) => {
      const ts = teachingTs[uSlotAt(u, o)];
      if (!ts) return;
      entries.forEach((e) => out[day][ts.id].push(e));
    });
  });
  return out;
}

// ——————————————————————————————————————————————————————————————
// KO'P URINISHLI GENERATOR
// Har chaqiruv qisqa (1 urinish) va boshqa strategiya bilan ishlaydi.
// Shu sababli tashqi sikl (Schedule.jsx) 20–40 marta xilma-xil urinib,
// eng yaxshisini tanlay oladi.
// ——————————————————————————————————————————————————————————————

