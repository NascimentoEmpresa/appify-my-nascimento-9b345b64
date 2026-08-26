# Worker de automação

Processo Node.js **separado** do app (Vite). Roda no PC, num ciclo de 60
segundos, e faz o que não cabe num request/response: falar com WhatsApp,
e-mail, Discord e serviços externos que demoram ou têm ritmo próprio.

Ele usa a `SUPABASE_SERVICE_ROLE_KEY`, que **ignora toda RLS**. Qualquer código
aqui já enxerga tudo — não tente simular sessão de usuário.

## O que roda a cada ciclo

Cada rotina vive num `try/catch` isolado em `src/index.js`: erro numa não
derruba as outras.

| Módulo | O que faz | Ritmo |
|---|---|---|
| `lembreteWhatsapp.js` | avisa participantes de reunião que começa em ~10 min | todo ciclo |
| `emailAta.js` | manda o PDF da ata por e-mail quando a reunião encerra | todo ciclo |
| `chamadosDev.js` | abre worktree e dispara o agente para chamado novo | todo ciclo |
| `caepi.js` | baixa o catálogo de CA do Ministério do Trabalho | semanal |
| `nfe.js` | puxa NF-e emitida contra a empresa na SEFAZ | ver abaixo |

As três primeiras são as originais. As duas últimas nascem **desligadas** e só
ligam quando as variáveis do `.env` são preenchidas.

## Setup

```bash
cd worker
npm install
npm start
```

Na primeira vez aparece um QR code — escaneie com o WhatsApp (Aparelhos
conectados) do número que dispara as mensagens. A sessão fica em
`.wwebjs_auth/` e é reaproveitada depois.

Copie `.env.example` para `.env` e preencha. **O `.env` não é versionado** — é
o lugar certo para senha de certificado e service role key.

> O `npm start` roda com `node --openssl-legacy-provider`. Isso **não é
> opcional**: o certificado A1 da empresa usa RC2-40-CBC, cifra legada que o
> OpenSSL 3 recusa. Sem a flag, o módulo de NF-e falha com
> `ERR_CRYPTO_UNSUPPORTED_OPERATION`, mensagem que não diz nada sobre a causa.

## Catálogo de CA (`caepi.js`)

Espelha a base CAEPI do Ministério do Trabalho em `sst_ca_catalogo`, para
conferir o CA digitado numa entrada de EPI contra a fonte oficial e auditar o
estoque de uma vez.

Liga com `CAEPI_LIGADO=1`.

**Não aponte para `gov.br/.../tgg_export_caepi.zip`.** Aquilo parece a fonte
oficial e está congelado em 19/01/2023 — declara 13.088 CAs "VÁLIDO" e nenhuma
validade passa de 2025. Ligar aquele arquivo marcaria como vencido quase todo
CA legítimo e travaria entrada de EPI no estoque.

A fonte viva é o botão "Base de dados do sistema CAEPI (Download)" em
`caepi.trabalho.gov.br`, que é um postback ASP.NET gerando o arquivo sob
demanda. O módulo carrega a página, devolve os campos de estado e recebe o
arquivo.

O formato **é detectado, não assumido**: o container sai dos bytes mágicos
(gzip, RAR ou zip) e o separador sai da linha de cabeçalho. Em três anos o
Ministério trocou de RAR-com-extensão-`.zip`-separado-por-pipe para `.csv.gz`,
as duas vezes sem aviso.

## NF-e de entrada (`nfe.js`)

Puxa da SEFAZ as notas emitidas **contra** o CNPJ da empresa, pelo serviço
`NFeDistribuicaoDFe`. Liga preenchendo `NFE_CERT_PATH`, `NFE_CERT_PASS` e
`NFE_CNPJ`.

### O NSU, e por que o ritmo importa

A SEFAZ mantém uma caixa postal numerada por CNPJ. Cada documento ganha um
**NSU** — a posição na fila, não o número da nota. A consulta é sempre "me dá o
que veio depois do NSU X"; a resposta traz até 50 documentos e diz até onde
entregou. A próxima consulta parte **daí**.

**Pular para um NSU arbitrário faz a SEFAZ bloquear o CNPJ por 1 hora**
(`cStat 656 — Consumo Indevido`). Não é teoria: aconteceu em 26/08/2026 ao
saltar de 50 para 10890.

| Resposta | Significa | O módulo faz |
|---|---|---|
| `cStat 138` | vieram documentos | continua do `ultNSU`, 1 chamada/min |
| `cStat 137` | fila vazia, alcançou o presente | recua 1 hora |
| `cStat 656` | punição ativa | recua 1 hora e **não** avança o NSU |

O `ultNSU` e o `bloqueado_ate` ficam em `nfe_dist_estado`, **no banco**, não em
`state/*.json`. São dois motivos: perder o arquivo faria a fila recomeçar do
zero (em 26/08/2026 eram 10.914 documentos acumulados, ~219 chamadas para
recuperar), e reiniciar o worker durante a punição não pode fazer ele bater na
porta de novo, porque isso renova o castigo.

A **primeira carga** leva horas. Depois de alcançar o presente, o dia a dia é
1 ou 2 chamadas por dia.

### Resumo x XML completo

Nota emitida contra a empresa chega primeiro como **resumo** (`resNFe`):
emitente, valor e chave, sem os itens. O **XML completo** só é liberado depois
da **Manifestação do Destinatário** — confirmado consultando pela chave de uma
NF real, que voltou `cStat 137` mesmo com a chave válida.

### Certificado

Aponte `NFE_CERT_PATH` para uma **cópia local** do `.pfx`. O arquivo no
servidor da empresa é usado por outras demandas e é somente leitura.

O módulo avisa quando faltarem 30 dias para o vencimento. Sem esse alerta a
integração para em silêncio, e "parou de puxar nota" é sintoma que se investiga
por dias antes de alguém lembrar do certificado.

## Estado em disco

`state/chamados-dev.json` guarda o cursor da automação de chamados.
`state/planos/` guarda os planos gerados. `.wwebjs_auth/` é a sessão do
WhatsApp. Nada disso é versionado.
