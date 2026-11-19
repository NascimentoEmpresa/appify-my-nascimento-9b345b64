-- =========================================================================
-- TURNOVER: HUSM E SALTO DO JACUÍ — DEMISSÕES DO FIM DO CONTRATO MARCADAS
-- COMO TÉRMINO DE CONTRATO (18/11/2026)
--
-- PEDIDO (Pablo, Relatórios › Turn-over, novembro): "tá puxando errado o
-- valor do turnover da HUSM e Salto do Jacuí, zera os valores, porque acabou
-- os contratos de lá, e término de contrato não é turnover. Não tá como
-- término de contrato porque quando o pessoal solicitou as demissões nesse
-- dia ainda não tinha a atualização que possibilitava marcar".
--
-- O QUE ESTAVA ERRADO (conferido com dir_turnover_painel, nov/2026):
--   · 1052 - HUSM SANTA MARIA - LAVANDERIA - 020/2021: 30 demissões, 115%
--     sobre o próprio contrato. O contrato já está "encerrado" em Licitações ›
--     Contratos, mas a regra da mig 20261116130000 não o pegou: a filial da
--     Senior sai com `encerrado: false` (a ligação filial → contrato cai em
--     outro contrato — há o "HUSM LAVANDERIA EMERGENCIAL - 039/2026", ativo).
--   · 1061 - SALTO DO JACUI - 722/2021: contrato ainda "ativo" (vigência até
--     30/11); 26 pessoas em aviso trabalhado, que viram demissão no fim do
--     mês e entrariam no turnover de novembro.
--   As solicitações de demissão dessas pessoas foram abertas em out–nov/2026,
--   antes da pergunta "encerramento de contrato" existir na Solicitar Demissão
--   (SIS-2026-0854, mig 20261114085400) — por isso nenhuma está marcada.
--
-- A CORREÇÃO: marcar encerramento_contrato nessas solicitações — o mesmo que
-- quem solicita marca hoje na tela. A regra única public.turnover_desconsidera
-- já tira do turnover quem tem solicitação marcada (todas as contas: Relatórios
-- › Turn-over, TVs, Indicadores, Rotatividade), inclusive os avisos
-- trabalhados dos Analistas. Nenhuma função muda.
--
-- ESCOPO: só as solicitações destes dois contratos (texto exato do campo
-- contrato, que vem da filial da Senior), feitas a partir de 01/10/2026 (o
-- encerramento), que não estão canceladas nem reprovadas. Fica de fora uma
-- solicitação da HUSM de setembro (outra situação, "Não se aplica").
-- Nenhuma trava da tabela dispara: elas olham mudança de status (e a do RH
-- antes do SST só barra status 'Pendente SST', que nenhuma destas tem).
--
-- Idempotente (só marca quem ainda não está marcado).
-- =========================================================================

UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
   SET encerramento_contrato = true
 WHERE contrato IN ('1052 - HUSM SANTA MARIA - LAVANDERIA - 020/2021',
                    '1061 - SALTO DO JACUI - 722/2021')
   AND data_solicitacao >= DATE '2026-10-01'
   AND status NOT IN ('Cancelada', 'Reprovada')
   AND NOT encerramento_contrato;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
--    SET encerramento_contrato = false
--  WHERE contrato IN ('1052 - HUSM SANTA MARIA - LAVANDERIA - 020/2021',
--                     '1061 - SALTO DO JACUI - 722/2021')
--    AND data_solicitacao >= DATE '2026-10-01';
-- NOTIFY pgrst, 'reload schema';
