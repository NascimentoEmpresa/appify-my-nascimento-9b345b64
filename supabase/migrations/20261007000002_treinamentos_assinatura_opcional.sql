-- =========================================================================
-- TREINAMENTOS — assinatura do curso deixa de ser obrigatória (07/10/2026)
--
-- PEDIDO (Pablo): "tira a obrigatoriedade das assinaturas dos cursos de
-- treinamentos, tem alguns treinamentos que não tem assinatura."
--
-- A mig 20261006000001 barrava publicar curso SEM assinatura. Agora curso
-- sem assinatura publica normalmente (o certificado sai sem assinatura).
-- O que continua: SE o curso tem assinatura, ela tem que ser ativa e de
-- Técnico(a) em Segurança com registro (trn_assinatura_eh_tst) — e a
-- assinatura que segura curso publicado continua protegida
-- (trn_assinatura_protege_publicado, sem mudança).
--
-- Front: CursoDetalhe.tsx, CursoForm.tsx e Assinaturas.tsx seguem a mesma
-- regra. Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.trn_curso_publicar_exige_assinatura()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  -- 07/10/2026: sem assinatura publica; só a assinatura escolhida é validada.
  IF NEW.publicado AND NEW.assinatura_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NOT OLD.publicado OR NEW.assinatura_id IS DISTINCT FROM OLD.assinatura_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public."TRN_ASSINATURA" a
                    WHERE a.id = NEW.assinatura_id AND a.ativo
                      AND public.trn_assinatura_eh_tst(a.cargo, a.registro)) THEN
      RAISE EXCEPTION 'A assinatura do curso precisa ser de um(a) Técnico(a) em Segurança, com cargo e registro preenchidos (ou deixe o curso sem assinatura).';
    END IF;
  END IF;
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar trn_curso_publicar_exige_assinatura da mig 20261006000001
-- (com o RAISE para assinatura_id IS NULL).
