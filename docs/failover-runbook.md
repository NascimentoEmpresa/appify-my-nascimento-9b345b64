# Runbook do failover do ERP

Documento de operação. Os outros explicam **como foi construído**; este é o que
se usa **quando algo acontece**.

- [`infra/failover/README.md`](../infra/failover/README.md) — decisões técnicas e as armadilhas encontradas
- [`docs/failover-relatorio-direcao.md`](failover-relatorio-direcao.md) — para quem decide, sem jargão
- [`docs/runner-servidor-empresa.md`](runner-servidor-empresa.md) — instalar o arquivo de longo prazo no servidor

---

## O mapa, numa olhada

```
PRODUÇÃO                          CÓPIA (failover)
┌──────────────────┐              ┌────────────────────────────┐
│ Supabase         │              │ Render — erp-failover      │
│ · Postgres 17    │─── backup ──▶│ · Postgres 17              │
│ · Auth (GoTrue)  │   5× ao dia  │ · PostgREST · GoTrue       │
│ · PostgREST      │              │ · Storage · Edge Functions │
│ · Storage 4,8 GB │              │ · nginx                    │
└──────────────────┘              └────────────────────────────┘
         ▲                                     ▲
         │                                     │ (só quando a produção cai)
         └────────── ERP (Lovable) ────────────┘
                     appify-my-nascimento.lovable.app

ARQUIVO                GitHub Actions — artefatos cifrados (GPG), 90 dias
                       + servidor da empresa S:\  (pendente: senha do admin)
```

**Endereços**

| | |
|---|---|
| ERP | `https://appify-my-nascimento.lovable.app` |
| Réplica | `https://erp-failover.onrender.com` |
| Painel da réplica | Render → `erp-failover` (srv-davb2bvavr4c73b97li0) |
| Repositório | `NascimentoEmpresa/appify-my-nascimento-9b345b64` (**público**) |

---

## O que acontece sozinho, e quando

Horários em **Brasília** (UTC−3).

| Hora | O quê | Onde |
|---|---|---|
| 07, 10, 13, 16, 20h | Backup do banco (~110 MB, cifrado) | GitHub Actions |
| 07, 10, 13, 16, 20h | Backup dos arquivos (incremental) | GitHub Actions |
| 30 min depois de cada | Réplica recarrega do backup | Render |
| 23h | Cópia para o servidor da empresa | *pendente de instalação* |
| Dia 1º do mês | Backup **completo** dos arquivos (re-baseline) | GitHub Actions |

**Retenção dos backups**

| O quê | Guardado por |
|---|---|
| Banco — último do dia (20h) | **90 dias** |
| Banco — 07h | 14 dias |
| Banco — meio do expediente | 3 dias |
| Arquivos (completo e incrementais) | **90 dias** |
| Inventário dos arquivos | 90 dias |

> Por que o completo mensal existe: o backup de arquivos é **incremental**. Só o
> artefato completo tem tudo; os incrementais sozinhos não reconstroem nada.
> Sem gerar um completo novo em dia, quando o atual expira perde-se o histórico.

---

## Verificação de rotina

Rode isto quando quiser confirmar que está tudo de pé. Leva 1 minuto e **não
toca na produção**.

```bash
bash infra/failover/conferir-replica.sh
```

Para incluir os testes de RLS e de escrita, exporte o segredo antes:

```bash
REPLICA_JWT_SECRET='<o JWT_SECRET da réplica>' bash infra/failover/conferir-replica.sh
```

**O que deve aparecer**

```
1. ESTÁ NO AR?        /saude responde 200
2. TEM OS DADOS?      empregados visíveis sem login: 0   (a RLS esconde)
3. A RLS VALE AQUI?   gerente 811 | encarregada 8 | sem login 0
                      token forjado recusado: 401
4. RECUSA ESCRITA?    INSERT 403 · UPDATE 403 · LEITURA 206
```

Se o item 4 devolver **201 ou 204**, a trava de somente leitura caiu —
veja *Problemas conhecidos*.

---

## EMERGÊNCIA — a Supabase caiu

### Primeiro: confirme que caiu mesmo

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://fwmzeaztjxrxxzxzxmgc.supabase.co/rest/v1/ -H "apikey: <anon de produção>"
```

Veja também o painel da Supabase e <https://status.supabase.com>.

### O que o usuário vê, sem você fazer nada

O ERP detecta a queda sozinho (duas falhas seguidas, 3s de intervalo — um erro
isolado não dispara) e mostra:

> **Sistema temporariamente indisponível**
> `[Recarregar]` `[Consultar em modo leitura]`

O segundo botão só aparece **depois** de a réplica confirmar que está no ar.
Quem clicar passa a consultar os dados da cópia, com uma faixa fixa no topo:

> **Modo consulta.** O sistema principal está indisponível. Você está vendo uma
> cópia dos dados e **não é possível salvar alterações**.

**Nada se perde**, porque nada se escreve: a réplica recusa gravação no próprio
banco. Isso cobre a maioria do uso — conferir pedido, escala, contrato.

### Quando a Supabase volta

Sozinho. O ERP testa a cada 15 segundos e recarrega a página quando o sistema
responde. Quem estava em modo consulta clica em **"Tentar o sistema principal"**
ou simplesmente fecha o navegador — a contingência vale só para aquela aba.

---

## Promover a réplica a produção

> **Decisão humana, e só em queda longa.** Enquanto a réplica está em somente
> leitura, ninguém perde nada. Depois de promovida, o que for salvo nela existe
> **só nela** — e a Supabase, ao voltar, não terá esses dados.

**Antes de promover, pergunte:** a Supabase volta nas próximas horas? Se há
dúvida, **espere**. Em somente leitura o risco é zero.

### Como

No painel da Render → `erp-failover` → **Shell**:

```bash
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres PGPASSWORD="$POSTGRES_PASSWORD"
/usr/local/bin/promover.sh status     # o que está valendo agora
/usr/local/bin/promover.sh promover   # libera escrita
```

O `promover` faz duas coisas: cria a marca `PROMOVIDA` (que **cancela a recarga
automática**, senão ela apagaria o trabalho novo) e devolve os privilégios de
escrita.

### Voltar atrás

```bash
/usr/local/bin/promover.sh reverter
```

O `reverter` **lista o que foi escrito** enquanto a réplica esteve promovida,
antes de travar de novo. Esse trabalho **não volta sozinho para a Supabase** —
alguém precisa levar à mão.

---

## Recuperar dados

### Um anexo antigo

1. no ERP, copie o nome do arquivo;
2. baixe o artefato `storage-arquivos-*` mais recente que cubra a data, em
   *Actions → Backup dos arquivos do Storage → (execução) → Artifacts*;
3. no PC que tem a chave GPG:

```bash
unzip storage-arquivos-XXXX.zip
gpg --decrypt storage-arquivos.tar.gpg | tar -xf -
```

Os arquivos saem em `arquivos/<balde>/<caminho>/<nome real>`, com os nomes
preservados.

### O banco inteiro

```bash
# baixe o artefato backup-AAAAMMDD-HHMMSS.dump.gpg e então:
gpg --decrypt backup-....dump.gpg > banco.dump
pg_restore -d "<destino>" --no-owner --no-privileges banco.dump
```

Para restaurar numa réplica nova, use `infra/failover/carregar-replica.sh`, que
já trata as oito armadilhas documentadas no README.

---

## Problemas conhecidos, e o que fazer

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Réplica fora (`/saude` ≠ 200) por minutos | redimensionamento de disco ou deploy | aguarde; ela volta sozinha |
| `Instance failed: /tmp exceeded 2GB` nos eventos | algo gravando em `/tmp` | o `/tmp` da Render é limitado a 2 GB; todo trabalho pesado vai em `/var/lib/postgresql/data/tmp` |
| Escrita na réplica retorna **201/204** | a trava caiu | rode uma recarga: ela reaplica `REVOKE` nas tabelas e nas RPC |
| Botão "Consultar em modo leitura" não aparece | `/contingencia.json` fora, ou CORS | `curl https://erp-failover.onrender.com/contingencia.json` deve devolver JSON com `url` e `anon` |
| `nao consegui decifrar/extrair` na carga de anexos | chave GPG ausente no ambiente | confira `GPG_PRIVATE_KEY_B64` e `GPG_PASSPHRASE` nas variáveis da Render |
| Backup falhou | — | chega DM no Discord do Eduardo; o canal não é usado para isto |
| Mudança no `render.yaml` não aplica | falta aprovar o plano | Blueprint → **Manual sync** → **Approve**. A tela não volta sozinha, e parece que falhou |
| Script novo não entrou na réplica | sync ≠ deploy | o sync aplica disco/variáveis; código exige **Manual Deploy → Deploy latest commit** |

---

## Limites — o que isto NÃO faz

Dito sem rodeio, para ninguém contar com o que não existe:

- **A troca não é automática.** O ERP *oferece* a cópia; quem decide é o
  usuário. Promover a réplica a produção é decisão humana, de propósito —
  troca automática arriscaria duas verdades ao mesmo tempo.
- **Em modo consulta, 249 operações recusam** com "permissão negada". É o
  desenho funcionando: são justamente as que gravam.
- **Dados escritos na réplica promovida não voltam sozinhos** para a Supabase.
- **O atraso da cópia é de até ~3h30** em horário de expediente. Fora dele,
  até a manhã seguinte.
- **O arquivo de longo prazo no servidor da empresa ainda não está instalado**
  (aguarda a senha de admin). Enquanto isso, o histórico vive nos artefatos do
  GitHub, com 90 dias de retenção.

---

## Custo

| | Por mês |
|---|---|
| Réplica (servidor + disco 20 GB) | US$ 30,00 |
| Serviços antigos desligados | − US$ 13,00 |
| **Aumento real** | **US$ 17,00** |

Backups e automações rodam no GitHub, sem custo adicional — o repositório é
público e o armazenamento de artefatos é gratuito.
