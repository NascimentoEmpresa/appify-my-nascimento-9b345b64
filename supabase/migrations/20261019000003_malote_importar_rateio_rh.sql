-- =========================================================================
-- MALOTE › CRIAR DESPESA → "IMPORTAR RATEIO" DO RH (19/10/2026)
--
-- Pablo (19/10): "integrar o módulo de rateio com o Malote — um rateio já
-- feito pode ser usado no Malote sem redigitar". O caminho RH → Malote já
-- existia ("Enviar ao Malote", mig 20261016000020). Este é o caminho de
-- volta, aprovado pelo Pablo em 19/10:
--   · no Criar Despesa, "Importar rateio" lista os rateios CONFERIDOS que
--     ainda não estão no Malote;
--   · o fornecedor é escolhido na importação e vale para todas as linhas;
--   · o rateio fica VINCULADO à despesa e TRAVADO, igual ao Enviar ao
--     Malote (mesma coluna RH_RATEIO_DESPESA.malote_despesa_id, mesma
--     rh_rateio_malote_ativo: excluir/reprovar/cancelar a despesa solta).
--
-- POR QUE UMA COLUNA EM malote_despesa E UM GATILHO (e não uma RPC depois)
-- O Criar Despesa grava pelo cliente (useSalvarDespesa: INSERT + linhas).
-- Uma RPC de "vincular" chamada depois deixaria uma janela: duas pessoas
-- importam o mesmo rateio, as duas despesas nascem e só uma fica vinculada.
-- Com malote_despesa.rh_rateio_id no próprio INSERT, o gatilho AFTER INSERT
-- trava o rateio (FOR UPDATE) e recusa — o INSERT inteiro volta. Por isso
-- AFTER e não BEFORE: o UPDATE do rateio aponta (FK) para a despesa, que
-- precisa existir.
--
-- O gatilho confere: permissão, rateio conferido, ainda livre e valor da
-- despesa = valor do rateio. A soma das linhas = total é a regra normal do
-- painel (igual a qualquer despesa). rh_rateio_id não muda depois do INSERT.
--
-- PERMISSÃO: a MESMA ação do caminho de ida — 'enviar_malote' no menu
-- rh_rateio_despesas. Ver os rateios do RH e transformá-los em despesa é o
-- mesmo poder, por outra porta; quem só lança despesa no Malote não vê os
-- rateios do RH (valores por contrato de FGTS, seguro etc.).
--
-- Idempotente. Entra sozinha no merge da main (cluster_pos_merge.yml).
-- =========================================================================

-- ── 1) Vínculo na despesa ────────────────────────────────────────────────
ALTER TABLE public.malote_despesa
  ADD COLUMN IF NOT EXISTS rh_rateio_id uuid REFERENCES public."RH_RATEIO_DESPESA"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_malote_despesa_rh_rateio ON public.malote_despesa(rh_rateio_id) WHERE rh_rateio_id IS NOT NULL;

-- ── 2) Rateios que podem ser importados ──────────────────────────────────
-- SECURITY DEFINER: quem importa pode não ter a tela do RH (RLS de
-- RH_RATEIO_DESPESA é rh_rateio_pode('visualizar')).
CREATE OR REPLACE FUNCTION public.malote_rateios_rh_para_importar()
RETURNS TABLE(id uuid, tipo text, competencia date, valor numeric, descricao text, criterio text,
              anexo_path text, anexo_nome text, conferido_por text, atualizado_em timestamptz, itens jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.rh_rateio_pode('enviar_malote') THEN
    RAISE EXCEPTION 'Sem permissão para usar rateios do RH no Malote' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.id, r.tipo, r.competencia, r.valor, r.descricao, r.criterio, r.anexo_path, r.anexo_nome,
         COALESCE(r.alterado_por_nome, r.criado_por_nome), r.updated_at,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'contrato_id', i.contrato_id, 'contrato_nome', i.contrato_nome,
                     'valor', i.valor, 'percentual', i.percentual) ORDER BY i.ordem)
                     FROM public."RH_RATEIO_ITEM" i WHERE i.despesa_id = r.id), '[]'::jsonb)
    FROM public."RH_RATEIO_DESPESA" r
   WHERE r.status = 'conferido'
     AND NOT public.rh_rateio_malote_ativo(r.malote_despesa_id)
   ORDER BY r.competencia DESC, r.updated_at DESC
   LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.malote_rateios_rh_para_importar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_rateios_rh_para_importar() TO authenticated;

-- ── 3) Gatilho: vincula e trava o rateio no INSERT da despesa ────────────
CREATE OR REPLACE FUNCTION public.malote_despesa_vincula_rateio_rh()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r      public."RH_RATEIO_DESPESA"%ROWTYPE;
  v_nome text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.rh_rateio_id IS DISTINCT FROM OLD.rh_rateio_id THEN
      RAISE EXCEPTION 'O rateio do RH de uma despesa não muda depois de criada — crie outra despesa.';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT public.rh_rateio_pode('enviar_malote') THEN
    RAISE EXCEPTION 'Sem permissão para usar rateios do RH no Malote' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public."RH_RATEIO_DESPESA" WHERE id = NEW.rh_rateio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rateio do RH não encontrado.'; END IF;
  IF r.status <> 'conferido' THEN
    RAISE EXCEPTION 'Só rateio conferido pode ser usado no Malote.';
  END IF;
  IF public.rh_rateio_malote_ativo(r.malote_despesa_id) THEN
    RAISE EXCEPTION 'Este rateio já foi usado em outra despesa do Malote.';
  END IF;
  IF round(NEW.valor_total, 2) IS DISTINCT FROM round(r.valor, 2) THEN
    RAISE EXCEPTION 'O valor da despesa deve ser o valor do rateio (R$ %).', to_char(r.valor, 'FM999G999G990D00');
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), pr.email) INTO v_nome
    FROM public.profiles pr WHERE pr.id = auth.uid();
  UPDATE public."RH_RATEIO_DESPESA"
     SET malote_despesa_id = NEW.id, enviado_malote_em = now(),
         enviado_malote_por = auth.uid(), enviado_malote_por_nome = v_nome
   WHERE id = r.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.malote_despesa_vincula_rateio_rh() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_malote_despesa_vincula_rateio_rh ON public.malote_despesa;
CREATE TRIGGER trg_malote_despesa_vincula_rateio_rh
  AFTER INSERT ON public.malote_despesa
  FOR EACH ROW WHEN (NEW.rh_rateio_id IS NOT NULL)
  EXECUTE FUNCTION public.malote_despesa_vincula_rateio_rh();

DROP TRIGGER IF EXISTS trg_malote_despesa_rateio_rh_fixo ON public.malote_despesa;
CREATE TRIGGER trg_malote_despesa_rateio_rh_fixo
  BEFORE UPDATE OF rh_rateio_id ON public.malote_despesa
  FOR EACH ROW EXECUTE FUNCTION public.malote_despesa_vincula_rateio_rh();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_malote_despesa_rateio_rh_fixo ON public.malote_despesa;
-- DROP TRIGGER IF EXISTS trg_malote_despesa_vincula_rateio_rh ON public.malote_despesa;
-- DROP FUNCTION IF EXISTS public.malote_despesa_vincula_rateio_rh();
-- DROP FUNCTION IF EXISTS public.malote_rateios_rh_para_importar();
-- DROP INDEX IF EXISTS public.idx_malote_despesa_rh_rateio;
-- ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS rh_rateio_id;
-- NOTIFY pgrst, 'reload schema';
