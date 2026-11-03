-- SIS-2026-0753 — Painel e IA distinguem físico, reservado e disponível
--
-- O estoque operacional mostra o físico da prateleira e o disponível para
-- novos pedidos. O planejamento usava corretamente o disponível, mas chamá-lo
-- de "em casa" induzia comparação errada com o físico. Expor os três na mesma
-- resposta deixa o dashboard e a IA auditáveis pela view canônica
-- `sup_estoque_saldo`.
--
-- ROLLBACK:
--   Recriar a definição anterior de sup_estoque_saudavel sem a chave `fisico`.

DO $migration$
DECLARE
  v_def text;
  v_trecho text := '''disponivel'', disponivel, ''reservado'', reservado,';
  v_substituto text := '''disponivel'', disponivel, ''reservado'', reservado, ''fisico'', fisico,';
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid,integer)'::regprocedure
  ) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Função sup_estoque_saudavel não encontrada.';
  END IF;

  IF position(v_substituto IN v_def) > 0 THEN
    RAISE NOTICE 'sup_estoque_saudavel já expõe o saldo físico; nada a fazer.';
  ELSIF position(v_trecho IN v_def) = 0 THEN
    RAISE EXCEPTION 'Trecho do saldo não encontrado em sup_estoque_saudavel; migration interrompida para não publicar definição parcial.';
  ELSE
    EXECUTE replace(v_def, v_trecho, v_substituto);
  END IF;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
