-- =========================================================================
-- Demissão: a vaga de Substituição só é exigida quando quem pediu disse "Sim"
--
-- O SINTOMA (11/09/2026)
--   Analista tentando aprovar: "Esta demissão ainda não tem a vaga de
--   reposição. Quem solicitou precisa abrir a vaga de Substituição de VICTOR
--   AMONRA ... antes de o pedido seguir." Só que nem toda demissão repõe
--   alguém — redução de quadro, posto que fecha — e, pior, o site ainda roda
--   a tela antiga, que nem abre a vaga: o gatilho da 092 (vaga_obrigatoria
--   nascendo TRUE) travou pedidos que ninguém conseguia destravar.
--
-- A DECISÃO
--   A tela ganhou a pergunta "Deseja solicitar a substituição desse
--   colaborador?" (Sim/Não) no fim do pedido. `vaga_obrigatoria` passa a
--   nascer FALSE e só é TRUE quando a resposta foi "Sim" — aí a vaga abre em
--   seguida e o pedido só anda com ela (trigger demissao_exige_vaga, que não
--   muda). Pedido gravado pela tela antiga (sem a pergunta) não exige nada.
--
--   Estoque: as demissões sem vaga e ainda em "Pendente Analista" que
--   nasceram TRUE hoje ficam FALSE — ninguém respondeu a pergunta nelas.
--   Quem quiser a vaga pede pela lista ("Solicitar vaga").
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ALTER COLUMN vaga_obrigatoria SET DEFAULT false;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".vaga_obrigatoria IS
  'TRUE quando quem pediu respondeu "Sim" a "Deseja solicitar a substituição?": a vaga de Substituição abre em seguida e o pedido não sai de Pendente Analista sem ela (trigger demissao_exige_vaga). FALSE = sem reposição (redução de quadro) ou pedido da tela antiga.';

UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
   SET vaga_obrigatoria = false
 WHERE vaga_obrigatoria
   AND vaga_id IS NULL;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE vaga_obrigatoria AND vaga_id IS NULL) AS presas_sem_vaga
  FROM public."SISTEMA_SOLICITACOES_DEMISSAO";
-- (esperado: 0)

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" ALTER COLUMN vaga_obrigatoria SET DEFAULT true;
-- NOTIFY pgrst, 'reload schema';
