-- =====================================================================
-- SUPPLY / PEDIDOS DE MATERIAIS — EDITAR O PEDIDO, COM TRILHA
--
-- Pedido de usuário final: a tela /app/suprimentos/pedidos-materiais tinha
-- "Status", "Histórico" e "Excluir", mas não tinha "Editar". O encarregado
-- pedia o tamanho errado, ou esquecia um item, e a única saída era o Supply
-- APAGAR o pedido para ele refazer — perdendo protocolo, data e trilha.
--
-- O que esta migration entrega:
--   1. sup_pedido_historico ganha `campo` / `valor_anterior` / `valor_novo`,
--      o mesmo vocabulário que sup_patrimonio_log já usa (20260824000001).
--      Uma linha por campo alterado, com autor, dia e hora — que é
--      exatamente o que foi pedido.
--   2. Dois triggers de auditoria (pedido e item). O log fica no BANCO, não
--      na RPC: qualquer UPDATE que chegue por fora (PostgREST direto, SQL
--      Editor, uma tela futura) também fica registrado. É a lição do §9.2
--      do módulo — "não dá para esquecer de logar se quem loga é o trigger".
--   3. RPC sup_pedido_editar(): aplica cabeçalho + diff de itens numa
--      transação só, com os guarda-corpos que a edição exige.
--   4. sup_ext_pode_ver_contrato() passa a reconhecer o operador de Supply,
--      senão o modal de edição não consegue listar o catálogo da função.
--
-- DECISÕES DE PRODUTO (fechadas com o solicitante em 02/09/2026):
--   • contrato / posto / função NÃO são editáveis. Trocá-los muda a
--     identidade do pedido e invalida o catálogo dos itens já escolhidos —
--     para esse caso o caminho continua sendo excluir e refazer.
--   • pedido DESPACHADO ou CANCELADO só aceita edição das observações. A
--     peça física já saiu (ou o pedido morreu); reescrever colaborador e
--     itens depois disso seria reescrever a história.
--   • item que já consumiu etiqueta do estoque é INTOCÁVEL em qualquer
--     status — nem remover, nem mudar tamanho/quantidade. É a dívida §12.7
--     do legado (lá, editar o pedido reordenava o array JSONB e quebrava a
--     ligação com a TAG em silêncio). Aqui a recusa é explícita e nomeia a
--     etiqueta.
--
-- ROLLBACK: ver bloco comentado no fim do arquivo.
-- =====================================================================

-- ── 1. Histórico campo a campo ───────────────────────────────────────
--
-- `acao = 'EDITADO'` já era previsto no CHECK original (20260819000002) e
-- até hoje ninguém gravava esse valor. As três colunas novas são NULL em
-- tudo que já existe, e o front trata linha sem `campo` como o evento
-- antigo (mudança de status / comentário de Compras).
ALTER TABLE public.sup_pedido_historico
  ADD COLUMN IF NOT EXISTS campo          text,
  ADD COLUMN IF NOT EXISTS valor_anterior text,
  ADD COLUMN IF NOT EXISTS valor_novo     text;

COMMENT ON COLUMN public.sup_pedido_historico.campo IS
  'Coluna alterada (nome_colaborador, tipo_pedido...) ou pseudo-campo de item '
  '(item_adicionado, item_alterado, item_removido). NULL nos eventos de status.';

-- ── 2. Descrição legível de um item ──────────────────────────────────
--
-- "BOTINA DE SEGURANÇA (42) x1" é o que vai para a trilha. Uma função só,
-- usada pelo trigger nos três casos (adicionado / alterado / removido),
-- para o texto do "antes" e do "depois" nunca divergirem de formato.
CREATE OR REPLACE FUNCTION public.sup_pedido_item_descr(
  p_nome text, p_tamanho text, p_litros text, p_quantidade integer
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(p_nome, '—')
      || coalesce(' (' || nullif(btrim(p_tamanho), '') || ')', '')
      || coalesce(' ' || nullif(btrim(p_litros), '') || 'L', '')
      || ' x' || coalesce(p_quantidade, 1);
$$;

-- ── 3. Auditoria do cabeçalho do pedido ──────────────────────────────
--
-- NÃO registra `status`, `data_despachado`, `observacao` nem `updated_at`:
--   • status/data_despachado já têm evento próprio, gravado por
--     sup_est_baixar() na mesma transação da baixa de estoque. Logar aqui
--     também produziria duas linhas para o mesmo fato;
--   • `observacao` (comentário de Compras) é do fluxo de status pela mesma
--     razão — quando a edição mexe nela, quem grava é sup_pedido_editar(),
--     no MESMO formato que sup_est_baixar já usa, para a linha do tempo ter
--     uma renderização só para esse evento;
--   • `updated_at` é ruído.
--
-- §9.2 do módulo: o log nunca derruba a operação. Daí o bloco EXCEPTION.
CREATE OR REPLACE FUNCTION public.sup_pedido_registrar_edicao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text := coalesce(public.sup_est_nome_usuario(), 'sistema');
BEGIN
  BEGIN
    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_novo, campo, valor_anterior, valor_novo,
       alterado_por, alterado_por_nome)
    SELECT NEW.id, 'EDITADO', NEW.status, x.campo, x.antes, x.depois, v_uid, v_nome
      FROM (VALUES
        ('nome_colaborador',        OLD.nome_colaborador,           NEW.nome_colaborador),
        ('matricula_colaborador',   OLD.matricula_colaborador,      NEW.matricula_colaborador),
        ('tipo_pedido',             OLD.tipo_pedido,                NEW.tipo_pedido),
        ('admissao',                OLD.admissao::text,             NEW.admissao::text),
        ('tipo_admissao',           OLD.tipo_admissao,              NEW.tipo_admissao),
        ('data_admissao',           OLD.data_admissao::text,        NEW.data_admissao::text),
        ('observacoes_solicitante', OLD.observacoes_solicitante,    NEW.observacoes_solicitante),
        ('contrato_nome',           OLD.contrato_nome,              NEW.contrato_nome),
        ('posto_nome',              OLD.posto_nome,                 NEW.posto_nome),
        ('funcao_nome',             OLD.funcao_nome,                NEW.funcao_nome),
        ('imagem_cracha_path',      OLD.imagem_cracha_path,         NEW.imagem_cracha_path)
      ) AS x(campo, antes, depois)
     WHERE x.antes IS DISTINCT FROM x.depois;
  EXCEPTION WHEN others THEN
    NULL;  -- auditoria nunca impede a operação
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sup_pedido_log_edicao ON public.sup_pedido;
CREATE TRIGGER trg_sup_pedido_log_edicao
  AFTER UPDATE ON public.sup_pedido
  FOR EACH ROW EXECUTE FUNCTION public.sup_pedido_registrar_edicao();

-- ── 4. Auditoria dos itens ───────────────────────────────────────────
--
-- Duas armadilhas tratadas explicitamente:
--
--   • CRIAÇÃO DO PEDIDO. sup_ext_criar_pedido() insere N itens logo depois
--     do pedido; sem guarda, cada pedido novo nasceria com um "CRIADO" e
--     mais N linhas de "item adicionado". O item nascido junto tem
--     created_at igual ao do pedido (ambos são o now() da MESMA transação),
--     e é isso que o distingue de um item incluído numa edição posterior.
--
--   • EXCLUSÃO DO PEDIDO. O DELETE cascateia para os itens e dispara este
--     trigger uma vez por item, gravando histórico que o próprio cascade
--     apagaria em seguida. Quando o pai já sumiu, a busca por ele volta
--     vazia — e é esse vazio que diz "não é edição, é exclusão".
CREATE OR REPLACE FUNCTION public.sup_pedido_item_registrar_edicao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_nome   text := coalesce(public.sup_est_nome_usuario(), 'sistema');
  -- NÃO inicializar com OLD/NEW aqui: num INSERT o OLD ainda não existe e
  -- ler um campo dele derruba a função com "record old is not assigned yet".
  v_pedido uuid;
  v_status text;
  v_criado timestamptz;
  v_campo  text;
  v_antes  text;
  v_depois text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_pedido := OLD.pedido_id; ELSE v_pedido := NEW.pedido_id; END IF;

  BEGIN
    SELECT p.status, p.created_at INTO v_status, v_criado
      FROM public.sup_pedido p WHERE p.id = v_pedido;
    IF v_status IS NULL THEN
      -- Pedido sendo excluído: o cascade levaria o histórico junto.
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF NEW.created_at = v_criado THEN
        RETURN NEW;  -- item que nasceu junto com o pedido, não é edição
      END IF;
      v_campo  := 'item_adicionado';
      v_depois := public.sup_pedido_item_descr(NEW.nome_item, NEW.tamanho, NEW.litros, NEW.quantidade);

    ELSIF TG_OP = 'DELETE' THEN
      v_campo := 'item_removido';
      v_antes := public.sup_pedido_item_descr(OLD.nome_item, OLD.tamanho, OLD.litros, OLD.quantidade);

    ELSE
      -- `ordem` muda a cada reordenação e não interessa à trilha.
      IF (OLD.nome_item, OLD.tamanho, OLD.litros, OLD.quantidade)
         IS NOT DISTINCT FROM
         (NEW.nome_item, NEW.tamanho, NEW.litros, NEW.quantidade) THEN
        RETURN NEW;
      END IF;
      v_campo  := 'item_alterado';
      v_antes  := public.sup_pedido_item_descr(OLD.nome_item, OLD.tamanho, OLD.litros, OLD.quantidade);
      v_depois := public.sup_pedido_item_descr(NEW.nome_item, NEW.tamanho, NEW.litros, NEW.quantidade);
    END IF;

    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_novo, campo, valor_anterior, valor_novo,
       alterado_por, alterado_por_nome)
    VALUES (v_pedido, 'EDITADO', v_status, v_campo, v_antes, v_depois, v_uid, v_nome);
  EXCEPTION WHEN others THEN
    NULL;  -- auditoria nunca impede a operação
  END;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

DROP TRIGGER IF EXISTS trg_sup_pedido_item_log_edicao ON public.sup_pedido_item;
CREATE TRIGGER trg_sup_pedido_item_log_edicao
  AFTER INSERT OR UPDATE OR DELETE ON public.sup_pedido_item
  FOR EACH ROW EXECUTE FUNCTION public.sup_pedido_item_registrar_edicao();

-- ── 5. O catálogo precisa enxergar o operador de Supply ──────────────
--
-- sup_ext_itens() (a lista de materiais liberados para a função) passa por
-- sup_ext_pode_ver_contrato(), que só conhecia dois perfis: o encarregado
-- externo com sessão viva e o interno com o menu de SOLICITAR materiais.
-- Quem opera a fila de Pedidos de Materiais não tem, necessariamente, o
-- menu de solicitação — sem este ramo, o modal de edição abriria com o
-- seletor de "adicionar item" vazio e um erro de permissão no console.
CREATE OR REPLACE FUNCTION public.sup_ext_pode_ver_contrato(p_contrato_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_contrato_id IS NULL THEN RETURN false; END IF;

  -- Externo: exatamente o contrato que ele escolheu ao entrar.
  IF EXISTS (
    SELECT 1 FROM public.sup_ext_sessao s
     WHERE s.user_id = v_uid AND s.contrato_id = p_contrato_id
  ) THEN
    RETURN true;
  END IF;

  -- Interno: precisa da tela (solicitar OU editar a fila) E do contrato
  -- estar numa empresa dele.
  RETURN (
       public.can_access(v_uid, 'encarregados_solicitar_materiais', 'visualizar')
    OR public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar')
  ) AND EXISTS (
       SELECT 1 FROM public.contratos c
         JOIN public.user_empresa ue ON ue.empresa_id = c.empresa_id
        WHERE c.id = p_contrato_id AND ue.user_id = v_uid
     );
END $$;

-- ── 6. RPC de edição ─────────────────────────────────────────────────
--
-- Payload:
--   {
--     "colaborador_empregado_id": 1234 | null,
--     "nome_colaborador": "...",        -- só vale quando admissao = true
--     "admissao": bool,
--     "tipo_admissao": "substituicao" | "aditivo" | null,
--     "data_admissao": "AAAA-MM-DD" | null,
--     "tipo_pedido": "uniforme" | "insumos" | "ambos",
--     "observacoes_solicitante": "..." | null,
--     "observacao": "..." | null,       -- comentário de Compras
--     "itens": [ { "id": uuid|null, "item_id": uuid,
--                  "tamanho": "...", "quantidade": 2, "litros": "..." } ]
--   }
--
-- `itens` ausente = "não mexi nos itens". `itens: []` seria apagar todos, e
-- por isso é recusado — pedido sem item não existe (mesma regra da criação).
--
-- Quem manda no nome e na matrícula do colaborador é o SERVIDOR, lendo
-- EMPREGADOS a partir do id escolhido. O que vier nesses campos de texto é
-- ignorado, exatamente como em sup_ext_criar_pedido() — é o que impede
-- inventar colaborador por payload.
CREATE OR REPLACE FUNCTION public.sup_pedido_editar(
  p_pedido_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_nome_op  text := coalesce(public.sup_est_nome_usuario(), 'sistema');
  v_ped      record;
  v_travado  boolean;
  v_mexe_it  boolean := (p_payload ? 'itens');
  v_itens    jsonb   := coalesce(p_payload->'itens', '[]'::jsonb);
  v_admissao boolean;
  v_tipo     text;
  v_colab_id bigint;
  v_col_nome text;
  v_col_matr text;
  v_digitado boolean := false;
  v_obs_nova text;
  v_ids      uuid[];
  it         jsonb;
  v_idx      int := 0;
  v_alvo     record;
  v_tags     text;
  v_add      int := 0;
  v_upd      int := 0;
  v_del      int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar pedidos' USING ERRCODE = '42501';
  END IF;

  -- Mesmo lock de sup_est_baixar: dois operadores no mesmo pedido serializam
  -- aqui, em vez de um sobrescrever o outro.
  SELECT * INTO v_ped FROM public.sup_pedido p WHERE p.id = p_pedido_id FOR UPDATE;
  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;

  v_travado := v_ped.status IN ('DESPACHADO', 'CANCELADO');

  -- ── Cabeçalho ──────────────────────────────────────────────────────
  IF v_travado THEN
    -- Só as observações. Nada de colaborador, tipo ou itens: a peça já saiu
    -- (DESPACHADO) ou o pedido morreu (CANCELADO).
    IF v_mexe_it THEN
      RAISE EXCEPTION 'Pedido % está % — os itens não podem mais ser alterados',
        v_ped.pedido_id, v_ped.status;
    END IF;

    UPDATE public.sup_pedido p
       SET observacoes_solicitante = nullif(btrim(coalesce(
             p_payload->>'observacoes_solicitante', p.observacoes_solicitante)), '')
     WHERE p.id = p_pedido_id;

  ELSE
    -- Chave ausente no payload = "não mexi nisso". Vale para todo o
    -- cabeçalho: a tela manda o formulário inteiro, mas uma edição parcial
    -- (via RPC, num script) não pode apagar o que não citou.
    v_admissao := coalesce((p_payload->>'admissao')::boolean, v_ped.admissao);
    v_tipo     := coalesce(nullif(p_payload->>'tipo_pedido', ''), v_ped.tipo_pedido);

    IF p_payload ? 'colaborador_empregado_id' THEN
      v_colab_id := nullif(p_payload->>'colaborador_empregado_id', '')::bigint;
    ELSE
      v_colab_id := v_ped.colaborador_empregado_id;
    END IF;

    IF v_colab_id IS DISTINCT FROM v_ped.colaborador_empregado_id AND v_colab_id IS NOT NULL THEN
      -- Trocou de pessoa: nome e matrícula vêm do cadastro, nunca do que o
      -- cliente mandou. É o que impede inventar colaborador por payload.
      SELECT e."Nome", nullif(btrim(e."Cadastro"::text), '')
        INTO v_col_nome, v_col_matr
        FROM public."EMPREGADOS" e
       WHERE e."ID" = v_colab_id AND e."Situação" <> 'Demitido';
      IF v_col_nome IS NULL THEN
        RAISE EXCEPTION 'Colaborador não encontrado ou desligado';
      END IF;

    ELSIF v_colab_id IS NOT NULL THEN
      -- Mesma pessoa de sempre: preserva o snapshot já gravado. Não relê
      -- EMPREGADOS de propósito — se ela foi desligada depois do pedido,
      -- reler travaria até a correção de uma vírgula na observação, e o
      -- pedido é registro histórico, não espelho do cadastro.
      v_col_nome := v_ped.nome_colaborador;
      v_col_matr := v_ped.matricula_colaborador;
      v_digitado := v_ped.colaborador_digitado;

    ELSIF v_admissao THEN
      -- Admissão é a única porta para texto livre: a pessoa ainda não está
      -- na folha, então não há o que escolher numa lista.
      v_col_nome := coalesce(nullif(btrim(p_payload->>'nome_colaborador'), ''),
                             nullif(v_ped.nome_colaborador, ''));
      v_digitado := true;
      IF v_col_nome IS NULL THEN
        RAISE EXCEPTION 'Informe o nome do novo colaborador';
      END IF;

    ELSIF nullif(btrim(v_ped.nome_colaborador), '') IS NOT NULL THEN
      -- Pedido anterior ao vínculo com EMPREGADOS (antes de 30/08/2026):
      -- tem nome gravado e nenhum id. Preserva o que está lá. Exigir a
      -- escolha na lista aqui travaria até a correção de uma observação num
      -- pedido antigo — e o nome que vale continua sendo o que foi pedido.
      v_col_nome := v_ped.nome_colaborador;
      v_col_matr := v_ped.matricula_colaborador;
      v_digitado := v_ped.colaborador_digitado;

    ELSIF v_tipo <> 'insumos' THEN
      RAISE EXCEPTION 'Escolha o colaborador na lista, ou marque "É admissão"';
    ELSE
      v_col_nome := '';  -- pedido só de insumos não tem colaborador
    END IF;

    UPDATE public.sup_pedido p
       SET nome_colaborador         = coalesce(v_col_nome, ''),
           matricula_colaborador    = v_col_matr,
           colaborador_empregado_id = v_colab_id,
           colaborador_digitado     = v_digitado,
           admissao                 = v_admissao,
           -- Deixar de ser admissão limpa os dois campos: manter data de
           -- admissão num pedido que não é mais admissão é lixo que depois
           -- aparece no Excel.
           tipo_admissao            = CASE WHEN v_admissao THEN
                                        coalesce(nullif(p_payload->>'tipo_admissao', ''),
                                                 v_ped.tipo_admissao) END,
           data_admissao            = CASE WHEN v_admissao THEN
                                        coalesce(nullif(p_payload->>'data_admissao', '')::date,
                                                 v_ped.data_admissao) END,
           tipo_pedido              = v_tipo,
           observacoes_solicitante  = nullif(btrim(coalesce(
             p_payload->>'observacoes_solicitante', p.observacoes_solicitante)), '')
     WHERE p.id = p_pedido_id;
  END IF;

  -- ── Comentário de Compras ──────────────────────────────────────────
  -- Fora do trigger de propósito (ver seção 3): este evento já tem forma
  -- própria na linha do tempo, gravada por sup_est_baixar() quando a
  -- alteração vem pelo modal de Status. Aqui a forma é a mesma.
  IF p_payload ? 'observacao' THEN
    v_obs_nova := nullif(btrim(p_payload->>'observacao'), '');
    IF v_obs_nova IS DISTINCT FROM v_ped.observacao THEN
      UPDATE public.sup_pedido p SET observacao = v_obs_nova WHERE p.id = p_pedido_id;
      INSERT INTO public.sup_pedido_historico
        (pedido_id, acao, status_novo, observacao, alterado_por, alterado_por_nome)
      VALUES (p_pedido_id, 'EDITADO', v_ped.status, v_obs_nova, v_uid, v_nome_op);
    END IF;
  END IF;

  -- ── Itens ──────────────────────────────────────────────────────────
  IF v_mexe_it THEN
    IF jsonb_array_length(v_itens) = 0 THEN
      RAISE EXCEPTION 'O pedido precisa ter ao menos um item';
    END IF;

    -- Ids que sobrevivem a esta edição.
    SELECT array_agg((e->>'id')::uuid)
      INTO v_ids
      FROM jsonb_array_elements(v_itens) e
     WHERE nullif(e->>'id', '') IS NOT NULL;
    v_ids := coalesce(v_ids, ARRAY[]::uuid[]);

    -- REMOÇÕES. Item com etiqueta consumida é intocável: a peça saiu do
    -- estoque de verdade e apagar a linha apagaria a trilha dela. Para
    -- devolver, existe Estoque & Etiquetas → Devolução.
    FOR v_alvo IN
      SELECT pi.id, pi.nome_item, pi.tamanho, pi.litros, pi.quantidade
        FROM public.sup_pedido_item pi
       WHERE pi.pedido_id = p_pedido_id AND NOT (pi.id = ANY (v_ids))
    LOOP
      SELECT string_agg(t.codigo, ', ') INTO v_tags
        FROM public.sup_est_tags_do_pedido(p_pedido_id) t
       WHERE t.pedido_item_id = v_alvo.id;
      IF v_tags IS NOT NULL THEN
        RAISE EXCEPTION
          'Não dá para remover "%": a peça já saiu do estoque com a(s) etiqueta(s) %. Use Estoque & Etiquetas → Devolução antes.',
          v_alvo.nome_item, v_tags;
      END IF;
      DELETE FROM public.sup_pedido_item pi WHERE pi.id = v_alvo.id;
      v_del := v_del + 1;
    END LOOP;

    -- ALTERAÇÕES e INCLUSÕES, na ordem em que vieram (é ela que vira `ordem`).
    FOR it IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
      v_idx := v_idx + 1;

      IF nullif(it->>'id', '') IS NOT NULL THEN
        SELECT pi.id, pi.nome_item, pi.tamanho, pi.litros, pi.quantidade
          INTO v_alvo
          FROM public.sup_pedido_item pi
         WHERE pi.id = (it->>'id')::uuid AND pi.pedido_id = p_pedido_id;
        IF v_alvo.id IS NULL THEN
          RAISE EXCEPTION 'Item não pertence a este pedido';
        END IF;

        -- Só confere etiqueta se algo realmente mudou — reordenar não é mexer.
        IF (v_alvo.tamanho, v_alvo.litros, v_alvo.quantidade)
           IS DISTINCT FROM
           (nullif(it->>'tamanho', ''), nullif(it->>'litros', ''),
            greatest(coalesce((it->>'quantidade')::int, 1), 1))
        THEN
          SELECT string_agg(t.codigo, ', ') INTO v_tags
            FROM public.sup_est_tags_do_pedido(p_pedido_id) t
           WHERE t.pedido_item_id = v_alvo.id;
          IF v_tags IS NOT NULL THEN
            RAISE EXCEPTION
              'Não dá para alterar "%": a peça já saiu do estoque com a(s) etiqueta(s) %.',
              v_alvo.nome_item, v_tags;
          END IF;
          v_upd := v_upd + 1;
        END IF;

        UPDATE public.sup_pedido_item pi
           SET tamanho    = nullif(it->>'tamanho', ''),
               litros     = nullif(it->>'litros', ''),
               quantidade = greatest(coalesce((it->>'quantidade')::int, 1), 1),
               ordem      = v_idx
         WHERE pi.id = v_alvo.id;

      ELSE
        -- Item novo: mesma validação da criação — precisa estar liberado
        -- para a FUNÇÃO do pedido, senão qualquer material do catálogo
        -- entraria por payload.
        IF NOT EXISTS (
          SELECT 1 FROM public.sup_funcao_item fi
           WHERE fi.funcao_id = v_ped.funcao_id
             AND fi.item_id   = (it->>'item_id')::uuid
             AND fi.aprovado AND fi.ativo
        ) THEN
          RAISE EXCEPTION 'Item % não pertence à função deste pedido',
            coalesce(it->>'nome_item', it->>'item_id');
        END IF;

        INSERT INTO public.sup_pedido_item
          (pedido_id, item_id, nome_item, tipo_item, tamanho, quantidade, litros, ordem)
        SELECT p_pedido_id, i.id, i.nome, i.tipo,
               nullif(it->>'tamanho', ''),
               greatest(coalesce((it->>'quantidade')::int, 1), 1),
               nullif(it->>'litros', ''),
               v_idx
          FROM public.sup_item i
         WHERE i.id = (it->>'item_id')::uuid;
        v_add := v_add + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'pedido_id',  v_ped.pedido_id,
    'travado',    v_travado,
    'itens_incluidos', v_add,
    'itens_alterados', v_upd,
    'itens_removidos', v_del
  );
END $$;

-- ── 7. Grants ────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.sup_pedido_editar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_pedido_editar(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.sup_pedido_item_descr(text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_pedido_item_descr(text, text, text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_sup_pedido_item_log_edicao ON public.sup_pedido_item;
--   DROP TRIGGER IF EXISTS trg_sup_pedido_log_edicao      ON public.sup_pedido;
--   DROP FUNCTION IF EXISTS public.sup_pedido_item_registrar_edicao();
--   DROP FUNCTION IF EXISTS public.sup_pedido_registrar_edicao();
--   DROP FUNCTION IF EXISTS public.sup_pedido_editar(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.sup_pedido_item_descr(text, text, text, integer);
--   ALTER TABLE public.sup_pedido_historico
--     DROP COLUMN IF EXISTS campo,
--     DROP COLUMN IF EXISTS valor_anterior,
--     DROP COLUMN IF EXISTS valor_novo;
--   -- e recriar sup_ext_pode_ver_contrato() como está em 20260819000003
-- =====================================================================
