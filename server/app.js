import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { openDb, uid, inviteCode } from "./db.js";
import { hashPassword, verifyPassword, makeToken, verifyToken } from "./auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loadSecret(dataDir) {
  if (process.env.GRANA_SECRET) return process.env.GRANA_SECRET;
  const f = join(dataDir, "secret.key");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  mkdirSync(dataDir, { recursive: true });
  const s = randomBytes(32).toString("hex");
  writeFileSync(f, s, "utf8");
  return s;
}

export function createApp({ dbFile, dataDir }) {
  const db = openDb(dbFile);
  const SECRET = loadSecret(dataDir);

  // ---------- consultas ----------
  const q = {
    userById: db.prepare("SELECT * FROM users WHERE id = ?"),
    userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    insUser: db.prepare(
      "INSERT INTO users (id,email,name,salt,hash,avatar,notifications,monthly_summary,household_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ),
    setUserHousehold: db.prepare("UPDATE users SET household_id = ? WHERE id = ?"),
    updProfile: db.prepare(
      "UPDATE users SET name = ?, avatar = ?, notifications = ?, monthly_summary = ? WHERE id = ?"
    ),
    household: db.prepare("SELECT * FROM households WHERE id = ?"),
    householdByCode: db.prepare("SELECT * FROM households WHERE invite_code = ?"),
    insHousehold: db.prepare("INSERT INTO households (id,name,invite_code,created_at) VALUES (?,?,?,?)"),
    members: db.prepare("SELECT id,name,avatar FROM users WHERE household_id = ? ORDER BY created_at"),
    countMembers: db.prepare("SELECT COUNT(*) c FROM users WHERE household_id = ?"),
    delHousehold: db.prepare("DELETE FROM households WHERE id = ?"),
    billsOf: db.prepare("SELECT * FROM bills WHERE household_id = ? AND month = ? ORDER BY created_at"),
    billById: db.prepare("SELECT * FROM bills WHERE id = ?"),
    insBill: db.prepare(
      "INSERT INTO bills (id,household_id,month,title,category,amount,due_day,paid,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ),
    delBill: db.prepare("DELETE FROM bills WHERE id = ? AND household_id = ?"),
    income: db.prepare("SELECT amount FROM incomes WHERE household_id = ? AND month = ?"),
    incomesUpTo: db.prepare(
      "SELECT month, amount FROM incomes WHERE household_id = ? AND month <= ? ORDER BY month DESC LIMIT 1"
    ),
    setIncome: db.prepare(
      "INSERT INTO incomes (household_id,month,amount) VALUES (?,?,?) ON CONFLICT(household_id,month) DO UPDATE SET amount = excluded.amount"
    ),
  };

  // ---------- tempo real (SSE) ----------
  const streams = new Map(); // householdId -> Set<res>
  function subscribe(householdId, res) {
    let set = streams.get(householdId);
    if (!set) streams.set(householdId, (set = new Set()));
    set.add(res);
    return () => { set.delete(res); if (!set.size) streams.delete(householdId); };
  }
  function broadcast(householdId) {
    const set = streams.get(householdId);
    if (!set) return;
    const msg = `event: change\ndata: ${Date.now()}\n\n`;
    for (const res of set) { try { res.write(msg); } catch { /* ignora */ } }
  }

  // ---------- helpers ----------
  function serializeUser(u) {
    return {
      id: u.id, email: u.email, name: u.name, avatar: u.avatar,
      notifications: !!u.notifications, monthlySummary: !!u.monthly_summary,
    };
  }
  function serializeBill(b) {
    return {
      id: b.id, month: b.month, title: b.title, category: b.category,
      amount: b.amount, dueDay: b.due_day, paid: !!b.paid, ownerId: b.owner_id,
    };
  }
  function householdPayload(u) {
    const hh = q.household.get(u.household_id);
    const members = q.members.all(u.household_id);
    return {
      meId: u.id,
      user: serializeUser(u),
      household: hh ? { id: hh.id, name: hh.name, inviteCode: hh.invite_code } : null,
      members,
    };
  }
  function resolveOwner(owner, u) {
    if (owner === "shared" || owner === null) return null;
    if (!owner || owner === "me") return u.id;
    const m = q.userById.get(owner);
    if (m && m.household_id === u.household_id) return m.id;
    return u.id;
  }

  // ---------- HTTP ----------
  function send(res, status, body, headers) {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, Object.assign(
      { "Content-Type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json; charset=utf-8" },
      headers || {}
    ));
    res.end(payload);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 2e6) req.destroy(); });
      req.on("end", () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error("JSON inválido")); } });
      req.on("error", reject);
    });
  }
  function auth(req, url) {
    let token = null;
    const h = req.headers["authorization"];
    if (h && h.startsWith("Bearer ")) token = h.slice(7);
    if (!token) token = url.searchParams.get("token");
    const userId = token && verifyToken(token, SECRET);
    if (!userId) return null;
    return q.userById.get(userId) || null;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    try {
      // -------- API --------
      if (path.startsWith("/api/")) {
        // públicas
        if (req.method === "POST" && path === "/api/register") return register(req, res);
        if (req.method === "POST" && path === "/api/login") return login(req, res);

        const u = auth(req, url);
        if (!u) return send(res, 401, { error: "Não autenticado" });

        if (req.method === "GET" && path === "/api/me") return send(res, 200, householdPayload(u));
        if (req.method === "POST" && path === "/api/join") return joinHouse(req, res, u);
        if (req.method === "GET" && path === "/api/data") return getData(req, res, u, url);
        if (req.method === "GET" && path === "/api/history") return getHistory(req, res, u);
        if (req.method === "POST" && path === "/api/bills") return createBill(req, res, u);
        if (req.method === "PATCH" && path.startsWith("/api/bills/")) return patchBill(req, res, u, path.slice(11));
        if (req.method === "DELETE" && path.startsWith("/api/bills/")) return deleteBill(req, res, u, path.slice(11));
        if (req.method === "PUT" && path === "/api/income") return putIncome(req, res, u);
        if (req.method === "PATCH" && path === "/api/profile") return patchProfile(req, res, u);
        if (req.method === "GET" && path === "/api/events") return events(req, res, u);
        return send(res, 404, { error: "Rota não encontrada" });
      }

      // -------- estáticos --------
      if (req.method === "GET") {
        let file = path === "/" ? "/index.html" : path;
        const full = join(PUBLIC_DIR, file);
        if (full.startsWith(PUBLIC_DIR) && existsSync(full) && !full.endsWith("/")) {
          const type = full.endsWith(".js") ? "text/javascript" : full.endsWith(".css") ? "text/css" : "text/html; charset=utf-8";
          res.writeHead(200, { "Content-Type": type });
          return res.end(readFileSync(full));
        }
        // SPA fallback
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(readFileSync(join(PUBLIC_DIR, "index.html")));
      }
      return send(res, 404, { error: "Não encontrado" });
    } catch (err) {
      return send(res, 400, { error: err.message || "Erro" });
    }
  });

  // ---------- handlers ----------
  async function register(req, res) {
    const b = await readBody(req);
    const email = String(b.email || "").trim().toLowerCase();
    const password = String(b.password || "");
    const name = String(b.name || "").trim();
    if (!EMAIL_RE.test(email)) return send(res, 400, { error: "E-mail inválido" });
    if (password.length < 6) return send(res, 400, { error: "A senha precisa ter ao menos 6 caracteres" });
    if (q.userByEmail.get(email)) return send(res, 409, { error: "Já existe uma conta com esse e-mail" });
    const now = Date.now();
    const { salt, hash } = hashPassword(password);
    const hhId = uid();
    let code = inviteCode();
    while (q.householdByCode.get(code)) code = inviteCode();
    q.insHousehold.run(hhId, "Casa", code, now);
    const userId = uid();
    q.insUser.run(userId, email, name || email.split("@")[0], salt, hash, "frida", 1, 1, hhId, now);
    const u = q.userById.get(userId);
    return send(res, 201, { token: makeToken(userId, SECRET), ...householdPayload(u) });
  }

  async function login(req, res) {
    const b = await readBody(req);
    const email = String(b.email || "").trim().toLowerCase();
    const u = q.userByEmail.get(email);
    if (!u || !verifyPassword(String(b.password || ""), u.salt, u.hash)) {
      return send(res, 401, { error: "E-mail ou senha incorretos" });
    }
    return send(res, 200, { token: makeToken(u.id, SECRET), ...householdPayload(u) });
  }

  async function joinHouse(req, res, u) {
    const b = await readBody(req);
    const code = String(b.code || "").trim().toUpperCase();
    const hh = q.householdByCode.get(code);
    if (!hh) return send(res, 404, { error: "Código de convite inválido" });
    if (hh.id === u.household_id) return send(res, 200, householdPayload(u));
    const oldHh = u.household_id;
    q.setUserHousehold.run(hh.id, u.id);
    // remove a casa antiga se ficou vazia
    if (oldHh && q.countMembers.get(oldHh).c === 0) q.delHousehold.run(oldHh);
    const fresh = q.userById.get(u.id);
    broadcast(hh.id);
    if (oldHh) broadcast(oldHh);
    return send(res, 200, householdPayload(fresh));
  }

  function getData(req, res, u, url) {
    const month = String(url.searchParams.get("month") || "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return send(res, 400, { error: "Mês inválido" });
    const bills = q.billsOf.all(u.household_id, month).map(serializeBill);
    const incRow = q.income.get(u.household_id, month);
    const carried = incRow ? null : q.incomesUpTo.get(u.household_id, month);
    const income = incRow ? incRow.amount : carried ? carried.amount : 0;
    const hh = q.household.get(u.household_id);
    return send(res, 200, {
      meId: u.id,
      month,
      income,
      incomeSet: !!incRow,
      bills,
      members: q.members.all(u.household_id),
      household: hh ? { id: hh.id, name: hh.name, inviteCode: hh.invite_code } : null,
      user: serializeUser(u),
    });
  }

  async function createBill(req, res, u) {
    const b = await readBody(req);
    const month = String(b.month || "");
    if (!/^\d{4}-\d{2}$/.test(month)) return send(res, 400, { error: "Mês inválido" });
    const title = String(b.title || "").trim().slice(0, 80);
    const amount = Number(b.amount);
    if (!title) return send(res, 400, { error: "Informe o nome da conta" });
    if (!(amount > 0)) return send(res, 400, { error: "Informe um valor maior que zero" });
    const day = Number.isFinite(+b.dueDay) ? Math.trunc(+b.dueDay) : 0;
    const category = String(b.category || "Outros").slice(0, 40);
    const owner = resolveOwner(b.owner, u);
    const now = Date.now();
    const id = uid();
    q.insBill.run(id, u.household_id, month, title, category, Math.round(amount * 100) / 100,
      day >= 1 && day <= 31 ? day : 0, b.paid ? 1 : 0, owner, now, now);
    broadcast(u.household_id);
    return send(res, 201, serializeBill(q.billById.get(id)));
  }

  async function patchBill(req, res, u, id) {
    const b = await readBody(req);
    const bill = q.billById.get(id);
    if (!bill || bill.household_id !== u.household_id) return send(res, 404, { error: "Conta não encontrada" });
    const title = b.title !== undefined ? String(b.title).trim().slice(0, 80) : bill.title;
    const category = b.category !== undefined ? String(b.category).slice(0, 40) : bill.category;
    const amount = b.amount !== undefined ? Math.round(Number(b.amount) * 100) / 100 : bill.amount;
    const day = b.dueDay !== undefined ? (Math.trunc(Number(b.dueDay)) || 0) : bill.due_day;
    const paid = b.paid !== undefined ? (b.paid ? 1 : 0) : bill.paid;
    const owner = b.owner !== undefined ? resolveOwner(b.owner, u) : bill.owner_id;
    db.prepare("UPDATE bills SET title=?,category=?,amount=?,due_day=?,paid=?,owner_id=?,updated_at=? WHERE id=?")
      .run(title, category, amount, day >= 1 && day <= 31 ? day : 0, paid, owner, Date.now(), id);
    broadcast(u.household_id);
    return send(res, 200, serializeBill(q.billById.get(id)));
  }

  function deleteBill(req, res, u, id) {
    q.delBill.run(id, u.household_id);
    broadcast(u.household_id);
    return send(res, 200, { ok: true });
  }

  async function putIncome(req, res, u) {
    const b = await readBody(req);
    const month = String(b.month || "");
    if (!/^\d{4}-\d{2}$/.test(month)) return send(res, 400, { error: "Mês inválido" });
    const amount = Number(b.amount);
    if (!(amount >= 0)) return send(res, 400, { error: "Valor inválido" });
    q.setIncome.run(u.household_id, month, Math.round(amount * 100) / 100);
    broadcast(u.household_id);
    return send(res, 200, { ok: true });
  }

  async function patchProfile(req, res, u) {
    const b = await readBody(req);
    const name = b.name !== undefined ? String(b.name).trim().slice(0, 60) || u.name : u.name;
    const avatar = b.avatar !== undefined ? String(b.avatar).slice(0, 20) : u.avatar;
    const notif = b.notifications !== undefined ? (b.notifications ? 1 : 0) : (u.notifications ? 1 : 0);
    const summ = b.monthlySummary !== undefined ? (b.monthlySummary ? 1 : 0) : (u.monthly_summary ? 1 : 0);
    q.updProfile.run(name, avatar, notif, summ, u.id);
    broadcast(u.household_id);
    return send(res, 200, serializeUser(q.userById.get(u.id)));
  }

  function currentMonth() {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(new Date());
    const o = {};
    p.forEach((x) => (o[x.type] = x.value));
    return `${o.year}-${o.month}`;
  }

  function getHistory(req, res, u) {
    const cur = currentMonth();
    const mb = db.prepare("SELECT DISTINCT month FROM bills WHERE household_id = ?").all(u.household_id).map((r) => r.month);
    const mi = db.prepare("SELECT DISTINCT month FROM incomes WHERE household_id = ?").all(u.household_id).map((r) => r.month);
    const months = [...new Set([...mb, ...mi])].filter((m) => m < cur);
    const out = months.map((m) => {
      const bills = q.billsOf.all(u.household_id, m);
      const incRow = q.income.get(u.household_id, m);
      const carried = incRow ? null : q.incomesUpTo.get(u.household_id, m);
      const income = incRow ? incRow.amount : carried ? carried.amount : 0;
      const paid = bills.filter((b) => b.paid);
      const spent = Math.round(paid.reduce((a, b) => a + b.amount, 0) * 100) / 100;
      return { month: m, income, spent, paidCount: paid.length, billsCount: bills.length };
    });
    out.sort((a, b) => b.month.localeCompare(a.month));
    return send(res, 200, out);
  }

  function events(req, res, u) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    const unsub = subscribe(u.household_id, res);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* */ } }, 25000);
    req.on("close", () => { clearInterval(ping); unsub(); });
  }

  return { server, db };
}
