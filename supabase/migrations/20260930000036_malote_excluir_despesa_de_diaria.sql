-- =====================================================================
-- SIS-2026-0287 — apagar no Malote uma despesa que veio de diária.
--
-- Relato do usuário em /app/malote/aprovacoes: "Excluir permanentemente"
-- devolvia
--   update or delete on table "malote_despesa" violates foreign key
--   constraint "DIARIA_SOLICITACAO_malote_despesa_id_fkey"
-- para toda despesa criada a partir de /app/operacional/diarias. O botão
-- existe para limpar dado de teste — e era justamente nas diárias de teste
-- que ele não funcionava.
--
-- Causa: "DIARIA_SOLICITACAO".malote_despesa_id referencia malote_despesa(id)
-- sem ON DELETE (20260930000019), então o Postgres bloqueia o DELETE enquanto
-- a diária apontar para a despesa.
--
-- Correção em três partes:
--   1) diaria_desfazendo_aprovacao() — GUC de transação, igual ao
--      diaria_recalculando() que já existe;
--   2) diaria_guard() passa a aceitar a volta de 'aprovada' para 'solicitada'
--      quando essa GUC está ligada (fora dela, nada muda: continua proibido
--      redecidir uma solicitação já decidida);
--   3) malote_excluir_permanentemente() solta a diária antes de apagar.
--
-- Efeito para o usuário: apagou a despesa, a diária volta para "Solicitada" e
-- pode ser aprovada de novo — em vez de ficar presa apontando para uma
-- despesa que não existe mais.
-- =====================================================================

-- Marca de "estou desfazendo a aprovação porque a despesa está sendo apagada".
-- Vale só dentro da transação que a liga (is_local = true).
CREATE OR REPLACE FUNCTION public.diaria_desfazendo_aprovacao() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$ SELECT COALESCE(current_setting('diaria.desfazendo_aprovacao', true), '') = '1' $$;

CREATE OR REPLACE FUNCTION public.diaria_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- SIS-2026-0287 (correção): excluir permanentemente no Malote uma despesa
  -- nascida de diária esbarrava na FK DIARIA_SOLICITACAO_malote_despesa_id_fkey
  -- ("update or delete on table malote_despesa violates foreign key
  -- constraint"). O botão "Excluir permanentemente" simplesmente não
  -- funcionava para essas despesas.
  --
  -- A FK fica onde está: é ela que garante que diária 'aprovada' aponta para
  -- uma despesa que existe de verdade — o próprio guard exige
  -- malote_despesa_id para aprovar. Quem cede é o ESTADO da diária: apagar a
  -- despesa desfaz a aprovação e devolve a solicitação para 'solicitada',
  -- pronta para ser decidida de novo. (Patrimônio e Reembolso guardam o mesmo
  -- vínculo sem FK; aqui a FK é deliberada e não vale trocar por link solto.)
  --
  -- A GUC só é ligada dentro de malote_excluir_permanentemente(), que é
  -- SECURITY DEFINER e já exige can_access(..., 'excluir'). Mesmo desenho do
  -- diaria.recalculando: coluna-bandeira não serve, porque o guard roda no
  -- mesmo UPDATE que a mudaria. set_config() vive em pg_catalog e não é
  -- exposto pelo PostgREST, então o cliente não liga isso por fora.
  IF public.diaria_desfazendo_aprovacao() THEN
    RETURN NEW;
  END IF;

  IF NEW.valor_total_centavos IS DISTINCT FROM OLD.valor_total_centavos
     AND NOT public.diaria_recalculando() THEN
    RAISE EXCEPTION 'O total é calculado pelas diárias, não pode ser digitado.';
  END IF;
  IF NEW.valor_total_centavos IS DISTINCT FROM OLD.valor_total_centavos
     AND public.diaria_recalculando() THEN
    RETURN NEW;
  END IF;
  IF NEW.solicitante_id IS DISTINCT FROM OLD.solicitante_id THEN
    RAISE EXCEPTION 'O solicitante não muda.';
  END IF;
  IF NEW.numero IS DISTINCT FROM OLD.numero THEN
    RAISE EXCEPTION 'O número da solicitação não muda.';
  END IF;

  IF public.can_access(auth.uid(), 'operacional_diarias', 'aprovar') THEN
    IF (to_jsonb(NEW) - ARRAY[
          'status', 'malote_motivo', 'malote_data_pagamento',
          'malote_despesa_id', 'enviado_malote_em',
          'decidido_por', 'decidido_por_nome', 'decidido_em', 'updated_at'
        ]::text[])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY[
          'status', 'malote_motivo', 'malote_data_pagamento',
          'malote_despesa_id', 'enviado_malote_em',
          'decidido_por', 'decidido_por_nome', 'decidido_em', 'updated_at'
        ]::text[]) THEN
      RAISE EXCEPTION 'A aprovação não pode alterar os dados da solicitação.';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status <> 'solicitada' THEN
        RAISE EXCEPTION 'A solicitação já foi % e não pode ser decidida novamente.', OLD.status;
      END IF;
      IF NEW.status NOT IN ('aprovada', 'reprovada') THEN
        RAISE EXCEPTION 'Decisão inválida para a solicitação.';
      END IF;
      IF OLD.solicitante_id = auth.uid() THEN
        RAISE EXCEPTION 'Quem solicitou a diária não pode aprovar ou reprovar a própria solicitação.';
      END IF;
      IF NEW.status = 'aprovada'
         AND (btrim(coalesce(NEW.malote_motivo, '')) = ''
              OR NEW.malote_data_pagamento IS NULL) THEN
        RAISE EXCEPTION 'Nome/motivo e data de pagamento são obrigatórios para aprovar.';
      END IF;
      IF NEW.status = 'aprovada' AND NEW.malote_despesa_id IS NULL THEN
        RAISE EXCEPTION 'A diária só pode ser aprovada pela RPC que cria a despesa do Malote.';
      END IF;
      IF NEW.status = 'reprovada' THEN
        NEW.malote_motivo := NULL;
        NEW.malote_data_pagamento := NULL;
      END IF;
      NEW.decidido_por := auth.uid();
      NEW.decidido_em := now();
      SELECT COALESCE(p.display_name, p.email) INTO NEW.decidido_por_nome
        FROM public.profiles p WHERE p.id = auth.uid();
    ELSIF NEW.malote_motivo IS DISTINCT FROM OLD.malote_motivo
       OR NEW.malote_data_pagamento IS DISTINCT FROM OLD.malote_data_pagamento
       OR NEW.malote_despesa_id IS DISTINCT FROM OLD.malote_despesa_id
       OR NEW.enviado_malote_em IS DISTINCT FROM OLD.enviado_malote_em
       OR NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
       OR NEW.decidido_por_nome IS DISTINCT FROM OLD.decidido_por_nome
       OR NEW.decidido_em IS DISTINCT FROM OLD.decidido_em THEN
      RAISE EXCEPTION 'Os dados da decisão só mudam junto com o status.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Você não tem permissão para decidir esta solicitação.';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['observacoes', 'updated_at']::text[])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['observacoes', 'updated_at']::text[]) THEN
    RAISE EXCEPTION 'Depois de criada, somente a observação da solicitação pode ser corrigida.';
  END IF;
  IF NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
     OR NEW.decidido_por_nome IS DISTINCT FROM OLD.decidido_por_nome
     OR NEW.decidido_em IS DISTINCT FROM OLD.decidido_em
     OR NEW.malote_motivo IS DISTINCT FROM OLD.malote_motivo
     OR NEW.malote_data_pagamento IS DISTINCT FROM OLD.malote_data_pagamento
     OR NEW.malote_despesa_id IS DISTINCT FROM OLD.malote_despesa_id
     OR NEW.enviado_malote_em IS DISTINCT FROM OLD.enviado_malote_em THEN
    RAISE EXCEPTION 'Só quem aprova preenche os dados do Malote.';
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.malote_excluir_permanentemente(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origem text;
  v_menu text;
BEGIN
  SELECT origem INTO v_origem FROM public.malote_despesa WHERE id = _id;
  IF v_origem IS NULL THEN RAISE EXCEPTION 'Item não encontrado.'; END IF;

  v_menu := CASE WHEN v_origem = 'solicitacao' THEN 'malote_solicitacao_visualizar' ELSE 'malote_despesa_visualizar' END;

  IF NOT public.can_access(auth.uid(), v_menu, 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir permanentemente este item.';
  END IF;

  -- SIS-2026-0287: solta a diária ANTES do DELETE, senão a FK barra tudo. A
  -- solicitação volta a aguardar decisão, sem rastro da aprovação desfeita —
  -- é o mesmo estado em que ela estava antes de alguém clicar em aprovar.
  PERFORM set_config('diaria.desfazendo_aprovacao', '1', true);
  UPDATE public."DIARIA_SOLICITACAO"
     SET status                = 'solicitada',
         malote_despesa_id     = NULL,
         malote_motivo         = NULL,
         malote_data_pagamento = NULL,
         enviado_malote_em     = NULL,
         decidido_por          = NULL,
         decidido_por_nome     = NULL,
         decidido_em           = NULL
   WHERE malote_despesa_id = _id;
  PERFORM set_config('diaria.desfazendo_aprovacao', '0', true);

  -- malote_despesa_rateio_linha, malote_despesa_parcela e
  -- malote_despesa_evento têm FK ON DELETE CASCADE — não precisa deletar
  -- manualmente.
  DELETE FROM public.malote_despesa WHERE id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.diaria_desfazendo_aprovacao()          FROM public, anon;
REVOKE ALL ON FUNCTION public.malote_excluir_permanentemente(uuid)   FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_excluir_permanentemente(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (executar manualmente)
--
-- Reexecutar, nesta ordem:
--   1) 20260930000035_diaria_competencia_cast_date.sql  (repõe o diaria_guard
--      sem o desvio da GUC — é a versão imediatamente anterior a esta);
--   2) 20260913000001_malote_exclusao_permanente.sql    (repõe a RPC de
--      exclusão sem o passo que solta a diária);
--   3) DROP FUNCTION IF EXISTS public.diaria_desfazendo_aprovacao();
--
-- Depois disso o botão "Excluir permanentemente" volta a falhar em despesa de
-- diária — é exatamente o bug que esta migration corrige.
-- =====================================================================
