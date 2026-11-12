-- =========================================================================
-- VAGAS DO QUADRO DE POSTOS: a trava de envio repetido derrubava a leva (12/11/2026)
--
-- O CASO (prints do Pablo): em Licitações › Contratos, ao salvar o contrato
-- com postos marcados para abrir vaga, saía o toast vermelho "Erro ao abrir
-- as vagas — Esta solicitação já foi enviada (#1536). Não precisa enviar de
-- novo." (também #1528). Nenhuma vaga ficava: a RPC é uma transação só.
--
-- Por quê: contrato_quadro_gerar_vagas (mig 20260930000241) cria UMA linha
-- em SISTEMA_RECRUTAMENTO por pessoa do posto, todas com quantidade_vagas = 1
-- e o mesmo contrato, cargo, motivo, local e solicitante — só mudam
-- quadro_indice (1..N) e o texto da observação. O gatilho
-- trg_recrutamento_envio_repetido (mig 20261026000030) compara justamente
-- aquelas colunas e não as do quadro, então a vaga 2 do posto parecia o
-- "clique repetido" da vaga 1 (o # do erro é a vaga 1, que acabara de nascer
-- na mesma transação) e a leva inteira voltava.
--
-- Correção: quadro_posto_id e quadro_indice entram na chave do gatilho.
--   - Vaga manual (Recrutamento › Solicitar Vaga): as duas colunas são NULL,
--     NULL IS NOT DISTINCT FROM NULL → a trava continua exatamente igual.
--   - Vaga do quadro: cada pessoa tem o seu índice → não se confundem mais.
--     A duplicidade de verdade (mesmo posto, mesmo índice) segue barrada por
--     uq_sr_quadro_indice (mig 20260930000238) e pelo CONTINUE WHEN EXISTS
--     da própria RPC, que pula o índice já gerado ao repetir a geração.
-- =========================================================================

DROP TRIGGER IF EXISTS trg_recrutamento_envio_repetido ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_recrutamento_envio_repetido
  BEFORE INSERT ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.solicitacao_bloqueia_envio_repetido(
    'created_at', 'solicitante_cpf', 'contrato', 'cargo', 'motivo_vaga', 'quantidade_vagas',
    'nome_substituido', 'local_exato', 'quadro_posto_id', 'quadro_indice');

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_recrutamento_envio_repetido ON public."SISTEMA_RECRUTAMENTO";
-- CREATE TRIGGER trg_recrutamento_envio_repetido
--   BEFORE INSERT ON public."SISTEMA_RECRUTAMENTO"
--   FOR EACH ROW EXECUTE FUNCTION public.solicitacao_bloqueia_envio_repetido(
--     'created_at', 'solicitante_cpf', 'contrato', 'cargo', 'motivo_vaga', 'quantidade_vagas', 'nome_substituido', 'local_exato');
