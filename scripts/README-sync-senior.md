# Sincronização Senior → Supabase (EMPREGADOS)

Traz `hagg.BiEmpregados` (MySQL do Senior, via túnel SSH) para a tabela
`EMPREGADOS` do Supabase.

## Por que não é uma Edge Function

O MySQL do Senior só é alcançável por **túnel SSH**, e Edge Function
(Deno Deploy) não abre socket TCP cru nem SSH. O robô precisa rodar numa
máquina que enxergue os dois lados — o servidor de produção é o lugar
natural.

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
