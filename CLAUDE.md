# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Loyiha haqida

Smartjadval.uz — O'zbekiston maktablari uchun avtomatik dars jadvali platformasi.
React 19 + Vite 8 SPA, backend sifatida Supabase (Auth + Postgres + Edge Function),
GitHub Pages'ga `smartjadval.uz` domeni bilan deploy qilinadi.

**UI matnlari va kod izohlari — o'zbek tilida.** Yangi kod ham shu tilda yozilsin.

## Buyruqlar

```bash
npm run dev       # Vite dev server — port 5175, strictPort, brauzer avtomatik ochiladi
npm run build     # dist/ ga production build
npm run lint      # eslint . (flat config, dist/ e'tiborsiz)
npm run preview   # build natijasini ko'rish
```

Windows PowerShell'da `npm.ps1` execution-policy xatosi chiqsa — `npm.cmd run dev`.

Test to'plami yo'q (test runner ham o'rnatilmagan). Tekshirish = `npm run lint` +
`npm run build` + brauzerda qo'lda sinash.

## Arxitektura

### Navigatsiya — router kutubxonasi ISHLATILMAYDI

`react-router-dom` package.json'da bor, lekin hech qayerda import qilinmagan
(`framer-motion` va `react-icons` ham shunday — ishlatilmaydigan bog'liqliklar).

Navigatsiya [App.jsx](src/App.jsx) ichida: `activePage` state + `PAGE_IDS` ro'yxati +
`renderPage()` switch. Faol bo'lim URL hash'ida (`#/schedule`) saqlanadi — GitHub
Pages'da server tomonda rewrite yo'q, shuning uchun path emas, hash ishlatiladi.
`popstate` orqali brauzerning "Orqaga" tugmasi bo'limlar bo'ylab yuradi.

**Yangi sahifa qo'shish = 4 joyga tegish:** import, `PAGE_IDS`, `renderPage()` switch,
[Sidebar.jsx](src/components/Sidebar.jsx) menyusi.

### Rollar — uchta alohida ilova daraxti

`App.jsx` foydalanuvchi roliga qarab butunlay boshqa daraxt render qiladi:

| Rol | Nima ko'radi |
|---|---|
| `district_admin` | [DistrictApp.jsx](src/pages/DistrictApp.jsx) — maktab ma'lumotlari yuklanmaydi, cloudSync ishlamaydi |
| `superadmin` | oddiy ilova + [Users.jsx](src/pages/Users.jsx) sahifasi |
| `user` | oddiy ilova |

`mustChangePassword` bayrog'i hamma narsadan ustun — `ForcePasswordChange` ekrani
(App.jsx oxirida) ochiladi. Parol tiklash havolasi (`isPasswordRecoveryUrl()`) undan
ham ustun.

### Ma'lumot holati — props drilling, store yo'q

Maktab ma'lumotlari 10 ta state slice sifatida `App.jsx` da yashaydi:
`settings, classes, subjects, teachers, classSubjects, rooms, timeslots, lunchGroups,
shifts, schedule`. Context/Redux/Zustand yo'q — hammasi `pageProps` orqali pastga
uzatiladi, sahifalar `setXxx` setterlarini oladi.

Bu ro'yxat **uch joyda sinxron turishi shart**: `App.jsx` state'lari va `saveUserData`
effektlari, `readLocalData()`, hamda [cloudSync.js](src/services/cloudSync.js) dagi
`SYNC_KEYS` + `EMPTY`. Bittasi unutilsa — ma'lumot bulutga bormaydi yoki qaytishda
yo'qoladi.

### Local-first saqlash

localStorage — **asosiy ish nusxasi**, Supabase — zaxira va qurilmalararo ko'prik.

- Kalit formati: `smartjadval_user_<userId>_<key>` ([storageService.js](src/services/storageService.js)).
  Prefiks rejimga bog'liq — lokal rejimda `smartjadval_dev_` (pastga qarang).
- Kirishda localStorage'dan darhol o'qiladi va ilova OCHILADI; bulut fonda
  sinxronlanadi. To'liq ekranli kutish faqat qurilmada umuman ma'lumot bo'lmasa.
- Bulutda hammasi **bitta JSONB blob**: `schools` jadvalida `owner_id` bo'yicha bitta
  qator, ichida barcha SYNC_KEYS.
- `schedulePush()` debounce bilan yuboradi (1s kutish, 3s maksimal), `flushPush()`
  sahifa yopilishida/chiqishda majburan yuboradi.
- Yo'qolishdan himoya: `sync_meta_<userId>` da `lastHash` (djb2) saqlanadi. Kirishda
  mahalliy hash farq qilsa — "yuborilmagan o'zgarish bor" deb hisoblanadi va bulut
  ustidan YOZILMAYDI, aksincha avval push qilinadi (`syncOnLogin` → `"recovered"`).
- `classSubjects` "sim uchun" siqiladi (`encodeBlob`/`decodeBlob`, `WIRE_VERSION = 3`):
  `CS_DEFAULTS` dagi default qiymatlar tashlanadi, qaytarishda tiklanadi.
  **`classSubjects` yozuviga yangi maydon qo'shsangiz — `CS_DEFAULTS` ni ham yangilang**,
  aks holda qiymat bulutdan noto'g'ri tiklanadi.
- `demo@smartjadval.uz` hisobi hech qachon bulutga yozilmaydi; ma'lumoti bo'sh bo'lsa
  [demoData.js](src/utils/demoData.js) dan avtomatik to'ldiriladi.

**LOKAL REJIM** ([devMode.js](src/services/devMode.js)): `npm run dev` da
(`import.meta.env.DEV`) cloudSync butunlay o'chadi — na push, na pull. Bundan tashqari
localStorage kalitlari `smartjadval_dev_` prefiksiga o'tadi, ya'ni sinov ma'lumoti
alohida "quti"da yotadi va bulutga yuboradigan kod uni umuman ko'rmaydi.
Production build'da `isLocalOnly()` doim `false` — Vite uni compile paytida yo'q qiladi
(`function k(){return!1}`), shuning uchun saytda bu mexanizmning izi ham qolmaydi.
Lokal ma'lumotni tozalash: dev konsolida `smartjadvalWipeLocal()`. Bulutni ataylab yoqish:
`localStorage.setItem("smartjadval_cloud_sync","on")` yoki `.env.local` da
`VITE_CLOUD_SYNC=on`. Rejim ekranning chap pastida "🔌 Lokal rejim" nishoni bilan
ko'rinadi. **Diqqat:** bu qulf faqat maktab ma'lumoti sinxronizatsiyasiga tegishli —
auth (login), superadmin RPC lari va tuman moduli yozuvlari lokalda ham haqiqiy
Supabase bilan ishlaydi.

### Jadval ma'lumot tuzilmasi

```js
schedule[day][timeslotId] = [ lesson, ... ]   // day — DAYS dagi o'zbekcha nom
lesson = { subjectId, classId, classIds[], teacherId, roomId, groupPart?,
           blockSize?, blockIndex?, groupKey?, alternating?, altTeacherId?,
           locked?, manual? }
```

`DAYS` ("Dushanba"…"Shanba", [constants.js](src/utils/constants.js)) obyekt KALITI
sifatida ishlatiladi — nomini o'zgartirish saqlangan barcha jadvallarni buzadi.

Bir katakda bir nechta dars bo'lishi normal: guruhli fanlar (`splitEnabled`), daraja
guruhlari (`levelGroupEnabled`), parallel sinflar (`classIds` bir nechta), juft/toq
hafta almashinuvi (`weekAltEnabled`), fan almashinuvi (`swapEnabled`).

### Jadval dvigatellari

- [scheduleGenerator.js](src/utils/scheduleGenerator.js) (~3700 qator) — avtomatik
  generatsiya. `generateSchedule()` bir necha `generateScheduleAttempt()` chaqiradi
  (har birida boshqa `seed` va `strategy`), natijalarni `betterResult()` bilan
  leksikografik taqqoslaydi: tushmagan soat → joylangan soat → kun o'rtasidagi oyna →
  kunlik yuk notekisligi → yumshoq jarima. Vaqt byudjeti `budgetFor(totalHours)` da
  hisoblanadi va deadline'ga qarab erta to'xtaydi, shuning uchun UI qotib qolmaydi.
  `lockedSchedule` — 🔒 qulflangan darslar qayta generatsiyada joyida qoladi.
- [moveResolver.js](src/utils/moveResolver.js) — **qo'lda ko'chirish/almashtirishning
  yagona dvigateli**. Sinf setkasi ([Schedule.jsx](src/pages/Schedule.jsx)) va ustoz
  setkasi ([TeacherGrid.jsx](src/components/TeacherGrid.jsx)) ikkalasi ham shundan
  foydalanadi — ko'chirish qoidasi o'zgarsa, faqat shu faylga tegiladi.

Hard cheklovlar (ikkala dvigatelda ham): ustoz/sinf dam kuni, obed guruhlari, smena
(`timeslot.classIds`), ustoz/sinf/xona bandligi.

### Supabase

Klient [supabaseClient.js](src/services/supabaseClient.js) da — URL va **publishable**
anon kalit kodda hardcoded (env fayl yo'q, GitHub Pages statik hosting).
`flowType: 'pkce'` va `detectSessionInUrl: true` — parol tiklash havolasi shularsiz
ishlamaydi.

Jadvallar: `profiles`, `schools`, `districts`, `schedule_submissions`, `notifications`,
`audit_log`, `district_excel_data`.
RPC: `admin_set_subscription`, `admin_set_role`, `admin_set_status`, `admin_create_user`,
`admin_delete_user`, `admin_set_district`, `admin_set_location`, `admin_set_phone`,
`admin_update_profile`, `admin_revoke_subscription`, `clear_password_change_flag`.
Edge Function: **`quick-handler`** — admin tomonidan parol tiklash (`RESET_PASSWORD_FN`
konstantasi authService va districtService'da takrorlangan).

Xavfsizlik butunlay RLS va `security definer` funksiyalarda — frontend faqat so'rov
yuboradi, ruxsatni server tekshiradi.

⚠️ [supabase_setup.sql](supabase_setup.sql) faqat `profiles` + admin RPC larini qamraydi.
`schools`, `districts`, `district_excel_data` va tuman modulining migratsiyalari repoda
YO'Q — ular faqat Supabase loyihasida yashaydi. Shu jadvallarga ustun qo'shish kerak
bo'lsa, SQL Dashboard'da qo'lda bajariladi.

### Auth va obuna

[authService.js](src/services/authService.js): profil localStorage'da keshlanadi
(`smartjadval_auth_current_user`), shu sababli `getCurrentUser()` va
`checkSubscription()` **sinxron** — sahifalar ularni to'g'ridan-to'g'ri chaqiraveradi.

Kesh eskirishi mumkin: Supabase access token ~1 soatda tugaydi. Shuning uchun har bir
himoyalangan chaqiruvdan oldin `getFreshSession()` ishlatiladi va token `Authorization`
header'ida ANIQ yuboriladi. Yangi admin amali qo'shsangiz — shu naqshni takrorlang.

**Mehmon rejimi (paywall):** obuna tugagan bo'lsa `App.jsx` `<main>` ustida
`onClickCapture`/`onFocusCapture` bilan barcha bosishlarni ushlaydi va `PaywallModal`
ochadi. Qulfdan chiqarish uchun element `data-pw-allow` atributiga ega bo'lishi kerak.

### Excel import/export

`xlsx` (oddiy) va `xlsx-js-style` (rangli) — [excelUtils.js](src/utils/excelUtils.js)
dagi `loadXLSX()` / `loadStyledXLSX()` orqali olinadi (uslubli kutubxona dinamik import,
o'rnatilmagan bo'lsa faqat rangli eksport ishlamaydi).
Eksport modullari: `coloredScheduleExport` (rangli dars jadvali), `hourGridExport`
(soat setkasi), `analysisExport` (tahlil), `districtExcelService` (tuman moduli).

### Deploy

`main` ga push → [deploy.yml](.github/workflows/deploy.yml) → `npm run build` → GitHub
Pages. `CNAME` = `smartjadval.uz`, Vite `base: '/'`. `dist/` git'da kuzatilmaydi.

## Bilib qo'yish kerak bo'lgan tuzoqlar

- **Uslublar aralash:** `src/styles/*.css` global fayllar bor, lekin JSX ichida ham ko'p
  inline style. Mavjud faylning uslubiga ergashing, birini ikkinchisiga ko'chirmang.
- **O'lik kod:** [deviceLock.js](src/services/deviceLock.js) va
  [DeviceLockNotice.jsx](src/components/DeviceLockNotice.jsx) hech qayerdan import
  qilinmaydi — qurilma cheklovi olib tashlangan. Ularga qarab xulosa chiqarmang.
- **Ildizdagi `README_*.md` fayllari** — eski versiya eslatmalari (port 5173, demo
  parollari va h.k. eskirgan). Haqiqat manbai — kod va shu fayl.
- Fayllar katta (`scheduleGenerator.js` 3.7k qator, `Schedule.jsx` ~2k). Tahrirlashdan
  oldin kerakli bo'limni grep bilan toping, butun faylni qayta yozmang.
