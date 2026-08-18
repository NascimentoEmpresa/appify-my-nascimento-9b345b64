-- =========================================================================
-- RECRUTAMENTO — desistencia, aprovacao paralela SST+Compras e devolucao
-- do Juridico
--
-- Tres mudancas de fluxo pedidas pelo RH em 18/08/2026:
--
-- 1) DESISTENCIA — o candidato pode desistir em QUALQUER etapa, informando
--    o motivo. Nao e reprovacao: quem reprova e a empresa, quem desiste e
--    ele. Sao coisas diferentes para indicador e para reaproveitamento no
--    banco de talentos, entao ganham campos proprios em vez de virar mais
--    um "motivo_reprovacao".
--
-- 2) SST + COMPRAS EM PARALELO — ao sair da DOCUMENTACAO o candidato ia
--    para EXAME SST e so depois para COMPRAS, em fila. Passam a correr
--    juntos: as duas colunas viram uma so e a proxima etapa (ADMISSAO) so
--    libera quando os DOIS setores aprovarem. `sst_ok` ja existia;
--    `compras_ok` nao — havia so `compras_em`, que marca "mexeu", nao
--    "aprovou".
--
-- 3) JURIDICO DEVOLVE — hoje o parecer negativo do Juridico manda direto
--    para Reprovado. Passa a existir "reprovar e devolver ao RH": o
--    parecer fica gravado (juridico_ok = false) e o candidato volta para
--    TRIAGEM com alerta, para o RH decidir. Sem coluna nova: a combinacao
--    juridico_ok = false + etapa <> 'Reprovado' JA descreve esse estado.
--
-- Idempotente.
-- ROLLBACK:
--   UPDATE public."WA_CURRICULOS" SET etapa_processo = 'EXAME SST'
--    WHERE etapa_processo = 'SST + COMPRAS';
--   ALTER TABLE public."WA_CURRICULOS"
--     DROP COLUMN IF EXISTS compras_ok, DROP COLUMN IF EXISTS desistiu,
--     DROP COLUMN IF EXISTS desistencia_motivo, DROP COLUMN IF EXISTS desistencia_em,
--     DROP COLUMN IF EXISTS desistencia_por, DROP COLUMN IF EXISTS desistencia_etapa;
-- =========================================================================

ALTER TABLE public."WA_CURRICULOS"
  -- Espelha o sst_ok. `compras_em` sozinho nao servia: marca que alguem
  -- mexeu, nao que aprovou.
  ADD COLUMN IF NOT EXISTS compras_ok          boolean,
  ADD COLUMN IF NOT EXISTS desistiu            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS desistencia_motivo  text,
  ADD COLUMN IF NOT EXISTS desistencia_em      timestamptz,
  ADD COLUMN IF NOT EXISTS desistencia_por     text,
  -- Em que etapa ele estava ao desistir. Sem isso o indicador de "onde
  -- perdemos candidato" fica cego, porque a etapa vira 'Reprovado'.
  ADD COLUMN IF NOT EXISTS desistencia_etapa   text;

COMMENT ON COLUMN public."WA_CURRICULOS".desistiu IS
  'O CANDIDATO desistiu (diferente de reprovado, que e decisao da empresa). Etapa vai para Reprovado, e a coluna do kanban mostra os dois grupos.';
COMMENT ON COLUMN public."WA_CURRICULOS".compras_ok IS
  'Compras aprovou. Junto com sst_ok libera a ADMISSAO — os dois correm em paralelo.';

CREATE INDEX IF NOT EXISTS wa_curriculos_desistiu_idx
  ON public."WA_CURRICULOS" (desistiu) WHERE desistiu;

-- ── Fusao das etapas: DE PROPOSITO, NAO ACONTECE AQUI ──────────────────
-- A primeira versao desta migration trocava etapa_processo de 'EXAME SST'
-- e 'COMPRAS' para 'SST + COMPRAS'. Foi um erro de ORDEM: o kanban desenha
-- so as colunas de CAND_ETAPAS, entao o candidato com a etapa nova ficou
-- SEM coluna onde cair — sumiu do quadro em producao ate o codigo subir.
--
-- A licao virou desenho: quem concilia os nomes e a TELA, que trata
-- 'EXAME SST', 'COMPRAS' e 'SST + COMPRAS' como a mesma coluna. Assim dado
-- antigo e codigo novo convivem, e nao existe janela em que um esteja na
-- frente do outro.

NOTIFY pgrst, 'reload schema';
