-- =========================================================================
-- Orientações Jurídicas: "é do encarregado" passa a ser QUEM pergunta, não a
-- porta; e o Operacional também REPROVA
--
-- PROBLEMA (25/09/2026, Pablo)
--   "Mesmo tendo permissões não tá aparecendo no Operacional › Orientações
--   Jurídicas pra aprovar; tem que aparecer lá, pra conseguir responder ou
--   passar direto pro Jurídico. Ou reprovar."
--   A mig 244 decidia a origem pela TELA (Encarregados › Orientações). Mas o
--   encarregado também pergunta pela Central de Serviços — a #31 (hoje) e as
--   #24/#28 saíram por lá e foram direto para a aprovação do Jurídico.
--
-- AGORA
--   1. Origem 'encarregados' = quem pergunta tem a tela Orientações Jurídicas
--      do módulo Encarregados (encarregados_orientacoes — exceção individual
--      ou perfil, sem o "concede tudo" do admin), OU veio por aquela porta.
--   2. Retroativo: perguntas de encarregado ganham origem 'encarregados' (o
--      Operacional passa a vê-las); as ainda 'Aberta' vão para 'Pendente
--      Operacional'. As já aprovadas/respondidas ficam onde estão.
--   3. jur_duvida_operacional_decidir ganha 'reprovar' (motivo obrigatório,
--      vai para quem perguntou — o gatilho de sino já avisa Reprovada).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.jur_duvida_autor_e_encarregado(p_autor uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT p_autor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.malote_usuarios_com_acesso('encarregados_orientacoes', 'visualizar'::public.app_acao) u
     WHERE u = p_autor);
$fn$;
REVOKE ALL ON FUNCTION public.jur_duvida_autor_e_encarregado(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.jur_duvidas_status_inicial()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.origem := CASE WHEN NEW.origem = 'encarregados' OR public.jur_duvida_autor_e_encarregado(NEW.autor_id)
                     THEN 'encarregados' ELSE 'central' END;
  NEW.status := CASE WHEN NEW.origem = 'encarregados' THEN 'Pendente Operacional' ELSE 'Aberta' END;
  IF coalesce(NEW.publicada, true) = false THEN
    NEW.ocultada_por := coalesce(NEW.ocultada_por, NEW.autor_nome, 'quem perguntou');
    NEW.ocultada_em  := coalesce(NEW.ocultada_em, now());
  END IF;
  RETURN NEW;
END $fn$;

-- Retroativo (sem disparar o sino de "nova" — o gatilho de notificação só
-- olha INSERT e troca de status; a troca Aberta → Pendente Operacional não
-- está entre as que avisam).
UPDATE public."JUR_DUVIDAS" d
   SET origem = 'encarregados'
 WHERE d.origem = 'central' AND public.jur_duvida_autor_e_encarregado(d.autor_id);
UPDATE public."JUR_DUVIDAS"
   SET status = 'Pendente Operacional', updated_at = now()
 WHERE origem = 'encarregados' AND status = 'Aberta';

-- O Operacional decide: responde, encaminha ao Jurídico ou reprova.
CREATE OR REPLACE FUNCTION public.jur_duvida_operacional_decidir(p_id bigint, p_acao text, p_texto text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d       record;
  v_nome  text;
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
BEGIN
  IF NOT public.pode_orientar_operacional() THEN
    RAISE EXCEPTION 'Só o Operacional (Orientações Jurídicas) decide esta orientação.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM public."JUR_DUVIDAS" WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Orientação #% não existe.', p_id; END IF;
  IF d.status <> 'Pendente Operacional' THEN
    RAISE EXCEPTION 'Esta orientação já saiu do Operacional (está %).', d.status;
  END IF;
  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();

  IF p_acao = 'responder' THEN
    IF length(coalesce(v_texto, '')) < 5 THEN RAISE EXCEPTION 'Escreva a orientação para o encarregado.'; END IF;
    UPDATE public."JUR_DUVIDAS"
       SET status = 'Respondida', resposta = v_texto, respondido_por = v_nome || ' (Operacional)',
           respondido_em = now(), respondido_etapa = 'operacional',
           publicada = false,
           operacional_por = v_nome, operacional_em = now(), operacional_acao = 'respondeu',
           updated_at = now()
     WHERE id = p_id;
  ELSIF p_acao = 'encaminhar' THEN
    UPDATE public."JUR_DUVIDAS"
       SET status = 'Aprovada', aprovado_por = v_nome || ' (Operacional)', aprovado_em = now(),
           operacional_por = v_nome, operacional_em = now(), operacional_acao = 'encaminhou',
           operacional_obs = v_texto, updated_at = now()
     WHERE id = p_id;
  ELSIF p_acao = 'reprovar' THEN
    IF length(coalesce(v_texto, '')) < 5 THEN RAISE EXCEPTION 'Escreva o motivo da reprovação — é o que o encarregado lê.'; END IF;
    UPDATE public."JUR_DUVIDAS"
       SET status = 'Reprovada', motivo_reprovacao = v_texto,
           aprovado_por = v_nome || ' (Operacional)', aprovado_em = now(),
           operacional_por = v_nome, operacional_em = now(), operacional_acao = 'reprovou',
           updated_at = now()
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Ação inválida: %', p_acao;
  END IF;
  RETURN jsonb_build_object('id', p_id, 'acao', p_acao);
END $fn$;
REVOKE ALL ON FUNCTION public.jur_duvida_operacional_decidir(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_duvida_operacional_decidir(bigint, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar jur_duvidas_status_inicial e jur_duvida_operacional_decidir da 20260930000244;
-- DROP FUNCTION IF EXISTS public.jur_duvida_autor_e_encarregado(uuid);
-- (as perguntas movidas para 'Pendente Operacional' ficam — decidir no Operacional)
-- NOTIFY pgrst, 'reload schema';
