import { randomUUID } from "node:crypto";
import { JsonStore } from "./store.js";
import { hashPassword, verifyPassword } from "./password.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Repositorio de dados de login dos usuarios.
 *
 * Guarda, para cada usuario:
 *  - id        identificador unico
 *  - email     usado para login (unico, normalizado em minusculas)
 *  - name      nome de exibicao (perfil)
 *  - passwordHash   hash scrypt da senha (nunca a senha em texto puro)
 *  - createdAt / updatedAt / lastLoginAt
 *
 * A senha em texto puro nunca e guardada nem retornada por nenhum metodo.
 */
export class UserRepository {
  constructor({ filePath = "data/users.json" } = {}) {
    this.store = new JsonStore(filePath);
  }

  _normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  /** Remove campos sensiveis antes de expor um usuario para fora do repositorio. */
  _publicView(user) {
    if (!user) return null;
    const { passwordHash, ...safe } = user;
    return { ...safe };
  }

  /** Cadastra um novo usuario. Lanca erro se o email ja existir ou for invalido. */
  register({ email, password, name }) {
    const normalized = this._normalizeEmail(email);
    if (!EMAIL_RE.test(normalized)) throw new Error("Email invalido");
    if (typeof password !== "string" || password.length < 8) {
      throw new Error("A senha precisa ter ao menos 8 caracteres");
    }
    if (this._findRaw(normalized)) throw new Error("Email ja cadastrado");

    const now = new Date().toISOString();
    const user = {
      id: randomUUID(),
      email: normalized,
      name: String(name || "").trim() || normalized.split("@")[0],
      passwordHash: hashPassword(password),
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    };
    this.store.data.users.push(user);
    this.store.save();
    return this._publicView(user);
  }

  /** Valida email + senha. Retorna o usuario (sem hash) ou null se falhar. */
  authenticate({ email, password }) {
    const user = this._findRaw(this._normalizeEmail(email));
    if (!user) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    user.lastLoginAt = new Date().toISOString();
    this.store.save();
    return this._publicView(user);
  }

  /** Troca a senha de um usuario existente. */
  changePassword({ email, currentPassword, newPassword }) {
    const user = this._findRaw(this._normalizeEmail(email));
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      throw new Error("Credenciais invalidas");
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      throw new Error("A nova senha precisa ter ao menos 8 caracteres");
    }
    user.passwordHash = hashPassword(newPassword);
    user.updatedAt = new Date().toISOString();
    this.store.save();
    return this._publicView(user);
  }

  findByEmail(email) {
    return this._publicView(this._findRaw(this._normalizeEmail(email)));
  }

  findById(id) {
    return this._publicView(this.store.data.users.find((u) => u.id === id));
  }

  list() {
    return this.store.data.users.map((u) => this._publicView(u));
  }

  delete(id) {
    const before = this.store.data.users.length;
    this.store.data.users = this.store.data.users.filter((u) => u.id !== id);
    const removed = before !== this.store.data.users.length;
    if (removed) this.store.save();
    return removed;
  }

  _findRaw(normalizedEmail) {
    return this.store.data.users.find((u) => u.email === normalizedEmail);
  }
}
