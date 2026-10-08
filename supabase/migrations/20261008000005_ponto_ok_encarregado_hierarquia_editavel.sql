-- =========================================================================
-- PONTO DOS ENCARREGADOS POR CONTRATO + HIERARQUIA EDITÁVEL (08/10/2026)
--
-- PEDIDO (Pablo, sobre a 20261007000023 e a 20261007000024):
--   "na conferência de ponto do encarregado, ele só vai ver o seu contrato.
--    No contrato de UFFS CHAPECÓ, apenas o responsável pelo contrato vai
--    poder encaminhar para o operacional — no caso, apenas o Idalécio.
--    Vamos permitir o operacional enviar ao RH mesmo os encarregados não
--    aprovando: ele vai poder marcar como OK do Encarregado e depois ENVIAR
--    PARA RH. Se o encarregado marcar como OK, fica no histórico e aparece
--    pro operacional 'OK do (encarregado tal)'.
--    E tem que ser possível editar a hierarquia, trocar os encarregados etc.,
--    tudo conectado com a EMPREGADOS — as pessoas selecionadas, nada
--    digitado."
--
-- RESPONSÁVEL PELO CONTRATO = sai da Hierarquia de Postos, não de cadastro
-- à parte. Para cada posto do contrato que está na árvore, o responsável é
-- o líder OCUPADO mais próximo ACIMA dele (posto vago passa a bola para
-- cima). Contam primeiro os postos de execução ocupados; os postos de
-- liderança do contrato só entram se ele não tiver nenhum — senão o posto
-- do próprio encarregado (que fica no contrato) tornaria o chefe dele
-- responsável também. Conferido em 08/10/2026 com UFFS CHAPECÓ: os 9 postos
-- de execução dela na árvore estão abaixo do PO-00029 ENCARREGADO → só
-- IDALECIO CARDOSO COSTA. No total, 52 contratos com responsável (1 com
-- mais de um) e 12 ativos sem nenhum (aparecem nas Pendências da tela).
--
-- TROCAR PESSOAS NOS POSTOS: EMPREGADOS."Posto" é da Senior e a sincronia
-- reescreve (mig 275) — gravar lá seria desfeito na próxima carga. O ajuste
-- do ERP mora em RH_POSTO_OCUPANTE_ERP (uma linha por empregado; posto NULL
-- = tirado de qualquer posto). Posto efetivo = o do ERP se houver ajuste,
-- senão o da Senior. Vale para a Hierarquia, a "minha área" e o ponto; a
-- tela Ativos/Contratos continua lendo a Senior.
--
-- OK DO ENCARREGADO: três colunas na linha do contrato/mês
-- (SISTEMA_CONFERENCIA_PONTO). O envio do encarregado preenche; o
-- Operacional (quem aprova contrato, ponto_aprovar_contrato) pode preencher
-- no lugar dele — fica marcado que foi o Operacional. Devolver o envio
-- limpa o OK do encarregado.
--
-- Nenhuma permissão nova. Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Ajuste de ocupante no ERP ─────────────────────────────────────────
-- Sem FK para EMPREGADOS: a limpeza de duplicados e a sincronia apagam
-- linhas de lá, e um ajuste órfão só deixa de casar (não pode travar a carga).
CREATE TABLE IF NOT EXISTS public."RH_POSTO_OCUPANTE_ERP" (
  empregado_id  bigint PRIMARY KEY,                                   -- EMPREGADOS."ID"
  posto_codigo  text REFERENCES public."RH_POSTO_TRABALHO"(codigo),   -- NULL = fora de qualquer posto
  posto_senior  text,                                                 -- o que a Senior dizia na hora
  motivo        text,
  alterado_por  text,
  alterado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_posto_ocup_erp_posto ON public."RH_POSTO_OCUPANTE_ERP"(posto_codigo);

ALTER TABLE public."RH_POSTO_OCUPANTE_ERP" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."RH_POSTO_OCUPANTE_ERP" FROM PUBLIC, anon;
GRANT SELECT ON public."RH_POSTO_OCUPANTE_ERP" TO authenticated;
DROP POLICY IF EXISTS rh_posto_ocup_erp_sel ON public."RH_POSTO_OCUPANTE_ERP";
CREATE POLICY rh_posto_ocup_erp_sel ON public."RH_POSTO_OCUPANTE_ERP" FOR SELECT TO authenticated USING (public.rh_hier_pode());

-- O histórico da hierarquia passa a guardar também troca de ocupante e de
-- vagas. tipo 'posto' usa pai_antes/pai_depois (como antes); 'ocupante' e
-- 'vagas' usam valor_antes/valor_depois.
ALTER TABLE public."RH_POSTO_HIERARQUIA_HIST" ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'posto';
ALTER TABLE public."RH_POSTO_HIERARQUIA_HIST" ADD COLUMN IF NOT EXISTS empregado_id bigint;
ALTER TABLE public."RH_POSTO_HIERARQUIA_HIST" ADD COLUMN IF NOT EXISTS empregado_nome text;
ALTER TABLE public."RH_POSTO_HIERARQUIA_HIST" ADD COLUMN IF NOT EXISTS valor_antes text;
ALTER TABLE public."RH_POSTO_HIERARQUIA_HIST" ADD COLUMN IF NOT EXISTS valor_depois text;
ALTER TABLE public."RH_POSTO_HIERARQUIA_HIST" DROP CONSTRAINT IF EXISTS rh_hier_hist_tipo;
ALTER TABLE public."RH_POSTO_HIERARQUIA_HIST" ADD CONSTRAINT rh_hier_hist_tipo CHECK (tipo IN ('posto', 'ocupante', 'vagas'));

-- ── 2) Ocupação efetiva (Senior + ajuste do ERP) ─────────────────────────
-- Interna: só as funções SECURITY DEFINER abaixo chamam.
CREATE OR REPLACE FUNCTION public.rh_hier_ocupacao()
RETURNS TABLE (empregado_id bigint, posto text, ajustado boolean, posto_senior text, auth_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e."ID",
         CASE WHEN a.empregado_id IS NOT NULL THEN a.posto_codigo ELSE e."Posto" END,
         a.empregado_id IS NOT NULL,
         e."Posto",
         e.auth_user_id
    FROM public."EMPREGADOS" e
    LEFT JOIN public."RH_POSTO_OCUPANTE_ERP" a ON a.empregado_id = e."ID"
   WHERE COALESCE(e."Situação", '') <> 'Demitido'
     AND COALESCE(e."Nome", '') NOT ILIKE '%teste%'
$$;
REVOKE ALL ON FUNCTION public.rh_hier_ocupacao() FROM PUBLIC, anon, authenticated;

-- ── 3) Responsáveis por contrato ─────────────────────────────────────────
-- Uma linha por (contrato, posto líder, ocupante). Regra no cabeçalho.
-- Camada 1 = postos de execução ocupados; 2 = postos de liderança
-- ocupados; 3 = qualquer posto do contrato na árvore. Vale a menor camada
-- que o contrato tiver.
CREATE OR REPLACE FUNCTION public.rh_hier_responsaveis()
RETURNS TABLE (empresa bigint, filial bigint, posto_lider text, empregado_id bigint, auth_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH RECURSIVE
  oc AS (SELECT o.empregado_id, o.posto, o.auth_user_id FROM public.rh_hier_ocupacao() o WHERE o.posto IS NOT NULL),
  lider AS (SELECT DISTINCT h.pai_codigo AS codigo FROM public."RH_POSTO_HIERARQUIA" h WHERE h.pai_codigo IS NOT NULL),
  anc AS (
    SELECT h.posto_codigo AS posto, h.pai_codigo AS ancestral, 1 AS dist
      FROM public."RH_POSTO_HIERARQUIA" h WHERE h.pai_codigo IS NOT NULL
    UNION ALL
    SELECT a.posto, h.pai_codigo, a.dist + 1
      FROM anc a JOIN public."RH_POSTO_HIERARQUIA" h ON h.posto_codigo = a.ancestral
     WHERE h.pai_codigo IS NOT NULL AND a.dist < 20
  ),
  -- O líder ocupado mais próximo acima de cada posto.
  resp AS (
    SELECT DISTINCT ON (a.posto) a.posto, a.ancestral
      FROM anc a
     WHERE EXISTS (SELECT 1 FROM oc WHERE oc.posto = a.ancestral)
     ORDER BY a.posto, a.dist
  ),
  pc AS (
    SELECT p.codigo, p.empresa::bigint AS empresa, p.filial::bigint AS filial,
           CASE WHEN EXISTS (SELECT 1 FROM oc WHERE oc.posto = p.codigo)
                THEN CASE WHEN p.codigo IN (SELECT codigo FROM lider) THEN 2 ELSE 1 END
                ELSE 3 END AS camada
      FROM public."RH_POSTO_TRABALHO" p
      JOIN public."RH_POSTO_HIERARQUIA" h ON h.posto_codigo = p.codigo
     WHERE p.ativo AND p.empresa IS NOT NULL AND p.filial IS NOT NULL
  ),
  cand AS (
    SELECT pc.empresa, pc.filial, r.ancestral AS posto_lider, pc.camada,
           min(pc.camada) OVER (PARTITION BY pc.empresa, pc.filial) AS melhor
      FROM pc JOIN resp r ON r.posto = pc.codigo
  )
  SELECT DISTINCT c.empresa, c.filial, c.posto_lider, oc.empregado_id, oc.auth_user_id
    FROM cand c JOIN oc ON oc.posto = c.posto_lider
   WHERE c.camada = c.melhor
$$;
REVOKE ALL ON FUNCTION public.rh_hier_responsaveis() FROM PUBLIC, anon, authenticated;

-- Os contratos de que o usuário logado é responsável (pelo login vinculado
-- ao cadastro dele em EMPREGADOS).
CREATE OR REPLACE FUNCTION public.ponto_enc_responsavel(_empresa bigint, _filial bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.rh_hier_responsaveis() r
     WHERE r.auth_user_id = auth.uid() AND r.empresa = _empresa AND r.filial = _filial)
$$;
REVOKE ALL ON FUNCTION public.ponto_enc_responsavel(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_enc_responsavel(bigint, bigint) TO authenticated;

-- Quem aprova contrato no Operacional (a mesma chave do "Aprovar e enviar ao RH").
CREATE OR REPLACE FUNCTION public.ponto_pode_aprovar_contrato()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.can_access(auth.uid(), 'ponto_aprovar_contrato', 'visualizar'::public.app_acao)
          OR public.can_access(auth.uid(), 'ponto_aprovar_contrato', 'alterar'::public.app_acao))
$$;
REVOKE ALL ON FUNCTION public.ponto_pode_aprovar_contrato() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_pode_aprovar_contrato() TO authenticated;

-- ── 4) OK do encarregado na linha do contrato/mês ────────────────────────
ALTER TABLE public."SISTEMA_CONFERENCIA_PONTO" ADD COLUMN IF NOT EXISTS ok_encarregado_por text;
ALTER TABLE public."SISTEMA_CONFERENCIA_PONTO" ADD COLUMN IF NOT EXISTS ok_encarregado_em timestamptz;
ALTER TABLE public."SISTEMA_CONFERENCIA_PONTO" ADD COLUMN IF NOT EXISTS ok_encarregado_pelo_operacional boolean NOT NULL DEFAULT false;

-- ── 5) Contexto do encarregado: só os contratos dele ─────────────────────
CREATE OR REPLACE FUNCTION public.ponto_enc_contexto()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (public.ponto_enc_eh_encarregado() OR public.ponto_enc_eh_operacional()) THEN
    RAISE EXCEPTION 'Sem acesso à Conferência de Ponto dos encarregados.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'eu', (SELECT jsonb_build_object('nome', e."Nome", 'empresa', e."Empresa", 'filial', e."Filial", 'posto', e."Nome do Posto")
             FROM public."EMPREGADOS" e WHERE e.auth_user_id = auth.uid()
            ORDER BY (e."Situação" = 'Trabalhando') DESC, e."ID" DESC LIMIT 1),
    'tem_cadastro', EXISTS (SELECT 1 FROM public."EMPREGADOS" e WHERE e.auth_user_id = auth.uid()),
    'contratos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('empresa', c."Empresa", 'filial', c."Filial", 'nome', c."NOME CONTRATO",
                                          'empresa_nome', c."NOME EMPRESA", 'postos_lider', m.postos) ORDER BY c."NOME CONTRATO")
        FROM (SELECT r.empresa, r.filial, array_agg(DISTINCT r.posto_lider) AS postos
                FROM public.rh_hier_responsaveis() r WHERE r.auth_user_id = auth.uid()
               GROUP BY r.empresa, r.filial) m
        JOIN public."CONTRATOS" c ON c."Empresa" = m.empresa AND c."Filial" = m.filial AND c."ATIVO" = 'SIM'), '[]'::jsonb),
    'relogio_ate', public.diaria_ponto_sincronizado_ate());
END $$;
REVOKE ALL ON FUNCTION public.ponto_enc_contexto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_enc_contexto() TO authenticated;

-- ── 6) Colaboradores do contrato: responsável ou Operacional ─────────────
-- Corpo igual ao da 20261007000023; muda só a trava de entrada.
CREATE OR REPLACE FUNCTION public.ponto_enc_colaboradores(p_empresa bigint, p_filial bigint, p_mes text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_de  date;
  v_ate date;
  v_lim date;
  v_relogio jsonb := '{}'::jsonb;
BEGIN
  IF NOT (public.ponto_enc_eh_operacional()
          OR (public.ponto_enc_eh_encarregado() AND public.ponto_enc_responsavel(p_empresa, p_filial))) THEN
    RAISE EXCEPTION 'Você não é o responsável por este contrato na Hierarquia de Postos.' USING ERRCODE = '42501';
  END IF;
  IF p_mes !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'Mês inválido.'; END IF;
  v_de  := (p_mes || '-01')::date;
  v_ate := (v_de + interval '1 month')::date - 1;
  v_lim := LEAST(v_ate, COALESCE(public.diaria_ponto_sincronizado_ate(), v_de - 1));

  IF to_regclass('espelho."BiMarcacoes"') IS NOT NULL AND v_lim >= v_de THEN
    BEGIN
      EXECUTE $q$
        SELECT COALESCE(jsonb_object_agg(cad::text, jsonb_build_object('dias', dias)), '{}'::jsonb)
          FROM (SELECT (m.matricula % 100000000) AS cad, array_agg(DISTINCT m.data_hora::date) AS dias
                  FROM espelho."BiMarcacoes" m
                 WHERE m.empresa = $1 AND m.data_hora >= $2 AND m.data_hora < $3 + 1
                 GROUP BY 1) x
      $q$ INTO v_relogio USING p_empresa::int, v_de, v_lim;
    EXCEPTION WHEN OTHERS THEN v_relogio := '{}'::jsonb;
    END;
  END IF;

  RETURN jsonb_build_object(
    'de', v_de, 'ate', v_ate, 'relogio_ate', CASE WHEN v_lim >= v_de THEN v_lim END,
    'colaboradores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'empregado_id', e."ID", 'nome', e."Nome", 'cadastro', e."Cadastro", 'cargo', e."Título do Cargo",
               'posto', e."Nome do Posto", 'situacao_senior', e."Situação",
               'dias_marcados', COALESCE(jsonb_array_length(v_relogio -> (e."Cadastro"::text) -> 'dias'), 0),
               'dias_uteis_sem_marcacao', CASE WHEN v_lim >= v_de THEN (
                  SELECT count(*) FROM generate_series(v_de, v_lim, interval '1 day') g
                   WHERE extract(isodow FROM g) < 6
                     AND NOT COALESCE((v_relogio -> (e."Cadastro"::text) -> 'dias') ? to_char(g, 'YYYY-MM-DD'), false)) END)
             ORDER BY e."Nome")
        FROM public."EMPREGADOS" e
       WHERE e."Empresa" = p_empresa AND e."Filial" = p_filial
         AND COALESCE(e."Situação", '') <> 'Demitido'
         AND COALESCE(e."Nome", '') NOT ILIKE '%teste%'), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.ponto_enc_colaboradores(bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_enc_colaboradores(bigint, bigint, text) TO authenticated;

-- ── 7) Salvar: só o responsável pelo contrato ────────────────────────────
CREATE OR REPLACE FUNCTION public.ponto_enc_salvar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id    bigint := NULLIF(p->>'id', '')::bigint;
  v_env   public."PONTO_ENVIO_ENCARREGADO"%ROWTYPE;
  v_nome  text := (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid());
  v_mes   text := p->>'mes_referencia';
  v_emp   bigint := (p->>'contrato_empresa')::bigint;
  v_fil   bigint := (p->>'contrato_filial')::bigint;
  v_posto text := COALESCE(btrim(p->>'posto'), '');
BEGIN
  IF NOT public.ponto_enc_eh_encarregado() THEN
    RAISE EXCEPTION 'Sem acesso para enviar ponto.' USING ERRCODE = '42501';
  END IF;

  IF v_id IS NULL THEN
    IF v_mes !~ '^\d{4}-\d{2}$' OR v_emp IS NULL OR v_fil IS NULL THEN
      RAISE EXCEPTION 'Informe o mês e o contrato.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public."CONTRATOS" WHERE "Empresa" = v_emp AND "Filial" = v_fil AND "ATIVO" = 'SIM') THEN
      RAISE EXCEPTION 'Contrato não encontrado entre os ativos.';
    END IF;
    IF NOT public.ponto_enc_responsavel(v_emp, v_fil) THEN
      RAISE EXCEPTION 'Você não é o responsável por este contrato na Hierarquia de Postos.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_env FROM public."PONTO_ENVIO_ENCARREGADO"
     WHERE mes_referencia = v_mes AND contrato_empresa = v_emp AND contrato_filial = v_fil
       AND encarregado_id = auth.uid() AND posto = v_posto;
    IF NOT FOUND THEN
      INSERT INTO public."PONTO_ENVIO_ENCARREGADO"
        (mes_referencia, contrato_empresa, contrato_filial, contrato_nome, posto, encarregado_id, encarregado_nome, observacao)
      VALUES (v_mes, v_emp, v_fil,
              (SELECT "NOME CONTRATO" FROM public."CONTRATOS" WHERE "Empresa" = v_emp AND "Filial" = v_fil AND "ATIVO" = 'SIM' LIMIT 1),
              v_posto, auth.uid(), v_nome, NULLIF(btrim(p->>'observacao'), ''))
      RETURNING * INTO v_env;
      INSERT INTO public."PONTO_ENVIO_EVENTO" (envio_id, acao, para_status, autor_nome)
      VALUES (v_env.id, 'criado', 'rascunho', v_nome);
    END IF;
    v_id := v_env.id;
  ELSE
    SELECT * INTO v_env FROM public."PONTO_ENVIO_ENCARREGADO" WHERE id = v_id FOR UPDATE;
    IF NOT FOUND OR v_env.encarregado_id <> auth.uid() THEN RAISE EXCEPTION 'Envio não encontrado.'; END IF;
    IF NOT public.ponto_enc_responsavel(v_env.contrato_empresa, v_env.contrato_filial) THEN
      RAISE EXCEPTION 'Você não é mais o responsável por este contrato na Hierarquia de Postos.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_env.status NOT IN ('rascunho', 'devolvido') THEN
    RAISE EXCEPTION 'Este envio já foi % — não dá mais para alterar.', v_env.status;
  END IF;

  UPDATE public."PONTO_ENVIO_ENCARREGADO" SET observacao = NULLIF(btrim(p->>'observacao'), '') WHERE id = v_id;

  IF p ? 'itens' THEN
    DELETE FROM public."PONTO_ENVIO_ITEM" WHERE envio_id = v_id;
    INSERT INTO public."PONTO_ENVIO_ITEM"
      (envio_id, empregado_id, nome, cadastro, cargo, posto, situacao, faltas, atrasos, horas_extras, dias_marcados, dias_sem_marcacao, observacao)
    SELECT v_id, NULLIF(i->>'empregado_id', '')::bigint, btrim(i->>'nome'), NULLIF(i->>'cadastro', '')::bigint,
           NULLIF(i->>'cargo', ''), NULLIF(i->>'posto', ''), COALESCE(NULLIF(i->>'situacao', ''), 'ok'),
           GREATEST(COALESCE(NULLIF(i->>'faltas', '')::int, 0), 0), GREATEST(COALESCE(NULLIF(i->>'atrasos', '')::int, 0), 0),
           NULLIF(btrim(i->>'horas_extras'), ''), NULLIF(i->>'dias_marcados', '')::int, NULLIF(i->>'dias_sem_marcacao', '')::int,
           NULLIF(btrim(i->>'observacao'), '')
      FROM jsonb_array_elements(p->'itens') AS i
     WHERE btrim(coalesce(i->>'nome', '')) <> '';
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.ponto_enc_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_enc_salvar(jsonb) TO authenticated;

-- ── 8) Enviar = OK do encarregado ────────────────────────────────────────
-- Além do que já fazia, grava o OK na linha do contrato. Se o Operacional
-- tinha dado o OK no lugar dele, o do encarregado substitui (é o que vale).
CREATE OR REPLACE FUNCTION public.ponto_enc_enviar(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_env  public."PONTO_ENVIO_ENCARREGADO"%ROWTYPE;
  v_nome text := (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid());
  v_scp  public."SISTEMA_CONFERENCIA_PONTO"%ROWTYPE;
  v_obs  text;
BEGIN
  SELECT * INTO v_env FROM public."PONTO_ENVIO_ENCARREGADO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_env.encarregado_id <> auth.uid() OR NOT public.ponto_enc_eh_encarregado() THEN
    RAISE EXCEPTION 'Envio não encontrado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.ponto_enc_responsavel(v_env.contrato_empresa, v_env.contrato_filial) THEN
    RAISE EXCEPTION 'Só o responsável pelo contrato na Hierarquia de Postos pode dar o OK.' USING ERRCODE = '42501';
  END IF;
  IF v_env.status NOT IN ('rascunho', 'devolvido') THEN RAISE EXCEPTION 'Este envio já foi %.', v_env.status; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."PONTO_ENVIO_ITEM" WHERE envio_id = p_id) THEN
    RAISE EXCEPTION 'Confira ao menos um colaborador antes de enviar.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."PONTO_ENVIO_ANEXO" WHERE envio_id = p_id) THEN
    RAISE EXCEPTION 'Anexe a folha/espelho de ponto antes de enviar.';
  END IF;

  UPDATE public."PONTO_ENVIO_ENCARREGADO"
     SET status = 'enviado', enviado_em = now(), devolucao_motivo = NULL
   WHERE id = p_id;
  INSERT INTO public."PONTO_ENVIO_EVENTO" (envio_id, acao, de_status, para_status, autor_nome)
  VALUES (p_id, 'enviado', v_env.status, 'enviado', v_nome);

  v_obs := 'OK do encarregado ' || coalesce(v_nome, '') || ' (ponto enviado)';
  SELECT * INTO v_scp FROM public."SISTEMA_CONFERENCIA_PONTO"
   WHERE contrato_empresa = v_env.contrato_empresa AND contrato_filial = v_env.contrato_filial
     AND mes_referencia = v_env.mes_referencia FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public."SISTEMA_CONFERENCIA_PONTO"
      (contrato_empresa, contrato_filial, contrato_nome, mes_referencia, status, atualizado_por,
       ok_encarregado_por, ok_encarregado_em, ok_encarregado_pelo_operacional)
    VALUES (v_env.contrato_empresa, v_env.contrato_filial, v_env.contrato_nome, v_env.mes_referencia, 'Pendente Operacional', v_nome,
            v_nome, now(), false)
    RETURNING * INTO v_scp;
    INSERT INTO public."SISTEMA_CONFERENCIA_PONTO_EVENTOS" (conferencia_id, acao, de_status, para_status, observacao, usuario_nome)
    VALUES (v_scp.id, 'ok_encarregado', 'Pendente Encarregados', 'Pendente Operacional', v_obs, v_nome);
  ELSE
    UPDATE public."SISTEMA_CONFERENCIA_PONTO"
       SET status = CASE WHEN status = 'Pendente Encarregados' THEN 'Pendente Operacional' ELSE status END,
           atualizado_por = v_nome,
           ok_encarregado_por = v_nome, ok_encarregado_em = now(), ok_encarregado_pelo_operacional = false
     WHERE id = v_scp.id;
    INSERT INTO public."SISTEMA_CONFERENCIA_PONTO_EVENTOS" (conferencia_id, acao, de_status, para_status, observacao, usuario_nome)
    VALUES (v_scp.id, 'ok_encarregado', v_scp.status,
            CASE WHEN v_scp.status = 'Pendente Encarregados' THEN 'Pendente Operacional' ELSE v_scp.status END,
            v_obs || CASE WHEN v_scp.ok_encarregado_pelo_operacional THEN ' — substitui o OK marcado pelo Operacional (' || coalesce(v_scp.ok_encarregado_por, '') || ')' ELSE '' END,
            v_nome);
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.ponto_enc_enviar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_enc_enviar(bigint) TO authenticated;

-- ── 9) Operacional recebe ou devolve — devolver tira o OK ────────────────
CREATE OR REPLACE FUNCTION public.ponto_enc_decidir(p_id bigint, p_acao text, p_motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_env  public."PONTO_ENVIO_ENCARREGADO"%ROWTYPE;
  v_nome text := (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid());
  v_mot  text := NULLIF(btrim(coalesce(p_motivo, '')), '');
  v_scp  public."SISTEMA_CONFERENCIA_PONTO"%ROWTYPE;
BEGIN
  IF NOT public.ponto_enc_pode_receber() THEN
    RAISE EXCEPTION 'Sem permissão para receber/devolver o ponto dos encarregados.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_env FROM public."PONTO_ENVIO_ENCARREGADO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envio não encontrado.'; END IF;
  IF v_env.status <> 'enviado' THEN RAISE EXCEPTION 'Só envio "enviado" pode ser recebido ou devolvido (está %).', v_env.status; END IF;

  IF p_acao = 'receber' THEN
    UPDATE public."PONTO_ENVIO_ENCARREGADO" SET status = 'recebido', recebido_por = v_nome, recebido_em = now() WHERE id = p_id;
    INSERT INTO public."PONTO_ENVIO_EVENTO" (envio_id, acao, de_status, para_status, observacao, autor_nome)
    VALUES (p_id, 'recebido', 'enviado', 'recebido', v_mot, v_nome);
  ELSIF p_acao = 'devolver' THEN
    IF v_mot IS NULL THEN RAISE EXCEPTION 'Informe o motivo da devolução.'; END IF;
    UPDATE public."PONTO_ENVIO_ENCARREGADO"
       SET status = 'devolvido', devolvido_por = v_nome, devolvido_em = now(), devolucao_motivo = v_mot
     WHERE id = p_id;
    INSERT INTO public."PONTO_ENVIO_EVENTO" (envio_id, acao, de_status, para_status, observacao, autor_nome)
    VALUES (p_id, 'devolvido', 'enviado', 'devolvido', v_mot, v_nome);
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    VALUES (v_env.encarregado_id, 'Ponto devolvido pelo Operacional',
            coalesce(v_env.contrato_nome, 'Contrato') || ' — ' || v_env.mes_referencia || '. Motivo: ' || v_mot || '. Corrija e reenvie.',
            'ponto_envio_devolvido', '/app/encarregados/conferencia-ponto?envio=' || p_id);

    -- Devolvido = o encarregado ainda não deu o OK. Se o contrato ainda
    -- está na mão do Operacional, volta para "Pendente Encarregados".
    SELECT * INTO v_scp FROM public."SISTEMA_CONFERENCIA_PONTO"
     WHERE contrato_empresa = v_env.contrato_empresa AND contrato_filial = v_env.contrato_filial
       AND mes_referencia = v_env.mes_referencia FOR UPDATE;
    IF FOUND AND NOT v_scp.ok_encarregado_pelo_operacional AND v_scp.ok_encarregado_em IS NOT NULL THEN
      UPDATE public."SISTEMA_CONFERENCIA_PONTO"
         SET ok_encarregado_por = NULL, ok_encarregado_em = NULL,
             status = CASE WHEN status = 'Pendente Operacional' THEN 'Pendente Encarregados' ELSE status END,
             atualizado_por = v_nome
       WHERE id = v_scp.id;
      INSERT INTO public."SISTEMA_CONFERENCIA_PONTO_EVENTOS" (conferencia_id, acao, de_status, para_status, observacao, usuario_nome)
      VALUES (v_scp.id, 'ok_encarregado_devolvido', v_scp.status,
              CASE WHEN v_scp.status = 'Pendente Operacional' THEN 'Pendente Encarregados' ELSE v_scp.status END,
              'Ponto devolvido ao encarregado ' || coalesce(v_env.encarregado_nome, '') || ': ' || v_mot, v_nome);
    END IF;
  ELSE
    RAISE EXCEPTION 'Ação inválida.';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.ponto_enc_decidir(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_enc_decidir(bigint, text, text) TO authenticated;

-- ── 10) Operacional marca o OK no lugar do encarregado ───────────────────
-- Só enquanto o contrato está na etapa do Operacional (as mesmas origens do
-- "Aprovar e enviar ao RH"). Cria a linha do mês se ainda não existe.
CREATE OR REPLACE FUNCTION public.ponto_ok_encarregado_operacional(p_empresa bigint, p_filial bigint, p_mes text, p_observacao text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_nome text := (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid());
  v_scp  public."SISTEMA_CONFERENCIA_PONTO"%ROWTYPE;
  v_para text;
  v_obs  text;
BEGIN
  IF NOT public.ponto_pode_aprovar_contrato() THEN
    RAISE EXCEPTION 'Sem permissão: é preciso poder aprovar contrato na Conferência de Ponto.' USING ERRCODE = '42501';
  END IF;
  IF p_mes !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'Mês inválido.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."CONTRATOS" WHERE "Empresa" = p_empresa AND "Filial" = p_filial AND "ATIVO" = 'SIM') THEN
    RAISE EXCEPTION 'Contrato não encontrado entre os ativos.';
  END IF;
  v_obs := 'OK do encarregado marcado pelo Operacional (' || coalesce(v_nome, '') || ') — o encarregado não enviou'
           || COALESCE('. ' || NULLIF(btrim(coalesce(p_observacao, '')), ''), '');

  SELECT * INTO v_scp FROM public."SISTEMA_CONFERENCIA_PONTO"
   WHERE contrato_empresa = p_empresa AND contrato_filial = p_filial AND mes_referencia = p_mes FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public."SISTEMA_CONFERENCIA_PONTO"
      (contrato_empresa, contrato_filial, contrato_nome, mes_referencia, status, atualizado_por,
       ok_encarregado_por, ok_encarregado_em, ok_encarregado_pelo_operacional)
    VALUES (p_empresa, p_filial,
            (SELECT "NOME CONTRATO" FROM public."CONTRATOS" WHERE "Empresa" = p_empresa AND "Filial" = p_filial AND "ATIVO" = 'SIM' LIMIT 1),
            p_mes, 'Pendente Operacional', v_nome, v_nome, now(), true)
    RETURNING * INTO v_scp;
    INSERT INTO public."SISTEMA_CONFERENCIA_PONTO_EVENTOS" (conferencia_id, acao, de_status, para_status, observacao, usuario_nome)
    VALUES (v_scp.id, 'ok_encarregado_operacional', 'Pendente Encarregados', 'Pendente Operacional', v_obs, v_nome);
    RETURN;
  END IF;

  IF v_scp.status NOT IN ('Pendente Encarregados', 'Pendente Operacional', 'Em Andamento Operacional', 'Devolvido Operacional', 'Problema') THEN
    RAISE EXCEPTION 'O contrato já saiu do Operacional (está %).', v_scp.status;
  END IF;
  IF v_scp.ok_encarregado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este contrato já tem o OK de % em %.', coalesce(v_scp.ok_encarregado_por, '?'),
      to_char(v_scp.ok_encarregado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  END IF;

  v_para := CASE WHEN v_scp.status = 'Pendente Encarregados' THEN 'Pendente Operacional' ELSE v_scp.status END;
  UPDATE public."SISTEMA_CONFERENCIA_PONTO"
     SET status = v_para, atualizado_por = v_nome,
         ok_encarregado_por = v_nome, ok_encarregado_em = now(), ok_encarregado_pelo_operacional = true
   WHERE id = v_scp.id;
  INSERT INTO public."SISTEMA_CONFERENCIA_PONTO_EVENTOS" (conferencia_id, acao, de_status, para_status, observacao, usuario_nome)
  VALUES (v_scp.id, 'ok_encarregado_operacional', v_scp.status, v_para, v_obs, v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.ponto_ok_encarregado_operacional(bigint, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_ok_encarregado_operacional(bigint, bigint, text, text) TO authenticated;

-- Desfazer o OK que o Operacional marcou (engano), enquanto não foi ao RH.
-- O OK dado pelo próprio encarregado só sai devolvendo o envio.
CREATE OR REPLACE FUNCTION public.ponto_ok_encarregado_desfazer(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_nome text := (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid());
  v_scp  public."SISTEMA_CONFERENCIA_PONTO"%ROWTYPE;
BEGIN
  IF NOT public.ponto_pode_aprovar_contrato() THEN
    RAISE EXCEPTION 'Sem permissão: é preciso poder aprovar contrato na Conferência de Ponto.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_scp FROM public."SISTEMA_CONFERENCIA_PONTO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_scp.ok_encarregado_em IS NULL THEN RAISE EXCEPTION 'Este contrato não tem OK do encarregado.'; END IF;
  IF NOT v_scp.ok_encarregado_pelo_operacional THEN
    RAISE EXCEPTION 'O OK foi dado pelo próprio encarregado — para tirar, devolva o envio a ele.';
  END IF;
  IF v_scp.status NOT IN ('Pendente Operacional', 'Em Andamento Operacional', 'Devolvido Operacional', 'Problema') THEN
    RAISE EXCEPTION 'O contrato já saiu do Operacional (está %).', v_scp.status;
  END IF;
  UPDATE public."SISTEMA_CONFERENCIA_PONTO"
     SET ok_encarregado_por = NULL, ok_encarregado_em = NULL, ok_encarregado_pelo_operacional = false, atualizado_por = v_nome
   WHERE id = p_id;
  INSERT INTO public."SISTEMA_CONFERENCIA_PONTO_EVENTOS" (conferencia_id, acao, de_status, para_status, observacao, usuario_nome)
  VALUES (p_id, 'ok_encarregado_desfeito', v_scp.status, v_scp.status,
          'OK marcado pelo Operacional (' || coalesce(v_scp.ok_encarregado_por, '') || ') desfeito', v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.ponto_ok_encarregado_desfazer(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_ok_encarregado_desfazer(bigint) TO authenticated;

-- ── 11) Hierarquia: trocar quem está no posto ────────────────────────────
-- p_entra vai para p_posto; p_sai sai de p_posto (fica sem posto no ERP).
-- Os dois juntos = trocar o encarregado. Quando o ajuste repete o que a
-- Senior já diz, o ajuste some (não fica lixo para conferir depois).
CREATE OR REPLACE FUNCTION public.rh_hier_ocupante(p_posto text, p_entra bigint, p_sai bigint, p_motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_nome   text := (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid());
  v_mot    text := NULLIF(btrim(coalesce(p_motivo, '')), '');
  v_e      record;
  v_antes  text;
BEGIN
  IF NOT public.rh_hier_pode('alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar a hierarquia.' USING ERRCODE = '42501';
  END IF;
  IF p_entra IS NULL AND p_sai IS NULL THEN RAISE EXCEPTION 'Escolha quem entra ou quem sai do posto.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."RH_POSTO_TRABALHO" WHERE codigo = p_posto) THEN RAISE EXCEPTION 'Posto % não existe.', p_posto; END IF;
  IF p_entra IS NOT NULL AND p_entra = p_sai THEN RAISE EXCEPTION 'Quem entra e quem sai são a mesma pessoa.'; END IF;

  IF p_sai IS NOT NULL THEN
    SELECT o.*, e."Nome" AS nome INTO v_e
      FROM public.rh_hier_ocupacao() o JOIN public."EMPREGADOS" e ON e."ID" = o.empregado_id
     WHERE o.empregado_id = p_sai;
    IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador % não está entre os ativos.', p_sai; END IF;
    IF v_e.posto IS DISTINCT FROM p_posto THEN RAISE EXCEPTION '% não está neste posto.', v_e.nome; END IF;
    IF v_e.posto_senior IS NULL THEN
      DELETE FROM public."RH_POSTO_OCUPANTE_ERP" WHERE empregado_id = p_sai;
    ELSE
      INSERT INTO public."RH_POSTO_OCUPANTE_ERP" (empregado_id, posto_codigo, posto_senior, motivo, alterado_por, alterado_em)
      VALUES (p_sai, NULL, v_e.posto_senior, v_mot, v_nome, now())
      ON CONFLICT (empregado_id) DO UPDATE SET posto_codigo = NULL, posto_senior = EXCLUDED.posto_senior,
        motivo = EXCLUDED.motivo, alterado_por = EXCLUDED.alterado_por, alterado_em = now();
    END IF;
    INSERT INTO public."RH_POSTO_HIERARQUIA_HIST" (posto_codigo, tipo, empregado_id, empregado_nome, valor_antes, valor_depois, motivo, autor_nome)
    VALUES (p_posto, 'ocupante', p_sai, v_e.nome, p_posto, NULL, v_mot, v_nome);
  END IF;

  IF p_entra IS NOT NULL THEN
    SELECT o.*, e."Nome" AS nome INTO v_e
      FROM public.rh_hier_ocupacao() o JOIN public."EMPREGADOS" e ON e."ID" = o.empregado_id
     WHERE o.empregado_id = p_entra;
    IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador % não está entre os ativos.', p_entra; END IF;
    IF v_e.posto IS NOT DISTINCT FROM p_posto THEN RAISE EXCEPTION '% já está neste posto.', v_e.nome; END IF;
    v_antes := v_e.posto;
    IF v_e.posto_senior IS NOT DISTINCT FROM p_posto THEN
      DELETE FROM public."RH_POSTO_OCUPANTE_ERP" WHERE empregado_id = p_entra;
    ELSE
      INSERT INTO public."RH_POSTO_OCUPANTE_ERP" (empregado_id, posto_codigo, posto_senior, motivo, alterado_por, alterado_em)
      VALUES (p_entra, p_posto, v_e.posto_senior, v_mot, v_nome, now())
      ON CONFLICT (empregado_id) DO UPDATE SET posto_codigo = EXCLUDED.posto_codigo, posto_senior = EXCLUDED.posto_senior,
        motivo = EXCLUDED.motivo, alterado_por = EXCLUDED.alterado_por, alterado_em = now();
    END IF;
    INSERT INTO public."RH_POSTO_HIERARQUIA_HIST" (posto_codigo, tipo, empregado_id, empregado_nome, valor_antes, valor_depois, motivo, autor_nome)
    VALUES (p_posto, 'ocupante', p_entra, v_e.nome, v_antes, p_posto, v_mot, v_nome);
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.rh_hier_ocupante(text, bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_hier_ocupante(text, bigint, bigint, text) TO authenticated;

-- Desfaz o ajuste: a pessoa volta ao posto que a Senior dá.
CREATE OR REPLACE FUNCTION public.rh_hier_ocupante_senior(p_empregado bigint, p_motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_nome text := (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid());
  v_a    public."RH_POSTO_OCUPANTE_ERP"%ROWTYPE;
  v_sen  text;
BEGIN
  IF NOT public.rh_hier_pode('alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar a hierarquia.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_a FROM public."RH_POSTO_OCUPANTE_ERP" WHERE empregado_id = p_empregado FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Este colaborador não tem ajuste no ERP.'; END IF;
  SELECT "Posto" INTO v_sen FROM public."EMPREGADOS" WHERE "ID" = p_empregado;
  DELETE FROM public."RH_POSTO_OCUPANTE_ERP" WHERE empregado_id = p_empregado;
  INSERT INTO public."RH_POSTO_HIERARQUIA_HIST" (posto_codigo, tipo, empregado_id, empregado_nome, valor_antes, valor_depois, motivo, autor_nome)
  VALUES (coalesce(v_a.posto_codigo, v_sen, '—'), 'ocupante', p_empregado, (SELECT "Nome" FROM public."EMPREGADOS" WHERE "ID" = p_empregado),
          v_a.posto_codigo, v_sen, '[volta ao posto da Senior] ' || coalesce(NULLIF(btrim(coalesce(p_motivo, '')), ''), ''), v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.rh_hier_ocupante_senior(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_hier_ocupante_senior(bigint, text) TO authenticated;

-- Vagas do posto (vieram da planilha da Senior; a sincronia não reescreve).
CREATE OR REPLACE FUNCTION public.rh_hier_vagas(p_posto text, p_vagas integer, p_motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_nome  text := (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid());
  v_antes integer;
BEGIN
  IF NOT public.rh_hier_pode('alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar a hierarquia.' USING ERRCODE = '42501';
  END IF;
  IF p_vagas IS NOT NULL AND (p_vagas < 0 OR p_vagas > 9999) THEN RAISE EXCEPTION 'Vagas inválidas.'; END IF;
  SELECT vagas INTO v_antes FROM public."RH_POSTO_TRABALHO" WHERE codigo = p_posto FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Posto % não existe.', p_posto; END IF;
  IF v_antes IS NOT DISTINCT FROM p_vagas THEN RETURN; END IF;
  UPDATE public."RH_POSTO_TRABALHO" SET vagas = p_vagas, atualizado_em = now() WHERE codigo = p_posto;
  INSERT INTO public."RH_POSTO_HIERARQUIA_HIST" (posto_codigo, tipo, valor_antes, valor_depois, motivo, autor_nome)
  VALUES (p_posto, 'vagas', v_antes::text, p_vagas::text, NULLIF(btrim(coalesce(p_motivo, '')), ''), v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.rh_hier_vagas(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_hier_vagas(text, integer, text) TO authenticated;

-- ── 12) Painel e "minha área" com a ocupação efetiva ─────────────────────
CREATE OR REPLACE FUNCTION public.rh_hier_painel()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.rh_hier_pode() THEN
    RAISE EXCEPTION 'Sem acesso à Hierarquia de Postos.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    -- [codigo, descricao, titulo, empresa, filial, cargo_cod, vagas, pai, ordem, na_hierarquia, origem]
    'postos', COALESCE((SELECT jsonb_agg(jsonb_build_array(p.codigo, p.descricao, p.titulo, p.empresa, p.filial, p.cargo_cod,
                          p.vagas, h.pai_codigo, COALESCE(h.ordem, 0), h.posto_codigo IS NOT NULL, h.origem) ORDER BY p.codigo)
                         FROM public."RH_POSTO_TRABALHO" p
                         LEFT JOIN public."RH_POSTO_HIERARQUIA" h ON h.posto_codigo = p.codigo
                        WHERE p.ativo), '[]'::jsonb),
    -- [id, nome, cadastro, cargo, situação, posto EFETIVO, tem_login, empresa, filial, nome do posto na Senior,
    --  ajustado no ERP, posto da Senior]
    'ocupantes', COALESCE((SELECT jsonb_agg(jsonb_build_array(e."ID", e."Nome", e."Cadastro", e."Título do Cargo", e."Situação",
                          o.posto, e.auth_user_id IS NOT NULL, e."Empresa", e."Filial", e."Nome do Posto",
                          o.ajustado, o.posto_senior) ORDER BY e."Nome")
                           FROM public.rh_hier_ocupacao() o
                           JOIN public."EMPREGADOS" e ON e."ID" = o.empregado_id), '[]'::jsonb),
    -- [empresa, filial, nome, ativo]
    'contratos', COALESCE((SELECT jsonb_agg(jsonb_build_array(c."Empresa", c."Filial", c."NOME CONTRATO", c."ATIVO" = 'SIM'))
                           FROM public."CONTRATOS" c), '[]'::jsonb),
    -- [empresa, filial, posto_lider, empregado_id] — quem dá o OK do ponto de cada contrato
    'responsaveis', COALESCE((SELECT jsonb_agg(jsonb_build_array(r.empresa, r.filial, r.posto_lider, r.empregado_id))
                              FROM public.rh_hier_responsaveis() r), '[]'::jsonb),
    'historico', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
                           FROM (SELECT * FROM public."RH_POSTO_HIERARQUIA_HIST" ORDER BY created_at DESC LIMIT 300) x), '[]'::jsonb),
    'pode_alterar', public.rh_hier_pode('alterar'));
END $$;
REVOKE ALL ON FUNCTION public.rh_hier_painel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_hier_painel() TO authenticated;

CREATE OR REPLACE FUNCTION public.rh_hier_minha_area()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_meus text[];
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT array_agg(DISTINCT o.posto) INTO v_meus
    FROM public.rh_hier_ocupacao() o
   WHERE o.auth_user_id = auth.uid()
     AND o.posto IN (SELECT codigo FROM public."RH_POSTO_TRABALHO");
  RETURN (
    WITH area AS (
      SELECT DISTINCT d.codigo FROM unnest(COALESCE(v_meus, '{}')) m(p), LATERAL public.rh_hier_descendentes(m.p) d
    )
    SELECT jsonb_build_object(
      'meus_postos', COALESCE(to_jsonb(v_meus), '[]'::jsonb),
      'postos', COALESCE((SELECT jsonb_agg(codigo ORDER BY codigo) FROM area), '[]'::jsonb),
      'contratos', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('empresa', p.empresa, 'filial', p.filial))
                               FROM public."RH_POSTO_TRABALHO" p WHERE p.codigo IN (SELECT codigo FROM area)), '[]'::jsonb),
      'colaboradores', COALESCE((SELECT count(*) FROM public.rh_hier_ocupacao() o
                                  WHERE o.posto IN (SELECT codigo FROM area)), 0)));
END $$;
REVOKE ALL ON FUNCTION public.rh_hier_minha_area() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_hier_minha_area() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (as funções ponto_enc_contexto/colaboradores/salvar/enviar/decidir, rh_hier_painel e rh_hier_minha_area voltam
--  reaplicando os blocos delas da 20261007000023 e da 20261007000024)
-- DROP FUNCTION IF EXISTS public.rh_hier_vagas(text, integer, text), public.rh_hier_ocupante_senior(bigint, text),
--   public.rh_hier_ocupante(text, bigint, bigint, text), public.ponto_ok_encarregado_desfazer(bigint),
--   public.ponto_ok_encarregado_operacional(bigint, bigint, text, text), public.ponto_pode_aprovar_contrato(),
--   public.ponto_enc_responsavel(bigint, bigint), public.rh_hier_responsaveis(), public.rh_hier_ocupacao();
-- ALTER TABLE public."SISTEMA_CONFERENCIA_PONTO" DROP COLUMN IF EXISTS ok_encarregado_por,
--   DROP COLUMN IF EXISTS ok_encarregado_em, DROP COLUMN IF EXISTS ok_encarregado_pelo_operacional;
-- ALTER TABLE public."RH_POSTO_HIERARQUIA_HIST" DROP CONSTRAINT IF EXISTS rh_hier_hist_tipo, DROP COLUMN IF EXISTS tipo,
--   DROP COLUMN IF EXISTS empregado_id, DROP COLUMN IF EXISTS empregado_nome, DROP COLUMN IF EXISTS valor_antes, DROP COLUMN IF EXISTS valor_depois;
-- DROP TABLE IF EXISTS public."RH_POSTO_OCUPANTE_ERP";   (R2: precisa da válvula de escape)
