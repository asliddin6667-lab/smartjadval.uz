// ==UserScript==
// @name         TURON ERP Moslash
// @namespace    turon-erp-moslash
// @version      6.3
// @description  ERP ro'yxatini yig'adi; TURONda tanlangan bo'lim (Faol/Nofaol/Bitirgan/...) o'quvchilarini ERP bilan solishtirib ERP tugmachasini yoqadi/o'chiradi
// @match        https://erp.maktab.uz/StudentReports/StudentList*
// @match        https://turon-odob-ilm.xususiy-maktab.uz/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @noframes
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js
// ==/UserScript==

(function () {
    'use strict';

    // Yashirin iframe ichida (yoki ikki marta) ishga tushmaslik
    if (window.top !== window.self) return;
    if (window.__temLoaded) return;
    window.__temLoaded = true;
    document.querySelectorAll('.tem-panel, #tem-style, iframe.tem-iframe').forEach(el => el.remove());

    // ================= SOZLAMALAR =================
    const SOZ = {
        SAHIFA_KUT: 100,      // o'qishda sahifa guruhlari orasidagi kutish (ms)
        PARALLEL: 6,          // bir vaqtda o'qiladigan sahifalar soni
        BOSISH_KUT: 450,      // tugmacha bosishlar orasidagi kutish — so'rov kuzatilmasa (ms)
        TARMOQ_KUT: 6000,     // bosishdan keyin server so'rovi tugashini kutish chegarasi (ms)
        SAQLASH_KUT: 2000,    // server saqlashini kutish — so'rov kuzatilmasa (ms)
        SAQLASH_QISQA: 400,   // so'rovlar tugagani kuzatilgan bo'lsa tekshiruvdan oldingi kutish (ms)
        IFRAME_PARALLEL: 3,   // bir vaqtda ishlaydigan yashirin oynalar soni
        IFRAME_KUT: 25000,    // iframe yuklanishini kutish (ms)
        MIN_SCORE: 85,        // faqat ism bo'yicha moslik chegarasi (%)
        SANA_ISM_MIN: 70,     // tug'ilgan sana bir xil bo'lsa ism uchun chegara (%)
        SHUBHA_FARQ: 3,       // 1- va 2-nomzod orasidagi farq shundan kam bo'lsa — shubhali
        HAJM: 500,            // bitta sahifada so'raladigan qatorlar soni
        HAJM_NOMLARI: ['per_page', 'perPage', 'limit', 'page_size', 'pageSize', 'paginate', 'per-page', 'size', 'count', 'rows'],
        MAX_SAHIFA: 400,
    };
    const STUDENTS_PATH = '/head-office/students';
    const KEYS = {
        erp: 'erp_students', erpMeta: 'erp_meta', ui: 'tem_ui',
        natija: 'tem_natija', nav: 'tem_nav', hajm: 'tem_hajm', statuslar: 'tem_statuslar',
    };

    // ================= TO'XTATISH =================
    class ToxtashXato extends Error { constructor(m) { super(m || "To'xtatildi"); this.toxtash = true; } }
    const HOLAT = { ish: false, toxtat: false, ac: null, radEt: null };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    function chk() { if (HOLAT.toxtat) throw new ToxtashXato(); }
    async function kut(ms) { for (let w = 0; w < ms; w += 200) { await sleep(Math.min(200, ms - w)); chk(); } }
    function toxtashmi(e) { return HOLAT.toxtat || !!(e && (e.toxtash || e.name === 'AbortError')); }

    // ================= ISM SOLISHTIRISH =================
    const CYR = {
        'ў': "o'", 'ғ': "g'", 'ш': 'sh', 'ч': 'ch', 'я': 'ya', 'ю': 'yu', 'ё': 'yo', 'ц': 'ts', 'щ': 'sh',
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ж': 'j', 'з': 'z', 'и': 'i', 'й': 'y',
        'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
        'ф': 'f', 'х': 'x', 'ҳ': 'h', 'қ': 'q', 'э': 'e', 'ъ': '', 'ь': ''
    };
    const KALIT_TASHLA = new Set(['qizi', 'ogli', 'ugli', 'o', 'g']);

    function normalize(name) {
        let s = String(name || '').toLowerCase().trim();
        s = s.split('').map(ch => CYR[ch] !== undefined ? CYR[ch] : ch).join('');
        s = s.replace(/[’'`ʻʼ‘´]/g, '');
        s = s.replace(/sh/g, 'ş').replace(/ch/g, 'ç');
        s = s.replace(/h/g, 'x');
        s = s.replace(/ş/g, 'sh').replace(/ç/g, 'ch');
        s = s.replace(/iye/g, 'ie');
        s = s.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
        return s.split(' ').filter(t => t && !KALIT_TASHLA.has(t)).sort().join(' ');
    }

    function levRatio(a, b) {
        const m = a.length, n = b.length;
        if (!m || !n) return 0;
        const maxLen = Math.max(m, n);
        if ((maxLen - Math.min(m, n)) / maxLen > 0.45) return (1 - Math.abs(m - n) / maxLen) * 60;
        let prev = new Array(n + 1), cur = new Array(n + 1);
        for (let j = 0; j <= n; j++) prev[j] = j;
        for (let i = 1; i <= m; i++) {
            cur[0] = i;
            const ca = a.charCodeAt(i - 1);
            for (let j = 1; j <= n; j++)
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1));
            const t = prev; prev = cur; cur = t;
        }
        return (1 - prev[n] / maxLen) * 100;
    }

    function simNorm(na, nb) {
        if (!na || !nb) return 0;
        if (na === nb) return 100;
        const ta = na.split(' '), tb = nb.split(' ');
        let sum = 0;
        for (const t1 of ta) {
            let best = 0;
            for (const t2 of tb) { const r = levRatio(t1, t2); if (r > best) best = r; if (best >= 100) break; }
            sum += best;
        }
        const tokenScore = ta.length ? sum / ta.length : 0;
        if (tokenScore >= 95) return tokenScore;
        // Qisqa ism uzunining ichida to'liq bo'lsa («Aliyev Ali» ⊂ «Aliyev Ali Valiyevich») — 97% gacha
        if (ta.length !== tb.length) {
            const sh = ta.length < tb.length ? ta : tb, lo = ta.length < tb.length ? tb : ta;
            if (sh.length >= 2) {
                let mn = 100;
                for (const t of sh) { let best = 0; for (const t2 of lo) { const r = levRatio(t, t2); if (r > best) best = r; } if (best < mn) mn = best; }
                if (mn >= 90) return Math.max(tokenScore, mn * 0.97);
            }
        }
        return Math.max(levRatio(na, nb), tokenScore);
    }

    // '12.02.2022' / '2022-02-12' -> '20220212'
    function birthKey(s) {
        s = String(s || '').trim();
        let m = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s);
        if (m) return m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0');
        m = /(\d{1,2})[-./](\d{1,2})[-./](\d{4})/.exec(s);
        if (m) return m[3] + m[2].padStart(2, '0') + m[1].padStart(2, '0');
        const d = s.replace(/\D/g, '');
        return d.length === 8 ? d : '';
    }

    // ================= MATN AJRATISH (jonli DOM va DOMParser uchun bir xil) =================
    const BLOCK = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'TR', 'TD', 'TH', 'SMALL']);
    function cellLines(cell) {
        const out = []; let cur = '';
        const push = () => { const t = cur.replace(/\s+/g, ' ').trim(); if (t) out.push(t); cur = ''; };
        (function walk(n) {
            for (const c of n.childNodes) {
                if (c.nodeType === 3) { cur += c.nodeValue; continue; }
                if (c.nodeType !== 1) continue;
                const tag = c.tagName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'SVG') continue;
                if (tag === 'BR') { push(); continue; }
                const blk = BLOCK.has(tag) || /badge|chip/i.test(c.getAttribute('class') || '');
                if (blk) push();
                walk(c);
                if (blk) push();
            }
        })(cell);
        push();
        return out;
    }
    const cellText = cell => cell ? cellLines(cell).join(' ').replace(/\s+/g, ' ').trim() : '';
    const KOD_RE = /STD[-\s]?\d{4}[-\s]?\d+/i;
    const FILIAL_RE = /turon[^|\n]*\|[^\n]*/i;

    function extractKod(lines) {
        for (const l of lines) { const m = KOD_RE.exec(l); if (m) return m[0].toUpperCase().replace(/\s/g, ''); }
        return '';
    }
    function extractFilial(lines) {
        const l = lines.find(x => FILIAL_RE.test(x));
        if (!l) return { filial: '', filialTola: '' };
        const parts = FILIAL_RE.exec(l)[0].split('|').map(s => s.trim()).filter(Boolean);
        return { filial: parts[1] || parts[0] || '', filialTola: parts.slice(1).join(' | ') || parts[0] || '' };
    }
    function extractName(lines) {
        const toza = lines.map(l => l.replace(KOD_RE, ' ').replace(FILIAL_RE, ' ').replace(/\s+/g, ' ').trim());
        const good = toza.find(l => l.split(' ').length >= 2 && l.length > 5);
        if (good) return good;
        return toza.slice().sort((a, b) => b.length - a.length)[0] || '';
    }

    function findTableIn(root) {
        for (const table of root.querySelectorAll('table')) {
            let hs = table.querySelectorAll('thead th, thead td');
            if (!hs.length) hs = table.querySelectorAll('tr:first-child th');
            const heads = [...hs].map(h => (h.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase());
            const erpIdx = heads.findIndex(h => h === 'ERP');
            const nameIdx = heads.findIndex(h => h.includes('QUVCHI'));
            if (erpIdx < 0 || nameIdx < 0) continue;
            return {
                table, erpIdx, nameIdx,
                sinfIdx: heads.findIndex(h => h.includes('SINF')),
                tugIdx: heads.findIndex(h => h.includes('TUG')),
                statusIdx: heads.findIndex(h => h === 'STATUS' || h.includes('HOLAT')),
            };
        }
        return null;
    }
    const toggleTop = (doc, sid) =>
        doc.querySelector('input.erp-toggle[data-student-id="' + sid + '"]')
        || doc.querySelector('input[type="checkbox"][data-student-id="' + sid + '"]');

    // ================= PANEL (surish, o'lcham, masshtab, yig'ish) =================
    const CSS = `
.tem-panel{position:fixed;z-index:2147483000;right:18px;bottom:18px;width:420px;min-width:300px;min-height:120px;max-width:96vw;max-height:94vh;display:flex;flex-direction:column;background:linear-gradient(160deg,#111827 0%,#0b1220 100%);color:#e5e7eb;border:1px solid rgba(148,163,184,.18);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.55),0 0 0 1px rgba(99,102,241,.18);--fs:13px;font-size:var(--fs);font-family:Inter,"Segoe UI",system-ui,sans-serif;line-height:1.45;user-select:none;overflow:hidden}
.tem-panel *{box-sizing:border-box}
.tem-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(90deg,#4f46e5,#7c3aed);cursor:move;touch-action:none;flex:none}
.tem-head .tem-title{font-weight:700;font-size:1.05em;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff}
.tem-dot{width:10px;height:10px;border-radius:50%;background:#94a3b8;box-shadow:0 0 0 3px rgba(255,255,255,.15);flex:none}
.tem-dot.run{background:#22c55e;animation:tem-pulse 1s infinite}
.tem-dot.err{background:#ef4444}
.tem-dot.ok{background:#22c55e}
@keyframes tem-pulse{0%,100%{opacity:1}50%{opacity:.3}}
.tem-ib{background:rgba(255,255,255,.16);border:0;color:#fff;min-width:26px;height:26px;border-radius:7px;cursor:pointer;font:600 12px/1 inherit;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;padding:0 6px;margin:0}
.tem-ib:hover{background:rgba(255,255,255,.3)}
.tem-body{padding:12px;display:flex;flex-direction:column;gap:10px;overflow:auto;flex:1;min-height:0}
.tem-card{background:rgba(255,255,255,.045);border:1px solid rgba(148,163,184,.14);border-radius:12px;padding:10px 12px;flex:none}
.tem-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:none}
.tem-label{font-size:.82em;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;font-weight:600}
.tem-select{width:100%;background:#0f172a;color:#f1f5f9;border:1px solid rgba(148,163,184,.3);border-radius:9px;padding:8px 10px;font:inherit;cursor:pointer;outline:none}
.tem-select:focus{border-color:#8b5cf6}
.tem-btn{border:0;border-radius:10px;padding:9px 12px;font:inherit;font-weight:600;color:#fff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:transform .08s,filter .15s;flex:1;margin:0;line-height:1.2}
.tem-btn:hover{filter:brightness(1.12)} .tem-btn:active{transform:scale(.98)}
.tem-btn:disabled{opacity:.45;cursor:not-allowed;filter:none;transform:none}
.tem-p{background:linear-gradient(90deg,#6366f1,#8b5cf6)} .tem-g{background:linear-gradient(90deg,#16a34a,#22c55e)}
.tem-r{background:linear-gradient(90deg,#dc2626,#ef4444)} .tem-b{background:linear-gradient(90deg,#0284c7,#0ea5e9)} .tem-s{background:#334155}
.tem-chk{display:flex;gap:8px;align-items:center;cursor:pointer;color:#cbd5e1;margin:0}
.tem-chk input{accent-color:#8b5cf6;width:16px;height:16px;margin:0}
.tem-status{color:#e2e8f0;flex:none}
.tem-prog{height:8px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden;flex:none}
.tem-prog>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#22d3ee,#8b5cf6);transition:width .25s}
.tem-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;flex:none}
.tem-stat{background:rgba(255,255,255,.05);border-radius:10px;padding:6px 4px;text-align:center}
.tem-stat b{display:block;font-size:1.25em;line-height:1.2} .tem-stat span{font-size:.78em;color:#94a3b8}
.tem-log{font-family:ui-monospace,Consolas,monospace;font-size:.88em;line-height:1.4;background:#020617;border:1px solid rgba(148,163,184,.12);border-radius:10px;padding:8px;flex:1 1 130px;min-height:90px;overflow:auto;user-select:text;white-space:pre-wrap;word-break:break-word}
.tem-log .ok{color:#4ade80}.tem-log .warn{color:#facc15}.tem-log .err{color:#f87171}.tem-log .dim{color:#64748b}
.tem-grip{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,rgba(148,163,184,.6) 50%,rgba(148,163,184,.6) 58%,transparent 58%,transparent 72%,rgba(148,163,184,.6) 72%,rgba(148,163,184,.6) 80%,transparent 80%)}
.tem-panel.min .tem-body,.tem-panel.min .tem-grip{display:none}
.tem-panel.min{width:auto!important;height:auto!important;min-height:0;min-width:0}
.tem-table{width:100%;border-collapse:collapse;font-size:.9em}
.tem-table th,.tem-table td{padding:4px 6px;border-bottom:1px solid rgba(148,163,184,.12);text-align:left;white-space:nowrap}
.tem-table th{color:#94a3b8;font-weight:600}
.tem-table td.n{text-align:right}
.tem-warn{background:rgba(250,204,21,.12);border:1px solid rgba(250,204,21,.35);color:#fde68a;border-radius:10px;padding:8px 10px;flex:none}
.tem-err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);color:#fecaca;border-radius:10px;padding:8px 10px;flex:none}
`;

    const uiOl = () => GM_getValue(KEYS.ui, {}) || {};
    const uiSaqla = p => GM_setValue(KEYS.ui, Object.assign({}, uiOl(), p));

    function makePanel(title) {
        const st = document.createElement('style'); st.id = 'tem-style'; st.textContent = CSS;
        document.head.appendChild(st);
        const box = document.createElement('div');
        box.className = 'tem-panel';
        box.innerHTML = `
            <div class="tem-head" id="tem-head" title="Surish: sudrang · Asl holat: 2 marta bosing">
                <span class="tem-dot" id="tem-dot"></span>
                <span class="tem-title">${title}</span>
                <button class="tem-ib" id="tem-zm" title="Yozuvni kichraytirish">A−</button>
                <button class="tem-ib" id="tem-zp" title="Yozuvni kattalashtirish">A+</button>
                <button class="tem-ib" id="tem-min" title="Yig'ish / yoyish">–</button>
            </div>
            <div class="tem-body" id="tem-body"></div>
            <div class="tem-grip" id="tem-grip" title="O'lchamini o'zgartirish"></div>`;
        document.body.appendChild(box);

        const ui = uiOl();
        const joyla = (l, t) => { box.style.left = l + 'px'; box.style.top = t + 'px'; box.style.right = 'auto'; box.style.bottom = 'auto'; };
        if (ui.fs) box.style.setProperty('--fs', ui.fs + 'px');
        if (ui.w) box.style.width = ui.w + 'px';
        if (ui.h) box.style.height = ui.h + 'px';
        if (ui.left != null && ui.top != null) joyla(ui.left, ui.top);
        const minBtn = box.querySelector('#tem-min');
        if (ui.min) { box.classList.add('min'); minBtn.textContent = '+'; }

        function clamp() {
            const r = box.getBoundingClientRect();
            let l = r.left, t = r.top;
            if (l + 80 > innerWidth) l = innerWidth - 80;
            if (t + 40 > innerHeight) t = innerHeight - 40;
            if (l < 0) l = 0; if (t < 0) t = 0;
            if (l !== r.left || t !== r.top) joyla(l, t);
        }
        clamp();
        window.addEventListener('resize', clamp);

        minBtn.addEventListener('click', () => {
            box.classList.toggle('min');
            const m = box.classList.contains('min');
            minBtn.textContent = m ? '+' : '–';
            uiSaqla({ min: m });
        });
        const zoom = d => {
            const cur = parseFloat(getComputedStyle(box).getPropertyValue('--fs')) || 13;
            const fs = Math.min(20, Math.max(10, cur + d));
            box.style.setProperty('--fs', fs + 'px');
            uiSaqla({ fs });
        };
        box.querySelector('#tem-zm').addEventListener('click', () => zoom(-1));
        box.querySelector('#tem-zp').addEventListener('click', () => zoom(1));

        // sudrab surish (sichqoncha + sensor)
        const head = box.querySelector('#tem-head');
        head.addEventListener('pointerdown', e => {
            if (e.target.closest('button')) return;
            const r = box.getBoundingClientRect();
            joyla(r.left, r.top);
            const dx = e.clientX - r.left, dy = e.clientY - r.top;
            try { head.setPointerCapture(e.pointerId); } catch (err) { }
            const mv = ev => joyla(Math.min(innerWidth - 60, Math.max(0, ev.clientX - dx)), Math.min(innerHeight - 30, Math.max(0, ev.clientY - dy)));
            const up = () => {
                head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up);
                const rr = box.getBoundingClientRect(); uiSaqla({ left: rr.left, top: rr.top });
            };
            head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
            e.preventDefault();
        });
        head.addEventListener('dblclick', e => {
            if (e.target.closest('button')) return;
            box.style.cssText = ''; box.classList.remove('min'); minBtn.textContent = '–';
            GM_setValue(KEYS.ui, {});
        });

        // o'lchamini o'zgartirish (pastki o'ng burchak)
        const grip = box.querySelector('#tem-grip');
        grip.addEventListener('pointerdown', e => {
            const r = box.getBoundingClientRect();
            joyla(r.left, r.top);
            const sx = e.clientX, sy = e.clientY, sw = r.width, sh = r.height;
            try { grip.setPointerCapture(e.pointerId); } catch (err) { }
            const mv = ev => {
                const w = Math.max(300, Math.min(innerWidth - r.left - 4, sw + ev.clientX - sx));
                const h = Math.max(140, Math.min(innerHeight - r.top - 4, sh + ev.clientY - sy));
                box.style.width = w + 'px'; box.style.height = h + 'px';
            };
            const up = () => {
                grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
                const rr = box.getBoundingClientRect(); uiSaqla({ w: Math.round(rr.width), h: Math.round(rr.height) });
            };
            grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
            e.preventDefault();
        });
        return box;
    }

    let statusEl = null, logEl = null, dotEl = null, progEl = null;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const setStatus = html => { if (statusEl) statusEl.innerHTML = html; };
    const setDot = c => { if (dotEl) dotEl.className = 'tem-dot' + (c ? ' ' + c : ''); };
    function setProg(a, b) {
        if (!progEl) return;
        progEl.style.display = b ? '' : 'none';
        progEl.firstElementChild.style.width = (b ? Math.min(100, Math.round(100 * a / b)) : 0) + '%';
    }
    function log(msg, cls) {
        msg = String(msg); console.log('[TEM]', msg.replace(/<[^>]+>/g, ''));
        if (!logEl) return;
        const d = document.createElement('div');
        if (cls) d.className = cls;
        d.innerHTML = `<span class="dim">${new Date().toLocaleTimeString().slice(0, 5)}</span> ${msg}`;
        logEl.appendChild(d);
        while (logEl.childElementCount > 500) logEl.removeChild(logEl.firstChild);
        logEl.scrollTop = logEl.scrollHeight;
    }
    window.addEventListener('error', e => {
        if (!/tem|turon-erp/i.test(String(e.filename || '')) && !String(e.message || '').includes('TEM')) return;
        log('❌ Xato: ' + esc(e.message), 'err');
    });

    function toxtat() {
        if (!HOLAT.ish) return;
        HOLAT.toxtat = true;
        if (HOLAT.ac) { try { HOLAT.ac.abort(); } catch (e) { } }
        if (HOLAT.radEt) { try { HOLAT.radEt(new ToxtashXato()); } catch (e) { } }
        GM_setValue(KEYS.nav, null);
        document.querySelectorAll('iframe.tem-iframe').forEach(fr => { try { fr.src = 'about:blank'; } catch (e) { } });
        log("⏹ To'xtatish so'raldi — joriy amal yakunlanib to'xtaydi…", 'warn');
    }

    // ================= UMUMIY: qatorlar/paginatsiya (ERP sahifasi uchun) =================
    function realClick(el) {
        try {
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
        } catch (e) { }
        ['mousedown', 'mouseup'].forEach(type => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })));
        try { if (typeof el.click === 'function') el.click(); } catch (e) { }
    }
    function visible(el) {
        return el.offsetParent !== null
            && !el.closest('.disabled') && !el.classList.contains('disabled')
            && el.getAttribute('aria-disabled') !== 'true';
    }
    const rowCount = () => document.querySelectorAll('table tbody tr').length;
    const sig = () => { const tr = document.querySelector('table tbody tr'); return tr ? tr.innerText : ''; };

    async function loadAllRows() {
        const lastTr = () => { const trs = document.querySelectorAll('table tbody tr'); return trs[trs.length - 1]; };
        let prev = -1, stable = 0;
        while (stable < 3) {
            chk();
            const tr = lastTr();
            if (tr) tr.scrollIntoView({ block: 'end' });
            let el = tr ? tr.closest('div') : null;
            while (el) {
                if (el.scrollHeight > el.clientHeight + 10) el.scrollTop = el.scrollHeight;
                el = el.parentElement;
            }
            window.scrollTo(0, document.body.scrollHeight);
            await sleep(350);
            const c = rowCount();
            if (c === prev) stable++; else { stable = 0; prev = c; }
        }
    }

    function nextBtn(currentPage) {
        const els = [...document.querySelectorAll('a,button,li,span,i,div')].filter(visible);
        const byChevron = els.find(el => {
            const t = el.innerText.trim();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            return t === '›' || t === '❯' || t === '→'
                || el.getAttribute('rel') === 'next'
                || aria.includes('next') || aria.includes('keyingi') || aria.includes('след');
        });
        if (byChevron) return byChevron.closest('a,button') || byChevron;
        const nums = els.filter(el => /^\d+$/.test(el.innerText.trim()) && el.innerText.trim().length < 4
            && ['A', 'BUTTON', 'LI', 'SPAN'].includes(el.tagName));
        const act = nums.find(el => el.classList.contains('active') || el.closest('.active') || el.getAttribute('aria-current'));
        const want = String((act ? Number(act.innerText.trim()) : currentPage) + 1);
        const target = nums.find(el => el.innerText.trim() === want);
        return target ? (target.closest('a,button') || target) : null;
    }

    // ================= 1-QISM: ERP (yig'ish) =================
    if (location.hostname === 'erp.maktab.uz') {
        const box = makePanel("1-bosqich · ERP ro'yxatini yig'ish");
        const body = box.querySelector('#tem-body');
        body.innerHTML = `
            <div class="tem-card">
                <div class="tem-label">ERP bazasi (skript xotirasi)</div>
                <div class="tem-status" id="tem-status"></div>
            </div>
            <div class="tem-row">
                <button class="tem-btn tem-g" id="tem-add">➕ Shu sahifani qo'shish</button>
            </div>
            <div class="tem-row">
                <button class="tem-btn tem-p" id="tem-collect">📥 Barcha sahifalarni yig'ish</button>
                <button class="tem-btn tem-r" id="tem-stop" style="display:none">⏹ To'xtatish</button>
            </div>
            <div class="tem-row">
                <button class="tem-btn tem-s" id="tem-clear">🗑 Ro'yxatni tozalash</button>
            </div>
            <div class="tem-prog" id="tem-prog" style="display:none"><i></i></div>
            <div class="tem-log" id="tem-log"></div>`;
        statusEl = body.querySelector('#tem-status');
        logEl = body.querySelector('#tem-log');
        dotEl = box.querySelector('#tem-dot');
        progEl = body.querySelector('#tem-prog');

        // «Ma'lumotlar 1 dan 50 gacha, jami 1234» -> 1234
        function jamiSoni() {
            const info = document.querySelector('.dataTables_info, [id$="_info"]');
            const txt = info ? info.textContent : '';
            const nums = (txt.match(/\d[\d\s,.]*/g) || []).map(x => Number(x.replace(/\D/g, ''))).filter(n => n > 0);
            return nums.length ? Math.max(...nums) : 0;
        }
        function infoKorsat(extra) {
            const list = GM_getValue(KEYS.erp, []);
            const meta = GM_getValue(KEYS.erpMeta, null) || {};
            setStatus(`Saqlangan: <b>${list.length}</b> ta` + (meta.when ? ` <span style="color:#94a3b8">(${esc(meta.when)})</span>` : '') + (extra ? '<br>' + extra : ''));
        }
        function saqla(list) {
            GM_setValue(KEYS.erp, list);
            GM_setValue(KEYS.erpMeta, { when: new Date().toLocaleString(), count: list.length, jami: jamiSoni() });
        }
        infoKorsat();

        function scrapePage(list) {
            let yangi = 0;
            document.querySelectorAll('table tbody tr').forEach(tr => {
                const tds = tr.querySelectorAll('td');
                if (tds.length < 4) return;
                const fish = tds[2].innerText.trim();
                const birth = tds[3].innerText.trim();
                if (fish && !list.some(x => x.fish === fish && x.birth === birth)) { list.push({ fish, sinf: tds[1].innerText.trim(), birth }); yangi++; }
            });
            return yangi;
        }

        async function trySetPageSize() {
            const before = rowCount();
            let touched = false;
            for (const sel of document.querySelectorAll('select')) {
                const opts = [...sel.options].map(o => o.value.trim());
                if (!opts.length || !opts.every(v => /^\d+$/.test(v))) continue;
                const o = document.createElement('option');
                o.value = '2000'; o.text = '2000';
                sel.appendChild(o);
                sel.value = '2000';
                sel.dispatchEvent(new Event('input', { bubbles: true }));
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                touched = true;
            }
            for (const inp of document.querySelectorAll('input[type="number"]')) {
                if (![10, 25, 50, 100].includes(Number(inp.value))) continue;
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(inp, '2000');
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
                touched = true;
            }
            if (!touched) return false;
            log("Sahifa hajmi 2000 ga o'zgartirilmoqda…", 'dim');
            let w = 0;
            while (rowCount() <= before && w < 15000) { await kut(500); w += 500; }
            return rowCount() > before;
        }

        const ishUi = on => {
            HOLAT.ish = on; HOLAT.toxtat = false;
            body.querySelector('#tem-stop').style.display = on ? '' : 'none';
            body.querySelector('#tem-collect').disabled = on;
            body.querySelector('#tem-add').disabled = on;
            setDot(on ? 'run' : '');
        };

        body.querySelector('#tem-add').addEventListener('click', async () => {
            ishUi(true);
            try {
                await loadAllRows();
                const list = GM_getValue(KEYS.erp, []);
                const yangi = scrapePage(list);
                saqla(list);
                infoKorsat(`➕ Qo'shildi: <b>${yangi}</b> ta. Keyingi sahifaga o'tib yana bosing.`);
                log(`➕ ${yangi} ta qo'shildi, jami ${list.length}`, 'ok');
            } catch (e) { if (!toxtashmi(e)) log('❌ ' + esc(e.message), 'err'); }
            ishUi(false);
        });

        body.querySelector('#tem-clear').addEventListener('click', () => {
            saqla([]);
            infoKorsat("Ro'yxat tozalandi.");
            log("🗑 Ro'yxat tozalandi", 'warn');
        });

        body.querySelector('#tem-stop').addEventListener('click', toxtat);

        body.querySelector('#tem-collect').addEventListener('click', async () => {
            ishUi(true);
            const list = [];
            const jami = jamiSoni();
            log(`📥 Yig'ish boshlandi${jami ? ` (jami ${jami} ta kutilmoqda)` : ''}`, 'ok');
            try {
                const bigPage = await trySetPageSize();
                if (bigPage) {
                    await loadAllRows();
                    scrapePage(list);
                    saqla(list);
                    setProg(1, 1);
                    infoKorsat(`✅ Saqlandi: <b>${list.length}</b> ta. Endi TURON sahifasiga o'ting.`);
                    log(`✅ Bitta sahifada ${list.length} ta yig'ildi`, 'ok');
                } else {
                    let page = 1;
                    while (true) {
                        chk();
                        await loadAllRows();
                        scrapePage(list);
                        saqla(list);
                        if (jami) setProg(list.length, jami);
                        infoKorsat(`Sahifa <b>${page}</b> — jami: <b>${list.length}</b> ta…`);
                        const s = sig(), nb = nextBtn(page);
                        if (!nb) break;
                        realClick(nb);
                        let w = 0;
                        while (sig() === s && w < 12000) { await kut(300); w += 300; }
                        if (sig() === s) break;
                        await kut(1200);
                        page++;
                    }
                    infoKorsat(`✅ Saqlandi: <b>${list.length}</b> ta. Endi TURON sahifasiga o'ting.`);
                    log(`✅ ${page} sahifadan ${list.length} ta yig'ildi`, 'ok');
                }
                if (jami && list.length < jami) {
                    log(`⚠️ Jami ${jami} ta bo'lishi kerak, ${list.length} ta yig'ildi — qolgan sahifalarga qo'lda o'tib «➕» ni bosing`, 'warn');
                }
            } catch (e) {
                if (toxtashmi(e)) { saqla(list); infoKorsat(`⏹ To'xtatildi. Saqlandi: <b>${list.length}</b> ta.`); log("⏹ To'xtatildi", 'warn'); }
                else { log('❌ ' + esc(e.message), 'err'); setDot('err'); }
            }
            ishUi(false);
        });
    }

    // ================= 2-QISM: TURON (bo'limlar bo'yicha solishtirish) =================
    if (location.hostname.includes('xususiy-maktab.uz')) {
        const base = location.origin + (location.pathname.endsWith('/students') ? location.pathname : STUDENTS_PATH);
        const studentsPage = location.pathname.endsWith('/students');

        function urlYasa(status, page, hajm, q) {
            const u = new URL(base);
            if (q) u.searchParams.set('q', q);
            if (status) u.searchParams.set('status', status);
            u.searchParams.set('page', String(page || 1));
            if (hajm) u.searchParams.set(hajm, String(SOZ.HAJM));
            return u.toString();
        }

        // ---- Serverdan sahifa o'qish (fetch + DOMParser) ----
        async function fetchDoc(url) {
            for (let a = 0; a < 3; a++) {
                chk();
                try {
                    const r = await fetch(url, { credentials: 'include', signal: HOLAT.ac ? HOLAT.ac.signal : undefined });
                    if (r.status === 419 || (r.redirected && /login/i.test(r.url))) throw new Error('SESSIYA');
                    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
                    if (!findTableIn(doc) && doc.querySelector('input[type="password"]')) throw new Error('SESSIYA');
                    if (!r.ok) { log(`⚠️ Server ${r.status} (${a + 1}/3) — 3 soniyadan keyin qayta…`, 'warn'); await kut(3000); continue; }
                    return doc;
                } catch (e) {
                    if (toxtashmi(e)) throw new ToxtashXato();
                    if (e.message === 'SESSIYA') throw new Error('Sessiya tugagan — Turon tizimiga qayta kiring va F5 bosing');
                    log(`⚠️ So'rov xatosi: ${esc(e.message)} (${a + 1}/3)`, 'warn');
                    await kut(3000);
                }
            }
            throw new Error('Server javob bermadi: ' + url);
        }

        function maxPageOf(doc) {
            let mx = 1;
            doc.querySelectorAll('a[href*="page="]').forEach(a => {
                const m = /[?&]page=(\d+)/.exec(a.getAttribute('href') || '');
                if (m) mx = Math.max(mx, Number(m[1]));
            });
            return mx;
        }
        const qatorSoni = doc => { const f = findTableIn(doc); return f ? f.table.querySelectorAll('tbody tr').length : 0; };

        function statuslarDan(doc) {
            const sel = doc.querySelector('select[name="status"]');
            if (!sel) return null;
            const list = [...sel.options].map(o => ({ v: o.value.trim(), t: o.textContent.trim() })).filter(o => o.v);
            return list.length ? list : null;
        }

        // Bitta sahifadagi qatorlarni o'qish; qaytaradi: sahifadagi qatorlar soni
        function qatorlarOqi(doc, s, page, rows, seen, takror) {
            const f = findTableIn(doc);
            if (!f) return -1;
            const trs = f.table.querySelectorAll('tbody tr');
            let n = 0;
            for (const tr of trs) {
                const tds = tr.querySelectorAll('td');
                if (tds.length <= Math.max(f.erpIdx, f.nameIdx)) continue;
                const lines = cellLines(tds[f.nameIdx]);
                const name = extractName(lines);
                if (!name) continue;
                n++;
                const inp = tds[f.erpIdx].querySelector('input.erp-toggle') || tds[f.erpIdx].querySelector('input[type="checkbox"]');
                const sid = inp ? (inp.getAttribute('data-student-id') || '') : '';
                const kod = extractKod(lines);
                const birth = f.tugIdx >= 0 ? cellText(tds[f.tugIdx]) : '';
                const key = sid || kod || (name + '|' + birth);
                if (seen.has(key)) { takror.n++; continue; }
                seen.add(key);
                const fil = extractFilial(lines);
                rows.push({
                    name, kod, sinf: f.sinfIdx >= 0 ? cellText(tds[f.sinfIdx]) : '',
                    filial: fil.filial, filialTola: fil.filialTola,
                    status: s.v, statusT: f.statusIdx >= 0 ? (cellText(tds[f.statusIdx]) || s.t) : s.t, prio: s.prio,
                    birth, bd: birthKey(birth), sid, on: inp ? inp.checked : false, disabled: inp ? inp.disabled : true,
                    page, norm: normalize(name),
                    found: false, amb: false, near: '', score: 0, level: '', sabab: '', natija: '', onAfter: null,
                });
            }
            return n;
        }

        async function bolimOqi(s, hajm) {
            const rows = [], seen = new Set(), takror = { n: 0 };
            const d1 = await fetchDoc(urlYasa(s.v, 1, hajm));
            if (!findTableIn(d1)) throw new Error(`«${s.t}» bo'limida jadval topilmadi`);
            let maxP = maxPageOf(d1), p = 1, toxta = false;
            const holat = () => {
                setProg(p, maxP);
                setStatus(`📖 <b>${esc(s.t)}</b>: sahifa <b>${p}</b>/${maxP} — <b>${rows.length}</b> ta o'qildi`);
            };
            qatorlarOqi(d1, s, 1, rows, seen, takror);
            holat();
            // Qolgan sahifalar PARALLEL tadan guruhlab, bir vaqtda o'qiladi
            while (!toxta && p < maxP && p < SOZ.MAX_SAHIFA) {
                chk();
                const from = p + 1, to = Math.min(maxP, SOZ.MAX_SAHIFA, p + SOZ.PARALLEL);
                const pages = []; for (let i = from; i <= to; i++) pages.push(i);
                const docs = await Promise.all(pages.map(pg => fetchDoc(urlYasa(s.v, pg, hajm))));
                for (let i = 0; i < docs.length; i++) {
                    const pg = pages[i], d = docs[i];
                    maxP = Math.max(maxP, maxPageOf(d));
                    const n = qatorlarOqi(d, s, pg, rows, seen, takror);
                    p = pg;
                    if (n < 0) { log(`⚠️ ${esc(s.t)} ${pg}-sahifada jadval yo'q — shu yerda to'xtatildi`, 'warn'); toxta = true; break; }
                    if (n === 0) { toxta = true; break; }
                }
                holat();
                if (!toxta && p < maxP) await kut(SOZ.SAHIFA_KUT);
            }
            if (takror.n) log(`⚠️ ${esc(s.t)}: ${takror.n} ta takror qator tashlab yuborildi (saralash beqaror)`, 'warn');
            log(`📖 ${esc(s.t)}: ${rows.length} ta (${p} sahifa)`, 'dim');
            return rows;
        }

        // Sahifa hajmini kattalashtiruvchi parametr nomini topish
        async function hajmAniqla(statusV) {
            const cached = GM_getValue(KEYS.hajm, '') || '';
            const d0 = await fetchDoc(urlYasa(statusV, 1, null));
            if (!findTableIn(d0)) throw new Error("O'quvchilar jadvali o'qilmadi — sahifani F5 qilib qayta urining");
            const n0 = qatorSoni(d0);
            if (n0 >= SOZ.HAJM) return null;
            const nomlar = cached ? [cached].concat(SOZ.HAJM_NOMLARI.filter(n => n !== cached)) : SOZ.HAJM_NOMLARI;
            for (const nom of nomlar) {
                setStatus(`📏 Sahifa hajmi sinalmoqda: <b>${nom}</b>…`);
                const d = await fetchDoc(urlYasa(statusV, 1, nom));
                const n = qatorSoni(d);
                if (n > n0) {
                    GM_setValue(KEYS.hajm, nom);
                    log(`📏 Sahifa hajmi: ${nom}=${SOZ.HAJM} → ${n} ta/sahifa`, 'ok');
                    return nom;
                }
                if (cached === nom) log(`📏 Oldingi «${nom}» endi ishlamadi, boshqalari sinaladi`, 'dim');
            }
            GM_setValue(KEYS.hajm, '');
            log(`📏 Sahifa hajmini o'zgartirib bo'lmadi — ${n0} ta/sahifa bilan o'qiladi`, 'dim');
            return null;
        }

        // ---- ERP indeksi ----
        function erpIndeks(erpList) {
            const items = erpList.map((e, i) => ({ i, fish: e.fish || '', sinf: e.sinf || '', birth: e.birth || '', norm: normalize(e.fish), bd: birthKey(e.birth) }));
            const byNorm = new Map(), byBd = new Map(), tokenIdx = new Map();
            for (const it of items) {
                if (!byNorm.has(it.norm)) byNorm.set(it.norm, []);
                byNorm.get(it.norm).push(it.i);
                if (it.bd) { if (!byBd.has(it.bd)) byBd.set(it.bd, []); byBd.get(it.bd).push(it.i); }
                for (const t of it.norm.split(' ')) { if (!t) continue; if (!tokenIdx.has(t)) tokenIdx.set(t, []); tokenIdx.get(t).push(it.i); }
            }
            return { items, byNorm, byBd, tokenIdx };
        }

        // ---- GLOBAL MOSLASHTIRISH (birga-bir, 3 daraja) ----
        function moslashtir(rows, E) {
            const used = new Set();
            const bagla = (r, i, s, level) => { r.found = true; r.erpIdx = i; r.near = E.items[i].fish; r.score = Math.round(s); r.level = level; used.add(i); };
            const eng = (r, pool) => {
                let b = -1, bs = 0, s2 = 0;
                for (const i of pool) {
                    if (used.has(i)) continue;
                    const s = simNorm(r.norm, E.items[i].norm);
                    if (s > bs) { s2 = bs; bs = s; b = i; } else if (s > s2) s2 = s;
                }
                return { i: b, s: bs, s2 };
            };
            const fuzzyEng = r => {
                const counts = new Map();
                for (const t of r.norm.split(' ')) (E.tokenIdx.get(t) || []).forEach(i => { if (!used.has(i)) counts.set(i, (counts.get(i) || 0) + 1); });
                if (!counts.size) return { i: -1, s: 0, s2: 0 };
                const pool = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(x => x[0]);
                return eng(r, pool);
            };
            // Ball baland → avval; teng bo'lsa Faol (prio kichik) → avval; so'ng allaqachon yoniq
            const tartib = (a, b) => (b.s - a.s) || (a.r.prio - b.r.prio) || ((b.r.on ? 1 : 0) - (a.r.on ? 1 : 0));

            // 1-daraja: tug'ilgan sana bir xil + ism ≥ 70%
            const juft = [];
            for (const r of rows) {
                if (!r.bd) continue;
                const pool = E.byBd.get(r.bd);
                if (!pool) continue;
                const c = eng(r, pool);
                if (c.i >= 0 && c.s >= SOZ.SANA_ISM_MIN) juft.push({ r, s: c.s });
            }
            juft.sort(tartib);
            for (const j of juft) {
                const r = j.r;
                if (r.found) continue;
                const c = eng(r, E.byBd.get(r.bd));
                if (c.i < 0 || c.s < SOZ.SANA_ISM_MIN) continue;
                if (c.s < 100 && c.s2 >= SOZ.SANA_ISM_MIN && c.s - c.s2 < SOZ.SHUBHA_FARQ) {
                    r.amb = true; r.near = E.items[c.i].fish; r.score = Math.round(c.s);
                    r.sabab = 'bir xil sanali ikki ERP nomzod juda yaqin';
                    continue;
                }
                bagla(r, c.i, c.s, c.s >= 100 ? 'ism+sana' : 'sana+ism≈');
            }

            // 2-daraja: ism aynan bir xil (sana farq yoki yo'q) — ikkala tomonda yagona bo'lsa
            const byNormT = new Map();
            rows.filter(r => !r.found && !r.amb).forEach(r => { if (!byNormT.has(r.norm)) byNormT.set(r.norm, []); byNormT.get(r.norm).push(r); });
            for (const [n, rs] of byNormT) {
                const cands = (E.byNorm.get(n) || []).filter(i => !used.has(i));
                if (!cands.length) continue;
                if (rs.length > 1) {
                    rs.forEach(r => { r.amb = true; r.near = E.items[cands[0]].fish; r.score = 100; r.sabab = `Turonda bir xil ismli ${rs.length} qator`; });
                    continue;
                }
                const r = rs[0];
                if (cands.length > 1) { r.amb = true; r.near = E.items[cands[0]].fish; r.score = 100; r.sabab = `ERPda bir xil ismli ${cands.length} kishi`; continue; }
                const it = E.items[cands[0]];
                const sanaFarq = r.bd && it.bd && r.bd !== it.bd;
                bagla(r, cands[0], 100, sanaFarq ? 'ism aniq (sana farq)' : 'ism aniq');
                if (sanaFarq) r.sabab = `sana farq: Turon ${r.birth} / ERP ${it.birth}`;
            }

            // 3-daraja: ism ≈ (≥ MIN_SCORE), ikkala tomonda sana bor-u farq qilsa — rad
            const juft3 = [];
            for (const r of rows) {
                if (r.found || r.amb) continue;
                const c = fuzzyEng(r);
                if (c.i >= 0) { r.near = E.items[c.i].fish; r.score = Math.round(c.s); }
                if (c.i >= 0 && c.s >= SOZ.MIN_SCORE) juft3.push({ r, i: c.i, s: c.s });
            }
            // Turon tomonidagi shubha: ikki qator bitta ERP nomzodga deyarli teng ball bilan da'vo qilsa — ikkalasi ham tegilmaydi
            const byI = new Map();
            juft3.forEach(j => { if (!byI.has(j.i)) byI.set(j.i, []); byI.get(j.i).push(j); });
            for (const [i, js] of byI) {
                if (js.length < 2) continue;
                js.sort((a, b) => b.s - a.s);
                if (js[0].s < 100 && js[0].s - js[1].s < SOZ.SHUBHA_FARQ) {
                    js.forEach(j => { j.r.amb = true; j.r.sabab = `Turonda ${js.length} qator bitta ERP nomzodga (${E.items[i].fish}) teng yaqin`; });
                }
            }
            juft3.sort(tartib);
            for (const j of juft3) {
                const r = j.r;
                if (r.found || r.amb) continue;
                const c = fuzzyEng(r);
                r.near = c.i >= 0 ? E.items[c.i].fish : ''; r.score = Math.round(c.s);
                if (c.i < 0 || c.s < SOZ.MIN_SCORE) continue;
                const it = E.items[c.i];
                if (r.bd && it.bd && r.bd !== it.bd) { r.sabab = `ism ${r.score}% o'xshash, lekin sana farq (${r.birth} / ${it.birth})`; continue; }
                if (c.s2 >= SOZ.MIN_SCORE && c.s - c.s2 < SOZ.SHUBHA_FARQ) { r.amb = true; r.sabab = 'ikki ERP nomzod juda yaqin'; continue; }
                bagla(r, c.i, c.s, 'ism≈');
            }
            rows.forEach(r => {
                if (!r.found && !r.amb && !r.sabab) r.sabab = r.near ? `eng yaqin ${r.score}% (< ${SOZ.MIN_SCORE}%)` : "ERPda nomzod yo'q";
            });
            return used;
        }

        // ---- REJA: tanlangan bo'limlar uchun o'zgarishlar ----
        function rejaTuz(rows, tanlangan) {
            const ops = [];
            for (const r of rows) {
                r.natija = ''; r.onAfter = null;
                if (!tanlangan.has(r.status)) continue;
                if (r.amb) { r.natija = 'shubhali'; continue; }
                const want = r.found;
                if (r.on === want) { r.natija = 'bor'; continue; }
                if (!r.sid) { r.natija = 'yoq'; r.sabab = r.sabab || 'tugmacha ID topilmadi'; continue; }
                if (r.disabled) { r.natija = 'qulf'; continue; }
                ops.push({ r, sid: r.sid, kod: r.kod, name: r.name, status: r.status, statusT: r.statusT, page: r.page, want, bosildi: false, ok: false, after: null, natija: '' });
            }
            return ops;
        }

        // ---- YASHIRIN IFRAME'LAR: haqiqiy tugmachani bosish (bir nechtasi parallel) ----
        function iframeOl(idx) {
            const id = 'tem-iframe-' + (idx || 0);
            let fr = document.getElementById(id);
            if (!fr) {
                fr = document.createElement('iframe');
                fr.id = id; fr.className = 'tem-iframe';
                fr.setAttribute('aria-hidden', 'true');
                fr.style.cssText = 'position:fixed;left:-4000px;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;border:0';
                document.body.appendChild(fr);
            }
            return fr;
        }
        function iframeYuk(url, idx) {
            return new Promise((res, rej) => {
                const fr = iframeOl(idx);
                let done = false;
                const t = setTimeout(() => { if (!done) { done = true; rej(new Error('iframe yuklanmadi (vaqt tugadi)')); } }, SOZ.IFRAME_KUT);
                fr.onload = () => { if (done) return; done = true; clearTimeout(t); res(fr); };
                fr.src = url;
            });
        }
        async function iframeJadval(fr) {
            for (let w = 0; w < 15000; w += 300) {
                chk();
                let doc = null;
                try { doc = fr.contentDocument; } catch (e) { }
                if (doc && doc.readyState !== 'loading' && findTableIn(doc)) return doc;
                await sleep(300);
            }
            return null;
        }
        // confirm()/alert() ni iframe ichida o'chirib qo'yamiz (3 usul — qaysi biri o'tsa ham bo'ladi)
        function confirmYop(win, doc, fr) {
            try { win.confirm = () => true; win.alert = () => { }; } catch (e) { }
            try {
                const uw = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
                const f2 = fr ? uw.document.getElementById(fr.id) : null;
                const w2 = f2 ? f2.contentWindow : uw;
                if (w2) { w2.confirm = () => true; w2.alert = () => { }; }
            } catch (e) { }
            try {
                const s = doc.createElement('script');
                s.textContent = 'window.confirm=function(){return true};window.alert=function(){};';
                (doc.head || doc.documentElement).appendChild(s);
                s.remove();
            } catch (e) { }
        }
        // Iframe ichidagi XHR/fetch so'rovlarini sanash — bosishdan keyin «server javob berdi»ni
        // ko'r-ko'rona kutish o'rniga aniq bilish uchun (window.__temNet = {pending, jami})
        const NET_JS = "(function(){if(window.__temNet)return;var n={pending:0,jami:0};window.__temNet=n;"
            + "var S=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(){n.pending++;n.jami++;var d=function(){n.pending=Math.max(0,n.pending-1)};"
            + "this.addEventListener('loadend',d);try{return S.apply(this,arguments)}catch(e){d();throw e}};"
            + "if(window.fetch){var F=window.fetch;window.fetch=function(){n.pending++;n.jami++;var d=function(){n.pending=Math.max(0,n.pending-1)};"
            + "var p;try{p=F.apply(this,arguments)}catch(e){d();throw e}p.then(d,d);return p}}})();";
        function tarmoqHolat(fr) {
            try { const w = fr.contentWindow; const n = (w.wrappedJSObject || w).__temNet; return n || null; } catch (e) { return null; }
        }
        function tarmoqKuzat(fr, doc) {
            if (tarmoqHolat(fr)) return;
            try {
                const s = doc.createElement('script'); s.textContent = NET_JS;
                (doc.head || doc.documentElement).appendChild(s); s.remove();
            } catch (e) { }
        }
        // Bosishdan keyin so'rov ketib tugashini kutish; kuzatuv ishlamasa — oddiy kutish. true = kuzatildi
        async function sorovKut(fr, jamiOldin) {
            const net = tarmoqHolat(fr);
            if (!net || jamiOldin == null) { await kut(SOZ.BOSISH_KUT); return false; }
            let w = 0;
            while (net.jami === jamiOldin && w < 800) { await sleep(50); w += 50; }
            if (net.jami === jamiOldin) { await kut(SOZ.BOSISH_KUT); return false; }
            w = 0;
            while (net.pending > 0 && w < SOZ.TARMOQ_KUT) { await sleep(50); w += 50; chk(); }
            await sleep(120);
            return true;
        }
        // SweetAlert / Bootstrap modal tasdig'i chiqsa — bosamiz.
        // MODAL: null — hali noma'lum (to'liq kutiladi), 'bor' — chiqadi, 'yoq' — chiqmaydi (qisqa kutiladi)
        let MODAL = null;
        async function tasdiqModalBos(doc, net, jamiOldin) {
            const SEL = '.swal2-confirm,.swal-button--confirm,.modal.show .btn-primary,.modal.show .btn-danger,.modal.show .btn-success,.modal.show .btn-warning';
            const maxW = MODAL === 'yoq' ? 250 : 1500;
            for (let w = 0; w < maxW; w += 50) {
                const b = doc.querySelector(SEL);
                if (b && b.offsetParent !== null) { MODAL = 'bor'; b.click(); return true; }
                // so'rov allaqachon ketdi — tasdiq oynasi yo'q, kutib o'tirmaymiz
                if (net && jamiOldin != null && net.jami > jamiOldin && MODAL !== 'bor') break;
                await sleep(50);
            }
            if (MODAL === null) MODAL = 'yoq';
            return false;
        }

        // Bitta sahifani iframe'da ochib, ro'yxatdagi tugmachalarni bosish
        async function iframeSahifa(url, list, prog, idx) {
            const fr = await iframeYuk(url, idx);
            chk();
            const doc0 = await iframeJadval(fr);
            if (!doc0) throw new Error('iframe ichida jadval chiqmadi');
            confirmYop(fr.contentWindow, doc0, fr);
            tarmoqKuzat(fr, doc0);
            let bosildi = 0, kuzatildi = 0;
            const yoq = [];
            for (const o of list) {
                chk();
                let d = fr.contentDocument || doc0;
                if (!findTableIn(d)) { d = (await iframeJadval(fr)) || d; confirmYop(fr.contentWindow, d, fr); tarmoqKuzat(fr, d); }
                const inp = toggleTop(d, o.sid);
                if (!inp) { yoq.push(o); continue; }
                if (inp.disabled) { o.natija = 'qulf'; continue; }
                if (inp.checked === o.want) { o.bosildi = true; o.bor = true; continue; }
                const net = tarmoqHolat(fr), jami0 = net ? net.jami : null;
                inp.click();
                bosildi++; o.bosildi = true;
                await tasdiqModalBos(d, net, jami0);
                if (await sorovKut(fr, jami0)) kuzatildi++;
                if (prog) prog();
            }
            return { bosildi, yoq, kuzatildi };
        }

        // Serverdan qayta o'qib tekshirish (haqiqiy holat)
        async function tekshir(ops, hajm) {
            const guruh = new Map();
            ops.forEach(o => { o.after = null; const k = o.status + '|' + o.page; if (!guruh.has(k)) guruh.set(k, []); guruh.get(k).push(o); });
            for (const [k, list] of guruh) {
                chk();
                const o0 = list[0];
                const doc = await fetchDoc(urlYasa(o0.status, o0.page, hajm));
                for (const o of list) { const inp = toggleTop(doc, o.sid); if (inp) o.after = inp.checked; }
            }
            for (const o of ops) {
                if (o.after !== null) continue;
                chk();
                const doc = await fetchDoc(urlYasa(o.status, 1, null, o.kod || o.name));
                const inp = toggleTop(doc, o.sid);
                if (inp) o.after = inp.checked;
            }
            ops.forEach(o => { o.ok = o.after === o.want; });
        }

        const yakunNatija = o => {
            if (o.natija === 'qulf') return;
            if (o.ok) o.natija = o.bor ? 'bor' : (o.want ? 'yoqildi' : 'ochirildi');
            else o.natija = o.natija === 'yoq' ? 'yoq' : 'saqlanmadi';
        };

        // ---- QO'LLASH: iframe → tekshiruv → qayta urinish; bo'lmasa zaxira rejim ----
        // Bitta sahifa guruhi: bosish → (qisqa) kutish → serverdan tekshirish → kechikkan bo'lsa yana tekshirish
        async function guruhQollash(list, hajm, prog, idx) {
            const o0 = list[0];
            let res;
            try { res = await iframeSahifa(urlYasa(o0.status, o0.page, hajm), list, prog, idx); }
            catch (e) {
                if (toxtashmi(e)) throw new ToxtashXato();
                log('⚠️ iframe: ' + esc(e.message), 'warn');
                res = { bosildi: 0, yoq: list.slice(), kuzatildi: 0 };
            }
            // Sahifada chiqmaganlar — kod bo'yicha qidiruv sahifasida
            for (const o of res.yoq) {
                chk();
                try {
                    const r2 = await iframeSahifa(urlYasa(o.status, 1, null, o.kod || o.name), [o], prog, idx);
                    if (r2.yoq.length) o.natija = 'yoq';
                    else { res.bosildi += r2.bosildi; res.kuzatildi += r2.kuzatildi; }
                } catch (e) { if (toxtashmi(e)) throw new ToxtashXato(); o.natija = 'yoq'; }
            }
            // So'rovlar tugagani kuzatilgan bo'lsa qisqa, bo'lmasa to'liq kutish
            await kut(res.bosildi && res.kuzatildi >= res.bosildi ? SOZ.SAQLASH_QISQA : SOZ.SAQLASH_KUT);
            await tekshir(list, hajm);
            let qayta = list.filter(o => !o.ok && o.natija !== 'qulf' && o.natija !== 'yoq');
            // Saqlanmagandek ko'ringanlar — server kechikkan bo'lishi mumkin: to'liq kutib yana o'qiymiz
            if (qayta.length && res.bosildi) { await kut(SOZ.SAQLASH_KUT); await tekshir(qayta, hajm); qayta = qayta.filter(o => !o.ok); }
            return {
                list, o0, qayta,
                okN: list.filter(o => o.ok).length,
                bosN: list.filter(o => o.bosildi && !o.bor && o.natija !== 'qulf').length,
            };
        }
        // Bir marta qayta urinish — kod bo'yicha qidiruv sahifasida
        async function guruhQayta(g, hajm, idx) {
            if (!g.qayta.length) return;
            log(`🔁 ${esc(g.o0.statusT)} ${g.o0.page}-sahifa: ${g.qayta.length} ta saqlanmadi — qayta urinilmoqda`, 'warn');
            for (const o of g.qayta) {
                chk();
                try { await iframeSahifa(urlYasa(o.status, 1, null, o.kod || o.name), [o], null, idx); } catch (e) { if (toxtashmi(e)) throw new ToxtashXato(); }
            }
            await kut(SOZ.SAQLASH_KUT);
            await tekshir(g.qayta, hajm);
        }
        function guruhYakun(g) {
            const list = g.list, o0 = g.o0;
            list.forEach(yakunNatija);
            const y = list.filter(o => o.natija === 'yoqildi').length, oc = list.filter(o => o.natija === 'ochirildi').length,
                x = list.filter(o => !o.ok && o.natija !== 'qulf').length, q = list.filter(o => o.natija === 'qulf').length;
            log(`${esc(o0.statusT)} ${o0.page}-sahifa: ✅ yoqildi ${y}, ⛔ o'chirildi ${oc}` + (x ? `, ❌ bo'lmadi ${x}` : '') + (q ? `, 🔒 qulf ${q}` : ''), x ? 'warn' : 'ok');
        }

        async function qollash(ops, hajm) {
            const guruh = new Map();
            ops.forEach(o => { const k = o.status + '|' + o.page; if (!guruh.has(k)) guruh.set(k, []); guruh.get(k).push(o); });
            const guruhlar = [...guruh.values()];
            let done = 0;
            const prog = () => { done++; setProg(done, ops.length); };
            const faol = [];
            const holatYoz = () => setStatus(`⚙️ Qo'llanmoqda: <b>${done}</b>/${ops.length}` +
                (faol.length ? ` · ${faol.map(l => esc(l[0].statusT) + ' ' + l[0].page + '-sahifa').join(', ')}` : ''));
            // 1-guruh alohida: yashirin oyna usuli umuman ishlayaptimi — tekshiramiz
            const l0 = guruhlar[0];
            setStatus(`⚙️ <b>${esc(l0[0].statusT)}</b> ${l0[0].page}-sahifa: ${l0.length} ta tugmacha bosilmoqda…`);
            const g0 = await guruhQollash(l0, hajm, prog, 0);
            if (g0.bosN > 0 && g0.okN === 0) {
                log("⚠️ Yashirin oyna usuli natija bermadi — sahifama-sahifa zaxira rejimga o'tilmoqda", 'warn');
                return { zaxira: true };
            }
            await guruhQayta(g0, hajm, 0);
            guruhYakun(g0);
            // Qolgan guruhlar IFRAME_PARALLEL ta yashirin oynada bir vaqtda; har biri o'z guruhini to'liq yakunlaydi
            let i = 1, xato = null;
            const ishchi = async idx => {
                while (i < guruhlar.length && !xato) {
                    chk();
                    const list = guruhlar[i++];
                    faol.push(list); holatYoz();
                    try {
                        const g = await guruhQollash(list, hajm, prog, idx);
                        await guruhQayta(g, hajm, idx);
                        guruhYakun(g);
                    } catch (e) {
                        if (toxtashmi(e)) throw new ToxtashXato();
                        if (!xato) xato = e;
                    }
                    faol.splice(faol.indexOf(list), 1); holatYoz();
                }
            };
            const n = Math.min(SOZ.IFRAME_PARALLEL, Math.max(1, guruhlar.length - 1));
            await Promise.all(Array.from({ length: n }, (_, k) => ishchi(k)));
            if (xato) throw xato;
            return { zaxira: false };
        }

        // ---- ZAXIRA REJIM: haqiqiy sahifada (q=kod) birma-bir, sahifa qayta yuklanib davom etadi ----
        function zaxiraBoshla(ops) {
            const qolgan = ops.filter(o => !o.ok && o.natija !== 'qulf')
                .map(o => ({ sid: o.sid, kod: o.kod, name: o.name, status: o.status, statusT: o.statusT, want: o.want, ok: false, natija: '' }));
            if (!qolgan.length) return false;
            GM_setValue(KEYS.nav, { running: true, ops: qolgan, idx: 0, ok: 0, boshlandi: Date.now() });
            const o = qolgan[0];
            location.href = urlYasa(o.status, 1, null, o.kod || o.name);
            return true;
        }

        async function jadvalKutTop(timeout) {
            for (let w = 0; w < timeout; w += 400) {
                chk();
                const f = findTableIn(document);
                if (f && f.table.querySelectorAll('tbody tr').length) return f;
                await sleep(400);
            }
            return findTableIn(document);
        }

        async function zaxiraDavom() {
            const nav = GM_getValue(KEYS.nav, null);
            if (!nav || !nav.running) return false;
            ishUi(true);
            log(`🧭 Zaxira rejim davom etmoqda: ${nav.idx}/${nav.ops.length} bajarildi`, 'dim');
            try {
                while (nav.idx < nav.ops.length) {
                    chk();
                    const o = nav.ops[nav.idx];
                    const q = o.kod || o.name;
                    const u = new URL(location.href);
                    if ((u.searchParams.get('q') || '') !== q || (u.searchParams.get('status') || '') !== o.status) {
                        GM_setValue(KEYS.nav, nav);
                        setStatus(`🧭 Zaxira rejim: ${nav.idx + 1}/${nav.ops.length} — ${esc(o.name)} sahifasiga o'tilmoqda…`);
                        location.href = urlYasa(o.status, 1, null, q);
                        return true;
                    }
                    setStatus(`🧭 Zaxira rejim: ${nav.idx + 1}/${nav.ops.length} — <b>${esc(o.name)}</b>`);
                    setProg(nav.idx, nav.ops.length);
                    await jadvalKutTop(20000);
                    confirmYop(window, document);
                    const inp = toggleTop(document, o.sid);
                    let ok = false;
                    if (!inp) o.natija = 'yoq';
                    else if (inp.disabled) o.natija = 'qulf';
                    else {
                        for (let urinish = 0; urinish < 2 && !ok; urinish++) {
                            if (inp.checked !== o.want) { inp.click(); await tasdiqModalBos(document); await kut(SOZ.SAQLASH_KUT); }
                            const d = await fetchDoc(urlYasa(o.status, 1, null, q));
                            const i2 = toggleTop(d, o.sid);
                            ok = !!(i2 && i2.checked === o.want);
                        }
                        o.natija = ok ? (o.want ? 'yoqildi' : 'ochirildi') : 'saqlanmadi';
                    }
                    o.ok = ok;
                    if (ok) nav.ok++;
                    log(`${ok ? '✅' : '❌'} ${esc(o.name)} — ${o.natija}`, ok ? 'ok' : 'warn');
                    nav.idx++;
                    GM_setValue(KEYS.nav, nav);
                }
                GM_setValue(KEYS.nav, null);
                // saqlangan natijaga qo'shamiz
                const N = GM_getValue(KEYS.natija, null);
                if (N && N.rows) {
                    const bySid = new Map(N.rows.map(r => [r.sid, r]));
                    nav.ops.forEach(o => { const r = bySid.get(o.sid); if (!r) return; r.natija = o.natija; r.onAfter = o.ok ? o.want : r.on; });
                    N.zaxira = true;
                    GM_setValue(KEYS.natija, N);
                    natijaKorsat(N);
                }
                log(`🏁 Zaxira rejim tugadi: ${nav.ok}/${nav.ops.length} ta muvaffaqiyatli`, 'ok');
                setStatus(`✅ Zaxira rejim tugadi: <b>${nav.ok}</b>/${nav.ops.length} ta saqlandi. 📊 Excel tayyor.`);
                setDot('ok');
            } catch (e) {
                if (toxtashmi(e)) { GM_setValue(KEYS.nav, null); setStatus("⏹ To'xtatildi."); log("⏹ To'xtatildi", 'warn'); setDot(''); }
                else { log('❌ ' + esc(e.message), 'err'); setStatus('❌ ' + esc(e.message)); setDot('err'); }
            }
            ishUi(false);
            return true;
        }

        // ---- PANEL ----
        const box = makePanel('2-bosqich · TURON ↔ ERP sinxron');
        const body = box.querySelector('#tem-body');
        body.innerHTML = `
            <div class="tem-card">
                <div class="tem-label">ERP bazasi</div>
                <div id="tem-erpinfo"></div>
            </div>
            <div class="tem-card">
                <div class="tem-label">Bo'lim (status)</div>
                <select class="tem-select" id="tem-bolim"><option value="__">⏳ Bo'limlar yuklanmoqda…</option></select>
                <label class="tem-chk" style="margin-top:8px"><input type="checkbox" id="tem-avto"> Rejani tasdiqlamasdan avtomatik qo'llash</label>
            </div>
            <div class="tem-row">
                <button class="tem-btn tem-p" id="tem-run">🚀 Solishtirish va sinxronlash</button>
            </div>
            <div class="tem-row">
                <button class="tem-btn tem-r" id="tem-stop" style="display:none">⏹ To'xtatish</button>
                <button class="tem-btn tem-b" id="tem-export" style="display:none">📊 Excel hisobot</button>
                <button class="tem-btn tem-g" id="tem-export2" style="display:none">🎨 To'liq hisobot</button>
                ${studentsPage ? '' : '<button class="tem-btn tem-s" id="tem-goto">👥 O\'quvchilar sahifasi</button>'}
            </div>
            <div class="tem-status" id="tem-status">Tayyor.</div>
            <div class="tem-prog" id="tem-prog" style="display:none"><i></i></div>
            <div id="tem-plan"></div>
            <div class="tem-stats" id="tem-stats" style="display:none"></div>
            <div id="tem-bolimlar"></div>
            <div class="tem-log" id="tem-log"></div>`;
        statusEl = body.querySelector('#tem-status');
        logEl = body.querySelector('#tem-log');
        dotEl = box.querySelector('#tem-dot');
        progEl = body.querySelector('#tem-prog');
        const selEl = body.querySelector('#tem-bolim');
        const runBtn = body.querySelector('#tem-run');
        const stopBtn = body.querySelector('#tem-stop');
        const exportBtn = body.querySelector('#tem-export');
        const export2Btn = body.querySelector('#tem-export2');
        const avtoEl = body.querySelector('#tem-avto');
        const planEl = body.querySelector('#tem-plan');
        const statsEl = body.querySelector('#tem-stats');
        const bolimlarEl = body.querySelector('#tem-bolimlar');
        const gotoBtn = body.querySelector('#tem-goto');
        if (gotoBtn) gotoBtn.addEventListener('click', () => { location.href = base; });

        function ishUi(on) {
            HOLAT.ish = on; HOLAT.toxtat = false;
            stopBtn.style.display = on ? '' : 'none';
            runBtn.disabled = on; selEl.disabled = on;
            setDot(on ? 'run' : '');
            if (!on) setProg(0, 0);
        }

        function erpInfo() {
            const erpList = GM_getValue(KEYS.erp, []);
            const meta = GM_getValue(KEYS.erpMeta, null) || {};
            let html = `<b>${erpList.length}</b> ta o'quvchi` + (meta.when ? ` <span style="color:#94a3b8">· ${esc(meta.when)}</span>` : '');
            if (!erpList.length) html += `<div class="tem-err" style="margin-top:6px">Baza bo'sh — avval <b>erp.maktab.uz</b> da ro'yxatni yig'ing.</div>`;
            else if (meta.jami && erpList.length < meta.jami) html += `<div class="tem-warn" style="margin-top:6px">⚠️ ERPda jami ${meta.jami} ta, yig'ilgani ${erpList.length} ta — to'liq emas! Yetishmaganlar «ERPda yo'q» deb o'chirilishi mumkin.</div>`;
            body.querySelector('#tem-erpinfo').innerHTML = html;
            return erpList;
        }
        erpInfo();

        // ---- Bo'limlar ro'yxati ----
        let STATUSLAR = GM_getValue(KEYS.statuslar, null) || null;
        function selToldir() {
            const ui = uiOl();
            const urlStatus = new URLSearchParams(location.search).get('status') || '';
            const pageSel = document.querySelector('select[name="status"]');
            const joriy = urlStatus || (pageSel ? pageSel.value : '') || ui.bolim || (STATUSLAR && STATUSLAR[0] ? STATUSLAR[0].v : '');
            selEl.innerHTML = `<option value="">🌐 Barcha bo'limlar</option>` +
                STATUSLAR.map(s => `<option value="${esc(s.v)}">${esc(s.t)}</option>`).join('');
            selEl.value = STATUSLAR.some(s => s.v === joriy) ? joriy : '';
        }
        selEl.addEventListener('change', () => uiSaqla({ bolim: selEl.value }));
        (async () => {
            let st = studentsPage ? statuslarDan(document) : null;
            if (!st) { try { const d = await fetchDoc(base); st = statuslarDan(d); } catch (e) { } }
            if (st) { STATUSLAR = st; GM_setValue(KEYS.statuslar, st); }
            if (!STATUSLAR) STATUSLAR = [{ v: 'active', t: 'Faol' }, { v: 'inactive', t: 'Nofaol' }];
            STATUSLAR.forEach((s, i) => { s.prio = i; });
            selToldir();
        })();

        // ---- Natija: saqlash / ko'rsatish ----
        const holat = r => r.onAfter != null ? r.onAfter : r.on;
        const statusNomi = v => ((STATUSLAR || []).find(x => x.v === v) || { t: v }).t;
        function natijaSaqla(rows, tanlangan, erpList, used, extra) {
            const N = Object.assign({
                when: new Date().toLocaleString(),
                tanlangan: [...tanlangan],
                tanlanganT: STATUSLAR.filter(s => tanlangan.has(s.v)).map(s => s.t).join(', ') || "Barcha bo'limlar",
                erpJami: erpList.length,
                erpTopilmagan: erpList.filter((e, i) => !used.has(i)),
                rows: rows.map(r => ({
                    name: r.name, kod: r.kod, sinf: r.sinf, filial: r.filial, filialTola: r.filialTola,
                    status: r.status, statusT: r.statusT, birth: r.birth, sid: r.sid, on: r.on, onAfter: r.onAfter,
                    found: r.found, near: r.near, score: r.score, level: r.level, amb: r.amb, sabab: r.sabab, disabled: r.disabled, natija: r.natija,
                    erpFish: r.found && erpList[r.erpIdx] ? (erpList[r.erpIdx].fish || '') : '',
                    erpSinf: r.found && erpList[r.erpIdx] ? (erpList[r.erpIdx].sinf || '') : '',
                    erpBirth: r.found && erpList[r.erpIdx] ? (erpList[r.erpIdx].birth || '') : '',
                })),
            }, extra || {});
            GM_setValue(KEYS.natija, N);
            return N;
        }
        const stat = (n, t, c) => `<div class="tem-stat"><b style="color:${c || '#f1f5f9'}">${n}</b><span>${t}</span></div>`;
        function natijaKorsat(N) {
            const T = N.rows.filter(r => N.tanlangan.length === 0 || N.tanlangan.includes(r.status));
            const s = {
                jami: T.length, mos: T.filter(r => r.found).length,
                yoq: T.filter(r => r.natija === 'yoqildi').length, och: T.filter(r => r.natija === 'ochirildi').length,
                shub: T.filter(r => r.amb).length, top: T.filter(r => !r.found && !r.amb).length,
                xato: T.filter(r => r.natija === 'saqlanmadi' || r.natija === 'yoq').length, qulf: T.filter(r => r.natija === 'qulf').length,
            };
            statsEl.style.display = '';
            statsEl.innerHTML = stat(s.jami, 'Jami') + stat(s.mos, 'ERP mos', '#4ade80') + stat(s.yoq, 'Yoqildi', '#4ade80') + stat(s.och, "O'chirildi", '#fb923c')
                + stat(s.top, 'Topilmadi', '#f87171') + stat(s.shub, 'Shubhali', '#facc15') + stat(s.xato, 'Yoqilmadi', '#f87171') + stat(s.qulf, 'Qulf', '#94a3b8');
            const bolimlar = [...new Set(N.rows.map(r => r.status))];
            bolimlarEl.innerHTML = `<table class="tem-table"><tr><th>Bo'lim</th><th>Jami</th><th>Mos</th><th>Yoniq</th><th>O'chiq</th><th>±</th></tr>` +
                bolimlar.map(v => {
                    const g = N.rows.filter(r => r.status === v);
                    const t = statusNomi(v);
                    const tanl = N.tanlangan.length === 0 || N.tanlangan.includes(v);
                    const oz = g.filter(r => r.natija === 'yoqildi' || r.natija === 'ochirildi').length;
                    return `<tr style="${tanl ? '' : 'opacity:.45'}"><td>${esc(t)}${tanl ? '' : ' <span class="dim" style="color:#64748b">(faqat solishtirish)</span>'}</td><td class="n">${g.length}</td><td class="n">${g.filter(r => r.found).length}</td><td class="n">${g.filter(holat).length}</td><td class="n">${g.filter(r => !holat(r)).length}</td><td class="n">${oz}</td></tr>`;
                }).join('') + '</table>';
            exportBtn.style.display = ''; export2Btn.style.display = '';
        }

        // Joriy sahifadagi qatorlarni bo'yash
        function ranglarniQoy(N) {
            if (!studentsPage || !N || !N.rows) return;
            const bySid = new Map(N.rows.map(r => [r.sid, r]));
            document.querySelectorAll('input[data-student-id]').forEach(inp => {
                const r = bySid.get(inp.getAttribute('data-student-id'));
                const tr = inp.closest('tr');
                if (!r || !tr) return;
                tr.style.background = r.amb ? 'rgba(250,204,21,.18)' : r.found ? 'rgba(34,197,94,.14)' : 'rgba(239,68,68,.10)';
                tr.title = r.found ? `ERP: ${r.near} (${r.score}%, ${r.level})` : `ERPda topilmadi: ${r.sabab}` + (r.near ? ` — eng yaqin: ${r.near}` : '');
            });
        }

        // ---- Reja tasdig'i (panel ichida) ----
        function tasdiqKut(ops, rows, tanlangan) {
            return new Promise((res, rej) => {
                HOLAT.radEt = rej;
                const T = rows.filter(r => tanlangan.has(r.status));
                const yoq = ops.filter(o => o.want).length, och = ops.filter(o => !o.want).length;
                const shub = T.filter(r => r.amb).length, qulf = T.filter(r => r.natija === 'qulf').length;
                const bolimlar = [...new Set(T.map(r => r.status))];
                planEl.innerHTML = `<div class="tem-card" style="border-color:rgba(139,92,246,.5)">
                    <div class="tem-label">Reja</div>
                    <table class="tem-table"><tr><th>Bo'lim</th><th>Jami</th><th>Mos</th><th>✅ Yoqiladi</th><th>⛔ O'chiriladi</th><th>⚠️</th></tr>` +
                    bolimlar.map(v => {
                        const g = T.filter(r => r.status === v), t = statusNomi(v);
                        return `<tr><td>${esc(t)}</td><td class="n">${g.length}</td><td class="n">${g.filter(r => r.found).length}</td><td class="n" style="color:#4ade80">${ops.filter(o => o.status === v && o.want).length}</td><td class="n" style="color:#fb923c">${ops.filter(o => o.status === v && !o.want).length}</td><td class="n" style="color:#facc15">${g.filter(r => r.amb).length}</td></tr>`;
                    }).join('') +
                    `</table>
                    <div style="margin:8px 0;color:#cbd5e1">Jami o'zgarish: <b>${ops.length}</b> (yoqiladi ${yoq}, o'chiriladi ${och})${shub ? ` · shubhali ${shub} ta tegilmaydi` : ''}${qulf ? ` · qulflangan ${qulf}` : ''}</div>
                    ${och > 0 && och > yoq * 3 && och > 20 ? `<div class="tem-warn" style="margin-bottom:8px">⚠️ O'chiriladiganlar juda ko'p — ERP bazasi to'liq yig'ilganini tekshiring.</div>` : ''}
                    <div class="tem-row">
                        <button class="tem-btn tem-g" id="tem-ok">✅ Qo'llash (${ops.length})</button>
                        <button class="tem-btn tem-s" id="tem-cancel">✖ Bekor</button>
                    </div></div>`;
                planEl.querySelector('#tem-ok').addEventListener('click', () => { HOLAT.radEt = null; planEl.innerHTML = ''; res(true); });
                planEl.querySelector('#tem-cancel').addEventListener('click', () => { HOLAT.radEt = null; planEl.innerHTML = ''; rej(new ToxtashXato('Bekor qilindi')); });
            });
        }

        // ---- ASOSIY OQIM ----
        async function boshla() {
            if (HOLAT.ish) return;
            const erpList = erpInfo();
            if (!erpList.length) { setStatus("❌ ERP bazasi bo'sh — avval erp.maktab.uz da ro'yxatni yig'ing."); return; }
            if (!STATUSLAR || selEl.value === '__') { setStatus("⏳ Bo'limlar hali yuklanmadi, biroz kuting."); return; }
            const tanlovV = selEl.value;
            const tanlangan = new Set(tanlovV ? [tanlovV] : STATUSLAR.map(s => s.v));
            const tanlanganT = tanlovV ? (STATUSLAR.find(s => s.v === tanlovV) || { t: tanlovV }).t : "Barcha bo'limlar";
            ishUi(true);
            HOLAT.ac = new AbortController();
            planEl.innerHTML = ''; statsEl.style.display = 'none'; bolimlarEl.innerHTML = '';
            logEl.innerHTML = '';
            log(`🚀 Boshlandi: <b>${esc(tanlanganT)}</b> · ERP bazasi ${erpList.length} ta`, 'ok');
            const t0 = Date.now();
            try {
                // 1) sahifa hajmi
                const hajm = await hajmAniqla(STATUSLAR[0].v);
                // 2) HAMMA bo'limlarni o'qiymiz (takror ismlar to'g'ri bog'lanishi uchun), tanlanganlar avval
                const tartib = STATUSLAR.slice().sort((a, b) => (tanlangan.has(b.v) ? 1 : 0) - (tanlangan.has(a.v) ? 1 : 0));
                const rows = [];
                for (const s of tartib) { chk(); const rs = await bolimOqi(s, hajm); rows.push(...rs); }
                if (!rows.length) throw new Error("Hech qanday o'quvchi o'qilmadi");
                log(`📚 Jami o'qildi: ${rows.length} ta (${STATUSLAR.length} bo'lim)`, 'ok');
                // 3) moslashtirish
                setStatus(`🧠 Solishtirilmoqda: <b>${rows.length}</b> ta Turon ↔ ${erpList.length} ta ERP…`);
                await sleep(30);
                const E = erpIndeks(erpList);
                const used = moslashtir(rows, E);
                const T = rows.filter(r => tanlangan.has(r.status));
                log(`🧠 ${esc(tanlanganT)}: ${T.length} ta, ERP mos ${T.filter(r => r.found).length}, shubhali ${T.filter(r => r.amb).length}, topilmadi ${T.filter(r => !r.found && !r.amb).length}`, 'dim');
                // 4) reja
                const ops = rejaTuz(rows, tanlangan);
                let N = natijaSaqla(rows, tanlangan, erpList, used);
                ranglarniQoy(N);
                if (!ops.length) {
                    natijaKorsat(N);
                    setStatus(`✅ <b>${esc(tanlanganT)}</b>: hammasi joyida — yoqiladigan/o'chiriladigan yo'q.`);
                    log('✅ O\'zgarish kerak emas', 'ok'); setDot('ok');
                    ishUi(false); return;
                }
                setStatus(`📋 Reja tayyor: <b>${ops.length}</b> ta o'zgarish (yoqiladi ${ops.filter(o => o.want).length}, o'chiriladi ${ops.filter(o => !o.want).length})`);
                if (!avtoEl.checked) await tasdiqKut(ops, rows, tanlangan);
                else log(`⚡ Avtomatik rejim: ${ops.length} ta o'zgarish tasdiqsiz qo'llanmoqda`, 'warn');
                // 5) qo'llash
                const q = await qollash(ops, hajm);
                ops.forEach(o => { o.r.natija = o.natija; o.r.onAfter = o.after != null ? o.after : (o.ok ? o.want : o.r.on); });
                N = natijaSaqla(rows, tanlangan, erpList, used);
                if (q.zaxira) {
                    log('🧭 Zaxira rejim: sahifa qayta yuklanadi, panel o\'zi davom ettiradi…', 'warn');
                    if (zaxiraBoshla(ops)) return;
                }
                // 6) hisobot
                natijaKorsat(N);
                ranglarniQoy(N);
                const y = ops.filter(o => o.natija === 'yoqildi').length, oc = ops.filter(o => o.natija === 'ochirildi').length,
                    x = ops.filter(o => !o.ok && o.natija !== 'qulf').length;
                const sek = Math.round((Date.now() - t0) / 1000);
                setStatus(`✅ <b>${esc(tanlanganT)}</b> tugadi (${sek} s): yoqildi <b style="color:#4ade80">${y}</b>, o'chirildi <b style="color:#fb923c">${oc}</b>` + (x ? `, bo'lmadi <b style="color:#f87171">${x}</b>` : '') + `<br>📊 Excel hisobot tayyor.`);
                log(`🏁 Tugadi: ${y} yoqildi, ${oc} o'chirildi, ${x} bo'lmadi (${sek} s)`, x ? 'warn' : 'ok');
                setDot(x ? 'err' : 'ok');
            } catch (e) {
                if (toxtashmi(e)) {
                    setStatus(`⏹ ${esc(e.message || "To'xtatildi")}.`);
                    log(`⏹ ${esc(e.message || "To'xtatildi")}`, 'warn');
                    setDot('');
                } else {
                    console.error('TEM:', e);
                    setStatus('❌ ' + esc(e.message));
                    log('❌ ' + esc(e.message), 'err');
                    setDot('err');
                }
            }
            HOLAT.ac = null; HOLAT.radEt = null;
            planEl.innerHTML = '';
            ishUi(false);
        }

        // ---- EXCEL ----
        function exportExcel() {
            if (typeof XLSX === 'undefined') { setStatus('❌ Excel kutubxonasi yuklanmadi. Skriptni qayta saqlab, F5 bosing.'); return; }
            const N = GM_getValue(KEYS.natija, null);
            if (!N || !N.rows || !N.rows.length) { setStatus("Hisobot yo'q — avval solishtirishni ishga tushiring."); return; }
            const R = N.rows;
            const wb = XLSX.utils.book_new();
            const safe = s => String(s).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31);
            const holatT = r => holat(r) ? 'Yoniq' : "O'chiq";
            const natijaT = r => ({ yoqildi: 'Yoqildi', ochirildi: "O'chirildi", saqlanmadi: 'Saqlanmadi', yoq: 'Sahifada topilmadi', qulf: 'Qulflangan', shubhali: 'Shubhali — tegilmadi', bor: "O'zgarish kerak emas" }[r.natija] || '');
            const bolimlar = [...new Set(R.map(r => r.statusT))];
            const filiallar = [...new Set(R.map(r => r.filial || "Filial ko'rsatilmagan"))].sort();

            const aoa = [
                ['TURON ↔ ERP HISOBOT', N.when], ["Tanlangan bo'lim", N.tanlanganT], [],
                ["Bo'lim", 'Jami', 'ERP mos', 'Yoniq', "O'chiq", 'Yoqildi', "O'chirildi", 'Shubhali', 'Yoqilmadi', 'Qulflangan'],
                ...bolimlar.map(b => {
                    const g = R.filter(r => r.statusT === b);
                    return [b, g.length, g.filter(r => r.found).length, g.filter(holat).length, g.filter(r => !holat(r)).length,
                        g.filter(r => r.natija === 'yoqildi').length, g.filter(r => r.natija === 'ochirildi').length, g.filter(r => r.amb).length,
                        g.filter(r => r.natija === 'saqlanmadi' || r.natija === 'yoq').length, g.filter(r => r.natija === 'qulf').length];
                }),
                [], ['Filial', 'Jami', 'Yoniq', "O'chiq"],
                ...filiallar.map(f => { const g = R.filter(r => (r.filial || "Filial ko'rsatilmagan") === f); return [f, g.length, g.filter(holat).length, g.filter(r => !holat(r)).length]; }),
                [], ['ERP bazasi: jami', N.erpJami], ["ERP: TURONga bog'langan", N.erpJami - N.erpTopilmagan.length], ['ERP: TURONda topilmagan', N.erpTopilmagan.length],
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Umumiy');

            const qator = r => ({
                "Bo'lim": r.statusT, "O'quvchi (TURON)": r.name, 'Kod': r.kod, 'Sinf': r.sinf, 'Filial': r.filial, "Tug'ilgan sana": r.birth,
                'ERP holati': holatT(r), 'Amal': natijaT(r), 'ERP mos': r.found ? 'Ha' : "Yo'q", 'ERP ism': r.near, 'Foiz': r.score, 'Daraja': r.level, 'Izoh': r.sabab,
            });
            const oz = R.filter(r => ['yoqildi', 'ochirildi', 'saqlanmadi', 'yoq', 'qulf'].includes(r.natija));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oz.map(qator)), "O'zgarishlar");
            for (const b of bolimlar) {
                const g = R.filter(r => r.statusT === b && !holat(r));
                if (g.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(g.map(qator)), safe("O'chiq - " + b));
            }
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(R.filter(r => !r.found && !r.amb).map(qator)), 'ERPda topilmaganlar');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(R.filter(r => r.amb).map(qator)), 'Shubhalilar');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(R.filter(r => r.natija === 'saqlanmadi' || r.natija === 'yoq').map(qator)), 'Yoqilmadi');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(N.erpTopilmagan.map(x => ({ "O'quvchi (ERP)": x.fish || '', 'Sinf': x.sinf || '', "Tug'ilgan sana": x.birth || '' }))), 'TURONda topilmagan ERP');
            XLSX.writeFile(wb, 'turon-erp-hisobot.xlsx');
        }

        // ---- TO'LIQ, BEZATILGAN EXCEL HISOBOT (ExcelJS) ----
        const RANG = {
            bosh: '1E1B4B', boshMatn: 'FFFFFF', sarlavha: '312E81', izoh: '64748B', chiziq: 'CBD5E1', juft: 'F8FAFC',
            yashil: 'DCFCE7', yashilM: '166534', qizil: 'FEE2E2', qizilM: '991B1B', sariq: 'FEF9C3', sariqM: '854D0E',
            toq: 'FFEDD5', toqM: '9A3412', kul: 'E2E8F0', kulM: '475569', kok: 'DBEAFE', kokM: '1E40AF', binafsha: 'EDE9FE', binafshaM: '5B21B6',
        };
        const fillOf = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + c } });
        const chiziq = { style: 'thin', color: { argb: 'FF' + RANG.chiziq } };
        const BORDER = { top: chiziq, left: chiziq, bottom: chiziq, right: chiziq };
        const teg = (bg, fg) => ({ fill: fillOf(bg), font: { bold: true, color: { argb: 'FF' + fg } } });
        const TEG = {
            yashil: teg(RANG.yashil, RANG.yashilM), qizil: teg(RANG.qizil, RANG.qizilM), sariq: teg(RANG.sariq, RANG.sariqM),
            kul: teg(RANG.kul, RANG.kulM), toq: teg(RANG.toq, RANG.toqM), kok: teg(RANG.kok, RANG.kokM), binafsha: teg(RANG.binafsha, RANG.binafshaM),
        };
        const faolmi = r => /^faol/i.test(r.statusT || '') || r.status === 'active';
        const nofaolmi = r => /nofaol/i.test(r.statusT || '') || r.status === 'inactive';
        const sinfKalit = s => { const m = /(\d+)/.exec(s || ''); return m ? Number(m[1]) : 9999; };
        const tartibla = (arr, nom) => arr.slice().sort((a, b) => (sinfKalit(a.sinf) - sinfKalit(b.sinf)) || String(a.sinf || '').localeCompare(String(b.sinf || '')) || String(a[nom] || '').localeCompare(String(b[nom] || '')));
        const raqamla = arr => arr.map((q, i) => Object.assign({}, q, { _i: i + 1 }));
        const natijaMatni = r => ({ yoqildi: 'Yoqildi', ochirildi: "O'chirildi", saqlanmadi: 'Saqlanmadi', yoq: 'Sahifada topilmadi', qulf: 'Qulflangan', shubhali: 'Shubhali — tegilmadi', bor: "O'zgarish kerak emas" }[r.natija] || '');
        const natijaTeg = r => ({ yoqildi: TEG.yashil, ochirildi: TEG.toq, saqlanmadi: TEG.qizil, yoq: TEG.qizil, qulf: TEG.kul, shubhali: TEG.sariq }[r.natija] || null);

        // Jadval varag'i: 1-qator sarlavha, 2-qator izoh, 4-qator ustun boshlari (muzlatilgan, filtrli), keyin ma'lumot
        function jadvalVaraq(wb, nom, sarlavha, izoh, ustunlar, qatorlar) {
            const ws = wb.addWorksheet(nom, { views: [{ state: 'frozen', ySplit: 4 }] });
            const n = Math.max(ustunlar.length, 2);
            ws.mergeCells(1, 1, 1, n);
            const t = ws.getCell(1, 1);
            t.value = sarlavha; t.font = { bold: true, size: 15, color: { argb: 'FF' + RANG.sarlavha } }; t.alignment = { vertical: 'middle' };
            ws.getRow(1).height = 30;
            ws.mergeCells(2, 1, 2, n);
            const s2 = ws.getCell(2, 1);
            s2.value = izoh; s2.font = { italic: true, size: 10, color: { argb: 'FF' + RANG.izoh } };
            const hr = ws.getRow(4);
            ustunlar.forEach((u, i) => {
                const c = hr.getCell(i + 1);
                c.value = u.h; c.fill = fillOf(RANG.bosh); c.font = { bold: true, color: { argb: 'FF' + RANG.boshMatn } };
                c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; c.border = BORDER;
            });
            hr.height = 32;
            const kenglik = ustunlar.map(u => Math.max(8, String(u.h).length + 2));
            qatorlar.forEach((q, ri) => {
                const row = ws.getRow(5 + ri);
                ustunlar.forEach((u, i) => {
                    const v = typeof u.k === 'function' ? u.k(q) : q[u.k];
                    const val = v == null ? '' : v;
                    const c = row.getCell(i + 1);
                    c.value = val;
                    c.border = BORDER;
                    const tg = u.teg ? u.teg(q, val) : null;
                    c.alignment = { vertical: 'middle', wrapText: !!u.wrap, horizontal: (u.markaz || (tg && !u.wrap)) ? 'center' : (typeof val === 'number' ? 'right' : 'left') };
                    if (ri % 2) c.fill = fillOf(RANG.juft);
                    if (tg) { c.fill = tg.fill; c.font = tg.font; }
                    const len = String(val).length;
                    if (len + 2 > kenglik[i]) kenglik[i] = Math.min(u.max || 50, len + 2);
                });
            });
            ustunlar.forEach((u, i) => { ws.getColumn(i + 1).width = u.w || kenglik[i]; });
            if (qatorlar.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + qatorlar.length, column: ustunlar.length } };
            else { const c = ws.getCell(5, 1); c.value = "— Ro'yxat bo'sh —"; c.font = { italic: true, color: { argb: 'FF94A3B8' } }; }
            return ws;
        }

        // Turon o'quvchilari uchun ustunlar
        const ustTuron = () => [
            { h: '№', k: '_i', w: 6, markaz: true },
            { h: "O'quvchi (TURON)", k: 'name', max: 48 },
            { h: 'Kod', k: 'kod', w: 15 },
            { h: 'Sinf / yo\'nalish', k: 'sinf', max: 30 },
            { h: 'Filial', k: 'filial', max: 22 },
            { h: "Tug'ilgan sana", k: 'birth', w: 14, markaz: true },
            { h: "Bo'lim", k: 'statusT', w: 13, teg: q => faolmi(q) ? TEG.yashil : nofaolmi(q) ? TEG.kul : TEG.kok },
            { h: 'ERP tugmasi', k: q => holat(q) ? 'YONIQ' : "O'CHIQ", w: 13, teg: q => holat(q) ? TEG.yashil : TEG.qizil },
            { h: 'ERPda bor', k: q => q.amb ? 'SHUBHALI' : q.found ? 'HA' : "YO'Q", w: 12, teg: q => q.amb ? TEG.sariq : q.found ? TEG.yashil : TEG.qizil },
            { h: "O'quvchi (ERP)", k: q => q.erpFish || (q.found || q.amb ? q.near : '') || '', max: 48 },
            { h: 'ERP sinf', k: q => q.erpSinf || '', w: 12 },
            { h: 'ERP sana', k: q => q.erpBirth || '', w: 12, markaz: true },
            { h: 'Moslik %', k: q => (q.found || q.amb) ? q.score : '', w: 10, markaz: true },
            { h: 'Daraja', k: q => q.level || '', w: 18 },
            { h: 'Amal (natija)', k: natijaMatni, w: 22, teg: natijaTeg },
            { h: 'Izoh', k: q => q.sabab || '', max: 60, wrap: true },
        ];
        // ERP o'quvchilari uchun ustunlar
        const ustErp = () => [
            { h: '№', k: '_i', w: 6, markaz: true },
            { h: "O'quvchi (ERP)", k: 'fish', max: 48 },
            { h: 'ERP sinf', k: 'sinf', w: 12 },
            { h: "Tug'ilgan sana", k: 'birth', w: 14, markaz: true },
            { h: 'Turonda', k: q => q.r ? 'BOR' : "YO'Q", w: 11, teg: q => q.r ? TEG.yashil : TEG.qizil },
            { h: "O'quvchi (TURON)", k: q => q.r ? q.r.name : '', max: 48 },
            { h: 'Kod', k: q => q.r ? q.r.kod : '', w: 15 },
            { h: 'Turon sinf', k: q => q.r ? q.r.sinf : '', max: 30 },
            { h: 'Filial', k: q => q.r ? q.r.filial : '', max: 22 },
            { h: "Bo'lim", k: q => q.r ? q.r.statusT : '', w: 13, teg: q => q.r ? (faolmi(q.r) ? TEG.yashil : nofaolmi(q.r) ? TEG.kul : TEG.kok) : null },
            { h: 'ERP tugmasi', k: q => q.r ? (holat(q.r) ? 'YONIQ' : "O'CHIQ") : '', w: 13, teg: q => q.r ? (holat(q.r) ? TEG.yashil : TEG.qizil) : null },
            { h: 'Moslik %', k: q => q.r ? q.r.score : '', w: 10, markaz: true },
        ];

        // Umumiy varaq: KPI kartalar + bo'limlar + filiallar + ERP jadvallari
        function umumiyVaraq(wb, N, R, E) {
            const ws = wb.addWorksheet('Umumiy', { views: [{ showGridLines: false }] });
            for (let i = 1; i <= 10; i++) ws.getColumn(i).width = i === 1 ? 30 : 15;
            const yoz = (r, c, v, st) => { const cell = ws.getCell(r, c); cell.value = v; if (st) Object.keys(st).forEach(k => { cell[k] = st[k]; }); return cell; };
            let r = 1;
            ws.mergeCells(r, 1, r, 10);
            yoz(r, 1, 'TURON ↔ ERP · TO\'LIQ HISOBOT', { font: { bold: true, size: 18, color: { argb: 'FF' + RANG.sarlavha } }, alignment: { vertical: 'middle' } });
            ws.getRow(r).height = 34; r++;
            ws.mergeCells(r, 1, r, 10);
            yoz(r, 1, `Sana: ${N.when} · Tanlangan bo'lim: ${N.tanlanganT} · Turon: ${R.length} ta · ERP: ${N.erpJami} ta`, { font: { italic: true, size: 10, color: { argb: 'FF' + RANG.izoh } } });
            r += 2;
            // KPI kartalar
            const kpi = [
                ['Jami (Turon)', R.length, TEG.kok], ['ERP mos', R.filter(x => x.found).length, TEG.yashil],
                ['ERPda topilmadi', R.filter(x => !x.found && !x.amb).length, TEG.qizil], ['Shubhali', R.filter(x => x.amb).length, TEG.sariq],
                ['ERP yoniq', R.filter(holat).length, TEG.yashil], ["ERP o'chiq", R.filter(x => !holat(x)).length, TEG.qizil],
                ['Yoqildi', R.filter(x => x.natija === 'yoqildi').length, TEG.yashil], ["O'chirildi", R.filter(x => x.natija === 'ochirildi').length, TEG.toq],
                ['ERP jami', N.erpJami, TEG.binafsha], ['ERP · Turonda yo\'q', E.filter(x => !x.r).length, TEG.qizil],
            ];
            kpi.forEach((k, i) => {
                const c = (i % 5) + 2, rr = r + Math.floor(i / 5) * 3;
                yoz(rr, c, k[1], { fill: k[2].fill, font: { bold: true, size: 20, color: k[2].font.color }, alignment: { horizontal: 'center', vertical: 'middle' }, border: BORDER });
                yoz(rr + 1, c, k[0], { fill: k[2].fill, font: { size: 9, color: k[2].font.color }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: BORDER });
                ws.getRow(rr).height = 30;
            });
            yoz(r, 1, "Ko'rsatkichlar", { font: { bold: true, size: 12, color: { argb: 'FF' + RANG.sarlavha } } });
            r += 7;
            // kichik jadval yozuvchi
            const jadval = (sarl, heads, rows, tegFn) => {
                yoz(r, 1, sarl, { font: { bold: true, size: 12, color: { argb: 'FF' + RANG.sarlavha } } }); r++;
                heads.forEach((h, i) => yoz(r, i + 1, h, { fill: fillOf(RANG.bosh), font: { bold: true, color: { argb: 'FF' + RANG.boshMatn } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: BORDER }));
                ws.getRow(r).height = 30; r++;
                rows.forEach((row, ri) => {
                    row.forEach((v, i) => {
                        const tg = tegFn ? tegFn(i, v, row) : null;
                        yoz(r, i + 1, v, {
                            border: BORDER, alignment: { horizontal: i ? 'center' : 'left', vertical: 'middle' },
                            fill: tg ? tg.fill : (ri % 2 ? fillOf(RANG.juft) : fillOf('FFFFFF')), font: tg ? tg.font : { color: { argb: 'FF0F172A' } },
                        });
                    });
                    r++;
                });
                r += 2;
            };
            const hisob = g => [g.length, g.filter(x => x.found).length, g.filter(x => !x.found && !x.amb).length, g.filter(x => x.amb).length,
                g.filter(holat).length, g.filter(x => !holat(x)).length, g.filter(x => x.natija === 'yoqildi').length, g.filter(x => x.natija === 'ochirildi').length,
                g.filter(x => x.natija === 'saqlanmadi' || x.natija === 'yoq').length];
            const HEADS = ['', 'Jami', 'ERP mos', 'Topilmadi', 'Shubhali', 'Yoniq', "O'chiq", 'Yoqildi', "O'chirildi", 'Xato'];
            const tegUst = (i, v) => (!v || typeof v !== 'number') ? null : ({ 2: TEG.yashil, 3: TEG.qizil, 4: TEG.sariq, 5: TEG.yashil, 6: TEG.qizil, 7: TEG.yashil, 8: TEG.toq, 9: TEG.qizil }[i] || null);
            const bolimlar = [...new Set(R.map(x => x.statusT))];
            jadval("Bo'limlar bo'yicha", ["Bo'lim"].concat(HEADS.slice(1)),
                bolimlar.map(b => [b].concat(hisob(R.filter(x => x.statusT === b)))).concat([['JAMI'].concat(hisob(R))]), tegUst);
            const filiallar = [...new Set(R.map(x => x.filial || "Filial ko'rsatilmagan"))].sort();
            jadval('Filiallar bo\'yicha', ['Filial'].concat(HEADS.slice(1)),
                filiallar.map(f => [f].concat(hisob(R.filter(x => (x.filial || "Filial ko'rsatilmagan") === f)))).concat([['JAMI'].concat(hisob(R))]), tegUst);
            const erpBor = E.filter(x => x.r).length;
            jadval('ERP bazasi', ["Ko'rsatkich", 'Soni', 'Foiz'], [
                ['ERP jami', N.erpJami, '100%'],
                ["Turonga bog'langan", erpBor, N.erpJami ? Math.round(100 * erpBor / N.erpJami) + '%' : ''],
                ['Turonda topilmagan', N.erpJami - erpBor, N.erpJami ? Math.round(100 * (N.erpJami - erpBor) / N.erpJami) + '%' : ''],
            ], (i, v, row) => i ? (row[0].startsWith('Turonga') ? TEG.yashil : row[0].startsWith('Turonda') ? TEG.qizil : TEG.binafsha) : null);
            ws.mergeCells(r, 1, r, 10);
            yoz(r, 1, "Varaqlar: Faol · ERP yoniq / o'chiq · Nofaol · ERP bor / yo'q · boshqa bo'limlar · ERP hisobot · Barcha filiallar · har bir filial alohida", { font: { italic: true, size: 9, color: { argb: 'FF' + RANG.izoh } } });
            return ws;
        }

        async function yukla(wb, fayl) {
            const buf = await wb.xlsx.writeBuffer();
            const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = fayl;
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
        }

        async function exportChiroyli() {
            if (typeof ExcelJS === 'undefined') { setStatus('❌ ExcelJS kutubxonasi yuklanmadi. Skriptni qayta saqlab, F5 bosing.'); return; }
            const N = GM_getValue(KEYS.natija, null);
            if (!N || !N.rows || !N.rows.length) { setStatus("Hisobot yo'q — avval solishtirishni ishga tushiring."); return; }
            export2Btn.disabled = true;
            setStatus('🎨 To\'liq hisobot tayyorlanmoqda…');
            await sleep(30);
            try {
                const R = N.rows;
                const bor = new Set();
                const nomTozala = s => {
                    const n = String(s).replace(/[\\\/\?\*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Varaq';
                    let k = n, i = 2;
                    while (bor.has(k.toLowerCase())) { const suf = ' (' + (i++) + ')'; k = n.slice(0, 31 - suf.length) + suf; }
                    bor.add(k.toLowerCase()); return k;
                };
                // ERP tomonidagi ro'yxat: bog'langanlar + Turonda topilmaganlar
                const E = tartibla(
                    R.filter(x => x.found).map(x => ({ fish: x.erpFish || x.near || '', sinf: x.erpSinf || '', birth: x.erpBirth || '', r: x }))
                        .concat((N.erpTopilmagan || []).map(x => ({ fish: x.fish || '', sinf: x.sinf || '', birth: x.birth || '', r: null }))), 'fish');
                const wb = new ExcelJS.Workbook();
                wb.creator = 'TURON ERP Moslash'; wb.created = new Date();
                umumiyVaraq(wb, N, R, E); bor.add('umumiy');
                const izoh = (g, qoshimcha) => `${g.length} ta · ${N.when}` + (qoshimcha ? ' · ' + qoshimcha : '');
                const turonVaraq = (nom, sarl, g, qoshimcha) => jadvalVaraq(wb, nomTozala(nom), sarl, izoh(g, qoshimcha), ustTuron(), raqamla(tartibla(g, 'name')));
                // Faol
                const faol = R.filter(faolmi);
                turonVaraq('Faol · ERP yoniq', "FAOL o'quvchilar — ERP tugmasi YONIQ", faol.filter(holat));
                turonVaraq("Faol · ERP o'chiq", "FAOL o'quvchilar — ERP tugmasi O'CHIQ", faol.filter(x => !holat(x)), "ERPda topilmaganlar yoki yoqilmaganlar");
                // Nofaol
                const nofaol = R.filter(nofaolmi);
                turonVaraq('Nofaol · ERP bor', "NOFAOL o'quvchilar — ERPda BOR", nofaol.filter(x => x.found), "ERP bazasida mos o'quvchi topilgan");
                turonVaraq("Nofaol · ERP yo'q", "NOFAOL o'quvchilar — ERPda YO'Q", nofaol.filter(x => !x.found), "ERP bazasida topilmagan yoki shubhali");
                // Boshqa bo'limlar
                [...new Set(R.filter(x => !faolmi(x) && !nofaolmi(x)).map(x => x.statusT))].forEach(b => {
                    turonVaraq(b, `${b.toUpperCase()} o'quvchilari`, R.filter(x => x.statusT === b));
                });
                // Shubhali / xato — bo'lsa
                const shub = R.filter(x => x.amb); if (shub.length) turonVaraq('Shubhalilar', 'SHUBHALI mosliklar — tegilmagan', shub);
                const xato = R.filter(x => x.natija === 'saqlanmadi' || x.natija === 'yoq'); if (xato.length) turonVaraq('Yoqilmadi', "O'ZGARTIRIB BO'LMAGANLAR", xato);
                // ERP hisobot
                jadvalVaraq(wb, nomTozala('ERP hisobot'), 'ERP BAZASI — Turon bilan bog\'lanish', `${E.length} ta · bog'langan ${E.filter(x => x.r).length} · topilmagan ${E.filter(x => !x.r).length} · ${N.when}`, ustErp(), raqamla(E));
                jadvalVaraq(wb, nomTozala("ERP · Turonda yo'q"), "ERP o'quvchilari — TURONDA TOPILMAGAN", izoh(E.filter(x => !x.r)), ustErp(), raqamla(E.filter(x => !x.r)));
                // Filiallar
                turonVaraq('Barcha filiallar', "BARCHA FILIALLAR — barcha bo'limlar", R);
                [...new Set(R.map(x => x.filial || "Filial ko'rsatilmagan"))].sort().forEach(f => {
                    const g = R.filter(x => (x.filial || "Filial ko'rsatilmagan") === f);
                    turonVaraq('Filial · ' + f, `FILIAL: ${f}`, g, `faol ${g.filter(faolmi).length} · nofaol ${g.filter(nofaolmi).length} · ERP yoniq ${g.filter(holat).length}`);
                });
                const sana = new Date().toISOString().slice(0, 10);
                await yukla(wb, `turon-erp-toliq-hisobot_${sana}.xlsx`);
                setStatus(`🎨 To'liq hisobot yuklandi: <b>${wb.worksheets.length}</b> varaq.`);
                log(`🎨 To'liq hisobot: ${wb.worksheets.length} varaq, ${R.length} ta Turon, ${E.length} ta ERP`, 'ok');
            } catch (e) {
                console.error('TEM:', e);
                setStatus('❌ Hisobot xatosi: ' + esc(e.message));
                log('❌ Hisobot xatosi: ' + esc(e.message), 'err');
            }
            export2Btn.disabled = false;
        }

        // ---- Tugmalar ----
        runBtn.addEventListener('click', boshla);
        stopBtn.addEventListener('click', toxtat);
        exportBtn.addEventListener('click', exportExcel);
        export2Btn.addEventListener('click', exportChiroyli);

        // ---- Ishga tushirish ----
        (async () => {
            const N = GM_getValue(KEYS.natija, null);
            if (N && N.rows && N.rows.length) {
                exportBtn.style.display = ''; export2Btn.style.display = '';
                setStatus(`Oxirgi natija: <b>${esc(N.tanlanganT)}</b> · ${esc(N.when)}`);
                natijaKorsat(N);
                ranglarniQoy(N);
            }
            await zaxiraDavom();
        })();
    }
})();
