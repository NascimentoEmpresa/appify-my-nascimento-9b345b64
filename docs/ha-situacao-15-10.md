# Onde estamos — 15/10/2026, 17h

Reescrito no fim da tarde de 15/10. As cinco pendências do levantamento da
manhã estão **fechadas**. O que sobra para amanhã são as duas etapas da noite.

---

## O que foi feito hoje, com o número ao lado

| | Antes | Agora |
|---|---|---|
| **anexos** | 368 a menos no cluster | **12.041 de 12.041**, 5.806 MB, 0 sem xattr |
| **auth/storage** | carga de 13/10 | **157 = 157** logins, **12.053 = 12.053** objetos |
| **Edge Functions** | 4 na versão de agosto, 1 faltando | **64 de 64**, idênticas ao repo, nos **dois** nós |
| **backup do cluster** | não existia | timer diário nos **dois** nós, cifrado |
| **endereço HTTP** | só banco1 | **banco2 servindo**, falta 1 registro de DNS |

Mais o que você fez: **PR #881 mergeada** e **worker religado** (batimento de
16h18, fila caiu de 16 para 11 — ele está processando).

### O achado que valeu o dia

Eu tinha te dito "falta a `tvg-ia`, 63 de 64". Faltava, mas o problema era
outro:

| Function no cluster | Versão que estava lá |
|---|---|
| `whatsapp-enviar` | **05/08** |
| `whatsapp-template-enviar` | 26/08 |
| `whatsapp-webhook` | 18/08 |
| `dev-github-sync` | 09/10 |

**Na virada, o envio de WhatsApp teria subido com o código de dois meses
atrás.** E nenhum número reclamaria: não havia conferidor nenhum olhando para
as Edge Functions. Agora há (`disparar-functions.sh`), e as 64 estão idênticas
ao repositório nos dois nós — provado pelo caminho do navegador, com a
`tvg-ia` respondendo 405 (quer POST) em vez de 404.

---

## 🟡 Falta de você, hoje ou amanhã de manhã (2 minutos cada)

### 1. O segundo registro A, no registro.br

```
acrescentar   A   api   172.237.48.8      (mantendo o 216.238.120.171)
```

O banco2 **já está servindo** o endereço com certificado válido — provei por
`--resolve`, que finge que o DNS já aponta para lá e deixa o resto real:

```
/auth/v1/health              -> 200
/rest/v1/CHAMADO_SISTEMA?... -> 200
tls_verify_result = 0  (o navegador aceitaria), 93 ms
fingerprint SHA256 IDENTICA a do banco1
```

Sem isso, o banco troca de líder sozinho mas o **endereço** não: o nó que
morrer inteiro leva o ERP junto, com o banco intacto do outro lado.

### 2. O secret do backup, no GitHub

As linhas estão na seção 1.13 do roteiro. Sem ele, o backup existe nos dois
nós mas não sai de lá — e dois servidores nossos não são "fora".

---

## 🔵 Amanhã depois das 17h, as duas etapas

| | O que é | Reversível? |
|---|---|---|
| **a recópia** (`disparar-religar.sh --aplicar`) | restaura a replicação que morreu | sim, totalmente |
| **a noite do Marco B** (2.1 a 2.8) | a virada | ponto sem volta a partir do 1º salvamento |

**E uma coisa antes das duas:** o **teste de failover** ainda não rodou (o
cluster está na timeline 6, o teste a levaria para 8). Ele tem que vir
**antes** da recópia — trocar o líder no meio da cópia derruba a cópia.

```bash
bash infra/ha/testar-failover.sh          # 3 min, antes de tudo
bash infra/ha/disparar-religar.sh --aplicar
bash infra/ha/disparar-schema.sh          # a produção andou desde ontem
bash infra/ha/disparar-sincronia.sh
bash infra/ha/disparar-anexos.sh          # o delta do dia
bash infra/ha/disparar-auth-storage.sh    # depois do congelamento
```

---

## "Depois dessas 7, acabou a infraestrutura?"

**Quase — e a diferença importa.** Depois das sete, o ERP roda no cluster e os
usuários estão lá dentro. Mas sobram seis coisas, e três delas têm prazo:

| | O que | Quando |
|---|---|---|
| 1 | `backup_storage.yml` reapontado para o cluster | **os 5,8 GB de anexos ficam sem backup fora até isso** |
| 2 | desligar Render e Supabase | só depois de alguns dias de operação normal — é o corte de R$ 287/mês |
| 3 | renovação do certificado no banco2 | manual hoje; **vence 12/01/2027** |
| 4 | `synchronous_mode_strict` | decidir com a casa rodando (recomendação: deixar desligado) |
| 5 | conferir `client.ts` depois do build do Lovable | logo após a virada |
| 6 | o espelho de anexos vira o caminho principal | hoje é redundância entre nós, não backup |

O item 1 é o que eu não deixaria passar da semana que vem: **redundância não é
backup.** Os anexos vivem nos dois nós, em dois provedores — mas apagou dos
dois, apagou. O banco já tem backup cifrado diário; os arquivos ainda não.

E o item 2 é o que faz a conta **cair**: as três máquinas já estão pagas, então
até desligar Render e Supabase o projeto paga os dois lados. Esse período
encurta terminando, não pausando.

### Sobre partir para a documentação

O roteiro (`docs/ha-corte-roteiro.md`) já é a documentação **do corte**, e foi
mantido o dia inteiro — hoje ganhou as seções 1.12, 1.13 e 1.14. O que **não**
existe ainda é a documentação do **dia seguinte**: como operar a casa nova.

Coisas que hoje só estão na minha cabeça e nos cabeçalhos dos scripts:

- como restaurar o backup (ordem: `globais.sql` **primeiro**, `pg_restore`
  depois — ao contrário, entra 1 política de RLS de 1.416, em silêncio)
- o que fazer quando a replicação parar (três scripts, três perguntas
  diferentes) — e que o relógio é de **7 horas**
- como subir uma Edge Function nova nos dois nós
- como aplicar uma migration no cluster sem derivar
- quem é o líder, como trocar de propósito, e o que não fazer durante a cópia

Minha sugestão: a documentação do dia seguinte sai **melhor depois da virada**,
porque a noite do Marco B vai ensinar coisas que hoje são previsão. Mas o
**roteiro de restauração** eu escreveria antes — é o único que precisa estar
pronto justamente quando tudo deu errado.

---

## Estado agora, medido

```
PRODUÇÃO (o que os usuários usam)
  ERP                      200 em 0,58 s        app.grpnascimento.com.br
  worker                   VIVO (batimento 15/10 16:18), fila 11 e caindo
  slot erp_corte           lost -- a recópia de amanhã resolve

CLUSTER (paralelo, ninguém usa)
  Patroni                  banco2 líder, banco1 sync standby, lag 0, TL 6
  banco1                   auth 200  rest 200  functions 405  tls válido
  banco2                   auth 200  rest 200  functions 405  tls válido
  anexos                   12.041 arquivos, 5.806 MB, iguais nos dois nós
  auth/storage             157 logins, 12.053 objetos
  Edge Functions           64 de 64, idênticas ao repositório
  backup                   61,8 MB cifrados, timer diário nos dois nós
  replicação               PARADA (slot perdido) -- a recópia de amanhã

GIT
  PR #881                  mergeada por você
  PR #894                  aberta, com as cinco de hoje
```

---

## Pendências menores, sem pressa

- **SMTP do comitê de ética quebrado.** `HTTP 500 — SMTP não configurado`.
  31 alertas pendentes e **zero** `COMITE_ETICA_RESPONSAVEL` ativo.
- **`revisao-ia` passa sem revisar** — precisa de `ANTHROPIC_API_KEY` própria.
- **Certificado A1 da NF-e vencido** há 33 dias (12/09). SEFAZ devolve 403.
- **Duas sessões automáticas não rodaram** (SIS-2026-0649 e SIS-2026-0663).
- **Domínio no seu CPF**, vencendo 27/02/2027 — vale transferir para o CNPJ.
