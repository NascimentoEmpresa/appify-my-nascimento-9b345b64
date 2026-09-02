-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — diagnóstico anônimo dos feedbacks por setor
--
-- POR QUE EXISTE
--   O diagnóstico cruza todos os feedbacks visíveis de um setor e custa uma
--   chamada de IA. Guardar o resultado evita cobrar novamente a cada visita e
--   deixa explícito sobre quantas respostas aquela leitura foi produzida.
--
-- SEGURANÇA
--   A capacidade `diagnostico_feedback` liga somente esta função. Ela não
--   amplia a leitura de CS_FORM_RESPOSTAS: a Edge Function consulta respostas
--   com o JWT do usuário, portanto cs_form_resp_select continua decidindo quais
--   linhas entram no agregado. A tabela abaixo também é fechada para anon,
--   exige a capacidade e só libera um diagnóstico quando o solicitante ainda
--   enxerga, pela RLS, pelo menos a quantidade de respostas usada para gerá-lo.
--   Conferir só "existe uma" seria insuficiente: alguém com uma resposta própria
--   no setor poderia ler o agregado produzido por um gestor sobre treze.
--
-- PRIVACIDADE
--   `conteudo` guarda apenas o diagnóstico do setor, sem nomes ou identificador
--   de respondente. gerado_por identifica quem acionou a ferramenta, não quem
--   aparece nos feedbacks.
--
-- Idempotente. ROLLBACK comentado no fim.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."CS_FORM_DIAGNOSTICOS" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formulario_id     uuid NOT NULL REFERENCES public."CS_FORMULARIOS"(id) ON DELETE CASCADE,
  setor             text NOT NULL,
  setor_norm        text NOT NULL,
  gerado_em         timestamptz NOT NULL DEFAULT now(),
  gerado_por        uuid DEFAULT auth.uid(),
  gerado_por_nome   text,
  qtd_respostas     integer NOT NULL,
  modelo            text,
  conteudo          jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS cs_form_diag_setor_idx
  ON public."CS_FORM_DIAGNOSTICOS" (formulario_id, setor_norm, gerado_em DESC);

ALTER TABLE public."CS_FORM_DIAGNOSTICOS" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public."CS_FORM_DIAGNOSTICOS" FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public."CS_FORM_DIAGNOSTICOS" TO authenticated;

DROP POLICY IF EXISTS cs_form_diag_select ON public."CS_FORM_DIAGNOSTICOS";
CREATE POLICY cs_form_diag_select ON public."CS_FORM_DIAGNOSTICOS"
  FOR SELECT TO authenticated
  USING (
    public.cs_form_cap('diagnostico_feedback')
    AND qtd_respostas <= (
      SELECT count(*)
        FROM public."CS_FORM_RESPOSTAS" r
       WHERE r.formulario_id = "CS_FORM_DIAGNOSTICOS".formulario_id
         AND regexp_replace(
               translate(upper(btrim(coalesce(r.setor, ''))),
                 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                 'AAAAAEEEEIIIIOOOOOUUUUC'),
               '\s+', ' ', 'g') = "CS_FORM_DIAGNOSTICOS".setor_norm
    )
  );

DROP POLICY IF EXISTS cs_form_diag_insert ON public."CS_FORM_DIAGNOSTICOS";
CREATE POLICY cs_form_diag_insert ON public."CS_FORM_DIAGNOSTICOS"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.cs_form_cap('diagnostico_feedback')
    AND gerado_por = auth.uid()
    AND qtd_respostas <= (
      SELECT count(*)
        FROM public."CS_FORM_RESPOSTAS" r
       WHERE r.formulario_id = "CS_FORM_DIAGNOSTICOS".formulario_id
         AND regexp_replace(
               translate(upper(btrim(coalesce(r.setor, ''))),
                 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                 'AAAAAEEEEIIIIOOOOOUUUUC'),
               '\s+', ' ', 'g') = "CS_FORM_DIAGNOSTICOS".setor_norm
    )
  );

-- UUIDs conferidos individualmente. Nome não é chave: o cadastro real contém
-- homônimos e contas de teste que seriam liberados por engano numa busca textual.
INSERT INTO public."CS_FORM_ACESSOS" (user_id, papel)
VALUES ('60e5bb0a-c0ae-4434-950f-9fdaecb01ea7', 'diagnostico_feedback'),  -- HELENA NASCIMENTO
       ('d1dbc8d4-bf9b-4125-a6b1-11b6195155a4', 'diagnostico_feedback'),  -- IURY DE JESUS SILVA
       ('97260632-2f1a-44e3-9f93-58b2b1f3702c', 'diagnostico_feedback')   -- EDUARDO JEIEL P. MONTEIRO
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DELETE FROM public."CS_FORM_ACESSOS"
--    WHERE papel = 'diagnostico_feedback'
--      AND user_id IN (
--        '60e5bb0a-c0ae-4434-950f-9fdaecb01ea7',
--        'd1dbc8d4-bf9b-4125-a6b1-11b6195155a4',
--        '97260632-2f1a-44e3-9f93-58b2b1f3702c');
--   DROP POLICY IF EXISTS cs_form_diag_insert ON public."CS_FORM_DIAGNOSTICOS";
--   DROP POLICY IF EXISTS cs_form_diag_select ON public."CS_FORM_DIAGNOSTICOS";
--   DROP INDEX IF EXISTS public.cs_form_diag_setor_idx;
--   DROP TABLE IF EXISTS public."CS_FORM_DIAGNOSTICOS";
-- =========================================================================
