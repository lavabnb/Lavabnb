// Protocollo dei lettori CHAFON H100 / H102 / H103 (BLE).
// Fonti: "UHF Hand Reader User manual V1.2", "Bluetooth Development 20250304"
// e la libreria ufficiale cf-sdk-v1.0.4 (comportamento verificato sul codice).
// Questo file non dipende da React né dal resto di LavaBnB.

export const BLE_SERVICE = 0xffe0;
export const BLE_WRITE = 0xffe3;
export const BLE_NOTIFY = 0xffe4;

export const CMD = {
  INVENTORY: 0x0001,
  STOP: 0x0002,
  DEVICE_INFO: 0x0070,
  SET_ALL: 0x0071,
  GET_ALL: 0x0072,
  PERMISSION: 0x0076,
  BATTERY: 0x0083,
  KEY: 0x0089,
  READMODE: 0x008e,
};

export const STATUS_INVENTORY_DONE = 0x12;

// Posizioni nel blocco di configurazione (25 byte, risposta GET_ALL dal byte 6)
export const P = { WORKMODE: 2, REGION: 7, POWER: 15, AREA: 16, Q: 17, SESSION: 18, FILTER: 21 };

export const AREAS = ["Riservata", "EPC", "TID", "USER", "EPC+TID", "EPC+USER", "EPC+TID+USER"];
export const REGIONS = {
  0: "personalizzata",
  1: "USA (902–928 MHz)",
  2: "Corea",
  3: "Europa (865–868 MHz)",
  4: "Giappone",
  5: "Malesia",
  6: "Europa 3",
  7: "Cina 1",
  8: "Cina 2",
};
export const WORKMODES = ["risposta (comandi)", "attiva", "a grilletto"];

export function crc16(bytes, len = bytes.length) {
  let c = 0xffff;
  for (let i = 0; i < len; i++) {
    c ^= bytes[i];
    for (let j = 0; j < 8; j++) c = c & 1 ? (c >>> 1) ^ 0x8408 : c >>> 1;
  }
  return c & 0xffff;
}

export function buildFrame(cmd, data = []) {
  const f = [0xcf, 0xff, (cmd >> 8) & 0xff, cmd & 0xff, data.length, ...data];
  const c = crc16(f);
  f.push((c >> 8) & 0xff, c & 0xff);
  return new Uint8Array(f);
}

export const toHex = (b, s = 0, e = b.length) =>
  Array.from(b.slice(s, e), (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
export const toHexSpaced = (b) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ").toUpperCase();

// Ricompone i frame dai pacchetti BLE (che possono arrivare spezzati o uniti) e verifica il CRC.
export class FrameParser {
  constructor(onFrame, onBad) {
    this.buf = new Uint8Array(0);
    this.onFrame = onFrame;
    this.onBad = onBad;
  }
  reset() {
    this.buf = new Uint8Array(0);
  }
  push(chunk) {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    while (this.buf.length) {
      const start = this.buf.indexOf(0xcf);
      if (start < 0) {
        this.onBad?.(this.buf);
        this.buf = new Uint8Array(0);
        return;
      }
      if (start > 0) this.buf = this.buf.slice(start);
      if (this.buf.length < 5) return;
      const total = 5 + this.buf[4] + 2;
      if (this.buf.length < total) return;
      const f = this.buf.slice(0, total);
      const c = crc16(f, total - 2);
      const hiLo = (f[total - 2] << 8) | f[total - 1];
      const loHi = (f[total - 1] << 8) | f[total - 2];
      if (c === hiLo || c === loHi) {
        this.buf = this.buf.slice(total);
        this.onFrame(f);
      } else {
        this.onBad?.(f);
        this.buf = this.buf.slice(1);
      }
    }
  }
}

// Alcune versioni rispondono a GET_ALL con il codice 0x0071: lo riconosciamo dalla lunghezza.
export function frameCmd(f) {
  const cmd = (f[2] << 8) | f[3];
  if (cmd === CMD.SET_ALL && f[4] >= 26) return CMD.GET_ALL;
  return cmd;
}

// Tag letto. Come la libreria ufficiale: dati = dal byte 11 fino al CRC, RSSI in decimi di dBm.
export function decodeTag(f) {
  if (f[4] <= 1 || f[5] !== 0x00) return null;
  const data = f.slice(11, f.length - 2);
  const epcLen = f[10];
  const id = epcLen > 0 && epcLen <= data.length ? data.slice(0, epcLen) : data;
  if (!id.length) return null;
  let rssi = (f[6] << 8) | f[7];
  if (rssi & 0x8000) rssi -= 0x10000;
  return { epc: toHex(id), rssi: Math.round(rssi / 10) };
}

export function decodeDeviceInfo(f) {
  const ascii = Array.from(f.slice(5, f.length - 2), (b) =>
    b >= 32 && b < 127 ? String.fromCharCode(b) : " "
  )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return ascii || toHex(f, 5, f.length - 2);
}

export function decodePermission(f) {
  if (f[5] !== 0 || f.length < 49) return null;
  return { codeEN: f[7], maskEN: f[12], maskLen: f[14] };
}
export const permissionActive = (p) => !!p && (p.codeEN || (p.maskEN && p.maskLen));
