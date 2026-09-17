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
    return { ok: false, error: "Errore di accesso: " + (e.message || String(e)) };
  }
}

export async function requestPasswordResetOtp(email) {
  try {
    const res = await neon.auth.forgetPassword.emailOtp({ email });
    if (res.error) return { ok: false, error: translateAuthError(res.error.message) };
    return { ok: true };
  } catch (e) {
    console.error("requestPasswordResetOtp error:", e);
    return { ok: false, error: "Non è stato possibile inviare il codice: " + (e.message || String(e)) };
  }
}

export async function resetPasswordWithOtp(email, otp, newPassword) {
  try {
    const check = await neon.auth.emailOtp.checkVerificationOtp({
      email,
      otp,
      type: "forget-password",
    });
    if (check.error || !check.data || !check.data.success) {
      return { ok: false, error: "Codice non valido o scaduto." };
    }
    const res = await neon.auth.emailOtp.resetPassword({ email, otp, password: newPassword });
    if (res.error) return { ok: false, error: translateAuthError(res.error.message) };
    return { ok: true };
  } catch (e) {
    console.error("resetPasswordWithOtp error:", e);
    return {
      ok: false,
      error: "Non è stato possibile reimpostare la password: " + (e.message || String(e)),
    };
  }
}

export async function signUpAdmin(email, password) {
  try {
    const res = await neon.auth.signUp.email({ email, password, name: email });
    if (res.error) return { ok: false, error: translateAuthError(res.error.message) };
    return { ok: true };
  } catch (e) {
    console.error("signUpAdmin error:", e);
    return { ok: false, error: "Errore nella creazione dell'account: " + (e.message || String(e)) };
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
  clientType,
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
        client_type: clientType || "privato",
      },
    ]);
    if (error) {
      console.error("signUpClient insert clients error:", error);
      return {
        ok: false,
        error: "Account creato ma non ho potuto salvare il profilo: " + error.message,
      };
    }
    return { ok: true };
  } catch (e) {
    console.error("signUpClient error:", e);
    return { ok: false, error: "Errore nella registrazione: " + (e.message || String(e)) };
  }
}

export async function signOut() {
  await neon.auth.signOut();
}

// ---------------- Lettura dati ----------------

export async function fetchAll() {
  const [catalogRes, clientsRes, ordersRes, notifRes, staffRes, returnsRes, addressesRes] = await Promise.all([
    neon.from("catalog_items").select("*").order("category"),
    neon.from("clients").select("*, client_pricing(item_id, price)"),
    neon.from("orders").select("*, order_items(*), order_slots(*), order_messages(*)"),
    neon.from("notifications").select("*"),
    neon.from("staff").select("user_id"),
    neon.from("returns").select("*"),
    neon.from("client_addresses").select("*").order("created_at"),
  ]);

  const catalog = (catalogRes.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    weightKg: Number(r.weight_kg),
    clientId: r.client_id || null,
  }));

  const clients = (clientsRes.data || []).map((c) => ({
    id: c.id,
    userId: c.user_id,
    name: c.name,
    paymentMethod: c.payment_method || "contanti",
    deliveryFee: Number(c.delivery_fee || 0),
    deliveryEnabled: !!c.delivery_enabled,
    clientType: c.client_type || "privato",
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
    paymentStatus: o.payment_status || "da_pagare",
    deliveryDate: o.delivery_date,
    deliveryTime: o.delivery_time ? o.delivery_time.slice(0, 5) : null,
    note: o.note || "",
    lastModification: o.last_modification || "",
    paymentMethod: o.payment_method || "contanti",
    deliveryFee: Number(o.delivery_fee || 0),
    createdBy: o.created_by || "client",
    addressId: o.address_id || null,
    addressLabel: o.address_label || "",
    addressSnapshot: o.address_snapshot || "",
    addressIntercom: o.address_intercom || "",
    addressFloor: o.address_floor || "",
    addressUnit: o.address_unit || "",
    addressNotes: o.address_notes || "",
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
    messages: (o.order_messages || [])
      .map((m) => ({
        id: m.id,
        sender: m.sender,
        message: m.message,
        createdAt: m.created_at,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));

  const notifications = (notifRes.data || []).map((n) => ({
    id: n.id,
    clientId: n.client_id,
    message: n.message,
    createdAt: n.created_at,
    audience: n.audience || "client",
  }));

  const returns = (returnsRes.data || []).map((r) => ({
    id: r.id,
    clientId: r.client_id,
    orderId: r.order_id,
    itemName: r.item_name,
    qty: r.qty,
    amount: Number(r.amount),
    reason: r.reason,
    note: r.note || "",
    applied: r.applied,
    appliedOrderId: r.applied_order_id,
    createdAt: r.created_at,
    staffSeen: r.staff_seen !== false,
  }));

  const addresses = (addressesRes.data || []).map((a) => ({
    id: a.id,
    clientId: a.client_id,
    label: a.label,
    address: a.address,
    intercom: a.intercom || "",
    floor: a.floor || "",
    unit: a.unit || "",
    notes: a.notes || "",
    isDefault: !!a.is_default,
    createdAt: a.created_at,
  }));

  const isStaff = (staffRes.data || []).length > 0;

  return { catalog, clients, orders, notifications, returns, addresses, isStaff };
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
    .insert([{ name, category, weight_kg: weightKg, client_id: clientId }])
    .select();
  if (error || !data || !data[0]) throw new Error(error?.message || "Errore creazione capo");
  const itemId = data[0].id;
  await neon.from("client_pricing").insert([{ client_id: clientId, item_id: itemId, price }]);
}

export async function setClientPaymentMethod(clientId, method) {
  try {
    const { error } = await neon.from("clients").update({ payment_method: method }).eq("id", clientId);
    if (error) return { ok: false, error: "Non ho potuto salvare: " + error.message };
    return { ok: true };
  } catch (e) {
    console.error("setClientPaymentMethod error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}

export async function setClientDelivery(clientId, enabled, fee) {
  try {
    const { error, data } = await neon
      .from("clients")
      .update({ delivery_enabled: enabled, delivery_fee: enabled ? fee : 0 })
      .eq("id", clientId)
      .select();
    if (error) return { ok: false, error: "Non ho potuto salvare: " + error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "Il salvataggio non ha avuto effetto (probabile problema di permessi)." };
    }
    return { ok: true };
  } catch (e) {
    console.error("setClientDelivery error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}

export async function completeProfile(clientId, fields) {
  try {
    const { error } = await neon
      .from("clients")
      .update({
        name: fields.businessName,
        delivery_address: fields.deliveryAddress,
        phone: fields.phone,
        billing_name: fields.billingName,
        billing_vat: fields.billingVat,
        billing_address: fields.billingAddress,
        client_type: fields.clientType || "privato",
      })
      .eq("id", clientId);
    if (error) {
      console.error("completeProfile error:", error);
      return { ok: false, error: "Non ho potuto salvare i dati: " + error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error("completeProfile error:", e);
    return { ok: false, error: "Errore nel salvare i dati: " + (e.message || String(e)) };
  }
}

export async function createClientProfile(userId, email, fields) {
  try {
    const { error } = await neon.from("clients").insert([
      {
        user_id: userId,
        name: fields.businessName,
        email,
        phone: fields.phone,
        delivery_address: fields.deliveryAddress,
        billing_name: fields.billingName,
        billing_vat: fields.billingVat,
        billing_address: fields.billingAddress,
        client_type: fields.clientType || "privato",
      },
    ]);
    if (error) {
      console.error("createClientProfile error:", error);
      return { ok: false, error: "Non ho potuto salvare il profilo: " + error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error("createClientProfile error:", e);
    return { ok: false, error: "Errore nel salvare il profilo: " + (e.message || String(e)) };
  }
}

// ---------------- Notifiche ----------------

export async function addNotification(clientId, message, audience = "client") {
  await neon.from("notifications").insert([{ client_id: clientId, message, audience }]);
}

// ---------------- Ordini ----------------


export async function createOrder({ clientId, items, total, preferredSlots, note, returns, paymentMethod, address, deliveryFee }) {
  const fee = Number(deliveryFee || 0);
  const { data, error } = await neon
    .from("orders")
    .insert([{
      client_id: clientId,
      total: total + fee,
      delivery_fee: fee,
      status: "nuovo",
      note: note || "",
      payment_method: paymentMethod || "contanti",
      created_by: "client",
      address_id: address?.id || null,
      address_label: address?.label || "",
      address_snapshot: address?.address || "",
      address_intercom: address?.intercom || "",
      address_floor: address?.floor || "",
      address_unit: address?.unit || "",
      address_notes: address?.notes || "",
    }])
    .select();
  if (error || !data || !data[0]) {
    console.error("createOrder insert orders error:", error);
    throw new Error(error?.message || "Errore nella creazione dell'ordine.");
  }
  const orderId = data[0].id;

  const fail = async (context, err) => {
    console.error(`createOrder error (${context}):`, err);
    // Ripulisco l'ordine appena creato per non lasciare dati a metà.
    await neon.from("orders").delete().eq("id", orderId);
    throw new Error(`Errore durante "${context}": ${err?.message || err}`);
  };

  if (items.length > 0) {
    const { error: itemsError } = await neon.from("order_items").insert(
      items.map((it) => ({ order_id: orderId, item_id: it.itemId, name: it.name, qty: it.qty, price: it.price }))
    );
    if (itemsError) await fail("salvataggio capi ordinati", itemsError);
  }
  if (preferredSlots && preferredSlots.length > 0) {
    const { error: slotsError } = await neon
      .from("order_slots")
      .insert(preferredSlots.map((s) => ({ order_id: orderId, slot_date: s.date, slot_time: s.time })));
    if (slotsError) await fail("salvataggio orari richiesti", slotsError);
  }
  if (note && note.trim()) {
    const { error: msgError } = await neon
      .from("order_messages")
      .insert([{ order_id: orderId, sender: "client", message: note.trim() }]);
    if (msgError) {
      // Non blocco l'intero ordine per una nota non salvata: la segnalo soltanto.
      console.error("createOrder note->message error:", msgError);
    } else {
      await addNotification(
        clientId,
        `Nuovo messaggio dal cliente sull'ordine #${orderId}: "${note.trim()}"`,
        "staff"
      );
    }
  }
  if (returns && returns.length > 0) {
    const { error: returnsError } = await neon.from("returns").insert(
      returns.map((r) => ({
        client_id: clientId,
        order_id: r.orderId || null,
        item_name: r.itemName,
        qty: r.qty,
        amount: r.amount,
        reason: r.reason,
        note: r.note || "",
        applied: false,
        staff_seen: false,
      }))
    );
    if (returnsError) await fail("salvataggio resi segnalati", returnsError);
  }
  await addNotification(clientId, `Il tuo ordine #${orderId} è stato ricevuto.`);
  return orderId;
}

export async function sendOrderMessage(orderId, sender, message) {
  try {
    const { error } = await neon
      .from("order_messages")
      .insert([{ order_id: orderId, sender, message }]);
    if (error) {
      console.error("sendOrderMessage error:", error);
      return { ok: false, error: "Non ho potuto inviare il messaggio: " + error.message };
    }
    if (sender === "staff") {
      const clientId = await getOrderClientId(orderId);
      if (clientId) {
        await addNotification(
          clientId,
          `La lavanderia ha una richiesta per il tuo ordine #${orderId}. Guarda i messaggi sull'ordine.`
        );
      }
    } else {
      const clientId = await getOrderClientId(orderId);
      if (clientId) {
        await addNotification(
          clientId,
          `Nuovo messaggio dal cliente sull'ordine #${orderId}: "${message}"`,
          "staff"
        );
      }
    }
    return { ok: true };
  } catch (e) {
    console.error("sendOrderMessage error:", e);
    return { ok: false, error: "Errore nell'invio del messaggio: " + (e.message || String(e)) };
  }
}

export async function markReturnSeen(returnId) {
  try {
    const { error } = await neon.from("returns").update({ staff_seen: true }).eq("id", returnId);
    if (error) return { ok: false, error: "Non ho potuto salvare: " + error.message };
    return { ok: true };
  } catch (e) {
    console.error("markReturnSeen error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}

export async function deleteReturn(returnId) {
  try {
    const { error, data } = await neon.from("returns").delete().eq("id", returnId).select();
    if (error) return { ok: false, error: "Non ho potuto eliminare: " + error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "Il reso non risulta eliminato (probabile problema di permessi)." };
    }
    return { ok: true };
  } catch (e) {
    console.error("deleteReturn error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}

export async function adminCreateOrder({ clientId, items, total, deliveryDate, deliveryTime, paymentMethod, returnIds, address, deliveryFee }) {
  const status = deliveryDate ? "programmato" : "nuovo";
  const fee = Number(deliveryFee || 0);
  const { data, error } = await neon
    .from("orders")
    .insert([
      {
        client_id: clientId,
        total: total + fee,
        delivery_fee: fee,
        status,
        delivery_date: deliveryDate || null,
        delivery_time: deliveryTime || null,
        payment_method: paymentMethod || "contanti",
        created_by: "lavanderia",
        address_id: address?.id || null,
        address_label: address?.label || "",
        address_snapshot: address?.address || "",
        address_intercom: address?.intercom || "",
        address_floor: address?.floor || "",
        address_unit: address?.unit || "",
        address_notes: address?.notes || "",
      },
    ])
    .select();
  if (error || !data || !data[0]) {
    console.error("adminCreateOrder insert orders error:", error);
    throw new Error(error?.message || "Errore nella creazione dell'ordine.");
  }
  const orderId = data[0].id;
  if (items.length > 0) {
    const { error: itemsError } = await neon.from("order_items").insert(
      items.map((it) => ({ order_id: orderId, item_id: it.itemId, name: it.name, qty: it.qty, price: it.price }))
    );
    if (itemsError) {
      console.error("adminCreateOrder items error:", itemsError);
      await neon.from("orders").delete().eq("id", orderId);
      throw new Error("Errore durante il salvataggio dei capi: " + itemsError.message);
    }
  }
  if (returnIds && returnIds.length > 0) {
    await applyReturnsToOrder(returnIds, orderId);
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
    const { data: slotRows } = await neon
      .from("order_slots")
      .select("slot_date, slot_time")
      .eq("order_id", orderId);
    const requested = slotRows || [];
    const matches =
      requested.length === 0 ||
      requested.some((s) => s.slot_date === date && s.slot_time && s.slot_time.slice(0, 5) === time);
    const message = matches
      ? `Il tuo ordine #${orderId} è stato programmato per il ${formatIT(date)} alle ${time}.`
      : `Il tuo ordine #${orderId} è stato programmato per il ${formatIT(date)} alle ${time} — orario diverso da quello che avevi richiesto. Scrivici nei messaggi dell'ordine se hai bisogno di riparlarne.`;
    await addNotification(clientId, message);
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
  try {
    const clientId = await getOrderClientId(orderId);

    const { error: err1 } = await neon.from("returns").delete().eq("order_id", orderId);
    if (err1) {
      console.error("deleteOrder returns(order_id) error:", err1);
      return { ok: false, error: "Non ho potuto eliminare i resi collegati: " + err1.message };
    }
    const { error: err2 } = await neon.from("returns").delete().eq("applied_order_id", orderId);
    if (err2) {
      console.error("deleteOrder returns(applied_order_id) error:", err2);
      return { ok: false, error: "Non ho potuto eliminare i crediti collegati: " + err2.message };
    }
    const { error: err3, data } = await neon.from("orders").delete().eq("id", orderId).select();
    if (err3) {
      console.error("deleteOrder orders error:", err3);
      return { ok: false, error: "Non ho potuto eliminare l'ordine: " + err3.message };
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "L'ordine non risulta eliminato (probabile problema di permessi)." };
    }
    if (clientId) {
      await addNotification(clientId, `Il tuo ordine #${orderId} è stato annullato dalla lavanderia.`);
    }
    return { ok: true };
  } catch (e) {
    console.error("deleteOrder error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
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

export async function updateOrderItems(orderId, items) {
  try {
    const { data: oldRows } = await neon
      .from("order_items")
      .select("item_id, name, qty, price")
      .eq("order_id", orderId);
    const oldItems = oldRows || [];
    const keep = items.filter((it) => it.qty > 0);

    await neon.from("order_items").delete().eq("order_id", orderId);
    if (keep.length > 0) {
      await neon.from("order_items").insert(
        keep.map((it) => ({
          order_id: orderId,
          item_id: it.itemId,
          name: it.name,
          qty: it.qty,
          price: it.price,
        }))
      );
    }
    const total = keep.reduce((s, it) => s + it.qty * it.price, 0);
    await neon.from("orders").update({ total }).eq("id", orderId);

    const oldMap = Object.fromEntries(oldItems.map((it) => [it.item_id, it]));
    const newMap = Object.fromEntries(keep.map((it) => [it.itemId, it]));
    const diffLines = [];
    const summaryParts = [];
    for (const it of keep) {
      const old = oldMap[it.itemId];
      if (!old) {
        diffLines.push(`+ aggiunto ${it.qty}× ${it.name}`);
        summaryParts.push(`aggiunto ${it.qty}× ${it.name}`);
      } else if (old.qty !== it.qty) {
        diffLines.push(`✎ ${it.name}: da ${old.qty} a ${it.qty} pezzi`);
        summaryParts.push(`${it.name} da ${old.qty} a ${it.qty}`);
      }
    }
    for (const old of oldItems) {
      if (!newMap[old.item_id]) {
        diffLines.push(`− rimosso ${old.qty}× ${old.name}`);
        summaryParts.push(`rimosso ${old.qty}× ${old.name}`);
      }
    }

    if (diffLines.length > 0) {
      await neon
        .from("orders")
        .update({ last_modification: summaryParts.join("; ") })
        .eq("id", orderId);
      const clientId = await getOrderClientId(orderId);
      if (clientId) {
        const message = `La lavanderia ha modificato il tuo ordine #${orderId}:\n${diffLines.join("\n")}`;
        await neon.from("order_messages").insert([{ order_id: orderId, sender: "staff", message }]);
        await addNotification(
          clientId,
          `Il tuo ordine #${orderId} è stato modificato dalla lavanderia. Guarda i dettagli.`
        );
      }
    }

    return { ok: true };
  } catch (e) {
    console.error("updateOrderItems error:", e);
    return { ok: false, error: "Errore nel salvare i capi: " + (e.message || String(e)) };
  }
}

// ---------------- Catalogo ----------------

export async function deleteCatalogItem(itemId) {
  try {
    const { error } = await neon.from("catalog_items").delete().eq("id", itemId);
    if (error) return { ok: false, error: "Non ho potuto eliminare la tipologia: " + error.message };
    return { ok: true };
  } catch (e) {
    console.error("deleteCatalogItem error:", e);
    return { ok: false, error: "Errore nell'eliminazione: " + (e.message || String(e)) };
  }
}

export async function updateCatalogItemWeight(itemId, weightKg) {
  try {
    const { error } = await neon.from("catalog_items").update({ weight_kg: weightKg }).eq("id", itemId);
    if (error) return { ok: false, error: "Non ho potuto salvare il peso: " + error.message };
    return { ok: true };
  } catch (e) {
    console.error("updateCatalogItemWeight error:", e);
    return { ok: false, error: "Errore nel salvare il peso: " + (e.message || String(e)) };
  }
}

// ---------------- Clienti (eliminazione) ----------------

export async function deleteClient(clientId) {
  try {
    const { error } = await neon.from("clients").delete().eq("id", clientId);
    if (error) return { ok: false, error: "Non ho potuto eliminare il cliente: " + error.message };
    return { ok: true };
  } catch (e) {
    console.error("deleteClient error:", e);
    return { ok: false, error: "Errore nell'eliminazione: " + (e.message || String(e)) };
  }
}

// ---------------- Appartamenti/indirizzi ----------------

export async function createAddress(clientId, fields) {
  try {
    if (fields.isDefault) {
      await neon.from("client_addresses").update({ is_default: false }).eq("client_id", clientId);
    }
    const { error } = await neon.from("client_addresses").insert([
      {
        client_id: clientId,
        label: fields.label,
        address: fields.address,
        intercom: fields.intercom || "",
        floor: fields.floor || "",
        unit: fields.unit || "",
        notes: fields.notes || "",
        is_default: !!fields.isDefault,
      },
    ]);
    if (error) return { ok: false, error: "Non ho potuto salvare l'appartamento: " + error.message };
    return { ok: true };
  } catch (e) {
    console.error("createAddress error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}

export async function updateAddress(addressId, fields) {
  try {
    if (fields.isDefault) {
      const { data } = await neon.from("client_addresses").select("client_id").eq("id", addressId);
      const clientId = data && data[0] ? data[0].client_id : null;
      if (clientId) {
        await neon.from("client_addresses").update({ is_default: false }).eq("client_id", clientId);
      }
    }
    const { error } = await neon
      .from("client_addresses")
      .update({
        label: fields.label,
        address: fields.address,
        intercom: fields.intercom || "",
        floor: fields.floor || "",
        unit: fields.unit || "",
        notes: fields.notes || "",
        is_default: !!fields.isDefault,
      })
      .eq("id", addressId);
    if (error) return { ok: false, error: "Non ho potuto salvare le modifiche: " + error.message };
    return { ok: true };
  } catch (e) {
    console.error("updateAddress error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}

export async function deleteAddress(addressId) {
  try {
    const { error } = await neon.from("client_addresses").delete().eq("id", addressId);
    if (error) return { ok: false, error: "Non ho potuto eliminare l'appartamento: " + error.message };
    return { ok: true };
  } catch (e) {
    console.error("deleteAddress error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}

// ---------------- Resi ----------------

export async function createReturn({ clientId, orderId, itemName, qty, amount, reason, note }) {
  try {
    const { error } = await neon.from("returns").insert([
      {
        client_id: clientId,
        order_id: orderId || null,
        item_name: itemName,
        qty,
        amount,
        reason,
        note: note || "",
      },
    ]);
    if (error) return { ok: false, error: "Non ho potuto registrare il reso: " + error.message };
    if (orderId) {
      await addNotification(
        clientId,
        `Abbiamo registrato un reso di ${qty}× ${itemName} sul tuo ordine #${orderId} (€${Number(
          amount
        ).toFixed(2)} a tuo credito).`
      );
    }
    return { ok: true };
  } catch (e) {
    console.error("createReturn error:", e);
    return { ok: false, error: "Errore nel registrare il reso: " + (e.message || String(e)) };
  }
}

export async function updateReturn(returnId, { qty, amount, reason, note }) {
  try {
    const { error } = await neon
      .from("returns")
      .update({ qty, amount, reason, note: note || "" })
      .eq("id", returnId);
    if (error) return { ok: false, error: "Non ho potuto salvare le modifiche: " + error.message };
    return { ok: true };
  } catch (e) {
    console.error("updateReturn error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}

export async function applyReturnsToOrder(returnIds, orderId) {
  try {
    const { data: returnRows } = await neon.from("returns").select("amount, client_id").in("id", returnIds);
    const totalCredit = (returnRows || []).reduce((s, r) => s + Number(r.amount), 0);
    await neon.from("returns").update({ applied: true, applied_order_id: orderId }).in("id", returnIds);
    const { data: orderRows } = await neon.from("orders").select("total").eq("id", orderId);
    const currentTotal = orderRows && orderRows[0] ? Number(orderRows[0].total) : 0;
    const newTotal = Math.max(0, currentTotal - totalCredit);
    await neon.from("orders").update({ total: newTotal }).eq("id", orderId);
    const clientId = returnRows && returnRows[0] ? returnRows[0].client_id : null;
    if (clientId) {
      await addNotification(
        clientId,
        `Abbiamo applicato un credito di €${totalCredit.toFixed(2)} al tuo ordine #${orderId}.`
      );
    }
    return { ok: true };
  } catch (e) {
    console.error("applyReturnsToOrder error:", e);
    return { ok: false, error: "Errore nell'applicare il credito: " + (e.message || String(e)) };
  }
}

export async function setOrderNote(orderId, note) {
  await neon.from("orders").update({ note }).eq("id", orderId);
}

export async function confirmPayment(orderId) {
  try {
    const clientId = await getOrderClientId(orderId);
    const { data, error } = await neon
      .from("orders")
      .update({ payment_status: "saldato" })
      .eq("id", orderId)
      .select();
    if (error) return { ok: false, error: "Non ho potuto salvare: " + error.message };
    if (!data || data.length === 0) {
      return {
        ok: false,
        error:
          "L'aggiornamento non ha avuto effetto (probabile problema di permessi sul database). Nessuna riga modificata.",
      };
    }
    if (clientId) {
      await addNotification(clientId, `Il tuo ordine #${orderId} risulta saldato. Grazie!`);
    }
    return { ok: true };
  } catch (e) {
    console.error("confirmPayment error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}
