import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";

let server, base, dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "grana-api-"));
  const app = createApp({ dbFile: join(dir, "t.db"), dataDir: dir });
  server = app.server;
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* */ }
  return { status: res.status, data };
}

test("cadastro cria conta + casa com código de convite", async () => {
  const r = await api("POST", "/api/register", { body: { email: "a@grana.app", password: "senha123", name: "Ana" } });
  assert.equal(r.status, 201);
  assert.ok(r.data.token);
  assert.ok(r.data.household.inviteCode);
  assert.equal(r.data.user.email, "a@grana.app");
});

test("não permite e-mail duplicado", async () => {
  const r = await api("POST", "/api/register", { body: { email: "a@grana.app", password: "outra123", name: "X" } });
  assert.equal(r.status, 409);
});

test("login válido e inválido", async () => {
  const ok = await api("POST", "/api/login", { body: { email: "a@grana.app", password: "senha123" } });
  assert.equal(ok.status, 200);
  const bad = await api("POST", "/api/login", { body: { email: "a@grana.app", password: "errada" } });
  assert.equal(bad.status, 401);
});

test("casal: parceira entra pelo código e os dois compartilham os dados", async () => {
  // Ana (dona da casa)
  const ana = (await api("POST", "/api/login", { body: { email: "a@grana.app", password: "senha123" } })).data;
  const code = ana.household.inviteCode;

  // Sarah cria conta própria e entra na casa da Ana
  const sarahReg = (await api("POST", "/api/register", { body: { email: "s@grana.app", password: "senha123", name: "Sarah" } })).data;
  const join = await api("POST", "/api/join", { token: sarahReg.token, body: { code } });
  assert.equal(join.status, 200);
  assert.equal(join.data.household.id, ana.household.id);
  assert.equal(join.data.members.length, 2);

  // Ana adiciona uma conta compartilhada em setembro
  const bill = await api("POST", "/api/bills", {
    token: ana.token,
    body: { month: "2026-09", title: "Aluguel", category: "Casa", amount: 1500, owner: "shared" },
  });
  assert.equal(bill.status, 201);
  assert.equal(bill.data.ownerId, null);

  // Sarah vê a conta da Ana
  const sarahData = (await api("GET", "/api/data?month=2026-09", { token: sarahReg.token })).data;
  assert.equal(sarahData.bills.length, 1);
  assert.equal(sarahData.bills[0].title, "Aluguel");
  assert.equal(sarahData.members.length, 2);

  // Sarah adiciona uma conta dela; Ana vê
  await api("POST", "/api/bills", { token: sarahReg.token, body: { month: "2026-09", title: "Academia", category: "Saúde", amount: 120, owner: "me" } });
  const anaData = (await api("GET", "/api/data?month=2026-09", { token: ana.token })).data;
  assert.equal(anaData.bills.length, 2);
});

test("marcar paga, editar, excluir e renda do mês", async () => {
  const ana = (await api("POST", "/api/login", { body: { email: "a@grana.app", password: "senha123" } })).data;
  const created = (await api("POST", "/api/bills", { token: ana.token, body: { month: "2026-10", title: "Luz", category: "Contas fixas", amount: 200 } })).data;

  const paid = await api("PATCH", "/api/bills/" + created.id, { token: ana.token, body: { paid: true } });
  assert.equal(paid.data.paid, true);

  const edited = await api("PATCH", "/api/bills/" + created.id, { token: ana.token, body: { amount: 250 } });
  assert.equal(edited.data.amount, 250);

  await api("PUT", "/api/income", { token: ana.token, body: { month: "2026-10", amount: 6000 } });
  const data = (await api("GET", "/api/data?month=2026-10", { token: ana.token })).data;
  assert.equal(data.income, 6000);

  const del = await api("DELETE", "/api/bills/" + created.id, { token: ana.token });
  assert.equal(del.status, 200);
  const after = (await api("GET", "/api/data?month=2026-10", { token: ana.token })).data;
  assert.equal(after.bills.length, 0);
});

test("sem token é bloqueado", async () => {
  const r = await api("GET", "/api/data?month=2026-10");
  assert.equal(r.status, 401);
});

test("tempo real: parceira recebe evento quando a outra grava", async () => {
  const ana = (await api("POST", "/api/login", { body: { email: "a@grana.app", password: "senha123" } })).data;
  // abre SSE como Ana
  const ctrl = new AbortController();
  const evRes = await fetch(base + "/api/events?token=" + ana.token, { signal: ctrl.signal, headers: { Accept: "text/event-stream" } });
  const reader = evRes.body.getReader();
  const got = (async () => {
    const dec = new TextDecoder();
    const start = Date.now();
    while (Date.now() - start < 3000) {
      const { value, done } = await reader.read();
      if (done) break;
      if (dec.decode(value).includes("event: change")) return true;
    }
    return false;
  })();
  // Sarah grava algo
  const sarah = (await api("POST", "/api/login", { body: { email: "s@grana.app", password: "senha123" } })).data;
  await api("POST", "/api/bills", { token: sarah.token, body: { month: "2026-11", title: "Mercado", category: "Alimentação", amount: 300 } });
  const received = await got;
  ctrl.abort();
  assert.equal(received, true);
});
