# Migração do sistema antigo (Render) → Supabase

Levantado direto no banco de origem em 17/08/2026, via `psql`. Nenhum CSV/Excel
envolvido: o dump e os perfis abaixo saíram da própria conexão.

- **Origem**: PostgreSQL 16.13, Render (Oregon), base `erp_nascimento`
- **Destino**: Supabase, tabelas `sup_*` das rotas `/app/suprimentos/*`
- **Estratégia escolhida**: mapear para as tabelas novas que já existem (não clonar o schema antigo)

## ⚠️ O banco de origem está VIVO

Entre duas consultas com poucos minutos de intervalo:

| Tabela | 1ª contagem | 2ª contagem |
|---|---:|---:|
| `estoque_items` | 888 | 889 |
| `pedidos_site_externo` | 1227 | 1228 |

O sistema antigo continua em uso. **A carga final tem que sair de um snapshot
único** (`REPEATABLE READ`), senão as tabelas ficam inconsistentes entre si —
um pedido carregado sem a etiqueta que o consumiu, por exemplo. As contagens
deste documento são de referência, não são o número final.

## Correspondência das 17 tabelas

| Antiga | Linhas | Destino no Supabase | Observação |
|---|---:|---|---|
| `estoque_items` | 889 | `sup_item` + `sup_estoque_item` | `localizacao` (texto) → FK `almoxarifado` |
| `estoque_tags` | 12.551 | `sup_estoque_tag` | `estado` migra do item para a etiqueta |
| `estoque_tags_consumo` | 3.428 | `sup_estoque_consumo` | |
| `pedidos_site_externo` | 1.228 | `sup_pedido` + `sup_pedido_item` | JSONB `equipamentos` → 4.963 linhas |
| `lotes_alteracoes_catalogo` | 52 | `sup_cat_lote` | |
| `alteracoes_catalogo_site_externo` | 4.258 | `sup_cat_alteracao` | |
| `veiculos` | 18 | `sup_patrimonio` (`categoria='veiculo'`) | |
| `equipamentos` | 122 | `sup_patrimonio` (`categoria='equipamento'`) | |
| `veiculos_arquivos` | 11 | `sup_patrimonio_arquivo` | |
| `equipamentos_arquivos` | 307 | `sup_patrimonio_arquivo` | |
| `manutencao_logs` | 1.108 | `sup_patrimonio_log` | |
| `cotacoes_impugnacoes` | 120 | `cotacoes_licitacao` | |
| `usuarios_permissoes` | 50 | `profiles` + `usuario_perfil_acesso` | ver ressalva abaixo |
| `contratos` | 3 | `contratos` | ver ressalva abaixo |
| `compras_solicitacoes` | 9 | **sem destino** | virou o Malote (`malote_despesa`), outro módulo |
| `compras_historico` | 32 | **sem destino** | idem |
| `compras_anexos` | 17 | **sem destino** | idem |

## Numeração

`compras_solicitacoes_numero_seq` = **105**, `is_called = t` → a próxima
solicitação seria a **106**. As 9 linhas restantes em `compras_solicitacoes`
mostram que ~96 solicitações foram apagadas ao longo do tempo; a sequência
nunca voltou.

## Colunas que NÃO precisam migrar

- **`pedidos_site_externo.tags`** — `NULL` nas 1.228 linhas. Coluna morta.
- **`estoque_items.contrato_id`** — `NULL` nas 889 linhas. A FK para `contratos`
  existe no schema mas nunca foi usada.
- **`usuarios_permissoes.senha`** — hash. Não migra: a autenticação nova é o
  Supabase Auth. (Existe também `senhas_backup_crypto`, 40 linhas, com senhas
  reversíveis — **não exportar em hipótese alguma**.)

## Qualidade dos dados de origem

### `estoque_items.tipo_item` é texto livre e está sujo

25 valores distintos para o que deveriam ser ~5 categorias:

```
UNIFORME (500) · UNIFORME␠(43) · UNIFORMES (33) · UNIFORMES␠(1) · Uniforme (7) · Uniforme␠(2) · UNI (1)
EPI (154) · EPI␠(3)
INSUMOS (68) · INSUMO (4) · INS (1)
EQUIPAMENTOS (18) · EQUIPAMENTO (7)
PEÇA DE REPOSIÇÃO (1) · PEÇAS PARA REPOSIÇÃO (1)
lixo: "1" (4) · "TESTE" (2) · "teste" (1) · "eeeeeeeeeee" (1) · "u" (1)
```

Há duplicatas por **espaço à direita** (`UNIFORME` vs `UNIFORME␠`). Precisa de
`upper(trim())` + de-para na carga, senão o catálogo novo nasce com 25 tipos.

### Volume de nomes livres a casar com as tabelas novas

| Campo de origem | Distintos | Alvo |
|---|---:|---|
| `pedidos.contrato` | 49 | `contratos` |
| `pedidos.posto` | 272 | `sup_posto` |
| `pedidos.funcao` | 95 | `sup_funcao` |
| `pedidos.equipamentos[].nome` | 335 | `sup_item` |
| `estoque_items.nome` | 351 | `sup_item` |
| `estoque_items.localizacao` | 442 | `almoxarifado` |
| `veiculos/equipamentos.contrato` | 7 | `contratos` |
| `veiculos/equipamentos.posto` | 15 | `sup_posto` |

**É aqui que a migração ganha ou perde.** Nenhum desses campos tem FK no banco
antigo — são strings digitadas. O que não casar por nome vira órfão.

### Contratos de origem são inservíveis

As 3 linhas de `contratos` são `048/2026`, `18022004` ("TESTE EDUARDO") e
`UFFS - 041/2021` (com espaços à esquerda). Os **43 contratos e ~408 postos
reais não estão no banco** — estão num arquivo `contratosPostos.js` do código
do sistema antigo. Para casar os 49 contratos e 272 postos dos pedidos vou
precisar ou desse arquivo, ou casar contra os 64 contratos que já existem no
Supabase.

## Formas dos JSONB

```
pedidos_site_externo.equipamentos  [] de {nome, quantidade, tamanho, litros?}
                                   4.963 elementos; `litros` em 4.122
                                   → sup_pedido_item JÁ TEM a coluna `litros`

usuarios_permissoes.permissoes     {papel, modulos[]}
                                   papéis: adm-full(17) compras-full(10)
                                           operacional-full(9) licitacao-full(9)
                                           treinamentos-full(5)
                                   23 módulos distintos; "*" em 17 usuários

alteracoes_catalogo_site_externo.dados  varia por tipo_entidade
                                   equipamento(3429) opcoes(392) funcao(215)
                                   posto(190) contrato(32)
```

## Ordem de carga (imposta pelas FKs do destino)

```
1º  contratos, almoxarifado, sup_posto, sup_funcao   ← referências
2º  sup_item (+ sup_item_opcao)
3º  sup_estoque_item
4º  sup_pedido → sup_pedido_item
5º  sup_estoque_tag        (depende de sup_estoque_item E sup_pedido_item)
6º  sup_estoque_consumo    (depende das duas acima)
7º  sup_patrimonio → sup_patrimonio_arquivo, sup_patrimonio_log
8º  sup_cat_lote → sup_cat_alteracao
9º  cotacoes_licitacao     (independente)
```

## Arquivos binários

`compras_anexos.caminho_arquivo`, `veiculos_arquivos.url` e
`equipamentos_arquivos.url` guardam **caminho, não o arquivo**. Os binários
estão no disco do servidor da Render. Migrar os 318 anexos para o Supabase
Storage é um trabalho separado deste.
