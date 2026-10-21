// Regole del ciclo di vita della biancheria RFID (funzioni pure, senza database).
//
// Stati di un pezzo:
//   magazzino       → pulito, disponibile
//   preparazione    → assegnato a una consegna non ancora partita
//   presso_cliente  → consegnato, non ancora rientrato
//   ritirato        → rientrato dal cliente, da riportare in magazzino
// Un CICLO è completato quando un pezzo consegnato rientra davvero (scansionato al ritiro).

export const STATUS_LABEL = {
  magazzino: "In magazzino",
  preparazione: "In preparazione",
  presso_cliente: "Presso il cliente",
  ritirato: "Ritirato (da riportare in magazzino)",
};
export const STATUS_COLOR = {
  magazzino: "bg-emerald-500",
  preparazione: "bg-amber-500",
  presso_cliente: "bg-blue-500",
  ritirato: "bg-purple-500",
};
export const MOVEMENT_LABEL = {
  registrato: "Registrato",
  rinominato: "Nome modificato",
  preparazione: "In preparazione",
  consegna: "Consegnato",
  ritiro: "Ritirato dal cliente",
  rientro_magazzino: "Rientrato in magazzino",
  reso_errato: "Restituito per errore",
  annullato: "Consegna annullata",
};

const DAY = 86400000;
export const daysBetween = (from, to = Date.now()) =>
  Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / DAY);
export const fmtDays = (d) => {
  if (d < 1) return "meno di 1 giorno";
  const n = Math.floor(d);
  return n === 1 ? "1 giorno" : `${n} giorni`;
};

// Statistiche di un pezzo calcolate dalle righe di consegna (unica fonte di verità).
export function itemStats(epc, deliveryItems, deliveriesById, now = Date.now()) {
  const rows = deliveryItems.filter((r) => r.epc === epc && r.delivered_at);
  const perClient = {};
  let cycles = 0;
  let totalDays = 0;
  let currentDays = null;
  for (const r of rows) {
    const d = deliveriesById[r.delivery_id];
    const key = d ? d.client_id : "?";
    if (!perClient[key]) perClient[key] = { clientId: key, clientName: d ? d.client_name : "—", cycles: 0, days: 0, open: false };
    const days = daysBetween(r.delivered_at, r.returned_at || now);
    perClient[key].days += days;
    totalDays += days;
    if (r.returned_at) {
      cycles++;
      perClient[key].cycles++;
    } else {
      perClient[key].open = true;
      currentDays = days;
    }
  }
  return {
    cycles,
    totalDays,
    currentDays,
    perClient: Object.values(perClient).sort((a, b) => b.days - a.days),
  };
}

// Controllo dei pezzi scansionati per una consegna.
export function classifyForDelivery(scannedEpcs, itemsByEpc, deliveryId = null) {
  const ok = [];
  const problems = [];
  for (const epc of scannedEpcs) {
    const it = itemsByEpc[epc];
    if (!it) problems.push({ epc, reason: "non_registrato", text: "Tag non registrato: registralo prima nella sezione Registrazione tag." });
    else if (it.status === "presso_cliente") problems.push({ epc, item: it, reason: "fuori", text: `Risulta ancora presso ${it.client_name || "un cliente"}: registra prima il ritiro.` });
    else if (it.status === "preparazione" && it.delivery_id !== deliveryId) problems.push({ epc, item: it, reason: "altra_consegna", text: `È già in preparazione per ${it.client_name || "un'altra consegna"}.` });
    else ok.push({ epc, item: it, warn: it.status === "ritirato" ? "Ritirato ma non ancora riportato in magazzino." : "" });
  }
  return { ok, problems };
}

// Confronto al ritiro: pezzi attesi dal cliente vs pezzi scansionati.
export function classifyPickup(scannedEpcs, clientId, items) {
  const scanned = new Set(scannedEpcs);
  const byEpc = Object.fromEntries(items.map((i) => [i.epc, i]));
  const expected = items.filter((i) => i.status === "presso_cliente" && String(i.client_id) === String(clientId));
  const returned = expected.filter((i) => scanned.has(i.epc));
  const missing = expected.filter((i) => !scanned.has(i.epc));
  const wrong = [];
  for (const epc of scanned) {
    const it = byEpc[epc];
    if (it && it.status === "presso_cliente" && String(it.client_id) === String(clientId)) continue;
    if (!it) wrong.push({ epc, reason: "non_registrato", text: "Tag non registrato" });
    else if (it.status === "presso_cliente") wrong.push({ epc, item: it, reason: "altro_cliente", text: `Era stato consegnato a ${it.client_name || "un altro cliente"}` });
    else if (it.status === "preparazione") wrong.push({ epc, item: it, reason: "in_preparazione", text: "Risulta in preparazione, non consegnato" });
    else wrong.push({ epc, item: it, reason: "non_uscito", text: it.status === "ritirato" ? "Già ritirato in precedenza" : "Risulta in magazzino, non consegnato" });
  }
  return { expected, returned, missing, wrong };
}

// Pezzi presso i clienti da più di `thresholdDays` giorni.
export function overdueItems(items, thresholdDays, now = Date.now()) {
  return items
    .filter((i) => i.status === "presso_cliente" && daysBetween(i.status_since, now) >= thresholdDays)
    .map((i) => ({ ...i, days: daysBetween(i.status_since, now) }))
    .sort((a, b) => b.days - a.days);
}

// Riepilogo per cliente.
export function clientSummary(items, deliveries, thresholdDays, now = Date.now()) {
  const map = {};
  const get = (id, name) => (map[id] = map[id] || { clientId: id, clientName: name || "—", out: 0, overdue: 0, oldestDays: 0, openDeliveries: 0 });
  for (const i of items) {
    if (i.status !== "presso_cliente") continue;
    const c = get(String(i.client_id), i.client_name);
    const d = daysBetween(i.status_since, now);
    c.out++;
    if (d >= thresholdDays) c.overdue++;
    c.oldestDays = Math.max(c.oldestDays, d);
  }
  for (const d of deliveries) {
    if (d.status === "consegnata" || d.status === "preparazione") get(String(d.client_id), d.client_name).openDeliveries++;
  }
  return Object.values(map).sort((a, b) => b.overdue - a.overdue || b.out - a.out);
}
