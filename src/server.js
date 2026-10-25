import { createServer } from "node:http";
import { UserRepository } from "./userRepository.js";

/**
 * API HTTP minima sobre o UserRepository, usando apenas o Node nativo.
 *
 * Rotas:
 *   POST /register   { email, password, name }  -> cria usuario
 *   POST /login      { email, password }         -> valida login
 *   GET  /users                                  -> lista usuarios (sem hash)
 *
 * Observacao: para producao, coloque isto atras de HTTPS e adicione
 * rate limiting / sessoes. Aqui o foco e a camada de dados de login.
 */
const repo = new UserRepository({
  filePath: process.env.USERS_FILE || "data/users.json",
});

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy(); // protege contra payload gigante
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON invalido"));
      }
    });
    req.on("error", reject);
  });
}

export const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/register") {
      const body = await readJson(req);
      return send(res, 201, repo.register(body));
    }
    if (req.method === "POST" && req.url === "/login") {
      const body = await readJson(req);
      const user = repo.authenticate(body);
      if (!user) return send(res, 401, { error: "Credenciais invalidas" });
      return send(res, 200, user);
    }
    if (req.method === "GET" && req.url === "/users") {
      return send(res, 200, repo.list());
    }
    return send(res, 404, { error: "Nao encontrado" });
  } catch (err) {
    return send(res, 400, { error: err.message });
  }
});

// Sobe o servidor apenas quando executado diretamente (node src/server.js),
// nao quando importado por testes.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Grana user-login API ouvindo em http://localhost:${port}`);
  });
}
