-- =========================================================================
-- CONTROLE DE DIÁRIAS × RELÓGIO DE PONTO (07/10/2026)
--
-- PEDIDO (Pablo): "quando alguém for solicitar uma diária, o sistema tem que
-- verificar se essa pessoa não tem marcação aquele dia — como eu vou pagar
-- uma diarista pra trabalhar no lugar do joãozinho se o joãozinho tem
-- marcação de ponto hoje? Significa que ele foi trabalhar, então não dá."
--
-- DE ONDE VEM O PONTO: espelho."BiMarcacoes" (espelho do MySQL da Hagg),
-- já usado no Espaço do Colaborador (mig 20260930000059). Formato:
--     empresa | matricula  | data_hora (só a DATA) | hora (MINUTO DO DIA)
--     1       | 100006983  | 2026-08-01 00:00:00   | 416   (= 06:56)
-- · `hora` é minuto do dia, não hora: 420 = 07:00. Turno que vira a noite
--   passa de 1440 (1560 = 02:00 do dia seguinte) e continua pertencendo à
--   jornada de data_hora — é ESSA data que conta como "trabalhou no dia".
-- · matricula às vezes vem prefixada pela empresa (100006983 = 1×1e8 + 6983):
--   `matricula % 100000000` = EMPREGADOS."Cadastro", e a empresa entra junto
--   porque "Cadastro" se repete entre filiais.
-- · O faltante é achado pelo CPF gravado na solicitação (todos os vínculos
--   dele em EMPREGADOS — readmitido tem mais de um cadastro).
--
-- A REGRA
--   1) Lançar/ajustar diária: se o faltante tem QUALQUER marcação naquela
--      data, a linha é recusada (trigger em DIARIA_LINHA — barreira de
--      verdade; a tela avisa antes, linha a linha, pela RPC abaixo).
--   2) Aprovar: confere de novo todas as datas. Diária pedida para hoje
--      ainda não tem o ponto sincronizado (o espelho chega até ontem); se na
--      hora de aprovar o ponto do dia já chegou e o faltante bateu, a
--      aprovação é recusada.
--   Sem vínculo/matrícula ou com o espelho fora do ar, não bloqueia (não há
--   como afirmar que trabalhou) — a tela mostra "não verificado".
--
-- Conferência na base em 07/10/2026: das 232 diárias já lançadas, 8 eram
-- para dias em que o faltante bateu ponto (5 aprovadas). Elas ficam como
-- estão; a lista passa a marcá-las.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 0) Índice para "até que dia o ponto está sincronizado" ───────────────
-- O espelho faz TRUNCATE + carga; índice sobrevive ao TRUNCATE.
DO $$
BEGIN
  IF to_regclass('espelho."BiMarcacoes"') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bimarcacoes_data_hora ON espelho."BiMarcacoes" (data_hora)';
  END IF;
END $$;

-- Faltante é achado pelo CPF em dígitos: sem este índice cada consulta varre
-- EMPREGADOS (~40 ms) e a lista, que confere todas as linhas, levaria segundos.
-- A expressão tem que ser IDÊNTICA à das funções abaixo.
CREATE INDEX IF NOT EXISTS idx_empregados_cpf_digitos
  ON public."EMPREGADOS" ((regexp_replace(coalesce("CPF"::text, ''), '\D', '', 'g')));

-- ── 1) Minutos batidos por um CPF numa data (interno) ────────────────────
CREATE OR REPLACE FUNCTION public.diaria_ponto_minutos(p_cpf text, p_data date)
RETURNS int[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_out int[];
BEGIN
  IF length(v_cpf) <> 11 OR p_data IS NULL OR to_regclass('espelho."BiMarcacoes"') IS NULL THEN
    RETURN NULL;
  END IF;
  -- EXECUTE: referência tardia ao espelho (banco de homologação pode não tê-lo).
  EXECUTE $q$
    -- O cast fica num CASE: no ON direto, o planejador pode avaliar o
    -- ::bigint antes do filtro de "só dígitos" e o erro (engolido pelo
    -- EXCEPTION abaixo) faria a checagem passar calada.
    SELECT array_agg(DISTINCT m.hora ORDER BY m.hora)
      FROM (SELECT CASE WHEN btrim(e."Cadastro"::text) ~ '^[0-9]+$' THEN btrim(e."Cadastro"::text)::bigint END AS cad,
                   CASE WHEN btrim(e."Empresa"::text)  ~ '^[0-9]+$' THEN btrim(e."Empresa"::text)::int END AS emp
              FROM public."EMPREGADOS" e
             WHERE regexp_replace(coalesce(e."CPF"::text, ''), '\D', '', 'g') = $1) e
      JOIN espelho."BiMarcacoes" m
        ON (m.matricula % 100000000) = e.cad
       AND m.empresa = e.emp
       AND m.data_hora >= $2 AND m.data_hora < $2 + 1
     WHERE m.hora IS NOT NULL
  $q$ INTO v_out USING v_cpf, p_data;
  RETURN v_out;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;   -- espelho quebrado não pode travar o lançamento
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ponto_minutos(text, date) FROM PUBLIC, anon, authenticated;

-- Último dia com marcação no espelho (NULL = espelho vazio/ausente).
CREATE OR REPLACE FUNCTION public.diaria_ponto_sincronizado_ate()
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v date;
BEGIN
  IF to_regclass('espelho."BiMarcacoes"') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT max(data_hora)::date FROM espelho."BiMarcacoes"' INTO v;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ponto_sincronizado_ate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ponto_sincronizado_ate() TO authenticated;

-- 420 → '07:00'; 1560 → '02:00 (+1d)'.
CREATE OR REPLACE FUNCTION public.diaria_ponto_fmt(p_minutos int[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT string_agg(lpad(((h % 1440) / 60)::text, 2, '0') || ':' || lpad((h % 60)::text, 2, '0')
                    || CASE WHEN h >= 1440 THEN ' (+1d)' ELSE '' END, ', ' ORDER BY h)
    FROM unnest(p_minutos) AS h
$$;

-- ── 2) RPC da tela: o ponto do faltante nas datas digitadas ──────────────
CREATE OR REPLACE FUNCTION public.diaria_ponto_faltante(p_cpf text, p_datas date[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
BEGIN
  IF NOT public.diaria_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Controle de Diárias.' USING ERRCODE = '42501';
  END IF;
  IF to_regclass('espelho."BiMarcacoes"') IS NULL THEN
    RETURN jsonb_build_object('disponivel', false, 'motivo', 'O espelho do relógio de ponto não está no banco.');
  END IF;
  RETURN jsonb_build_object(
    'disponivel', true,
    'sincronizado_ate', public.diaria_ponto_sincronizado_ate(),
    'vinculos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', e."ID", 'nome', e."Nome", 'cadastro', btrim(e."Cadastro"::text),
               'empresa', btrim(e."Empresa"::text), 'situacao', e."Situação") ORDER BY e."ID" DESC)
        FROM public."EMPREGADOS" e
       WHERE length(v_cpf) = 11
         AND regexp_replace(coalesce(e."CPF"::text, ''), '\D', '', 'g') = v_cpf
         AND btrim(e."Cadastro"::text) ~ '^[0-9]+$' AND btrim(e."Empresa"::text) ~ '^[0-9]+$'), '[]'::jsonb),
    'dias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('data', d, 'minutos', to_jsonb(public.diaria_ponto_minutos(v_cpf, d))) ORDER BY d)
        FROM (SELECT DISTINCT d FROM unnest(p_datas) AS d WHERE d IS NOT NULL) x), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ponto_faltante(text, date[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ponto_faltante(text, date[]) TO authenticated;

-- ── 3) RPC da lista: linhas cujo faltante bateu ponto no dia ─────────────
CREATE OR REPLACE FUNCTION public.diaria_ponto_conflitos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.diaria_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Controle de Diárias.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'sincronizado_ate', public.diaria_ponto_sincronizado_ate(),
    'conflitos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('solicitacao_id', x.sid, 'data', x.data, 'minutos', to_jsonb(x.mins)) ORDER BY x.data DESC)
        FROM (
          SELECT s.id AS sid, l.data, public.diaria_ponto_minutos(s.faltante_cpf, l.data) AS mins
            FROM public."DIARIA_LINHA" l
            JOIN public."DIARIA_SOLICITACAO" s ON s.id = l.solicitacao_id
           WHERE s.status NOT IN ('reprovada', 'excluida')
             -- Encarregado vê só as dele (mesma regra da policy de select).
             AND (public.diaria_ve_tudo() OR s.solicitante_id = auth.uid())
        ) x
       WHERE x.mins IS NOT NULL), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ponto_conflitos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ponto_conflitos() TO authenticated;

-- ── 4) Barreira no lançamento/ajuste (DIARIA_LINHA) ──────────────────────
CREATE OR REPLACE FUNCTION public.diaria_linha_ponto_valida()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  s      public."DIARIA_SOLICITACAO"%ROWTYPE;
  v_mins int[];
BEGIN
  SELECT * INTO s FROM public."DIARIA_SOLICITACAO" WHERE id = NEW.solicitacao_id;
  IF NOT FOUND THEN RETURN NEW; END IF;   -- a outra trigger já recusa
  v_mins := public.diaria_ponto_minutos(s.faltante_cpf, NEW.data);
  IF v_mins IS NOT NULL THEN
    RAISE EXCEPTION 'Ponto: % bateu ponto em % (%) — trabalhou nesse dia, então não cabe diária no lugar dele(a).',
      s.faltante_nome, to_char(NEW.data, 'DD/MM/YYYY'), public.diaria_ponto_fmt(v_mins)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS diaria_linha_ponto_trg ON public."DIARIA_LINHA";
CREATE TRIGGER diaria_linha_ponto_trg
  BEFORE INSERT OR UPDATE OF data, solicitacao_id ON public."DIARIA_LINHA"
  FOR EACH ROW EXECUTE FUNCTION public.diaria_linha_ponto_valida();

-- ── 5) Barreira na aprovação (o ponto do dia pode ter chegado depois) ────
CREATE OR REPLACE FUNCTION public.diaria_aprovacao_ponto_valida()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r record;
BEGIN
  IF NEW.status = 'aprovada' AND OLD.status IS DISTINCT FROM 'aprovada' THEN
    SELECT l.data, public.diaria_ponto_minutos(NEW.faltante_cpf, l.data) AS mins
      INTO r
      FROM public."DIARIA_LINHA" l
     WHERE l.solicitacao_id = NEW.id
       AND public.diaria_ponto_minutos(NEW.faltante_cpf, l.data) IS NOT NULL
     ORDER BY l.data
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Ponto: % bateu ponto em % (%) — não dá para aprovar diária no lugar de quem trabalhou. Reprove ou devolva para ajuste.',
        NEW.faltante_nome, to_char(r.data, 'DD/MM/YYYY'), public.diaria_ponto_fmt(r.mins)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS diaria_aprovacao_ponto_trg ON public."DIARIA_SOLICITACAO";
CREATE TRIGGER diaria_aprovacao_ponto_trg
  BEFORE UPDATE OF status ON public."DIARIA_SOLICITACAO"
  FOR EACH ROW EXECUTE FUNCTION public.diaria_aprovacao_ponto_valida();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS diaria_aprovacao_ponto_trg ON public."DIARIA_SOLICITACAO";
-- DROP TRIGGER IF EXISTS diaria_linha_ponto_trg ON public."DIARIA_LINHA";
-- DROP FUNCTION IF EXISTS public.diaria_aprovacao_ponto_valida();
-- DROP FUNCTION IF EXISTS public.diaria_linha_ponto_valida();
-- DROP FUNCTION IF EXISTS public.diaria_ponto_conflitos();
-- DROP FUNCTION IF EXISTS public.diaria_ponto_faltante(text, date[]);
-- DROP FUNCTION IF EXISTS public.diaria_ponto_fmt(int[]);
-- DROP FUNCTION IF EXISTS public.diaria_ponto_sincronizado_ate();
-- DROP FUNCTION IF EXISTS public.diaria_ponto_minutos(text, date);
-- DROP INDEX IF EXISTS espelho.idx_bimarcacoes_data_hora;
-- DROP INDEX IF EXISTS public.idx_empregados_cpf_digitos;
