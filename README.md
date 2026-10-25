# Grana — contas do casal, sincronizadas

App de finanças pessoais para **casais**: cada pessoa tem uma conta própria, vocês
ficam na **mesma casa** por um **código de convite**, e tudo o que um adiciona
**aparece na hora** no aparelho do outro (sincronização em tempo real).

- **Pessoal + pote comum:** cada conta é marcada como *de você*, *do parceiro(a)* ou
  *compartilhada* (pote comum, dividido igualmente).
- **Tempo real:** mudanças de um aparecem no outro via Server-Sent Events.
- **Sem dependências:** backend e frontend usam só o Node nativo (`node:sqlite`,
  `node:http`, `node:crypto`). Nada de `npm install`.

## Como funciona

- **Backend** (`server/`): API HTTP + SSE, banco **SQLite** (arquivo em `DATA_DIR`),
  senhas com hash `scrypt`, sessões por token assinado (HMAC).
- **Frontend** (`public/index.html`): app mobile em uma página, servido pelo backend.
- **Casa (household):** ao se cadastrar, você ganha uma casa e um **código de convite**.
  Seu par se cadastra e usa o código para entrar na sua casa. A partir daí, os dois
  compartilham contas, renda e histórico.

## Rodar localmente

Requer **Node 22.5+**.

```bash
npm start
# abre em http://localhost:3000  (dados em ./data/grana.db)
npm test   # testes do backend
```

## Variáveis de ambiente

| Variável        | Padrão        | Para quê |
|-----------------|---------------|----------|
| `PORT`          | `3000`        | Porta do servidor |
| `DATA_DIR`      | `./data`      | Onde ficam o SQLite e a chave de sessão |
| `GRANA_SECRET`  | (gerado)      | Segredo das sessões. Se não definir, é gerado e salvo em `DATA_DIR/secret.key`. **Defina um valor fixo** em hospedagens sem disco persistente, senão todo mundo é deslogado a cada reinício. |

## Publicar (deploy)

O importante é ter **disco persistente** para `DATA_DIR` (senão os dados somem ao reiniciar).

### Opção A — Fly.io (grátis, com volume)
1. Instale o `flyctl` e faça login: `fly auth login`.
2. Edite `fly.toml` e troque `app` por um nome único seu.
3. Crie o volume: `fly volumes create grana_data --size 1 --region gru`.
4. Defina o segredo: `fly secrets set GRANA_SECRET=$(openssl rand -hex 32)`.
5. `fly deploy`. Pronto — a URL aparece no fim.

### Opção B — Railway (grátis, com volume)
1. Novo projeto → *Deploy from GitHub* apontando para este repositório.
2. Em *Variables*, adicione `DATA_DIR=/data` e `GRANA_SECRET=<um valor aleatório>`.
3. Em *Volumes*, crie um volume montado em `/data`.
4. O start é `npm start` (ou `node --no-warnings server/index.js`).

### Opção C — Render
O arquivo `render.yaml` já configura um disco em `/var/data`. Discos no Render exigem
plano pago; no plano grátis os dados não persistem (use Fly/Railway para grátis com
persistência).

### Opção D — Docker (qualquer lugar)
```bash
docker build -t grana .
docker run -p 3000:3000 -v grana_data:/data -e GRANA_SECRET=$(openssl rand -hex 32) grana
```

## Usar a dois

1. Você se cadastra no app.
2. Em **Perfil → Casal**, copie o **código de convite** e mande para seu par.
3. Seu par se cadastra, vai em **Perfil → Casal → “Usar um código de convite”** e digita o código.
4. Pronto: os dois veem e editam as mesmas contas, em tempo real.

## API (resumo)

Autenticação por `Authorization: Bearer <token>` (o `/api/events` aceita `?token=`).

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/register` | cria conta + casa (retorna token e código) |
| POST | `/api/login` | autentica |
| GET  | `/api/me` | conta + casa + membros |
| POST | `/api/join` | entra numa casa pelo código |
| GET  | `/api/data?month=AAAA-MM` | renda + contas do mês |
| POST | `/api/bills` | cria conta |
| PATCH| `/api/bills/:id` | edita / marca paga |
| DELETE| `/api/bills/:id` | exclui |
| PUT  | `/api/income` | define a renda do mês |
| GET  | `/api/history` | resumo dos meses anteriores |
| PATCH| `/api/profile` | nome, avatar, preferências |
| GET  | `/api/events` | stream SSE (tempo real) |

Os dados de cada casa são privados: só quem está nela (via convite) enxerga.
