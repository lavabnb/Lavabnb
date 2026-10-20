// Pagina "Test RFID" della sezione Lavanderia.
// Modulo isolato: usa solo i file della cartella src/rfid e non legge né scrive i dati di LavaBnB.
import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  ChevronLeft,
  Loader2,
  Trash2,
  Bluetooth,
  Tag,
  Download,
  Upload,
  Copy,
  Play,
  Square,
  ScanLine,
} from "lucide-react";
import { ChafonReader, bluetoothSupport } from "./chafonReader";
import { P, AREAS, REGIONS, WORKMODES, permissionActive } from "./chafonProtocol";
import {
  loadNames,
  saveNames,
  storageAvailable,
  exportNamesJson,
  importNamesJson,
  downloadText,
} from "./rfidNames";

// Pulsante da mettere nella Dashboard Lavanderia
export function RfidEntryButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full border border-gray-200 text-gray-700 rounded-xl py-3 font-semibold flex items-center justify-center gap-2 mb-5"
    >
      <ScanLine size={16} /> Test RFID
    </button>
  );
}

const timeStr = (ts) => new Date(ts).toLocaleTimeString("it-IT");
const fmt = (n) => Number(n).toLocaleString("it-IT");

function Card({ title, children, className = "" }) {
  return (
    <div className={`border border-gray-200 rounded-2xl p-5 mb-5 ${className}`}>
      {title && <div className="font-bold text-gray-900 mb-3">{title}</div>}
      {children}
    </div>
  );
}

function Stat({ value, label, valueClass = "text-gray-900" }) {
  return (
    <div className="border border-gray-200 rounded-2xl p-4">
      <span className="text-gray-500 text-xs">{label}</span>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

function Notice({ kind = "warn", children }) {
  const cls =
    kind === "bad"
      ? "bg-rose-50 border-rose-100 text-rose-700"
      : kind === "ok"
      ? "bg-emerald-50 border-emerald-100 text-emerald-700"
      : "bg-amber-50 border-amber-100 text-amber-800";
  return <div className={`border rounded-2xl p-4 text-sm mb-4 ${cls}`}>{children}</div>;
}

function Dot({ color }) {
  return <span className={`w-2.5 h-2.5 rounded-full ${color}`} />;
}

const btnPrimary =
  "flex-1 bg-gray-900 text-white rounded-xl py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-40";
const btnSecondary =
  "flex-1 border border-gray-300 text-gray-800 rounded-xl py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-40";

export default function RfidTestScreen({ onBack }) {
  const support = useRef(bluetoothSupport()).current;
  const canStore = useRef(storageAvailable()).current;

  // Stato mutabile condiviso con i callback del lettore (evita valori "vecchi")
  const S = useRef({
    tags: new Map(),
    order: [],
    totalReads: 0,
    badFrames: 0,
    running: false,
    sessionId: 0,
    sessionTags: 0,
    t0: 0,
    t0Wall: 0,
    elapsed: 0,
    fresh: new Set(),
  }).current;
  const readerRef = useRef(null);
  const [, setTick] = useState(0);
  const rafRef = useRef(0);
  const bump = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setTick((t) => t + 1);
    });
  }, []);

  const [conn, setConn] = useState({ state: "idle", name: "" });
  const [battery, setBattery] = useState(null);
  const [config, setConfig] = useState(null);
  const [power, setPower] = useState(26);
  const [busy, setBusy] = useState("");
  const [diagMsg, setDiagMsg] = useState(null); // {kind, text}
  const [readMsg, setReadMsg] = useState(null); // {kind, text, causes?}
  const [names, setNames] = useState(() => loadNames());
  const namesRef = useRef(names);
  namesRef.current = names;
  const [selected, setSelected] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  const [nameInfo, setNameInfo] = useState("");
  const [logLines, setLogLines] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const [showReg, setShowReg] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [copied, setCopied] = useState("");
  const fileRef = useRef(null);
  const configRef = useRef(null);
  configRef.current = config;

  const log = useCallback((m) => {
    setLogLines((l) => [`${timeStr(Date.now())}  ${m}`, ...l].slice(0, 150));
  }, []);

  const causes = useCallback(() => {
    const c = [];
    const cfg = configRef.current;
    const p = cfg && cfg.params;
    if (p) {
      if (p[P.POWER] < 15)
        c.push(`La potenza nel lettore è ${p[P.POWER]} dBm: legge solo a contatto. Porta il cursore a 24–30 dBm e premi “Applica potenza”.`);
      if (p[P.AREA] !== 1) c.push(`Il lettore legge l'area “${AREAS[p[P.AREA]] || p[P.AREA]}” invece di EPC.`);
      if (p[P.REGION] === 1) c.push("La banda radio è quella USA: con tag europei la distanza di lettura si riduce molto.");
    } else c.push("Configurazione non letta: premi “Verifica configurazione”.");
    if (cfg && cfg.readMode === 1) c.push("Il lettore è in modalità codice a barre/QR.");
    if (cfg && permissionActive(cfg.permission))
      c.push("È attivo un filtro di lettura (impostazioni avanzate H103): il lettore ignora i tag che non corrispondono.");
    c.push("Tieni i tag a 10–30 cm dal lettore, senza mani o metallo davanti e lontani da liquidi.");
    return c;
  }, []);

  const setRunning = useCallback(
    (r) => {
      if (r && !S.running) {
        S.sessionTags = 0;
        S.t0Wall = Date.now();
        S.sessionId++;
        S.t0 = performance.now() - S.elapsed;
        setReadMsg(null);
      }
      if (!r && S.running) S.elapsed = performance.now() - S.t0;
      S.running = r;
      bump();
    },
    [S, bump]
  );

  const inventoryEnded = useCallback(() => {
    const was = S.running;
    setRunning(false);
    if (!was) return;
    if (S.sessionTags === 0) {
      log("Lettura conclusa: il lettore non ha trovato nessun tag");
      setReadMsg({ kind: "bad", text: "Il lettore ha cercato ma non ha trovato nessun tag. Non è un problema di collegamento: il lettore risponde.", causes: causes() });
    } else {
      setReadMsg({ kind: "ok", text: `Lettura conclusa: ${S.sessionTags} pezzi diversi trovati in questa lettura.` });
    }
  }, [S, setRunning, log, causes]);

  // Crea il lettore una sola volta
  if (!readerRef.current) {
    readerRef.current = new ChafonReader({
      onLog: (m) => log(m),
      onStatus: (state, name) => {
        setConn((c) => ({ state, name: name || c.name }));
        if (state === "disconnected") {
          S.running = false;
          bump();
        }
      },
      onError: (m) => setDiagMsg({ kind: "bad", text: m }),
      onBadFrame: () => {
        S.badFrames++;
        bump();
      },
      onBattery: (b) => setBattery(b),
      onConfig: (c) => setConfig(c),
      onKey: (k) => {
        if (k === "down") {
          log("Grilletto premuto");
          setRunning(true);
        } else log("Grilletto rilasciato");
      },
      onInventory: () => {
        if (S.running) inventoryEnded();
      },
      onTag: ({ epc, rssi }) => {
        const now = Date.now();
        S.totalReads++;
        let t = S.tags.get(epc);
        if (!t) {
          t = { epc, rssi, count: 0, first: now, last: now };
          S.tags.set(epc, t);
          S.order.unshift(epc);
          S.fresh.add(epc);
          S.sessionTags++;
        } else if (t.last < S.t0Wall) S.sessionTags++;
        t.count++;
        t.rssi = rssi;
        t.last = now;
        if (!S.running) setRunning(true);
        bump();
      },
    });
  }
  const reader = readerRef.current;

  // Aggiorna il tempo mentre legge; scollega all'uscita dalla pagina
  useEffect(() => {
    const iv = setInterval(() => S.running && bump(), 250);
    return () => clearInterval(iv);
  }, [S, bump]);
  useEffect(() => () => reader.disconnect(), [reader]);

  // Ricorda quando è stato visto l'ultima volta ogni pezzo con nome (salvato ogni 3 s)
  useEffect(() => {
    const iv = setInterval(() => {
      const cur = namesRef.current;
      let changed = false;
      const next = { ...cur };
      for (const k of Object.keys(cur)) {
        const t = S.tags.get(k);
        if (t && t.last !== cur[k].lastSeen) {
          next[k] = { ...cur[k], lastSeen: t.last };
          changed = true;
        }
      }
      if (changed) {
        saveNames(next);
        setNames(next);
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [S]);

  const connected = conn.state === "connected";

  async function handleConnect() {
    setDiagMsg(null);
    setBusy("connect");
    try {
      const res = await reader.connect();
      if (!res.ok && res.problem === "no-response")
        setDiagMsg({ kind: "bad", text: "Il lettore è collegato ma non risponde ai comandi. Chiudi l'app Chafon, spegni e riaccendi il lettore e ricollegalo." });
      else if (!res.ok)
        setDiagMsg({ kind: "bad", text: "Il lettore risponde ma non ha inviato la configurazione. Riprova con “Verifica configurazione”." });
    } catch (e) {
      log("Collegamento non riuscito: " + e.message);
      setConn({ state: "error", name: "" });
      setDiagMsg({ kind: "bad", text: e.message });
    }
    setBusy("");
  }

  async function handleApplyPower() {
    setBusy("power");
    const was = S.running;
    if (was) {
      await reader.stopInventory();
      await new Promise((r) => setTimeout(r, 300));
    }
    const res = await reader.applyPower(power);
    setDiagMsg(res.ok ? { kind: "ok", text: `Potenza salvata nel lettore: ${power} dBm.` } : { kind: "bad", text: res.reason });
    setBusy("");
    if (was) handleStart();
  }

  async function handleStart() {
    setRunning(true);
    const id = S.sessionId;
    const cur = reader.config.params;
    if (!cur || cur[P.POWER] !== power) {
      setBusy("power");
      const res = await reader.applyPower(power);
      if (!res.ok) {
        log("Attenzione: " + res.reason);
        setDiagMsg({ kind: "bad", text: res.reason });
      }
      setBusy("");
    }
    const sentAt = await reader.startInventory();
    setTimeout(() => {
      if (S.running && S.sessionId === id && reader.lastRx < sentAt)
        setReadMsg({ kind: "bad", text: "Il lettore non ha risposto al comando di lettura. Scollega e ricollega il lettore; se il problema resta, spegnilo e riaccendilo." });
    }, 2500);
  }

  function handleStop() {
    const id = S.sessionId;
    reader.stopInventory();
    setTimeout(() => {
      if (S.running && S.sessionId === id) inventoryEnded();
    }, 1200);
  }

  async function handleCheckConfig() {
    setBusy("config");
    const res = await reader.readConfig();
    if (!res.ok) setDiagMsg({ kind: "bad", text: res.problem === "no-response" ? "Il lettore non risponde ai comandi." : "Configurazione non ricevuta." });
    else setDiagMsg(null);
    setBusy("");
  }

  function handleReset() {
    S.tags.clear();
    S.order = [];
    S.totalReads = 0;
    S.badFrames = 0;
    S.elapsed = 0;
    S.sessionTags = 0;
    if (S.running) S.t0 = performance.now();
    setReadMsg(null);
    bump();
  }

  // ---- Nomi ----
  const nameOf = (epc) => (names[epc] && names[epc].name) || "";

  function selectTag(epc) {
    setSelected(epc);
    setNameDraft(nameOf(epc));
    setNameInfo(names[epc] ? "Nome registrato il " + new Date(names[epc].created).toLocaleDateString("it-IT") : "Questo pezzo non ha ancora un nome.");
  }
  function saveName() {
    if (!selected) return;
    const v = nameDraft.trim();
    if (!v) {
      setNameInfo("Scrivi un nome prima di salvare.");
      return;
    }
    const dup = Object.keys(names).find((k) => k !== selected && names[k].name.toLowerCase() === v.toLowerCase());
    const prev = names[selected];
    const t = S.tags.get(selected);
    const next = {
      ...names,
      [selected]: { name: v, created: prev ? prev.created : Date.now(), updated: Date.now(), lastSeen: t ? t.last : (prev && prev.lastSeen) || null },
    };
    const ok = saveNames(next);
    setNames(next);
    setNameInfo((ok ? "Salvato ✓" : "Salvato solo fino alla chiusura della pagina: il browser non permette il salvataggio.") + (dup ? ` Attenzione: anche il tag ${dup} ha questo nome.` : ""));
  }
  function removeName(epc) {
    const next = { ...names };
    delete next[epc];
    saveNames(next);
    setNames(next);
    if (epc === selected) {
      setNameDraft("");
      setNameInfo("Nome rimosso.");
    }
  }
  function nextUnnamed() {
    const e = S.order.find((x) => !nameOf(x) && x !== selected);
    if (e) selectTag(e);
    else setNameInfo("Tutti i pezzi letti hanno già un nome.");
  }
  async function handleImport(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const { names: merged, count } = importNamesJson(await file.text(), names);
      saveNames(merged);
      setNames(merged);
      setCopied(`Importati ${count} nomi`);
    } catch (e) {
      setCopied("File non valido: " + e.message);
    }
    setTimeout(() => setCopied(""), 3000);
  }
  function csvText() {
    const rows = [["epc", "nome", "letture", "ultimo_segnale_dbm", "prima_lettura", "ultima_lettura"]];
    for (const e of S.order.slice().reverse()) {
      const t = S.tags.get(e);
      rows.push([e, '"' + nameOf(e).replace(/"/g, '""') + '"', t.count, t.rssi, new Date(t.first).toISOString(), new Date(t.last).toISOString()]);
    }
    return rows.map((r) => r.join(";")).join("\n");
  }
  async function copyList() {
    const txt = S.order.map((e) => (nameOf(e) ? nameOf(e) + "\t" : "") + e).join("\n");
    try {
      await navigator.clipboard.writeText(txt);
      setCopied("Lista copiata");
    } catch (e) {
      setCopied("Copia non riuscita");
    }
    setTimeout(() => setCopied(""), 2000);
  }

  // ---- Valori calcolati ----
  const elapsed = S.running ? performance.now() - S.t0 : S.elapsed;
  const secs = elapsed / 1000;
  const rate = secs > 0.2 ? Math.round(S.totalReads / secs) : 0;
  let named = 0;
  for (const e of S.order) if (nameOf(e)) named++;
  const p = config && config.params;
  const fresh = new Set(S.fresh);
  S.fresh.clear();
  const regKeys = Object.keys(names).sort((a, b) => names[a].name.localeCompare(names[b].name, "it"));

  const connLabel = {
    idle: "Non collegato",
    searching: "Ricerca lettore…",
    connecting: "Collegamento…",
    connected: "Collegato" + (conn.name ? " · " + conn.name : ""),
    disconnected: "Scollegato",
    error: "Errore di collegamento",
  }[conn.state];
  const connColor = connected ? "bg-emerald-500" : conn.state === "error" ? "bg-rose-500" : conn.state === "idle" || conn.state === "disconnected" ? "bg-slate-400" : "bg-amber-500";

  return (
    <div className="px-6 pt-5 pb-8">
      <div className="mb-4">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-900 mb-1" aria-label="Torna alla Dashboard">
          <ChevronLeft size={22} />
          <span className="text-2xl font-bold">Test RFID</span>
        </button>
        <p className="text-gray-500 text-sm mt-1">Lettore CHAFON H103 via Bluetooth · area di prova separata</p>
      </div>

      {!support.ok && (
        <Notice kind="bad">
          <b>Bluetooth non disponibile.</b> {support.reason}
        </Notice>
      )}
      {!canStore && (
        <Notice kind="bad">Il browser non permette di salvare dati: i nomi assegnati andranno persi alla chiusura. Usa “Esporta nomi”.</Notice>
      )}

      {/* Indicatori di stato */}
      <div className="flex flex-wrap gap-2 mb-5 text-sm">
        <span className="inline-flex items-center gap-2 border border-gray-200 rounded-full px-3 py-1.5 font-medium text-gray-800" data-testid="conn">
          <Dot color={connColor} /> {connLabel}
        </span>
        <span className="inline-flex items-center gap-2 border border-gray-200 rounded-full px-3 py-1.5 font-medium text-gray-800" data-testid="inv">
          <Dot color={S.running ? "bg-blue-500" : "bg-slate-400"} /> {busy === "power" ? "Imposto la potenza…" : S.running ? "In lettura…" : "Fermo"}
        </span>
        <span className="inline-flex items-center gap-2 border border-gray-200 rounded-full px-3 py-1.5 font-medium text-gray-800">
          Batteria <b>{battery === null ? "—" : battery + "%"}</b>
        </span>
      </div>

      {/* Lettore */}
      <Card title="Lettore">
        <div className="flex gap-3 mb-4">
          <button className={btnPrimary} onClick={handleConnect} disabled={!support.ok || connected || busy === "connect"}>
            {busy === "connect" ? <Loader2 size={16} className="animate-spin" /> : <Bluetooth size={16} />} Collega lettore
          </button>
          <button className={btnSecondary} onClick={() => reader.disconnect()} disabled={!connected}>
            Scollega
          </button>
        </div>
        <label htmlFor="rfid-power" className="text-gray-500 text-xs">Potenza di trasmissione</label>
        <div className="flex items-center gap-3 mt-1">
          <input id="rfid-power" type="range" min="5" max="30" step="1" value={power} onChange={(e) => setPower(Number(e.target.value))} className="flex-1 accent-gray-900" />
          <span className="font-bold text-gray-900 w-16 text-right tabular-nums">{power} dBm</span>
        </div>
        <p className="text-xs text-gray-400 mt-1 mb-4">Bassa (5–12) per un solo pezzo vicino, alta (24–30) per un carrello o un sacco. Viene salvata nel lettore prima di ogni lettura.</p>
        <div className="flex gap-3">
          <button className={btnSecondary} onClick={handleApplyPower} disabled={!connected || !!busy}>Applica potenza</button>
          <button className={btnSecondary} onClick={handleCheckConfig} disabled={!connected || !!busy}>
            {busy === "config" && <Loader2 size={16} className="animate-spin" />} Verifica configurazione
          </button>
        </div>
      </Card>

      {/* Diagnostica */}
      <Card title="Diagnostica lettore">
        {diagMsg && <Notice kind={diagMsg.kind}>{diagMsg.text}</Notice>}
        {!config ? (
          <p className="text-gray-400 text-sm">Collega il lettore per leggere la configurazione.</p>
        ) : (
          <div className="text-sm" data-testid="diag">
            {[
              config.deviceInfo && ["Dispositivo", config.deviceInfo],
              config.readMode !== null && ["Modalità", config.readMode === 1 ? "codice a barre/QR (RFID spento)" : "RFID", config.readMode === 1 ? "bad" : ""],
              p && ["Potenza salvata", p[P.POWER] + " dBm", p[P.POWER] < 15 ? "warn" : ""],
              p && ["Banda radio", REGIONS[p[P.REGION]] || "codice " + p[P.REGION], p[P.REGION] === 1 ? "warn" : ""],
              p && ["Area letta", AREAS[p[P.AREA]] || String(p[P.AREA]), p[P.AREA] !== 1 ? "warn" : ""],
              p && ["Modo di lavoro", WORKMODES[p[P.WORKMODE]] || String(p[P.WORKMODE])],
              p && ["Filtro doppioni", p[P.FILTER] ? p[P.FILTER] + " s" : "spento"],
              config.permission && ["Filtro avanzato H103", permissionActive(config.permission) ? "ATTIVO" : "spento", permissionActive(config.permission) ? "bad" : ""],
              ["Dati scartati", fmt(S.badFrames), S.badFrames ? "warn" : ""],
            ]
              .filter(Boolean)
              .map(([k, v, lvl]) => (
                <div key={k} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                  <span className="text-gray-500">{k}</span>
                  <span className={`font-semibold text-right ${lvl === "bad" ? "text-rose-600" : lvl === "warn" ? "text-amber-600" : "text-gray-900"}`}>{v}</span>
                </div>
              ))}
          </div>
        )}
      </Card>

      {/* Lettura */}
      <div className="flex gap-3 mb-2">
        <button className={btnPrimary} onClick={handleStart} disabled={!connected || S.running}>
          <Play size={16} /> Avvia lettura
        </button>
        <button className={`${btnSecondary} border-rose-300 text-rose-600`} onClick={handleStop} disabled={!connected}>
          <Square size={16} /> Ferma
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-4">Puoi usare anche il grilletto del lettore: i pezzi letti compaiono qui in automatico.</p>
      {readMsg && (
        <div data-testid="readmsg">
          <Notice kind={readMsg.kind}>
            {readMsg.text}
            {readMsg.causes && (
              <ul className="list-disc pl-5 mt-2 space-y-1">
                {readMsg.causes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </Notice>
        </div>
      )}

      {/* Contatori */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="col-span-2 border border-gray-200 rounded-2xl p-4">
          <span className="text-gray-500 text-xs">Pezzi diversi letti</span>
          <div className="text-5xl font-bold mt-1 tabular-nums text-gray-900" data-testid="unique">{fmt(S.tags.size)}</div>
        </div>
        <Stat value={fmt(named)} label="Con nome" valueClass="text-emerald-600" />
        <Stat value={fmt(S.tags.size - named)} label="Senza nome" valueClass={S.tags.size - named ? "text-amber-600" : "text-gray-900"} />
        <Stat value={fmt(S.totalReads)} label="Letture totali" />
        <Stat value={`${fmt(rate)}/s`} label={`Velocità · ${secs.toLocaleString("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s`} />
      </div>

      {/* Assegna nome */}
      <Card title="Assegna nome">
        {!selected ? (
          <p className="text-gray-400 text-sm">Tocca un pezzo nella lista qui sotto per dargli un nome.</p>
        ) : (
          <div>
            <p className="text-xs text-gray-500 mb-2 break-all">
              Codice tag: <span className="font-mono">{selected}</span>
            </p>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              maxLength={80}
              placeholder="Es. Lenzuolo matrimoniale – Hotel Bella Vista #023"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base mb-3"
              aria-label="Nome del pezzo"
              data-testid="name-input"
              autoFocus
            />
            <div className="flex gap-3 mb-2">
              <button className={btnPrimary} onClick={saveName}>Salva nome</button>
              <button className={btnSecondary} onClick={nextUnnamed}>Prossimo senza nome</button>
            </div>
            {names[selected] && (
              <button onClick={() => removeName(selected)} className="text-sm text-rose-600 font-semibold flex items-center gap-1 mt-1">
                <Trash2 size={14} /> Rimuovi nome
              </button>
            )}
            <p className="text-xs text-gray-500 mt-2" data-testid="name-info">{nameInfo}</p>
          </div>
        )}
      </Card>

      {/* Lista pezzi */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-gray-900">Pezzi letti</h3>
        <div className="flex items-center gap-3 text-sm font-semibold text-gray-600">
          <button onClick={copyList} className="flex items-center gap-1"><Copy size={14} /> Copia</button>
          <button onClick={() => downloadText("lettura-rfid-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".csv", "﻿" + csvText(), "text/csv")} className="flex items-center gap-1">
            <Download size={14} /> CSV
          </button>
          <button onClick={handleReset} className="text-rose-600">Azzera</button>
        </div>
      </div>
      {copied && <p className="text-xs text-emerald-600 mb-2">{copied}</p>}
      <div className="mb-5" data-testid="list">
        {S.order.length === 0 && <p className="text-gray-400 text-sm py-6 text-center">Nessun tag letto. Collega il lettore e premi “Avvia lettura”.</p>}
        {S.order.slice(0, 300).map((e) => {
          const t = S.tags.get(e);
          const n = nameOf(e);
          return (
            <button
              key={e}
              onClick={() => selectTag(e)}
              className={`w-full text-left border rounded-2xl p-4 mb-2 transition-colors ${selected === e ? "border-gray-900 bg-gray-50" : fresh.has(e) ? "border-blue-200 bg-blue-50" : "border-gray-200"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className={`font-semibold ${n ? "text-gray-900" : "text-amber-600"} break-words min-w-0`}>
                  <Tag size={14} className="inline mr-1 -mt-0.5" />
                  {n || "Senza nome — tocca per assegnarlo"}
                </span>
                <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">{t.count}×</span>
              </div>
              <div className="flex items-center justify-between gap-3 mt-1">
                <span className="font-mono text-[11px] text-gray-400 break-all min-w-0">{e}</span>
                <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                  {timeStr(t.last)} · {t.rssi} dBm
                </span>
              </div>
            </button>
          );
        })}
        {S.order.length > 300 && <p className="text-xs text-gray-400 text-center">… e altri {S.order.length - 300} pezzi (presenti nel CSV)</p>}
      </div>

      {/* Nomi salvati */}
      <Card>
        <button onClick={() => setShowReg((v) => !v)} className="w-full flex items-center justify-between font-bold text-gray-900">
          <span>Nomi salvati ({regKeys.length})</span>
          <span className="text-sm text-gray-500">{showReg ? "Chiudi" : "Apri"}</span>
        </button>
        {showReg && (
          <div className="mt-3">
            <p className="text-xs text-gray-500 mb-3">I nomi sono salvati in questo browser, su questo dispositivo. Esportali per tenerne una copia o per usarli su un altro telefono.</p>
            <div className="flex gap-3 mb-3">
              <button className={btnSecondary} onClick={() => downloadText("nomi-rfid-" + new Date().toISOString().slice(0, 10) + ".json", exportNamesJson(names), "application/json")}>
                <Download size={16} /> Esporta nomi
              </button>
              <button className={btnSecondary} onClick={() => fileRef.current && fileRef.current.click()}>
                <Upload size={16} /> Importa nomi
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImport} />
            </div>
            {regKeys.length === 0 && <p className="text-gray-400 text-sm">Nessun nome salvato.</p>}
            {regKeys.map((k) => (
              <div key={k} className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 break-words">{names[k].name}</div>
                  <div className="font-mono text-[11px] text-gray-400 break-all">{k}</div>
                  {names[k].lastSeen && <div className="text-[11px] text-gray-400">ultima lettura {new Date(names[k].lastSeen).toLocaleString("it-IT")}</div>}
                </div>
                <button
                  onClick={() => {
                    if (confirmDel === k) {
                      removeName(k);
                      setConfirmDel(null);
                    } else setConfirmDel(k);
                  }}
                  className="text-xs font-semibold text-rose-600 whitespace-nowrap"
                >
                  {confirmDel === k ? "Conferma" : "Elimina"}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Registro tecnico */}
      <Card>
        <button onClick={() => setShowLog((v) => !v)} className="w-full flex items-center justify-between font-bold text-gray-900">
          <span>Registro tecnico</span>
          <span className="text-sm text-gray-500">{showLog ? "Chiudi" : "Apri"}</span>
        </button>
        {showLog && (
          <pre className="mt-3 text-[11px] leading-snug text-gray-500 whitespace-pre-wrap break-all max-h-64 overflow-y-auto" data-testid="log">
            {logLines.join("\n") || "Nessun evento."}
          </pre>
        )}
      </Card>
    </div>
  );
}
