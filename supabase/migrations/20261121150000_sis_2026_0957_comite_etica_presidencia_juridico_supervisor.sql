-- =========================================================================
-- SIS-2026-0957 — COMITÊ DE ÉTICA → PRESIDÊNCIA → JURÍDICO → SUPERVISOR
-- (19/11/2026)
--
-- PEDIDO
--   1. O Comitê registra o Parecer Conclusivo (versão final) e o sistema o
--      encaminha à presidente. Para CADA medida recomendada ela tem dois
--      comandos:
--        · Desaprovar — devolve ao Comitê com a medida que ela propõe ou um
--          aditivo. O Comitê reavalia e reenvia o parecer ajustado: é um
--          CICLO, com histórico;
--        · Aprovar e encaminhar ao Jurídico — abre sozinho uma solicitação
--          no módulo que o Jurídico já usa para advertências
--          (SISTEMA_SOLICITACOES_ADVERTENCIA), com o nº da denúncia, o
--          contrato, a medida e, quando houver, o colaborador; e um resumo
--          do parecer dela, redigido com ajuda da I.A (Edge
--          denuncia-parecer-ia, modo "encaminhamento" — a I.A só redige, quem
--          grava é a presidente).
--   2. O Jurídico elabora a advertência (ou formaliza a diretriz) e aciona
--      "Encaminhar ao supervisor do contrato": o sistema acha sozinho o
--      supervisor operacional do contrato da denúncia (Organograma
--      Operacional, OPE_ORG_CONTRATO.supervisor_id) e põe no painel dele o
--      documento final e as orientações.
--   3. O supervisor clica "Registrar aplicação" (data + comprovante
--      opcional). Fica vinculado à denúncia; o Comitê acompanha.
--
-- TABELAS NOVAS
--   COMITE_ETICA_PARECER_CICLO   um envio do parecer à Presidência (ciclo N)
--   COMITE_ETICA_MEDIDA          uma medida do ciclo e a decisão dela
--   COMITE_ETICA_MEDIDA_SUPERVISOR  o item no painel do supervisor — SÓ o que
--                                ele precisa: protocolo, contrato,
--                                colaborador, medida, documento, orientações
--                                e a aplicação. Nada do conteúdo da denúncia.
--   COMITE_ETICA_MEDIDA_EVENTO   a trilha de todas as etapas
--   Tudo é escrito pelas RPCs (SECURITY DEFINER) daqui; authenticated só lê,
--   e cada um lê o que a sua ponta precisa (RLS na seção 6).
--
-- ADVERTÊNCIA: A MESMA TABELA, COM SIGILO
--   SISTEMA_SOLICITACOES_ADVERTENCIA ganha `canal_denuncia_id`. Linha com ele
--   preenchido nasce de uma decisão da Presidência e leva o resumo do caso;
--   por isso a RLS dela passa a ser outra: lê quem tem o card "Recebidos da
--   presidência" (juridico_recebidos_presidencia), quem pediu (a própria
--   presidente) e quem enxerga a denúncia (Comitê/Presidência) — e NÃO quem
--   só tem o menu `advertencias` (supervisores e analistas de contrato
--   leem a fila comum). Comentários e histórico da advertência herdam,
--   porque as policies deles consultam esta tabela. As linhas comuns
--   (canal_denuncia_id nulo) continuam exatamente com a regra de antes.
--   As travas de "já existe solicitação em aberto" (mig 104) e o sino de
--   "nova advertência para aprovar" (mig 185/20261005000008) não valem para
--   essas linhas: a presidente já decidiu, e o aviso é o desta migration.
--
-- MENUS (nascem PENDENTES — SIS-2026-0931: liberar em Módulos & Menus ›
-- Novos Módulos depois do merge):
--   juridico_recebidos_presidencia  fantasma  Jurídico › Advertências ›
--                                   card "Recebidos da presidência"
--   juridico_encaminhar_supervisor  fantasma  pode "Encaminhar ao supervisor"
--   advertencias_recebido_juridico  /app/juridico/advertencias — card
--                                   "Recebido do jurídico" do supervisor.
--                                   Tem a MESMA rota de `advertencias` de
--                                   propósito: é a porta da tela para o
--                                   supervisor sem dar a ele a fila inteira
--                                   de advertências (RouteGuard aceita
--                                   qualquer menu ativo da rota).
--   A Presidência usa o que já existe: comite_etica_presidencia_painel (a
--   tela) e comite_etica_presidencia (decidir).
--
-- Espelho das regras na tela: src/lib/comite-etica/encaminhamento.ts
-- (testes em src/test/comite-etica-encaminhamento.test.ts).
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Menus ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM (VALUES
    ('juridico_recebidos_presidencia', 'Advertências › Recebidos da presidência (Comitê de Ética)', NULL::text, 41),
    ('juridico_encaminhar_supervisor', 'Advertências › Pode encaminhar ao supervisor do contrato',   NULL::text, 42),
    ('advertencias_recebido_juridico', 'Advertências › Recebido do jurídico (supervisor do contrato)', '/app/juridico/advertencias', 43)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'juridico'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Acesso PREPARADO (não libera nada sozinho — o menu nasce pendente):
-- quem já aprova advertências fica pré-marcado para o card do Jurídico e
-- para encaminhar; quem é supervisor no Organograma Operacional e tem login,
-- para o card do supervisor.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, x.menu, 'visualizar'::public.app_acao, true,
       'SIS-2026-0957: aprovava advertências (acesso preparado)'
  FROM public.screen_permission_user s
 CROSS JOIN (VALUES ('juridico_recebidos_presidencia'), ('juridico_encaminhar_supervisor')) AS x(menu)
 WHERE s.menu_codigo = 'advertencias' AND s.acao = 'aprovar'::public.app_acao AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user y
                    WHERE y.user_id = s.user_id AND y.menu_codigo = x.menu AND y.acao = 'visualizar'::public.app_acao);

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT e.auth_user_id, 'advertencias_recebido_juridico', 'visualizar'::public.app_acao, true,
       'SIS-2026-0957: supervisor no Organograma Operacional (acesso preparado)'
  FROM public."OPE_ORG_CONTRATO" o
  JOIN public."EMPREGADOS" e ON e."ID" = o.supervisor_id
 WHERE e.auth_user_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user y
                    WHERE y.user_id = e.auth_user_id AND y.menu_codigo = 'advertencias_recebido_juridico'
                      AND y.acao = 'visualizar'::public.app_acao);

-- ── 2) Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."COMITE_ETICA_PARECER_CICLO" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  denuncia_id       uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  ciclo             integer NOT NULL,
  protocolo         text,
  -- Espelho: SITUACAO_CICLO em src/lib/comite-etica/encaminhamento.ts.
  status            text NOT NULL DEFAULT 'aguardando_presidencia'
                    CHECK (status IN ('aguardando_presidencia', 'devolvido', 'decidido', 'cancelado')),
  -- O parecer como estava no envio: o que a presidente decidiu é ESTE texto,
  -- mesmo que o Comitê reabra o documento depois.
  parecer_versao    integer,
  parecer_texto     text,
  medida_principal  text,
  origem            text NOT NULL DEFAULT 'manual' CHECK (origem IN ('automatico', 'manual')),
  enviado_por       uuid REFERENCES auth.users(id),
  enviado_por_nome  text,
  enviado_em        timestamptz NOT NULL DEFAULT now(),
  encerrado_em      timestamptz,
  UNIQUE (denuncia_id, ciclo)
);
-- Um ciclo aberto por denúncia.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cetica_ciclo_aberto
  ON public."COMITE_ETICA_PARECER_CICLO"(denuncia_id) WHERE status = 'aguardando_presidencia';
CREATE INDEX IF NOT EXISTS cetica_ciclo_enviado_por_idx ON public."COMITE_ETICA_PARECER_CICLO"(enviado_por);
CREATE INDEX IF NOT EXISTS cetica_ciclo_status_idx ON public."COMITE_ETICA_PARECER_CICLO"(status, enviado_em DESC);

CREATE TABLE IF NOT EXISTS public."COMITE_ETICA_MEDIDA" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciclo_id          uuid NOT NULL REFERENCES public."COMITE_ETICA_PARECER_CICLO"(id) ON DELETE CASCADE,
  denuncia_id       uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  protocolo         text,
  -- Código do vocabulário do Comitê (MEDIDA em vocabulario.ts).
  medida            text NOT NULL,
  medida_rotulo     text NOT NULL,
  status            text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'desaprovada')),
  -- Desaprovar: a medida que a presidente propõe ou o aditivo (obrigatório).
  -- Aprovar: observação opcional.
  decisao_texto     text,
  decidido_por      uuid REFERENCES auth.users(id),
  decidido_por_nome text,
  decidido_em       timestamptz,
  -- O que vai ao Jurídico (aprovada).
  resumo_juridico   text,
  resumo_usou_ia    boolean NOT NULL DEFAULT false,
  colaborador_id    bigint,             -- EMPREGADOS."ID" (sem FK: mesma razão do OPE_ORG_CONTRATO)
  colaborador_nome  text,
  contrato_texto    text,
  contrato_id       uuid,               -- public.contratos.id, resolvido no envio ao supervisor
  advertencia_id    bigint REFERENCES public."SISTEMA_SOLICITACOES_ADVERTENCIA"(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ciclo_id, medida)
);
CREATE INDEX IF NOT EXISTS cetica_medida_denuncia_idx    ON public."COMITE_ETICA_MEDIDA"(denuncia_id);
CREATE INDEX IF NOT EXISTS cetica_medida_decidido_por_idx ON public."COMITE_ETICA_MEDIDA"(decidido_por);
CREATE INDEX IF NOT EXISTS cetica_medida_advertencia_idx ON public."COMITE_ETICA_MEDIDA"(advertencia_id);
CREATE INDEX IF NOT EXISTS cetica_medida_aprovadas_idx   ON public."COMITE_ETICA_MEDIDA"(decidido_em DESC) WHERE status = 'aprovada';

CREATE TABLE IF NOT EXISTS public."COMITE_ETICA_MEDIDA_SUPERVISOR" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medida_id            uuid NOT NULL UNIQUE REFERENCES public."COMITE_ETICA_MEDIDA"(id) ON DELETE CASCADE,
  denuncia_id          uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  protocolo            text,
  contrato_id          uuid NOT NULL,
  contrato_nome        text,
  supervisor_empregado_id bigint,
  supervisor_user_id   uuid REFERENCES auth.users(id),
  supervisor_nome      text,
  colaborador_nome     text,
  medida_rotulo        text NOT NULL,
  aprovado_em          timestamptz,
  orientacoes          text NOT NULL,
  documento_path       text,
  documento_nome       text,
  encaminhado_por      uuid REFERENCES auth.users(id),
  encaminhado_por_nome text,
  encaminhado_em       timestamptz NOT NULL DEFAULT now(),
  status               text NOT NULL DEFAULT 'aguardando_aplicacao' CHECK (status IN ('aguardando_aplicacao', 'aplicada')),
  aplicada_em          date,
  aplicacao_obs        text,
  comprovante_path     text,
  comprovante_nome     text,
  registrado_por       uuid REFERENCES auth.users(id),
  registrado_por_nome  text,
  registrado_em        timestamptz
);
CREATE INDEX IF NOT EXISTS cetica_sup_denuncia_idx        ON public."COMITE_ETICA_MEDIDA_SUPERVISOR"(denuncia_id);
CREATE INDEX IF NOT EXISTS cetica_sup_supervisor_user_idx ON public."COMITE_ETICA_MEDIDA_SUPERVISOR"(supervisor_user_id);
CREATE INDEX IF NOT EXISTS cetica_sup_contrato_idx        ON public."COMITE_ETICA_MEDIDA_SUPERVISOR"(contrato_id);
CREATE INDEX IF NOT EXISTS cetica_sup_encaminhado_por_idx ON public."COMITE_ETICA_MEDIDA_SUPERVISOR"(encaminhado_por);
CREATE INDEX IF NOT EXISTS cetica_sup_registrado_por_idx  ON public."COMITE_ETICA_MEDIDA_SUPERVISOR"(registrado_por);

CREATE TABLE IF NOT EXISTS public."COMITE_ETICA_MEDIDA_EVENTO" (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  denuncia_id   uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  ciclo_id      uuid REFERENCES public."COMITE_ETICA_PARECER_CICLO"(id) ON DELETE CASCADE,
  medida_id     uuid REFERENCES public."COMITE_ETICA_MEDIDA"(id) ON DELETE CASCADE,
  -- Espelho: ETAPA em src/lib/comite-etica/encaminhamento.ts.
  etapa         text NOT NULL CHECK (etapa IN ('comite', 'presidencia', 'juridico', 'supervisor')),
  evento        text NOT NULL,
  detalhe       text,
  usuario_id    uuid REFERENCES auth.users(id),
  usuario_nome  text,
  em            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cetica_evento_denuncia_idx ON public."COMITE_ETICA_MEDIDA_EVENTO"(denuncia_id, em);
CREATE INDEX IF NOT EXISTS cetica_evento_ciclo_idx    ON public."COMITE_ETICA_MEDIDA_EVENTO"(ciclo_id);
CREATE INDEX IF NOT EXISTS cetica_evento_medida_idx   ON public."COMITE_ETICA_MEDIDA_EVENTO"(medida_id);
CREATE INDEX IF NOT EXISTS cetica_evento_usuario_idx  ON public."COMITE_ETICA_MEDIDA_EVENTO"(usuario_id);

-- A advertência que nasceu da decisão da Presidência.
ALTER TABLE public."SISTEMA_SOLICITACOES_ADVERTENCIA"
  ADD COLUMN IF NOT EXISTS canal_denuncia_id uuid REFERENCES public."CANAL_DENUNCIA"(id);
CREATE INDEX IF NOT EXISTS adv_canal_denuncia_idx
  ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"(canal_denuncia_id) WHERE canal_denuncia_id IS NOT NULL;
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_ADVERTENCIA".canal_denuncia_id IS
  'Preenchido quando a solicitação nasceu de medida aprovada pela Presidência (Comitê de Ética, SIS-2026-0957). Muda a RLS da linha: sigilo da denúncia.';

-- ── 3) Funções de apoio ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cetica_nome_usuario(_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) FROM public.profiles p WHERE p.id = _uid;
$$;

-- Espelho: MEDIDA em src/pages/comite-etica/vocabulario.ts.
CREATE OR REPLACE FUNCTION public.cetica_medida_rotulo(_m text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE _m
    WHEN 'advertencia' THEN 'Advertência'
    WHEN 'suspensao' THEN 'Suspensão'
    WHEN 'demissao' THEN 'Demissão'
    WHEN 'treinamento' THEN 'Treinamento'
    WHEN 'orientacao' THEN 'Orientação / Feedback'
    WHEN 'melhoria_processo' THEN 'Melhoria de processo'
    WHEN 'nenhuma' THEN 'Nenhuma medida (aprovar o parecer)'
    ELSE coalesce(_m, '—') END;
$$;

CREATE OR REPLACE FUNCTION public.cetica_pode_decidir()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.tem_acesso_menu('comite_etica_presidencia');
$$;

CREATE OR REPLACE FUNCTION public.cetica_juridico_ve()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_screen_access(auth.uid(), 'juridico_recebidos_presidencia', 'visualizar'::public.app_acao, NULL);
$$;

CREATE OR REPLACE FUNCTION public.cetica_juridico_encaminha()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_screen_access(auth.uid(), 'juridico_encaminhar_supervisor', 'visualizar'::public.app_acao, NULL);
$$;

-- O supervisor do contrato hoje, pelo Organograma Operacional. Demitido não
-- conta (o contrato fica sem supervisor até alguém definir outro).
CREATE OR REPLACE FUNCTION public.cetica_supervisor_do_contrato(_contrato uuid)
RETURNS TABLE (empregado_id bigint, user_id uuid, nome text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e."ID"::bigint, e.auth_user_id, e."Nome"
    FROM public."OPE_ORG_CONTRATO" o
    JOIN public."EMPREGADOS" e ON e."ID" = o.supervisor_id
   WHERE o.contrato_id = _contrato
     AND coalesce(e."Situação", '') <> 'Demitido'
   LIMIT 1;
$$;

-- Supervisor enxerga o item: é quem recebeu OU é o supervisor do contrato
-- hoje (troca no organograma passa o item ao novo) — e tem o card liberado.
CREATE OR REPLACE FUNCTION public.cetica_sou_supervisor(_contrato uuid, _supervisor_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_screen_access(auth.uid(), 'advertencias_recebido_juridico', 'visualizar'::public.app_acao, NULL)
     AND (_supervisor_user = auth.uid()
          OR EXISTS (SELECT 1 FROM public.cetica_supervisor_do_contrato(_contrato) s WHERE s.user_id = auth.uid()));
$$;

-- Contrato (public.contratos.id) da denúncia, na ordem do que é mais certo:
--   1. o denunciado vinculado pelo Comitê → contrato dele no Ativos/Contratos;
--   2. o contrato da ficha do Comitê, senão o informado pelo denunciante,
--      pelo nome normalizado (mesma régua do organograma, rh_norm_contrato);
--   3. o mesmo nome contra a filial da Senior (de-para de Suprimentos).
-- NULL = não deu para saber; o Jurídico escolhe o contrato na tela.
CREATE OR REPLACE FUNCTION public.cetica_contrato_da_denuncia(_denuncia uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d record;
  v uuid;
  t text;
BEGIN
  SELECT denunciado_empregado_id, contrato, contrato_informado INTO d
    FROM public."CANAL_DENUNCIA" WHERE id = _denuncia;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF d.denunciado_empregado_id IS NOT NULL THEN
    SELECT a.contrato_id INTO v FROM public.rh_ac_ativos() a
     WHERE a.empregado_id = d.denunciado_empregado_id AND a.contrato_id IS NOT NULL LIMIT 1;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END IF;

  FOREACH t IN ARRAY ARRAY[d.contrato, d.contrato_informado] LOOP
    CONTINUE WHEN public.rh_norm_contrato(t) IS NULL;
    SELECT c.id INTO v FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) = public.rh_norm_contrato(t)
     ORDER BY (coalesce(c.status, 'ativo') = 'encerrado'), c.created_at DESC
     LIMIT 1;
    IF v IS NOT NULL THEN RETURN v; END IF;
    SELECT m.contrato_id INTO v
      FROM public.ope_org_contrato_senior() m
      JOIN public."CONTRATOS" s ON s."Empresa"::bigint = m.empresa AND s."Filial"::bigint = m.filial
     WHERE public.rh_norm_contrato(s."NOME CONTRATO") = public.rh_norm_contrato(t)
     LIMIT 1;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- Quem do Comitê acompanha: o relator do caso e quem enviou o ciclo.
CREATE OR REPLACE FUNCTION public.cetica_quem_acompanha(_denuncia uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT u) FILTER (WHERE u IS NOT NULL), '{}'::uuid[])
    FROM (
      SELECT d.apuracao_responsavel_id AS u FROM public."CANAL_DENUNCIA" d WHERE d.id = _denuncia
      UNION ALL
      SELECT c.enviado_por FROM public."COMITE_ETICA_PARECER_CICLO" c WHERE c.denuncia_id = _denuncia
    ) x;
$$;

CREATE OR REPLACE FUNCTION public.cetica_evento(_denuncia uuid, _ciclo uuid, _medida uuid, _etapa text, _evento text, _detalhe text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public."COMITE_ETICA_MEDIDA_EVENTO" (denuncia_id, ciclo_id, medida_id, etapa, evento, detalhe, usuario_id, usuario_nome)
  VALUES (_denuncia, _ciclo, _medida, _etapa, _evento, nullif(btrim(coalesce(_detalhe, '')), ''),
          auth.uid(), public.cetica_nome_usuario(auth.uid()));
$$;

-- Muda a situação da denúncia pelo fluxo. O guard do canal exige
-- justificativa; o da Presidência deixa a presidente mudar situação.
CREATE OR REPLACE FUNCTION public.cetica_denuncia_situacao(_denuncia uuid, _status text, _justificativa text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public."CANAL_DENUNCIA"
     SET status = _status, justificativa_mudanca = _justificativa
   WHERE id = _denuncia AND status IS DISTINCT FROM _status;
END $$;

-- ── 4) Comitê → Presidência ──────────────────────────────────────────────
-- Abre o ciclo (interna: quem chama já conferiu a permissão).
CREATE OR REPLACE FUNCTION public.cetica_ciclo_abrir(_denuncia uuid, _origem text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d       record;
  v_doc   record;
  v_num   integer;
  v_ciclo uuid;
  v_med   text[];
  v_m     text;
BEGIN
  SELECT id, protocolo, status, medidas, medida_principal, contrato, contrato_informado,
         denunciado_empregado_id, denunciado_nome, denunciado_informado
    INTO d FROM public."CANAL_DENUNCIA" WHERE id = _denuncia FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Denúncia não encontrada.'; END IF;
  IF d.status IN ('concluida', 'arquivada') THEN
    RAISE EXCEPTION 'A denúncia % já está encerrada. Reabra antes de enviar à Presidência.', d.protocolo;
  END IF;

  SELECT conteudo, versao INTO v_doc FROM public."CANAL_DENUNCIA_DOCUMENTO"
   WHERE denuncia_id = _denuncia AND tipo = 'parecer_conclusivo' AND final;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registre o Parecer Conclusivo em versão final antes de enviar à Presidência.';
  END IF;
  IF EXISTS (SELECT 1 FROM public."COMITE_ETICA_PARECER_CICLO" WHERE denuncia_id = _denuncia AND status = 'aguardando_presidencia') THEN
    RAISE EXCEPTION 'O parecer desta denúncia já está com a Presidência.';
  END IF;

  -- Medidas do Comitê que ainda não foram aprovadas num ciclo anterior.
  SELECT coalesce(array_agg(u.x ORDER BY u.o), '{}') INTO v_med
    FROM unnest(coalesce(d.medidas, '{}')) WITH ORDINALITY AS u(x, o)
   WHERE u.x <> 'nenhuma'
     AND NOT EXISTS (SELECT 1 FROM public."COMITE_ETICA_MEDIDA" md
                      WHERE md.denuncia_id = _denuncia AND md.medida = u.x AND md.status = 'aprovada');
  -- Sem medida nova, a presidente aprova (ou devolve) o parecer em si.
  IF cardinality(v_med) = 0 THEN v_med := ARRAY['nenhuma']; END IF;

  SELECT coalesce(max(ciclo), 0) + 1 INTO v_num FROM public."COMITE_ETICA_PARECER_CICLO" WHERE denuncia_id = _denuncia;

  INSERT INTO public."COMITE_ETICA_PARECER_CICLO"
    (denuncia_id, ciclo, protocolo, parecer_versao, parecer_texto, medida_principal, origem, enviado_por, enviado_por_nome)
  VALUES (_denuncia, v_num, d.protocolo, v_doc.versao, v_doc.conteudo, d.medida_principal,
          CASE WHEN _origem = 'automatico' THEN 'automatico' ELSE 'manual' END,
          auth.uid(), public.cetica_nome_usuario(auth.uid()))
  RETURNING id INTO v_ciclo;

  FOREACH v_m IN ARRAY v_med LOOP
    INSERT INTO public."COMITE_ETICA_MEDIDA"
      (ciclo_id, denuncia_id, protocolo, medida, medida_rotulo, colaborador_id, colaborador_nome, contrato_texto)
    VALUES (v_ciclo, _denuncia, d.protocolo, v_m, public.cetica_medida_rotulo(v_m),
            d.denunciado_empregado_id, coalesce(nullif(btrim(d.denunciado_nome), ''), nullif(btrim(d.denunciado_informado), '')),
            coalesce(nullif(btrim(d.contrato), ''), nullif(btrim(d.contrato_informado), '')))
    ON CONFLICT (ciclo_id, medida) DO NOTHING;
  END LOOP;

  PERFORM public.cetica_denuncia_situacao(_denuncia, 'aguardando_presidencia',
    format('Parecer Conclusivo enviado à Presidência (ciclo %s).', v_num));
  PERFORM public.cetica_evento(_denuncia, v_ciclo, NULL, 'comite',
    format('Parecer enviado à Presidência — ciclo %s', v_num),
    'Medidas: ' || (SELECT string_agg(public.cetica_medida_rotulo(x), ', ') FROM unnest(v_med) x)
      || CASE WHEN _origem = 'automatico' THEN ' · enviado ao finalizar o Parecer Conclusivo' ELSE '' END);
  PERFORM public.jur_notificar(public.jur_quem_tem('comite_etica_presidencia', 'visualizar'),
    'Parecer do Comitê de Ética para decidir',
    format('Denúncia %s — ciclo %s. %s medida(s) aguardando sua decisão.', d.protocolo, v_num, cardinality(v_med)),
    'warning', '/app/comite-etica/presidencia?denuncia=' || _denuncia);
  RETURN v_ciclo;
END $$;

-- Botão "Enviar à Presidência" (reenvio depois da devolução, ou quando o
-- envio automático não aconteceu).
CREATE OR REPLACE FUNCTION public.cetica_parecer_enviar(_denuncia uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.canal_denuncia_visivel_por_id(_denuncia)
                                AND public.canal_denuncia_documento_pode_redigir(_denuncia)) THEN
    RAISE EXCEPTION 'Só o Comitê (relator ou quem redige os documentos) envia o parecer à Presidência.'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.cetica_ciclo_abrir(_denuncia, 'manual');
END $$;

-- Parecer Conclusivo virou versão final → vai à Presidência sozinho. Reaberto
-- com o ciclo ainda sem nenhuma decisão → o ciclo é cancelado (o Comitê
-- retirou para ajustar; o reenvio vem quando finalizar de novo).
CREATE OR REPLACE FUNCTION public.cetica_parecer_final_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ciclo record;
BEGIN
  IF NEW.tipo <> 'parecer_conclusivo' THEN RETURN NULL; END IF;

  IF NEW.final AND (TG_OP = 'INSERT' OR NOT OLD.final) THEN
    IF NOT EXISTS (SELECT 1 FROM public."COMITE_ETICA_PARECER_CICLO"
                    WHERE denuncia_id = NEW.denuncia_id AND status = 'aguardando_presidencia')
       AND EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA"
                    WHERE id = NEW.denuncia_id AND status NOT IN ('concluida', 'arquivada')) THEN
      BEGIN
        PERFORM public.cetica_ciclo_abrir(NEW.denuncia_id, 'automatico');
      EXCEPTION WHEN others THEN
        -- Salvar o parecer não pode falhar por causa do envio: o Comitê tem
        -- o botão "Enviar à Presidência", que mostra o motivo.
        RAISE WARNING 'cetica: envio automático à Presidência não aconteceu: %', SQLERRM;
      END;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.final AND NOT NEW.final THEN
    SELECT * INTO v_ciclo FROM public."COMITE_ETICA_PARECER_CICLO"
     WHERE denuncia_id = NEW.denuncia_id AND status = 'aguardando_presidencia';
    IF FOUND AND NOT EXISTS (SELECT 1 FROM public."COMITE_ETICA_MEDIDA" WHERE ciclo_id = v_ciclo.id AND status <> 'pendente') THEN
      UPDATE public."COMITE_ETICA_PARECER_CICLO" SET status = 'cancelado', encerrado_em = now() WHERE id = v_ciclo.id;
      PERFORM public.cetica_evento(NEW.denuncia_id, v_ciclo.id, NULL, 'comite',
        format('Ciclo %s retirado da Presidência', v_ciclo.ciclo), 'O Comitê reabriu o Parecer Conclusivo para ajustes.');
      PERFORM public.cetica_denuncia_situacao(NEW.denuncia_id, 'parecer_elaboracao',
        format('Parecer Conclusivo reaberto pelo Comitê (ciclo %s retirado da Presidência).', v_ciclo.ciclo));
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_canal_denuncia_documento_zz_presidencia ON public."CANAL_DENUNCIA_DOCUMENTO";
CREATE TRIGGER trg_canal_denuncia_documento_zz_presidencia
  AFTER INSERT OR UPDATE OF final ON public."CANAL_DENUNCIA_DOCUMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.cetica_parecer_final_trg();

-- ── 5) Presidência decide cada medida ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cetica_ciclo_fechar(_ciclo uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c      record;
  v_dev  text;
  v_real integer;
BEGIN
  SELECT * INTO c FROM public."COMITE_ETICA_PARECER_CICLO" WHERE id = _ciclo FOR UPDATE;
  IF c.status <> 'aguardando_presidencia'
     OR EXISTS (SELECT 1 FROM public."COMITE_ETICA_MEDIDA" WHERE ciclo_id = _ciclo AND status = 'pendente') THEN
    RETURN;
  END IF;

  SELECT string_agg(m.medida_rotulo || ': ' || coalesce(m.decisao_texto, '—'), ' · ') INTO v_dev
    FROM public."COMITE_ETICA_MEDIDA" m WHERE m.ciclo_id = _ciclo AND m.status = 'desaprovada';

  IF v_dev IS NOT NULL THEN
    UPDATE public."COMITE_ETICA_PARECER_CICLO" SET status = 'devolvido', encerrado_em = now() WHERE id = _ciclo;
    PERFORM public.cetica_denuncia_situacao(c.denuncia_id, 'parecer_elaboracao',
      left(format('Presidência devolveu o parecer ao Comitê (ciclo %s). %s', c.ciclo, v_dev), 2000));
    PERFORM public.cetica_evento(c.denuncia_id, _ciclo, NULL, 'presidencia',
      format('Parecer devolvido ao Comitê — ciclo %s', c.ciclo), v_dev);
    PERFORM public.jur_notificar(public.cetica_quem_acompanha(c.denuncia_id),
      'Presidência devolveu o parecer',
      format('Denúncia %s — ciclo %s. Reavalie e reenvie o parecer ajustado.', c.protocolo, c.ciclo),
      'warning', '/app/comite-etica/denuncias?denuncia=' || c.denuncia_id);
  ELSE
    UPDATE public."COMITE_ETICA_PARECER_CICLO" SET status = 'decidido', encerrado_em = now() WHERE id = _ciclo;
    SELECT count(*) INTO v_real FROM public."COMITE_ETICA_MEDIDA"
     WHERE denuncia_id = c.denuncia_id AND status = 'aprovada' AND medida <> 'nenhuma';
    IF v_real > 0 THEN
      PERFORM public.cetica_denuncia_situacao(c.denuncia_id, 'aguardando_cumprimento',
        format('Presidência aprovou as medidas do parecer (ciclo %s) e encaminhou ao Jurídico.', c.ciclo));
    END IF;
    PERFORM public.cetica_evento(c.denuncia_id, _ciclo, NULL, 'presidencia',
      format('Parecer aprovado pela Presidência — ciclo %s', c.ciclo), NULL);
    PERFORM public.jur_notificar(public.cetica_quem_acompanha(c.denuncia_id),
      'Presidência aprovou o parecer',
      format('Denúncia %s — ciclo %s.', c.protocolo, c.ciclo),
      'success', '/app/comite-etica/denuncias?denuncia=' || c.denuncia_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cetica_medida_decidir(
  _medida uuid, _aprovar boolean, _texto text DEFAULT NULL,
  _resumo text DEFAULT NULL, _resumo_ia boolean DEFAULT false,
  _colaborador_id bigint DEFAULT NULL, _colaborador_nome text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m        record;
  c        record;
  d        record;
  v_uid    uuid := auth.uid();
  v_nome   text := public.cetica_nome_usuario(auth.uid());
  v_email  text;
  v_texto  text := nullif(btrim(coalesce(_texto, '')), '');
  v_resumo text := nullif(btrim(coalesce(_resumo, '')), '');
  v_colab  text;
  v_adv    bigint;
BEGIN
  SELECT * INTO m FROM public."COMITE_ETICA_MEDIDA" WHERE id = _medida FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medida não encontrada.'; END IF;
  IF NOT public.cetica_pode_decidir() OR NOT public.canal_denuncia_presidencia_ve_por_id(m.denuncia_id)
     AND NOT public.canal_denuncia_visivel_por_id(m.denuncia_id) THEN
    RAISE EXCEPTION 'Só a Presidência decide as medidas do parecer.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public."COMITE_ETICA_PARECER_CICLO" WHERE id = m.ciclo_id;
  IF c.status <> 'aguardando_presidencia' OR m.status <> 'pendente' THEN
    RAISE EXCEPTION 'Esta medida já foi decidida (ciclo %).', c.ciclo;
  END IF;

  IF NOT _aprovar THEN
    IF v_texto IS NULL THEN
      RAISE EXCEPTION 'Para desaprovar, escreva a medida que propõe ou o aditivo à decisão.';
    END IF;
    UPDATE public."COMITE_ETICA_MEDIDA"
       SET status = 'desaprovada', decisao_texto = v_texto,
           decidido_por = v_uid, decidido_por_nome = v_nome, decidido_em = now()
     WHERE id = _medida;
    PERFORM public.cetica_evento(m.denuncia_id, m.ciclo_id, _medida, 'presidencia',
      'Medida desaprovada: ' || m.medida_rotulo, v_texto);
  ELSE
    IF m.medida <> 'nenhuma' AND v_resumo IS NULL THEN
      RAISE EXCEPTION 'Escreva o resumo do parecer para o Jurídico (pode gerar com a I.A).';
    END IF;
    v_colab := coalesce(nullif(btrim(coalesce(_colaborador_nome, '')), ''), m.colaborador_nome);

    IF m.medida <> 'nenhuma' THEN
      SELECT gravidade, ocorrencia_data INTO d FROM public."CANAL_DENUNCIA" WHERE id = m.denuncia_id;
      SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;
      INSERT INTO public."SISTEMA_SOLICITACOES_ADVERTENCIA"
        (solicitante_nome, solicitante_email, colaborador_id, colaborador_nome, contrato,
         tipo_advertencia, grau, descricao_ocorrido, data_ocorrido, status, aprovado_por_nome, canal_denuncia_id)
      VALUES (
        v_nome, coalesce(v_email, auth.email()),
        coalesce(_colaborador_id, m.colaborador_id),
        coalesce(v_colab, 'A definir pelo Jurídico'),
        m.contrato_texto,
        CASE m.medida WHEN 'advertencia' THEN 'Escrita' ELSE m.medida_rotulo END,
        CASE d.gravidade WHEN 'baixa' THEN 'Baixo' WHEN 'media' THEN 'Médio'
                         WHEN 'alta' THEN 'Alto' WHEN 'critica' THEN 'Alto' END,
        left(format('Comitê de Ética — denúncia %s. Medida aprovada pela Presidência: %s.%s%s',
                    m.protocolo, m.medida_rotulo, E'\n\n', v_resumo), 20000),
        d.ocorrencia_data,
        'Aguardando Jurídico', v_nome, m.denuncia_id)
      RETURNING id INTO v_adv;
    END IF;

    UPDATE public."COMITE_ETICA_MEDIDA"
       SET status = 'aprovada', decisao_texto = v_texto,
           decidido_por = v_uid, decidido_por_nome = v_nome, decidido_em = now(),
           resumo_juridico = v_resumo, resumo_usou_ia = coalesce(_resumo_ia, false) AND v_resumo IS NOT NULL,
           colaborador_id = coalesce(_colaborador_id, colaborador_id), colaborador_nome = v_colab,
           advertencia_id = v_adv
     WHERE id = _medida;

    PERFORM public.cetica_evento(m.denuncia_id, m.ciclo_id, _medida, 'presidencia',
      CASE WHEN v_adv IS NULL THEN 'Parecer aprovado (sem medida a aplicar)'
           ELSE format('Medida aprovada e encaminhada ao Jurídico: %s (solicitação #%s)', m.medida_rotulo, v_adv) END,
      v_texto);
    IF v_adv IS NOT NULL THEN
      PERFORM public.jur_notificar(public.jur_quem_tem('juridico_recebidos_presidencia', 'visualizar'),
        'Recebido da presidência: medida para formalizar',
        format('Denúncia %s — %s%s. Veja em Advertências › Recebidos da presidência.',
               m.protocolo, m.medida_rotulo, coalesce(' · ' || v_colab, '')),
        'warning', '/app/juridico/advertencias?card=presidencia');
    END IF;
  END IF;

  PERFORM public.cetica_ciclo_fechar(m.ciclo_id);
  RETURN jsonb_build_object('medida_id', _medida, 'advertencia_id', v_adv,
    'ciclo_status', (SELECT status FROM public."COMITE_ETICA_PARECER_CICLO" WHERE id = m.ciclo_id));
END $$;

-- ── 6) Jurídico → supervisor do contrato ─────────────────────────────────
-- O que a tela mostra antes de encaminhar: o contrato achado e o supervisor.
CREATE OR REPLACE FUNCTION public.cetica_juridico_destino(_medida uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m     record;
  v_ctr uuid;
  v_nm  text;
  s     record;
BEGIN
  IF NOT public.cetica_juridico_ve() THEN
    RAISE EXCEPTION 'Sem acesso aos recebidos da presidência.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public."COMITE_ETICA_MEDIDA" WHERE id = _medida AND status = 'aprovada';
  IF NOT FOUND THEN RAISE EXCEPTION 'Medida não encontrada.'; END IF;
  v_ctr := coalesce(m.contrato_id, public.cetica_contrato_da_denuncia(m.denuncia_id));
  SELECT c.nome INTO v_nm FROM public.contratos c WHERE c.id = v_ctr;
  SELECT * INTO s FROM public.cetica_supervisor_do_contrato(v_ctr);
  RETURN jsonb_build_object(
    'contrato_id', v_ctr, 'contrato_nome', v_nm,
    'supervisor_nome', s.nome, 'supervisor_tem_login', s.user_id IS NOT NULL);
END $$;

-- Quando o contrato não foi achado sozinho: os contratos que têm supervisor.
CREATE OR REPLACE FUNCTION public.cetica_contratos_com_supervisor(_busca text DEFAULT NULL)
RETURNS TABLE (contrato_id uuid, contrato_nome text, supervisor_nome text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.cetica_juridico_ve() THEN
    RAISE EXCEPTION 'Sem acesso aos recebidos da presidência.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.nome, e."Nome"
    FROM public."OPE_ORG_CONTRATO" o
    JOIN public.contratos c ON c.id = o.contrato_id
    JOIN public."EMPREGADOS" e ON e."ID" = o.supervisor_id
   WHERE coalesce(e."Situação", '') <> 'Demitido'
     AND (coalesce(btrim(_busca), '') = '' OR c.nome ILIKE '%' || btrim(_busca) || '%')
   ORDER BY c.nome
   LIMIT 50;
END $$;

CREATE OR REPLACE FUNCTION public.cetica_juridico_encaminhar(
  _medida uuid, _orientacoes text, _documento_path text DEFAULT NULL, _documento_nome text DEFAULT NULL,
  _contrato uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m      record;
  v_ctr  uuid;
  v_cnm  text;
  s      record;
  v_item uuid;
  v_nome text := public.cetica_nome_usuario(auth.uid());
  v_ori  text := nullif(btrim(coalesce(_orientacoes, '')), '');
  v_doc  text := nullif(btrim(coalesce(_documento_path, '')), '');
BEGIN
  IF NOT (public.cetica_juridico_ve() AND public.cetica_juridico_encaminha()) THEN
    RAISE EXCEPTION 'Você não tem a permissão "Encaminhar ao supervisor do contrato".' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public."COMITE_ETICA_MEDIDA" WHERE id = _medida FOR UPDATE;
  IF NOT FOUND OR m.status <> 'aprovada' OR m.medida = 'nenhuma' THEN
    RAISE EXCEPTION 'Medida não encontrada ou não aprovada pela Presidência.';
  END IF;
  IF EXISTS (SELECT 1 FROM public."COMITE_ETICA_MEDIDA_SUPERVISOR" WHERE medida_id = _medida) THEN
    RAISE EXCEPTION 'Esta medida já foi encaminhada ao supervisor.';
  END IF;
  IF v_ori IS NULL THEN RAISE EXCEPTION 'Escreva as orientações ao supervisor.'; END IF;
  -- O arquivo tem que estar na pasta desta medida (é o que a RLS do storage confere).
  IF v_doc IS NOT NULL AND v_doc NOT LIKE _medida::text || '/documento/%' THEN
    RAISE EXCEPTION 'Documento fora da pasta da medida.';
  END IF;

  v_ctr := coalesce(_contrato, m.contrato_id, public.cetica_contrato_da_denuncia(m.denuncia_id));
  IF v_ctr IS NULL THEN
    RAISE EXCEPTION 'Não foi possível identificar o contrato da denúncia %. Escolha o contrato.', m.protocolo;
  END IF;
  SELECT c.nome INTO v_cnm FROM public.contratos c WHERE c.id = v_ctr;
  SELECT * INTO s FROM public.cetica_supervisor_do_contrato(v_ctr);
  IF s.empregado_id IS NULL THEN
    RAISE EXCEPTION 'O contrato % não tem supervisor no Organograma Operacional. Defina o supervisor em Operacional › Organograma.', coalesce(v_cnm, '—');
  END IF;
  IF s.user_id IS NULL THEN
    RAISE EXCEPTION 'O supervisor % (contrato %) não tem login no ERP.', s.nome, coalesce(v_cnm, '—');
  END IF;

  INSERT INTO public."COMITE_ETICA_MEDIDA_SUPERVISOR"
    (medida_id, denuncia_id, protocolo, contrato_id, contrato_nome, supervisor_empregado_id, supervisor_user_id,
     supervisor_nome, colaborador_nome, medida_rotulo, aprovado_em, orientacoes, documento_path, documento_nome,
     encaminhado_por, encaminhado_por_nome)
  VALUES (_medida, m.denuncia_id, m.protocolo, v_ctr, v_cnm, s.empregado_id, s.user_id,
          s.nome, m.colaborador_nome, m.medida_rotulo, m.decidido_em, v_ori, v_doc,
          CASE WHEN v_doc IS NULL THEN NULL ELSE coalesce(nullif(btrim(_documento_nome), ''), 'documento') END,
          auth.uid(), v_nome)
  RETURNING id INTO v_item;

  UPDATE public."COMITE_ETICA_MEDIDA" SET contrato_id = v_ctr WHERE id = _medida;
  IF m.advertencia_id IS NOT NULL THEN
    UPDATE public."SISTEMA_SOLICITACOES_ADVERTENCIA"
       SET status = 'Concluída', resultado = 'Encaminhada ao supervisor do contrato',
           parecer_juridico = v_ori, concluido_por_nome = v_nome, contrato = coalesce(v_cnm, contrato)
     WHERE id = m.advertencia_id;
  END IF;

  PERFORM public.cetica_evento(m.denuncia_id, m.ciclo_id, _medida, 'juridico',
    format('Jurídico encaminhou ao supervisor %s (contrato %s)', s.nome, coalesce(v_cnm, '—')),
    CASE WHEN v_doc IS NULL THEN 'Sem documento anexo' ELSE 'Documento: ' || coalesce(_documento_nome, 'documento') END);
  PERFORM public.jur_notificar(ARRAY[s.user_id],
    'Recebido do jurídico: medida para aplicar',
    format('%s%s — contrato %s. Registre a aplicação em Advertências › Recebido do jurídico.',
           m.medida_rotulo, coalesce(' · ' || m.colaborador_nome, ''), coalesce(v_cnm, '—')),
    'warning', '/app/juridico/advertencias?card=supervisor');
  PERFORM public.jur_notificar(public.cetica_quem_acompanha(m.denuncia_id),
    'Jurídico encaminhou a medida ao supervisor',
    format('Denúncia %s — %s · supervisor %s.', m.protocolo, m.medida_rotulo, s.nome),
    'info', '/app/comite-etica/denuncias?denuncia=' || m.denuncia_id);
  RETURN v_item;
END $$;

-- ── 7) Supervisor registra a aplicação ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.cetica_supervisor_registrar_aplicacao(
  _item uuid, _data date, _comprovante_path text DEFAULT NULL, _comprovante_nome text DEFAULT NULL,
  _obs text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  it      record;
  v_nome  text := public.cetica_nome_usuario(auth.uid());
  v_comp  text := nullif(btrim(coalesce(_comprovante_path, '')), '');
  v_falta integer;
BEGIN
  SELECT * INTO it FROM public."COMITE_ETICA_MEDIDA_SUPERVISOR" WHERE id = _item FOR UPDATE;
  IF NOT FOUND OR NOT public.cetica_sou_supervisor(it.contrato_id, it.supervisor_user_id) THEN
    RAISE EXCEPTION 'Este item não está no seu painel.' USING ERRCODE = '42501';
  END IF;
  IF it.status = 'aplicada' THEN RAISE EXCEPTION 'A aplicação já foi registrada.'; END IF;
  IF _data IS NULL THEN RAISE EXCEPTION 'Informe a data da aplicação.'; END IF;
  IF _data > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A data da aplicação não pode ser futura.';
  END IF;
  IF v_comp IS NOT NULL AND v_comp NOT LIKE it.medida_id::text || '/comprovante/%' THEN
    RAISE EXCEPTION 'Comprovante fora da pasta da medida.';
  END IF;

  UPDATE public."COMITE_ETICA_MEDIDA_SUPERVISOR"
     SET status = 'aplicada', aplicada_em = _data, aplicacao_obs = nullif(btrim(coalesce(_obs, '')), ''),
         comprovante_path = v_comp,
         comprovante_nome = CASE WHEN v_comp IS NULL THEN NULL ELSE coalesce(nullif(btrim(_comprovante_nome), ''), 'comprovante') END,
         registrado_por = auth.uid(), registrado_por_nome = v_nome, registrado_em = now()
   WHERE id = _item;

  PERFORM public.cetica_evento(it.denuncia_id, NULL, it.medida_id, 'supervisor',
    format('Aplicação registrada pelo supervisor: %s em %s', it.medida_rotulo, to_char(_data, 'DD/MM/YYYY')),
    concat_ws(' · ', CASE WHEN v_comp IS NULL THEN 'sem comprovante' ELSE 'com comprovante' END,
              nullif(btrim(coalesce(_obs, '')), '')));

  -- Todas as medidas aprovadas já aplicadas? Avisa o Comitê que dá para concluir.
  SELECT count(*) INTO v_falta
    FROM public."COMITE_ETICA_MEDIDA" md
    LEFT JOIN public."COMITE_ETICA_MEDIDA_SUPERVISOR" sp ON sp.medida_id = md.id
   WHERE md.denuncia_id = it.denuncia_id AND md.status = 'aprovada' AND md.medida <> 'nenhuma'
     AND coalesce(sp.status, '') <> 'aplicada';
  PERFORM public.jur_notificar(public.cetica_quem_acompanha(it.denuncia_id),
    CASE WHEN v_falta = 0 THEN 'Cumprimento concluído — todas as medidas aplicadas' ELSE 'Medida aplicada pelo supervisor' END,
    format('Denúncia %s — %s aplicada em %s.%s', it.protocolo, it.medida_rotulo, to_char(_data, 'DD/MM/YYYY'),
           CASE WHEN v_falta = 0 THEN ' A denúncia pode ser concluída.' ELSE format(' Faltam %s.', v_falta) END),
    'success', '/app/comite-etica/denuncias?denuncia=' || it.denuncia_id);
END $$;

-- ── 8) Grants das funções ────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.cetica_nome_usuario(uuid)',
    'public.cetica_supervisor_do_contrato(uuid)',
    'public.cetica_contrato_da_denuncia(uuid)',
    'public.cetica_quem_acompanha(uuid)',
    'public.cetica_evento(uuid, uuid, uuid, text, text, text)',
    'public.cetica_denuncia_situacao(uuid, text, text)',
    'public.cetica_ciclo_abrir(uuid, text)',
    'public.cetica_ciclo_fechar(uuid)',
    'public.cetica_parecer_final_trg()'
  ] LOOP
    -- Internas: só as RPCs abaixo (DEFINER) chamam.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.cetica_medida_rotulo(text)',
    'public.cetica_pode_decidir()',
    'public.cetica_juridico_ve()',
    'public.cetica_juridico_encaminha()',
    'public.cetica_sou_supervisor(uuid, uuid)',
    'public.cetica_parecer_enviar(uuid)',
    'public.cetica_medida_decidir(uuid, boolean, text, text, boolean, bigint, text)',
    'public.cetica_juridico_destino(uuid)',
    'public.cetica_contratos_com_supervisor(text)',
    'public.cetica_juridico_encaminhar(uuid, text, text, text, uuid)',
    'public.cetica_supervisor_registrar_aplicacao(uuid, date, text, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- ── 9) RLS das tabelas novas ─────────────────────────────────────────────
ALTER TABLE public."COMITE_ETICA_PARECER_CICLO"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."COMITE_ETICA_MEDIDA"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."COMITE_ETICA_MEDIDA_SUPERVISOR"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."COMITE_ETICA_MEDIDA_EVENTO"      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."COMITE_ETICA_PARECER_CICLO", public."COMITE_ETICA_MEDIDA",
              public."COMITE_ETICA_MEDIDA_SUPERVISOR", public."COMITE_ETICA_MEDIDA_EVENTO" FROM PUBLIC, anon;
-- Só leitura: quem escreve são as RPCs.
GRANT SELECT ON public."COMITE_ETICA_PARECER_CICLO", public."COMITE_ETICA_MEDIDA",
                public."COMITE_ETICA_MEDIDA_SUPERVISOR", public."COMITE_ETICA_MEDIDA_EVENTO" TO authenticated;

-- Ciclo (com o texto do parecer): só quem enxerga o caso.
DROP POLICY IF EXISTS cetica_ciclo_select ON public."COMITE_ETICA_PARECER_CICLO";
CREATE POLICY cetica_ciclo_select ON public."COMITE_ETICA_PARECER_CICLO" FOR SELECT TO authenticated
  USING (public.canal_denuncia_documento_pode_ler(denuncia_id));

-- Medida: quem enxerga o caso; o Jurídico, só as aprovadas que vão a ele.
DROP POLICY IF EXISTS cetica_medida_select ON public."COMITE_ETICA_MEDIDA";
CREATE POLICY cetica_medida_select ON public."COMITE_ETICA_MEDIDA" FOR SELECT TO authenticated
  USING (public.canal_denuncia_documento_pode_ler(denuncia_id)
         OR (status = 'aprovada' AND medida <> 'nenhuma' AND (SELECT public.cetica_juridico_ve())));

-- Item do supervisor: o próprio supervisor (do contrato), o Jurídico e quem
-- enxerga o caso. Não tem conteúdo da denúncia — é a única tabela deste
-- fluxo que o supervisor lê.
DROP POLICY IF EXISTS cetica_sup_select ON public."COMITE_ETICA_MEDIDA_SUPERVISOR";
CREATE POLICY cetica_sup_select ON public."COMITE_ETICA_MEDIDA_SUPERVISOR" FOR SELECT TO authenticated
  USING (public.cetica_sou_supervisor(contrato_id, supervisor_user_id)
         OR (SELECT public.cetica_juridico_ve())
         OR public.canal_denuncia_documento_pode_ler(denuncia_id));

-- Trilha: quem enxerga o caso; o Jurídico, a das medidas que recebeu.
DROP POLICY IF EXISTS cetica_evento_select ON public."COMITE_ETICA_MEDIDA_EVENTO";
CREATE POLICY cetica_evento_select ON public."COMITE_ETICA_MEDIDA_EVENTO" FOR SELECT TO authenticated
  USING (public.canal_denuncia_documento_pode_ler(denuncia_id)
         OR (medida_id IS NOT NULL AND (SELECT public.cetica_juridico_ve())
             AND EXISTS (SELECT 1 FROM public."COMITE_ETICA_MEDIDA" md
                          WHERE md.id = medida_id AND md.status = 'aprovada' AND md.medida <> 'nenhuma')));

-- ── 10) Advertência com sigilo de denúncia ───────────────────────────────
-- Linhas comuns: a mesma regra de antes (mig 124 e 3vias), sem tirar nada de
-- ninguém. Linhas da denúncia: Jurídico do card, a presidente que pediu e
-- quem enxerga o caso.
DROP POLICY IF EXISTS adv_select ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE POLICY adv_select ON public."SISTEMA_SOLICITACOES_ADVERTENCIA" FOR SELECT TO authenticated
USING (
  -- (SELECT ...) no que não depende da linha: avaliado uma vez (Guardião M1).
  CASE WHEN canal_denuncia_id IS NULL THEN
    (SELECT public.has_screen_access((SELECT auth.uid()), 'advertencias', 'visualizar'::app_acao))
    OR solicitante_email = (SELECT auth.email())
    OR public.eh_analista_advertencia(contrato_id)
  ELSE
    (SELECT public.cetica_juridico_ve())
    OR solicitante_email = (SELECT auth.email())
    OR public.canal_denuncia_documento_pode_ler(canal_denuncia_id)
  END
);

-- Linha da denúncia só é escrita pelas RPCs (encaminhar ao supervisor).
DROP POLICY IF EXISTS adv_insert ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE POLICY adv_insert ON public."SISTEMA_SOLICITACOES_ADVERTENCIA" FOR INSERT TO authenticated
WITH CHECK (
  canal_denuncia_id IS NULL
  AND (solicitante_email = (SELECT auth.email())
       OR (SELECT public.has_screen_access((SELECT auth.uid()), 'advertencias', 'incluir'::app_acao)))
);

DROP POLICY IF EXISTS adv_update ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE POLICY adv_update ON public."SISTEMA_SOLICITACOES_ADVERTENCIA" FOR UPDATE TO authenticated
USING (
  canal_denuncia_id IS NULL
  AND ((SELECT public.has_screen_access((SELECT auth.uid()), 'advertencias', 'alterar'::app_acao))
       OR (SELECT public.has_screen_access((SELECT auth.uid()), 'advertencias', 'aprovar'::app_acao))
       OR public.eh_analista_advertencia(contrato_id))
)
WITH CHECK (
  canal_denuncia_id IS NULL
  AND ((SELECT public.has_screen_access((SELECT auth.uid()), 'advertencias', 'alterar'::app_acao))
       OR (SELECT public.has_screen_access((SELECT auth.uid()), 'advertencias', 'aprovar'::app_acao))
       OR public.eh_analista_advertencia(contrato_id))
);

DROP POLICY IF EXISTS adv_delete ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE POLICY adv_delete ON public."SISTEMA_SOLICITACOES_ADVERTENCIA" FOR DELETE TO authenticated
USING (canal_denuncia_id IS NULL
       AND (SELECT public.has_screen_access((SELECT auth.uid()), 'advertencias', 'excluir'::app_acao)));

-- A presidente já decidiu: "já existe solicitação em aberto" não a trava, e
-- o sino de "nova advertência para aprovar" não toca (o aviso é o daqui).
DROP TRIGGER IF EXISTS trg_advertencia_sem_duplicidade ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE TRIGGER trg_advertencia_sem_duplicidade
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"
  FOR EACH ROW WHEN (NEW.canal_denuncia_id IS NULL)
  EXECUTE FUNCTION public.solicitacao_bloqueia_duplicada('advertencia');

DROP TRIGGER IF EXISTS trg_adv_notificar ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE TRIGGER trg_adv_notificar
  AFTER INSERT OR UPDATE OF status ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"
  FOR EACH ROW WHEN (NEW.canal_denuncia_id IS NULL)
  EXECUTE FUNCTION public.adv_notificar();

-- ── 11) Storage: documento do Jurídico e comprovante do supervisor ───────
-- Caminho: <medida_id>/documento/... e <medida_id>/comprovante/...
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('comite-etica-medidas', 'comite-etica-medidas', false, 20971520) -- 20 MB
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cetica_arquivo_pode(_nome text, _escrever boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_med   uuid;
  v_pasta text := split_part(coalesce(_nome, ''), '/', 2);
  m       record;
  it      record;
BEGIN
  BEGIN
    v_med := split_part(coalesce(_nome, ''), '/', 1)::uuid;
  EXCEPTION WHEN others THEN RETURN false;
  END;
  SELECT denuncia_id, status, medida INTO m FROM public."COMITE_ETICA_MEDIDA" WHERE id = v_med;
  IF NOT FOUND OR m.status <> 'aprovada' OR m.medida = 'nenhuma' THEN RETURN false; END IF;
  SELECT contrato_id, supervisor_user_id, status INTO it FROM public."COMITE_ETICA_MEDIDA_SUPERVISOR" WHERE medida_id = v_med;

  IF _escrever THEN
    IF v_pasta = 'documento' THEN
      RETURN public.cetica_juridico_ve() AND public.cetica_juridico_encaminha() AND it IS NULL;
    ELSIF v_pasta = 'comprovante' THEN
      RETURN it.contrato_id IS NOT NULL AND it.status = 'aguardando_aplicacao'
         AND public.cetica_sou_supervisor(it.contrato_id, it.supervisor_user_id);
    END IF;
    RETURN false;
  END IF;

  RETURN public.cetica_juridico_ve()
      OR public.canal_denuncia_documento_pode_ler(m.denuncia_id)
      OR (it.contrato_id IS NOT NULL AND public.cetica_sou_supervisor(it.contrato_id, it.supervisor_user_id));
END $$;
REVOKE ALL ON FUNCTION public.cetica_arquivo_pode(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cetica_arquivo_pode(text, boolean) TO authenticated;

DROP POLICY IF EXISTS "comite etica medidas select" ON storage.objects;
CREATE POLICY "comite etica medidas select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'comite-etica-medidas' AND public.cetica_arquivo_pode(name, false));

DROP POLICY IF EXISTS "comite etica medidas insert" ON storage.objects;
CREATE POLICY "comite etica medidas insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'comite-etica-medidas' AND public.cetica_arquivo_pode(name, true));

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
-- SELECT codigo, rota, liberado_em FROM public.app_menu
--  WHERE codigo IN ('juridico_recebidos_presidencia','juridico_encaminhar_supervisor','advertencias_recebido_juridico');
-- SELECT c.nome, public.cetica_supervisor_do_contrato(c.id) FROM public.contratos c LIMIT 20;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP POLICY IF EXISTS "comite etica medidas insert" ON storage.objects;
-- DROP POLICY IF EXISTS "comite etica medidas select" ON storage.objects;
-- DROP FUNCTION IF EXISTS public.cetica_arquivo_pode(text, boolean);
-- DROP TRIGGER IF EXISTS trg_adv_notificar ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
-- CREATE TRIGGER trg_adv_notificar AFTER INSERT OR UPDATE OF status ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"
--   FOR EACH ROW EXECUTE FUNCTION public.adv_notificar();
-- DROP TRIGGER IF EXISTS trg_advertencia_sem_duplicidade ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
-- CREATE TRIGGER trg_advertencia_sem_duplicidade BEFORE INSERT ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"
--   FOR EACH ROW EXECUTE FUNCTION public.solicitacao_bloqueia_duplicada('advertencia');
-- Recriar adv_select/adv_update pela 20260930000124 e adv_insert/adv_delete pela 20260717190007.
-- DROP TRIGGER IF EXISTS trg_canal_denuncia_documento_zz_presidencia ON public."CANAL_DENUNCIA_DOCUMENTO";
-- DROP TABLE IF EXISTS public."COMITE_ETICA_MEDIDA_EVENTO", public."COMITE_ETICA_MEDIDA_SUPERVISOR",
--   public."COMITE_ETICA_MEDIDA", public."COMITE_ETICA_PARECER_CICLO";
-- ALTER TABLE public."SISTEMA_SOLICITACOES_ADVERTENCIA" DROP COLUMN IF EXISTS canal_denuncia_id;
-- DROP FUNCTION IF EXISTS public.cetica_supervisor_registrar_aplicacao(uuid, date, text, text, text),
--   public.cetica_juridico_encaminhar(uuid, text, text, text, uuid), public.cetica_contratos_com_supervisor(text),
--   public.cetica_juridico_destino(uuid), public.cetica_medida_decidir(uuid, boolean, text, text, boolean, bigint, text),
--   public.cetica_ciclo_fechar(uuid), public.cetica_parecer_final_trg(), public.cetica_parecer_enviar(uuid),
--   public.cetica_ciclo_abrir(uuid, text), public.cetica_denuncia_situacao(uuid, text, text),
--   public.cetica_evento(uuid, uuid, uuid, text, text, text), public.cetica_quem_acompanha(uuid),
--   public.cetica_contrato_da_denuncia(uuid), public.cetica_sou_supervisor(uuid, uuid),
--   public.cetica_supervisor_do_contrato(uuid), public.cetica_juridico_encaminha(), public.cetica_juridico_ve(),
--   public.cetica_pode_decidir(), public.cetica_medida_rotulo(text), public.cetica_nome_usuario(uuid);
-- DELETE FROM public.screen_permission_user WHERE motivo LIKE 'SIS-2026-0957:%';
-- DELETE FROM public.app_menu WHERE codigo IN ('juridico_recebidos_presidencia','juridico_encaminhar_supervisor','advertencias_recebido_juridico');
-- NOTIFY pgrst, 'reload schema';
