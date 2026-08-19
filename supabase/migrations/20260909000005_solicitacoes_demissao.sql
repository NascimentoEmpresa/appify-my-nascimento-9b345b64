-- =========================================================================
-- SOLICITAÇÃO DE DEMISSÃO — encarregado → operacional → RH
--
-- O FLUXO
--   1. O ENCARREGADO abre a solicitação já completa (dados do colaborador,
--      motivos, aviso e documentos anexados).
--   2. O OPERACIONAL aprova ou reprova. Reprovar EXIGE motivo — sem isso o
--      encarregado não sabe o que corrigir.
--   3. O RH recebe só o que o operacional aprovou e conclui.
--
-- O status é a memória desse caminho, e por isso ninguém escreve status
-- direto na tela: cada etapa grava quem decidiu e quando.
--
--   Pendente Operacional → Pendente RH → Concluída
--                        ↘ Reprovada
--
-- Encarregado e operacional enxergam TODAS as solicitações em qualquer
-- status (o pedido era acompanhar o andamento do começo ao fim); quem entra
-- em cada tela é decidido pelo menu, como no resto do sistema.
--
-- Espelha SISTEMA_SOLICITACOES_FERIAS (20260617000004): RLS liberada para
-- authenticated, controle de acesso no menu/RouteGuard.
--
-- Idempotente.
-- ROLLBACK:
--   DROP TABLE public."SISTEMA_SOL_DEMISSAO_ANEXOS";
--   DROP TABLE public."SISTEMA_SOLICITACOES_DEMISSAO";
--   DELETE FROM public.app_menu WHERE codigo IN
--     ('encarregados_solicitar_demissao','operacional_demissoes','rh_demissoes');
--   DELETE FROM public.app_modulo WHERE codigo = 'operacional';
-- =========================================================================

-- ── 1. A solicitação ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_SOLICITACOES_DEMISSAO" (
  id                    BIGSERIAL PRIMARY KEY,

  -- Quem pediu (o encarregado logado).
  solicitante_nome      TEXT,
  solicitante_email     TEXT,
  data_solicitacao      DATE,

  -- Quem vai ser desligado. `colaborador_id` é o ID em EMPREGADOS e serve de
  -- prova de que a pessoa foi ESCOLHIDA na lista, não digitada à mão: os
  -- campos que vêm do cadastro (posto, contrato, escala) chegam travados na
  -- tela justamente porque saem daqui.
  colaborador_id        BIGINT,
  colaborador_nome      TEXT,
  colaborador_cpf       TEXT,
  colaborador_posto     TEXT,
  colaborador_cargo     TEXT,
  colaborador_filial    TEXT,
  colaborador_admissao  DATE,
  colaborador_telefone  TEXT,
  colaborador_email     TEXT,
  contrato              TEXT,
  contrato_id           BIGINT,
  escala                TEXT,

  -- Motivos (passo 2 do formulário).
  motivo_solicitacao    TEXT,
  motivo_pedido         TEXT,
  relato               TEXT,

  -- Aviso e dados adicionais (passo 3).
  termino_experiencia   TEXT,
  data_aviso            DATE,
  modelo_aviso          TEXT,

  -- Andamento.
  status                TEXT NOT NULL DEFAULT 'Pendente Operacional',
  operacional_por       TEXT,
  operacional_em        TIMESTAMPTZ,
  operacional_motivo    TEXT,     -- obrigatório na reprovação
  rh_por                TEXT,
  rh_em                 TIMESTAMPTZ,
  rh_observacao         TEXT,

  criado_em             TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ssd_status_idx      ON public."SISTEMA_SOLICITACOES_DEMISSAO"(status);
CREATE INDEX IF NOT EXISTS ssd_solicitante_idx ON public."SISTEMA_SOLICITACOES_DEMISSAO"(solicitante_email);
CREATE INDEX IF NOT EXISTS ssd_colaborador_idx ON public."SISTEMA_SOLICITACOES_DEMISSAO"(colaborador_id);
CREATE INDEX IF NOT EXISTS ssd_criado_idx      ON public."SISTEMA_SOLICITACOES_DEMISSAO"(criado_em DESC);

ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SISTEMA_SOLICITACOES_DEMISSAO" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public."SISTEMA_SOLICITACOES_DEMISSAO_id_seq" TO authenticated;

DROP POLICY IF EXISTS ssd_all_auth ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE POLICY ssd_all_auth ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 2. Os documentos anexados ────────────────────────────────────────
-- Uma linha por arquivo. O arquivo em si vive no bucket privado
-- `demissoes-docs`; aqui fica só o caminho, aberto por URL assinada.
CREATE TABLE IF NOT EXISTS public."SISTEMA_SOL_DEMISSAO_ANEXOS" (
  id              BIGSERIAL PRIMARY KEY,
  solicitacao_id  BIGINT NOT NULL REFERENCES public."SISTEMA_SOLICITACOES_DEMISSAO"(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  storage_path    TEXT NOT NULL,
  tamanho         BIGINT,
  tipo            TEXT,
  enviado_por     TEXT,
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ssda_sol_idx ON public."SISTEMA_SOL_DEMISSAO_ANEXOS"(solicitacao_id);

ALTER TABLE public."SISTEMA_SOL_DEMISSAO_ANEXOS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SISTEMA_SOL_DEMISSAO_ANEXOS" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public."SISTEMA_SOL_DEMISSAO_ANEXOS_id_seq" TO authenticated;

DROP POLICY IF EXISTS ssda_all_auth ON public."SISTEMA_SOL_DEMISSAO_ANEXOS";
CREATE POLICY ssda_all_auth ON public."SISTEMA_SOL_DEMISSAO_ANEXOS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 3. Bucket dos documentos ─────────────────────────────────────────
-- Privado e com teto de 10 MB por arquivo — o mesmo limite que a tela
-- valida antes de enviar, para o erro aparecer no formulário e não como um
-- 413 sem explicação.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('demissoes-docs', 'demissoes-docs', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

DROP POLICY IF EXISTS demissoes_docs_select ON storage.objects;
CREATE POLICY demissoes_docs_select ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'demissoes-docs');

DROP POLICY IF EXISTS demissoes_docs_insert ON storage.objects;
CREATE POLICY demissoes_docs_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'demissoes-docs');

DROP POLICY IF EXISTS demissoes_docs_delete ON storage.objects;
CREATE POLICY demissoes_docs_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'demissoes-docs');

-- ── 4. Navegação e acesso ────────────────────────────────────────────
-- Módulo OPERACIONAL: nasce agora porque a fila de aprovação é dele. Fica
-- logo abaixo de Encarregados, que é de onde as solicitações chegam.
INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem)
SELECT 'operacional', 'Operacional', 'Aprovações e acompanhamento das solicitações',
       'ClipboardCheck',
       COALESCE((SELECT ordem FROM public.app_modulo WHERE codigo = 'encarregados'),
                (SELECT max(ordem) FROM public.app_modulo), 200) + 1
WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'operacional');

-- Um menu por tela: o acesso é por menu, e aqui são três públicos distintos
-- (encarregado abre, operacional decide, RH conclui).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota,
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + x.ordem,
       true
  FROM (VALUES
    ('encarregados', 'encarregados_solicitar_demissao', 'Solicitar Demissão',      '/app/encarregados/solicitar-demissao', 10),
    ('operacional',  'operacional_demissoes',           'Solicitações de Demissão', '/app/operacional/solicitacoes-demissao', 10),
    ('rh',           'rh_demissoes',                    'Solicitações de Demissão', '/app/rh/solicitacoes-demissao',          10)
  ) AS x(modulo, codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = x.modulo
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- ── Conferência ──────────────────────────────────────────────────────
SELECT codigo, nome, rota FROM public.app_menu
 WHERE codigo IN ('encarregados_solicitar_demissao','operacional_demissoes','rh_demissoes')
 ORDER BY codigo;

NOTIFY pgrst, 'reload schema';
