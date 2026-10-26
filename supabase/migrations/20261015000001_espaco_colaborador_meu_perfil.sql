-- =========================================================================
-- ESPAÇO DO COLABORADOR — "Meu perfil" (15/10/2026)
--
-- Pablo: "ao clicar em espaço do colaborador, vai aparecer o meu perfil.
-- Minha gestão de ponto, meus treinamentos, minhas férias, meus afastamentos,
-- minhas advertências, meus cursos, todo meu histórico completo, o crachá e
-- materiais também."
--
--   1. esp_col_exige_acesso(p_empregado_id): a PRÓPRIA pessoa (EMPREGADOS.
--      auth_user_id = auth.uid()) passa sem a tela do Espaço do Colaborador;
--      para os outros, a regra continua a mesma (has_screen_access). Ficha,
--      histórico e ponto passam a usar essa versão.
--      Na ficha, o atalho "é a própria pessoa" só vale pelo ID — a matrícula
--      ("Cadastro") se repete entre empresas e casaria outra pessoa.
--   2. esp_col_perfil(p_empregado_id): o que faltava na ficha, num jsonb só —
--      férias (solicitações + saldo de venda), treinamentos (conclusões),
--      cursos (matrículas, progresso, certificado), afastamento ATUAL (o
--      espelho só tem a situação de hoje da Senior, não o histórico),
--      admissão (candidatura) e a foto do crachá.
--   3. Storage sup-crachas: quem pode ver a ficha vê a foto do crachá — a
--      própria pessoa a dela, e quem tem o Espaço do Colaborador as dos outros.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 1. Acesso: a própria pessoa ou quem tem a tela ─────────────────────────
CREATE OR REPLACE FUNCTION public.esp_col_eh_proprio(p_empregado_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND p_empregado_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public."EMPREGADOS" e WHERE e."ID" = p_empregado_id AND e.auth_user_id = auth.uid());
$fn$;
REVOKE ALL ON FUNCTION public.esp_col_eh_proprio(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_eh_proprio(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.esp_col_exige_acesso(p_empregado_id bigint)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF public.esp_col_eh_proprio(p_empregado_id) THEN RETURN auth.uid(); END IF;
  RETURN public.esp_col_exige_acesso();
END $fn$;
REVOKE ALL ON FUNCTION public.esp_col_exige_acesso(bigint) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.esp_col_ficha(p_ref text)
 RETURNS TABLE(empregado_id bigint, matricula text, nome text, cargo text, posto text, local text, filial text, empresa text, setor text, situacao text, admissao date, escala text, nivel text, contrato_id uuid, contrato_nome text, supervisor_nome text, supervisor_ativo boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ref text := btrim(COALESCE(p_ref, ''));
  v_num bigint;
  v_proprio boolean;
BEGIN
  v_num := CASE WHEN v_ref ~ '^[0-9]+$' THEN v_ref::bigint ELSE NULL END;
  -- A própria pessoa só pelo ID (a matrícula se repete entre empresas).
  v_proprio := public.esp_col_eh_proprio(v_num);
  IF NOT v_proprio THEN PERFORM public.esp_col_exige_acesso(); END IF;
  IF v_ref = '' THEN RETURN; END IF;

  RETURN QUERY
  SELECT e."ID"::bigint,
         nullif(btrim(e."Cadastro"::text), ''),
         e."Nome",
         e."Título do Cargo",
         e."Nome do Posto",
         e."Descrição do Local",
         e."Nome Filial",
         e."Nome da Empresa",
         e."Setor_ERP",
         e."Situação",
         public.rh_data(e."Admissão"::text),
         e."Escala",
         btrim(COALESCE(e."LIDER", '')),
         ct.id,
         ct.nome,
         sup.nome_sup,
         sup.ativo_sup
    FROM public."EMPREGADOS" e
    LEFT JOIN public.contratos ct
           ON ct.id = public.esp_col_contrato_id(e."Descrição do Local", e."Nome Filial")
    -- LEFT JOIN LATERAL para o supervisor do contrato DA PESSOA. Designação
    -- do contrato inteiro (posto IS NULL) — a de posto é do encarregado.
    LEFT JOIN LATERAL (
      SELECT COALESCE(es."Nome", d.empregado_nome) AS nome_sup,
             COALESCE(public.esp_col_esta_ativo(es."Situação"), false) AS ativo_sup
        FROM public.operacao_designacao d
        LEFT JOIN public."EMPREGADOS" es ON es."ID" = d.empregado_id
       WHERE d.contrato_id = ct.id
         AND d.papel = 'supervisor'
         AND d.posto IS NULL
         AND d.vigente_ate IS NULL
       LIMIT 1
    ) sup ON true
   WHERE (NOT v_proprio AND btrim(e."Cadastro"::text) = v_ref)
      OR (v_num IS NOT NULL AND e."ID" = v_num)
   ORDER BY (btrim(e."Cadastro"::text) = v_ref AND NOT v_proprio) DESC
   LIMIT 1;
END $function$;

CREATE OR REPLACE FUNCTION public.esp_col_historico(p_empregado_id bigint)
 RETURNS TABLE(origem text, origem_id text, protocolo text, data_ref timestamp with time zone, titulo text, detalhe text, status text, extra jsonb)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cad text;
BEGIN
  PERFORM public.esp_col_exige_acesso(p_empregado_id);
  IF p_empregado_id IS NULL THEN RETURN; END IF;

  SELECT nullif(btrim(e."Cadastro"::text), '') INTO v_cad
    FROM public."EMPREGADOS" e WHERE e."ID" = p_empregado_id;

  RETURN QUERY
  SELECT 'advertencia'::text, a.id::text, a.id::text,
         COALESCE(a.data_ocorrido::timestamptz, a.created_at),
         COALESCE(a.tipo_advertencia, 'Advertência'),
         a.descricao_ocorrido, a.status,
         jsonb_build_object('grau', a.grau, 'resultado', a.resultado,
           'contrato', a.contrato, 'solicitante', a.solicitante_nome,
           'aprovado_por', a.aprovado_por_nome, 'parecer_juridico', a.parecer_juridico)
    FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
   WHERE a.colaborador_id = p_empregado_id

  UNION ALL
  SELECT 'troca_funcao'::text, t.id::text, t.id::text,
         COALESCE(t.data_pretendida::timestamptz, t.criado_em),
         COALESCE(t.cargo_atual, '—') || ' → ' || t.cargo_novo,
         t.motivo, t.status,
         jsonb_build_object('cargo_atual', t.cargo_atual, 'cargo_novo', t.cargo_novo,
           'posto', t.posto, 'filial', t.filial, 'solicitante', t.solicitante_nome,
           'aprovador', t.aprovador_nome, 'rh_em', t.rh_em)
    FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" t
   WHERE t.colaborador_id = p_empregado_id

  UNION ALL
  -- Dois caminhos até a pessoa. O id é a prova de que ela foi ESCOLHIDA na
  -- lista; a matrícula é o que existe nos 1.443 pedidos anteriores a essa
  -- funcionalidade. `vinculo` no extra diz por qual caminho veio, para
  -- ninguém tratar um casamento por texto como se fosse referência.
  SELECT 'material'::text, pd.id::text, pd.pedido_id, pd.created_at,
         'Uniformes / EPI'::text,
         (SELECT string_agg(i.quantidade || '× ' || i.nome_item
                            || COALESCE(' (' || i.tamanho || ')', ''), ', '
                            ORDER BY i.ordem, i.nome_item)
            FROM public.sup_pedido_item i WHERE i.pedido_id = pd.id),
         pd.status,
         jsonb_build_object('contrato', pd.contrato_nome, 'posto', pd.posto_nome,
           'funcao', pd.funcao_nome,
           'vinculo', CASE WHEN pd.colaborador_empregado_id = p_empregado_id
                           THEN 'colaborador escolhido na lista'
                           ELSE 'casado pela matrícula ' || COALESCE(v_cad,'?') END,
           'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                              'id', i.id, 'nome', i.nome_item, 'tipo', i.tipo_item,
                              'tamanho', i.tamanho, 'quantidade', i.quantidade)
                              ORDER BY i.ordem, i.nome_item), '[]'::jsonb)
                       FROM public.sup_pedido_item i WHERE i.pedido_id = pd.id))
    FROM public.sup_pedido pd
   WHERE pd.colaborador_empregado_id = p_empregado_id
      OR (pd.colaborador_empregado_id IS NULL
          AND v_cad IS NOT NULL
          AND btrim(pd.matricula_colaborador) = v_cad)

  ORDER BY 4 DESC NULLS LAST;
END $function$;

CREATE OR REPLACE FUNCTION public.esp_col_marcacoes(p_empregado_id bigint, p_ano integer, p_mes integer)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cad    bigint;
  v_emp    int;
  v_de     date;
  v_ate    date;
  v_linhas jsonb;
BEGIN
  -- Fora do bloco com EXCEPTION abaixo: sem acesso tem que ser ERRO, não
  -- "ponto indisponível".
  PERFORM public.esp_col_exige_acesso(p_empregado_id);
  RETURN public.esp_col_marcacoes_ler(p_empregado_id, p_ano, p_mes);
END $function$;

-- O corpo antigo de esp_col_marcacoes, sem a checagem (só é chamado depois dela).
CREATE OR REPLACE FUNCTION public.esp_col_marcacoes_ler(p_empregado_id bigint, p_ano integer, p_mes integer)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cad    bigint;
  v_emp    int;
  v_de     date;
  v_ate    date;
  v_linhas jsonb;
BEGIN
  IF to_regclass('espelho."BiMarcacoes"') IS NULL THEN
    RETURN jsonb_build_object('disponivel', false, 'linhas', '[]'::jsonb,
      'motivo', 'O espelho do relógio de ponto (espelho."BiMarcacoes") não está no banco.');
  END IF;

  SELECT CASE WHEN btrim(e."Cadastro"::text) ~ '^[0-9]+$' THEN btrim(e."Cadastro"::text)::bigint END,
         CASE WHEN btrim(e."Empresa"::text)  ~ '^[0-9]+$' THEN btrim(e."Empresa"::text)::int    END
    INTO v_cad, v_emp
    FROM public."EMPREGADOS" e
   WHERE e."ID" = p_empregado_id;

  IF v_cad IS NULL THEN
    RETURN jsonb_build_object('disponivel', false, 'linhas', '[]'::jsonb,
      'motivo', 'Colaborador sem matrícula numérica no cadastro — não há como casar com o relógio de ponto.');
  END IF;

  v_de  := make_date(p_ano, p_mes, 1);
  v_ate := (v_de + interval '1 month')::date;

  -- `matricula % 100000000`: o relógio grava ora a matrícula pura (3997),
  -- ora prefixada pela empresa (100006983 = 1×1e8 + 6983). A empresa entra
  -- no filtro porque "Cadastro" se repete entre filiais.
  EXECUTE $q$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('data', d, 'minutos', h) ORDER BY d, h), '[]'::jsonb)
      FROM (
        SELECT DISTINCT m.data_hora::date AS d, m.hora AS h
          FROM espelho."BiMarcacoes" m
         WHERE (m.matricula % 100000000) = $1
           AND ($2 IS NULL OR m.empresa = $2)
           AND m.data_hora >= $3 AND m.data_hora < $4
      ) s
  $q$
  INTO v_linhas USING v_cad, v_emp, v_de, v_ate;

  RETURN jsonb_build_object(
    'disponivel', true,
    'matricula',  v_cad::text,
    'linhas',     COALESCE(v_linhas, '[]'::jsonb));

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('disponivel', false, 'linhas', '[]'::jsonb,
    'motivo', 'Falha ao ler o espelho do ponto: ' || SQLERRM);
END $function$;
REVOKE ALL ON FUNCTION public.esp_col_marcacoes_ler(bigint, integer, integer) FROM PUBLIC, anon, authenticated;

-- ── 2. O resto do perfil ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.esp_col_perfil(p_empregado_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  e        public."EMPREGADOS";
  v_ferias jsonb; v_saldo jsonb; v_trein jsonb; v_cursos jsonb; v_adm jsonb;
  v_afast  jsonb; v_foto text; v_foto_origem text;
BEGIN
  PERFORM public.esp_col_exige_acesso(p_empregado_id);
  SELECT * INTO e FROM public."EMPREGADOS" WHERE "ID" = p_empregado_id;
  IF e."ID" IS NULL THEN RETURN NULL; END IF;

  -- Férias: as solicitações (inclusive a venda sem tirar, mig 20261014000043) + o saldo.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'tipo', coalesce(f.tipo, 'ferias'), 'status', f.status,
           'data_saida', f.data_saida, 'data_retorno', f.data_retorno,
           'dias_ferias', f.dias_ferias, 'dias_vendidos', f.dias_vendidos,
           'criado_em', f.criado_em, 'solicitante', f.solicitante_nome) ORDER BY f.criado_em DESC), '[]'::jsonb)
    INTO v_ferias
    FROM public."SISTEMA_SOLICITACOES_FERIAS" f WHERE f.colaborador_id = p_empregado_id;
  BEGIN
    v_saldo := to_jsonb(public.ferias_saldo(p_empregado_id, NULL));
  EXCEPTION WHEN OTHERS THEN v_saldo := NULL;
  END;

  -- Treinamentos do ERP (TREINAMENTOS): por login — só quem tem login no ERP faz.
  IF e.auth_user_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'titulo', t.titulo, 'tipo', t.tipo, 'tem_prova', coalesce(t.prova IS NOT NULL AND t.prova::text NOT IN ('null', '[]', '{}'), false),
             'concluido_em', c.concluido_em, 'aprovado', c.aprovado, 'nota', c.prova_nota, 'tentativas', c.tentativas,
             'visto_em', v.ultima_em) ORDER BY coalesce(c.concluido_em, v.ultima_em) DESC NULLS LAST, t.titulo), '[]'::jsonb)
      INTO v_trein
      FROM public."TREINAMENTOS" t
      LEFT JOIN public."TREINAMENTO_CONCLUSAO" c ON c.treinamento_id = t.id AND c.user_id = e.auth_user_id
      LEFT JOIN LATERAL (SELECT max(x.ultima_em) ultima_em FROM public."TREINAMENTO_VISUALIZACAO" x
                          WHERE x.treinamento_id = t.id AND x.user_id = e.auth_user_id) v ON true
     WHERE c.id IS NOT NULL OR v.ultima_em IS NOT NULL;
  END IF;

  -- Cursos (Portal de Treinamentos / TRN_*): pelo aluno vinculado ao cadastro.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'curso_id', cu.id, 'curso', cu.nome, 'inscrito_em', m.inscrito_em,
           'aulas', tot.n, 'concluidas', feitas.n,
           'certificado_em', ce.emitido_em, 'certificado_codigo', ce.codigo_validacao,
           'carga_horaria_min', coalesce(ce.carga_horaria_min, cu.carga_horaria_min)) ORDER BY m.inscrito_em DESC), '[]'::jsonb)
    INTO v_cursos
    FROM public."TRN_ALUNO" a
    JOIN public."TRN_MATRICULA" m ON m.aluno_id = a.id
    JOIN public."TRN_CURSO" cu ON cu.id = m.curso_id
    LEFT JOIN LATERAL (SELECT count(*) n FROM public."TRN_AULA" au JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id
                        WHERE mo.curso_id = cu.id AND au.publicada) tot ON true
    LEFT JOIN LATERAL (SELECT count(*) n FROM public."TRN_PROGRESSO" p JOIN public."TRN_AULA" au ON au.id = p.aula_id
                         JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id
                        WHERE p.aluno_id = a.id AND mo.curso_id = cu.id AND p.concluida) feitas ON true
    LEFT JOIN LATERAL (SELECT * FROM public."TRN_CERTIFICADO" x WHERE x.aluno_id = a.id AND x.curso_id = cu.id ORDER BY x.emitido_em DESC LIMIT 1) ce ON true
   WHERE a.empregado_id = p_empregado_id;

  -- Admissão: a candidatura que virou este cadastro.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'candidato_id', c.id, 'vaga_id', c.vaga_id, 'cargo', s.cargo, 'contrato', s.contrato,
           'candidatura_em', c.created_at, 'admitido_em', c.admitido_em, 'etapa', c.etapa_processo) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_adm
    FROM public."WA_CURRICULOS" c LEFT JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = c.vaga_id
   WHERE c.empregado_id = p_empregado_id;

  -- Foto do crachá: a do Recrutamento (mig 20261014000045), senão a do pedido de materiais.
  SELECT c.cracha_foto_path, 'recrutamento' INTO v_foto, v_foto_origem
    FROM public."WA_CURRICULOS" c WHERE c.empregado_id = p_empregado_id AND c.cracha_foto_path IS NOT NULL
   ORDER BY c.created_at DESC LIMIT 1;
  IF v_foto IS NULL THEN
    SELECT pd.imagem_cracha_path, 'pedido ' || pd.pedido_id INTO v_foto, v_foto_origem
      FROM public.sup_pedido pd
     WHERE nullif(btrim(pd.imagem_cracha_path), '') IS NOT NULL
       AND (pd.colaborador_empregado_id = p_empregado_id
            OR (pd.colaborador_empregado_id IS NULL AND btrim(pd.matricula_colaborador) = btrim(e."Cadastro"::text)))
     ORDER BY pd.created_at DESC LIMIT 1;
  END IF;

  -- Afastamento ATUAL, da Senior (espelho.BiEmpregados.sitafa/datafa). O
  -- histórico de afastamentos é outra tabela da Senior, que não é espelhada.
  BEGIN
    EXECUTE $q$
      SELECT jsonb_build_object('codigo', b.sitafa, 'desde', b.datafa::date,
                                'descricao', s.descricao, 'tipo', s.tipo_descricao)
        FROM espelho."BiEmpregados" b
        LEFT JOIN espelho."BiSituacoes" s ON s.situacao ~ '^[0-9]+$' AND s.situacao::int = b.sitafa
       WHERE b.numemp = $1 AND b.numcad = $2
       LIMIT 1
    $q$ INTO v_afast USING e."Empresa"::int, e."Cadastro"::int;
  EXCEPTION WHEN OTHERS THEN v_afast := NULL;
  END;

  RETURN jsonb_build_object(
    'ferias', coalesce(v_ferias, '[]'::jsonb), 'ferias_saldo', v_saldo,
    'treinamentos', coalesce(v_trein, '[]'::jsonb), 'tem_login', e.auth_user_id IS NOT NULL,
    'cursos', coalesce(v_cursos, '[]'::jsonb),
    'admissao', coalesce(v_adm, '[]'::jsonb),
    'afastamento', v_afast, 'situacao_erp', e."Situação", 'data_afastamento', e."Data Afastamento",
    'cracha_foto_path', v_foto, 'cracha_foto_origem', v_foto_origem);
END $fn$;
REVOKE ALL ON FUNCTION public.esp_col_perfil(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_perfil(bigint) TO authenticated;

-- ── 3. Foto do crachá: quem vê a ficha vê a foto ──────────────────────────
DROP POLICY IF EXISTS sup_crachas_select_ficha ON storage.objects;
CREATE POLICY sup_crachas_select_ficha ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'sup-crachas' AND (
      public.has_screen_access(auth.uid(), 'central_servicos_espaco_colaborador', 'visualizar'::app_acao)
      OR EXISTS (SELECT 1 FROM public."WA_CURRICULOS" c JOIN public."EMPREGADOS" e ON e."ID" = c.empregado_id
                  WHERE e.auth_user_id = auth.uid() AND c.cracha_foto_path = storage.objects.name)
      OR EXISTS (SELECT 1 FROM public.sup_pedido pd JOIN public."EMPREGADOS" e ON e."ID" = pd.colaborador_empregado_id
                  WHERE e.auth_user_id = auth.uid() AND pd.imagem_cracha_path = storage.objects.name)
    )
  );

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP POLICY IF EXISTS sup_crachas_select_ficha ON storage.objects;
-- DROP FUNCTION IF EXISTS public.esp_col_perfil(bigint);
-- (reaplicar esp_col_ficha/esp_col_historico/esp_col_marcacoes da 20260930000059 — voltam a chamar esp_col_exige_acesso())
-- DROP FUNCTION IF EXISTS public.esp_col_marcacoes_ler(bigint, integer, integer);
-- DROP FUNCTION IF EXISTS public.esp_col_exige_acesso(bigint);
-- DROP FUNCTION IF EXISTS public.esp_col_eh_proprio(bigint);
-- NOTIFY pgrst, 'reload schema';
