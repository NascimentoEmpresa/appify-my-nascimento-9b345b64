-- =========================================================================
-- DEMISSÃO — JUSTIFICATIVA DO DESLIGAMENTO OBRIGATÓRIA (10/11/2026)
--
-- PEDIDO (chamado): "ao realizar a abertura de um processo de demissão de
-- colaborador, após o preenchimento do motivo do desligamento, seja
-- obrigatório o preenchimento de um campo adicional de Justificativa do
-- Desligamento [...] Solicitação realizada pelo fiscal responsável; Faltas ou
-- excesso de ausências; Apresentação recorrente de atestados médicos; Má
-- conduta ou comportamento inadequado; Outros motivos, com possibilidade de
-- descrição complementar. O sistema deverá impedir a conclusão da abertura
-- do processo de demissão enquanto a justificativa não for preenchida."
-- Objetivo: estatística dos desligamentos.
--
-- O QUE MUDA
--   1. Duas colunas em SISTEMA_SOLICITACOES_DEMISSAO: justificativa_desligamento
--      (lista fechada, para a estatística contar certo) e
--      justificativa_complemento (texto; obrigatório em "Outros motivos").
--      As solicitações antigas ficam NULL — no relatório aparecem como
--      "(não informado)".
--   2. Gatilho no INSERT: nenhuma solicitação nova nasce sem justificativa
--      (a tela cobra antes, mas a regra é do banco). E ninguém apaga a
--      justificativa depois de preenchida.
--   3. demissao_reenviar_ajuste (mig 20261105020000): o ajuste pedido pelo RH
--      também passa pela justificativa — inclusive nas antigas que estavam
--      sem, que ganham a justificativa ao voltar para o RH — e a troca entra
--      no histórico de alterações.
--   4. dir_rel_demissoes_linhas (mig 20261105008300): devolve a justificativa,
--      para Relatórios › Demissões contar por ela (por contrato, como os
--      outros motivos).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Colunas ───────────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ADD COLUMN IF NOT EXISTS justificativa_desligamento text,
  ADD COLUMN IF NOT EXISTS justificativa_complemento  text;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".justificativa_desligamento IS
  'Justificativa do desligamento (lista fechada — src/lib/demissao/solicitacao.ts JUSTIFICATIVAS_DESLIGAMENTO). NULL só nas abertas antes de 10/11/2026.';
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".justificativa_complemento IS
  'Descrição complementar da justificativa; obrigatória quando a justificativa é "Outros motivos".';

-- A lista é a mesma do front. Mudou a lista? Mude aqui e lá.
CREATE OR REPLACE FUNCTION public.demissao_justificativas_validas()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'Solicitação do fiscal responsável',
    'Faltas ou excesso de ausências',
    'Apresentação recorrente de atestados médicos',
    'Má conduta ou comportamento inadequado',
    'Baixo desempenho na função',
    'Redução de quadro ou encerramento do posto',
    'Pedido do próprio colaborador',
    'Outros motivos'
  ];
$$;

ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" DROP CONSTRAINT IF EXISTS sol_demissao_justificativa_valida;
ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" ADD CONSTRAINT sol_demissao_justificativa_valida
  CHECK (justificativa_desligamento IS NULL OR justificativa_desligamento = ANY (public.demissao_justificativas_validas()));
ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" DROP CONSTRAINT IF EXISTS sol_demissao_justificativa_complemento;
ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" ADD CONSTRAINT sol_demissao_justificativa_complemento
  CHECK (justificativa_complemento IS NULL OR char_length(justificativa_complemento) <= 1000);

-- A mesma régua da tela, num lugar só (o gatilho e o ajuste usam).
CREATE OR REPLACE FUNCTION public.demissao_erro_justificativa(p_just text, p_comp text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN nullif(btrim(coalesce(p_just, '')), '') IS NULL
      THEN 'Selecione a justificativa do desligamento.'
    WHEN NOT btrim(p_just) = ANY (public.demissao_justificativas_validas())
      THEN 'Justificativa do desligamento inválida.'
    WHEN btrim(p_just) = 'Outros motivos' AND char_length(btrim(coalesce(p_comp, ''))) < 10
      THEN 'Em "Outros motivos", descreva a justificativa (pelo menos 10 caracteres).'
  END;
$$;

-- ── 2) Gatilho: abertura sem justificativa não passa ─────────────────────
CREATE OR REPLACE FUNCTION public.demissao_exige_justificativa()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_erro text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_erro := public.demissao_erro_justificativa(NEW.justificativa_desligamento, NEW.justificativa_complemento);
    IF v_erro IS NOT NULL THEN RAISE EXCEPTION '%', v_erro USING ERRCODE = 'P0001'; END IF;
  ELSIF OLD.justificativa_desligamento IS NOT NULL AND NEW.justificativa_desligamento IS DISTINCT FROM OLD.justificativa_desligamento THEN
    -- Trocar só pelo ajuste (que valida); apagar, nunca.
    v_erro := public.demissao_erro_justificativa(NEW.justificativa_desligamento, NEW.justificativa_complemento);
    IF v_erro IS NOT NULL THEN RAISE EXCEPTION '%', v_erro USING ERRCODE = 'P0001'; END IF;
  END IF;
  NEW.justificativa_desligamento := nullif(btrim(coalesce(NEW.justificativa_desligamento, '')), '');
  NEW.justificativa_complemento := nullif(btrim(coalesce(NEW.justificativa_complemento, '')), '');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_demissao_exige_justificativa ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_demissao_exige_justificativa
  BEFORE INSERT OR UPDATE OF justificativa_desligamento, justificativa_complemento
  ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.demissao_exige_justificativa();

-- ── 3) Ajuste pedido pelo RH: a justificativa entra na régua ─────────────
-- Cópia da mig 20261105020000 com a justificativa (marcado "justificativa").
CREATE OR REPLACE FUNCTION public.demissao_reenviar_ajuste(
  p_id bigint, p_dados jsonb, p_anexos_novos jsonb DEFAULT '[]'::jsonb,
  p_anexos_remover bigint[] DEFAULT '{}'::bigint[], p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d            record;
  c            record;
  a            jsonb;
  v_email      text := lower(coalesce(auth.email(), ''));
  v_nome       text;
  v_obs        text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_data_sol   date;
  v_data_aviso date;
  v_motivo_sol text := btrim(coalesce(p_dados->>'motivo_solicitacao', ''));
  v_motivo_ped text := btrim(coalesce(p_dados->>'motivo_pedido', ''));
  v_just       text := btrim(coalesce(p_dados->>'justificativa_desligamento', ''));   -- justificativa
  v_just_comp  text := nullif(btrim(coalesce(p_dados->>'justificativa_complemento', '')), '');  -- justificativa
  v_erro_just  text;
  v_relato     text := btrim(coalesce(p_dados->>'relato', ''));
  v_termino    text := btrim(coalesce(p_dados->>'termino_experiencia', ''));
  v_modelo     text := btrim(coalesce(p_dados->>'modelo_aviso', ''));
  v_telefone   text := btrim(coalesce(p_dados->>'colaborador_telefone', ''));
  v_mail       text := btrim(coalesce(p_dados->>'colaborador_email', ''));
  v_posto      text := nullif(btrim(coalesce(p_dados->>'colaborador_posto', '')), '');
  v_alteracoes jsonb := '[]'::jsonb;
  v_removidos  text[] := '{}';
  v_n_novos    int := 0;
  v_n_rem      int := 0;
  v_resumo     text;
BEGIN
  SELECT * INTO d FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Solicitação #% não existe.', p_id; END IF;
  IF lower(coalesce(d.solicitante_email, '')) <> v_email OR v_email = '' THEN
    RAISE EXCEPTION 'Só quem abriu a solicitação pode ajustá-la.' USING ERRCODE = '42501';
  END IF;
  IF d.status <> 'Ajuste solicitado' THEN
    RAISE EXCEPTION 'Esta solicitação não está aguardando ajuste (agora está %).', d.status;
  END IF;

  -- A mesma régua do formulário de abertura.
  v_data_sol   := nullif(btrim(coalesce(p_dados->>'data_solicitacao', '')), '')::date;
  v_data_aviso := nullif(btrim(coalesce(p_dados->>'data_aviso', '')), '')::date;
  IF v_data_sol IS NULL THEN RAISE EXCEPTION 'Informe a data da solicitação.'; END IF;
  IF v_motivo_sol = '' THEN RAISE EXCEPTION 'Selecione o motivo da solicitação.'; END IF;
  IF v_motivo_ped = '' THEN RAISE EXCEPTION 'Selecione o motivo do pedido de demissão.'; END IF;
  v_erro_just := public.demissao_erro_justificativa(v_just, v_just_comp);                -- justificativa
  IF v_erro_just IS NOT NULL THEN RAISE EXCEPTION '%', v_erro_just; END IF;              -- justificativa
  IF length(v_relato) < 20 THEN RAISE EXCEPTION 'Relate o motivo com pelo menos 20 caracteres.'; END IF;
  IF v_termino = '' THEN RAISE EXCEPTION 'Informe o término de contrato de experiência.'; END IF;
  IF v_data_aviso IS NULL THEN RAISE EXCEPTION 'Informe a data do aviso.'; END IF;
  IF v_modelo = '' THEN RAISE EXCEPTION 'Selecione o modelo de aviso.'; END IF;
  IF length(regexp_replace(v_telefone, '\D', '', 'g')) < 10 THEN RAISE EXCEPTION 'Informe o telefone do colaborador com DDD.'; END IF;
  IF v_mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' THEN RAISE EXCEPTION 'Informe um e-mail válido do colaborador.'; END IF;

  FOR c IN
    SELECT * FROM (VALUES
      ('Data da solicitação', to_char(d.data_solicitacao, 'DD/MM/YYYY'), to_char(v_data_sol, 'DD/MM/YYYY')),
      ('Posto', d.colaborador_posto, coalesce(v_posto, d.colaborador_posto)),
      ('Motivo da solicitação', d.motivo_solicitacao, v_motivo_sol),
      ('Motivo do pedido', d.motivo_pedido, v_motivo_ped),
      ('Justificativa do desligamento', d.justificativa_desligamento, v_just),            -- justificativa
      ('Complemento da justificativa', d.justificativa_complemento, v_just_comp),         -- justificativa
      ('Relato', d.relato, v_relato),
      ('Término de experiência', d.termino_experiencia, v_termino),
      ('Data do aviso', to_char(d.data_aviso, 'DD/MM/YYYY'), to_char(v_data_aviso, 'DD/MM/YYYY')),
      ('Modelo de aviso', d.modelo_aviso, v_modelo),
      ('Telefone do colaborador', d.colaborador_telefone, v_telefone),
      ('E-mail do colaborador', d.colaborador_email, v_mail)
    ) AS t(campo, antes, depois)
    WHERE t.antes IS DISTINCT FROM t.depois
  LOOP
    v_alteracoes := v_alteracoes || jsonb_build_object('campo', c.campo, 'antes', c.antes, 'depois', c.depois);
  END LOOP;

  -- Anexos: só os DESTA solicitação são removidos, venha o id que vier.
  WITH apagados AS (
    DELETE FROM public."SISTEMA_SOL_DEMISSAO_ANEXOS"
     WHERE solicitacao_id = p_id AND id = ANY (coalesce(p_anexos_remover, '{}'::bigint[]))
    RETURNING storage_path
  )
  SELECT coalesce(array_agg(storage_path), '{}') INTO v_removidos FROM apagados;
  v_n_rem := coalesce(array_length(v_removidos, 1), 0);

  FOR a IN SELECT * FROM jsonb_array_elements(coalesce(p_anexos_novos, '[]'::jsonb)) LOOP
    -- O caminho tem que estar na pasta desta solicitação (o mesmo do formulário).
    IF coalesce(a->>'storage_path', '') NOT LIKE p_id::text || '/%' THEN
      RAISE EXCEPTION 'Anexo fora da pasta da solicitação #%.', p_id;
    END IF;
    INSERT INTO public."SISTEMA_SOL_DEMISSAO_ANEXOS" (solicitacao_id, nome, storage_path, tamanho, tipo, enviado_por)
    VALUES (p_id, coalesce(a->>'nome', 'arquivo'), a->>'storage_path',
            nullif(a->>'tamanho', '')::bigint, nullif(a->>'tipo', ''), v_email);
    v_n_novos := v_n_novos + 1;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public."SISTEMA_SOL_DEMISSAO_ANEXOS" WHERE solicitacao_id = p_id) THEN
    RAISE EXCEPTION 'Anexe pelo menos 1 documento.';
  END IF;
  IF jsonb_array_length(v_alteracoes) = 0 AND v_n_novos = 0 AND v_n_rem = 0 AND v_obs IS NULL THEN
    RAISE EXCEPTION 'Nada foi alterado. Corrija o que o RH pediu ou escreva uma observação para o RH.';
  END IF;

  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  v_nome := coalesce(v_nome, v_email);

  UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
     SET data_solicitacao = v_data_sol,
         colaborador_posto = coalesce(v_posto, colaborador_posto),
         motivo_solicitacao = v_motivo_sol,
         motivo_pedido = v_motivo_ped,
         justificativa_desligamento = v_just,                                              -- justificativa
         justificativa_complemento = v_just_comp,                                          -- justificativa
         relato = v_relato,
         termino_experiencia = v_termino,
         data_aviso = v_data_aviso,
         modelo_aviso = v_modelo,
         colaborador_telefone = v_telefone,
         colaborador_email = v_mail,
         status = 'Pendente RH',
         ajuste_feito_por = v_nome,
         ajuste_feito_em = now(),
         ajuste_observacao = v_obs,
         ajuste_alteracoes = v_alteracoes,
         atualizado_em = now()
   WHERE id = p_id;

  SELECT string_agg(e->>'campo' || ': ' || coalesce(e->>'antes', '—') || ' → ' || coalesce(e->>'depois', '—'), '; ')
    INTO v_resumo
    FROM jsonb_array_elements(v_alteracoes) e
   WHERE e->>'campo' NOT IN ('Relato', 'Complemento da justificativa');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_alteracoes) e WHERE e->>'campo' = 'Relato') THEN
    v_resumo := concat_ws('; ', v_resumo, 'Relato alterado');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_alteracoes) e WHERE e->>'campo' = 'Complemento da justificativa') THEN
    v_resumo := concat_ws('; ', v_resumo, 'Complemento da justificativa alterado');
  END IF;
  IF v_n_novos > 0 THEN v_resumo := concat_ws('; ', v_resumo, v_n_novos || ' anexo(s) incluído(s)'); END IF;
  IF v_n_rem > 0 THEN v_resumo := concat_ws('; ', v_resumo, v_n_rem || ' anexo(s) removido(s)'); END IF;

  INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, autor_cpf, texto)
  VALUES ('demissao', p_id::text, v_nome, v_email,
          '✏️ AJUSTE FEITO pelo solicitante — voltou para o RH.'
          || coalesce(' ' || v_resumo || '.', '')
          || coalesce(' Observação: ' || v_obs, ''));

  RETURN jsonb_build_object('id', p_id, 'status', 'Pendente RH', 'removidos', to_jsonb(v_removidos));
END $fn$;
REVOKE ALL ON FUNCTION public.demissao_reenviar_ajuste(bigint, jsonb, jsonb, bigint[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demissao_reenviar_ajuste(bigint, jsonb, jsonb, bigint[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.demissao_reenviar_ajuste(bigint, jsonb, jsonb, bigint[], text) TO authenticated;

-- ── 4) Relatório: a justificativa vai junto ──────────────────────────────
-- Cópia da mig 20261105008300 com justificativa_desligamento/complemento.
CREATE OR REPLACE FUNCTION public.dir_rel_demissoes_linhas(
  _de date DEFAULT NULL, _ate date DEFAULT NULL, _contrato uuid DEFAULT NULL, _meses int[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
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
             'justificativa', x.justificativa_desligamento, 'justificativa_complemento', x.justificativa_complemento,
             'relato', x.relato, 'categoria_ia', x.categoria_ia) ORDER BY x.dt DESC, x.id DESC), '[]'::jsonb)
      FROM (
        SELECT s.id, COALESCE(s.data_solicitacao, s.criado_em::date) dt, s.colaborador_nome, s.colaborador_cargo,
               s.contrato, s.status,
               CASE WHEN s.status IN ('Concluída', 'ASO válido', 'Agendamento concluído') THEN 'concluido'
                    WHEN s.status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END grupo,
               s.motivo_solicitacao, s.motivo_pedido, s.justificativa_desligamento, s.justificativa_complemento, s.relato,
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

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_demissao_exige_justificativa ON public."SISTEMA_SOLICITACOES_DEMISSAO";
--   DROP FUNCTION IF EXISTS public.demissao_exige_justificativa(), public.demissao_erro_justificativa(text, text);
--   ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" DROP CONSTRAINT IF EXISTS sol_demissao_justificativa_valida,
--     DROP CONSTRAINT IF EXISTS sol_demissao_justificativa_complemento;
--   DROP FUNCTION IF EXISTS public.demissao_justificativas_validas();
--   (demissao_reenviar_ajuste: reaplicar a 20261105020000; dir_rel_demissoes_linhas: a 20261105008300)
--   ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" DROP COLUMN IF EXISTS justificativa_complemento,
--     DROP COLUMN IF EXISTS justificativa_desligamento;
-- =========================================================================
