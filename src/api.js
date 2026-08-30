import { neon } from "./neonClient";

function formatIT(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function translateAuthError(msg) {
  if (!msg) return "Si è verificato un errore. Riprova.";
  const m = msg.toLowerCase();
  if (m.includes("invalid") && (m.includes("password") || m.includes("credential")))
    return "Email o password non corretti.";
  if (m.includes("already exist") || m.includes("already registered") || m.includes("duplicate"))
    return "Esiste già un account con questa email.";
  if (m.includes("password") && (m.includes("least") || m.includes("short")))
    return "La password è troppo corta (minimo 8 caratteri).";
  return msg;
}

// ---------------- Autenticazione ----------------

export async function getSession() {
  try {
    const { data } = await neon.auth.getSession();
    if (data && data.session && data.user) return data.user;
    return null;
  } catch (e) {
    console.error("getSession error:", e);
    return null;
  }
}

export async function signIn(email, password) {
  try {
    const res = await neon.auth.signIn.email({ email, password });
    if (res.error) return { ok: false, error: translateAuthError(res.error.message) };
    return { ok: true };
  } catch (e) {
    console.error("signIn error:", e);
    return { ok: false, error: "Non è stato possibile accedere. Riprova tra poco." };
  }
}

export async function signUpAdmin(email, password) {
  try {
    const res = await neon.auth.signUp.email({ email, password, name: email });
    if (res.error) return { ok: false, error: translateAuthError(res.error.message) };
    return { ok: true };
  } catch (e) {
    console.error("signUpAdmin error:", e);
    return { ok: false, error: "Non è stato possibile creare l'account. Riprova tra poco." };
  }
}

export async function signUpClient({
  businessName,
  email,
  password,
  deliveryAddress,
  phone,
  billingName,
  billingVat,
  billingAddress,
}) {
  try {
    const signUpRes = await neon.auth.signUp.email({ email, password, name: businessName });
    if (signUpRes.error) return { ok: false, error: translateAuthError(signUpRes.error.message) };
    const userId = signUpRes.data.user.id;
    const { error } = await neon.from("clients").insert([
      {
        user_id: userId,
        name: businessName,
        email,
        phone,
        delivery_address: deliveryAddress,
        billing_name: billingName,
        billing_vat: billingVat,
        billing_address: billingAddress,
      },
    ]);
    if (error) {
      console.error("signUpClient insert clients error:", error);
      return {
        ok: false,
        error:
          "Il tuo account è stato creato, ma c'è stato un problema nel salvare i dati della struttura. Riprova tra poco o contatta la lavanderia.",
      };
    }
    return { ok: true };
  } catch (e) {
    console.error("signUpClient error:", e);
    return {
      ok: false,
      error: "Non è stato possibile completare la registrazione. Riprova tra poco.",
    };
  }
}

export async function signOut() {
  await neon.auth.signOut();
}

// ---------------- Lettura dati ----------------

export async function fetchAll() {
  const [catalogRes, clientsRes, ordersRes, notifRes, staffRes] = await Promise.all([
    neon.from("catalog_items").select("*").order("category"),
    neon.from("clients").select("*, client_pricing(item_id, price)"),
    neon.from("orders").select("*, order_items(*), order_slots(*)"),
    neon.from("notifications").select("*"),
    neon.from("staff").select("user_id"),
  ]);

  const catalog = (catalogRes.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    weightKg: Number(r.weight_kg),
  }));

  const clients = (clientsRes.data || []).map((c) => ({
    id: c.id,
    userId: c.user_id,
    name: c.name,
    pricing: Object.fromEntries(
      (c.client_pricing || []).map((p) => [p.item_id, Number(p.price)])
    ),
    account: {
      email: c.email || "",
      phone: c.phone || "",
      deliveryAddress: c.delivery_address || "",
      billingName: c.billing_name || "",
      billingVat: c.billing_vat || "",
      billingAddress: c.billing_address || "",
    },
  }));

  const orders = (ordersRes.data || []).map((o) => ({
    id: o.id,
    clientId: o.client_id,
    createdDate: o.created_date,
    status: o.status,
    deliveryDate: o.delivery_date,
    deliveryTime: o.delivery_time ? o.delivery_time.slice(0, 5) : null,
    note: o.note || "",
    total: Number(o.total),
    items: (o.order_items || []).map((it) => ({
      itemId: it.item_id,
      name: it.name,
      qty: it.qty,
      price: Number(it.price),
    })),
    preferredSlots: (o.order_slots || []).map((s) => ({
      date: s.slot_date,
      time: s.slot_time ? s.slot_time.slice(0, 5) : "",
    })),
  }));

  const notifications = (notifRes.data || []).map((n) => ({
    id: n.id,
    clientId: n.client_id,
    message: n.message,
    createdAt: n.created_at,
  }));

  const isStaff = (staffRes.data || []).length > 0;

  return { catalog, clients, orders, notifications, isStaff };
}

// ---------------- Clienti / listino ----------------

export async function setClientPrice(clientId, itemId, price) {
  await neon
    .from("client_pricing")
    .upsert([{ client_id: clientId, item_id: itemId, price }], { onConflict: "client_id,item_id" });
}

export async function removeClientItem(clientId, itemId) {
  await neon.from("client_pricing").delete().eq("client_id", clientId).eq("item_id", itemId);
}

export async function addCatalogItemForClient(clientId, { name, category, weightKg, price }) {
  const { data, error } = await neon
    .from("catalog_items")
    .insert([{ name, category, weight_kg: weightKg }])
    .select();
  if (error || !data || !data[0]) throw new Error(error?.message || "Errore creazione capo");
  const itemId = data[0].id;
  await neon.from("client_pricing").insert([{ client_id: clientId, item_id: itemId, price }]);
}

export async function completeProfile(clientId, fields) {
  await neon
    .from("clients")
    .update({
      name: fields.businessName,
      delivery_address: fields.deliveryAddress,
      phone: fields.phone,
      billing_name: fields.billingName,
      billing_vat: fields.billingVat,
      billing_address: fields.billingAddress,
    })
    .eq("id", clientId);
}

// ---------------- Notifiche ----------------

export async function addNotification(clientId, message) {
  await neon.from("notifications").insert([{ client_id: clientId, message }]);
}

// ---------------- Ordini ----------------

export async function createOrder({ clientId, items, total, preferredSlots }) {
  const { data, error } = await neon
    .from("orders")
    .insert([{ client_id: clientId, total, status: "nuovo" }])
    .select();
  if (error || !data || !data[0]) throw new Error(error?.message || "Errore creazione ordine");
  const orderId = data[0].id;
  if (items.length > 0) {
    await neon.from("order_items").insert(
      items.map((it) => ({ order_id: orderId, item_id: it.itemId, name: it.name, qty: it.qty, price: it.price }))
    );
  }
  if (preferredSlots && preferredSlots.length > 0) {
    await neon
      .from("order_slots")
      .insert(preferredSlots.map((s) => ({ order_id: orderId, slot_date: s.date, slot_time: s.time })));
  }
  await addNotification(clientId, `Il tuo ordine #${orderId} è stato ricevuto.`);
  return orderId;
}

export async function adminCreateOrder({ clientId, items, total, deliveryDate, deliveryTime }) {
  const status = deliveryDate ? "programmato" : "nuovo";
  const { data, error } = await neon
    .from("orders")
    .insert([
      {
        client_id: clientId,
        total,
        status,
        delivery_date: deliveryDate || null,
        delivery_time: deliveryTime || null,
      },
    ])
    .select();
  if (error || !data || !data[0]) throw new Error(error?.message || "Errore creazione ordine");
  const orderId = data[0].id;
  if (items.length > 0) {
    await neon.from("order_items").insert(
      items.map((it) => ({ order_id: orderId, item_id: it.itemId, name: it.name, qty: it.qty, price: it.price }))
    );
  }
  await addNotification(clientId, `La lavanderia ha registrato un nuovo ordine per te (#${orderId}).`);
  if (deliveryDate) {
    await addNotification(
      clientId,
      `Il tuo ordine #${orderId} è stato programmato per il ${formatIT(deliveryDate)} alle ${deliveryTime}.`
    );
  }
  return orderId;
}

async function getOrderClientId(orderId) {
  const { data } = await neon.from("orders").select("client_id").eq("id", orderId);
  return data && data[0] ? data[0].client_id : null;
}

export async function scheduleOrder(orderId, date, time) {
  const clientId = await getOrderClientId(orderId);
  await neon
    .from("orders")
    .update({ status: "programmato", delivery_date: date, delivery_time: time })
    .eq("id", orderId);
  if (clientId) {
    await addNotification(
      clientId,
      `Il tuo ordine #${orderId} è stato programmato per il ${formatIT(date)} alle ${time}.`
    );
  }
}

export async function unscheduleOrder(orderId) {
  const clientId = await getOrderClientId(orderId);
  await neon
    .from("orders")
    .update({ status: "pronto", delivery_date: null, delivery_time: null })
    .eq("id", orderId);
  if (clientId) {
    await addNotification(
      clientId,
      `La consegna del tuo ordine #${orderId} è stata rimandata: verrà riprogrammata a breve.`
    );
  }
}

export async function markReady(orderId) {
  await neon.from("orders").update({ status: "pronto" }).eq("id", orderId);
}

export async function markDelivered(orderId) {
  const clientId = await getOrderClientId(orderId);
  await neon.from("orders").update({ status: "consegnato" }).eq("id", orderId);
  if (clientId) {
    await addNotification(clientId, `Il tuo ordine #${orderId} è stato consegnato. Grazie!`);
  }
}

export async function deleteOrder(orderId) {
  const clientId = await getOrderClientId(orderId);
  if (clientId) {
    await addNotification(clientId, `Il tuo ordine #${orderId} è stato annullato dalla lavanderia.`);
  }
  await neon.from("orders").delete().eq("id", orderId);
}

export async function updateOrderItemQty(orderId, itemId, newQty) {
  if (newQty <= 0) {
    await neon.from("order_items").delete().eq("order_id", orderId).eq("item_id", itemId);
  } else {
    await neon.from("order_items").update({ qty: newQty }).eq("order_id", orderId).eq("item_id", itemId);
  }
  const { data: itemRows } = await neon.from("order_items").select("qty, price").eq("order_id", orderId);
  const total = (itemRows || []).reduce((s, it) => s + it.qty * Number(it.price), 0);
  await neon.from("orders").update({ total }).eq("id", orderId);
}

export async function setOrderNote(orderId, note) {
  await neon.from("orders").update({ note }).eq("id", orderId);
}
