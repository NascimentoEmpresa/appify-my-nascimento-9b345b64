-- =====================================================================
-- TREINAMENTOS — Dashboard de vídeos: quem viu, quem concluiu, quantas vezes.
--
-- O QUE FALTAVA
--   O módulo só sabia de CONCLUSÃO ("TREINAMENTO_CONCLUSAO", uma linha por
--   pessoa por treinamento). Quem abriu o vídeo e não terminou não deixava
--   rastro nenhum — então a pergunta "quem assistiu?" não tinha resposta no
--   banco, só a pergunta "quem concluiu?".
--
--   Esta migration acrescenta a metade que faltava: "TREINAMENTO_VISUALIZACAO",
--   com um contador de aberturas por pessoa, e duas RPCs de leitura agregada
--   que alimentam o Dashboard de Vídeos.
--
-- POR QUE CONTADOR, E NÃO UMA LINHA POR ABERTURA
--   As três perguntas do dashboard são "quem viu", "quantas vezes" e "quando
--   foi a última". Um contador por (treinamento, pessoa) responde as três com
--   uma linha por par, enquanto um log de eventos cresceria sem teto para
--   responder o mesmo — e ninguém pediu a série temporal de aberturas. Se um
--   dia pedirem "visualizações por dia", aí sim vira log; hoje seria carregar
--   custo por uma pergunta que não existe.
--
-- ACESSO — NENHUMA TELA NOVA DE PERMISSÃO (foi o pedido explícito)
--   Um menu fantasma a mais, ao lado dos que já existem:
--     `treinamentos_dashboard` (rota NULL)
--   Ele aparece sozinho em Administração › Acesso por Usuário — o painel é
--   data-driven, lê app_modulo/app_menu — e é lá, no toggle por usuário, que
--   se decide quem abre o dashboard. Mesmo padrão de `treinamentos_gerenciar`
--   e de ~25 outros menus de capacidade. Nada de tabela nova, nada de tela de
--   configuração própria.
--
--   A porta é cobrada NO BANCO, não só no botão: as duas RPCs de leitura
--   levantam exceção para quem não tem o código. Esconder o botão é conforto;
--   quem barra é a função.
--
-- O REGISTRO DE VISUALIZAÇÃO SÓ ENTRA PELA RPC
--   "TREINAMENTO_VISUALIZACAO" não tem policy de INSERT nem de UPDATE: a
--   única porta de escrita é `trn_registrar_visualizacao()`, que é
--   SECURITY DEFINER e sempre grava em nome de auth.uid(). Assim ninguém
--   forja visualização de terceiro nem infla o contador de um vídeo que nem
--   enxerga (a função confere o escopo antes de gravar).
--
-- Idempotente.
-- ROLLBACK no fim do arquivo.
-- =====================================================================

-- 1) Menu de capacidade -------------------------------------------------
-- ⚠ O menu é pendurado no MÓDULO DO VIZINHO `treinamentos_gerenciar`, e não
-- num `app_modulo` escrito à mão aqui. Motivo, conferido no banco antes de
-- escrever isto: o módulo `treinamentos` da 20260925000001 NÃO EXISTE MAIS —
-- a 20260930000022 dissolveu ele dentro de `encarregados`, e a Central de
-- Serviços entra pelo menu próprio `central_servicos_treinamentos`. Um INSERT
-- condicionado a `app_modulo.codigo = 'treinamentos'` não insere linha
-- nenhuma, em silêncio, e o botão nunca aparece no painel de acesso.
--
-- Ancorar no vizinho também sobrevive à próxima mudança de casa: se alguém
-- mover os treinamentos de módulo outra vez, esta capacidade vai junto.
--
-- Um código só serve as DUAS portas, igual a `treinamentos_gerenciar`: quem
-- tem o toggle abre o dashboard tanto em Encarregados quanto na Central, e o
-- filtro de módulo dentro do painel é que recorta o conteúdo.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT vizinho.modulo_id, 'treinamentos_dashboard', 'Dashboard de vídeos (quem assistiu)', NULL, 95, true
  FROM public.app_menu vizinho
 WHERE vizinho.codigo = 'treinamentos_gerenciar'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'treinamentos_dashboard')
 LIMIT 1;

-- 2) Helper -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trn_pode_dashboard()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.can_access(auth.uid(), 'treinamentos_dashboard', 'visualizar'::public.app_acao);
$$;
REVOKE ALL ON FUNCTION public.trn_pode_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_pode_dashboard() TO authenticated;

-- 3) A tabela -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."TREINAMENTO_VISUALIZACAO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treinamento_id uuid NOT NULL REFERENCES public."TREINAMENTOS"(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usuario_nome   text,
  -- De qual porta a pessoa abriu na última vez (encarregados / central_servicos).
  -- É o mesmo vocabulário de TREINAMENTOS.escopos, e serve para o dashboard
  -- responder "quantos assistiram pela Central" sem adivinhar pelo perfil.
  escopo         text,
  aberturas      integer NOT NULL DEFAULT 1,
  primeira_em    timestamptz NOT NULL DEFAULT now(),
  ultima_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (treinamento_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trn_visu_treinamento ON public."TREINAMENTO_VISUALIZACAO" (treinamento_id);
CREATE INDEX IF NOT EXISTS idx_trn_visu_user        ON public."TREINAMENTO_VISUALIZACAO" (user_id);

-- Backfill: quem concluiu antes de hoje obviamente assistiu, mas não tem
-- linha de visualização — sem isto o dashboard nasceria dizendo "12
-- conclusões, 0 visualizações", que é falso e faria o número novo parecer
-- quebrado. Uma abertura, datada pela conclusão: é o mínimo que se pode
-- afirmar com honestidade sobre o passado.
INSERT INTO public."TREINAMENTO_VISUALIZACAO"
       (treinamento_id, user_id, usuario_nome, escopo, aberturas, primeira_em, ultima_em)
SELECT c.treinamento_id, c.user_id, c.usuario_nome, NULL, 1, c.concluido_em, c.concluido_em
  FROM public."TREINAMENTO_CONCLUSAO" c
ON CONFLICT (treinamento_id, user_id) DO NOTHING;

-- 4) RLS ----------------------------------------------------------------
ALTER TABLE public."TREINAMENTO_VISUALIZACAO" ENABLE ROW LEVEL SECURITY;

-- Cada um vê o próprio rastro; quem tem o dashboard (ou gerencia os cards)
-- vê o de todos. Escrita não tem policy nenhuma de propósito — a porta é a
-- RPC do bloco 5.
DROP POLICY IF EXISTS trn_visu_select ON public."TREINAMENTO_VISUALIZACAO";
CREATE POLICY trn_visu_select ON public."TREINAMENTO_VISUALIZACAO" FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.trn_pode_dashboard() OR public.trn_pode_gerenciar());

-- 5) Registrar a visualização ------------------------------------------
/**
 * Marca que auth.uid() abriu este treinamento. Primeira vez insere; as
 * seguintes incrementam o contador e carimbam `ultima_em`.
 *
 * A conferência de escopo evita o contador inflado por quem não deveria nem
 * enxergar o card: é a MESMA regra da policy de leitura de TREINAMENTOS
 * (`trn_pode_ver_escopos`), reaproveitada em vez de reescrita.
 */
CREATE OR REPLACE FUNCTION public.trn_registrar_visualizacao(_treinamento uuid, _escopo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_escopos text[];
  v_nome    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  SELECT t.escopos INTO v_escopos FROM public."TREINAMENTOS" t WHERE t.id = _treinamento;
  IF v_escopos IS NULL THEN
    RAISE EXCEPTION 'Treinamento não encontrado.';
  END IF;
  IF NOT public.trn_pode_ver_escopos(v_escopos) THEN
    RAISE EXCEPTION 'Você não tem acesso a este treinamento.';
  END IF;

  -- O nome vem do cadastro, não do cliente: nome enviado pela tela pode vir
  -- vazio (perfil sem display_name) ou adulterado, e é ele que aparece na
  -- lista de "quem assistiu".
  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), p.email)
    INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public."TREINAMENTO_VISUALIZACAO"
         (treinamento_id, user_id, usuario_nome, escopo, aberturas, primeira_em, ultima_em)
  VALUES (_treinamento, auth.uid(), v_nome, _escopo, 1, now(), now())
  ON CONFLICT (treinamento_id, user_id) DO UPDATE
     SET aberturas    = public."TREINAMENTO_VISUALIZACAO".aberturas + 1,
         ultima_em    = now(),
         usuario_nome = COALESCE(EXCLUDED.usuario_nome, public."TREINAMENTO_VISUALIZACAO".usuario_nome),
         escopo       = COALESCE(EXCLUDED.escopo, public."TREINAMENTO_VISUALIZACAO".escopo);
END $$;

REVOKE ALL ON FUNCTION public.trn_registrar_visualizacao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_registrar_visualizacao(uuid, text) TO authenticated;

-- 6) O dashboard, por vídeo --------------------------------------------
/**
 * Uma linha por treinamento: quantas pessoas viram, quantas aberturas ao
 * todo, quantas conclusões e quantos aprovados.
 *
 * `_escopo` NULL = todos os módulos. A agregação é feita no banco porque a
 * alternativa — mandar visualizações e conclusões cruas para a tela somar —
 * cresce com o número de pessoas × vídeos, e é justamente o que a tela não
 * precisa ver para desenhar um número.
 */
CREATE OR REPLACE FUNCTION public.trn_dashboard_videos(_escopo text DEFAULT NULL)
RETURNS TABLE (
  treinamento_id     uuid,
  titulo             text,
  escopos            text[],
  publicado          boolean,
  tem_video          boolean,
  tem_prova          boolean,
  pessoas_viram      bigint,
  visualizacoes      bigint,
  conclusoes         bigint,
  aprovados          bigint,
  nota_media         numeric,
  ultima_atividade   timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.trn_pode_dashboard() THEN
    RAISE EXCEPTION 'Você não tem acesso ao Dashboard de vídeos.';
  END IF;

  RETURN QUERY
  SELECT t.id,
         t.titulo,
         t.escopos,
         t.publicado,
         (COALESCE(btrim(t.video_url), '') <> '' OR COALESCE(btrim(t.video_path), '') <> ''),
         (t.prova IS NOT NULL AND jsonb_typeof(t.prova) = 'array' AND jsonb_array_length(t.prova) > 0),
         COALESCE(v.pessoas, 0),
         COALESCE(v.aberturas, 0),
         COALESCE(c.total, 0),
         COALESCE(c.aprovados, 0),
         c.nota_media,
         GREATEST(v.ultima, c.ultima)
    FROM public."TREINAMENTOS" t
    LEFT JOIN (
      SELECT x.treinamento_id, count(*) AS pessoas, sum(x.aberturas) AS aberturas, max(x.ultima_em) AS ultima
        FROM public."TREINAMENTO_VISUALIZACAO" x GROUP BY x.treinamento_id
    ) v ON v.treinamento_id = t.id
    LEFT JOIN (
      SELECT x.treinamento_id, count(*) AS total,
             count(*) FILTER (WHERE x.aprovado) AS aprovados,
             round(avg(x.prova_nota), 1) AS nota_media,
             max(x.concluido_em) AS ultima
        FROM public."TREINAMENTO_CONCLUSAO" x GROUP BY x.treinamento_id
    ) c ON c.treinamento_id = t.id
   WHERE _escopo IS NULL OR _escopo = ANY(t.escopos)
   ORDER BY t.ordem, t.created_at DESC;
END $$;

REVOKE ALL ON FUNCTION public.trn_dashboard_videos(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_dashboard_videos(text) TO authenticated;

-- 7) O dashboard, por pessoa -------------------------------------------
/**
 * Uma linha por pessoa por treinamento: viu? quantas vezes? concluiu? com
 * que nota?
 *
 * É um FULL JOIN entre visualização e conclusão de propósito. Os dois lados
 * existem sem o outro: quem abriu e não terminou só tem visualização, e quem
 * concluiu antes desta migration (fora do backfill, se alguém apagar a linha)
 * só teria conclusão. Um INNER esconderia exatamente as pessoas que o
 * dashboard existe para mostrar.
 */
CREATE OR REPLACE FUNCTION public.trn_dashboard_pessoas(
  _treinamento uuid DEFAULT NULL,
  _escopo      text DEFAULT NULL
)
RETURNS TABLE (
  treinamento_id uuid,
  titulo         text,
  user_id        uuid,
  usuario_nome   text,
  visualizou     boolean,
  aberturas      integer,
  primeira_em    timestamptz,
  ultima_em      timestamptz,
  concluiu       boolean,
  prova_nota     numeric,
  aprovado       boolean,
  concluido_em   timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.trn_pode_dashboard() THEN
    RAISE EXCEPTION 'Você não tem acesso ao Dashboard de vídeos.';
  END IF;

  RETURN QUERY
  WITH juncao AS (
    SELECT COALESCE(a.treinamento_id, b.treinamento_id)                       AS treinamento_id,
           COALESCE(a.user_id, b.user_id)                                     AS user_id,
           COALESCE(NULLIF(btrim(a.usuario_nome), ''), NULLIF(btrim(b.usuario_nome), '')) AS nome,
           (a.user_id IS NOT NULL)                                            AS visualizou,
           a.aberturas, a.primeira_em, a.ultima_em,
           (b.user_id IS NOT NULL)                                            AS concluiu,
           b.prova_nota, b.aprovado, b.concluido_em
      FROM public."TREINAMENTO_VISUALIZACAO" a
      FULL JOIN public."TREINAMENTO_CONCLUSAO" b
        ON b.treinamento_id = a.treinamento_id AND b.user_id = a.user_id
  )
  SELECT t.id,
         t.titulo,
         j.user_id,
         COALESCE(j.nome, NULLIF(btrim(p.display_name), ''), p.email, '(sem nome)'),
         j.visualizou,
         COALESCE(j.aberturas, 0),
         j.primeira_em,
         j.ultima_em,
         j.concluiu,
         j.prova_nota,
         j.aprovado,
         j.concluido_em
    FROM public."TREINAMENTOS" t
    JOIN juncao j ON j.treinamento_id = t.id
    LEFT JOIN public.profiles p ON p.id = j.user_id
   WHERE (_treinamento IS NULL OR t.id = _treinamento)
     AND (_escopo IS NULL OR _escopo = ANY(t.escopos))
   ORDER BY t.titulo, 4;
END $$;

REVOKE ALL ON FUNCTION public.trn_dashboard_pessoas(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_dashboard_pessoas(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
-- Os menus de treinamento, onde quer que eles morem hoje (ver bloco 1).
SELECT m.codigo AS modulo, x.codigo AS menu, COALESCE(x.rota, '(capacidade)') AS rota, x.ativo
  FROM public.app_menu x JOIN public.app_modulo m ON m.id = x.modulo_id
 WHERE x.codigo IN ('treinamentos_erp', 'treinamentos_gerenciar',
                    'treinamentos_dashboard', 'central_servicos_treinamentos')
 ORDER BY m.codigo, x.ordem;

SELECT count(*) AS visualizacoes_apos_backfill FROM public."TREINAMENTO_VISUALIZACAO";

-- =====================================================================
-- DEPOIS DE RODAR: liberar em Administração › Acesso por Usuário → módulo
-- Treinamentos → "Dashboard de vídeos (quem assistiu)", por usuário. Sem
-- isso o botão não aparece para ninguém (e as RPCs recusam), que é o
-- comportamento desejado: relatório de quem assistiu o quê não é dado de
-- grade pública.
-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.trn_dashboard_pessoas(uuid, text);
--   DROP FUNCTION IF EXISTS public.trn_dashboard_videos(text);
--   DROP FUNCTION IF EXISTS public.trn_registrar_visualizacao(uuid, text);
--   DROP TABLE IF EXISTS public."TREINAMENTO_VISUALIZACAO";
--   DROP FUNCTION IF EXISTS public.trn_pode_dashboard();
--   DELETE FROM public.app_menu WHERE codigo = 'treinamentos_dashboard';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
