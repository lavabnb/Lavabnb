// Collegamento al lettore CHAFON via Web Bluetooth (Chrome su Android / computer).
// Tutto avviene nel browser: nessun server, nessuna funzione serverless.
import {
  BLE_SERVICE,
  BLE_WRITE,
  BLE_NOTIFY,
  CMD,
  P,
  STATUS_INVENTORY_DONE,
  FrameParser,
  buildFrame,
  toHexSpaced,
  frameCmd,
  decodeTag,
  decodeDeviceInfo,
  decodePermission,
} from "./chafonProtocol";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Verifica se il browser può usare il Bluetooth e, se no, spiega perché.
export function bluetoothSupport() {
  if (typeof window === "undefined") return { ok: false, reason: "Ambiente non supportato." };
  if (!window.isSecureContext)
    return { ok: false, reason: "La pagina deve essere aperta da un indirizzo https://." };
  if (!navigator.bluetooth)
    return {
      ok: false,
      reason:
        "Questo browser non supporta il Bluetooth per le pagine web. Usa Chrome su Android (su iPhone non è disponibile).",
    };
  return { ok: true };
}

export class ChafonReader {
  constructor(handlers = {}) {
    this.h = handlers; // onLog, onStatus, onTag, onConfig, onInventory, onBattery, onKey, onBadFrame
    this.device = null;
    this.writeCh = null;
    this.notifyCh = null;
    this.queue = Promise.resolve();
    this.waiters = [];
    this.lastRx = 0;
    this.config = { params: null, deviceInfo: "", readMode: null, permission: null };
    this.parser = new FrameParser(
      (f) => this._handle(f),
      (f) => {
        this.h.onBadFrame?.();
        this._log("Dati scartati (CRC errato): " + toHexSpaced(f));
      }
    );
    this._onNotify = this._onNotify.bind(this);
    this._onDisconnected = this._onDisconnected.bind(this);
  }

  get connected() {
    return !!(this.writeCh && this.device?.gatt?.connected);
  }

  _log(m) {
    this.h.onLog?.(m);
  }

  async connect() {
    const sup = bluetoothSupport();
    if (!sup.ok) throw new Error(sup.reason);
    this.h.onStatus?.("searching");
    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [BLE_SERVICE],
      });
    } catch (e) {
      if (/permissions policy|disallowed/i.test(e.message))
        throw new Error(
          "Il browser blocca il Bluetooth in questa pagina. Aprila direttamente in Chrome, non dentro un'anteprima o un'altra app."
        );
      if (e.name === "NotFoundError") throw new Error("Nessun lettore selezionato.");
      throw e;
    }
    this.device = device;
    device.addEventListener("gattserverdisconnected", this._onDisconnected);
    this.h.onStatus?.("connecting", device.name);
    try {
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService(BLE_SERVICE);
      this.writeCh = await svc.getCharacteristic(BLE_WRITE);
      this.notifyCh = await svc.getCharacteristic(BLE_NOTIFY);
      this.notifyCh.addEventListener("characteristicvaluechanged", this._onNotify);
      await this.notifyCh.startNotifications();
    } catch (e) {
      this.writeCh = this.notifyCh = null;
      if (/service/i.test(e.message))
        throw new Error(
          "Il lettore non espone il servizio dati: probabilmente è in modalità tastiera (HID). Toglilo dai dispositivi Bluetooth del telefono, riavvialo e riprova."
        );
      throw new Error("Collegamento non riuscito: " + e.message);
    }
    this._log("Collegato: " + (device.name || "(senza nome)"));
    this.h.onStatus?.("connected", device.name);
    await this.send(CMD.STOP, []);
    await sleep(200);
    return this.readConfig();
  }

  disconnect() {
    try {
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } catch (e) {
      /* già scollegato */
    }
  }

  _onDisconnected() {
    this.writeCh = this.notifyCh = null;
    this.parser.reset();
    this._log("Lettore scollegato");
    this.h.onStatus?.("disconnected");
  }

  send(cmd, data = []) {
    const bytes = buildFrame(cmd, data);
    this.queue = this.queue
      .then(async () => {
        if (!this.writeCh) throw new Error("lettore non collegato");
        this._log("→ " + toHexSpaced(bytes));
        // Come la libreria ufficiale: un comando per scrittura, con conferma.
        if (this.writeCh.properties?.write && this.writeCh.writeValueWithResponse)
          await this.writeCh.writeValueWithResponse(bytes);
        else if (this.writeCh.writeValueWithoutResponse)
          await this.writeCh.writeValueWithoutResponse(bytes);
        else await this.writeCh.writeValue(bytes);
      })
      .catch((e) => {
        this._log("Errore invio: " + e.message);
        this.h.onError?.("Invio del comando non riuscito: " + e.message);
      });
    return this.queue;
  }

  request(cmd, data, test = () => true, ms = 2500) {
    const p = new Promise((resolve) => {
      const w = { cmd, test, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          resolve(null);
        }
      }, ms);
    });
    this.send(cmd, data);
    return p;
  }

  _onNotify(ev) {
    const dv = ev.target.value;
    this.lastRx = Date.now();
    this.parser.push(new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength)));
  }

  _handle(f) {
    const cmd = frameCmd(f);
    if (cmd !== CMD.INVENTORY || (this._invLogged = (this._invLogged || 0) + 1) <= 30)
      this._log("← " + toHexSpaced(f));
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i].cmd === cmd && this.waiters[i].test(f)) {
        this.waiters[i].resolve(f);
        this.waiters.splice(i, 1);
      }
    }
    const status = f[5];
    switch (cmd) {
      case CMD.INVENTORY: {
        if (f[4] === 1) {
          if (status === STATUS_INVENTORY_DONE) this.h.onInventory?.("done");
          else this._log("Lettura: stato 0x" + status.toString(16));
          return;
        }
        const tag = decodeTag(f);
        if (tag) this.h.onTag?.(tag);
        else this._log("Lettura: stato 0x" + status.toString(16));
        break;
      }
      case CMD.STOP:
        this.h.onInventory?.("stopped");
        break;
      case CMD.KEY:
        if (f[5] === 0x01) this.h.onKey?.("down");
        else if (f[5] === 0x02) this.h.onKey?.("up");
        break;
      case CMD.BATTERY:
        if (status === 0 && f.length >= 9) this.h.onBattery?.(f[6]);
        break;
      case CMD.GET_ALL:
        if (status === 0 && f[4] >= 26) {
          this.config.params = Array.from(f.slice(6, 31));
          this.h.onConfig?.({ ...this.config });
        }
        break;
      case CMD.SET_ALL:
        if (f[4] === 1)
          this._log(status === 0 ? "Configurazione salvata nel lettore" : "Configurazione rifiutata (stato 0x" + status.toString(16) + ")");
        break;
      case CMD.READMODE:
        if (f[4] >= 2 && status === 0) {
          this.config.readMode = f[6];
          this.h.onConfig?.({ ...this.config });
        }
        break;
      case CMD.PERMISSION: {
        const p = decodePermission(f);
        if (p) {
          this.config.permission = p;
          this.h.onConfig?.({ ...this.config });
        }
        break;
      }
      case CMD.DEVICE_INFO:
        this.config.deviceInfo = decodeDeviceInfo(f);
        this.h.onConfig?.({ ...this.config });
        break;
      default:
        break;
    }
  }

  // Legge la configurazione; se il lettore è in modalità codice a barre lo riporta in RFID.
  async readConfig() {
    this.config = { params: null, deviceInfo: "", readMode: null, permission: null };
    const info = await this.request(CMD.DEVICE_INFO, []);
    const rm = await this.request(CMD.READMODE, [0x02], (f) => f[4] >= 2);
    if (rm && rm[6] === 1) {
      this._log("Lettore in modalità codice a barre: passo a RFID");
      await this.request(CMD.READMODE, [0x01, 0x00, 0, 0, 0, 0, 0, 0, 0], (f) => f[4] === 1);
      await sleep(1100); // il manuale chiede 1 s dopo il cambio
      await this.request(CMD.READMODE, [0x02], (f) => f[4] >= 2);
    }
    const all = await this.request(CMD.GET_ALL, [], (f) => f[4] >= 26);
    await this.request(CMD.PERMISSION, [0x02], () => true, 1500);
    await this.request(CMD.BATTERY, [], () => true, 1500);
    this.h.onConfig?.({ ...this.config });
    if (!info && !rm && !all) return { ok: false, problem: "no-response" };
    if (!all) return { ok: false, problem: "no-config" };
    return { ok: true };
  }

  // Imposta la potenza come l'app ufficiale: rilegge la configurazione, cambia solo la potenza, la riscrive.
  async applyPower(pwr) {
    if (!this.config.params) await this.request(CMD.GET_ALL, [], (f) => f[4] >= 26);
    const params = this.config.params;
    if (!params) return { ok: false, reason: "Non riesco a leggere la configurazione del lettore." };
    if (params[P.POWER] === pwr) return { ok: true };
    const next = params.slice();
    next[P.POWER] = pwr;
    const res = await this.request(CMD.SET_ALL, next, (f) => f[4] === 1, 3000);
    if (!res || res[5] !== 0) return { ok: false, reason: "Il lettore non ha accettato la nuova potenza." };
    await this.request(CMD.GET_ALL, [], (f) => f[4] >= 26);
    const okNow = this.config.params && this.config.params[P.POWER] === pwr;
    return okNow ? { ok: true } : { ok: false, reason: "Il lettore non conferma la nuova potenza." };
  }

  async startInventory() {
    this._invLogged = 0;
    const sentAt = Date.now();
    await this.send(CMD.INVENTORY, [0x00, 0x00, 0x00, 0x00, 0x00]);
    return sentAt;
  }

  stopInventory() {
    return this.send(CMD.STOP, []);
  }
}
