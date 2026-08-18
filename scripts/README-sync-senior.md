# Sincronização Senior → Supabase (EMPREGADOS)

Traz `hagg.BiEmpregados` (MySQL do Senior, via túnel SSH) para a tabela
`EMPREGADOS` do Supabase.

## Onde pode rodar

O SSH do Senior (72.61.222.128) está num **IP público** — verificado: o
servidor responde direto, sem VPN nem rede local. Então o robô roda em
qualquer lugar com saída para a internet.

O que **não** serve é Edge Function do Supabase: Deno Deploy não abre
socket TCP cru nem SSH. Essa é a única restrição real.

| Opção | Como agenda | Observação |
|---|---|---|
| **GitHub Actions** | `.github/workflows/sync-senior.yml` | zero infra; ~2 min por rodada — de hora em hora cabe na cota grátis, a cada 15 min não |
| **Discloud / Railway / Render** | `SYNC_INTERVALO_MIN=15` | container sempre no ar; melhor para sincronizar de poucos em poucos minutos |
| **Máquina própria** | Tarefas do Windows / cron | só se já houver um servidor ligado sempre |

### Modo contínuo (container)

Com `SYNC_INTERVALO_MIN` definido, o script não encerra: roda, espera o
intervalo e repete. Falha numa rodada não derruba o processo — a próxima
tenta de novo. É o modo para Discloud e afins, que não têm cron.

```bash
SYNC_INTERVALO_MIN=15 node sync-senior-empregados.mjs
```

## Chave: (Empresa, Cadastro)

Nunca só o cadastro. Medido nos 13.214 registros do Senior, `numcad`
sozinho tem apenas 9.810 valores distintos: `numcad = 1` são cinco
pessoas diferentes, uma por empresa. Casar por cadastro fundiria gente.

Ficam de fora as 68 pessoas com `tipcol = 2`: o par (Empresa, Cadastro)
colide entre `tipcol` 1 e 2 e a `EMPREGADOS` não tem coluna de tipo para
desempatar. Para trazê-las é preciso criar essa coluna e passar a chave a
(Empresa, Tipo, Cadastro).

## O que é atualizado em quem já existe

Apenas **situação**, **data de afastamento** e **salário** — o que muda
com o tempo. Nome, CPF, admissão e nascimento não são sobrescritos: a
tela de Colaboradores permite edição, e sobrescrever apagaria correção
manual a cada rodada.

## Instalação

Na máquina que vai rodar o robô (precisa de Node 18+):

```bash
mkdir sync-senior && cd sync-senior
npm init -y
npm install ssh2 mysql2
# copiar sync-senior-empregados.mjs para esta pasta
```

As dependências **não** estão no `package.json` do ERP de propósito: são
de servidor e o ERP é front-end.

## Variáveis de ambiente

| Variável | O que é |
|---|---|
| `SENIOR_SSH_PW` | senha do usuário `haggtunel` |
| `SENIOR_DB_PW` | senha do usuário MySQL `hagg` |
| `SUPABASE_URL` | `https://fwmzeaztjxrxxzxzxmgc.supabase.co` |
| `SUPABASE_SERVICE_KEY` | chave `service_role` (`npx supabase projects api-keys --project-ref fwmzeaztjxrxxzxzxmgc`) |

Opcionais: `SENIOR_SSH_HOST`, `SENIOR_SSH_PORT`, `SENIOR_SSH_USER`,
`SENIOR_DB_USER`.

⚠️ A `service_role` ignora RLS. Ela só pode existir nessa máquina, em
variável de ambiente — nunca no repositório nem no front-end.

## Testar antes de gravar

```bash
node sync-senior-empregados.mjs --dry-run
```

Lê o Senior, converte tudo e imprime uma amostra **sem escrever nada** no
Supabase. É o teste que confirma túnel, credenciais e conversão.

## Agendar

**Windows (Agendador de Tarefas):** ação `node`, argumento o caminho do
`.mjs`, "Iniciar em" a pasta do script, repetir a cada 15 minutos.

**Linux (cron):**

```
*/15 * * * * cd /opt/sync-senior && /usr/bin/node sync-senior-empregados.mjs >> sync.log 2>&1
```

Rodar de novo é seguro: o robô só insere quem falta e só atualiza o que
mudou de valor.

## O lado do banco

A RPC `rh_sync_senior_empregados(jsonb)` decide insert/update e já está
aplicada (migration `20260906000008`). Ela é `SECURITY DEFINER` e tem
`EXECUTE` apenas para `service_role` — nenhum usuário logado a alcança.
