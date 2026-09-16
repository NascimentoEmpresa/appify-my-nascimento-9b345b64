-- =========================================================================
-- Mudança de Função: a etapa do analista sai; o que estava nela vai pra
-- fila de quem decide
--
-- Pedido do Pablo em 16/09/2026: "na Licitação ninguém pode ver as do
-- administrativo nem as com setor; na Licitação não pode aparecer o botão
-- de validar, apenas na tela do Operacional; quando tiver setor vai pra
-- Diretoria › Mudança de Função".
--
-- A regra nova mora na tela (src/lib/trocaFuncao/solicitacao.ts):
--   • administrativa = escritório OU com setor → "Pendente Escritório"
--     (Diretoria), visível/decidível só por quem tem o setor marcado em
--     SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR (mig 125);
--   • contrato sem setor → "Pendente Operacional";
--   • Licitações › Analistas Validações só acompanha as de contrato.
--
-- O que este arquivo faz é só o ESTOQUE: nada nasce mais em "Pendente
-- Analista", e o que estava lá (3 linhas em 16/09/2026) não pode ficar
-- órfão — Licitações perdeu o botão. Cada uma vai pra fila certa pela mesma
-- regra da tela. O status "Pendente Analista" continua aceito pelo CHECK
-- (mig 118) só pelo histórico.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

UPDATE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
   SET status = CASE
                  WHEN coalesce(e_escritorio, false) OR nullif(btrim(coalesce(setor, '')), '') IS NOT NULL
                    THEN 'Pendente Escritório'
                  ELSE 'Pendente Operacional'
                END
 WHERE status = 'Pendente Analista';

-- Conferência
-- SELECT id, colaborador_nome, e_escritorio, setor, status FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
--  WHERE status IN ('Pendente Operacional', 'Pendente Escritório') ORDER BY id;

-- ROLLBACK: não se desfaz sozinho (as linhas podem já ter andado).
