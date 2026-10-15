-- ============================================================================
-- SIS-2026-0599 — parte 2: acesso de escrita, reuniões de implantação e a
-- carga inicial do contrato-piloto.
--
-- Três coisas que só apareceram com a tela no ar (15/10/2026):
--
-- 1. NINGUÉM conseguia escrever. A mig 20261015000001 semeou a permissão
--    copiando de `licitacoes.implantacao`, e lá quase todo mundo tem só
--    `visualizar` — inclusive o Admin Master. Pior: os 5 menus novos
--    nasceram com `concede_tudo_alcanca = false`, enquanto o menu irmão
--    (`licitacoes.implantacao`) tem `true`, então nem perfil "concede tudo"
--    alcançava. Clicar em "Atualizar da base" devolvia
--    "Sem acesso para atualizar a Base Mestre".
--
-- 2. A Helena pediu (pelo Yuri, na conversa do chamado) para puxar e vincular
--    as reuniões de implantação que já existem. Elas existem — 7 no módulo
--    `reuniao` — mas NÃO têm vínculo com contrato: o que amarra hoje é o
--    nome do contrato escrito no título ("REUNIÃO DE IMPLANTAÇÃO DE CONTRATO
--    - IRGA") e `tipo_reuniao` está como 'outro' em todas. Por isso o
--    vínculo é explícito, escolhido na tela, e não adivinhado por texto:
--    casar por título erraria em silêncio e ninguém saberia dizer por quê.
--
-- 3. A tela nascia zerada. A carga do contrato-piloto vai aqui no fim, para
--    a Base Mestre abrir com dado real sem depender de alguém clicar.
--
-- Idempotente. NÃO se auto-aplica: rodar no SQL Editor do projeto remoto.
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1) Os menus novos passam a ser alcançados por "concede tudo" ────────────
-- Igual ao menu irmão. Não é afrouxar o deny-by-default: quem não tem perfil
-- com concede_tudo continua dependendo de liberação individual.
UPDATE public.app_menu
   SET concede_tudo_alcanca = true
 WHERE codigo IN ('implantacao.base', 'financeiro.inicio_contrato', 'rh.inicio_contrato',
                  'operacional.inicio_contrato', 'suprimentos.inicio_contrato');

-- Quem já edita a Implantação de Contratos passa a editar a Base Mestre.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow)
SELECT s.user_id, 'implantacao.base', s.acao, true
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'licitacoes.implantacao' AND s.allow
   AND s.acao IN ('incluir', 'alterar', 'excluir')
ON CONFLICT DO NOTHING;

-- ── 2) Reuniões de implantação vinculadas ao contrato ───────────────────────
CREATE TABLE IF NOT EXISTS public."IMPLANTACAO_BASE_REUNIAO" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id       uuid NOT NULL REFERENCES public."IMPLANTACAO_BASE"(id) ON DELETE CASCADE,
  empresa_id    uuid NOT NULL,
  reuniao_id    uuid NOT NULL REFERENCES public.reuniao(id) ON DELETE CASCADE,
  observacao    text,
  vinculado_por uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_id, reuniao_id)
);

COMMENT ON TABLE public."IMPLANTACAO_BASE_REUNIAO" IS
  'Liga uma reunião do módulo de reuniões ao contrato em implantação '
  '(SIS-2026-0599, pedido da Helena). O vínculo é escolhido por gente: as '
  'reuniões não guardam contrato_id, e casar pelo título erra em silêncio.';

CREATE INDEX IF NOT EXISTS implantacao_base_reuniao_base_idx ON public."IMPLANTACAO_BASE_REUNIAO" (base_id);

DROP TRIGGER IF EXISTS implantacao_base_reuniao_touch ON public."IMPLANTACAO_BASE_REUNIAO";
CREATE TRIGGER implantacao_base_reuniao_touch
  BEFORE UPDATE ON public."IMPLANTACAO_BASE_REUNIAO"
  FOR EACH ROW EXECUTE FUNCTION public.implantacao_base_touch();

ALTER TABLE public."IMPLANTACAO_BASE_REUNIAO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS implantacao_base_reuniao_select ON public."IMPLANTACAO_BASE_REUNIAO";
CREATE POLICY implantacao_base_reuniao_select ON public."IMPLANTACAO_BASE_REUNIAO"
  FOR SELECT TO authenticated USING (public.implantacao_base_pode_ver());

DROP POLICY IF EXISTS implantacao_base_reuniao_insert ON public."IMPLANTACAO_BASE_REUNIAO";
CREATE POLICY implantacao_base_reuniao_insert ON public."IMPLANTACAO_BASE_REUNIAO"
  FOR INSERT TO authenticated WITH CHECK (public.implantacao_base_pode_escrever());

DROP POLICY IF EXISTS implantacao_base_reuniao_update ON public."IMPLANTACAO_BASE_REUNIAO";
CREATE POLICY implantacao_base_reuniao_update ON public."IMPLANTACAO_BASE_REUNIAO"
  FOR UPDATE TO authenticated USING (public.implantacao_base_pode_escrever())
  WITH CHECK (public.implantacao_base_pode_escrever());

DROP POLICY IF EXISTS implantacao_base_reuniao_delete ON public."IMPLANTACAO_BASE_REUNIAO";
CREATE POLICY implantacao_base_reuniao_delete ON public."IMPLANTACAO_BASE_REUNIAO"
  FOR DELETE TO authenticated USING (public.implantacao_base_pode_escrever());

-- Reuniões JÁ vinculadas, com o resumo do que aconteceu nelas.
-- SECURITY DEFINER de propósito: quem monta a implantação enxerga só este
-- recorte das reuniões, sem precisar de acesso ao módulo de Reuniões —
-- mesma fronteira de `implantacao_origem_contrato`.
CREATE OR REPLACE FUNCTION public.implantacao_base_reunioes(p_contrato_id uuid)
RETURNS TABLE (
  vinculo_id uuid, reuniao_id uuid, numero text, titulo text, data_hora timestamptz,
  etapa text, tipo_reuniao text, duracao_minutos integer,
  qt_pauta integer, qt_decisoes integer, qt_acoes integer, qt_acoes_pendentes integer,
  qt_participantes integer, tem_ata boolean, observacao text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.id, r.id, r.numero, r.titulo, r.data_hora, r.etapa, r.tipo_reuniao, r.duracao_minutos,
         (SELECT count(*)::int FROM public.reuniao_pauta p WHERE p.reuniao_id = r.id),
         (SELECT count(*)::int FROM public.reuniao_decisao_acao d
            JOIN public.reuniao_pauta p ON p.id = d.pauta_id
           WHERE p.reuniao_id = r.id AND d.tipo = 'decisao'),
         (SELECT count(*)::int FROM public.reuniao_decisao_acao d
            JOIN public.reuniao_pauta p ON p.id = d.pauta_id
           WHERE p.reuniao_id = r.id AND d.tipo <> 'decisao'),
         (SELECT count(*)::int FROM public.reuniao_decisao_acao d
            JOIN public.reuniao_pauta p ON p.id = d.pauta_id
           WHERE p.reuniao_id = r.id AND d.tipo <> 'decisao'
             AND COALESCE(d.status, 'pendente') NOT IN ('concluido', 'concluida', 'cancelado')),
         (SELECT count(*)::int FROM public.reuniao_convidado c WHERE c.reuniao_id = r.id),
         r.pdf_final_storage_path IS NOT NULL,
         v.observacao
    FROM public."IMPLANTACAO_BASE_REUNIAO" v
    JOIN public."IMPLANTACAO_BASE" b ON b.id = v.base_id AND b.contrato_id = p_contrato_id
    JOIN public.reuniao r ON r.id = v.reuniao_id
   WHERE public.implantacao_base_pode_ver()
   ORDER BY r.data_hora DESC NULLS LAST;
$$;

-- Candidatas para vincular. Sugere por nome do contrato no título (é o único
-- laço que existe hoje), mas quem decide é quem está na tela.
CREATE OR REPLACE FUNCTION public.implantacao_base_reunioes_disponiveis(p_contrato_id uuid, p_busca text DEFAULT NULL)
RETURNS TABLE (reuniao_id uuid, numero text, titulo text, data_hora timestamptz, etapa text, sugerida boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cliente text;
  v_nome    text;
BEGIN
  IF NOT public.implantacao_base_pode_ver() THEN
    RETURN;
  END IF;

  SELECT c.cliente, c.nome INTO v_cliente, v_nome FROM public.contratos c WHERE c.id = p_contrato_id;

  RETURN QUERY
  SELECT r.id, r.numero, r.titulo, r.data_hora, r.etapa,
         -- "sugerida" é dica visual, não vínculo: parece ser deste contrato.
         (r.titulo ILIKE '%implanta%'
           AND (v_cliente IS NOT NULL AND r.titulo ILIKE '%' || split_part(v_cliente, ' ', 1) || '%'
             OR v_nome    IS NOT NULL AND r.titulo ILIKE '%' || split_part(v_nome, ' ', 1) || '%'))
    FROM public.reuniao r
   WHERE (p_busca IS NULL OR p_busca = '' OR r.titulo ILIKE '%' || p_busca || '%' OR r.numero ILIKE '%' || p_busca || '%')
     AND NOT EXISTS (
       SELECT 1 FROM public."IMPLANTACAO_BASE_REUNIAO" v
         JOIN public."IMPLANTACAO_BASE" b ON b.id = v.base_id AND b.contrato_id = p_contrato_id
        WHERE v.reuniao_id = r.id)
   ORDER BY 6 DESC, r.data_hora DESC NULLS LAST
   LIMIT 50;
END;
$$;

CREATE OR REPLACE FUNCTION public.implantacao_base_reuniao_vincular(
  p_contrato_id uuid, p_reuniao_id uuid, p_observacao text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base uuid;
  v_emp  uuid;
  v_id   uuid;
BEGIN
  IF NOT public.implantacao_base_pode_escrever() THEN
    RAISE EXCEPTION 'Sem acesso para vincular reunião à Base Mestre';
  END IF;

  SELECT c.empresa_id INTO v_emp FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Contrato % não encontrado', p_contrato_id;
  END IF;

  INSERT INTO public."IMPLANTACAO_BASE" (empresa_id, contrato_id)
       VALUES (v_emp, p_contrato_id)
  ON CONFLICT (contrato_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_base;

  INSERT INTO public."IMPLANTACAO_BASE_REUNIAO" (base_id, empresa_id, reuniao_id, observacao, vinculado_por)
       VALUES (v_base, v_emp, p_reuniao_id, p_observacao, auth.uid())
  ON CONFLICT (base_id, reuniao_id) DO UPDATE SET observacao = EXCLUDED.observacao, updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.implantacao_base_reuniao_desvincular(p_vinculo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.implantacao_base_pode_escrever() THEN
    RAISE EXCEPTION 'Sem acesso para desvincular reunião da Base Mestre';
  END IF;
  DELETE FROM public."IMPLANTACAO_BASE_REUNIAO" t WHERE t.id = p_vinculo_id;
END;
$$;

-- O hub conta as reuniões junto com as outras bases. O retorno ganhou uma
-- coluna, e Postgres não troca coluna OUT com CREATE OR REPLACE — precisa de
-- DROP. Nenhum objeto de banco depende desta função: só o hook do frontend,
-- via PostgREST.
DROP FUNCTION IF EXISTS public.implantacao_base_resumo(uuid);

CREATE FUNCTION public.implantacao_base_resumo(p_contrato_id uuid)
RETURNS TABLE (
  base_id uuid, contrato_nome text, cliente text, cnpj_contratante text, objeto text,
  valor_mensal numeric, qt_postos integer, qt_colaboradores integer,
  qt_locais integer, qt_cidades integer, qt_tipos_servico integer,
  qt_itens_uniforme integer, qt_itens_material integer,
  qt_prazos integer, qt_documentos integer, qt_reunioes integer,
  situacao text, sincronizado_em timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, c.nome, c.cliente, b.cnpj_contratante, COALESCE(b.objeto, ce.objeto),
         b.valor_mensal, b.qt_postos, b.qt_colaboradores,
         (SELECT count(DISTINCT l.local_nome)::int FROM public."IMPLANTACAO_BASE_LOCAL" l WHERE l.base_id = b.id),
         (SELECT count(DISTINCT l.cidade)::int     FROM public."IMPLANTACAO_BASE_LOCAL" l WHERE l.base_id = b.id AND l.cidade IS NOT NULL),
         (SELECT count(DISTINCT p.tipo_servico)::int FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = b.id),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_ITEM" i WHERE i.base_id = b.id AND i.tipo IN ('uniforme', 'epi')),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_ITEM" i WHERE i.base_id = b.id AND i.tipo NOT IN ('uniforme', 'epi')),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_PRAZO" x WHERE x.base_id = b.id),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_DOC"   x WHERE x.base_id = b.id),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_REUNIAO" x WHERE x.base_id = b.id),
         b.situacao, b.sincronizado_em
    FROM public."IMPLANTACAO_BASE" b
    JOIN public.contratos c ON c.id = b.contrato_id
    LEFT JOIN public.capa_edital ce ON ce.contrato_id = c.id
   WHERE b.contrato_id = p_contrato_id
     AND public.implantacao_base_pode_ver();
$$;

-- ── 2.1) Semear: corrigir a leitura da Planilha de Custo ───────────────────
-- A mig 20261015000001 lia planilha_custo direto, e isso estava ERRADO: a
-- tabela guarda QUATRO linhas por posto — duas vigências (2026-06-23 e
-- 2026-07-01, revisão de salário) × duas versões (orexec ORÇADO e EXECUTADO).
-- Somando cru, o contrato-piloto dava 708 postos. Filtrando a vigência mais
-- recente e uma versão: 48 tipos de posto e 177 pessoas — os números que o
-- mockup do chamado mostra.
--
-- E um detalhe que vale escrito: `planilha_custo.qt_postos` conta GENTE (177),
-- não postos (170). Os dois números só se separam na planilha do Yuri, na
-- coluna "Nº DE POSTOS". Enquanto ela não for importada, os dois indicadores
-- mostram 177; a importação (origem 'planilha') corrige para 170/177.
CREATE OR REPLACE FUNCTION public.implantacao_base_semear(p_contrato_id uuid)
RETURNS TABLE (base_id uuid, postos integer, locais integer, itens integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base    uuid;
  v_emp     uuid;
  v_postos  integer := 0;
  v_locais  integer := 0;
  v_itens   integer := 0;
BEGIN
  IF NOT public.implantacao_base_pode_escrever() THEN
    RAISE EXCEPTION 'Sem acesso para atualizar a Base Mestre de Início de Contrato';
  END IF;

  SELECT c.empresa_id INTO v_emp FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Contrato % não encontrado', p_contrato_id;
  END IF;

  INSERT INTO public."IMPLANTACAO_BASE" AS b (empresa_id, contrato_id, implantacao_id, cnpj_contratante,
                                              valor_mensal, qt_postos, qt_colaboradores, sincronizado_em)
  SELECT c.empresa_id, c.id,
         (SELECT ic.id FROM public.implantacao_contrato ic WHERE ic.contrato_id = c.id LIMIT 1),
         c.cnpj_cliente, c.valor_mensal_contratado, 0, 0, now()
    FROM public.contratos c WHERE c.id = p_contrato_id
  ON CONFLICT (contrato_id) DO UPDATE
    SET cnpj_contratante = EXCLUDED.cnpj_contratante,
        valor_mensal     = EXCLUDED.valor_mensal,
        implantacao_id   = COALESCE(b.implantacao_id, EXCLUDED.implantacao_id),
        sincronizado_em  = now()
  RETURNING b.id INTO v_base;

  DELETE FROM public."IMPLANTACAO_BASE_POSTO" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_POSTO"
    (base_id, empresa_id, ordem, tipo_servico, tipo_posto, qt_postos, qt_funcionarios,
     salario_base, sindicato, insalubridade, planilha_custo_id, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY pc.posto),
         pc.posto, pc.servico, COALESCE(pc.qt_postos, 0), COALESCE(pc.qt_postos, 0),
         pc.salario, pc.sindicato, pc.insalubridade, pc.id, 'base'
    FROM (
      SELECT DISTINCT ON (upper(p.posto)) p.*
        FROM public.planilha_custo p
       WHERE p.contrato_id = p_contrato_id AND NOT COALESCE(p.encerrado, false)
       ORDER BY upper(p.posto), p.data_vigencia DESC NULLS LAST,
                (p.orexec = 'ORÇADO') DESC, p.created_at DESC
    ) pc
   WHERE NOT EXISTS (SELECT 1 FROM public."IMPLANTACAO_BASE_POSTO" x
                      WHERE x.base_id = v_base AND x.origem <> 'base'
                        AND upper(x.tipo_servico) = upper(pc.posto));
  GET DIAGNOSTICS v_postos = ROW_COUNT;

  DELETE FROM public."IMPLANTACAO_BASE_LOCAL" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_LOCAL"
    (base_id, empresa_id, ordem, local_nome, cidade, endereco, qt_postos, qt_funcionarios, sup_posto_id, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY sp.nome), sp.nome,
         loc.municipio,
         NULLIF(trim(concat_ws(', ', loc.logradouro, loc.numero, loc.bairro)), ''),
         0, COALESCE(loc.qt_pessoas_orcadas, 0), sp.id, 'base'
    FROM public.sup_posto sp
    LEFT JOIN LATERAL (
      SELECT l.* FROM public.planilha_posto_localizacao l
       JOIN public.planilha_custo pc ON pc.id = l.planilha_custo_id AND pc.contrato_id = p_contrato_id
      WHERE upper(l.nome) = upper(sp.nome) LIMIT 1
    ) loc ON true
   WHERE sp.contrato_id = p_contrato_id AND sp.ativo
     AND NOT EXISTS (SELECT 1 FROM public."IMPLANTACAO_BASE_LOCAL" x
                      WHERE x.base_id = v_base AND x.origem <> 'base'
                        AND upper(x.local_nome) = upper(sp.nome));
  GET DIAGNOSTICS v_locais = ROW_COUNT;

  DELETE FROM public."IMPLANTACAO_BASE_ITEM" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_ITEM"
    (base_id, empresa_id, ordem, cargo, sup_funcao_id, item_id, descricao, tipo, quantidade, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY f.nome, i.nome),
         f.nome, f.id, i.id, i.nome, i.tipo, COALESCE(fi.quantidade, 0), 'base'
    FROM public.sup_funcao f
    JOIN public.sup_posto  sp ON sp.id = f.posto_id AND sp.contrato_id = p_contrato_id
    JOIN public.sup_funcao_item fi ON fi.funcao_id = f.id AND fi.ativo
    JOIN public.sup_item   i  ON i.id = fi.item_id AND i.ativo
   WHERE f.ativo
     AND NOT EXISTS (SELECT 1 FROM public."IMPLANTACAO_BASE_ITEM" x
                      WHERE x.base_id = v_base AND x.origem <> 'base'
                        AND x.item_id = i.id AND upper(x.cargo) = upper(f.nome));
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  UPDATE public."IMPLANTACAO_BASE" b
     SET qt_postos        = COALESCE((SELECT sum(p.qt_postos)       FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         qt_colaboradores = COALESCE((SELECT sum(p.qt_funcionarios) FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         sincronizado_em  = now()
   WHERE b.id = v_base;

  RETURN QUERY SELECT v_base, v_postos, v_locais, v_itens;
END;
$$;

-- ── 3) Carga inicial do contrato-piloto ─────────────────────────────────────
-- O mesmo que o botão "Atualizar da base" faz, rodado aqui uma vez para a
-- tela não nascer vazia. Sem o gate de permissão porque quem roda migration
-- é o dono do banco, não um usuário logado. Só o contrato do chamado.
DO $$
DECLARE
  v_contrato uuid := '3918b9ef-ea35-415a-b9f1-9790c863da7f';  -- POLÍCIA CIVIL RS LIMPEZA - 066/2026
  v_base     uuid;
  v_emp      uuid;
BEGIN
  SELECT c.empresa_id INTO v_emp FROM public.contratos c WHERE c.id = v_contrato;
  IF v_emp IS NULL THEN
    RAISE NOTICE 'Contrato-piloto não existe neste banco; carga inicial ignorada.';
    RETURN;
  END IF;

  INSERT INTO public."IMPLANTACAO_BASE" AS b (empresa_id, contrato_id, cnpj_contratante, valor_mensal, sincronizado_em)
  SELECT c.empresa_id, c.id, c.cnpj_cliente, c.valor_mensal_contratado, now()
    FROM public.contratos c WHERE c.id = v_contrato
  ON CONFLICT (contrato_id) DO UPDATE SET sincronizado_em = now()
  RETURNING b.id INTO v_base;

  DELETE FROM public."IMPLANTACAO_BASE_POSTO" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_POSTO"
    (base_id, empresa_id, ordem, tipo_servico, tipo_posto, qt_postos, qt_funcionarios,
     salario_base, sindicato, insalubridade, planilha_custo_id, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY pc.posto),
         pc.posto, pc.servico, COALESCE(pc.qt_postos, 0), COALESCE(pc.qt_postos, 0),
         pc.salario, pc.sindicato, pc.insalubridade, pc.id, 'base'
    FROM (
      SELECT DISTINCT ON (upper(p.posto)) p.*
        FROM public.planilha_custo p
       WHERE p.contrato_id = v_contrato AND NOT COALESCE(p.encerrado, false)
       ORDER BY upper(p.posto), p.data_vigencia DESC NULLS LAST,
                (p.orexec = 'ORÇADO') DESC, p.created_at DESC
    ) pc;

  DELETE FROM public."IMPLANTACAO_BASE_LOCAL" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_LOCAL"
    (base_id, empresa_id, ordem, local_nome, cidade, endereco, qt_postos, qt_funcionarios, sup_posto_id, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY sp.nome), sp.nome,
         loc.municipio,
         NULLIF(trim(concat_ws(', ', loc.logradouro, loc.numero, loc.bairro)), ''),
         0, COALESCE(loc.qt_pessoas_orcadas, 0), sp.id, 'base'
    FROM public.sup_posto sp
    LEFT JOIN LATERAL (
      SELECT l.* FROM public.planilha_posto_localizacao l
       JOIN public.planilha_custo pc ON pc.id = l.planilha_custo_id AND pc.contrato_id = v_contrato
      WHERE upper(l.nome) = upper(sp.nome) LIMIT 1
    ) loc ON true
   WHERE sp.contrato_id = v_contrato AND sp.ativo;

  DELETE FROM public."IMPLANTACAO_BASE_ITEM" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_ITEM"
    (base_id, empresa_id, ordem, cargo, sup_funcao_id, item_id, descricao, tipo, quantidade, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY f.nome, i.nome),
         f.nome, f.id, i.id, i.nome, i.tipo, COALESCE(fi.quantidade, 0), 'base'
    FROM public.sup_funcao f
    JOIN public.sup_posto  sp ON sp.id = f.posto_id AND sp.contrato_id = v_contrato
    JOIN public.sup_funcao_item fi ON fi.funcao_id = f.id AND fi.ativo
    JOIN public.sup_item   i  ON i.id = fi.item_id AND i.ativo
   WHERE f.ativo;

  UPDATE public."IMPLANTACAO_BASE" b
     SET qt_postos        = COALESCE((SELECT sum(p.qt_postos)       FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         qt_colaboradores = COALESCE((SELECT sum(p.qt_funcionarios) FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0)
   WHERE b.id = v_base;

  RAISE NOTICE 'Carga inicial do contrato-piloto concluída.';
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- DELETE FROM public."IMPLANTACAO_BASE" WHERE contrato_id = '3918b9ef-ea35-415a-b9f1-9790c863da7f';
-- DROP FUNCTION IF EXISTS public.implantacao_base_reuniao_desvincular(uuid),
--   public.implantacao_base_reuniao_vincular(uuid, uuid, text),
--   public.implantacao_base_reunioes_disponiveis(uuid, text),
--   public.implantacao_base_reunioes(uuid);
-- DROP TABLE IF EXISTS public."IMPLANTACAO_BASE_REUNIAO";
-- UPDATE public.app_menu SET concede_tudo_alcanca = false
--  WHERE codigo IN ('implantacao.base','financeiro.inicio_contrato','rh.inicio_contrato',
--                   'operacional.inicio_contrato','suprimentos.inicio_contrato');
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'implantacao.base' AND acao IN ('incluir','alterar','excluir');
-- (a versão anterior de implantacao_base_resumo, sem qt_reunioes, está na mig 20261015000001)
-- NOTIFY pgrst, 'reload schema';
