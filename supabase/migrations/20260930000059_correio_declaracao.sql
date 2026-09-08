-- =====================================================================
-- SIS-2026-0322 — Declaração de Conteúdo dos Correios
-- =====================================================================

-- 1) Numeração. O advisory lock serializa dois salvamentos concorrentes; o
-- maior número é calculado por ano para cada janeiro voltar a DEC-AAAA-0001.
CREATE OR REPLACE FUNCTION public.sup_gerar_declaracao_numero()
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ano text := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY');
  v_ultimo integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sup_correio_declaracao:' || v_ano));
  SELECT COALESCE(MAX(substring(d.numero FROM 10)::integer), 0)
    INTO v_ultimo
    FROM public.sup_correio_declaracao d
   WHERE d.numero LIKE 'DEC-' || v_ano || '-%';
  RETURN 'DEC-' || v_ano || '-' || lpad((v_ultimo + 1)::text, 4, '0');
END $$;

-- 2) Cabeçalho e itens. Todos os endereços são snapshots editáveis: o
-- contrato ainda não possui esses dados no schema atual.
CREATE TABLE IF NOT EXISTS public.sup_correio_declaracao (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES public.empresas(id),
  numero             text NOT NULL UNIQUE DEFAULT public.sup_gerar_declaracao_numero(),
  pedido_id          uuid REFERENCES public.sup_pedido(id) ON DELETE SET NULL,
  pedido_protocolo   text,
  rem_nome           text,
  rem_cnpj           text,
  rem_endereco       text,
  rem_complemento    text,
  rem_bairro         text,
  rem_cidade         text,
  rem_uf             text,
  rem_cep            text,
  rem_caixa_postal   text,
  dest_nome          text,
  dest_cnpj          text,
  dest_endereco      text,
  dest_complemento   text,
  dest_bairro        text,
  dest_cidade        text,
  dest_uf            text,
  dest_cep           text,
  peso_total_kg      numeric,
  assinatura_cidade  text,
  assinatura_data    date,
  criado_por         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_por_nome    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sup_correio_declaracao_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaracao_id  uuid NOT NULL REFERENCES public.sup_correio_declaracao(id) ON DELETE CASCADE,
  ordem          integer NOT NULL DEFAULT 0,
  conteudo       text NOT NULL,
  quantidade     integer NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  valor          numeric
);

CREATE INDEX IF NOT EXISTS idx_sup_correio_declaracao_empresa
  ON public.sup_correio_declaracao(empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sup_correio_declaracao_pedido
  ON public.sup_correio_declaracao(pedido_id);
CREATE INDEX IF NOT EXISTS idx_sup_correio_declaracao_item_declaracao
  ON public.sup_correio_declaracao_item(declaracao_id, ordem);

REVOKE ALL ON FUNCTION public.sup_gerar_declaracao_numero() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_gerar_declaracao_numero() TO authenticated;

DROP TRIGGER IF EXISTS trg_sup_correio_declaracao_updated ON public.sup_correio_declaracao;
CREATE TRIGGER trg_sup_correio_declaracao_updated
  BEFORE UPDATE ON public.sup_correio_declaracao
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) RLS: a permissão de tela e a empresa do usuário são condições
-- independentes. can_access sozinho nunca deve abrir linhas de outra empresa.
ALTER TABLE public.sup_correio_declaracao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_correio_declaracao_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_correio_declaracao_select ON public.sup_correio_declaracao;
CREATE POLICY sup_correio_declaracao_select ON public.sup_correio_declaracao
  FOR SELECT TO authenticated USING (
    public.can_access(auth.uid(), 'sup_correio_declaracao', 'visualizar')
    AND sup_correio_declaracao.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
    AND (
      sup_correio_declaracao.pedido_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.sup_pedido p
         WHERE p.id = sup_correio_declaracao.pedido_id
           AND p.empresa_id = sup_correio_declaracao.empresa_id
      )
    )
  );

DROP POLICY IF EXISTS sup_correio_declaracao_insert ON public.sup_correio_declaracao;
CREATE POLICY sup_correio_declaracao_insert ON public.sup_correio_declaracao
  FOR INSERT TO authenticated WITH CHECK (
    public.can_access(auth.uid(), 'sup_correio_declaracao', 'incluir')
    AND sup_correio_declaracao.criado_por = auth.uid()
    AND sup_correio_declaracao.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
    AND (
      sup_correio_declaracao.pedido_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.sup_pedido p
         WHERE p.id = sup_correio_declaracao.pedido_id
           AND p.empresa_id = sup_correio_declaracao.empresa_id
      )
    )
  );

DROP POLICY IF EXISTS sup_correio_declaracao_update ON public.sup_correio_declaracao;
CREATE POLICY sup_correio_declaracao_update ON public.sup_correio_declaracao
  FOR UPDATE TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_correio_declaracao', 'alterar')
    AND sup_correio_declaracao.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'sup_correio_declaracao', 'alterar')
    AND sup_correio_declaracao.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
    AND (
      sup_correio_declaracao.pedido_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.sup_pedido p
         WHERE p.id = sup_correio_declaracao.pedido_id
           AND p.empresa_id = sup_correio_declaracao.empresa_id
      )
    )
  );

DROP POLICY IF EXISTS sup_correio_declaracao_item_select ON public.sup_correio_declaracao_item;
CREATE POLICY sup_correio_declaracao_item_select ON public.sup_correio_declaracao_item
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1
      FROM public.sup_correio_declaracao d
     WHERE d.id = sup_correio_declaracao_item.declaracao_id
       AND public.can_access(auth.uid(), 'sup_correio_declaracao', 'visualizar')
       AND d.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ));

DROP POLICY IF EXISTS sup_correio_declaracao_item_insert ON public.sup_correio_declaracao_item;
CREATE POLICY sup_correio_declaracao_item_insert ON public.sup_correio_declaracao_item
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1
      FROM public.sup_correio_declaracao d
     WHERE d.id = sup_correio_declaracao_item.declaracao_id
       AND (
         public.can_access(auth.uid(), 'sup_correio_declaracao', 'incluir')
         OR public.can_access(auth.uid(), 'sup_correio_declaracao', 'alterar')
       )
       AND d.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ));

DROP POLICY IF EXISTS sup_correio_declaracao_item_update ON public.sup_correio_declaracao_item;
CREATE POLICY sup_correio_declaracao_item_update ON public.sup_correio_declaracao_item
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_correio_declaracao d
     WHERE d.id = sup_correio_declaracao_item.declaracao_id
       AND public.can_access(auth.uid(), 'sup_correio_declaracao', 'alterar')
       AND d.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sup_correio_declaracao d
     WHERE d.id = sup_correio_declaracao_item.declaracao_id
       AND public.can_access(auth.uid(), 'sup_correio_declaracao', 'alterar')
       AND d.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ));

DROP POLICY IF EXISTS sup_correio_declaracao_item_delete ON public.sup_correio_declaracao_item;
CREATE POLICY sup_correio_declaracao_item_delete ON public.sup_correio_declaracao_item
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.sup_correio_declaracao d
     WHERE d.id = sup_correio_declaracao_item.declaracao_id
       AND public.can_access(auth.uid(), 'sup_correio_declaracao', 'alterar')
       AND d.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ));

-- 4) A linha do tempo passa a reconhecer os dois fatos novos.
ALTER TABLE public.sup_pedido_historico
  DROP CONSTRAINT IF EXISTS sup_pedido_historico_acao_check;
ALTER TABLE public.sup_pedido_historico
  ADD CONSTRAINT sup_pedido_historico_acao_check
  CHECK (acao IN ('CRIADO', 'STATUS', 'EDITADO', 'CANCELADO', 'DECLARACAO', 'COMPROVACAO'));

CREATE OR REPLACE FUNCTION public.sup_correio_declaracao_historico()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Regravar a mesma declaração não é um novo fato na linha do tempo. Um
  -- UPDATE só gera evento quando a declaração passa a apontar para outro
  -- pedido.
  IF NEW.pedido_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.pedido_id IS DISTINCT FROM OLD.pedido_id) THEN
    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_novo, observacao, alterado_por, alterado_por_nome)
    SELECT NEW.pedido_id, 'DECLARACAO', p.status, NEW.numero,
           auth.uid(), COALESCE(public.sup_est_nome_usuario(), NEW.criado_por_nome)
      FROM public.sup_pedido p
     WHERE p.id = NEW.pedido_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sup_correio_declaracao_historico ON public.sup_correio_declaracao;
CREATE TRIGGER trg_sup_correio_declaracao_historico
  AFTER INSERT OR UPDATE ON public.sup_correio_declaracao
  FOR EACH ROW EXECUTE FUNCTION public.sup_correio_declaracao_historico();

-- Salvar cabeçalho, itens e evento precisa ser uma transação só. Fazer três
-- requests pelo frontend deixaria uma declaração sem itens se a rede caísse
-- entre elas, justamente no momento de impressão.
CREATE OR REPLACE FUNCTION public.sup_correio_declaracao_salvar(p_payload jsonb)
RETURNS public.sup_correio_declaracao
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_empresa_id uuid := nullif(p_payload->>'empresa_id', '')::uuid;
  v_pedido_id uuid := nullif(p_payload->>'pedido_id', '')::uuid;
  v_pedido_protocolo text := nullif(p_payload->>'pedido_protocolo', '');
  v_declaracao public.sup_correio_declaracao;
  v_item jsonb;
  v_ordem integer := 0;
  v_nome text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF v_empresa_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_empresa ue
     WHERE ue.user_id = v_uid AND ue.empresa_id = v_empresa_id
  ) THEN
    RAISE EXCEPTION 'Empresa inválida ou sem acesso';
  END IF;
  IF NOT public.can_access(
    v_uid,
    'sup_correio_declaracao',
    CASE WHEN v_id IS NULL
      THEN 'incluir'::public.app_acao
      ELSE 'alterar'::public.app_acao
    END
  ) THEN
    RAISE EXCEPTION 'Sem permissão para salvar a declaração';
  END IF;
  IF v_pedido_id IS NOT NULL THEN
    SELECT p.pedido_id INTO v_pedido_protocolo
      FROM public.sup_pedido p
     WHERE p.id = v_pedido_id AND p.empresa_id = v_empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pedido não pertence à empresa da declaração';
    END IF;
  END IF;

  SELECT COALESCE(p.display_name, auth.jwt()->>'email', 'Usuário')
    INTO v_nome FROM public.profiles p WHERE p.id = v_uid;
  v_nome := COALESCE(v_nome, auth.jwt()->>'email', 'Usuário');

  IF v_id IS NULL THEN
    INSERT INTO public.sup_correio_declaracao (
      empresa_id, pedido_id, pedido_protocolo,
      rem_nome, rem_cnpj, rem_endereco, rem_complemento, rem_bairro,
      rem_cidade, rem_uf, rem_cep, rem_caixa_postal,
      dest_nome, dest_cnpj, dest_endereco, dest_complemento, dest_bairro,
      dest_cidade, dest_uf, dest_cep, peso_total_kg,
      assinatura_cidade, assinatura_data, criado_por, criado_por_nome
    ) VALUES (
      v_empresa_id, v_pedido_id, v_pedido_protocolo,
      nullif(p_payload->>'rem_nome', ''), nullif(p_payload->>'rem_cnpj', ''), nullif(p_payload->>'rem_endereco', ''), nullif(p_payload->>'rem_complemento', ''), nullif(p_payload->>'rem_bairro', ''),
      nullif(p_payload->>'rem_cidade', ''), nullif(p_payload->>'rem_uf', ''), nullif(p_payload->>'rem_cep', ''), nullif(p_payload->>'rem_caixa_postal', ''),
      nullif(p_payload->>'dest_nome', ''), nullif(p_payload->>'dest_cnpj', ''), nullif(p_payload->>'dest_endereco', ''), nullif(p_payload->>'dest_complemento', ''), nullif(p_payload->>'dest_bairro', ''),
      nullif(p_payload->>'dest_cidade', ''), nullif(p_payload->>'dest_uf', ''), nullif(p_payload->>'dest_cep', ''), nullif(p_payload->>'peso_total_kg', '')::numeric,
      nullif(p_payload->>'assinatura_cidade', ''), nullif(p_payload->>'assinatura_data', '')::date, v_uid, v_nome
    ) RETURNING * INTO v_declaracao;
  ELSE
    UPDATE public.sup_correio_declaracao d SET
      pedido_id = v_pedido_id,
      pedido_protocolo = v_pedido_protocolo,
      rem_nome = nullif(p_payload->>'rem_nome', ''), rem_cnpj = nullif(p_payload->>'rem_cnpj', ''),
      rem_endereco = nullif(p_payload->>'rem_endereco', ''), rem_complemento = nullif(p_payload->>'rem_complemento', ''),
      rem_bairro = nullif(p_payload->>'rem_bairro', ''), rem_cidade = nullif(p_payload->>'rem_cidade', ''),
      rem_uf = nullif(p_payload->>'rem_uf', ''), rem_cep = nullif(p_payload->>'rem_cep', ''),
      rem_caixa_postal = nullif(p_payload->>'rem_caixa_postal', ''),
      dest_nome = nullif(p_payload->>'dest_nome', ''), dest_cnpj = nullif(p_payload->>'dest_cnpj', ''),
      dest_endereco = nullif(p_payload->>'dest_endereco', ''), dest_complemento = nullif(p_payload->>'dest_complemento', ''),
      dest_bairro = nullif(p_payload->>'dest_bairro', ''), dest_cidade = nullif(p_payload->>'dest_cidade', ''),
      dest_uf = nullif(p_payload->>'dest_uf', ''), dest_cep = nullif(p_payload->>'dest_cep', ''),
      peso_total_kg = nullif(p_payload->>'peso_total_kg', '')::numeric,
      assinatura_cidade = nullif(p_payload->>'assinatura_cidade', ''),
      assinatura_data = nullif(p_payload->>'assinatura_data', '')::date
    WHERE d.id = v_id AND d.empresa_id = v_empresa_id
    RETURNING d.* INTO v_declaracao;
    IF NOT FOUND THEN RAISE EXCEPTION 'Declaração não encontrada ou sem acesso'; END IF;
  END IF;

  DELETE FROM public.sup_correio_declaracao_item i
   WHERE i.declaracao_id = v_declaracao.id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itens', '[]'::jsonb)) LOOP
    IF nullif(btrim(v_item->>'conteudo'), '') IS NOT NULL THEN
      INSERT INTO public.sup_correio_declaracao_item
        (declaracao_id, ordem, conteudo, quantidade, valor)
      VALUES (
        v_declaracao.id, v_ordem, btrim(v_item->>'conteudo'),
        GREATEST(COALESCE((v_item->>'quantidade')::integer, 1), 1),
        nullif(v_item->>'valor', '')::numeric
      );
      v_ordem := v_ordem + 1;
    END IF;
  END LOOP;
  IF v_ordem = 0 THEN RAISE EXCEPTION 'Informe pelo menos um item na declaração'; END IF;

  RETURN v_declaracao;
END $$;

REVOKE ALL ON FUNCTION public.sup_correio_declaracao_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_correio_declaracao_salvar(jsonb) TO authenticated;

-- 5) Menu e permissões. Sem estas linhas o menu novo nasceria fora do
-- enforcement e apareceria para qualquer usuário autenticado.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_correio_declaracao', 'Declaração de Conteúdo',
       '/app/suprimentos/correio-declaracao', 66, true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE
  SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sup_correio_declaracao', a, true
  FROM public.perfil_acesso pa,
       unnest(ARRAY['visualizar','incluir','alterar']::public.app_acao[]) a
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ROLLBACK
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sup_correio_declaracao';
-- DELETE FROM public.app_menu WHERE codigo = 'sup_correio_declaracao';
-- ALTER TABLE public.sup_pedido_historico DROP CONSTRAINT IF EXISTS sup_pedido_historico_acao_check;
-- ALTER TABLE public.sup_pedido_historico ADD CONSTRAINT sup_pedido_historico_acao_check
--   CHECK (acao IN ('CRIADO', 'STATUS', 'EDITADO', 'CANCELADO'));
-- DROP TRIGGER IF EXISTS trg_sup_correio_declaracao_historico ON public.sup_correio_declaracao;
-- DROP FUNCTION IF EXISTS public.sup_correio_declaracao_historico();
-- DROP FUNCTION IF EXISTS public.sup_correio_declaracao_salvar(jsonb);
-- DROP TABLE IF EXISTS public.sup_correio_declaracao_item;
-- DROP TABLE IF EXISTS public.sup_correio_declaracao;
-- DROP FUNCTION IF EXISTS public.sup_gerar_declaracao_numero();

NOTIFY pgrst, 'reload schema';
