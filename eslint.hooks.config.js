// =====================================================================
//  HOOK TARTIBI TEKSHIRUVI — deploy'dan oldin majburiy
//
//  `npm run check:hooks` — faqat `react-hooks/rules-of-hooks` qoidasi.
//  Hook (`useState`, `useEffect`, ...) shartli yoki erta `return` dan
//  keyin chaqirilsa, ishlab turgan saytda React #300/#310 xatosi
//  chiqadi va foydalanuvchi "Ilovada kutilmagan xato" ekranini ko'radi
//  (28.10.2026 da App.jsx da aynan shu bo'lgan). Bunday xato brauzerda
//  faqat ma'lum holatda (birinchi kirish, chiqish) ko'rinadi, shuning
//  uchun uni statik tekshiruv ushlashi kerak.
//
//  Asosiy `eslint.config.js` dagi to'liq to'plam emas — u yerda
//  tozalanmagan boshqa ogohlantirishlar deploy'ni to'sib qo'ymasin.
//  Bu fayl .github/workflows/deploy.yml dan chaqiriladi.
// =====================================================================
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'public', 'scripts', 'supabase']),
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
    },
  },
])
