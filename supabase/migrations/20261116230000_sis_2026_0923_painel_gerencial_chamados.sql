-- =========================================================================
-- SIS-2026-0923 — PRESIDÊNCIA › ACOMPANHAMENTO DE CHAMADOS (painel gerencial)
-- 16/11/2026, pedido do Pablo:
--   "Criar esse novo submódulo onde a presidência e Controladoria podem
--    acompanhar as tarefas e solicitar ações como prioridade, reprovação etc.
--    Quem tiver acesso a essa tela pode acompanhar o chat dela. ... ver todos
--    os chamados, gráficos, informações de rendimento, quem tem mais chamados
--    concluídos, avaliações, quem entrega mais rápido, definir ações como
--    solicitar mais informações, mudar as prioridades, solicitar cancelamento."
--
-- A REGRA QUE GUIA TUDO: a gestão PEDE, Sistemas DECIDE.
--   Nenhuma ação da tela gerencial muda o chamado sozinha. O pedido vai para
--   "CHAMADO_SISTEMA_ACAO_GESTAO" e quem já decide reabertura e transferência
--   (chamado_pode_decidir: Gestor de Sistemas ou Coordenar, mig 20261112190000)
--   aceita ou recusa. Aceito, o efeito sai pelos MESMOS caminhos da tela de
--   chamados: UPDATE com a marca app.chamado_gestao_rpc (que o guard trata como
--   "coordenar"), chamado_normalizar_fila_dev para a fila e os mesmos textos de
--   evento que o chat já traduz ("Prioridade alterada para …", "Chamado
--   cancelado: …", "Chamado reaberto: …").
--   POR QUE não deixar a Presidência mudar a prioridade direto: no código de
--   hoje só Coordenar muda prioridade (guard chamado_sistema_guard) e a
--   Presidência só tem poder sobre os chamados que a coordenação marcou
--   "Enviar à Presidência" (mig 266, aprovar/devolver). Dar poder direto seria
--   regra nova de negócio — fica como pedido analisado por Sistemas.
--
-- O QUE ESTA MIGRATION FAZ
--   1. Menus no módulo Presidência (deny-by-default, com semente):
--        presidencia_chamados_gerencial         — "Acompanhamento de Chamados":
--          ver o painel (o "Ver painel gerencial chamados" do pedido),
--          todos os chamados, indicadores e a conversa de cada um.
--        presidencia_chamados_gerencial_acao    — menu fantasma: pedir ação.
--   2. Tabela "CHAMADO_SISTEMA_ACAO_GESTAO" (os pedidos e as respostas).
--   3. RPCs de leitura para o painel (SECURITY DEFINER, has_screen_access):
--        chamado_gerencial_listar()            — todos os chamados + avaliação
--        chamado_gerencial_conversa(id)        — o chat (sem o interno da equipe)
--        chamado_gerencial_anexos(id)          — nomes dos anexos do chat
--        chamado_gestao_acoes_listar()         — os pedidos, com nomes
--   4. RPCs de escrita: chamado_gestao_acao_solicitar / _cancelar / _decidir.
--   5. chamado_pendencias_gestao ganha o tipo 'acao_gestao' (aviso no Painel
--      de Distribuição, ao lado de reabertura e transferência).
--
-- CONVERSA: SÓ LEITURA PARA A GESTÃO (decisão, SIS-2026-0923)
--   A gestão lê a mesma conversa que o solicitante lê (sem as observações
--   internas da equipe) e NÃO escreve nela. Uma mensagem da Presidência no
--   meio do chat do solicitante confundiria quem está sendo atendido ("é uma
--   ordem? preciso responder?"). Para falar com Sistemas existe o pedido
--   "Solicitar informações / atualização", que fica registrado e respondido.
--   As RLS de CHAMADO_SISTEMA_EVENTO/ANEXO não mudam: a leitura é por RPC, e
--   o painel não aparece na lista "quem viu" do chat.
--
-- Idempotente. Aplica sozinha no merge para a main (cluster_pos_merge.yml).
-- =========================================================================

-- ── 1. Menus ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'presidencia_chamados_gerencial', 'Acompanhamento de Chamados',
       '/app/presidencia/acompanhamento-chamados', 42, true
  FROM public.app_modulo m WHERE m.codigo = 'presidencia'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'presidencia_chamados_gerencial_acao', 'Acompanhamento de Chamados · Pode solicitar ação',
       NULL, 43, true
  FROM public.app_modulo m WHERE m.codigo = 'presidencia'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, ativo = true;

-- ── 1b. Semente (tela nova nasce sem ninguém) ───────────────────────────
-- Ver o painel: quem já valida chamados na Presidência (mig 266) e quem já vê
-- o Monitoramento de Chamados (mig 20261022000180 — que por sua vez foi
-- semeado de quem enxerga todos os chamados: Painel/Dashboard/Coordenar).
-- Pedir ação: SÓ quem já decide chamados na Presidência
-- (presidencia_chamados_dev_validar). Controladoria e demais diretores entram
-- liberados um a um em Acesso por Usuário — não há código de menu que
-- identifique "a Controladoria" sem abrir para o setor inteiro.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, x.menu, 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso_permissao pp
  CROSS JOIN LATERAL (
    SELECT 'presidencia_chamados_gerencial'::text AS menu
    UNION ALL
    SELECT 'presidencia_chamados_gerencial_acao' WHERE pp.menu_codigo = 'presidencia_chamados_dev_validar'
  ) x
 WHERE pp.menu_codigo IN ('presidencia_chamados_dev', 'presidencia_chamados_dev_validar',
                          'central_servicos_chamados_monitoramento')
   AND pp.acao = 'visualizar' AND pp.allow
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao y
                    WHERE y.perfil_id = pp.perfil_id AND y.menu_codigo = x.menu AND y.acao = 'visualizar');

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, x.menu, 'visualizar'::public.app_acao, true,
       'Migração 20261116230000 (SIS-2026-0923): já validava chamados na Presidência ou via o Monitoramento de Chamados'
  FROM public.screen_permission_user s
  CROSS JOIN LATERAL (
    SELECT 'presidencia_chamados_gerencial'::text AS menu
    UNION ALL
    SELECT 'presidencia_chamados_gerencial_acao' WHERE s.menu_codigo = 'presidencia_chamados_dev_validar'
  ) x
 WHERE s.menu_codigo IN ('presidencia_chamados_dev', 'presidencia_chamados_dev_validar',
                         'central_servicos_chamados_monitoramento')
   AND s.acao = 'visualizar' AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user y
                    WHERE y.user_id = s.user_id AND y.menu_codigo = x.menu AND y.acao = 'visualizar');

-- ── 2. Tabela dos pedidos ────────────────────────────────────────────────
-- tipo (espelho: TIPOS_ACAO_GESTAO em src/lib/chamados/painelGerencial.ts):
--   prioridade   — mudar a prioridade (valor_solicitado = alta|media|baixa)
--   ordem_fila   — mudar a posição na fila do responsável (valor = nº)
--   cancelamento — cancelar o chamado (só ativo)
--   revisao      — reprovar a entrega e devolver ao desenvolvimento (só concluído)
--   informacoes  — pedir informação/atualização a Sistemas (sem efeito no chamado)
-- status: pendente → aceita | recusada (Sistemas) | cancelada (quem pediu desistiu)
CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_ACAO_GESTAO" (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chamado_id       uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  tipo             text NOT NULL
                     CHECK (tipo IN ('prioridade', 'ordem_fila', 'cancelamento', 'revisao', 'informacoes')),
  justificativa    text NOT NULL CHECK (length(btrim(justificativa)) >= 10),
  -- Foto do chamado no pedido, para a resposta saber de onde partiu.
  valor_atual      text,
  valor_solicitado text,
  status_chamado   text,
  responsavel_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  solicitado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente', 'aceita', 'recusada', 'cancelada')),
  resposta         text,
  decidido_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_em      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public."CHAMADO_SISTEMA_ACAO_GESTAO" IS
  'SIS-2026-0923: pedidos da Presidência/Controladoria sobre um chamado (prioridade, fila, cancelamento, revisão, informações). Sistemas aceita ou recusa; só a aceitação muda o chamado. Escrita só pelas RPCs chamado_gestao_acao_*.';

CREATE INDEX IF NOT EXISTS idx_chamado_acao_gestao_chamado
  ON public."CHAMADO_SISTEMA_ACAO_GESTAO"(chamado_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chamado_acao_gestao_pendente
  ON public."CHAMADO_SISTEMA_ACAO_GESTAO"(created_at) WHERE status = 'pendente';
-- Um pedido pendente por chamado e tipo: o segundo clique não duplica.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chamado_acao_gestao_pendente
  ON public."CHAMADO_SISTEMA_ACAO_GESTAO"(chamado_id, tipo) WHERE status = 'pendente';
-- FK sem índice varre a tabela em todo JOIN e em toda exclusão de usuário.
CREATE INDEX IF NOT EXISTS chamado_sistema_acao_gestao_solicitado_por_idx ON public."CHAMADO_SISTEMA_ACAO_GESTAO" (solicitado_por);
CREATE INDEX IF NOT EXISTS chamado_sistema_acao_gestao_responsavel_id_idx ON public."CHAMADO_SISTEMA_ACAO_GESTAO" (responsavel_id);
CREATE INDEX IF NOT EXISTS chamado_sistema_acao_gestao_decidido_por_idx ON public."CHAMADO_SISTEMA_ACAO_GESTAO" (decidido_por);

-- ── 3. Quem vê / quem pede ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_gerencial_pode_ver()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.has_screen_access(auth.uid(), 'presidencia_chamados_gerencial', 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'presidencia_chamados_gerencial_acao', 'visualizar'::public.app_acao));
$$;
REVOKE ALL ON FUNCTION public.chamado_gerencial_pode_ver() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gerencial_pode_ver() TO authenticated;

CREATE OR REPLACE FUNCTION public.chamado_gerencial_pode_pedir()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_screen_access(auth.uid(), 'presidencia_chamados_gerencial_acao', 'visualizar'::public.app_acao);
$$;
REVOKE ALL ON FUNCTION public.chamado_gerencial_pode_pedir() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gerencial_pode_pedir() TO authenticated;

-- ── 4. RLS: leitura só; escrita só pelas RPCs ────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA_ACAO_GESTAO" ENABLE ROW LEVEL SECURITY;

-- Lê: o painel gerencial, quem decide (Sistemas) e o dev responsável pelo
-- chamado (o pedido é sobre a fila dele). O solicitante NÃO: é conversa da
-- gestão com Sistemas; o que muda no chamado ele vê no chat.
DROP POLICY IF EXISTS chamado_acao_gestao_select ON public."CHAMADO_SISTEMA_ACAO_GESTAO";
CREATE POLICY chamado_acao_gestao_select ON public."CHAMADO_SISTEMA_ACAO_GESTAO" FOR SELECT TO authenticated
  USING ((SELECT public.chamado_gerencial_pode_ver())
         OR (SELECT public.chamado_pode_decidir())
         OR EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c
                     WHERE c.id = "CHAMADO_SISTEMA_ACAO_GESTAO".chamado_id
                       AND c.responsavel_id = (SELECT auth.uid())));

REVOKE ALL ON public."CHAMADO_SISTEMA_ACAO_GESTAO" FROM PUBLIC, anon;
GRANT SELECT ON public."CHAMADO_SISTEMA_ACAO_GESTAO" TO authenticated;

-- ── 5. Leitura do painel ─────────────────────────────────────────────────
-- Todos os chamados (inclusive encerrados) com o que o painel precisa para os
-- indicadores. A nota da avaliação é a média ponderada de types.tsx
-- (CRITERIOS_AVALIACAO); avaliação antiga, só com estrelas, usa as estrelas.
CREATE OR REPLACE FUNCTION public.chamado_gerencial_listar()
RETURNS TABLE(
  id uuid, numero text, assunto text, descricao text, prioridade text, status text,
  setor text, solicitante_id uuid, solicitante_nome text,
  responsavel_id uuid, responsavel_nome text, posicao_dev integer,
  modulo_sistema text, modulo_sistema_outro text,
  created_at timestamptz, concluido_em timestamptz, cancelado_em timestamptz,
  conclusao_confirmada_em timestamptz, concluido_sem_retorno boolean, gestao_finalizada_em timestamptz,
  desenvolvimento_iniciado_em timestamptz, prazo_conclusao_em timestamptz, prazo_solicitante date,
  concluido_no_prazo boolean, horas_gastas numeric,
  etapa_validacao text, avaliacao_nota numeric, avaliacao_comentario text,
  acoes_pendentes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.chamado_gerencial_pode_ver() THEN
    RAISE EXCEPTION 'Sem acesso ao Acompanhamento de Chamados.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.numero::text, c.assunto::text, c.descricao::text, c.prioridade::text, c.status::text,
         c.setor::text, c.solicitante_id, COALESCE(ps.display_name, c.solicitante_nome)::text,
         c.responsavel_id, pr.display_name::text, c.posicao_dev::integer,
         c.modulo_sistema::text, c.modulo_sistema_outro::text,
         c.created_at, c.concluido_em, c.cancelado_em,
         c.conclusao_confirmada_em, COALESCE(c.concluido_sem_retorno, false), c.gestao_finalizada_em,
         c.desenvolvimento_iniciado_em, c.prazo_conclusao_em, c.prazo_solicitante::date,
         c.concluido_no_prazo, c.horas_gastas::numeric,
         v.etapa::text,
         CASE WHEN a.id IS NULL THEN NULL
              ELSE round(COALESCE(
                     a.qualidade * 0.30 + a.prazo * 0.20 + a.comunicacao * 0.15
                     + a.clareza * 0.10 + a.facilidade * 0.10 + a.satisfacao * 0.15,
                     a.estrelas)::numeric, 2) END,
         a.comentario::text,
         (SELECT count(*)::integer FROM public."CHAMADO_SISTEMA_ACAO_GESTAO" g
           WHERE g.chamado_id = c.id AND g.status = 'pendente')
    FROM public."CHAMADO_SISTEMA" c
    LEFT JOIN public.profiles ps ON ps.id = c.solicitante_id
    LEFT JOIN public.profiles pr ON pr.id = c.responsavel_id
    LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
    LEFT JOIN public."CHAMADO_SISTEMA_AVALIACAO" a ON a.chamado_id = c.id
   ORDER BY c.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_gerencial_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gerencial_listar() TO authenticated;

-- A conversa como o solicitante a vê: sem 'observacao_interna'. Mensagem
-- apagada volta sem o texto (o conteúdo antigo é auditoria da equipe).
CREATE OR REPLACE FUNCTION public.chamado_gerencial_conversa(p_chamado_id uuid)
RETURNS TABLE(id uuid, chamado_id uuid, autor_id uuid, autor_nome text, tipo text, texto text,
              meta jsonb, created_at timestamptz, editado_em timestamptz,
              apagado_em timestamptz, apagado_por uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.chamado_gerencial_pode_ver() THEN
    RAISE EXCEPTION 'Sem acesso ao Acompanhamento de Chamados.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.id, e.chamado_id, e.autor_id, p.display_name::text, e.tipo::text,
         CASE WHEN e.apagado_em IS NOT NULL THEN NULL ELSE e.texto END::text,
         e.meta::jsonb, e.created_at, e.editado_em, e.apagado_em, e.apagado_por
    FROM public."CHAMADO_SISTEMA_EVENTO" e
    LEFT JOIN public.profiles p ON p.id = e.autor_id
   WHERE e.chamado_id = p_chamado_id
     AND e.tipo <> 'observacao_interna'
   ORDER BY e.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_gerencial_conversa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gerencial_conversa(uuid) TO authenticated;

-- Só o nome dos anexos (o arquivo continua atrás da policy do bucket, que
-- segue a visibilidade normal do chamado). Anexo de mensagem interna fica fora.
CREATE OR REPLACE FUNCTION public.chamado_gerencial_anexos(p_chamado_id uuid)
RETURNS TABLE(id uuid, evento_id uuid, nome_arquivo text, mime_type text, tamanho_bytes bigint, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.chamado_gerencial_pode_ver() THEN
    RAISE EXCEPTION 'Sem acesso ao Acompanhamento de Chamados.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT an.id, an.evento_id, an.nome_arquivo::text, an.mime_type::text, an.tamanho_bytes::bigint, an.created_at
    FROM public."CHAMADO_SISTEMA_ANEXO" an
    LEFT JOIN public."CHAMADO_SISTEMA_EVENTO" e ON e.id = an.evento_id
   WHERE an.chamado_id = p_chamado_id
     AND COALESCE(an.campo, '') <> 'interno'
     AND COALESCE(e.tipo, '') <> 'observacao_interna'
   ORDER BY an.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_gerencial_anexos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gerencial_anexos(uuid) TO authenticated;

-- Os pedidos com nomes e o chamado. Painel gerencial e quem decide.
CREATE OR REPLACE FUNCTION public.chamado_gestao_acoes_listar()
RETURNS TABLE(id bigint, chamado_id uuid, numero text, assunto text, setor text, prioridade text,
              status_chamado_atual text, tipo text, justificativa text, valor_atual text, valor_solicitado text,
              status_chamado text, responsavel_id uuid, responsavel_nome text,
              solicitado_por uuid, solicitado_por_nome text, status text, resposta text,
              decidido_por uuid, decidido_por_nome text, decidido_em timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.chamado_gerencial_pode_ver() OR public.chamado_pode_decidir()) THEN
    RAISE EXCEPTION 'Sem acesso às solicitações da gestão.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT g.id, g.chamado_id, c.numero::text, c.assunto::text, c.setor::text, c.prioridade::text,
         c.status::text, g.tipo, g.justificativa, g.valor_atual, g.valor_solicitado,
         g.status_chamado, g.responsavel_id, pr.display_name::text,
         g.solicitado_por, ps.display_name::text, g.status, g.resposta,
         g.decidido_por, pd.display_name::text, g.decidido_em, g.created_at
    FROM public."CHAMADO_SISTEMA_ACAO_GESTAO" g
    JOIN public."CHAMADO_SISTEMA" c ON c.id = g.chamado_id
    LEFT JOIN public.profiles pr ON pr.id = g.responsavel_id
    LEFT JOIN public.profiles ps ON ps.id = g.solicitado_por
    LEFT JOIN public.profiles pd ON pd.id = g.decidido_por
   ORDER BY (g.status = 'pendente') DESC, g.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_gestao_acoes_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gestao_acoes_listar() TO authenticated;

-- Pedidos PENDENTES de um chamado, com o nome de quem pediu: o card nas
-- telas Coordenar/Executar. Mesma regra de leitura da policy acima (o dev
-- responsável vê os pedidos sobre a fila dele); para os outros volta vazio.
CREATE OR REPLACE FUNCTION public.chamado_gestao_acoes_pendentes(p_chamado_id uuid)
RETURNS TABLE(id bigint, chamado_id uuid, tipo text, justificativa text, valor_atual text, valor_solicitado text,
              solicitado_por uuid, solicitado_por_nome text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT g.id, g.chamado_id, g.tipo, g.justificativa, g.valor_atual, g.valor_solicitado,
         g.solicitado_por, p.display_name::text, g.created_at
    FROM public."CHAMADO_SISTEMA_ACAO_GESTAO" g
    JOIN public."CHAMADO_SISTEMA" c ON c.id = g.chamado_id
    LEFT JOIN public.profiles p ON p.id = g.solicitado_por
   WHERE g.chamado_id = p_chamado_id
     AND g.status = 'pendente'
     AND (public.chamado_gerencial_pode_ver() OR public.chamado_pode_decidir()
          OR c.responsavel_id = auth.uid())
   ORDER BY g.created_at;
$$;
REVOKE ALL ON FUNCTION public.chamado_gestao_acoes_pendentes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gestao_acoes_pendentes(uuid) TO authenticated;

-- ── 6. A gestão pede ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_gestao_acao_solicitar(
  p_chamado_id uuid, p_tipo text, p_justificativa text,
  p_prioridade text DEFAULT NULL, p_posicao integer DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  c         record;
  v_id      bigint;
  v_just    text := btrim(COALESCE(p_justificativa, ''));
  v_atual   text;
  v_valor   text;
  v_rotulo  text;
  v_resumo  text;
  v_fila    integer;
  v_ativo   boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chamado_gerencial_pode_pedir() THEN
    RAISE EXCEPTION 'Sem permissão para solicitar ações sobre chamados.' USING ERRCODE = '42501';
  END IF;
  IF length(v_just) < 10 THEN
    RAISE EXCEPTION 'Escreva a justificativa com pelo menos 10 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT ch.id, ch.numero, ch.assunto, ch.status, ch.prioridade, ch.responsavel_id, ch.posicao_dev INTO c
    FROM public."CHAMADO_SISTEMA" ch WHERE ch.id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  v_ativo := c.status NOT IN ('concluido', 'reprovado', 'cancelado');

  CASE p_tipo
    WHEN 'prioridade' THEN
      IF NOT v_ativo THEN
        RAISE EXCEPTION 'Chamado encerrado — a prioridade não muda mais.' USING ERRCODE = '22023';
      END IF;
      IF p_prioridade IS NULL OR p_prioridade NOT IN ('alta', 'media', 'baixa') THEN
        RAISE EXCEPTION 'Escolha a nova prioridade.' USING ERRCODE = '22023';
      END IF;
      IF p_prioridade = c.prioridade THEN
        RAISE EXCEPTION 'O chamado já está com essa prioridade.' USING ERRCODE = '22023';
      END IF;
      v_atual := c.prioridade; v_valor := p_prioridade;
      v_rotulo := 'mudar a prioridade';
      v_resumo := 'prioridade ' || c.prioridade || ' → ' || p_prioridade;
    WHEN 'ordem_fila' THEN
      IF NOT v_ativo OR c.responsavel_id IS NULL OR c.posicao_dev IS NULL THEN
        RAISE EXCEPTION 'Só chamado na fila de um desenvolvedor tem posição para mudar.' USING ERRCODE = '22023';
      END IF;
      SELECT count(*)::integer INTO v_fila FROM public."CHAMADO_SISTEMA"
       WHERE responsavel_id = c.responsavel_id AND status NOT IN ('concluido', 'reprovado', 'cancelado');
      IF p_posicao IS NULL OR p_posicao < 1 OR p_posicao > v_fila THEN
        RAISE EXCEPTION 'Escolha uma posição entre 1 e % (tamanho da fila do responsável).', v_fila USING ERRCODE = '22023';
      END IF;
      IF p_posicao = c.posicao_dev THEN
        RAISE EXCEPTION 'O chamado já está nessa posição.' USING ERRCODE = '22023';
      END IF;
      v_atual := c.posicao_dev::text; v_valor := p_posicao::text;
      v_rotulo := 'mudar a posição na fila';
      v_resumo := c.posicao_dev || 'º → ' || p_posicao || 'º na fila';
    WHEN 'cancelamento' THEN
      IF NOT v_ativo THEN
        RAISE EXCEPTION 'Chamado já encerrado — não há o que cancelar.' USING ERRCODE = '22023';
      END IF;
      v_rotulo := 'cancelar o chamado'; v_resumo := 'cancelamento';
    WHEN 'revisao' THEN
      IF c.status <> 'concluido' THEN
        RAISE EXCEPTION 'Só a entrega de um chamado concluído pode ser reprovada para revisão.' USING ERRCODE = '22023';
      END IF;
      v_rotulo := 'reprovar a entrega e devolver ao desenvolvimento'; v_resumo := 'revisão da entrega';
    WHEN 'informacoes' THEN
      v_rotulo := 'receber informações/atualização'; v_resumo := 'pedido de informações';
    ELSE
      RAISE EXCEPTION 'Tipo de ação desconhecido: %', p_tipo USING ERRCODE = '22023';
  END CASE;

  IF EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_ACAO_GESTAO"
              WHERE chamado_id = p_chamado_id AND tipo = p_tipo AND status = 'pendente') THEN
    RAISE EXCEPTION 'Já existe um pedido igual aguardando Sistemas neste chamado.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_ACAO_GESTAO"
    (chamado_id, tipo, justificativa, valor_atual, valor_solicitado, status_chamado, responsavel_id, solicitado_por)
  VALUES (p_chamado_id, p_tipo, v_just, v_atual, v_valor, c.status, c.responsavel_id, auth.uid())
  RETURNING id INTO v_id;

  -- Interno: é a gestão falando com a equipe. O solicitante só vê o efeito,
  -- se Sistemas aceitar.
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'observacao_interna',
          'Pedido da gestão (' || v_resumo || '): ' || v_just || ' (aguardando Sistemas)',
          jsonb_build_object('origem', 'acao_gestao', 'acao', 'acao_gestao_solicitada', 'acao_gestao_id', v_id, 'tipo', p_tipo));

  PERFORM public.chamado_avisar_decisores(
    'Pedido da gestão — chamado #' || c.numero,
    left(c.assunto, 120) || ' — pediram para ' || v_rotulo || '. Aceite ou recuse.',
    'chamado_acao_gestao', '/app/sistemas/chamados/' || p_chamado_id || '/coordenar');
  PERFORM public.chamado_avisar_usuario(c.responsavel_id,
    'Pedido da gestão — chamado #' || c.numero,
    left(c.assunto, 120) || ' — pediram para ' || v_rotulo || ' (Sistemas vai analisar).',
    'chamado_acao_gestao', '/app/sistemas/chamados/' || p_chamado_id);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_gestao_acao_solicitar(uuid, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gestao_acao_solicitar(uuid, text, text, text, integer) TO authenticated;

-- Quem pediu desiste enquanto está pendente.
CREATE OR REPLACE FUNCTION public.chamado_gestao_acao_cancelar(p_acao_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  g record;
BEGIN
  SELECT * INTO g FROM public."CHAMADO_SISTEMA_ACAO_GESTAO" WHERE id = p_acao_id FOR UPDATE;
  IF NOT FOUND OR g.status <> 'pendente' THEN
    RAISE EXCEPTION 'Não há pedido pendente para cancelar.' USING ERRCODE = '22023';
  END IF;
  IF g.solicitado_por IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Só quem fez o pedido pode desistir dele.' USING ERRCODE = '42501';
  END IF;
  UPDATE public."CHAMADO_SISTEMA_ACAO_GESTAO"
     SET status = 'cancelada', decidido_por = auth.uid(), decidido_em = now()
   WHERE id = g.id;
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (g.chamado_id, auth.uid(), 'observacao_interna', 'Pedido da gestão retirado por quem pediu',
          jsonb_build_object('origem', 'acao_gestao', 'acao', 'acao_gestao_cancelada', 'acao_gestao_id', g.id));
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_gestao_acao_cancelar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gestao_acao_cancelar(bigint) TO authenticated;

-- ── 7. Sistemas decide ───────────────────────────────────────────────────
-- Recusar: resposta obrigatória (≥ 5). Informações: aceitar = responder, e a
-- resposta também é obrigatória. Aceitar os demais aplica o efeito.
CREATE OR REPLACE FUNCTION public.chamado_gestao_acao_decidir(
  p_acao_id bigint, p_aceitar boolean, p_resposta text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  g          record;
  c          record;
  v_resp     text := NULLIF(btrim(COALESCE(p_resposta, '')), '');
  v_ordem    uuid[];
  v_destino  integer;
  v_label    text;
  v_status   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chamado_pode_decidir() THEN
    RAISE EXCEPTION 'Só o Gestor de Sistemas (ou quem coordena chamados) responde aos pedidos da gestão.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO g FROM public."CHAMADO_SISTEMA_ACAO_GESTAO" WHERE id = p_acao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF g.status <> 'pendente' THEN
    RAISE EXCEPTION 'Este pedido já foi respondido.' USING ERRCODE = '22023';
  END IF;
  SELECT ch.id, ch.numero, ch.assunto, ch.status, ch.prioridade, ch.responsavel_id, ch.posicao_dev, ch.solicitante_id INTO c
    FROM public."CHAMADO_SISTEMA" ch WHERE ch.id = g.chamado_id FOR UPDATE;

  IF (NOT p_aceitar OR g.tipo = 'informacoes') AND (v_resp IS NULL OR length(v_resp) < 5) THEN
    RAISE EXCEPTION '%', CASE WHEN p_aceitar THEN 'Escreva a resposta para a gestão.'
                              ELSE 'Informe o motivo para recusar o pedido.' END
      USING ERRCODE = '22023';
  END IF;

  IF NOT p_aceitar THEN
    UPDATE public."CHAMADO_SISTEMA_ACAO_GESTAO"
       SET status = 'recusada', resposta = v_resp, decidido_por = auth.uid(), decidido_em = now()
     WHERE id = g.id;
    INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
    VALUES (c.id, auth.uid(), 'observacao_interna', 'Pedido da gestão recusado por Sistemas: ' || v_resp,
            jsonb_build_object('origem', 'acao_gestao', 'acao', 'acao_gestao_recusada', 'acao_gestao_id', g.id, 'tipo', g.tipo));
    PERFORM public.chamado_avisar_usuario(g.solicitado_por,
      'Pedido recusado — chamado #' || c.numero, v_resp,
      'chamado_acao_gestao', '/app/presidencia/acompanhamento-chamados?aba=acoes');
    RETURN 'recusada';
  END IF;

  -- Aceitar: o chamado pode ter mudado desde o pedido — confere de novo.
  PERFORM set_config('app.chamado_gestao_rpc', 'on', true);
  CASE g.tipo
    WHEN 'prioridade' THEN
      IF c.status IN ('concluido', 'reprovado', 'cancelado') THEN
        RAISE EXCEPTION 'Chamado encerrado depois do pedido — recuse explicando.' USING ERRCODE = '22023';
      END IF;
      IF c.prioridade IS DISTINCT FROM g.valor_solicitado THEN
        UPDATE public."CHAMADO_SISTEMA" SET prioridade = g.valor_solicitado WHERE id = c.id;
        v_label := CASE g.valor_solicitado WHEN 'alta' THEN 'Alta' WHEN 'media' THEN 'Média' ELSE 'Baixa' END;
        -- Mesmo texto do Coordenar/Painel — o chat já traduz.
        INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
        VALUES (c.id, auth.uid(), 'evento', 'Prioridade alterada para ' || v_label,
                jsonb_build_object('origem', 'acao_gestao', 'acao_gestao_id', g.id));
      END IF;

    WHEN 'ordem_fila' THEN
      IF c.status IN ('concluido', 'reprovado', 'cancelado') OR c.responsavel_id IS NULL THEN
        RAISE EXCEPTION 'O chamado saiu da fila depois do pedido — recuse explicando.' USING ERRCODE = '22023';
      END IF;
      -- Mesma mecânica de chamado_reordenar_fila_dev: monta a fila atual na
      -- ordem, tira o chamado e o recoloca na posição pedida (limitada ao
      -- tamanho da fila de agora), grava e normaliza.
      SELECT array_agg(x.id ORDER BY x.posicao_dev NULLS LAST, x.created_at, x.id) INTO v_ordem
        FROM public."CHAMADO_SISTEMA" x
       WHERE x.responsavel_id = c.responsavel_id
         AND x.status NOT IN ('concluido', 'reprovado', 'cancelado')
         AND x.id <> c.id;
      v_ordem := COALESCE(v_ordem, ARRAY[]::uuid[]);
      v_destino := LEAST(GREATEST(g.valor_solicitado::integer, 1), cardinality(v_ordem) + 1);
      v_ordem := v_ordem[1:v_destino - 1] || c.id || v_ordem[v_destino:cardinality(v_ordem)];
      UPDATE public."CHAMADO_SISTEMA" x
         SET posicao_dev = o.ord
        FROM (SELECT unnest(v_ordem) AS id, generate_subscripts(v_ordem, 1) AS ord) o
       WHERE x.id = o.id AND x.posicao_dev IS DISTINCT FROM o.ord;
      PERFORM public.chamado_normalizar_fila_dev(c.responsavel_id);
      INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
      VALUES (c.id, auth.uid(), 'evento',
              format('Posição na fila do responsável alterada para %sº', v_destino),
              jsonb_build_object('origem', 'acao_gestao', 'acao_gestao_id', g.id,
                                 'de', c.posicao_dev, 'para', v_destino));

    WHEN 'cancelamento' THEN
      IF c.status IN ('concluido', 'reprovado', 'cancelado') THEN
        RAISE EXCEPTION 'Chamado já encerrado — recuse explicando.' USING ERRCODE = '22023';
      END IF;
      UPDATE public."CHAMADO_SISTEMA"
         SET status = 'cancelado', motivo_cancelamento = 'A pedido da gestão: ' || g.justificativa
       WHERE id = c.id;
      IF c.responsavel_id IS NOT NULL THEN
        PERFORM public.chamado_normalizar_fila_dev(c.responsavel_id);
      END IF;
      INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
      VALUES (c.id, auth.uid(), 'evento', 'Chamado cancelado: a pedido da gestão — ' || g.justificativa,
              jsonb_build_object('origem', 'acao_gestao', 'acao_gestao_id', g.id));
      PERFORM public.chamado_avisar_usuario(c.solicitante_id,
        'Chamado #' || c.numero || ' cancelado', 'A pedido da gestão: ' || left(g.justificativa, 200),
        'chamado_acao_gestao', '/app/central-servicos/chamados/' || c.id || '/acompanhar');

    WHEN 'revisao' THEN
      IF c.status <> 'concluido' THEN
        RAISE EXCEPTION 'O chamado não está mais concluído — recuse explicando.' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_REABERTURA"
                  WHERE chamado_id = c.id AND status = 'pendente') THEN
        RAISE EXCEPTION 'O solicitante também pediu reabertura — decida a reabertura primeiro.' USING ERRCODE = '22023';
      END IF;
      -- Volta ao desenvolvimento com o mesmo dev (sem dev: volta à triagem).
      -- NÃO grava "Chamado reaberto: …" de propósito: esse texto é contado
      -- (LIKE 'Chamado reaberto%') no Monitoramento de Chamados — que mede a
      -- qualidade do pedido do SOLICITANTE — e na bonificação/parecer da I.A.
      -- A revisão pedida pela gestão não é falha do solicitante, e decidir se
      -- ela pesa na bonificação do dev é regra de negócio que o pedido não
      -- trouxe. Texto próprio; se for para contar, basta ajustar o LIKE lá.
      v_status := CASE WHEN c.responsavel_id IS NULL THEN 'aberto' ELSE 'em_andamento' END;
      UPDATE public."CHAMADO_SISTEMA" SET status = v_status WHERE id = c.id;
      IF c.responsavel_id IS NOT NULL THEN
        PERFORM public.chamado_normalizar_fila_dev(c.responsavel_id);
      END IF;
      INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
      VALUES (c.id, auth.uid(), 'evento',
              'Entrega devolvida para revisão a pedido da gestão: ' || g.justificativa,
              jsonb_build_object('acao', 'revisao_gestao', 'origem', 'acao_gestao', 'acao_gestao_id', g.id));
      PERFORM public.chamado_avisar_usuario(c.responsavel_id,
        'Chamado #' || c.numero || ' voltou para revisão', left(g.justificativa, 200),
        'chamado_acao_gestao', '/app/sistemas/chamados/' || c.id);

    WHEN 'informacoes' THEN
      NULL;  -- sem efeito no chamado; a resposta é o que importa
  END CASE;
  PERFORM set_config('app.chamado_gestao_rpc', 'off', true);

  UPDATE public."CHAMADO_SISTEMA_ACAO_GESTAO"
     SET status = 'aceita', resposta = v_resp, decidido_por = auth.uid(), decidido_em = now()
   WHERE id = g.id;
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (c.id, auth.uid(), 'observacao_interna',
          CASE WHEN g.tipo = 'informacoes' THEN 'Resposta de Sistemas à gestão: ' || v_resp
               ELSE 'Pedido da gestão aceito por Sistemas' || COALESCE(': ' || v_resp, '') END,
          jsonb_build_object('origem', 'acao_gestao', 'acao', 'acao_gestao_aceita', 'acao_gestao_id', g.id, 'tipo', g.tipo));
  PERFORM public.chamado_avisar_usuario(g.solicitado_por,
    CASE WHEN g.tipo = 'informacoes' THEN 'Sistemas respondeu — chamado #' ELSE 'Pedido aceito — chamado #' END || c.numero,
    COALESCE(v_resp, left(c.assunto, 120)),
    'chamado_acao_gestao', '/app/presidencia/acompanhamento-chamados?aba=acoes');
  RETURN 'aceita';
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_gestao_acao_decidir(bigint, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gestao_acao_decidir(bigint, boolean, text) TO authenticated;

-- ── 8. Aviso no Painel de Distribuição ───────────────────────────────────
-- Corpo da mig 20261112190000 + os pedidos da gestão. Mesma assinatura: o
-- front antigo só não reconhece o tipo novo (mostra como transferência).
CREATE OR REPLACE FUNCTION public.chamado_pendencias_gestao()
RETURNS TABLE(tipo text, pedido_id bigint, chamado_id uuid, numero text, assunto text,
              solicitado_por uuid, motivo text, para_responsavel uuid, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT x.* FROM (
    SELECT 'reabertura'::text, r.id, c.id, c.numero::text, c.assunto::text,
           r.solicitado_por, r.motivo, NULL::uuid, r.created_at
      FROM public."CHAMADO_SISTEMA_REABERTURA" r
      JOIN public."CHAMADO_SISTEMA" c ON c.id = r.chamado_id
     WHERE r.status = 'pendente'
    UNION ALL
    SELECT 'transferencia'::text, t.id, c.id, c.numero::text, c.assunto::text,
           t.solicitado_por, t.motivo, t.para_responsavel, t.created_at
      FROM public."CHAMADO_SISTEMA_TRANSFERENCIA" t
      JOIN public."CHAMADO_SISTEMA" c ON c.id = t.chamado_id
     WHERE t.status = 'pendente'
    UNION ALL
    SELECT 'acao_gestao'::text, g.id, c.id, c.numero::text, c.assunto::text,
           g.solicitado_por, g.justificativa, NULL::uuid, g.created_at
      FROM public."CHAMADO_SISTEMA_ACAO_GESTAO" g
      JOIN public."CHAMADO_SISTEMA" c ON c.id = g.chamado_id
     WHERE g.status = 'pendente'
  ) x
  WHERE public.chamado_pode_decidir()
  ORDER BY 9;
$$;
REVOKE ALL ON FUNCTION public.chamado_pendencias_gestao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_pendencias_gestao() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (manual)
-- =========================================================================
-- Reaplicar chamado_pendencias_gestao da mig 20261112190000.
-- DROP FUNCTION IF EXISTS public.chamado_gestao_acao_decidir(bigint, boolean, text);
-- DROP FUNCTION IF EXISTS public.chamado_gestao_acao_cancelar(bigint);
-- DROP FUNCTION IF EXISTS public.chamado_gestao_acao_solicitar(uuid, text, text, text, integer);
-- DROP FUNCTION IF EXISTS public.chamado_gestao_acoes_pendentes(uuid);
-- DROP FUNCTION IF EXISTS public.chamado_gestao_acoes_listar();
-- DROP FUNCTION IF EXISTS public.chamado_gerencial_anexos(uuid);
-- DROP FUNCTION IF EXISTS public.chamado_gerencial_conversa(uuid);
-- DROP FUNCTION IF EXISTS public.chamado_gerencial_listar();
-- DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_ACAO_GESTAO";
-- DROP FUNCTION IF EXISTS public.chamado_gerencial_pode_pedir();
-- DROP FUNCTION IF EXISTS public.chamado_gerencial_pode_ver();
-- DELETE FROM public.screen_permission_user WHERE menu_codigo IN ('presidencia_chamados_gerencial', 'presidencia_chamados_gerencial_acao');
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('presidencia_chamados_gerencial', 'presidencia_chamados_gerencial_acao');
-- DELETE FROM public.app_menu WHERE codigo IN ('presidencia_chamados_gerencial', 'presidencia_chamados_gerencial_acao');
-- NOTIFY pgrst, 'reload schema';
