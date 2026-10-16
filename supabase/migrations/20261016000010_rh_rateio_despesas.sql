-- =========================================================================
-- RH › RATEIO DE DESPESAS (16/10/2026) — chamado SIS-2026-0673
--
-- PEDIDO ("incluir aba de rateio automático para ir para o malote"):
--   · "realizar ajuste automático conforme a planilha anexada nesta demanda,
--     para a despesa do jus brasil" — planilha Rateio_Atualizada.xlsx:
--     contrato paga valor × faturamento do contrato / faturamento total;
--   · "rateio senior, conforme quantidade de colaborador por contrato" —
--     colaboradores TRABALHANDO na EMPREGADOS, contrato pelo mesmo caminho de
--     RH › Ativos/Contratos (rh_ac_ativos: filial/depara/local);
--   · "rateio de FGTS, Bullla, seguro, BSF, gratificação pcd e mensalidade
--     seeac — por leitura do pdf anexado à despesa" — o PDF é lido NO
--     NAVEGADOR (pdf.js, como em Controladoria › Reuniões); o banco só casa
--     os CPFs lidos com a EMPREGADOS (rh_rateio_casar_cpfs) e devolve o
--     contrato de cada um.
--
-- A conta fica em src/lib/rh/rateioDespesas.ts (testada); aqui só guarda o
-- resultado conferido. Gravar é só por RPC (rh_rateio_salvar/excluir): as
-- tabelas não têm policy de escrita.
--
-- FORA DAQUI (de propósito): mandar o rateio para o Malote. O malote é do
-- Financeiro — fica para quando o dono do módulo aprovar. Por ora a tela
-- exporta o Excel.
--
-- FATURAMENTO do Jus Brasil é digitado/importado da planilha do RH, por
-- despesa (RH_RATEIO_ITEM.base). Não lê faturamento de tabelas do Financeiro.
--
-- PERMISSÃO: menu rh_rateio_despesas (visualizar, incluir, alterar,
-- excluir, exportar). Nasce sem ninguém (concede_tudo_alcanca = false por
-- padrão desde 08/10/2026) — liberar em Acesso por Usuário.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'rh_rateio_despesas', 'Rateio de Despesas', '/app/rh/rateio-despesas', 8, true
  FROM public.app_modulo m WHERE m.codigo = 'rh'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'rh_rateio_despesas', a::public.app_acao
  FROM unnest(ARRAY['incluir', 'alterar', 'excluir', 'exportar']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── 2) Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."RH_RATEIO_DESPESA" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo             text NOT NULL CHECK (tipo IN ('jusbrasil', 'senior', 'fgts', 'bullla', 'seguro', 'bsf', 'gratificacao_pcd', 'mensalidade_seeac')),
  competencia      date NOT NULL,                       -- 1º dia do mês
  valor            numeric(14,2) NOT NULL CHECK (valor >= 0),
  descricao        text,
  criterio         text NOT NULL CHECK (criterio IN ('faturamento', 'consultas', 'colaboradores', 'pdf')),
  status           text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'conferido')),
  anexo_path       text,                                -- bucket rh-rateio
  anexo_nome       text,
  -- Linhas lidas do PDF (n, cpf, nome, valor, contrato_id) — para conferência
  -- e para o Excel de detalhe. NULL nos rateios que não usam PDF.
  detalhe          jsonb,
  criado_por       uuid DEFAULT auth.uid(),
  criado_por_nome  text,
  alterado_por     uuid,
  alterado_por_nome text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_rateio_despesa_comp ON public."RH_RATEIO_DESPESA"(competencia DESC, tipo);

CREATE TABLE IF NOT EXISTS public."RH_RATEIO_ITEM" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  despesa_id     uuid NOT NULL REFERENCES public."RH_RATEIO_DESPESA"(id) ON DELETE CASCADE,
  contrato_id    uuid REFERENCES public.contratos(id) ON DELETE SET NULL,  -- NULL = sem contrato
  contrato_nome  text NOT NULL,                         -- foto do nome no dia
  base           numeric(16,2) NOT NULL DEFAULT 0,      -- faturamento / consultas / pessoas / valor do PDF
  qtd            integer,                               -- pessoas ou linhas do PDF
  percentual     numeric(12,8) NOT NULL DEFAULT 0,
  valor          numeric(14,2) NOT NULL DEFAULT 0,
  ajustado       boolean NOT NULL DEFAULT false,        -- valor digitado à mão
  observacao     text,
  ordem          integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rh_rateio_item_despesa ON public."RH_RATEIO_ITEM"(despesa_id, ordem);

DROP TRIGGER IF EXISTS trg_rh_rateio_despesa_updated ON public."RH_RATEIO_DESPESA";
CREATE TRIGGER trg_rh_rateio_despesa_updated BEFORE UPDATE ON public."RH_RATEIO_DESPESA"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3) Acesso ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_rateio_pode(_acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.can_access(auth.uid(), 'rh_rateio_despesas', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.rh_rateio_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_rateio_pode(text) TO authenticated;

ALTER TABLE public."RH_RATEIO_DESPESA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RH_RATEIO_ITEM" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."RH_RATEIO_DESPESA", public."RH_RATEIO_ITEM" FROM PUBLIC, anon;
GRANT SELECT ON public."RH_RATEIO_DESPESA", public."RH_RATEIO_ITEM" TO authenticated;
DROP POLICY IF EXISTS rh_rateio_despesa_sel ON public."RH_RATEIO_DESPESA";
CREATE POLICY rh_rateio_despesa_sel ON public."RH_RATEIO_DESPESA" FOR SELECT TO authenticated USING ((select public.rh_rateio_pode('visualizar')));
DROP POLICY IF EXISTS rh_rateio_item_sel ON public."RH_RATEIO_ITEM";
CREATE POLICY rh_rateio_item_sel ON public."RH_RATEIO_ITEM" FOR SELECT TO authenticated USING ((select public.rh_rateio_pode('visualizar')));

-- ── 4) Storage (PDF/planilha anexada à despesa) ──────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('rh-rateio', 'rh-rateio', false, 20971520) -- 20 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "rh rateio anexo select" ON storage.objects;
CREATE POLICY "rh rateio anexo select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'rh-rateio' AND (select public.rh_rateio_pode('visualizar')));
DROP POLICY IF EXISTS "rh rateio anexo insert" ON storage.objects;
CREATE POLICY "rh rateio anexo insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'rh-rateio' AND ((select public.rh_rateio_pode('incluir')) OR (select public.rh_rateio_pode('alterar'))));
DROP POLICY IF EXISTS "rh rateio anexo delete" ON storage.objects;
CREATE POLICY "rh rateio anexo delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'rh-rateio' AND ((select public.rh_rateio_pode('excluir')) OR (select public.rh_rateio_pode('alterar'))));

-- ── 5) Contratos + colaboradores trabalhando (rateio Senior) ─────────────
-- Uma linha por contrato da tabela contratos (inclusive encerrados, para o
-- casamento de nomes da planilha/PDF) com quantos TRABALHANDO ele tem agora,
-- e uma linha contrato_id NULL com quem está trabalhando sem contrato.
-- rh_ac_ativos leva ~0,5 s (mig 20261007000004).
CREATE OR REPLACE FUNCTION public.rh_rateio_contratos()
RETURNS TABLE(contrato_id uuid, nome text, status text, colaboradores integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.rh_rateio_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Rateio de Despesas' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH a AS (
    SELECT x.contrato_id AS cid, count(*)::int AS n
      FROM public.rh_ac_ativos() x
     WHERE public.rh_ac_conta_no_posto(x.situacao)
     GROUP BY x.contrato_id
  )
  SELECT c.id, btrim(c.nome), COALESCE(c.status, 'ativo'), COALESCE(a.n, 0)
    FROM public.contratos c
    LEFT JOIN a ON a.cid = c.id
  UNION ALL
  SELECT NULL::uuid, NULL::text, NULL::text, a.n FROM a WHERE a.cid IS NULL
  ORDER BY 2 NULLS LAST;
END $$;
REVOKE ALL ON FUNCTION public.rh_rateio_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_rateio_contratos() TO authenticated;

-- ── 6) CPFs do PDF → colaborador e contrato ──────────────────────────────
-- Recebe só os CPFs lidos do PDF (dígitos) e devolve nome, situação e
-- contrato de cada um — nunca a linha inteira da EMPREGADOS. Procura
-- também demitidos (FGTS rescisório, último mês de seguro): CPF com mais de
-- um cadastro fica com o ativo, depois Trabalhando, depois o mais recente.
-- Contrato pelo mesmo caminho de rh_ac_ativos (filial exata no depara →
-- contrato pelo nome normalizado → depara normalizado → local).
CREATE OR REPLACE FUNCTION public.rh_rateio_casar_cpfs(_cpfs text[])
RETURNS TABLE(cpf text, nome text, cadastro text, situacao text, contrato_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (public.rh_rateio_pode('incluir') OR public.rh_rateio_pode('alterar')) THEN
    RAISE EXCEPTION 'Sem permissão para lançar rateio' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(array_length(_cpfs, 1), 0) > 5000 THEN
    RAISE EXCEPTION 'No máximo 5.000 CPFs por leitura';
  END IF;
  RETURN QUERY
  WITH alvo AS (
    SELECT DISTINCT regexp_replace(c, '\D', '', 'g') AS d FROM unnest(_cpfs) c
  ),
  e AS MATERIALIZED (
    SELECT DISTINCT ON (k.d) k.d, x."Nome", x."Cadastro", x."Situação", x."Nome Filial", x."Descrição do Local",
           public.rh_norm_contrato(x."Nome Filial") AS nn_filial,
           public.rh_norm_contrato(x."Descrição do Local") AS nn_local
      FROM alvo k
      JOIN public."EMPREGADOS" x
        ON regexp_replace(COALESCE(x."CPF", ''), '\D', '', 'g') = k.d
     ORDER BY k.d, public.esp_col_esta_ativo(x."Situação") DESC,
              public.rh_ac_conta_no_posto(x."Situação") DESC, x."ID" DESC
  ),
  ct AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(c.nome)) public.rh_norm_contrato(c.nome) AS nn, c.id
      FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(c.nome), (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC
  ),
  dp_nome AS MATERIALIZED (
    SELECT DISTINCT ON (d.filial_nome) d.filial_nome, d.contrato_id
      FROM public.sup_empregado_contrato_depara d ORDER BY d.filial_nome, d.contrato_id
  ),
  dp_nn AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(d.filial_nome)) public.rh_norm_contrato(d.filial_nome) AS nn, d.contrato_id
      FROM public.sup_empregado_contrato_depara d
     WHERE public.rh_norm_contrato(d.filial_nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(d.filial_nome), d.contrato_id
  )
  SELECT e.d, e."Nome", e."Cadastro"::text, e."Situação",
         COALESCE(d1.contrato_id, c1.id, d2.contrato_id, c2.id)
    FROM e
    LEFT JOIN dp_nome d1 ON d1.filial_nome = e."Nome Filial"
    LEFT JOIN ct c1      ON c1.nn = e.nn_filial
    LEFT JOIN dp_nn d2   ON d2.nn = e.nn_filial
    LEFT JOIN ct c2      ON c2.nn = e.nn_local;
END $$;
REVOKE ALL ON FUNCTION public.rh_rateio_casar_cpfs(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_rateio_casar_cpfs(text[]) TO authenticated;

-- ── 7) Gravar (despesa + itens numa transação só) ────────────────────────
-- p: { id?, tipo, competencia, valor, descricao, criterio, status,
--      anexo_path, anexo_nome, detalhe, itens: [{contrato_id, contrato_nome,
--      base, qtd, percentual, valor, ajustado, observacao}] }
-- Sem id → nova (incluir). Com id → altera (alterar) e troca os itens.
CREATE OR REPLACE FUNCTION public.rh_rateio_salvar(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id   uuid := NULLIF(p->>'id', '')::uuid;
  v_nome text;
  v_soma numeric;
BEGIN
  IF v_id IS NULL AND NOT public.rh_rateio_pode('incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir rateio' USING ERRCODE = '42501';
  END IF;
  IF v_id IS NOT NULL AND NOT public.rh_rateio_pode('alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar rateio' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p->'itens') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Rateio sem itens';
  END IF;
  SELECT COALESCE(round(sum((i->>'valor')::numeric), 2), 0) INTO v_soma FROM jsonb_array_elements(p->'itens') i;
  IF (p->>'status') = 'conferido' AND v_soma <> round((p->>'valor')::numeric, 2) THEN
    RAISE EXCEPTION 'A soma do rateio (%) não bate com o valor da despesa (%)', v_soma, (p->>'valor')::numeric;
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), pr.email) INTO v_nome
    FROM public.profiles pr WHERE pr.id = auth.uid();

  IF v_id IS NULL THEN
    INSERT INTO public."RH_RATEIO_DESPESA"
      (tipo, competencia, valor, descricao, criterio, status, anexo_path, anexo_nome, detalhe, criado_por, criado_por_nome)
    VALUES (p->>'tipo', (p->>'competencia')::date, (p->>'valor')::numeric, NULLIF(btrim(p->>'descricao'), ''),
            p->>'criterio', COALESCE(p->>'status', 'rascunho'), NULLIF(p->>'anexo_path', ''), NULLIF(p->>'anexo_nome', ''),
            CASE WHEN jsonb_typeof(p->'detalhe') = 'array' THEN p->'detalhe' END, auth.uid(), v_nome)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public."RH_RATEIO_DESPESA" SET
      tipo = p->>'tipo', competencia = (p->>'competencia')::date, valor = (p->>'valor')::numeric,
      descricao = NULLIF(btrim(p->>'descricao'), ''), criterio = p->>'criterio',
      status = COALESCE(p->>'status', 'rascunho'),
      anexo_path = NULLIF(p->>'anexo_path', ''), anexo_nome = NULLIF(p->>'anexo_nome', ''),
      detalhe = CASE WHEN jsonb_typeof(p->'detalhe') = 'array' THEN p->'detalhe' END,
      alterado_por = auth.uid(), alterado_por_nome = v_nome
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rateio não encontrado'; END IF;
    DELETE FROM public."RH_RATEIO_ITEM" WHERE despesa_id = v_id;
  END IF;

  INSERT INTO public."RH_RATEIO_ITEM"
    (despesa_id, contrato_id, contrato_nome, base, qtd, percentual, valor, ajustado, observacao, ordem)
  SELECT v_id, NULLIF(i->>'contrato_id', '')::uuid, COALESCE(NULLIF(btrim(i->>'contrato_nome'), ''), 'Sem contrato'),
         COALESCE((i->>'base')::numeric, 0), NULLIF(i->>'qtd', '')::int, COALESCE((i->>'percentual')::numeric, 0),
         COALESCE((i->>'valor')::numeric, 0), COALESCE((i->>'ajustado')::boolean, false), NULLIF(btrim(i->>'observacao'), ''),
         o::int
    FROM jsonb_array_elements(p->'itens') WITH ORDINALITY AS t(i, o);

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.rh_rateio_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_rateio_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rh_rateio_excluir(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.rh_rateio_pode('excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir rateio' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."RH_RATEIO_DESPESA" WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.rh_rateio_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_rateio_excluir(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.rh_rateio_excluir(uuid), public.rh_rateio_salvar(jsonb),
--   public.rh_rateio_casar_cpfs(text[]), public.rh_rateio_contratos();
-- DROP POLICY IF EXISTS "rh rateio anexo select" ON storage.objects;
-- DROP POLICY IF EXISTS "rh rateio anexo insert" ON storage.objects;
-- DROP POLICY IF EXISTS "rh rateio anexo delete" ON storage.objects;
-- DROP TABLE IF EXISTS public."RH_RATEIO_ITEM", public."RH_RATEIO_DESPESA";
-- DROP FUNCTION IF EXISTS public.rh_rateio_pode(text);
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'rh_rateio_despesas';
-- DELETE FROM public.app_menu WHERE codigo = 'rh_rateio_despesas';
-- NOTIFY pgrst, 'reload schema';
