-- =========================================================================
-- CONFERÊNCIA DE 13º: contratos da LICITAÇÃO + situação das pessoas
-- (13/11/2026) — complementa a 20261112220000
--
-- RELATO (Pablo, com print de 2026/1ª parcela, 63 contratos "Pendente RH"):
--   "esses contratos tá puxando da onde? tem alguns que já estão inativos.
--    tem uns que tem só uma pessoa com aux doença, aí tem que mostrar essa
--    situação em detalhes também. mas tem que puxar todos contratos da
--    licitação, lá eles controlam as situações dos contratos."
--
-- DE ONDE VINHA: public."CONTRATOS" com "ATIVO" = 'SIM' — o cadastro de
-- filiais da Senior (o mesmo da Conferência de Ponto). Ali o ATIVO não
-- acompanha o encerramento do contrato; quem controla isso é a Licitação
-- (Licitações › Contratos, public.contratos.status ativo/suspenso/encerrado).
--
-- O QUE MUDA
--   1. A linha do 13º passa a ser do contrato da LICITAÇÃO (contrato_id uuid).
--      contrato_empresa/contrato_filial ficam (nulos) só para o histórico das
--      linhas antigas; as que já existiam ganham o contrato_id pelo nome, com a
--      mesma normalização de rh_ac_ativos (rh_norm_contrato).
--   2. A lista sai de decimo_contratos(): contratos com status 'ativo' na
--      Licitação + os que já têm linha nesta parcela (contrato encerrado no
--      meio do fluxo não some com o 13º para pagar). Cada um vem com as
--      PESSOAS ativas ligadas a ele e a situação de cada uma (Trabalhando,
--      Auxílio Doença, Férias…) — a mesma ligação pessoa → contrato do
--      RH › Ativos/Contratos (rh_ac_ativos).
--   3. decimo_agir e decimo_importar_valores trocam (empresa, filial) por
--      contrato_id. A planilha da Senior continua vindo por empresa/filial (e
--      matrícula, quando tiver): o banco acha o contrato da Licitação de cada
--      linha — pela pessoa (empresa + cadastro) e, sem ela, pelo contrato em
--      que a maioria das pessoas daquela filial está. `p_simular` devolve a
--      prévia sem gravar, para a tela mostrar antes.
--   4. A policy contratos_decimo_gate (CONTRATOS) sai: o 13º não lê mais o
--      cadastro da Senior pela tela.
--
-- Nada em Licitação é alterado: só leitura, por SECURITY DEFINER.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) A chave passa a ser o contrato da Licitação ───────────────────────
ALTER TABLE public."SISTEMA_CONFERENCIA_DECIMO" ADD COLUMN IF NOT EXISTS contrato_id uuid;
ALTER TABLE public."SISTEMA_CONFERENCIA_DECIMO" ALTER COLUMN contrato_empresa DROP NOT NULL;
ALTER TABLE public."SISTEMA_CONFERENCIA_DECIMO" ALTER COLUMN contrato_filial  DROP NOT NULL;
ALTER TABLE public."SISTEMA_CONFERENCIA_DECIMO" DROP CONSTRAINT IF EXISTS scd_contrato_parcela_unico;

-- Linhas criadas no dia da 20261112220000 (se houver): o contrato pelo nome,
-- só quando não colide com outra linha da mesma parcela.
WITH ct AS (
  SELECT DISTINCT ON (public.rh_norm_contrato(c.nome)) public.rh_norm_contrato(c.nome) AS nn, c.id
    FROM public.contratos c
   WHERE public.rh_norm_contrato(c.nome) IS NOT NULL
   ORDER BY public.rh_norm_contrato(c.nome), (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC
),
cand AS (
  SELECT DISTINCT ON (ct.id, d.ano, d.parcela) d.id AS linha_id, ct.id AS contrato_id
    FROM public."SISTEMA_CONFERENCIA_DECIMO" d
    JOIN ct ON ct.nn = public.rh_norm_contrato(d.contrato_nome)
   WHERE d.contrato_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public."SISTEMA_CONFERENCIA_DECIMO" o
                      WHERE o.contrato_id = ct.id AND o.ano = d.ano AND o.parcela = d.parcela)
   ORDER BY ct.id, d.ano, d.parcela, d.id
)
UPDATE public."SISTEMA_CONFERENCIA_DECIMO" d SET contrato_id = cand.contrato_id
  FROM cand WHERE d.id = cand.linha_id;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scd_contrato_id_parcela_unico') THEN
    ALTER TABLE public."SISTEMA_CONFERENCIA_DECIMO"
      ADD CONSTRAINT scd_contrato_id_parcela_unico UNIQUE (contrato_id, ano, parcela);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS scd_contrato_id_idx ON public."SISTEMA_CONFERENCIA_DECIMO"(contrato_id);

-- portaria-ok: R3 — o 13º deixou de ler CONTRATOS (Senior) pela tela; a contratos_gate segue protegendo a tabela.
DROP POLICY IF EXISTS contratos_decimo_gate ON public."CONTRATOS";

-- ── 2) Quem pode ver a tela ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decimo_ve_tela()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.can_access(auth.uid(), 'rh_conferencia_decimo', 'visualizar'::app_acao)
      OR public.can_access(auth.uid(), 'financeiro_conferencia_decimo', 'visualizar'::app_acao);
$$;
REVOKE ALL ON FUNCTION public.decimo_ve_tela() FROM PUBLIC, anon, authenticated;

-- ── 3) A lista: contratos da Licitação + as pessoas e a situação delas ───
CREATE OR REPLACE FUNCTION public.decimo_contratos(p_ano integer, p_parcela integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.decimo_ve_tela() THEN
    RAISE EXCEPTION 'Sem acesso à Conferência de 13º.' USING ERRCODE = '42501';
  END IF;

  WITH
  -- `MATERIALIZED`: rh_ac_ativos é a conta pesada do Ativos/Contratos; roda
  -- uma vez e o resto lê o resultado.
  pes AS MATERIALIZED (
    SELECT a.contrato_id, a.cadastro, a.nome, a.cargo, a.situacao, a.admissao
      FROM public.rh_ac_ativos() a
     WHERE a.contrato_id IS NOT NULL
  ),
  ids AS (
    SELECT c.id FROM public.contratos c WHERE COALESCE(c.status, 'ativo') = 'ativo'
    UNION
    SELECT d.contrato_id FROM public."SISTEMA_CONFERENCIA_DECIMO" d
     WHERE d.ano = p_ano AND d.parcela = p_parcela AND d.contrato_id IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'contrato_id',     c.id,
           'nome',            c.nome,
           'cliente',         c.cliente,
           'empresa',         COALESCE(e.nome_fantasia, e.razao_social),
           'status_contrato', COALESCE(c.status, 'ativo'),
           'pessoas', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'cadastro', p.cadastro, 'nome', p.nome, 'cargo', p.cargo,
                      'situacao', p.situacao, 'admissao', p.admissao)
                    ORDER BY p.situacao = 'Trabalhando' DESC, p.situacao, p.nome)
               FROM pes p WHERE p.contrato_id = c.id), '[]'::jsonb)
         ) ORDER BY c.nome), '[]'::jsonb)
    INTO v_out
    FROM ids
    JOIN public.contratos c ON c.id = ids.id
    LEFT JOIN public.empresas e ON e.id = c.empresa_id;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.decimo_contratos(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decimo_contratos(integer, integer) TO authenticated;

-- ── 4) decimo_agir pelo contrato da Licitação ────────────────────────────
DROP FUNCTION IF EXISTS public.decimo_agir(bigint, bigint, integer, integer, text, numeric, text, text);

CREATE OR REPLACE FUNCTION public.decimo_agir(
  p_contrato_id      uuid,
  p_ano              integer,
  p_parcela          integer,
  p_acao             text,
  p_valor            numeric DEFAULT NULL,
  p_observacao       text    DEFAULT NULL,
  p_status_esperado  text    DEFAULT NULL
)
RETURNS public."SISTEMA_CONFERENCIA_DECIMO"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nome    text := (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid());
  v_linha   public."SISTEMA_CONFERENCIA_DECIMO";
  v_menu    text;
  v_origens text[];
  v_destino text;
  v_de      text;
  v_obs     text := nullif(btrim(coalesce(p_observacao, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão expirada.' USING ERRCODE = '42501'; END IF;
  IF p_parcela NOT IN (1, 2) THEN RAISE EXCEPTION 'Parcela inválida: %', p_parcela; END IF;

  -- Espelho de src/lib/conferenciaDecimo/conferencia.ts (ORIGENS/DESTINO/MENU_DA_ACAO).
  CASE p_acao
    WHEN 'andamento'      THEN v_menu := 'decimo_confirmar_conferencia'; v_origens := ARRAY['Pendente RH','Devolvido RH'];                                   v_destino := 'Em Conferência RH';
    WHEN 'confirmar'      THEN v_menu := 'decimo_confirmar_conferencia'; v_origens := ARRAY['Pendente RH','Em Conferência RH','Devolvido RH'];              v_destino := 'Conferido RH';
    WHEN 'reabrir'        THEN v_menu := 'decimo_confirmar_conferencia'; v_origens := ARRAY['Conferido RH'];                                                v_destino := 'Em Conferência RH';
    WHEN 'informar_valor' THEN v_menu := 'decimo_informar_valor';        v_origens := ARRAY['Pendente RH','Em Conferência RH','Conferido RH','Devolvido RH']; v_destino := NULL;
    WHEN 'liberar'        THEN v_menu := 'decimo_informar_valor';        v_origens := ARRAY['Conferido RH'];                                                v_destino := 'Liberado Financeiro';
    WHEN 'marcar_pago'    THEN v_menu := 'decimo_marcar_pago';           v_origens := ARRAY['Liberado Financeiro','Problema'];                              v_destino := 'Pago';
    WHEN 'devolver_rh'    THEN v_menu := 'decimo_marcar_pago';           v_origens := ARRAY['Liberado Financeiro','Problema'];                              v_destino := 'Devolvido RH';
    WHEN 'problema'       THEN v_menu := 'decimo_marcar_pago';           v_origens := ARRAY['Liberado Financeiro'];                                         v_destino := 'Problema';
    ELSE RAISE EXCEPTION 'Ação desconhecida: %', p_acao;
  END CASE;

  IF NOT public.decimo_tem_chave(v_menu) THEN
    RAISE EXCEPTION 'Você não tem a permissão para esta ação (%).', v_menu USING ERRCODE = '42501';
  END IF;
  IF p_acao IN ('devolver_rh', 'problema') AND length(coalesce(v_obs, '')) < 10 THEN
    RAISE EXCEPTION 'Escreva o motivo (mín. 10 caracteres).';
  END IF;
  IF p_valor IS NOT NULL AND p_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero.'; END IF;
  IF p_acao = 'informar_valor' AND p_valor IS NULL THEN RAISE EXCEPTION 'Informe o valor.'; END IF;

  -- A linha nasce na primeira ação. Contrato novo só se estiver ATIVO na
  -- Licitação; o que já tem linha segue o fluxo mesmo encerrado depois.
  INSERT INTO public."SISTEMA_CONFERENCIA_DECIMO" (contrato_id, contrato_nome, ano, parcela, atualizado_por)
  SELECT c.id, c.nome, p_ano, p_parcela, v_nome
    FROM public.contratos c
   WHERE c.id = p_contrato_id AND COALESCE(c.status, 'ativo') = 'ativo'
  ON CONFLICT (contrato_id, ano, parcela) DO NOTHING;

  SELECT * INTO v_linha FROM public."SISTEMA_CONFERENCIA_DECIMO"
   WHERE contrato_id = p_contrato_id AND ano = p_ano AND parcela = p_parcela
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não está ativo na Licitação.'; END IF;

  v_de := v_linha.status;
  IF p_status_esperado IS NOT NULL AND p_status_esperado <> v_de THEN
    RAISE EXCEPTION 'Alguém mexeu neste contrato enquanto você olhava (agora: %). Recarregue.', v_de USING ERRCODE = '40001';
  END IF;
  IF NOT (v_de = ANY (v_origens)) THEN
    RAISE EXCEPTION 'Esta ação não vale no estado atual do contrato (%).', v_de;
  END IF;

  IF p_valor IS NOT NULL THEN
    v_linha.valor := p_valor; v_linha.valor_origem := 'manual';
    v_linha.valor_por := v_nome; v_linha.valor_em := now();
  END IF;
  IF p_acao = 'liberar' AND coalesce(v_linha.valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe o valor do 13º antes de liberar ao Financeiro.';
  END IF;

  CASE p_acao
    WHEN 'andamento'   THEN v_linha.conferindo_por := v_nome; v_linha.conferindo_em := now();
    WHEN 'reabrir'     THEN v_linha.confirmado_por := NULL;   v_linha.confirmado_em := NULL;
    WHEN 'confirmar'   THEN v_linha.confirmado_por := v_nome; v_linha.confirmado_em := now();
    WHEN 'liberar'     THEN v_linha.liberado_por   := v_nome; v_linha.liberado_em   := now();
    WHEN 'marcar_pago' THEN v_linha.pago_por       := v_nome; v_linha.pago_em       := now();
    WHEN 'devolver_rh' THEN v_linha.devolucao_motivo := v_obs;
                            v_linha.confirmado_por := NULL; v_linha.confirmado_em := NULL;
                            v_linha.liberado_por   := NULL; v_linha.liberado_em   := NULL;
    WHEN 'problema'    THEN v_linha.devolucao_motivo := v_obs;
    ELSE NULL;
  END CASE;

  UPDATE public."SISTEMA_CONFERENCIA_DECIMO" SET
    status           = coalesce(v_destino, status),
    valor            = v_linha.valor,
    valor_origem     = v_linha.valor_origem,
    valor_por        = v_linha.valor_por,        valor_em      = v_linha.valor_em,
    devolucao_motivo = v_linha.devolucao_motivo,
    conferindo_por   = v_linha.conferindo_por,   conferindo_em = v_linha.conferindo_em,
    confirmado_por   = v_linha.confirmado_por,   confirmado_em = v_linha.confirmado_em,
    liberado_por     = v_linha.liberado_por,     liberado_em   = v_linha.liberado_em,
    pago_por         = v_linha.pago_por,         pago_em       = v_linha.pago_em,
    atualizado_por   = v_nome
   WHERE id = v_linha.id
  RETURNING * INTO v_linha;

  INSERT INTO public."SISTEMA_CONFERENCIA_DECIMO_EVENTOS"
    (conferencia_id, acao, de_status, para_status, observacao, usuario_id, usuario_nome)
  VALUES (v_linha.id, p_acao, v_de, v_linha.status,
          coalesce(v_obs, CASE WHEN p_valor IS NOT NULL THEN 'Valor: ' || to_char(p_valor, 'FM999G999G990D00') END),
          auth.uid(), v_nome);

  RETURN v_linha;
END $$;

REVOKE ALL ON FUNCTION public.decimo_agir(uuid, integer, integer, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decimo_agir(uuid, integer, integer, text, numeric, text, text) TO authenticated;

-- ── 5) Importação: a planilha da Senior → contrato da Licitação ─────────
-- p_linhas: [{empresa, filial, cadastro, valor, qtd}] — uma por linha da
-- planilha (por colaborador ou já resumida por filial). O banco soma por
-- contrato. Com p_simular = true não grava: devolve a prévia.
DROP FUNCTION IF EXISTS public.decimo_importar_valores(integer, integer, jsonb, text);

CREATE OR REPLACE FUNCTION public.decimo_importar_valores(
  p_ano      integer,
  p_parcela  integer,
  p_linhas   jsonb,
  p_arquivo  text    DEFAULT NULL,
  p_simular  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nome      text := (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid());
  r           record;
  v_linha     public."SISTEMA_CONFERENCIA_DECIMO";
  v_prev      jsonb;
  v_sem       jsonb;
  v_gravados  int := 0;
  v_travados  jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão expirada.' USING ERRCODE = '42501'; END IF;
  IF NOT public.decimo_tem_chave('decimo_informar_valor') THEN
    RAISE EXCEPTION 'Você não tem a permissão para esta ação (decimo_informar_valor).' USING ERRCODE = '42501';
  END IF;
  IF p_parcela NOT IN (1, 2) THEN RAISE EXCEPTION 'Parcela inválida: %', p_parcela; END IF;
  IF jsonb_typeof(p_linhas) <> 'array' THEN RAISE EXCEPTION 'p_linhas tem que ser uma lista.'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _decimo_imp (
    contrato_id uuid, nome text, status_contrato text, valor numeric, qtd int
  ) ON COMMIT DROP;
  TRUNCATE _decimo_imp;

  WITH
  lin AS (
    SELECT nullif(e->>'empresa', '')::bigint AS empresa,
           nullif(e->>'filial', '')::bigint  AS filial,
           nullif(ltrim(btrim(e->>'cadastro'), '0'), '') AS cadastro,
           (e->>'valor')::numeric AS valor,
           nullif(e->>'qtd', '')::int AS qtd,
           ord
      FROM jsonb_array_elements(p_linhas) WITH ORDINALITY AS t(e, ord)
     WHERE nullif(e->>'valor', '') IS NOT NULL AND (e->>'valor')::numeric <> 0
  ),
  pes AS MATERIALIZED (
    SELECT a.contrato_id, a.empresa, x."Filial"::bigint AS filial,
           nullif(ltrim(btrim(a.cadastro), '0'), '') AS cadastro
      FROM public.rh_ac_ativos() a
      JOIN public."EMPREGADOS" x ON x."ID" = a.empregado_id
     WHERE a.contrato_id IS NOT NULL
  ),
  por_cad AS (
    SELECT DISTINCT ON (empresa, cadastro) empresa, cadastro, contrato_id
      FROM pes WHERE cadastro IS NOT NULL ORDER BY empresa, cadastro, contrato_id
  ),
  -- O contrato em que está a maioria das pessoas da filial.
  por_fil AS (
    SELECT DISTINCT ON (empresa, filial) empresa, filial, contrato_id
      FROM (SELECT empresa, filial, contrato_id, count(*) AS n FROM pes GROUP BY 1, 2, 3) s
     ORDER BY empresa, filial, n DESC, contrato_id
  ),
  por_fil_so AS (
    SELECT DISTINCT ON (filial) filial, contrato_id
      FROM (SELECT filial, contrato_id, count(*) AS n FROM pes GROUP BY 1, 2) s
     ORDER BY filial, n DESC, contrato_id
  ),
  res AS (
    SELECT l.*, COALESCE(pc.contrato_id, pf.contrato_id, CASE WHEN l.empresa IS NULL THEN pfs.contrato_id END) AS contrato_id
      FROM lin l
      LEFT JOIN por_cad pc    ON l.cadastro IS NOT NULL AND pc.empresa = l.empresa AND pc.cadastro = l.cadastro
      LEFT JOIN por_fil pf    ON pf.empresa = l.empresa AND pf.filial = l.filial
      LEFT JOIN por_fil_so pfs ON pfs.filial = l.filial
  ),
  sem AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('empresa', empresa, 'filial', filial, 'cadastro', cadastro, 'valor', valor) ORDER BY ord), '[]'::jsonb) AS j
      FROM res WHERE contrato_id IS NULL
  ),
  agg AS (
    INSERT INTO _decimo_imp (contrato_id, nome, status_contrato, valor, qtd)
    SELECT rs.contrato_id, c.nome, COALESCE(c.status, 'ativo'), round(sum(rs.valor), 2),
           CASE WHEN bool_or(rs.qtd IS NOT NULL) THEN sum(rs.qtd)::int
                -- Por colaborador (toda linha com matrícula): uma pessoa por matrícula.
                WHEN bool_and(rs.cadastro IS NOT NULL) THEN count(DISTINCT rs.cadastro)::int
                WHEN count(*) > 1 THEN count(*)::int END
      FROM res rs JOIN public.contratos c ON c.id = rs.contrato_id
     GROUP BY rs.contrato_id, c.nome, c.status
    RETURNING 1
  )
  SELECT (SELECT j FROM sem), (SELECT count(*) FROM agg) INTO v_sem, v_gravados;
  v_gravados := 0;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'contrato_id', i.contrato_id, 'nome', i.nome, 'valor', i.valor, 'qtd', i.qtd,
           'status_contrato', i.status_contrato,
           'status', COALESCE(d.status, 'Pendente RH'),
           'travado', d.status IS NOT NULL AND d.status NOT IN ('Pendente RH','Em Conferência RH','Conferido RH','Devolvido RH')
                      OR (d.status IS NULL AND i.status_contrato <> 'ativo')
         ) ORDER BY i.nome), '[]'::jsonb)
    INTO v_prev
    FROM _decimo_imp i
    LEFT JOIN public."SISTEMA_CONFERENCIA_DECIMO" d
      ON d.contrato_id = i.contrato_id AND d.ano = p_ano AND d.parcela = p_parcela;

  IF p_simular THEN
    RETURN jsonb_build_object('por_contrato', v_prev, 'sem_contrato', v_sem);
  END IF;

  FOR r IN SELECT * FROM _decimo_imp WHERE valor > 0 LOOP
    IF r.status_contrato = 'ativo' THEN
      INSERT INTO public."SISTEMA_CONFERENCIA_DECIMO" (contrato_id, contrato_nome, ano, parcela, atualizado_por)
      VALUES (r.contrato_id, r.nome, p_ano, p_parcela, v_nome)
      ON CONFLICT (contrato_id, ano, parcela) DO NOTHING;
    END IF;

    SELECT * INTO v_linha FROM public."SISTEMA_CONFERENCIA_DECIMO"
     WHERE contrato_id = r.contrato_id AND ano = p_ano AND parcela = p_parcela FOR UPDATE;
    IF NOT FOUND OR v_linha.status NOT IN ('Pendente RH', 'Em Conferência RH', 'Conferido RH', 'Devolvido RH') THEN
      v_travados := v_travados || jsonb_build_object('contrato', r.nome,
                                                     'status', COALESCE(v_linha.status, 'contrato ' || r.status_contrato));
      CONTINUE;
    END IF;
    IF v_linha.valor IS NOT DISTINCT FROM r.valor AND v_linha.qtd_colaboradores IS NOT DISTINCT FROM r.qtd THEN
      CONTINUE;
    END IF;

    UPDATE public."SISTEMA_CONFERENCIA_DECIMO" SET
      valor = r.valor, qtd_colaboradores = r.qtd,
      valor_origem = 'planilha', planilha_nome = p_arquivo,
      valor_por = v_nome, valor_em = now(), atualizado_por = v_nome
     WHERE id = v_linha.id;

    INSERT INTO public."SISTEMA_CONFERENCIA_DECIMO_EVENTOS"
      (conferencia_id, acao, de_status, para_status, observacao, usuario_id, usuario_nome)
    VALUES (v_linha.id, 'importar_planilha', v_linha.status, v_linha.status,
            'Planilha' || coalesce(' ' || p_arquivo, '') || ': ' || to_char(r.valor, 'FM999G999G990D00')
              || coalesce(' (' || r.qtd || ' colaboradores)', ''),
            auth.uid(), v_nome);
    v_gravados := v_gravados + 1;
  END LOOP;

  RETURN jsonb_build_object('gravados', v_gravados, 'travados', v_travados, 'sem_contrato', v_sem);
END $$;

REVOKE ALL ON FUNCTION public.decimo_importar_valores(integer, integer, jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decimo_importar_valores(integer, integer, jsonb, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (volta à 20261112220000; as linhas novas ficam sem empresa/filial)
--   DROP FUNCTION IF EXISTS public.decimo_importar_valores(integer, integer, jsonb, text, boolean);
--   DROP FUNCTION IF EXISTS public.decimo_agir(uuid, integer, integer, text, numeric, text, text);
--   DROP FUNCTION IF EXISTS public.decimo_contratos(integer, integer);
--   DROP FUNCTION IF EXISTS public.decimo_ve_tela();
--   ALTER TABLE public."SISTEMA_CONFERENCIA_DECIMO" DROP CONSTRAINT IF EXISTS scd_contrato_id_parcela_unico;
--   ALTER TABLE public."SISTEMA_CONFERENCIA_DECIMO" DROP COLUMN IF EXISTS contrato_id;
--   -- e reaplicar as seções 3 e 4 da 20261112220000 (policy contratos_decimo_gate e as duas RPCs antigas)
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
