# Integração Senior → Supabase (EMPREGADOS)

Traz `hagg.BiEmpregados` (MySQL do Senior, via túnel SSH) para a tabela
`EMPREGADOS` do Supabase. Pacote **self-contained**: esta pasta inteira é
a unidade de deploy.

## Onde pode rodar

O SSH do Senior (`72.61.222.128`) está num **IP público** — verificado: a
porta 22 responde direto, sem VPN nem rede local. A porta 3306 do MySQL
está fechada, por isso o túnel.

A única coisa que **não** serve é Edge Function do Supabase: Deno Deploy
não abre socket TCP cru nem SSH.

| Onde | Como repete | Observação |
|---|---|---|
| **Discloud / Railway / Render / Fly** | `SYNC_INTERVALO_MIN` | container sempre no ar; sem cron, o processo é que persiste |
| Qualquer VPS | `SYNC_INTERVALO_MIN` ou cron | idem |
| GitHub Actions | `.github/workflows/sync-senior.yml` | zero infra, mas ~2 min por rodada consome cota em repo privado |

## Deploy no Discloud

1. Zipar **o conteúdo desta pasta** (não a pasta em si): `index.mjs`,
   `package.json`, `discloud.config`. O `node_modules` não vai — o
   Discloud instala pelo `package.json`.
2. Subir o zip pelo site do Discloud ou pelo bot (`.up` com o arquivo).
3. No painel da aplicação, cadastrar as variáveis de ambiente (abaixo),
   incluindo `SYNC_INTERVALO_MIN`.
4. Iniciar. O log deve mostrar `Modo continuo: a cada N min.`

O `discloud.config` já vem pronto (`TYPE=bot`, `MAIN=index.mjs`,
`AUTORESTART=true`). `TYPE=bot` é o certo para processo que fica no ar
sem servir HTTP.

## Variáveis de ambiente

| Variável | O que é |
|---|---|
| `SENIOR_SSH_PW` | senha do usuário **`haggtunel`** (túnel) |
| `SENIOR_DB_PW` | senha do usuário MySQL **`hagg`** (banco) |
| `SUPABASE_URL` | `https://fwmzeaztjxrxxzxzxmgc.supabase.co` |
| `SUPABASE_SERVICE_KEY` | chave `service_role` |
| `SYNC_INTERVALO_MIN` | minutos entre rodadas. **Sem ela, roda uma vez e sai** |

Opcionais: `SENIOR_SSH_HOST`, `SENIOR_SSH_PORT`, `SENIOR_SSH_USER`,
`SENIOR_DB_USER`.

⚠️ A `service_role` ignora RLS. Ela vive só no cofre da hospedagem —
nunca no `.env` do ERP, que **está versionado** e cujos `VITE_*` vão para
o bundle do navegador.

## Testar antes

```bash
npm install
npm run dry-run
```

Lê o Senior, converte tudo e imprime uma amostra **sem escrever nada**.
Confirma túnel, credenciais e conversão de uma vez.

## Rodar de novo é seguro

Medido: a segunda execução seguida dá `inseridos 0, atualizados 0`. Só
insere quem falta e só atualiza o que mudou de valor.

## Chave: (Empresa, Cadastro)

Nunca só o cadastro. Nos 13.214 registros do Senior, `numcad` sozinho tem
apenas 9.810 valores distintos — `numcad = 1` são cinco pessoas
diferentes, uma por empresa. Casar por cadastro fundiria gente.

Ficam de fora as 68 pessoas com `tipcol = 2`: o par (Empresa, Cadastro)
colide entre `tipcol` 1 e 2 e a `EMPREGADOS` não tem coluna de tipo para
desempatar. Para trazê-las é preciso criar essa coluna e passar a chave a
(Empresa, Tipo, Cadastro).

## O que é atualizado em quem já existe

Apenas **situação**, **data de afastamento** e **salário** — o que muda
com o tempo. Nome, CPF, admissão e nascimento não são sobrescritos: a
tela de Colaboradores permite edição, e sobrescrever apagaria correção
manual a cada rodada.

`sitafa` é a SITUAÇÃO (7=Demitido, 1=Trabalhando…), não a data; a data é
`datafa`, com `1900-12-31` significando "sem afastamento". A descrição
vem da `BiSituacoes`.

## O lado do banco

A RPC `rh_sync_senior_empregados(jsonb)` decide insert/update e já está
aplicada (migration `20260906000008`). É `SECURITY DEFINER` com `EXECUTE`
apenas para `service_role` — nenhum usuário logado a alcança.
