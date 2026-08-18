# Resultado da migração — sistema antigo (Render) → Supabase

Executada em 17/08/2026, direto entre os dois bancos, sem CSV nem Excel.
Script: [etl.mjs](etl.mjs) · Migrations: `20260903000001`, `20260903000002`.

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
