-- =========================================================================
-- Demissão: o encarregado CANCELA (reconsidera) a solicitação — até o ASO
-- ser agendado
--
-- PEDIDO (17/09/2026, Pablo)
--   Depois de aprovada e no SST, a demissão não é mais alterável pelo RH, e
--   às vezes o aviso é reconsiderado pelo encarregado. Ele ganha o botão
--   CANCELAR (em Solicitar Demissão e em Minhas Solicitações): "Tem certeza
--   que deseja reconsiderar? Informe o motivo" → a solicitação fica
--   CANCELADA (vermelho) com o motivo. Se o ASO já foi AGENDADO, não cancela
--   mais — o exame tem custo — e a tela avisa.
--
-- O QUE MUDA
--   1. Colunas cancelado_por / cancelado_em / cancelado_motivo.
--   2. RPC demissao_cancelar(p_id, p_motivo): só o SOLICITANTE (e-mail do
--      login) cancela; motivo com 10+ caracteres; recusa se o ASO já está
--      agendado / válido, se já foi concluída, reprovada ou cancelada. Grava
--      o status 'Cancelada', o carimbo, e escreve no fio da conversa
--      (SISTEMA_COMENTARIOS) pra RH e SST verem o motivo sem abrir o card.
--      A vaga de Substituição vinculada que ainda está "Pendente ..." (nem
--      chegou a abrir) é cancelada junto — não faz sentido repor quem fica.
--      Vaga já em seleção fica como está: quem decide é o Recrutamento.
--   3. demissao_exige_vaga deixa a solicitação ir pra 'Cancelada' mesmo sem
--      a vaga de reposição — cancelar não é "seguir".
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ADD COLUMN IF NOT EXISTS cancelado_por    text,
  ADD COLUMN IF NOT EXISTS cancelado_em     timestamptz,
  ADD COLUMN IF NOT EXISTS cancelado_motivo text;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".cancelado_motivo IS
  'Por que o encarregado reconsiderou (cancelou) a demissão — RPC demissao_cancelar (17/09/2026).';

-- 3) Cancelar não é seguir: o trigger da vaga deixa passar.
CREATE OR REPLACE FUNCTION public.demissao_exige_vaga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.vaga_obrigatoria
     AND NEW.vaga_id IS NULL
     AND OLD.status IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria')
     AND NEW.status NOT IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria', 'Reprovada', 'Cancelada')
     AND length(btrim(coalesce(NEW.sem_vaga_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'Esta demissão ainda não tem a vaga de reposição. Abra a vaga de Substituição de % ou descreva o motivo da exceção antes de o pedido seguir.', NEW.colaborador_nome;
  END IF;
  RETURN NEW;
END $fn$;

-- 2) A RPC
CREATE OR REPLACE FUNCTION public.demissao_cancelar(p_id bigint, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d       record;
  v_email text := lower(coalesce(auth.email(), ''));
  v_nome  text;
  v_vaga  text := NULL;
BEGIN
  IF length(btrim(coalesce(p_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo da reconsideração (mín. 10 caracteres).';
  END IF;
  SELECT * INTO d FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Solicitação #% não existe.', p_id; END IF;
  IF lower(coalesce(d.solicitante_email, '')) <> v_email THEN
    RAISE EXCEPTION 'Só quem solicitou a demissão pode cancelá-la.';
  END IF;
  IF d.status IN ('Agendamento concluído', 'ASO válido') THEN
    RAISE EXCEPTION 'O ASO demissional já foi agendado — a solicitação não pode mais ser cancelada, porque o exame já tem custo. Fale com o SST.';
  END IF;
  IF d.status IN ('Concluída', 'Reprovada', 'Cancelada') THEN
    RAISE EXCEPTION 'A solicitação já está %: não há o que cancelar.', lower(d.status);
  END IF;

  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();

  UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
     SET status = 'Cancelada',
         cancelado_por = coalesce(v_nome, v_email),
         cancelado_em = now(),
         cancelado_motivo = btrim(p_motivo),
         atualizado_em = now()
   WHERE id = p_id;

  -- A vaga de Substituição que nem abriu ainda cai junto.
  IF d.vaga_id IS NOT NULL THEN
    UPDATE public."SISTEMA_RECRUTAMENTO"
       SET status = 'Cancelada'
     WHERE id = d.vaga_id AND status LIKE 'Pendente%';
    IF FOUND THEN v_vaga := 'cancelada'; ELSE v_vaga := 'mantida'; END IF;
  END IF;

  -- No fio da conversa, pra RH e SST verem sem abrir o card.
  INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, autor_cpf, texto)
  VALUES ('demissao', p_id::text, coalesce(v_nome, v_email), v_email,
          '🚫 DEMISSÃO CANCELADA pelo solicitante. Motivo: ' || btrim(p_motivo));

  RETURN jsonb_build_object('id', p_id, 'status', 'Cancelada', 'vaga', v_vaga);
END $fn$;
REVOKE ALL ON FUNCTION public.demissao_cancelar(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demissao_cancelar(bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.demissao_cancelar(bigint, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.demissao_cancelar(bigint, text);
-- Reaplicar demissao_exige_vaga da 20260930000169 (sem 'Cancelada');
-- ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
--   DROP COLUMN IF EXISTS cancelado_por, DROP COLUMN IF EXISTS cancelado_em, DROP COLUMN IF EXISTS cancelado_motivo;
-- NOTIFY pgrst, 'reload schema';
