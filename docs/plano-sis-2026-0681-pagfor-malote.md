<!-- chamado:SIS-2026-0681 -->
# SIS-2026-0681 — Integração PagFor Sicredi com o Pagamento do Malote

> Rascunho de plano (não commitado). Base: manual Sicredi "Pagamento a Fornecedor – CNAB 240 Febraban" (38 págs), levantamento de 08/10/2026 e leitura do código em 06/11/2026.
> **Limitação desta rodada:** o chamado em si (texto completo, comentários) e o estado do banco de produção NÃO foram reconferidos — o túnel do banco estava fechado e `worker/.env` aponta para o Supabase antigo. Os números de 08/10 (Pix 551, Boleto 225, 438 fornecedores sem Pix etc.) devem ser revalidados antes de implementar.

## 1. Objetivo
Gerar a remessa CNAB 240 do PagFor a partir das despesas do Malote "prontas para pagar", e ler o retorno para dar baixa automática (ou devolver para ajuste com o motivo do banco), eliminando a digitação de pagamentos no Internet Banking.

## 2. O que o manual exige (resumo técnico)
- Arquivo `.REM`, ASCII, 240 bytes/linha. Registros: header de arquivo (0), header de lote (1), detalhe (3: segmentos A/B, J/J52, O, N), trailer de lote (5), trailer de arquivo (9). Máx. 70 lotes, 10.000 movimentos por lote.
- **PIX transferência:** forma de lançamento 45, câmara 009, segmentos A + B; tipo de chave: 01 telefone, 02 e-mail, 03 CPF/CNPJ, 04 aleatória, 05 dados bancários. PIX QR Code só dinâmico (forma 47).
- **Boleto:** forma 30 (Sicredi) / 31 (outros bancos), segmentos J + J52 (J52 obrigatório: CNPJ/nome do pagador, beneficiário e avalista).
- **Tributos:** segmentos O/N (fora de escopo inicial).
- Campos numéricos à direita com zeros à esquerda; alfanuméricos à esquerda com brancos; sem acentos/caixa conforme layout.
- **NSA** (nº sequencial do arquivo, header pos. 158-163) sequencial por convênio; reenvio com NSA/lote repetido é recusado.
- **Cancelamento:** novo arquivo com o próximo NSA contendo só os lançamentos a cancelar, trocando `000`→`999` nas colunas 15-17 do segmento A/J/O/N (A+B / J+J52 sempre juntos).
- **Retorno `.RET`:** ocorrência nas posições 231-232 (`00` pago, `BD` agendado, `01` sem saldo, demais = críticas, ver Nota G099). Segmento Z devolve autenticação + protocolo. A empresa precisa implementar a importação do retorno no mesmo sistema que gera a remessa.
- Transmissão: "Internet Banking ou Troca de Arquivos" — o manual não descreve SFTP/API; o canal automático precisa ser confirmado com a Sicredi/TI.
- **Ambiguidade do manual:** versão do layout "livre desde que 3 dígitos" (header de arquivo 164-166) × valores fixos citados (`089` arquivo; `045` PagFor, `040` boleto, `012` tributos no lote). Resolver com arquivo real de exemplo/gerente; tornar configurável por conta.

## 3. Estado atual do ERP (código lido hoje)
- Status (`src/lib/maloteStatus.ts`): `aguardando_pagamento → pronto_para_pagar → despesa_paga`, com `ajuste_pagamento` e `despesa_reprovada`. Tela de pagamento: `src/pages/malote/PagamentoMalote.tsx` (`STATUS_PAGAMENTO`, `statusEfetivo` por parcela).
- Mutations em `src/hooks/useMaloteDespesa.ts`: `useMarcarConferidoDespesa`, `useSolicitarAjustePagamentoDespesa`, `usePagarDespesa` (RPC `malote_pagar_despesa`) e `usePagarParcela` (RPC `malote_pagar_parcela`) — pagamento é por despesa **ou por parcela**; a remessa tem de gerar um movimento por parcela quando `parcelado`.
- Dados de pagamento da despesa: `forma_pagamento` (texto do catálogo), `banco_id` (catálogo `malote_cartao_banco`), `informacoes_pagamento` (texto livre — chave Pix digitada à mão). Boleto = só PDF anexo, sem linha digitável/código de barras.
- `fornecedor_conta_bancaria` (migration 20260518184202) já tem `pix_tipo` (cpf/cnpj/email/telefone/aleatoria), `pix_chave`, `principal`, `ativa` — é o destino natural dos dados estruturados do favorecido. Em 08/10 estava vazia para os 438 fornecedores e a despesa não aponta para o fornecedor (só o rateio).
- CNAB legado de **cobrança** (a receber): `conta_bancaria` (cnab_convenio, cnab_layout, cnab_proxima_sequencia, pastas FTP), `remessa_cnab`, `remessa_cnab_titulo`, tela `src/pages/financeiro/IntegracaoBancaria.tsx` (hoje só upload manual de retorno; "parsers e envio plugados no próximo passo"). Só 2 contas Sicredi (ag. 155 e 119), sem convênio e sem empresa. **Reaproveitar o conceito de conta/NSA, mas o layout de pagamento é outro** (CNAB 240 pagamento ≠ cobrança).
- Não há geração/leitura CNAB em Edge Function nem no `worker/` hoje.

## 4. Decisões que precisam do Iury/TI antes de codar (bloqueantes)
1. **Cartilha/arquivo real:** a cartilha Sicredi que a TI tem + 1 remessa e 1 retorno reais de exemplo (resolve a versão do layout e as críticas G099).
2. **Conta pagadora por empresa:** convênio, agência, conta (+DV) Sicredi de cada empresa que paga. Hoje só há 2 contas, sem convênio.
3. **Canal de envio:** fase 1 manual (baixar `.REM`, subir no PagFor, depois subir `.RET`) × automático (SFTP/troca de arquivos). Recomendação: **fase 1 manual** — não depende da Sicredi e já elimina a digitação.
4. **Quem aprova o envio ao banco:** a mesma permissão de "pagar" (`malote_pagamento:aprovar`?) ou uma nova — ver pendência em [[project-malote-pagamento-cotacao-ignora-setor]].
5. **Escopo:** fase 1 só PIX; boleto na fase 2; TED/tributos depois (confirmar com o Iury).
6. **Chave Pix estruturada:** aceitar cadastro em `fornecedor_conta_bancaria` e/ou campos na despesa (ver §5.1).

## 5. Plano de implementação (fases)

### Fase 0 — Preparação (sem código de produção)
- Revalidar no banco: volume de despesas por forma, quantas `pronto_para_pagar`, quantas têm chave Pix reconhecível em `informacoes_pagamento`.
- Obter itens 1–3 da §4.

### Fase 1 — PIX (remessa + retorno manual)
**5.1 Dados (migrations, numeração após `git fetch` e conferência de `origin/joao|pablo`)**
- `malote_despesa` (e parcela, se o favorecido variar): `favorecido_nome`, `favorecido_documento`, `pix_tipo` (01–05 ou enum textual), `pix_chave`, `fornecedor_id` opcional (default a partir de `fornecedor_conta_bancaria.principal`). Validação por tipo (CPF/CNPJ com DV, e-mail, telefone E.164, UUID para aleatória) em CHECK/trigger.
- `pagfor_conta` (ou colunas novas em `conta_bancaria`): empresa, banco 748, agência, conta, convênio, versão de layout (3 dígitos), `proximo_nsa`, ativa.
- `pagfor_remessa` (id, conta, nsa, status `gerada|enviada|retornada|cancelada`, nome do arquivo, conteúdo/hash, gerado_por, datas) e `pagfor_remessa_item` (remessa, despesa_id, parcela_id, valor, data de pagamento, nº sequencial no lote, ocorrência/crítica de retorno, autenticação, protocolo, status).
- Status novo `enviado_ao_banco` em `malote_despesa` (e efetivo por parcela), entre `pronto_para_pagar` e `despesa_paga`; atualizar `StatusDespesa`, `STATUS_LABEL`, `STATUS_BADGE_CLASS`, filtros/contadores de `PagamentoMalote.tsx`, `FluxoAprovacaoVisual.tsx`, `meusItensUtils.ts` e `maloteStatus.ts`; CHECK/enum do banco.
- Tudo com `app_menu`/`app_menu_acao` (menu fantasma ou tela nova "Remessa PagFor") e RLS via `can_access` — nunca `has_role`. RPCs `SECURITY DEFINER` com `search_path`, `NOTIFY pgrst`, ROLLBACK comentado. NSA incrementado **dentro da RPC** de geração (lock de linha em `pagfor_conta`) para nunca repetir.

**5.2 Geração da remessa (puro e testável)**
- `src/lib/pagfor/` com funções puras: `montarRemessaPix(conta, itens, nsa, agora) → string`, formatadores de campo (numérico/alfanumérico, sanitização ASCII, DDMMAAAA), cálculo de totais de trailer, regra de 240 colunas por linha. Sem rede, sem Supabase — fácil de cobrir com Vitest (`src/test/pagfor-remessa.test.ts`) com fixtures baseadas no arquivo real da §4.1: tamanho de cada linha = 240, contagem de registros do trailer, soma de valores, NSA, PIX segmentos A+B por tipo de chave.
- Geração do cancelamento (`000→999`) reutilizando o mesmo montador.
- Local: client-side (download do `.REM`) numa primeira versão, já que a RPC só reserva NSA e devolve os itens; alternativa Edge Function se for preciso guardar o arquivo no servidor (decidir em §4.3).

**5.3 Tela (Pagamento do Malote)**
- Em `PagamentoMalote.tsx`: seleção em lote das despesas `pronto_para_pagar` com forma Pix, validação prévia (chave válida, valor > 0, data de pagamento ≥ hoje, conta pagadora da empresa), botão "Gerar remessa PagFor" → baixa `.REM`, marca itens como `enviado_ao_banco` e registra a remessa. Histórico de remessas com reimpressão e "Cancelar no banco" (gera arquivo `999`).
- Gate: `<AcessoGate menu="..." acao="...">`.

**5.4 Retorno**
- Parser puro `lerRetornoPagfor(texto)`: ocorrência (231-232), segmento Z (autenticação/protocolo), mapeamento de críticas G099 para mensagem em português.
- Tela de upload do `.RET`; RPC aplica em transação: `00` → chama a lógica de `malote_pagar_despesa`/`malote_pagar_parcela` (data de pagamento do banco, autenticação como comprovante/observação); `BD` (agendado) → mantém `enviado_ao_banco`; crítica → `ajuste_pagamento` com o motivo do banco em `malote_despesa_historico` (usar `registrarEventoDespesa`, conforme regra do histórico do Malote). Idempotente: reimportar o mesmo retorno não duplica pagamento.
- Verificar impacto em Orçamento Utilizado/DRE/Fluxo de Caixa: o pagamento precisa seguir o mesmo caminho das RPCs atuais (nada de UPDATE direto de status).

### Fase 2 — Boleto (J/J52)
- Guardar linha digitável/código de barras (44 dígitos) e dados do beneficiário na despesa (extração do PDF ou digitação com validação do DV); segmentos J + J52.

### Fase 3 — Automação do canal e extras
- Envio/recebimento por troca de arquivos (se a Sicredi liberar), TED (forma 41/43), tributos (O/N), conciliação do retorno com o extrato (Conciliação Bancária).

## 6. Arquivos críticos
- `src/lib/maloteStatus.ts`, `src/pages/malote/PagamentoMalote.tsx`, `src/hooks/useMaloteDespesa.ts`, `src/pages/malote/FluxoAprovacaoVisual.tsx`, `src/pages/malote/meusItensUtils.ts`
- `src/pages/financeiro/IntegracaoBancaria.tsx` (referência de conta/NSA/upload)
- Novos: `src/lib/pagfor/*`, `src/hooks/usePagfor.ts`, tela de remessas, migrations `pagfor_*`, testes Vitest.

## 7. Riscos
- Layout/versão divergente no manual → só se fecha com arquivo real; sem isso a Sicredi recusa o lote.
- Pagamento duplicado (reenvio/NSA repetido, retorno importado duas vezes) → NSA transacional, unicidade `(despesa/parcela, remessa ativa)`, retorno idempotente.
- Chave Pix errada = dinheiro no destino errado → validação forte + conferência humana (status `pronto_para_pagar` já é "conferido") e confirmação do favorecido na tela antes de gerar.
- Dados de 438 fornecedores sem Pix cadastrado → fase 1 depende de estruturar a chave na despesa ou de cadastro/carga.
- Status novo impacta contadores, filtros, orçamento e relatórios que testam `despesa_paga`/`pronto_para_pagar` — varrer todos os usos (`grep` mostrou 9 arquivos em `src/`) e views no banco.
- Migrations aplicam sozinhas no merge; mudança de CHECK/enum de status em tabela grande exige `lock_timeout` ok e aplicação fora do pico.

## 8. Verificação
- Vitest do montador/parsers com fixtures reais; teste de que cada linha tem 240 bytes e de que trailers batem.
- Teste de migration em PG18 descartável (RPC de NSA, idempotência do retorno, transições de status).
- Homologação: gerar remessa de 1 PIX de valor baixo para conta própria, subir no PagFor, importar o retorno e conferir baixa, comprovante e Fluxo de Caixa.
- Abrir as telas no navegador (nenhuma verificação visual feita ainda).

## 9. Decisões (09/11/2026, João) e pendências
**Decididas:** fase 1 com envio manual (baixar `.REM` / importar `.RET`); Pix e boleto já na fase 1; chave Pix digitada na despesa (com tipo e validação); gera remessa quem tem a permissão de pagar; a cartilha é o próprio manual PDF (a TI não tem nada além dele); a empresa nunca usou o PagFor, então não existem arquivos modelo (usar os exemplos em imagem do manual como fixtures).

**Contas Sicredi (conferido no banco em 09/11):** as duas são da HAGG (NASCIMENTO SERVICOS DE LIMPEZA LTDA, CNPJ 03.644.009/0001-23): ag. 0119 conta 82786-0 e ag. 0155 conta 32026-9, com DV, NSA=1 e lote=1. `cnab_convenio` vazio nas duas. A de ag. 0155 estava com banco `478` (corrigido para `748` por migration).

**Pendências externas (devolvidas ao chamado):**
1. Convênio PagFor (4 caracteres) de cada conta que vai pagar fornecedor, junto ao Sicredi.
2. Confirmar se as contas 0119/82786-0 e 0155/32026-9 já estão habilitadas no PagFor e se as duas pagarão fornecedor (se só uma, basta o convênio dela; se as duas, o ERP precisa de seletor de conta na remessa).
3. Modelo oficial de remessa/retorno do Sicredi, se o banco fornecer (desejável, não bloqueante) — resolve a versão do layout (`089/045` ou livre).

**Boleto na fase 1:** exige guardar linha digitável/código de barras (44 dígitos) e dados do beneficiário (CNPJ e nome para o J52), hoje inexistentes (boleto é só PDF anexo).

**Primeiro envio:** testar com um Pix de valor baixo para conta própria, antes de qualquer pagamento real.
