-- =========================================================================
-- Recrutamento: "APROVA VAGAS" no Operacional e em Licitações (02/10/2026)
--
-- Pedido do Pablo: "no gerenciamento de acesso do operacional tenha APROVA
-- VAGAS — se estiver flegado, pode aprovar as vagas pelo Gestão Recrutamento
-- do Operacional também. E mesma coisa em Licitações: se estiver flegado
-- pode aprovar; desmarcado não aprova, nem aparece o botão."
--
-- Até aqui a etapa 1 da vaga ("Pendente Analista" — na tela agora
-- "Pendente Operacional", só o rótulo) era decidida por quem tinha
-- 'aprovar'/'alterar' na TELA licitacoes_analistas_recrutamento (mig 232), e
-- o Operacional só acompanhava (escopo "operacional", leitura pura, desde
-- 02/09/2026).
--
-- Agora quem decide é uma capacidade própria, um menu fantasma por módulo
-- (rota NULL, ação 'aprovar' — mesmo mecanismo da mig 264):
--   • operacional_aprova_vagas  (Operacional › APROVA VAGAS)  — nasce vazio;
--   • licitacoes_aprova_vagas   (Licitações  › APROVA VAGAS)  — semeado com
--     quem já aprovava pela tela de Licitações (aprovar ou alterar), para
--     ninguém perder o botão no dia da troca.
--
-- A trava mora no banco, em três lugares que precisam concordar:
--   1. rec_guard_aprovador_setor: sair de "Pendente Analista" (aprovar ou
--      reprovar) exige uma das duas capacidades;
--   2. sistema_recrutamento_guard: quem tem a capacidade mas não é "gestor"
--      (caso do Operacional) pode, numa vaga em "Pendente Analista", mexer
--      SÓ em status + carimbo de quem aprovou + motivo da reprovação;
--   3. RLS sistema_recrutamento_update: o WITH CHECK aceita as duas.
-- O histórico (rec_historico_automatico) passa a carimbar "Aprovada pelo
-- Operacional" quando quem aprovou tem só a capacidade do Operacional.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── As capacidades ───────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, 'APROVA VAGAS', NULL, x.ordem, true
  FROM (VALUES ('operacional', 'operacional_aprova_vagas', 21),
               ('licitacoes',  'licitacoes_aprova_vagas',  281)) AS x(modulo, codigo, ordem)
  JOIN public.app_modulo m ON m.codigo = x.modulo
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('operacional_aprova_vagas', 'aprovar'::app_acao),
       ('licitacoes_aprova_vagas',  'aprovar'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- Quem já aprovava pela tela de Licitações continua aprovando.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'licitacoes_aprova_vagas', 'aprovar'::app_acao, true,
       'Migração 20260930000287: já aprovava vagas em Licitações › Analistas Validações'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'licitacoes_analistas_recrutamento' AND s.allow
   AND s.acao IN ('aprovar'::app_acao, 'alterar'::app_acao)
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'licitacoes_aprova_vagas'
                      AND x.acao = 'aprovar'::app_acao);

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT p.perfil_id, 'licitacoes_aprova_vagas', 'aprovar'::app_acao, true
  FROM public.perfil_acesso_permissao p
 WHERE p.menu_codigo = 'licitacoes_analistas_recrutamento' AND p.allow
   AND p.acao IN ('aprovar'::app_acao, 'alterar'::app_acao)
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao x
                    WHERE x.perfil_id = p.perfil_id AND x.menu_codigo = 'licitacoes_aprova_vagas'
                      AND x.acao = 'aprovar'::app_acao);

-- ── Quem aprova a etapa 1 ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_aprova_vagas(_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT public.has_screen_access(_uid, 'licitacoes_aprova_vagas', 'aprovar'::app_acao)
      OR public.has_screen_access(_uid, 'operacional_aprova_vagas', 'aprovar'::app_acao);
$fn$;
REVOKE ALL ON FUNCTION public.rec_aprova_vagas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_aprova_vagas(uuid) TO authenticated;

-- 1) A trava da etapa (substitui a regra da mig 232) ----------------------
CREATE OR REPLACE FUNCTION public.rec_guard_aprovador_setor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = 'Pendente Diretoria'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.aprova_setor(OLD.setor) THEN
    RAISE EXCEPTION 'Você não aprova vagas do setor "%". Peça ao administrador para marcar o setor em Acesso por Usuário.', coalesce(OLD.setor, '—')
      USING ERRCODE = '42501';
  END IF;
  -- 02/10/2026 (mig 287): a etapa 1 é de quem tem "APROVA VAGAS" — no
  -- Operacional ou em Licitações. Antes (mig 232) era o 'aprovar'/'alterar'
  -- da tela de Licitações.
  IF OLD.status = 'Pendente Analista'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('Pendente Diretoria', 'Cancelada')
     AND NOT public.rec_aprova_vagas(auth.uid()) THEN
    RAISE EXCEPTION 'Você não tem "APROVA VAGAS". Peça ao administrador para marcar em Acesso por Usuário (Operacional ou Licitações).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.rec_guard_aprovador_setor() FROM PUBLIC, anon;

-- 2) O gatilho de colunas deixa o aprovador decidir (e só isso) ------------
CREATE OR REPLACE FUNCTION public.sistema_recrutamento_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gestor  boolean;
  v_dias    integer;
  v_livre   jsonb;
  v_ult     jsonb;
  v_msg     text := 'A vaga precisa de no mínimo 7 dias úteis entre hoje e a data de início prevista.';
BEGIN
  IF btrim(coalesce(NEW.motivo_vaga, '')) = 'Expansão' THEN
    NEW.motivo_vaga := 'Expansão (Aumento de Quadro)';
  END IF;

  IF public.rec_cargo_exige_cnh(NEW.cargo) THEN
    NEW.cnh_obrigatoria := true;
    IF upper(translate(coalesce(NEW.req_obrigatorios, ''),
         'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
         'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
       !~ '(CNH|CARTEIRA DE (MOTORISTA|HABILITA))' THEN
      NEW.req_obrigatorios := btrim(concat(
        'CNH obrigatória (categoria compatível com a função).',
        CASE WHEN btrim(coalesce(NEW.req_obrigatorios, '')) = '' THEN '' ELSE E'\n' || NEW.req_obrigatorios END));
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.cnh_obrigatoria := COALESCE(NEW.cnh_obrigatoria, false);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF public.rec_data_prevista(NEW.data_inicio_prevista) IS NOT NULL THEN
      v_dias := public.dias_uteis_entre(current_date, public.rec_data_prevista(NEW.data_inicio_prevista));
      IF v_dias < 7 THEN
        RAISE EXCEPTION '% A data escolhida tem % dia(s) útil(eis).', v_msg, v_dias;
      END IF;
      NEW.grau_urgencia := public.rec_grau_por_data(NEW.data_inicio_prevista);
    END IF;
    NEW.data_inicio_alteracoes := COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb);
    RETURN NEW;
  END IF;

  -- Quem decide sobre a vaga. São as MESMAS portas que a RLS reconhece
  -- (sistema_recrutamento_gate e sistema_recrutamento_operacional) — manter
  -- as duas listas iguais é o que impede a RLS liberar e o gatilho recusar,
  -- que foi exatamente o defeito corrigido quando esta função nasceu.
  --
  -- 02/09/2026: entrou `licitacoes_analistas_recrutamento` e SAIU
  -- `operacional_recrutamento`. A etapa 1 mudou de dono; o Operacional
  -- acompanha, e acompanhar não escreve.
  v_gestor := has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
           OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir')
           OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar')
           OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar')
           -- Diretoria (16/09/2026): aprova a vaga administrativa / com setor.
           OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'aprovar')
           OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'alterar');

  -- 02/10/2026 (mig 287): quem tem "APROVA VAGAS" sem ser gestor (o
  -- Operacional) decide a etapa 1 — e só ela: na vaga em "Pendente
  -- Analista", pode mudar o status e gravar o carimbo de quem aprovou e o
  -- motivo da reprovação. Qualquer outra coluna segue a regra abaixo.
  IF NOT v_gestor AND OLD.status = 'Pendente Analista' AND public.rec_aprova_vagas(auth.uid()) THEN
    v_livre := to_jsonb(OLD) - 'status' - 'aprovado_por_nome' - 'aprovado_por_email' - 'motivo_reprovacao'
                             - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes';
    IF v_livre IS NOT DISTINCT FROM (to_jsonb(NEW) - 'status' - 'aprovado_por_nome' - 'aprovado_por_email' - 'motivo_reprovacao'
                                     - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes')
       AND NEW.data_inicio_prevista IS NOT DISTINCT FROM OLD.data_inicio_prevista
       AND NEW.data_inicio_alteracoes IS NOT DISTINCT FROM OLD.data_inicio_alteracoes THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NOT v_gestor THEN
    v_livre := to_jsonb(OLD) - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes';
    IF v_livre IS DISTINCT FROM (to_jsonb(NEW) - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes') THEN
      RAISE EXCEPTION 'Depois de criada, você só pode alterar a Data de Início Prevista da vaga. Para mudar qualquer outra informação, fale com o Recrutamento.';
    END IF;
  END IF;

  IF NEW.data_inicio_prevista IS DISTINCT FROM OLD.data_inicio_prevista THEN
    IF public.rec_data_prevista(NEW.data_inicio_prevista) IS NULL THEN
      RAISE EXCEPTION 'Informe a nova data de início prevista.';
    END IF;
    v_dias := public.dias_uteis_entre(current_date, public.rec_data_prevista(NEW.data_inicio_prevista));
    IF v_dias < 7 THEN
      RAISE EXCEPTION '% A data escolhida tem % dia(s) útil(eis).', v_msg, v_dias;
    END IF;
    NEW.grau_urgencia := public.rec_grau_por_data(NEW.data_inicio_prevista);

    IF jsonb_array_length(COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb))
       <> jsonb_array_length(COALESCE(OLD.data_inicio_alteracoes, '[]'::jsonb)) + 1 THEN
      RAISE EXCEPTION 'Toda troca de data precisa de uma justificativa.';
    END IF;
    v_ult := NEW.data_inicio_alteracoes -> (jsonb_array_length(NEW.data_inicio_alteracoes) - 1);
    IF length(btrim(coalesce(v_ult->>'justificativa', ''))) < 10 THEN
      RAISE EXCEPTION 'Escreva a justificativa da troca de data (mínimo 10 caracteres).';
    END IF;
    IF btrim(coalesce(v_ult->>'para', '')) <> btrim(coalesce(NEW.data_inicio_prevista, '')) THEN
      RAISE EXCEPTION 'O histórico da troca de data não bate com a data enviada.';
    END IF;
    NEW.data_inicio_alteracoes := jsonb_set(
      NEW.data_inicio_alteracoes,
      ARRAY[(jsonb_array_length(NEW.data_inicio_alteracoes) - 1)::text],
      v_ult || jsonb_build_object('por', auth.uid(), 'em', now()));
  ELSIF NEW.data_inicio_alteracoes IS DISTINCT FROM OLD.data_inicio_alteracoes AND NOT v_gestor THEN
    RAISE EXCEPTION 'O histórico de datas não pode ser alterado.';
  END IF;

  RETURN NEW;
END $function$;

-- 3) RLS: o WITH CHECK do UPDATE aceita quem tem "APROVA VAGAS" ------------
-- USING igual ao que estava no banco (o Operacional já enxergava a linha por
-- operacional_recrutamento/visualizar).
DROP POLICY IF EXISTS sistema_recrutamento_update ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_update ON public."SISTEMA_RECRUTAMENTO" FOR UPDATE TO authenticated
  USING (
    (has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
     OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
     OR has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
     OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
     OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)
     OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao)
     OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao))
    AND ((NOT administrativa)
     OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao)
     OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao)))
  WITH CHECK (
    (has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir'::app_acao)
     OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::app_acao)
     OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'incluir'::app_acao)
     OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'alterar'::app_acao)
     OR has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'incluir'::app_acao)
     OR has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'alterar'::app_acao)
     OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'incluir'::app_acao)
     OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar'::app_acao)
     OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar'::app_acao)
     OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'aprovar'::app_acao)
     OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'alterar'::app_acao)
     OR has_screen_access(auth.uid(), 'recrutamento_solicitacao_editar', 'alterar'::app_acao)
     OR public.rec_aprova_vagas(auth.uid()))
    AND ((NOT administrativa)
     OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao)
     OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao)));

-- 4) Histórico: quem aprovou a etapa 1 -------------------------------------
-- Operacional quando a pessoa tem só a capacidade do Operacional; senão
-- Analista (como era).
CREATE OR REPLACE FUNCTION public.rec_historico_automatico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_nome   text;
  v_email  text;
  v_evento text;
  v_papel  text;
  v_papel_etapa1 text;
  v_detalhe text;
  v_mud    text[];
  k        text;
  v_de     text;
  v_para   text;
  -- Campos técnicos ou já cobertos pelo evento de status: não viram "edição".
  v_ignorar text[] := ARRAY['status', 'status_changed_at', 'updated_at', 'created_at', 'id',
                            'aprovado_por_nome', 'aprovado_por_email', 'motivo_reprovacao',
                            'legado_chave'];
  -- Nome legível de cada campo no detalhe da edição.
  v_rotulo jsonb := '{
    "motivo_vaga":"Motivo", "nome_substituido":"Substituído", "contrato":"Contrato", "cargo":"Cargo",
    "estado":"Estado", "cidade":"Cidade", "quantidade_vagas":"Quantidade", "data_inicio_prevista":"Data de início",
    "escala":"Escala", "horario":"Horário", "salario":"Salário", "insalubridade_recebe":"Insalubridade",
    "insalubridade_quanto":"Valor insalubridade", "beneficios":"Benefícios", "local_exato":"Local",
    "grau_urgencia":"Urgência", "alta_rotatividade":"Alta rotatividade", "req_obrigatorios":"Requisitos obrigatórios",
    "req_desejaveis":"Requisitos desejáveis", "exp_minima":"Experiência mínima", "exp_minima_qual":"Qual experiência",
    "motivos_saida":"Motivos de saída", "recomendacao":"Recomendação", "observacao_importante":"Observação",
    "solicitante_nome":"Solicitante", "analista_nome":"Analista", "funcionario_selecionado":"Selecionado",
    "contratado_nome":"Contratado", "contratado_contato":"Contato do contratado", "contratado_data_inicio":"Início do contratado",
    "etiquetas":"Etiquetas", "cnh_obrigatoria":"CNH obrigatória", "data_inicio_alteracoes":"Remarcação da data de início",
    "administrativa":"Administrativa", "setor":"Setor", "reposicao_tecnica":"Reserva técnica", "reserva_tecnica":"Reserva técnica",
    "tem_recomendacao":"Tem recomendação", "recomendacao_nome":"Nome da recomendação", "demissao_id":"Demissão vinculada",
    "contrato_id":"Contrato (cadastro)", "posto_id":"Posto", "funcao_id":"Função"
  }'::jsonb;
BEGIN
  -- Carga do sistema antigo (Discord) já traz o próprio histórico.
  IF TG_OP = 'INSERT' AND NEW.legado_chave IS NOT NULL THEN RETURN NEW; END IF;

  IF v_uid IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(display_name), ''), email), email INTO v_nome, v_email
      FROM public.profiles WHERE id = v_uid;
  END IF;
  v_nome := coalesce(v_nome, 'Sistema');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, de_status, para_status, papel, usuario_nome, usuario_email)
    VALUES (NEW.id, 'Solicitação criada', NULL, NEW.status, 'Solicitante', v_nome, v_email);
    RETURN NEW;
  END IF;

  -- Mudança de status
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_detalhe := NULL;
    -- Etapa 1 (mig 287): o Operacional também aprova, com "APROVA VAGAS".
    v_papel_etapa1 := CASE
      WHEN v_uid IS NOT NULL
       AND public.has_screen_access(v_uid, 'operacional_aprova_vagas', 'aprovar'::app_acao)
       AND NOT public.has_screen_access(v_uid, 'licitacoes_aprova_vagas', 'aprovar'::app_acao)
      THEN 'Operacional' ELSE 'Analista' END;
    IF NEW.status = 'Reprovada' THEN
      v_evento := 'Solicitação reprovada';
      v_papel  := CASE OLD.status WHEN 'Pendente Analista' THEN v_papel_etapa1 WHEN 'Pendente Diretoria' THEN 'Diretoria'
                                  WHEN 'Pendente Operacional' THEN 'Operacional' ELSE 'Recrutamento' END;
      v_detalhe := nullif(btrim(coalesce(NEW.motivo_reprovacao, '')), '');
    ELSIF OLD.status = 'Pendente Analista' AND NEW.status = 'Pendente Recrutamento' THEN
      v_evento := 'Aprovada pelo ' || v_papel_etapa1;  v_papel := v_papel_etapa1;
    ELSIF OLD.status = 'Pendente Diretoria' AND NEW.status = 'Pendente Recrutamento' THEN
      v_evento := 'Aprovada pela Diretoria';    v_papel := 'Diretoria';
    ELSIF OLD.status = 'Pendente Operacional' THEN
      v_evento := 'Aprovada pelo Operacional';  v_papel := 'Operacional';
    ELSIF OLD.status = 'Pendente Recrutamento' AND NEW.status = 'Vaga aberta - Seleção de Currículos' THEN
      v_evento := 'Abertura de vaga confirmada'; v_papel := 'Recrutamento';
    ELSIF NEW.status IN ('Concluída', 'Contratado') OR NEW.status LIKE 'Concluído%' THEN
      v_evento := 'Solicitação concluída';      v_papel := 'Recrutamento';
    ELSIF NEW.status = 'Cancelada' THEN
      v_evento := 'Solicitação cancelada';      v_papel := NULL;
    ELSE
      -- Andamento dirigido pelo candidato mais adiantado (sr_sync_status_solicitacao).
      v_evento := 'Status da vaga atualizado';  v_papel := 'Recrutamento';
    END IF;
    INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, de_status, para_status, papel, usuario_nome, usuario_email, detalhe)
    VALUES (NEW.id, v_evento, OLD.status, NEW.status, v_papel, v_nome, v_email, v_detalhe);
  END IF;

  -- Edição de campos
  v_mud := ARRAY[]::text[];
  FOR k IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
    CONTINUE WHEN k = ANY (v_ignorar);
    IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k) THEN
      v_de   := left(coalesce(to_jsonb(OLD) ->> k, '—'), 80);
      v_para := left(coalesce(to_jsonb(NEW) ->> k, '—'), 80);
      v_mud  := v_mud || format('%s: %s → %s', coalesce(v_rotulo ->> k, k), v_de, v_para);
    END IF;
  END LOOP;
  IF array_length(v_mud, 1) > 0 THEN
    INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, papel, usuario_nome, usuario_email, detalhe)
    VALUES (NEW.id,
            CASE WHEN array_length(v_mud, 1) = 1 THEN 'Solicitação editada (1 campo)'
                 ELSE format('Solicitação editada (%s campos)', array_length(v_mud, 1)) END,
            NULL, v_nome, v_email, array_to_string(v_mud, E'\n'));
  END IF;

  RETURN NEW;
END $function$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar: rec_guard_aprovador_setor da 20260930000232; sistema_recrutamento_guard
-- e rec_historico_automatico como estavam (sem o bloco "APROVA VAGAS" / v_papel_etapa1);
-- a policy sistema_recrutamento_update sem `OR public.rec_aprova_vagas(auth.uid())`. Depois:
-- DROP FUNCTION IF EXISTS public.rec_aprova_vagas(uuid);
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo IN ('operacional_aprova_vagas', 'licitacoes_aprova_vagas');
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('operacional_aprova_vagas', 'licitacoes_aprova_vagas');
-- DELETE FROM public.app_menu_acao           WHERE menu_codigo IN ('operacional_aprova_vagas', 'licitacoes_aprova_vagas');
-- DELETE FROM public.app_menu                WHERE codigo      IN ('operacional_aprova_vagas', 'licitacoes_aprova_vagas');
-- NOTIFY pgrst, 'reload schema';
