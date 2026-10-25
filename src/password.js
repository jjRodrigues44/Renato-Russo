import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// Parametros do scrypt. N=16384 (2^14) e um custo recomendado para uso interativo.
const KEYLEN = 64;
const SALT_BYTES = 16;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

/**
 * Gera o hash de uma senha em texto puro.
 * O retorno guarda salt + parametros, para o hash ser auto-descritivo.
 * Formato: scrypt$N$r$p$<saltHex>$<hashHex>
 */
export function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("Senha invalida");
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEYLEN, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Verifica uma senha em texto puro contra um hash guardado.
 * Usa comparacao em tempo constante para evitar timing attacks.
 */
export function verifyPassword(plain, stored) {
  if (typeof plain !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(plain, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
