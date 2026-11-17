-- SIS-2026-0888: controle de calçados ortopédicos (SST + Compras).
--
-- O encarregado JÁ pede o calçado em Solicitar Materiais e o Compras já
-- atende em Pedidos de Materiais. Faltava ao SST: o laudo (ia pelo Discord) e
-- um status próprio (ficava numa planilha paralela no S:). Em vez de um
-- segundo formulário, cada item ortopédico pedido vira sozinho uma linha de
-- controle ligada ao sup_pedido_item, e o status do SST anda sozinho quando o
-- Compras mexe no pedido:
--   AGUARDANDO COMPRA                    → em_compra
--   RETIRADO PARA ENTREGA / DESPACHADO   → enviado
--   comprovação de entrega ENVIADA       → entregue
--   CANCELADO                            → cancelado
-- Só para frente, e nunca depois que o SST deu Entregue/Finalizado. "Em
-- análise" e "Finalizado" são do SST; Finalizado exige laudo (decisão do
-- Eduardo em 17/11: laudo opcional no pedido, obrigatório para fechar).
--
-- Em 17/11/2026 havia 5 pedidos com item ortopédico (3 AGUARDANDO ENVIO,
-- 1 AGUARDANDO COMPRA, 1 DESPACHADO) — entram na carga do item 8.
-- A tela nasce PENDENTE (SIS-2026-0931): o seed do item 2 é acesso preparado.

-- ── 1. Marca de item ortopédico ──────────────────────────────────────────
-- Marca explícita no catálogo; o nome só preenche a marca (aqui e no gatilho
-- abaixo), para item novo como "TÊNIS ORTOPÉDICO" entrar sem migration.
ALTER TABLE public.sup_item ADD COLUMN IF NOT EXISTS ortopedico boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.sup_item.ortopedico IS
  'SIS-2026-0888: item que exige laudo e entra no Controle de Calçados Ortopédicos do SST. Preenchido pelo nome (ORTOP); o filho de tamanho herda do pai.';
UPDATE public.sup_item SET ortopedico = true
 WHERE NOT ortopedico AND translate(upper(nome), 'ÉÊ', 'EE') LIKE '%ORTOP%';

CREATE OR REPLACE FUNCTION public.sup_item_marcar_ortopedico()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF translate(upper(coalesce(NEW.nome, '')), 'ÉÊ', 'EE') LIKE '%ORTOP%' THEN NEW.ortopedico := true; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sup_item_marcar_ortopedico ON public.sup_item;
CREATE TRIGGER trg_sup_item_marcar_ortopedico BEFORE INSERT OR UPDATE OF nome ON public.sup_item
FOR EACH ROW EXECUTE FUNCTION public.sup_item_marcar_ortopedico();

CREATE OR REPLACE FUNCTION public.sup_item_eh_ortopedico(p_item_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT i.ortopedico OR coalesce(pai.ortopedico, false)
    FROM public.sup_item i LEFT JOIN public.sup_item pai ON pai.id = i.item_pai_id
   WHERE i.id = p_item_id), false)
$$;
REVOKE ALL ON FUNCTION public.sup_item_eh_ortopedico(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sst_calcados_ortopedicos', 'Calçados Ortopédicos', '/app/sst/calcados-ortopedicos',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
FROM public.app_modulo m WHERE m.codigo = 'sst'
AND NOT EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = 'sst_calcados_ortopedicos');

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES ('sst_calcados_ortopedicos', 'alterar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- Acesso preparado: quem já cuida dos Laudos de EPI no SST.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, 'sst_calcados_ortopedicos', p.acao, true FROM public.perfil_acesso_permissao p
WHERE p.menu_codigo = 'sst_laudo' AND p.acao IN ('visualizar', 'alterar') AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT p.user_id, 'sst_calcados_ortopedicos', p.acao, true, 'SIS-2026-0888: acesso SST aos calçados ortopédicos'
FROM public.screen_permission_user p
WHERE p.menu_codigo = 'sst_laudo' AND p.acao IN ('visualizar', 'alterar') AND p.allow
AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x WHERE x.user_id = p.user_id AND x.menu_codigo = 'sst_calcados_ortopedicos' AND x.acao = p.acao);

-- ── 3. Tabelas ───────────────────────────────────────────────────────────
-- Os campos de pessoa/contrato são cópia do pedido no momento da criação: a
-- lista mostra o valor vivo do pedido e cai na cópia se o pedido for excluído.
CREATE TABLE IF NOT EXISTS public."SST_CALCADO_ORTOPEDICO" (
  id bigserial PRIMARY KEY,
  pedido_item_id uuid UNIQUE REFERENCES public.sup_pedido_item(id) ON DELETE SET NULL,
  pedido_id uuid REFERENCES public.sup_pedido(id) ON DELETE SET NULL,
  pedido_codigo text,
  colaborador_nome text,
  colaborador_empregado_id bigint,
  contrato_nome text,
  encarregado_nome text,
  item_nome text NOT NULL,
  tamanho text,
  quantidade integer,
  data_solicitacao timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'solicitado'
    CHECK (status IN ('solicitado', 'em_analise', 'em_compra', 'enviado', 'entregue', 'finalizado', 'cancelado')),
  observacoes text,
  -- Sem UNIQUE: o laudo enviado pelo encarregado vale para todos os itens
  -- ortopédicos do mesmo pedido (babuche + palmilha, por exemplo).
  laudo_nome text,
  laudo_path text,
  laudo_tamanho bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_calcado_pedido_idx ON public."SST_CALCADO_ORTOPEDICO" (pedido_id);
CREATE INDEX IF NOT EXISTS sst_calcado_laudo_idx ON public."SST_CALCADO_ORTOPEDICO" (laudo_path) WHERE laudo_path IS NOT NULL;
CREATE TABLE IF NOT EXISTS public."SST_CALCADO_ORTOPEDICO_HISTORICO" (
  id bigserial PRIMARY KEY,
  controle_id bigint NOT NULL REFERENCES public."SST_CALCADO_ORTOPEDICO"(id) ON DELETE CASCADE,
  descricao text NOT NULL,
  autor_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_calcado_hist_idx ON public."SST_CALCADO_ORTOPEDICO_HISTORICO" (controle_id);
ALTER TABLE public."SST_CALCADO_ORTOPEDICO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SST_CALCADO_ORTOPEDICO_HISTORICO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SST_CALCADO_ORTOPEDICO", public."SST_CALCADO_ORTOPEDICO_HISTORICO" FROM anon, authenticated;
DROP TRIGGER IF EXISTS trg_sst_calcado_updated_at ON public."SST_CALCADO_ORTOPEDICO";
CREATE TRIGGER trg_sst_calcado_updated_at BEFORE UPDATE ON public."SST_CALCADO_ORTOPEDICO"
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. Regras de status (espelhadas em src/lib/sst/calcadosOrtopedicos.ts) ─
CREATE OR REPLACE FUNCTION public.sst_calcado_ordem(p_status text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_status WHEN 'solicitado' THEN 1 WHEN 'em_analise' THEN 2 WHEN 'em_compra' THEN 3
    WHEN 'enviado' THEN 4 WHEN 'entregue' THEN 5 WHEN 'finalizado' THEN 6 ELSE 0 END
$$;

-- Status que o pedido do Compras sugere; NULL = o pedido não diz nada novo.
CREATE OR REPLACE FUNCTION public.sst_calcado_status_do_pedido(p_status_pedido text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_status_pedido
    WHEN 'AGUARDANDO COMPRA' THEN 'em_compra'
    WHEN 'RETIRADO PARA ENTREGA' THEN 'enviado'
    WHEN 'DESPACHADO' THEN 'enviado'
    WHEN 'CANCELADO' THEN 'cancelado'
    ELSE NULL END
$$;

-- Aplica a sugestão automática só para frente e sem passar por cima do SST.
CREATE OR REPLACE FUNCTION public.sst_calcado_proximo_status(p_atual text, p_sugerido text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_sugerido IS NULL OR p_atual IN ('entregue', 'finalizado', 'cancelado') THEN p_atual
    WHEN p_sugerido = 'cancelado' THEN 'cancelado'
    WHEN public.sst_calcado_ordem(p_sugerido) > public.sst_calcado_ordem(p_atual) THEN p_sugerido
    ELSE p_atual END
$$;

CREATE OR REPLACE FUNCTION public.sst_calcado_exige(p_acao text DEFAULT 'visualizar')
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access(auth.uid(), 'sst_calcados_ortopedicos', p_acao::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao controle de calçados ortopédicos (%)', p_acao USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.sst_calcado_exige(text) FROM PUBLIC, anon, authenticated;

-- Move as linhas de um pedido e registra cada mudança no histórico.
CREATE OR REPLACE FUNCTION public.sst_calcado_sincronizar(p_pedido_id uuid, p_sugerido text, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_novo text;
BEGIN
  FOR r IN SELECT id, status FROM public."SST_CALCADO_ORTOPEDICO" WHERE pedido_id = p_pedido_id FOR UPDATE LOOP
    v_novo := public.sst_calcado_proximo_status(r.status, p_sugerido);
    IF v_novo IS DISTINCT FROM r.status THEN
      UPDATE public."SST_CALCADO_ORTOPEDICO" SET status = v_novo WHERE id = r.id;
      INSERT INTO public."SST_CALCADO_ORTOPEDICO_HISTORICO" (controle_id, descricao, autor_nome)
      VALUES (r.id, 'Status: ' || r.status || ' → ' || v_novo || ' (' || p_motivo || ').', public.sst_afa_nome_usuario());
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.sst_calcado_sincronizar(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ── 5. Gatilhos no pedido ────────────────────────────────────────────────
-- Item ortopédico entrou (pedido novo ou edição do Compras) → linha de controle.
-- Item trocado por um não ortopédico → linha cancelada (o histórico fica).
CREATE OR REPLACE FUNCTION public.sst_calcado_do_pedido_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ped public.sup_pedido; v_id bigint; v_ortopedico boolean := public.sup_item_eh_ortopedico(NEW.item_id);
BEGIN
  -- sup_pedido_editar regrava os itens mesmo sem mudança; isso não é evento.
  IF TG_OP = 'UPDATE' AND NEW.item_id IS NOT DISTINCT FROM OLD.item_id
    AND NEW.tamanho IS NOT DISTINCT FROM OLD.tamanho AND NEW.quantidade IS NOT DISTINCT FROM OLD.quantidade THEN
    RETURN NULL;
  END IF;
  IF v_ortopedico THEN
    SELECT * INTO v_ped FROM public.sup_pedido WHERE id = NEW.pedido_id;
    INSERT INTO public."SST_CALCADO_ORTOPEDICO" (pedido_item_id, pedido_id, pedido_codigo, colaborador_nome,
      colaborador_empregado_id, contrato_nome, encarregado_nome, item_nome, tamanho, quantidade, data_solicitacao, status)
    VALUES (NEW.id, NEW.pedido_id, v_ped.pedido_id, nullif(btrim(v_ped.nome_colaborador), ''),
      v_ped.colaborador_empregado_id, v_ped.contrato_nome, v_ped.solicitante_nome, NEW.nome_item, NEW.tamanho,
      NEW.quantidade, coalesce(v_ped.created_at, now()),
      public.sst_calcado_proximo_status('solicitado', public.sst_calcado_status_do_pedido(v_ped.status)))
    ON CONFLICT (pedido_item_id) DO UPDATE SET item_nome = EXCLUDED.item_nome, tamanho = EXCLUDED.tamanho,
      quantidade = EXCLUDED.quantidade
    RETURNING id INTO v_id;
    INSERT INTO public."SST_CALCADO_ORTOPEDICO_HISTORICO" (controle_id, descricao, autor_nome)
    VALUES (v_id, CASE WHEN TG_OP = 'INSERT'
        THEN 'Pedido ' || coalesce(v_ped.pedido_id, '') || ' criado por ' || coalesce(v_ped.solicitante_nome, 'encarregado') || '.'
        ELSE 'Item alterado no pedido: ' || NEW.nome_item || coalesce(' tam. ' || NEW.tamanho, '') || '.' END,
      coalesce(nullif(public.sst_afa_nome_usuario(), 'Sistema'), v_ped.solicitante_nome, 'Sistema'));
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.sst_calcado_cancelar_item(NEW.id, 'item trocado no pedido por ' || NEW.nome_item);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.sst_calcado_cancelar_item(p_pedido_item_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, status FROM public."SST_CALCADO_ORTOPEDICO" WHERE pedido_item_id = p_pedido_item_id FOR UPDATE LOOP
    IF public.sst_calcado_proximo_status(r.status, 'cancelado') <> r.status THEN
      UPDATE public."SST_CALCADO_ORTOPEDICO" SET status = 'cancelado' WHERE id = r.id;
      INSERT INTO public."SST_CALCADO_ORTOPEDICO_HISTORICO" (controle_id, descricao, autor_nome)
      VALUES (r.id, 'Status: ' || r.status || ' → cancelado (' || p_motivo || ').', public.sst_afa_nome_usuario());
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.sst_calcado_cancelar_item(uuid, text) FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sst_calcado_do_pedido_item ON public.sup_pedido_item;
CREATE TRIGGER trg_sst_calcado_do_pedido_item AFTER INSERT OR UPDATE OF item_id, tamanho, quantidade ON public.sup_pedido_item
FOR EACH ROW EXECUTE FUNCTION public.sst_calcado_do_pedido_item();

-- Item removido do pedido (ou o pedido inteiro excluído): cancela antes de o
-- FK virar NULL, senão a linha perde o vínculo e não dá mais para achá-la.
CREATE OR REPLACE FUNCTION public.sst_calcado_item_removido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.sst_calcado_cancelar_item(OLD.id, 'item removido do pedido');
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_sst_calcado_item_removido ON public.sup_pedido_item;
CREATE TRIGGER trg_sst_calcado_item_removido BEFORE DELETE ON public.sup_pedido_item
FOR EACH ROW EXECUTE FUNCTION public.sst_calcado_item_removido();

CREATE OR REPLACE FUNCTION public.sst_calcado_do_pedido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.sst_calcado_sincronizar(NEW.id, public.sst_calcado_status_do_pedido(NEW.status),
      'pedido no Compras: ' || NEW.status);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_sst_calcado_do_pedido ON public.sup_pedido;
CREATE TRIGGER trg_sst_calcado_do_pedido AFTER UPDATE OF status ON public.sup_pedido
FOR EACH ROW EXECUTE FUNCTION public.sst_calcado_do_pedido();

-- Comprovação de entrega ENVIADA pelo encarregado = chegou ao colaborador.
CREATE OR REPLACE FUNCTION public.sst_calcado_da_comprovacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'ENVIADO' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ENVIADO') THEN
    PERFORM public.sst_calcado_sincronizar(NEW.pedido_id, 'entregue', 'comprovação de entrega enviada');
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_sst_calcado_da_comprovacao ON public.sup_pedido_comprovacao;
CREATE TRIGGER trg_sst_calcado_da_comprovacao AFTER INSERT OR UPDATE OF status ON public.sup_pedido_comprovacao
FOR EACH ROW EXECUTE FUNCTION public.sst_calcado_da_comprovacao();

-- ── 6. Laudo (bucket privado) ────────────────────────────────────────────
-- Caminhos: pedido/<sup_pedido.id>/<carimbo>_<nome>  → enviado pelo encarregado
--           controle/<id>/<carimbo>_<nome>          → enviado pelo SST
-- O encarregado externo (CPF + nascimento) não tem permissão de tela nenhuma;
-- o que o deixa enviar é ser quem criou o pedido.
CREATE OR REPLACE FUNCTION public.sst_calcado_pedido_do_encarregado(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT split_part(p_path, '/', 1) = 'pedido' AND auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sup_pedido p
     WHERE p.id::text = split_part(p_path, '/', 2) AND p.criado_por = auth.uid() AND p.status <> 'CANCELADO'
       AND EXISTS (SELECT 1 FROM public."SST_CALCADO_ORTOPEDICO" c WHERE c.pedido_id = p.id))
$$;
REVOKE ALL ON FUNCTION public.sst_calcado_pedido_do_encarregado(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_calcado_pedido_do_encarregado(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_calcado_pode_ler_laudo()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (public.can_access(auth.uid(), 'sst_calcados_ortopedicos', 'visualizar'::public.app_acao)
    OR public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar'::public.app_acao))
$$;
REVOKE ALL ON FUNCTION public.sst_calcado_pode_ler_laudo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_calcado_pode_ler_laudo() TO authenticated;

-- Laudo referenciado não sai do Storage; na substituição o antigo fica solto.
CREATE OR REPLACE FUNCTION public.sst_calcado_laudo_solto(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (public.can_access(auth.uid(), 'sst_calcados_ortopedicos', 'alterar'::public.app_acao)
          OR public.sst_calcado_pedido_do_encarregado(p_path))
    AND NOT EXISTS (SELECT 1 FROM public."SST_CALCADO_ORTOPEDICO" WHERE laudo_path = p_path)
$$;
REVOKE ALL ON FUNCTION public.sst_calcado_laudo_solto(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_calcado_laudo_solto(text) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sst-calcados-laudos', 'sst-calcados-laudos', false, 10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
-- O encarregado vê só o que ele mesmo enviou (mesmo critério do sup-crachas):
-- é o que deixa o front apagar o arquivo se o registro do laudo falhar.
DROP POLICY IF EXISTS "sst calcados laudos select" ON storage.objects;
CREATE POLICY "sst calcados laudos select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'sst-calcados-laudos' AND ((SELECT public.sst_calcado_pode_ler_laudo())
  OR (split_part(name, '/', 1) = 'pedido' AND owner = auth.uid())));
DROP POLICY IF EXISTS "sst calcados laudos insert" ON storage.objects;
CREATE POLICY "sst calcados laudos insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'sst-calcados-laudos' AND (
  (split_part(name, '/', 1) = 'controle' AND (SELECT public.can_access(auth.uid(), 'sst_calcados_ortopedicos', 'alterar'::public.app_acao)))
  OR public.sst_calcado_pedido_do_encarregado(name)));
DROP POLICY IF EXISTS "sst calcados laudos delete" ON storage.objects;
CREATE POLICY "sst calcados laudos delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'sst-calcados-laudos' AND public.sst_calcado_laudo_solto(name));

-- ── 7. RPCs ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_calcados_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_calcado_exige();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', c.id, 'pedido_id', c.pedido_id, 'pedido_codigo', coalesce(p.pedido_id, c.pedido_codigo),
    'pedido_status', p.status,
    'colaborador_nome', coalesce(nullif(btrim(p.nome_colaborador), ''), c.colaborador_nome),
    'contrato_nome', coalesce(p.contrato_nome, c.contrato_nome),
    'encarregado_nome', coalesce(p.solicitante_nome, c.encarregado_nome),
    'item_nome', c.item_nome, 'tamanho', c.tamanho, 'quantidade', c.quantidade,
    'data_solicitacao', c.data_solicitacao, 'status', c.status, 'observacoes', c.observacoes,
    'laudo_nome', c.laudo_nome, 'laudo_path', c.laudo_path, 'updated_at', c.updated_at)
    ORDER BY c.data_solicitacao DESC, c.id DESC)
    FROM public."SST_CALCADO_ORTOPEDICO" c LEFT JOIN public.sup_pedido p ON p.id = c.pedido_id), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_calcados_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_calcados_lista() TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_calcado_historico(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_calcado_exige();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', h.id, 'descricao', h.descricao,
    'autor_nome', h.autor_nome, 'created_at', h.created_at) ORDER BY h.id DESC)
    FROM public."SST_CALCADO_ORTOPEDICO_HISTORICO" h WHERE h.controle_id = p_id), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_calcado_historico(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_calcado_historico(bigint) TO authenticated;

-- O SST pode corrigir o status para qualquer valor (inclusive voltar), mas
-- Finalizado exige laudo — é o que garante o laudo no histórico do sistema.
CREATE OR REPLACE FUNCTION public.sst_calcado_salvar(p_id bigint, p_status text, p_observacoes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_ant public."SST_CALCADO_ORTOPEDICO"%ROWTYPE; v_obs text := nullif(btrim(coalesce(p_observacoes, '')), '');
BEGIN
  PERFORM public.sst_calcado_exige('alterar');
  SELECT * INTO v_ant FROM public."SST_CALCADO_ORTOPEDICO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado.'; END IF;
  IF p_status IS NULL OR public.sst_calcado_ordem(p_status) = 0 AND p_status <> 'cancelado' THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;
  IF p_status = 'finalizado' AND v_ant.laudo_path IS NULL THEN
    RAISE EXCEPTION 'Anexe o laudo antes de finalizar.';
  END IF;
  UPDATE public."SST_CALCADO_ORTOPEDICO" SET status = p_status, observacoes = v_obs WHERE id = p_id;
  IF v_ant.status IS DISTINCT FROM p_status THEN
    INSERT INTO public."SST_CALCADO_ORTOPEDICO_HISTORICO" (controle_id, descricao, autor_nome)
    VALUES (p_id, 'Status: ' || v_ant.status || ' → ' || p_status || '.', public.sst_afa_nome_usuario());
  END IF;
  IF v_ant.observacoes IS DISTINCT FROM v_obs THEN
    INSERT INTO public."SST_CALCADO_ORTOPEDICO_HISTORICO" (controle_id, descricao, autor_nome)
    VALUES (p_id, 'Observação: ' || coalesce(v_obs, '(apagada)'), public.sst_afa_nome_usuario());
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_calcado_salvar(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_calcado_salvar(bigint, text, text) TO authenticated;

-- Devolve o caminho antigo só quando ninguém mais aponta para ele, para o
-- front apagar o arquivo solto.
CREATE OR REPLACE FUNCTION public.sst_calcado_anexar_laudo(p_id bigint, p_nome text, p_path text, p_tamanho bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_antigo text;
BEGIN
  PERFORM public.sst_calcado_exige('alterar');
  IF p_path !~ ('^controle/' || p_id::text || '/[0-9]+_[^/]+$') OR nullif(btrim(p_nome), '') IS NULL
    OR p_tamanho < 1 OR p_tamanho > 10485760 THEN RAISE EXCEPTION 'Arquivo inválido.'; END IF;
  PERFORM 1 FROM storage.objects WHERE bucket_id = 'sst-calcados-laudos' AND name = p_path;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envie o arquivo antes de registrá-lo.'; END IF;
  SELECT laudo_path INTO v_antigo FROM public."SST_CALCADO_ORTOPEDICO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado.'; END IF;
  UPDATE public."SST_CALCADO_ORTOPEDICO" SET laudo_nome = p_nome, laudo_path = p_path, laudo_tamanho = p_tamanho WHERE id = p_id;
  INSERT INTO public."SST_CALCADO_ORTOPEDICO_HISTORICO" (controle_id, descricao, autor_nome)
  VALUES (p_id, 'Laudo anexado: ' || p_nome || '.', public.sst_afa_nome_usuario());
  IF v_antigo IS NOT NULL AND EXISTS (SELECT 1 FROM public."SST_CALCADO_ORTOPEDICO" WHERE laudo_path = v_antigo) THEN
    RETURN NULL;
  END IF;
  RETURN v_antigo;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_calcado_anexar_laudo(bigint, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_calcado_anexar_laudo(bigint, text, text, bigint) TO authenticated;

-- Encarregado, logo depois de criar o pedido. Preenche só as linhas ainda sem
-- laudo — não sobrescreve o que o SST já anexou.
CREATE OR REPLACE FUNCTION public.sup_pedido_anexar_laudo(p_pedido_id uuid, p_nome text, p_path text, p_tamanho bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_ped public.sup_pedido; v_qtd integer := 0; r record;
BEGIN
  SELECT * INTO v_ped FROM public.sup_pedido WHERE id = p_pedido_id;
  IF NOT FOUND OR auth.uid() IS NULL OR v_ped.criado_por IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Só quem fez o pedido pode anexar o laudo por aqui.' USING ERRCODE = '42501';
  END IF;
  IF p_path !~ ('^pedido/' || p_pedido_id::text || '/[0-9]+_[^/]+$') OR nullif(btrim(p_nome), '') IS NULL
    OR p_tamanho < 1 OR p_tamanho > 10485760 THEN RAISE EXCEPTION 'Arquivo inválido.'; END IF;
  PERFORM 1 FROM storage.objects WHERE bucket_id = 'sst-calcados-laudos' AND name = p_path;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envie o arquivo antes de registrá-lo.'; END IF;
  FOR r IN SELECT id FROM public."SST_CALCADO_ORTOPEDICO" WHERE pedido_id = p_pedido_id AND laudo_path IS NULL FOR UPDATE LOOP
    UPDATE public."SST_CALCADO_ORTOPEDICO" SET laudo_nome = p_nome, laudo_path = p_path, laudo_tamanho = p_tamanho WHERE id = r.id;
    INSERT INTO public."SST_CALCADO_ORTOPEDICO_HISTORICO" (controle_id, descricao, autor_nome)
    VALUES (r.id, 'Laudo anexado pelo encarregado no pedido: ' || p_nome || '.', coalesce(v_ped.solicitante_nome, 'Encarregado'));
    v_qtd := v_qtd + 1;
  END LOOP;
  RETURN v_qtd;
END $fn$;
REVOKE ALL ON FUNCTION public.sup_pedido_anexar_laudo(uuid, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_pedido_anexar_laudo(uuid, text, text, bigint) TO authenticated;

-- Para o card do Compras em Pedidos de Materiais: só os pedidos da página.
CREATE OR REPLACE FUNCTION public.sup_pedido_calcados(p_pedido_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.sst_calcado_pode_ler_laudo() THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'pedido_id', c.pedido_id,
    'pedido_item_id', c.pedido_item_id, 'status', c.status, 'laudo_nome', c.laudo_nome,
    'laudo_path', c.laudo_path, 'updated_at', c.updated_at))
    FROM public."SST_CALCADO_ORTOPEDICO" c
   WHERE c.pedido_id = ANY (coalesce(p_pedido_ids, '{}'::uuid[]))), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sup_pedido_calcados(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_pedido_calcados(uuid[]) TO authenticated;

-- Solicitar Materiais precisa saber quais itens pedem laudo. Mudar o RETURNS
-- TABLE exige DROP; o corpo é o mesmo da 20260819000003, mais a coluna nova.
DROP FUNCTION IF EXISTS public.sup_ext_itens(uuid);
CREATE FUNCTION public.sup_ext_itens(p_funcao_id uuid)
RETURNS TABLE (
  id uuid, nome text, tipo text,
  opcao_tamanho text[], opcao_quantidade text[], opcao_litros text[],
  ortopedico boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_contrato uuid;
BEGIN
  SELECT p.contrato_id INTO v_contrato
    FROM public.sup_funcao f JOIN public.sup_posto p ON p.id = f.posto_id
   WHERE f.id = p_funcao_id;
  IF NOT public.sup_ext_pode_ver_contrato(v_contrato) THEN
    RAISE EXCEPTION 'Sem acesso a esta função';
  END IF;

  RETURN QUERY
    SELECT i.id, i.nome, i.tipo,
           (SELECT o.opcoes FROM public.sup_item_opcao o
             WHERE o.item_id = i.id AND o.tipo = 'tamanho'),
           (SELECT o.opcoes FROM public.sup_item_opcao o
             WHERE o.item_id = i.id AND o.tipo = 'quantidade'),
           (SELECT o.opcoes FROM public.sup_item_opcao o
             WHERE o.item_id = i.id AND o.tipo = 'litros'),
           i.ortopedico
      FROM public.sup_funcao_item fi
      JOIN public.sup_item i ON i.id = fi.item_id
     WHERE fi.funcao_id = p_funcao_id
       AND fi.aprovado AND fi.ativo
       AND i.aprovado  AND i.ativo
     ORDER BY fi.ordem, i.tipo, i.nome;
END $$;
REVOKE EXECUTE ON FUNCTION public.sup_ext_itens(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_ext_itens(uuid) TO authenticated;

-- ── 8. Carga inicial: pedidos que já existem ─────────────────────────────
-- Status pela mesma regra dos gatilhos; comprovação ENVIADA vira entregue.
INSERT INTO public."SST_CALCADO_ORTOPEDICO" (pedido_item_id, pedido_id, pedido_codigo, colaborador_nome,
  colaborador_empregado_id, contrato_nome, encarregado_nome, item_nome, tamanho, quantidade, data_solicitacao, status)
SELECT pi.id, p.id, p.pedido_id, nullif(btrim(p.nome_colaborador), ''), p.colaborador_empregado_id, p.contrato_nome,
  p.solicitante_nome, pi.nome_item, pi.tamanho, pi.quantidade, p.created_at,
  public.sst_calcado_proximo_status(
    public.sst_calcado_proximo_status('solicitado', public.sst_calcado_status_do_pedido(p.status)),
    CASE WHEN EXISTS (SELECT 1 FROM public.sup_pedido_comprovacao pc WHERE pc.pedido_id = p.id AND pc.status = 'ENVIADO')
      THEN 'entregue' END)
FROM public.sup_pedido_item pi JOIN public.sup_pedido p ON p.id = pi.pedido_id
WHERE public.sup_item_eh_ortopedico(pi.item_id)
ON CONFLICT (pedido_item_id) DO NOTHING;
INSERT INTO public."SST_CALCADO_ORTOPEDICO_HISTORICO" (controle_id, descricao, autor_nome)
SELECT c.id, 'Trazido do pedido ' || coalesce(c.pedido_codigo, '') || ' na implantação do controle (status ' || c.status || ').', 'Sistema'
FROM public."SST_CALCADO_ORTOPEDICO" c
WHERE NOT EXISTS (SELECT 1 FROM public."SST_CALCADO_ORTOPEDICO_HISTORICO" h WHERE h.controle_id = c.id);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (somente se não houver registros a preservar):
-- DROP POLICY IF EXISTS "sst calcados laudos select" ON storage.objects;
-- DROP POLICY IF EXISTS "sst calcados laudos insert" ON storage.objects;
-- DROP POLICY IF EXISTS "sst calcados laudos delete" ON storage.objects;
-- DROP TRIGGER IF EXISTS trg_sst_calcado_do_pedido_item ON public.sup_pedido_item;
-- DROP TRIGGER IF EXISTS trg_sst_calcado_item_removido ON public.sup_pedido_item;
-- DROP TRIGGER IF EXISTS trg_sst_calcado_do_pedido ON public.sup_pedido;
-- DROP TRIGGER IF EXISTS trg_sst_calcado_da_comprovacao ON public.sup_pedido_comprovacao;
-- DROP TRIGGER IF EXISTS trg_sup_item_marcar_ortopedico ON public.sup_item;
-- DROP FUNCTION IF EXISTS public.sup_ext_itens(uuid);  -- e recriar pela 20260819000003
-- DROP FUNCTION IF EXISTS public.sup_pedido_calcados(uuid[]), public.sup_pedido_anexar_laudo(uuid, text, text, bigint),
--   public.sst_calcado_anexar_laudo(bigint, text, text, bigint), public.sst_calcado_salvar(bigint, text, text),
--   public.sst_calcado_historico(bigint), public.sst_calcados_lista(), public.sst_calcado_laudo_solto(text),
--   public.sst_calcado_pode_ler_laudo(), public.sst_calcado_pedido_do_encarregado(text),
--   public.sst_calcado_da_comprovacao(), public.sst_calcado_do_pedido(), public.sst_calcado_item_removido(),
--   public.sst_calcado_do_pedido_item(), public.sst_calcado_cancelar_item(uuid, text),
--   public.sst_calcado_sincronizar(uuid, text, text), public.sst_calcado_exige(text),
--   public.sst_calcado_proximo_status(text, text), public.sst_calcado_status_do_pedido(text),
--   public.sst_calcado_ordem(text), public.sup_item_eh_ortopedico(uuid), public.sup_item_marcar_ortopedico();
-- DELETE FROM storage.buckets WHERE id = 'sst-calcados-laudos'; -- somente bucket vazio
-- DROP TABLE IF EXISTS public."SST_CALCADO_ORTOPEDICO_HISTORICO", public."SST_CALCADO_ORTOPEDICO";
-- ALTER TABLE public.sup_item DROP COLUMN IF EXISTS ortopedico;
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'sst_calcados_ortopedicos';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sst_calcados_ortopedicos';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sst_calcados_ortopedicos';
-- DELETE FROM public.app_menu WHERE codigo = 'sst_calcados_ortopedicos';
-- NOTIFY pgrst, 'reload schema';
