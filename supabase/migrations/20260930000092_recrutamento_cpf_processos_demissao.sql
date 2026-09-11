-- =========================================================================
-- Recrutamento: três amarrações pedidas em 11/09/2026
--
--   1. NOME PELO CPF — o candidato pode digitar "SENILTON"; se o CPF está no
--      cadastro de pessoal, o nome que aparece em toda tela é o oficial
--      ("SENILTON RAMOS DO NASCIMENTO"). Trigger na WA_CURRICULOS: o que a
--      pessoa digitou fica guardado em `nome_informado`, `nome` vira o do
--      cadastro. Quem não está no cadastro fica com o que digitou — não há
--      outra fonte de nome por CPF.
--
--   2. PROCESSOS — se o candidato já processou a empresa (JUR_PROCESSOS), o
--      Recrutamento vê "#410 · 0021423-52.2025.5.04.0406" ao lado do nome.
--      RPC `rec_processos_do_candidato`, casando por CPF (quando o processo
--      tem o CPF vinculado) OU pelo nome completo. SECURITY DEFINER com
--      porta própria: quem trabalha recrutamento não tem (e não ganha)
--      acesso à tabela do Jurídico — só à resposta "processou / qual".
--
--   3. DEMISSÃO ↔ VAGA — uma demissão gera uma vaga de Substituição, e uma
--      vaga de Substituição exige a demissão de quem sai:
--        • SISTEMA_RECRUTAMENTO.demissao_id  → a demissão que abriu a vaga
--        • SISTEMA_SOLICITACOES_DEMISSAO.vaga_id → a vaga que repõe a pessoa
--      Gatilhos: vaga de Substituição nova sem `demissao_id` (ou apontando
--      para a demissão de OUTRA pessoa, ou reprovada) é recusada; a demissão
--      não sai de "Pendente Analista" sem a vaga (`vaga_obrigatoria`, que
--      nasce true e fica false só nas 46 que já existiam — ninguém vai
--      travar um caso de setembro por regra de hoje). Quando a vaga é criada,
--      a demissão recebe o `vaga_id` sozinha.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Nome pelo CPF
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS nome_informado text;

COMMENT ON COLUMN public."WA_CURRICULOS".nome_informado IS
  'O nome como o candidato digitou, quando o CPF está no cadastro de pessoal e `nome` foi trocado pelo oficial (trigger wa_curriculos_nome_pelo_cpf). NULL = o nome exibido é o que ele digitou.';

/**
 * Nome oficial de um CPF, pelo cadastro de pessoal. Com mais de um cadastro
 * para o mesmo CPF (reingresso, outra empresa do grupo), vale quem está
 * trabalhando; empatando, o mais novo.
 */
CREATE OR REPLACE FUNCTION public.rh_nome_oficial_por_cpf(p_cpf text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT btrim(e."Nome")
    FROM public."EMPREGADOS" e
   WHERE length(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')) = 11
     AND regexp_replace(coalesce(e."CPF", ''), '\D', '', 'g')
       = regexp_replace(p_cpf, '\D', '', 'g')
     AND nullif(btrim(e."Nome"), '') IS NOT NULL
   ORDER BY (e."Situação" = 'Trabalhando') DESC, e."ID" DESC
   LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION public.rh_nome_oficial_por_cpf(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rh_nome_oficial_por_cpf(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rh_nome_oficial_por_cpf(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rh_nome_oficial_por_cpf(text) TO service_role;

CREATE OR REPLACE FUNCTION public.wa_curriculos_nome_pelo_cpf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_oficial text;
BEGIN
  v_oficial := public.rh_nome_oficial_por_cpf(coalesce(NEW.cpf, NEW.cpf_cand));
  IF v_oficial IS NULL THEN
    RETURN NEW;                       -- fora do cadastro: fica o que digitou
  END IF;
  IF upper(btrim(coalesce(NEW.nome, ''))) IS DISTINCT FROM upper(v_oficial) THEN
    -- O que chegou diferente do oficial é o que a pessoa digitou: guarda e
    -- troca. Se já chegou igual, não há nada a guardar.
    IF nullif(btrim(coalesce(NEW.nome, '')), '') IS NOT NULL THEN
      NEW.nome_informado := btrim(NEW.nome);
    END IF;
    NEW.nome := v_oficial;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_wa_curriculos_nome_pelo_cpf ON public."WA_CURRICULOS";
CREATE TRIGGER trg_wa_curriculos_nome_pelo_cpf
  BEFORE INSERT OR UPDATE OF nome, cpf, cpf_cand ON public."WA_CURRICULOS"
  FOR EACH ROW EXECUTE FUNCTION public.wa_curriculos_nome_pelo_cpf();

-- Estoque: passa cada candidato pelo mesmo gatilho (UPDATE de `nome` para o
-- próprio valor dispara o BEFORE UPDATE OF nome).
UPDATE public."WA_CURRICULOS" c
   SET nome = c.nome
 WHERE public.rh_nome_oficial_por_cpf(coalesce(c.cpf, c.cpf_cand)) IS NOT NULL
   AND upper(btrim(coalesce(c.nome, ''))) IS DISTINCT FROM
       upper(public.rh_nome_oficial_por_cpf(coalesce(c.cpf, c.cpf_cand)));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Processos do candidato
-- ─────────────────────────────────────────────────────────────────────────
-- Nome comparável: maiúsculo, sem acento, um espaço só.
CREATE OR REPLACE FUNCTION public.rec_nome_chave(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT regexp_replace(upper(translate(btrim(coalesce(p, '')),
           'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
           'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '\s+', ' ', 'g')
$fn$;


/**
 * Para uma lista de candidatos (CPF e/ou nome), quais já processaram a
 * empresa. Uma linha por processo (JUR_PROCESSOS tem uma linha por motivo —
 * daí o DISTINCT em id_sequencial), com o CPF/nome que casou, para a tela
 * pendurar o aviso no candidato certo.
 *
 * Casa por CPF quando o processo tem `reclamante_vinculado_cpf`; senão pelo
 * nome completo, sem acento e sem espaço duplicado. Nome homônimo pode dar
 * falso positivo — o aviso diz "confira", não "reprove".
 *
 * PORTA: quem enxerga candidatos. Não é a RLS da JUR_PROCESSOS de propósito:
 * o Recrutamento não lê processos, lê "este CPF tem processo".
 */
CREATE OR REPLACE FUNCTION public.rec_processos_do_candidato(
  p_cpfs  text[] DEFAULT '{}',
  p_nomes text[] DEFAULT '{}'
)
RETURNS TABLE (
  id_sequencial   bigint,
  numero_processo text,
  reclamante      text,
  cpf_digits      text,
  nome_chave      text,
  status          text,
  casou_por       text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  IF NOT (public.has_screen_access(v_uid, 'recrutamento_gestao', 'visualizar')
       OR public.has_screen_access(v_uid, 'rh_banco_talentos', 'visualizar')
       OR public.has_screen_access(v_uid, 'candidatos', 'visualizar')
       OR public.has_screen_access(v_uid, 'licitacoes_analistas_recrutamento', 'visualizar')
       OR public.has_screen_access(v_uid, 'operacional_recrutamento', 'visualizar')) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH cpfs AS (
    SELECT DISTINCT regexp_replace(c, '\D', '', 'g') AS d
      FROM unnest(coalesce(p_cpfs, '{}')) c
     WHERE length(regexp_replace(c, '\D', '', 'g')) = 11
  ),
  nomes AS (
    SELECT DISTINCT public.rec_nome_chave(n) AS k
      FROM unnest(coalesce(p_nomes, '{}')) n
     WHERE length(btrim(coalesce(n, ''))) >= 5
  ),
  achados AS (
    SELECT p.id_sequencial, p.numero_processo, p.reclamante, p.status,
           regexp_replace(coalesce(p.reclamante_vinculado_cpf, ''), '\D', '', 'g') AS pcpf,
           public.rec_nome_chave(p.reclamante) AS pnome
      FROM public."JUR_PROCESSOS" p
     WHERE p.id_sequencial IS NOT NULL
  )
  SELECT DISTINCT ON (a.id_sequencial, coalesce(c.d, ''), coalesce(n.k, ''))
         a.id_sequencial, a.numero_processo, a.reclamante,
         c.d, n.k, a.status,
         CASE WHEN c.d IS NOT NULL THEN 'cpf' ELSE 'nome' END
    FROM achados a
    LEFT JOIN cpfs  c ON c.d = a.pcpf AND a.pcpf <> ''
    LEFT JOIN nomes n ON n.k = a.pnome
   WHERE c.d IS NOT NULL OR n.k IS NOT NULL
   ORDER BY a.id_sequencial, coalesce(c.d, ''), coalesce(n.k, ''), a.numero_processo;
END $fn$;

REVOKE ALL ON FUNCTION public.rec_processos_do_candidato(text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_processos_do_candidato(text[], text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.rec_processos_do_candidato(text[], text[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Demissão ↔ Vaga
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS demissao_id bigint
    REFERENCES public."SISTEMA_SOLICITACOES_DEMISSAO"(id) ON DELETE SET NULL;
COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".demissao_id IS
  'Substituição: a solicitação de demissão de quem está sendo reposto. Obrigatória em vaga nova de Substituição (trigger rec_vaga_exige_demissao).';

-- Uma demissão abre UMA vaga.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sistema_recrutamento_demissao
  ON public."SISTEMA_RECRUTAMENTO" (demissao_id) WHERE demissao_id IS NOT NULL;

ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ADD COLUMN IF NOT EXISTS vaga_id bigint
    REFERENCES public."SISTEMA_RECRUTAMENTO"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vaga_obrigatoria boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".vaga_id IS
  'A vaga de Substituição aberta para repor esta pessoa. Preenchida pelo trigger da vaga.';
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".vaga_obrigatoria IS
  'Sem a vaga, a demissão não sai de Pendente Analista. False só nas solicitações anteriores a 11/09/2026 (e em exceção decidida por quem administra).';

-- As que já existiam não conhecem a regra.
UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
   SET vaga_obrigatoria = false
 WHERE vaga_obrigatoria AND criado_em < '2026-09-11 13:00:00-03';

-- ── Vaga de Substituição exige a demissão de quem sai ────────────────────
CREATE OR REPLACE FUNCTION public.rec_vaga_exige_demissao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d record;
BEGIN
  -- Só cobra quando o vínculo muda: editar o salário de uma vaga antiga de
  -- Substituição (sem demissão porque nasceu antes da regra) continua livre.
  IF TG_OP = 'UPDATE'
     AND NEW.motivo_vaga IS NOT DISTINCT FROM OLD.motivo_vaga
     AND NEW.substituido_id IS NOT DISTINCT FROM OLD.substituido_id
     AND NEW.demissao_id IS NOT DISTINCT FROM OLD.demissao_id THEN
    RETURN NEW;
  END IF;

  IF btrim(coalesce(NEW.motivo_vaga, '')) <> 'Substituição' THEN
    NEW.demissao_id := NULL;          -- só a substituição carrega o vínculo
    RETURN NEW;
  END IF;

  IF NEW.demissao_id IS NULL THEN
    RAISE EXCEPTION 'Vaga de Substituição precisa da solicitação de demissão de quem vai ser substituído. Solicite a demissão primeiro — a vaga é aberta a partir dela.';
  END IF;

  SELECT id, colaborador_id, colaborador_nome, status INTO d
    FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE id = NEW.demissao_id;
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'A solicitação de demissão #% não existe.', NEW.demissao_id;
  END IF;
  IF d.status = 'Reprovada' THEN
    RAISE EXCEPTION 'A solicitação de demissão #% foi reprovada — não abre vaga de substituição.', NEW.demissao_id;
  END IF;
  IF NEW.substituido_id IS DISTINCT FROM d.colaborador_id THEN
    RAISE EXCEPTION 'A demissão #% é de % — a vaga de substituição tem que repor essa mesma pessoa.', NEW.demissao_id, d.colaborador_nome;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_rec_vaga_exige_demissao ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_rec_vaga_exige_demissao
  BEFORE INSERT OR UPDATE OF motivo_vaga, substituido_id, demissao_id ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_vaga_exige_demissao();

-- ── A vaga criada avisa a demissão ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_vaga_avisa_demissao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.demissao_id IS NOT NULL THEN
    UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
       SET vaga_id = NEW.id
     WHERE id = NEW.demissao_id AND vaga_id IS DISTINCT FROM NEW.id;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.demissao_id IS NOT NULL AND OLD.demissao_id IS DISTINCT FROM NEW.demissao_id THEN
    UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
       SET vaga_id = NULL
     WHERE id = OLD.demissao_id AND vaga_id = NEW.id;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_rec_vaga_avisa_demissao ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_rec_vaga_avisa_demissao
  AFTER INSERT OR UPDATE OF demissao_id ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_vaga_avisa_demissao();

-- ── A demissão não anda sem a vaga ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.demissao_exige_vaga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.vaga_obrigatoria
     AND NEW.vaga_id IS NULL
     AND OLD.status = 'Pendente Analista'
     AND NEW.status NOT IN ('Pendente Analista', 'Reprovada') THEN
    RAISE EXCEPTION 'Esta demissão ainda não tem a vaga de reposição. Quem solicitou precisa abrir a vaga de Substituição de % antes de o pedido seguir.', NEW.colaborador_nome;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_demissao_exige_vaga ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_demissao_exige_vaga
  BEFORE UPDATE OF status ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.demissao_exige_vaga();

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
-- SELECT id, nome, nome_informado FROM public."WA_CURRICULOS" WHERE nome_informado IS NOT NULL;
-- SELECT * FROM public.rec_processos_do_candidato('{}', ARRAY['MARINES RENOSTO OLIVEIRA']);

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_demissao_exige_vaga ON public."SISTEMA_SOLICITACOES_DEMISSAO";
-- DROP FUNCTION IF EXISTS public.demissao_exige_vaga();
-- DROP TRIGGER IF EXISTS trg_rec_vaga_avisa_demissao ON public."SISTEMA_RECRUTAMENTO";
-- DROP FUNCTION IF EXISTS public.rec_vaga_avisa_demissao();
-- DROP TRIGGER IF EXISTS trg_rec_vaga_exige_demissao ON public."SISTEMA_RECRUTAMENTO";
-- DROP FUNCTION IF EXISTS public.rec_vaga_exige_demissao();
-- ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" DROP COLUMN IF EXISTS vaga_obrigatoria, DROP COLUMN IF EXISTS vaga_id;
-- DROP INDEX IF EXISTS public.uq_sistema_recrutamento_demissao;
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP COLUMN IF EXISTS demissao_id;
-- DROP FUNCTION IF EXISTS public.rec_processos_do_candidato(text[], text[]);
-- DROP FUNCTION IF EXISTS public.rec_nome_chave(text);
-- DROP TRIGGER IF EXISTS trg_wa_curriculos_nome_pelo_cpf ON public."WA_CURRICULOS";
-- DROP FUNCTION IF EXISTS public.wa_curriculos_nome_pelo_cpf();
-- DROP FUNCTION IF EXISTS public.rh_nome_oficial_por_cpf(text);
-- UPDATE public."WA_CURRICULOS" SET nome = nome_informado WHERE nome_informado IS NOT NULL;
-- ALTER TABLE public."WA_CURRICULOS" DROP COLUMN IF EXISTS nome_informado;
-- NOTIFY pgrst, 'reload schema';
