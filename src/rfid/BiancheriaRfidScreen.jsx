// Pagina "Biancheria RFID".
// • Titolare (staff): voce della barra in basso della sezione Lavanderia.
// • Operatore RFID: unica schermata dell'app (mode="operatore"), senza accesso al resto del gestionale.
// In primo piano: CONSEGNA, RITIRO, MAGAZZINO. Secondarie: Pezzi, Clienti, Registrazione tag (con password).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ScanLine, ChevronLeft, ChevronRight, Bell, LogOut, Users, Tag, Lock } from "lucide-react";
import RfidTestScreen from "./RfidTestScreen.jsx";
import GestioneBiancheria from "./GestioneBiancheria.jsx";
import { ChafonReader } from "./chafonReader";
import { loadNames } from "./rfidNames";
import { overdueItems, upcomingOrders } from "./rfidLogic";
import * as rapi from "./rfidApi";

const THRESHOLD_KEY = "lavabnb-rfid-soglia-giorni";
const pz = (n) => (n === 1 ? "1 pezzo" : `${n} pezzi`);

export function RfidNavIcon() {
  return <ScanLine size={18} />;
}

const TITLES = {
  consegna: "Consegna",
  ritiro: "Ritiro",
  magazzino: "Magazzino",
  pezzi: "Pezzi",
  clienti: "Clienti",
  registrazione: "Registrazione tag",
};

// Grande pulsante della schermata principale
function BigTile({ label, sub, badge, tone, onClick, testid }) {
  const tones = {
    blue: "bg-blue-600 text-white",
    green: "bg-emerald-600 text-white",
    dark: "bg-gray-900 text-white",
  };
  return (
    <button onClick={onClick} data-testid={testid} className={`w-full rounded-3xl px-6 py-7 mb-3 text-left flex items-center justify-between shadow-sm active:scale-[0.99] transition-transform ${tones[tone]}`}>
      <div>
        <div className="text-3xl font-extrabold tracking-wide">{label}</div>
        {sub && <div className="text-sm opacity-90 mt-1">{sub}</div>}
      </div>
      <div className="flex items-center gap-2">
        {badge ? <span className="bg-white/25 rounded-full px-3 py-1 text-sm font-bold">{badge}</span> : null}
        <ChevronRight size={26} />
      </div>
    </button>
  );
}
function SmallLink({ icon, label, sub, onClick, testid }) {
  return (
    <button onClick={onClick} data-testid={testid} className="flex-1 border border-gray-200 rounded-2xl px-3 py-3 text-left">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">{icon} {label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </button>
  );
}

// Accesso alla Registrazione tag: password controllata dal database
function RegistrationGate({ role, onUnlock }) {
  const [has, setHas] = useState(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    rapi.hasRegPassword().then((r) => (r.ok ? setHas(r.value) : setErr(r.error)));
  }, []);

  async function unlock() {
    setBusy(true);
    setErr("");
    const r = await rapi.checkRegPassword(pw);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    if (!r.value) return setErr("Password non corretta.");
    onUnlock(pw);
  }
  async function create() {
    if (pw.length < 4) return setErr("La password deve avere almeno 4 caratteri.");
    if (pw !== pw2) return setErr("Le due password non coincidono.");
    setBusy(true);
    const r = await rapi.setRegPassword(pw);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    onUnlock(pw);
  }

  if (has === null && !err) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" size={24} /></div>;
  const input = "w-full border border-gray-300 rounded-xl px-4 py-3 text-base mb-3";
  return (
    <div className="border border-gray-200 rounded-2xl p-5" data-testid="reg-gate">
      <div className="flex items-center gap-2 font-bold text-gray-900 mb-2"><Lock size={16} /> Area protetta</div>
      {has === false && role !== "staff" ? (
        <p className="text-sm text-gray-600">La registrazione dei tag non è ancora attiva: il titolare deve impostare la password.</p>
      ) : has === false ? (
        <>
          <p className="text-sm text-gray-600 mb-3">Scegli la password che servirà per registrare o rinominare i tag. Comunicala solo a chi deve registrare i pezzi.</p>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nuova password" className={input} aria-label="Nuova password" />
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Ripeti la password" className={input} aria-label="Ripeti la password" />
          <button onClick={create} disabled={busy} className="w-full bg-gray-900 text-white rounded-xl py-3 font-semibold">Imposta password</button>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-3">Inserisci la password per registrare o rinominare i tag.</p>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} placeholder="Password" className={input} aria-label="Password registrazione" data-testid="reg-password" autoFocus />
          <button onClick={unlock} disabled={busy || !pw} className="w-full bg-gray-900 text-white rounded-xl py-3 font-semibold" data-testid="reg-unlock">Entra</button>
        </>
      )}
      {err && <p className="text-sm text-rose-600 mt-3">{err}</p>}
    </div>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  if (!open) return <button className="text-xs text-gray-500 underline mb-4" onClick={() => setOpen(true)}>Cambia password della registrazione</button>;
  return (
    <div className="border border-gray-200 rounded-2xl p-4 mb-4">
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nuova password (min. 4 caratteri)" className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-2" aria-label="Nuova password registrazione" />
      <div className="flex gap-2">
        <button className="flex-1 border border-gray-300 rounded-xl py-2 text-sm font-semibold" onClick={() => setOpen(false)}>Chiudi</button>
        <button className="flex-1 bg-gray-900 text-white rounded-xl py-2 text-sm font-semibold" onClick={async () => { const r = await rapi.setRegPassword(pw); setMsg(r.ok ? "Password cambiata ✓" : r.error); if (r.ok) setPw(""); }}>Salva</button>
      </div>
      {msg && <p className="text-xs mt-2 text-gray-600">{msg}</p>}
    </div>
  );
}

export default function BiancheriaRfidScreen({ mode = "staff", onLogout }) {
  const readerRef = useRef(null);
  if (!readerRef.current) readerRef.current = new ChafonReader({});
  const reader = readerRef.current;
  useEffect(() => () => reader.disconnect(), [reader]);

  const [view, setView] = useState("home");
  const [role, setRole] = useState(mode === "operatore" ? "operatore" : null);
  const [rfid, setRfid] = useState(null);
  const [clients, setClients] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loadErr, setLoadErr] = useState(null);
  const [regPassword, setRegPassword] = useState(null); // solo in memoria, mai salvata sul telefono
  const [importMsg, setImportMsg] = useState("");
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

  const refresh = useCallback(async () => {
    const [r, c, o, w] = await Promise.all([rapi.loadAll(), rapi.loadClients(), rapi.loadUpcomingOrders(), rapi.whoami()]);
    if (!r.ok) {
      setLoadErr(r);
      return r;
    }
    if (!w.ok || !c.ok || !o.ok) {
      const e = { ok: false, setupNeeded: !!w.setupNeeded, v2: true, error: (!w.ok && w.error) || (!c.ok && c.error) || (!o.ok && o.error) };
      setLoadErr(e);
      return e;
    }
    setRole(w.role);
    setRfid({ items: r.items, deliveries: r.deliveries, deliveryItems: r.deliveryItems });
    setClients(c.clients);
    setOrders(o.orders);
    setLoadErr(null);
    return r;
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Uscendo dalla Registrazione tag la password va reinserita (telefoni condivisi tra operatori)
  const go = (v) => {
    if (view === "registrazione" && v !== "registrazione") setRegPassword(null);
    setView(v);
  };

  // Archivio nomi per la Registrazione tag (tutto controllato dal database)
  const store = useMemo(() => {
    if (!rfid) return null;
    return {
      names: Object.fromEntries(rfid.items.filter((i) => i.name).map((i) => [i.epc, { name: i.name, created: Date.parse(i.created_at) || Date.now() }])),
      note: "I nomi sono salvati nel database di LavaBnB e vengono riconosciuti in Consegna, Ritiro e Magazzino. «Elimina tag» toglie il nome: senza un nuovo nome entro 48 ore il tag viene cancellato.",
      canRemove: role === "staff",
      save: async (epc, name) => {
        const r = await rapi.registerTag(epc, name, regPassword);
        if (r.ok) await refresh();
        return r;
      },
      remove: async (epc) => {
        const r = await rapi.markDelete(epc);
        if (r.ok) await refresh();
        return r;
      },
      importNames: async (obj) => {
        const r = await rapi.importNames(obj, rfid.items.map((i) => i.epc), regPassword);
        await refresh();
        return r;
      },
    };
  }, [rfid, refresh, role, regPassword]);

  const localPending = useMemo(() => {
    if (!rfid) return {};
    const have = new Set(rfid.items.map((i) => i.epc));
    return Object.fromEntries(Object.entries(loadNames()).filter(([epc]) => !have.has(epc)));
  }, [rfid]);
  const pendingCount = Object.keys(localPending).length;
  async function importFromPhone() {
    setImportMsg("Importazione…");
    const r = await rapi.importNames(localPending, rfid.items.map((i) => i.epc), regPassword);
    await refresh();
    setImportMsg(r.ok ? `Importati ${r.count} pezzi dal telefono.` : r.error);
  }

  const overdue = rfid ? overdueItems(rfid.items, threshold) : [];
  const zone = upcomingOrders(orders, 48);
  const counts = rfid ? rfid.items.reduce((m, i) => ((m[i.status] = (m[i.status] || 0) + 1), m), {}) : {};
  const isOperator = mode === "operatore";

  const header =
    view === "home" ? (
      <div className="mb-5">
        {isOperator && (
          <div className="flex items-center justify-between mb-3">
            <img src="/logo.png" alt="LavaBNB" className="h-7" />
            <button onClick={onLogout} className="text-xs font-semibold text-gray-400 flex items-center gap-1" data-testid="op-logout">
              <LogOut size={13} /> Esci
            </button>
          </div>
        )}
        <h2 className="text-2xl font-bold text-gray-900">Biancheria RFID</h2>
        <p className="text-gray-500 text-sm mt-1">{isOperator ? "Accesso operatore" : "Consegne, ritiri e magazzino con il lettore RFID"}</p>
      </div>
    ) : (
      <div className="mb-4">
        <button onClick={() => go("home")} className="flex items-center gap-2 text-gray-900" aria-label="Torna alla Biancheria RFID" data-testid="rfid-back">
          <ChevronLeft size={22} />
          <span className="text-2xl font-bold">{TITLES[view]}</span>
        </button>
      </div>
    );

  return (
    <div className="px-6 pt-5 pb-8" data-testid="rfid-page">
      {header}

      {loadErr && (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-sm text-rose-700 mb-4" data-testid="setup-needed">
          {loadErr.setupNeeded ? (
            <>
              <b>Il database della biancheria RFID non è aggiornato.</b> Esegui nell'SQL Editor di Neon {loadErr.v2 ? <code>rfid-v2.sql</code> : <code>rfid-biancheria.sql</code>}, poi premi <b>Refresh schema cache</b> (Data API) e ricarica la pagina.
            </>
          ) : (
            loadErr.error
          )}
          {loadErr.setupNeeded && loadErr.error && <p className="text-xs mt-2 font-mono break-all opacity-80">Dettaglio: {loadErr.error}</p>}
          <button onClick={refresh} className="block mt-2 font-semibold underline">Riprova</button>
        </div>
      )}
      {!rfid && !loadErr && (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-gray-400" size={24} />
        </div>
      )}

      {rfid && view === "home" && (
        <>
          {overdue.length > 0 && (
            <button onClick={() => go("clienti")} className="w-full text-left bg-rose-50 border border-rose-100 rounded-2xl p-4 mb-4" data-testid="overdue-banner">
              <div className="flex items-center gap-2 text-rose-600 font-semibold"><Bell size={16} /> Biancheria fuori da troppo tempo</div>
              <div className="text-rose-500 text-sm mt-1">{pz(overdue.length)} {overdue.length === 1 ? "è" : "sono"} presso i clienti da più di {threshold} giorni.</div>
            </button>
          )}
          <BigTile label="CONSEGNA" tone="blue" testid="tile-consegna" onClick={() => go("consegna")} sub={zone.length ? `${zone.length} ${zone.length === 1 ? "ordine" : "ordini"} nelle prossime 48 ore` : "Nessun ordine nelle prossime 48 ore"} badge={zone.filter((o) => o.late).length ? `${zone.filter((o) => o.late).length} in ritardo` : null} />
          <BigTile label="RITIRO" tone="green" testid="tile-ritiro" onClick={() => go("ritiro")} sub={`${pz(counts.presso_cliente || 0)} presso i clienti`} />
          <BigTile label="MAGAZZINO" tone="dark" testid="tile-magazzino" onClick={() => go("magazzino")} sub={`${counts.magazzino || 0} disponibili · ${counts.ritirato || 0} da riportare`} />
          <div className="flex gap-2 mt-4">
            <SmallLink icon={<Tag size={13} />} label="Pezzi" sub={`${rfid.items.length} registrati`} onClick={() => go("pezzi")} testid="link-pezzi" />
            <SmallLink icon={<Users size={13} />} label="Clienti" sub={overdue.length ? `${overdue.length} in ritardo` : "riepilogo"} onClick={() => go("clienti")} testid="link-clienti" />
            <SmallLink icon={<Lock size={13} />} label="Registra tag" sub="con password" onClick={() => go("registrazione")} testid="link-registrazione" />
          </div>
        </>
      )}

      {rfid && view === "registrazione" && (
        regPassword === null ? (
          <RegistrationGate role={role} onUnlock={setRegPassword} />
        ) : (
          <>
            {role === "staff" && <ChangePassword />}
            {pendingCount > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-sm text-amber-800 mb-4" data-testid="phone-import">
                Su questo telefono ci sono <b>{pendingCount}</b> pezzi registrati con la pagina di prova e non ancora nel database.
                <button onClick={importFromPhone} className="block mt-2 font-semibold underline">Importali nel database</button>
                {importMsg && <p className="mt-1">{importMsg}</p>}
              </div>
            )}
            {pendingCount === 0 && importMsg && <p className="text-xs text-emerald-600 mb-3">{importMsg}</p>}
            <RfidTestScreen reader={reader} store={store} embedded />
          </>
        )
      )}

      {rfid && ["consegna", "ritiro", "magazzino", "pezzi", "clienti"].includes(view) && (
        <GestioneBiancheria reader={reader} rfid={rfid} refresh={refresh} clients={clients} orders={orders} tab={view} role={role} threshold={threshold} setThreshold={setThreshold} />
      )}
    </div>
  );
}
