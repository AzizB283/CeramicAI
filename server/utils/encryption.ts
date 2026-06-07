import crypto from "node:crypto";

// AES-256-GCM with a versioned ciphertext format — ported from clinic-connect
// so ciphertext is interchangeable between the two products.
//
// Format: "v2:<iv-hex>:<authTag-hex>:<ciphertext-hex>"
//
// - v2 prefix identifies the algorithm; future rotations bump to v3/v4 while
//   older ciphertexts stay decryptable by mapping the prefix.
// - 12-byte (96-bit) IV is the GCM-recommended size; 16-byte auth tag is
//   verified on decrypt, so any tampering throws.

const VERSION = "v2";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable not set");
  }
  if (key.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be 64 hex characters (256-bit key)");
  }
  return Buffer.from(key, "hex");
}

/** Encrypt a string with AES-256-GCM → "v2:iv:tag:ciphertext" (all hex). */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/** Decrypt a value produced by `encrypt`. Throws on bad format or tamper. */
export function decrypt(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("decrypt: value must be a non-empty string");
  }
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(`decrypt: unsupported ciphertext format (expected ${VERSION}:iv:tag:ct)`);
  }
  const [, ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ctHex, "hex");
  if (iv.length !== IV_BYTES) throw new Error("decrypt: invalid IV length");
  if (tag.length !== TAG_BYTES) throw new Error("decrypt: invalid auth tag length");
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** True if `value` looks like a v2 ciphertext we produced (no decrypt attempt). */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  if (!value.startsWith(`${VERSION}:`)) return false;
  const parts = value.split(":");
  return (
    parts.length === 4 &&
    /^[0-9a-f]+$/i.test(parts[1]) &&
    /^[0-9a-f]+$/i.test(parts[2]) &&
    /^[0-9a-f]+$/i.test(parts[3])
  );
}

/** Generate a fresh 256-bit key in hex (seed for ENCRYPTION_KEY). */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Deterministic peppered HMAC for indexed lookup of an encrypted phone.
// The pepper derives from ENCRYPTION_KEY via a per-purpose info string, so
// leaking the hash column doesn't expose the encryption key.
function getHmacPepper(purpose: string): Buffer {
  return crypto.createHmac("sha256", getEncryptionKey()).update(`hash-pepper:${purpose}`).digest();
}

let phonePepper: Buffer | null = null;
function phonePepperLazy(): Buffer {
  if (!phonePepper) phonePepper = getHmacPepper("phone");
  return phonePepper;
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function hashPhone(phone: string): string {
  return crypto.createHmac("sha256", phonePepperLazy()).update(normalizePhone(phone)).digest("hex");
}

// Deterministic peppered HMAC for indexed lookup of an encrypted email — used
// to dedupe imported contacts and to match the suppression list without ever
// storing the address in plaintext. Separate pepper purpose from phone so the
// two hash spaces can't be cross-correlated.
let emailPepper: Buffer | null = null;
function emailPepperLazy(): Buffer {
  if (!emailPepper) emailPepper = getHmacPepper("email");
  return emailPepper;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashEmail(email: string): string {
  return crypto.createHmac("sha256", emailPepperLazy()).update(normalizeEmail(email)).digest("hex");
}
