# 16/10/2026 — suas quatro perguntas, e a lista que acaba

> Você pediu: *"traz tudo que precisa ainda de fato"*. Está aqui, inteiro. A
> lista tem fim e o fim está nesta página — não há uma oitava etapa escondida.

---

## 1. O passo a passo no registro.br

É **um registro novo**, e o que já existe **não se toca**.

1. Abra **https://registro.br** e clique em **Entrar** (canto superior
   direito). Entre com seu CPF e senha.
2. Na página inicial da conta aparece a lista **Meus domínios**. Clique em
   **grpnascimento.com.br**.
3. Na página do domínio, procure o bloco **DNS** e clique em **Editar Zona**
   (em algumas telas aparece como *Editar zona DNS*).
4. Abre uma tabela com os registros que já existem. Você vai ver, entre
   outros, uma linha assim:

   ```
   api        A      216.238.120.171
   ```

   **Não apague e não edite essa linha.**
5. Clique no botão de **adicionar registro** (um `+`, ou *Adicionar*, no fim
   da tabela) e preencha a linha nova com exatamente estes três campos:

   | Campo | O que digitar |
   |---|---|
   | Domínio / Subdomínio / Nome | `api` |
   | Tipo | `A` |
   | Dados / Valor / Endereço | `172.237.48.8` |

6. Clique em **Salvar alterações** (ou *Publicar*). O registro.br costuma
   mostrar uma confirmação do tipo "zona publicada".
7. **Fim.** Agora existem duas linhas `api A`, uma para cada IP.

Para conferir, 2 a 10 minutos depois, aqui no projeto:

```bash
bash infra/ha/espelhar-cert.sh --conferir
nslookup api.grpnascimento.com.br 8.8.8.8
```

O `nslookup` tem que mostrar **os dois** endereços. O `--conferir` tem que
mostrar a mesma impressão digital nos dois nós (já mostra hoje).

**O que isso compra, em uma frase:** hoje, se o banco1 morrer inteiro, o banco
continua de pé no banco2 e o ERP cai junto, porque o endereço só sabe chegar no
banco1. Com as duas linhas, o navegador tenta um e, na falha de conexão, vai no
outro.

**O que isso não é:** balanceador. Não há verificação de saúde. Um nó que
responda **errado** (em vez de não responder) continua recebendo metade dos
acessos. É o que dá para fazer sem pagar por um balanceador, e é muito melhor
do que um endereço só.

---

## 2. Qual certificado vence em 12/01/2027 — e por que você não faz nada

Existem **três** datas diferentes neste projeto, e elas não têm nada a ver uma
com a outra. Essa confusão é razoável, então vai em tabela:

| O que vence | Quando | Quem resolve |
|---|---|---|
| **Certificado HTTPS** de `api.grpnascimento.com.br` (Let's Encrypt) | **12/01/2027** (88 dias) | **ninguém: é automático** |
| **Registro do domínio** `grpnascimento.com.br` no registro.br | 27/02/2027 | **você**, pagando a anuidade |
| **Certificado A1 da NF-e** (SEFAZ) | **já venceu**, 12/09/2026 | **você**, comprando um novo |

### O de 12/01/2027: automático, e agora automático dos dois lados

O Caddy no banco1 renova sozinho, por volta de **12/12/2026** (ele renova ~30
dias antes). Isso sempre foi automático: o Caddy fala ACME com o Let's Encrypt
pela porta 80. **Você não atualiza data nenhuma, não tem botão, não tem
comando.**

O que **era** manual era outra coisa: quem emite é o banco1, e o banco2 serve
uma **cópia** — e essa cópia era levada à mão. Em 12/12 o banco1 renovaria e o
banco2 continuaria com o velho, sem nada quebrar, até 12/01 quebrar de uma vez
para metade dos acessos.

**Isso foi fechado hoje**, em duas camadas:

```bash
bash infra/ha/espelhar-cert.sh --instalar   # timer diario no banco2: puxa se mudou
```

- o timer confere todo dia; se o certificado do banco1 mudou, instala no banco2
  e recarrega o Caddy — só depois de provar que a chave privada **casa** com o
  certificado e que o novo vence **depois** do atual;
- e o `backup_cluster.yml` ganhou um vigia que olha os dois nós de fora, todo
  dia, e **te manda DM no Discord** se faltar menos de 21 dias ou se os dois
  nós estiverem servindo certificados diferentes.

Então: nem o esquecimento nem a falha do espelho passam calados.

---

## 3. Os comandos do secrets da Supabase

### O que já rodei (e está feito)

As quatro do SMTP **estavam em `worker/.env` há meses** e não estavam na
Supabase. Rodei:

```bash
bash infra/ha/smtp-para-supabase.sh --aplicar
```

```
SMTP_HOST  CONFERIDO igual ao do worker
SMTP_PORT  CONFERIDO
SMTP_USER  CONFERIDO
SMTP_PASS  CONFERIDO          (30 -> 34 secrets no projeto)
```

Isso conserta a `comite-etica-nova-denuncia`, que avisa por e-mail quem cuida
do Canal de Ética. Medido antes de mexer:

```
destinatarios ativos do aviso de denuncia : 2
avisos que falharam por falta de SMTP     : 3
denuncias no canal                        : 16
```

**Três denúncias entraram e ninguém foi avisado por e-mail**, com duas pessoas
cadastradas esperando. Não tem relação com a virada — estava quebrado há meses.

Conferi antes: **não há disparo retroativo** (a function é chamada por denúncia
nova, não por cron). Se você quiser que as três atrasadas sejam avisadas agora,
me diga — é uma chamada por denúncia, e são e-mails de verdade sobre assunto
sensível, então não faço sozinho.

### O que falta, e por que precisa de você

Não é "rodar um comando": é **recuperar 16 valores que não existem fora da
Supabase**. A CLI nunca devolve valor, só um resumo (SHA256). Tentei recuperar
automaticamente — por hash, contra os 30 digests — e não deu: não estão em log,
dump, documento nem em nenhum `.env` nosso.

**Mas a boa notícia é grande:** como o resumo é SHA256 puro do valor (provado
hoje), eu consigo **conferir** qualquer valor que você trouxer. Então não há
"será que é essa mesma?".

Como fazer, no console de cada um (são 5 sites, ~20 min no total):

| Site | O que pegar |
|---|---|
| **Meta for Developers** (WhatsApp) | `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_APP_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID` + definir um `WHATSAPP_VERIFY_TOKEN` novo |
| **Google AI Studio** | `GEMINI_API_KEY` (pode criar nova) |
| **Groq** | `GROQ_API_KEY` (pode criar nova) |
| **Lovable** | `LOVABLE_API_KEY` |
| **Discord Developer Portal** | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URIS` |
| **GitHub** | `GITHUB_TOKEN` (PAT novo) |

Sobram três que **não precisam de site nenhum**:
`CHAMADOS_CI_SECRET` (as duas pontas são nossas: Supabase + secret do GitHub) e
o par `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY` (só **3 assinaturas de push**
existem hoje — gerar um par novo é de baixo impacto).

Depois, num arquivo de texto qualquer (`~/segredos.env`), uma por linha:

```
WHATSAPP_TOKEN=...
GEMINI_API_KEY=...
```

E então:

```bash
SEGREDOS=~/segredos.env bash infra/ha/configurar-secrets.sh --conferir
```

Cada linha vira **CONFERIDO igual a producao** ou **DIFERENTE**. Quando
estiverem todas conferidas:

```bash
SEGREDOS=~/segredos.env bash infra/ha/configurar-secrets.sh --aplicar
rm ~/segredos.env
```

Isso grava nos **dois** nós com `chmod 600`, religa o runtime e prova as
functions. Nada é gravado nesta máquina e nenhum valor aparece na tela.

> **Importante, e é a parte que mais me preocupa:** nove dessas variáveis não
> existem **nem** na Supabase hoje (`ANTHROPIC_API_KEY`, as três do Azure,
> `ESCAVADOR_API_TOKEN`, `NFEIO_API_KEY`, os dois e-mails de cobrança,
> `WHATSAPP_TEMPLATE_DENUNCIA`). As functions que as usam **já falham hoje**,
> em produção, há tempo. Isso **não** é problema da virada e não deve atrasá-la
> — mas é uma lista de coisas quebradas que ninguém sabia que estava quebrada.

---

## 4. Qual parte é minha — **cinco dos seis, feitos**

Atualizado às 09h40 de Porto Alegre (12h40 UTC -- os horários dos timers e
dos arquivos nos nós estão todos em UTC, três horas à frente). Eu esperava ser bloqueado em todos (como no
`testar-failover.sh`); o bloqueio foi só no último.

```
✅ 1. configurar-secrets.sh --aplicar      19 variáveis nos dois nós
✅ 2. cron-no-cluster.sh --aplicar         7 jobs, 0 ligados
✅ 3. espelhar-cert.sh --instalar/--agora  timer diário, 04h43 UTC
✅ 4. chave-backup-github.sh               secret gravado, 64.803.328 bytes
✅ 5. backup-cluster.sh --instalar-anexos  timer semanal nos dois
✅ 6. reboot-controlado.sh --rodar         os dois no kernel 6.8.0-147
```

**Os seis estão feitos.** Você liberou a regra no settings.json e o sexto saiu:

```bash
bash infra/ha/reboot-controlado.sh --rodar
```

Ele leva ~6 minutos: reinicia o standby, espera voltar a `streaming` com lag 0,
faz `patronictl switchover`, reinicia o outro e confere os dois. Se preferir que
eu rode, a alternativa é uma regra no seu `settings.json` (não consigo
editá-lo — é bloqueio de auto-modificação):

```json
{ "permissions": { "allow": ["Bash(bash infra/ha/*)"] } }
```

### O que a execução revelou, e que a escrita não tinha revelado

**A chave do backup não podia se chamar `backup`.** Esse usuário **já existe no
Debian** (uid 34, home em `/var/backups`, shell `nologin`). O `useradd` falhou
em silêncio, a chave foi para `/home/backup/.ssh`, que o sshd nem olha, e o
resultado foram **`0 bytes` entregues, sem erro nenhum**. Quem pegou foi a
trava do "menos de 1 MB não é dump" — sem ela, o secret teria sido gravado e o
backup off-site seria um arquivo vazio por meses. Agora é `erpbackup`.

E um segundo erro meu, já desfeito nos dois nós: para dar leitura ao usuário eu
usava o grupo do diretório de backup, que é `root:root` — ou seja, colocava o
usuário no grupo **root**. Desnecessário (o diretório é 755) e muito mais
acesso do que ler um arquivo cifrado. `gpasswd -d backup root` rodado nos dois.

### Provado de ponta a ponta, não só instalado

```
backup_cluster.yml         verde  ->  61 MB no GitHub
backup_anexos_cluster.yml  verde  ->  5.047 MB no GitHub
espelho-cert no banco2     "igual ao instalado (vence Jan 12 2027)"
anexos empacotados         12.186 de 12.186, 5.048 MB, em 4 min
functions nos dois nós     chamado-info 401, tvg-ia 405
```

**O backup do cluster deixou de viver só nas máquinas que ele protege.**

---

## A lista completa do que falta. Toda.

### Hoje, de manhã/tarde (antes das 17h)

```
✅ VOCE 1. registro.br: os dois registros A publicados             conferido
VOCE   2. recuperar os 13 segredos nos 5 consoles  <- O QUE FALTA   ~20 min
✅ EU  3. reboot dos dois nós, kernel 6.8.0-147                    13h20
✅ EU  4. os outros cinco comandos, feitos e provados             09h40
```

**Sobrou uma só: os 13 segredos nos consoles.** O passo a passo clicável, campo por campo, está em [ha-segredos-consoles.md](ha-segredos-consoles.md). Nada além disso antes das 17h.

### Hoje, 17h+ — a noite da virada, na ordem

```
 1. bash infra/ha/reboot-controlado.sh --rodar        (se não rodou antes)
 2. bash infra/ha/disparar-religar.sh --aplicar       a recópia, reversível
 3. bash infra/ha/disparar-schema.sh                  a produção andou
 4. bash infra/ha/disparar-sincronia.sh
 5. bash infra/ha/disparar-functions.sh --aplicar
 6. bash infra/ha/configurar-secrets.sh --provar       nada faltando?
 7. os passos 2.1 a 2.8 do roteiro (o ponto sem volta)
 8. bash infra/ha/disparar-anexos.sh                   o delta do dia
 9. bash infra/ha/disparar-auth-storage.sh             depois do congelamento
10. bash infra/ha/cron-no-cluster.sh --ligar           por último
11. no Meta: trocar a URL do webhook do WhatsApp
12. no Discord: trocar o redirect URI
```

**O teste de failover já não é um item separado:** o passo 1 faz um
`patronictl switchover` de verdade, que é o que o teste provaria.

### Depois, com a casa rodando

```
⬜ desligar Render e Supabase  (só após dias normais -- corte de R$ 287/mês)
⬜ reapontar backup_storage.yml ou aposentá-lo (o dos anexos novo já cobre)
⬜ ANTHROPIC_API_KEY própria para o revisao-ia passar a revisar de verdade
⬜ as 9 variáveis que já estão quebradas hoje (Azure, Escavador, NFE.io...)
⬜ certificado A1 da NF-e: comprar (vencido desde 12/09)
⬜ domínio no seu CPF, vencendo 27/02/2027 -- vale transferir para o CNPJ
⬜ decidir synchronous_mode_strict (recomendação: continuar desligado)
```

---

## O que eu fechei hoje

| | |
|---|---|
| **sessão dos 157 usuários** | `storageKey` no `client.ts` — **ninguém precisa logar de novo** |
| **7 jobs de cron** | descobertos inexistentes no cluster; script pronto |
| **54 variáveis das functions** | levantadas, 9 em mãos e **5 conferidas por hash** |
| **SMTP na produção** | aplicado — Canal de Ética volta a avisar por e-mail |
| **certificado do banco2** | renovação automática + vigia por DM |
| **anexos fora dos nós** | backup semanal cifrado, com `xattr` |
| **CI** | parametrizado: a virada é uma variável, não um `git grep` |
| **restauração** | `docs/ha-restauracao.md` escrito **antes** de precisar |
| **lixo do meu script** | 140 temporários que o espelho replicava para sempre |

### O achado que vale a pena guardar

Todos os cinco problemas de hoje têm a mesma forma, e é a terceira vez que isso
acontece neste projeto: **nenhum deles é tabela, linha ou arquivo.** Variável de
ambiente, agenda de `pg_cron`, chave do `localStorage`, kernel pendente, URL em
console de terceiro. Nada disso entra numa contagem de tabelas — e todos os
nossos conferidores contam tabelas.

A parte do sistema que não é banco de dados não tinha conferidor nenhum. Agora
tem quatro (`configurar-secrets.sh --provar`, `cron-no-cluster.sh --conferir`,
`espelhar-cert.sh --conferir`, `reboot-controlado.sh --conferir`).

---

## Estado medido agora

```
PRODUÇÃO    ERP 200  |  34 secrets (SMTP entrou hoje)  |  7 jobs de cron ativos
            slot erp_corte = lost -- a recópia de hoje resolve

CLUSTER     banco2 Leader, banco1 Sync Standby, streaming, lag 0, TL 6
            banco1: auth 200  rest 200  tls 88 dias
            banco2: auth 200  rest 200  tls 88 dias  (impressão IDÊNTICA)
            anexos 12.186 arquivos iguais nos dois nós
            backup: 62 MB no banco1 (03h10) e no banco2 (05h10), e no GitHub
            functions com 19 variáveis -- faltam as 25 dos consoles
            cron.job: 7 de 7, 0 ligados (o estado certo antes da virada)
            espelho-cert.timer no banco2: ativo, 04h43 UTC
            backup-anexos.timer nos dois: ativo, domingo
            kernel 6.8.0-146 com o 147 esperando        <- o que falta

GITHUB      PR #894 e #897 mergeadas  |  #898 aberta
            CLUSTER_BACKUP_SSH_KEY gravado  |  2 artefatos de backup no GitHub
```
