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
  const [catalogRes, clientsRes, ordersRes, notifRes, staffRes, returnsRes] = await Promise.all([
    neon.from("catalog_items").select("*").order("category"),
    neon.from("clients").select("*, client_pricing(item_id, price)"),
    neon.from("orders").select("*, order_items(*), order_slots(*), order_messages(*)"),
    neon.from("notifications").select("*"),
    neon.from("staff").select("user_id"),
    neon.from("returns").select("*"),
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
    vatEnabled: !!c.vat_enabled,
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
    invoiced: !!o.invoiced,
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
  }));

  const isStaff = (staffRes.data || []).length > 0;

  return { catalog, clients, orders, notifications, returns, isStaff };
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

export async function addNotification(clientId, message) {
  await neon.from("notifications").insert([{ client_id: clientId, message }]);
}

// ---------------- Ordini ----------------

export async function createOrder({ clientId, items, total, preferredSlots, note }) {
  const { data, error } = await neon
    .from("orders")
    .insert([{ client_id: clientId, total, status: "nuovo", note: note || "" }])
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
    }
    return { ok: true };
  } catch (e) {
    console.error("sendOrderMessage error:", e);
    return { ok: false, error: "Errore nell'invio del messaggio: " + (e.message || String(e)) };
  }
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

export async function toggleInvoiced(orderId, value) {
  try {
    const { error } = await neon.from("orders").update({ invoiced: value }).eq("id", orderId);
    if (error) return { ok: false, error: "Non ho potuto salvare: " + error.message };
    return { ok: true };
  } catch (e) {
    console.error("toggleInvoiced error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}

export async function declarePaid(orderId) {
  try {
    const { error } = await neon
      .from("orders")
      .update({ payment_status: "dichiarato_pagato" })
      .eq("id", orderId);
    if (error) return { ok: false, error: "Non ho potuto salvare: " + error.message };
    return { ok: true };
  } catch (e) {
    console.error("declarePaid error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}

export async function confirmPayment(orderId) {
  try {
    const clientId = await getOrderClientId(orderId);
    const { error } = await neon
      .from("orders")
      .update({ payment_status: "saldato" })
      .eq("id", orderId);
    if (error) return { ok: false, error: "Non ho potuto salvare: " + error.message };
    if (clientId) {
      await addNotification(clientId, `Il tuo ordine #${orderId} risulta saldato. Grazie!`);
    }
    return { ok: true };
  } catch (e) {
    console.error("confirmPayment error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}

export async function setClientVat(clientId, enabled) {
  try {
    const { error } = await neon.from("clients").update({ vat_enabled: enabled }).eq("id", clientId);
    if (error) return { ok: false, error: "Non ho potuto salvare: " + error.message };
    return { ok: true };
  } catch (e) {
    console.error("setClientVat error:", e);
    return { ok: false, error: "Errore: " + (e.message || String(e)) };
  }
}
