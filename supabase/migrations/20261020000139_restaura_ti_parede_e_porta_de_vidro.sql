-- =====================================================================
-- RESTAURAÇÃO DO MÓDULO T.I (20/10/2026) — cópia FIEL da migration
-- 20260930000072.sql da branch local `ti`.
--
-- Pedido do Pablo: "restaura TUDO da branch ti". O Mapa 3D tinha saído da
-- pablo em 10/09/2026 (revert 7cb8e295) e o banco foi limpo pelas migs
-- 20260930000084 (módulo desligado) e 20260930000088 (tabelas TI_* apagadas).
-- As originais já constam como aplicadas no aplicador do cluster, por isso
-- voltam com número novo, na MESMA ordem: 0130 (= 060) … 0140 (= 074);
-- 0141 religa o módulo e os menus; 0142 devolve os dados do backup.
-- O corpo abaixo não foi alterado.
-- =====================================================================

-- =====================================================================
-- T.I › Construir o mapa — parede de vidro e porta de vidro de correr
--
-- Divisória de vidro é o que mais aparece em escritório novo, e até aqui a
-- planta só sabia desenhar parede cega: quem queria representar a sala de
-- reunião envidraçada usava "janela" deitada, que nasce com 120 cm de altura
-- e não fecha o ambiente.
--
-- São dois tipos, e não um só, porque servem a gestos diferentes: a PAREDE de
-- vidro se desenha arrastando do começo ao fim do pano, e a PORTA de correr
-- se põe com um clique dentro dele.
--
-- O `tipo` é fechado por CHECK, então tipo novo no catálogo do React sem esta
-- migration aplicada = INSERT recusado pelo banco na hora de criar a peça.
-- =====================================================================

ALTER TABLE public."TI_PLANTA_ELEMENTO" DROP CONSTRAINT IF EXISTS "TI_PLANTA_ELEMENTO_tipo_check";
ALTER TABLE public."TI_PLANTA_ELEMENTO" ADD CONSTRAINT "TI_PLANTA_ELEMENTO_tipo_check" CHECK (tipo IN (
  -- estrutura
  'parede', 'divisoria', 'porta', 'janela', 'escada',
  'parede_vidro', 'porta_vidro',
  -- ambientes (manchas de piso)
  'sala', 'recepcao', 'copa', 'banheiro', 'impressora_area',
  -- mobília
  'mesa', 'mesa_l', 'mesa_reuniao', 'bancada', 'cadeira', 'poltrona', 'sofa',
  'armario', 'gaveteiro', 'estante', 'rack', 'quadro_branco',
  'geladeira', 'bebedouro', 'planta_decorativa',
  -- anotação
  'texto'
));

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
-- Nenhuma linha existente pode ter ficado fora da lista nova.
SELECT tipo, count(*) FROM public."TI_PLANTA_ELEMENTO" GROUP BY tipo ORDER BY 1;

-- =====================================================================
-- ROLLBACK
--   Só depois de apagar as peças de vidro que já existirem, senão o
--   CHECK antigo não entra:
--
--   DELETE FROM public."TI_PLANTA_ELEMENTO" WHERE tipo IN ('parede_vidro', 'porta_vidro');
--   ALTER TABLE public."TI_PLANTA_ELEMENTO" DROP CONSTRAINT IF EXISTS "TI_PLANTA_ELEMENTO_tipo_check";
--   ALTER TABLE public."TI_PLANTA_ELEMENTO" ADD CONSTRAINT "TI_PLANTA_ELEMENTO_tipo_check" CHECK (tipo IN (
--     'parede', 'divisoria', 'porta', 'janela', 'escada',
--     'sala', 'recepcao', 'copa', 'banheiro', 'impressora_area',
--     'mesa', 'mesa_l', 'mesa_reuniao', 'bancada', 'cadeira', 'poltrona', 'sofa',
--     'armario', 'gaveteiro', 'estante', 'rack', 'quadro_branco',
--     'geladeira', 'bebedouro', 'planta_decorativa',
--     'texto'
--   ));
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
