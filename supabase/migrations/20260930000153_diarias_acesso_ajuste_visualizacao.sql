-- =====================================================================
-- DIÁRIAS — separar as duas portas, devolver para ajuste, excluir e
-- registrar quem visualizou.
--
-- Quatro pedidos do usuário (16/09/2026), todos na mesma família:
--
-- 1) "Nas duas rotas é possível aprovar e reprovar, e não encontrei nada no
--    Gerenciamento de Acesso que faça essa separação entre somente ver,
--    poder criar e poder aprovar."
--
--    O backend JÁ separava: diaria_pode() (20260930000065) nega 'aprovar'
--    pelo menu `encarregados_diarias`, e diaria_guard() só reconhece
--    `operacional_diarias`. O que NÃO existia era a separação no painel de
--    acesso: o toggle da tela grava o pacote inteiro
--    (visualizar/incluir/alterar/aprovar/exportar — ACOES_DO_TOGGLE_PADRAO
--    em ModulosMenusTab.tsx) e não havia switch algum para 'aprovar' nas
--    Diárias, porque nenhum dos dois menus tinha linha em `app_menu_acao`.
--    Resultado prático: era IMPOSSÍVEL dar a um funcionário interno o
--    Operacional de Diárias "só para ver/conferir" — ligar a tela ligava
--    junto o poder de decidir pagamento a pessoa física.
--
--    Correção aqui: as linhas em `app_menu_acao` que fazem a tela desenhar
--    os switches. E do lado do React, ACOES_FORA_DO_TOGGLE tira 'aprovar'
--    do pacote nestes dois menus — quem decide passa a ser o switch próprio,
--    nunca um efeito colateral de ligar a tela.
--
-- 2) "Se reprovar uma diária, ela fica ali parada, não tem opção de
--    excluí-la ou de solicitar um ajuste nela."
--
--    Dois estados novos: 'em_ajuste' (devolvida a quem criou) e 'excluida'
--    (exclusão LÓGICA — é dinheiro pago a pessoa física, apagar a linha
--    apagaria a prova de quem pediu, quem decidiu e por quê).
--
-- 3) "Caso algum usuário tenha alguma diária para ajustar, isso vire uma
--    notificação para o usuário." → o sininho global (public.notificacoes),
--    o mesmo que Atas de Reunião e Malote já usam.
--
-- 4) "Assim que a diária for criada, qualquer usuário que entrar nela,
--    aparecer bem pequeno e embaixo: Visualizada por X em dia - hora."
--    → "DIARIA_VISUALIZACAO", uma linha por pessoa, carimbando a PRIMEIRA
--    abertura.
--
-- E um quinto, menor, que vem junto porque muda a mesma tabela: a chave Pix
-- passa a ter TIPO (celular/email/cpf/cnpj), para o campo saber o que pedir.
--
-- Backend do módulo: 20260930000019 (+ 33/35/36/65/151/152).
-- =====================================================================

-- ── 1) Gerenciamento de Acesso: os switches que faltavam ─────────────
--
-- A tela de acesso só desenha um switch de ação se existir linha aqui
-- (20260910000002 — "fonte da verdade para quais switches a tela deve
-- mostrar"). A regra da tabela é listar só o que é CHECADO de verdade, então
-- entra exatamente o que os gates consultam:
--
--   operacional_diarias/incluir  → diaria_pode('incluir'), na RPC de criação
--   operacional_diarias/aprovar  → diaria_guard(), diaria_aprovar_com_despesa(),
--                                  diaria_solicitar_ajuste() (abaixo)
--   operacional_diarias/excluir  → diaria_excluir() (abaixo)
--   encarregados_diarias/incluir → diaria_pode('incluir')
--
-- 'aprovar' e 'excluir' NÃO entram para `encarregados_diarias` de propósito:
-- decidir e excluir são do Operacional. diaria_pode() já recusa 'aprovar' por
-- aquele menu, e as duas RPCs novas exigem `operacional_diarias` no nome, sem
-- passar por diaria_pode() — assim nem um seed errado em
-- perfil_acesso_permissao consegue dar poder de decisão ao usuário externo.
INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('operacional_diarias',  'incluir'),
  ('operacional_diarias',  'aprovar'),
  ('operacional_diarias',  'excluir'),
  ('encarregados_diarias', 'incluir')
ON CONFLICT DO NOTHING;

-- O perfil "Operacional" já recebeu visualizar/incluir/alterar/aprovar em
-- 20260930000019; falta 'excluir', que é ação nova.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'operacional_diarias', 'excluir'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.nome = 'Operacional' AND pa.ativo = true AND pa.concede_tudo = false
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 2) Colunas e estados novos ───────────────────────────────────────

ALTER TABLE public."DIARIA_SOLICITACAO"
  -- Tipo da chave Pix. Nullable porque as solicitações que já existem foram
  -- gravadas quando o campo era texto livre — inventar um tipo para elas
  -- seria escrever no histórico um dado que ninguém informou.
  ADD COLUMN IF NOT EXISTS pix_tipo              text,
  -- Devolução para ajuste (quem pediu, quando e o que precisa mudar).
  ADD COLUMN IF NOT EXISTS ajuste_motivo         text,
  ADD COLUMN IF NOT EXISTS ajuste_pedido_por     uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS ajuste_pedido_por_nome text,
  ADD COLUMN IF NOT EXISTS ajuste_pedido_em      timestamptz,
  -- Exclusão lógica.
  ADD COLUMN IF NOT EXISTS exclusao_motivo       text,
  ADD COLUMN IF NOT EXISTS excluida_por          uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS excluida_por_nome     text,
  ADD COLUMN IF NOT EXISTS excluida_em           timestamptz;

ALTER TABLE public."DIARIA_SOLICITACAO"
  DROP CONSTRAINT IF EXISTS "DIARIA_SOLICITACAO_pix_tipo_check";
ALTER TABLE public."DIARIA_SOLICITACAO"
  ADD CONSTRAINT "DIARIA_SOLICITACAO_pix_tipo_check"
  CHECK (pix_tipo IS NULL OR pix_tipo IN ('celular','email','cpf','cnpj'));

-- Os dois estados novos. 'paga' continua FORA do banco de propósito: é
-- 'aprovada' com a despesa do Malote paga, derivada na leitura
-- (20260930000151).
ALTER TABLE public."DIARIA_SOLICITACAO"
  DROP CONSTRAINT IF EXISTS "DIARIA_SOLICITACAO_status_check";
ALTER TABLE public."DIARIA_SOLICITACAO"
  ADD CONSTRAINT "DIARIA_SOLICITACAO_status_check"
  CHECK (status IN ('solicitada','em_ajuste','aprovada','reprovada','excluida'));

-- ── 3) "DIARIA_VISUALIZACAO" — quem abriu a solicitação ──────────────
--
-- Chave por (solicitação, pessoa): o pedido é "Visualizada por Fulano em
-- dd/mm - hh:mm", uma linha por pessoa. Guarda a PRIMEIRA abertura — é ela
-- que responde "desde quando o Operacional sabe desta diária"; regravar a
-- cada F5 transformaria o rodapé num relógio e apagaria essa resposta.
--
-- O nome vai gravado junto (como solicitante_nome e decidido_por_nome já
-- fazem): a lista aparece dentro de uma solicitação que pode ser de meses
-- atrás, e ninguém precisa de um JOIN em profiles para desenhar um rodapé.
CREATE TABLE IF NOT EXISTS public."DIARIA_VISUALIZACAO" (
  solicitacao_id uuid        NOT NULL REFERENCES public."DIARIA_SOLICITACAO"(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES auth.users(id),
  user_nome      text,
  visualizada_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (solicitacao_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_diaria_visualizacao_solicitacao
  ON public."DIARIA_VISUALIZACAO"(solicitacao_id, visualizada_em DESC);

ALTER TABLE public."DIARIA_VISUALIZACAO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."DIARIA_VISUALIZACAO" FROM PUBLIC, anon, authenticated;
-- Só SELECT: o carimbo é escrito pela RPC SECURITY DEFINER abaixo, senão
-- qualquer cliente poderia inventar que outra pessoa leu a solicitação.
GRANT SELECT ON public."DIARIA_VISUALIZACAO" TO authenticated;

-- Mesmo desenho de DIARIA_EVENTO: o EXISTS reaplica a policy de SELECT da
-- solicitação-mãe, então quem não enxerga a diária não enxerga quem a leu.
DROP POLICY IF EXISTS diaria_visualizacao_select ON public."DIARIA_VISUALIZACAO";
CREATE POLICY diaria_visualizacao_select ON public."DIARIA_VISUALIZACAO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."DIARIA_SOLICITACAO" s WHERE s.id = solicitacao_id));

-- Registra que o usuário logado abriu a solicitação.
--
-- ON CONFLICT DO NOTHING é o que garante "primeira abertura": a tela chama
-- isto toda vez que o modal abre, e só a primeira chamada grava.
--
-- A condição repete a policy diaria_solicitacao_select à mão porque a função
-- é SECURITY DEFINER (não passa por RLS): sem ela, um POST na mão carimbaria
-- visualização em diária que a pessoa nem pode abrir.
CREATE OR REPLACE FUNCTION public.diaria_registrar_visualizacao(p_solicitacao_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."DIARIA_SOLICITACAO" s
     WHERE s.id = p_solicitacao_id
       AND ( s.solicitante_id = auth.uid()
             OR public.can_access(auth.uid(), 'operacional_diarias', 'visualizar') )
  ) THEN
    RETURN;  -- silencioso: é telemetria de leitura, não uma operação do usuário
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public."DIARIA_VISUALIZACAO" (solicitacao_id, user_id, user_nome)
  VALUES (p_solicitacao_id, auth.uid(), v_nome)
  ON CONFLICT (solicitacao_id, user_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.diaria_registrar_visualizacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_registrar_visualizacao(uuid) TO authenticated;

-- ── 4) A GUC das transições novas ────────────────────────────────────
--
-- Mesmo desenho de diaria_recalculando() (20260930000019) e
-- diaria_desfazendo_aprovacao() (20260930000036): marca de transação, ligada
-- só dentro das RPCs abaixo, que já checaram permissão e estado ANTES de
-- ligá-la. Sem ela, todo UPDATE novo cairia no ramo final de diaria_guard()
-- ("Você não tem permissão para decidir esta solicitação"), que só conhece
-- aprovar/reprovar.
--
-- set_config() vive em pg_catalog e não é exposto pelo PostgREST, então o
-- cliente não liga isto por fora — é a mesma premissa em que as outras duas
-- GUCs já se apoiam desde 20260930000019.
CREATE OR REPLACE FUNCTION public.diaria_em_transicao() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$ SELECT COALESCE(current_setting('diaria.transicao', true), '') = '1' $$;

-- ── 5) diaria_guard() — abre a porta para as transições novas ────────
--
-- Corpo idêntico ao de 20260930000036, com UMA adição: o atalho da GUC, logo
-- abaixo do de diaria_desfazendo_aprovacao(). Todo o resto (o total que não
-- se digita, o solicitante que não muda, o pacote fechado da aprovação, a
-- proibição de redecidir) continua palavra por palavra.
CREATE OR REPLACE FUNCTION public.diaria_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- SIS-2026-0287: apagar a despesa no Malote desfaz a aprovação.
  IF public.diaria_desfazendo_aprovacao() THEN
    RETURN NEW;
  END IF;

  -- Devolver para ajuste, reenviar depois de ajustado e excluir logicamente.
  -- Quem liga esta GUC são as três RPCs abaixo, cada uma com o seu próprio
  -- can_access() e a sua própria checagem de estado.
  IF public.diaria_em_transicao() THEN
    RETURN NEW;
  END IF;

  IF NEW.valor_total_centavos IS DISTINCT FROM OLD.valor_total_centavos
     AND NOT public.diaria_recalculando() THEN
    RAISE EXCEPTION 'O total é calculado pelas diárias, não pode ser digitado.';
  END IF;
  IF NEW.valor_total_centavos IS DISTINCT FROM OLD.valor_total_centavos
     AND public.diaria_recalculando() THEN
    RETURN NEW;
  END IF;
  IF NEW.solicitante_id IS DISTINCT FROM OLD.solicitante_id THEN
    RAISE EXCEPTION 'O solicitante não muda.';
  END IF;
  IF NEW.numero IS DISTINCT FROM OLD.numero THEN
    RAISE EXCEPTION 'O número da solicitação não muda.';
  END IF;

  IF public.can_access(auth.uid(), 'operacional_diarias', 'aprovar') THEN
    IF (to_jsonb(NEW) - ARRAY[
          'status', 'malote_motivo', 'malote_data_pagamento',
          'malote_despesa_id', 'enviado_malote_em',
          'decidido_por', 'decidido_por_nome', 'decidido_em', 'updated_at'
        ]::text[])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY[
          'status', 'malote_motivo', 'malote_data_pagamento',
          'malote_despesa_id', 'enviado_malote_em',
          'decidido_por', 'decidido_por_nome', 'decidido_em', 'updated_at'
        ]::text[]) THEN
      RAISE EXCEPTION 'A aprovação não pode alterar os dados da solicitação.';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status <> 'solicitada' THEN
        RAISE EXCEPTION 'A solicitação já foi % e não pode ser decidida novamente.', OLD.status;
      END IF;
      IF NEW.status NOT IN ('aprovada', 'reprovada') THEN
        RAISE EXCEPTION 'Decisão inválida para a solicitação.';
      END IF;
      IF OLD.solicitante_id = auth.uid() THEN
        RAISE EXCEPTION 'Quem solicitou a diária não pode aprovar ou reprovar a própria solicitação.';
      END IF;
      IF NEW.status = 'aprovada'
         AND (btrim(coalesce(NEW.malote_motivo, '')) = ''
              OR NEW.malote_data_pagamento IS NULL) THEN
        RAISE EXCEPTION 'Nome/motivo e data de pagamento são obrigatórios para aprovar.';
      END IF;
      IF NEW.status = 'aprovada' AND NEW.malote_despesa_id IS NULL THEN
        RAISE EXCEPTION 'A diária só pode ser aprovada pela RPC que cria a despesa do Malote.';
      END IF;
      IF NEW.status = 'reprovada' THEN
        NEW.malote_motivo := NULL;
        NEW.malote_data_pagamento := NULL;
      END IF;
      NEW.decidido_por := auth.uid();
      NEW.decidido_em := now();
      SELECT COALESCE(p.display_name, p.email) INTO NEW.decidido_por_nome
        FROM public.profiles p WHERE p.id = auth.uid();
    ELSIF NEW.malote_motivo IS DISTINCT FROM OLD.malote_motivo
       OR NEW.malote_data_pagamento IS DISTINCT FROM OLD.malote_data_pagamento
       OR NEW.malote_despesa_id IS DISTINCT FROM OLD.malote_despesa_id
       OR NEW.enviado_malote_em IS DISTINCT FROM OLD.enviado_malote_em
       OR NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
       OR NEW.decidido_por_nome IS DISTINCT FROM OLD.decidido_por_nome
       OR NEW.decidido_em IS DISTINCT FROM OLD.decidido_em THEN
      RAISE EXCEPTION 'Os dados da decisão só mudam junto com o status.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Você não tem permissão para decidir esta solicitação.';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['observacoes', 'updated_at']::text[])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['observacoes', 'updated_at']::text[]) THEN
    RAISE EXCEPTION 'Depois de criada, somente a observação da solicitação pode ser corrigida.';
  END IF;
  IF NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
     OR NEW.decidido_por_nome IS DISTINCT FROM OLD.decidido_por_nome
     OR NEW.decidido_em IS DISTINCT FROM OLD.decidido_em
     OR NEW.malote_motivo IS DISTINCT FROM OLD.malote_motivo
     OR NEW.malote_data_pagamento IS DISTINCT FROM OLD.malote_data_pagamento
     OR NEW.malote_despesa_id IS DISTINCT FROM OLD.malote_despesa_id
     OR NEW.enviado_malote_em IS DISTINCT FROM OLD.enviado_malote_em THEN
    RAISE EXCEPTION 'Só quem aprova preenche os dados do Malote.';
  END IF;

  RETURN NEW;
END $$;

-- ── 6) Duplicidade de escala — 'excluida' não ocupa turno ────────────
--
-- Corpo de 20260930000019 com uma palavra a mais: a solicitação excluída
-- entra na mesma regra da reprovada. Ela não vai virar pagamento nenhum, e
-- deixá-la ocupando a escala impediria justamente o relançamento que motivou
-- a exclusão. 'em_ajuste' CONTINUA ocupando: ela vai voltar.
CREATE OR REPLACE FUNCTION public.diaria_linha_valida() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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
     AND o2.status NOT IN ('reprovada', 'excluida')
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
END $$;

-- ── 7) Trilha — os estados novos na DIARIA_EVENTO ────────────────────
--
-- Corpo de 20260930000019 com os três casos novos. A trilha é o único lugar
-- onde "devolvida, corrigida e reenviada três vezes" fica legível depois.
CREATE OR REPLACE FUNCTION public.diaria_evento_auto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."DIARIA_EVENTO" (solicitacao_id, tipo, descricao, autor_id, autor_nome)
    VALUES (NEW.id, 'criada', 'Solicitação registrada.', NEW.solicitante_id, NEW.solicitante_nome);
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public."DIARIA_EVENTO" (solicitacao_id, tipo, descricao, autor_id, autor_nome)
    VALUES (
      NEW.id,
      -- Voltar para 'solicitada' vindo de 'em_ajuste' não é "solicitada de
      -- novo": é o reenvio depois da correção, e a trilha precisa distinguir.
      CASE WHEN OLD.status = 'em_ajuste' AND NEW.status = 'solicitada'
           THEN 'reenviada' ELSE NEW.status END,
      CASE
        WHEN NEW.status = 'aprovada'
          THEN 'Enviada para o Malote: ' || COALESCE(NEW.malote_motivo, '(sem motivo)')
        WHEN NEW.status = 'em_ajuste'
          THEN 'Devolvida para ajuste: ' || COALESCE(NEW.ajuste_motivo, '(sem motivo)')
        WHEN NEW.status = 'excluida'
          THEN 'Excluída: ' || COALESCE(NEW.exclusao_motivo, '(sem motivo)')
        WHEN OLD.status = 'em_ajuste' AND NEW.status = 'solicitada'
          THEN 'Ajustada e reenviada pelo solicitante.'
        ELSE NULL
      END,
      auth.uid(),
      COALESCE(
        CASE WHEN NEW.status = 'em_ajuste' THEN NEW.ajuste_pedido_por_nome
             WHEN NEW.status = 'excluida'  THEN NEW.excluida_por_nome
             ELSE NEW.decidido_por_nome END,
        (SELECT COALESCE(p.display_name, p.email) FROM public.profiles p WHERE p.id = auth.uid())
      )
    );
  END IF;
  RETURN NULL;
END $$;

-- ── 8) Devolver para ajuste ──────────────────────────────────────────
--
-- Quem decide é o Operacional: o gate é can_access('operacional_diarias',
-- 'aprovar') CRU, não diaria_pode(). diaria_pode() existe para as leituras e
-- para a criação, que o encarregado também faz; devolver uma solicitação é
-- decisão, e decisão nunca passa pelo menu de Encarregados.
--
-- De 'solicitada' (a decisão normal) e de 'reprovada' — este segundo caso é
-- exatamente o relato: a reprovada "fica ali parada", e devolver para ajuste
-- é a saída que faltava para ela.
CREATE OR REPLACE FUNCTION public.diaria_solicitar_ajuste(
  p_solicitacao_id uuid,
  p_motivo         text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_s      public."DIARIA_SOLICITACAO"%ROWTYPE;
  v_nome   text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
BEGIN
  IF NOT public.can_access(auth.uid(), 'operacional_diarias', 'aprovar') THEN
    RAISE EXCEPTION 'Você não tem permissão para devolver esta solicitação para ajuste.';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Diga o que precisa ser ajustado — é o que o solicitante vai ler.';
  END IF;

  SELECT * INTO v_s FROM public."DIARIA_SOLICITACAO" WHERE id = p_solicitacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de diária não encontrada.';
  END IF;
  IF v_s.status NOT IN ('solicitada', 'reprovada') THEN
    RAISE EXCEPTION 'Só uma solicitação Solicitada ou Reprovada pode ser devolvida para ajuste (esta está %).', v_s.status;
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  PERFORM set_config('diaria.transicao', '1', true);
  UPDATE public."DIARIA_SOLICITACAO"
     SET status                 = 'em_ajuste',
         ajuste_motivo          = v_motivo,
         ajuste_pedido_por      = auth.uid(),
         ajuste_pedido_por_nome = v_nome,
         ajuste_pedido_em       = now(),
         -- A decisão anterior sai de cena: a solicitação volta a ser um
         -- pedido em aberto, e deixar "reprovada por Fulano" carimbado aqui
         -- faria a tela mostrar duas verdades ao mesmo tempo. Quem reprovou
         -- e quando continua na DIARIA_EVENTO, que é onde isso se lê.
         decidido_por           = NULL,
         decidido_por_nome      = NULL,
         decidido_em            = NULL
   WHERE id = p_solicitacao_id;
  PERFORM set_config('diaria.transicao', '0', true);

  -- O sininho global (public.notificacoes). É o pedido: "caso algum usuário
  -- tenha alguma diária para ajustar, isso vire uma notificação". O link vai
  -- para a rota de Encarregados porque é LÁ que o solicitante ajusta.
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT v_s.solicitante_id,
         'Diária devolvida para ajuste',
         'A solicitação ' || COALESCE(v_s.numero, '') || ' precisa de ajuste: ' || v_motivo,
         'diaria_ajuste',
         '/app/encarregados/diarias?solicitacao=' || p_solicitacao_id::text
   WHERE v_s.solicitante_id IS DISTINCT FROM auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.diaria_solicitar_ajuste(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_solicitar_ajuste(uuid, text) TO authenticated;

-- ── 9) Excluir (logicamente) ─────────────────────────────────────────
--
-- Exclusão LÓGICA, decidida com o solicitante em 16/09/2026. Diária é
-- pagamento a pessoa física: DELETE apagaria junto quem pediu, quem decidiu,
-- quando, e os anexos que sustentam o pagamento. A linha fica, sai da lista
-- padrão (a tela só a mostra quando se filtra por "Excluída") e não ocupa
-- mais a escala.
--
-- 'aprovada' fica de fora: ali já existe despesa no Malote, e sumir com a
-- diária deixaria a despesa órfã. O caminho para desfazer uma aprovação é o
-- "Excluir permanentemente" do Malote, que já devolve a diária para
-- 'solicitada' (20260930000036).
CREATE OR REPLACE FUNCTION public.diaria_excluir(
  p_solicitacao_id uuid,
  p_motivo         text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_s      public."DIARIA_SOLICITACAO"%ROWTYPE;
  v_nome   text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
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
    RAISE EXCEPTION 'Solicitação aprovada já virou despesa no Malote — apague a despesa por lá para liberá-la.';
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
END $$;
REVOKE ALL ON FUNCTION public.diaria_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_excluir(uuid, text) TO authenticated;

-- ── 10) Ajustar e reenviar ───────────────────────────────────────────
--
-- "Somente o usuário que criou a diária poderá ajustá-la e enviar novamente"
-- — daí o `solicitante_id = auth.uid()` ser condição, não sugestão. E só a
-- partir de 'em_ajuste': fora desse estado, a regra antiga vale inteira (o
-- dono só corrige a observação, por diaria_guard()).
--
-- Reescreve a solicitação inteira, contrato e posto inclusive (decisão do
-- solicitante em 16/09/2026). As linhas são apagadas e regravadas em vez de
-- casadas uma a uma: a grade é pequena, e é o DELETE+INSERT que faz a trava
-- de duplicidade rodar contra o conjunto novo inteiro, sem a linha antiga
-- conflitando com a versão corrigida dela mesma.
--
-- A ORDEM importa: o status volta para 'solicitada' ANTES de inserir as
-- linhas, porque diaria_linha_valida() recusa linha em solicitação que não
-- esteja 'solicitada'.
CREATE OR REPLACE FUNCTION public.diaria_editar_solicitacao(p_dados jsonb)
RETURNS TABLE (id uuid, numero text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id       uuid := (p_dados->>'id')::uuid;
  v_s        public."DIARIA_SOLICITACAO"%ROWTYPE;
  v_contrato public.contratos%ROWTYPE;
  v_posto    public.sup_posto%ROWTYPE;
  v_empresa_nome  text;
  v_faltante_id   bigint := NULLIF(p_dados->>'faltante_empregado_id', '')::bigint;
  v_diarista_id   bigint := NULLIF(p_dados->>'diarista_empregado_id', '')::bigint;
  v_faltante_nome text := btrim(coalesce(p_dados->>'faltante_nome', ''));
  v_faltante_cpf  text := btrim(coalesce(p_dados->>'faltante_cpf', ''));
  v_diarista_nome text := btrim(coalesce(p_dados->>'diarista_nome', ''));
  v_diarista_cpf  text := btrim(coalesce(p_dados->>'diarista_cpf', ''));
  v_pix_tipo      text := NULLIF(btrim(coalesce(p_dados->>'pix_tipo', '')), '');
  v_removidos     text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_dados->'anexos_removidos', '[]'::jsonb)));
  n_ponto    int;
  n_doc      int;
BEGIN
  IF NOT public.diaria_pode('incluir') THEN
    RAISE EXCEPTION 'Você não tem permissão para lançar diárias.';
  END IF;

  SELECT * INTO v_s FROM public."DIARIA_SOLICITACAO" WHERE "DIARIA_SOLICITACAO".id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de diária não encontrada.';
  END IF;
  IF v_s.solicitante_id <> auth.uid() THEN
    RAISE EXCEPTION 'Somente quem criou a solicitação pode ajustá-la.';
  END IF;
  IF v_s.status <> 'em_ajuste' THEN
    RAISE EXCEPTION 'Esta solicitação não está aguardando ajuste.';
  END IF;

  IF jsonb_array_length(COALESCE(p_dados->'diarias', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma diária.';
  END IF;

  SELECT * INTO v_contrato
    FROM public.contratos c
   WHERE c.id = (p_dados->>'contrato_id')::uuid
     AND c.status = 'ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato ativo não encontrado.';
  END IF;
  SELECT COALESCE(e.nome_fantasia, e.razao_social) INTO v_empresa_nome
    FROM public.empresas e WHERE e.id = v_contrato.empresa_id;

  SELECT * INTO v_posto
    FROM public.sup_posto p
   WHERE p.id = NULLIF(p_dados->>'posto_id', '')::uuid
     AND p.contrato_id = v_contrato.id
     AND p.ativo = true
     AND p.aprovado = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posto ativo e aprovado não encontrado neste contrato.';
  END IF;

  -- Igual à criação: veio do dropdown, nome e CPF saem de EMPREGADOS aqui no
  -- servidor — o cliente não troca o CPF mantendo o mesmo id.
  IF v_faltante_id IS NOT NULL THEN
    SELECT e."Nome", e."CPF" INTO v_faltante_nome, v_faltante_cpf
      FROM public."EMPREGADOS" e WHERE e."ID" = v_faltante_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Faltante não encontrado em EMPREGADOS.'; END IF;
  END IF;
  IF v_diarista_id IS NOT NULL THEN
    SELECT e."Nome", e."CPF" INTO v_diarista_nome, v_diarista_cpf
      FROM public."EMPREGADOS" e WHERE e."ID" = v_diarista_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Diarista não encontrado em EMPREGADOS.'; END IF;
  END IF;

  IF v_faltante_nome = '' OR length(regexp_replace(v_faltante_cpf, '\D', '', 'g')) <> 11 THEN
    RAISE EXCEPTION 'Informe nome e CPF válido do faltante.';
  END IF;
  IF v_diarista_nome = '' OR length(regexp_replace(v_diarista_cpf, '\D', '', 'g')) <> 11 THEN
    RAISE EXCEPTION 'Informe nome e CPF válido do diarista.';
  END IF;
  IF regexp_replace(v_faltante_cpf, '\D', '', 'g') = regexp_replace(v_diarista_cpf, '\D', '', 'g') THEN
    RAISE EXCEPTION 'Faltante e diarista precisam ser pessoas diferentes.';
  END IF;
  IF btrim(coalesce(p_dados->>'pix', '')) = '' THEN
    RAISE EXCEPTION 'Informe a chave Pix do diarista.';
  END IF;
  IF v_pix_tipo IS NOT NULL AND v_pix_tipo NOT IN ('celular','email','cpf','cnpj') THEN
    RAISE EXCEPTION 'Tipo de chave Pix inválido.';
  END IF;

  -- Anexo novo obedece ao mesmo formato de caminho da criação.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(p_dados->'anexos_novos', '[]'::jsonb)) a
     WHERE coalesce(a->>'categoria', '') NOT IN ('comprovante_ponto', 'documento')
        OR coalesce(a->>'storage_path', '') NOT LIKE
             v_id::text || '/' || (a->>'categoria') || '/%'
        OR coalesce(a->>'nome_arquivo', '') = ''
        OR NOT CASE
             WHEN coalesce(a->>'tamanho_bytes', '') ~ '^[0-9]+$'
             THEN (a->>'tamanho_bytes')::bigint BETWEEN 1 AND 10485760
             ELSE false
           END
  ) THEN
    RAISE EXCEPTION 'Metadados de anexo inválidos.';
  END IF;

  -- ── Escrita ──
  DELETE FROM public."DIARIA_LINHA" l WHERE l.solicitacao_id = v_id;

  DELETE FROM public."DIARIA_ANEXO" a
   WHERE a.solicitacao_id = v_id
     AND a.storage_path = ANY (v_removidos);

  INSERT INTO public."DIARIA_ANEXO" (
    solicitacao_id, categoria, storage_path, nome_arquivo, mime_type, tamanho_bytes
  )
  SELECT v_id, a->>'categoria', a->>'storage_path', a->>'nome_arquivo',
         NULLIF(a->>'mime_type', ''), NULLIF(a->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(COALESCE(p_dados->'anexos_novos', '[]'::jsonb)) a;

  -- A obrigatoriedade vale sobre o resultado FINAL (o que sobrou mais o que
  -- entrou), não sobre o que o cliente mandou — é o que impede "removi o
  -- comprovante e reenviei sem".
  SELECT count(*) FILTER (WHERE a.categoria = 'comprovante_ponto'),
         count(*) FILTER (WHERE a.categoria = 'documento')
    INTO n_ponto, n_doc
    FROM public."DIARIA_ANEXO" a WHERE a.solicitacao_id = v_id;
  IF n_ponto = 0 OR n_doc = 0 THEN
    RAISE EXCEPTION 'Anexe o comprovante do ponto e ao menos um documento.';
  END IF;

  PERFORM set_config('diaria.transicao', '1', true);
  UPDATE public."DIARIA_SOLICITACAO" s
     SET status                 = 'solicitada',
         contrato_id            = v_contrato.id,
         contrato_nome          = v_contrato.nome,
         contrato_cliente       = v_contrato.cliente,
         contrato_empresa       = v_empresa_nome,
         posto_id               = v_posto.id,
         posto_nome             = v_posto.nome,
         faltante_empregado_id  = v_faltante_id,
         faltante_nome          = v_faltante_nome,
         faltante_cpf           = v_faltante_cpf,
         diarista_empregado_id  = v_diarista_id,
         diarista_nome          = v_diarista_nome,
         diarista_cpf           = v_diarista_cpf,
         pix                    = btrim(p_dados->>'pix'),
         pix_tipo               = v_pix_tipo,
         observacoes            = NULLIF(p_dados->>'observacoes', ''),
         -- O pedido de ajuste foi atendido: some do cabeçalho e fica na
         -- trilha (DIARIA_EVENTO), que é onde o histórico se lê.
         ajuste_motivo          = NULL,
         ajuste_pedido_por      = NULL,
         ajuste_pedido_por_nome = NULL,
         ajuste_pedido_em       = NULL
   WHERE s.id = v_id;
  PERFORM set_config('diaria.transicao', '0', true);

  -- Depois do status voltar para 'solicitada': diaria_linha_valida() recusa
  -- linha em solicitação de qualquer outro estado.
  INSERT INTO public."DIARIA_LINHA" (
    solicitacao_id, data, turno, qt_vt, valor_unit_vt_centavos, valor_diaria_centavos
  )
  SELECT v_id, (d->>'data')::date, d->>'turno',
         COALESCE((d->>'qt_vt')::int, 0),
         COALESCE((d->>'valor_unit_vt_centavos')::bigint, 0),
         COALESCE((d->>'valor_diaria_centavos')::bigint, 0)
    FROM jsonb_array_elements(p_dados->'diarias') d;

  RETURN QUERY SELECT v_id, v_s.numero;
END $$;
REVOKE ALL ON FUNCTION public.diaria_editar_solicitacao(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_editar_solicitacao(jsonb) TO authenticated;

-- ── 11) Criação: a chave Pix ganha tipo ──────────────────────────────
--
-- Corpo de 20260930000065 com duas linhas novas (validar e gravar pix_tipo).
-- O resto é palavra por palavra — inclusive o gate diaria_pode('incluir'),
-- que é o que mantém a criação disponível nas DUAS portas.
CREATE OR REPLACE FUNCTION public.diaria_criar_solicitacao(p_dados jsonb)
RETURNS TABLE (id uuid, numero text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id      uuid := COALESCE((p_dados->>'id')::uuid, gen_random_uuid());
  v_numero  text;
  v_nome    text;
  v_empresa_nome text;
  v_contrato public.contratos%ROWTYPE;
  v_posto    public.sup_posto%ROWTYPE;
  v_faltante_id bigint := NULLIF(p_dados->>'faltante_empregado_id', '')::bigint;
  v_diarista_id bigint := NULLIF(p_dados->>'diarista_empregado_id', '')::bigint;
  v_faltante_nome text := btrim(coalesce(p_dados->>'faltante_nome', ''));
  v_faltante_cpf  text := btrim(coalesce(p_dados->>'faltante_cpf', ''));
  v_diarista_nome text := btrim(coalesce(p_dados->>'diarista_nome', ''));
  v_diarista_cpf  text := btrim(coalesce(p_dados->>'diarista_cpf', ''));
  v_pix_tipo      text := NULLIF(btrim(coalesce(p_dados->>'pix_tipo', '')), '');
  n_ponto   int;
  n_doc     int;
BEGIN
  IF NOT public.diaria_pode('incluir') THEN
    RAISE EXCEPTION 'Você não tem permissão para lançar diárias.';
  END IF;

  IF jsonb_array_length(COALESCE(p_dados->'diarias', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma diária.';
  END IF;

  SELECT * INTO v_contrato
    FROM public.contratos c
   WHERE c.id = (p_dados->>'contrato_id')::uuid
     AND c.status = 'ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato ativo não encontrado.';
  END IF;
  SELECT COALESCE(e.nome_fantasia, e.razao_social) INTO v_empresa_nome
    FROM public.empresas e WHERE e.id = v_contrato.empresa_id;

  SELECT * INTO v_posto
    FROM public.sup_posto p
   WHERE p.id = NULLIF(p_dados->>'posto_id', '')::uuid
     AND p.contrato_id = v_contrato.id
     AND p.ativo = true
     AND p.aprovado = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posto ativo e aprovado não encontrado neste contrato.';
  END IF;

  IF v_faltante_id IS NOT NULL THEN
    SELECT e."Nome", e."CPF" INTO v_faltante_nome, v_faltante_cpf
      FROM public."EMPREGADOS" e WHERE e."ID" = v_faltante_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Faltante não encontrado em EMPREGADOS.'; END IF;
  END IF;
  IF v_diarista_id IS NOT NULL THEN
    SELECT e."Nome", e."CPF" INTO v_diarista_nome, v_diarista_cpf
      FROM public."EMPREGADOS" e WHERE e."ID" = v_diarista_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Diarista não encontrado em EMPREGADOS.'; END IF;
  END IF;

  IF v_faltante_nome = '' OR length(regexp_replace(v_faltante_cpf, '\D', '', 'g')) <> 11 THEN
    RAISE EXCEPTION 'Informe nome e CPF válido do faltante.';
  END IF;
  IF v_diarista_nome = '' OR length(regexp_replace(v_diarista_cpf, '\D', '', 'g')) <> 11 THEN
    RAISE EXCEPTION 'Informe nome e CPF válido do diarista.';
  END IF;
  IF regexp_replace(v_faltante_cpf, '\D', '', 'g') = regexp_replace(v_diarista_cpf, '\D', '', 'g') THEN
    RAISE EXCEPTION 'Faltante e diarista precisam ser pessoas diferentes.';
  END IF;
  IF btrim(coalesce(p_dados->>'pix', '')) = '' THEN
    RAISE EXCEPTION 'Informe a chave Pix do diarista.';
  END IF;
  IF v_pix_tipo IS NOT NULL AND v_pix_tipo NOT IN ('celular','email','cpf','cnpj') THEN
    RAISE EXCEPTION 'Tipo de chave Pix inválido.';
  END IF;

  SELECT count(*) FILTER (WHERE a->>'categoria' = 'comprovante_ponto'),
         count(*) FILTER (WHERE a->>'categoria' = 'documento')
    INTO n_ponto, n_doc
    FROM jsonb_array_elements(COALESCE(p_dados->'anexos', '[]'::jsonb)) a;
  IF n_ponto = 0 OR n_doc = 0 THEN
    RAISE EXCEPTION 'Anexe o comprovante do ponto e ao menos um documento.';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(p_dados->'anexos', '[]'::jsonb)) a
     WHERE coalesce(a->>'categoria', '') NOT IN ('comprovante_ponto', 'documento')
        OR coalesce(a->>'storage_path', '') NOT LIKE
             v_id::text || '/' || (a->>'categoria') || '/%'
        OR coalesce(a->>'nome_arquivo', '') = ''
        OR NOT CASE
             WHEN coalesce(a->>'tamanho_bytes', '') ~ '^[0-9]+$'
             THEN (a->>'tamanho_bytes')::bigint BETWEEN 1 AND 10485760
             ELSE false
           END
  ) THEN
    RAISE EXCEPTION 'Metadados de anexo inválidos.';
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public."DIARIA_SOLICITACAO" (
    id, contrato_id, contrato_nome, contrato_cliente, contrato_empresa, posto_id, posto_nome,
    faltante_empregado_id, faltante_nome, faltante_cpf,
    diarista_empregado_id, diarista_nome, diarista_cpf, pix, pix_tipo,
    observacoes, solicitante_id, solicitante_nome
  ) VALUES (
    v_id,
    v_contrato.id, v_contrato.nome, v_contrato.cliente, v_empresa_nome,
    v_posto.id, v_posto.nome,
    v_faltante_id, v_faltante_nome, v_faltante_cpf,
    v_diarista_id, v_diarista_nome, v_diarista_cpf,
    btrim(p_dados->>'pix'), v_pix_tipo,
    NULLIF(p_dados->>'observacoes', ''),
    auth.uid(), v_nome
  )
  RETURNING "DIARIA_SOLICITACAO".numero INTO v_numero;

  INSERT INTO public."DIARIA_LINHA" (
    solicitacao_id, data, turno, qt_vt, valor_unit_vt_centavos, valor_diaria_centavos
  )
  SELECT v_id, (d->>'data')::date, d->>'turno',
         COALESCE((d->>'qt_vt')::int, 0),
         COALESCE((d->>'valor_unit_vt_centavos')::bigint, 0),
         COALESCE((d->>'valor_diaria_centavos')::bigint, 0)
    FROM jsonb_array_elements(p_dados->'diarias') d;

  INSERT INTO public."DIARIA_ANEXO" (
    solicitacao_id, categoria, storage_path, nome_arquivo, mime_type, tamanho_bytes
  )
  SELECT v_id, a->>'categoria', a->>'storage_path', a->>'nome_arquivo',
         NULLIF(a->>'mime_type', ''), NULLIF(a->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(p_dados->'anexos') a;

  RETURN QUERY SELECT v_id, v_numero;
END $$;
REVOKE ALL ON FUNCTION public.diaria_criar_solicitacao(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_criar_solicitacao(jsonb) TO authenticated;

-- ── 12) Policies de escrita do dono durante o ajuste ─────────────────
--
-- As RPCs acima são SECURITY DEFINER e não passam por RLS, mas o STORAGE
-- passa: quem ajusta sobe anexo novo e remove o que trocou, e as policies do
-- bucket já cobrem isso por diaria_pode('incluir') + owner = auth.uid()
-- (20260930000065). Nada a mudar ali.
--
-- Aqui só se amplia o UPDATE da tabela para o estado novo — não porque as
-- RPCs precisem (não precisam), mas para o dono continuar corrigindo a
-- observação de uma solicitação devolvida, que é o caminho que
-- diaria_guard() já permite a ele.
DROP POLICY IF EXISTS diaria_solicitacao_update ON public."DIARIA_SOLICITACAO";
CREATE POLICY diaria_solicitacao_update ON public."DIARIA_SOLICITACAO"
  FOR UPDATE TO authenticated
  USING (
    (solicitante_id = auth.uid() AND status IN ('solicitada', 'em_ajuste'))
    OR public.can_access(auth.uid(), 'operacional_diarias', 'aprovar')
  );

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- -- 1) Funções novas (as policies não dependem delas).
-- DROP FUNCTION IF EXISTS public.diaria_editar_solicitacao(jsonb);
-- DROP FUNCTION IF EXISTS public.diaria_excluir(uuid, text);
-- DROP FUNCTION IF EXISTS public.diaria_solicitar_ajuste(uuid, text);
-- DROP FUNCTION IF EXISTS public.diaria_registrar_visualizacao(uuid);
-- DROP TABLE    IF EXISTS public."DIARIA_VISUALIZACAO";
--
-- -- 2) Voltar as três funções alteradas aos corpos anteriores:
-- --    diaria_guard()        → 20260930000036
-- --    diaria_linha_valida() → 20260930000019
-- --    diaria_evento_auto()  → 20260930000019
-- --    diaria_criar_solicitacao() → 20260930000065
-- DROP FUNCTION IF EXISTS public.diaria_em_transicao();
--
-- -- 3) Estados e colunas. Precisa não haver linha nos estados novos.
-- UPDATE public."DIARIA_SOLICITACAO" SET status = 'reprovada'
--  WHERE status IN ('em_ajuste', 'excluida');
-- ALTER TABLE public."DIARIA_SOLICITACAO"
--   DROP CONSTRAINT IF EXISTS "DIARIA_SOLICITACAO_status_check";
-- ALTER TABLE public."DIARIA_SOLICITACAO"
--   ADD CONSTRAINT "DIARIA_SOLICITACAO_status_check"
--   CHECK (status IN ('solicitada','aprovada','reprovada'));
-- ALTER TABLE public."DIARIA_SOLICITACAO"
--   DROP CONSTRAINT IF EXISTS "DIARIA_SOLICITACAO_pix_tipo_check",
--   DROP COLUMN IF EXISTS pix_tipo,
--   DROP COLUMN IF EXISTS ajuste_motivo,
--   DROP COLUMN IF EXISTS ajuste_pedido_por,
--   DROP COLUMN IF EXISTS ajuste_pedido_por_nome,
--   DROP COLUMN IF EXISTS ajuste_pedido_em,
--   DROP COLUMN IF EXISTS exclusao_motivo,
--   DROP COLUMN IF EXISTS excluida_por,
--   DROP COLUMN IF EXISTS excluida_por_nome,
--   DROP COLUMN IF EXISTS excluida_em;
--
-- -- 4) Policy e switches do painel de acesso.
-- DROP POLICY IF EXISTS diaria_solicitacao_update ON public."DIARIA_SOLICITACAO";
-- CREATE POLICY diaria_solicitacao_update ON public."DIARIA_SOLICITACAO"
--   FOR UPDATE TO authenticated
--   USING ((solicitante_id = auth.uid() AND status = 'solicitada')
--          OR public.can_access(auth.uid(), 'operacional_diarias', 'aprovar'));
-- DELETE FROM public.app_menu_acao
--  WHERE menu_codigo IN ('operacional_diarias', 'encarregados_diarias');
-- DELETE FROM public.perfil_acesso_permissao
--  WHERE menu_codigo = 'operacional_diarias' AND acao = 'excluir';
-- NOTIFY pgrst, 'reload schema';
