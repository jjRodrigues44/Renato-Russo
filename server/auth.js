import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

// --- Hash de senha (scrypt, salt por usuário, comparação em tempo constante) ---
const KEYLEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length === 0) throw new Error("Senha inválida");
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN, SCRYPT);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}

export function verifyPassword(plain, saltHex, hashHex) {
  if (typeof plain !== "string" || !saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(plain, salt, expected.length, SCRYPT);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// --- Token de sessão: "<userId>.<hmac>" assinado com o segredo do servidor ---
export function makeToken(userId, secret) {
  const sig = createHmac("sha256", secret).update(userId).digest("base64url");
  return `${userId}.${sig}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== "string" || token.indexOf(".") < 0) return null;
  const i = token.lastIndexOf(".");
  const userId = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = createHmac("sha256", secret).update(userId).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}
