-- =====================================================================
-- SUPPLY / COMPRAS — Fase 1, parte 2 de 3: PEDIDOS DE MATERIAIS
--
-- Substitui a tabela `pedidos` do legado (REPLICAR-MODULO-COMPRAS.md §5,
-- ARQUITETURA-COMPLETA.md §8) e corrige as duas dívidas estruturais que o
-- próprio documento aponta como as mais graves:
--
--   §12.7 — ITENS EM TABELA FILHA, NÃO EM ARRAY JSONB.
--     No legado os equipamentos viviam num array JSONB e a POSIÇÃO no
--     array (equipamento_index) era a chave que amarrava as etiquetas de
--     estoque ao item. Editar o pedido reordenava o array e quebrava todas
--     as associações de TAG em silêncio. Aqui cada item tem id próprio, e
--     a Fase 2 (Controle de Estoque/TAGs) pluga direto em sup_pedido_item.id.
--
--   §12.3 — HISTÓRICO REAL.
--     No legado não existia tabela de histórico: o servidor FABRICAVA dois
--     eventos a partir do estado atual, com autor fixo "Admin ERP", e toda a
--     trilha intermediária se perdia. Aqui cada mudança grava uma linha, na
--     mesma transação da mudança.
--
-- DATAS: data_solicitacao usa o fuso de São Paulo explicitamente. Os dois
-- documentos descrevem o mesmo bug de fuso em três lugares diferentes
-- (a data "andava um dia para trás"); aqui a estratégia é uma só, no banco
-- e no front: nunca derivar dia a partir de UTC.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.sup_pedido_historico, public.sup_pedido_item,
--     public.sup_pedido, public.sup_ext_sessao CASCADE;
--   DROP FUNCTION IF EXISTS public.sup_gerar_pedido_id();
--   DROP SEQUENCE IF EXISTS public.sup_pedido_seq;
-- =====================================================================

-- ── 1. Sessão do usuário externo ─────────────────────────────────────
--
-- O login "Externo" aceita qualquer senha: quem autentica é o Supabase via
-- signInAnonymously(), e a IDENTIDADE do encarregado passa a ser o par
-- (login digitado, contrato escolhido). Esta tabela é o que amarra a sessão
-- anônima a esse par — e é o que permite ele voltar depois, de outro
-- aparelho, digitar a mesma identificação e reencontrar seus pedidos.
--
-- Consequência assumida: quem souber a identificação de outro encarregado
-- DO MESMO CONTRATO vê os pedidos daquela pessoa. É inerente a "qualquer
-- senha" — não há segredo a verificar. Nada além disso fica exposto: o
-- usuário anônimo não tem linha em user_empresa nem perfil de acesso, então
-- toda a RLS do resto do ERP já o nega por padrão.
CREATE TABLE IF NOT EXISTS public.sup_ext_sessao (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  login_informado text NOT NULL,
  contrato_id    uuid NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_ext_sessao_login
  ON public.sup_ext_sessao(contrato_id, login_informado);

-- ── 2. Pedido ────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.sup_pedido_seq START 1;

CREATE OR REPLACE FUNCTION public.sup_gerar_pedido_id()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'PED-'
      || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD')
      || '-'
      || lpad(nextval('public.sup_pedido_seq')::text, 4, '0');
$$;

CREATE TABLE IF NOT EXISTS public.sup_pedido (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  -- Protocolo visível ao usuário. UNIQUE protege contra duplo clique/reenvio.
  pedido_id              text NOT NULL UNIQUE DEFAULT public.sup_gerar_pedido_id(),

  -- Cascata: FK para navegar + snapshot textual para o pedido continuar
  -- legível se o catálogo mudar depois (o legado só tinha o texto).
  contrato_id            uuid REFERENCES public.contratos(id)  ON DELETE SET NULL,
  posto_id               uuid REFERENCES public.sup_posto(id)  ON DELETE SET NULL,
  funcao_id              uuid REFERENCES public.sup_funcao(id) ON DELETE SET NULL,
  contrato_nome          text NOT NULL,
  posto_nome             text NOT NULL,
  funcao_nome            text NOT NULL,

  -- Quem pediu. `criado_por` é o auth.uid() (anônimo ou interno);
  -- `solicitante_login` é o texto digitado no login Externo e é a chave
  -- de reencontro do histórico dele.
  criado_por             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  solicitante_login      text NOT NULL,
  solicitante_nome       text,
  origem                 text NOT NULL DEFAULT 'externo'
                           CHECK (origem IN ('externo', 'interno')),

  -- Colaborador atendido (vazio em pedido só de insumos)
  nome_colaborador       text NOT NULL DEFAULT '',
  matricula_colaborador  text NOT NULL DEFAULT '',
  admissao               boolean NOT NULL DEFAULT false,
  tipo_admissao          text CHECK (tipo_admissao IN ('substituicao','aditivo')),
  data_admissao          date,
  imagem_cracha_path     text,

  data_solicitacao       date NOT NULL
                           DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  tipo_pedido            text NOT NULL DEFAULT 'uniforme'
                           CHECK (tipo_pedido IN ('uniforme','insumos','ambos')),

  -- Dois campos de observação distintos e facilmente confundidos (§5.2):
  observacoes_solicitante text,  -- escrito por quem pediu
  observacao              text,  -- comentário do operador de Compras

  status                 text NOT NULL DEFAULT 'EM PREPARACAO'
                           CHECK (status IN ('EM PREPARACAO','AGUARDANDO ENVIO',
                                             'AGUARDANDO COMPRA','DESPACHADO','CANCELADO')),
  data_despachado        timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_pedido_status    ON public.sup_pedido(status);
CREATE INDEX IF NOT EXISTS idx_sup_pedido_contrato  ON public.sup_pedido(contrato_id);
CREATE INDEX IF NOT EXISTS idx_sup_pedido_criado    ON public.sup_pedido(criado_por);
CREATE INDEX IF NOT EXISTS idx_sup_pedido_data      ON public.sup_pedido(data_solicitacao DESC);
CREATE INDEX IF NOT EXISTS idx_sup_pedido_solic     ON public.sup_pedido(contrato_id, solicitante_login);

CREATE TABLE IF NOT EXISTS public.sup_pedido_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id      uuid NOT NULL REFERENCES public.sup_pedido(id) ON DELETE CASCADE,
  item_id        uuid REFERENCES public.sup_item(id) ON DELETE SET NULL,
  nome_item      text NOT NULL,          -- snapshot
  tipo_item      text NOT NULL DEFAULT 'uniforme',
  tamanho        text,
  quantidade     integer NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  litros         text,
  ordem          integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_pedido_item_pedido ON public.sup_pedido_item(pedido_id);

CREATE TABLE IF NOT EXISTS public.sup_pedido_historico (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id        uuid NOT NULL REFERENCES public.sup_pedido(id) ON DELETE CASCADE,
  acao             text NOT NULL CHECK (acao IN ('CRIADO','STATUS','EDITADO','CANCELADO')),
  status_anterior  text,
  status_novo      text,
  observacao       text,
  alterado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  alterado_por_nome text,
  data_alteracao   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_pedido_hist
  ON public.sup_pedido_historico(pedido_id, data_alteracao DESC);

DROP TRIGGER IF EXISTS trg_sup_pedido_updated ON public.sup_pedido;
CREATE TRIGGER trg_sup_pedido_updated BEFORE UPDATE ON public.sup_pedido
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- DESPACHADO carimba a data automaticamente — no legado esse era o único
-- efeito colateral de uma mudança de status, e ficava solto no controller.
CREATE OR REPLACE FUNCTION public.sup_pedido_carimbar_despacho()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'DESPACHADO' AND COALESCE(OLD.status, '') <> 'DESPACHADO' THEN
    NEW.data_despachado := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sup_pedido_despacho ON public.sup_pedido;
CREATE TRIGGER trg_sup_pedido_despacho BEFORE UPDATE ON public.sup_pedido
  FOR EACH ROW EXECUTE FUNCTION public.sup_pedido_carimbar_despacho();

-- ── 3. RLS ───────────────────────────────────────────────────────────
--
-- ATENÇÃO: usuários anônimos do Supabase recebem o papel `authenticated`
-- (com a claim is_anonymous=true), então TODAS as policies abaixo valem
-- para eles também. O que os separa é que um anônimo não tem linha em
-- user_empresa nem perfil de acesso — can_access() e o filtro de empresa
-- retornam falso para ele em tudo. O único caminho que ele tem é o ramo
-- explícito de sup_ext_sessao.
--
-- can_access() responde "pode abrir a tela", NUNCA "pode ver esta linha":
-- por isso o SELECT de sup_pedido sempre combina o gate de menu com uma
-- checagem de dono/contrato.

ALTER TABLE public.sup_ext_sessao       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_pedido           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_pedido_item      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_pedido_historico ENABLE ROW LEVEL SECURITY;

-- Sessão externa: cada um só enxerga a própria linha. Escrita só via RPC.
DROP POLICY IF EXISTS sup_ext_sessao_self ON public.sup_ext_sessao;
CREATE POLICY sup_ext_sessao_self ON public.sup_ext_sessao FOR SELECT TO authenticated
  USING (sup_ext_sessao.user_id = auth.uid());

-- Pedido — SELECT
DROP POLICY IF EXISTS sup_pedido_select ON public.sup_pedido;
CREATE POLICY sup_pedido_select ON public.sup_pedido FOR SELECT TO authenticated
  USING (
    -- (a) Supply / Compras: vê tudo da empresa dele
    (
      public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar')
      AND sup_pedido.empresa_id IN (
        SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
      )
    )
    -- (b) quem criou, seja interno ou anônimo, na mesma sessão
    OR sup_pedido.criado_por = auth.uid()
    -- (c) externo voltando: mesma identificação + mesmo contrato da sessão
    OR EXISTS (
      SELECT 1 FROM public.sup_ext_sessao s
       WHERE s.user_id          = auth.uid()
         AND s.contrato_id      = sup_pedido.contrato_id
         AND s.login_informado  = sup_pedido.solicitante_login
    )
  );

-- Pedido — INSERT direto só para usuário INTERNO com a tela de solicitação.
-- O externo entra exclusivamente pela RPC sup_ext_criar_pedido (parte 3),
-- que é SECURITY DEFINER e valida a cascata contra a sessão dele.
DROP POLICY IF EXISTS sup_pedido_insert ON public.sup_pedido;
CREATE POLICY sup_pedido_insert ON public.sup_pedido FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.can_access(auth.uid(), 'encarregados_solicitar_materiais', 'incluir')
      OR public.can_access(auth.uid(), 'sup_pedidos_materiais', 'alterar')
    )
    AND sup_pedido.criado_por = auth.uid()
    AND sup_pedido.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

-- Editar / cancelar / excluir é do Supply. O externo NÃO tem UPDATE nem
-- DELETE em nenhuma hipótese — decisão de produto, não só de UI.
DROP POLICY IF EXISTS sup_pedido_update ON public.sup_pedido;
CREATE POLICY sup_pedido_update ON public.sup_pedido FOR UPDATE TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_pedidos_materiais', 'alterar')
    AND sup_pedido.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'sup_pedidos_materiais', 'alterar')
    AND sup_pedido.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS sup_pedido_delete ON public.sup_pedido;
CREATE POLICY sup_pedido_delete ON public.sup_pedido FOR DELETE TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_pedidos_materiais', 'excluir')
    AND sup_pedido.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

-- Itens e histórico herdam a visibilidade do pedido pai (um EXISTS sobre
-- sup_pedido reaproveita as policies acima, sem duplicar a regra).
DROP POLICY IF EXISTS sup_pedido_item_select ON public.sup_pedido_item;
CREATE POLICY sup_pedido_item_select ON public.sup_pedido_item FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_pedido p WHERE p.id = sup_pedido_item.pedido_id
  ));

DROP POLICY IF EXISTS sup_pedido_item_write ON public.sup_pedido_item;
CREATE POLICY sup_pedido_item_write ON public.sup_pedido_item FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_pedido p
     WHERE p.id = sup_pedido_item.pedido_id
       AND (public.can_access(auth.uid(), 'sup_pedidos_materiais', 'alterar')
            OR p.criado_por = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sup_pedido p
     WHERE p.id = sup_pedido_item.pedido_id
       AND (public.can_access(auth.uid(), 'sup_pedidos_materiais', 'alterar')
            OR p.criado_por = auth.uid())
  ));

DROP POLICY IF EXISTS sup_pedido_hist_select ON public.sup_pedido_historico;
CREATE POLICY sup_pedido_hist_select ON public.sup_pedido_historico FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_pedido p WHERE p.id = sup_pedido_historico.pedido_id
  ));

DROP POLICY IF EXISTS sup_pedido_hist_insert ON public.sup_pedido_historico;
CREATE POLICY sup_pedido_hist_insert ON public.sup_pedido_historico FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sup_pedido p
     WHERE p.id = sup_pedido_historico.pedido_id
       AND (public.can_access(auth.uid(), 'sup_pedidos_materiais', 'alterar')
            OR p.criado_por = auth.uid())
  ));

-- ── 4. Storage: fotos de crachá ──────────────────────────────────────
--
-- Bucket PRIVADO (o legado servia as fotos publicamente em /uploads).
-- Foto de crachá é dado pessoal: leitura só para o Supply ou para quem
-- enviou, via signed URL.
INSERT INTO storage.buckets (id, name, public)
VALUES ('sup-crachas', 'sup-crachas', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS sup_crachas_insert ON storage.objects;
CREATE POLICY sup_crachas_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sup-crachas');

DROP POLICY IF EXISTS sup_crachas_select ON storage.objects;
CREATE POLICY sup_crachas_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'sup-crachas'
    AND (
      storage.objects.owner = auth.uid()
      OR public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar')
    )
  );

DROP POLICY IF EXISTS sup_crachas_delete ON storage.objects;
CREATE POLICY sup_crachas_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'sup-crachas'
    AND public.can_access(auth.uid(), 'sup_pedidos_materiais', 'alterar')
  );

NOTIFY pgrst, 'reload schema';
