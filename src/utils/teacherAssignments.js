// ═══════════════════════════════════════════════════════════════════
//  USTOZGA BIRIKTIRILGAN SINF + FAN JUFTLIKLARI — YAGONA MANBA
//
//  «Sinf fanlari»dagi yozuvlardan ustozning REJADAGI yuklamasini yig'adi:
//  qaysi sinfda, qaysi fanni, necha soat va qanday rolda (asosiy, 2-guruh,
//  almashinuv, daraja guruhi, «2 fan birga»).
//
//  ⚠️ Ilgari bu mantiq TeacherGrid.jsx ichida edi. Ustoz setkasining Excel
//  eksporti ham AYNI ro'yxatni ko'rsatishi kerak — nusxa ko'chirilsa ikkisi
//  vaqt o'tib ajralib ketardi (CLAUDE.md dagi «soat sanog'i bir joyda»
//  qoidasi). Shuning uchun mantiq shu faylga chiqarildi.
//
//  ⚠️ Almashinuv (`swapEnabled`) ustozlarini QO'LDA o'qimang — `swapGroups.js`
//  yordamchilari ishlatiladi; guruh fanlari ham `pairGroups.js` orqali.
// ═══════════════════════════════════════════════════════════════════
import { DAYS } from "./constants";
import { pairSideGroups } from "./pairGroups";
import { swapTeacherIds } from "./swapGroups";

/** Dars yozuvidagi barcha sinflar */
function lessonClassIds(lesson) {
  return Array.isArray(lesson?.classIds) ? lesson.classIds : [lesson?.classId].filter(Boolean);
}

/**
 * Ustozning reja bo'yicha sinf+fan qatorlari.
 * Har element: { classId, className, subjectId, subjectName, need, roomId, roles[], simple }
 *   need   — haftalik soat (rejada)
 *   roles  — ustozning shu qatordagi roli(lari)
 *   simple — oddiy dars (guruh/daraja/almashinuvsiz): qo'lda qo'shishga yaroqli
 */
export function teacherAssignments({ teacherId, classes = [], classSubjects = {}, subjects = [] }) {
  if (!teacherId) return [];
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));
  const out = [];

  classes.forEach((cls) => {
    (classSubjects?.[cls.id] || []).forEach((a) => {
      if (!a?.subjectId) return;

      // Bir vaqtda bir nechta fan — 2-, 3-, 4-guruh ustozi o'z fani bilan
      // alohida qator bo'lib chiqadi
      if (a.pairEnabled) {
        const own = pairSideGroups(a).find((g) => g.teacherId === teacherId);
        if (own) {
          out.push({
            classId: cls.id,
            className: cls.name,
            subjectId: own.subjectId,
            subjectName: subjectMap.get(own.subjectId)?.name || "Fan",
            need: Number(a.weeklyHours || 0),
            roomId: own.roomId || "",
            roles: ["2 fan birga"],
            simple: false,
          });
          return;
        }
      }

      const roles = [];
      if (a.teacherId === teacherId) roles.push("asosiy");
      if (a.teacherId2 === teacherId) roles.push("2-guruh");
      // Almashinuvda 2-soat ustozi boshqa bo'lishi mumkin — u ham shu qatorda
      if (a.swapEnabled && a.teacherId !== teacherId && swapTeacherIds(a).includes(teacherId)) roles.push("almashinuv");
      if (a.weekAltEnabled && a.weekAltTeacherId === teacherId) roles.push("juft/toq");
      if (a.pairEnabled && a.teacherId === teacherId) roles.push("2 fan birga");
      if ((a.levelGroups || []).some((g) => g.teacherId === teacherId)) roles.push("daraja guruhi");
      if (!roles.length) return;

      const simple = a.teacherId === teacherId && !a.levelGroupEnabled && !a.splitEnabled && !a.swapEnabled;
      out.push({
        classId: cls.id,
        className: cls.name,
        subjectId: a.subjectId,
        subjectName: subjectMap.get(a.subjectId)?.name || "Fan",
        need: Number(a.weeklyHours || 0),
        roomId: a.roomId || "",
        roles,
        simple,
      });
    });
  });

  return out.sort((a, b) => String(a.className).localeCompare(String(b.className), "uz", { numeric: true }));
}

/**
 * Tayyor jadvalda shu sinf + fan bo'yicha joylashgan soat.
 * Ustoz bo'yicha emas, SINF setkasi bo'yicha sanaladi (bo'linган guruhlar
 * bitta katakda tursa ham bir soat).
 */
export function placedSubjectHours(schedule = {}, timeslots = [], classId, subjectId) {
  let n = 0;
  DAYS.forEach((day) => {
    timeslots.forEach((slot) => {
      const cell = schedule?.[day]?.[slot.id];
      if (Array.isArray(cell) && cell.some((l) => l.subjectId === subjectId && lessonClassIds(l).includes(classId))) n += 1;
    });
  });
  return n;
}
