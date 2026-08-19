// Node uchun kichik "resolve" ilgagi: src/ ichidagi importlar Vite uslubida
// kengaytmasiz yozilgan ("./constants"), Node esa aniq fayl nomini talab qiladi.
// Topilmasa — ".js" qo'shib qayta urinamiz.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      return next(`${specifier}.js`, context);
    }
    throw err;
  }
}
