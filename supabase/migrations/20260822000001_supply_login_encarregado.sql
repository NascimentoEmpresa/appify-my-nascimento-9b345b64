-- =====================================================================
-- LOGIN DO ENCARREGADO — CPF + data de nascimento contra EMPREGADOS
--
-- Substitui a entrada "qualquer login e senha" da aba Externo. Agora só entra
-- quem está no cadastro de empregados E não está desligado — o acesso se
-- revoga sozinho quando a pessoa sai, sem ninguém precisar lembrar disso.
--
-- O ganho maior é rastreabilidade: o pedido deixa de chegar assinado com um
-- texto digitado ("EDU") e passa a carregar nome, CPF e o ID do empregado.
--
-- SOBRE A FORÇA DISSO: CPF e data de nascimento são identificação, não
-- segredo. A segurança aqui vem de três coisas somadas — o cadastro é
-- fechado (só empregado ativo entra), toda tentativa fica registrada, e há
-- bloqueio por tentativa e erro. É proporcional ao estrago possível: abrir
-- um pedido de uniforme, que ainda passa pela conferência do Supply antes de
-- qualquer coisa sair do estoque. Não serviria para aprovar pagamento.
--
-- ⚠️ BUG PRÉ-EXISTENTE QUE ISTO CONTORNA
-- A coluna EMPREGADOS."Nascimento" tem DOIS formatos misturados:
--   DD/MM/AAAA → 10.237 linhas   |   AAAA-MM-DD → 2.435 linhas
-- E entre os 2.165 empregados "Trabalhando", 2.149 estão em AAAA-MM-DD.
-- A RPC vincular_meu_empregado (usada pelo VinculoGate) compara os DÍGITOS
-- crus dos dois lados: o usuário digita 20/10/1987 → "20101987", e o banco
-- guarda "1987-10-20" → "19871020". Nunca bate. Ou seja, aquele vínculo hoje
-- falha para praticamente todo empregado ativo.
-- Aqui a comparação é feita como DATA, via sup_norm_data(), que entende os
-- dois formatos. A correção do vincular_meu_empregado fica para uma migration
-- própria — é outra tela, com outro dono.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_ext_entrar_empregado(text,text,uuid);
--   DROP FUNCTION IF EXISTS public.sup_ext_prevalidar(text,text);
--   DROP FUNCTION IF EXISTS public.sup_norm_data(text);
--   DROP TABLE IF EXISTS public.sup_ext_acesso_log, public.sup_ext_tentativa;
--   ALTER TABLE public.sup_ext_sessao
--     DROP COLUMN empregado_id, DROP COLUMN empregado_cpf, DROP COLUMN empregado_nome;
-- =====================================================================

-- ── 1. Normalização de data ──────────────────────────────────────────
-- Entende DD/MM/AAAA, AAAA-MM-DD e as versões só com dígitos. Devolve NULL
-- em vez de estourar quando não reconhece — quem chama decide o que fazer.
CREATE OR REPLACE FUNCTION public.sup_norm_data(t text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  s text := trim(coalesce(t, ''));
  d text := regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g');
BEGIN
  -- Com separador o formato é explícito; é o caso das duas grafias que
  -- convivem em EMPREGADOS."Nascimento" e do que o usuário digita na tela.
  IF s ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN
    BEGIN RETURN make_date(substr(d,5,4)::int, substr(d,3,2)::int, substr(d,1,2)::int);
    EXCEPTION WHEN others THEN RETURN NULL; END;
  END IF;
  IF s ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    BEGIN RETURN make_date(substr(d,1,4)::int, substr(d,5,2)::int, substr(d,7,2)::int);
    EXCEPTION WHEN others THEN RETURN NULL; END;
  END IF;

  IF length(d) <> 8 THEN RETURN NULL; END IF;

  -- Só dígitos: ambíguo. Tenta DDMMAAAA primeiro, que é como se digita aqui.
  -- Olhar os 4 primeiros dígitos NÃO desempata — em "20101987" (20/10/1987)
  -- eles formam "2010", um ano perfeitamente plausível.
  BEGIN
    RETURN make_date(substr(d,5,4)::int, substr(d,3,2)::int, substr(d,1,2)::int);
  EXCEPTION WHEN others THEN
    BEGIN RETURN make_date(substr(d,1,4)::int, substr(d,5,2)::int, substr(d,7,2)::int);
    EXCEPTION WHEN others THEN RETURN NULL; END;
  END;
END $$;

-- ── 2. Controle de tentativas ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sup_ext_tentativa (
  cpf           text PRIMARY KEY,
  tentativas    integer NOT NULL DEFAULT 0,
  bloqueado_ate timestamptz,
  ultima_em     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sup_ext_tentativa ENABLE ROW LEVEL SECURITY;
-- Sem policy: só as RPCs SECURITY DEFINER mexem aqui.

-- ── 3. Trilha de acesso ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sup_ext_acesso_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cpf            text,
  empregado_id   bigint,
  empregado_nome text,
  contrato_id    uuid REFERENCES public.contratos(id) ON DELETE SET NULL,
  user_id        uuid,
  sucesso        boolean NOT NULL,
  motivo         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_acesso_log_data ON public.sup_ext_acesso_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sup_acesso_log_cpf  ON public.sup_ext_acesso_log(cpf);

ALTER TABLE public.sup_ext_acesso_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sup_acesso_log_select ON public.sup_ext_acesso_log;
CREATE POLICY sup_acesso_log_select ON public.sup_ext_acesso_log FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar'));

-- ── 4. Identidade real na sessão ─────────────────────────────────────
ALTER TABLE public.sup_ext_sessao ADD COLUMN IF NOT EXISTS empregado_id   bigint;
ALTER TABLE public.sup_ext_sessao ADD COLUMN IF NOT EXISTS empregado_cpf  text;
ALTER TABLE public.sup_ext_sessao ADD COLUMN IF NOT EXISTS empregado_nome text;

-- ── 5. Casamento com o cadastro ──────────────────────────────────────
-- Uma função só, usada pela pré-validação e pela entrada de fato, para não
-- existirem duas regras que possam divergir.
CREATE OR REPLACE FUNCTION public.sup_ext_casar_empregado(p_cpf text, p_nascimento text)
RETURNS TABLE (id bigint, nome text, cpf text, situacao text, ok boolean, motivo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cpf  text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_nasc date := public.sup_norm_data(p_nascimento);
  v_bloq text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA','APOSENTADORIA'];
  e      public."EMPREGADOS"%ROWTYPE;
BEGIN
  IF length(v_cpf) <> 11 THEN
    RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, NULL::text, false, 'Informe um CPF válido (11 dígitos).';
    RETURN;
  END IF;
  IF v_nasc IS NULL THEN
    RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, NULL::text, false, 'Informe a data de nascimento (DD/MM/AAAA).';
    RETURN;
  END IF;

  -- Compara o CPF por dígitos, já que a coluna guarda formatado. Não-desligado
  -- primeiro, depois admissão mais recente — mesma preferência do vínculo interno.
  SELECT * INTO e FROM public."EMPREGADOS" x
   WHERE regexp_replace(coalesce(x."CPF",''), '[^0-9]', '', 'g') = v_cpf
   ORDER BY (CASE WHEN upper(coalesce(x."Situação",'')) = ANY (v_bloq) THEN 1 ELSE 0 END) ASC,
            public.sup_norm_data(x."Admissão") DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, NULL::text, false, 'CPF ou data de nascimento não confere.';
    RETURN;
  END IF;

  -- Data errada devolve a MESMA mensagem do CPF inexistente, de propósito:
  -- assim a tela não vira um verificador de "este CPF existe aqui?".
  IF public.sup_norm_data(e."Nascimento") IS DISTINCT FROM v_nasc THEN
    RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, NULL::text, false, 'CPF ou data de nascimento não confere.';
    RETURN;
  END IF;

  IF upper(coalesce(e."Situação",'')) = ANY (v_bloq) THEN
    RETURN QUERY SELECT e."ID", e."Nome", e."CPF", e."Situação", false,
      'Seu cadastro consta como desligado. Procure o RH.';
    RETURN;
  END IF;

  RETURN QUERY SELECT e."ID", e."Nome", e."CPF", e."Situação", true, NULL::text;
END $$;

-- ── 6. Registro de tentativa ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_ext_registrar_tentativa(p_cpf text, p_sucesso boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cpf text := regexp_replace(coalesce(p_cpf,''), '[^0-9]', '', 'g');
BEGIN
  IF p_sucesso THEN
    DELETE FROM public.sup_ext_tentativa t WHERE t.cpf = v_cpf;
    RETURN;
  END IF;
  INSERT INTO public.sup_ext_tentativa (cpf, tentativas, ultima_em)
  VALUES (v_cpf, 1, now())
  ON CONFLICT (cpf) DO UPDATE
    SET tentativas = CASE WHEN public.sup_ext_tentativa.ultima_em < now() - interval '15 minutes'
                          THEN 1 ELSE public.sup_ext_tentativa.tentativas + 1 END,
        ultima_em  = now(),
        bloqueado_ate = CASE WHEN (CASE WHEN public.sup_ext_tentativa.ultima_em < now() - interval '15 minutes'
                                        THEN 1 ELSE public.sup_ext_tentativa.tentativas + 1 END) >= 5
                             THEN now() + interval '15 minutes' END;
END $$;

-- ── 7. Pré-validação (única concedida a anon) ────────────────────────
-- Chamada ANTES de abrir a sessão, para um CPF errado não criar um usuário
-- anônimo à toa. Devolve só ok/motivo — nenhum dado pessoal.
CREATE OR REPLACE FUNCTION public.sup_ext_prevalidar(p_cpf text, p_nascimento text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cpf text := regexp_replace(coalesce(p_cpf,''), '[^0-9]', '', 'g');
  v_bloq timestamptz;
  r record;
BEGIN
  SELECT t.bloqueado_ate INTO v_bloq FROM public.sup_ext_tentativa t WHERE t.cpf = v_cpf;
  IF v_bloq IS NOT NULL AND v_bloq > now() THEN
    RETURN jsonb_build_object('ok', false,
      'motivo', format('Muitas tentativas. Tente de novo em %s minuto(s).',
                       ceil(extract(epoch FROM (v_bloq - now()))/60)::int));
  END IF;

  SELECT * INTO r FROM public.sup_ext_casar_empregado(p_cpf, p_nascimento);
  PERFORM public.sup_ext_registrar_tentativa(v_cpf, r.ok);

  IF NOT r.ok THEN
    INSERT INTO public.sup_ext_acesso_log (cpf, sucesso, motivo) VALUES (v_cpf, false, r.motivo);
    RETURN jsonb_build_object('ok', false, 'motivo', r.motivo);
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ── 8. Entrada de fato ───────────────────────────────────────────────
-- Revalida tudo do zero: a pré-validação é conveniência de UX, não pode ser
-- a autoridade — o cliente poderia simplesmente pular ela.
CREATE OR REPLACE FUNCTION public.sup_ext_entrar_empregado(
  p_cpf text, p_nascimento text, p_contrato_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cpf text := regexp_replace(coalesce(p_cpf,''), '[^0-9]', '', 'g');
  v_bloq timestamptz;
  r record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT t.bloqueado_ate INTO v_bloq FROM public.sup_ext_tentativa t WHERE t.cpf = v_cpf;
  IF v_bloq IS NOT NULL AND v_bloq > now() THEN
    RAISE EXCEPTION 'Muitas tentativas. Tente de novo em % minuto(s).',
      ceil(extract(epoch FROM (v_bloq - now()))/60)::int;
  END IF;

  SELECT * INTO r FROM public.sup_ext_casar_empregado(p_cpf, p_nascimento);
  IF NOT r.ok THEN
    PERFORM public.sup_ext_registrar_tentativa(v_cpf, false);
    INSERT INTO public.sup_ext_acesso_log (cpf, sucesso, motivo, user_id)
    VALUES (v_cpf, false, r.motivo, v_uid);
    RAISE EXCEPTION '%', r.motivo;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.contratos c
                  WHERE c.id = p_contrato_id AND c.status = 'ativo') THEN
    RAISE EXCEPTION 'Contrato inválido ou inativo';
  END IF;

  PERFORM public.sup_ext_registrar_tentativa(v_cpf, true);

  INSERT INTO public.sup_ext_sessao
    (user_id, login_informado, contrato_id, empregado_id, empregado_cpf, empregado_nome)
  VALUES (v_uid, upper(r.nome), p_contrato_id, r.id, v_cpf, r.nome)
  ON CONFLICT (user_id) DO UPDATE
    SET login_informado = excluded.login_informado,
        contrato_id     = excluded.contrato_id,
        empregado_id    = excluded.empregado_id,
        empregado_cpf   = excluded.empregado_cpf,
        empregado_nome  = excluded.empregado_nome,
        last_seen_at    = now();

  INSERT INTO public.sup_ext_acesso_log
    (cpf, empregado_id, empregado_nome, contrato_id, user_id, sucesso)
  VALUES (v_cpf, r.id, r.nome, p_contrato_id, v_uid, true);

  RETURN jsonb_build_object('ok', true, 'nome', r.nome, 'empregado_id', r.id);
END $$;

-- ── 9. O pedido passa a carregar a identidade real ───────────────────
ALTER TABLE public.sup_pedido ADD COLUMN IF NOT EXISTS solicitante_empregado_id bigint;
ALTER TABLE public.sup_pedido ADD COLUMN IF NOT EXISTS solicitante_cpf          text;

-- Reescreve só o trecho de identidade: o nome do solicitante deixa de vir do
-- payload (texto que o cliente mandava) e passa a vir da sessão, que por sua
-- vez veio do cadastro de empregados. O resto da função é idêntico.
CREATE OR REPLACE FUNCTION public.sup_ext_criar_pedido(p_payload jsonb)
RETURNS public.sup_pedido
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_contrato  uuid := (p_payload->>'contrato_id')::uuid;
  v_posto     uuid := (p_payload->>'posto_id')::uuid;
  v_funcao    uuid := (p_payload->>'funcao_id')::uuid;
  v_tipo      text := coalesce(p_payload->>'tipo_pedido', 'uniforme');
  v_ses       record;
  v_login     text;
  v_nome      text;
  v_origem    text;
  v_emp_id    bigint;
  v_emp_cpf   text;
  v_empresa   uuid;
  v_cnome     text;
  v_pnome     text;
  v_fnome     text;
  v_itens     jsonb := coalesce(p_payload->'itens', '[]'::jsonb);
  v_ped       public.sup_pedido;
  it          jsonb;
  v_idx       int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.sup_ext_pode_ver_contrato(v_contrato) THEN
    RAISE EXCEPTION 'Sem acesso a este contrato';
  END IF;
  IF jsonb_array_length(v_itens) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um item';
  END IF;

  SELECT c.empresa_id, c.nome, p.nome, f.nome
    INTO v_empresa, v_cnome, v_pnome, v_fnome
    FROM public.contratos c
    JOIN public.sup_posto  p ON p.id = v_posto  AND p.contrato_id = c.id
    JOIN public.sup_funcao f ON f.id = v_funcao AND f.posto_id    = p.id
   WHERE c.id = v_contrato
     AND p.aprovado AND p.ativo AND f.aprovado AND f.ativo;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Posto ou função não pertence a este contrato (ou não está aprovado)';
  END IF;

  SELECT * INTO v_ses FROM public.sup_ext_sessao s WHERE s.user_id = v_uid;
  IF v_ses.user_id IS NOT NULL THEN
    -- Externo: identidade vem do cadastro, nunca do que o cliente mandou.
    v_origem  := 'externo';
    v_emp_id  := v_ses.empregado_id;
    v_emp_cpf := v_ses.empregado_cpf;
    v_nome    := coalesce(v_ses.empregado_nome, v_ses.login_informado);
    v_login   := upper(coalesce(v_ses.empregado_nome, v_ses.login_informado));
  ELSE
    v_origem := 'interno';
    SELECT pr.display_name INTO v_nome FROM public.profiles pr WHERE pr.id = v_uid;
    v_login  := upper(coalesce(v_nome, 'INTERNO'));
  END IF;

  IF v_tipo <> 'insumos' THEN
    IF coalesce(trim(p_payload->>'nome_colaborador'), '') = ''
       OR coalesce(trim(p_payload->>'matricula_colaborador'), '') = '' THEN
      RAISE EXCEPTION 'Informe o nome e a matrícula do colaborador';
    END IF;
  END IF;

  INSERT INTO public.sup_pedido (
    empresa_id, contrato_id, posto_id, funcao_id,
    contrato_nome, posto_nome, funcao_nome,
    criado_por, solicitante_login, solicitante_nome, origem,
    solicitante_empregado_id, solicitante_cpf,
    nome_colaborador, matricula_colaborador,
    admissao, tipo_admissao, data_admissao, imagem_cracha_path,
    tipo_pedido, observacoes_solicitante
  ) VALUES (
    v_empresa, v_contrato, v_posto, v_funcao,
    v_cnome, v_pnome, v_fnome,
    v_uid, v_login, v_nome, v_origem,
    v_emp_id, v_emp_cpf,
    coalesce(trim(p_payload->>'nome_colaborador'), ''),
    coalesce(trim(p_payload->>'matricula_colaborador'), ''),
    coalesce((p_payload->>'admissao')::boolean, false),
    nullif(p_payload->>'tipo_admissao', ''),
    nullif(p_payload->>'data_admissao', '')::date,
    nullif(p_payload->>'imagem_cracha_path', ''),
    v_tipo,
    nullif(p_payload->>'observacoes_solicitante', '')
  ) RETURNING * INTO v_ped;

  FOR it IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
    v_idx := v_idx + 1;
    IF NOT EXISTS (
      SELECT 1 FROM public.sup_funcao_item fi
       WHERE fi.funcao_id = v_funcao
         AND fi.item_id   = (it->>'item_id')::uuid
         AND fi.aprovado AND fi.ativo
    ) THEN
      RAISE EXCEPTION 'Item % não pertence a esta função', coalesce(it->>'nome_item', it->>'item_id');
    END IF;

    INSERT INTO public.sup_pedido_item
      (pedido_id, item_id, nome_item, tipo_item, tamanho, quantidade, litros, ordem)
    SELECT v_ped.id, i.id, i.nome, i.tipo,
           nullif(it->>'tamanho', ''),
           greatest(coalesce((it->>'quantidade')::int, 1), 1),
           nullif(it->>'litros', ''),
           v_idx
      FROM public.sup_item i
     WHERE i.id = (it->>'item_id')::uuid;
  END LOOP;

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_novo, observacao, alterado_por, alterado_por_nome)
  VALUES (v_ped.id, 'CRIADO', v_ped.status, 'Pedido criado', v_uid, v_nome);

  RETURN v_ped;
END $$;

-- ── 10. Grants ───────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.sup_ext_casar_empregado(text, text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sup_ext_registrar_tentativa(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sup_ext_entrar_empregado(text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sup_norm_data(text)                        FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sup_ext_entrar_empregado(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_norm_data(text)                        TO authenticated;
-- A pré-validação é a única porta aberta antes da sessão existir.
GRANT EXECUTE ON FUNCTION public.sup_ext_prevalidar(text, text)             TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
