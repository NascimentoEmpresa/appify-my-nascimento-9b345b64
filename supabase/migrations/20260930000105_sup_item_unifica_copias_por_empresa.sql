-- =====================================================================
-- SUPRIMENTOS — materiais duplicados por empresa viram UM só: o da HAGG
--
-- O QUE ACONTECIA (14/09/2026)
-- Em Pedidos de Materiais, ao separar uma BOTINA tam. 40, a tela dizia
-- "0 em estoque" — e o Estoque & Etiquetas mostrava 3 no tamanho 40.
--
-- A migração do sistema antigo (migracao-sistema-antigo/etl.mjs) criou um
-- sup_item POR EMPRESA para cada nome: há 4 "BOTINA", uma de cada empresa,
-- cada uma com seu código. Mas o estoque físico é um só, no almoxarifado da
-- HAGG, e TODAS as 342 fichas de estoque estão nas cópias da HAGG. O enxoval
-- de contrato de outra empresa (NH, SN, Canaã) apontava para a cópia daquela
-- empresa, o pedido nascia com esse item_id, e:
--
--   • o saldo (sup_estoque_saldo, por sup_item_id) dava 0;
--   • sup_est_validar / sup_est_baixar RECUSAM etiqueta de outro sup_item —
--     nem bipando a botina de verdade a baixa passava.
--
-- Medido em produção antes desta migration:
--   1.777 sup_item, 701 nomes distintos, 364 nomes repetidos entre empresas;
--   1.076 cópias fora da HAGG, todas com uma cópia HAGG de mesmo nome;
--   1.090 linhas de enxoval e 557 itens de pedido apontando para cópias;
--   nenhuma ficha de estoque, preço, movimento, laudo ou NF numa cópia;
--   nenhum grupo com duas cópias HAGG; nenhuma função com as duas cópias
--   no enxoval; nenhum rascunho de catálogo pendente.
-- Efeito colateral do mesmo problema: o catálogo passou de 1000 linhas e o
-- PostgREST cortava a lista no "L" (LUVA sumia ao montar enxoval).
--
-- O QUE MUDA
-- Para cada nome (comparado sem diferença de caixa e de espaços), a cópia
-- da HAGG vira a canônica. Tudo o que apontava para as outras cópias passa
-- a apontar para ela, e as cópias ficam ativo = false. NADA é apagado de
-- sup_item: código, histórico e rascunhos antigos continuam resolvendo.
--
-- Empresa em Suprimentos é informação visual, não regra de acesso
-- (20260901000001_suprimentos_sem_filtro_de_empresa) — por isso o material
-- pode ser um só para o grupo inteiro. sup_ext_itens (a tela do encarregado)
-- não filtra por empresa e exige só aprovado + ativo, que as canônicas têm.
--
-- O que NÃO é unificado, de propósito:
--   • nomes diferentes que parecem o mesmo ("BOTINA - PRETA" x "BOTINA
--     PRETA COM BIQUEIRA DE AÇO") — isso é decisão de negócio, não de SQL;
--   • cópia que já tenha ficha de estoque, fornecedor ou laudo próprio
--     (hoje nenhuma): as três tabelas têm UNIQUE por material e juntar
--     exigiria somar saldo. A cópia fica como está e aparece na conferência.
--
-- Idempotente: rodar de novo não muda nada. Se der deadlock (pedido sendo
-- baixado no mesmo instante), é só rodar outra vez — a transação é única.
--
-- Tudo o que muda fica registrado em tmp_sup_item_unificacao_log, que é o
-- que o ROLLBACK no fim do arquivo usa para desfazer linha a linha.
-- =====================================================================

BEGIN;

-- ── 0. Guarda: a empresa dona do estoque físico ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = '5a61c769-21d8-4e61-b9bb-506b8db0bce8') THEN
    RAISE EXCEPTION 'Empresa HAGG (5a61c769-21d8-4e61-b9bb-506b8db0bce8) não encontrada — nada foi alterado';
  END IF;
END $$;

-- ── 1. Mapa cópia → canônica, e o log para desfazer ──────────────────
-- tmp_*: R2 permite DROP depois que a unificação estiver conferida.
CREATE TABLE IF NOT EXISTS public.tmp_sup_item_unificacao (
  copia_id       uuid PRIMARY KEY,
  canonico_id    uuid NOT NULL,
  nome           text NOT NULL,
  empresa_copia  uuid,
  copia_ativa    boolean NOT NULL,   -- estado original, para o rollback
  copia_aprovada boolean NOT NULL,
  unificado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tmp_sup_item_unificacao_log (
  id            bigserial PRIMARY KEY,
  tabela        text NOT NULL,
  acao          text NOT NULL,       -- update | delete | promover | aprovar | desativar
  linha_id      text,
  item_antigo   uuid,
  item_novo     uuid,
  linha         jsonb,               -- linha inteira ANTES, em delete/promover
  registrado_em timestamptz NOT NULL DEFAULT now()
);

-- Sem policy nenhuma: só o SQL Editor enxerga.
ALTER TABLE public.tmp_sup_item_unificacao     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tmp_sup_item_unificacao_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tmp_sup_item_unificacao     FROM anon, authenticated;
REVOKE ALL ON public.tmp_sup_item_unificacao_log FROM anon, authenticated;

WITH hagg AS (
  SELECT upper(regexp_replace(btrim(nome), '\s+', ' ', 'g')) AS chave,
         (array_agg(id))[1] AS id,
         count(*)           AS n
    FROM public.sup_item
   WHERE empresa_id = '5a61c769-21d8-4e61-b9bb-506b8db0bce8'
     AND ativo
   GROUP BY 1
)
INSERT INTO public.tmp_sup_item_unificacao
  (copia_id, canonico_id, nome, empresa_copia, copia_ativa, copia_aprovada)
SELECT i.id, h.id, i.nome, i.empresa_id, i.ativo, i.aprovado
  FROM public.sup_item i
  JOIN hagg h
    ON h.chave = upper(regexp_replace(btrim(i.nome), '\s+', ' ', 'g'))
   AND h.n = 1                                   -- duas HAGG de mesmo nome: não adivinha
 WHERE i.empresa_id IS DISTINCT FROM '5a61c769-21d8-4e61-b9bb-506b8db0bce8'
   AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_item    e WHERE e.sup_item_id = i.id)
   AND NOT EXISTS (SELECT 1 FROM public.sup_fornecedor_item f WHERE f.sup_item_id = i.id)
   AND NOT EXISTS (SELECT 1 FROM public.sst_laudo_epi       l WHERE l.sup_item_id = i.id)
ON CONFLICT (copia_id) DO NOTHING;

-- ── 2. Canônica herda a aprovação ────────────────────────────────────
-- sup_ext_itens exige i.aprovado. Se só a cópia estava aprovada, apontar o
-- enxoval para a canônica sumiria o material da tela do encarregado.
-- (Medido: nenhuma canônica nessa situação hoje — é guarda, não correção.)
WITH upd AS (
  UPDATE public.sup_item c SET aprovado = true
   WHERE NOT c.aprovado
     AND EXISTS (SELECT 1 FROM public.tmp_sup_item_unificacao m
                  WHERE m.canonico_id = c.id AND m.copia_aprovada)
  RETURNING c.id
)
INSERT INTO public.tmp_sup_item_unificacao_log (tabela, acao, linha_id, item_novo)
SELECT 'sup_item', 'aprovar', id::text, id FROM upd;

-- ── 3. Opções (tamanho/quantidade/litros) — UNIQUE (item_id, tipo) ────
-- 3a. A canônica já tem esse tipo: fica a dela. Único caso real hoje é a
--     BOTINA, onde a HAGG tem 33–49 e a cópia 33–45 — a HAGG já cobre.
WITH del AS (
  DELETE FROM public.sup_item_opcao o
   USING public.tmp_sup_item_unificacao m
   WHERE o.item_id = m.copia_id
     AND EXISTS (SELECT 1 FROM public.sup_item_opcao oc
                  WHERE oc.item_id = m.canonico_id AND oc.tipo = o.tipo)
  RETURNING o.*
)
INSERT INTO public.tmp_sup_item_unificacao_log (tabela, acao, linha_id, item_antigo, linha)
SELECT 'sup_item_opcao', 'delete', d.id::text, d.item_id, to_jsonb(d) FROM del d;

-- 3b. A canônica não tem: a opção da cópia passa para ela (uma por tipo).
WITH alvo AS (
  SELECT DISTINCT ON (m.canonico_id, o.tipo) o.id, o.item_id AS antigo, m.canonico_id
    FROM public.sup_item_opcao o
    JOIN public.tmp_sup_item_unificacao m ON m.copia_id = o.item_id
   ORDER BY m.canonico_id, o.tipo, o.id
), upd AS (
  UPDATE public.sup_item_opcao o SET item_id = a.canonico_id
    FROM alvo a WHERE o.id = a.id
  RETURNING o.id, a.antigo, a.canonico_id
)
INSERT INTO public.tmp_sup_item_unificacao_log (tabela, acao, linha_id, item_antigo, item_novo)
SELECT 'sup_item_opcao', 'update', id::text, antigo, canonico_id FROM upd;

-- 3c. Sobra (duas cópias com o mesmo tipo que a canônica não tinha).
WITH del AS (
  DELETE FROM public.sup_item_opcao o
   USING public.tmp_sup_item_unificacao m
   WHERE o.item_id = m.copia_id
  RETURNING o.*
)
INSERT INTO public.tmp_sup_item_unificacao_log (tabela, acao, linha_id, item_antigo, linha)
SELECT 'sup_item_opcao', 'delete', d.id::text, d.item_id, to_jsonb(d) FROM del d;

-- ── 4. Enxoval — UNIQUE (funcao_id, item_id) ─────────────────────────
-- 4a. A função já tem a canônica: se a linha ATIVA era a da cópia, a da
--     canônica herda ativo/aprovado antes de a da cópia sair. Sem isso o
--     material sumiria do enxoval.
WITH par AS (
  SELECT DISTINCT ON (fh.id) fh.id AS hagg_linha, fc.aprovado
    FROM public.sup_funcao_item fc
    JOIN public.tmp_sup_item_unificacao m ON m.copia_id = fc.item_id
    JOIN public.sup_funcao_item fh ON fh.funcao_id = fc.funcao_id AND fh.item_id = m.canonico_id
   WHERE fc.ativo AND NOT fh.ativo
   ORDER BY fh.id, fc.aprovado DESC
), antes AS (
  SELECT fh.* FROM public.sup_funcao_item fh JOIN par p ON p.hagg_linha = fh.id
), upd AS (
  UPDATE public.sup_funcao_item fh
     SET ativo = true, aprovado = fh.aprovado OR p.aprovado
    FROM par p WHERE fh.id = p.hagg_linha
  RETURNING fh.id
)
INSERT INTO public.tmp_sup_item_unificacao_log (tabela, acao, linha_id, linha)
SELECT 'sup_funcao_item', 'promover', a.id::text, to_jsonb(a)
  FROM antes a JOIN upd u ON u.id = a.id;

WITH del AS (
  DELETE FROM public.sup_funcao_item fc
   USING public.tmp_sup_item_unificacao m
   WHERE fc.item_id = m.copia_id
     AND EXISTS (SELECT 1 FROM public.sup_funcao_item fh
                  WHERE fh.funcao_id = fc.funcao_id AND fh.item_id = m.canonico_id)
  RETURNING fc.*
)
INSERT INTO public.tmp_sup_item_unificacao_log (tabela, acao, linha_id, item_antigo, linha)
SELECT 'sup_funcao_item', 'delete', d.id::text, d.item_id, to_jsonb(d) FROM del d;

-- 4b. Caso comum (as 1.090 linhas de hoje): a linha passa para a canônica.
--     Uma por função — duas cópias do mesmo nome na mesma função caem no 4c.
WITH alvo AS (
  SELECT DISTINCT ON (fc.funcao_id, m.canonico_id) fc.id, fc.item_id AS antigo, m.canonico_id
    FROM public.sup_funcao_item fc
    JOIN public.tmp_sup_item_unificacao m ON m.copia_id = fc.item_id
   ORDER BY fc.funcao_id, m.canonico_id, fc.ativo DESC, fc.aprovado DESC, fc.id
), upd AS (
  UPDATE public.sup_funcao_item fc SET item_id = a.canonico_id
    FROM alvo a WHERE fc.id = a.id
  RETURNING fc.id, a.antigo, a.canonico_id
)
INSERT INTO public.tmp_sup_item_unificacao_log (tabela, acao, linha_id, item_antigo, item_novo)
SELECT 'sup_funcao_item', 'update', id::text, antigo, canonico_id FROM upd;

-- 4c. Sobra.
WITH del AS (
  DELETE FROM public.sup_funcao_item fc
   USING public.tmp_sup_item_unificacao m
   WHERE fc.item_id = m.copia_id
  RETURNING fc.*
)
INSERT INTO public.tmp_sup_item_unificacao_log (tabela, acao, linha_id, item_antigo, linha)
SELECT 'sup_funcao_item', 'delete', d.id::text, d.item_id, to_jsonb(d) FROM del d;

-- ── 5. Itens de pedido ───────────────────────────────────────────────
-- É isto que faz a separação enxergar o saldo e a baixa aceitar a etiqueta.
-- Trocar só item_id não gera "EDITADO" no histórico do pedido: o gatilho
-- trg_sup_pedido_item_log_edicao só registra nome/tamanho/litros/quantidade.
WITH upd AS (
  UPDATE public.sup_pedido_item x SET item_id = m.canonico_id
    FROM public.tmp_sup_item_unificacao m
   WHERE x.item_id = m.copia_id
  RETURNING x.id, m.copia_id, m.canonico_id
)
INSERT INTO public.tmp_sup_item_unificacao_log (tabela, acao, linha_id, item_antigo, item_novo)
SELECT 'sup_pedido_item', 'update', id::text, copia_id, canonico_id FROM upd;

-- ── 6. Demais referências a sup_item (hoje todas vazias nas cópias) ──
-- Entram mesmo assim: entre a medição e a execução alguém pode ter lançado.
-- Nenhuma tem UNIQUE por material. nf_entrada_item dispara
-- trg_nf_item_propagar_sup_item, que acerta recebimento_nf_item sozinho.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sup_estoque_movimento', 'sup_estoque_inventario', 'sup_estoque_contagem_fila',
    'sup_item_preco', 'sup_compra_pedido_item', 'malote_despesa_item',
    'nf_entrada_item', 'recebimento_nf_item', 'sup_admissao_enxoval_item'
  ] LOOP
    EXECUTE format($f$
      WITH upd AS (
        UPDATE public.%I x SET sup_item_id = m.canonico_id
          FROM public.tmp_sup_item_unificacao m
         WHERE x.sup_item_id = m.copia_id
        RETURNING to_jsonb(x) ->> 'id' AS linha_id, m.copia_id, m.canonico_id
      )
      INSERT INTO public.tmp_sup_item_unificacao_log (tabela, acao, linha_id, item_antigo, item_novo)
      SELECT %L, 'update', linha_id, copia_id, canonico_id FROM upd
    $f$, t, t);
  END LOOP;
END $$;

-- ── 7. Cópias saem do catálogo (desativadas, nunca apagadas) ──────────
WITH upd AS (
  UPDATE public.sup_item i SET ativo = false
    FROM public.tmp_sup_item_unificacao m
   WHERE i.id = m.copia_id AND i.ativo
  RETURNING i.id, m.canonico_id
)
INSERT INTO public.tmp_sup_item_unificacao_log (tabela, acao, linha_id, item_antigo, item_novo)
SELECT 'sup_item', 'desativar', id::text, id, canonico_id FROM upd;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência (é o resultado que o SQL Editor mostra no fim) ───────
-- Esperado na primeira execução, pelos números de 14/09/2026:
--   sup_item/desativar ≈ 1076, sup_funcao_item/update ≈ 1090,
--   sup_pedido_item/update ≈ 557 (mais o que tiver entrado desde então),
--   sup_item_opcao/delete ≈ opções das cópias; e as linhas "ainda_em_copia"
--   todas com 0.
SELECT tabela, acao, count(*) AS linhas
  FROM public.tmp_sup_item_unificacao_log
 GROUP BY 1, 2
UNION ALL
SELECT 'ainda_em_copia: sup_funcao_item', '-', count(*)
  FROM public.sup_funcao_item x JOIN public.tmp_sup_item_unificacao m ON m.copia_id = x.item_id
UNION ALL
SELECT 'ainda_em_copia: sup_pedido_item', '-', count(*)
  FROM public.sup_pedido_item x JOIN public.tmp_sup_item_unificacao m ON m.copia_id = x.item_id
UNION ALL
-- Cópia ainda ativa que tem HAGG de mesmo nome: ou tem estoque/fornecedor/
-- laudo próprio, ou o nome tem duas cópias HAGG. Esperado hoje: 0.
SELECT 'nao_unificado: copia ativa com HAGG de mesmo nome', '-', count(*)
  FROM public.sup_item i
 WHERE i.empresa_id IS DISTINCT FROM '5a61c769-21d8-4e61-b9bb-506b8db0bce8'
   AND i.ativo
   AND NOT EXISTS (SELECT 1 FROM public.tmp_sup_item_unificacao m WHERE m.copia_id = i.id)
   AND EXISTS (SELECT 1 FROM public.sup_item h
                WHERE h.empresa_id = '5a61c769-21d8-4e61-b9bb-506b8db0bce8' AND h.ativo
                  AND upper(regexp_replace(btrim(h.nome), '\s+', ' ', 'g'))
                    = upper(regexp_replace(btrim(i.nome), '\s+', ' ', 'g')))
 ORDER BY 1, 2;

-- =====================================================================
-- ROLLBACK — desfaz pelo log, na ordem inversa. Rodar inteiro de uma vez.
-- =====================================================================
-- BEGIN;
-- -- 7. cópias voltam ao estado original
-- UPDATE public.sup_item i SET ativo = m.copia_ativa
--   FROM public.tmp_sup_item_unificacao m WHERE i.id = m.copia_id;
-- -- 6 e 5. referências voltam para a cópia
-- DO $$
-- DECLARE t text; col text;
-- BEGIN
--   FOR t, col IN SELECT * FROM (VALUES
--     ('sup_pedido_item','item_id'), ('sup_estoque_movimento','sup_item_id'),
--     ('sup_estoque_inventario','sup_item_id'), ('sup_estoque_contagem_fila','sup_item_id'),
--     ('sup_item_preco','sup_item_id'), ('sup_compra_pedido_item','sup_item_id'),
--     ('malote_despesa_item','sup_item_id'), ('nf_entrada_item','sup_item_id'),
--     ('recebimento_nf_item','sup_item_id'), ('sup_admissao_enxoval_item','sup_item_id')) v
--   LOOP
--     EXECUTE format('UPDATE public.%I x SET %I = l.item_antigo
--                       FROM public.tmp_sup_item_unificacao_log l
--                      WHERE l.tabela = %L AND l.acao = ''update'' AND x.id::text = l.linha_id',
--                    t, col, t);
--   END LOOP;
-- END $$;
-- -- 4. enxoval: desfaz a troca, devolve as linhas apagadas, desfaz a promoção
-- UPDATE public.sup_funcao_item x SET item_id = l.item_antigo
--   FROM public.tmp_sup_item_unificacao_log l
--  WHERE l.tabela = 'sup_funcao_item' AND l.acao = 'update' AND x.id::text = l.linha_id;
-- INSERT INTO public.sup_funcao_item
-- SELECT (jsonb_populate_record(NULL::public.sup_funcao_item, l.linha)).*
--   FROM public.tmp_sup_item_unificacao_log l
--  WHERE l.tabela = 'sup_funcao_item' AND l.acao = 'delete';
-- UPDATE public.sup_funcao_item x
--    SET ativo = (l.linha->>'ativo')::boolean, aprovado = (l.linha->>'aprovado')::boolean
--   FROM public.tmp_sup_item_unificacao_log l
--  WHERE l.tabela = 'sup_funcao_item' AND l.acao = 'promover' AND x.id::text = l.linha_id;
-- -- 3. opções
-- UPDATE public.sup_item_opcao x SET item_id = l.item_antigo
--   FROM public.tmp_sup_item_unificacao_log l
--  WHERE l.tabela = 'sup_item_opcao' AND l.acao = 'update' AND x.id::text = l.linha_id;
-- INSERT INTO public.sup_item_opcao
-- SELECT (jsonb_populate_record(NULL::public.sup_item_opcao, l.linha)).*
--   FROM public.tmp_sup_item_unificacao_log l
--  WHERE l.tabela = 'sup_item_opcao' AND l.acao = 'delete';
-- -- 2. aprovação herdada
-- UPDATE public.sup_item i SET aprovado = false
--   FROM public.tmp_sup_item_unificacao_log l
--  WHERE l.tabela = 'sup_item' AND l.acao = 'aprovar' AND i.id = l.item_novo;
-- -- 1. apoio
-- DROP TABLE public.tmp_sup_item_unificacao_log;
-- DROP TABLE public.tmp_sup_item_unificacao;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
