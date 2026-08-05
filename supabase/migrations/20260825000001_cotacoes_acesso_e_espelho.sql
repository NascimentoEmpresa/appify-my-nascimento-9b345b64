-- =====================================================================
-- COTAÇÕES — o lado de Compras + o canal inteiro sob o Acesso por Usuário
--
-- CONTEXTO
-- A 20260805000002 criou `cotacoes_licitacao` com o modelo completo de ida e
-- volta (Subsistema 5 do legado, REPLICAR-MODULO-COMPRAS.md §7). O lado da
-- Licitação já abre, edita e exclui solicitação. Falta a outra metade: quem
-- LÊ e RESPONDE, que é Compras. As colunas existem — `visualizado_por_*`,
-- `resposta_*`, `respondente_*` — mas nada no sistema escreve nelas hoje, e o
-- status `visualizado` é inalcançável.
--
-- O QUE ESTA MIGRATION FAZ
--   1. cria o menu sup_cotacoes (Compras), já fechado por padrão;
--   2. fecha cotacoes-licitacao, que hoje está ABERTO a todo autenticado;
--   3. reescreve a RLS amarrando ao gerenciamento de acesso;
--   4. cria o trigger que separa o que cada lado pode escrever;
--   5. cria as duas RPCs das ações de Compras;
--   6. fecha o bucket cotacoes-arquivos, hoje público.
--
-- Nada aqui muda o comportamento da tela de Licitação: ela continua abrindo,
-- editando e excluindo igual. O que muda é que passa a exigir permissão.
--
-- ROLLBACK: ver o bloco no fim do arquivo.
-- =====================================================================

-- ── 1. Menu de Compras ───────────────────────────────────────────────
--
-- Código NOVO (`sup_cotacoes`), não o `cotacoes` antigo. O menu antigo é da
-- tela de RFQ aposentada na 20260821000001 e carrega 25 regras herdadas dos
-- perfis "Legado: controladoria / diretor_adm / diretor_op / presidencia /
-- comprador". Reaproveitar o código entregaria a tela nova a quem tinha a
-- RFQ. Só a ROTA é reaproveitada.

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_cotacoes', 'Cotações — Licitação', '/app/suprimentos/cotacoes', 72, true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- O menu antigo continua inativo, mas larga a rota: matchMenuCode() em
-- useAccessibleMenus.ts resolve pathname → código por prefixo mais longo, e
-- duas linhas com a mesma rota ficariam disputando. Hoje não colide porque a
-- lista só traz ativo = true; isto evita a armadilha caso alguém reative.
UPDATE public.app_menu
   SET rota = '/app/suprimentos/cotacoes-rfq-aposentado'
 WHERE codigo = 'cotacoes'
   AND rota   = '/app/suprimentos/cotacoes'
   AND ativo IS NOT TRUE;

-- ── 2. Fechar por padrão os DOIS menus ───────────────────────────────
--
-- `cotacoes-licitacao` foi criado sem nenhuma regra em
-- perfil_acesso_permissao/screen_permission_user. Menu sem NENHUMA regra é
-- tratado como ABERTO (list_configured_menu_codes), então a tela de Cotações
-- da Licitação está visível para todo usuário autenticado desde que subiu.
-- Mesmo caso que a 20260823000002 corrigiu na Fase 1.
--
-- Semear nos perfis concede_tudo não muda nada para quem já via tudo — só
-- marca o código como "configurado", e aí vale negado por padrão.

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, m.codigo, a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('sup_cotacoes'), ('cotacoes-licitacao')) AS m(codigo)
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao),
                    ('alterar'::public.app_acao), ('excluir'::public.app_acao)) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 3. RLS amarrada ao gerenciamento de acesso ───────────────────────
--
-- As policies originais filtravam só por empresa: qualquer autenticado da
-- empresa lia, criava e alterava, e o delete usava has_role('admin'), do
-- sistema de cargo antigo. A tela já chamava can("incluir", ...) — era só o
-- banco que estava de fora.
--
-- O UPDATE fica propositalmente amplo aqui: RLS no Postgres não distingue
-- coluna, e é o trigger do passo 4 que diz quem pode escrever o quê.

DROP POLICY IF EXISTS cotacoes_select ON public.cotacoes_licitacao;
CREATE POLICY cotacoes_select ON public.cotacoes_licitacao
  FOR SELECT TO authenticated
  USING (
    empresa_id IN (SELECT empresa_id FROM public.user_empresa WHERE user_id = auth.uid())
    AND (public.can_access(auth.uid(), 'cotacoes-licitacao', 'visualizar')
         OR public.can_access(auth.uid(), 'sup_cotacoes', 'visualizar'))
  );

-- Só Licitação abre solicitação. Compras responde por UPDATE, nunca por INSERT.
DROP POLICY IF EXISTS cotacoes_insert ON public.cotacoes_licitacao;
CREATE POLICY cotacoes_insert ON public.cotacoes_licitacao
  FOR INSERT TO authenticated
  WITH CHECK (
    empresa_id IN (SELECT empresa_id FROM public.user_empresa WHERE user_id = auth.uid())
    AND public.can_access(auth.uid(), 'cotacoes-licitacao', 'incluir')
  );

DROP POLICY IF EXISTS cotacoes_update ON public.cotacoes_licitacao;
CREATE POLICY cotacoes_update ON public.cotacoes_licitacao
  FOR UPDATE TO authenticated
  USING (
    empresa_id IN (SELECT empresa_id FROM public.user_empresa WHERE user_id = auth.uid())
    AND (public.can_access(auth.uid(), 'cotacoes-licitacao', 'visualizar')
         OR public.can_access(auth.uid(), 'sup_cotacoes', 'visualizar'))
  );

-- Excluir é da Licitação, como no legado. Sai o has_role('admin').
DROP POLICY IF EXISTS cotacoes_delete ON public.cotacoes_licitacao;
CREATE POLICY cotacoes_delete ON public.cotacoes_licitacao
  FOR DELETE TO authenticated
  USING (
    empresa_id IN (SELECT empresa_id FROM public.user_empresa WHERE user_id = auth.uid())
    AND public.can_access(auth.uid(), 'cotacoes-licitacao', 'excluir')
  );

-- ── 4. O trigger que faz o espelho ser espelho ───────────────────────
--
-- Sem ele, a policy de UPDATE (necessariamente ampla) deixaria Compras
-- reescrever o pedido da Licitação e vice-versa. Aqui a regra é por GRUPO DE
-- COLUNAS, e vale por qualquer caminho — hook, RPC ou chamada crua na API:
--
--   comentario / tipo / arquivo_*      → alterar em cotacoes-licitacao
--   resposta_* / respondente_*         → alterar em sup_cotacoes
--   visualizado_*                      → visualizar em sup_cotacoes
--   resposta_visualizada_*             → visualizar em cotacoes-licitacao
--
-- Duas exceções deliberadas, ambas do §7.2:
--
--   • LIMPAR visualizado_* (para NULL) é permitido a quem pode editar a
--     solicitação. Editar faz o item voltar a contar como não lido para
--     Compras — é o que garante que uma alteração não passe despercebida.
--     Sem esta exceção o próprio "Editar" da Licitação seria barrado.
--   • O status não é livre: cada destino exige a permissão do lado que
--     legitimamente leva o item até lá.

CREATE OR REPLACE FUNCTION public.cotacoes_guarda_colunas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_lic_ver   boolean;
  v_lic_alt   boolean;
  v_com_ver   boolean;
  v_com_alt   boolean;
BEGIN
  -- Sem JWT (SQL Editor, service_role, jobs) não há o que autorizar: esses
  -- papéis já passam por cima da RLS de qualquer forma.
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  v_lic_ver := public.can_access(v_uid, 'cotacoes-licitacao', 'visualizar');
  v_lic_alt := public.can_access(v_uid, 'cotacoes-licitacao', 'alterar');
  v_com_ver := public.can_access(v_uid, 'sup_cotacoes', 'visualizar');
  v_com_alt := public.can_access(v_uid, 'sup_cotacoes', 'alterar');

  -- a) o pedido em si — só Licitação mexe
  IF (NEW.comentario, NEW.tipo, NEW.arquivo_url, NEW.arquivo_nome)
     IS DISTINCT FROM (OLD.comentario, OLD.tipo, OLD.arquivo_url, OLD.arquivo_nome)
     AND NOT v_lic_alt THEN
    RAISE EXCEPTION 'Sem permissão para alterar a solicitação de cotação (exige alterar em Licitações > Cotações).'
      USING ERRCODE = '42501';
  END IF;

  -- b) a resposta — só Compras escreve
  IF (NEW.resposta_comentario, NEW.resposta_arquivo_url, NEW.resposta_arquivo_nome,
      NEW.respondente_id, NEW.respondente_nome, NEW.data_resposta)
     IS DISTINCT FROM (OLD.resposta_comentario, OLD.resposta_arquivo_url, OLD.resposta_arquivo_nome,
      OLD.respondente_id, OLD.respondente_nome, OLD.data_resposta)
     AND NOT v_com_alt THEN
    RAISE EXCEPTION 'Sem permissão para responder cotação (exige alterar em Suprimentos > Cotações).'
      USING ERRCODE = '42501';
  END IF;

  -- c) leitura por Compras. Limpar é da edição da Licitação (§7.2); carimbar é de Compras.
  IF (NEW.visualizado_por_id, NEW.visualizado_por_nome, NEW.visualizado_em)
     IS DISTINCT FROM (OLD.visualizado_por_id, OLD.visualizado_por_nome, OLD.visualizado_em) THEN
    IF NEW.visualizado_por_id IS NULL AND NEW.visualizado_em IS NULL THEN
      IF NOT v_lic_alt THEN
        RAISE EXCEPTION 'Sem permissão para reabrir a cotação como não lida.' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT v_com_ver THEN
      RAISE EXCEPTION 'Sem permissão para marcar a cotação como visualizada por Compras.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- d) leitura da resposta pela Licitação
  IF (NEW.resposta_visualizada_por_id, NEW.resposta_visualizada_em)
     IS DISTINCT FROM (OLD.resposta_visualizada_por_id, OLD.resposta_visualizada_em)
     AND NOT v_lic_ver THEN
    RAISE EXCEPTION 'Sem permissão para marcar a resposta como lida.' USING ERRCODE = '42501';
  END IF;

  -- e) status: cada destino exige o lado que legitimamente leva o item até lá
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF    NEW.status = 'pendente'    AND NOT v_lic_alt THEN
      RAISE EXCEPTION 'Sem permissão para devolver a cotação a pendente.' USING ERRCODE = '42501';
    ELSIF NEW.status = 'visualizado' AND NOT v_com_ver THEN
      RAISE EXCEPTION 'Sem permissão para marcar a cotação como visualizada.' USING ERRCODE = '42501';
    ELSIF NEW.status = 'respondido'  AND NOT v_com_alt THEN
      RAISE EXCEPTION 'Sem permissão para responder cotação.' USING ERRCODE = '42501';
    ELSIF NEW.status NOT IN ('pendente', 'visualizado', 'respondido') THEN
      RAISE EXCEPTION 'Status de cotação inválido: %', NEW.status USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cotacoes_guarda_colunas ON public.cotacoes_licitacao;
CREATE TRIGGER trg_cotacoes_guarda_colunas
  BEFORE UPDATE ON public.cotacoes_licitacao
  FOR EACH ROW EXECUTE FUNCTION public.cotacoes_guarda_colunas();

-- ── 5. As duas ações de Compras ──────────────────────────────────────
--
-- Poderiam ser UPDATEs no cliente (o trigger já protege), mas via RPC o NOME
-- de quem agiu sai de `profiles`, nunca do payload — mesma correção feita em
-- sup_ext_criar_pedido, para ninguém carimbar a leitura ou a resposta com o
-- nome de outra pessoa.

-- §7.4: "ler é o ato de marcar como lido". Abrir um card pendente carimba
-- quem leu e quando — é isto que alimenta o "Visualizado por Compras em…"
-- que a tela da Licitação já renderiza e que nunca aparecia.
-- Idempotente: só age sobre pendente, então reabrir o card não reescreve a
-- data original nem rebaixa um item já respondido.
CREATE OR REPLACE FUNCTION public.sup_cot_marcar_visualizada(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
BEGIN
  IF NOT public.can_access(v_uid, 'sup_cotacoes', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver as cotações de Compras.' USING ERRCODE = '42501';
  END IF;

  SELECT p.display_name INTO v_nome FROM public.profiles p WHERE p.id = v_uid;

  UPDATE public.cotacoes_licitacao
     SET status               = 'visualizado',
         visualizado_por_id   = v_uid,
         visualizado_por_nome = COALESCE(v_nome, 'Compras'),
         visualizado_em       = now()
   WHERE id = p_id
     AND status = 'pendente';
END;
$$;

-- §7.2: "Responder exige comentário, respondente E arquivo." Não existe
-- resposta sem documento — é o documento que a Licitação vai anexar ao
-- processo. Status vai para respondido na mesma transação.
CREATE OR REPLACE FUNCTION public.sup_cot_responder(
  p_id            uuid,
  p_comentario    text,
  p_arquivo_path  text,
  p_arquivo_nome  text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_n    int;
BEGIN
  IF NOT public.can_access(v_uid, 'sup_cotacoes', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para responder cotação.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_comentario), '') = '' THEN
    RAISE EXCEPTION 'O comentário da resposta é obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_arquivo_path), '') = '' THEN
    RAISE EXCEPTION 'A resposta exige um arquivo anexado.' USING ERRCODE = '22023';
  END IF;

  SELECT p.display_name INTO v_nome FROM public.profiles p WHERE p.id = v_uid;

  UPDATE public.cotacoes_licitacao
     SET resposta_comentario   = p_comentario,
         resposta_arquivo_url  = p_arquivo_path,
         resposta_arquivo_nome = p_arquivo_nome,
         respondente_id        = v_uid,
         respondente_nome      = COALESCE(v_nome, 'Compras'),
         data_resposta         = now(),
         status                = 'respondido',
         -- Resposta nova é resposta não lida: reacende o aviso na Licitação.
         resposta_visualizada_por_id = NULL,
         resposta_visualizada_em     = NULL
   WHERE id = p_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Cotação não encontrada ou fora do seu acesso.' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sup_cot_marcar_visualizada(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.sup_cot_responder(uuid, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sup_cot_marcar_visualizada(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_cot_responder(uuid, text, text, text) TO authenticated;

-- ── 6. Bucket dos arquivos ───────────────────────────────────────────
--
-- Estava public = true, com policy de SELECT `TO public` (alcança até anon) e
-- o cliente montando getPublicUrl. Planilha de cotação traz preço de
-- fornecedor: quem tivesse o link lia sem login. Nem o bucket nem as policies
-- estavam em migration nenhuma — foram criados pelo dashboard.
--
-- Limite de 10 MB conforme §7.2. NÃO uso allowed_mime_types: o navegador
-- manda mime inconsistente para .xls/.zip (chega application/octet-stream com
-- frequência) e a lista barraria upload legítimo. A validação de extensão e
-- tamanho fica no cliente, e o teto de tamanho — que é o que protege o
-- serviço — fica aqui, onde não dá para burlar.

UPDATE storage.buckets
   SET public = false, file_size_limit = 10485760
 WHERE id = 'cotacoes-arquivos';

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cotacoes-arquivos', 'cotacoes-arquivos', false, 10485760)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS cotacoes_storage_select ON storage.objects;
CREATE POLICY cotacoes_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cotacoes-arquivos'
    AND (public.can_access(auth.uid(), 'cotacoes-licitacao', 'visualizar')
         OR public.can_access(auth.uid(), 'sup_cotacoes', 'visualizar')));

DROP POLICY IF EXISTS cotacoes_storage_insert ON storage.objects;
CREATE POLICY cotacoes_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cotacoes-arquivos'
    AND (public.can_access(auth.uid(), 'cotacoes-licitacao', 'incluir')
         OR public.can_access(auth.uid(), 'cotacoes-licitacao', 'alterar')
         OR public.can_access(auth.uid(), 'sup_cotacoes', 'alterar')));

-- As linhas já gravadas guardam a URL pública inteira. Com o bucket fechado
-- essa URL para de abrir, então converte para o CAMINHO — que é o que o
-- createSignedUrl do cliente espera. O helper no front aceita os dois
-- formatos, mas deixar a base limpa evita carregar a exceção para sempre.
UPDATE public.cotacoes_licitacao
   SET arquivo_url = split_part(arquivo_url, '/object/public/cotacoes-arquivos/', 2)
 WHERE arquivo_url LIKE '%/object/public/cotacoes-arquivos/%';

UPDATE public.cotacoes_licitacao
   SET resposta_arquivo_url = split_part(resposta_arquivo_url, '/object/public/cotacoes-arquivos/', 2)
 WHERE resposta_arquivo_url LIKE '%/object/public/cotacoes-arquivos/%';

-- ── 7. Conferência ───────────────────────────────────────────────────
SELECT am.codigo, am.nome, am.rota, am.ativo,
       EXISTS (SELECT 1 FROM public.perfil_acesso_permissao p WHERE p.menu_codigo = am.codigo)
         AS fechado_por_padrao
  FROM public.app_menu am
 WHERE am.codigo IN ('sup_cotacoes', 'cotacoes-licitacao', 'cotacoes')
 ORDER BY am.codigo;

SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'cotacoes-arquivos';

SELECT count(*) FILTER (WHERE arquivo_url LIKE 'http%') AS urls_publicas_restantes
  FROM public.cotacoes_licitacao;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_cotacoes_guarda_colunas ON public.cotacoes_licitacao;
--   DROP FUNCTION IF EXISTS public.cotacoes_guarda_colunas();
--   DROP FUNCTION IF EXISTS public.sup_cot_marcar_visualizada(uuid);
--   DROP FUNCTION IF EXISTS public.sup_cot_responder(uuid, text, text, text);
--   DELETE FROM public.perfil_acesso_permissao
--    WHERE menu_codigo IN ('sup_cotacoes', 'cotacoes-licitacao');
--   DELETE FROM public.app_menu WHERE codigo = 'sup_cotacoes';
--   UPDATE storage.buckets SET public = true WHERE id = 'cotacoes-arquivos';
--   -- as policies voltam ao estado original recriando-as só com empresa_id
-- =====================================================================
