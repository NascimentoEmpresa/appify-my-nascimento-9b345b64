-- Amarra implantacao_contrato -> contratos (a entidade OFICIAL) por FK.
--
-- Contexto: implantacao_contrato e contratos nascem da MESMA capa no
-- useCapaEdital (mesmo capa_id, mesmo nome inicial "cidade — objeto"). São
-- irmãs, mas sem elo direto — e o nome diverge quando alguém edita só o da
-- implantação (ex.: "CEITEC LIMPEZA - 025/2026" vs "Porto Alegre — LIMPEZA...").
-- Como implantacao_contrato SÓ nasce de capa, o vínculo é 100% confiável por
-- capa_id — sem casar por texto.

-- ── 1. FK ────────────────────────────────────────────────────────────────────
ALTER TABLE public.implantacao_contrato
  ADD COLUMN IF NOT EXISTS contrato_id uuid REFERENCES public.contratos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_implantacao_contrato_contrato_id
  ON public.implantacao_contrato(contrato_id);

-- ── 2. Backfill do vínculo por capa_id ───────────────────────────────────────
UPDATE public.implantacao_contrato i
   SET contrato_id = c.id
  FROM public.contratos c
 WHERE c.capa_id = i.capa_id
   AND i.capa_id IS NOT NULL
   AND i.contrato_id IS NULL;

-- ── 3. Nome oficial = o nome CURADO da implantação ───────────────────────────
-- Faz `contratos` (fonte única lida por Financeiro/NF/Malote/Planilha) adotar o
-- nome curado da implantação. No-op onde já são iguais.
--
-- REVISE ANTES DE APLICAR — rode primeiro o SELECT abaixo pra ver o que muda;
-- nomes com notas de trabalho (ex.: "(NOSSO)") também seriam adotados no oficial:
--
--   SELECT c.nome AS nome_atual_oficial, i.nome AS nome_curado_implantacao, c.cliente
--     FROM public.contratos c
--     JOIN public.implantacao_contrato i ON i.contrato_id = c.id
--    WHERE i.nome IS DISTINCT FROM c.nome
--    ORDER BY c.cliente;
--
UPDATE public.contratos c
   SET nome = i.nome, updated_at = now()
  FROM public.implantacao_contrato i
 WHERE i.contrato_id = c.id
   AND i.nome IS DISTINCT FROM c.nome;

-- ── 4. Triggers: mantêm o vínculo e o nome alinhados DAQUI PRA FRENTE ─────────
-- A regra vive no banco (não espalhada no frontend), então vale por qualquer
-- caminho de escrita — o processo gera informação confiável por construção.

-- 4.1 Ao criar um contrato oficial, liga o registro de implantação irmão pelo
--     capa_id (as duas nascem da mesma capa; o contrato é inserido DEPOIS da
--     implantação no useCapaEdital, por isso o gatilho fica no lado de contratos).
CREATE OR REPLACE FUNCTION public.link_implantacao_ao_contrato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.capa_id IS NOT NULL THEN
    UPDATE public.implantacao_contrato
       SET contrato_id = NEW.id
     WHERE capa_id = NEW.capa_id
       AND contrato_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_implantacao_ao_contrato ON public.contratos;
CREATE TRIGGER trg_link_implantacao_ao_contrato
  AFTER INSERT ON public.contratos
  FOR EACH ROW EXECUTE FUNCTION public.link_implantacao_ao_contrato();

-- 4.2 Ao editar o nome na implantação (o nome curado), propaga pro contrato
--     oficial — a fonte única lida por Financeiro/NF/Malote/Planilha.
--     Loop-safe: 4.1 só dispara em INSERT de contratos; 4.2 só mexe em nome, e
--     4.1 nunca mexe em nome.
CREATE OR REPLACE FUNCTION public.propaga_nome_implantacao_para_contrato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.contrato_id IS NOT NULL AND NEW.nome IS DISTINCT FROM OLD.nome THEN
    UPDATE public.contratos
       SET nome = NEW.nome, updated_at = now()
     WHERE id = NEW.contrato_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propaga_nome_implantacao ON public.implantacao_contrato;
CREATE TRIGGER trg_propaga_nome_implantacao
  AFTER UPDATE ON public.implantacao_contrato
  FOR EACH ROW EXECUTE FUNCTION public.propaga_nome_implantacao_para_contrato();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_propaga_nome_implantacao ON public.implantacao_contrato;
--   DROP TRIGGER IF EXISTS trg_link_implantacao_ao_contrato ON public.contratos;
--   DROP FUNCTION IF EXISTS public.propaga_nome_implantacao_para_contrato();
--   DROP FUNCTION IF EXISTS public.link_implantacao_ao_contrato();
--   ALTER TABLE public.implantacao_contrato DROP COLUMN IF EXISTS contrato_id;
--   (o rename de contratos.nome no passo 3 não tem rollback automático — os
--    nomes curados permanecem; se precisar reverter, restaure de backup.)
