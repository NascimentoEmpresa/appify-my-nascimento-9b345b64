-- =========================================================================
-- ANIVERSARIANTES — cartão do Início (/app)
--
-- O QUE ISTO RESOLVE
-- A data de nascimento já existe no cadastro (EMPREGADOS."Nascimento",
-- sincronizada do Senior), mas ninguém enxergava: o aniversário da equipe
-- circulava por grupo de WhatsApp e quem não estava no grupo não sabia. O
-- cartão do Início passa a mostrar quem faz aniversário HOJE e quem faz nos
-- próximos dias, e deixa o colega mandar uma reação (e um recado curto) que
-- aparece na foto do aniversariante durante o dia dele.
--
-- DUAS DECISÕES QUE PARECEM DETALHE E NÃO SÃO
--
--   1. SÓ ENTRA QUEM ESTÁ VINCULADO (EMPREGADOS.auth_user_id IS NOT NULL).
--      A tabela tem 13 mil linhas do Senior inteiro — obra, filial, gente
--      que nunca abriu o ERP. Listar todo mundo transformaria o cartão numa
--      lista telefônica com dezenas de nomes por dia. Vinculado = usa o
--      sistema = é alguém que os colegas do ERP conhecem.
--
--   2. O ANO DE NASCIMENTO NUNCA SAI DAQUI. As RPCs devolvem `dia` e `mes`,
--      nunca a data completa. Idade é dado pessoal e não tem por que
--      trafegar até o navegador de todo mundo só para desenhar um bolo.
--
-- A "Nascimento" é TEXTO (DD/MM/AAAA na prática, mas há linha em branco e
-- linha em ISO vinda de importação antiga). Por isso o parse passa por
-- rh_data_br_para_date(), que devolve NULL no que não casa em vez de
-- estourar a consulta inteira.
--
-- FUSO: a virada do dia é a de São Paulo, não a do servidor (UTC). Sem isso
-- o aniversário "começaria" às 21h do dia anterior para todo mundo.
--
-- Idempotente. Aplicar no banco do app (fwmzeaztjxrxxzxzxmgc).
-- =========================================================================

-- ── 1) Helpers de data ──────────────────────────────────────────────────

-- Texto do cadastro → date. Aceita DD/MM/AAAA (o formato do Senior) e ISO
-- (importações antigas). Qualquer outra coisa vira NULL e a pessoa
-- simplesmente não entra na lista — nunca um erro de consulta.
CREATE OR REPLACE FUNCTION public.rh_data_br_para_date(_txt text)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE
           WHEN _txt ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(_txt, 'DD/MM/YYYY')
           WHEN _txt ~ '^\d{4}-\d{2}-\d{2}'  THEN substr(_txt, 1, 10)::date
           ELSE NULL
         END;
$fn$;

-- O aniversário de _nasc dentro de _ano. Existe por causa de 29/02: quem
-- nasceu em ano bissexto comemora em 28/02 nos anos que não têm dia 29 —
-- make_date(2027, 2, 29) estouraria a consulta inteira.
CREATE OR REPLACE FUNCTION public.rh_aniversario_no_ano(_nasc date, _ano integer)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT make_date(
           _ano,
           extract(month from _nasc)::int,
           LEAST(
             extract(day from _nasc)::int,
             extract(day from (make_date(_ano, extract(month from _nasc)::int, 1)
                               + interval '1 month - 1 day'))::int
           )
         );
$fn$;

-- "Hoje" para efeito de aniversário: sempre o calendário de São Paulo.
CREATE OR REPLACE FUNCTION public.rh_hoje_br()
RETURNS date
LANGUAGE sql STABLE
AS $fn$
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date;
$fn$;

-- ── 2) Mural de felicitações ────────────────────────────────────────────
-- Uma linha por (aniversariante, ano, autor): o colega reage uma vez por
-- aniversário e pode trocar a reação/recado no mesmo dia sem duplicar.
--
-- `reacao` guarda a CHAVE ('festa', 'bolo'…), não o emoji. Emoji no banco é
-- pedir problema de encoding (o coração tem um seletor de variação
-- invisível junto) e amarra a arte da tela a uma migration: trocar o
-- desenho da reação passa a ser mexer no front, não no Postgres.
CREATE TABLE IF NOT EXISTS public."RH_ANIVERSARIO_FELICITACAO" (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aniversariante uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ano            smallint    NOT NULL,
  autor          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reacao         text,
  mensagem       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rh_aniv_felicitacao_reacao_valida
    CHECK (reacao IS NULL OR reacao IN ('festa','bolo','coracao','palmas','brinde')),
  CONSTRAINT rh_aniv_felicitacao_mensagem_tamanho
    CHECK (mensagem IS NULL OR char_length(mensagem) <= 180),
  CONSTRAINT rh_aniv_felicitacao_nao_vazia
    CHECK (reacao IS NOT NULL OR coalesce(btrim(mensagem), '') <> ''),
  CONSTRAINT rh_aniv_felicitacao_nao_e_o_proprio
    CHECK (autor <> aniversariante)
);

COMMENT ON TABLE public."RH_ANIVERSARIO_FELICITACAO" IS
  'Reacoes e recados enviados no aniversario de um colega. Uma linha por (aniversariante, ano, autor).';

CREATE UNIQUE INDEX IF NOT EXISTS rh_aniv_felicitacao_unica_idx
  ON public."RH_ANIVERSARIO_FELICITACAO" (aniversariante, ano, autor);

CREATE INDEX IF NOT EXISTS rh_aniv_felicitacao_ano_idx
  ON public."RH_ANIVERSARIO_FELICITACAO" (ano, aniversariante);

DROP TRIGGER IF EXISTS rh_aniv_felicitacao_touch_trg ON public."RH_ANIVERSARIO_FELICITACAO";
CREATE TRIGGER rh_aniv_felicitacao_touch_trg
  BEFORE UPDATE ON public."RH_ANIVERSARIO_FELICITACAO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3) RLS ──────────────────────────────────────────────────────────────
-- Ler: qualquer autenticado. O mural é coletivo por definição — o recado
-- existe para o aniversariante E para o colega ver que já parabenizou.
-- Escrever: só pela RPC da seção 6, que é quem confere se HOJE é mesmo o
-- aniversário. Sem policy de INSERT/UPDATE, um POST direto no PostgREST
-- deixaria alguém encher o mural de qualquer pessoa em qualquer dia.
-- Apagar o próprio recado, sim: arrependimento não precisa de RPC.
ALTER TABLE public."RH_ANIVERSARIO_FELICITACAO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rh_aniv_felicitacao_select" ON public."RH_ANIVERSARIO_FELICITACAO";
CREATE POLICY "rh_aniv_felicitacao_select" ON public."RH_ANIVERSARIO_FELICITACAO" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rh_aniv_felicitacao_delete" ON public."RH_ANIVERSARIO_FELICITACAO";
CREATE POLICY "rh_aniv_felicitacao_delete" ON public."RH_ANIVERSARIO_FELICITACAO" FOR DELETE TO authenticated USING (autor = auth.uid());

-- ── 4) Quem faz aniversário ─────────────────────────────────────────────
-- SECURITY DEFINER porque a EMPREGADOS é fechada por RLS. Não expõe nada
-- novo: nome, cargo e setor já saem na VW_EMPREGADOS_BASICO. CPF, salário,
-- PIS e o ANO de nascimento continuam fora.
--
-- `dias_ate = 0` é hoje. A ordenação já sai por proximidade — é assim que o
-- cartão desenha sem reordenar nada no navegador.
CREATE OR REPLACE FUNCTION public.rh_aniversariantes(_dias integer DEFAULT 15)
RETURNS TABLE (
  user_id    uuid,
  nome       text,
  avatar_url text,
  cargo      text,
  setor      text,
  dia        integer,
  mes        integer,
  dias_ate   integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH base AS (
    SELECT e.auth_user_id                                   AS user_id,
           btrim(coalesce(nullif(btrim(p.display_name), ''),
                          e."Nome", ''))                    AS nome,
           p.avatar_url                                     AS avatar_url,
           btrim(coalesce(e."Título do Cargo", ''))         AS cargo,
           btrim(coalesce(e."Setor_ERP", ''))               AS setor,
           public.rh_data_br_para_date(e."Nascimento")      AS nasc
      FROM public."EMPREGADOS" e
      JOIN public.profiles p ON p.id = e.auth_user_id
     WHERE e.auth_user_id IS NOT NULL
       AND coalesce(p.ativo, true)
       AND coalesce(e."Situação", '') !~* 'demitid'
       AND public.rh_data_br_para_date(e."Nascimento") IS NOT NULL
  ),
  calc AS (
    SELECT b.*,
           CASE
             WHEN public.rh_aniversario_no_ano(b.nasc, extract(year from public.rh_hoje_br())::int)
                  >= public.rh_hoje_br()
             THEN public.rh_aniversario_no_ano(b.nasc, extract(year from public.rh_hoje_br())::int)
             ELSE public.rh_aniversario_no_ano(b.nasc, extract(year from public.rh_hoje_br())::int + 1)
           END AS proximo
      FROM base b
  )
  SELECT c.user_id,
         c.nome,
         c.avatar_url,
         c.cargo,
         c.setor,
         extract(day   from c.nasc)::int,
         extract(month from c.nasc)::int,
         (c.proximo - public.rh_hoje_br())::int
    FROM calc c
   WHERE c.nome <> ''
     AND (c.proximo - public.rh_hoje_br()) <= GREATEST(coalesce(_dias, 15), 0)
   ORDER BY (c.proximo - public.rh_hoje_br()), c.nome;
$fn$;

REVOKE ALL ON FUNCTION public.rh_aniversariantes(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_aniversariantes(integer) TO authenticated;

-- ── 5) O mural do dia ───────────────────────────────────────────────────
-- Só o que foi enviado para quem faz aniversário HOJE. Recado de ano
-- anterior fica guardado (o histórico é do aniversariante), mas não volta
-- para a tela: o cartão é do dia.
CREATE OR REPLACE FUNCTION public.rh_aniversario_mural()
RETURNS TABLE (
  aniversariante uuid,
  autor          uuid,
  autor_nome     text,
  autor_avatar   text,
  reacao         text,
  mensagem       text,
  criado_em      timestamptz,
  sou_eu         boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT f.aniversariante,
         f.autor,
         btrim(coalesce(nullif(btrim(pa.display_name), ''), pa.email, 'Colega')),
         pa.avatar_url,
         f.reacao,
         f.mensagem,
         f.created_at,
         (f.autor = auth.uid())
    FROM public."RH_ANIVERSARIO_FELICITACAO" f
    JOIN public.profiles pa ON pa.id = f.autor
   WHERE f.ano = extract(year from public.rh_hoje_br())::int
     AND f.aniversariante IN (SELECT a.user_id FROM public.rh_aniversariantes(0) a)
   ORDER BY f.created_at;
$fn$;

REVOKE ALL ON FUNCTION public.rh_aniversario_mural() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_aniversario_mural() TO authenticated;

-- ── 6) Enviar a felicitação ─────────────────────────────────────────────
-- Recebe o estado COMPLETO do que o autor quer deixar (reação + recado) e
-- resolve INSERT/UPDATE/DELETE sozinha. Assim o botão de reação liga e
-- desliga sem apagar um recado que já estava escrito.
--
-- Recusa quando: hoje não é o aniversário da pessoa, o alvo não está na
-- lista (não vinculado / desligado), é o próprio autor, ou a reação não
-- existe. A checagem é aqui e não em policy porque depende do calendário —
-- e o front, sozinho, nunca é barreira.
CREATE OR REPLACE FUNCTION public.rh_aniversario_felicitar(
  _aniversariante uuid,
  _reacao         text DEFAULT NULL,
  _mensagem       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_ano  int  := extract(year from public.rh_hoje_br())::int;
  v_reac text := nullif(btrim(coalesce(_reacao, '')), '');
  v_msg  text := nullif(btrim(coalesce(_mensagem, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado.');
  END IF;

  IF _aniversariante IS NULL OR _aniversariante = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não dá para se parabenizar.');
  END IF;

  IF v_reac IS NOT NULL AND v_reac NOT IN ('festa','bolo','coracao','palmas','brinde') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reação desconhecida.');
  END IF;

  IF v_msg IS NOT NULL AND char_length(v_msg) > 180 THEN
    v_msg := substr(v_msg, 1, 180);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rh_aniversariantes(0) a WHERE a.user_id = _aniversariante) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hoje não é o aniversário dessa pessoa.');
  END IF;

  -- Nada a deixar: some do mural (é o "desmarcar" da tela).
  IF v_reac IS NULL AND v_msg IS NULL THEN
    DELETE FROM public."RH_ANIVERSARIO_FELICITACAO"
     WHERE aniversariante = _aniversariante AND ano = v_ano AND autor = v_uid;
    RETURN jsonb_build_object('ok', true, 'removido', true);
  END IF;

  INSERT INTO public."RH_ANIVERSARIO_FELICITACAO" (aniversariante, ano, autor, reacao, mensagem)
  VALUES (_aniversariante, v_ano, v_uid, v_reac, v_msg)
  ON CONFLICT (aniversariante, ano, autor)
  DO UPDATE SET reacao = EXCLUDED.reacao, mensagem = EXCLUDED.mensagem;

  RETURN jsonb_build_object('ok', true, 'removido', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rh_aniversario_felicitar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_aniversario_felicitar(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.rh_aniversario_felicitar(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.rh_aniversario_mural();
--   DROP FUNCTION IF EXISTS public.rh_aniversariantes(integer);
--   DROP TABLE IF EXISTS public."RH_ANIVERSARIO_FELICITACAO";
--   DROP FUNCTION IF EXISTS public.rh_hoje_br();
--   DROP FUNCTION IF EXISTS public.rh_aniversario_no_ano(date, integer);
--   DROP FUNCTION IF EXISTS public.rh_data_br_para_date(text);
--   NOTIFY pgrst, 'reload schema';
