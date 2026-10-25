import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Persistencia simples em arquivo JSON.
 * Escreve de forma atomica (arquivo temporario + rename) para nao corromper
 * os dados se o processo morrer no meio da escrita.
 */
export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { users: [] };
    this._load();
  }

  _load() {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.users)) this.data = parsed;
      } catch {
        // Arquivo corrompido: comeca do zero em vez de quebrar.
        this.data = { users: [] };
      }
    }
  }

  save() {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(tmp, this.filePath);
  }
}
