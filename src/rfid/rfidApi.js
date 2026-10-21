// Accesso ai dati della Biancheria RFID su Neon.
// Scrive SOLO nelle tabelle rfid_* (create da rfid-biancheria.sql).
// Clienti e ordini di LavaBnB vengono solo letti dall'app e qui salvati come riferimento (id + nome).
import { neon } from "../neonClient";

const T = { items: "rfid_items", deliveries: "rfid_deliveries", dItems: "rfid_delivery_items", moves: "rfid_movements" };
const nowIso = () => new Date().toISOString();
const uuid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

function fail(prefix, error) {
  const msg = (error && error.message) || String(error);
  return { ok: false, error: `${prefix}: ${msg}` };
}
const missingTables = (e) => !!e && (/does not exist|relation .*rfid_|PGRST205|42P01|schema cache/i.test(e.message || "") || e.code === "42P01" || e.code === "PGRST205");

export async function loadAll() {
  try {
    const [items, deliveries, dItems] = await Promise.all([
      neon.from(T.items).select("*").order("name"),
      neon.from(T.deliveries).select("*").order("created_at", { ascending: false }),
      neon.from(T.dItems).select("*"),
    ]);
    const err = items.error || deliveries.error || dItems.error;
    if (err) return { ok: false, setupNeeded: missingTables(err), error: "Non riesco a leggere la biancheria RFID: " + err.message };
    return { ok: true, items: items.data || [], deliveries: deliveries.data || [], deliveryItems: dItems.data || [] };
  } catch (e) {
    return { ok: false, setupNeeded: missingTables(e), error: "Errore di collegamento al database: " + (e.message || String(e)) };
  }
}

export async function loadMovements(epc) {
  const { data, error } = await neon.from(T.moves).select("*").eq("epc", epc).order("created_at", { ascending: false });
  if (error) return fail("Storico non disponibile", error);
  return { ok: true, movements: data || [] };
}

async function addMoves(rows) {
  if (!rows.length) return { ok: true };
  const { error } = await neon.from(T.moves).insert(rows.map((r) => ({ note: "", ...r })));
  return error ? fail("Movimenti non salvati", error) : { ok: true };
}

// ---------- Anagrafica ----------
export async function saveItemName(epc, name, existing) {
  if (existing) {
    const { error } = await neon.from(T.items).update({ name, updated_at: nowIso() }).eq("epc", epc);
    if (error) return fail("Nome non salvato", error);
    if (existing.name !== name) await addMoves([{ epc, type: "rinominato", note: `${existing.name} → ${name}` }]);
    return { ok: true };
  }
  const { error } = await neon.from(T.items).insert([{ epc, name, status: "magazzino" }]);
  if (error) return fail("Pezzo non registrato", error);
  await addMoves([{ epc, type: "registrato", note: name }]);
  return { ok: true };
}

// Si può eliminare solo un pezzo mai uscito; quelli con storico si rinominano soltanto.
export async function deleteItem(epc, hasHistory) {
  if (hasHistory) return { ok: false, error: "Questo pezzo ha già uno storico di consegne: puoi cambiarne il nome ma non eliminarlo." };
  const { error } = await neon.from(T.items).delete().eq("epc", epc);
  return error ? fail("Pezzo non eliminato", error) : { ok: true };
}

// Importa i nomi salvati sul telefono senza duplicare i tag già presenti.
export async function importNames(localNames, existingEpcs) {
  const have = new Set(existingEpcs);
  const rows = Object.entries(localNames)
    .filter(([epc, v]) => v && v.name && !have.has(epc))
    .map(([epc, v]) => ({ epc, name: v.name, status: "magazzino" }));
  if (!rows.length) return { ok: true, count: 0 };
  const { error } = await neon.from(T.items).insert(rows);
  if (error) return fail("Importazione non riuscita", error);
  await addMoves(rows.map((r) => ({ epc: r.epc, type: "registrato", note: "importato dal telefono" })));
  return { ok: true, count: rows.length };
}

// ---------- Consegne ----------
// mode "preparazione": i pezzi restano in lavanderia; "consegna": escono subito.
export async function createDelivery({ client, orderId, epcs, mode, note }) {
  const id = uuid();
  const t = nowIso();
  const delivered = mode === "consegna";
  const ref = { client_id: String(client.id), client_name: client.name, delivery_id: id, order_id: orderId ? String(orderId) : null };
  let r = await neon.from(T.deliveries).insert([
    { id, client_id: ref.client_id, client_name: ref.client_name, order_id: ref.order_id, status: delivered ? "consegnata" : "preparazione", note: note || "", delivered_at: delivered ? t : null },
  ]);
  if (r.error) return fail("Consegna non creata", r.error);
  r = await neon.from(T.dItems).insert(epcs.map((epc) => ({ delivery_id: id, epc, delivered_at: delivered ? t : null })));
  if (r.error) return fail("Pezzi della consegna non salvati", r.error);
  r = await neon
    .from(T.items)
    .update({ status: delivered ? "presso_cliente" : "preparazione", client_id: ref.client_id, client_name: ref.client_name, delivery_id: id, status_since: t, updated_at: t })
    .in("epc", epcs);
  if (r.error) return fail("Stato dei pezzi non aggiornato", r.error);
  const m = await addMoves(epcs.map((epc) => ({ epc, type: delivered ? "consegna" : "preparazione", client_id: ref.client_id, client_name: ref.client_name, delivery_id: id, order_id: ref.order_id })));
  if (!m.ok) return m;
  return { ok: true, id };
}

// Conferma una consegna preparata, con la lista finale dei pezzi (aggiunte e tolte comprese).
export async function confirmDelivery(delivery, finalEpcs, currentEpcs) {
  const t = nowIso();
  const id = delivery.id;
  const ref = { client_id: delivery.client_id, client_name: delivery.client_name, delivery_id: id, order_id: delivery.order_id };
  const removed = currentEpcs.filter((e) => !finalEpcs.includes(e));
  const added = finalEpcs.filter((e) => !currentEpcs.includes(e));
  let r;
  if (removed.length) {
    r = await neon.from(T.dItems).delete().eq("delivery_id", id).in("epc", removed);
    if (r.error) return fail("Pezzi tolti non aggiornati", r.error);
    r = await neon.from(T.items).update({ status: "magazzino", client_id: null, client_name: null, delivery_id: null, status_since: t, updated_at: t }).in("epc", removed);
    if (r.error) return fail("Pezzi tolti non aggiornati", r.error);
    await addMoves(removed.map((epc) => ({ epc, type: "annullato", ...ref, note: "tolto dalla consegna" })));
  }
  if (added.length) {
    r = await neon.from(T.dItems).insert(added.map((epc) => ({ delivery_id: id, epc })));
    if (r.error) return fail("Pezzi aggiunti non salvati", r.error);
  }
  if (!finalEpcs.length) return cancelDelivery(delivery, []);
  r = await neon.from(T.dItems).update({ delivered_at: t }).eq("delivery_id", id).in("epc", finalEpcs);
  if (r.error) return fail("Consegna non confermata", r.error);
  r = await neon.from(T.items).update({ status: "presso_cliente", client_id: ref.client_id, client_name: ref.client_name, delivery_id: id, status_since: t, updated_at: t }).in("epc", finalEpcs);
  if (r.error) return fail("Stato dei pezzi non aggiornato", r.error);
  r = await neon.from(T.deliveries).update({ status: "consegnata", delivered_at: t }).eq("id", id);
  if (r.error) return fail("Consegna non confermata", r.error);
  return addMoves(finalEpcs.map((epc) => ({ epc, type: "consegna", ...ref })));
}

export async function cancelDelivery(delivery, epcs) {
  const t = nowIso();
  let r;
  if (epcs.length) {
    r = await neon.from(T.items).update({ status: "magazzino", client_id: null, client_name: null, delivery_id: null, status_since: t, updated_at: t }).in("epc", epcs);
    if (r.error) return fail("Pezzi non riportati in magazzino", r.error);
    await addMoves(epcs.map((epc) => ({ epc, type: "annullato", client_id: delivery.client_id, client_name: delivery.client_name, delivery_id: delivery.id, order_id: delivery.order_id })));
  }
  r = await neon.from(T.deliveries).update({ status: "annullata", closed_at: t }).eq("id", delivery.id);
  return r.error ? fail("Consegna non annullata", r.error) : { ok: true };
}

// ---------- Ritiro ----------
// returnedItems: pezzi del cliente effettivamente scansionati.
// recovered: pezzi di ALTRI clienti scansionati qui che l'utente decide di registrare come rientrati.
// wrong: altri tag scansionati per errore (solo annotati nello storico).
export async function registerPickup({ client, returnedItems, recovered = [], wrong = [], deliveryItems, deliveries }) {
  const t = nowIso();
  const all = [...returnedItems.map((i) => ({ item: i, via: null })), ...recovered.map((i) => ({ item: i, via: client }))];
  // Rientro effettivo: chiude le righe di consegna aperte
  for (const { item } of all) {
    const r = await neon.from(T.dItems).update({ returned_at: t }).eq("epc", item.epc).is("returned_at", null);
    if (r.error) return fail("Rientro non registrato per " + item.name, r.error);
  }
  if (all.length) {
    const r = await neon
      .from(T.items)
      .update({ status: "ritirato", client_id: null, client_name: null, delivery_id: null, status_since: t, updated_at: t })
      .in("epc", all.map((a) => a.item.epc));
    if (r.error) return fail("Stato dei pezzi non aggiornato", r.error);
  }
  const moves = all.map(({ item, via }) => ({
    epc: item.epc,
    type: "ritiro",
    client_id: item.client_id,
    client_name: item.client_name,
    delivery_id: item.delivery_id,
    note: via ? `riconsegnato tramite ${via.name}` : "",
  }));
  for (const w of wrong) moves.push({ epc: w.epc, type: "reso_errato", client_id: String(client.id), client_name: client.name, note: w.text || "" });
  const m = await addMoves(moves);
  if (!m.ok) return m;
  // Chiude le consegne in cui tutti i pezzi sono rientrati
  const returnedNow = new Set(all.map((a) => a.item.epc));
  const touched = new Set(all.map((a) => a.item.delivery_id).filter(Boolean));
  for (const did of touched) {
    const rows = deliveryItems.filter((r) => r.delivery_id === did && r.delivered_at);
    const stillOut = rows.filter((r) => !r.returned_at && !returnedNow.has(r.epc));
    const d = deliveries.find((x) => x.id === did);
    if (d && stillOut.length === 0 && d.status === "consegnata") {
      await neon.from(T.deliveries).update({ status: "chiusa", closed_at: t }).eq("id", did);
    }
  }
  return { ok: true };
}

// ---------- Rientro in magazzino ----------
export async function toWarehouse(items) {
  if (!items.length) return { ok: true };
  const t = nowIso();
  const r = await neon.from(T.items).update({ status: "magazzino", client_id: null, client_name: null, delivery_id: null, status_since: t, updated_at: t }).in("epc", items.map((i) => i.epc));
  if (r.error) return fail("Rientro in magazzino non registrato", r.error);
  return addMoves(items.map((i) => ({ epc: i.epc, type: "rientro_magazzino" })));
}
