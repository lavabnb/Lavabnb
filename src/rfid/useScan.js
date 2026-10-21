// Lettura continua per le schermate operative: collega il lettore condiviso,
// raccoglie i tag letti (senza doppioni) e segnala i problemi di comunicazione.
import { useCallback, useEffect, useRef, useState } from "react";
import { P } from "./chafonProtocol";

export function useScan(reader, { defaultPower = 26 } = {}) {
  const [conn, setConn] = useState(() => (reader.connected ? { state: "connected", name: reader.device?.name || "" } : { state: "idle", name: "" }));
  const [running, setRunningState] = useState(false);
  const [scanned, setScanned] = useState(() => new Map()); // epc -> { rssi, count, last }
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [battery, setBattery] = useState(null);
  const [config, setConfig] = useState(() => (reader.config && reader.config.params ? { ...reader.config } : null));
  const [power, setPower] = useState(defaultPower);
  const [busy, setBusy] = useState("");
  const runRef = useRef(false);
  const sessionTags = useRef(0);
  const pending = useRef(new Map());
  const raf = useRef(0);

  const flush = useCallback(() => {
    raf.current = 0;
    // copia e svuota il buffer PRIMA dell'aggiornamento: l'aggiornamento deve restare "puro"
    const batch = [...pending.current.entries()];
    pending.current.clear();
    setScanned((prev) => {
      const next = new Map(prev);
      for (const [epc, v] of batch) {
        const old = next.get(epc);
        next.set(epc, { rssi: v.rssi, last: v.last, count: (old ? old.count : 0) + v.count });
      }
      return next;
    });
  }, []);

  const setRunning = (r) => {
    if (r && !runRef.current) {
      sessionTags.current = 0;
      setNotice(null);
    }
    runRef.current = r;
    setRunningState(r);
  };

  useEffect(() => {
    const mine = {
      onStatus: (state, name) => {
        setConn((c) => ({ state, name: name || c.name }));
        if (state === "disconnected") setRunning(false);
      },
      onError: (m) => setError(m),
      onBattery: setBattery,
      onConfig: (c) => setConfig(c),
      onKey: (k) => k === "down" && setRunning(true),
      onInventory: () => {
        if (!runRef.current) return;
        setRunning(false);
        if (sessionTags.current === 0) setNotice("Il lettore ha cercato ma non ha trovato nessun tag. Avvicina i pezzi (10–30 cm) o aumenta la potenza.");
      },
      onTag: ({ epc, rssi }) => {
        const p = pending.current.get(epc) || { rssi, last: 0, count: 0 };
        p.rssi = rssi;
        p.last = Date.now();
        p.count++;
        pending.current.set(epc, p);
        sessionTags.current++;
        if (!runRef.current) setRunning(true);
        if (!raf.current) raf.current = requestAnimationFrame(flush);
      },
    };
    reader.setHandlers(mine);
    return () => {
      if (runRef.current) reader.stopInventory();
      // non toglie i gestori se nel frattempo un'altra schermata li ha già presi
      if (reader.h === mine) reader.setHandlers({});
    };
  }, [reader, flush]);

  async function connect() {
    setError(null);
    setBusy("connect");
    try {
      const res = await reader.connect();
      if (!res.ok) setError(res.problem === "no-response" ? "Il lettore è collegato ma non risponde. Spegnilo, riaccendilo e ricollegalo." : "Il lettore non ha inviato la configurazione: riprova.");
    } catch (e) {
      setConn({ state: "error", name: "" });
      setError(e.message);
    }
    setBusy("");
  }

  async function start() {
    setRunning(true);
    const p = reader.config.params;
    if (!p || p[P.POWER] !== power) {
      setBusy("power");
      const r = await reader.applyPower(power);
      if (!r.ok) setError(r.reason);
      setBusy("");
    }
    const sentAt = await reader.startInventory();
    setTimeout(() => {
      if (runRef.current && reader.lastRx < sentAt) setError("Il lettore non ha risposto al comando di lettura. Scollegalo e ricollegalo.");
    }, 2500);
  }

  function stop() {
    reader.stopInventory();
    setTimeout(() => runRef.current && setRunning(false), 1200);
  }

  const clear = () => setScanned(new Map());
  const remove = (epc) =>
    setScanned((prev) => {
      const n = new Map(prev);
      n.delete(epc);
      return n;
    });

  return { conn, connected: conn.state === "connected", running, scanned, error, setError, notice, battery, config, power, setPower, busy, connect, disconnect: () => reader.disconnect(), start, stop, clear, remove };
}
