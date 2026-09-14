-- =========================================================================
-- Demissão: a etapa 1 VOLTA para o Operacional; os analistas só acompanham
--
-- Pedido do Pablo em 14/09/2026: "agora o OPERACIONAL aprova as solicitações
-- de demissão, e os analistas só veem. Antes era assim: Operacional só
-- visualizava e analistas aprovavam."
--
-- É o inverso do bloco 4 da 20260930000042 (02/09/2026), que levou a
-- decisão para o analista e renomeou "Pendente Operacional" → "Pendente
-- Analista". Aqui:
--
--   1. As linhas paradas na etapa 1 voltam ao nome antigo. Sem isso elas
--      somem das telas — o `.in("status", ...)` do front não pede mais
--      "Pendente Analista", e a solicitação vira um registro invisível.
--   2. O trigger demissao_exige_vaga (20260930000092) segura a demissão na
--      etapa 1 enquanto a vaga de reposição não existe — ele testava o
--      nome do status, então precisa aprender o nome novo. O corpo é o
--      mesmo, só o literal muda.
--
-- Não há policy por etapa a mexer: ssd_all_auth é aberta para authenticated
-- (20260909000005) e quem pode decidir é decidido na tela pelo menu
-- (operacional_demissoes vs licitacoes_analistas_demissao). As colunas
-- `operacional_*` voltam a bater com quem decide.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- 1) O trigger que segura a demissão sem vaga -----------------------------
CREATE OR REPLACE FUNCTION public.demissao_exige_vaga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Os dois nomes da etapa 1 são aceitos de propósito: entre aplicar esta
  -- migration e o deploy do front, a produção antiga ainda grava "Pendente
  -- Analista" — e o trigger não pode deixar passar (nem estourar) por causa
  -- de um nome em transição. Renomear a etapa (Analista ↔ Operacional) não
  -- é fazer o pedido seguir.
  IF NEW.vaga_obrigatoria
     AND NEW.vaga_id IS NULL
     AND OLD.status IN ('Pendente Operacional', 'Pendente Analista')
     AND NEW.status NOT IN ('Pendente Operacional', 'Pendente Analista', 'Reprovada') THEN
    RAISE EXCEPTION 'Esta demissão ainda não tem a vaga de reposição. Quem solicitou precisa abrir a vaga de Substituição de % antes de o pedido seguir.', NEW.colaborador_nome;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_demissao_exige_vaga ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_demissao_exige_vaga
  BEFORE UPDATE OF status ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.demissao_exige_vaga();

-- 2) As paradas na etapa 1 ------------------------------------------------
-- ⚠️ RODAR DE NOVO DEPOIS DO DEPLOY DO FRONT. A produção antiga grava
-- "Pendente Analista" em toda solicitação nova até ser rebuildada; o front
-- novo só lista "Pendente Operacional". Enquanto os dois convivem, o certo é
-- o banco ficar no nome que a produção NO AR entende (14/09/2026: aplicada,
-- revertida no mesmo dia porque o front ainda era o antigo — os analistas
-- estavam vendo contagens diferentes conforme a hora em que abriam a tela).
-- DEPOIS do trigger, de propósito: com a versão antiga ainda no ar, o UPDATE
-- abaixo cai exatamente na condição dela (OLD = 'Pendente Analista', NEW fora
-- de Analista/Reprovada) e estoura em quem ainda não tem vaga — foi o que
-- aconteceu na primeira aplicação, 14/09/2026 ("MARIA APARECIDA KUNZLER").
-- Renomear a etapa não é fazer o pedido seguir.
UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
   SET status = 'Pendente Operacional'
 WHERE status = 'Pendente Analista';

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".vaga_obrigatoria IS
  'TRUE quando quem pediu respondeu "Sim" a "Deseja solicitar a substituição?": a vaga de Substituição abre em seguida e o pedido não sai de Pendente Operacional sem ela (trigger demissao_exige_vaga). FALSE = sem reposição (redução de quadro) ou pedido da tela antiga.';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO" SET status = 'Pendente Analista'
--  WHERE status = 'Pendente Operacional';
-- Reaplicar o bloco "A demissão não anda sem a vaga" da
-- 20260930000092_recrutamento_cpf_processos_demissao.sql (literal
-- 'Pendente Analista') e NOTIFY pgrst, 'reload schema';
