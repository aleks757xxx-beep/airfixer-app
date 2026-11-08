/** Коды 2FA (TOTP, RFC 6238): 6 цифр, шаг 30 секунд, HMAC-SHA1 — как в Google Authenticator. */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP = 30;

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function newTotpSecret(): string {
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  return base32Encode(b);
}

async function codeAt(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(step / 2 ** 32));
  view.setUint32(4, step >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const off = (h[h.length - 1] ?? 0) & 15;
  const bin =
    (((h[off] ?? 0) & 0x7f) << 24) | ((h[off + 1] ?? 0) << 16) | ((h[off + 2] ?? 0) << 8) | (h[off + 3] ?? 0);
  return String(bin % 1_000_000).padStart(6, "0");
}

/**
 * Проверить код. Допускаем ±1 шаг (расхождение часов).
 * Возвращает номер шага, если код верный и новее lastStep, иначе null.
 */
export async function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const cur = Math.floor(now / 1000 / STEP);
  for (const step of [cur - 1, cur, cur + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if ((await codeAt(secret, step)) === code) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

