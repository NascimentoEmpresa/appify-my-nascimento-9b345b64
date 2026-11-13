-- =========================================================================
-- SIS-2026-0852 — SST › padrão único dos menus de ASO + ASO de Retorno ao
-- Trabalho (15/11/2026)
--
-- PEDIDO: "manter um padrão único para todos os tipos de ASO dentro do ERP".
-- No menu do SST, nesta ordem:
--   ASO Admissional · ASO Demissional · ASO Mudança de Função ·
--   ASO Periódico · ASO de Retorno ao Trabalho
--
-- O QUE ESTA MIGRATION FAZ
--   1. Renomeia os menus que já existem — SÓ o nome. `codigo` e `rota` ficam
--      como estão: permissão, RLS, sino e link salvo dependem deles.
--        sst_aso          'ASO / Admissão'           → 'ASO Admissional'
--        sst_troca_funcao 'Mudança de Função — ASO'  → 'ASO Mudança de Função'
--        (sst_aso_demissional e sst_aso_periodico já estão no padrão.)
--   2. Menu novo sst_aso_retorno (visualizar + alterar), semeado de quem já
--      cuida do ASO Periódico ou do Controle de Afastamentos — é a mesma
--      equipe e o mesmo dado. Sem a semente o menu nasceria aberto.
--   3. Ordem do módulo: os cinco ASOs em 1..5; os demais menus do SST vão
--      para depois, na mesma ordem relativa de hoje.
--   4. RPCs da tela nova: sst_aso_ret_lista, sst_aso_ret_salvar,
--      sst_aso_ret_anexo_registrar, sst_aso_ret_anexo_remover.
--
-- DE ONDE VEM O ASO DE RETORNO — NÃO HÁ TABELA NOVA
--   O ASO de retorno já é registrado no caso do Controle de Afastamentos
--   (SST_CTRL_AFASTAMENTO.aso_*, mig 20261105030000), e é dali que o ASO
--   Periódico lê o "último ASO de retorno" (mig 20261114100000). Uma segunda
--   tabela daria duas verdades. A tela nova é a FILA do ASO sobre os mesmos
--   casos: mostra só o que diz respeito ao exame e grava só os campos aso_*.
--   A regra de status do afastamento continua a do gatilho
--   sst_ctrl_afa_regras (ASO pendente → "Aguardando ASO de retorno").
--
-- QUEM ENTRA NA FILA
--   - caso com ASO de retorno marcado como necessário, solicitado, agendado
--     ou realizado no Controle de Afastamentos;
--   - caso ABERTO com 30 dias ou mais de afastamento (contando até a
--     previsão de retorno, se ela for adiante): aparece como "A solicitar",
--     marcado "30+ dias", mesmo que ninguém tenha ligado o ASO no caso.
--   Caso encerrado (desligamento) sem ASO realizado sai da fila.
--
-- STATUS (régua repetida em src/lib/sst/asoRetorno.ts, com teste):
--   realizado com resultado → Realizado/recebido
--   com data de agendamento → Agendado
--   com data de solicitação → Aguardando agendamento
--   senão                   → A solicitar
--
-- ANEXO: mesmo bucket privado do Controle (sst-controle-afastamentos),
-- categoria 'aso_retorno'. Quem só tem este menu enxerga SÓ os arquivos de
-- ASO de retorno — atestado e documento do INSS seguem atrás do menu do
-- Controle de Afastamentos.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Nomes no padrão ───────────────────────────────────────────────────
-- `codigo` só é único por módulo: sempre com o módulo junto.
UPDATE public.app_menu mn SET nome = x.nome
  FROM (VALUES ('sst_aso',          'ASO Admissional'),
               ('sst_troca_funcao', 'ASO Mudança de Função')) AS x(codigo, nome),
       public.app_modulo m
 WHERE m.codigo = 'sst' AND mn.modulo_id = m.id AND mn.codigo = x.codigo
   AND mn.nome IS DISTINCT FROM x.nome;

-- ── 2. Menu novo ─────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sst_aso_retorno', 'ASO de Retorno ao Trabalho', '/app/sst/aso-retorno', 5, true
  FROM public.app_modulo m
 WHERE m.codigo = 'sst'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'sst_aso_retorno');

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('sst_aso_retorno', 'alterar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, 'sst_aso_retorno', pp.acao, true
  FROM public.perfil_acesso_permissao pp
 WHERE pp.menu_codigo IN ('sst_aso_periodico', 'sst_controle_afastamentos')
   AND pp.acao IN ('visualizar', 'alterar') AND pp.allow
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao x
                    WHERE x.perfil_id = pp.perfil_id AND x.menu_codigo = 'sst_aso_retorno' AND x.acao = pp.acao);

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'sst_aso_retorno', s.acao, true,
       'Migração 20261115210000 (SIS-2026-0852): já cuidava do ASO Periódico ou do Controle de Afastamentos'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo IN ('sst_aso_periodico', 'sst_controle_afastamentos')
   AND s.acao IN ('visualizar', 'alterar') AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'sst_aso_retorno' AND x.acao = s.acao);

-- ── 3. Ordem do módulo ───────────────────────────────────────────────────
-- Os demais primeiro (11, 12, ... na ordem relativa de hoje), depois os
-- cinco ASOs em 1..5. Reexecutar dá o mesmo resultado.
WITH outros AS (
  SELECT mn.id, 10 + row_number() OVER (ORDER BY mn.ordem NULLS LAST, mn.nome, mn.id) AS nova
    FROM public.app_menu mn
    JOIN public.app_modulo m ON m.id = mn.modulo_id AND m.codigo = 'sst'
   WHERE mn.codigo NOT IN ('sst_aso', 'sst_aso_demissional', 'sst_troca_funcao', 'sst_aso_periodico', 'sst_aso_retorno')
)
UPDATE public.app_menu mn SET ordem = o.nova
  FROM outros o
 WHERE mn.id = o.id AND mn.ordem IS DISTINCT FROM o.nova;

UPDATE public.app_menu mn SET ordem = x.ordem
  FROM (VALUES ('sst_aso', 1), ('sst_aso_demissional', 2), ('sst_troca_funcao', 3),
               ('sst_aso_periodico', 4), ('sst_aso_retorno', 5)) AS x(codigo, ordem),
       public.app_modulo m
 WHERE m.codigo = 'sst' AND mn.modulo_id = m.id AND mn.codigo = x.codigo
   AND mn.ordem IS DISTINCT FROM x.ordem;

-- ── 4. Acesso ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_aso_ret_pode(_acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.can_access(auth.uid(), 'sst_aso_retorno', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.sst_aso_ret_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_ret_pode(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_aso_ret_exige(_acao text DEFAULT 'visualizar')
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.sst_aso_ret_pode(_acao) THEN
    RAISE EXCEPTION 'Sem acesso (%) ao ASO de Retorno ao Trabalho', _acao USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.sst_aso_ret_exige(text) FROM PUBLIC, anon, authenticated;

-- ── 5. Régua do status ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_aso_ret_status(p_realizado boolean, p_resultado text, p_agendado date, p_solicitado date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_realizado AND p_resultado IS NOT NULL THEN 'Realizado/recebido'
    WHEN p_agendado IS NOT NULL THEN 'Agendado'
    WHEN p_solicitado IS NOT NULL THEN 'Aguardando agendamento'
    ELSE 'A solicitar'
  END
$$;

-- ── 6. RPCs ──────────────────────────────────────────────────────────────
-- A fila. Só o que diz respeito ao exame: sem CPF, sem INSS, sem recursos.
CREATE OR REPLACE FUNCTION public.sst_aso_ret_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_aso_ret_exige('visualizar');
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', x.id, 'nome', x.nome, 'contrato_nome', x.contrato_nome, 'filial_nome', x.filial_nome,
             'funcao', x.funcao, 'motivo', x.motivo, 'data_inicio', x.data_inicio,
             'data_prevista_retorno', x.data_prevista_retorno, 'data_retorno_real', x.data_retorno_real,
             'status_afastamento', x.status, 'senior_situacao', x.senior_situacao,
             'aso_necessario', x.aso_necessario, 'aso_solicitado_em', x.aso_solicitado_em,
             'aso_agendado_em', x.aso_agendado_em, 'aso_clinica', x.aso_clinica, 'aso_realizado', x.aso_realizado,
             'aso_recebido_em', x.aso_recebido_em, 'aso_resultado', x.aso_resultado,
             'dias_afastado', x.dias, 'exige_por_prazo', x.por_prazo, 'updated_at', x.updated_at,
             'status', public.sst_aso_ret_status(x.aso_realizado, x.aso_resultado, x.aso_agendado_em, x.aso_solicitado_em),
             'documentos', COALESCE((
               SELECT jsonb_agg(jsonb_build_object('id', d.id, 'nome', d.nome, 'storage_path', d.storage_path,
                                                   'enviado_por', d.enviado_por, 'created_at', d.created_at) ORDER BY d.id DESC)
                 FROM public."SST_CTRL_AFASTAMENTO_DOC" d
                WHERE d.afastamento_id = x.id AND d.categoria = 'aso_retorno'), '[]'::jsonb))
           ORDER BY x.data_inicio DESC, x.nome)
      FROM (
        SELECT a.*,
               COALESCE(a.data_retorno_real, GREATEST(COALESCE(a.data_prevista_retorno, current_date), current_date)) - a.data_inicio AS dias,
               (a.status NOT IN ('Retornado', 'Afastamento encerrado')
                AND GREATEST(COALESCE(a.data_prevista_retorno, current_date), current_date) - a.data_inicio >= 30) AS por_prazo
          FROM public."SST_CTRL_AFASTAMENTO" a
      ) x
     WHERE (x.aso_realizado AND x.aso_resultado IS NOT NULL)
        OR (x.status <> 'Afastamento encerrado'
            AND (x.aso_necessario OR x.aso_realizado OR x.aso_solicitado_em IS NOT NULL
                 OR x.aso_agendado_em IS NOT NULL OR x.por_prazo))), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_ret_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_ret_lista() TO authenticated;

-- Grava SÓ os campos do ASO de retorno do caso. Salvar por aqui liga o
-- "ASO necessário" — o gatilho sst_ctrl_afa_regras cuida do status do caso.
CREATE OR REPLACE FUNCTION public.sst_aso_ret_salvar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id   bigint  := nullif(p->>'id', '')::bigint;
  v_sol  date    := nullif(p->>'aso_solicitado_em', '')::date;
  v_age  date    := nullif(p->>'aso_agendado_em', '')::date;
  v_real boolean := COALESCE((p->>'aso_realizado')::boolean, false);
  v_rec  date    := nullif(p->>'aso_recebido_em', '')::date;
  v_res  text    := nullif(p->>'aso_resultado', '');
  a      public."SST_CTRL_AFASTAMENTO"%ROWTYPE;
  n      public."SST_CTRL_AFASTAMENTO"%ROWTYPE;
BEGIN
  PERFORM public.sst_aso_ret_exige('alterar');
  IF v_res IS NOT NULL AND v_res NOT IN ('apto', 'inapto') THEN
    RAISE EXCEPTION 'Resultado inválido: use apto ou inapto.';
  END IF;
  IF v_real THEN
    IF v_rec IS NULL THEN RAISE EXCEPTION 'Informe a data da realização do ASO.'; END IF;
    IF v_res IS NULL THEN RAISE EXCEPTION 'Informe o resultado do ASO: apto ou inapto.'; END IF;
  END IF;
  IF v_rec > current_date THEN RAISE EXCEPTION 'A data da realização não pode ser futura.'; END IF;
  IF v_sol > current_date THEN RAISE EXCEPTION 'A data da solicitação não pode ser futura.'; END IF;
  IF v_age < v_sol THEN RAISE EXCEPTION 'O agendamento não pode ser antes da solicitação.'; END IF;

  SELECT * INTO a FROM public."SST_CTRL_AFASTAMENTO" WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Afastamento não encontrado.'; END IF;
  IF a.status = 'Afastamento encerrado' THEN
    RAISE EXCEPTION 'O afastamento de % está encerrado: o ASO de retorno não pode mais ser alterado.', a.nome;
  END IF;
  -- Quem já voltou não reabre por aqui: desfazer o ASO devolveria o caso a
  -- "Aguardando ASO de retorno". Esse ajuste é do Controle de Afastamentos.
  IF a.status = 'Retornado' AND NOT v_real THEN
    RAISE EXCEPTION '% já retornou ao trabalho: para desfazer o ASO, ajuste o caso no Controle de Afastamentos.', a.nome;
  END IF;

  UPDATE public."SST_CTRL_AFASTAMENTO" SET
    aso_necessario = true,
    aso_solicitado_em = v_sol,
    aso_agendado_em = v_age,
    aso_clinica = nullif(btrim(p->>'aso_clinica'), ''),
    aso_realizado = v_real,
    aso_recebido_em = v_rec,
    aso_resultado = v_res
  WHERE id = v_id
  RETURNING * INTO n;

  IF (n.aso_solicitado_em, n.aso_agendado_em, n.aso_clinica, n.aso_realizado, n.aso_recebido_em, n.aso_resultado)
     IS DISTINCT FROM
     (a.aso_solicitado_em, a.aso_agendado_em, a.aso_clinica, a.aso_realizado, a.aso_recebido_em, a.aso_resultado)
     OR NOT a.aso_necessario THEN
    PERFORM public.sst_ctrl_afa_evento(v_id, 'alterado',
      'ASO de retorno (tela ASO de Retorno ao Trabalho): '
      || public.sst_aso_ret_status(n.aso_realizado, n.aso_resultado, n.aso_agendado_em, n.aso_solicitado_em)
      || COALESCE(' em ' || to_char(CASE WHEN n.aso_realizado THEN n.aso_recebido_em ELSE n.aso_agendado_em END, 'DD/MM/YYYY'), '')
      || COALESCE(' (' || n.aso_resultado || ')', '')
      || CASE WHEN n.status IS DISTINCT FROM a.status THEN '; status: ' || a.status || ' → ' || n.status ELSE '' END || '.');
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_ret_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_ret_salvar(jsonb) TO authenticated;

-- O arquivo do ASO entra como documento do caso, categoria 'aso_retorno',
-- na subpasta <id>/aso_retorno/ — é ela que a policy do bucket libera.
CREATE OR REPLACE FUNCTION public.sst_aso_ret_anexo_registrar(p_id bigint, p_nome text, p_path text, p_tamanho bigint, p_tipo text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id bigint;
BEGIN
  PERFORM public.sst_aso_ret_exige('alterar');
  IF COALESCE(p_path, '') NOT LIKE p_id::text || '/aso_retorno/%' THEN
    RAISE EXCEPTION 'Arquivo fora da pasta do ASO de retorno do afastamento #%.', p_id;
  END IF;
  PERFORM 1 FROM public."SST_CTRL_AFASTAMENTO" WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Afastamento não encontrado.'; END IF;
  INSERT INTO public."SST_CTRL_AFASTAMENTO_DOC" (afastamento_id, categoria, nome, storage_path, tamanho, tipo, enviado_por)
  VALUES (p_id, 'aso_retorno', p_nome, p_path, p_tamanho, p_tipo, public.sst_afa_nome_usuario())
  RETURNING id INTO v_id;
  PERFORM public.sst_ctrl_afa_evento(p_id, 'documento', 'ASO de retorno anexado: ' || p_nome || '.');
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_ret_anexo_registrar(bigint, text, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_ret_anexo_registrar(bigint, text, text, bigint, text) TO authenticated;

-- Só documento de ASO de retorno sai por aqui. A tela apaga o arquivo do
-- bucket ANTES de chamar (a policy de delete depende deste registro).
CREATE OR REPLACE FUNCTION public.sst_aso_ret_anexo_remover(p_doc_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE d public."SST_CTRL_AFASTAMENTO_DOC"%ROWTYPE;
BEGIN
  PERFORM public.sst_aso_ret_exige('alterar');
  DELETE FROM public."SST_CTRL_AFASTAMENTO_DOC" WHERE id = p_doc_id AND categoria = 'aso_retorno' RETURNING * INTO d;
  IF NOT FOUND THEN RAISE EXCEPTION 'ASO de retorno não encontrado.'; END IF;
  PERFORM public.sst_ctrl_afa_evento(d.afastamento_id, 'documento', 'ASO de retorno removido: ' || d.nome || '.');
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_ret_anexo_remover(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_ret_anexo_remover(bigint) TO authenticated;

-- ── 7. Bucket: só os arquivos de ASO de retorno ──────────────────────────
-- As policies do Controle (mig 20261105030000) continuam valendo para quem
-- tem aquele menu; estas se somam (OR) e alcançam apenas o ASO de retorno:
-- a subpasta nova ou o que o Controle já registrou nessa categoria.
CREATE OR REPLACE FUNCTION public.sst_aso_ret_arquivo(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_name ~ '^\d+/aso_retorno/'
      OR EXISTS (SELECT 1 FROM public."SST_CTRL_AFASTAMENTO_DOC" d
                  WHERE d.storage_path = p_name AND d.categoria = 'aso_retorno')
$$;
REVOKE ALL ON FUNCTION public.sst_aso_ret_arquivo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_ret_arquivo(text) TO authenticated;

DROP POLICY IF EXISTS "sst aso retorno select" ON storage.objects;
CREATE POLICY "sst aso retorno select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sst-controle-afastamentos' AND (select public.sst_aso_ret_pode('visualizar'))
         AND public.sst_aso_ret_arquivo(name));
DROP POLICY IF EXISTS "sst aso retorno insert" ON storage.objects;
CREATE POLICY "sst aso retorno insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sst-controle-afastamentos' AND (select public.sst_aso_ret_pode('alterar'))
              AND name ~ '^\d+/aso_retorno/');
DROP POLICY IF EXISTS "sst aso retorno delete" ON storage.objects;
CREATE POLICY "sst aso retorno delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sst-controle-afastamentos' AND (select public.sst_aso_ret_pode('alterar'))
         AND public.sst_aso_ret_arquivo(name));

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP POLICY IF EXISTS "sst aso retorno select" ON storage.objects;
-- DROP POLICY IF EXISTS "sst aso retorno insert" ON storage.objects;
-- DROP POLICY IF EXISTS "sst aso retorno delete" ON storage.objects;
-- DROP FUNCTION IF EXISTS public.sst_aso_ret_arquivo(text), public.sst_aso_ret_anexo_remover(bigint),
--   public.sst_aso_ret_anexo_registrar(bigint, text, text, bigint, text), public.sst_aso_ret_salvar(jsonb),
--   public.sst_aso_ret_lista(), public.sst_aso_ret_status(boolean, text, date, date),
--   public.sst_aso_ret_exige(text), public.sst_aso_ret_pode(text);
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'sst_aso_retorno';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sst_aso_retorno';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sst_aso_retorno';
-- DELETE FROM public.app_menu      WHERE codigo      = 'sst_aso_retorno';
-- UPDATE public.app_menu SET nome = 'ASO / Admissão'          WHERE codigo = 'sst_aso';
-- UPDATE public.app_menu SET nome = 'Mudança de Função — ASO' WHERE codigo = 'sst_troca_funcao';
-- (A ordem antiga dos menus do SST não é restaurada: só muda a sequência na
--  lista de Acesso por Usuário. Os dados de ASO gravados pela tela ficam em
--  SST_CTRL_AFASTAMENTO — nada a desfazer.)
-- NOTIFY pgrst, 'reload schema';
