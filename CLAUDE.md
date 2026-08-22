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

Maktab ma'lumotlari 11 ta state slice sifatida `App.jsx` da yashaydi:
`settings, classes, subjects, teachers, classSubjects, rooms, timeslots, lunchGroups,
shifts, schedule, savedSchedules`. Context/Redux/Zustand yo'q — hammasi `pageProps` orqali pastga
uzatiladi, sahifalar `setXxx` setterlarini oladi.

Bu ro'yxat **uch joyda sinxron turishi shart**: `App.jsx` state'lari va `saveUserData`
effektlari, `readLocalData()`, hamda [cloudSync.js](src/services/cloudSync.js) dagi
`SYNC_KEYS` + `EMPTY`. Bittasi unutilsa — ma'lumot bulutga bormaydi yoki qaytishda
yo'qoladi.

### Saqlash: bulut yagona haqiqat manbai (cloudSync v5)

**BULUT — YAGONA HAQIQAT MANBAI.** localStorage endi "asosiy nusxa" emas: u tezkor
kesh va internet uzilganda ko'rsatiladigan nusxa. Qaysi qurilmadan kirilmasin,
ekranda bulutdagi oxirgi holat turadi.

Fayllar:
[schoolBlob.js](src/services/schoolBlob.js) — ma'lumot shakli (SYNC_KEYS, EMPTY,
encode/decode, hash), [cloudSync.js](src/services/cloudSync.js) — sinxronizatsiya
dvigateli, [versionService.js](src/services/versionService.js) — bulutdagi versiya
tarixi, [Backups.jsx](src/pages/Backups.jsx) — "Zaxira nusxalar" sahifasi,
[SyncBadge.jsx](src/components/SyncBadge.jsx) — o'ng pastdagi holat nishoni.

- Kalit formati: `smartjadval_user_<userId>_<key>` ([storageService.js](src/services/storageService.js)).
  Prefiks rejimga bog'liq — lokal rejimda `smartjadval_dev_` (pastga qarang).
- Bulutda hammasi **bitta JSONB blob**: `schools` jadvalida `owner_id` bo'yicha bitta
  qator, ichida barcha SYNC_KEYS + `_rev`/`_ts`/`_dev`.
- **Yozish — CAS (compare-and-swap).** `pushToCloud()`
  `UPDATE ... WHERE owner_id = ? AND data->>'_rev' = <baseRev>` yuboradi. Bulut
  oldinga ketgan bo'lsa 0 qator o'zgaradi va push `stale` qaytaradi — ya'ni eski
  qurilma yangi ma'lumot ustidan **yoza olmaydi**. CAS so'rovining o'zi rad etilsa
  (PostgREST JSON filtrni qo'llamasa) `guardedUpsert()` ga o'tiladi — u ham avval
  `readCloudHead()` bilan bulut holatini tekshiradi.
- **Konflikt — kalitma-kalit uchtomonlama birlashtirish** (`threeWayMerge`,
  `reconcile`). `sync_meta_<userId>.keyHashes` — biz oxirgi ko'rgan bulut holatining
  HAR BIR kaliti hash'i. Har kalit uchun: faqat mahalliy o'zgargan → mahalliy qoladi;
  faqat bulut o'zgargan → bulutniki; ikkalasi ham → **bulut ustun**, mahalliy nusxa
  esa versiya tarixiga va `conflict_<userId>` ga zaxiraga tushadi.
  **Qurilma soati ishlatilmaydi** — noto'g'ri sana ma'lumotni yo'qota olmaydi
  (v4 da aynan shu ma'lumot yo'qolishiga sabab bo'lgan).
- Avtosaqlash: `schedulePush()` debounce (0.7s kutish, 2.5s maksimal) →
  `pushWithRetry()` (4 urinish) → `startAutoSync()` "qorovul"i har 10 soniyada
  yuborilmagan o'zgarishni jo'natadi yoki bulutni tekshiradi (oyna faol bo'lganda)
  → `flushPush()` sahifa yopilishida/chiqishda → `beforeunload` ogohlantirishi.
- `pushToCloud()` `updated_at` ni **qo'lda yozadi**. `schools` jadvalida UPDATE uchun
  trigger yo'q — busiz u INSERT vaqtida qotib qolardi va boshqa qurilma "bulut
  o'zgarmagan" deb ma'lumotni umuman tortmasdi.
- `checkRemote()` boshqa qurilmadagi o'zgarishni ekranga tushiradi
  (`onRemoteUpdate` → App.jsx). Mahalliyda yuborilmagan o'zgarish bo'lsa — tegmaydi
  (avval o'sha ketadi).
- **Internet yo'q → FAQAT O'QISH.** Sinxronizatsiya holati `offline`/`error` bo'lsa
  App.jsx `<main>` ustidagi `guardClick`/`guardFocus` barcha tahrirlashni bloklaydi
  va qizil banner chiqaradi (mehmon rejimi bilan bir xil naqsh; qulfdan chiqarish
  atributi — `data-sync-allow`). Bir martalik uzilishda qulflanmaydi — ketma-ket
  ikki muvaffaqiyatsiz tekshiruv kerak (`headFailures`).
- App.jsx `syncDone` bayrog'i: kirishdagi sinxronizatsiya tugamaguncha `schedulePush`
  chaqirilmaydi va tahrirlash ham kutdiriladi (`syncPending`).
- `SYNC_KEYS` ga yangi kalit qo'shsangiz — hozirgi ro'yxatni `LEGACY_KEY_SETS` ga
  ko'chiring (ikkalasi ham schoolBlob.js da). Aks holda `lastHash` barcha
  qurilmalarda mos kelmay qoladi.
- `classSubjects` "sim uchun" siqiladi (`encodeBlob`/`decodeBlob`, `WIRE_VERSION = 3`):
  `CS_DEFAULTS` dagi default qiymatlar tashlanadi, qaytarishda tiklanadi.
  **`classSubjects` yozuviga yangi maydon qo'shsangiz — `CS_DEFAULTS` ni ham yangilang**,
  aks holda qiymat bulutdan noto'g'ri tiklanadi.
- `demo@smartjadval.uz` hisobi hech qachon bulutga yozilmaydi; ma'lumoti bo'sh bo'lsa
  [demoData.js](src/utils/demoData.js) dan avtomatik to'ldiriladi.

### Zaxira nusxalar (versiya tarixi)

`schools` da faqat OXIRGI holat turadi. Har bir muvaffaqiyatli yuborishdan keyin
holatning to'liq nusxasi `school_backups` jadvaliga tushadi
([versionService.js](src/services/versionService.js)):

- avtomatik zaxira — har 4 daqiqada bir martadan ko'p emas (`AUTO_GAP`);
- **majburiy** zaxira — konfliktda yutqazgan nusxa, tiklashdan oldingi holat,
  "💾 Hozirgi holatni zaxiraga olish" tugmasi;
- server trigger har foydalanuvchida oxirgi **40** tasini qoldiradi;
- "Zaxira nusxalar" sahifasi ro'yxatni ko'rsatadi va `restoreBlob()` orqali
  tiklaydi (tiklashdan oldingi holat ham avtomatik arxivlanadi — orqaga qaytish
  mumkin). Shu qurilmada qolgan `conflict_<userId>` zaxirasi ham shu sahifada
  ko'rinadi.

SQL: [school_backups_setup.sql](school_backups_setup.sql) — Supabase SQL Editor'da
bir marta ishga tushiriladi. Jadval bo'lmasa versiya tarixi jimgina o'chadi
(sinxronizatsiya baribir ishlayveradi), sahifada esa ogohlantirish chiqadi.

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
hafta almashinuvi (`weekAltEnabled`), fan almashinuvi (`swapEnabled`),
**bir vaqtda 2 fan** (`pairEnabled`).

**Bir vaqtda 2 fan (`pairEnabled`)** — sinf ikkiga bo'linadi va guruhlar AYNI BIR
SOATDA turli fan o'qiydi (masalan 1-guruh Ona tili, 2-guruh Rus tili). `swapEnabled`
dan farqi: guruhlar almashmaydi va 2 soatlik blok talab qilinmaydi.
Sozlama maydonlari: `pairEnabled`, `pairSubjectId`, `pairTeacherId`, `pairRoomId`
(guruh nomlari — `groupName1`/`groupName2`, 1-guruh ustozi/xonasi — `teacherId`/`roomId`).
Generatorda `type: "pair"` so'rovi; ikkala dars yozuvi `pairKey` bilan bog'lanadi —
shu kalit ularni [Schedule.jsx](src/pages/Schedule.jsx) `groupLessons()` da BITTA
karta qiladi va [moveResolver.js](src/utils/moveResolver.js) `sameCard()` da birga
ko'chiradi. Kunlik fan limiti uchun 2-fan `swapSubjectId` sifatida uzatiladi.
2-fanni "Sinf fanlari" ro'yxatida ALOHIDA belgilash shart emas (belgilansa — soat
ikki marta hisoblanadi, UI ogohlantiradi).

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

**Ustoz va xona bandligi VAQT bo'yicha, slot id bo'yicha emas.** Ikki smena bir xil
soatda o'tishi mumkin (id boshqa, `startTime` bir xil) — shuning uchun bandlik
`slotsOverlap()` bilan aniqlanadigan «vaqt bandi»ga bog'langan (`buildTimeBuckets()`,
[scheduleGenerator.js](src/utils/scheduleGenerator.js)). Generatorda `teacherGrid` va
`roomGrid` indeksi `d * TB + tsBucket[i]`, `buildValidationReport` esa `tSeen`/`rSeen`
ni band bo'yicha yuritadi; [moveResolver.js](src/utils/moveResolver.js) dagi `cellsAt()`
vaqti kesishadigan barcha kataklarni birga o'qiydi. **Sinf** bandligi va ustoz
setkasidagi qulflar (`blockedSlots`) avvalgidek slot bo'yicha qoladi.

### Saqlangan jadvallar

Dars jadvali sahifasidagi «💾 Saqlash» tugmasi joriy jadvalning TO'LIQ nusxasini nom
bilan `savedSchedules` massiviga qo'shadi ([savedSchedules.js](src/utils/savedSchedules.js)
dagi `upsertSaved`). Nusxalar [SavedSchedules.jsx](src/pages/SavedSchedules.jsx)
sahifasida ko'rinadi — u yerdan qayta yuklash (joriy jadval ustiga), nomini
o'zgartirish, Excel'ga chiqarish yoki o'chirish mumkin.

Har bir nusxa butun jadvalni saqlaydi, shuning uchun `MAX_SAVED = 20` cheklovi bor —
aks holda localStorage kvotasi va bulutga ketadigan JSONB blob shishib ketadi.
Saqlash oynasi ([SaveScheduleModal.jsx](src/components/SaveScheduleModal.jsx)) ikkala
sahifada ham bir xil ishlatiladi.

### Supabase

Klient [supabaseClient.js](src/services/supabaseClient.js) da — URL va **publishable**
anon kalit kodda hardcoded (env fayl yo'q, GitHub Pages statik hosting).
`flowType: 'pkce'` va `detectSessionInUrl: true` — parol tiklash havolasi shularsiz
ishlamaydi.

Jadvallar: `profiles`, `schools`, `school_backups`, `districts`, `schedule_submissions`, `notifications`,
`audit_log`, `district_excel_data`, `standard_hours`.
RPC: `admin_set_subscription`, `admin_set_role`, `admin_set_status`, `admin_create_user`,
`admin_delete_user`, `admin_set_district`, `admin_set_location`, `admin_set_phone`,
`admin_update_profile`, `admin_revoke_subscription`, `clear_password_change_flag`.
Edge Function: **`quick-handler`** — admin tomonidan parol tiklash (`RESET_PASSWORD_FN`
konstantasi authService va districtService'da takrorlangan).

Xavfsizlik butunlay RLS va `security definer` funksiyalarda — frontend faqat so'rov
yuboradi, ruxsatni server tekshiradi.

### Standart soatlar (superadmin)

Superadmin "Standart soatlar" sahifasida ([StandardHours.jsx](src/pages/StandardHours.jsx))
qaysi sinfda qaysi fan necha soat bo'lishini belgilaydi. Ma'lumot `standard_hours`
jadvalida bitta JSONB qatorda (`id = global`) yotadi va HAMMA foydalanuvchiga o'qish
uchun ochiq (yozish — faqat superadmin, RLS `is_admin()`).
[standardHoursService.js](src/services/standardHoursService.js) uni localStorage'ga
keshlaydi; bulut ochilmasa kesh, u ham bo'lmasa [curriculum.js](src/utils/curriculum.js)
dagi `DEFAULT_CURRICULUM` ishlatiladi. "Sinf fanlari" sahifasidagi "⚡ Standart soatlar"
tugmasi shu rejani qo'llaydi (fan nomi `aliases` orqali solishtiriladi).
Jadval SQL i: [standard_hours_setup.sql](standard_hours_setup.sql) — Supabase SQL
Editor'da bir marta ishga tushiriladi.

⚠️ [supabase_setup.sql](supabase_setup.sql) faqat `profiles` + admin RPC larini qamraydi.
Repoda yana ikkita SQL bor: [standard_hours_setup.sql](standard_hours_setup.sql) va
[school_backups_setup.sql](school_backups_setup.sql) (versiya tarixi).
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
