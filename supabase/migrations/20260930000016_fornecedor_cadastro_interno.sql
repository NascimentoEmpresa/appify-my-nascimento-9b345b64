-- =========================================================================
-- Cadastro de fornecedor preenchido por dentro da empresa
--
-- PEDIDO DO CASSIO (ajuste 3 da revisão de 27/08/2026)
-- "O link enviado ao fornecedor ter opção de ser feito por alguém interno, pra
-- compras online tipo Shopee, Amazon ou AliExpress — não tem como enviar um
-- formulário e esperar alguém preencher se for um e-commerce."
--
-- O problema é real: ninguém na Amazon vai receber um link nosso e preencher
-- razão social, dados bancários e prazo de entrega. Mas a compra acontece, a
-- nota chega, e o fornecedor precisa existir no cadastro.
--
-- POR QUE NÃO UM CAMINHO SEPARADO DE CADASTRO
-- A tentação é fazer um "cadastro rápido" que grava direto em `fornecedor`,
-- pulando a fila de aprovação. Seria mais curto e criaria dois caminhos para o
-- mesmo dado — um validado e outro não. O que muda aqui é QUEM digita, não o
-- que é exigido nem quem aprova.
--
-- Então o convite continua sendo o mesmo, o formulário é o mesmo e a aprovação
-- é a mesma. A única diferença é a marca de origem, para quem aprova saber o
-- que está olhando: cadastro que o próprio fornecedor preencheu tem outro peso
-- que um preenchido por nós a partir do site dele.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public.fornecedor_convite DROP COLUMN IF EXISTS interno;
--   DROP TRIGGER IF EXISTS trg_forn_herdar_interno ON public.fornecedor_cadastro_pendente;
--   DROP FUNCTION IF EXISTS public.sup_forn_herdar_interno();
--   DROP FUNCTION IF EXISTS public.sup_forn_marcar_convite_interno(uuid);
--   ALTER TABLE public.fornecedor_cadastro_pendente DROP COLUMN IF EXISTS interno;
-- =========================================================================

ALTER TABLE public.fornecedor_convite
  ADD COLUMN IF NOT EXISTS interno boolean NOT NULL DEFAULT false;

ALTER TABLE public.fornecedor_cadastro_pendente
  ADD COLUMN IF NOT EXISTS interno boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.fornecedor_convite.interno IS
  'true = alguem da empresa vai preencher o formulario, em vez de mandar o link ao fornecedor. Usado para e-commerce (Shopee, Amazon, AliExpress), onde nao existe alguem do outro lado para preencher.';

COMMENT ON COLUMN public.fornecedor_cadastro_pendente.interno IS
  'Herdado do convite. Quem aprova precisa saber se o dado veio do proprio fornecedor ou foi transcrito por nos.';

-- ── Marcar o convite como interno ────────────────────────────────────────
--
-- Uma função SEPARADA em vez de mexer na `sup_forn_gerar_convite`, que tem
-- assinatura `(text, text, integer)` e retorna a linha inteira. Acrescentar um
-- parâmetro ali criaria uma sobrecarga — duas funções com o mesmo nome — e o
-- Postgres escolheria por tipo de argumento, o que é exatamente o tipo de
-- ambiguidade que aparece meses depois como "às vezes não salva".
--
-- Quem gera um convite interno chama a de sempre e depois esta.

CREATE OR REPLACE FUNCTION public.sup_forn_marcar_convite_interno(p_convite_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_fornecedor_aprovacao', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para gerar cadastro de fornecedor';
  END IF;

  UPDATE public.fornecedor_convite
     SET interno = true
   WHERE id = p_convite_id AND usado_em IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado ou já utilizado';
  END IF;
END;
$fn$;

-- ── A marca acompanha o cadastro ─────────────────────────────────────────
-- Sem isto, `interno` ficaria só no convite e a fila de aprovação — que é
-- quem precisa da informação — não saberia a origem do que está julgando.

CREATE OR REPLACE FUNCTION public.sup_forn_herdar_interno()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.convite_id IS NOT NULL THEN
    SELECT c.interno INTO NEW.interno
      FROM public.fornecedor_convite c
     WHERE c.id = NEW.convite_id;
    NEW.interno := coalesce(NEW.interno, false);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_forn_herdar_interno ON public.fornecedor_cadastro_pendente;
CREATE TRIGGER trg_forn_herdar_interno
  BEFORE INSERT ON public.fornecedor_cadastro_pendente
  FOR EACH ROW EXECUTE FUNCTION public.sup_forn_herdar_interno();

REVOKE ALL ON FUNCTION public.sup_forn_marcar_convite_interno(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_forn_herdar_interno()             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_forn_marcar_convite_interno(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
