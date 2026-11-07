/** Шифрование токенов соцсетей: AES-GCM, ключ из секрета TOKEN_KEY (base64, 32 байта). */

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(secret: string | undefined): Promise<CryptoKey> {
  const raw = secret ? unb64(secret.trim()) : new Uint8Array();
  if (raw.length !== 32) throw new Error("TOKEN_KEY не задан или неверной длины");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(secret: string | undefined, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), new TextEncoder().encode(plain)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function open(secret: string | undefined, sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Неверный формат токена");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(secret), unb64(ct));
  return new TextDecoder().decode(pt);
}
