export function loadData(key, fallback = []) {
  try {
    const raw = localStorage.getItem(`smartjadval_${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export function saveData(key, value) {
  localStorage.setItem(`smartjadval_${key}`, JSON.stringify(value));
}

export function removeData(key) {
  localStorage.removeItem(`smartjadval_${key}`);
}

export function loadUserData(userId, key, fallback = []) {
  if (!userId) return fallback;
  return loadData(`user_${userId}_${key}`, fallback);
}

export function saveUserData(userId, key, value) {
  if (!userId) return;
  saveData(`user_${userId}_${key}`, value);
}
