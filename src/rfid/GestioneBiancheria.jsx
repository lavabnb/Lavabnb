// Gestione operativa della biancheria RFID: consegne, ritiri, magazzino, pezzi e clienti.
// Riconosce automaticamente i tag già registrati (tabella rfid_items).
import React, { useEffect, useMemo, useState } from "react";
import { Bluetooth, Loader2, Play, Square, Check, ChevronLeft, Bell } from "lucide-react";
import { useScan } from "./useScan";
import * as rapi from "./rfidApi";
import {
  STATUS_LABEL,
  STATUS_COLOR,
  MOVEMENT_LABEL,
  itemStats,
  classifyForDelivery,
  classifyPickup,
  overdueItems,
  clientSummary,
  daysBetween,
  fmtDays,
} from "./rfidLogic";

const THRESHOLD_KEY = "lavabnb-rfid-soglia-giorni";
const btnPrimary = "flex-1 bg-gray-900 text-white rounded-xl py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-40";
const btnSecondary = "flex-1 border border-gray-300 text-gray-800 rounded-xl py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-40";
const pz = (n) => (n === 1 ? "1 pezzo" : `${n} pezzi`);
const selectCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white";

function Notice({ kind = "warn", children }) {
  const cls = kind === "bad" ? "bg-rose-50 border-rose-100 text-rose-700" : kind === "ok" ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-amber-50 border-amber-100 text-amber-800";
  return <div className={`border rounded-2xl p-4 text-sm mb-4 ${cls}`}>{children}</div>;
}
function Section({ title, count, tone = "gray", children, testid }) {
  const color = { green: "text-emerald-600", amber: "text-amber-600", red: "text-rose-600", blue: "text-blue-600", gray: "text-gray-900" }[tone];
  return (
    <div className="border border-gray-200 rounded-2xl p-4 mb-4" data-testid={testid}>
      <div className={`font-bold mb-2 flex items-center justify-between ${color}`}>
        <span>{title}</span>
        {count !== undefined && <span className="tabular-nums">{count}</span>}
      </div>
      {children}
    </div>
  );
}
function Row({ name, epc, sub, right, onClick }) {
  const Tagname = onClick ? "button" : "div";
  return (
    <Tagname onClick={onClick} className="w-full text-left flex items-start justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900 break-words">{name}</div>
        <div className="font-mono text-[11px] text-gray-400 break-all">{epc}</div>
        {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
      </div>
      {right && <div className="shrink-0 text-xs text-right">{right}</div>}
    </Tagname>
  );
}
function StatusBadge({ status }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
      <span className={`w-2 h-2 rounded-full ${STATUS_COLOR[status] || "bg-slate-400"}`} />
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// Barra del lettore condivisa dalle schermate operative
function ReaderBar({ scan, hint }) {
  const label = { idle: "Non collegato", searching: "Ricerca lettore…", connecting: "Collegamento…", connected: "Collegato" + (scan.conn.name ? " · " + scan.conn.name : ""), disconnected: "Scollegato", error: "Errore di collegamento" }[scan.conn.state];
  const dot = scan.connected ? "bg-emerald-500" : scan.conn.state === "error" ? "bg-rose-500" : ["idle", "disconnected"].includes(scan.conn.state) ? "bg-slate-400" : "bg-amber-500";
  return (
    <div className="border border-gray-200 rounded-2xl p-4 mb-4">
      <div className="flex flex-wrap items-center gap-2 text-sm mb-3">
        <span className="inline-flex items-center gap-2 font-medium text-gray-800" data-testid="g-conn">
          <span className={`w-2.5 h-2.5 rounded-full ${dot}`} /> {label}
        </span>
        <span className="inline-flex items-center gap-2 font-medium text-gray-800 ml-auto" data-testid="g-inv">
          <span className={`w-2.5 h-2.5 rounded-full ${scan.running ? "bg-blue-500" : "bg-slate-400"}`} />
          {scan.busy === "power" ? "Imposto la potenza…" : scan.running ? "In lettura…" : "Fermo"}
        </span>
      </div>
      {!scan.connected ? (
        <button className={btnPrimary + " w-full"} onClick={scan.connect} disabled={scan.busy === "connect"}>
          {scan.busy === "connect" ? <Loader2 size={16} className="animate-spin" /> : <Bluetooth size={16} />} Collega lettore
        </button>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3">
            <label htmlFor="g-power" className="text-xs text-gray-500 shrink-0">Potenza</label>
            <input id="g-power" type="range" min="5" max="30" value={scan.power} onChange={(e) => scan.setPower(Number(e.target.value))} className="flex-1 accent-gray-900" />
            <span className="text-sm font-bold w-14 text-right tabular-nums">{scan.power} dBm</span>
          </div>
          <div className="flex gap-3">
            <button className={btnPrimary} onClick={scan.start} disabled={scan.running}>
              <Play size={16} /> Scansiona
            </button>
            <button className={`${btnSecondary} border-rose-300 text-rose-600`} onClick={scan.stop}>
              <Square size={16} /> Ferma
            </button>
          </div>
        </>
      )}
      {hint && <p className="text-xs text-gray-400 mt-2">{hint}</p>}
      {scan.error && <p className="text-xs text-rose-600 mt-2" data-testid="g-error">{scan.error}</p>}
      {scan.notice && <p className="text-xs text-amber-700 mt-2">{scan.notice}</p>}
    </div>
  );
}

function ClientSelect({ clients, value, onChange, counts }) {
  const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name, "it"));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls} aria-label="Cliente" data-testid="client-select">
      <option value="">Scegli il cliente…</option>
      {sorted.map((c) => (
        <option key={c.id} value={String(c.id)}>
          {c.name}
          {counts && counts[String(c.id)] ? ` · ${counts[String(c.id)]} pezzi presso il cliente` : ""}
        </option>
      ))}
    </select>
  );
}

// ======================= CONSEGNA =======================
function ConsegnaTab({ scan, rfid, itemsByEpc, clients, orders, run }) {
  const [clientId, setClientId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [editing, setEditing] = useState(null); // consegna in preparazione aperta
  const [removed, setRemoved] = useState(() => new Set());
  const client = clients.find((c) => String(c.id) === clientId);
  const clientOrders = orders.filter((o) => String(o.clientId) === clientId).sort((a, b) => String(b.createdDate).localeCompare(String(a.createdDate)));
  const prepared = rfid.deliveries.filter((d) => d.status === "preparazione" && (!clientId || d.client_id === clientId));
  const currentEpcs = editing ? rfid.deliveryItems.filter((r) => r.delivery_id === editing.id).map((r) => r.epc) : [];
  const cart = [...new Set([...currentEpcs, ...scan.scanned.keys()])].filter((e) => !removed.has(e));
  const { ok, problems } = classifyForDelivery(cart, itemsByEpc, editing ? editing.id : null);

  const reset = () => {
    scan.clear();
    setRemoved(new Set());
    setEditing(null);
  };
  const openPrepared = (d) => {
    scan.clear();
    setRemoved(new Set());
    setEditing(d);
    setClientId(d.client_id);
    setOrderId(d.order_id || "");
  };
  const okEpcs = ok.map((o) => o.epc);

  async function save(mode) {
    let res;
    if (editing) res = await rapi.confirmDelivery(editing, okEpcs, currentEpcs);
    else res = await rapi.createDelivery({ client, orderId, epcs: okEpcs, mode });
    const done = await run(res, mode === "consegna" ? `Consegna registrata: ${okEpcs.length} pezzi presso ${client ? client.name : editing.client_name}.` : `Preparazione salvata: ${okEpcs.length} pezzi per ${client.name}.`);
    if (done) reset();
  }
  async function cancelPrepared() {
    const done = await run(await rapi.cancelDelivery(editing, currentEpcs), "Preparazione annullata: i pezzi sono tornati in magazzino.");
    if (done) reset();
  }

  return (
    <div>
      {editing ? (
        <Notice kind="warn">
          Stai modificando la preparazione per <b>{editing.client_name}</b>
          {editing.order_id ? ` (ordine #${editing.order_id})` : ""}. Scansiona per aggiungere pezzi, poi conferma la consegna.
          <button className="block mt-2 font-semibold underline" onClick={reset}>Chiudi senza salvare</button>
        </Notice>
      ) : (
        <div className="border border-gray-200 rounded-2xl p-4 mb-4">
          <div className="text-xs text-gray-500 mb-1">Cliente</div>
          <ClientSelect clients={clients} value={clientId} onChange={(v) => { setClientId(v); setOrderId(""); }} />
          <div className="text-xs text-gray-500 mt-3 mb-1">Ordine LavaBnB (facoltativo)</div>
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={selectCls} disabled={!clientId} aria-label="Ordine" data-testid="order-select">
            <option value="">Nessun ordine</option>
            {clientOrders.map((o) => (
              <option key={o.id} value={String(o.id)}>
                #{o.id} · {o.createdDate} · {o.status}
              </option>
            ))}
          </select>
        </div>
      )}

      {!editing && prepared.length > 0 && (
        <Section title="Consegne in preparazione" count={prepared.length} tone="amber">
          {prepared.map((d) => {
            const n = rfid.deliveryItems.filter((r) => r.delivery_id === d.id).length;
            return <Row key={d.id} name={d.client_name} epc={`${n} pezzi${d.order_id ? ` · ordine #${d.order_id}` : ""}`} sub={`preparata il ${new Date(d.created_at).toLocaleString("it-IT")}`} right={<span className="font-semibold text-gray-900">Apri</span>} onClick={() => openPrepared(d)} />;
          })}
        </Section>
      )}

      <ReaderBar scan={scan} hint="Scansiona i pezzi da consegnare: vengono riconosciuti in automatico." />

      <Section title="Pezzi pronti per la consegna" count={ok.length} tone="green" testid="delivery-ok">
        {ok.length === 0 && <p className="text-gray-400 text-sm">Nessun pezzo ancora.</p>}
        {ok.map(({ epc, item, warn }) => (
          <Row key={epc} name={item.name} epc={epc} sub={warn} right={<button aria-label="Togli" onClick={() => setRemoved((s) => new Set(s).add(epc))} className="text-rose-600 font-semibold">Togli</button>} />
        ))}
      </Section>
      {problems.length > 0 && (
        <Section title="Non consegnabili" count={problems.length} tone="red" testid="delivery-problems">
          {problems.map((p) => (
            <Row key={p.epc} name={p.item ? p.item.name : "Tag sconosciuto"} epc={p.epc} sub={p.text} />
          ))}
        </Section>
      )}

      <div className="flex gap-3 mb-6">
        {editing ? (
          <>
            <button className={btnSecondary} onClick={cancelPrepared}>Annulla preparazione</button>
            <button className={btnPrimary} onClick={() => save("consegna")} disabled={!ok.length}>
              <Check size={16} /> Conferma consegna ({ok.length})
            </button>
          </>
        ) : (
          <>
            <button className={btnSecondary} onClick={() => save("preparazione")} disabled={!client || !ok.length}>Salva in preparazione</button>
            <button className={btnPrimary} onClick={() => save("consegna")} disabled={!client || !ok.length}>
              <Check size={16} /> Conferma consegna ({ok.length})
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ======================= RITIRO =======================
function RitiroTab({ scan, rfid, clients, outCounts, run }) {
  const [clientId, setClientId] = useState("");
  const [recover, setRecover] = useState(() => new Set());
  const client = clients.find((c) => String(c.id) === clientId);
  const scannedEpcs = [...scan.scanned.keys()];
  const res = useMemo(() => classifyPickup(scannedEpcs, clientId, rfid.items), [scannedEpcs.join(","), clientId, rfid.items]);

  async function confirm() {
    const recovered = res.wrong.filter((w) => w.reason === "altro_cliente" && recover.has(w.epc)).map((w) => w.item);
    const wrong = res.wrong.filter((w) => !(w.reason === "altro_cliente" && recover.has(w.epc)));
    const out = await rapi.registerPickup({ client, returnedItems: res.returned, recovered, wrong, deliveryItems: rfid.deliveryItems, deliveries: rfid.deliveries });
    const n = res.returned.length + recovered.length;
    const msg = `Ritiro registrato: ${pz(n)} ${n === 1 ? "rientrato" : "rientrati"}.` + (res.missing.length ? ` ${pz(res.missing.length)} ${res.missing.length === 1 ? "resta assegnato" : "restano assegnati"} a ${client.name} finché non ${res.missing.length === 1 ? "rientra" : "rientrano"}.` : " Tutti i pezzi del cliente sono rientrati.");
    if (await run(out, msg)) {
      scan.clear();
      setRecover(new Set());
    }
  }

  return (
    <div>
      <div className="border border-gray-200 rounded-2xl p-4 mb-4">
        <div className="text-xs text-gray-500 mb-1">Cliente da cui ritiri</div>
        <ClientSelect clients={clients} value={clientId} onChange={(v) => { setClientId(v); scan.clear(); setRecover(new Set()); }} counts={outCounts} />
        {client && <p className="text-xs text-gray-500 mt-2">Presso il cliente risultano <b>{res.expected.length}</b> pezzi.</p>}
      </div>
      {client && (
        <>
          <ReaderBar scan={scan} hint="Scansiona i pezzi restituiti: il confronto con quelli consegnati è automatico." />
          <Section title="Rientrati" count={res.returned.length} tone="green" testid="pickup-returned">
            {res.returned.length === 0 && <p className="text-gray-400 text-sm">Nessun pezzo ancora scansionato.</p>}
            {res.returned.map((i) => <Row key={i.epc} name={i.name} epc={i.epc} sub={`presso il cliente da ${fmtDays(daysBetween(i.status_since))}`} />)}
          </Section>
          <Section title="Mancanti · ancora presso il cliente" count={res.missing.length} tone="amber" testid="pickup-missing">
            {res.missing.length === 0 && <p className="text-gray-400 text-sm">Nessun pezzo mancante.</p>}
            {res.missing.map((i) => <Row key={i.epc} name={i.name} epc={i.epc} sub={`consegnato da ${fmtDays(daysBetween(i.status_since))} · resta assegnato al cliente`} />)}
          </Section>
          {res.wrong.length > 0 && (
            <Section title="Restituiti per errore" count={res.wrong.length} tone="red" testid="pickup-wrong">
              {res.wrong.map((w) => (
                <Row
                  key={w.epc}
                  name={w.item ? w.item.name : "Tag sconosciuto"}
                  epc={w.epc}
                  sub={w.text}
                  right={
                    w.reason === "altro_cliente" ? (
                      <label className="flex items-center gap-1 text-gray-700">
                        <input type="checkbox" checked={recover.has(w.epc)} onChange={(e) => setRecover((s) => { const n = new Set(s); e.target.checked ? n.add(w.epc) : n.delete(w.epc); return n; })} />
                        registra rientro
                      </label>
                    ) : null
                  }
                />
              ))}
              <p className="text-xs text-gray-500 mt-2">Questi pezzi non vengono considerati restituiti da {client.name}. Per un pezzo di un altro cliente puoi registrarne comunque il rientro.</p>
            </Section>
          )}
          <button className={btnPrimary + " w-full mb-6"} onClick={confirm} disabled={!res.returned.length && !recover.size && !res.wrong.length}>
            <Check size={16} /> Registra ritiro ({res.returned.length + recover.size} {res.returned.length + recover.size === 1 ? "rientrato" : "rientrati"}, {res.missing.length} {res.missing.length === 1 ? "mancante" : "mancanti"})
          </button>
        </>
      )}
    </div>
  );
}

// ======================= MAGAZZINO =======================
function MagazzinoTab({ scan, rfid, itemsByEpc, run }) {
  const counts = rfid.items.reduce((m, i) => ((m[i.status] = (m[i.status] || 0) + 1), m), {});
  const scanned = [...scan.scanned.keys()];
  const ok = [];
  const other = [];
  for (const epc of scanned) {
    const it = itemsByEpc[epc];
    if (it && it.status === "ritirato") ok.push(it);
    else other.push({ epc, it, text: !it ? "Tag non registrato" : it.status === "magazzino" ? "Già in magazzino" : it.status === "presso_cliente" ? `Risulta presso ${it.client_name}: registra prima il ritiro` : `In preparazione per ${it.client_name}` });
  }
  async function confirm() {
    if (await run(await rapi.toWarehouse(ok), `${ok.length} pezzi rientrati in magazzino.`)) scan.clear();
  }
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {["magazzino", "preparazione", "presso_cliente", "ritirato"].map((s) => (
          <div key={s} className="border border-gray-200 rounded-2xl p-4">
            <div className="text-gray-500 text-xs flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${STATUS_COLOR[s]}`} />{STATUS_LABEL[s].split(" (")[0]}</div>
            <div className="text-2xl font-bold mt-1 tabular-nums">{counts[s] || 0}</div>
          </div>
        ))}
      </div>
      <ReaderBar scan={scan} hint="Scansiona i pezzi lavati che rientrano in magazzino." />
      <Section title="Da riportare in magazzino" count={ok.length} tone="green" testid="wh-ok">
        {ok.length === 0 && <p className="text-gray-400 text-sm">Nessun pezzo ritirato scansionato.</p>}
        {ok.map((i) => <Row key={i.epc} name={i.name} epc={i.epc} />)}
      </Section>
      {other.length > 0 && (
        <Section title="Non registrabili" count={other.length} tone="red">
          {other.map((o) => <Row key={o.epc} name={o.it ? o.it.name : "Tag sconosciuto"} epc={o.epc} sub={o.text} />)}
        </Section>
      )}
      <button className={btnPrimary + " w-full mb-6"} onClick={confirm} disabled={!ok.length}>
        <Check size={16} /> Registra rientro in magazzino ({ok.length})
      </button>
    </div>
  );
}

// ======================= PEZZI =======================
function PieceDetail({ item, rfid, onBack }) {
  const [moves, setMoves] = useState(null);
  const [err, setErr] = useState("");
  const deliveriesById = useMemo(() => Object.fromEntries(rfid.deliveries.map((d) => [d.id, d])), [rfid.deliveries]);
  const st = itemStats(item.epc, rfid.deliveryItems, deliveriesById);
  useEffect(() => {
    let alive = true;
    rapi.loadMovements(item.epc).then((r) => alive && (r.ok ? setMoves(r.movements) : setErr(r.error)));
    return () => (alive = false);
  }, [item.epc, item.updated_at]);
  return (
    <div data-testid="piece-detail">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-semibold text-gray-600 mb-3"><ChevronLeft size={16} /> Tutti i pezzi</button>
      <div className="border border-gray-200 rounded-2xl p-4 mb-4">
        <div className="font-bold text-gray-900 text-lg break-words">{item.name}</div>
        <div className="font-mono text-[11px] text-gray-400 break-all mb-2">{item.epc}</div>
        <StatusBadge status={item.status} />
        {item.status === "presso_cliente" && <p className="text-sm text-gray-700 mt-1">presso <b>{item.client_name}</b> da {fmtDays(daysBetween(item.status_since))}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="border border-gray-200 rounded-2xl p-4"><div className="text-gray-500 text-xs">Cicli completati</div><div className="text-2xl font-bold mt-1" data-testid="cycles">{st.cycles}</div></div>
        <div className="border border-gray-200 rounded-2xl p-4"><div className="text-gray-500 text-xs">Giorni presso clienti</div><div className="text-2xl font-bold mt-1">{Math.floor(st.totalDays)}</div></div>
      </div>
      <Section title="Giorni per cliente">
        {st.perClient.length === 0 && <p className="text-gray-400 text-sm">Mai consegnato.</p>}
        {st.perClient.map((c) => (
          <div key={c.clientId} className="flex justify-between text-sm py-1.5 border-b border-gray-100 last:border-0">
            <span className="text-gray-700">{c.clientName}{c.open ? " · in corso" : ""}</span>
            <span className="font-semibold">{fmtDays(c.days)} · {c.cycles} cicli</span>
          </div>
        ))}
      </Section>
      <Section title="Storico movimenti" testid="history">
        {err && <p className="text-rose-600 text-sm">{err}</p>}
        {!moves && !err && <p className="text-gray-400 text-sm">Caricamento…</p>}
        {moves && moves.length === 0 && <p className="text-gray-400 text-sm">Nessun movimento.</p>}
        {moves && moves.map((m) => (
          <div key={m.id} className="py-2 border-b border-gray-100 last:border-0 text-sm">
            <div className="flex justify-between gap-3"><span className="font-medium text-gray-900">{MOVEMENT_LABEL[m.type] || m.type}</span><span className="text-xs text-gray-500 whitespace-nowrap">{new Date(m.created_at).toLocaleString("it-IT")}</span></div>
            {(m.client_name || m.note || m.order_id) && <div className="text-xs text-gray-500">{[m.client_name, m.order_id && `ordine #${m.order_id}`, m.note].filter(Boolean).join(" · ")}</div>}
          </div>
        ))}
      </Section>
    </div>
  );
}

function PezziTab({ scan, rfid, itemsByEpc }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [openEpc, setOpenEpc] = useState(null);
  const lastScanned = [...scan.scanned.entries()].sort((a, b) => b[1].last - a[1].last)[0];
  useEffect(() => {
    if (lastScanned && itemsByEpc[lastScanned[0]]) setOpenEpc(lastScanned[0]);
  }, [lastScanned && lastScanned[0]]);
  const open = openEpc && itemsByEpc[openEpc];
  if (open) return <PieceDetail item={open} rfid={rfid} onBack={() => { setOpenEpc(null); scan.clear(); }} />;
  const ql = q.trim().toLowerCase();
  const list = rfid.items.filter((i) => (!status || i.status === status) && (!ql || i.name.toLowerCase().includes(ql) || i.epc.toLowerCase().includes(ql)));
  const deliveriesById = Object.fromEntries(rfid.deliveries.map((d) => [d.id, d]));
  return (
    <div>
      <ReaderBar scan={scan} hint="Scansiona un pezzo per aprire la sua scheda." />
      <div className="flex gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca per nome o codice" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" aria-label="Cerca pezzo" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white" aria-label="Stato">
          <option value="">Tutti</option>
          {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{STATUS_LABEL[s].split(" (")[0]}</option>)}
        </select>
      </div>
      <Section title="Pezzi registrati" count={list.length}>
        {list.length === 0 && <p className="text-gray-400 text-sm">Nessun pezzo.</p>}
        {list.slice(0, 300).map((i) => (
          <Row key={i.epc} name={i.name} epc={i.epc} sub={<StatusBadge status={i.status} />} right={<span className="text-gray-500">{itemStats(i.epc, rfid.deliveryItems, deliveriesById).cycles} cicli{i.client_name && i.status === "presso_cliente" ? <><br />{i.client_name}</> : null}</span>} onClick={() => setOpenEpc(i.epc)} />
        ))}
      </Section>
    </div>
  );
}

// ======================= CLIENTI =======================
function ClientiTab({ rfid, threshold, setThreshold }) {
  const [openClient, setOpenClient] = useState(null);
  const summary = clientSummary(rfid.items, rfid.deliveries, threshold);
  if (openClient) {
    const c = summary.find((s) => s.clientId === openClient) || { clientName: "—" };
    const pieces = rfid.items.filter((i) => i.status === "presso_cliente" && String(i.client_id) === openClient).map((i) => ({ ...i, days: daysBetween(i.status_since) })).sort((a, b) => b.days - a.days);
    return (
      <div>
        <button onClick={() => setOpenClient(null)} className="flex items-center gap-1 text-sm font-semibold text-gray-600 mb-3"><ChevronLeft size={16} /> Tutti i clienti</button>
        <Section title={`Presso ${c.clientName}`} count={pieces.length}>
          {pieces.map((i) => <Row key={i.epc} name={i.name} epc={i.epc} right={<span className={i.days >= threshold ? "text-rose-600 font-semibold" : "text-gray-500"}>{fmtDays(i.days)}</span>} />)}
        </Section>
      </div>
    );
  }
  return (
    <div>
      <div className="border border-gray-200 rounded-2xl p-4 mb-4 flex items-center justify-between gap-3">
        <label htmlFor="g-threshold" className="text-sm text-gray-700">Segnala come mancanti dopo</label>
        <div className="flex items-center gap-2">
          <input id="g-threshold" type="number" min="1" max="365" value={threshold} onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 1))} className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right" />
          <span className="text-sm text-gray-500">giorni</span>
        </div>
      </div>
      <Section title="Clienti con biancheria" count={summary.length} testid="clients-summary">
        {summary.length === 0 && <p className="text-gray-400 text-sm">Nessun pezzo presso i clienti.</p>}
        {summary.map((s) => (
          <Row key={s.clientId} name={s.clientName} epc={`${s.out} pezzi presso il cliente · ${s.openDeliveries} consegne aperte`} sub={s.out ? `il più vecchio da ${fmtDays(s.oldestDays)}` : ""} right={s.overdue ? <span className="text-rose-600 font-semibold">{s.overdue} da troppo tempo</span> : <span className="text-emerald-600">ok</span>} onClick={() => setOpenClient(s.clientId)} />
        ))}
      </Section>
    </div>
  );
}

// ======================= CONTENITORE =======================
const TABS = [
  { key: "consegna", label: "Consegna" },
  { key: "ritiro", label: "Ritiro" },
  { key: "magazzino", label: "Magazzino" },
  { key: "pezzi", label: "Pezzi" },
  { key: "clienti", label: "Clienti" },
];

export default function GestioneBiancheria({ reader, rfid, refresh, clients, orders }) {
  const scan = useScan(reader);
  const [tab, setTab] = useState("consegna");
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [threshold, setThresholdState] = useState(() => {
    try {
      return Number(localStorage.getItem(THRESHOLD_KEY)) || 14;
    } catch (e) {
      return 14;
    }
  });
  const setThreshold = (v) => {
    setThresholdState(v);
    try {
      localStorage.setItem(THRESHOLD_KEY, String(v));
    } catch (e) {
      /* facoltativo */
    }
  };
  const itemsByEpc = useMemo(() => Object.fromEntries(rfid.items.map((i) => [i.epc, i])), [rfid.items]);
  const outCounts = useMemo(() => rfid.items.reduce((m, i) => (i.status === "presso_cliente" && (m[String(i.client_id)] = (m[String(i.client_id)] || 0) + 1), m), {}), [rfid.items]);
  const overdue = overdueItems(rfid.items, threshold);

  // Esegue un'operazione sul database e mostra l'esito (mai un successo non confermato)
  async function run(res, okText) {
    setSaving(true);
    const r = await res;
    if (r && r.ok) {
      const ref = await refresh();
      setMsg(ref && ref.ok === false ? { kind: "bad", text: okText + " Ma non riesco a ricaricare i dati: " + ref.error } : { kind: "ok", text: okText });
    } else setMsg({ kind: "bad", text: (r && r.error) || "Operazione non riuscita." });
    setSaving(false);
    return !!(r && r.ok);
  }

  const switchTab = (k) => {
    if (scan.running) scan.stop();
    scan.clear();
    setMsg(null);
    setTab(k);
  };

  return (
    <div>
      {overdue.length > 0 && (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 mb-4" data-testid="overdue-banner">
          <div className="flex items-center gap-2 text-rose-600 font-semibold"><Bell size={16} /> Biancheria fuori da troppo tempo</div>
          <div className="text-rose-500 text-sm mt-1">{overdue.length} pezzi sono presso i clienti da più di {threshold} giorni.</div>
          <button className="text-sm font-semibold text-rose-600 underline mt-1" onClick={() => switchTab("clienti")}>Vedi clienti</button>
        </div>
      )}
      <div className="flex bg-gray-100 rounded-full p-1 mb-4 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => switchTab(t.key)} className={`flex-1 rounded-full py-2 px-2 text-xs font-semibold whitespace-nowrap transition-colors ${tab === t.key ? "bg-gray-900 text-white" : "text-gray-500"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {saving && <Notice kind="warn"><Loader2 size={14} className="inline animate-spin mr-1" /> Salvataggio in corso…</Notice>}
      {msg && !saving && <div data-testid="g-msg"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      {tab === "consegna" && <ConsegnaTab scan={scan} rfid={rfid} itemsByEpc={itemsByEpc} clients={clients} orders={orders} run={run} />}
      {tab === "ritiro" && <RitiroTab scan={scan} rfid={rfid} clients={clients} outCounts={outCounts} run={run} />}
      {tab === "magazzino" && <MagazzinoTab scan={scan} rfid={rfid} itemsByEpc={itemsByEpc} run={run} />}
      {tab === "pezzi" && <PezziTab scan={scan} rfid={rfid} itemsByEpc={itemsByEpc} />}
      {tab === "clienti" && <ClientiTab rfid={rfid} threshold={threshold} setThreshold={setThreshold} />}
    </div>
  );
}
