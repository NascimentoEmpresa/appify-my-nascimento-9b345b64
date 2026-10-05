-- =========================================================================
-- TREINAMENTOS — ASSINATURA no certificado (05/10/2026)
--
-- PEDIDO (Pablo): cada treinamento pode ter uma ASSINATURA (opcional). Ao
-- marcar que o certificado do curso tem assinatura, quem tem permissão cria
-- a assinatura e a coloca como ASSINATURA PRINCIPAL. No certificado sai:
-- "ASSINADO DIGITALMENTE POR: <nome completo do treinador>" + a assinatura
-- desenhada na tela OU o nome escrito numa fonte cursiva escolhida.
--
-- MODELO
--   · "TRN_ASSINATURA": uma assinatura = um treinador. tipo 'desenho' guarda
--     o PNG (data URL) do traço; tipo 'texto' guarda o texto e a fonte. O
--     PNG fica NA TABELA, não no bucket trn-midia — o bucket é público, e
--     imagem de assinatura solta na internet é convite a falsificação.
--   · "TRN_CURSO".assinatura_id: a assinatura principal do curso (NULL = sem).
--   · "TRN_CERTIFICADO".assinatura_id: a assinatura VIGENTE NA EMISSÃO,
--     copiada do curso por gatilho (vale para as duas portas de emissão:
--     trn_emitir_certificado e col_trn_certificar). Trocar a assinatura do
--     curso depois não reescreve certificado já emitido.
--   · Assinatura usada em certificado não pode ser apagada (FK RESTRICT) —
--     a tela oferece desativar.
--
-- ACESSO: menu "Cursos — Assinaturas" (treinamentos_assinaturas), nasce
-- fechado. Ler: qualquer porta do módulo (como o resto, trn_rls). O curso
-- só pode apontar para assinatura ATIVA (gatilho).
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'treinamentos_assinaturas', 'Cursos — Assinaturas', '/app/treinamentos/cursos/assinaturas', 45, true
  FROM public.app_modulo m WHERE m.codigo = 'treinamentos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2) Assinaturas ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."TRN_ASSINATURA" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sai no certificado depois de "ASSINADO DIGITALMENTE POR:".
  nome_completo  text NOT NULL CHECK (length(btrim(nome_completo)) >= 3),
  -- Linha opcional embaixo do nome (ex.: "Instrutor de Treinamentos").
  cargo          text,
  -- O treinador dono da assinatura (login do ERP), quando houver.
  usuario_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tipo           text NOT NULL CHECK (tipo IN ('desenho', 'texto')),
  -- tipo 'desenho': PNG em data URL (o traço, fundo transparente).
  imagem         text,
  -- tipo 'texto': o que aparece escrito e a fonte (lista em assinaturas.ts).
  texto          text,
  fonte          text,
  ativo          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid DEFAULT auth.uid(),
  CHECK (
    (tipo = 'desenho' AND imagem LIKE 'data:image/png;base64,%' AND length(imagem) <= 400000)
    OR (tipo = 'texto' AND length(btrim(coalesce(texto, ''))) >= 2 AND coalesce(fonte, '') <> '')
  )
);

SELECT public.trn_rls('TRN_ASSINATURA', 'treinamentos_assinaturas');
-- trn_ve_modulo não conhece o menu novo: quem só tem "Assinaturas" também lê.
DROP POLICY IF EXISTS trn_assinatura_select ON public."TRN_ASSINATURA";
CREATE POLICY trn_assinatura_select ON public."TRN_ASSINATURA" FOR SELECT TO authenticated
  USING (public.trn_ve_modulo() OR public.trn_acesso('treinamentos_assinaturas'));

DROP TRIGGER IF EXISTS trg_trn_assinatura_touch ON public."TRN_ASSINATURA";
CREATE TRIGGER trg_trn_assinatura_touch BEFORE UPDATE ON public."TRN_ASSINATURA"
  FOR EACH ROW EXECUTE FUNCTION public.trn_touch();

-- ── 3) Assinatura principal do curso ─────────────────────────────────────
ALTER TABLE public."TRN_CURSO"
  ADD COLUMN IF NOT EXISTS assinatura_id uuid REFERENCES public."TRN_ASSINATURA"(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.trn_curso_assinatura_ativa()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.assinatura_id IS NOT NULL
     AND NEW.assinatura_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.assinatura_id END)
     AND NOT EXISTS (SELECT 1 FROM public."TRN_ASSINATURA" WHERE id = NEW.assinatura_id AND ativo) THEN
    RAISE EXCEPTION 'Essa assinatura está desativada — escolha outra ou reative em Cursos › Assinaturas.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_trn_curso_assinatura_ativa ON public."TRN_CURSO";
CREATE TRIGGER trg_trn_curso_assinatura_ativa BEFORE INSERT OR UPDATE OF assinatura_id ON public."TRN_CURSO"
  FOR EACH ROW EXECUTE FUNCTION public.trn_curso_assinatura_ativa();

-- ── 4) Assinatura gravada no certificado emitido ─────────────────────────
ALTER TABLE public."TRN_CERTIFICADO"
  ADD COLUMN IF NOT EXISTS assinatura_id uuid REFERENCES public."TRN_ASSINATURA"(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.trn_certificado_assinatura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.assinatura_id IS NULL THEN
    SELECT c.assinatura_id INTO NEW.assinatura_id
      FROM public."TRN_CURSO" c
      JOIN public."TRN_ASSINATURA" a ON a.id = c.assinatura_id AND a.ativo
     WHERE c.id = NEW.curso_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_trn_certificado_assinatura ON public."TRN_CERTIFICADO";
CREATE TRIGGER trg_trn_certificado_assinatura BEFORE INSERT ON public."TRN_CERTIFICADO"
  FOR EACH ROW EXECUTE FUNCTION public.trn_certificado_assinatura();

-- ── 5) Portal do Colaborador: o certificado devolve a assinatura ─────────
-- Mesmo corpo de col_certificado (mig 20260930000196) + 'assinatura'. A Edge
-- colaborador-portal só repassa o JSON — não precisa de redeploy.
CREATE OR REPLACE FUNCTION public.col_certificado(p_emp bigint, p_curso uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_aluno uuid; ce record; a record; c record; m record; v_mod jsonb; v_ass jsonb;
BEGIN
  SELECT id INTO v_aluno FROM public."TRN_ALUNO" WHERE empregado_id = p_emp ORDER BY created_at LIMIT 1;
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  SELECT * INTO ce FROM public."TRN_CERTIFICADO" WHERE aluno_id = v_aluno AND curso_id = p_curso;
  IF NOT FOUND THEN RAISE EXCEPTION 'Certificado ainda não emitido para este curso.'; END IF;
  SELECT * INTO a FROM public."TRN_ALUNO" WHERE id = v_aluno;
  SELECT * INTO c FROM public."TRN_CURSO" WHERE id = p_curso;
  SELECT * INTO m FROM public."TRN_CERTIFICADO_MODELO" WHERE id = ce.modelo_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('nome', mo.nome,
           'aulas', (SELECT coalesce(jsonb_agg(au.nome ORDER BY au.posicao), '[]'::jsonb) FROM public."TRN_AULA" au WHERE au.modulo_id = mo.id AND au.publicada))
           ORDER BY mo.posicao), '[]'::jsonb)
    INTO v_mod FROM public."TRN_MODULO" mo WHERE mo.curso_id = p_curso;
  SELECT jsonb_build_object('nome_completo', s.nome_completo, 'cargo', s.cargo, 'tipo', s.tipo,
                            'imagem', s.imagem, 'texto', s.texto, 'fonte', s.fonte)
    INTO v_ass FROM public."TRN_ASSINATURA" s WHERE s.id = ce.assinatura_id;
  RETURN jsonb_build_object(
    'codigo', ce.codigo_validacao, 'emitido_em', ce.emitido_em, 'carga_horaria_min', ce.carga_horaria_min,
    'aluno', a.nome, 'documento', a.documento, 'curso', c.nome,
    'modelo', CASE WHEN m.id IS NULL THEN NULL ELSE to_jsonb(m) END,
    'modulos', v_mod,
    'assinatura', v_ass);
END $function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar col_certificado da mig 20260930000196 (sem 'assinatura').
-- DROP TRIGGER IF EXISTS trg_trn_certificado_assinatura ON public."TRN_CERTIFICADO";
-- DROP FUNCTION IF EXISTS public.trn_certificado_assinatura();
-- ALTER TABLE public."TRN_CERTIFICADO" DROP COLUMN IF EXISTS assinatura_id;
-- DROP TRIGGER IF EXISTS trg_trn_curso_assinatura_ativa ON public."TRN_CURSO";
-- DROP FUNCTION IF EXISTS public.trn_curso_assinatura_ativa();
-- ALTER TABLE public."TRN_CURSO" DROP COLUMN IF EXISTS assinatura_id;
-- DROP TABLE IF EXISTS public."TRN_ASSINATURA";
-- DELETE FROM public.app_menu WHERE codigo = 'treinamentos_assinaturas';
