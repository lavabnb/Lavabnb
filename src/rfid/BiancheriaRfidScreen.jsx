// Pagina "Biancheria RFID" (voce della barra in basso della sezione Lavanderia).
// Due sezioni separate: Registrazione tag (funzione esistente) e Gestione biancheria.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ScanLine } from "lucide-react";
import RfidTestScreen from "./RfidTestScreen.jsx";
import GestioneBiancheria from "./GestioneBiancheria.jsx";
import { ChafonReader } from "./chafonReader";
import { loadNames } from "./rfidNames";
import * as rapi from "./rfidApi";

export function RfidNavIcon() {
  return <ScanLine size={18} />;
}

export default function BiancheriaRfidScreen({ clients, orders }) {
  const readerRef = useRef(null);
  if (!readerRef.current) readerRef.current = new ChafonReader({});
  const reader = readerRef.current;
  useEffect(() => () => reader.disconnect(), [reader]);

  const [section, setSection] = useState("gestione");
  const [rfid, setRfid] = useState(null); // { items, deliveries, deliveryItems }
  const [loadErr, setLoadErr] = useState(null);
  const [importMsg, setImportMsg] = useState("");

  const refresh = useCallback(async () => {
    const r = await rapi.loadAll();
    if (r.ok) {
      setRfid({ items: r.items, deliveries: r.deliveries, deliveryItems: r.deliveryItems });
      setLoadErr(null);
    } else setLoadErr(r);
    return r;
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Archivio nomi su Neon per la sezione Registrazione tag
  const store = useMemo(() => {
    if (!rfid) return null;
    const byEpc = Object.fromEntries(rfid.items.map((i) => [i.epc, i]));
    return {
      names: Object.fromEntries(rfid.items.map((i) => [i.epc, { name: i.name, created: Date.parse(i.created_at) || Date.now() }])),
      note: "I nomi sono salvati nel database di LavaBnB: sono disponibili su tutti i dispositivi e vengono riconosciuti nella Gestione biancheria.",
      save: async (epc, name) => {
        const r = await rapi.saveItemName(epc, name, byEpc[epc]);
        if (r.ok) await refresh();
        return r;
      },
      remove: async (epc) => {
        const it = byEpc[epc];
        if (!it) return { ok: true };
        const hasHistory = it.status !== "magazzino" || rfid.deliveryItems.some((d) => d.epc === epc);
        const r = await rapi.deleteItem(epc, hasHistory);
        if (r.ok) await refresh();
        return r;
      },
      importNames: async (obj) => {
        const r = await rapi.importNames(obj, rfid.items.map((i) => i.epc));
        if (r.ok) await refresh();
        return r;
      },
    };
  }, [rfid, refresh]);

  // Nomi rimasti sul telefono dalla pagina di prova, non ancora nel database
  const localPending = useMemo(() => {
    if (!rfid) return {};
    const have = new Set(rfid.items.map((i) => i.epc));
    return Object.fromEntries(Object.entries(loadNames()).filter(([epc]) => !have.has(epc)));
  }, [rfid]);
  const pendingCount = Object.keys(localPending).length;

  async function importFromPhone() {
    setImportMsg("Importazione…");
    const r = await rapi.importNames(localPending, rfid.items.map((i) => i.epc));
    if (r.ok) await refresh();
    setImportMsg(r.ok ? `Importati ${r.count} pezzi dal telefono.` : r.error);
  }

  return (
    <div className="px-6 pt-5 pb-8">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Biancheria RFID</h2>
        <p className="text-gray-500 text-sm mt-1">Registrazione dei tag e ciclo di vita di ogni pezzo</p>
      </div>

      <div className="flex bg-gray-100 rounded-full p-1 mb-5">
        {[
          { key: "registrazione", label: "Registrazione tag" },
          { key: "gestione", label: "Gestione biancheria" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setSection(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition-colors ${section === t.key ? "bg-gray-900 text-white" : "text-gray-500"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loadErr && (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-sm text-rose-700 mb-4" data-testid="setup-needed">
          {loadErr.setupNeeded ? (
            <>
              <b>Il database della biancheria RFID non è ancora attivo.</b> Esegui una volta lo script <code>rfid-biancheria.sql</code> nell'SQL Editor di Neon, poi ricarica la pagina.
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

      {rfid && pendingCount > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-sm text-amber-800 mb-4" data-testid="phone-import">
          Su questo telefono ci sono <b>{pendingCount}</b> pezzi registrati con la pagina di prova e non ancora nel database.
          <button onClick={importFromPhone} className="block mt-2 font-semibold underline">Importali nel database</button>
          {importMsg && <p className="mt-1">{importMsg}</p>}
        </div>
      )}
      {rfid && pendingCount === 0 && importMsg && <p className="text-xs text-emerald-600 mb-3">{importMsg}</p>}

      {rfid && section === "registrazione" && <RfidTestScreen reader={reader} store={store} embedded />}
      {rfid && section === "gestione" && <GestioneBiancheria reader={reader} rfid={rfid} refresh={refresh} clients={clients} orders={orders} />}
    </div>
  );
}
