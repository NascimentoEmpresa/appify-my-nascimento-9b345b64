-- Organograma › Estrutura: o SUPERVISOR de cada contrato (06/11/2026).
--
-- Pedido do Pablo ao ver a visão Estrutura: "essas pessoas soltas assim não
-- podem ficar ... os vigias têm que ficar dentro do contrato deles (da
-- Senior) ... os supervisores operacionais permanecem e os contratos ficam
-- dentro deles. Deixa definirem isso em algum lugar, e até arrastar o
-- contrato pra dentro do supervisor."
--
-- O pessoal de campo agora aparece SEMPRE dentro do contrato da Senior
-- (EMPREGADOS.Empresa/Filial, lido na hora pela organograma_arvore) — quem é
-- contratado hoje num contrato já cai nele, sem passo manual. Esta tabela só
-- diz em qual supervisor o CONTRATO fica pendurado: um por contrato.
--
-- Por que não ORGANOGRAMA_NO_CONTRATO: aquela é "quem lidera mais de um
-- contrato" (várias pessoas por contrato, filtro de contrato) e é regravada
-- inteira pelo salvar da posição da pessoa; aqui é um dono só, mudado por
-- arrastar. Sem linha aqui o front deduz pelo cadastro (supervisor do próprio
-- contrato ou o mais próximo na cadeia de comando).
--
-- Escreve quem pode montar o organograma (organograma_pode_montar); lê quem
-- vê o organograma. Pessoa que sai do organograma leva junto a linha (CASCADE)
-- e o contrato volta para "sem supervisor".

CREATE TABLE IF NOT EXISTS public."ORGANOGRAMA_CONTRATO_SUPERVISOR" (
  empresa        bigint NOT NULL,
  filial         bigint NOT NULL,
  no_id          uuid NOT NULL REFERENCES public."ORGANOGRAMA_NO"(id) ON DELETE CASCADE,
  definido_por   uuid DEFAULT auth.uid(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, filial)
);
CREATE INDEX IF NOT EXISTS idx_organograma_contrato_supervisor_no ON public."ORGANOGRAMA_CONTRATO_SUPERVISOR" (no_id);

ALTER TABLE public."ORGANOGRAMA_CONTRATO_SUPERVISOR" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ORGANOGRAMA_CONTRATO_SUPERVISOR" FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS organograma_contrato_supervisor_select ON public."ORGANOGRAMA_CONTRATO_SUPERVISOR";
CREATE POLICY organograma_contrato_supervisor_select ON public."ORGANOGRAMA_CONTRATO_SUPERVISOR" FOR SELECT TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'organograma', 'visualizar'::public.app_acao)));
GRANT SELECT ON public."ORGANOGRAMA_CONTRATO_SUPERVISOR" TO authenticated;

-- p_no NULL = tira o supervisor (o contrato volta a ser deduzido pelo cadastro).
CREATE OR REPLACE FUNCTION public.organograma_definir_supervisor_contrato(p_empresa bigint, p_filial bigint, p_no uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.organograma_pode_montar() THEN
    RAISE EXCEPTION 'Sem permissão para montar o organograma.' USING ERRCODE = '42501';
  END IF;
  IF p_empresa IS NULL OR p_filial IS NULL THEN
    RAISE EXCEPTION 'Contrato inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_no IS NULL THEN
    DELETE FROM public."ORGANOGRAMA_CONTRATO_SUPERVISOR" WHERE empresa = p_empresa AND filial = p_filial;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."ORGANOGRAMA_NO" WHERE id = p_no) THEN
    RAISE EXCEPTION 'Pessoa não está no organograma.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."ORGANOGRAMA_CONTRATO_SUPERVISOR" (empresa, filial, no_id, definido_por, atualizado_em)
  VALUES (p_empresa, p_filial, p_no, auth.uid(), now())
  ON CONFLICT (empresa, filial) DO UPDATE
     SET no_id = EXCLUDED.no_id, definido_por = EXCLUDED.definido_por, atualizado_em = now();
END $$;

REVOKE ALL ON FUNCTION public.organograma_definir_supervisor_contrato(bigint, bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organograma_definir_supervisor_contrato(bigint, bigint, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.organograma_definir_supervisor_contrato(bigint, bigint, uuid);
--   DROP TABLE IF EXISTS public."ORGANOGRAMA_CONTRATO_SUPERVISOR";
