-- =========================================================================
-- SIS-2026-0481 — Uniforme exige tamanho (trava no banco)
--
-- PEDIDO DO CASSIO
-- "Quando o encarregado solicitar o pedido de EPI, bloquear quando faltar
--  informação complementar." O caso real: a encarregada pediu uma JAQUETA e não
--  informou o tamanho (pedido PED-20260916-0113), e o Supply ficou sem como
--  separar.
--
-- A CAUSA
-- No formulário, um item de uniforme SEM grade de tamanho cadastrada
-- (sup_item_opcao tipo 'tamanho') não mostrava campo nenhum e seguia sem
-- tamanho. O front já passou a exigir o tamanho (da grade, ou escrito quando
-- não há grade). Esta migration é a trava equivalente no banco — a última linha
-- de defesa, igual ao resto do módulo, que confere no banco o que a tela pede.
--
-- POR QUE UM TRIGGER, E NÃO uma guarda dentro de cada RPC
-- O item nasce por dois caminhos (sup_ext_criar_pedido, do encarregado/interno,
-- e sup_pedido_editar, do operador) e a admissão passa pelo primeiro
-- (sup_adm_criar_pedido -> sup_ext_criar_pedido). Um trigger na própria tabela
-- cobre os três de uma vez, sem recriar duas funções SECURITY DEFINER de ~240
-- linhas (onde seria fácil perder uma guarda). O invariante é simples e de
-- integridade — "uniforme tem tamanho" — não é regra derivada/calculada, que é
-- o tipo de lógica que o módulo evita duplicar em trigger.
--
-- ALCANCE (decisão do Eduardo em 06/10/2026)
-- Vale TAMBÉM para a admissão: um uniforme que chegar sem tamanho na geração do
-- pedido (sup_adm_criar_pedido -> INSERT) é recusado com a mesma mensagem, que
-- nomeia o item. Na prática a tela de admissão (enxovalCompleto em
-- src/lib/suprimentos/admissao.ts) já exige o tamanho de todo item, então isto
-- é um backstop, não um fluxo esperado — mas foi escolhido de propósito.
--
-- NÃO REVALIDA LINHA HISTÓRICA QUE NÃO MUDOU
-- A trava vale para INSERT (item novo, na criação/edição/admissão) e para o
-- UPDATE que de fato altera tamanho ou tipo. Um UPDATE que não mexeu nesses
-- campos — o caso do sup_pedido_editar, que reescreve a ordem de todo item
-- retido a cada save — não revalida a linha, então um pedido antigo com uniforme
-- sem tamanho (a JAQUETA do chamado) continua editável para corrigir, p.ex., a
-- observação. Cargas em massa com session_replication_role = replica ignoram o
-- trigger, como os demais gatilhos do módulo.
--
-- Idempotente.
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_sup_pedido_item_exige_tamanho ON public.sup_pedido_item;
--   DROP FUNCTION IF EXISTS public.sup_pedido_item_exige_tamanho();
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sup_pedido_item_exige_tamanho()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- "Reordenar não é mexer": sup_pedido_editar dá UPDATE em TODO item retido a
  -- cada save (só pra gravar a ordem), então um UPDATE que não mexeu no tamanho
  -- nem no tipo não pode revalidar a linha. É isso que mantém editável um
  -- pedido antigo que tem uniforme sem tamanho (a JAQUETA do chamado): corrigir
  -- a observação não exige preencher o tamanho de uma linha histórica. A trava
  -- vale para INSERT (item novo, criação/admissão) e para o UPDATE que de fato
  -- muda o tamanho ou o tipo do item.
  IF TG_OP = 'UPDATE'
     AND coalesce(btrim(NEW.tamanho), '') = coalesce(btrim(OLD.tamanho), '')
     AND NEW.tipo_item IS NOT DISTINCT FROM OLD.tipo_item THEN
    RETURN NEW;
  END IF;

  -- Todo uniforme exige tamanho — da grade ou escrito. Insumo/EPI fica livre:
  -- o que ele oferece (quantidade, litros) já é conferido por quem monta o item.
  IF NEW.tipo_item = 'uniforme'
     AND coalesce(btrim(NEW.tamanho), '') = '' THEN
    RAISE EXCEPTION 'Uniforme "%" exige o tamanho', NEW.nome_item
      USING ERRCODE = '23514';  -- check_violation
  END IF;
  RETURN NEW;
END $$;

-- Trigger/constraint nunca com CREATE OR REPLACE: DROP + CREATE para reexecutar.
DROP TRIGGER IF EXISTS trg_sup_pedido_item_exige_tamanho ON public.sup_pedido_item;
CREATE TRIGGER trg_sup_pedido_item_exige_tamanho
  BEFORE INSERT OR UPDATE ON public.sup_pedido_item
  FOR EACH ROW EXECUTE FUNCTION public.sup_pedido_item_exige_tamanho();

NOTIFY pgrst, 'reload schema';
