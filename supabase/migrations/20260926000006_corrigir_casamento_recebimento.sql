-- =====================================================================
-- SIS-2026-0207 — casamento de itens do recebimento e lockdown da escrita
--
-- ROLLBACK:
--   Reaplicar as definições anteriores de nf_item_espelhar_recebimento() e
--   nf_item_propagar_sup_item_recebimento() somente se for necessário reverter
--   o casamento por descrição. Não restaure policy de escrita direta.
--   DROP FUNCTION IF EXISTS public.sup_normalizar_descricao_item(text);
--
-- Migration append-only: as migrations 00002–00005 permanecem intactas.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sup_normalizar_descricao_item(p_descricao text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT regexp_replace(
    translate(
      lower(btrim(COALESCE(p_descricao, ''))),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    ),
    '[[:space:]]+', ' ', 'g'
  );
$$;

-- Item sem vínculo de catálogo usa a descrição da NF para encontrar a linha
-- correspondente no mesmo pedido. O anti-join conserva a relação um-para-um
-- quando o mesmo material aparece mais de uma vez.
CREATE OR REPLACE FUNCTION public.nf_item_espelhar_recebimento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_receb_id uuid;
  v_pedido_id uuid;
  v_pedido_item_id uuid;
BEGIN
  SELECT r.id, r.sup_compra_pedido_id
    INTO v_receb_id, v_pedido_id
    FROM public.recebimento_nf r
   WHERE r.nf_id = NEW.nf_id;

  IF v_pedido_id IS NOT NULL THEN
    SELECT pi.id INTO v_pedido_item_id
      FROM public.sup_compra_pedido_item pi
     WHERE pi.pedido_id = v_pedido_id
       AND (
         (NEW.sup_item_id IS NOT NULL AND pi.sup_item_id = NEW.sup_item_id)
         OR (
           NEW.sup_item_id IS NULL
           AND NULLIF(public.sup_normalizar_descricao_item(NEW.descricao_original), '') IS NOT NULL
           AND public.sup_normalizar_descricao_item(pi.nome_item)
               = public.sup_normalizar_descricao_item(NEW.descricao_original)
         )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.recebimento_nf_item ri
          WHERE ri.recebimento_id = v_receb_id
            AND ri.sup_compra_pedido_item_id = pi.id
       )
     ORDER BY pi.ordem, pi.id
     LIMIT 1;
  END IF;

  IF v_receb_id IS NOT NULL THEN
    INSERT INTO public.recebimento_nf_item (
      recebimento_id, nf_item_id, produto_id, sup_item_id,
      sup_compra_pedido_item_id, qtd_nf, qtd_recebida, condicao, conferido
    ) VALUES (
      v_receb_id, NEW.id, NEW.produto_id, NEW.sup_item_id,
      v_pedido_item_id, NEW.quantidade, 0, 'ok', false
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nf_item_espelhar_recebimento ON public.nf_entrada_item;
CREATE TRIGGER trg_nf_item_espelhar_recebimento
  AFTER INSERT ON public.nf_entrada_item
  FOR EACH ROW EXECUTE FUNCTION public.nf_item_espelhar_recebimento();

-- Ao vincular manualmente duas linhas da NF ao mesmo material, cada uma deve
-- consumir uma linha ainda livre do pedido, em vez de ambas colapsarem na primeira.
CREATE OR REPLACE FUNCTION public.nf_item_propagar_sup_item_recebimento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_receb_id uuid;
  v_pedido_id uuid;
  v_pedido_item_id uuid;
BEGIN
  SELECT ri.recebimento_id, r.sup_compra_pedido_id
    INTO v_receb_id, v_pedido_id
    FROM public.recebimento_nf_item ri
    JOIN public.recebimento_nf r ON r.id = ri.recebimento_id
   WHERE ri.nf_item_id = NEW.id
   LIMIT 1;

  IF v_pedido_id IS NOT NULL AND NEW.sup_item_id IS NOT NULL THEN
    SELECT pi.id INTO v_pedido_item_id
      FROM public.sup_compra_pedido_item pi
     WHERE pi.pedido_id = v_pedido_id
       AND pi.sup_item_id = NEW.sup_item_id
       AND NOT EXISTS (
         SELECT 1
           FROM public.recebimento_nf_item ri_usado
          WHERE ri_usado.recebimento_id = v_receb_id
            AND ri_usado.sup_compra_pedido_item_id = pi.id
            AND ri_usado.nf_item_id IS DISTINCT FROM NEW.id
       )
     ORDER BY pi.ordem, pi.id
     LIMIT 1;
  END IF;

  UPDATE public.recebimento_nf_item ri
     SET sup_item_id = NEW.sup_item_id,
         sup_compra_pedido_item_id = v_pedido_item_id
   WHERE ri.nf_item_id = NEW.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nf_item_propagar_sup_item ON public.nf_entrada_item;
CREATE TRIGGER trg_nf_item_propagar_sup_item
  AFTER UPDATE OF sup_item_id ON public.nf_entrada_item
  FOR EACH ROW
  WHEN (OLD.sup_item_id IS DISTINCT FROM NEW.sup_item_id)
  EXECUTE FUNCTION public.nf_item_propagar_sup_item_recebimento();

-- A definição vigente desde 20260718100005 chama-se receb_item_write. O nome
-- receb_item_all é derrubado também para ambientes com histórico parcial.
DROP POLICY IF EXISTS receb_item_write ON public.recebimento_nf_item;
DROP POLICY IF EXISTS receb_item_all ON public.recebimento_nf_item;

NOTIFY pgrst, 'reload schema';
