-- =========================================================================
-- MÓDULO TREINAMENTOS — submódulo "Treinamentos ERP"
--
-- Cards de treinamento com quatro peças, TODAS opcionais mas pelo menos uma
-- obrigatória (o CHECK abaixo é quem garante isso, não o formulário):
--   vídeo   — link (YouTube/Vimeo/etc) OU arquivo enviado;
--   anexo   — PDF/slide/planilha no storage;
--   prova   — questionário de múltipla escolha em jsonb;
--   descrição — texto livre, acompanha qualquer uma das anteriores.
--
-- ACESSO: nenhuma tabela nova de permissão. Usa app_modulo/app_menu, que é
-- o que Administração › Acesso por Usuário já lista, e as policies cobram
-- can_access() sobre esses códigos:
--   treinamentos_erp        — a tela (rota real, aparece na sidebar);
--   treinamentos_gerenciar  — menu de CAPACIDADE (rota NULL), quem cria e
--                             edita card. Mesmo padrão de
--                             `formularios_acesso_botao` e ~25 outros.
-- O toggle daquele painel grava visualizar+incluir+alterar+aprovar+exportar
-- de uma vez e NUNCA `excluir` — por isso escrever cobra 'incluir'/'alterar'
-- e apagar de vez cobra 'excluir', que continua vindo de perfil. Na tela o
-- caminho normal é despublicar, não deletar.
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- ── 1) Módulo e menus ────────────────────────────────────────────────────
-- Ordem 76: logo depois de Jurídico (72) e SST (74), antes de Plano de Ações.
INSERT INTO public.app_modulo (codigo, nome, ordem, ativo)
SELECT 'treinamentos', 'Treinamentos', 76, true
 WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'treinamentos');

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'treinamentos_erp', 'Treinamentos ERP', '/app/treinamentos/erp', 10, true
  FROM public.app_modulo m
 WHERE m.codigo = 'treinamentos'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'treinamentos_erp');

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'treinamentos_gerenciar', 'Criar e editar treinamentos', NULL, 90, true
  FROM public.app_modulo m
 WHERE m.codigo = 'treinamentos'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'treinamentos_gerenciar');

-- ── 2) Helpers ───────────────────────────────────────────────────────────
-- Uma função por pergunta, para a policy não repetir a string do menu em oito
-- lugares e para o dia em que a regra mudar ter UM lugar só.
CREATE OR REPLACE FUNCTION public.trn_pode_ver()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_access(auth.uid(), 'treinamentos_erp', 'visualizar'::public.app_acao);
$$;
REVOKE EXECUTE ON FUNCTION public.trn_pode_ver() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.trn_pode_ver() TO authenticated;

CREATE OR REPLACE FUNCTION public.trn_pode_gerenciar()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_access(auth.uid(), 'treinamentos_gerenciar', 'incluir'::public.app_acao)
      OR public.can_access(auth.uid(), 'treinamentos_gerenciar', 'alterar'::public.app_acao);
$$;
REVOKE EXECUTE ON FUNCTION public.trn_pode_gerenciar() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.trn_pode_gerenciar() TO authenticated;

-- ── 3) O card ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."TREINAMENTOS" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL,
  descricao     text,
  -- Vídeo por link OU por arquivo. Link cobre o caso comum (YouTube interno);
  -- arquivo existe para o vídeo que não pode sair da empresa.
  video_url     text,
  video_path    text,
  anexo_path    text,
  anexo_nome    text,
  -- [{id, enunciado, opcoes:[texto], correta:<índice>}]. jsonb e não tabela
  -- filha porque a prova é editada e lida sempre inteira, junto do card —
  -- mesma decisão das perguntas de Formulários.
  prova         jsonb,
  -- % de acerto para aprovar. Só significa algo quando há prova.
  nota_minima   integer NOT NULL DEFAULT 70,
  publicado     boolean NOT NULL DEFAULT true,
  ordem         integer NOT NULL DEFAULT 0,
  criado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_por_nome text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT trn_titulo_nao_vazio CHECK (length(btrim(titulo)) > 0),
  CONSTRAINT trn_nota_minima_valida CHECK (nota_minima BETWEEN 0 AND 100),
  -- A regra que o Pablo pediu: tudo opcional, mas alguma coisa tem que vir.
  -- Card só com título não ensina nada e vira lixo na grade.
  CONSTRAINT trn_precisa_de_conteudo CHECK (
    coalesce(btrim(video_url),  '') <> ''
 OR coalesce(btrim(video_path), '') <> ''
 OR coalesce(btrim(anexo_path), '') <> ''
 OR (prova IS NOT NULL AND jsonb_typeof(prova) = 'array' AND jsonb_array_length(prova) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_treinamentos_ordem ON public."TREINAMENTOS" (ordem, created_at DESC);

DROP TRIGGER IF EXISTS trg_treinamentos_updated ON public."TREINAMENTOS";
CREATE TRIGGER trg_treinamentos_updated BEFORE UPDATE ON public."TREINAMENTOS"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4) Quem já fez ───────────────────────────────────────────────────────
-- Uma linha por pessoa por treinamento. Guarda o que ela respondeu, e não só
-- a nota, para o dia em que alguém contestar o resultado.
CREATE TABLE IF NOT EXISTS public."TREINAMENTO_CONCLUSAO" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treinamento_id  uuid NOT NULL REFERENCES public."TREINAMENTOS"(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usuario_nome    text,
  prova_nota      numeric,
  prova_respostas jsonb,
  aprovado        boolean,
  tentativas      integer NOT NULL DEFAULT 1,
  concluido_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (treinamento_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trn_conclusao_user ON public."TREINAMENTO_CONCLUSAO" (user_id);

-- ── 5) RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public."TREINAMENTOS"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TREINAMENTO_CONCLUSAO"  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trn_select      ON public."TREINAMENTOS";
DROP POLICY IF EXISTS trn_insert      ON public."TREINAMENTOS";
DROP POLICY IF EXISTS trn_update      ON public."TREINAMENTOS";
DROP POLICY IF EXISTS trn_delete      ON public."TREINAMENTOS";

-- Rascunho (publicado = false) é obra em andamento: só quem gerencia vê.
CREATE POLICY trn_select ON public."TREINAMENTOS" FOR SELECT TO authenticated
  USING (public.trn_pode_ver() AND (publicado OR public.trn_pode_gerenciar()));

CREATE POLICY trn_insert ON public."TREINAMENTOS" FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'treinamentos_gerenciar', 'incluir'::public.app_acao));

CREATE POLICY trn_update ON public."TREINAMENTOS" FOR UPDATE TO authenticated
  USING       (public.can_access(auth.uid(), 'treinamentos_gerenciar', 'alterar'::public.app_acao))
  WITH CHECK  (public.can_access(auth.uid(), 'treinamentos_gerenciar', 'alterar'::public.app_acao));

-- Apagar de vez leva junto o histórico de quem já fez (CASCADE), então cobra
-- 'excluir' — a ação que o toggle da tela de acesso NÃO dá de brinde.
CREATE POLICY trn_delete ON public."TREINAMENTOS" FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'treinamentos_gerenciar', 'excluir'::public.app_acao));

DROP POLICY IF EXISTS trn_conc_select ON public."TREINAMENTO_CONCLUSAO";
DROP POLICY IF EXISTS trn_conc_insert ON public."TREINAMENTO_CONCLUSAO";
DROP POLICY IF EXISTS trn_conc_update ON public."TREINAMENTO_CONCLUSAO";

-- Cada um vê o próprio histórico; quem gerencia vê o de todos (é o relatório
-- de quem fez o treinamento).
CREATE POLICY trn_conc_select ON public."TREINAMENTO_CONCLUSAO" FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.trn_pode_gerenciar());

-- Só dá para registrar conclusão em nome PRÓPRIO, e só de treinamento que a
-- pessoa enxerga. Sem o segundo teste dava para marcar presença em rascunho.
CREATE POLICY trn_conc_insert ON public."TREINAMENTO_CONCLUSAO" FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public."TREINAMENTOS" t WHERE t.id = treinamento_id)
  );

CREATE POLICY trn_conc_update ON public."TREINAMENTO_CONCLUSAO" FOR UPDATE TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 6) Storage ───────────────────────────────────────────────────────────
-- Privado: material interno não fica em URL pública adivinhável. A tela lê
-- por signed URL, como o Jurídico já faz com juridico-docs.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('treinamentos', 'treinamentos', false, 209715200)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS trn_stg_read   ON storage.objects;
DROP POLICY IF EXISTS trn_stg_write  ON storage.objects;
DROP POLICY IF EXISTS trn_stg_delete ON storage.objects;

CREATE POLICY trn_stg_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'treinamentos' AND public.trn_pode_ver());

CREATE POLICY trn_stg_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'treinamentos' AND public.trn_pode_gerenciar());

CREATE POLICY trn_stg_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'treinamentos' AND public.trn_pode_gerenciar());

-- ── 7) Conferência ───────────────────────────────────────────────────────
SELECT m.codigo AS modulo, x.codigo AS menu, x.rota, x.ativo
  FROM public.app_menu x JOIN public.app_modulo m ON m.id = x.modulo_id
 WHERE m.codigo = 'treinamentos'
 ORDER BY x.ordem;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- DEPOIS DE RODAR: o menu nasce SEM ninguém enxergando (a regra é negar por
-- padrão). Liberar em Administração › Acesso por Usuário → módulo
-- Treinamentos → "Treinamentos ERP" para quem assiste, e
-- "Criar e editar treinamentos" para quem publica. Quem tem perfil
-- `concede_tudo` já vê sem mexer em nada.
-- =========================================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS trn_stg_read ON storage.objects;
--   DROP POLICY IF EXISTS trn_stg_write ON storage.objects;
--   DROP POLICY IF EXISTS trn_stg_delete ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'treinamentos';
--   DROP TABLE IF EXISTS public."TREINAMENTO_CONCLUSAO";
--   DROP TABLE IF EXISTS public."TREINAMENTOS";
--   DROP FUNCTION IF EXISTS public.trn_pode_gerenciar();
--   DROP FUNCTION IF EXISTS public.trn_pode_ver();
--   DELETE FROM public.app_menu x USING public.app_modulo m
--    WHERE x.modulo_id = m.id AND m.codigo = 'treinamentos';
--   DELETE FROM public.app_modulo WHERE codigo = 'treinamentos';
-- =========================================================================
