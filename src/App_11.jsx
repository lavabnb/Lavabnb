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
  ChevronDown,
  Settings,
  X,
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
function toNumber(str) {
  if (typeof str !== "string") return Number(str) || 0;
  const n = parseFloat(str.replace(",", "."));
  return isNaN(n) ? 0 : n;
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
function hasClientMessage(order) {
  const messages = order.messages || [];
  const last = messages[messages.length - 1];
  return !!last && last.sender === "client" && order.staffMessageSeen === false;
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

const CLIENT_STATUS = {
  nuovo: { label: "Nuovo", color: "bg-blue-500" },
  pronto: { label: "Confermato", color: "bg-purple-500" },
  programmato: { label: "Confermato", color: "bg-purple-500" },
  consegnato: { label: "Consegnato", color: "bg-slate-400" },
};

const REASON_LABELS = {
  lavaggio: "Lavaggio",
  cliente: "Cliente",
  qualita: "Qualità prodotto",
  altro: "Altro",
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

function StatCard({ value, label, valueClass = "text-gray-900", icon, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className="flex-1 border border-gray-200 rounded-2xl p-4 text-left">
      <div className="flex items-center justify-between">
        <span className="text-gray-500 text-xs">{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-bold mt-1 ${valueClass}`}>{value}</div>
    </Tag>
  );
}

function StatusDot({ status, forClient }) {
  const s = (forClient ? CLIENT_STATUS : STATUS)[status];
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

function ClientDetailScreen({
  client,
  catalog,
  onBack,
  onSetPrice,
  onRemoveItem,
  onAddNewItem,
  onUpdateWeight,
  onDeleteCatalogItem,
  onDeleteClient,
}) {
  const [addingItem, setAddingItem] = useState(null); // category or null
  const [newName, setNewName] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState(null);
  const [confirmDeleteClient, setConfirmDeleteClient] = useState(false);

  const submitNewItem = (category) => {
    if (!newName.trim() || !newWeight || !newPrice) return;
    onAddNewItem(client.id, {
      name: newName.trim(),
      category,
      weightKg: toNumber(newWeight),
      price: toNumber(newPrice),
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
        const items = catalog.filter((it) => it.category === cat && it.clientId === client.id);
        return (
          <div key={cat} className="mb-6">
            <div className="flex items-center gap-2 mb-2 text-sm font-bold text-gray-700">
              <span>{CATEGORY_ICON[cat]}</span> {cat}
            </div>
            {items.map((it) => {
              const enabled = client.pricing[it.id] !== undefined;
              const confirmingDelete = confirmDeleteItemId === it.id;
              return (
                <div key={it.id} className="border border-gray-200 rounded-xl px-4 py-3 mb-2">
                  <div className="flex items-center justify-between">
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
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 truncate">{it.name}</div>
                        <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={it.weightKg}
                            onChange={(e) => onUpdateWeight(it.id, toNumber(e.target.value))}
                            className="w-12 border border-gray-200 rounded px-1 py-0.5 text-xs text-right"
                          />
                          <span>kg/pz</span>
                        </div>
                      </div>
                    </label>
                    <div className="flex items-center gap-2 shrink-0">
                      {enabled && (
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400 text-sm">€</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={client.pricing[it.id]}
                            onChange={(e) => onSetPrice(client.id, it.id, toNumber(e.target.value))}
                            className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right"
                          />
                        </div>
                      )}
                      {!confirmingDelete && (
                        <button
                          onClick={() => setConfirmDeleteItemId(it.id)}
                          className="text-gray-300 hover:text-rose-500"
                          title="Elimina tipologia dal catalogo"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                  {confirmingDelete && (
                    <div className="mt-2 bg-rose-50 border border-rose-200 rounded-lg p-2 flex items-center justify-between">
                      <span className="text-xs text-rose-600 font-medium">
                        Eliminare "{it.name}" dal catalogo per tutti i clienti?
                      </span>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => {
                            onDeleteCatalogItem(it.id);
                            setConfirmDeleteItemId(null);
                          }}
                          className="bg-rose-600 text-white text-xs font-semibold rounded-lg px-2.5 py-1"
                        >
                          Sì
                        </button>
                        <button
                          onClick={() => setConfirmDeleteItemId(null)}
                          className="border border-gray-300 text-xs font-semibold rounded-lg px-2.5 py-1"
                        >
                          No
                        </button>
                      </div>
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
                    type="text"
                    inputMode="decimal"
                    value={newWeight}
                    onChange={(e) => setNewWeight(e.target.value)}
                    className="w-1/2 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Prezzo €"
                    type="text"
                    inputMode="decimal"
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

      <div className="mt-8 pt-6 border-t border-gray-100">
        {!confirmDeleteClient ? (
          <button
            onClick={() => setConfirmDeleteClient(true)}
            className="w-full border border-rose-200 text-rose-600 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
          >
            <Trash2 size={14} /> Elimina cliente
          </button>
        ) : (
          <div className="border border-rose-200 rounded-xl p-3">
            <div className="text-sm text-rose-600 font-semibold mb-2">
              Eliminare definitivamente {client.name}? Verranno eliminati anche tutti i suoi ordini
              e lo storico. L'operazione non è reversibile.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onDeleteClient(client.id)}
                className="flex-1 bg-rose-600 text-white rounded-lg py-1.5 text-sm font-semibold"
              >
                Sì, elimina definitivamente
              </button>
              <button
                onClick={() => setConfirmDeleteClient(false)}
                className="flex-1 border border-gray-300 rounded-lg py-1.5 text-sm font-semibold"
              >
                Annulla
              </button>
            </div>
          </div>
        )}
      </div>
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

function ConfirmDeliverButton({ orderId, onConfirm, className }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-gray-500 whitespace-nowrap">Sicuro?</span>
        <button
          onClick={() => onConfirm(orderId)}
          className="bg-rose-600 text-white text-xs font-semibold rounded-lg px-2.5 py-1.5"
        >
          Sì
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="border border-gray-300 text-xs font-semibold rounded-lg px-2.5 py-1.5 text-gray-700"
        >
          No
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => setConfirming(true)}
      className={
        className ||
        "border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-800 flex items-center gap-1 shrink-0"
      }
    >
      <Check size={12} /> Consegnato
    </button>
  );
}

function OrderRecentCard({ order, clientName, onMarkReady, onSchedule, onMarkDelivered, onOpenDetail, onMarkMessageSeen }) {
  const [scheduling, setScheduling] = useState(false);
  const urgent = isUrgentOrder(order);
  const deliverySoon = isDeliverySoon(order);
  const clientMsg = hasClientMessage(order);
  return (
    <div className={`border rounded-2xl p-5 mb-4 ${clientMsg ? "border-blue-300 bg-blue-50/30" : "border-gray-200"}`}>
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
            {clientMsg && (
              <span className="bg-blue-600 text-white text-[11px] font-bold pl-2 pr-1 py-1 rounded-full flex items-center gap-1">
                <MessageSquare size={11} /> NUOVO MESSAGGIO
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkMessageSeen(order.id);
                  }}
                  className="ml-0.5 hover:bg-blue-700 rounded-full p-0.5"
                >
                  <X size={11} />
                </button>
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
          <ConfirmDeliverButton orderId={order.id} onConfirm={onMarkDelivered} />
        </div>
      )}
    </div>
  );
}

function ReturnForm({ order, onSubmit, onCancel }) {
  const [itemName, setItemName] = useState(order.items[0]?.name || "");
  const [qty, setQty] = useState(1);
  const [amount, setAmount] = useState(order.items[0] ? order.items[0].price.toFixed(2) : "0");
  const [reason, setReason] = useState("lavaggio");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const REASONS = [
    { value: "lavaggio", label: "Lavaggio" },
    { value: "cliente", label: "Cliente" },
    { value: "qualita", label: "Qualità prodotto" },
    { value: "altro", label: "Altro" },
  ];

  const selectItem = (name) => {
    setItemName(name);
    const it = order.items.find((i) => i.name === name);
    if (it) setAmount((it.price * qty).toFixed(2));
  };

  const submit = async () => {
    setError("");
    const numQty = parseInt(qty, 10) || 1;
    const numAmount = toNumber(String(amount));
    if (!itemName || numQty <= 0 || numAmount < 0) {
      setError("Controlla i dati inseriti.");
      return;
    }
    setBusy(true);
    const res = await onSubmit({
      itemName,
      qty: numQty,
      amount: numAmount,
      reason,
      note: note.trim(),
    });
    setBusy(false);
    if (res && res.ok === false) setError(res.error);
  };

  return (
    <div className="border border-gray-200 rounded-xl p-3 mb-4">
      <div className="text-sm font-bold text-gray-900 mb-2">Segnala reso</div>
      {error && <div className="text-xs text-rose-600 mb-2">{error}</div>}
      <div className="text-xs font-semibold text-gray-500 mb-1">Capo</div>
      <select
        value={itemName}
        onChange={(e) => selectItem(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
      >
        {order.items.map((it) => (
          <option key={it.itemId} value={it.name}>
            {it.name}
          </option>
        ))}
      </select>
      <div className="flex gap-2 mb-2">
        <div className="flex-1">
          <div className="text-xs font-semibold text-gray-500 mb-1">Quantità</div>
          <input
            type="text"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1">
          <div className="text-xs font-semibold text-gray-500 mb-1">Importo a credito €</div>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="text-xs font-semibold text-gray-500 mb-1">Causale</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {REASONS.map((r) => (
          <button
            key={r.value}
            onClick={() => setReason(r.value)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium ${
              reason === r.value
                ? "bg-gray-900 text-white border-gray-900"
                : "border-gray-300 text-gray-700"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (facoltativo)"
        rows={2}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
      />
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={submit}
          className="flex-1 bg-gray-900 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-semibold"
        >
          Registra reso
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

function EditReturnForm({ ret, onSubmit, onCancel }) {
  const [qty, setQty] = useState(ret.qty);
  const [amount, setAmount] = useState(ret.amount.toFixed(2));
  const [reason, setReason] = useState(ret.reason);
  const [note, setNote] = useState(ret.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const REASONS = [
    { value: "lavaggio", label: "Lavaggio" },
    { value: "cliente", label: "Cliente" },
    { value: "qualita", label: "Qualità prodotto" },
    { value: "altro", label: "Altro" },
  ];

  const submit = async () => {
    setError("");
    const numQty = parseInt(qty, 10) || 1;
    const numAmount = toNumber(String(amount));
    setBusy(true);
    const res = await onSubmit({ qty: numQty, amount: numAmount, reason, note: note.trim() });
    setBusy(false);
    if (res && res.ok === false) setError(res.error);
  };

  return (
    <div className="border border-gray-200 rounded-xl p-3 mt-2">
      <div className="text-sm font-bold text-gray-900 mb-2">Modifica reso — {ret.itemName}</div>
      {error && <div className="text-xs text-rose-600 mb-2">{error}</div>}
      <div className="flex gap-2 mb-2">
        <div className="flex-1">
          <div className="text-xs font-semibold text-gray-500 mb-1">Quantità</div>
          <input
            type="text"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1">
          <div className="text-xs font-semibold text-gray-500 mb-1">Importo a credito €</div>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="text-xs font-semibold text-gray-500 mb-1">Causale</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {REASONS.map((r) => (
          <button
            key={r.value}
            onClick={() => setReason(r.value)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium ${
              reason === r.value
                ? "bg-gray-900 text-white border-gray-900"
                : "border-gray-300 text-gray-700"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (facoltativo)"
        rows={2}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
      />
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={submit}
          className="flex-1 bg-gray-900 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-semibold"
        >
          Salva modifiche
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

function OrderDetailAdminScreen({
  order,
  clientName,
  client,
  catalog,
  returns,
  onBack,
  onUpdateItems,
  onSetNote,
  onMarkReady,
  onUnschedule,
  onDelete,
  onSendMessage,
  onCreateReturn,
  onUpdateReturn,
  onApplyCredit,
  onConfirmPayment,
  onRejectPayment,
}) {
  const [noteDraft, setNoteDraft] = useState(order.note || "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftItems, setDraftItems] = useState(() => order.items.map((it) => ({ ...it })));
  const [dirty, setDirty] = useState(false);
  const [savingItems, setSavingItems] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [selectedCredits, setSelectedCredits] = useState([]);
  const [applyingCredit, setApplyingCredit] = useState(false);
  const urgent = isUrgentOrder(order);
  const isConsegnato = order.status === "consegnato";
  const availableCredits = (returns || []).filter((r) => r.clientId === order.clientId && !r.applied);
  const reportedOnThisOrder = (returns || []).filter((r) => r.orderId === order.id);
  const appliedToThisOrder = (returns || []).filter((r) => r.appliedOrderId === order.id);
  const [editingReturnId, setEditingReturnId] = useState(null);

  useEffect(() => {
    setDraftItems(order.items.map((it) => ({ ...it })));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const setDraftQty = (itemId, newQty) => {
    setDraftItems((items) =>
      items.map((it) => (it.itemId === itemId ? { ...it, qty: Math.max(0, newQty) } : it))
    );
    setDirty(true);
  };

  const addDraftItem = (catalogItem) => {
    setDraftItems((items) => [
      ...items,
      { itemId: catalogItem.id, name: catalogItem.name, qty: 1, price: client.pricing[catalogItem.id] },
    ]);
    setDirty(true);
    setAddingItem(false);
  };

  const saveItems = async () => {
    setSavingItems(true);
    await onUpdateItems(order.id, draftItems);
    setDraftItems((items) => items.filter((it) => it.qty > 0));
    setDirty(false);
    setSavingItems(false);
  };

  const draftTotal = draftItems.reduce((s, it) => s + it.qty * it.price, 0);
  const availableToAdd = client
    ? catalog.filter(
        (it) => client.pricing[it.id] !== undefined && !draftItems.some((d) => d.itemId === it.id)
      )
    : [];

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
        {draftItems.map((it) => (
          <div
            key={it.itemId}
            className={`flex items-center justify-between px-4 py-3 ${it.qty === 0 ? "opacity-40" : ""}`}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{it.name}</div>
              <div className="text-xs text-gray-400">€{it.price.toFixed(2)}/pezzo</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setDraftQty(it.itemId, it.qty - 1)}
                className="w-8 h-8 border border-gray-300 rounded-lg flex items-center justify-center"
              >
                <Minus size={14} />
              </button>
              <span className="w-6 text-center font-semibold text-sm">{it.qty}</span>
              <button
                onClick={() => setDraftQty(it.itemId, it.qty + 1)}
                className="w-8 h-8 border border-gray-300 rounded-lg flex items-center justify-center"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        ))}
        {draftItems.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-gray-400">
            Nessun capo in questo ordine.
          </div>
        )}
      </div>

      {client &&
        (addingItem ? (
          <div className="border border-gray-200 rounded-xl p-3 mb-4">
            <div className="text-xs font-semibold text-gray-500 mb-2">
              Scegli un prodotto dal listino del cliente
            </div>
            {availableToAdd.length === 0 ? (
              <p className="text-xs text-gray-400 mb-2">
                Tutti i prodotti del listino sono già in questo ordine.
              </p>
            ) : (
              <div className="divide-y divide-gray-100 mb-2">
                {availableToAdd.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => addDraftItem(it)}
                    className="w-full flex items-center justify-between py-2 text-sm text-left"
                  >
                    <span>
                      {CATEGORY_ICON[it.category]} {it.name}
                    </span>
                    <span className="text-gray-400">€{client.pricing[it.id].toFixed(2)}</span>
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setAddingItem(false)}
              className="text-xs font-semibold text-gray-500"
            >
              Chiudi
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingItem(true)}
            className="w-full border border-dashed border-gray-300 text-gray-700 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 mb-4"
          >
            <Plus size={14} /> Aggiungi prodotto
          </button>
        ))}

      <div className="flex items-center justify-between px-1 mb-4">
        <span className="font-semibold text-gray-700">Totale</span>
        <span className="font-bold text-xl text-gray-900">€{draftTotal.toFixed(2)}</span>
      </div>

      {dirty && (
        <button
          disabled={savingItems}
          onClick={saveItems}
          className="w-full bg-gray-900 disabled:bg-gray-300 text-white rounded-xl py-2.5 text-sm font-bold mb-6"
        >
          {savingItems ? "Salvataggio..." : "Salva modifiche ai capi"}
        </button>
      )}

      <div className="font-bold text-gray-900 mb-2">Note</div>
      <textarea
        value={noteDraft}
        onChange={(e) => setNoteDraft(e.target.value)}
        onBlur={() => onSetNote(order.id, noteDraft)}
        placeholder="Aggiungi note interne su questo ordine..."
        rows={4}
        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-6"
      />

      {reportedOnThisOrder.length > 0 && (
        <div className="border border-gray-200 rounded-xl p-3 mb-6">
          <div className="text-sm font-bold text-gray-900 mb-2">Resi segnalati su questo ordine</div>
          {reportedOnThisOrder.map((r) => (
            <div key={r.id} className="border-t border-gray-100 pt-2 mt-2 first:border-0 first:pt-0 first:mt-0">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  {r.qty}× {r.itemName} — €{r.amount.toFixed(2)} ({REASON_LABELS[r.reason] || r.reason})
                  {r.applied && <span className="text-emerald-600 font-medium"> · applicato</span>}
                </div>
                <button
                  onClick={() => setEditingReturnId(editingReturnId === r.id ? null : r.id)}
                  className="text-xs font-semibold text-gray-500 underline shrink-0 ml-2"
                >
                  Modifica
                </button>
              </div>
              {r.note && <div className="text-xs text-gray-400 mt-0.5">{r.note}</div>}
              {editingReturnId === r.id && (
                <EditReturnForm
                  ret={r}
                  onSubmit={async (fields) => {
                    const res = await onUpdateReturn(r.id, fields);
                    if (res && res.ok !== false) setEditingReturnId(null);
                    return res;
                  }}
                  onCancel={() => setEditingReturnId(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {appliedToThisOrder.length > 0 && (
        <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-3 mb-6">
          <div className="text-sm font-bold text-emerald-800 mb-2">
            Credito reso applicato a questo ordine
          </div>
          {appliedToThisOrder.map((r) => (
            <div key={r.id} className="text-sm text-emerald-800 py-0.5">
              -€{r.amount.toFixed(2)} su {r.qty}× {r.itemName} ({REASON_LABELS[r.reason] || r.reason})
            </div>
          ))}
        </div>
      )}

      {availableCredits.length > 0 && (
        <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-3 mb-6">
          <div className="text-sm font-bold text-emerald-800 mb-2">
            Crediti resi disponibili per questo cliente
          </div>
          {availableCredits.map((r) => (
            <label key={r.id} className="flex items-center gap-2 py-1 text-sm text-emerald-800">
              <input
                type="checkbox"
                checked={selectedCredits.includes(r.id)}
                onChange={(e) =>
                  setSelectedCredits((ids) =>
                    e.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id)
                  )
                }
                className="w-4 h-4"
              />
              {r.qty}× {r.itemName} — €{r.amount.toFixed(2)} ({REASON_LABELS[r.reason] || r.reason})
            </label>
          ))}
          <button
            disabled={selectedCredits.length === 0 || applyingCredit}
            onClick={async () => {
              setApplyingCredit(true);
              await onApplyCredit(selectedCredits, order.id);
              setSelectedCredits([]);
              setApplyingCredit(false);
            }}
            className="w-full bg-emerald-700 disabled:bg-emerald-300 text-white rounded-lg py-2 text-sm font-semibold mt-2"
          >
            Applica credito selezionato a questo ordine
          </button>
        </div>
      )}

      {isConsegnato && (
        <div className="border border-gray-200 rounded-xl p-3 mb-6">
          <div className="text-sm font-bold text-gray-900 mb-2">Stato pagamento</div>
          {order.paymentStatus === "saldato" ? (
            <div className="text-sm text-emerald-600 font-medium">✔ Saldato</div>
          ) : order.paymentStatus === "dichiarato_pagato" ? (
            <>
              <div className="text-sm text-amber-600 font-medium mb-2">
                Il cliente ha dichiarato di aver saldato — in attesa di conferma.
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onConfirmPayment(order.id)}
                  className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm font-semibold"
                >
                  Conferma saldo ricevuto
                </button>
                <button
                  onClick={() => onRejectPayment(order.id)}
                  className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-semibold text-gray-800"
                >
                  Non risulta saldato
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-gray-500 mb-2">Ancora da saldare.</div>
              <button
                onClick={() => onConfirmPayment(order.id)}
                className="w-full border border-gray-300 rounded-lg py-2 text-sm font-semibold text-gray-800"
              >
                Segna come saldato
              </button>
            </>
          )}
        </div>
      )}

      {isConsegnato && (
        <div className="mb-6">
          {!showReturnForm ? (
            <button
              onClick={() => setShowReturnForm(true)}
              className="w-full border border-dashed border-gray-300 text-gray-700 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
            >
              <Plus size={14} /> Segnala reso
            </button>
          ) : (
            <ReturnForm
              order={order}
              onSubmit={async (fields) => {
                const res = await onCreateReturn({
                  clientId: order.clientId,
                  orderId: order.id,
                  ...fields,
                });
                if (res && res.ok !== false) setShowReturnForm(false);
                return res;
              }}
              onCancel={() => setShowReturnForm(false)}
            />
          )}
        </div>
      )}

      <OrderChat order={order} sender="staff" onSend={onSendMessage} readOnly={isConsegnato} />

      <div className="mt-6" />

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

      {!confirmingDelete ? (
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
      )}
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
  onMarkMessageSeen,
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
  const pendingMessages = orders.filter(hasClientMessage);

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

      {pendingMessages.length > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-5">
          <div className="flex items-center gap-2 text-blue-700 font-semibold">
            <MessageSquare size={16} /> Messaggi in attesa
          </div>
          <div className="text-blue-600 text-sm mt-1">
            {pendingMessages.length} {pendingMessages.length === 1 ? "ordine ha" : "ordini hanno"} un
            nuovo messaggio dal cliente da leggere
          </div>
        </div>
      )}

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
          onMarkMessageSeen={onMarkMessageSeen}
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

function ArchivioScreen({ orders, clients, onBack, onOpenDetail, onMarkMessageSeen }) {
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "—";
  const [query, setQuery] = useState("");
  const consegnati = orders
    .filter((o) => o.status === "consegnato")
    .filter((o) => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return String(o.id).includes(q) || clientName(o.clientId).toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const da = `${a.deliveryDate}T${a.deliveryTime || "00:00"}`;
      const db = `${b.deliveryDate}T${b.deliveryTime || "00:00"}`;
      return db.localeCompare(da);
    });

  return (
    <div className="px-6 pt-5">
      <ScreenHeader title="Tutti" subtitle="Consegne già effettuate, per data e ora" onBack={onBack} />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cerca per numero ordine o cliente..."
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
      />
      {consegnati.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">
          {query.trim() ? "Nessun ordine trovato." : "Nessuna consegna archiviata ancora."}
        </p>
      )}
      {consegnati.map((o) => (
        <div
          key={o.id}
          className={`border rounded-2xl p-5 mb-4 ${hasClientMessage(o) ? "border-blue-300 bg-blue-50/30" : "border-gray-200"}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-gray-900">#{o.id}</span>
              {o.invoiced && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  FATTURATO
                </span>
              )}
              {hasClientMessage(o) && (
                <span className="bg-blue-600 text-white text-[10px] font-bold pl-2 pr-1 py-0.5 rounded-full flex items-center gap-1">
                  <MessageSquare size={10} /> MESSAGGIO
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkMessageSeen(o.id);
                    }}
                    className="ml-0.5 hover:bg-blue-700 rounded-full p-0.5"
                  >
                    <X size={10} />
                  </button>
                </span>
              )}
            </div>
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
              <ConfirmDeliverButton
                orderId={o.id}
                onConfirm={onMarkDelivered}
                className="flex-1 border border-gray-300 rounded-lg py-1.5 text-sm font-semibold text-gray-800 flex items-center justify-center gap-1.5"
              />
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
function ClientInvoiceScreen({ clientId, clientName, orders, onBack, onOpenDetail, onToggleInvoiced }) {
  const sorted = [...orders].sort((a, b) => {
    const da = `${a.deliveryDate}T${a.deliveryTime || "00:00"}`;
    const db = `${b.deliveryDate}T${b.deliveryTime || "00:00"}`;
    return db.localeCompare(da);
  });
  const totale = sorted.reduce((s, o) => s + o.total, 0);
  const daFatturare = sorted.filter((o) => !o.invoiced);
  const totaleDaFatturare = daFatturare.reduce((s, o) => s + o.total, 0);
  const [confirmingId, setConfirmingId] = useState(null);

  return (
    <div className="px-6 pt-5 pb-8">
      <ScreenHeader title={clientName} subtitle="Ordini consegnati e stato fatturazione" onBack={onBack} />

      <div className="grid grid-cols-2 gap-3 mb-5">
        <StatCard value={`€${totale.toFixed(2)}`} label="Totale consegnato" />
        <StatCard
          value={`€${totaleDaFatturare.toFixed(2)}`}
          label={`Da fatturare (${daFatturare.length})`}
          valueClass="text-amber-600"
        />
      </div>

      {sorted.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">Nessun ordine consegnato ancora.</p>
      )}
      {sorted.map((o) => (
        <div key={o.id} className="border border-gray-200 rounded-2xl p-4 mb-3">
          <div className="flex items-center justify-between">
            <button onClick={() => onOpenDetail(o.id)} className="text-left">
              <div className="font-bold text-gray-900 text-sm">#{o.id}</div>
              <div className="text-xs text-gray-400">
                {formatIT(o.deliveryDate)} • €{o.total.toFixed(2)}
              </div>
            </button>
            {!o.invoiced && confirmingId === o.id ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Confermi?</span>
                <button
                  onClick={() => {
                    onToggleInvoiced(o.id, true);
                    setConfirmingId(null);
                  }}
                  className="bg-gray-900 text-white text-xs font-semibold rounded-lg px-2.5 py-1.5"
                >
                  Sì
                </button>
                <button
                  onClick={() => setConfirmingId(null)}
                  className="border border-gray-300 text-xs font-semibold rounded-lg px-2.5 py-1.5 text-gray-700"
                >
                  No
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={o.invoiced}
                  onChange={(e) =>
                    e.target.checked ? setConfirmingId(o.id) : onToggleInvoiced(o.id, false)
                  }
                  className="w-4 h-4 accent-gray-900"
                />
                Fatturato
              </label>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function DaFatturareScreen({ orders, clients, onBack, onOpenDetail, onToggleInvoiced }) {
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "—";
  const list = orders
    .filter((o) => o.status === "consegnato" && !o.invoiced)
    .sort((a, b) => b.id - a.id);
  const [confirmingId, setConfirmingId] = useState(null);
  const totale = list.reduce((s, o) => s + o.total, 0);

  return (
    <div className="px-6 pt-5 pb-8">
      <ScreenHeader title="Da Fatturare" subtitle="Ordini consegnati non ancora fatturati" onBack={onBack} />
      <div className="mb-5">
        <StatCard
          value={`€${totale.toFixed(2)}`}
          label={`Totale da fatturare (${list.length})`}
          valueClass="text-amber-600"
        />
      </div>
      {list.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">Tutto fatturato! 🎉</p>
      )}
      {list.map((o) => (
        <div key={o.id} className="border border-gray-200 rounded-2xl p-4 mb-3">
          <div className="flex items-center justify-between">
            <button onClick={() => onOpenDetail(o.id)} className="text-left">
              <div className="font-bold text-gray-900 text-sm">
                #{o.id} • {clientName(o.clientId)}
              </div>
              <div className="text-xs text-gray-400">
                {formatIT(o.deliveryDate)} • €{o.total.toFixed(2)}
              </div>
            </button>
            {confirmingId === o.id ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Confermi?</span>
                <button
                  onClick={() => {
                    onToggleInvoiced(o.id, true);
                    setConfirmingId(null);
                  }}
                  className="bg-gray-900 text-white text-xs font-semibold rounded-lg px-2.5 py-1.5"
                >
                  Sì
                </button>
                <button
                  onClick={() => setConfirmingId(null)}
                  className="border border-gray-300 text-xs font-semibold rounded-lg px-2.5 py-1.5 text-gray-700"
                >
                  No
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => setConfirmingId(o.id)}
                  className="w-4 h-4 accent-gray-900"
                />
                Fatturato
              </label>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatisticheScreen({ orders, clients, catalog, returns, onOpenDetail, onToggleInvoiced }) {
  const weightOf = (itemId) => catalog.find((c) => c.id === itemId)?.weightKg || 0;
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "—";
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
    const cName = clientName(o.clientId);
    if (!perCliente[cName]) {
      perCliente[cName] = { pezzi: 0, kg: 0, entrate: 0, clientId: o.clientId, daFatturare: 0, daFatturareCount: 0 };
    }
    perCliente[cName].entrate += o.total;
    if (!o.invoiced) {
      perCliente[cName].daFatturare += o.total;
      perCliente[cName].daFatturareCount += 1;
    }
    o.items.forEach((it) => {
      perCliente[cName].pezzi += it.qty;
      perCliente[cName].kg += it.qty * weightOf(it.itemId);
    });
  });

  const tipoList = Object.entries(perTipo).sort((a, b) => b[1] - a[1]);
  const clienteList = Object.entries(perCliente).sort((a, b) => b[1].entrate - a[1].entrate);

  const totaleResi = (returns || []).length;
  const valoreResi = (returns || []).reduce((s, r) => s + r.amount, 0);
  const perReason = {};
  const perClienteResi = {};
  (returns || []).forEach((r) => {
    if (!perReason[r.reason]) perReason[r.reason] = { count: 0, amount: 0 };
    perReason[r.reason].count += 1;
    perReason[r.reason].amount += r.amount;
    const cName = clientName(r.clientId);
    if (!perClienteResi[cName]) perClienteResi[cName] = { count: 0, amount: 0 };
    perClienteResi[cName].count += 1;
    perClienteResi[cName].amount += r.amount;
  });
  const reasonList = Object.entries(perReason).sort((a, b) => b[1].amount - a[1].amount);
  const clienteResiList = Object.entries(perClienteResi).sort((a, b) => b[1].amount - a[1].amount);

  const [searchQuery, setSearchQuery] = useState("");
  const [viewingClientId, setViewingClientId] = useState(null);
  const [viewingFatturare, setViewingFatturare] = useState(false);
  const totaleDaFatturareGlobale = orders.filter((o) => o.status === "consegnato" && !o.invoiced);
  const searchResults =
    searchQuery.trim().length === 0
      ? []
      : orders
          .filter((o) => {
            const q = searchQuery.trim().toLowerCase();
            return String(o.id).includes(q) || clientName(o.clientId).toLowerCase().includes(q);
          })
          .sort((a, b) => b.id - a.id)
          .slice(0, 15);

  if (viewingFatturare) {
    return (
      <DaFatturareScreen
        orders={orders}
        clients={clients}
        onBack={() => setViewingFatturare(false)}
        onOpenDetail={onOpenDetail}
        onToggleInvoiced={onToggleInvoiced}
      />
    );
  }

  if (viewingClientId) {
    return (
      <ClientInvoiceScreen
        clientId={viewingClientId}
        clientName={clientName(viewingClientId)}
        orders={orders.filter((o) => o.clientId === viewingClientId && o.status === "consegnato")}
        onBack={() => setViewingClientId(null)}
        onOpenDetail={onOpenDetail}
        onToggleInvoiced={onToggleInvoiced}
      />
    );
  }

  return (
    <div className="px-6 pt-5 pb-8">
      <ScreenHeader title="Statistiche" subtitle="Calcolate sulle consegne archiviate" />

      <button
        onClick={() => setViewingFatturare(true)}
        className="w-full border border-amber-200 bg-amber-50 rounded-2xl p-4 mb-5 text-left flex items-center justify-between"
      >
        <div>
          <div className="text-xs text-amber-700">Da Fatturare</div>
          <div className="text-2xl font-bold mt-1 text-amber-700">
            {totaleDaFatturareGlobale.length}
          </div>
        </div>
        <ChevronDown size={18} className="text-amber-600 -rotate-90" />
      </button>

      <div className="border border-gray-200 rounded-2xl p-4 mb-5">
        <div className="font-bold text-gray-900 mb-2 text-sm">Cerca un ordine</div>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Numero ordine o nome cliente..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
        />
        {searchQuery.trim().length > 0 && (
          <div className="divide-y divide-gray-100">
            {searchResults.length === 0 && (
              <p className="text-xs text-gray-400 py-2">Nessun ordine trovato.</p>
            )}
            {searchResults.map((o) => (
              <button
                key={o.id}
                onClick={() => onOpenDetail(o.id)}
                className="w-full flex items-center justify-between py-2 text-left"
              >
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    #{o.id} • {clientName(o.clientId)}
                  </div>
                  <div className="text-xs text-gray-400">
                    {formatIT(o.createdDate)} • {STATUS[o.status].label}
                  </div>
                </div>
                <span className="text-sm font-semibold text-gray-700">€{o.total.toFixed(2)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

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

      <div className="border border-gray-200 rounded-2xl p-5 mb-5">
        <div className="font-bold text-gray-900 mb-1">Per cliente</div>
        <p className="text-xs text-gray-400 mb-3">Tocca un cliente per vedere i suoi ordini e segnare quali hai già fatturato.</p>
        {clienteList.length === 0 && (
          <p className="text-gray-400 text-sm">Nessun dato ancora disponibile.</p>
        )}
        {clienteList.map(([name, d]) => (
          <button
            key={name}
            onClick={() => setViewingClientId(d.clientId)}
            className="w-full text-left py-2 border-b border-gray-100 last:border-0"
          >
            <div className="flex items-center justify-between">
              <div className="font-medium text-gray-900 text-sm">{name}</div>
              {d.daFatturareCount > 0 ? (
                <span className="text-[11px] font-bold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5">
                  {d.daFatturareCount} da fatturare
                </span>
              ) : (
                <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">
                  Tutto fatturato
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {d.pezzi} pz • {d.kg.toFixed(1)} kg • €{d.entrate.toFixed(2)}
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <StatCard value={totaleResi} label="Resi totali" valueClass="text-rose-600" />
        <StatCard value={`€${valoreResi.toFixed(2)}`} label="Valore resi" valueClass="text-rose-600" />
      </div>

      <div className="border border-gray-200 rounded-2xl p-5 mb-5">
        <div className="font-bold text-gray-900 mb-3">Resi per causale</div>
        {reasonList.length === 0 && (
          <p className="text-gray-400 text-sm">Nessun reso registrato ancora.</p>
        )}
        {reasonList.map(([reason, d]) => (
          <div key={reason} className="flex items-center justify-between text-sm py-1.5">
            <span className="text-gray-700">{REASON_LABELS[reason] || reason}</span>
            <span className="font-semibold text-gray-900">
              {d.count} • €{d.amount.toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <div className="border border-gray-200 rounded-2xl p-5">
        <div className="font-bold text-gray-900 mb-3">Resi per cliente</div>
        {clienteResiList.length === 0 && (
          <p className="text-gray-400 text-sm">Nessun reso registrato ancora.</p>
        )}
        {clienteResiList.map(([name, d]) => (
          <div key={name} className="flex items-center justify-between text-sm py-1.5">
            <span className="text-gray-700">{name}</span>
            <span className="font-semibold text-gray-900">
              {d.count} • €{d.amount.toFixed(2)}
            </span>
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
    const orderClient = data.clients.find((c) => c.id === order.clientId);
    const clientName = orderClient?.name || "—";
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto">
          <OrderDetailAdminScreen
            order={order}
            clientName={clientName}
            client={orderClient}
            catalog={data.catalog}
            returns={data.returns}
            onBack={() => setDetailOrderId(null)}
            onUpdateItems={actions.updateOrderItems}
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
            onSendMessage={actions.sendOrderMessage}
            onCreateReturn={actions.createReturn}
            onUpdateReturn={actions.updateReturn}
            onApplyCredit={actions.applyReturnsToOrder}
            onConfirmPayment={actions.confirmPayment}
            onRejectPayment={actions.rejectPayment}
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
        onMarkMessageSeen={actions.markMessageSeen}
      />
    );
  } else if (nav === "archivio") {
    content = (
      <ArchivioScreen
        orders={data.orders}
        clients={data.clients}
        onBack={() => setNav("dashboard")}
        onOpenDetail={setDetailOrderId}
        onMarkMessageSeen={actions.markMessageSeen}
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
        onUpdateWeight={actions.updateCatalogItemWeight}
        onDeleteCatalogItem={actions.deleteCatalogItem}
        onDeleteClient={(id) => {
          actions.deleteClient(id);
          setClientDetailId(null);
        }}
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
    content = (
      <StatisticheScreen
        orders={data.orders}
        clients={data.clients}
        catalog={data.catalog}
        returns={data.returns}
        onOpenDetail={setDetailOrderId}
        onToggleInvoiced={actions.toggleInvoiced}
      />
    );
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
function NewOrderScreen({ client, catalog, lastOrder, onBack, onCreate }) {
  const categories = CATEGORY_ORDER.filter((cat) =>
    catalog.some((it) => it.category === cat && client.pricing[it.id] !== undefined)
  );
  const [category, setCategory] = useState(categories[0] || null);
  const [qty, setQty] = useState({});
  const [slots, setSlots] = useState([{ date: addDaysISO(isoToday(), 2), time: "09:00" }]);
  const [showRecap, setShowRecap] = useState(false);
  const [note, setNote] = useState("");
  const [returnQtys, setReturnQtys] = useState({});
  const [returnReason, setReturnReason] = useState("cliente");
  const [returnNote, setReturnNote] = useState("");

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
  const selectedItems = allEnabled.filter((it) => (qty[it.id] || 0) > 0);
  const HOUR_SLOTS = ["09:00", "10:00", "11:00", "12:00", "13:00"];
  const setReturnQty = (itemId, delta, max) =>
    setReturnQtys((r) => ({ ...r, [itemId]: Math.max(0, Math.min(max, (r[itemId] || 0) + delta)) }));
  const returnItemsToSend = (lastOrder?.items || []).filter((it) => (returnQtys[it.itemId] || 0) > 0);

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

        <div className="border border-gray-200 rounded-2xl overflow-hidden mb-4">
          <button
            onClick={() => setShowRecap((s) => !s)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-gray-900"
          >
            <span>🧺 Riepilogo carrello ({itemCount} pezzi)</span>
            <ChevronDown
              size={16}
              className={`transition-transform ${showRecap ? "rotate-180" : ""}`}
            />
          </button>
          {showRecap && (
            <div className="px-4 pb-4">
              {selectedItems.length === 0 ? (
                <p className="text-xs text-gray-400 py-1">Nessun capo selezionato ancora.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {selectedItems.map((it) => (
                    <div key={it.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="flex items-center gap-2 text-gray-700">
                        <span>{CATEGORY_ICON[it.category]}</span>
                        {it.name}
                      </span>
                      <span className="font-semibold text-gray-900">×{qty[it.id]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-2 mb-4">
          <div className="font-bold text-gray-900 mb-1">Quando preferisci la consegna?</div>
          <p className="text-xs text-gray-400 mb-3">
            Indica una o più fasce orarie possibili (9:00–14:00), con almeno 24 ore di anticipo. La
            lavanderia sceglierà quella più adatta e non sarà modificabile dopo la conferma.
          </p>
          {slots.map((s, i) => {
            const valid = isSlotValid(s.date, s.time);
            return (
              <div key={i} className="mb-3">
                <div className="flex gap-2 items-center mb-2">
                  <input
                    type="date"
                    value={s.date}
                    min={addDaysISO(isoToday(), 1)}
                    onChange={(e) => updateSlot(i, "date", e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
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
                <div className="flex flex-wrap gap-1.5">
                  {HOUR_SLOTS.map((h) => {
                    const endHour = String(parseInt(h, 10) + 1).padStart(2, "0");
                    return (
                      <button
                        key={h}
                        onClick={() => updateSlot(i, "time", h)}
                        className={`text-xs px-3 py-1.5 rounded-full border font-medium ${
                          s.time === h
                            ? "bg-gray-900 text-white border-gray-900"
                            : "border-gray-300 text-gray-700"
                        }`}
                      >
                        {h}–{endHour}:00
                      </button>
                    );
                  })}
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
            <Plus size={14} /> Aggiungi un'altra fascia oraria
          </button>
        </div>

        {lastOrder && lastOrder.items.length > 0 && (
          <div className="mb-4 border border-gray-200 rounded-2xl p-4">
            <div className="font-bold text-gray-900 mb-1">
              Vuoi rendere dei capi dal tuo ultimo ordine (#{lastOrder.id})?
            </div>
            <p className="text-xs text-gray-400 mb-3">Facoltativo — indica quantità e motivo.</p>
            {lastOrder.items.map((it) => (
              <div key={it.itemId} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-gray-700">{it.name}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setReturnQty(it.itemId, -1, it.qty)}
                    className="w-7 h-7 border border-gray-300 rounded-lg flex items-center justify-center"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="w-6 text-center font-semibold">{returnQtys[it.itemId] || 0}</span>
                  <button
                    onClick={() => setReturnQty(it.itemId, 1, it.qty)}
                    className="w-7 h-7 border border-gray-300 rounded-lg flex items-center justify-center"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            ))}
            {returnItemsToSend.length > 0 && (
              <>
                <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-2.5 mt-2 text-sm font-semibold text-emerald-700">
                  Credito che riceverai: €
                  {returnItemsToSend.reduce((s, it) => s + it.price * returnQtys[it.itemId], 0).toFixed(2)}
                </div>
                <div className="text-xs font-semibold text-gray-500 mt-3 mb-1.5">Motivo</div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    { value: "lavaggio", label: "Lavaggio" },
                    { value: "cliente", label: "Mio errore" },
                    { value: "qualita", label: "Qualità prodotto" },
                    { value: "altro", label: "Altro" },
                  ].map((r) => (
                    <button
                      key={r.value}
                      onClick={() => setReturnReason(r.value)}
                      className={`text-xs px-3 py-1.5 rounded-full border font-medium ${
                        returnReason === r.value
                          ? "bg-gray-900 text-white border-gray-900"
                          : "border-gray-300 text-gray-700"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                  rows={2}
                  placeholder="Note sul reso (facoltativo)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </>
            )}
          </div>
        )}

        <div className="mb-4">
          <div className="font-bold text-gray-900 mb-1">Note (facoltativo)</div>
          <p className="text-xs text-gray-400 mb-2">
            Specifica qui la tua disponibilità esatta, es. "disponibile solo dopo le 10:30".
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Aggiungi eventuali note per la lavanderia..."
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
          />
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
            onCreate({
              items: orderItems,
              total,
              preferredSlots: validSlots,
              note: note.trim(),
              returns: returnItemsToSend.map((it) => ({
                orderId: lastOrder.id,
                itemName: it.name,
                qty: returnQtys[it.itemId],
                amount: it.price * returnQtys[it.itemId],
                reason: returnReason,
                note: returnNote.trim(),
              })),
            });
          }}
          className="w-full bg-gray-900 disabled:bg-gray-300 text-white rounded-xl py-3.5 font-bold"
        >
          Conferma Ordine
        </button>
      </div>
    </div>
  );
}

function OrderChat({ order, sender, onSend, readOnly }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const messages = order.messages || [];

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    const res = await onSend(order.id, sender, text.trim());
    setBusy(false);
    if (res && res.ok === false) setError(res.error);
    else setText("");
  };

  return (
    <div className="mt-3 border border-gray-200 rounded-xl p-3">
      <div className="text-xs font-bold text-gray-500 mb-2">
        {readOnly ? "Messaggi sull'ordine (archiviati)" : "Messaggi sull'ordine"}
      </div>
      {messages.length === 0 && (
        <p className="text-xs text-gray-400 mb-2">Nessun messaggio ancora.</p>
      )}
      {messages.length > 0 && (
        <div className="space-y-2 mb-3 max-h-56 overflow-y-auto">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
                m.sender === sender ? "bg-gray-900 text-white ml-auto" : "bg-gray-100 text-gray-800"
              }`}
            >
              {m.message}
            </div>
          ))}
        </div>
      )}
      {!readOnly && (
        <>
          {error && <div className="text-xs text-rose-600 mb-2">{error}</div>}
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Scrivi un messaggio..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              disabled={busy}
              onClick={submit}
              className="bg-gray-900 disabled:bg-gray-300 text-white rounded-lg px-4 text-sm font-semibold"
            >
              Invia
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ClienteOrderCard({ order, onSendMessage, returns }) {
  const [showChat, setShowChat] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const messages = order.messages || [];
  const lastMsg = messages[messages.length - 1];
  const isConsegnato = order.status === "consegnato";
  const hasStaffPing = !isConsegnato && lastMsg && lastMsg.sender === "staff";
  const appliedCredits = (returns || []).filter((r) => r.appliedOrderId === order.id);

  return (
    <div className="border border-gray-200 rounded-2xl p-5 mb-4">
      <div className="flex items-center justify-between">
        <span className="font-bold text-gray-900">#{order.id}</span>
        <span className="text-sm text-gray-500">
          {formatIT(order.createdDate)} • €{order.total.toFixed(2)}
        </span>
      </div>

      {appliedCredits.length > 0 && (
        <div className="mt-2 bg-emerald-50 border border-emerald-100 rounded-lg p-2 text-xs text-emerald-700">
          {appliedCredits.map((r) => (
            <div key={r.id}>
              💳 Credito reso applicato: -€{r.amount.toFixed(2)} su {r.qty}× {r.itemName}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 border border-gray-100 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowItems((s) => !s)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-600"
        >
          <span>
            {order.items.reduce((s, it) => s + it.qty, 0)} capi ordinati
          </span>
          <ChevronDown size={14} className={`transition-transform ${showItems ? "rotate-180" : ""}`} />
        </button>
        {showItems && (
          <div className="px-3 pb-2 divide-y divide-gray-50">
            {order.items.map((it) => (
              <div key={it.itemId} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-gray-700">{it.name}</span>
                <span className="font-semibold text-gray-900">×{it.qty}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {order.lastModification && (
        <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-xl p-3">
          ✏️ Ordine modificato dalla lavanderia: {order.lastModification}
        </div>
      )}

      <div className="mt-3">
        <StatusDot status={order.status} forClient />
      </div>

      {order.status === "nuovo" ? (
        <div className="mt-3 bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm rounded-xl p-3 font-medium">
          ✅ Richiesta inviata! Riceverai una notifica di conferma il prima possibile.
        </div>
      ) : (
        <div className="mt-3 bg-gray-50 text-sm text-gray-600 rounded-xl p-3">
          {order.status === "pronto" &&
            "Il tuo ordine è stato confermato. Ti contatteremo a breve per fissare l'orario di consegna."}
          {order.status === "programmato" &&
            `Consegna prevista il ${formatIT(order.deliveryDate)} alle ${order.deliveryTime}.`}
          {order.status === "consegnato" &&
            `Consegnato il ${formatIT(order.deliveryDate)} alle ${order.deliveryTime}.`}
        </div>
      )}

      {hasStaffPing && !showChat && (
        <button
          onClick={() => setShowChat(true)}
          className="mt-3 w-full bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold rounded-xl p-3 text-left"
        >
          🔔 La lavanderia ti ha scritto riguardo a questo ordine — tocca per rispondere
        </button>
      )}

      {(!isConsegnato || messages.length > 0) &&
        (!showChat ? (
          <button
            onClick={() => setShowChat(true)}
            className="mt-3 text-xs font-semibold text-gray-500 underline"
          >
            {isConsegnato
              ? `Messaggi archiviati (${messages.length})`
              : messages.length > 0
              ? `Messaggi (${messages.length})`
              : "Scrivi alla lavanderia"}
          </button>
        ) : (
          <OrderChat order={order} sender="client" onSend={onSendMessage} readOnly={isConsegnato} />
        ))}
    </div>
  );
}

function SaldareScreen({ orders, onDeclarePaid, onBack }) {
  const sorted = [...orders].sort((a, b) => b.id - a.id);
  const [confirmingId, setConfirmingId] = useState(null);

  return (
    <div className="px-6 pt-5 pb-6 h-full overflow-y-auto">
      <ScreenHeader
        title="Da Saldare"
        subtitle="Spunta gli ordini che hai già pagato"
        onBack={onBack}
      />
      {sorted.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">
          Nessun ordine da saldare al momento.
        </p>
      )}
      {sorted.map((o) => (
        <div key={o.id} className="border border-gray-200 rounded-2xl p-4 mb-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-gray-900">#{o.id}</span>
            <span className="text-sm text-gray-500">{formatIT(o.deliveryDate)}</span>
          </div>
          <div className="text-sm text-gray-700 mt-1">Totale: €{o.total.toFixed(2)}</div>
          {confirmingId === o.id ? (
            <div className="mt-3 bg-gray-50 rounded-xl p-3">
              <div className="text-sm text-gray-700 mb-2">Confermi di aver saldato questo ordine?</div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onDeclarePaid(o.id);
                    setConfirmingId(null);
                  }}
                  className="flex-1 bg-gray-900 text-white rounded-lg py-1.5 text-sm font-semibold"
                >
                  Sì, ho saldato
                </button>
                <button
                  onClick={() => setConfirmingId(null)}
                  className="flex-1 border border-gray-300 rounded-lg py-1.5 text-sm font-semibold"
                >
                  Annulla
                </button>
              </div>
            </div>
          ) : (
            <label className="flex items-center gap-2 mt-3 text-sm select-none">
              <input
                type="checkbox"
                checked={false}
                onChange={() => setConfirmingId(o.id)}
                className="w-4 h-4 accent-gray-900"
              />
              <span className="text-gray-700">Ho saldato questo ordine</span>
            </label>
          )}
        </div>
      ))}
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
      setError("Errore imprevisto: " + (e.message || String(e)));
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

function ForgotPasswordFlow({ onRequestOtp, onReset, onCancel }) {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const sendOtp = async () => {
    setError("");
    setInfo("");
    if (!email.trim()) {
      setError("Inserisci la tua email.");
      return;
    }
    setBusy(true);
    const res = await onRequestOtp(email.trim());
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setInfo("Ti abbiamo inviato un codice via email. Controlla anche lo spam.");
      setStep("otp");
    }
  };

  const doReset = async () => {
    setError("");
    if (!otp.trim() || !newPassword || newPassword !== confirmPassword) {
      setError("Controlla il codice e assicurati che le due password coincidano.");
      return;
    }
    setBusy(true);
    const res = await onReset(email.trim(), otp.trim(), newPassword);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else setInfo("Password aggiornata! Ora puoi accedere con la nuova password.");
  };

  return (
    <div className="border border-gray-200 rounded-xl p-4 mt-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-gray-900">Recupera password</div>
        <button onClick={onCancel} className="text-xs text-gray-400 font-semibold">
          Chiudi
        </button>
      </div>
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 text-sm rounded-xl px-3 py-2 mb-3">
          {error}
        </div>
      )}
      {info && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-3 py-2 mb-3">
          {info}
        </div>
      )}
      {step === "email" ? (
        <>
          <input
            placeholder="La tua email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <button
            disabled={busy}
            onClick={sendOtp}
            className="w-full bg-gray-900 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-semibold"
          >
            Invia codice via email
          </button>
        </>
      ) : (
        <>
          <input
            placeholder="Codice ricevuto via email"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <input
            placeholder="Nuova password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <input
            placeholder="Conferma nuova password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <button
            disabled={busy}
            onClick={doReset}
            className="w-full bg-gray-900 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-semibold"
          >
            Reimposta password
          </button>
        </>
      )}
    </div>
  );
}

function AuthScreen({ onLogin, onRegister, onAdminSignup, onRequestPasswordReset, onResetPassword }) {
  const [mode, setMode] = useState("login");
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
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
      setError("Errore imprevisto: " + (e.message || String(e)));
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
      setError("Errore imprevisto: " + (e.message || String(e)));
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
          {!showForgot ? (
            <button
              onClick={() => setShowForgot(true)}
              className="text-xs font-semibold text-gray-500 underline mt-3"
            >
              Password dimenticata?
            </button>
          ) : (
            <ForgotPasswordFlow
              onRequestOtp={onRequestPasswordReset}
              onReset={onResetPassword}
              onCancel={() => setShowForgot(false)}
            />
          )}
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

function CompleteProfileScreen({ client, onComplete, onLogout, onBack }) {
  const [businessName, setBusinessName] = useState(client.name || "");
  const [deliveryAddress, setDeliveryAddress] = useState(client.account.deliveryAddress || "");
  const [phone, setPhone] = useState(client.account.phone || "");
  const [billingName, setBillingName] = useState(client.account.billingName || "");
  const [billingVat, setBillingVat] = useState(client.account.billingVat || "");
  const [sameAddress, setSameAddress] = useState(
    !client.account.billingAddress || client.account.billingAddress === client.account.deliveryAddress
  );
  const [billingAddress, setBillingAddress] = useState(client.account.billingAddress || "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    setSaved(false);
    if (!deliveryAddress.trim() || !phone.trim() || !billingVat.trim()) {
      setError("Compila tutti i campi obbligatori.");
      return;
    }
    setBusy(true);
    const res = await onComplete({
      businessName: businessName.trim(),
      deliveryAddress: deliveryAddress.trim(),
      phone: phone.trim(),
      billingName: billingName.trim() || businessName.trim(),
      billingVat: billingVat.trim(),
      billingAddress: sameAddress ? deliveryAddress.trim() : billingAddress.trim(),
    });
    setBusy(false);
    if (res && res.ok === false) setError(res.error);
    else if (onBack) setSaved(true);
  };

  return (
    <div className="px-6 pt-6 pb-8 h-full overflow-y-auto">
      {onBack ? (
        <ScreenHeader
          title="I tuoi dati"
          subtitle="Modifica in qualsiasi momento i dati della tua struttura"
          onBack={onBack}
        />
      ) : (
        <>
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
        </>
      )}
      {saved && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-3 py-2 mb-4">
          Dati aggiornati con successo.
        </div>
      )}
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
        disabled={busy}
        onClick={submit}
        className="w-full bg-gray-900 disabled:bg-gray-300 text-white rounded-xl py-3 font-bold mt-2"
      >
        {busy ? "Salvataggio..." : onBack ? "Salva modifiche" : "Salva e continua"}
      </button>
    </div>
  );
}

function RecoverProfileScreen({ email, onComplete, onLogout }) {
  const [businessName, setBusinessName] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [billingName, setBillingName] = useState("");
  const [billingVat, setBillingVat] = useState("");
  const [sameAddress, setSameAddress] = useState(true);
  const [billingAddress, setBillingAddress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (!businessName.trim() || !deliveryAddress.trim() || !phone.trim() || !billingVat.trim()) {
      setError("Compila tutti i campi obbligatori.");
      return;
    }
    setBusy(true);
    try {
      const res = await onComplete({
        businessName: businessName.trim(),
        deliveryAddress: deliveryAddress.trim(),
        phone: phone.trim(),
        billingName: billingName.trim() || businessName.trim(),
        billingVat: billingVat.trim(),
        billingAddress: sameAddress ? deliveryAddress.trim() : billingAddress.trim(),
      });
      if (!res.ok) setError(res.error);
    } catch (e) {
      setError("Errore imprevisto: " + (e.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-6 pt-6 pb-8 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-bold text-gray-900">Completa la registrazione</h2>
        <button
          onClick={onLogout}
          className="text-xs font-semibold text-gray-400 flex items-center gap-1"
        >
          <LogOut size={13} /> Esci
        </button>
      </div>
      <p className="text-gray-500 text-sm mb-5">
        Il tuo accesso ({email}) esiste già, ma mancano ancora i dati della tua struttura.
        Completali qui sotto per continuare.
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
        disabled={busy}
        onClick={submit}
        className="w-full bg-gray-900 disabled:bg-gray-300 text-white rounded-xl py-3 font-bold mt-2"
      >
        Salva e continua
      </button>
    </div>
  );
}

function NoProfileScreen({ email, onRetry, onLogout, onCreateProfile }) {
  const [showRecover, setShowRecover] = useState(false);

  if (showRecover) {
    return (
      <RecoverProfileScreen email={email} onComplete={onCreateProfile} onLogout={onLogout} />
    );
  }

  return (
    <div className="p-6 flex flex-col h-full">
      <p className="text-sm text-gray-500 mb-2">
        Il tuo accesso ({email}) è valido, ma non troviamo ancora un profilo collegato.
      </p>
      <p className="text-sm text-gray-500 mb-5">
        Se ti sei appena registrato come <b>amministratore</b>, assicurati che la riga SQL di
        attivazione sia stata eseguita, poi premi "Riprova". Se invece ti sei registrato come{" "}
        <b>cliente</b> e la registrazione non si è completata, puoi creare qui i dati della tua
        struttura.
      </p>
      <div className="flex gap-2 mb-3">
        <button
          onClick={onRetry}
          className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-semibold text-gray-800"
        >
          Riprova
        </button>
        <button
          onClick={onLogout}
          className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-semibold text-gray-800"
        >
          Esci
        </button>
      </div>
      <button
        onClick={() => setShowRecover(true)}
        className="text-xs font-semibold text-gray-400 underline text-left"
      >
        Sono un cliente: crea qui i dati della mia struttura
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
  const confermati = myOrders.filter((o) => o.status === "pronto" || o.status === "programmato").length;
  const daSaldare = myOrders.filter((o) => o.status === "consegnato" && o.paymentStatus === "da_pagare");
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
    const lastOrder = myOrders.filter((o) => o.status === "consegnato").sort((a, b) => b.id - a.id)[0] || null;
    return (
      <NewOrderScreen
        client={client}
        catalog={data.catalog}
        lastOrder={lastOrder}
        onBack={() => setSubScreen("dashboard")}
        onCreate={({ returns, ...payload }) => {
          actions.addOrder({ clientId: client.id, ...payload });
          (returns || []).forEach((r) => {
            actions.createReturn({ clientId: client.id, ...r });
          });
          setSubScreen("dashboard");
        }}
      />
    );
  }

  if (subScreen === "profilo") {
    return (
      <CompleteProfileScreen
        client={client}
        onComplete={(fields) => actions.completeProfile(client.id, fields)}
        onBack={() => setSubScreen("dashboard")}
      />
    );
  }

  if (subScreen === "saldare") {
    return (
      <SaldareScreen
        orders={daSaldare}
        onDeclarePaid={actions.declarePaid}
        onBack={() => setSubScreen("dashboard")}
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
          <ClienteOrderCard key={o.id} order={o} onSendMessage={actions.sendOrderMessage} returns={data.returns} />
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
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setSubScreen("profilo")}
              className="text-xs font-semibold text-gray-400 flex items-center gap-1"
            >
              <Settings size={13} /> I miei dati
            </button>
            <button
              onClick={actions.logout}
              className="text-xs font-semibold text-gray-400 flex items-center gap-1"
            >
              <LogOut size={13} /> Esci
            </button>
          </div>
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
          <StatCard value={confermati} label="Confermati" valueClass="text-purple-600" />
        </div>

        <button
          onClick={() => setSubScreen("saldare")}
          className="w-full border border-gray-200 rounded-2xl p-4 mb-6 text-left flex items-center justify-between"
        >
          <div>
            <div className="text-xs text-gray-500">Da Saldare</div>
            <div className={`text-2xl font-bold mt-1 ${daSaldare.length > 0 ? "text-rose-600" : "text-gray-900"}`}>
              {daSaldare.length}
            </div>
          </div>
          <ChevronDown size={18} className="text-gray-400 -rotate-90" />
        </button>

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
          <ClienteOrderCard key={o.id} order={o} onSendMessage={actions.sendOrderMessage} returns={data.returns} />
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
    updateCatalogItemWeight: async (itemId, weightKg) => {
      const res = await api.updateCatalogItemWeight(itemId, weightKg);
      await refresh();
      return res;
    },
    deleteCatalogItem: async (itemId) => {
      const res = await api.deleteCatalogItem(itemId);
      await refresh();
      return res;
    },
    deleteClient: async (clientId) => {
      const res = await api.deleteClient(clientId);
      await refresh();
      return res;
    },
    createReturn: async (fields) => {
      const res = await api.createReturn(fields);
      await refresh();
      return res;
    },
    updateReturn: async (returnId, fields) => {
      const res = await api.updateReturn(returnId, fields);
      await refresh();
      return res;
    },
    applyReturnsToOrder: async (returnIds, orderId) => {
      const res = await api.applyReturnsToOrder(returnIds, orderId);
      await refresh();
      return res;
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
    updateOrderItems: async (orderId, items) => {
      const res = await api.updateOrderItems(orderId, items);
      await refresh();
      return res;
    },
    setOrderNote: async (orderId, note) => {
      await api.setOrderNote(orderId, note);
      await refresh();
    },
    toggleInvoiced: async (orderId, value) => {
      const res = await api.toggleInvoiced(orderId, value);
      await refresh();
      return res;
    },
    declarePaid: async (orderId) => {
      const res = await api.declarePaid(orderId);
      await refresh();
      return res;
    },
    confirmPayment: async (orderId) => {
      const res = await api.confirmPayment(orderId);
      await refresh();
      return res;
    },
    rejectPayment: async (orderId) => {
      const res = await api.rejectPayment(orderId);
      await refresh();
      return res;
    },
    sendOrderMessage: async (orderId, sender, message) => {
      const res = await api.sendOrderMessage(orderId, sender, message);
      await refresh();
      return res;
    },
    markMessageSeen: async (orderId) => {
      const res = await api.markMessageSeen(orderId);
      await refresh();
      return res;
    },
    completeProfile: async (clientId, fields) => {
      const res = await api.completeProfile(clientId, fields);
      await refresh();
      return res;
    },
    createClientProfile: async (fields) => {
      const res = await api.createClientProfile(authUser.id, authUser.email, fields);
      if (!res.ok) return res;
      await refresh();
      return { ok: true };
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
        return { ok: false, error: "Accesso riuscito ma errore nel caricare i dati: " + (e.message || String(e)) };
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
        return { ok: false, error: "Account creato ma errore nel caricare i dati: " + (e.message || String(e)) };
      }
    },
    adminSignup: async (email, password) => {
      try {
        return await api.signUpAdmin(email, password);
      } catch (e) {
        console.error("adminSignup error:", e);
        return { ok: false, error: "Errore: " + (e.message || String(e)) };
      }
    },
    requestPasswordReset: async (email) => api.requestPasswordResetOtp(email),
    resetPassword: async (email, otp, newPassword) =>
      api.resetPasswordWithOtp(email, otp, newPassword),
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
            onRequestPasswordReset={actions.requestPasswordReset}
            onResetPassword={actions.resetPassword}
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
            <NoProfileScreen
              email={authUser.email}
              onRetry={refresh}
              onLogout={actions.logout}
              onCreateProfile={actions.createClientProfile}
            />
          )}
        </div>
      </div>
    </div>
  );
}
