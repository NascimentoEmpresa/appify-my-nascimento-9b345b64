-- =====================================================================
-- SIS-2026-0199 — custo do item no estoque e histórico de preços
--
-- "Quando a gente pesquisa o produto, aparece o estoque, o mínimo... mas não
--  aparece o custo do produto, quanto custa ali o produto."
--
-- O custo que ele quer é o ÚLTIMO VALOR PAGO, não média: "o último custo, o
-- último valor pago, porque daí é o valor atualizado". Esse dado JÁ EXISTE em
-- sup_estoque_item.valor_unitario e já é capturado na entrada de estoque —
-- só nunca foi mostrado de volta. A parte visual é frontend.
--
-- O que falta no banco é o HISTÓRICO. Hoje o valor é sobrescrito a cada
-- entrada (ver o ON CONFLICT de sup_est_entrada, 20260820000002:78) e o preço
-- anterior se perde. Sem ele não dá para responder as outras duas coisas que
-- ele pediu:
--
--   1. "histórico de valores das cotações" — o que já se pagou por aquele item;
--   2. "a própria licitação poderia pesquisar: quanto custa hoje a nossa
--      camiseta mescla" — sem depender do comprador estar disponível.
--
-- E a validade do preço, que é regra de negociação: "quanto tempo tu consegue
-- segurar essa cotação para mim? Seis meses, três meses. O tio Clay pode
-- definir isso quando cadastrar."
--
-- POR QUE TRIGGER, E NÃO MEXER NA RPC DE ENTRADA: sup_est_entrada é o caminho
-- crítico do almoxarifado (bipagem, reciclagem de etiqueta, sucesso parcial).
-- Um trigger em sup_estoque_item registra o preço sozinho, sem tocar nesse
-- código e sem risco de alguma outra escrita futura esquecer de registrar.
--
-- Idempotente.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_sup_item_preco_registra ON public.sup_estoque_item;
--   DROP FUNCTION IF EXISTS public.sup_item_preco_registra();
--   DROP FUNCTION IF EXISTS public.sup_item_precos(uuid);
--   DROP FUNCTION IF EXISTS public.sup_precos_consulta(text);
--   DROP FUNCTION IF EXISTS public.sup_est_validade_preco(uuid, uuid, date);
--   DROP TABLE IF EXISTS public.sup_item_preco CASCADE;
--   ALTER TABLE public.sup_estoque_item DROP COLUMN IF EXISTS preco_valido_ate;
--   DELETE FROM public.app_menu WHERE codigo = 'sup_precos_consulta';
-- =====================================================================

-- ── 1) Validade do preço atual ───────────────────────────────────────
--
-- Fica no item de estoque porque é uma propriedade do preço vigente. O
-- histórico guarda a sua própria cópia, para uma consulta antiga continuar
-- dizendo até quando aquele preço valia.
ALTER TABLE public.sup_estoque_item
  ADD COLUMN IF NOT EXISTS preco_valido_ate date;

COMMENT ON COLUMN public.sup_estoque_item.preco_valido_ate IS
  'Até quando o fornecedor segura este preço. Negociado na cotação. SIS-2026-0199.';

-- ── 2) Histórico de preços ───────────────────────────────────────────
--
-- Uma linha por vez em que o preço daquele material MUDOU. Não é log de
-- entrada: reentrada pelo mesmo valor não gera linha nova, senão o histórico
-- vira ruído e a pergunta "quanto já se pagou por isso" fica ilegível.
CREATE TABLE IF NOT EXISTS public.sup_item_preco (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  sup_item_id     uuid NOT NULL REFERENCES public.sup_item(id) ON DELETE CASCADE,
  item_estoque_id uuid REFERENCES public.sup_estoque_item(id) ON DELETE SET NULL,
  almoxarifado_id uuid REFERENCES public.almoxarifado(id) ON DELETE SET NULL,

  valor_unitario  numeric(12,2) NOT NULL,
  valor_anterior  numeric(12,2),
  valido_ate      date,

  -- De onde veio o preço. Hoje só 'entrada'; a entrada de NF do SIS-2026-0207
  -- passa a gravar 'nf' com a chave da nota.
  origem          text NOT NULL DEFAULT 'entrada'
                    CHECK (origem IN ('entrada','nf','ajuste')),
  fornecedor_id   uuid REFERENCES public.fornecedor(id) ON DELETE SET NULL,
  fornecedor_nome text,
  documento       text,

  registrado_em   timestamptz NOT NULL DEFAULT now(),
  registrado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  registrado_por_nome text
);
CREATE INDEX IF NOT EXISTS idx_sup_item_preco_item
  ON public.sup_item_preco(sup_item_id, registrado_em DESC);
CREATE INDEX IF NOT EXISTS idx_sup_item_preco_empresa
  ON public.sup_item_preco(empresa_id, registrado_em DESC);

-- ── 3) O trigger que alimenta o histórico ────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_item_preco_registra()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_anterior numeric(12,2);
  v_forn     text;
BEGIN
  -- Preço zero é "não informado", não é preço. A entrada deixa em branco
  -- quando o operador não sabe o valor, e registrar isso apagaria a memória
  -- do último valor pago de verdade.
  IF COALESCE(NEW.valor_unitario, 0) = 0 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_anterior := OLD.valor_unitario;
    -- Nada mudou no preço nem na validade: não gera linha.
    IF COALESCE(OLD.valor_unitario, 0) = NEW.valor_unitario
       AND COALESCE(OLD.preco_valido_ate, '1900-01-01'::date)
         = COALESCE(NEW.preco_valido_ate, '1900-01-01'::date) THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT f.razao_social INTO v_forn
    FROM public.fornecedor f WHERE f.id = NEW.fornecedor_id;

  INSERT INTO public.sup_item_preco (
    empresa_id, sup_item_id, item_estoque_id, almoxarifado_id,
    valor_unitario, valor_anterior, valido_ate,
    origem, fornecedor_id, fornecedor_nome,
    registrado_por, registrado_por_nome
  ) VALUES (
    NEW.empresa_id, NEW.sup_item_id, NEW.id, NEW.almoxarifado_id,
    NEW.valor_unitario, NULLIF(v_anterior, 0), NEW.preco_valido_ate,
    'entrada', NEW.fornecedor_id, COALESCE(v_forn, NEW.fornecedor),
    auth.uid(), public.sup_est_nome_usuario()
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sup_item_preco_registra ON public.sup_estoque_item;
CREATE TRIGGER trg_sup_item_preco_registra
  AFTER INSERT OR UPDATE OF valor_unitario, preco_valido_ate
  ON public.sup_estoque_item
  FOR EACH ROW EXECUTE FUNCTION public.sup_item_preco_registra();

-- ── 4) Semente: o preço que já está lá ───────────────────────────────
--
-- Sem isso o histórico nasce vazio e a tela diria "nunca comprado" para
-- material que tem preço cadastrado. Uma linha por item de estoque com valor,
-- marcada como 'ajuste' para não se confundir com entrada real.
INSERT INTO public.sup_item_preco (
  empresa_id, sup_item_id, item_estoque_id, almoxarifado_id,
  valor_unitario, origem, fornecedor_id, fornecedor_nome, registrado_em
)
SELECT ei.empresa_id, ei.sup_item_id, ei.id, ei.almoxarifado_id,
       ei.valor_unitario, 'ajuste', ei.fornecedor_id,
       COALESCE(f.razao_social, ei.fornecedor), ei.created_at
  FROM public.sup_estoque_item ei
  LEFT JOIN public.fornecedor f ON f.id = ei.fornecedor_id
 WHERE COALESCE(ei.valor_unitario, 0) > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.sup_item_preco p WHERE p.item_estoque_id = ei.id
   );

-- ── 5) RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.sup_item_preco ENABLE ROW LEVEL SECURITY;

-- Quem vê estoque vê o preço; quem consulta preços para a Licitação também,
-- e só isso — a tela de consulta é somente leitura.
DROP POLICY IF EXISTS sup_item_preco_select ON public.sup_item_preco;
CREATE POLICY sup_item_preco_select ON public.sup_item_preco
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_precos_consulta', 'visualizar')
  );

-- Nenhuma policy de INSERT/UPDATE/DELETE, de propósito: com RLS ligada e sem
-- policy, `authenticated` não escreve nem apaga. Quem grava é só o trigger,
-- que é SECURITY DEFINER. É o que garante o "histórico não deverá ser apagado"
-- do próprio documento de diretrizes.

-- ── 6) Definir a validade do preço ───────────────────────────────────
--
-- RPC pequena e separada, chamada logo depois da entrada, em vez de acrescentar
-- o campo em sup_est_entrada: aquela RPC é o caminho crítico do almoxarifado
-- (bipagem, reciclagem de etiqueta, sucesso parcial) e não vale reescrevê-la
-- inteira por causa de um campo opcional.
--
-- O UPDATE dispara o trigger do histórico, então mudar só a validade também
-- vira linha — é informação de negociação e o comprador precisa saber quando
-- ela mudou.
CREATE OR REPLACE FUNCTION public.sup_est_validade_preco(
  p_almoxarifado_id uuid, p_sup_item_id uuid, p_valido_ate date
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_estoque', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o estoque';
  END IF;

  UPDATE public.sup_estoque_item
     SET preco_valido_ate = p_valido_ate
   WHERE almoxarifado_id = p_almoxarifado_id
     AND sup_item_id     = p_sup_item_id;
END $$;

REVOKE ALL ON FUNCTION public.sup_est_validade_preco(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_est_validade_preco(uuid, uuid, date) TO authenticated;

-- ── 7) Histórico de um material ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_item_precos(p_sup_item_id uuid)
RETURNS TABLE (
  valor_unitario numeric, valor_anterior numeric, valido_ate date,
  origem text, fornecedor_nome text, documento text,
  registrado_em timestamptz, registrado_por_nome text, almoxarifado text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.valor_unitario, p.valor_anterior, p.valido_ate, p.origem,
         p.fornecedor_nome, p.documento, p.registrado_em, p.registrado_por_nome,
         a.nome
    FROM public.sup_item_preco p
    LEFT JOIN public.almoxarifado a ON a.id = p.almoxarifado_id
   WHERE p.sup_item_id = p_sup_item_id
     AND (public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
          OR public.can_access(auth.uid(), 'sup_precos_consulta', 'visualizar'))
   ORDER BY p.registrado_em DESC
   LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.sup_item_precos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_item_precos(uuid) TO authenticated;

-- ── 8) Consulta de preços para a Licitação ───────────────────────────
--
-- "Hoje o pessoal da licitação manda uma planilha para o tio Clay, ele faz as
--  cotações e devolve. Para o banco de dados que a gente tem, não precisaria:
--  a própria licitação poderia pesquisar."
--
-- Devolve o preço VIGENTE por material, com a validade — que é o que decide se
-- a Licitação pode usar aquele número ou precisa pedir cotação nova.
CREATE OR REPLACE FUNCTION public.sup_precos_consulta(p_busca text DEFAULT NULL)
RETURNS TABLE (
  sup_item_id uuid, material text, tipo text,
  valor_unitario numeric, valido_ate date, vencido boolean,
  fornecedor_nome text, atualizado_em timestamptz, almoxarifado text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ON (ei.sup_item_id)
         ei.sup_item_id, i.nome, i.tipo,
         ei.valor_unitario, ei.preco_valido_ate,
         (ei.preco_valido_ate IS NOT NULL AND ei.preco_valido_ate < CURRENT_DATE),
         COALESCE(f.razao_social, ei.fornecedor),
         ei.updated_at, a.nome
    FROM public.sup_estoque_item ei
    JOIN public.sup_item i ON i.id = ei.sup_item_id
    LEFT JOIN public.fornecedor f ON f.id = ei.fornecedor_id
    LEFT JOIN public.almoxarifado a ON a.id = ei.almoxarifado_id
   WHERE COALESCE(ei.valor_unitario, 0) > 0
     AND i.ativo
     AND (p_busca IS NULL OR btrim(p_busca) = ''
          OR i.nome ILIKE '%' || btrim(p_busca) || '%')
     AND (public.can_access(auth.uid(), 'sup_precos_consulta', 'visualizar')
          OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar'))
   -- Mesmo material em dois almoxarifados: vale o preço mais recente.
   ORDER BY ei.sup_item_id, ei.updated_at DESC
$$;

REVOKE ALL ON FUNCTION public.sup_precos_consulta(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_precos_consulta(text) TO authenticated;

-- ── 9) Menu da consulta ──────────────────────────────────────────────
--
-- Mora em Licitações porque é lá que a pessoa está quando precisa do número.
-- Menu próprio, ação `visualizar` apenas: a Licitação consulta, não edita —
-- "uma aba de consulta sem edição nenhuma, sem eles poderem alterar".
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_precos_consulta', 'Preços de Materiais',
       '/app/licitacoes/precos-materiais',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 10,
       true
  FROM public.app_modulo m
 WHERE m.codigo = 'licitacoes'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- Menu sem nenhuma regra é tratado como ABERTO para todo autenticado.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sup_precos_consulta', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── Conferência ──────────────────────────────────────────────────────
SELECT 'precos semeados' AS o_que, count(*) AS quantos FROM public.sup_item_preco;

NOTIFY pgrst, 'reload schema';
