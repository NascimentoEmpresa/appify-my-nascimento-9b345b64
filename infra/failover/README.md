# Failover do ERP — a réplica e o caminho até a troca automática

> **O problema que isto resolve:** backup protege contra *perder dados*.
> Não protege contra o *fornecedor cair*. Se a Supabase ficar fora do ar, o
> ERP fica fora junto — e nenhuma das três cópias de backup coloca uma tela
> no ar. Esta pasta ataca exatamente essa lacuna.

---

## Por que Postgres, e não MySQL, MariaDB ou SQLite

Foi a primeira ideia considerada, e ela não funciona. Não por preferência —
por incompatibilidade estrutural:

| Peça | O que o ERP usa hoje | MySQL / MariaDB | SQLite |
|---|---|---|---|
| Controle de acesso | **1.312 políticas de RLS** no banco | ❌ RLS não existe | ❌ não existe |
| API | PostgREST (gera a API do schema) | ❌ exige Postgres | ❌ |
| Login | GoTrue sobre Postgres | ❌ | ❌ |
| Concorrência | centenas de conexões | ✅ | ❌ arquivo local |

O ponto decisivo é a **RLS**. O acesso do ERP é decidido linha a linha, dentro
do banco, por 1.312 políticas. Em MySQL esse conceito **não existe**: todas
teriam que ser reescritas dentro da aplicação — que hoje nem tem servidor
próprio (`CLAUDE.md`: *"não existe servidor Node de aplicação"*).

Trocar o motor não seria failover. Seria **reescrever o ERP**.

A réplica precisa ser **Postgres com a stack Supabase**. Aí sim tudo se
preserva: RLS, funções, senhas, tokens e a API.

---

## O que já estava pronto sem a gente perceber

O trabalho de backup dos últimos dias **já resolveu a parte mais difícil**:

- O dump contém **o schema inteiro** — as 1.312 policies, as funções, os enums.
- Já foi **provado** que ele restaura num Postgres puro.
- Já sabemos as **duas armadilhas** que fazem a restauração parecer certa e
  vir insegura (papéis e GRANTs) — e o script aqui já as corrige.

Ou seja: "replicar as regras de RLS em outro ambiente" **já está resolvido e
testado**. O que falta é a stack em volta e o mecanismo de troca.

---

## O que esta pasta entrega

```
docker-compose.yml     a stack: Postgres + GoTrue + PostgREST + Storage + Kong
kong.yml               o gateway, publicando /auth/v1 /rest/v1 /storage/v1
gerar-chaves.mjs       gera JWT_SECRET + chaves anon e service_role coerentes
preparar-replica.ps1   carrega o backup, cria os papéis, conserta os GRANTs
validar-replica.sql    prova que a réplica tem dados E segurança
```

### Passo a passo

**1. Instale o Rancher Desktop** (gratuito, Apache 2.0).
O Docker Desktop **não é gratuito** para empresa com mais de 250 funcionários.

**2. Gere as chaves**
```powershell
cd infra\failover
node gerar-chaves.mjs
```

**3. Suba a stack**
```powershell
docker compose up -d
```

**4. Carregue o backup**
```powershell
.\preparar-replica.ps1 -Backup "S:\...\BACKUP-BANCO\backup-AAAAMMDD.dump.gpg"
```

**5. Valide**
```powershell
psql -h localhost -p 55432 -U postgres -d postgres -f validar-replica.sql
```

**6. Aponte o ERP para a réplica** — sem tocar no `.env` de produção:

Crie `.env.replica` na raiz do projeto com a `VITE_SUPABASE_URL=http://localhost:8000`
e a `ANON_KEY` que o passo 2 imprimiu. Depois:

```powershell
npm run dev -- --mode replica
```

Abra `http://localhost:8080` e teste: **login, uma tela com RLS, um anexo.**
É aqui que se descobre se a réplica serve de verdade.

### Testar de fora (Vercel)

O navegador precisa **alcançar** a réplica. Uma página HTTPS na Vercel não
consegue chamar `http://localhost` — o navegador bloqueia por conteúdo misto.

Para esse teste, exponha a réplica com um túnel:

```powershell
cloudflared tunnel --url http://localhost:8000
```

Ele devolve uma URL `https://...trycloudflare.com`. Use **essa** como
`VITE_SUPABASE_URL` na Vercel, e ajuste `URL_EXTERNA` e `URL_SITE` no `.env`
antes de subir a stack (o GoTrue valida a origem dos redirecionamentos).

---

## O que isto É e o que ainda NÃO é

| | Status |
|---|---|
| Réplica com dados e RLS idênticos | ✅ esta pasta |
| Aplicação funcionando contra ela | 🔍 é o que o passo 6 prova |
| Dados atualizados em tempo real | ❌ **falta** |
| Detecção automática de queda | ❌ **falta** |
| Troca automática de tráfego | ❌ **falta** |
| Trava contra split-brain | ❌ **falta** |

**Isto é um *standby frio*: uma réplica carregada a partir do backup.** Ela
prova que o ERP roda fora da Supabase — que é a pergunta que precisa ser
respondida antes de gastar qualquer dinheiro.

---

## A escada até o failover automático

**Degrau 1 — provar que roda fora da Supabase** ← *esta pasta*
Custo: R$ 0. Se falhar aqui, todo o resto muda de rumo.

**Degrau 2 — standby morno (promoção manual)**
Replicação lógica contínua da Supabase para a réplica, rodando num servidor
sempre ligado. Se a Supabase cair, **um humano promove** em 30–60 min.
Custo: ~US$ 120–300/mês.
*Atenção:* a Supabase recomenda instância **XL** para replicação lógica, e a
produção está em **Small**. Ligar isso exige janela e medição.

**Degrau 3 — failover automático**
Degrau 2 + endereço estável próprio (`api.empresa.com.br`) + health check +
promoção automática + *fencing* contra split-brain.
Custo: ~US$ 400–900/mês.

> **O risco do degrau 3 sem o fencing:** a Supabase volta enquanto a réplica
> já recebe escrita. Dois bancos divergem e ninguém percebe. Isso é **pior**
> que ficar fora do ar — é perder dados achando que está tudo bem.

---

## A pergunta que decide o investimento

**Quanto a Supabase realmente cai?**

Se o histórico for de 99,9%, são ~43 minutos por mês. Vale US$ 300/mês para
evitar 43 minutos? Talvez sim, talvez não — mas é decisão de negócio, e deve
ser tomada com o número na mesa, não com a sensação de risco.

O degrau 1 custa zero e responde a pergunta técnica.
Os degraus 2 e 3 custam dinheiro e respondem a uma pergunta de negócio.

---

## Segurança

O `.env` desta pasta é **git-ignorado**. Ele contém a `SERVICE_ROLE_KEY`, que
**ignora toda a RLS** — trate como senha de root. Nunca vai para o frontend,
nunca é commitada.
