-- =========================================================================
-- FÉRIAS — registro da carga do histórico das planilhas (04/11/2026)
--
-- Esta migration NÃO grava nada: é o registro, no repositório, de uma carga
-- de dados feita direto no banco1 em 04/11/2026, com o OK do Pablo sobre a
-- prévia. Os dados são pessoais (nome, CPF, datas de férias), então nem as
-- planilhas nem o script com as linhas entram no git.
--
-- Fonte: "PLANILHA DE FÉRIAS 2026.xlsx" (abas PLANILHA GERAL ATÉ 06.26,
-- 07.2026 a 12.2026, 01.2027 e 02.2027) e "PLANILHA DE FÉRIAS 2027.xlsx"
-- (01.2027 a 05.2027) — controle do RH antes de o pedido de férias existir
-- no ERP. As abas Planilha1..5 ficaram de fora (financeiro / set-2025 / vazias).
--
-- Destino: public."SISTEMA_SOLICITACOES_FERIAS", ids #378 a #1404
-- (1.027 linhas; a tabela foi de 331 para 1.358). Cada linha carrega nas
-- observações a origem: "Migrado da planilha de férias <ano> (aba X, linha N)".
--
-- Regras usadas:
--   · colaborador_id = EMPREGADOS."ID": pela matrícula da Senior
--     (EMPREGADOS."Cadastro" + empresa HAGG=1 / SN=2) quando a planilha tinha
--     o código; senão pelo nome oficial; erro de digitação só com um único
--     candidato próximo. Readmissão: o cadastro vigente na data de saída.
--   · "Já existe" = período do mesmo colaborador que cruza com solicitação
--     ATIVA no sistema → não entrou e nada existente foi alterado (302).
--     Cruzando só com Reprovada/Cancelada: entrou como solicitação nova
--     (7, decisão do Pablo).
--   · Status: GERADA / ANTECIPADA / saída já passada → 'Aprovada' (aprovado_por
--     "RH — <usuário> (planilha)"); "cancelada" na planilha → 'Cancelada';
--     2027 ainda não gerada → 'Pendente'.
--   · Solicitante: "PROGRAMAÇÃO RECEBIDA POR" (1º nome) → encarregado com login
--     quando identificável (867); senão fica o texto da planilha, sem e-mail.
--   · Linhas repetidas entre as abas: ficou a fonte mais nova (18 puladas).
--   · Fora: 27 sem data de início e 9 nomes que não existem em EMPREGADOS.
--
-- Carga numa transação, com trg_sino_ferias, trg_ferias_fracionamento,
-- trg_ferias_sem_duplicidade, trg_ferias_envio_repetido e
-- trg_ferias_valida_venda desligados SÓ durante o INSERT (sem ~1.000 avisos
-- no sino do RH e sem as regras de pedido novo barrando histórico) e
-- religados no fim. trg_ferias_historico ficou ligado ("Criada"), e o evento
-- da decisão foi gravado como no estoque da mig 20260930000113.
--
-- Conferido depois: 1.027 origens distintas, 0 períodos ativos sobrepostos
-- envolvendo as migradas, 2.035 eventos de histórico.
-- =========================================================================

-- Só conferência (não altera nada): quantas migradas o banco tem.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public."SISTEMA_SOLICITACOES_FERIAS"
   WHERE observacoes LIKE 'Migrado da planilha de férias%';
  RAISE NOTICE 'Férias migradas das planilhas: % (esperado 1027)', n;
END $$;

-- Desfazer a carga (só se for preciso — apaga também o histórico, ON DELETE CASCADE):
-- DELETE FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE observacoes LIKE 'Migrado da planilha de férias%';
