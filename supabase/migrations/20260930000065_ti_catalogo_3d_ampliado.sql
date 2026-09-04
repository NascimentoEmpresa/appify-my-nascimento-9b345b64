-- =====================================================================
-- T.I — mais objetos no mapa 3D.
--
-- O catálogo nasceu com o essencial (computador, monitor, impressora, rede) e
-- o escritório de verdade tem mais coisa em cima da mesa: teclado, mouse,
-- headset, webcam, dock. E a planta precisa de mais móveis para parecer o
-- andar real — mesa em L, mesa de reunião, gaveteiro, estante, quadro branco,
-- geladeira e bebedouro da copa, poltrona da recepção.
--
-- POR QUE ISTO É UMA MIGRATION, E NÃO SÓ FRONT
--   Os dois `tipo` são cobrados por CHECK. Acrescentar o tipo apenas no
--   catálogo do React faz a tela oferecer "Teclado" e o PostgREST devolver 400
--   ao salvar — a lista do banco e a do front são a MESMA lista escrita duas
--   vezes, e existe um teste (`src/test/ti-mapa-catalogo.test.ts`) que compara
--   as duas justamente para isso não passar batido.
--
--   Os CHECK são recriados por inteiro (não dá para "adicionar valor" a um
--   CHECK de lista): DROP + ADD com a lista completa, que é o padrão daqui.
--   Nenhum valor antigo saiu — só entraram novos —, então nenhuma linha
--   existente é invalidada.
--
-- Idempotente. ROLLBACK no fim.
-- =====================================================================

-- 1) Equipamentos --------------------------------------------------------
ALTER TABLE public."TI_ATIVO" DROP CONSTRAINT IF EXISTS "TI_ATIVO_tipo_check";
ALTER TABLE public."TI_ATIVO" ADD CONSTRAINT "TI_ATIVO_tipo_check" CHECK (tipo IN (
  -- computadores
  'desktop', 'notebook', 'servidor', 'storage',
  -- tela e imagem
  'monitor', 'tv', 'projetor', 'webcam',
  -- periféricos de mesa (os que faltavam)
  'teclado', 'mouse', 'headset', 'dock', 'periferico',
  -- impressão
  'impressora', 'scanner',
  -- rede
  'switch', 'roteador', 'access_point', 'firewall', 'rack', 'camera',
  -- energia
  'nobreak', 'estabilizador',
  -- telefonia e móveis
  'telefone_ip', 'celular', 'tablet',
  'outro'
));

-- 2) Peças da planta -----------------------------------------------------
ALTER TABLE public."TI_PLANTA_ELEMENTO" DROP CONSTRAINT IF EXISTS "TI_PLANTA_ELEMENTO_tipo_check";
ALTER TABLE public."TI_PLANTA_ELEMENTO" ADD CONSTRAINT "TI_PLANTA_ELEMENTO_tipo_check" CHECK (tipo IN (
  -- estrutura
  'parede', 'divisoria', 'porta', 'janela', 'escada',
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
SELECT 'TI_ATIVO' AS tabela, tipo, count(*) FROM public."TI_ATIVO" GROUP BY tipo
UNION ALL
SELECT 'TI_PLANTA_ELEMENTO', tipo, count(*) FROM public."TI_PLANTA_ELEMENTO" GROUP BY tipo
ORDER BY 1, 2;

-- =====================================================================
-- ROLLBACK
--   Reexecutar os dois CHECK da 20260930000060_ti_mapa_hardware.sql — mas só
--   depois de conferir que nenhuma linha usa os tipos novos, senão o ADD
--   CONSTRAINT falha com as linhas já gravadas.
-- =====================================================================
