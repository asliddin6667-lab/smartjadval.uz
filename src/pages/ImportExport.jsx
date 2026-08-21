import { useRef, useState } from 'react';
import { genId } from '../utils/helpers';
import { loadXLSX, splitNames, normalizeText, findByName, makeSubject, worksheetToRows, downloadWorkbook } from '../utils/excelUtils';
import { exportColoredSchedule } from '../utils/coloredScheduleExport';
import { exportAnalysisExcel } from '../utils/analysisExport';
import { exportHourGridExcel } from '../utils/hourGridExport';

function teacherSubjectIds(teacher) {
  return Array.isArray(teacher.subjectIds) ? teacher.subjectIds : (teacher.subjectId ? [teacher.subjectId] : []);
}

function safeFileDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function ImportExportPage({
  classes, subjects, setSubjects,
  teachers, setTeachers,
  rooms, timeslots, lunchGroups, schedule,
  classSubjects = {},
  settings = {},
  schoolName = '',
  toast,
}) {
  const teacherFileRef = useRef(null);
  const [importing, setImporting] = useState(false);

  async function downloadTeacherTemplate() {
    try {
      const XLSX = await loadXLSX();
      downloadWorkbook(XLSX, [{
        name: "O'qituvchilar",
        rows: [
          {
            "Ism familiya": "Aliyev Ali",
            "Fanlar": "Matematika, Algebra",
            "Telefon": "+998 90 000 00 00",
            "Maksimal haftalik soat": 28,
            "Status": "Bo'sh",
          },
          {
            "Ism familiya": "Karimova Malika",
            "Fanlar": "Ingliz tili, Rus tili",
            "Telefon": "+998 91 000 00 00",
            "Maksimal haftalik soat": 24,
            "Status": "Bo'sh",
          },
        ],
      }], `oqituvchilar_shablon_${safeFileDate()}.xlsx`);
      toast("O'qituvchi shabloni yuklandi ✓", 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function importTeachers(file) {
    if (!file) return;
    setImporting(true);
    try {
      const XLSX = await loadXLSX();
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = worksheetToRows(XLSX, ws);
      if (!rows.length) {
        toast('Excel faylda ma\'lumot topilmadi', 'warning');
        return;
      }

      let nextSubjects = [...subjects];
      const nextTeachers = [...teachers];
      let addedTeachers = 0;
      let updatedTeachers = 0;
      let addedSubjects = 0;

      rows.forEach((row, rowIndex) => {
        const name = normalizeText(row["Ism familiya"] || row["F.I.Sh"] || row["O'qituvchi"] || row["Ustoz"] || row["Name"]);
        if (!name) return;

        const subjectNames = splitNames(row["Fanlar"] || row["Fan"] || row["Subjects"] || row["Subject"]);
        const subjectIds = [];
        subjectNames.forEach(subjectName => {
          let subject = findByName(nextSubjects, subjectName);
          if (!subject) {
            subject = makeSubject(subjectName, nextSubjects.length + rowIndex);
            nextSubjects.push(subject);
            addedSubjects += 1;
          }
          subjectIds.push(subject.id);
        });

        const maxWeeklyHours = Number(row["Maksimal haftalik soat"] || row["Max soat"] || row["MaxWeeklyHours"] || 28) || 28;
        const phone = normalizeText(row["Telefon"] || row["Phone"] || '');
        const status = normalizeText(row["Status"] || "Bo'sh") || "Bo'sh";
        const existing = findByName(nextTeachers, name);

        if (existing) {
          existing.subjectIds = [...new Set([ ...teacherSubjectIds(existing), ...subjectIds ])];
          existing.subjectId = existing.subjectIds[0] || existing.subjectId || '';
          existing.phone = phone || existing.phone || '';
          existing.maxWeeklyHours = maxWeeklyHours;
          existing.status = status;
          updatedTeachers += 1;
        } else {
          nextTeachers.push({
            id: genId(),
            name,
            subjectIds: [...new Set(subjectIds)],
            subjectId: subjectIds[0] || '',
            phone,
            maxWeeklyHours,
            status,
            createdAt: Date.now(),
          });
          addedTeachers += 1;
        }
      });

      setSubjects(nextSubjects);
      setTeachers(nextTeachers);
      toast(`${addedTeachers} ta o'qituvchi qo'shildi, ${updatedTeachers} ta yangilandi, ${addedSubjects} ta fan yaratildi ✓`, 'success');
    } catch (e) {
      toast(e.message || 'Excel importda xatolik', 'error');
    } finally {
      setImporting(false);
      if (teacherFileRef.current) teacherFileRef.current.value = '';
    }
  }

  async function exportTeachers() {
    try {
      const XLSX = await loadXLSX();
      const rows = teachers.map(t => ({
        "Ism familiya": t.name,
        "Fanlar": teacherSubjectIds(t).map(id => subjects.find(s => s.id === id)?.name).filter(Boolean).join(', '),
        "Telefon": t.phone || '',
        "Maksimal haftalik soat": t.maxWeeklyHours || 28,
        "Status": t.status || "Bo'sh",
      }));
      downloadWorkbook(XLSX, [{ name: "O'qituvchilar", rows: rows.length ? rows : [{ "Ism familiya": '', "Fanlar": '', "Telefon": '', "Maksimal haftalik soat": '', "Status": '' }] }], `oqituvchilar_${safeFileDate()}.xlsx`);
      toast("O'qituvchilar Excelga yuklandi ✓", 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // Jadval eksporti — umumiy modulga o'tkazildi (coloredScheduleExport.js).
  // Format: bo'sh soat qatorlari chiqmaydi, kunlar ajratuvchi qator bilan
  // ajratiladi, kun nomlari katta shriftda.
  // mono = true — aynan shu jadvalning rangsiz (oq-qora) nusxasi.
  async function exportColoredMatrix(mono = false) {
    await exportColoredSchedule({
      classes, subjects, teachers, rooms, timeslots, lunchGroups, schedule, toast, mono,
      schoolName: settings.schoolName || schoolName,
      academicYear: settings.academicYear,
    });
  }

  // Jadval tahlili eksporti — 2 varaq: sinflar bo'yicha (Fan/Joylashgan/Kerakli/Holat)
  // va o'qituvchilar bo'yicha (soat, yuklama %, holat).
  async function exportAnalysis() {
    await exportAnalysisExcel({
      classes, subjects, teachers, timeslots, schedule, classSubjects, toast,
    });
  }

  // Dars soat setkasi — fan × sinf matritsasi (tuman admin varag'i bilan bir xil).
  // Sarlavhadagi maktab nomi Sozlamalar sahifasidan (settings.schoolName) olinadi.
  async function exportHourGrid() {
    await exportHourGridExcel({
      classes, subjects, classSubjects, settings, schoolName, toast,
    });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Excel import / export</div>
          <div className="page-subtitle">O'qituvchilarni Excel orqali kiritish va dars jadvalini Excelga yuklash</div>
        </div>
      </div>

      <div className="page-body">
        <div className="alert alert-info">
          ℹ️ Excel fayllarini o'qish/yozish uchun SheetJS ishlatiladi. Internet bo'lmasa terminalda: <b>npm install xlsx</b>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div className="card"><div className="card-body">
            <div style={{ fontSize: 28, marginBottom: 10 }}>👩‍🏫</div>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>O'qituvchilar importi</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Excel ustunlari: Ism familiya, Fanlar, Telefon, Maksimal haftalik soat, Status.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={downloadTeacherTemplate}>⬇️ Shablon</button>
              <button className="btn btn-primary" onClick={() => teacherFileRef.current?.click()} disabled={importing}>{importing ? '⏳ Yuklanmoqda...' : '📥 Import'}</button>
              <button className="btn btn-secondary" onClick={exportTeachers} disabled={!teachers.length}>📤 Ustozlar export</button>
              <input ref={teacherFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => importTeachers(e.target.files?.[0])} />
            </div>
          </div></div>

          <div className="card"><div className="card-body">
            <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Dars jadvalini Excelga yuklash</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Ustunlarda sinflar, kunlar alohida qator bilan ajratilgan, bo'sh soatlar chiqmaydi. Rangli variantda har bir fan o'z rangida; rangsiz variant — aynan shu jadval oq-qora holda (oddiy printer uchun).
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-success" onClick={() => exportColoredMatrix(false)}>🎨 Rangli jadval (sinflar ustun)</button>
              <button className="btn btn-secondary" onClick={() => exportColoredMatrix(true)}>🖨️ Rangsiz jadval</button>
            </div>
          </div></div>

          <div className="card"><div className="card-body">
            <div style={{ fontSize: 28, marginBottom: 10 }}>🕐</div>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Dars soat setkasi</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Fan × sinf matritsasi: har bir fanning har bir sinfdagi haftalik soati, qator va ustun jamilari bilan. Sarlavhada Sozlamalardagi maktab nomi chiqadi.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-success" onClick={exportHourGrid}>🕐 Soat setkasi (Excel)</button>
            </div>
          </div></div>

          <div className="card"><div className="card-body">
            <div style={{ fontSize: 28, marginBottom: 10 }}>📈</div>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Jadval tahlilini Excelga yuklash</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              2 varaq: sinflar bo'yicha soatlar tahlili (fan, joylashgan, kerakli, holat) va o'qituvchilar yuklamasi (soat, yuklama %, holat). Umumiy statistika bilan.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={exportAnalysis}>📈 Tahlil (Excel)</button>
            </div>
          </div></div>
        </div>
      </div>
    </div>
  );
}
