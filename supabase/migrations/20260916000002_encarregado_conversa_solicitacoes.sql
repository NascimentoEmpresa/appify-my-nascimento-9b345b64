-- =========================================================================
-- Encarregado passa a conversar sobre as PRÓPRIAS solicitações
--
-- POR QUE
-- A tela "Minhas Solicitações" ganhou detalhes e chat. Só que o fio da VAGA
-- é o WA_MENSAGENS_RECRUTAMENTO, e a policy dele exige `recrutamento_gestao`
-- — que o encarregado não tem. Sem esta migration, o chat da vaga abriria
-- vazio para ele e o envio falharia.
--
-- E não é só o encarregado: a policy também não conhece
-- `operacional_recrutamento`. Quem entra pela Gestão de Recrutamento do
-- Operacional dependia de ter as duas liberações para ver a conversa — o que
-- contraria o desenho daquele módulo ("liberar operacional_recrutamento já
-- basta", ver 20260909000007).
--
-- O RECORTE DO ENCARREGADO
-- Ele não vê a conversa de qualquer vaga: vê a das vagas que ELE abriu
-- (`solicitante_cpf` = e-mail dele, que é como o resto do módulo já amarra).
-- Quem trata continua vendo todas.
--
-- Idempotente.
-- =========================================================================

-- Sem isto, cada linha da conversa faria uma varredura em SISTEMA_RECRUTAMENTO
-- para responder "esta vaga é dele?".
CREATE INDEX IF NOT EXISTS sistema_recrutamento_solicitante_idx
  ON public."SISTEMA_RECRUTAMENTO" (solicitante_cpf);

-- ── Conversa da vaga ─────────────────────────────────────────────────
DROP POLICY IF EXISTS wa_mensagens_recrutamento_gate ON public."WA_MENSAGENS_RECRUTAMENTO";
CREATE POLICY wa_mensagens_recrutamento_gate ON public."WA_MENSAGENS_RECRUTAMENTO"
  FOR ALL TO authenticated
  USING (
    has_screen_access(auth.uid(), 'recrutamento_gestao'::text, 'visualizar'::app_acao)
    -- O Operacional decide sobre a vaga; ler o que foi conversado sobre ela
    -- faz parte de decidir.
    OR has_screen_access(auth.uid(), 'operacional_recrutamento'::text, 'visualizar'::app_acao)
    -- O encarregado, só nas vagas que ele mesmo abriu.
    OR EXISTS (
      SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" s
       WHERE s.id = "WA_MENSAGENS_RECRUTAMENTO".solicitacao_id
         AND s.solicitante_cpf = (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid())
    )
  )
  WITH CHECK (
    has_screen_access(auth.uid(), 'recrutamento_gestao'::text, 'incluir'::app_acao)
    OR has_screen_access(auth.uid(), 'recrutamento_gestao'::text, 'alterar'::app_acao)
    OR has_screen_access(auth.uid(), 'operacional_recrutamento'::text, 'alterar'::app_acao)
    OR has_screen_access(auth.uid(), 'operacional_recrutamento'::text, 'aprovar'::app_acao)
    OR EXISTS (
      SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" s
       WHERE s.id = "WA_MENSAGENS_RECRUTAMENTO".solicitacao_id
         AND s.solicitante_cpf = (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid())
    )
  );

-- ── Conversa de férias, advertência e demissão ───────────────────────
-- SISTEMA_COMENTARIOS já é `USING (true)` para authenticated — o feed é
-- compartilhado por vários módulos e sempre foi assim. Não estreito aqui:
-- estreitar exigiria conhecer a regra de acesso de CADA módulo que usa o
-- feed (patrimônio, processo, férias…), e errar nisso apagaria comentário
-- de gente que hoje enxerga. Fica registrado como dívida.
--
-- O que dá para fazer sem risco é garantir que os três módulos novos são
-- valores esperados, para uma consulta futura por módulo não achar que
-- 'demissao' é typo.
COMMENT ON COLUMN public."SISTEMA_COMENTARIOS".modulo IS
  'patrimonio | processo | ferias | bonificacao | advertencia | demissao. advertencia e demissao entraram em 21/08/2026 com a tela de Minhas Solicitacoes do encarregado.';

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT policyname,
       (COALESCE(qual, '') LIKE '%operacional_recrutamento%')       AS le_operacional,
       (COALESCE(qual, '') LIKE '%SISTEMA_RECRUTAMENTO%')           AS le_dono_da_vaga
  FROM pg_policies
 WHERE tablename = 'WA_MENSAGENS_RECRUTAMENTO';

-- =========================================================================
-- ROLLBACK
--   Recriar wa_mensagens_recrutamento_gate da 20260804000005 (só
--   recrutamento_gestao). Isso devolve o chat vazio para o encarregado.
-- =========================================================================
