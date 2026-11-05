-- =========================================================================
-- RELATÓRIO DE DEMISSÕES — motivo por contrato + relato agrupado pela I.A
-- (05/11/2026)
--
-- PEDIDO (Pablo), em /app/relatorios/demissoes:
--   1. "Demissões por contrato" só dá o total e "Motivo da demissão" só o
--      total por motivo — ele quer, POR CONTRATO, quantas de cada motivo
--      (os dois campos de lista do passo 2 do Solicitar Demissão:
--      motivo_solicitacao e motivo_pedido).
--   2. O relato livre ("Relate abaixo o motivo…") diz a mesma coisa de
--      jeitos diferentes. A I.A classifica cada relato numa categoria FECHADA
--      (lista em supabase/functions/_shared/demissao-relato-ia.ts) e o
--      relatório agrupa por ela — também por contrato.
--   3. Abrir cada motivo/categoria e ver as solicitações.
--
-- O QUE ENTRA
--   · "SISTEMA_DEMISSAO_RELATO_IA": a categoria de cada solicitação + o md5
--     do relato que foi classificado. Tabela À PARTE, não coluna nova em
--     "SISTEMA_SOLICITACOES_DEMISSAO": aquela tabela tem gatilhos de etapa e
--     de guarda, e gravar nela pela Edge (sem auth.uid()) bateria neles. O
--     md5 é o que faz "reclassificar quando o relato mudar" sem gatilho
--     nenhum: relato editado → md5 diferente → volta a ser pendente, e o
--     relatório mostra "(aguardando I.A)" até a Edge passar de novo.
--   · dem_rel_relato_md5(text): a régua do md5 (espaços colapsados), a
--     MESMA na pendência, na gravação e no relatório.
--   · dir_rel_demissoes_linhas(de, ate, contrato, meses): uma linha por
--     solicitação do período, com os dois motivos de lista, o relato e a
--     categoria da I.A. Mesmo portão (dir_rel_exige) e mesmo filtro de
--     data/contrato/meses do dir_rel_dados('demissoes') — o total bate com o
--     card "Total no período". A tela cruza contrato × motivo no navegador
--     (~400 linhas/ano; a lógica é testada no Vitest).
--   · dem_relato_ia_pendentes(limite): o que falta classificar (sem linha
--     ou md5 velho). Portão do relatório: a Edge chama com o JWT de quem
--     abriu a tela, então só quem vê o relatório gasta token.
--   · dem_relato_ia_gravar(itens): SÓ service_role (a Edge, depois de
--     validar o usuário). Grava o md5 que a Edge LEU, não o atual: se o
--     relato mudou no meio do caminho, a linha já nasce velha e volta pra
--     fila — nunca fica a categoria antiga com o md5 novo.
--
-- Nada muda em dir_rel_dados/dir_rel_montar (Relatório Geral, TVs e a Edge
-- diretoria-ia seguem iguais).
-- Idempotente.
-- =========================================================================

-- ── 1) Categoria da I.A por solicitação ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_DEMISSAO_RELATO_IA" (
  solicitacao_id  BIGINT PRIMARY KEY REFERENCES public."SISTEMA_SOLICITACOES_DEMISSAO"(id) ON DELETE CASCADE,
  categoria       TEXT NOT NULL,
  relato_md5      TEXT NOT NULL,
  modelo          TEXT,
  classificado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public."SISTEMA_DEMISSAO_RELATO_IA" IS
  'Relatório de Demissões: categoria normalizada do relato livre, dada pela Edge demissao-relato-ia. relato_md5 = dem_rel_relato_md5(relato) do texto classificado; diferente do atual = pendente.';

-- Sem policy: ninguém lê/escreve direto. Leitura pelas RPCs do relatório,
-- escrita só pela Edge (service_role) via dem_relato_ia_gravar.
ALTER TABLE public."SISTEMA_DEMISSAO_RELATO_IA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SISTEMA_DEMISSAO_RELATO_IA" FROM PUBLIC, anon, authenticated;

-- ── 2) A régua do md5 ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dem_rel_relato_md5(_relato text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT md5(btrim(regexp_replace(COALESCE(_relato, ''), '\s+', ' ', 'g')))
$$;

-- ── 3) Linhas do relatório (contrato × motivo, categorias, detalhe) ──────
CREATE OR REPLACE FUNCTION public.dir_rel_demissoes_linhas(
  _de date DEFAULT NULL, _ate date DEFAULT NULL, _contrato uuid DEFAULT NULL, _meses int[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- Mesmo período padrão do dir_rel_montar (12 meses até hoje).
  v_ate date := COALESCE(_ate, current_date);
  v_de  date := COALESCE(_de, (date_trunc('month', COALESCE(_ate, current_date)) - interval '11 months')::date);
  v_nn  text := public.dir_rel_contrato_nn(_contrato);
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_demissoes');
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', x.id, 'data', x.dt, 'colaborador', x.colaborador_nome, 'cargo', x.colaborador_cargo,
             'contrato', x.contrato, 'status', x.status, 'grupo', x.grupo,
             'motivo_solicitacao', x.motivo_solicitacao, 'motivo_pedido', x.motivo_pedido,
             'relato', x.relato, 'categoria_ia', x.categoria_ia) ORDER BY x.dt DESC, x.id DESC), '[]'::jsonb)
      FROM (
        SELECT s.id, COALESCE(s.data_solicitacao, s.criado_em::date) dt, s.colaborador_nome, s.colaborador_cargo,
               -- Mesma coluna do ranking "Demissões por contrato" (d1 do dir_rel_dados).
               s.contrato, s.status,
               CASE WHEN s.status IN ('Concluída', 'ASO válido', 'Agendamento concluído') THEN 'concluido'
                    WHEN s.status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END grupo,
               s.motivo_solicitacao, s.motivo_pedido, s.relato,
               -- Categoria só vale se foi dada para ESTE texto.
               CASE WHEN ia.relato_md5 = public.dem_rel_relato_md5(s.relato) THEN ia.categoria END categoria_ia
          FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
          LEFT JOIN public."SISTEMA_DEMISSAO_RELATO_IA" ia ON ia.solicitacao_id = s.id
         WHERE COALESCE(s.data_solicitacao, s.criado_em::date) BETWEEN v_de AND v_ate
           AND public.dir_rel_no_mes(COALESCE(s.data_solicitacao, s.criado_em::date), _meses)
           AND (_contrato IS NULL OR public.dir_rel_no_contrato(NULL, COALESCE(s.contrato, s.colaborador_filial), _contrato, v_nn))
      ) x);
END $$;
REVOKE ALL ON FUNCTION public.dir_rel_demissoes_linhas(date, date, uuid, int[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_rel_demissoes_linhas(date, date, uuid, int[]) TO authenticated;

-- ── 4) Fila da I.A ───────────────────────────────────────────────────────
-- Mais novas primeiro: quem abre o relatório vê o período recente pronto
-- antes; as antigas vão saindo nos lotes seguintes.
CREATE OR REPLACE FUNCTION public.dem_relato_ia_pendentes(_limite int DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_demissoes');
  RETURN (
    WITH p AS (
      SELECT s.id, s.relato, s.motivo_solicitacao, s.motivo_pedido, public.dem_rel_relato_md5(s.relato) md5,
             COALESCE(s.data_solicitacao, s.criado_em::date) dt
        FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
        LEFT JOIN public."SISTEMA_DEMISSAO_RELATO_IA" ia ON ia.solicitacao_id = s.id
       WHERE ia.solicitacao_id IS NULL OR ia.relato_md5 <> public.dem_rel_relato_md5(s.relato))
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM p),
      'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', q.id, 'relato', q.relato, 'motivo_solicitacao', q.motivo_solicitacao,
                  'motivo_pedido', q.motivo_pedido, 'md5', q.md5) ORDER BY q.dt DESC, q.id DESC), '[]'::jsonb)
                  FROM (SELECT * FROM p ORDER BY dt DESC, id DESC LIMIT LEAST(GREATEST(COALESCE(_limite, 25), 1), 200)) q)));
END $$;
REVOKE ALL ON FUNCTION public.dem_relato_ia_pendentes(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dem_relato_ia_pendentes(int) TO authenticated;

-- _itens: [{"id": 123, "categoria": "...", "md5": "<o md5 lido na fila>", "modelo": "groq/..."}]
CREATE OR REPLACE FUNCTION public.dem_relato_ia_gravar(_itens jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int;
BEGIN
  INSERT INTO public."SISTEMA_DEMISSAO_RELATO_IA" AS t (solicitacao_id, categoria, relato_md5, modelo, classificado_em)
  SELECT s.id, left(btrim(i->>'categoria'), 120), i->>'md5', left(i->>'modelo', 80), now()
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) i
    JOIN public."SISTEMA_SOLICITACOES_DEMISSAO" s ON s.id = (i->>'id')::bigint
   WHERE COALESCE(btrim(i->>'categoria'), '') <> '' AND COALESCE(i->>'md5', '') <> ''
  ON CONFLICT (solicitacao_id) DO UPDATE
     SET categoria = EXCLUDED.categoria, relato_md5 = EXCLUDED.relato_md5,
         modelo = EXCLUDED.modelo, classificado_em = EXCLUDED.classificado_em;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.dem_relato_ia_gravar(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dem_relato_ia_gravar(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

-- -------------------------------------------------------------------------
-- ROLLBACK
-- -------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.dem_relato_ia_gravar(jsonb);
-- DROP FUNCTION IF EXISTS public.dem_relato_ia_pendentes(int);
-- DROP FUNCTION IF EXISTS public.dir_rel_demissoes_linhas(date, date, uuid, int[]);
-- DROP FUNCTION IF EXISTS public.dem_rel_relato_md5(text);
-- DROP TABLE IF EXISTS public."SISTEMA_DEMISSAO_RELATO_IA";
-- NOTIFY pgrst, 'reload schema';
