-- =====================================================================
-- T.I — MAPA DE HARDWARE
--
-- O QUE É
--   O primeiro submódulo do módulo T.I: uma planta baixa editável do
--   escritório onde cada computador, monitor, impressora, switch, nobreak
--   etc. é posicionado no lugar físico em que ele realmente está, com o
--   cadastro completo da máquina por trás (configuração, rede, garantia,
--   responsável, histórico).
--
--   São três coisas empilhadas, e é bom não confundi-las:
--     1. a PLANTA  ("TI_PLANTA")          — o escritório (um por andar/unidade);
--     2. o DESENHO ("TI_PLANTA_ELEMENTO") — paredes, salas, mesas, portas…
--        (cenário: não é hardware, não entra em inventário);
--     3. o ATIVO   ("TI_ATIVO")           — o hardware. Existe com ou sem
--        posição no mapa: equipamento em estoque/manutenção fica sem
--        planta_id e aparece na bandeja lateral da tela, esperando alguém
--        arrastar para o mapa.
--
--   O histórico ("TI_ATIVO_EVENTO") é escrito por trigger, não pela tela:
--   mover uma máquina de sala, trocar o responsável ou mudar o status
--   sempre deixa rastro, mesmo quando a alteração vem por outro caminho.
--
-- COORDENADAS
--   Tudo em CENTÍMETROS, com a origem no canto superior esquerdo da planta.
--   Não é pixel: assim o mapa continua fiel quando alguém mede a sala com
--   trena, e o zoom da tela vira só uma escala de render. O grid da tela é
--   de 25 cm (`snap`), e a planta padrão nasce 24 m × 16 m.
--
-- ACESSO (README da raiz + J1 de .github/REGRAS-PR.md)
--   Módulo `ti`, com um menu de tela e três menus fantasma (rota NULL) que
--   existem só para carregar capacidade:
--     ti_mapa_hardware        — a tela  (SELECT de tudo: `visualizar`)
--     ti_mapa_editar          — desenhar a planta (paredes/salas/mesas)
--     ti_ativo_gerenciar      — cadastrar/editar/mover/excluir hardware
--     ti_ativo_sensivel       — ver o bloco de acesso remoto / notas internas
--
--   ⚠ `ti_ativo_sensivel` é gate de INTERFACE, não de dado: a RLS entrega a
--   linha inteira de "TI_ATIVO" para quem tem `visualizar`. Ele esconde da
--   tela o ID de AnyDesk/TeamViewer e as notas internas de quem não precisa
--   ver aquilo no dia a dia — não é cofre. Nada de senha vai nessas colunas
--   justamente por isso; se um dia precisar de segredo de verdade, ele mora
--   em outra tabela com RLS própria, não aqui.
--
--   `excluir` NÃO faz parte do pacote do toggle de "Acesso por Usuário"
--   (ACOES_DO_TOGGLE_PADRAO, ver J1.A). Quem precisa apagar hardware ou
--   parede recebe o perfil-espelho "T.I" — criado automaticamente pelo
--   trg_criar_perfil_acesso_do_modulo no INSERT em app_modulo abaixo, e que
--   libera QUALQUER ação sobre QUALQUER menu deste módulo (inclusive os
--   fantasmas e os que vierem depois). Não precisa de Administrador Geral, e
--   a tela esconde os botões de excluir de quem não tem a ação.
--
--   Teste de J1.G: usuário sem nenhum perfil, só com o toggle do módulo T.I
--   ligado em Acesso por Usuário → vê a tela ✅, cadastra hardware ✅,
--   arrasta no mapa ✅, desenha parede ✅. Excluir exige o perfil-espelho
--   "T.I" (ou a ação `excluir` marcada individualmente), por desenho.
--
-- Idempotente: pode rodar de novo inteiro sem erro.
-- =====================================================================

-- 1) Módulo e menus -----------------------------------------------------
INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem, ativo)
SELECT 'ti', 'T.I', 'Infraestrutura, hardware e mapa do escritório', 'Cpu',
       COALESCE((SELECT max(ordem) FROM public.app_modulo), 200) + 5, true
WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'ti');

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM public.app_modulo m
 CROSS JOIN (VALUES
   ('ti_mapa_hardware',   'Mapa de Hardware',                    '/app/ti/mapa-hardware', 10),
   ('ti_mapa_editar',     'Mapa de Hardware — Editar a planta',   NULL,                    11),
   ('ti_ativo_gerenciar', 'Mapa de Hardware — Gerenciar hardware', NULL,                   12),
   ('ti_ativo_sensivel',  'Mapa de Hardware — Dados sensíveis',    NULL,                   13)
 ) AS x(codigo, nome, rota, ordem)
 WHERE m.codigo = 'ti'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 2) Helper de permissão ------------------------------------------------
-- Um lugar só para a regra: as policies abaixo chamam isto, e mudar a
-- política do módulo inteiro é mexer aqui, não em 12 policies.
CREATE OR REPLACE FUNCTION public.ti_pode(_menu text, _acao public.app_acao)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.has_screen_access(auth.uid(), _menu, _acao, NULL);
$$;

REVOKE ALL ON FUNCTION public.ti_pode(text, public.app_acao) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ti_pode(text, public.app_acao) FROM anon;
GRANT EXECUTE ON FUNCTION public.ti_pode(text, public.app_acao) TO authenticated;

-- 3) Tabelas ------------------------------------------------------------

-- 3.1) Planta: um escritório/andar/unidade.
CREATE TABLE IF NOT EXISTS public."TI_PLANTA" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  descricao   text,
  endereco    text,
  -- Dimensões do "terreno" em centímetros (padrão 24 m × 16 m).
  largura_cm  integer NOT NULL DEFAULT 2400 CHECK (largura_cm BETWEEN 200 AND 20000),
  altura_cm   integer NOT NULL DEFAULT 1600 CHECK (altura_cm  BETWEEN 200 AND 20000),
  cor_piso    text NOT NULL DEFAULT '#f1f5f9',
  ordem       integer NOT NULL DEFAULT 0,
  ativo       boolean NOT NULL DEFAULT true,
  created_by  uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 3.2) Elemento do desenho: o cenário da planta.
CREATE TABLE IF NOT EXISTS public."TI_PLANTA_ELEMENTO" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planta_id  uuid NOT NULL REFERENCES public."TI_PLANTA"(id) ON DELETE CASCADE,
  tipo       text NOT NULL DEFAULT 'parede'
               CHECK (tipo IN ('parede','sala','mesa','divisoria','porta','janela','armario',
                               'cadeira','sofa','rack','impressora_area','copa','banheiro',
                               'recepcao','planta_decorativa','escada','texto')),
  rotulo     text,
  x          numeric(10,2) NOT NULL DEFAULT 0,
  y          numeric(10,2) NOT NULL DEFAULT 0,
  largura    numeric(10,2) NOT NULL DEFAULT 100 CHECK (largura > 0),
  altura     numeric(10,2) NOT NULL DEFAULT 100 CHECK (altura  > 0),
  rotacao    numeric(6,2)  NOT NULL DEFAULT 0,
  cor        text,
  z_index    integer NOT NULL DEFAULT 0,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ti_planta_elemento_planta ON public."TI_PLANTA_ELEMENTO"(planta_id);

-- 3.3) Ativo: o hardware em si.
--
-- responsavel_empregado_id aponta para "EMPREGADOS"."ID" SEM foreign key de
-- propósito: aquela tabela é reimportada do Senior periodicamente (a limpeza
-- de duplicados de 20/08/2026 apagou 266 linhas) e uma FK transformaria cada
-- reimportação num bloqueio. O nome fica desnormalizado ao lado para o
-- histórico não perder o "quem era" quando a pessoa sai.
CREATE TABLE IF NOT EXISTS public."TI_ATIVO" (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo             text UNIQUE,                       -- TI-0001, gerado por trigger
  patrimonio         text,                              -- nº de patrimônio da empresa
  tipo               text NOT NULL DEFAULT 'desktop'
                       CHECK (tipo IN ('desktop','notebook','monitor','impressora','scanner',
                                       'servidor','switch','roteador','access_point','firewall',
                                       'nobreak','estabilizador','telefone_ip','celular','tablet',
                                       'projetor','tv','camera','storage','rack','periferico','outro')),
  nome               text NOT NULL,
  hostname           text,
  marca              text,
  modelo             text,
  numero_serie       text,
  status             text NOT NULL DEFAULT 'em_uso'
                       CHECK (status IN ('em_uso','disponivel','manutencao','reservado',
                                         'emprestado','inativo','descartado')),
  criticidade        text NOT NULL DEFAULT 'media' CHECK (criticidade IN ('baixa','media','alta')),

  -- Configuração
  cpu                text,
  cpu_nucleos        integer,
  ram_gb             numeric(8,2),
  ram_tipo           text,
  armazenamento_tipo text CHECK (armazenamento_tipo IS NULL
                                 OR armazenamento_tipo IN ('hdd','ssd','nvme','hibrido')),
  armazenamento_gb   numeric(10,2),
  armazenamento_extra text,
  placa_video        text,
  placa_mae          text,
  fonte_watts        integer,
  sistema_operacional text,
  so_versao          text,
  so_licenca         text,
  office_versao      text,
  office_licenca     text,
  antivirus          text,
  monitores_qtd      integer,
  perifericos        text,
  especificacoes     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- campos livres extras

  -- Rede
  ip                 text,
  ip_tipo            text CHECK (ip_tipo IS NULL OR ip_tipo IN ('fixo','dhcp')),
  mac                text,
  mascara            text,
  gateway            text,
  dns                text,
  vlan               text,
  dominio            text,
  rede_tipo          text CHECK (rede_tipo IS NULL OR rede_tipo IN ('cabo','wifi','ambos')),
  switch_nome        text,
  switch_porta       text,
  ponto_rede         text,

  -- Suporte remoto (bloco sensível — ver cabeçalho)
  anydesk            text,
  teamviewer         text,
  observacoes_internas text,

  -- Gestão / patrimônio
  responsavel_empregado_id integer,
  responsavel_nome   text,
  setor              text,
  fornecedor         text,
  nota_fiscal        text,
  data_aquisicao     date,
  valor_aquisicao    numeric(14,2),
  garantia_ate       date,
  vida_util_meses    integer,
  ultima_manutencao  date,
  proxima_manutencao date,
  observacoes        text,

  -- Posição no mapa (NULL = ainda não posicionado; fica na bandeja da tela)
  planta_id          uuid REFERENCES public."TI_PLANTA"(id) ON DELETE SET NULL,
  pos_x              numeric(10,2),
  pos_y              numeric(10,2),
  rotacao            numeric(6,2) NOT NULL DEFAULT 0,
  escala             numeric(5,2) NOT NULL DEFAULT 1 CHECK (escala BETWEEN 0.4 AND 3),
  cor                text,

  -- Um monitor/nobreak pode pendurar no computador que ele serve.
  ativo_pai_id       uuid REFERENCES public."TI_ATIVO"(id) ON DELETE SET NULL,

  created_by         uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ti_ativo_planta      ON public."TI_ATIVO"(planta_id);
CREATE INDEX IF NOT EXISTS idx_ti_ativo_status      ON public."TI_ATIVO"(status);
CREATE INDEX IF NOT EXISTS idx_ti_ativo_tipo        ON public."TI_ATIVO"(tipo);
CREATE INDEX IF NOT EXISTS idx_ti_ativo_responsavel ON public."TI_ATIVO"(responsavel_empregado_id);
CREATE INDEX IF NOT EXISTS idx_ti_ativo_pai         ON public."TI_ATIVO"(ativo_pai_id);
CREATE INDEX IF NOT EXISTS idx_ti_ativo_ip          ON public."TI_ATIVO"(ip);

-- IP duplicado é o bug de rede clássico (duas máquinas com o mesmo fixo).
-- Índice parcial: só cobra unicidade de IP FIXO de equipamento que não foi
-- descartado — DHCP e sucata podem repetir à vontade.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ti_ativo_ip_fixo
  ON public."TI_ATIVO"(ip)
  WHERE ip IS NOT NULL AND ip <> '' AND ip_tipo = 'fixo' AND status <> 'descartado';

-- 3.4) Histórico do ativo (escrito por trigger + notas manuais da tela).
CREATE TABLE IF NOT EXISTS public."TI_ATIVO_EVENTO" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ativo_id   uuid NOT NULL REFERENCES public."TI_ATIVO"(id) ON DELETE CASCADE,
  tipo       text NOT NULL DEFAULT 'nota'
               CHECK (tipo IN ('criacao','edicao','movimentacao','status','responsavel',
                               'manutencao','rede','nota')),
  texto      text,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  autor_id   uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ti_ativo_evento_ativo ON public."TI_ATIVO_EVENTO"(ativo_id, created_at DESC);

-- 3.5) Anexos (foto do equipamento, nota fiscal, laudo de manutenção).
CREATE TABLE IF NOT EXISTS public."TI_ATIVO_ANEXO" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ativo_id      uuid NOT NULL REFERENCES public."TI_ATIVO"(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  nome_arquivo  text NOT NULL,
  mime_type     text,
  tamanho_bytes bigint,
  categoria     text NOT NULL DEFAULT 'foto'
                  CHECK (categoria IN ('foto','nota_fiscal','laudo','outro')),
  autor_id      uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ti_ativo_anexo_ativo ON public."TI_ATIVO_ANEXO"(ativo_id);

-- 4) Triggers -----------------------------------------------------------

DROP TRIGGER IF EXISTS trg_ti_planta_updated ON public."TI_PLANTA";
CREATE TRIGGER trg_ti_planta_updated BEFORE UPDATE ON public."TI_PLANTA"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_ti_planta_elemento_updated ON public."TI_PLANTA_ELEMENTO";
CREATE TRIGGER trg_ti_planta_elemento_updated BEFORE UPDATE ON public."TI_PLANTA_ELEMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_ti_ativo_updated ON public."TI_ATIVO";
CREATE TRIGGER trg_ti_ativo_updated BEFORE UPDATE ON public."TI_ATIVO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4.1) Código sequencial TI-0001.
CREATE SEQUENCE IF NOT EXISTS public.ti_ativo_codigo_seq;

CREATE OR REPLACE FUNCTION public.gerar_codigo_ti_ativo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.codigo IS NULL OR btrim(NEW.codigo) = '' THEN
    NEW.codigo := 'TI-' || lpad(nextval('public.ti_ativo_codigo_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gerar_codigo_ti_ativo ON public."TI_ATIVO";
CREATE TRIGGER trg_gerar_codigo_ti_ativo BEFORE INSERT ON public."TI_ATIVO"
  FOR EACH ROW EXECUTE FUNCTION public.gerar_codigo_ti_ativo();

-- Alinha a sequência com o que já existe (reexecução / carga inicial).
SELECT setval(
  'public.ti_ativo_codigo_seq',
  GREATEST(
    COALESCE((SELECT max(NULLIF(regexp_replace(codigo, '\D', '', 'g'), '')::bigint)
                FROM public."TI_ATIVO" WHERE codigo LIKE 'TI-%'), 0),
    1
  ),
  true
);

-- 4.2) Histórico automático. Só registra o que interessa a quem investiga
-- ("cadê essa máquina?", "quem estava com ela?"), não todo UPDATE.
CREATE OR REPLACE FUNCTION public.ti_ativo_registrar_evento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."TI_ATIVO_EVENTO" (ativo_id, tipo, texto, meta)
    VALUES (NEW.id, 'criacao', 'Ativo cadastrado', jsonb_build_object('tipo', NEW.tipo, 'status', NEW.status));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public."TI_ATIVO_EVENTO" (ativo_id, tipo, texto, meta)
    VALUES (NEW.id, 'status', format('Status: %s → %s', OLD.status, NEW.status),
            jsonb_build_object('de', OLD.status, 'para', NEW.status));
  END IF;

  IF NEW.responsavel_empregado_id IS DISTINCT FROM OLD.responsavel_empregado_id
     OR NEW.responsavel_nome IS DISTINCT FROM OLD.responsavel_nome THEN
    INSERT INTO public."TI_ATIVO_EVENTO" (ativo_id, tipo, texto, meta)
    VALUES (NEW.id, 'responsavel',
            format('Responsável: %s → %s', COALESCE(OLD.responsavel_nome, '—'), COALESCE(NEW.responsavel_nome, '—')),
            jsonb_build_object('de', OLD.responsavel_nome, 'para', NEW.responsavel_nome));
  END IF;

  -- Movimentação: mudou de planta, ou andou mais de 30 cm dentro da mesma.
  -- O limiar existe para o histórico não virar log de mouse: encostar a
  -- máquina 5 cm para alinhar na mesa não é uma mudança de lugar.
  IF NEW.planta_id IS DISTINCT FROM OLD.planta_id
     OR (NEW.planta_id IS NOT NULL
         AND (abs(COALESCE(NEW.pos_x, 0) - COALESCE(OLD.pos_x, 0)) > 30
              OR abs(COALESCE(NEW.pos_y, 0) - COALESCE(OLD.pos_y, 0)) > 30)) THEN
    INSERT INTO public."TI_ATIVO_EVENTO" (ativo_id, tipo, texto, meta)
    VALUES (NEW.id, 'movimentacao', 'Posição no mapa alterada',
            jsonb_build_object('de', jsonb_build_object('planta', OLD.planta_id, 'x', OLD.pos_x, 'y', OLD.pos_y),
                               'para', jsonb_build_object('planta', NEW.planta_id, 'x', NEW.pos_x, 'y', NEW.pos_y)));
  END IF;

  IF NEW.ip IS DISTINCT FROM OLD.ip THEN
    INSERT INTO public."TI_ATIVO_EVENTO" (ativo_id, tipo, texto, meta)
    VALUES (NEW.id, 'rede', format('IP: %s → %s', COALESCE(OLD.ip, '—'), COALESCE(NEW.ip, '—')),
            jsonb_build_object('de', OLD.ip, 'para', NEW.ip));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ti_ativo_evento ON public."TI_ATIVO";
CREATE TRIGGER trg_ti_ativo_evento AFTER INSERT OR UPDATE ON public."TI_ATIVO"
  FOR EACH ROW EXECUTE FUNCTION public.ti_ativo_registrar_evento();

-- 5) RLS ----------------------------------------------------------------
ALTER TABLE public."TI_PLANTA"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TI_PLANTA_ELEMENTO"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TI_ATIVO"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TI_ATIVO_EVENTO"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TI_ATIVO_ANEXO"      ENABLE ROW LEVEL SECURITY;

-- Sem filtro de empresa, de propósito (J1.E): o parque de máquinas é do
-- escritório, e quem não tem linha em user_empresa veria a tela vazia.

DROP POLICY IF EXISTS ti_planta_select ON public."TI_PLANTA";
CREATE POLICY ti_planta_select ON public."TI_PLANTA" FOR SELECT TO authenticated USING (public.ti_pode('ti_mapa_hardware', 'visualizar'));
DROP POLICY IF EXISTS ti_planta_insert ON public."TI_PLANTA";
CREATE POLICY ti_planta_insert ON public."TI_PLANTA" FOR INSERT TO authenticated WITH CHECK (public.ti_pode('ti_mapa_editar', 'incluir'));
DROP POLICY IF EXISTS ti_planta_update ON public."TI_PLANTA";
CREATE POLICY ti_planta_update ON public."TI_PLANTA" FOR UPDATE TO authenticated USING (public.ti_pode('ti_mapa_editar', 'alterar')) WITH CHECK (public.ti_pode('ti_mapa_editar', 'alterar'));
DROP POLICY IF EXISTS ti_planta_delete ON public."TI_PLANTA";
CREATE POLICY ti_planta_delete ON public."TI_PLANTA" FOR DELETE TO authenticated USING (public.ti_pode('ti_mapa_editar', 'excluir'));

DROP POLICY IF EXISTS ti_planta_elemento_select ON public."TI_PLANTA_ELEMENTO";
CREATE POLICY ti_planta_elemento_select ON public."TI_PLANTA_ELEMENTO" FOR SELECT TO authenticated USING (public.ti_pode('ti_mapa_hardware', 'visualizar'));
DROP POLICY IF EXISTS ti_planta_elemento_insert ON public."TI_PLANTA_ELEMENTO";
CREATE POLICY ti_planta_elemento_insert ON public."TI_PLANTA_ELEMENTO" FOR INSERT TO authenticated WITH CHECK (public.ti_pode('ti_mapa_editar', 'incluir'));
DROP POLICY IF EXISTS ti_planta_elemento_update ON public."TI_PLANTA_ELEMENTO";
CREATE POLICY ti_planta_elemento_update ON public."TI_PLANTA_ELEMENTO" FOR UPDATE TO authenticated USING (public.ti_pode('ti_mapa_editar', 'alterar')) WITH CHECK (public.ti_pode('ti_mapa_editar', 'alterar'));
DROP POLICY IF EXISTS ti_planta_elemento_delete ON public."TI_PLANTA_ELEMENTO";
CREATE POLICY ti_planta_elemento_delete ON public."TI_PLANTA_ELEMENTO" FOR DELETE TO authenticated USING (public.ti_pode('ti_mapa_editar', 'excluir'));

DROP POLICY IF EXISTS ti_ativo_select ON public."TI_ATIVO";
CREATE POLICY ti_ativo_select ON public."TI_ATIVO" FOR SELECT TO authenticated USING (public.ti_pode('ti_mapa_hardware', 'visualizar'));
DROP POLICY IF EXISTS ti_ativo_insert ON public."TI_ATIVO";
CREATE POLICY ti_ativo_insert ON public."TI_ATIVO" FOR INSERT TO authenticated WITH CHECK (public.ti_pode('ti_ativo_gerenciar', 'incluir'));
DROP POLICY IF EXISTS ti_ativo_update ON public."TI_ATIVO";
CREATE POLICY ti_ativo_update ON public."TI_ATIVO" FOR UPDATE TO authenticated USING (public.ti_pode('ti_ativo_gerenciar', 'alterar')) WITH CHECK (public.ti_pode('ti_ativo_gerenciar', 'alterar'));
DROP POLICY IF EXISTS ti_ativo_delete ON public."TI_ATIVO";
CREATE POLICY ti_ativo_delete ON public."TI_ATIVO" FOR DELETE TO authenticated USING (public.ti_pode('ti_ativo_gerenciar', 'excluir'));

DROP POLICY IF EXISTS ti_ativo_evento_select ON public."TI_ATIVO_EVENTO";
CREATE POLICY ti_ativo_evento_select ON public."TI_ATIVO_EVENTO" FOR SELECT TO authenticated USING (public.ti_pode('ti_mapa_hardware', 'visualizar'));
-- INSERT manual = a "nota" que o técnico escreve na timeline. Os eventos
-- automáticos entram pela trigger (SECURITY DEFINER), que não passa por RLS.
DROP POLICY IF EXISTS ti_ativo_evento_insert ON public."TI_ATIVO_EVENTO";
CREATE POLICY ti_ativo_evento_insert ON public."TI_ATIVO_EVENTO" FOR INSERT TO authenticated WITH CHECK (public.ti_pode('ti_ativo_gerenciar', 'incluir') AND autor_id = auth.uid());

DROP POLICY IF EXISTS ti_ativo_anexo_select ON public."TI_ATIVO_ANEXO";
CREATE POLICY ti_ativo_anexo_select ON public."TI_ATIVO_ANEXO" FOR SELECT TO authenticated USING (public.ti_pode('ti_mapa_hardware', 'visualizar'));
DROP POLICY IF EXISTS ti_ativo_anexo_insert ON public."TI_ATIVO_ANEXO";
CREATE POLICY ti_ativo_anexo_insert ON public."TI_ATIVO_ANEXO" FOR INSERT TO authenticated WITH CHECK (public.ti_pode('ti_ativo_gerenciar', 'incluir'));
DROP POLICY IF EXISTS ti_ativo_anexo_delete ON public."TI_ATIVO_ANEXO";
CREATE POLICY ti_ativo_anexo_delete ON public."TI_ATIVO_ANEXO" FOR DELETE TO authenticated USING (public.ti_pode('ti_ativo_gerenciar', 'excluir'));

-- 6) Storage ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('ti-ativos', 'ti-ativos', false, 20971520)  -- 20 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ti ativos anexo select" ON storage.objects;
CREATE POLICY "ti ativos anexo select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'ti-ativos' AND public.ti_pode('ti_mapa_hardware', 'visualizar'));
DROP POLICY IF EXISTS "ti ativos anexo insert" ON storage.objects;
CREATE POLICY "ti ativos anexo insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'ti-ativos' AND public.ti_pode('ti_ativo_gerenciar', 'incluir'));
DROP POLICY IF EXISTS "ti ativos anexo delete" ON storage.objects;
CREATE POLICY "ti ativos anexo delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'ti-ativos' AND public.ti_pode('ti_ativo_gerenciar', 'excluir'));

-- 7) Planta inicial -----------------------------------------------------
-- Uma planta vazia para a tela não abrir num vazio sem nome. O desenho é
-- feito pelo time de T.I na própria tela — não semeamos parede nenhuma.
INSERT INTO public."TI_PLANTA" (nome, descricao, largura_cm, altura_cm, ordem)
SELECT 'Escritório — Sede', 'Planta principal do escritório', 2400, 1600, 0
WHERE NOT EXISTS (SELECT 1 FROM public."TI_PLANTA");

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
-- Os 4 menus têm de existir, ativos, no módulo `ti`; e o perfil-espelho
-- "T.I" tem de ter nascido junto (é ele que carrega o `excluir`).
SELECT am.codigo, am.nome, COALESCE(am.rota, '(menu fantasma)') AS rota, am.ativo
  FROM public.app_menu am
  JOIN public.app_modulo mo ON mo.id = am.modulo_id
 WHERE mo.codigo = 'ti'
 ORDER BY am.ordem;

SELECT nome, modulo_codigo, ativo FROM public.perfil_acesso WHERE modulo_codigo = 'ti';

-- =====================================================================
-- ROLLBACK
--   DROP TABLE IF EXISTS public."TI_ATIVO_ANEXO";
--   DROP TABLE IF EXISTS public."TI_ATIVO_EVENTO";
--   DROP TABLE IF EXISTS public."TI_ATIVO";
--   DROP TABLE IF EXISTS public."TI_PLANTA_ELEMENTO";
--   DROP TABLE IF EXISTS public."TI_PLANTA";
--   DROP FUNCTION IF EXISTS public.ti_ativo_registrar_evento();
--   DROP FUNCTION IF EXISTS public.gerar_codigo_ti_ativo();
--   DROP SEQUENCE IF EXISTS public.ti_ativo_codigo_seq;
--   DROP FUNCTION IF EXISTS public.ti_pode(text, public.app_acao);
--   DELETE FROM public.app_menu WHERE modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'ti');
--   DELETE FROM public.perfil_acesso WHERE modulo_codigo = 'ti';
--   DELETE FROM public.app_modulo WHERE codigo = 'ti';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
