-- =========================================================================
-- DEMISSÃO — etapa do SST (ASO demissional) depois do RH
--
-- Pedido de 25/08/2026: concluir no RH não encerra mais a demissão. Ela
-- passa para o SST, que marca o ASO demissional — data, hora e local, os
-- MESMOS campos do ASO de admissão (WA_CURRICULOS.sst_*), para quem trabalha
-- no SST não ter que aprender dois formulários para a mesma coisa.
--
--   Pendente Operacional → Pendente RH → Pendente SST → Concluída
--                        ↘ Reprovada
--
-- O status "Concluída" muda de dono: era o fim no RH, agora é o fim no SST.
-- As demissões que JÁ estão concluídas ficam como estão — voltar todas para
-- "Pendente SST" encheria a fila do SST com desligamento antigo, de gente
-- que já saiu da empresa.
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- ── 1) Os campos do ASO ──────────────────────────────────────────────────
-- Mesmos nomes de WA_CURRICULOS: quem já mexe no ASO de admissão reconhece,
-- e um dia dá para consolidar as duas telas sem renomear coluna.
ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ADD COLUMN IF NOT EXISTS sst_data_exame  DATE,
  ADD COLUMN IF NOT EXISTS sst_hora_exame  TEXT,
  ADD COLUMN IF NOT EXISTS sst_local_exame TEXT,
  ADD COLUMN IF NOT EXISTS sst_maps_url    TEXT,
  ADD COLUMN IF NOT EXISTS sst_observacao  TEXT,
  ADD COLUMN IF NOT EXISTS sst_por         TEXT,
  ADD COLUMN IF NOT EXISTS sst_em          TIMESTAMPTZ;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".sst_data_exame IS
  'Data do ASO demissional. Mesmos campos do ASO de admissão em WA_CURRICULOS.';

-- ── 2) O menu do SST ─────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sst_aso_demissional', 'ASO Demissional', '/app/sst/aso-demissional',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m
 WHERE m.codigo = 'sst'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'sst_aso_demissional');

-- ── 3) O menu no perfil de módulo do SST ─────────────────────────────────
-- Sem isto o menu novo nasce visível só para os perfis `concede_tudo` e
-- liberar exigiria marcar usuário por usuário, mesmo existindo um perfil de
-- módulo que serve exatamente para isso (mesma lição de
-- 20260925000008_troca_funcao_seed_perfis). NÃO é abrir acesso: o RouteGuard
-- nega por padrão e quem não tem o perfil continua sem ver a tela.
--
-- `alterar` a mais porque no SST marcar o ASO é escrita, igual ao `sst_aso`.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, x.menu, x.acao::public.app_acao, true
  FROM (VALUES
    ('SST', 'sst_aso_demissional', 'visualizar'),
    ('SST', 'sst_aso_demissional', 'alterar')
  ) AS x(perfil, menu, acao)
  JOIN public.perfil_acesso pa ON pa.nome = x.perfil AND pa.ativo
 WHERE EXISTS (SELECT 1 FROM public.app_menu m WHERE m.codigo = x.menu)
   AND NOT EXISTS (
     SELECT 1 FROM public.perfil_acesso_permissao p
      WHERE p.perfil_id = pa.id AND p.menu_codigo = x.menu AND p.acao::text = x.acao);

-- ── 4) Conferência ───────────────────────────────────────────────────────
SELECT status, count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO" GROUP BY 1 ORDER BY 2 DESC;

SELECT pa.nome AS perfil, pap.menu_codigo,
       string_agg(pap.acao::text, ', ' ORDER BY pap.acao::text) AS acoes
  FROM public.perfil_acesso pa
  JOIN public.perfil_acesso_permissao pap ON pap.perfil_id = pa.id AND pap.allow
 WHERE pap.menu_codigo = 'sst_aso_demissional'
 GROUP BY 1, 2 ORDER BY 1;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- DEPOIS DE RODAR: quem não estiver no perfil SST e mesmo assim precisar da
-- fila (o caso de sempre: uma pessoa emprestada de outro setor) continua
-- sendo liberação individual em Administração › Acesso por Usuário —
-- `sst_aso_demissional`, ações visualizar + alterar.
-- =========================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sst_aso_demissional';
--   DELETE FROM public.app_menu WHERE codigo = 'sst_aso_demissional';
--   ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
--     DROP COLUMN IF EXISTS sst_data_exame, DROP COLUMN IF EXISTS sst_hora_exame,
--     DROP COLUMN IF EXISTS sst_local_exame, DROP COLUMN IF EXISTS sst_maps_url,
--     DROP COLUMN IF EXISTS sst_observacao, DROP COLUMN IF EXISTS sst_por,
--     DROP COLUMN IF EXISTS sst_em;
--   (as que estiverem em 'Pendente SST' precisam voltar para 'Concluída')
-- =========================================================================
