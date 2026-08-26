-- =====================================================================
-- HOTFIX — "column \"nome\" does not exist" ao gerar link de cadastro de
--          fornecedor
--
-- BUG EM PRODUÇÃO, introduzido por mim na 20260925000003 (SIS-2026-0209).
-- Sintoma: em /app/suprimentos/fornecedores/pendentes, o botão "Gerar e
-- copiar" falha com `column "nome" does not exist`. A tela abre, o modal
-- abre, e o link nunca é gerado.
--
-- CAUSA: as três RPCs leem `profiles.nome`. Essa coluna NUNCA EXISTIU —
-- public.profiles tem `display_name`, `email`, `telefone`, `cargo`,
-- `must_change_password`, `empresa_id`, `empresa_atual_id`, `ativo`.
--
-- Como passou: ao escrever, procurei o padrão com
-- `grep "nome INTO v_nome FROM public.profiles"` e o grep retornou uma
-- ocorrência — que era do MEU PRÓPRIO arquivo, já escrito. Verificação
-- circular: confirmei a mim mesmo. O `npx tsc` não pega isso porque é SQL, e
-- migration não roda em CI.
--
-- CORREÇÃO: usar `public.sup_malote_nome_ator()`, que já existe desde a
-- 20260831000001 e resolve exatamente este problema, com fallback:
--     COALESCE(display_name, email, 'Usuário sem nome')
--
-- Reusar em vez de reescrever a expressão em cada função — se o cadastro de
-- usuário mudar de novo, muda num lugar só.
--
-- Idempotente. Só redefine as três funções; nenhum dado é tocado.
--
-- ROLLBACK: não fazer. A versão anterior está quebrada.
-- =====================================================================

-- ── 1) Gerar convite ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_forn_gerar_convite(
  p_destinatario text DEFAULT NULL,
  p_observacao   text DEFAULT NULL,
  p_dias         integer DEFAULT 30
) RETURNS public.fornecedor_convite
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text := public.sup_malote_nome_ator();
  v_emp   uuid;
  v_row   public.fornecedor_convite;
BEGIN
  IF NOT public.can_access(v_uid, 'fornecedores', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para convidar fornecedor';
  END IF;

  -- Só a empresa: o nome vem do helper acima.
  SELECT empresa_atual_id INTO v_emp FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.fornecedor_convite
    (token, empresa_id, criado_por, criado_por_nome, destinatario, observacao, expira_em)
  VALUES (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    v_emp, v_uid, v_nome, nullif(btrim(coalesce(p_destinatario, '')), ''),
    nullif(btrim(coalesce(p_observacao, '')), ''),
    CASE WHEN p_dias IS NULL OR p_dias <= 0 THEN NULL
         ELSE now() + make_interval(days => p_dias) END
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.sup_forn_gerar_convite(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_forn_gerar_convite(text, text, integer) TO authenticated;

-- ── 2) Aprovar cadastro ──────────────────────────────────────────────
--
-- Mesma correção. O corpo é idêntico ao da 20260925000003, exceto pela linha
-- do nome.
CREATE OR REPLACE FUNCTION public.sup_forn_aprovar(
  p_id         uuid,
  p_empresa_id uuid,
  p_campos     jsonb DEFAULT NULL
) RETURNS public.fornecedor
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text := public.sup_malote_nome_ator();
  v_p     public.fornecedor_cadastro_pendente;
  v_forn  public.fornecedor;
  v_id    uuid;
  v_conta jsonb;
  v_pix   text;
BEGIN
  IF NOT public.can_access(v_uid, 'sup_fornecedor_aprovacao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar cadastro de fornecedor';
  END IF;
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Escolha a empresa do cadastro antes de aprovar';
  END IF;

  SELECT * INTO v_p FROM public.fornecedor_cadastro_pendente WHERE id = p_id FOR UPDATE;
  IF v_p IS NULL THEN RAISE EXCEPTION 'Cadastro não encontrado'; END IF;
  IF v_p.status <> 'pendente' THEN
    RAISE EXCEPTION 'Este cadastro já foi %', v_p.status;
  END IF;

  SELECT f.id INTO v_id
    FROM public.fornecedor f
   WHERE f.empresa_id = p_empresa_id
     AND regexp_replace(coalesce(f.cnpj_cpf, ''), '\D', '', 'g')
       = regexp_replace(coalesce(v_p.cnpj_cpf, ''), '\D', '', 'g');

  IF v_id IS NULL THEN
    INSERT INTO public.fornecedor (
      empresa_id, tipo, cnpj_cpf, razao_social, nome_fantasia, inscricao_estadual,
      cnae_principal, contato, email, telefone, cep, logradouro, numero,
      complemento, bairro, cidade, uf, observacoes,
      email_financeiro, email_nota_fiscal, telefone_vendedor, formas_pagamento,
      condicao_pagamento, prazo_entrega_dias, devolucao_prazo_dias,
      devolucao_procedimento, ativo
    ) VALUES (
      p_empresa_id, v_p.tipo::public.fornecedor_tipo, v_p.cnpj_cpf, v_p.razao_social,
      v_p.nome_fantasia, v_p.inscricao_estadual, v_p.cnae_principal, v_p.contato,
      v_p.email, v_p.telefone, v_p.cep, v_p.logradouro, v_p.numero, v_p.complemento,
      v_p.bairro, v_p.cidade, v_p.uf, v_p.observacoes,
      v_p.email_financeiro, v_p.email_nota_fiscal, v_p.telefone_vendedor,
      v_p.formas_pagamento, v_p.condicao_pagamento, v_p.prazo_entrega_dias,
      v_p.devolucao_prazo_dias, v_p.devolucao_procedimento, true
    )
    RETURNING * INTO v_forn;
    v_id := v_forn.id;
  ELSE
    UPDATE public.fornecedor f SET
      razao_social       = CASE WHEN (p_campos IS NULL OR p_campos ? 'razao_social')       AND v_p.razao_social       IS NOT NULL THEN v_p.razao_social       ELSE f.razao_social END,
      nome_fantasia      = CASE WHEN (p_campos IS NULL OR p_campos ? 'nome_fantasia')      AND v_p.nome_fantasia      IS NOT NULL THEN v_p.nome_fantasia      ELSE f.nome_fantasia END,
      inscricao_estadual = CASE WHEN (p_campos IS NULL OR p_campos ? 'inscricao_estadual') AND v_p.inscricao_estadual IS NOT NULL THEN v_p.inscricao_estadual ELSE f.inscricao_estadual END,
      cnae_principal     = CASE WHEN (p_campos IS NULL OR p_campos ? 'cnae_principal')     AND v_p.cnae_principal     IS NOT NULL THEN v_p.cnae_principal     ELSE f.cnae_principal END,
      contato            = CASE WHEN (p_campos IS NULL OR p_campos ? 'contato')            AND v_p.contato            IS NOT NULL THEN v_p.contato            ELSE f.contato END,
      email              = CASE WHEN (p_campos IS NULL OR p_campos ? 'email')              AND v_p.email              IS NOT NULL THEN v_p.email              ELSE f.email END,
      telefone           = CASE WHEN (p_campos IS NULL OR p_campos ? 'telefone')           AND v_p.telefone           IS NOT NULL THEN v_p.telefone           ELSE f.telefone END,
      cep                = CASE WHEN (p_campos IS NULL OR p_campos ? 'cep')                AND v_p.cep                IS NOT NULL THEN v_p.cep                ELSE f.cep END,
      logradouro         = CASE WHEN (p_campos IS NULL OR p_campos ? 'logradouro')         AND v_p.logradouro         IS NOT NULL THEN v_p.logradouro         ELSE f.logradouro END,
      numero             = CASE WHEN (p_campos IS NULL OR p_campos ? 'numero')             AND v_p.numero             IS NOT NULL THEN v_p.numero             ELSE f.numero END,
      complemento        = CASE WHEN (p_campos IS NULL OR p_campos ? 'complemento')        AND v_p.complemento        IS NOT NULL THEN v_p.complemento        ELSE f.complemento END,
      bairro             = CASE WHEN (p_campos IS NULL OR p_campos ? 'bairro')             AND v_p.bairro             IS NOT NULL THEN v_p.bairro             ELSE f.bairro END,
      cidade             = CASE WHEN (p_campos IS NULL OR p_campos ? 'cidade')             AND v_p.cidade             IS NOT NULL THEN v_p.cidade             ELSE f.cidade END,
      uf                 = CASE WHEN (p_campos IS NULL OR p_campos ? 'uf')                 AND v_p.uf                 IS NOT NULL THEN v_p.uf                 ELSE f.uf END,
      observacoes        = CASE WHEN (p_campos IS NULL OR p_campos ? 'observacoes')        AND v_p.observacoes        IS NOT NULL THEN v_p.observacoes        ELSE f.observacoes END,
      email_financeiro   = CASE WHEN (p_campos IS NULL OR p_campos ? 'email_financeiro')   AND v_p.email_financeiro   IS NOT NULL THEN v_p.email_financeiro   ELSE f.email_financeiro END,
      email_nota_fiscal  = CASE WHEN (p_campos IS NULL OR p_campos ? 'email_nota_fiscal')  AND v_p.email_nota_fiscal  IS NOT NULL THEN v_p.email_nota_fiscal  ELSE f.email_nota_fiscal END,
      telefone_vendedor  = CASE WHEN (p_campos IS NULL OR p_campos ? 'telefone_vendedor')  AND v_p.telefone_vendedor  IS NOT NULL THEN v_p.telefone_vendedor  ELSE f.telefone_vendedor END,
      formas_pagamento   = CASE WHEN (p_campos IS NULL OR p_campos ? 'formas_pagamento')   AND array_length(v_p.formas_pagamento, 1) IS NOT NULL THEN v_p.formas_pagamento ELSE f.formas_pagamento END,
      condicao_pagamento = CASE WHEN (p_campos IS NULL OR p_campos ? 'condicao_pagamento') AND v_p.condicao_pagamento IS NOT NULL THEN v_p.condicao_pagamento ELSE f.condicao_pagamento END,
      prazo_entrega_dias = CASE WHEN (p_campos IS NULL OR p_campos ? 'prazo_entrega_dias') AND v_p.prazo_entrega_dias IS NOT NULL THEN v_p.prazo_entrega_dias ELSE f.prazo_entrega_dias END,
      devolucao_prazo_dias   = CASE WHEN (p_campos IS NULL OR p_campos ? 'devolucao_prazo_dias')   AND v_p.devolucao_prazo_dias   IS NOT NULL THEN v_p.devolucao_prazo_dias   ELSE f.devolucao_prazo_dias END,
      devolucao_procedimento = CASE WHEN (p_campos IS NULL OR p_campos ? 'devolucao_procedimento') AND v_p.devolucao_procedimento IS NOT NULL THEN v_p.devolucao_procedimento ELSE f.devolucao_procedimento END
    WHERE f.id = v_id
    RETURNING * INTO v_forn;
  END IF;

  FOR v_conta IN SELECT * FROM jsonb_array_elements(coalesce(v_p.contas_bancarias, '[]'::jsonb))
  LOOP
    CONTINUE WHEN coalesce(v_conta->>'banco_codigo', '') = ''
                  AND coalesce(v_conta->>'pix_chave', '') = '';

    v_pix := nullif(v_conta->>'pix_tipo', '');
    IF v_pix IS NOT NULL AND v_pix NOT IN ('cpf','cnpj','email','telefone','aleatoria') THEN
      v_pix := NULL;
    END IF;

    INSERT INTO public.fornecedor_conta_bancaria (
      fornecedor_id, empresa_id, banco_codigo, banco_nome, agencia, agencia_digito,
      conta, conta_digito, tipo, titular_nome, titular_documento,
      pix_tipo, pix_chave, principal, ativa
    ) VALUES (
      v_id, p_empresa_id,
      coalesce(nullif(v_conta->>'banco_codigo', ''), '000'),
      coalesce(nullif(v_conta->>'banco_nome', ''), 'Informado pelo fornecedor'),
      coalesce(nullif(v_conta->>'agencia', ''), '0'),
      nullif(v_conta->>'agencia_digito', ''),
      coalesce(nullif(v_conta->>'conta', ''), '0'),
      nullif(v_conta->>'conta_digito', ''),
      coalesce(nullif(v_conta->>'tipo', ''), 'corrente'),
      nullif(v_conta->>'titular_nome', ''),
      nullif(v_conta->>'titular_documento', ''),
      v_pix,
      nullif(v_conta->>'pix_chave', ''),
      coalesce((v_conta->>'principal')::boolean, false),
      true
    );
  END LOOP;

  UPDATE public.fornecedor_cadastro_pendente
     SET status = 'aprovado', empresa_id = p_empresa_id, fornecedor_id = v_id,
         decidido_por = v_uid, decidido_por_nome = v_nome, decidido_em = now()
   WHERE id = p_id;

  RETURN v_forn;
END $$;

REVOKE ALL ON FUNCTION public.sup_forn_aprovar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_forn_aprovar(uuid, uuid, jsonb) TO authenticated;

-- ── 3) Reprovar cadastro ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_forn_reprovar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text := public.sup_malote_nome_ator();
BEGIN
  IF NOT public.can_access(v_uid, 'sup_fornecedor_aprovacao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para reprovar cadastro de fornecedor';
  END IF;
  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação';
  END IF;

  UPDATE public.fornecedor_cadastro_pendente
     SET status = 'reprovado', motivo_reprovacao = btrim(p_motivo),
         decidido_por = v_uid, decidido_por_nome = v_nome, decidido_em = now()
   WHERE id = p_id AND status = 'pendente';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cadastro não encontrado ou já decidido';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.sup_forn_reprovar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_forn_reprovar(uuid, text) TO authenticated;

-- ── Conferência ──────────────────────────────────────────────────────
-- Nenhuma das três pode mais referenciar profiles.nome.
SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('sup_forn_gerar_convite','sup_forn_aprovar','sup_forn_reprovar')
   AND pg_get_functiondef(p.oid) LIKE '%profiles.nome%';
-- Esperado: 0 linhas.

NOTIFY pgrst, 'reload schema';
