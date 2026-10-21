-- ============================================================================
-- [SEM-CHAMADO] Malote: depois do horário 1.1 o Nível 1 só aprova com a SENHA de uma exceção de aprovação
-- ============================================================================
-- Caso real (DM-2026-2947, 20/10/2026): criada 19/10 às 16:10 para pagar em 21/10; o aprovador do Nível 1 aprovou em 20/10 às
-- 15:05, depois do meio-dia (regra 1.1, "Prazo para inclusão e aprovação pelo setor"), e o banco deixou. Nenhuma função olhava o
-- relógio na aprovação do N1: a 1.1 só valia para CRIAR a despesa; a 1.2 só pedia uma justificativa e só quando o pagamento era hoje.
--
-- Orientação do Iury: depois das 12h é preciso uma chave de exceção, com atalho para criá-la. N1 entra no horário 1.1, N2 no 1.2.
--
--  1. malote_excecao_solicitacao ganha `finalidade` ('criacao' = a exceção de sempre, para LANÇAR a despesa; 'aprovacao' = a chave
--     para o N1 aprovar fora do prazo) e `despesa_alvo_id` (a despesa que a chave de aprovação libera);
--  2. malote_config.n1_aprovacao_prazo_ativo (padrão true): chave geral para desligar a regra sem migration, se preciso;
--  3. malote_n1_fora_do_prazo(): hora de Brasília depois de inclusao_setor_horario (1.1) e a regra ligada;
--  4. malote_excecao_solicitar_aprovacao(despesa, justificativa): o próprio aprovador N1 pede a chave daquela despesa. Quem decide é
--     o mesmo grupo das exceções (Malote › Configurações), e a senha sai pelo mesmo caminho (malote_excecao_decidir);
--  5. malote_aprovar_despesa ganha _senha_excecao: N1, fora do prazo, despesa que ainda não é exceção -> exige a senha, que vale só
--     para ESSA despesa, só para quem pediu, 24 h e uma vez. N2/N3 não mudam (têm a rolagem de data da 1.2);
--  6. a senha de aprovação não serve para lançar despesa (gatilho de guarda) e a notificação da decisão diz para onde usá-la.
--
-- Despesa que já nasceu como exceção (com senha na criação) fica fora: já passou por uma chave.
--
-- Migrations não se auto-aplicam por pgAdmin sem ok: rodar um BLOCO por vez (1 a 6). O BLOCO 6 troca a assinatura de
-- malote_aprovar_despesa (DROP + CREATE no mesmo bloco: cuidado com a ambiguidade de overload da 20260930000190).
--
-- ROLLBACK (desliga a regra na hora, sem desfazer o resto):
--   UPDATE public.malote_config SET n1_aprovacao_prazo_ativo = false WHERE id = true;
-- ROLLBACK completo: reaplicar malote_aprovar_despesa da 20260930000189 (DROP da de 11 parâmetros antes) e
--   DROP FUNCTION IF EXISTS public.malote_excecao_solicitar_aprovacao(uuid, text, text[]); DROP FUNCTION IF EXISTS public.malote_n1_fora_do_prazo();
--   DROP TRIGGER IF EXISTS malote_despesa_0_excecao_senha_so_criacao ON public.malote_despesa;
--   NOTIFY pgrst, 'reload schema';

SET lock_timeout = '8s';

-- ── BLOCO 1 ── colunas
ALTER TABLE public.malote_excecao_solicitacao
  ADD COLUMN IF NOT EXISTS finalidade text NOT NULL DEFAULT 'criacao',
  ADD COLUMN IF NOT EXISTS despesa_alvo_id uuid REFERENCES public.malote_despesa(id) ON DELETE SET NULL;
ALTER TABLE public.malote_excecao_solicitacao DROP CONSTRAINT IF EXISTS malote_excecao_solicitacao_finalidade_check;
ALTER TABLE public.malote_excecao_solicitacao
  ADD CONSTRAINT malote_excecao_solicitacao_finalidade_check CHECK (finalidade IN ('criacao', 'aprovacao'));
CREATE INDEX IF NOT EXISTS idx_malote_excecao_sol_despesa_alvo
  ON public.malote_excecao_solicitacao (despesa_alvo_id) WHERE despesa_alvo_id IS NOT NULL;

ALTER TABLE public.malote_config
  ADD COLUMN IF NOT EXISTS n1_aprovacao_prazo_ativo boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.malote_config.n1_aprovacao_prazo_ativo IS
  'Malote — depois do horário 1.1 (inclusao_setor_horario) o Nível 1 só aprova com a senha de uma exceção de aprovação. false desliga a regra.';

-- ── BLOCO 2 ── fora do prazo do Nível 1?
CREATE OR REPLACE FUNCTION public.malote_n1_fora_do_prazo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT c.n1_aprovacao_prazo_ativo AND ((now() AT TIME ZONE 'America/Sao_Paulo')::time > c.inclusao_setor_horario)
       FROM public.malote_config c WHERE c.id = true),
    false);
$$;

REVOKE ALL ON FUNCTION public.malote_n1_fora_do_prazo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_n1_fora_do_prazo() TO authenticated;

-- ── BLOCO 3 ── o N1 pede a chave daquela despesa
CREATE OR REPLACE FUNCTION public.malote_excecao_solicitar_aprovacao(
  _despesa_id uuid,
  _justificativa text,
  _arquivos text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d record;
  v_class uuid;
  v_existente uuid;
  v_id uuid;
  v_numero text;
  v_aprovadores uuid[];
  v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão ausente.'; END IF;
  IF btrim(COALESCE(_justificativa, '')) = '' THEN
    RAISE EXCEPTION 'Informe a justificativa: por que a aprovação do Nível 1 precisa sair do prazo.';
  END IF;

  SELECT id, numero, nome, empresa_id, classificacao_id, contrato_id, valor_total, data_pagamento, status, nivel_aprovacao_atual, excecao
    INTO d FROM public.malote_despesa WHERE id = _despesa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF d.status <> 'pendente_aprovacao' OR d.nivel_aprovacao_atual IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'A chave de aprovação só vale para despesa pendente no Nível 1.';
  END IF;
  IF COALESCE(d.excecao, false) THEN
    RAISE EXCEPTION 'Esta despesa já foi lançada como exceção: o Nível 1 aprova normalmente, sem chave.';
  END IF;
  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_e_aprovador_do_nivel(_despesa_id, 1::smallint, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Só o aprovador do Nível 1 desta despesa pode pedir a chave de aprovação.';
  END IF;

  -- Pedido ainda valendo (em análise, ou aprovado e dentro das 24 h): devolve o mesmo, sem duplicar.
  SELECT s.id INTO v_existente
    FROM public.malote_excecao_solicitacao s
   WHERE s.despesa_alvo_id = _despesa_id AND s.solicitante_id = auth.uid() AND s.finalidade = 'aprovacao'
     AND (s.status = 'em_analise' OR (s.status = 'aprovada' AND s.senha_expira_em > now()))
   ORDER BY s.created_at DESC LIMIT 1;
  IF v_existente IS NOT NULL THEN RETURN v_existente; END IF;

  v_class := COALESCE(d.classificacao_id, (SELECT rl.classificacao_id FROM public.malote_despesa_rateio_linha rl WHERE rl.despesa_id = d.id LIMIT 1));
  IF v_class IS NULL THEN RAISE EXCEPTION 'A despesa não tem classificação: não há como definir quem aprova a exceção.'; END IF;
  IF COALESCE(d.valor_total, 0) <= 0 THEN RAISE EXCEPTION 'A despesa não tem valor.'; END IF;

  -- Quem decide: o mesmo grupo das exceções de criação (aprovador configurado e/ou N2 da classificação, pelo modo de Configurações).
  SELECT ARRAY(
    SELECT DISTINCT u FROM (
      SELECT c.excecao_aprovador_user_id AS u FROM public.malote_config c
       WHERE c.id = true AND c.excecao_aprovacao_modo IN ('pessoa', 'pessoa_e_n2')
      UNION ALL
      SELECT unnest(COALESCE(k.aprovador2_user_ids, '{}'::uuid[]))
        FROM public.malote_config c
        JOIN public.planejamento_orcamentario_classificacao k ON k.id = v_class
       WHERE c.id = true AND c.excecao_aprovacao_modo IN ('pessoa_e_n2', 'n2')
    ) x WHERE u IS NOT NULL AND u <> auth.uid()
  ) INTO v_aprovadores;
  IF COALESCE(array_length(v_aprovadores, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Não há aprovador para esta exceção: configure o aprovador (ou o N2 da classificação) em Malote › Configurações — peça ao Sistemas.';
  END IF;

  v_numero := 'EXC-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY') || '-' || lpad(nextval('public.malote_excecao_solicitacao_seq')::text, 4, '0');

  INSERT INTO public.malote_excecao_solicitacao
    (numero, solicitante_id, tipo, classificacao_id, contrato_id, empresa_id, valor, data_pagamento, descricao, justificativa, arquivos,
     finalidade, despesa_alvo_id)
  VALUES
    (v_numero, auth.uid(), CASE WHEN d.contrato_id IS NOT NULL THEN 'contrato' ELSE 'administrativo' END, v_class, d.contrato_id, d.empresa_id,
     round(d.valor_total, 2), d.data_pagamento,
     format('Aprovação do Nível 1 fora do prazo — %s (%s)', d.numero, COALESCE(d.nome, '')),
     btrim(_justificativa), COALESCE(_arquivos, '{}'), 'aprovacao', _despesa_id)
  RETURNING id INTO v_id;

  INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'solicitada', auth.uid(), format('Chave de aprovação do Nível 1 solicitada para a despesa %s.', d.numero));

  SELECT COALESCE(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  PERFORM public.malote_notificar_usuarios(
    v_aprovadores, d.empresa_id,
    'Nova solicitação de exceção no Malote (aprovação fora do prazo)',
    format('%s pediu a exceção %s para aprovar a despesa %s depois do horário do Nível 1. Analise em Malote › Autorizações de Exceção.',
           COALESCE(v_nome, 'Um usuário'), v_numero, d.numero),
    'malote_excecao', '/app/malote/excecao/autorizacoes'
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_excecao_solicitar_aprovacao(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_excecao_solicitar_aprovacao(uuid, text, text[]) TO authenticated;

-- ── BLOCO 4 ── a senha de aprovação não serve para LANÇAR despesa
CREATE OR REPLACE FUNCTION public.malote_despesa_senha_so_de_criacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.excecao_solicitacao_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.excecao_solicitacao_id IS DISTINCT FROM NEW.excecao_solicitacao_id)
     AND EXISTS (SELECT 1 FROM public.malote_excecao_solicitacao s WHERE s.id = NEW.excecao_solicitacao_id AND s.finalidade <> 'criacao') THEN
    RAISE EXCEPTION 'Esta senha é de aprovação do Nível 1 e não vale para lançar despesa.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS malote_despesa_0_excecao_senha_so_criacao ON public.malote_despesa;
CREATE TRIGGER malote_despesa_0_excecao_senha_so_criacao
  BEFORE INSERT OR UPDATE ON public.malote_despesa
  FOR EACH ROW EXECUTE FUNCTION public.malote_despesa_senha_so_de_criacao();

-- ── BLOCO 5 ── decidir (corpo da 20261016000010) com a notificação certa para cada finalidade
CREATE OR REPLACE FUNCTION public.malote_excecao_decidir(_id uuid, _aprovar boolean, _motivo text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.malote_excecao_solicitacao%ROWTYPE;
  v_senha text;
  v_como_n2 boolean;
  v_sufixo text;
  v_uso text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão ausente.'; END IF;
  SELECT * INTO s FROM public.malote_excecao_solicitacao WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF s.status <> 'em_analise' THEN RAISE EXCEPTION 'Esta solicitação já foi decidida (%).', s.status; END IF;
  IF NOT public.malote_excecao_pode_decidir(s.classificacao_id, auth.uid()) THEN
    RAISE EXCEPTION 'Você não é aprovador desta solicitação de exceção (veja em Malote › Configurações quem aprova).';
  END IF;
  IF NOT _aprovar AND btrim(COALESCE(_motivo, '')) = '' THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação.';
  END IF;

  v_como_n2 := NOT EXISTS (SELECT 1 FROM public.malote_config c WHERE c.id = true AND c.excecao_aprovacao_modo <> 'n2' AND c.excecao_aprovador_user_id = auth.uid());
  v_sufixo := CASE WHEN v_como_n2 THEN ' (decidida como N2 da classificação)' ELSE '' END;
  v_uso := CASE WHEN s.finalidade = 'aprovacao'
                THEN 'Informe a senha ao aprovar a despesa no Nível 1, na própria despesa, em até 24 horas.'
                ELSE 'Use a senha na criação da despesa em até 24 horas. Veja em Malote › Solicitar Exceção.' END;

  IF _aprovar THEN
    LOOP
      v_senha := 'EXC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.malote_excecao_solicitacao WHERE senha = v_senha);
    END LOOP;
    UPDATE public.malote_excecao_solicitacao
       SET status = 'aprovada', decidido_por = auth.uid(), decidido_em = now(), motivo_decisao = NULLIF(btrim(COALESCE(_motivo, '')), ''),
           senha = v_senha, senha_expira_em = now() + interval '24 hours', updated_at = now()
     WHERE id = _id;
    INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
    VALUES (_id, 'aprovada', auth.uid(), 'Exceção aprovada' || v_sufixo || '. Senha gerada, válida por 24 horas.');
    PERFORM public.malote_notificar_usuarios(
      ARRAY[s.solicitante_id], s.empresa_id,
      'Exceção aprovada — senha liberada',
      format('A exceção %s foi aprovada. %s', s.numero, v_uso),
      'malote_excecao', '/app/malote/excecao/solicitar'
    );
    RETURN v_senha;
  END IF;

  UPDATE public.malote_excecao_solicitacao
     SET status = 'reprovada', decidido_por = auth.uid(), decidido_em = now(), motivo_decisao = btrim(_motivo), updated_at = now()
   WHERE id = _id;
  INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'reprovada', auth.uid(), 'Exceção reprovada' || v_sufixo || ': ' || btrim(_motivo));
  PERFORM public.malote_notificar_usuarios(
    ARRAY[s.solicitante_id], s.empresa_id,
    'Exceção reprovada',
    format('A exceção %s foi reprovada. Motivo: %s', s.numero, btrim(_motivo)),
    'malote_excecao', '/app/malote/excecao/solicitar'
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_excecao_decidir(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_excecao_decidir(uuid, boolean, text) TO authenticated;

-- ── BLOCO 6 ── aprovar despesa com a senha (DROP da assinatura antiga + CREATE da nova, juntos)
DROP FUNCTION IF EXISTS public.malote_aprovar_despesa(uuid, boolean, numeric, text, text, text, date, date, jsonb, text);
-- Sobra mais antiga (8 parâmetros, sem rateio nem autorizador) que continuava em produção: chamada direto pela API aprovaria SEM as
-- regras novas (nem esta do Nível 1, nem o fluxo especial, nem o congelamento do rateio). A tela sempre usa a versão completa.
DROP FUNCTION IF EXISTS public.malote_aprovar_despesa(uuid, boolean, numeric, text, text, text, date, date);

CREATE OR REPLACE FUNCTION public.malote_aprovar_despesa(
  _id uuid,
  _proximo_nivel_configurado boolean,
  _valor_aprovado numeric,
  _justificativa text,
  _forma_pagamento text,
  _informacoes_pagamento text,
  _data_pagamento date,
  _competencia date,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb,
  _autorizador_nome text DEFAULT NULL,
  _senha_excecao text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_nivel smallint;
  v_excecao boolean;
  v_forma_atual text;
  v_fluxo_especial boolean;
  v_finaliza boolean;
  v_linha jsonb;
  v_senha text;
  v_horario time;
  s public.malote_excecao_solicitacao%ROWTYPE;
BEGIN
  SELECT status, nivel_aprovacao_atual, excecao, forma_pagamento
    INTO v_status, v_nivel, v_excecao, v_forma_atual
    FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'pendente_aprovacao' THEN RAISE EXCEPTION 'Despesa não está pendente de aprovação.'; END IF;

  IF _data_pagamento < ((now() AT TIME ZONE 'America/Sao_Paulo')::date) THEN
    RAISE EXCEPTION 'Data de pagamento % é anterior a hoje — não é possível aprovar. Peça "Solicitar ajuste" para corrigir a data antes.', _data_pagamento;
  END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_e_aprovador_do_nivel(_id, v_nivel, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR (v_excecao AND public.malote_gerente_financeiro(auth.uid()))
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta despesa.';
  END IF;

  -- Nível 1 depois do horário 1.1: só com a senha de uma exceção de aprovação desta despesa. Despesa que já é exceção
  -- (lançada com senha) e chamadas sem sessão (jobs) ficam de fora.
  IF v_nivel = 1 AND NOT COALESCE(v_excecao, false) AND auth.uid() IS NOT NULL AND public.malote_n1_fora_do_prazo() THEN
    SELECT inclusao_setor_horario INTO v_horario FROM public.malote_config WHERE id = true;
    v_senha := upper(btrim(COALESCE(_senha_excecao, '')));
    IF v_senha = '' THEN
      RAISE EXCEPTION 'Depois das % o Nível 1 só aprova com a senha de uma exceção de aprovação (regra 1.1). Peça a chave em "Solicitar exceção de aprovação", na própria despesa.', to_char(v_horario, 'HH24:MI');
    END IF;
    SELECT * INTO s FROM public.malote_excecao_solicitacao WHERE senha = v_senha FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Senha de exceção não encontrada.'; END IF;
    IF s.finalidade <> 'aprovacao' OR s.despesa_alvo_id IS DISTINCT FROM _id THEN
      RAISE EXCEPTION 'Esta senha não é a chave de aprovação desta despesa.';
    END IF;
    IF s.solicitante_id <> auth.uid() THEN RAISE EXCEPTION 'Esta senha foi pedida por outro usuário.'; END IF;
    IF s.status = 'utilizada' THEN RAISE EXCEPTION 'Esta senha já foi utilizada.'; END IF;
    IF s.status <> 'aprovada' THEN RAISE EXCEPTION 'Esta senha não está ativa (%).', s.status; END IF;
    IF now() > s.senha_expira_em THEN RAISE EXCEPTION 'Esta senha expirou (valia 24 horas a partir da aprovação). Peça uma nova chave.'; END IF;

    UPDATE public.malote_excecao_solicitacao
       SET status = 'utilizada', usada_em = now(), despesa_id = _id, updated_at = now()
     WHERE id = s.id;
    INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
    VALUES (s.id, 'senha_utilizada', auth.uid(), 'Senha utilizada na aprovação do Nível 1.');
  END IF;

  SELECT fp.fluxo_aprovacao = 'especial' INTO v_fluxo_especial
    FROM public.malote_forma_pagamento fp WHERE fp.nome = v_forma_atual;
  v_finaliza := COALESCE(v_fluxo_especial, false) OR NOT (v_nivel < 3 AND _proximo_nivel_configurado);

  UPDATE public.malote_despesa SET
    valor_aprovado = _valor_aprovado,
    justificativa_aprovacao = _justificativa,
    forma_pagamento = _forma_pagamento,
    informacoes_pagamento = _informacoes_pagamento,
    data_pagamento = _data_pagamento,
    competencia = _competencia,
    autorizador_nome = COALESCE(_autorizador_nome, autorizador_nome),
    nivel_aprovacao_atual = CASE WHEN v_finaliza THEN nivel_aprovacao_atual ELSE v_nivel + 1 END,
    status = CASE WHEN v_finaliza THEN 'aguardando_pagamento' ELSE status END
  WHERE id = _id;

  IF v_finaliza THEN
    FOR v_linha IN SELECT * FROM jsonb_array_elements(_rateio_snapshot)
    LOOP
      UPDATE public.malote_despesa_rateio_linha
      SET orcado_snapshot = (v_linha->>'orcado')::numeric,
          utilizado_com_lancamento_snapshot = (v_linha->>'utilizado_com_lancamento')::numeric,
          congelado_em = now()
      WHERE id = (v_linha->>'linha_id')::uuid
        AND despesa_id = _id;
    END LOOP;
  END IF;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_id, 'aprovacao_nivel', _justificativa, v_nivel, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.malote_aprovar_despesa(uuid, boolean, numeric, text, text, text, date, date, jsonb, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
