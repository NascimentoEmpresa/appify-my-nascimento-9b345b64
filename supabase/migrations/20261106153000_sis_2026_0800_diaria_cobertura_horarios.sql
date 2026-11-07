-- SIS-2026-0800: cobertura por data e comparação com intervalos trabalhados.
-- Registros antigos continuam sem horário: a interface exige conferência,
-- sem inventar início/fim a partir do turno. Novas criações/reenvios exigem
-- ambos. Fim < início representa término no dia seguinte (menos de 24h).
ALTER TABLE public."DIARIA_LINHA"
  ADD COLUMN IF NOT EXISTS inicio_cobertura time,
  ADD COLUMN IF NOT EXISTS fim_cobertura time;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."DIARIA_LINHA"'::regclass AND conname = 'diaria_linha_cobertura_check') THEN
    ALTER TABLE public."DIARIA_LINHA" ADD CONSTRAINT diaria_linha_cobertura_check CHECK (
      (inicio_cobertura IS NULL AND fim_cobertura IS NULL) OR
      (inicio_cobertura IS NOT NULL AND fim_cobertura IS NOT NULL
       AND inicio_cobertura <> fim_cobertura
       AND inicio_cobertura < time '24:00' AND fim_cobertura < time '24:00'
       AND extract(second FROM inicio_cobertura) = 0 AND extract(second FROM fim_cobertura) = 0));
  END IF;
END $$;

-- Internas: somente as RPCs com os gates já existentes podem ler o espelho.
CREATE OR REPLACE FUNCTION public.diaria_ponto_tem_vinculo(p_cpf text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public."EMPREGADOS" e
    WHERE length(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')) = 11
      AND regexp_replace(coalesce(e."CPF"::text, ''), '\D', '', 'g') = regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')
      AND btrim(e."Cadastro"::text) ~ '^[0-9]+$' AND btrim(e."Empresa"::text) ~ '^[0-9]+$')
$$;
REVOKE ALL ON FUNCTION public.diaria_ponto_tem_vinculo(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.diaria_ponto_jornadas(p_cpf text, p_data date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_jornadas jsonb;
BEGIN
  IF p_data IS NULL OR to_regclass('espelho."BiMarcacoes"') IS NULL THEN
    RETURN jsonb_build_object('disponivel', false, 'jornadas', '[]'::jsonb);
  END IF;
  -- Mantém cada matrícula/empresa e jornada separada: uma entrada de um
  -- vínculo jamais fecha a saída de outro. O dia anterior pode terminar
  -- depois da meia-noite; o seguinte pode coincidir com cobertura noturna.
  EXECUTE $q$
    SELECT coalesce(jsonb_agg(jsonb_build_object('data', x.data, 'vinculo', x.vinculo, 'minutos', x.minutos)
                              ORDER BY x.data, x.vinculo), '[]'::jsonb)
      FROM (
        SELECT m.data_hora::date AS data,
               m.empresa::text || '/' || (m.matricula % 100000000)::text AS vinculo,
               array_agg(DISTINCT m.hora ORDER BY m.hora) AS minutos
          FROM (SELECT DISTINCT
                  CASE WHEN btrim(e."Cadastro"::text) ~ '^[0-9]+$' THEN btrim(e."Cadastro"::text)::bigint END AS cad,
                  CASE WHEN btrim(e."Empresa"::text) ~ '^[0-9]+$' THEN btrim(e."Empresa"::text)::int END AS emp
                FROM public."EMPREGADOS" e
                WHERE regexp_replace(coalesce(e."CPF"::text, ''), '\D', '', 'g') = $1 AND length($1) = 11) e
          JOIN espelho."BiMarcacoes" m ON m.empresa = e.emp AND (m.matricula % 100000000) = e.cad
         WHERE m.data_hora >= $2 - 1 AND m.data_hora < $2 + 2
         GROUP BY m.data_hora::date, m.empresa, (m.matricula % 100000000)
      ) x
  $q$ INTO v_jornadas USING regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), p_data;
  RETURN jsonb_build_object('disponivel', true, 'jornadas', v_jornadas);
EXCEPTION WHEN OTHERS THEN
  -- Falha nunca pode virar ausência confirmada de conflito.
  RETURN jsonb_build_object('disponivel', false, 'jornadas', '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ponto_jornadas(text, date) FROM PUBLIC, anon, authenticated;

-- Corpos de criação/reenvio e RPCs de leitura abaixo preservam os gates,
-- transações, snapshots e anexos existentes; apenas incluem a cobertura e
-- as jornadas usadas pela comparação compartilhada no frontend.


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

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_dados->'diarias', '[]'::jsonb)) d
    WHERE coalesce(d->>'inicio_cobertura', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR coalesce(d->>'fim_cobertura', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR d->>'inicio_cobertura' = d->>'fim_cobertura') THEN
    RAISE EXCEPTION 'Informe início e fim diferentes para a cobertura de cada diária (HH:MM).';
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
    solicitacao_id, data, turno, inicio_cobertura, fim_cobertura, qt_vt, valor_unit_vt_centavos, valor_diaria_centavos
  )
  SELECT v_id, (d->>'data')::date, d->>'turno',
         (d->>'inicio_cobertura')::time, (d->>'fim_cobertura')::time,
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

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_dados->'diarias', '[]'::jsonb)) d
    WHERE coalesce(d->>'inicio_cobertura', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR coalesce(d->>'fim_cobertura', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR d->>'inicio_cobertura' = d->>'fim_cobertura') THEN
    RAISE EXCEPTION 'Informe início e fim diferentes para a cobertura de cada diária (HH:MM).';
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
    solicitacao_id, data, turno, inicio_cobertura, fim_cobertura, qt_vt, valor_unit_vt_centavos, valor_diaria_centavos
  )
  SELECT v_id, (d->>'data')::date, d->>'turno',
         (d->>'inicio_cobertura')::time, (d->>'fim_cobertura')::time,
         COALESCE((d->>'qt_vt')::int, 0),
         COALESCE((d->>'valor_unit_vt_centavos')::bigint, 0),
         COALESCE((d->>'valor_diaria_centavos')::bigint, 0)
    FROM jsonb_array_elements(p_dados->'diarias') d;

  RETURN QUERY SELECT v_id, v_s.numero;
END $$;
REVOKE ALL ON FUNCTION public.diaria_editar_solicitacao(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_editar_solicitacao(jsonb) TO authenticated;

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
      SELECT jsonb_agg(jsonb_build_object('data', d, 'minutos', to_jsonb(public.diaria_ponto_minutos(v_cpf, d)), 'ponto', public.diaria_ponto_jornadas(v_cpf, d)) ORDER BY d)
        FROM (SELECT DISTINCT d FROM unnest(p_datas) AS d WHERE d IS NOT NULL) x), '[]'::jsonb));
END $fn$;

CREATE OR REPLACE FUNCTION public.diaria_ponto_conflitos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.diaria_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Controle de Diárias.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'sincronizado_ate', public.diaria_ponto_sincronizado_ate(),
    'conflitos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('solicitacao_id', x.sid, 'data', x.data, 'minutos', to_jsonb(x.mins),
                   'linha_id', x.linha_id, 'inicio_cobertura', x.inicio_cobertura, 'fim_cobertura', x.fim_cobertura,
                   'tem_vinculo', x.tem_vinculo, 'ponto', x.ponto) ORDER BY x.data DESC)
        FROM (
          SELECT s.id AS sid, l.data, l.id AS linha_id, l.inicio_cobertura, l.fim_cobertura,
                 public.diaria_ponto_tem_vinculo(s.faltante_cpf) AS tem_vinculo,
                 public.diaria_ponto_jornadas(s.faltante_cpf, l.data) AS ponto, public.diaria_ponto_minutos(s.faltante_cpf, l.data) AS mins
            FROM public."DIARIA_LINHA" l
            JOIN public."DIARIA_SOLICITACAO" s ON s.id = l.solicitacao_id
           WHERE s.status NOT IN ('reprovada', 'excluida')
             -- Encarregado vê só as dele (mesma regra da policy de select).
             AND (public.diaria_ve_tudo() OR s.solicitante_id = auth.uid())
        ) x
       -- Inclui dados insuficientes; a interface os separa de conflito.
       ), '[]'::jsonb));
END $fn$;

CREATE OR REPLACE FUNCTION public.diaria_ponto_malote(p_despesas uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (public.can_access(auth.uid(), 'malote_aprovacoes', 'visualizar'::public.app_acao)
       OR public.can_access(auth.uid(), 'malote_despesa_visualizar', 'visualizar'::public.app_acao)
       OR public.diaria_pode('visualizar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Sem acesso às despesas do Malote.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_despesas), 0) = 0 THEN
    RETURN jsonb_build_object('sincronizado_ate', public.diaria_ponto_sincronizado_ate(), 'itens', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'sincronizado_ate', public.diaria_ponto_sincronizado_ate(),
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'despesa_id', s.malote_despesa_id,
               'solicitacao_id', s.id,
               'numero', s.numero,
               'faltante_nome', s.faltante_nome,
               'contrato_nome', s.contrato_nome,
               'posto_nome', s.posto_nome,
               'tem_vinculo', EXISTS (
                 SELECT 1 FROM public."EMPREGADOS" e
                  WHERE length(regexp_replace(coalesce(s.faltante_cpf, ''), '\D', '', 'g')) = 11
                    AND regexp_replace(coalesce(e."CPF"::text, ''), '\D', '', 'g') = regexp_replace(coalesce(s.faltante_cpf, ''), '\D', '', 'g')
                    AND btrim(e."Cadastro"::text) ~ '^[0-9]+$' AND btrim(e."Empresa"::text) ~ '^[0-9]+$'),
               'dias', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('data', l.data, 'turno', l.turno,
                                                     'linha_id', l.id, 'inicio_cobertura', l.inicio_cobertura, 'fim_cobertura', l.fim_cobertura,
                                                     'ponto', public.diaria_ponto_jornadas(s.faltante_cpf, l.data),
                                                     'minutos', to_jsonb(public.diaria_ponto_minutos(s.faltante_cpf, l.data)))
                                  ORDER BY l.data, l.turno)
                   FROM public."DIARIA_LINHA" l WHERE l.solicitacao_id = s.id), '[]'::jsonb))
             ORDER BY s.numero)
        FROM public."DIARIA_SOLICITACAO" s
       WHERE s.malote_despesa_id = ANY (p_despesas[1:300])
         AND s.status NOT IN ('excluida')), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.diaria_ponto_faltante(text, date[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ponto_faltante(text, date[]) TO authenticated;

REVOKE ALL ON FUNCTION public.diaria_ponto_conflitos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ponto_conflitos() TO authenticated;

REVOKE ALL ON FUNCTION public.diaria_ponto_malote(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ponto_malote(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
