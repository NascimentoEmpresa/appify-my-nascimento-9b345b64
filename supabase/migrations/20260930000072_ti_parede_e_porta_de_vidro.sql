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
