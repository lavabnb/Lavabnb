// Archivio dei nomi assegnati ai tag RFID.
// Salvato nel browser (localStorage) sotto una chiave dedicata: non tocca il database Neon
// né gli altri dati di LavaBnB. Esportazione/importazione in JSON per copie di sicurezza.

const KEY = "lavabnb-rfid-nomi-v1";

export function storageAvailable() {
  try {
    localStorage.setItem(KEY + "-test", "1");
    localStorage.removeItem(KEY + "-test");
    return true;
  } catch (e) {
    return false;
  }
}

export function loadNames() {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) {
    return {};
  }
}

export function saveNames(names) {
  try {
    localStorage.setItem(KEY, JSON.stringify(names));
    return true;
  } catch (e) {
    return false;
  }
}

export function exportNamesJson(names) {
  return JSON.stringify(
    { tipo: "lavabnb-rfid-nomi", versione: 1, esportato: new Date().toISOString(), nomi: names },
    null,
    2
  );
}

// Restituisce { names, count } unendo i nomi importati a quelli esistenti.
export function importNamesJson(text, current) {
  const data = JSON.parse(text);
  const incoming = data && data.nomi ? data.nomi : data;
  const names = { ...current };
  let count = 0;
  for (const [k, v] of Object.entries(incoming || {})) {
    if (!/^[0-9A-F]+$/i.test(k) || !v || typeof v.name !== "string" || !v.name.trim()) continue;
    names[k.toUpperCase()] = {
      name: v.name.trim().slice(0, 80),
      created: v.created || Date.now(),
      updated: v.updated || Date.now(),
      lastSeen: v.lastSeen || null,
    };
    count++;
  }
  return { names, count };
}

export function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
