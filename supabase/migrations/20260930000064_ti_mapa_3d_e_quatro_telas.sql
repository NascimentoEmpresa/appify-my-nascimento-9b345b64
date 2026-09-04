-- =====================================================================
-- T.I — o Mapa de Hardware vira 3D e se divide em QUATRO telas.
--
-- POR QUE MUDAR O QUE ACABOU DE NASCER
--   A primeira versão (20260930000060) pôs mapa, inventário e painel em três
--   abas da MESMA tela, com um único menu. Isso torna impossível a coisa mais
--   pedida: "deixar só o mapa para o pessoal ver onde ficam as pessoas e os
--   computadores". Aba não é unidade de permissão neste ERP — menu é. Com uma
--   tela só, liberar o mapa liberava junto o inventário (com valor de compra,
--   nota fiscal, número de série) e o painel gerencial.
--
--   Agora são quatro menus, quatro rotas, quatro cadeados independentes:
--     ti_mapa_hardware  → /app/ti/mapa        (SÓ VER: o passeio pelo escritório)
--     ti_construir      → /app/ti/construir   (o editor da planta)
--     ti_inventario     → /app/ti/inventario  (a lista, com dados de patrimônio)
--     ti_painel         → /app/ti/painel      (indicadores)
--
--   `ti_mapa_hardware` é REAPROVEITADO em vez de recriado: quem já recebeu
--   esse código continua com ele, e só muda a rota para onde aponta. Código de
--   menu é identificador interno — trocá-lo obrigaria a remigrar
--   screen_permission_user por nada.
--
-- A ARMADILHA QUE ESTA MIGRATION FECHA (J1 do REGRAS-PR, causa E/A)
--   As policies antigas cobravam `ti_mapa_hardware` no SELECT de TODAS as
--   tabelas. Com as telas separadas, liberar só o Inventário para alguém
--   abriria uma tela VAZIA, sem erro nenhum — o sintoma clássico daqui. Por
--   isso o SELECT passa a cobrar `ti_pode_ver()`: verdadeiro se a pessoa
--   alcança QUALQUER uma das quatro telas.
--
-- 3D — A DIMENSÃO QUE FALTAVA
--   O mapa era uma planta chapada: x, y, largura, altura (esta última é
--   PROFUNDIDADE, vista de cima). Faltava a altura vertical de verdade, e sem
--   ela não há parede, não há tampo de mesa e não há monitor em cima da mesa.
--     TI_PLANTA.pe_direito_cm     — altura das paredes do ambiente
--     TI_PLANTA_ELEMENTO.altura_z — altura do móvel/parede (NULL = catálogo)
--     TI_ATIVO.pos_z              — altura de apoio (NULL = o chão, ou o móvel
--                                   sob o equipamento, resolvido na tela)
--   Nada disso é obrigatório: planta antiga continua desenhando, com as
--   alturas padrão do catálogo do front.
--
-- Idempotente. ROLLBACK no fim.
-- =====================================================================

-- 1) As quatro telas -----------------------------------------------------
UPDATE public.app_menu
   SET nome = 'Mapa 3D do escritório', rota = '/app/ti/mapa', ordem = 10
 WHERE codigo = 'ti_mapa_hardware';

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM public.app_modulo m
 CROSS JOIN (VALUES
   ('ti_construir',  'Construir o mapa',        '/app/ti/construir',  11),
   ('ti_inventario', 'Inventário de hardware',  '/app/ti/inventario', 12),
   ('ti_painel',     'Painel de T.I',           '/app/ti/painel',     13)
 ) AS x(codigo, nome, rota, ordem)
 WHERE m.codigo = 'ti'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu a WHERE a.codigo = x.codigo)
;

-- 2) Colunas do 3D -------------------------------------------------------
ALTER TABLE public."TI_PLANTA"
  ADD COLUMN IF NOT EXISTS pe_direito_cm integer NOT NULL DEFAULT 280;

ALTER TABLE public."TI_PLANTA_ELEMENTO"
  ADD COLUMN IF NOT EXISTS altura_z numeric(10,2);

ALTER TABLE public."TI_ATIVO"
  ADD COLUMN IF NOT EXISTS pos_z numeric(10,2);

-- 3) Quem enxerga ---------------------------------------------------------
/**
 * Verdadeiro se a pessoa alcança QUALQUER tela de leitura do módulo.
 *
 * É o que impede a tela vazia: as quatro telas leem as mesmas tabelas, então
 * exigir o código de UMA delas (como era antes) faria o Inventário liberado
 * mostrar zero linhas para quem não tivesse também o Mapa.
 */
CREATE OR REPLACE FUNCTION public.ti_pode_ver()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.has_screen_access(auth.uid(), 'ti_mapa_hardware', 'visualizar', NULL)
      OR public.has_screen_access(auth.uid(), 'ti_construir',     'visualizar', NULL)
      OR public.has_screen_access(auth.uid(), 'ti_inventario',    'visualizar', NULL)
      OR public.has_screen_access(auth.uid(), 'ti_painel',        'visualizar', NULL);
$$;
REVOKE ALL ON FUNCTION public.ti_pode_ver() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ti_pode_ver() TO authenticated;

/**
 * Quem constrói. A TELA de construir (`ti_construir`) já autoriza construir —
 * é para isso que ela existe —, e `ti_mapa_editar` continua valendo como a
 * capacidade avulsa de quem tem o cadeado antigo.
 */
CREATE OR REPLACE FUNCTION public.ti_pode_construir(_acao public.app_acao)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.has_screen_access(auth.uid(), 'ti_construir',   _acao, NULL)
      OR public.has_screen_access(auth.uid(), 'ti_mapa_editar', _acao, NULL);
$$;
REVOKE ALL ON FUNCTION public.ti_pode_construir(public.app_acao) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ti_pode_construir(public.app_acao) TO authenticated;

-- 4) Policies ------------------------------------------------------------
-- SELECT: qualquer tela de leitura. ESCRITA de cenário: quem constrói.
-- Equipamento continua governado por `ti_ativo_gerenciar` — cadastrar máquina
-- é outra responsabilidade que desenhar parede, e quem edita a planta não
-- ganha de brinde o direito de mexer no patrimônio.

DROP POLICY IF EXISTS ti_planta_select ON public."TI_PLANTA";
CREATE POLICY ti_planta_select ON public."TI_PLANTA" FOR SELECT TO authenticated USING (public.ti_pode_ver());
DROP POLICY IF EXISTS ti_planta_insert ON public."TI_PLANTA";
CREATE POLICY ti_planta_insert ON public."TI_PLANTA" FOR INSERT TO authenticated WITH CHECK (public.ti_pode_construir('incluir'));
DROP POLICY IF EXISTS ti_planta_update ON public."TI_PLANTA";
CREATE POLICY ti_planta_update ON public."TI_PLANTA" FOR UPDATE TO authenticated USING (public.ti_pode_construir('alterar')) WITH CHECK (public.ti_pode_construir('alterar'));
DROP POLICY IF EXISTS ti_planta_delete ON public."TI_PLANTA";
CREATE POLICY ti_planta_delete ON public."TI_PLANTA" FOR DELETE TO authenticated USING (public.ti_pode_construir('excluir'));

DROP POLICY IF EXISTS ti_planta_elemento_select ON public."TI_PLANTA_ELEMENTO";
CREATE POLICY ti_planta_elemento_select ON public."TI_PLANTA_ELEMENTO" FOR SELECT TO authenticated USING (public.ti_pode_ver());
DROP POLICY IF EXISTS ti_planta_elemento_insert ON public."TI_PLANTA_ELEMENTO";
CREATE POLICY ti_planta_elemento_insert ON public."TI_PLANTA_ELEMENTO" FOR INSERT TO authenticated WITH CHECK (public.ti_pode_construir('incluir'));
DROP POLICY IF EXISTS ti_planta_elemento_update ON public."TI_PLANTA_ELEMENTO";
CREATE POLICY ti_planta_elemento_update ON public."TI_PLANTA_ELEMENTO" FOR UPDATE TO authenticated USING (public.ti_pode_construir('alterar')) WITH CHECK (public.ti_pode_construir('alterar'));
DROP POLICY IF EXISTS ti_planta_elemento_delete ON public."TI_PLANTA_ELEMENTO";
CREATE POLICY ti_planta_elemento_delete ON public."TI_PLANTA_ELEMENTO" FOR DELETE TO authenticated USING (public.ti_pode_construir('excluir'));

DROP POLICY IF EXISTS ti_ativo_select ON public."TI_ATIVO";
CREATE POLICY ti_ativo_select ON public."TI_ATIVO" FOR SELECT TO authenticated USING (public.ti_pode_ver());

DROP POLICY IF EXISTS ti_ativo_evento_select ON public."TI_ATIVO_EVENTO";
CREATE POLICY ti_ativo_evento_select ON public."TI_ATIVO_EVENTO" FOR SELECT TO authenticated USING (public.ti_pode_ver());

DROP POLICY IF EXISTS ti_ativo_anexo_select ON public."TI_ATIVO_ANEXO";
CREATE POLICY ti_ativo_anexo_select ON public."TI_ATIVO_ANEXO" FOR SELECT TO authenticated USING (public.ti_pode_ver());

-- O bucket seguia o mesmo código único; passa a seguir as quatro telas.
DROP POLICY IF EXISTS "ti ativos anexo select" ON storage.objects;
CREATE POLICY "ti ativos anexo select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'ti-ativos' AND public.ti_pode_ver());

-- 5) Mover equipamento no mapa é CONSTRUIR, não gerenciar patrimônio ------
-- Sem isto, quem tem a tela de construir mas não `ti_ativo_gerenciar` monta o
-- escritório inteiro e não consegue arrastar um computador para cima da mesa.
-- A policy de UPDATE aceita os dois; o guard abaixo é que limita o construtor
-- às colunas de POSIÇÃO — ele arruma o mapa, não reescreve a ficha da máquina.
DROP POLICY IF EXISTS ti_ativo_update ON public."TI_ATIVO";
CREATE POLICY ti_ativo_update ON public."TI_ATIVO" FOR UPDATE TO authenticated USING (public.ti_pode('ti_ativo_gerenciar', 'alterar') OR public.ti_pode_construir('alterar')) WITH CHECK (public.ti_pode('ti_ativo_gerenciar', 'alterar') OR public.ti_pode_construir('alterar'));

CREATE OR REPLACE FUNCTION public.ti_ativo_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Quem gerencia patrimônio muda o que quiser.
  IF public.ti_pode('ti_ativo_gerenciar', 'alterar') THEN
    RETURN NEW;
  END IF;

  -- O construtor mexe só onde a coisa está. Qualquer outra coluna diferente
  -- da anterior é edição de ficha, e essa exige o outro cadeado.
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    IF (to_jsonb(NEW) - 'planta_id' - 'pos_x' - 'pos_y' - 'pos_z' - 'rotacao' - 'escala' - 'updated_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'planta_id' - 'pos_x' - 'pos_y' - 'pos_z' - 'rotacao' - 'escala' - 'updated_at') THEN
      RAISE EXCEPTION 'Sem permissão para alterar o cadastro do equipamento — você pode apenas posicioná-lo no mapa.';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ti_ativo_guard ON public."TI_ATIVO";
CREATE TRIGGER trg_ti_ativo_guard BEFORE UPDATE ON public."TI_ATIVO"
  FOR EACH ROW EXECUTE FUNCTION public.ti_ativo_guard();

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT am.codigo, COALESCE(am.rota, '(capacidade)') AS rota, am.ordem, am.ativo
  FROM public.app_menu am JOIN public.app_modulo mo ON mo.id = am.modulo_id
 WHERE mo.codigo = 'ti' ORDER BY am.ordem;

-- =====================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_ti_ativo_guard ON public."TI_ATIVO";
--   DROP FUNCTION IF EXISTS public.ti_ativo_guard();
--   DROP FUNCTION IF EXISTS public.ti_pode_construir(public.app_acao);
--   DROP FUNCTION IF EXISTS public.ti_pode_ver();
--   -- e reexecutar o bloco 5 de 20260930000060_ti_mapa_hardware.sql
--   DELETE FROM public.app_menu WHERE codigo IN ('ti_construir','ti_inventario','ti_painel');
--   UPDATE public.app_menu SET nome='Mapa de Hardware', rota='/app/ti/mapa-hardware'
--    WHERE codigo='ti_mapa_hardware';
--   ALTER TABLE public."TI_ATIVO" DROP COLUMN IF EXISTS pos_z;
--   ALTER TABLE public."TI_PLANTA_ELEMENTO" DROP COLUMN IF EXISTS altura_z;
--   ALTER TABLE public."TI_PLANTA" DROP COLUMN IF EXISTS pe_direito_cm;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
