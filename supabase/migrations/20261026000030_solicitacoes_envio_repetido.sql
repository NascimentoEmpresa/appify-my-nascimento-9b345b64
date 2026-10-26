-- =========================================================================
-- SOLICITAÇÕES: o mesmo envio não entra duas vezes (26/10/2026)
--
-- O CASO (print do Pablo): a encarregada registrou a advertência VERBAL do
-- AILTON ALVANDIR RITZ COUTO (UFRGS — LIMPEZA GERAL, ocorrido 08/10/2026,
-- "FALTA SEM JUSTIFICATIVA…") e saíram 8 solicitações iguais, #56 a #63,
-- todas "Solicitada: 13/10/2026 às 11:15" — cliques repetidos no botão
-- enquanto o primeiro envio ainda estava indo. "Isso não pode acontecer":
-- tirar as repetidas e travar para não duplicar em nenhum outro sistema.
--
-- Por que a trava que já existia não pegou: solicitacao_em_aberto (mig
-- 20260930000104) recusa advertência nova só quando há outra AGUARDANDO
-- decisão. A verbal nasce "Registrada" (status final, mig 20260930000210),
-- então nunca está "em aberto" e passava sempre.
--
--   1. solicitacao_bloqueia_envio_repetido(): gatilho genérico BEFORE INSERT.
--      Recusa a linha se a MESMA solicitação (mesmas colunas-chave, passadas
--      como argumento) entrou há menos de 2 minutos. Advisory lock pela chave
--      para que dois cliques simultâneos não passem os dois (um não vê o
--      outro antes do commit). Primeiro argumento: a coluna de data da tabela
--      (created_at ou criado_em, conforme a tabela).
--   2. Ligado em advertência, férias, demissão, mudança de função e vaga.
--   3. Limpeza: advertências iguais (colaborador, tipo, data e descrição do
--      ocorrido, solicitante) enviadas a menos de 2 min da anterior ficam só
--      com a primeira (menor #). Anexos e comentários das repetidas passam
--      para a que fica; o histórico delas sai junto (ON DELETE CASCADE). As
--      linhas apagadas ficam em SISTEMA_SOLICITACOES_ADVERTENCIA_DUP_BKP.
--
-- No navegador, src/lib/envioUnico.ts segura o clique repetido antes de
-- chegar aqui (vale para qualquer insert do sistema); este gatilho é a
-- garantia caso algo escape (duas abas, rede lenta, outra tela).
-- =========================================================================

-- ── 1. Gatilho genérico ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.solicitacao_bloqueia_envio_repetido()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_col_data text := TG_ARGV[0];
  v_cond     text := '';
  v_chave    text := TG_TABLE_NAME;
  v_novo     jsonb := to_jsonb(NEW);
  v_id       text;
  i          int;
BEGIN
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    v_cond  := v_cond || format(' AND t.%I IS NOT DISTINCT FROM ($1).%I', TG_ARGV[i], TG_ARGV[i]);
    v_chave := v_chave || '|' || COALESCE(v_novo ->> TG_ARGV[i], '∅');
  END LOOP;

  -- Dois cliques ao mesmo tempo: o segundo espera o primeiro terminar e aí o vê.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_chave, 0));

  EXECUTE format('SELECT t.id::text FROM %I.%I t WHERE t.%I > now() - interval ''2 minutes''%s ORDER BY t.id LIMIT 1',
                 TG_TABLE_SCHEMA, TG_TABLE_NAME, v_col_data, v_cond)
     INTO v_id USING NEW;

  IF v_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta solicitação já foi enviada (#%). Não precisa enviar de novo.', v_id
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.solicitacao_bloqueia_envio_repetido() FROM PUBLIC, anon;

-- ── 2. Onde vale ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_advertencia_envio_repetido ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE TRIGGER trg_advertencia_envio_repetido
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"
  FOR EACH ROW EXECUTE FUNCTION public.solicitacao_bloqueia_envio_repetido(
    'created_at', 'colaborador_id', 'tipo_advertencia', 'data_ocorrido', 'descricao_ocorrido', 'solicitante_email');

DROP TRIGGER IF EXISTS trg_ferias_envio_repetido ON public."SISTEMA_SOLICITACOES_FERIAS";
CREATE TRIGGER trg_ferias_envio_repetido
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_FERIAS"
  FOR EACH ROW EXECUTE FUNCTION public.solicitacao_bloqueia_envio_repetido(
    'criado_em', 'colaborador_id', 'data_saida', 'dias_ferias', 'dias_vendidos', 'solicitante_email');

DROP TRIGGER IF EXISTS trg_demissao_envio_repetido ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_demissao_envio_repetido
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.solicitacao_bloqueia_envio_repetido(
    'criado_em', 'colaborador_id', 'solicitante_email');

DROP TRIGGER IF EXISTS trg_troca_funcao_envio_repetido ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
CREATE TRIGGER trg_troca_funcao_envio_repetido
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  FOR EACH ROW EXECUTE FUNCTION public.solicitacao_bloqueia_envio_repetido(
    'criado_em', 'colaborador_id', 'cargo_novo', 'solicitante_email');

DROP TRIGGER IF EXISTS trg_recrutamento_envio_repetido ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_recrutamento_envio_repetido
  BEFORE INSERT ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.solicitacao_bloqueia_envio_repetido(
    'created_at', 'solicitante_cpf', 'contrato', 'cargo', 'motivo_vaga', 'quantidade_vagas', 'nome_substituido', 'local_exato');

-- ── 3. Limpeza das advertências repetidas ─────────────────────────────────
-- Repetida = existe outra igual, de # menor, enviada até 2 min antes. A que
-- fica é a primeira da sequência (a menor # do grupo).
CREATE TEMP TABLE adv_rep ON COMMIT DROP AS
WITH RECURSIVE base AS (
  SELECT a.id, a.created_at,
         md5(concat_ws('|', a.colaborador_id, a.tipo_advertencia, a.data_ocorrido, a.descricao_ocorrido, a.solicitante_email)) AS k
    FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
),
cadeia AS (   -- começa em quem NÃO tem anterior igual a ≤ 2 min; segue para a próxima a ≤ 2 min
  SELECT b.id AS fica, b.id, b.created_at, b.k
    FROM base b
   WHERE NOT EXISTS (SELECT 1 FROM base p WHERE p.k = b.k AND p.id < b.id
                       AND b.created_at - p.created_at BETWEEN interval '0' AND interval '2 minutes')
  UNION
  SELECT c.fica, b.id, b.created_at, b.k
    FROM cadeia c
    JOIN base b ON b.k = c.k AND b.id > c.id
               AND b.created_at - c.created_at BETWEEN interval '0' AND interval '2 minutes'
)
SELECT DISTINCT ON (id) id, fica FROM cadeia WHERE id <> fica ORDER BY id, fica;

CREATE TABLE IF NOT EXISTS public."SISTEMA_SOLICITACOES_ADVERTENCIA_DUP_BKP"
  (LIKE public."SISTEMA_SOLICITACOES_ADVERTENCIA");
ALTER TABLE public."SISTEMA_SOLICITACOES_ADVERTENCIA_DUP_BKP"
  ADD COLUMN IF NOT EXISTS duplicada_de bigint,
  ADD COLUMN IF NOT EXISTS removida_em timestamptz DEFAULT now();
ALTER TABLE public."SISTEMA_SOLICITACOES_ADVERTENCIA_DUP_BKP" ENABLE ROW LEVEL SECURITY;  -- sem policy: só o banco lê
INSERT INTO public."SISTEMA_SOLICITACOES_ADVERTENCIA_DUP_BKP"
SELECT a.*, r.fica, now()
  FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a JOIN adv_rep r ON r.id = a.id;

UPDATE public."SISTEMA_SOLICITACOES_ANEXOS" x SET entidade_id = r.fica::text
  FROM adv_rep r WHERE x.modulo = 'advertencia' AND x.entidade_id = r.id::text;
UPDATE public."SISTEMA_COMENTARIOS" x SET entidade_id = r.fica::text
  FROM adv_rep r WHERE x.modulo = 'advertencia' AND x.entidade_id = r.id::text;

DELETE FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a USING adv_rep r WHERE a.id = r.id;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_advertencia_envio_repetido  ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
-- DROP TRIGGER IF EXISTS trg_ferias_envio_repetido       ON public."SISTEMA_SOLICITACOES_FERIAS";
-- DROP TRIGGER IF EXISTS trg_demissao_envio_repetido     ON public."SISTEMA_SOLICITACOES_DEMISSAO";
-- DROP TRIGGER IF EXISTS trg_troca_funcao_envio_repetido ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
-- DROP TRIGGER IF EXISTS trg_recrutamento_envio_repetido ON public."SISTEMA_RECRUTAMENTO";
-- DROP FUNCTION IF EXISTS public.solicitacao_bloqueia_envio_repetido();
-- As apagadas estão em "SISTEMA_SOLICITACOES_ADVERTENCIA_DUP_BKP" (todas as
-- colunas + duplicada_de/removida_em); para devolver, INSERT com a lista de
-- colunas da tabela original lendo do backup. Anexos e comentários ficaram
-- na que sobrou (duplicada_de) — não voltam sozinhos.
