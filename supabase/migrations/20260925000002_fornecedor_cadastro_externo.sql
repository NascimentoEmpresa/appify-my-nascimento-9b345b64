-- =====================================================================
-- SIS-2026-0209 — cadastro de fornecedor preenchido pelo PRÓPRIO fornecedor
--
-- Hoje quem digita o cadastro é o comprador, com o que o vendedor mandou por
-- WhatsApp. Falta dado (e-mail da nota, banco, prazo) e ninguém percebe até a
-- hora de pagar. Pedido do gerente de Suprimentos:
--
--   "Ter um linkzinho que a gente enviasse para o fornecedor e ele
--    preenchesse ali. Quando ele finalizar, a gente recebe e aprova o
--    cadastro dele. Não é nós que fazemos o cadastro."
--
-- FLUXO
--   comprador gera convite  →  manda o link no WhatsApp
--     →  fornecedor preenche SEM LOGIN (Edge Function fornecedor-cadastro-publico)
--     →  cai na fila "Cadastros Pendentes" do Suprimentos
--     →  alguém aprova, escolhendo a EMPRESA
--     →  vira public.fornecedor (+ contas bancárias)
--
-- POR QUE A EMPRESA SÓ É DEFINIDA NA APROVAÇÃO: public.fornecedor tem
-- UNIQUE (empresa_id, cnpj_cpf) e empresa_id NOT NULL, mas quem está de fora
-- não sabe (nem deve saber) a estrutura de empresas do grupo. O pendente nasce
-- sem empresa e quem aprova decide — e é nesse momento que dá para saber se o
-- CNPJ já existe NAQUELA empresa, virando ATUALIZAÇÃO em vez de cadastro novo.
--
-- Idempotente.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.fornecedor_cadastro_pendente CASCADE;
--   DROP TABLE IF EXISTS public.fornecedor_convite CASCADE;
--   DROP FUNCTION IF EXISTS public.sup_forn_gerar_convite(text, text, int);
--   DROP FUNCTION IF EXISTS public.sup_forn_aprovar(uuid, uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.sup_forn_reprovar(uuid, text);
--   DROP FUNCTION IF EXISTS public.sup_forn_cnpj_existente(text);
--   DROP FUNCTION IF EXISTS public.sup_forn_validar_convite(text);
--   DROP FUNCTION IF EXISTS public.sup_forn_enviar_cadastro(text, jsonb);
--   DELETE FROM public.app_menu WHERE codigo = 'sup_fornecedor_aprovacao';
--   ALTER TABLE public.fornecedor
--     DROP COLUMN IF EXISTS email_financeiro,
--     DROP COLUMN IF EXISTS email_nota_fiscal,
--     DROP COLUMN IF EXISTS telefone_vendedor,
--     DROP COLUMN IF EXISTS formas_pagamento,
--     DROP COLUMN IF EXISTS prazo_entrega_dias,
--     DROP COLUMN IF EXISTS condicao_pagamento,
--     DROP COLUMN IF EXISTS devolucao_prazo_dias,
--     DROP COLUMN IF EXISTS devolucao_procedimento;
-- =====================================================================

-- ── 1) Campos que faltavam no cadastro ───────────────────────────────
--
-- O resto o cadastro já tinha (CNPJ, razão social, IE, CNAE, endereço
-- completo, pix_chave/pix_tipo). O que falta é o que ele ditou na reunião e
-- que hoje vive solto dentro de `observacoes`, em texto livre — o placeholder
-- da tela dizia literalmente "Prazo de entrega, condição de pagamento, o que
-- for útil na compra".
ALTER TABLE public.fornecedor
  ADD COLUMN IF NOT EXISTS email_financeiro       text,
  ADD COLUMN IF NOT EXISTS email_nota_fiscal      text,
  ADD COLUMN IF NOT EXISTS telefone_vendedor      text,
  -- boleto / pix / transferencia — o que o fornecedor aceita receber.
  ADD COLUMN IF NOT EXISTS formas_pagamento       text[] NOT NULL DEFAULT '{}',
  -- "qual o prazo de entrega do pedido após o pedido finalizado"
  ADD COLUMN IF NOT EXISTS prazo_entrega_dias     integer,
  ADD COLUMN IF NOT EXISTS condicao_pagamento     text,
  -- "no caso de uma devolução, como é o processo da empresa dele?
  --  Sete dias para devolver, devolve com qual descrição"
  ADD COLUMN IF NOT EXISTS devolucao_prazo_dias   integer,
  ADD COLUMN IF NOT EXISTS devolucao_procedimento text;

COMMENT ON COLUMN public.fornecedor.formas_pagamento IS
  'Formas que o fornecedor aceita: boleto, pix, transferencia. SIS-2026-0209.';
COMMENT ON COLUMN public.fornecedor.devolucao_procedimento IS
  'Como devolver para este fornecedor, para o comprador não ter de ligar e perguntar.';

-- ── 2) Convite ───────────────────────────────────────────────────────
--
-- Um token por convite, e não um link público fixo: o comprador precisa saber
-- quem convidou quem, e o link morre depois de usado.
CREATE TABLE IF NOT EXISTS public.fornecedor_convite (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token           text NOT NULL UNIQUE,
  -- Empresa de quem gerou. É INFORMATIVA: a empresa que vale é a escolhida na
  -- aprovação. Guardada para a fila conseguir dizer de onde o convite saiu.
  empresa_id      uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  criado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_por_nome text,
  -- Para quem o comprador disse que ia mandar (nome da empresa, e-mail, zap).
  destinatario    text,
  observacao      text,
  expira_em       timestamptz,
  usado_em        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fornecedor_convite_token ON public.fornecedor_convite(token);
CREATE INDEX IF NOT EXISTS idx_fornecedor_convite_criador ON public.fornecedor_convite(criado_por, created_at DESC);

-- ── 3) Cadastro pendente ─────────────────────────────────────────────
--
-- O que o fornecedor preencheu, esperando aprovação. Colunas tipadas (e não um
-- jsonb solto) porque quem aprova precisa comparar campo a campo com o
-- cadastro existente quando o CNPJ já é conhecido.
CREATE TABLE IF NOT EXISTS public.fornecedor_cadastro_pendente (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  convite_id    uuid REFERENCES public.fornecedor_convite(id) ON DELETE SET NULL,

  tipo                text NOT NULL DEFAULT 'pj' CHECK (tipo IN ('pj','pf')),
  cnpj_cpf            text NOT NULL,
  razao_social        text NOT NULL,
  nome_fantasia       text,
  inscricao_estadual  text,
  cnae_principal      text,

  email               text,
  email_financeiro    text,
  email_nota_fiscal   text,
  contato             text,
  telefone            text,
  telefone_vendedor   text,

  cep                 text,
  logradouro          text,
  numero              text,
  complemento         text,
  bairro              text,
  cidade              text,
  uf                  text,

  formas_pagamento       text[] NOT NULL DEFAULT '{}',
  condicao_pagamento     text,
  prazo_entrega_dias     integer,
  devolucao_prazo_dias   integer,
  devolucao_procedimento text,
  observacoes            text,

  -- Lista de contas: [{banco_codigo, banco_nome, agencia, agencia_digito,
  -- conta, conta_digito, tipo, titular_nome, titular_documento,
  -- pix_tipo, pix_chave, principal}]
  contas_bancarias jsonb NOT NULL DEFAULT '[]'::jsonb,

  status            text NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','aprovado','reprovado')),
  motivo_reprovacao text,
  -- Só preenchidos na decisão. empresa_id é NULO enquanto pendente, de
  -- propósito: ver o cabeçalho.
  empresa_id        uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  fornecedor_id     uuid REFERENCES public.fornecedor(id) ON DELETE SET NULL,
  decidido_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_por_nome text,
  decidido_em       timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forn_pendente_status ON public.fornecedor_cadastro_pendente(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forn_pendente_cnpj   ON public.fornecedor_cadastro_pendente(cnpj_cpf);

DROP TRIGGER IF EXISTS trg_forn_pendente_upd ON public.fornecedor_cadastro_pendente;
CREATE TRIGGER trg_forn_pendente_upd
  BEFORE UPDATE ON public.fornecedor_cadastro_pendente
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4) Menu da fila de aprovação ─────────────────────────────────────
--
-- Menu próprio, e não a ação 'aprovar' de `fornecedores`: cadastrar fornecedor
-- e aprovar cadastro que veio de fora são coisas diferentes, e o módulo já
-- separa assim em sup_catalogo / sup_catalogo_aprovacao.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_fornecedor_aprovacao', 'Cadastros de Fornecedor',
       '/app/suprimentos/fornecedores/pendentes',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 10,
       true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- Menu SEM nenhuma regra é tratado como ABERTO para todo autenticado (ver
-- list_configured_menu_codes). Semear no perfil concede_tudo não muda nada
-- para ele — só marca o menu como configurado, e a partir daí vale
-- negado-por-padrão. Mesmo procedimento da 20260823000002 e da 20260828000003.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sup_fornecedor_aprovacao', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 5) RLS ───────────────────────────────────────────────────────────
--
-- Nenhuma das duas tabelas é exposta ao `anon`: quem escreve pelo lado público
-- é a Edge Function fornecedor-cadastro-publico, com service role. Aqui só o
-- lado de dentro.
ALTER TABLE public.fornecedor_convite            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedor_cadastro_pendente  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fornecedor_convite_select ON public.fornecedor_convite;
CREATE POLICY fornecedor_convite_select ON public.fornecedor_convite
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'fornecedores', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_fornecedor_aprovacao', 'visualizar')
  );

-- Convite nasce só pela RPC (SECURITY DEFINER), que é onde o token é gerado.
DROP POLICY IF EXISTS fornecedor_convite_write ON public.fornecedor_convite;
CREATE POLICY fornecedor_convite_write ON public.fornecedor_convite
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'fornecedores', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'fornecedores', 'alterar'));

DROP POLICY IF EXISTS fornecedor_pendente_select ON public.fornecedor_cadastro_pendente;
CREATE POLICY fornecedor_pendente_select ON public.fornecedor_cadastro_pendente
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_fornecedor_aprovacao', 'visualizar'));

DROP POLICY IF EXISTS fornecedor_pendente_write ON public.fornecedor_cadastro_pendente;
CREATE POLICY fornecedor_pendente_write ON public.fornecedor_cadastro_pendente
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'sup_fornecedor_aprovacao', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'sup_fornecedor_aprovacao', 'alterar'));

DROP POLICY IF EXISTS fornecedor_pendente_delete ON public.fornecedor_cadastro_pendente;
CREATE POLICY fornecedor_pendente_delete ON public.fornecedor_cadastro_pendente
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'sup_fornecedor_aprovacao', 'excluir'));

-- ── 6) Gerar convite ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_forn_gerar_convite(
  p_destinatario text DEFAULT NULL,
  p_observacao   text DEFAULT NULL,
  p_dias         integer DEFAULT 30
) RETURNS public.fornecedor_convite
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_emp   uuid;
  v_row   public.fornecedor_convite;
BEGIN
  IF NOT public.can_access(v_uid, 'fornecedores', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para convidar fornecedor';
  END IF;

  SELECT nome, empresa_atual_id INTO v_nome, v_emp
    FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.fornecedor_convite
    (token, empresa_id, criado_por, criado_por_nome, destinatario, observacao, expira_em)
  VALUES (
    -- 32 hex sem hífen: cabe na URL e não é adivinhável.
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

-- ── 7) O CNPJ já existe? ─────────────────────────────────────────────
--
-- Chamada pela fila ao escolher a empresa: é o que decide se a aprovação é um
-- cadastro NOVO ou uma ATUALIZAÇÃO do que já está lá. Só dígitos, porque o
-- fornecedor digita com máscara e o cadastro antigo nem sempre tem.
CREATE OR REPLACE FUNCTION public.sup_forn_cnpj_existente(p_cnpj text)
RETURNS TABLE (id uuid, empresa_id uuid, razao_social text, ativo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id, f.empresa_id, f.razao_social, f.ativo
    FROM public.fornecedor f
   WHERE regexp_replace(coalesce(f.cnpj_cpf, ''), '\D', '', 'g')
       = regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g')
     AND regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g') <> ''
     AND public.can_access(auth.uid(), 'sup_fornecedor_aprovacao', 'visualizar');
$$;

REVOKE ALL ON FUNCTION public.sup_forn_cnpj_existente(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_forn_cnpj_existente(text) TO authenticated;

-- ── 8) Aprovar ───────────────────────────────────────────────────────
--
-- p_campos é opcional e existe para o caso ATUALIZAÇÃO: quem aprova marca
-- quais campos quer trazer do pendente. Vindo NULL, traz tudo que não é nulo.
-- Cadastro novo ignora p_campos.
CREATE OR REPLACE FUNCTION public.sup_forn_aprovar(
  p_id         uuid,
  p_empresa_id uuid,
  p_campos     jsonb DEFAULT NULL
) RETURNS public.fornecedor
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text;
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

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_uid;

  -- Já existe esse CNPJ nessa empresa? Então é atualização.
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
    -- Atualização: campo nulo no pendente nunca apaga o que já existe, e
    -- p_campos (quando vem) limita ao que o aprovador marcou.
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

  -- Contas bancárias: acrescenta as que vieram, sem apagar as que já existem.
  -- Devolver conta antiga não é problema do cadastro — desativar é decisão de
  -- quem cuida do Financeiro.
  FOR v_conta IN SELECT * FROM jsonb_array_elements(coalesce(v_p.contas_bancarias, '[]'::jsonb))
  LOOP
    CONTINUE WHEN coalesce(v_conta->>'banco_codigo', '') = ''
                  AND coalesce(v_conta->>'pix_chave', '') = '';

    -- pix_tipo tem CHECK no banco. O valor vem de fora, então um lixo aqui
    -- derrubaria a aprovação inteira por causa de um campo acessório —
    -- melhor gravar a chave sem o tipo do que perder o cadastro.
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

-- ── 9) Reprovar ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_forn_reprovar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
BEGIN
  IF NOT public.can_access(v_uid, 'sup_fornecedor_aprovacao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para reprovar cadastro de fornecedor';
  END IF;
  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação';
  END IF;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_uid;

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

-- ── 10) Lado público ─────────────────────────────────────────────────
--
-- As duas únicas coisas que o mundo de fora alcança, e só através da Edge
-- Function fornecedor-cadastro-publico, que usa a chave ANON — o GRANT abaixo
-- é a barreira real, igual ao Canal de Denúncia (ver denuncia-registrar).
--
-- O token É a credencial. Não há login, então tudo que estas funções fazem é
-- checado contra ele: existe, não expirou e não foi usado.

-- Só diz se o link ainda vale. Não devolve NADA da empresa nem do convite —
-- quem está de fora não precisa saber para quem está se cadastrando.
CREATE OR REPLACE FUNCTION public.sup_forn_validar_convite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c public.fornecedor_convite;
BEGIN
  SELECT * INTO v_c FROM public.fornecedor_convite WHERE token = p_token;

  IF v_c IS NULL THEN
    RETURN jsonb_build_object('valido', false, 'motivo', 'inexistente');
  ELSIF v_c.usado_em IS NOT NULL THEN
    RETURN jsonb_build_object('valido', false, 'motivo', 'ja_usado');
  ELSIF v_c.expira_em IS NOT NULL AND v_c.expira_em < now() THEN
    RETURN jsonb_build_object('valido', false, 'motivo', 'expirado');
  END IF;

  RETURN jsonb_build_object('valido', true);
END $$;

-- Grava o que o fornecedor preencheu e queima o convite. O cadastro NÃO vira
-- fornecedor aqui: fica pendente até alguém aprovar e escolher a empresa.
CREATE OR REPLACE FUNCTION public.sup_forn_enviar_cadastro(p_token text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c  public.fornecedor_convite;
  v_id uuid;
BEGIN
  SELECT * INTO v_c FROM public.fornecedor_convite WHERE token = p_token FOR UPDATE;

  IF v_c IS NULL THEN
    RAISE EXCEPTION 'Link inválido';
  ELSIF v_c.usado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este link já foi utilizado';
  ELSIF v_c.expira_em IS NOT NULL AND v_c.expira_em < now() THEN
    RAISE EXCEPTION 'Este link expirou';
  END IF;

  IF coalesce(btrim(p_payload->>'cnpj_cpf'), '') = ''
     OR coalesce(btrim(p_payload->>'razao_social'), '') = '' THEN
    RAISE EXCEPTION 'CNPJ e razão social são obrigatórios';
  END IF;

  INSERT INTO public.fornecedor_cadastro_pendente (
    convite_id, tipo, cnpj_cpf, razao_social, nome_fantasia, inscricao_estadual,
    cnae_principal, email, email_financeiro, email_nota_fiscal, contato,
    telefone, telefone_vendedor, cep, logradouro, numero, complemento, bairro,
    cidade, uf, formas_pagamento, condicao_pagamento, prazo_entrega_dias,
    devolucao_prazo_dias, devolucao_procedimento, observacoes, contas_bancarias
  ) VALUES (
    v_c.id,
    CASE WHEN length(regexp_replace(coalesce(p_payload->>'cnpj_cpf',''), '\D', '', 'g')) = 11
         THEN 'pf' ELSE 'pj' END,
    btrim(p_payload->>'cnpj_cpf'), btrim(p_payload->>'razao_social'),
    nullif(btrim(coalesce(p_payload->>'nome_fantasia','')), ''),
    nullif(btrim(coalesce(p_payload->>'inscricao_estadual','')), ''),
    nullif(btrim(coalesce(p_payload->>'cnae_principal','')), ''),
    nullif(btrim(coalesce(p_payload->>'email','')), ''),
    nullif(btrim(coalesce(p_payload->>'email_financeiro','')), ''),
    nullif(btrim(coalesce(p_payload->>'email_nota_fiscal','')), ''),
    nullif(btrim(coalesce(p_payload->>'contato','')), ''),
    nullif(btrim(coalesce(p_payload->>'telefone','')), ''),
    nullif(btrim(coalesce(p_payload->>'telefone_vendedor','')), ''),
    nullif(btrim(coalesce(p_payload->>'cep','')), ''),
    nullif(btrim(coalesce(p_payload->>'logradouro','')), ''),
    nullif(btrim(coalesce(p_payload->>'numero','')), ''),
    nullif(btrim(coalesce(p_payload->>'complemento','')), ''),
    nullif(btrim(coalesce(p_payload->>'bairro','')), ''),
    nullif(btrim(coalesce(p_payload->>'cidade','')), ''),
    upper(nullif(btrim(coalesce(p_payload->>'uf','')), '')),
    COALESCE(
      (SELECT array_agg(x) FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(p_payload->'formas_pagamento') = 'array'
              THEN p_payload->'formas_pagamento' ELSE '[]'::jsonb END) AS t(x)),
      '{}'
    ),
    nullif(btrim(coalesce(p_payload->>'condicao_pagamento','')), ''),
    nullif(p_payload->>'prazo_entrega_dias', '')::integer,
    nullif(p_payload->>'devolucao_prazo_dias', '')::integer,
    nullif(btrim(coalesce(p_payload->>'devolucao_procedimento','')), ''),
    nullif(btrim(coalesce(p_payload->>'observacoes','')), ''),
    CASE WHEN jsonb_typeof(p_payload->'contas_bancarias') = 'array'
         THEN p_payload->'contas_bancarias' ELSE '[]'::jsonb END
  )
  RETURNING id INTO v_id;

  UPDATE public.fornecedor_convite SET usado_em = now() WHERE id = v_c.id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- Estas duas SÃO alcançáveis pelo anon, de propósito. É o mesmo desenho do
-- Canal de Denúncia: a função valida tudo e não devolve dado de dentro.
REVOKE ALL ON FUNCTION public.sup_forn_validar_convite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sup_forn_validar_convite(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.sup_forn_enviar_cadastro(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sup_forn_enviar_cadastro(text, jsonb) TO anon, authenticated;

-- ── Conferência ──────────────────────────────────────────────────────
SELECT 'menu configurado' AS o_que,
       EXISTS (SELECT 1 FROM public.perfil_acesso_permissao
                WHERE menu_codigo = 'sup_fornecedor_aprovacao') AS ok;

NOTIFY pgrst, 'reload schema';
