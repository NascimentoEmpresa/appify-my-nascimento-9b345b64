-- ============================================================================
-- SIS-2026-0601 (2ª rodada) — diária em status terminal não ocupa mais escala.
--
-- A PR #808 resolveu metade: fez a tela MOSTRAR o status real do Malote
-- (`diaria_malote_status`) e apagou à mão a SD-2026-000078. O que ela não
-- tocou foi a regra que bloqueia o relançamento — e é ela que o usuário
-- esbarra. Resultado: a lista exibe "Cancelada" e o sistema mesmo assim
-- recusa lançar de novo, que é literalmente o "o cancelamento não ficou
-- registrado corretamente" do relato do chamado.
--
-- A duplicidade de escala pulava apenas dois estados ('reprovada',
-- 'excluida'), ambos da PRÓPRIA diária. Só que depois de aprovada o
-- andamento pertence ao Malote: cancelar ou reprovar a despesa lá não muda
-- nada em "DIARIA_SOLICITACAO", que continua 'aprovada' — e 'aprovada' ocupa
-- escala para sempre. O único jeito de soltar era o "Excluir permanentemente"
-- do Malote (20260930000036), que faz DELETE físico da despesa; ou seja, a
-- saída oficial exigia destruir a trilha do Malote. Foi por isso que a
-- despesa deste chamado foi CANCELADA em vez de apagada, e foi por isso que a
-- 078 precisou de migration escrita à mão.
--
-- Levantamento em produção no dia desta migration: 9 solicitações 'aprovada'
-- com despesa terminal sem pagamento (7 'despesa_reprovada' + 2 'cancelada'),
-- cada uma prendendo a escala do seu faltante/diarista em silêncio.
--
-- Esta migration passa a tratar QUATRO estados como "não ocupa escala", que é
-- o combinado com o solicitante:
--   diária 'reprovada'          → nunca virou pagamento
--   diária 'excluida'           → exclusão lógica
--   despesa 'cancelada'         → terminal sem pagamento no Malote
--   despesa 'despesa_reprovada' → terminal sem pagamento no Malote
--
-- NENHUM dado é corrigido aqui de propósito. As 9 destravam sozinhas porque a
-- regra passou a ler o status atual do Malote em vez de um retrato congelado.
-- Nada de DELETE pontual como o da rodada anterior.
-- ============================================================================

-- ── 1) A definição única de "ocupa escala" ───────────────────────────
--
-- Recebe a linha inteira para servir aos dois usos sem consulta a mais: a
-- trigger passa a whole-row reference do JOIN que ela já fez, e o PostgREST a
-- expõe como computed field da "DIARIA_SOLICITACAO".
--
-- SECURITY DEFINER pelo mesmo motivo já documentado em 20261006130000: quem
-- usa o Controle de Diárias não tem, em geral, SELECT direto em
-- malote_despesa. A função devolve um booleano, não expõe a despesa.
CREATE OR REPLACE FUNCTION public.diaria_ocupa_escala(s public."DIARIA_SOLICITACAO")
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT s.status NOT IN ('reprovada', 'excluida')
     AND NOT EXISTS (
           SELECT 1
             FROM public.malote_despesa d
            WHERE d.id = s.malote_despesa_id
              AND d.status IN ('cancelada', 'despesa_reprovada'))
$fn$;

REVOKE ALL ON FUNCTION public.diaria_ocupa_escala(public."DIARIA_SOLICITACAO")
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ocupa_escala(public."DIARIA_SOLICITACAO")
  TO authenticated;

-- ── 2) A barreira de verdade passa a usar a definição ────────────────
--
-- Corpo de 20260930000153 com uma linha trocada: o
-- `o2.status NOT IN ('reprovada','excluida')` vira a chamada do helper. O
-- filtro de data + turno + CPF vem antes no plano, então o custo da chamada
-- por linha candidata é irrelevante.
--
-- Esta trigger é a barreira que importa: o front fala direto com o Supabase
-- pela anon key, então o aviso da tela (avaliarConflitos em
-- src/pages/operacional/diarias.ts) é cortesia, e esta função é a regra.
CREATE OR REPLACE FUNCTION public.diaria_linha_valida() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  s        public."DIARIA_SOLICITACAO"%ROWTYPE;
  conflito record;
BEGIN
  SELECT * INTO s FROM public."DIARIA_SOLICITACAO" WHERE id = NEW.solicitacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de diária não encontrada.';
  END IF;

  IF s.status <> 'solicitada' THEN
    RAISE EXCEPTION 'Solicitação já foi % — não aceita mais diárias.', s.status;
  END IF;

  SELECT o2.numero AS numero, l2.data AS data, l2.turno AS turno,
         (regexp_replace(o2.faltante_cpf, '\D', '', 'g')
            = regexp_replace(s.faltante_cpf, '\D', '', 'g')) AS bate_faltante,
         (regexp_replace(o2.diarista_cpf, '\D', '', 'g')
            = regexp_replace(s.diarista_cpf, '\D', '', 'g')) AS bate_diarista
    INTO conflito
    FROM public."DIARIA_LINHA" l2
    JOIN public."DIARIA_SOLICITACAO" o2 ON o2.id = l2.solicitacao_id
   WHERE l2.id <> NEW.id
     AND l2.data = NEW.data
     AND public.diaria_turnos_conflitam(l2.turno, NEW.turno)
     -- SIS-2026-0601: era `o2.status NOT IN ('reprovada','excluida')`, que
     -- ignorava o Malote e deixava diária cancelada bloqueando relançamento.
     AND public.diaria_ocupa_escala(o2)
     AND (   regexp_replace(o2.faltante_cpf, '\D', '', 'g')
               = regexp_replace(s.faltante_cpf, '\D', '', 'g')
          OR regexp_replace(o2.diarista_cpf, '\D', '', 'g')
               = regexp_replace(s.diarista_cpf, '\D', '', 'g'))
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Duplicidade no %: já existe diária em % (%) na solicitação %.',
      CASE WHEN conflito.bate_faltante AND conflito.bate_diarista THEN 'faltante e diarista'
           WHEN conflito.bate_faltante THEN 'faltante'
           ELSE 'diarista' END,
      to_char(conflito.data, 'DD/MM/YYYY'),
      conflito.turno,
      COALESCE(conflito.numero, '(em edição)');
  END IF;

  RETURN NEW;
END $fn$;

-- ── 3) Dar baixa na diária sem destruir a despesa no Malote ──────────
--
-- Corpo de 20260930000153 com uma recusa afrouxada. A regra antiga era:
--
--   IF v_s.status = 'aprovada' THEN
--     RAISE EXCEPTION 'Solicitação aprovada já virou despesa no Malote —
--                      apague a despesa por lá para liberá-la.';
--
-- O motivo original continua válido — sumir com a diária deixaria a despesa
-- órfã —, mas ele não vale quando a despesa JÁ terminou sem pagamento: aí não
-- há o que orfanar, e mandar o usuário "apagar a despesa por lá" é mandá-lo
-- destruir o registro de uma decisão que o Financeiro tomou de propósito.
--
-- Com o item 2 acima a exclusão nem é mais necessária para destravar a escala
-- (a diária cancelada já parou de bloquear). Isto aqui é o "dar baixa"
-- explícito que o chamado pede: tira a linha da lista de trabalho, grava
-- motivo/autor/data e deixa a trilha legível. Despesa ativa continua barrada.
--
-- A transição 'aprovada' → 'excluida' passa pelo diaria_guard() porque esta
-- RPC liga a GUC diaria.transicao, e o guard (hoje em 20260930000155) devolve
-- NEW logo no começo quando diaria_em_transicao() está ligada.
CREATE OR REPLACE FUNCTION public.diaria_excluir(
  p_solicitacao_id uuid,
  p_motivo         text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_s      public."DIARIA_SOLICITACAO"%ROWTYPE;
  v_nome   text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_malote text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'operacional_diarias', 'excluir') THEN
    RAISE EXCEPTION 'Você não tem permissão para excluir solicitações de diária.';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.';
  END IF;

  SELECT * INTO v_s FROM public."DIARIA_SOLICITACAO" WHERE id = p_solicitacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de diária não encontrada.';
  END IF;
  IF v_s.status = 'excluida' THEN
    RAISE EXCEPTION 'Esta solicitação já está excluída.';
  END IF;

  IF v_s.status = 'aprovada' THEN
    SELECT d.status INTO v_malote
      FROM public.malote_despesa d
     WHERE d.id = v_s.malote_despesa_id;

    IF COALESCE(v_malote, '') NOT IN ('cancelada', 'despesa_reprovada') THEN
      RAISE EXCEPTION
        'Solicitação aprovada com despesa ativa no Malote (%) — cancele ou reprove a despesa por lá antes de excluir a diária.',
        COALESCE(v_malote, 'sem despesa vinculada');
    END IF;
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  PERFORM set_config('diaria.transicao', '1', true);
  UPDATE public."DIARIA_SOLICITACAO"
     SET status            = 'excluida',
         exclusao_motivo   = v_motivo,
         excluida_por      = auth.uid(),
         excluida_por_nome = v_nome,
         excluida_em       = now()
   WHERE id = p_solicitacao_id;
  PERFORM set_config('diaria.transicao', '0', true);

  -- Se a solicitação estava devolvida para ajuste, quem a estava corrigindo
  -- precisa saber que não adianta mais — senão trabalha à toa.
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT v_s.solicitante_id,
         'Diária excluída',
         'A solicitação ' || COALESCE(v_s.numero, '') || ' foi excluída: ' || v_motivo,
         'diaria_ajuste',
         '/app/encarregados/diarias?solicitacao=' || p_solicitacao_id::text
   WHERE v_s.status = 'em_ajuste'
     AND v_s.solicitante_id IS DISTINCT FROM auth.uid();
END $fn$;

REVOKE ALL ON FUNCTION public.diaria_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_excluir(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (executar manualmente)
--
-- Reexecutar, NESTA ordem:
--   1) 20260930000153_diarias_acesso_ajuste_visualizacao.sql
--        repõe diaria_linha_valida() e diaria_excluir() nas versões antigas.
--        Repõe TAMBÉM o diaria_guard() da 153 — por isso a etapa 2.
--   2) 20260930000155_diarias_ufrgs.sql
--        obrigatória logo depois: é ela que tem o diaria_guard() com
--        diaria_decide(), sem o qual a rota espelho do Financeiro volta a
--        mostrar os botões de decisão e o banco recusa o clique.
--   3) DROP FUNCTION IF EXISTS
--        public.diaria_ocupa_escala(public."DIARIA_SOLICITACAO");
--        só DEPOIS da etapa 1: enquanto diaria_linha_valida() ainda chamar
--        esta função, derrubá-la faz todo INSERT em "DIARIA_LINHA" estourar
--        com 'function public.diaria_ocupa_escala(...) does not exist'.
--   4) NOTIFY pgrst, 'reload schema';
--
-- Depois disso diária cancelada no Malote volta a bloquear o relançamento —
-- que é exatamente o bug que esta migration corrige.
-- ============================================================================
