-- =========================================================================
-- Status oficial do CA bloqueia o uso do EPI
--
-- PEDIDO DO CASSIO (ajuste 8 e 9 da revisão de 27/08/2026)
-- Conferir o número do CA contra o site do Ministério e, se estiver Suspenso,
-- Cancelado ou Vencido, acusar no item e impedir que ele siga para o pedido de
-- materiais — com o motivo na tela.
--
-- POR QUE NÃO CONSULTAMOS O SITE
-- A ideia original era bater no `consultaCAInternet.aspx` a cada verificação.
-- Duas razões para não fazer isso:
--
--   1. O site recusa qualquer cliente que não seja navegador (403 medido em
--      26/08/2026, inclusive da própria máquina onde o Chrome funciona).
--   2. **Não precisa.** O arquivo que o Ministério publica — o mesmo que já
--      carregamos em `sst_ca_catalogo` — traz a coluna de situação com
--      exatamente os quatro valores do site. Medido nos 42.340 CAs de hoje:
--      14.879 VÁLIDO, 27.382 VENCIDO, 76 CANCELADO, 3 SUSPENSO.
--
-- Consultar a base local é mais rápido, funciona sem internet e não depende do
-- site estar de pé. O preço é a idade do catálogo, que a tela já mostra.
--
-- O QUE CADA STATUS SIGNIFICA (texto do próprio Ministério)
--   Expedido  → emissão, renovação ou alteração. É o CA em ordem.
--   Suspenso  → validade suspensa para apuração. Fabricação proibida.
--   Cancelado → fabricação e comercialização proibidas.
--   Vencido   → validade expirada. Fabricação e comercialização proibidas.
--
-- Idempotente.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sst_ca_bloqueio(text, date);
--   DROP TRIGGER IF EXISTS trg_sst_ca_guard_baixa ON public.sup_estoque_tag;
--   DROP FUNCTION IF EXISTS public.sst_ca_guard_baixa();
--   DROP FUNCTION IF EXISTS public.sst_ca_itens_bloqueados();
-- =========================================================================

-- ── 1) O veredito sobre um CA ────────────────────────────────────────────
--
-- Uma função só, usada pela tela, pela entrada de estoque e pelo pedido de
-- materiais. Três lugares decidindo o mesmo por conta própria divergiriam no
-- dia em que um deles mudasse.

CREATE OR REPLACE FUNCTION public.sst_ca_bloqueio(
  p_ca_numero text,
  p_validade_tag date DEFAULT NULL
)
RETURNS TABLE (
  bloqueado boolean,
  situacao  text,
  motivo    text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ca      text := regexp_replace(coalesce(p_ca_numero, ''), '\D', '', 'g');
  v_cat     record;
  v_situacao text;
BEGIN
  IF v_ca = '' THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_cat FROM public.sst_ca_catalogo WHERE ca_numero = v_ca;

  -- CA que não está no catálogo NÃO bloqueia.
  --
  -- Pode ser erro de digitação, mas também pode ser um CA novo, emitido depois
  -- da última carga do arquivo. Bloquear por ausência puniria o fornecedor por
  -- um atraso nosso — e o catálogo é atualizado à mão, então esse atraso é
  -- esperado. A tela avisa que não foi encontrado; a decisão fica com o SST.
  IF v_cat.ca_numero IS NULL THEN
    RETURN QUERY SELECT false, 'NAO_ENCONTRADO'::text,
      'CA não encontrado na base do Ministério — pode ser digitação errada ou CA mais novo que a última atualização da lista.'::text;
    RETURN;
  END IF;

  -- A situação do arquivo está congelada na data em que o governo o gerou.
  -- Um CA "VÁLIDO" cuja validade já passou é vencido de fato, e é o que vale.
  v_situacao := CASE
    WHEN v_cat.validade IS NOT NULL AND v_cat.validade < CURRENT_DATE THEN 'VENCIDO'
    ELSE upper(coalesce(v_cat.situacao, ''))
  END;

  IF v_situacao IN ('VENCIDO', 'CANCELADO', 'SUSPENSO') THEN
    RETURN QUERY SELECT true, v_situacao,
      format(
        'CA está com status %s, não pode ser administrado até o Setor de SST tomar ciência e ações sistemáticas nesse item.',
        initcap(lower(v_situacao))
      );
    RETURN;
  END IF;

  RETURN QUERY SELECT false, coalesce(nullif(v_situacao, ''), 'VÁLIDO')::text, NULL::text;
END;
$fn$;

-- ── 2) O que está bloqueado no estoque ───────────────────────────────────
-- Alimenta o painel: quais etiquetas de EPI não podem sair, e por quê.

CREATE OR REPLACE FUNCTION public.sst_ca_itens_bloqueados()
RETURNS TABLE (
  tag_id       uuid,
  codigo       text,
  sup_item_id  uuid,
  item         text,
  almoxarifado text,
  ca_numero    text,
  situacao     text,
  motivo       text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT t.id, t.codigo, ei.sup_item_id, i.nome, a.nome,
         t.ca_numero, b.situacao, b.motivo
    FROM public.sup_estoque_tag t
    JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
    JOIN public.sup_item i          ON i.id = ei.sup_item_id
    LEFT JOIN public.almoxarifado a ON a.id = ei.almoxarifado_id
   CROSS JOIN LATERAL public.sst_ca_bloqueio(t.ca_numero, t.ca_validade) b
   WHERE i.tipo = 'epi'
     AND NOT t.usado
     AND b.bloqueado;
$fn$;

-- ── 3) A trava de verdade, na saída do estoque ───────────────────────────
--
-- A tela avisar não basta: quem chama a RPC direto (ou uma tela futura)
-- passaria por cima. A regra tem que morar onde a etiqueta é entregue.
--
-- Um gatilho, e não uma alteração em `sup_est_baixar`.
--
-- `sup_est_baixar` tem ~140 linhas e trata etiqueta única, massa, reatribuição
-- e sucesso parcial. Reescrevê-la inteira para acrescentar seis linhas é o tipo
-- de mudança em que se perde um `CONTINUE` sem perceber — e ela é a função que
-- movimenta o estoque.
--
-- O gatilho pega o momento exato que importa: a etiqueta sendo vinculada a um
-- pedido. Vale para `sup_est_baixar` e para qualquer caminho futuro, o que uma
-- checagem dentro de uma RPC específica não daria.

CREATE OR REPLACE FUNCTION public.sst_ca_guard_baixa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_tipo text;
  v_bloq record;
BEGIN
  -- Só interessa a transição para "usado com pedido". Devolução, inventário e
  -- correção de dado não passam por aqui.
  IF NEW.pedido_id IS NULL OR NEW.pedido_id IS NOT DISTINCT FROM OLD.pedido_id THEN
    RETURN NEW;
  END IF;

  SELECT i.tipo INTO v_tipo
    FROM public.sup_estoque_item ei
    JOIN public.sup_item i ON i.id = ei.sup_item_id
   WHERE ei.id = NEW.item_estoque_id;

  IF coalesce(v_tipo, '') <> 'epi' THEN RETURN NEW; END IF;

  SELECT * INTO v_bloq FROM public.sst_ca_bloqueio(NEW.ca_numero, NEW.ca_validade);

  IF v_bloq.bloqueado THEN
    RAISE EXCEPTION 'Etiqueta %: %', NEW.codigo, v_bloq.motivo;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sst_ca_guard_baixa ON public.sup_estoque_tag;
CREATE TRIGGER trg_sst_ca_guard_baixa
  BEFORE UPDATE ON public.sup_estoque_tag
  FOR EACH ROW EXECUTE FUNCTION public.sst_ca_guard_baixa();

REVOKE ALL ON FUNCTION public.sst_ca_guard_baixa()          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sst_ca_bloqueio(text, date)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sst_ca_itens_bloqueados()     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ca_bloqueio(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sst_ca_itens_bloqueados()   TO authenticated;

NOTIFY pgrst, 'reload schema';
