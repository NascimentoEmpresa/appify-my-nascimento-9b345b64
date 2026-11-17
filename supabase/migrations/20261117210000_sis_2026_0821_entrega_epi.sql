-- SIS-2026-0821: entrega de EPI com comprovacao individual.
-- O pedido representa separacao/expedicao; esta tabela representa o recebimento.
-- Registros antigos nao sao presumidos entregues. Correcoes documentais sao anexos novos.

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_epi_entregas', 'Entrega de EPIs', '/app/suprimentos/entregas-epi',
       coalesce((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = excluded.nome, rota = excluded.rota, ativo = true;
INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('sup_epi_entregas', 'alterar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.id, 'sup_epi_entregas', a.acao, true FROM public.perfil_acesso p
CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('alterar'::public.app_acao)) a(acao)
WHERE p.concede_tudo AND p.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

CREATE TABLE IF NOT EXISTS public."EPI_ENTREGA" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES public.sup_pedido(id) ON DELETE RESTRICT,
  empregado_id bigint NOT NULL,
  cpf text NOT NULL,
  colaborador_nome text NOT NULL,
  matricula text,
  empresa_nome text,
  contrato_nome text NOT NULL,
  posto_nome text NOT NULL,
  funcao_nome text NOT NULL,
  protocolo text NOT NULL,
  solicitado_em date NOT NULL,
  separado_em timestamptz,
  enviado_em timestamptz,
  entregador_nome text NOT NULL,
  registrado_por uuid NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT now(),
  modo text NOT NULL CHECK (modo IN ('eletronico', 'fisico')),
  itens jsonb NOT NULL CHECK (jsonb_typeof(itens) = 'array' AND jsonb_array_length(itens) > 0),
  confirmado_em timestamptz,
  confirmacao_hash text,
  confirmacao_ip text,
  confirmacao_dispositivo text,
  declaracao_versao integer NOT NULL DEFAULT 1,
  CONSTRAINT epi_entrega_confirmacao_par CHECK ((confirmado_em IS NULL) = (confirmacao_hash IS NULL))
);
CREATE INDEX IF NOT EXISTS epi_entrega_pedido_idx ON public."EPI_ENTREGA" (pedido_id, registrado_em DESC);
CREATE INDEX IF NOT EXISTS epi_entrega_cpf_idx ON public."EPI_ENTREGA" (cpf, registrado_em DESC);
CREATE INDEX IF NOT EXISTS epi_entrega_pendente_idx ON public."EPI_ENTREGA" (registrado_em DESC) WHERE confirmado_em IS NULL;

CREATE TABLE IF NOT EXISTS public."EPI_ENTREGA_DOCUMENTO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entrega_id uuid NOT NULL REFERENCES public."EPI_ENTREGA"(id) ON DELETE RESTRICT,
  storage_path text NOT NULL UNIQUE,
  legivel boolean NOT NULL,
  observacao text,
  anexado_por uuid NOT NULL,
  anexado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS epi_entrega_documento_entrega_idx ON public."EPI_ENTREGA_DOCUMENTO" (entrega_id, anexado_em DESC);

CREATE TABLE IF NOT EXISTS public."EPI_CONFIRMACAO_TENTATIVA" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empregado_id bigint NOT NULL,
  tentativa_em timestamptz NOT NULL DEFAULT now(),
  ip text
);
CREATE INDEX IF NOT EXISTS epi_confirmacao_tentativa_emp_idx
  ON public."EPI_CONFIRMACAO_TENTATIVA" (empregado_id, tentativa_em DESC);
ALTER TABLE public."EPI_CONFIRMACAO_TENTATIVA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."EPI_CONFIRMACAO_TENTATIVA" FROM PUBLIC, anon, authenticated;

ALTER TABLE public."EPI_ENTREGA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EPI_ENTREGA_DOCUMENTO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."EPI_ENTREGA", public."EPI_ENTREGA_DOCUMENTO" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public."EPI_ENTREGA", public."EPI_ENTREGA_DOCUMENTO" TO authenticated;
DROP POLICY IF EXISTS epi_entrega_select ON public."EPI_ENTREGA";
CREATE POLICY epi_entrega_select ON public."EPI_ENTREGA" FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access(auth.uid(), 'sup_epi_entregas', 'visualizar')));
DROP POLICY IF EXISTS epi_entrega_documento_select ON public."EPI_ENTREGA_DOCUMENTO";
CREATE POLICY epi_entrega_documento_select ON public."EPI_ENTREGA_DOCUMENTO" FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access(auth.uid(), 'sup_epi_entregas', 'visualizar')));

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('epi-entregas', 'epi-entregas', false, 10485760)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "epi entregas ler" ON storage.objects;
CREATE POLICY "epi entregas ler" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'epi-entregas' AND (SELECT public.has_screen_access(auth.uid(), 'sup_epi_entregas', 'visualizar')));
DROP POLICY IF EXISTS "epi entregas anexar" ON storage.objects;
CREATE POLICY "epi entregas anexar" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'epi-entregas'
    AND (SELECT public.has_screen_access(auth.uid(), 'sup_epi_entregas', 'alterar'))
    AND EXISTS (SELECT 1 FROM public."EPI_ENTREGA" e
      WHERE e.id::text = split_part(name, '/', 1) AND e.modo = 'fisico'));
-- Outras policies globais de Storage nao podem autorizar substituicao ou exclusao.
DROP POLICY IF EXISTS "epi entregas sem update" ON storage.objects;
CREATE POLICY "epi entregas sem update" ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'epi-entregas') WITH CHECK (bucket_id <> 'epi-entregas');
DROP POLICY IF EXISTS "epi entregas sem delete" ON storage.objects;
CREATE POLICY "epi entregas sem delete" ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'epi-entregas');

-- A baixa do estoque, e nao a quantidade solicitada, determina o snapshot.
-- O lock no pedido impede duas aberturas concorrentes de capturarem a mesma peca.
CREATE OR REPLACE FUNCTION public.sup_epi_entrega_abrir(p_pedido uuid, p_entregador text, p_modo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE
  v_pedido public.sup_pedido%ROWTYPE;
  v_emp public."EMPREGADOS"%ROWTYPE;
  v_id uuid;
  v_itens jsonb;
  v_empresa text;
  v_separado timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'sup_epi_entregas', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissao para registrar entrega de EPI' USING ERRCODE = '42501';
  END IF;
  IF p_modo NOT IN ('eletronico', 'fisico') OR length(btrim(coalesce(p_entregador, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o modo e o responsavel pela entrega';
  END IF;
  SELECT * INTO v_pedido FROM public.sup_pedido WHERE id = p_pedido FOR UPDATE;
  IF NOT FOUND OR v_pedido.status NOT IN ('RETIRADO PARA ENTREGA', 'DESPACHADO') THEN
    RAISE EXCEPTION 'O pedido precisa estar retirado para entrega ou despachado';
  END IF;
  SELECT * INTO v_emp FROM public."EMPREGADOS" e
   WHERE e."ID" = v_pedido.colaborador_empregado_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vincule o colaborador do RH ao pedido antes de registrar a entrega';
  END IF;
  IF public.col_desligado(v_emp."Situação") OR length(public.col_digitos(v_emp."CPF")) <> 11 THEN
    RAISE EXCEPTION 'O colaborador precisa estar ativo e com CPF valido no RH';
  END IF;
  IF public.sup_norm_nome(v_emp."Nome") IS DISTINCT FROM public.sup_norm_nome(v_pedido.nome_colaborador)
     OR (nullif(btrim(v_pedido.matricula_colaborador), '') IS NOT NULL
         AND btrim(v_emp."Cadastro"::text) IS DISTINCT FROM btrim(v_pedido.matricula_colaborador)) THEN
    RAISE EXCEPTION 'Nome ou matricula do pedido nao conferem com o colaborador vinculado no RH';
  END IF;

  WITH movimentos AS (
    SELECT t.pedido_item_id, t.codigo, nullif(btrim(t.ca_numero), '') AS ca,
           t.ca_validade, 1::integer AS quantidade
      FROM public.sup_estoque_tag t
     WHERE t.pedido_id = p_pedido AND t.tipo = 'unico'
       AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_consumo c
                        WHERE c.codigo = t.codigo AND c.pedido_id = p_pedido)
    UNION ALL
    SELECT c.pedido_item_id, c.codigo, nullif(btrim(t.ca_numero), ''), t.ca_validade, c.quantidade
      FROM public.sup_estoque_consumo c
      JOIN public.sup_estoque_tag t ON t.codigo = c.codigo
     WHERE c.pedido_id = p_pedido
  ), anteriores AS (
    SELECT (x.item->>'pedido_item_id')::uuid AS pedido_item_id,
           x.item->>'codigo' AS codigo, sum((x.item->>'quantidade')::integer) AS quantidade
      FROM public."EPI_ENTREGA" e
      CROSS JOIN LATERAL jsonb_array_elements(e.itens) AS x(item)
     WHERE e.pedido_id = p_pedido
     GROUP BY 1, 2
  ), disponiveis AS (
    SELECT pi.id, pi.nome_item, pi.tamanho, m.codigo, m.ca, m.ca_validade,
           sum(m.quantidade) - coalesce(max(a.quantidade), 0) AS quantidade
      FROM movimentos m
      JOIN public.sup_pedido_item pi ON pi.id = m.pedido_item_id AND pi.pedido_id = p_pedido
      LEFT JOIN public.sup_item item ON item.id = pi.item_id
      LEFT JOIN anteriores a ON a.pedido_item_id = pi.id AND a.codigo = m.codigo
     WHERE coalesce(item.tipo, pi.tipo_item) = 'epi'
     GROUP BY pi.id, pi.nome_item, pi.tamanho, m.codigo, m.ca, m.ca_validade
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'pedido_item_id', id, 'descricao', nome_item, 'tamanho', tamanho,
    'codigo', codigo, 'ca', ca, 'ca_validade', ca_validade, 'quantidade', quantidade)
    ORDER BY nome_item, codigo), '[]'::jsonb)
    INTO v_itens FROM disponiveis WHERE quantidade > 0;
  IF jsonb_array_length(v_itens) = 0 THEN
    RAISE EXCEPTION 'Nao ha EPI baixado no estoque ainda sem registro de entrega';
  END IF;

  SELECT e.razao_social INTO v_empresa FROM public.empresas e WHERE e.id = v_pedido.empresa_id;
  SELECT min(h.data_alteracao) INTO v_separado FROM public.sup_pedido_historico h
   WHERE h.pedido_id = p_pedido AND h.status_novo IN ('EM SEPARACAO', 'AGUARDANDO ENVIO');
  INSERT INTO public."EPI_ENTREGA" (
    pedido_id, empregado_id, cpf, colaborador_nome, matricula, empresa_nome,
    contrato_nome, posto_nome, funcao_nome, protocolo, solicitado_em, separado_em,
    enviado_em, entregador_nome, registrado_por, modo, itens)
  VALUES (p_pedido, v_emp."ID", public.col_digitos(v_emp."CPF"), v_emp."Nome",
    v_emp."Cadastro"::text, v_empresa, v_pedido.contrato_nome, v_pedido.posto_nome,
    v_pedido.funcao_nome, v_pedido.pedido_id, v_pedido.data_solicitacao, v_separado,
    coalesce(v_pedido.retirado_em, v_pedido.data_despachado), btrim(p_entregador), auth.uid(), p_modo, v_itens)
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sup_epi_entrega_abrir(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_epi_entrega_abrir(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sup_epi_entrega_documento(p_entrega uuid, p_path text, p_legivel boolean, p_obs text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage, pg_temp AS $fn$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'sup_epi_entregas', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."EPI_ENTREGA" e WHERE e.id = p_entrega AND e.modo = 'fisico') THEN
    RAISE EXCEPTION 'Entrega fisica nao encontrada';
  END IF;
  IF p_path !~ ('^' || p_entrega::text || '/[0-9a-f-]{36}\.(pdf|png|jpg|jpeg)$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'epi-entregas' AND o.name = p_path) THEN
    RAISE EXCEPTION 'Arquivo da ficha nao encontrado';
  END IF;
  INSERT INTO public."EPI_ENTREGA_DOCUMENTO" (entrega_id, storage_path, legivel, observacao, anexado_por)
  VALUES (p_entrega, p_path, p_legivel, left(p_obs, 500), auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sup_epi_entrega_documento(uuid,text,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_epi_entrega_documento(uuid,text,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sup_epi_pedidos_para_entrega(p_termo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_resultado jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'sup_epi_entregas', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.data_solicitacao DESC), '[]'::jsonb)
    INTO v_resultado FROM (
    SELECT p.id, p.pedido_id, p.nome_colaborador, p.matricula_colaborador,
           p.contrato_nome, p.posto_nome, p.status, p.data_solicitacao,
           p.colaborador_empregado_id
      FROM public.sup_pedido p
     WHERE p.status IN ('RETIRADO PARA ENTREGA', 'DESPACHADO')
       AND EXISTS (SELECT 1 FROM public.sup_pedido_item pi
                   LEFT JOIN public.sup_item i ON i.id = pi.item_id
                  WHERE pi.pedido_id = p.id AND coalesce(i.tipo, pi.tipo_item) = 'epi')
       AND (nullif(btrim(p_termo), '') IS NULL OR p.pedido_id ILIKE '%' || btrim(p_termo) || '%'
            OR p.nome_colaborador ILIKE '%' || btrim(p_termo) || '%')
     ORDER BY p.data_solicitacao DESC LIMIT 50
  ) x;
  RETURN v_resultado;
END $fn$;
REVOKE ALL ON FUNCTION public.sup_epi_pedidos_para_entrega(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_epi_pedidos_para_entrega(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sup_epi_entregas_buscar(
  p_termo text DEFAULT NULL, p_status text DEFAULT NULL,
  p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL, p_pagina integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_resultado jsonb; v_termo text := left(btrim(coalesce(p_termo, '')), 100);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'sup_epi_entregas', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  IF p_pagina < 0 OR p_pagina > 100 THEN RAISE EXCEPTION 'Pagina invalida'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.registrado_em DESC), '[]'::jsonb)
    INTO v_resultado FROM (
    SELECT e.id, e.pedido_id, e.protocolo, e.cpf, e.colaborador_nome, e.matricula,
           e.empresa_nome, e.contrato_nome, e.posto_nome, e.funcao_nome,
           e.solicitado_em, e.separado_em, e.enviado_em, e.registrado_em,
           e.entregador_nome, e.modo, e.itens, e.confirmado_em,
           e.confirmacao_hash, e.declaracao_versao,
           CASE WHEN e.confirmado_em IS NOT NULL THEN 'confirmado'
                WHEN d.legivel IS TRUE THEN 'ficha_recebida'
                WHEN d.legivel IS FALSE THEN 'ficha_ilegivel'
                WHEN e.modo = 'fisico' THEN 'aguardando_ficha'
                ELSE 'aguardando_confirmacao' END AS situacao,
           coalesce((SELECT jsonb_agg(jsonb_build_object('id', doc.id, 'path', doc.storage_path,
             'legivel', doc.legivel, 'observacao', doc.observacao, 'anexado_em', doc.anexado_em)
             ORDER BY doc.anexado_em DESC)
             FROM public."EPI_ENTREGA_DOCUMENTO" doc WHERE doc.entrega_id = e.id), '[]'::jsonb) AS documentos
      FROM public."EPI_ENTREGA" e
      LEFT JOIN LATERAL (SELECT doc.legivel FROM public."EPI_ENTREGA_DOCUMENTO" doc
        WHERE doc.entrega_id = e.id ORDER BY doc.anexado_em DESC LIMIT 1) d ON true
     WHERE (v_termo = '' OR e.colaborador_nome ILIKE '%' || v_termo || '%'
       OR e.cpf = regexp_replace(v_termo, '[^0-9]', '', 'g')
       OR e.contrato_nome ILIKE '%' || v_termo || '%'
       OR e.protocolo ILIKE '%' || v_termo || '%'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.itens) item
                   WHERE item->>'descricao' ILIKE '%' || v_termo || '%'))
       AND (p_inicio IS NULL OR e.registrado_em >= (p_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo'))
       AND (p_fim IS NULL OR e.registrado_em < ((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
       AND (p_status IS NULL OR p_status = CASE WHEN e.confirmado_em IS NOT NULL THEN 'confirmado'
                WHEN d.legivel IS TRUE THEN 'ficha_recebida'
                WHEN d.legivel IS FALSE THEN 'ficha_ilegivel'
                WHEN e.modo = 'fisico' THEN 'aguardando_ficha'
                ELSE 'aguardando_confirmacao' END)
     ORDER BY e.registrado_em DESC LIMIT 50 OFFSET p_pagina * 50
  ) x;
  RETURN v_resultado;
END $fn$;
REVOKE ALL ON FUNCTION public.sup_epi_entregas_buscar(text,text,date,date,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_epi_entregas_buscar(text,text,date,date,integer) TO authenticated;

-- Chamadas do portal so chegam pelo service_role. p_emp vem de col_sessao(token)
-- na Edge Function; o navegador nunca escolhe a identidade do signatario.
CREATE OR REPLACE FUNCTION public.col_epi_entregas(p_emp bigint, p_pagina integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'protocolo', e.protocolo, 'empresa', e.empresa_nome,
    'contrato', e.contrato_nome, 'posto', e.posto_nome, 'entregador', e.entregador_nome,
    'itens', e.itens, 'modo', e.modo, 'registrado_em', e.registrado_em,
    'confirmado_em', e.confirmado_em, 'confirmacao_hash', e.confirmacao_hash,
    'documentos', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'legivel', d.legivel, 'anexado_em', d.anexado_em)
      ORDER BY d.anexado_em DESC) FROM public."EPI_ENTREGA_DOCUMENTO" d
      WHERE d.entrega_id = e.id), '[]'::jsonb))
    ORDER BY e.registrado_em DESC), '[]'::jsonb)
  FROM (SELECT * FROM public."EPI_ENTREGA"
         WHERE cpf = (SELECT public.col_digitos("CPF") FROM public."EMPREGADOS" WHERE "ID" = p_emp)
         ORDER BY registrado_em DESC LIMIT 50 OFFSET greatest(p_pagina, 0) * 50) e
$fn$;
REVOKE ALL ON FUNCTION public.col_epi_entregas(bigint,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_epi_entregas(bigint,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.col_epi_documento_path(p_emp bigint, p_documento uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT d.storage_path FROM public."EPI_ENTREGA_DOCUMENTO" d
  JOIN public."EPI_ENTREGA" e ON e.id = d.entrega_id
  WHERE d.id = p_documento
    AND e.cpf = (SELECT public.col_digitos("CPF") FROM public."EMPREGADOS" WHERE "ID" = p_emp)
$fn$;
REVOKE ALL ON FUNCTION public.col_epi_documento_path(bigint,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_epi_documento_path(bigint,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.col_epi_confirmar(p_emp bigint, p_entrega uuid, p_senha text, p_ip text, p_ua text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE v_e public."EPI_ENTREGA"%ROWTYPE; v_hash text; v_agora timestamptz := now(); v_confirmacao text;
BEGIN
  SELECT * INTO v_e FROM public."EPI_ENTREGA" WHERE id = p_entrega FOR UPDATE;
  IF NOT FOUND OR v_e.cpf IS DISTINCT FROM
       (SELECT public.col_digitos("CPF") FROM public."EMPREGADOS" WHERE "ID" = p_emp)
     OR v_e.modo <> 'eletronico' THEN
    RAISE EXCEPTION 'Entrega nao encontrada para este colaborador';
  END IF;
  IF v_e.confirmado_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'confirmado_em', v_e.confirmado_em); END IF;
  SELECT c.senha_hash INTO v_hash FROM public."COL_PORTAL_CREDENCIAL" c WHERE c.empregado_id = p_emp;
  IF v_hash IS NULL THEN RAISE EXCEPTION 'Defina uma senha pessoal no seu perfil antes de confirmar'; END IF;
  IF (SELECT count(*) FROM public."EPI_CONFIRMACAO_TENTATIVA" t
      WHERE t.empregado_id = p_emp AND t.tentativa_em > now() - interval '15 minutes') >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas tentativas. Aguarde 15 minutos.');
  END IF;
  IF v_hash <> crypt(coalesce(p_senha, ''), v_hash) THEN
    INSERT INTO public."EPI_CONFIRMACAO_TENTATIVA" (empregado_id, ip) VALUES (p_emp, left(p_ip, 100));
    RETURN jsonb_build_object('ok', false, 'error', 'Senha incorreta');
  END IF;
  v_confirmacao := encode(digest(v_e.id::text || v_e.empregado_id::text || v_e.itens::text ||
    v_agora::text || 'declaracao-v1', 'sha256'), 'hex');
  UPDATE public."EPI_ENTREGA" SET confirmado_em = v_agora, confirmacao_hash = v_confirmacao,
    confirmacao_ip = left(p_ip, 100), confirmacao_dispositivo = left(p_ua, 300) WHERE id = p_entrega;
  RETURN jsonb_build_object('ok', true, 'confirmado_em', v_agora, 'hash', v_confirmacao);
END $fn$;
REVOKE ALL ON FUNCTION public.col_epi_confirmar(bigint,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_epi_confirmar(bigint,uuid,text,text,text) TO service_role;

-- Impede edicao ou exclusao de evidencias, inclusive por escrita direta com service_role.
CREATE OR REPLACE FUNCTION public.epi_entrega_somente_confirmacao()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Comprovante de EPI nao pode ser excluido'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.confirmado_em IS NOT NULL OR NEW.confirmado_em IS NULL OR NEW.confirmacao_hash IS NULL
       OR (to_jsonb(NEW) - 'confirmado_em' - 'confirmacao_hash' - 'confirmacao_ip' - 'confirmacao_dispositivo') IS DISTINCT FROM
          (to_jsonb(OLD) - 'confirmado_em' - 'confirmacao_hash' - 'confirmacao_ip' - 'confirmacao_dispositivo') THEN
      RAISE EXCEPTION 'Comprovante de EPI nao pode ser alterado';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_epi_entrega_imutavel ON public."EPI_ENTREGA";
CREATE TRIGGER trg_epi_entrega_imutavel BEFORE UPDATE OR DELETE ON public."EPI_ENTREGA"
FOR EACH ROW EXECUTE FUNCTION public.epi_entrega_somente_confirmacao();
CREATE OR REPLACE FUNCTION public.epi_documento_imutavel()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'Documento de EPI nao pode ser alterado ou excluido'; END $fn$;
DROP TRIGGER IF EXISTS trg_epi_documento_imutavel ON public."EPI_ENTREGA_DOCUMENTO";
CREATE TRIGGER trg_epi_documento_imutavel BEFORE UPDATE OR DELETE ON public."EPI_ENTREGA_DOCUMENTO"
FOR EACH ROW EXECUTE FUNCTION public.epi_documento_imutavel();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: retirar menu, policies, bucket e funcoes somente apos preservar/exportar
-- as evidencias e arquivos de todas as entregas ja confirmadas.
