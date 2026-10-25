# Grana — Repositório de dados de login dos usuários

Repositório para armazenar com segurança os **dados de login dos usuários** do app Grana.
Guarda as credenciais de cada usuário (e-mail, nome de exibição e senha) e serve de camada
de dados para cadastro e autenticação.

## Princípios de segurança

- A **senha nunca é guardada em texto puro**. Guardamos só o hash `scrypt`, com salt
  aleatório por usuário, embutido no próprio hash.
- A verificação de senha usa comparação em **tempo constante** (evita _timing attacks_).
- Nenhum método do repositório devolve o hash da senha para fora.
- O arquivo com os dados reais (`data/users.json`) fica **fora do controle de versão**.

## Estrutura

```
src/
  password.js         hash e verificação de senha (scrypt)
  store.js            persistência em JSON (escrita atômica)
  userRepository.js   camada de repositório (cadastro, login, perfil)
  server.js           API HTTP mínima (só Node nativo)
test/
  userRepository.test.js
data/                 onde o JSON de usuários é gravado em runtime
```

## Uso como biblioteca

```js
import { UserRepository } from "./src/userRepository.js";

const repo = new UserRepository({ filePath: "data/users.json" });

const user = repo.register({ email: "ana@grana.app", password: "senhaforte1", name: "Ana" });
const logged = repo.authenticate({ email: "ana@grana.app", password: "senhaforte1" });
// user.passwordHash === undefined  (nunca exposto)
```

## API HTTP

```bash
npm start           # sobe em http://localhost:3000
```

| Método | Rota        | Corpo                          | Descrição               |
|--------|-------------|--------------------------------|-------------------------|
| POST   | `/register` | `{ email, password, name }`    | Cadastra um usuário     |
| POST   | `/login`    | `{ email, password }`          | Valida o login          |
| GET    | `/users`    | —                              | Lista usuários (sem hash) |

## Testes

```bash
npm test
```

> Esta é a camada de dados de login. Para produção, coloque a API atrás de HTTPS e
> adicione sessões/tokens e _rate limiting_ na frente dela.
