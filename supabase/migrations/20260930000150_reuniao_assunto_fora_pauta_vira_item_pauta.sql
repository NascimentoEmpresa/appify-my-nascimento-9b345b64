-- SIS-2026-0393: "Assunto fora de pauta não aparece em nenhum lugar".
--
-- Até aqui o assunto fora da pauta vivia só em reuniao_assunto_fora_pauta e
-- só era listado no card lateral da tela de Condução — que redireciona pro
-- detalhe assim que a reunião é encerrada. Resultado: depois de criado, o
-- assunto não podia receber decisão/ação (reuniao_decisao_acao e a RPC
-- criar_acao_reuniao_plano_acao exigem pauta_id), não entrava na ata final
-- (o PDF percorre só reuniao_pauta) e sumia de vista ao encerrar a reunião.
--
-- Pedido do gestor: o assunto fora da pauta tem que ter a MESMA tratativa dos
-- itens de pauta — ser conduzido durante a reunião, gerar ação no Plano de
-- Ações e sair na ata final. Em vez de duplicar toda a maquinaria de
-- condução/decisões/ações/ata pra uma segunda tabela, cada assunto fora da
-- pauta passa a ter um item correspondente em reuniao_pauta (marcado com
-- fora_pauta = true). reuniao_assunto_fora_pauta continua guardando os dados
-- próprios do assunto (classificação, tratativa, estacionamento, concluído).

-- 1) Marca de origem no item de pauta ------------------------------------------
ALTER TABLE public.reuniao_pauta
  ADD COLUMN IF NOT EXISTS fora_pauta boolean NOT NULL DEFAULT false;

-- 2) Vínculo assunto → item de pauta ---------------------------------------------
-- CASCADE: excluir o item de pauta exclui o assunto junto (são a mesma coisa
-- do ponto de vista do usuário).
ALTER TABLE public.reuniao_assunto_fora_pauta
  ADD COLUMN IF NOT EXISTS pauta_id uuid REFERENCES public.reuniao_pauta(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_reuniao_assunto_fora_pauta_pauta ON public.reuniao_assunto_fora_pauta(pauta_id);

-- 3) Trigger: todo assunto novo ganha seu item de pauta, na mesma transação ----
-- SECURITY INVOKER de propósito: o INSERT em reuniao_pauta passa pela RLS
-- normal (organizador/criador/responsável pela ata, reunião agendada ou em
-- andamento) — mesma regra de quem já pode adicionar item de pauta.
CREATE OR REPLACE FUNCTION public.reuniao_assunto_fora_pauta_criar_item_pauta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ordem    int;
  v_pauta_id uuid;
BEGIN
  IF NEW.pauta_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(ordem) + 1, 0) INTO v_ordem
    FROM public.reuniao_pauta WHERE reuniao_id = NEW.reuniao_id;

  INSERT INTO public.reuniao_pauta (
    reuniao_id, ordem, titulo_topico, descricao, responsavel_user_id, prazo, fora_pauta
  ) VALUES (
    NEW.reuniao_id,
    v_ordem,
    COALESCE(NULLIF(btrim(NEW.assunto_estacionado), ''), 'Assunto fora da pauta'),
    NULLIF(btrim(NEW.observacoes), ''),
    NEW.responsavel_tratativa_user_id,
    NEW.data_prevista,
    true
  ) RETURNING id INTO v_pauta_id;

  NEW.pauta_id := v_pauta_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reuniao_assunto_fora_pauta_criar_item_pauta ON public.reuniao_assunto_fora_pauta;
CREATE TRIGGER trg_reuniao_assunto_fora_pauta_criar_item_pauta
  BEFORE INSERT ON public.reuniao_assunto_fora_pauta
  FOR EACH ROW EXECUTE FUNCTION public.reuniao_assunto_fora_pauta_criar_item_pauta();

-- 4) UPDATE nunca teve policy — o botão "Marcar como resolvido" do card de
--    assuntos fora da pauta atualizava zero linhas em silêncio (RLS sem
--    policy de UPDATE não erra, só não aplica).
DROP POLICY IF EXISTS reuniao_assunto_fora_pauta_update ON public.reuniao_assunto_fora_pauta;
CREATE POLICY reuniao_assunto_fora_pauta_update ON public.reuniao_assunto_fora_pauta
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('central_servicos_reunioes') AND public.tem_interacao_reuniao(reuniao_id))
  WITH CHECK (public.tem_acesso_menu('central_servicos_reunioes') AND public.tem_interacao_reuniao(reuniao_id));

-- 5) Backfill: assuntos já registrados (que "sumiram") ganham seu item de
--    pauta, no fim da pauta da respectiva reunião, na ordem em que foram
--    criados. Roda como dono no SQL Editor, então não passa por RLS.
DO $$
DECLARE
  a        record;
  v_ordem  int;
  v_pauta  uuid;
BEGIN
  FOR a IN
    SELECT * FROM public.reuniao_assunto_fora_pauta
     WHERE pauta_id IS NULL
     ORDER BY reuniao_id, created_at
  LOOP
    SELECT COALESCE(MAX(ordem) + 1, 0) INTO v_ordem
      FROM public.reuniao_pauta WHERE reuniao_id = a.reuniao_id;

    INSERT INTO public.reuniao_pauta (
      reuniao_id, ordem, titulo_topico, descricao, responsavel_user_id, prazo, fora_pauta
    ) VALUES (
      a.reuniao_id,
      v_ordem,
      COALESCE(NULLIF(btrim(a.assunto_estacionado), ''), 'Assunto fora da pauta'),
      NULLIF(btrim(a.observacoes), ''),
      a.responsavel_tratativa_user_id,
      a.data_prevista,
      true
    ) RETURNING id INTO v_pauta;

    UPDATE public.reuniao_assunto_fora_pauta SET pauta_id = v_pauta WHERE id = a.id;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_reuniao_assunto_fora_pauta_criar_item_pauta ON public.reuniao_assunto_fora_pauta;
-- DROP FUNCTION IF EXISTS public.reuniao_assunto_fora_pauta_criar_item_pauta();
-- DROP POLICY IF EXISTS reuniao_assunto_fora_pauta_update ON public.reuniao_assunto_fora_pauta;
-- DELETE FROM public.reuniao_pauta WHERE fora_pauta; -- apaga também os assuntos (CASCADE) — rode só se quiser desfazer tudo
-- ALTER TABLE public.reuniao_assunto_fora_pauta DROP COLUMN IF EXISTS pauta_id;
-- ALTER TABLE public.reuniao_pauta DROP COLUMN IF EXISTS fora_pauta;
-- NOTIFY pgrst, 'reload schema';
