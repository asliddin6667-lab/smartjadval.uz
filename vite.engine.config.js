// =====================================================================
//  DVIGATEL QURILISHI — ALOHIDA BUILD
//
//  `npm run build:engine` shu konfiguratsiya bilan
//  src/engine/scheduleEngine.js ni O'ZI YETARLI (self-contained) ES
//  modulga aylantiradi: barcha bog'liqliklar (constants, pairGroups,
//  homeroom, swapGroups, subjectConflicts, parallelDays, scheduleCore)
//  ichkariga singdiriladi, chunki brauzer uni Blob URL orqali yuklaydi
//  va u yerda import'larni hal qiladigan hech narsa yo'q.
//
//  Natija `build/engine/engine.js` ga tushadi va `dist/` ga UMUMAN
//  kirmaydi — GitHub Pages'ga yuklanmaydi. Keyin scripts/packEngine.mjs
//  uni Edge Function ichiga base64 sifatida joylaydi.
// =====================================================================
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'build/engine',
    emptyOutDir: true,
    minify: true,
    target: 'es2022',
    lib: {
      entry: 'src/engine/scheduleEngine.js',
      formats: ['es'],
      fileName: () => 'engine.js',
    },
    rollupOptions: {
      // Hech narsa tashqarida qolmasin — modul yolg'iz ishlashi kerak
      external: [],
    },
  },
});
