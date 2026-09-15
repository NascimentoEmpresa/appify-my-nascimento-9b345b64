-- =====================================================================
-- SIS-2026-0385 — aprovação de fornecedor para todas as empresas
--
-- O cadastro de fornecedor já possui `is_global`, usado em todo o módulo
-- para disponibilizar um único registro a todas as empresas do grupo. A fila
-- de aprovação, porém, só aceitava uma empresa individual e nunca encaminhava
-- esse indicador à RPC.
--
-- Esta migration mantém `empresa_id` como a empresa de origem do cadastro
-- (necessário para integridade e contas bancárias) e grava `is_global = true`
-- quando o aprovador escolher "Todas as empresas". Assim a abrangência não
-- fica presa às quatro empresas atuais.
--
-- ROLLBACK:
--   Reaplicar a versão de public.sup_forn_aprovar da migration
--   20260926000007_fix_fornecedor_convite_nome.sql e remover, se desejado:
--   ALTER TABLE public.fornecedor_cadastro_pendente DROP COLUMN is_global;
-- =====================================================================

ALTER TABLE public.fornecedor_cadastro_pendente
  ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.fornecedor_cadastro_pendente.is_global IS
  'Abrangência escolhida na aprovação: true disponibiliza o fornecedor para todas as empresas.';

-- A tela precisa distinguir um cadastro global já existente de cadastros
-- locais do mesmo CNPJ para exibir corretamente criação x atualização.
DROP FUNCTION IF EXISTS public.sup_forn_cnpj_existente(text);

CREATE FUNCTION public.sup_forn_cnpj_existente(p_cnpj text)
RETURNS TABLE (
  id uuid,
  empresa_id uuid,
  razao_social text,
  ativo boolean,
  is_global boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id, f.empresa_id, f.razao_social, f.ativo, f.is_global
    FROM public.fornecedor f
   WHERE regexp_replace(coalesce(f.cnpj_cpf, ''), '\D', '', 'g')
       = regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g')
     AND regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g') <> ''
     AND public.can_access(auth.uid(), 'sup_fornecedor_aprovacao', 'visualizar');
$$;

REVOKE ALL ON FUNCTION public.sup_forn_cnpj_existente(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_forn_cnpj_existente(text) TO authenticated;

-- A assinatura ganha apenas um argumento opcional no final. Remover a versão
-- anterior evita overload ambíguo no PostgREST; chamadas antigas continuam
-- funcionando porque p_is_global tem default false.
DROP FUNCTION IF EXISTS public.sup_forn_aprovar(uuid, uuid, jsonb);

CREATE FUNCTION public.sup_forn_aprovar(
  p_id         uuid,
  p_empresa_id uuid,
  p_campos     jsonb DEFAULT NULL,
  p_is_global  boolean DEFAULT false
) RETURNS public.fornecedor
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_nome      text := public.sup_malote_nome_ator();
  v_p         public.fornecedor_cadastro_pendente;
  v_forn      public.fornecedor;
  v_id        uuid;
  v_conta     jsonb;
  v_pix       text;
  v_is_global boolean := coalesce(p_is_global, false);
BEGIN
  IF NOT public.can_access(v_uid, 'sup_fornecedor_aprovacao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar cadastro de fornecedor';
  END IF;
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Escolha a empresa do cadastro antes de aprovar';
  END IF;

  SELECT * INTO v_p
    FROM public.fornecedor_cadastro_pendente
   WHERE id = p_id
   FOR UPDATE;

  IF v_p IS NULL THEN RAISE EXCEPTION 'Cadastro não encontrado'; END IF;
  IF v_p.status <> 'pendente' THEN
    RAISE EXCEPTION 'Este cadastro já foi %', v_p.status;
  END IF;

  -- Global encontra somente o global já existente; local encontra somente o
  -- cadastro daquela empresa. Isso impede uma aprovação local de rebaixar ou
  -- sobrescrever silenciosamente um fornecedor global.
  SELECT f.id INTO v_id
    FROM public.fornecedor f
   WHERE f.is_global = v_is_global
     AND (v_is_global OR f.empresa_id = p_empresa_id)
     AND regexp_replace(coalesce(f.cnpj_cpf, ''), '\D', '', 'g')
       = regexp_replace(coalesce(v_p.cnpj_cpf, ''), '\D', '', 'g')
   ORDER BY f.created_at
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.fornecedor (
      empresa_id, tipo, cnpj_cpf, razao_social, nome_fantasia, inscricao_estadual,
      cnae_principal, contato, email, telefone, cep, logradouro, numero,
      complemento, bairro, cidade, uf, observacoes,
      email_financeiro, email_nota_fiscal, telefone_vendedor, formas_pagamento,
      condicao_pagamento, prazo_entrega_dias, devolucao_prazo_dias,
      devolucao_procedimento, ativo, is_global
    ) VALUES (
      p_empresa_id, v_p.tipo::public.fornecedor_tipo, v_p.cnpj_cpf, v_p.razao_social,
      v_p.nome_fantasia, v_p.inscricao_estadual, v_p.cnae_principal, v_p.contato,
      v_p.email, v_p.telefone, v_p.cep, v_p.logradouro, v_p.numero, v_p.complemento,
      v_p.bairro, v_p.cidade, v_p.uf, v_p.observacoes,
      v_p.email_financeiro, v_p.email_nota_fiscal, v_p.telefone_vendedor,
      v_p.formas_pagamento, v_p.condicao_pagamento, v_p.prazo_entrega_dias,
      v_p.devolucao_prazo_dias, v_p.devolucao_procedimento, true, v_is_global
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

  FOR v_conta IN
    SELECT * FROM jsonb_array_elements(coalesce(v_p.contas_bancarias, '[]'::jsonb))
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
     SET status = 'aprovado',
         empresa_id = p_empresa_id,
         fornecedor_id = v_id,
         is_global = v_is_global,
         decidido_por = v_uid,
         decidido_por_nome = v_nome,
         decidido_em = now()
   WHERE id = p_id;

  RETURN v_forn;
END $$;

REVOKE ALL ON FUNCTION public.sup_forn_aprovar(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_forn_aprovar(uuid, uuid, jsonb, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
