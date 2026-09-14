# Resultado da migração — sistema antigo (Render) → Supabase

Executada em 17/08/2026, direto entre os dois bancos, sem CSV nem Excel.
Script: [etl.mjs](etl.mjs) · Migrations: `20260903000001`, `20260903000002`.
Conferência: [verificar.mjs](verificar.mjs) — `node verificar.mjs`.

---

## Corte — 14/09/2026, fim das baixas no sistema antigo

O Eduardo confirmou que ninguém mais dá baixa nem pede material no sistema
antigo. Rodadas as duas fases uma última vez:

| Fase | Resultado |
|---|---|
| `pedidos` | 0 pedidos novos · 4 status atualizados · 5 operados no novo intocados |
| `estoque_sync` | 18 etiquetas atualizadas · nada criado, nada removido |

Conferência depois do corte: **0 pedidos faltando** (1.898 na origem, todos
no destino) e **527 de 531** material+tamanho batendo — as 4 restantes são as
peças únicas explicadas abaixo, onde o novo é que está certo.

A partir daqui o sistema novo é a fonte da verdade. **Não rodar mais o ETL**:
qualquer rodada nova sobrescreveria o que o time já fez no novo com o estado
congelado do antigo.

---

## Recarga de 14/09/2026 — estoque (fase nova `estoque_sync`)

O estoque novo tinha parado em 19/08: a fase `estoque` só insere, e desde
então o sistema antigo usou 1.117 peças únicas e consumiu 1.798 unidades em
massa — o novo mostrava 2.281 unidades a mais. Decisão do Eduardo: **o saldo
novo passa a ser o do antigo**, descontado o que só o sistema novo movimentou;
materiais novos nascem **aprovados**; acerto agora e **de novo no corte**.

`node etl.mjs estoque_sync [--commit]` espelha o estado de **cada etiqueta**
(não o saldo agregado), para a peça usada no antigo ficar usada aqui ligada
ao pedido — o vínculo que o alerta de EPI vencendo usa.

| O quê | Quantidade |
|---|---:|
| Materiais criados (aprovados, códigos 0001816–0001851) | 36 |
| Etiquetas atualizadas pelo estado do antigo | 851 |
| Etiquetas novas trazidas do antigo | 832 |
| Códigos reaproveitados pelo antigo (órfã repontada) | 102 |
| Apagadas no antigo e removidas aqui (movimento `remocao`) | 106 |
| Linhas de consumo novas | 1.141 |
| **Material+tamanho batendo depois (comparação por rastro)** | **527 de 531** |

Regras que valem para as próximas rodadas:

- Ficha antiga → material novo pelo **rastro** (`legado_id` das etiquetas de
  agosto), nunca pelo nome: a Aprovação de Catálogo renomeou itens.
- Etiqueta **tocada pelo sistema novo** (baixa, consumo, remoção, reserva):
  única fica como está; em massa = quantidade do antigo − o que o novo tirou.
- Roda com os gatilhos desligados só na transação (`sst_ca_guard_baixa`
  barraria zerar EPI com CA vencido, e isto é inventário, não entrega). Recusa
  rodar se houver reserva ativa; confere 24 FKs antes do COMMIT.
- **A fase `estoque` antiga não deve mais ser rodada** — ela casa por nome e
  recriaria material renomeado.

**Para o time de Suprimentos conferir:**

- As 4 unidades que "sobram" são peças únicas baixadas no novo. O novo está
  certo; o antigo é que ainda mostra a CALÇA DE SARJA M 1100995 e a BABUCHE
  BRANCO 42 35292 como disponíveis.
- **Mesma peça entregue a dois pedidos, um em cada sistema:** JAQUETA GG
  (etiqueta 29613: `PED-MT011LQY-67R1BL9` no novo × `PED-MT2Z6HTB-79PW1CL` no
  antigo) e CALÇA DE SARJA M (1101000: `PED-MT014M28-D7JWORX` × `PED-MSXCOJTW-VCFGI38`).
- Materiais criados parecidos com outros do catálogo — já eram fichas
  separadas no antigo, então ficaram separados; Compras decide se junta:
  BOJO PARA ROÇADEIRA TOYAMA, VASSOURA EM NYLON 60CM, BALDE MOP 15L, PNEU PARA
  CARRINHO, CAMARA PARA CARRINHO, MOP- ALGODAO, FITA DUREX, CAPACETE DE
  PROTEÇÃO (MARROM), STIHL PODADOR CERCA VIVA GASOLINA HS45,
  MANGUEIRA TRANÇADA 1/2 50M, CAMISA POLO PRETA S LOGO (ML/MC) e BABY.
- 3 etiquetas de teste de 04/08 (BABUCHE - PRETO 40 ×2, CALÇA DE OXFORD 42)
  continuam no saldo novo — não existem no antigo.

---

## Recarga de 14/09/2026 — pedidos

Feita enquanto o botão de solicitar materiais do sistema antigo era
desligado. Só a fase `pedidos`.

| O quê | Quantidade |
|---|---:|
| Pedidos novos trazidos (19/08 → 14/09) | **595** |
| Itens desses pedidos | **1.869** |
| Já migrados com status atualizado pelo legado | **194** |
| Faltando depois da carga (diferença de ids) | **0** |

**Três ajustes no ETL**, todos por mudanças no destino depois de agosto:

1. `trg_sup_pedido_validar_envio` exige `envio_tipo` em INSERT de pedido
   DESPACHADO. O legado não tem esse campo (os 1.084 despachados de agosto
   estão com NULL), e 408 dos 595 eram despachados — a fase inteira abortava.
   A fase agora roda com `SET LOCAL session_replication_role = replica`
   (só na própria transação) e confere as 8 FKs à mão antes do COMMIT.
2. Item passa a nascer com o `created_at` do pedido — sem isso,
   `trg_sup_pedido_item_log_edicao` gravaria "item adicionado" falso no
   histórico de cada item migrado.
3. O conflito era `do nothing`, então status que andou no legado nunca
   chegava: 199 pedidos estavam parados. Agora o status é sincronizado,
   **exceto** em pedido com linha em `sup_pedido_historico` (alguém operou
   no sistema novo — quem decide é gente).

Também entraram no de-para 3 contratos que o legado passou a usar depois de
agosto (IRGA 049, CEITEC 025, UFRGS Copa 025).

**Deixado para decisão humana:**

- 5 pedidos operados no sistema novo com status diferente do legado:
  `PED-MT02NAX0-9YHU5CD` (novo AGUARDANDO ENVIO × antigo AGUARDANDO COMPRA),
  `PED-MT095BHT-5UGFQIT`, `PED-MT014M28-D7JWORX`, `PED-MT02ZHB8-SXQ82H6`,
  `PED-MT011LQY-67R1BL9` (novo AGUARDANDO ENVIO × antigo DESPACHADO).
- 11 pedidos cuja lista de itens foi editada no legado depois de migrada — o
  ETL não reescreve itens (podem estar ligados a etiqueta/consumo).
- 8 pedidos apagados no legado que continuam no Supabase.
- 36 pedidos sem posto/função ligados: os postos não existem no catálogo
  novo. Aparecem na tela com o nome em texto.

---

## Recarga de 18/08/2026

Usuários relataram que "não veio 100%". **Não era dado deixado para trás na
carga: era o sistema antigo continuando a ser usado depois dela.** Entre 17 e
18/08 a origem ganhou 74 pedidos, 136 etiquetas, 122 linhas de consumo, 74 logs
e 5 anexos — e apagou 6 pedidos e 1 etiqueta que já tinham sido migrados.

Recarga rodada. Estado ao fim, por **diferença de conjunto de ids** (contar
linha não serve: num banco vivo dois totais iguais podem esconder uma linha
faltando de um lado e outra sobrando do outro):

| Tabela | Origem | Destino | Falta | Sobra |
|---|---:|---:|---:|---:|
| pedidos | 1.306 | 1.311 | 1 | 6 |
| etiquetas | 12.689 | 12.683 | 7 | 1 |
| consumo | 3.575 | 3.575 | **0** | 0 |
| logs manutenção | 1.187 | 1.177 | 10 | 0 |
| anexos, catálogo, cotações | — | — | **0** | 0 |

O que ainda falta são só as três exceções conhecidas: 1 pedido criado durante a
própria verificação, as 7 etiquetas de ficha-lixo e os 10 logs órfãos.

### Dois defeitos do ETL corrigidos nesta recarga

**A nota de colapso duplicava.** Ficha sem etiqueta tem seus dados gravados em
`observacoes`; sem guarda, cada execução anexava o mesmo texto de novo. Agora
há `position('[legado ficha N]' in observacoes) = 0`. Conferido: zero duplicadas.

**Código de etiqueta reaproveitado abortava a fase.** O sistema antigo apagou as
etiquetas 14810 e 32521 e criou outras com os MESMOS códigos impressos (24391 e
36000). Como `codigo` é único global, o INSERT estourava. Agora, quando o dono
antigo do código não existe mais na origem, a linha órfã é repontada; se os dois
estiverem vivos, o ETL recusa e avisa em vez de inventar desempate.

---

## Conferência origem × destino

| Origem (Render) | Linhas | Destino (Supabase) | Carregado | Δ |
|---|---:|---|---:|---|
| `pedidos_site_externo` | 1.234 | `sup_pedido` | 1.234 | ✅ |
| itens dentro do JSONB | 4.981 | `sup_pedido_item` | 4.981 | ✅ |
| `estoque_items` | 894 | `sup_estoque_item` | 288 | colapso previsto |
| `estoque_tags` | 12.556 | `sup_estoque_tag` | 12.549 | −7 |
| `estoque_tags_consumo` | 3.453 | `sup_estoque_consumo` | 3.453 | ✅ |
| `veiculos` + `equipamentos` | 140 | `sup_patrimonio` | 140 | ✅ |
| `veiculos_arquivos` + `equipamentos_arquivos` | 319 | `sup_patrimonio_arquivo` | 319 | ✅ |
| `manutencao_logs` | 1.113 | `sup_patrimonio_log` | 1.103 | −10 |
| `lotes_alteracoes_catalogo` | 52 | `sup_cat_lote` | 52 | ✅ |
| `alteracoes_catalogo_site_externo` | 4.258 | `sup_cat_alteracao` | 4.258 | ✅ |
| `cotacoes_impugnacoes` | 120 | `cotacoes_licitacao` | 120 | ✅ |

O colapso de `estoque_items` é o desenho, não perda: 894 fichas eram
(nome, tipo, **tamanho**, estado, valor, fornecedor, prateleira). Viraram 288
materiais, e o que as distinguia desceu para as 12.549 etiquetas, que já
carregam tamanho, estado e valor, e agora também prateleira e fornecedor.

## Referências criadas para os dados caberem

| O quê | Quantidade | Estado |
|---|---:|---|
| Itens de catálogo | 304 | `aprovado = false` |
| Postos | 20 | `aprovado = false` |
| Funções | 24 | `aprovado = false` |

Nascem pendentes de propósito: entram na tela de Aprovações do Catálogo para
o time de Compras revisar. É lá que se resolvem os duplicados que o legado
trouxe (`BABUCHE` × `BABUCHE - PRETO`) e os erros de digitação
(`BABUCHJE PRETO`, `SAPATO SOCIAL - FEMININNO`).

## Qualidade dos vínculos

| Vínculo | Resultado |
|---|---|
| Pedido → contrato | **1.234 de 1.234** |
| Pedido → posto | **1.234 de 1.234** |
| Pedido → função | **1.234 de 1.234** |
| Item de pedido → catálogo | 4.977 de 4.981 |
| Etiqueta → pedido | 1.066 religadas; 2.204 só com o texto |
| Consumo → pedido | 1.995 religadas; 1.458 só com o texto |

As etiquetas e consumos "só com texto" não são falha da migração: os pedidos
que eles citam **foram apagados no sistema antigo** na limpeza de 23/06/2026,
e nem a tabela de backup `pedidos_site_externo20260623` os tem. O protocolo
original ficou em `pedido_id_legado`, então o rastro existe.

## O que NÃO foi migrado, e por quê

| Item | Volume | Motivo |
|---|---:|---|
| 7 fichas de estoque e suas 7 etiquetas | 14 linhas | O nome do item é lixo de digitação: `1`, `3`, `41`, `A`, `u`, `,`. Criar item de catálogo com esses nomes sujaria o cadastro. |
| 10 logs de manutenção | 10 | Apontam para bens já apagados no sistema antigo; `sup_patrimonio_log.patrimonio_id` é obrigatório e não há dono. |
| `lotes_alteracoes_catalogo.callback_url` | 52 valores | URL de callback da integração antiga, que deixa de existir. Não é dado de negócio. |
| `usuarios_permissoes.senha` | 50 | Hash de senha. A autenticação nova é o Supabase Auth. |
| `senhas_backup_crypto` | 40 | Senhas reversíveis. **Nunca exportar.** |
| `pedidos_site_externo.tags` | 1.234 | Coluna morta: `NULL` em todas as linhas. |
| `estoque_items.quantidade_total` | 894 | Zero em todas: o saldo real é a contagem de etiquetas não usadas. |
| `estoque_items.contrato_id` | 894 | `NULL` em todas. |

## Numeração de solicitações

`compras_solicitacoes_numero_seq` estava em **105** (`is_called = t`), ou seja
a próxima seria a **106**. As 3 tabelas de `compras_*` não foram migradas
porque no sistema novo esse fluxo virou o **Malote** (`malote_despesa`), que é
de outro dev — fica registrado para quando ele quiser a numeração.

## Como repetir ou continuar

O script é **idempotente**: a chave `(legado_origem, legado_id)` tem índice
único em 14 tabelas. Rodar de novo só traz o que apareceu depois — foi assim
que o último pedido criado durante a execução entrou (1.233 pulados, 1 novo).

```
node etl.mjs <fase>            # simula e dá ROLLBACK
node etl.mjs <fase> --commit   # grava
```

Fases, na ordem: `referencias`, `pedidos`, `estoque`, `patrimonio`,
`catalogo`, `cotacoes`.

Precisa de duas variáveis: `RENDER_PW_FILE` (arquivo com a senha da origem) e
`SUPABASE_PW`. E do pacote `pg` — que **não está no `package.json`**; instale
com `npm install pg --no-save` se sumir depois de um `npm ci`.

## Pendências

1. **Os anexos ainda são só caminho.** `veiculos_arquivos.url`,
   `equipamentos_arquivos.url` e `compras_anexos.caminho_arquivo` guardam o
   caminho, não o arquivo. Os 319 binários estão no disco da Render e migrar
   para o Supabase Storage é um trabalho à parte — enquanto a Render viver.
2. **Revisar os 348 registros pendentes** na tela de Aprovações do Catálogo.
3. **Rodar a fase `pedidos` de novo** pouco antes de desligar o sistema
   antigo, para capturar o que for criado até lá.
4. **Trocar as senhas** que passaram pelo chat: a do banco da Render e a do
   Supabase.
