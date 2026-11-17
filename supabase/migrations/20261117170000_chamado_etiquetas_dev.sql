-- Etiquetas pessoais do desenvolvedor nos chamados (16/11/2026, Pablo: "ao
-- lado do código deixa criar etiquetas pro dev se organizar, cada um cria as
-- suas etiquetas que quiser com a cor que quiser e adiciona no chamado que
-- quiser").
--
-- PESSOAIS: cada etiqueta tem dono (usuario_id) e só o dono a vê, cria, edita,
-- apaga e cola em chamados. Ninguém mais (nem a gestão) enxerga as etiquetas
-- dos outros — é organização individual, não classificação do chamado.
--
-- 1) "CHAMADO_ETIQUETA"         — a etiqueta (nome + cor) de cada dev.
-- 2) "CHAMADO_ETIQUETA_CHAMADO" — em quais chamados o dono colou a etiqueta.
-- 3) RLS — dono + tela do Painel do Desenvolvedor; colar só em chamado que o
--    usuário já consegue ver (o EXISTS em "CHAMADO_SISTEMA" passa pelo RLS dele).

-- 1) Etiqueta ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."CHAMADO_ETIQUETA" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  nome        text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 30),
  cor         text NOT NULL DEFAULT '#64748b' CHECK (cor ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Mesmo nome (sem diferenciar maiúscula) só uma vez por dono.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chamado_etiqueta_usuario_nome
  ON public."CHAMADO_ETIQUETA" (usuario_id, lower(btrim(nome)));

DROP TRIGGER IF EXISTS trg_chamado_etiqueta_updated_at ON public."CHAMADO_ETIQUETA";
CREATE TRIGGER trg_chamado_etiqueta_updated_at
  BEFORE UPDATE ON public."CHAMADO_ETIQUETA"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Etiqueta colada no chamado --------------------------------------------
CREATE TABLE IF NOT EXISTS public."CHAMADO_ETIQUETA_CHAMADO" (
  etiqueta_id uuid NOT NULL REFERENCES public."CHAMADO_ETIQUETA"(id) ON DELETE CASCADE,
  chamado_id  uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (etiqueta_id, chamado_id)
);

CREATE INDEX IF NOT EXISTS idx_chamado_etiqueta_chamado_chamado
  ON public."CHAMADO_ETIQUETA_CHAMADO" (chamado_id);

-- 3) RLS ----------------------------------------------------------------------
ALTER TABLE public."CHAMADO_ETIQUETA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CHAMADO_ETIQUETA_CHAMADO" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."CHAMADO_ETIQUETA" TO authenticated;
GRANT SELECT, INSERT, DELETE ON public."CHAMADO_ETIQUETA_CHAMADO" TO authenticated;

DROP POLICY IF EXISTS chamado_etiqueta_dono ON public."CHAMADO_ETIQUETA";
CREATE POLICY chamado_etiqueta_dono ON public."CHAMADO_ETIQUETA"
  FOR ALL TO authenticated
  USING (usuario_id = auth.uid())
  WITH CHECK (
    usuario_id = auth.uid()
    AND public.has_screen_access(auth.uid(), 'chamados_sistemas_dev', 'visualizar')
  );

DROP POLICY IF EXISTS chamado_etiqueta_chamado_select ON public."CHAMADO_ETIQUETA_CHAMADO";
CREATE POLICY chamado_etiqueta_chamado_select ON public."CHAMADO_ETIQUETA_CHAMADO"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."CHAMADO_ETIQUETA" e
    WHERE e.id = etiqueta_id AND e.usuario_id = auth.uid()
  ));

DROP POLICY IF EXISTS chamado_etiqueta_chamado_insert ON public."CHAMADO_ETIQUETA_CHAMADO";
CREATE POLICY chamado_etiqueta_chamado_insert ON public."CHAMADO_ETIQUETA_CHAMADO"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_screen_access(auth.uid(), 'chamados_sistemas_dev', 'visualizar')
    AND EXISTS (
      SELECT 1 FROM public."CHAMADO_ETIQUETA" e
      WHERE e.id = etiqueta_id AND e.usuario_id = auth.uid()
    )
    -- Sem SECURITY DEFINER: o RLS de "CHAMADO_SISTEMA" vale aqui, então só
    -- entra chamado que o usuário já enxerga.
    AND EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id)
  );

DROP POLICY IF EXISTS chamado_etiqueta_chamado_delete ON public."CHAMADO_ETIQUETA_CHAMADO";
CREATE POLICY chamado_etiqueta_chamado_delete ON public."CHAMADO_ETIQUETA_CHAMADO"
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."CHAMADO_ETIQUETA" e
    WHERE e.id = etiqueta_id AND e.usuario_id = auth.uid()
  ));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TABLE IF EXISTS public."CHAMADO_ETIQUETA_CHAMADO";
-- DROP TABLE IF EXISTS public."CHAMADO_ETIQUETA";
-- NOTIFY pgrst, 'reload schema';
