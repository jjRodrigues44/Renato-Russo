import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UserRepository } from "../src/userRepository.js";
import { hashPassword, verifyPassword } from "../src/password.js";

function freshRepo() {
  const dir = mkdtempSync(join(tmpdir(), "grana-"));
  const repo = new UserRepository({ filePath: join(dir, "users.json") });
  return { repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("hash e verify de senha funcionam", () => {
  const h = hashPassword("segredo123");
  assert.ok(h.startsWith("scrypt$"));
  assert.equal(verifyPassword("segredo123", h), true);
  assert.equal(verifyPassword("errada", h), false);
});

test("registra usuario e nunca expoe a senha", () => {
  const { repo, cleanup } = freshRepo();
  try {
    const u = repo.register({ email: "Ana@Grana.app", password: "senhaforte1", name: "Ana" });
    assert.equal(u.email, "ana@grana.app"); // normalizado
    assert.equal(u.name, "Ana");
    assert.ok(u.id);
    assert.equal(u.passwordHash, undefined);
  } finally {
    cleanup();
  }
});

test("nao permite email duplicado", () => {
  const { repo, cleanup } = freshRepo();
  try {
    repo.register({ email: "x@grana.app", password: "senhaforte1" });
    assert.throws(() => repo.register({ email: "x@grana.app", password: "outra123456" }), /ja cadastrado/);
  } finally {
    cleanup();
  }
});

test("rejeita email invalido e senha curta", () => {
  const { repo, cleanup } = freshRepo();
  try {
    assert.throws(() => repo.register({ email: "naoemail", password: "senhaforte1" }), /Email invalido/);
    assert.throws(() => repo.register({ email: "y@grana.app", password: "123" }), /ao menos 8/);
  } finally {
    cleanup();
  }
});

test("authenticate valida credenciais e grava lastLoginAt", () => {
  const { repo, cleanup } = freshRepo();
  try {
    repo.register({ email: "b@grana.app", password: "senhaforte1" });
    assert.equal(repo.authenticate({ email: "b@grana.app", password: "errada" }), null);
    const ok = repo.authenticate({ email: "B@grana.app", password: "senhaforte1" });
    assert.ok(ok);
    assert.ok(ok.lastLoginAt);
  } finally {
    cleanup();
  }
});

test("troca de senha exige a senha atual", () => {
  const { repo, cleanup } = freshRepo();
  try {
    repo.register({ email: "c@grana.app", password: "senhaforte1" });
    assert.throws(
      () => repo.changePassword({ email: "c@grana.app", currentPassword: "errada", newPassword: "novasenha1" }),
      /invalidas/
    );
    repo.changePassword({ email: "c@grana.app", currentPassword: "senhaforte1", newPassword: "novasenha1" });
    assert.ok(repo.authenticate({ email: "c@grana.app", password: "novasenha1" }));
  } finally {
    cleanup();
  }
});

test("persiste entre instancias", () => {
  const dir = mkdtempSync(join(tmpdir(), "grana-"));
  const path = join(dir, "users.json");
  try {
    const a = new UserRepository({ filePath: path });
    a.register({ email: "d@grana.app", password: "senhaforte1" });
    const b = new UserRepository({ filePath: path });
    assert.ok(b.findByEmail("d@grana.app"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("delete remove o usuario", () => {
  const { repo, cleanup } = freshRepo();
  try {
    const u = repo.register({ email: "e@grana.app", password: "senhaforte1" });
    assert.equal(repo.delete(u.id), true);
    assert.equal(repo.findById(u.id), null);
  } finally {
    cleanup();
  }
});
