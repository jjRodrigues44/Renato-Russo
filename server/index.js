import { join } from "node:path";
import { createApp } from "./app.js";

const DATA_DIR = process.env.DATA_DIR || "./data";
const dbFile = process.env.DB_FILE || join(DATA_DIR, "grana.db");
const PORT = process.env.PORT || 3000;

const { server } = createApp({ dbFile, dataDir: DATA_DIR });

server.listen(PORT, () => {
  console.log(`Grana (casal) ouvindo em http://localhost:${PORT}  ·  dados em ${dbFile}`);
});
