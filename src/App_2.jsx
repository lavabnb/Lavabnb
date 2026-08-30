import React, { useState, useEffect, useCallback } from "react";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  MessageSquare,
  Minus,
  Bell,
  Shirt,
  Euro,
  Loader2,
  Users,
  Calendar as CalendarIcon,
  BarChart3,
  Home,
  Check,
  Trash2,
  LogOut,
} from "lucide-react";
import * as api from "./api";

// ---------- Date helpers ----------
function isoToday() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function formatIT(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function formatDateTimeIT(isoDateTime) {
  const d = new Date(isoDateTime);
  return d.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function isoFromYMD(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function monthLabel(date) {
  const s = date.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function buildMonthGrid(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // lunedì = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(isoFromYMD(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function minAllowedSlot() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}
function isSlotValid(date, time) {
  if (!date || !time) return false;
  const dt = new Date(`${date}T${time}:00`);
  return dt.getTime() >= minAllowedSlot().getTime();
}
function earliestSlotMs(order) {
  if (!order.preferredSlots || order.preferredSlots.length === 0) return Infinity;
  return Math.min(
    ...order.preferredSlots.map((s) => new Date(`${s.date}T${s.time}:00`).getTime())
  );
}
function isUrgentOrder(order) {
  if (order.status !== "nuovo" && order.status !== "pronto") return false;
  const earliest = earliestSlotMs(order);
  if (earliest === Infinity) return false;
  return earliest - Date.now() < 48 * 60 * 60 * 1000;
}
function dueMs(order) {
  if (order.status === "programmato" && order.deliveryDate) {
    return new Date(`${order.deliveryDate}T${order.deliveryTime}:00`).getTime();
  }
  return earliestSlotMs(order);
}
function isDeliverySoon(order) {
  if (order.status !== "programmato" || !order.deliveryDate) return false;
  const dt = new Date(`${order.deliveryDate}T${order.deliveryTime}:00`).getTime();
  return dt - Date.now() < 72 * 60 * 60 * 1000;
}

// ---------- Catalogo & clienti (seed) ----------
const CATEGORY_ORDER = ["Lenzuola", "Asciugamani", "Coperte", "Tavola"];
const CATEGORY_ICON = { Lenzuola: "🛏️", Asciugamani: "🧺", Coperte: "🛋️", Tavola: "🍽️" };

const STATUS = {
  nuovo: { label: "Nuovo", color: "bg-blue-500" },
  pronto: { label: "Pronto", color: "bg-purple-500" },
  programmato: { label: "Programmato", color: "bg-amber-500" },
  consegnato: { label: "Consegnato", color: "bg-slate-400" },
};

// ---------- UI helpers ----------
function Pill({ children, active, onClick, icon }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition-colors ${
        active ? "bg-gray-900 text-white" : "text-gray-500"
      }`}
    >
      <span>{icon}</span>
      {children}
    </button>
  );
}

function StatCard({ value, label, valueClass = "text-gray-900", icon }) {
  return (
    <div className="flex-1 border border-gray-200 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <span className="text-gray-500 text-xs">{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-bold mt-1 ${valueClass}`}>{value}</div>
    </div>
  );
}

function StatusDot({ status }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-800">
      <span className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
      {s.label}
    </span>
  );
}

function BottomNav({ items, active, onChange }) {
  return (
    <div className="border-t border-gray-100 px-2 py-3 flex items-center justify-around">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className={`flex flex-col items-center gap-1 text-[11px] font-semibold px-2 ${
            active === it.key ? "text-gray-900" : "text-gray-400"
          }`}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

function ScreenHeader({ title, subtitle, onBack }) {
  return (
    <div className="mb-4">
      {onBack ? (
        <button onClick={onBack} className="flex items-center gap-2 text-gray-900 mb-1">
          <ChevronLeft size={22} />
          <span className="text-2xl font-bold">{title}</span>
        </button>
      ) : (
        <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
      )}
      {subtitle && <p className="text-gray-500 text-sm mt-1">{subtitle}</p>}
    </div>
  );
}

// ================= CLIENTI (lato Lavanderia) =================
function ClientiListScreen({ clients, orders, onOpen }) {
  return (
    <div className="px-6 pt-5">
      <ScreenHeader title="Clienti" subtitle="Gestisci i listini concordati con ogni cliente" />
      <p className="text-xs text-gray-400 mb-5">
        I clienti compaiono qui automaticamente quando si registrano dall'app.
      </p>

      {clients.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">
          Nessun cliente registrato ancora.
        </p>
      )}
      {clients.map((c) => {
        const nItems = Object.keys(c.pricing).length;
        const activeOrders = orders.filter(
          (o) => o.clientId === c.id && o.status !== "consegnato"
        ).length;
        return (
          <button
            key={c.id}
            onClick={() => onOpen(c.id)}
            className="w-full text-left border border-gray-200 rounded-2xl p-5 mb-4"
          >
            <div className="font-bold text-gray-900">{c.name}</div>
            <div className="text-sm text-gray-500 mt-1">
              {nItems} {nItems === 1 ? "tipologia" : "tipologie"} in listino • {activeOrders}{" "}
              ordini attivi
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ClientDetailScreen({ client, catalog, onBack, onSetPrice, onRemoveItem, onAddNewItem }) {
  const [addingItem, setAddingItem] = useState(null); // category or null
  const [newName, setNewName] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [newPrice, setNewPrice] = useState("");

  const submitNewItem = (category) => {
    if (!newName.trim() || !newWeight || !newPrice) return;
    onAddNewItem(client.id, {
      name: newName.trim(),
      category,
      weightKg: parseFloat(newWeight),
      price: parseFloat(newPrice),
    });
    setNewName("");
    setNewWeight("");
    setNewPrice("");
    setAddingItem(null);
  };

  return (
    <div className="px-6 pt-5 pb-8">
      <ScreenHeader title={client.name} subtitle="Listino concordato: prezzo per pezzo" onBack={onBack} />

      {client.account ? (
        <div className="border border-gray-200 rounded-2xl p-4 mb-6 text-sm text-gray-600 space-y-1">
          <div className="font-bold text-gray-900 mb-1">Dati cliente</div>
          <div>Email: {client.account.email}</div>
          <div>Telefono referente: {client.account.phone}</div>
          <div>Indirizzo di consegna: {client.account.deliveryAddress}</div>
          <div>
            Fatturazione: {client.account.billingName} — {client.account.billingVat}
          </div>
          <div>Indirizzo di fatturazione: {client.account.billingAddress}</div>
        </div>
      ) : (
        <div className="border border-dashed border-gray-300 rounded-2xl p-4 mb-6 text-sm text-gray-400">
          Cliente aggiunto manualmente: non ha ancora registrato un account in app.
        </div>
      )}

      {CATEGORY_ORDER.map((cat) => {
        const items = catalog.filter((it) => it.category === cat);
        return (
          <div key={cat} className="mb-6">
            <div className="flex items-center gap-2 mb-2 text-sm font-bold text-gray-700">
              <span>{CATEGORY_ICON[cat]}</span> {cat}
            </div>
            {items.map((it) => {
              const enabled = client.pricing[it.id] !== undefined;
              return (
                <div
                  key={it.id}
                  className="flex items-center justify-between border border-gray-200 rounded-xl px-4 py-3 mb-2"
                >
                  <label className="flex items-center gap-3 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) =>
                        e.target.checked
                          ? onSetPrice(client.id, it.id, 0)
                          : onRemoveItem(client.id, it.id)
                      }
                      className="w-4 h-4 accent-gray-900 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{it.name}</div>
                      <div className="text-xs text-gray-400">{it.weightKg} kg/pz</div>
                    </div>
                  </label>
                  {enabled && (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-gray-400 text-sm">€</span>
                      <input
                        type="number"
                        step="0.10"
                        value={client.pricing[it.id]}
                        onChange={(e) =>
                          onSetPrice(client.id, it.id, parseFloat(e.target.value) || 0)
                        }
                        className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right"
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {addingItem === cat ? (
              <div className="border border-gray-200 rounded-xl p-3 mt-2">
                <input
                  autoFocus
                  placeholder="Nome capo"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm mb-2"
                />
                <div className="flex gap-2 mb-2">
                  <input
                    placeholder="Peso kg"
                    type="number"
                    step="0.1"
                    value={newWeight}
                    onChange={(e) => setNewWeight(e.target.value)}
                    className="w-1/2 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Prezzo €"
                    type="number"
                    step="0.10"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    className="w-1/2 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => submitNewItem(cat)}
                    className="flex-1 bg-gray-900 text-white rounded-lg py-1.5 text-sm font-semibold"
                  >
                    Aggiungi
                  </button>
                  <button
                    onClick={() => setAddingItem(null)}
                    className="flex-1 border border-gray-300 rounded-lg py-1.5 text-sm font-semibold"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingItem(cat)}
                className="text-sm font-semibold text-gray-600 flex items-center gap-1.5 mt-1"
              >
                <Plus size={14} /> Nuova tipologia in {cat.toLowerCase()}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ================= ORDINI / DASHBOARD (lato Lavanderia) =================
function ScheduleForm({ order, onConfirm, onCancel }) {
  const firstSlot = order.preferredSlots && order.preferredSlots[0];
  const [date, setDate] = useState(firstSlot ? firstSlot.date : addDaysISO(isoToday(), 2));
  const [time, setTime] = useState(firstSlot ? firstSlot.time : "10:00");
  return (
    <div className="mt-4 bg-gray-50 rounded-xl p-3">
      <div className="text-sm font-semibold text-gray-700 mb-2">Programma consegna</div>
      {order.preferredSlots && order.preferredSlots.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1.5">Orari richiesti dal cliente:</div>
          <div className="flex flex-wrap gap-1.5">
            {order.preferredSlots.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  setDate(s.date);
                  setTime(s.time);
                }}
                className={`text-xs px-2.5 py-1 rounded-full border ${
                  date === s.date && time === s.time
                    ? "bg-gray-900 text-white border-gray-900"
                    : "border-gray-300 text-gray-700"
                }`}
              >
                {formatIT(s.date)} • {s.time}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2 mb-3">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onConfirm(order.id, date, time)}
          className="flex-1 bg-gray-900 text-white rounded-lg py-1.5 text-sm font-semibold"
        >
          Conferma
        </button>
        <button
          onClick={onCancel}
          className="flex-1 border border-gray-300 rounded-lg py-1.5 text-sm font-semibold"
        >
          Annulla
        </button>
      </div>
    </div>
  );
}

function OrderRecentCard({ order, clientName, onMarkReady, onSchedule, onMarkDelivered, onOpenDetail }) {
  const [scheduling, setScheduling] = useState(false);
  const urgent = isUrgentOrder(order);
  const deliverySoon = isDeliverySoon(order);
  return (
    <div className="border border-gray-200 rounded-2xl p-5 mb-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-gray-900">#{order.id}</span>
            {urgent && (
              <span className="bg-rose-600 text-white text-[11px] font-bold px-2 py-1 rounded-full">
                URGENTE
              </span>
            )}
            {deliverySoon && (
              <span className="bg-blue-50 text-blue-600 text-[11px] font-bold px-2 py-1 rounded-full">
                CONSEGNA ENTRO 72H
              </span>
            )}
          </div>
          <div className="text-sm text-gray-500 mt-0.5">{clientName}</div>
          <div className="text-sm text-gray-500 mt-0.5">
            {formatIT(order.createdDate)} • €{order.total.toFixed(2)}
          </div>
        </div>
        <button
          onClick={() => onOpenDetail(order.id)}
          className="border border-gray-300 rounded-lg px-4 py-1.5 text-sm font-semibold text-gray-800 shrink-0"
        >
          Dettagli
        </button>
      </div>
      <div className="mt-3 text-xs text-gray-500">
        {order.items.map((it) => `${it.qty}× ${it.name}`).join(" · ")}
      </div>
      {order.status !== "programmato" && order.preferredSlots && order.preferredSlots.length > 0 && (
        <div className="mt-2 text-xs text-gray-400">
          Orari richiesti: {order.preferredSlots.map((s) => `${formatIT(s.date)} ${s.time}`).join(" / ")}
        </div>
      )}
      <div className="mt-3">
        <StatusDot status={order.status} />
      </div>

      {order.status === "nuovo" && (
        <button
          onClick={() => onMarkReady(order.id)}
          className="mt-3 border border-gray-300 rounded-lg px-4 py-1.5 text-sm font-semibold text-gray-800"
        >
          Segna come pronto
        </button>
      )}

      {order.status === "pronto" &&
        (!scheduling ? (
          <button
            onClick={() => setScheduling(true)}
            className="mt-3 border border-gray-300 rounded-lg px-4 py-1.5 text-sm font-semibold text-gray-800"
          >
            Programma consegna
          </button>
        ) : (
          <ScheduleForm
            order={order}
            onConfirm={(id, date, time) => {
              onSchedule(id, date, time);
              setScheduling(false);
            }}
            onCancel={() => setScheduling(false)}
          />
        ))}

      {order.status === "programmato" && (
        <div className="mt-3 flex items-center justify-between gap-2 bg-gray-50 rounded-xl p-3">
          <span className="text-sm text-gray-600">
            Consegna: {formatIT(order.deliveryDate)} alle {order.deliveryTime}
          </span>
          <button
            onClick={() => onMarkDelivered(order.id)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-800 flex items-center gap-1 shrink-0"
          >
            <Check size={12} /> Consegnato
          </button>
        </div>
      )}
    </div>
  );
}

function OrderDetailAdminScreen({
  order,
  clientName,
  onBack,
  onUpdateQty,
  onSetNote,
  onMarkReady,
  onUnschedule,
  onDelete,
}) {
  const [noteDraft, setNoteDraft] = useState(order.note || "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const urgent = isUrgentOrder(order);

  return (
    <div className="px-6 pt-5 pb-8">
      <ScreenHeader title={`Ordine #${order.id}`} subtitle={clientName} onBack={onBack} />

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <StatusDot status={order.status} />
        {urgent && (
          <span className="bg-rose-600 text-white text-[11px] font-bold px-2 py-1 rounded-full">
            URGENTE
          </span>
        )}
        <span className="text-sm text-gray-400">Creato il {formatIT(order.createdDate)}</span>
      </div>

      {order.status !== "nuovo" && order.deliveryDate && (
        <div className="border border-gray-200 rounded-xl px-4 py-3 mb-5 text-sm text-gray-700">
          Consegna {order.status === "consegnato" ? "effettuata" : "programmata"} il{" "}
          <b>{formatIT(order.deliveryDate)}</b> alle <b>{order.deliveryTime}</b>
        </div>
      )}

      {order.status === "nuovo" && order.preferredSlots && order.preferredSlots.length > 0 && (
        <div className="border border-gray-200 rounded-xl px-4 py-3 mb-5 text-sm text-gray-600">
          Orari richiesti dal cliente:{" "}
          {order.preferredSlots.map((s) => `${formatIT(s.date)} ${s.time}`).join(" / ")}
        </div>
      )}

      <div className="font-bold text-gray-900 mb-3">Capi ordinati</div>
      <div className="border border-gray-200 rounded-2xl divide-y divide-gray-100 mb-2">
        {order.items.map((it) => (
          <div key={it.itemId} className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{it.name}</div>
              <div className="text-xs text-gray-400">€{it.price.toFixed(2)}/pezzo</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onUpdateQty(order.id, it.itemId, it.qty - 1)}
                className="w-8 h-8 border border-gray-300 rounded-lg flex items-center justify-center"
              >
                <Minus size={14} />
              </button>
              <span className="w-6 text-center font-semibold text-sm">{it.qty}</span>
              <button
                onClick={() => onUpdateQty(order.id, it.itemId, it.qty + 1)}
                className="w-8 h-8 border border-gray-300 rounded-lg flex items-center justify-center"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        ))}
        {order.items.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-gray-400">
            Nessun capo in questo ordine.
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-1 mb-6">
        <span className="font-semibold text-gray-700">Totale</span>
        <span className="font-bold text-xl text-gray-900">€{order.total.toFixed(2)}</span>
      </div>

      <div className="font-bold text-gray-900 mb-2">Note</div>
      <textarea
        value={noteDraft}
        onChange={(e) => setNoteDraft(e.target.value)}
        onBlur={() => onSetNote(order.id, noteDraft)}
        placeholder="Aggiungi note interne su questo ordine..."
        rows={4}
        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-6"
      />

      {order.status === "nuovo" && (
        <button
          onClick={() => onMarkReady(order.id)}
          className="w-full border border-gray-300 rounded-xl py-2.5 text-sm font-semibold text-gray-800 mb-3"
        >
          Segna come pronto
        </button>
      )}

      {order.status === "programmato" && (
        <button
          onClick={() => onUnschedule(order.id)}
          className="w-full border border-gray-300 rounded-xl py-2.5 text-sm font-semibold text-gray-800 mb-3"
        >
          Annulla programmazione (torna tra i pronti)
        </button>
      )}

      {order.status !== "consegnato" &&
        (!confirmingDelete ? (
          <button
            onClick={() => setConfirmingDelete(true)}
            className="w-full border border-rose-200 text-rose-600 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
          >
            <Trash2 size={14} /> Elimina ordine definitivamente
          </button>
        ) : (
          <div className="border border-rose-200 rounded-xl p-3">
            <div className="text-sm text-rose-600 font-semibold mb-2">
              Sei sicuro? L'operazione non è reversibile.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onDelete(order.id)}
                className="flex-1 bg-rose-600 text-white rounded-lg py-1.5 text-sm font-semibold"
              >
                Sì, elimina
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="flex-1 border border-gray-300 rounded-lg py-1.5 text-sm font-semibold"
              >
                Annulla
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}

function DashboardScreen({
  orders,
  clients,
  onSchedule,
  onMarkReady,
  onMarkDelivered,
  onGoArchive,
  onOpenDetail,
  onNewOrder,
  onLogout,
}) {
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "—";
  const today = isoToday();
  const ordersToday = orders.filter((o) => o.createdDate === today);
  const incassoOggi = ordersToday.reduce((s, o) => s + o.total, 0);

  const counts = {
    nuovo: orders.filter((o) => o.status === "nuovo").length,
    pronto: orders.filter((o) => o.status === "pronto").length,
    programmato: orders.filter((o) => o.status === "programmato").length,
    consegnato: orders.filter((o) => o.status === "consegnato").length,
  };

  const recenti = orders
    .filter((o) => o.status !== "consegnato")
    .sort((a, b) => {
      const da = dueMs(a);
      const db = dueMs(b);
      if (da !== db) return da - db;
      return a.createdDate.localeCompare(b.createdDate) || a.id - b.id;
    });
  const urgentPending = recenti.filter(isUrgentOrder).length;

  return (
    <div className="px-6 pt-5">
      <div className="flex items-start justify-between">
        <ScreenHeader title="Dashboard Lavanderia" subtitle="Gestisci tutti gli ordini e comunicazioni" />
        <button
          onClick={onLogout}
          className="text-xs font-semibold text-gray-400 flex items-center gap-1 shrink-0 mt-1"
        >
          <LogOut size={13} /> Esci
        </button>
      </div>

      <button
        onClick={onNewOrder}
        className="w-full border border-dashed border-gray-300 text-gray-700 rounded-xl py-3 font-semibold flex items-center justify-center gap-2 mb-5"
      >
        <Plus size={16} /> Nuovo Ordine per un cliente
      </button>

      <div className="flex gap-4 mb-5">
        <StatCard
          value={ordersToday.length}
          label="Ordini Oggi"
          icon={<Shirt size={16} className="text-blue-500" />}
        />
        <StatCard
          value={`€${incassoOggi.toFixed(2)}`}
          label="Incasso Oggi"
          icon={<Euro size={16} className="text-emerald-500" />}
        />
      </div>

      <div className="border border-gray-200 rounded-2xl p-5 mb-5">
        <div className="font-bold text-gray-900 mb-4">Stato Ordini</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Nuovi: {counts.nuovo}
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500" /> Pronti: {counts.pronto}
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Programmati:{" "}
            {counts.programmato}
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> Consegnati:{" "}
            {counts.consegnato}
          </span>
          <span className="col-span-2 font-semibold pt-2 mt-1 border-t border-gray-100">
            Totali: {orders.length}
          </span>
        </div>
      </div>

      {urgentPending > 0 && (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 mb-5">
          <div className="flex items-center gap-2 text-rose-600 font-semibold">
            <Bell size={16} /> Attenzione Richiesta
          </div>
          <div className="text-rose-500 text-sm mt-1">
            {urgentPending} ordini urgenti: mancano meno di 48h dall'orario richiesto e non sono
            ancora programmati
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-gray-900">Ordini Recenti</h3>
        <button
          onClick={onGoArchive}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-600"
        >
          <Clock size={16} /> Tutti
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Restano qui finché non vengono consegnati, ordinati per data di consegna
      </p>

      {recenti.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">
          Nessun ordine da lavorare al momento.
        </p>
      )}
      {recenti.map((o) => (
        <OrderRecentCard
          key={o.id}
          order={o}
          clientName={clientName(o.clientId)}
          onMarkReady={onMarkReady}
          onSchedule={onSchedule}
          onMarkDelivered={onMarkDelivered}
          onOpenDetail={onOpenDetail}
        />
      ))}
    </div>
  );
}

function AdminNewOrderScreen({ clients, catalog, onBack, onCreate }) {
  const eligibleClients = clients.filter((c) => Object.keys(c.pricing).length > 0);
  const [clientId, setClientId] = useState(eligibleClients[0]?.id || "");
  const [category, setCategory] = useState("");
  const [qty, setQty] = useState({});
  const [scheduleNow, setScheduleNow] = useState(false);
  const [date, setDate] = useState(addDaysISO(isoToday(), 1));
  const [time, setTime] = useState("10:00");

  const client = clients.find((c) => c.id === clientId);
  const categories = client
    ? CATEGORY_ORDER.filter((cat) =>
        catalog.some((it) => it.category === cat && client.pricing[it.id] !== undefined)
      )
    : [];

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(category)) {
      setCategory(categories[0]);
    }
    setQty({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (eligibleClients.length === 0) {
    return (
      <div className="px-6 pt-5">
        <ScreenHeader title="Nuovo Ordine" onBack={onBack} />
        <p className="text-gray-400 text-sm py-8 text-center">
          Nessun cliente ha ancora un listino configurato. Vai su Clienti per crearne uno prima.
        </p>
      </div>
    );
  }

  const items = client
    ? catalog.filter((it) => it.category === category && client.pricing[it.id] !== undefined)
    : [];
  const allEnabled = client ? catalog.filter((it) => client.pricing[it.id] !== undefined) : [];
  const total = allEnabled.reduce((s, it) => s + (qty[it.id] || 0) * client.pricing[it.id], 0);
  const itemCount = Object.values(qty).reduce((a, b) => a + b, 0);
  const setItemQty = (id, delta) =>
    setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] || 0) + delta) }));

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5">
        <ScreenHeader
          title="Nuovo Ordine"
          subtitle="Crea un ordine e assegnalo a un cliente"
          onBack={onBack}
        />
        <div className="mb-3">
          <div className="text-xs font-semibold text-gray-500 mb-1.5">Cliente</div>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {eligibleClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="px-6 flex gap-1 border-b border-gray-100 overflow-x-auto no-scrollbar">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap mb-2 ${
              category === c ? "bg-gray-900 text-white" : "text-gray-500"
            }`}
          >
            <span>{CATEGORY_ICON[c]}</span>
            {c}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {items.map((item) => (
          <div key={item.id} className="border border-gray-200 rounded-2xl p-5 mb-4">
            <div className="font-bold text-gray-900">{item.name}</div>
            <div className="text-sm text-gray-500 mt-1">
              €{client.pricing[item.id].toFixed(2)}/pezzo
            </div>
            <div className="flex items-center gap-3 mt-4">
              <span className="text-sm font-semibold text-gray-700">Quantità:</span>
              <button
                onClick={() => setItemQty(item.id, -1)}
                className="w-9 h-9 border border-gray-300 rounded-lg flex items-center justify-center"
              >
                <Minus size={16} />
              </button>
              <span className="w-8 text-center font-semibold">{qty[item.id] || 0}</span>
              <button
                onClick={() => setItemQty(item.id, 1)}
                className="w-9 h-9 border border-gray-300 rounded-lg flex items-center justify-center"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        ))}

        <label className="flex items-center gap-2 mt-2 mb-3 select-none">
          <input
            type="checkbox"
            checked={scheduleNow}
            onChange={(e) => setScheduleNow(e.target.checked)}
            className="w-4 h-4 accent-gray-900"
          />
          <span className="text-sm text-gray-700">Programma subito la consegna</span>
        </label>
        {scheduleNow && (
          <div className="flex gap-2 mb-4">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
        )}
      </div>

      <div className="px-6 pb-6 pt-2 border-t border-gray-100">
        <div className="flex items-center justify-between mb-3 text-sm text-gray-600">
          <span>{itemCount} capi selezionati</span>
          <span className="font-bold text-gray-900 text-base">€{total.toFixed(2)}</span>
        </div>
        <button
          disabled={itemCount === 0 || !clientId}
          onClick={() => {
            const orderItems = allEnabled
              .filter((it) => (qty[it.id] || 0) > 0)
              .map((it) => ({
                itemId: it.id,
                name: it.name,
                qty: qty[it.id],
                price: client.pricing[it.id],
              }));
            onCreate({
              clientId,
              items: orderItems,
              total,
              deliveryDate: scheduleNow ? date : null,
              deliveryTime: scheduleNow ? time : null,
            });
          }}
          className="w-full bg-gray-900 disabled:bg-gray-300 text-white rounded-xl py-3.5 font-bold"
        >
          Crea Ordine
        </button>
      </div>
    </div>
  );
}

function ArchivioScreen({ orders, clients, onBack, onOpenDetail }) {
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "—";
  const consegnati = orders
    .filter((o) => o.status === "consegnato")
    .sort((a, b) => {
      const da = `${a.deliveryDate}T${a.deliveryTime || "00:00"}`;
      const db = `${b.deliveryDate}T${b.deliveryTime || "00:00"}`;
      return db.localeCompare(da);
    });

  return (
    <div className="px-6 pt-5">
      <ScreenHeader title="Tutti" subtitle="Consegne già effettuate, per data e ora" onBack={onBack} />
      {consegnati.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">
          Nessuna consegna archiviata ancora.
        </p>
      )}
      {consegnati.map((o) => (
        <div key={o.id} className="border border-gray-200 rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between">
            <span className="font-bold text-gray-900">#{o.id}</span>
            <span className="text-sm text-gray-500">
              {formatIT(o.deliveryDate)} • {o.deliveryTime}
            </span>
          </div>
          <div className="text-sm text-gray-500 mt-1">{clientName(o.clientId)}</div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm text-gray-500">€{o.total.toFixed(2)}</span>
            <button
              onClick={() => onOpenDetail(o.id)}
              className="border border-gray-300 rounded-lg px-3 py-1 text-xs font-semibold text-gray-800"
            >
              Dettagli
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ================= CALENDARIO =================
function CalendarioScreen({ orders, clients, onMarkDelivered, onOpenDetail }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [selected, setSelected] = useState(isoToday());
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "—";

  const cells = buildMonthGrid(month);
  const deliveriesByDay = {};
  orders
    .filter((o) => o.deliveryDate)
    .forEach((o) => {
      deliveriesByDay[o.deliveryDate] = (deliveriesByDay[o.deliveryDate] || 0) + 1;
    });

  const dayOrders = orders
    .filter((o) => o.deliveryDate === selected)
    .sort((a, b) => (a.deliveryTime || "").localeCompare(b.deliveryTime || ""));

  return (
    <div className="px-6 pt-5">
      <ScreenHeader title="Calendario Consegne" subtitle="Organizza le consegne programmate" />

      <div className="border border-gray-200 rounded-2xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>
            <ChevronLeft size={18} />
          </button>
          <span className="font-bold text-gray-900 text-sm">{monthLabel(month)}</span>
          <button onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-gray-400 mb-1">
          {["L", "M", "M", "G", "V", "S", "D"].map((d, i) => (
            <div key={i}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((iso, i) => {
            if (!iso) return <div key={i} />;
            const count = deliveriesByDay[iso] || 0;
            const isSelected = iso === selected;
            const isToday = iso === isoToday();
            return (
              <button
                key={i}
                onClick={() => setSelected(iso)}
                className={`relative h-10 rounded-lg text-sm flex items-center justify-center ${
                  isSelected
                    ? "bg-gray-900 text-white font-bold"
                    : isToday
                    ? "border border-gray-900 font-semibold text-gray-900"
                    : "text-gray-700"
                }`}
              >
                {parseInt(iso.split("-")[2], 10)}
                {count > 0 && (
                  <span
                    className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${
                      isSelected ? "bg-white" : "bg-amber-500"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="font-bold text-gray-900 mb-3">Consegne del {formatIT(selected)}</div>
      {dayOrders.length === 0 && (
        <p className="text-gray-400 text-sm py-6 text-center">
          Nessuna consegna programmata per questo giorno.
        </p>
      )}
      {dayOrders.map((o) => (
        <div key={o.id} className="border border-gray-200 rounded-2xl p-4 mb-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-gray-900">
                #{o.id} • {o.deliveryTime}
              </div>
              <div className="text-sm text-gray-500">{clientName(o.clientId)}</div>
            </div>
            <StatusDot status={o.status} />
          </div>
          <div className="flex gap-2 mt-3">
            {o.status === "programmato" && (
              <button
                onClick={() => onMarkDelivered(o.id)}
                className="flex-1 border border-gray-300 rounded-lg py-1.5 text-sm font-semibold text-gray-800 flex items-center justify-center gap-1.5"
              >
                <Check size={14} /> Consegnato
              </button>
            )}
            <button
              onClick={() => onOpenDetail(o.id)}
              className="flex-1 border border-gray-300 rounded-lg py-1.5 text-sm font-semibold text-gray-800"
            >
              Dettagli
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ================= STATISTICHE =================
function StatisticheScreen({ orders, clients, catalog }) {
  const weightOf = (itemId) => catalog.find((c) => c.id === itemId)?.weightKg || 0;
  const consegnati = orders.filter((o) => o.status === "consegnato");

  const totaleConsegne = consegnati.length;
  const totaleEntrate = consegnati.reduce((s, o) => s + o.total, 0);
  let totaleKg = 0;
  let totalePezzi = 0;
  const perTipo = {};
  const perCliente = {};

  consegnati.forEach((o) => {
    o.items.forEach((it) => {
      totaleKg += it.qty * weightOf(it.itemId);
      totalePezzi += it.qty;
      perTipo[it.name] = (perTipo[it.name] || 0) + it.qty;
    });
    const cName = clients.find((c) => c.id === o.clientId)?.name || "—";
    if (!perCliente[cName]) perCliente[cName] = { pezzi: 0, kg: 0, entrate: 0 };
    perCliente[cName].entrate += o.total;
    o.items.forEach((it) => {
      perCliente[cName].pezzi += it.qty;
      perCliente[cName].kg += it.qty * weightOf(it.itemId);
    });
  });

  const tipoList = Object.entries(perTipo).sort((a, b) => b[1] - a[1]);
  const clienteList = Object.entries(perCliente).sort((a, b) => b[1].entrate - a[1].entrate);

  return (
    <div className="px-6 pt-5 pb-8">
      <ScreenHeader title="Statistiche" subtitle="Calcolate sulle consegne archiviate" />

      <div className="grid grid-cols-2 gap-3 mb-5">
        <StatCard value={totaleConsegne} label="Consegne totali" />
        <StatCard
          value={`€${totaleEntrate.toFixed(2)}`}
          label="Entrate totali"
          valueClass="text-emerald-600"
        />
        <StatCard value={`${totaleKg.toFixed(1)} kg`} label="Kg lavorati" />
        <StatCard value={totalePezzi} label="Pezzi lavorati" />
      </div>

      <div className="border border-gray-200 rounded-2xl p-5 mb-5">
        <div className="font-bold text-gray-900 mb-3">Pezzi per tipologia</div>
        {tipoList.length === 0 && (
          <p className="text-gray-400 text-sm">Nessun dato ancora disponibile.</p>
        )}
        {tipoList.map(([name, qty]) => (
          <div key={name} className="flex items-center justify-between text-sm py-1.5">
            <span className="text-gray-700">{name}</span>
            <span className="font-semibold text-gray-900">{qty} pz</span>
          </div>
        ))}
      </div>

      <div className="border border-gray-200 rounded-2xl p-5">
        <div className="font-bold text-gray-900 mb-3">Per cliente</div>
        {clienteList.length === 0 && (
          <p className="text-gray-400 text-sm">Nessun dato ancora disponibile.</p>
        )}
        {clienteList.map(([name, d]) => (
          <div key={name} className="py-2 border-b border-gray-100 last:border-0">
            <div className="font-medium text-gray-900 text-sm">{name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {d.pezzi} pz • {d.kg.toFixed(1)} kg • €{d.entrate.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ================= VISTA LAVANDERIA (root) =================
function LavanderiaView({ data, actions }) {
  const [nav, setNav] = useState("dashboard");
  const [clientDetailId, setClientDetailId] = useState(null);
  const [detailOrderId, setDetailOrderId] = useState(null);
  const [creatingOrder, setCreatingOrder] = useState(false);

  const navItems = [
    { key: "dashboard", label: "Dashboard", icon: <Home size={18} /> },
    { key: "clienti", label: "Clienti", icon: <Users size={18} /> },
    { key: "calendario", label: "Calendario", icon: <CalendarIcon size={18} /> },
    { key: "statistiche", label: "Statistiche", icon: <BarChart3 size={18} /> },
  ];

  if (creatingOrder) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto">
          <AdminNewOrderScreen
            clients={data.clients}
            catalog={data.catalog}
            onBack={() => setCreatingOrder(false)}
            onCreate={(payload) => {
              actions.adminCreateOrder(payload);
              setCreatingOrder(false);
            }}
          />
        </div>
        <BottomNav
          items={navItems}
          active={nav}
          onChange={(k) => {
            setCreatingOrder(false);
            setNav(k);
            setClientDetailId(null);
          }}
        />
      </div>
    );
  }

  if (detailOrderId) {
    const order = data.orders.find((o) => o.id === detailOrderId);
    const clientName = data.clients.find((c) => c.id === order.clientId)?.name || "—";
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto">
          <OrderDetailAdminScreen
            order={order}
            clientName={clientName}
            onBack={() => setDetailOrderId(null)}
            onUpdateQty={actions.updateOrderItemQty}
            onSetNote={actions.setOrderNote}
            onMarkReady={(id) => actions.markReady(id)}
            onUnschedule={(id) => {
              actions.unscheduleOrder(id);
              setDetailOrderId(null);
            }}
            onDelete={(id) => {
              actions.deleteOrder(id);
              setDetailOrderId(null);
            }}
          />
        </div>
        <BottomNav
          items={navItems}
          active={nav}
          onChange={(k) => {
            setDetailOrderId(null);
            setNav(k);
            setClientDetailId(null);
          }}
        />
      </div>
    );
  }

  let content;
  if (nav === "dashboard") {
    content = (
      <DashboardScreen
        orders={data.orders}
        clients={data.clients}
        onSchedule={actions.scheduleOrder}
        onMarkReady={actions.markReady}
        onMarkDelivered={actions.markDelivered}
        onGoArchive={() => setNav("archivio")}
        onOpenDetail={setDetailOrderId}
        onNewOrder={() => setCreatingOrder(true)}
        onLogout={actions.logout}
      />
    );
  } else if (nav === "archivio") {
    content = (
      <ArchivioScreen
        orders={data.orders}
        clients={data.clients}
        onBack={() => setNav("dashboard")}
        onOpenDetail={setDetailOrderId}
      />
    );
  } else if (nav === "clienti") {
    const client = data.clients.find((c) => c.id === clientDetailId);
    content = client ? (
      <ClientDetailScreen
        client={client}
        catalog={data.catalog}
        onBack={() => setClientDetailId(null)}
        onSetPrice={actions.setClientPrice}
        onRemoveItem={actions.removeClientItem}
        onAddNewItem={actions.addCatalogItemForClient}
      />
    ) : (
      <ClientiListScreen
        clients={data.clients}
        orders={data.orders}
        onOpen={setClientDetailId}
      />
    );
  } else if (nav === "calendario") {
    content = (
      <CalendarioScreen
        orders={data.orders}
        clients={data.clients}
        onMarkDelivered={actions.markDelivered}
        onOpenDetail={setDetailOrderId}
      />
    );
  } else if (nav === "statistiche") {
    content = <StatisticheScreen orders={data.orders} clients={data.clients} catalog={data.catalog} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">{content}</div>
      <BottomNav
        items={navItems}
        active={nav}
        onChange={(k) => {
          setNav(k);
          setClientDetailId(null);
        }}
      />
    </div>
  );
}

// ================= NUOVO ORDINE (lato Cliente) =================
function NewOrderScreen({ client, catalog, onBack, onCreate }) {
  const categories = CATEGORY_ORDER.filter((cat) =>
    catalog.some((it) => it.category === cat && client.pricing[it.id] !== undefined)
  );
  const [category, setCategory] = useState(categories[0] || null);
  const [qty, setQty] = useState({});
  const [slots, setSlots] = useState([{ date: addDaysISO(isoToday(), 2), time: "09:00" }]);

  if (categories.length === 0) {
    return (
      <div className="px-6 pt-5">
        <ScreenHeader title="Nuovo Ordine" onBack={onBack} />
        <p className="text-gray-400 text-sm py-8 text-center">
          Il listino non è ancora stato configurato dalla lavanderia. Contattali per iniziare.
        </p>
      </div>
    );
  }

  const items = catalog.filter(
    (it) => it.category === category && client.pricing[it.id] !== undefined
  );
  const allEnabled = catalog.filter((it) => client.pricing[it.id] !== undefined);
  const total = allEnabled.reduce((s, it) => s + (qty[it.id] || 0) * client.pricing[it.id], 0);
  const itemCount = Object.values(qty).reduce((a, b) => a + b, 0);

  const setItemQty = (id, delta) =>
    setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] || 0) + delta) }));
  const updateSlot = (i, field, value) =>
    setSlots((s) => s.map((sl, idx) => (idx === i ? { ...sl, [field]: value } : sl)));
  const addSlot = () => setSlots((s) => [...s, { date: addDaysISO(isoToday(), 2), time: "09:00" }]);
  const removeSlot = (i) => setSlots((s) => s.filter((_, idx) => idx !== i));
  const validSlots = slots.filter((s) => isSlotValid(s.date, s.time));
  const hasInvalidSlot = slots.some((s) => !isSlotValid(s.date, s.time));

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5">
        <ScreenHeader
          title="Nuovo Ordine"
          subtitle="Crea un nuovo ordine per la biancheria"
          onBack={onBack}
        />
      </div>

      <div className="px-6 flex gap-1 border-b border-gray-100 overflow-x-auto no-scrollbar">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap mb-2 ${
              category === c ? "bg-gray-900 text-white" : "text-gray-500"
            }`}
          >
            <span>{CATEGORY_ICON[c]}</span>
            {c}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {items.map((item) => (
          <div key={item.id} className="border border-gray-200 rounded-2xl p-5 mb-4">
            <div className="font-bold text-gray-900">{item.name}</div>
            <div className="text-sm text-gray-500 mt-1">
              €{client.pricing[item.id].toFixed(2)}/pezzo
            </div>
            <div className="flex items-center gap-3 mt-4">
              <span className="text-sm font-semibold text-gray-700">Quantità:</span>
              <button
                onClick={() => setItemQty(item.id, -1)}
                className="w-9 h-9 border border-gray-300 rounded-lg flex items-center justify-center"
              >
                <Minus size={16} />
              </button>
              <span className="w-8 text-center font-semibold">{qty[item.id] || 0}</span>
              <button
                onClick={() => setItemQty(item.id, 1)}
                className="w-9 h-9 border border-gray-300 rounded-lg flex items-center justify-center"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        ))}

        <div className="mt-2 mb-4">
          <div className="font-bold text-gray-900 mb-1">Quando preferisci la consegna?</div>
          <p className="text-xs text-gray-400 mb-3">
            Indica uno o più orari possibili, con almeno 24 ore di anticipo. La lavanderia sceglierà
            quello più adatto e non sarà modificabile dopo la conferma.
          </p>
          {slots.map((s, i) => {
            const valid = isSlotValid(s.date, s.time);
            return (
              <div key={i} className="mb-2">
                <div className="flex gap-2 items-center">
                  <input
                    type="date"
                    value={s.date}
                    min={addDaysISO(isoToday(), 1)}
                    onChange={(e) => updateSlot(i, "date", e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                  />
                  <input
                    type="time"
                    value={s.time}
                    onChange={(e) => updateSlot(i, "time", e.target.value)}
                    className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                  />
                  {slots.length > 1 && (
                    <button
                      onClick={() => removeSlot(i)}
                      className="w-9 h-9 border border-gray-300 rounded-lg flex items-center justify-center text-gray-500 shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {!valid && (
                  <div className="text-xs text-rose-600 mt-1">
                    Serve almeno 24 ore di anticipo da adesso.
                  </div>
                )}
              </div>
            );
          })}
          <button
            onClick={addSlot}
            className="text-sm font-semibold text-gray-600 flex items-center gap-1.5 mt-1"
          >
            <Plus size={14} /> Aggiungi un altro orario
          </button>
        </div>
      </div>

      <div className="px-6 pb-6 pt-2 border-t border-gray-100">
        <div className="flex items-center justify-between mb-3 text-sm text-gray-600">
          <span>{itemCount} capi selezionati</span>
          <span className="font-bold text-gray-900 text-base">€{total.toFixed(2)}</span>
        </div>
        <button
          disabled={itemCount === 0 || hasInvalidSlot || validSlots.length === 0}
          onClick={() => {
            const orderItems = allEnabled
              .filter((it) => (qty[it.id] || 0) > 0)
              .map((it) => ({
                itemId: it.id,
                name: it.name,
                qty: qty[it.id],
                price: client.pricing[it.id],
              }));
            onCreate({ items: orderItems, total, preferredSlots: validSlots });
          }}
          className="w-full bg-gray-900 disabled:bg-gray-300 text-white rounded-xl py-3.5 font-bold"
        >
          Conferma Ordine
        </button>
      </div>
    </div>
  );
}

function ClienteOrderCard({ order }) {
  return (
    <div className="border border-gray-200 rounded-2xl p-5 mb-4">
      <div className="flex items-center justify-between">
        <span className="font-bold text-gray-900">#{order.id}</span>
        <span className="text-sm text-gray-500">
          {formatIT(order.createdDate)} • €{order.total.toFixed(2)}
        </span>
      </div>
      <div className="mt-3 text-xs text-gray-500">
        {order.items.map((it) => `${it.qty}× ${it.name}`).join(" · ")}
      </div>
      <div className="mt-3">
        <StatusDot status={order.status} />
      </div>
      <div className="mt-3 bg-gray-50 text-sm text-gray-600 rounded-xl p-3">
        {order.status === "nuovo" && "Il tuo ordine è stato ricevuto e verrà lavorato a breve."}
        {order.status === "pronto" &&
          "Il tuo ordine è pronto ed è in attesa di essere programmato per la consegna."}
        {order.status === "programmato" &&
          `Consegna prevista il ${formatIT(order.deliveryDate)} alle ${order.deliveryTime}.`}
        {order.status === "consegnato" &&
          `Consegnato il ${formatIT(order.deliveryDate)} alle ${order.deliveryTime}.`}
      </div>
    </div>
  );
}

function MessaggiScreen({ notifications }) {
  const sorted = [...notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="px-6 pt-5">
      <ScreenHeader title="Messaggi" subtitle="Notifiche sulle azioni relative ai tuoi ordini" />
      {sorted.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">Nessuna notifica per ora.</p>
      )}
      {sorted.map((n) => (
        <div key={n.id} className="border border-gray-200 rounded-2xl p-4 mb-3">
          <div className="text-sm text-gray-800">{n.message}</div>
          <div className="text-xs text-gray-400 mt-1">{formatDateTimeIT(n.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}

// ================= AUTENTICAZIONE CLIENTE =================
function AdminSignupForm({ onSubmit, onCancel }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (!email.trim() || !password) {
      setError("Compila email e password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Le password non coincidono.");
      return;
    }
    setBusy(true);
    try {
      const res = await onSubmit(email.trim(), password);
      if (!res.ok) setError(res.error);
      else setDone(true);
    } catch (e) {
      console.error(e);
      setError("Si è verificato un problema. Riprova tra poco.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
        Account creato. Comunica l'email <b>{email}</b> a chi ti sta configurando l'app: dovrà
        eseguire una riga di SQL per attivare i tuoi permessi da amministratore. Dopodiché potrai
        accedere normalmente con "Accedi".
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-400 mb-3">
        Questo crea solo il tuo accesso come titolare della lavanderia (nessun dato di una
        struttura cliente). L'attivazione finale dei permessi va fatta una volta sola lato database.
      </p>
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 text-sm rounded-xl px-3 py-2 mb-3">
          {error}
        </div>
      )}
      <input
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
      />
      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
      />
      <input
        placeholder="Conferma password"
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
      />
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={submit}
          className="flex-1 bg-gray-900 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-semibold"
        >
          Crea accesso amministratore
        </button>
        <button
          onClick={onCancel}
          className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-semibold"
        >
          Annulla
        </button>
      </div>
    </div>
  );
}

function AuthScreen({ onLogin, onRegister, onAdminSignup }) {
  const [mode, setMode] = useState("login");
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [sameAddress, setSameAddress] = useState(true);
  const [billingName, setBillingName] = useState("");
  const [billingVat, setBillingVat] = useState("");
  const [billingAddress, setBillingAddress] = useState("");

  const submitLogin = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await onLogin(loginEmail.trim(), loginPassword);
      if (!res.ok) setError(res.error);
    } catch (e) {
      console.error(e);
      setError("Si è verificato un problema. Riprova tra poco.");
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async () => {
    setError("");
    if (
      !businessName.trim() ||
      !email.trim() ||
      !deliveryAddress.trim() ||
      !phone.trim() ||
      !billingVat.trim()
    ) {
      setError("Compila tutti i campi obbligatori.");
      return;
    }
    if (!password || password !== confirmPassword) {
      setError("Le password non coincidono.");
      return;
    }
    setBusy(true);
    try {
      const res = await onRegister({
        businessName: businessName.trim(),
        email: email.trim(),
        password,
        deliveryAddress: deliveryAddress.trim(),
        phone: phone.trim(),
        billingName: billingName.trim() || businessName.trim(),
        billingVat: billingVat.trim(),
        billingAddress: sameAddress ? deliveryAddress.trim() : billingAddress.trim(),
      });
      if (!res.ok) setError(res.error);
    } catch (e) {
      console.error(e);
      setError("Si è verificato un problema. Riprova tra poco.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-6 pt-6 pb-8 h-full overflow-y-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Benvenuto</h2>
      <p className="text-gray-500 text-sm mb-5">Accedi o registra la tua struttura</p>

      <div className="flex bg-gray-100 rounded-full p-1 mb-5">
        <Pill
          active={mode === "login"}
          onClick={() => {
            setMode("login");
            setError("");
          }}
          icon="🔑"
        >
          Accedi
        </Pill>
        <Pill
          active={mode === "register"}
          onClick={() => {
            setMode("register");
            setError("");
          }}
          icon="🏨"
        >
          Registrati
        </Pill>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 text-sm rounded-xl px-3 py-2 mb-4">
          {error}
        </div>
      )}

      {mode === "login" ? (
        <div>
          <input
            placeholder="Email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <input
            placeholder="Password"
            type="password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <button
            disabled={busy}
            onClick={submitLogin}
            className="w-full bg-gray-900 disabled:bg-gray-300 text-white rounded-xl py-3 font-bold"
          >
            Accedi
          </button>
        </div>
      ) : (
        <div>
          <input
            placeholder="Nome struttura (es. Hotel Sole)"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <input
            placeholder="Conferma password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />

          <div className="text-xs font-semibold text-gray-500 mt-2 mb-2">Consegna e contatto</div>
          <input
            placeholder="Indirizzo di consegna"
            value={deliveryAddress}
            onChange={(e) => setDeliveryAddress(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <input
            placeholder="Telefono del referente"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />

          <div className="text-xs font-semibold text-gray-500 mt-2 mb-2">Dati di fatturazione</div>
          <input
            placeholder="Ragione sociale (se diversa dal nome struttura)"
            value={billingName}
            onChange={(e) => setBillingName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <input
            placeholder="Partita IVA / Codice Fiscale"
            value={billingVat}
            onChange={(e) => setBillingVat(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <label className="flex items-center gap-2 mb-3 select-none">
            <input
              type="checkbox"
              checked={sameAddress}
              onChange={(e) => setSameAddress(e.target.checked)}
              className="w-4 h-4 accent-gray-900"
            />
            <span className="text-sm text-gray-600">
              Indirizzo di fatturazione uguale a quello di consegna
            </span>
          </label>
          {!sameAddress && (
            <input
              placeholder="Indirizzo di fatturazione"
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
            />
          )}

          <button
            disabled={busy}
            onClick={submitRegister}
            className="w-full bg-gray-900 disabled:bg-gray-300 text-white rounded-xl py-3 font-bold mt-2"
          >
            Crea account
          </button>
        </div>
      )}

      <div className="mt-8 pt-5 border-t border-gray-100">
        {!showAdminForm ? (
          <button
            onClick={() => setShowAdminForm(true)}
            className="text-xs font-semibold text-gray-400 underline"
          >
            Sei il titolare della lavanderia? Crea qui il tuo accesso amministratore
          </button>
        ) : (
          <AdminSignupForm onSubmit={onAdminSignup} onCancel={() => setShowAdminForm(false)} />
        )}
      </div>
    </div>
  );
}

function CompleteProfileScreen({ client, onComplete, onLogout }) {
  const [businessName, setBusinessName] = useState(client.name || "");
  const [deliveryAddress, setDeliveryAddress] = useState(client.account.deliveryAddress || "");
  const [phone, setPhone] = useState(client.account.phone || "");
  const [billingName, setBillingName] = useState(client.account.billingName || "");
  const [billingVat, setBillingVat] = useState(client.account.billingVat || "");
  const [sameAddress, setSameAddress] = useState(true);
  const [billingAddress, setBillingAddress] = useState(client.account.billingAddress || "");
  const [error, setError] = useState("");

  const submit = () => {
    if (!deliveryAddress.trim() || !phone.trim() || !billingVat.trim()) {
      setError("Compila tutti i campi obbligatori.");
      return;
    }
    onComplete({
      businessName: businessName.trim(),
      deliveryAddress: deliveryAddress.trim(),
      phone: phone.trim(),
      billingName: billingName.trim() || businessName.trim(),
      billingVat: billingVat.trim(),
      billingAddress: sameAddress ? deliveryAddress.trim() : billingAddress.trim(),
    });
  };

  return (
    <div className="px-6 pt-6 pb-8 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-bold text-gray-900">Completa il tuo profilo</h2>
        <button
          onClick={onLogout}
          className="text-xs font-semibold text-gray-400 flex items-center gap-1"
        >
          <LogOut size={13} /> Esci
        </button>
      </div>
      <p className="text-gray-500 text-sm mb-5">
        Ci servono ancora alcuni dati prima di attivare il tuo account.
      </p>
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 text-sm rounded-xl px-3 py-2 mb-4">
          {error}
        </div>
      )}
      <input
        placeholder="Nome struttura"
        value={businessName}
        onChange={(e) => setBusinessName(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
      />
      <input
        placeholder="Indirizzo di consegna"
        value={deliveryAddress}
        onChange={(e) => setDeliveryAddress(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
      />
      <input
        placeholder="Telefono del referente"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
      />
      <input
        placeholder="Ragione sociale (fatturazione)"
        value={billingName}
        onChange={(e) => setBillingName(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
      />
      <input
        placeholder="Partita IVA / Codice Fiscale"
        value={billingVat}
        onChange={(e) => setBillingVat(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
      />
      <label className="flex items-center gap-2 mb-3 select-none">
        <input
          type="checkbox"
          checked={sameAddress}
          onChange={(e) => setSameAddress(e.target.checked)}
          className="w-4 h-4 accent-gray-900"
        />
        <span className="text-sm text-gray-600">
          Indirizzo di fatturazione uguale a quello di consegna
        </span>
      </label>
      {!sameAddress && (
        <input
          placeholder="Indirizzo di fatturazione"
          value={billingAddress}
          onChange={(e) => setBillingAddress(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
        />
      )}
      <button
        onClick={submit}
        className="w-full bg-gray-900 text-white rounded-xl py-3 font-bold mt-2"
      >
        Salva e continua
      </button>
    </div>
  );
}

function WaitingActivationScreen({ clientName, onLogout }) {
  return (
    <div className="px-6 pt-5 flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Ciao, {clientName}!</h2>
        <button
          onClick={onLogout}
          className="text-xs font-semibold text-gray-400 flex items-center gap-1"
        >
          <LogOut size={13} /> Esci
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
        <div className="text-4xl mb-4">⏳</div>
        <div className="font-bold text-gray-900 mb-2">Account creato con successo</div>
        <p className="text-gray-500 text-sm">
          La lavanderia sta configurando il listino prezzi per la tua struttura. Appena sarà pronto
          potrai iniziare a creare ordini.
        </p>
      </div>
    </div>
  );
}

// ================= VISTA CLIENTE (root) =================
function ClienteDashboard({ data, client, actions }) {
  const [tab, setTab] = useState("ordini");
  const [subScreen, setSubScreen] = useState("dashboard");

  const myOrders = data.orders
    .filter((o) => o.clientId === client.id)
    .sort((a, b) => b.id - a.id);
  const active = myOrders.filter((o) => o.status !== "consegnato").length;
  const programmati = myOrders.filter((o) => o.status === "programmato").length;
  const myNotifications = (data.notifications || []).filter((n) => n.clientId === client.id);

  const bottomItems = [
    { key: "ordini", label: "Ordini", icon: <Shirt size={18} /> },
    { key: "messaggi", label: "Messaggi", icon: <MessageSquare size={18} /> },
  ];

  if (tab === "messaggi") {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto">
          <MessaggiScreen notifications={myNotifications} />
        </div>
        <BottomNav items={bottomItems} active={tab} onChange={setTab} />
      </div>
    );
  }

  if (subScreen === "newOrder") {
    return (
      <NewOrderScreen
        client={client}
        catalog={data.catalog}
        onBack={() => setSubScreen("dashboard")}
        onCreate={(payload) => {
          actions.addOrder({ clientId: client.id, ...payload });
          setSubScreen("dashboard");
        }}
      />
    );
  }

  if (subScreen === "cronologia") {
    return (
      <div className="px-6 pt-5 pb-6 h-full overflow-y-auto">
        <ScreenHeader
          title="Cronologia"
          subtitle="Tutti i tuoi ordini"
          onBack={() => setSubScreen("dashboard")}
        />
        {myOrders.length === 0 && (
          <p className="text-gray-400 text-sm py-8 text-center">Nessun ordine ancora.</p>
        )}
        {myOrders.map((o) => (
          <ClienteOrderCard key={o.id} order={o} />
        ))}
      </div>
    );
  }

  const activeOrders = myOrders.filter((o) => o.status !== "consegnato");

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 pt-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-2xl font-bold text-gray-900">Ciao, {client.name}! 👋</h2>
          <button
            onClick={actions.logout}
            className="text-xs font-semibold text-gray-400 flex items-center gap-1 shrink-0"
          >
            <LogOut size={13} /> Esci
          </button>
        </div>
        <p className="text-gray-500 mt-1 mb-5">Gestisci i tuoi ordini di biancheria</p>

        <button
          onClick={() => setSubScreen("newOrder")}
          className="w-full bg-gray-900 text-white rounded-xl py-3.5 font-bold flex items-center justify-center gap-2 mb-5"
        >
          <Plus size={18} /> Nuovo Ordine
        </button>

        <div className="flex gap-4 mb-6">
          <StatCard value={active} label="Ordini Attivi" />
          <StatCard value={programmati} label="Programmati" valueClass="text-amber-600" />
        </div>

        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-gray-900">I Tuoi Ordini</h3>
          <button
            onClick={() => setSubScreen("cronologia")}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 border border-gray-200 rounded-full px-3 py-1"
          >
            <Clock size={13} /> Cronologia
          </button>
        </div>

        {activeOrders.length === 0 && (
          <p className="text-gray-400 text-sm py-8 text-center">
            Nessun ordine ancora. Crea il tuo primo ordine!
          </p>
        )}
        {activeOrders.map((o) => (
          <ClienteOrderCard key={o.id} order={o} />
        ))}
      </div>

      <BottomNav items={bottomItems} active={tab} onChange={setTab} />
    </div>
  );
}

function ClienteView({ data, client, actions }) {
  const needsProfile =
    !client.account.phone || !client.account.deliveryAddress || !client.account.billingVat;
  if (needsProfile) {
    return (
      <CompleteProfileScreen
        client={client}
        onComplete={(fields) => actions.completeProfile(client.id, fields)}
        onLogout={actions.logout}
      />
    );
  }

  if (Object.keys(client.pricing).length === 0) {
    return <WaitingActivationScreen clientName={client.name} onLogout={actions.logout} />;
  }

  return <ClienteDashboard data={data} client={client} actions={actions} />;
}

// ================= APP ROOT =================
export default function App() {
  const [authUser, setAuthUser] = useState(undefined); // undefined = in caricamento, null = non loggato
  const [data, setData] = useState(null);

  const refresh = useCallback(async () => {
    const fresh = await api.fetchAll();
    setData(fresh);
    return fresh;
  }, []);

  useEffect(() => {
    (async () => {
      const user = await api.getSession();
      setAuthUser(user);
      if (user) await refresh();
    })();
  }, [refresh]);

  const actions = {
    setClientPrice: async (clientId, itemId, price) => {
      await api.setClientPrice(clientId, itemId, price);
      await refresh();
    },
    removeClientItem: async (clientId, itemId) => {
      await api.removeClientItem(clientId, itemId);
      await refresh();
    },
    addCatalogItemForClient: async (clientId, fields) => {
      await api.addCatalogItemForClient(clientId, fields);
      await refresh();
    },
    addOrder: async (payload) => {
      await api.createOrder(payload);
      await refresh();
    },
    adminCreateOrder: async (payload) => {
      await api.adminCreateOrder(payload);
      await refresh();
    },
    scheduleOrder: async (orderId, date, time) => {
      await api.scheduleOrder(orderId, date, time);
      await refresh();
    },
    unscheduleOrder: async (orderId) => {
      await api.unscheduleOrder(orderId);
      await refresh();
    },
    markReady: async (orderId) => {
      await api.markReady(orderId);
      await refresh();
    },
    markDelivered: async (orderId) => {
      await api.markDelivered(orderId);
      await refresh();
    },
    deleteOrder: async (orderId) => {
      await api.deleteOrder(orderId);
      await refresh();
    },
    updateOrderItemQty: async (orderId, itemId, newQty) => {
      await api.updateOrderItemQty(orderId, itemId, newQty);
      await refresh();
    },
    setOrderNote: async (orderId, note) => {
      await api.setOrderNote(orderId, note);
      await refresh();
    },
    completeProfile: async (clientId, fields) => {
      await api.completeProfile(clientId, fields);
      await refresh();
    },
    loginClient: async (email, password) => {
      const res = await api.signIn(email, password);
      if (!res.ok) return res;
      try {
        const user = await api.getSession();
        setAuthUser(user);
        await refresh();
        return { ok: true };
      } catch (e) {
        console.error("post-login error:", e);
        return { ok: false, error: "Accesso riuscito ma non è stato possibile caricare i dati. Riprova." };
      }
    },
    registerClient: async (fields) => {
      const res = await api.signUpClient(fields);
      if (!res.ok) return res;
      try {
        const user = await api.getSession();
        setAuthUser(user);
        await refresh();
        return { ok: true };
      } catch (e) {
        console.error("post-register error:", e);
        return { ok: false, error: "Account creato ma non è stato possibile caricare i dati. Riprova ad accedere." };
      }
    },
    adminSignup: async (email, password) => {
      try {
        return await api.signUpAdmin(email, password);
      } catch (e) {
        console.error("adminSignup error:", e);
        return { ok: false, error: "Si è verificato un problema. Riprova tra poco." };
      }
    },
    logout: async () => {
      await api.signOut();
      setAuthUser(null);
      setData(null);
    },
  };

  if (authUser === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-gray-400" size={28} />
      </div>
    );
  }

  if (authUser === null) {
    return (
      <div className="min-h-screen bg-gray-100 flex justify-center py-6 px-3">
        <div className="w-full max-w-md bg-white rounded-[2rem] shadow-sm border border-gray-100 flex flex-col h-[820px] overflow-hidden">
          <AuthScreen
            onLogin={actions.loginClient}
            onRegister={actions.registerClient}
            onAdminSignup={actions.adminSignup}
          />
        </div>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-gray-400" size={28} />
      </div>
    );
  }

  const client = !data.isStaff ? data.clients.find((c) => c.userId === authUser.id) : null;

  return (
    <div className="min-h-screen bg-gray-100 flex justify-center py-6 px-3">
      <div className="w-full max-w-md bg-white rounded-[2rem] shadow-sm border border-gray-100 flex flex-col h-[820px] overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {data.isStaff ? (
            <LavanderiaView data={data} actions={actions} />
          ) : client ? (
            <ClienteView data={data} client={client} actions={actions} />
          ) : (
            <div className="p-6 flex flex-col h-full">
              <p className="text-sm text-gray-500 mb-4">
                Non troviamo il tuo profilo cliente, e il tuo account non risulta ancora attivato
                come amministratore. Se ti sei appena registrato come amministratore, assicurati
                che la riga SQL di attivazione sia stata eseguita, poi riprova.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={refresh}
                  className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-semibold text-gray-800"
                >
                  Riprova
                </button>
                <button
                  onClick={actions.logout}
                  className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-semibold text-gray-800"
                >
                  Esci
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
