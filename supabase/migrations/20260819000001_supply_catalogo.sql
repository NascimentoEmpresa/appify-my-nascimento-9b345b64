-- =====================================================================
-- SUPPLY / COMPRAS — Fase 1, parte 1 de 3: CATÁLOGO EM CASCATA
--
-- Substitui a hierarquia do sistema legado (site externo:
-- contratos → postos → funcoes → equipamentos + equipamento_opcoes),
-- com duas correções deliberadas em relação a ele:
--
--   1. CONTRATO NÃO É MAIS TABELA PRÓPRIA. A cascata pendura direto em
--      public.contratos, que já é alimentada por Licitações
--      (ContratosERP.tsx). Só existe posto para contrato que existe.
--
--   2. AS OPÇÕES DE UM ITEM PENDURAM NO ITEM, NÃO NO NOME DELE. No legado
--      equipamento_opcoes casava por NOME e era GLOBAL: renomear um item
--      orfãozava suas opções, e dois contratos com item de mesmo nome
--      compartilhavam tamanhos sem querer (ARQUITETURA-COMPLETA.md §14.6).
--      Aqui sup_item é catálogo mestre, sup_item_opcao referencia item_id,
--      e sup_funcao_item é o vínculo N:N ("enxoval da função"). A cascata
--      que o usuário enxerga na tela fica idêntica.
--
-- APROVAÇÃO EM LOTE (Subsistema 6 do legado): toda linha nasce com
-- aprovado = false e é invisível para o encarregado (as RPCs sup_ext_*
-- da parte 3 filtram aprovado = true AND ativo = true).
--
-- Limitação consciente desta fase: ações 'editar' são aplicadas na hora e
-- NÃO são desfeitas por uma reprovação — igual ao legado. 'criar' e
-- 'excluir' são de fato reversíveis (ver sup_cat_decidir_lote).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_cat_decidir_lote(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.sup_cat_enviar_lote(text);
--   DROP TABLE IF EXISTS public.sup_cat_alteracao, public.sup_cat_lote,
--     public.sup_funcao_item, public.sup_item_opcao, public.sup_item,
--     public.sup_funcao, public.sup_posto CASCADE;
--   DELETE FROM public.app_menu WHERE codigo IN
--     ('sup_catalogo','sup_catalogo_aprovacao','sup_pedidos_materiais',
--      'encarregados_solicitar_materiais','encarregados_meus_pedidos');
-- =====================================================================

-- ── 1. Cascata ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sup_posto (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresas(id)  ON DELETE CASCADE,
  contrato_id uuid NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  descricao   text,
  ativo       boolean NOT NULL DEFAULT true,
  aprovado    boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contrato_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_sup_posto_contrato ON public.sup_posto(contrato_id);

CREATE TABLE IF NOT EXISTS public.sup_funcao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  posto_id   uuid NOT NULL REFERENCES public.sup_posto(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  ativo      boolean NOT NULL DEFAULT true,
  aprovado   boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (posto_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_sup_funcao_posto ON public.sup_funcao(posto_id);

-- Catálogo mestre de materiais. 'tipo' é o que separa o passo "Uniformes"
-- do passo "EPIs / Insumos" no wizard — no legado isso era feito por um
-- item-fantasma chamado literalmente "INSUMOS", que precisava ser filtrado
-- da lista (ARQUITETURA-COMPLETA.md §8.1). Aqui não existe.
CREATE TABLE IF NOT EXISTS public.sup_item (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  tipo       text NOT NULL DEFAULT 'uniforme'
               CHECK (tipo IN ('uniforme', 'epi', 'insumo', 'equipamento')),
  ativo      boolean NOT NULL DEFAULT true,
  aprovado   boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nome)
);

CREATE TABLE IF NOT EXISTS public.sup_item_opcao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL REFERENCES public.sup_item(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('tamanho', 'quantidade', 'litros')),
  opcoes     text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, tipo)
);

-- Enxoval: quais itens do catálogo mestre aquela função recebe.
CREATE TABLE IF NOT EXISTS public.sup_funcao_item (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcao_id  uuid NOT NULL REFERENCES public.sup_funcao(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES public.sup_item(id)   ON DELETE CASCADE,
  ordem      int  NOT NULL DEFAULT 0,
  ativo      boolean NOT NULL DEFAULT true,
  aprovado   boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funcao_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_sup_funcao_item_funcao ON public.sup_funcao_item(funcao_id);

-- ── 2. Fila de aprovação do catálogo ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sup_cat_lote (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  codigo           text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'PENDENTE'
                     CHECK (status IN ('PENDENTE', 'APROVADO', 'REPROVADO')),
  total_alteracoes int NOT NULL DEFAULT 0,
  criado_por       uuid REFERENCES auth.users(id),
  criado_por_nome  text,
  decidido_por     uuid REFERENCES auth.users(id),
  decidido_por_nome text,
  comentario       text,
  data_envio       timestamptz NOT NULL DEFAULT now(),
  data_resposta    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sup_cat_alteracao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  -- NULL enquanto RASCUNHO; ganha o lote ao ser enviada para aprovação.
  lote_id         uuid REFERENCES public.sup_cat_lote(id) ON DELETE SET NULL,
  tipo_entidade   text NOT NULL
                    CHECK (tipo_entidade IN ('posto','funcao','item','opcoes','funcao_item')),
  tipo_acao       text NOT NULL CHECK (tipo_acao IN ('criar','editar','excluir')),
  -- Chave de casamento na hora de aplicar/reverter. SEMPRE por id: o legado
  -- casava por nome e só corrigiu depois de um bug real (commit 7e5bfd8);
  -- casar por nome quebra com renomeação e com nomes repetidos entre contratos.
  alvo_id         uuid NOT NULL,
  dados           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Nomes da hierarquia gravados na criação, para a tela de aprovação exibir
  -- "Contrato X · Posto Y · Função Z" sem ter que re-derivar nada em JS
  -- (é a melhor ideia do Subsistema 6 do legado — REPLICAR §8.3).
  contexto        jsonb NOT NULL DEFAULT '{}'::jsonb,
  descricao       text NOT NULL,
  status          text NOT NULL DEFAULT 'RASCUNHO'
                    CHECK (status IN ('RASCUNHO','PENDENTE','APROVADO','REPROVADO')),
  criado_por      uuid REFERENCES auth.users(id),
  criado_por_nome text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_cat_alteracao_lote   ON public.sup_cat_alteracao(lote_id);
CREATE INDEX IF NOT EXISTS idx_sup_cat_alteracao_status ON public.sup_cat_alteracao(status);

-- ── 3. Triggers de updated_at ────────────────────────────────────────

DO $$
DECLARE
  t    text;
  trg  text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sup_posto','sup_funcao','sup_item','sup_item_opcao',
                           'sup_funcao_item','sup_cat_lote']
  LOOP
    -- Nome do trigger montado ANTES do format: 'trg_%I_updated' com %I
    -- geraria trg_"sup_posto"_updated, que não é um identificador válido.
    trg := 'trg_' || t || '_updated';
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trg, t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', trg, t);
  END LOOP;
END $$;

-- sup_posto.empresa_id É DERIVADO do contrato, nunca informado pela tela.
-- Se a tela mandasse uma empresa diferente da do contrato, o posto sumiria
-- da RLS (o filtro de empresa não casaria) e o sintoma seria "cadastrei e
-- não aparece" — caro de diagnosticar. Aqui não tem como divergir.
CREATE OR REPLACE FUNCTION public.sup_posto_herdar_empresa()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT c.empresa_id INTO NEW.empresa_id
    FROM public.contratos c WHERE c.id = NEW.contrato_id;
  IF NEW.empresa_id IS NULL THEN
    RAISE EXCEPTION 'Contrato % não encontrado', NEW.contrato_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sup_posto_empresa ON public.sup_posto;
CREATE TRIGGER trg_sup_posto_empresa BEFORE INSERT OR UPDATE OF contrato_id ON public.sup_posto
  FOR EACH ROW EXECUTE FUNCTION public.sup_posto_herdar_empresa();

-- ── 4. RLS ───────────────────────────────────────────────────────────
--
-- Autoridade: can_access(uid, <menu_codigo>, <acao>) — o mesmo gate que
-- governa o resto do ERP (ver 20260717200003_rewrite_gate_functions_perfil_acesso).
-- Combinado com escopo de empresa via user_empresa, porque can_access
-- sozinho responde "pode abrir a tela", NÃO "pode ver esta linha".
--
-- Nas subqueries EXISTS, toda coluna é qualificada com o nome da tabela
-- externa: coluna solta dentro de um EXISTS já se ligou à PK da tabela
-- interna neste projeto, sem erro de sintaxe e sem aviso.

ALTER TABLE public.sup_posto        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_funcao       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_item         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_item_opcao   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_funcao_item  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_cat_lote     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_cat_alteracao ENABLE ROW LEVEL SECURITY;

-- sup_posto / sup_item — têm empresa_id próprio
DROP POLICY IF EXISTS sup_posto_select ON public.sup_posto;
CREATE POLICY sup_posto_select ON public.sup_posto FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
    AND sup_posto.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS sup_posto_write ON public.sup_posto;
CREATE POLICY sup_posto_write ON public.sup_posto FOR ALL TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_catalogo', 'alterar')
    AND sup_posto.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'sup_catalogo', 'alterar')
    AND sup_posto.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS sup_item_select ON public.sup_item;
CREATE POLICY sup_item_select ON public.sup_item FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
    AND sup_item.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS sup_item_write ON public.sup_item;
CREATE POLICY sup_item_write ON public.sup_item FOR ALL TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_catalogo', 'alterar')
    AND sup_item.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'sup_catalogo', 'alterar')
    AND sup_item.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

-- sup_funcao — escopo herdado do posto
DROP POLICY IF EXISTS sup_funcao_select ON public.sup_funcao;
CREATE POLICY sup_funcao_select ON public.sup_funcao FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_posto p
     WHERE p.id = sup_funcao.posto_id
       AND public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
       AND p.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ));
DROP POLICY IF EXISTS sup_funcao_write ON public.sup_funcao;
CREATE POLICY sup_funcao_write ON public.sup_funcao FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_posto p
     WHERE p.id = sup_funcao.posto_id
       AND public.can_access(auth.uid(), 'sup_catalogo', 'alterar')
       AND p.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sup_posto p
     WHERE p.id = sup_funcao.posto_id
       AND public.can_access(auth.uid(), 'sup_catalogo', 'alterar')
       AND p.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ));

-- sup_item_opcao — escopo herdado do item
DROP POLICY IF EXISTS sup_item_opcao_select ON public.sup_item_opcao;
CREATE POLICY sup_item_opcao_select ON public.sup_item_opcao FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_item i
     WHERE i.id = sup_item_opcao.item_id
       AND public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
       AND i.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ));
DROP POLICY IF EXISTS sup_item_opcao_write ON public.sup_item_opcao;
CREATE POLICY sup_item_opcao_write ON public.sup_item_opcao FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_item i
     WHERE i.id = sup_item_opcao.item_id
       AND public.can_access(auth.uid(), 'sup_catalogo', 'alterar')
       AND i.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sup_item i
     WHERE i.id = sup_item_opcao.item_id
       AND public.can_access(auth.uid(), 'sup_catalogo', 'alterar')
       AND i.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ));

-- sup_funcao_item — escopo herdado da função (→ posto)
DROP POLICY IF EXISTS sup_funcao_item_select ON public.sup_funcao_item;
CREATE POLICY sup_funcao_item_select ON public.sup_funcao_item FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_funcao f
      JOIN public.sup_posto p ON p.id = f.posto_id
     WHERE f.id = sup_funcao_item.funcao_id
       AND public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
       AND p.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ));
DROP POLICY IF EXISTS sup_funcao_item_write ON public.sup_funcao_item;
CREATE POLICY sup_funcao_item_write ON public.sup_funcao_item FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_funcao f
      JOIN public.sup_posto p ON p.id = f.posto_id
     WHERE f.id = sup_funcao_item.funcao_id
       AND public.can_access(auth.uid(), 'sup_catalogo', 'alterar')
       AND p.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sup_funcao f
      JOIN public.sup_posto p ON p.id = f.posto_id
     WHERE f.id = sup_funcao_item.funcao_id
       AND public.can_access(auth.uid(), 'sup_catalogo', 'alterar')
       AND p.empresa_id IN (
         SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
       )
  ));

-- Lotes: quem mantém o catálogo enxerga (para acompanhar o que enviou) e
-- quem aprova também. A DECISÃO em si só sai pela RPC sup_cat_decidir_lote.
DROP POLICY IF EXISTS sup_cat_lote_select ON public.sup_cat_lote;
CREATE POLICY sup_cat_lote_select ON public.sup_cat_lote FOR SELECT TO authenticated
  USING (
    (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
     OR public.can_access(auth.uid(), 'sup_catalogo_aprovacao', 'visualizar'))
    AND sup_cat_lote.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS sup_cat_alteracao_select ON public.sup_cat_alteracao;
CREATE POLICY sup_cat_alteracao_select ON public.sup_cat_alteracao FOR SELECT TO authenticated
  USING (
    (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
     OR public.can_access(auth.uid(), 'sup_catalogo_aprovacao', 'visualizar'))
    AND sup_cat_alteracao.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS sup_cat_alteracao_write ON public.sup_cat_alteracao;
CREATE POLICY sup_cat_alteracao_write ON public.sup_cat_alteracao FOR ALL TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_catalogo', 'alterar')
    AND sup_cat_alteracao.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'sup_catalogo', 'alterar')
    AND sup_cat_alteracao.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

-- ── 5. RPCs do fluxo de aprovação ────────────────────────────────────

-- Agrupa todos os RASCUNHOs do usuário/empresa num lote e manda para decisão.
CREATE OR REPLACE FUNCTION public.sup_cat_enviar_lote(p_empresa_id uuid)
RETURNS public.sup_cat_lote
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_total int;
  v_lote  public.sup_cat_lote;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_catalogo', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para enviar alterações de catálogo';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.sup_cat_alteracao a
   WHERE a.status = 'RASCUNHO' AND a.empresa_id = p_empresa_id;
  IF v_total = 0 THEN RAISE EXCEPTION 'Nenhuma alteração em rascunho para enviar'; END IF;

  SELECT p.display_name INTO v_nome FROM public.profiles p WHERE p.id = v_uid;

  INSERT INTO public.sup_cat_lote (empresa_id, codigo, total_alteracoes, criado_por, criado_por_nome)
  VALUES (p_empresa_id,
          'LOTE-' || to_char(now(), 'YYYYMMDDHH24MISS'),
          v_total, v_uid, v_nome)
  RETURNING * INTO v_lote;

  UPDATE public.sup_cat_alteracao a
     SET lote_id = v_lote.id, status = 'PENDENTE'
   WHERE a.status = 'RASCUNHO' AND a.empresa_id = p_empresa_id;

  RETURN v_lote;
END $$;

-- Aplica (APROVADO) ou reverte (REPROVADO) um lote inteiro, em transação.
--
--   criar   → aprovado=true          | reprovado: DELETE da linha ainda não aprovada
--   excluir → aprovado: DELETE real  | reprovado: volta ativo=true (soft-delete desfeito)
--   editar  → já aplicado na hora, NÃO é revertido (mesma decisão do legado)
CREATE OR REPLACE FUNCTION public.sup_cat_decidir_lote(
  p_lote_id uuid, p_status text, p_comentario text DEFAULT NULL
) RETURNS public.sup_cat_lote
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_lote public.sup_cat_lote;
  r      record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_catalogo_aprovacao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar catálogo';
  END IF;
  IF p_status NOT IN ('APROVADO','REPROVADO') THEN
    RAISE EXCEPTION 'Status inválido: %', p_status;
  END IF;

  SELECT * INTO v_lote FROM public.sup_cat_lote l WHERE l.id = p_lote_id FOR UPDATE;
  IF v_lote.id IS NULL THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;
  -- Idempotência: decidir duas vezes é erro, não silêncio (legado §11.3).
  IF v_lote.status <> 'PENDENTE' THEN
    RAISE EXCEPTION 'Lote já foi decidido (status atual: %)', v_lote.status;
  END IF;

  FOR r IN
    SELECT a.tipo_entidade, a.tipo_acao, a.alvo_id
      FROM public.sup_cat_alteracao a
     WHERE a.lote_id = p_lote_id AND a.status = 'PENDENTE'
  LOOP
    IF p_status = 'APROVADO' THEN
      IF r.tipo_acao = 'criar' THEN
        CASE r.tipo_entidade
          WHEN 'posto'       THEN UPDATE public.sup_posto       SET aprovado = true WHERE id = r.alvo_id;
          WHEN 'funcao'      THEN UPDATE public.sup_funcao      SET aprovado = true WHERE id = r.alvo_id;
          WHEN 'item'        THEN UPDATE public.sup_item        SET aprovado = true WHERE id = r.alvo_id;
          WHEN 'funcao_item' THEN UPDATE public.sup_funcao_item SET aprovado = true WHERE id = r.alvo_id;
          ELSE NULL; -- 'opcoes' acompanha o item, não tem flag própria
        END CASE;
      ELSIF r.tipo_acao = 'excluir' THEN
        CASE r.tipo_entidade
          WHEN 'posto'       THEN DELETE FROM public.sup_posto       WHERE id = r.alvo_id;
          WHEN 'funcao'      THEN DELETE FROM public.sup_funcao      WHERE id = r.alvo_id;
          WHEN 'item'        THEN DELETE FROM public.sup_item        WHERE id = r.alvo_id;
          WHEN 'funcao_item' THEN DELETE FROM public.sup_funcao_item WHERE id = r.alvo_id;
          ELSE NULL;
        END CASE;
      END IF;
    ELSE -- REPROVADO
      IF r.tipo_acao = 'criar' THEN
        CASE r.tipo_entidade
          WHEN 'posto'       THEN DELETE FROM public.sup_posto       WHERE id = r.alvo_id AND aprovado = false;
          WHEN 'funcao'      THEN DELETE FROM public.sup_funcao      WHERE id = r.alvo_id AND aprovado = false;
          WHEN 'item'        THEN DELETE FROM public.sup_item        WHERE id = r.alvo_id AND aprovado = false;
          WHEN 'funcao_item' THEN DELETE FROM public.sup_funcao_item WHERE id = r.alvo_id AND aprovado = false;
          ELSE NULL;
        END CASE;
      ELSIF r.tipo_acao = 'excluir' THEN
        CASE r.tipo_entidade
          WHEN 'posto'       THEN UPDATE public.sup_posto       SET ativo = true WHERE id = r.alvo_id;
          WHEN 'funcao'      THEN UPDATE public.sup_funcao      SET ativo = true WHERE id = r.alvo_id;
          WHEN 'item'        THEN UPDATE public.sup_item        SET ativo = true WHERE id = r.alvo_id;
          WHEN 'funcao_item' THEN UPDATE public.sup_funcao_item SET ativo = true WHERE id = r.alvo_id;
          ELSE NULL;
        END CASE;
      END IF;
    END IF;
  END LOOP;

  SELECT p.display_name INTO v_nome FROM public.profiles p WHERE p.id = v_uid;

  UPDATE public.sup_cat_alteracao a SET status = p_status WHERE a.lote_id = p_lote_id;
  UPDATE public.sup_cat_lote l
     SET status = p_status, comentario = p_comentario, decidido_por = v_uid,
         decidido_por_nome = v_nome, data_resposta = now()
   WHERE l.id = p_lote_id
  RETURNING * INTO v_lote;

  RETURN v_lote;
END $$;

REVOKE EXECUTE ON FUNCTION public.sup_cat_enviar_lote(uuid)               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sup_cat_decidir_lote(uuid, text, text)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sup_cat_enviar_lote(uuid)               TO authenticated;
GRANT  EXECUTE ON FUNCTION public.sup_cat_decidir_lote(uuid, text, text)  TO authenticated;

-- ── 6. Menus (Módulos & Menus / Acesso por Usuário) ──────────────────
--
-- Sem seed de permissão, como todo o resto do ERP: quem acessa cada tela
-- é liberado no painel /app/administracao?tab=modulos. Enquanto ninguém
-- configurar nada, o menu fica aberto (list_configured_menu_codes).
--
-- Códigos prefixados de propósito: app_menu.codigo só é UNIQUE por módulo,
-- e já houve colisão real neste projeto entre módulos diferentes
-- (20260730000001_fix_menu_codigo_colisoes.sql).

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM public.app_modulo m, (VALUES
    ('suprimentos',  'sup_catalogo',            'Catálogo de Materiais',   '/app/suprimentos/catalogo',            60),
    ('suprimentos',  'sup_catalogo_aprovacao',  'Aprovação de Catálogo',   '/app/suprimentos/catalogo/aprovacoes', 61),
    ('suprimentos',  'sup_pedidos_materiais',   'Pedidos de Materiais',    '/app/suprimentos/pedidos-materiais',   62),
    ('encarregados', 'encarregados_solicitar_materiais', 'Solicitar Materiais', '/app/encarregados/solicitar-materiais', 20),
    ('encarregados', 'encarregados_meus_pedidos',        'Meus Pedidos',        '/app/encarregados/meus-pedidos',        30)
  ) AS x(modulo_codigo, codigo, nome, rota, ordem)
 WHERE m.codigo = x.modulo_codigo
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';
