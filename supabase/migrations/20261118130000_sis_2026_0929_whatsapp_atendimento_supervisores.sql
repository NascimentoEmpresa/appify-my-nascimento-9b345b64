-- =========================================================================
-- SIS-2026-0929 — ATENDIMENTO DOS SUPERVISORES POR WHATSAPP COM I.A (18/11/2026)
--
-- PEDIDO: supervisores recebem dúvidas e demandas pelo WhatsApp; registrar e
-- rastrear essas conversas (protocolo, status, fila, quem respondeu), deixar a
-- I.A responder o que dá com base em procedimentos APROVADOS, e só entregar
-- dado de colaborador quando o número que pergunta for o do próprio
-- colaborador ou o do encarregado dele, conferido no cadastro ATUAL.
--
-- CONSTRUÍDO EM CIMA DO MÓDULO WHATSAPP QUE JÁ EXISTE (Caixa de Entrada,
-- pastas, WA_MENSAGEM com origem bot/atendente, WA_EVENTO, webhook da Meta).
-- O que esta migration acrescenta:
--
--   1. WA_CANAL — um número da Meta por canal. O número de hoje vira o canal
--      'principal' (recrutamento & cia, nada muda para ele). O canal
--      'supervisores' é o número corporativo novo, RESTRITO: só vê as conversas
--      dele quem tem o menu whatsapp_atd_fila — nem 'Todas as conversas'
--      (whatsapp_todas) passa por cima. A RLS de WA_CONVERSA ganha essa trava;
--      WA_MENSAGEM/WA_EVENTO herdam, porque a policy deles consulta a conversa.
--   2. WA_CONVERSA.canal_codigo e UNIQUE (contato_id, canal_codigo): a mesma
--      pessoa pode falar com os dois números sem misturar o histórico (um
--      colaborador que já foi candidato não pode ter a conversa com o
--      supervisor aparecendo para o Recrutamento). As três RPCs que criavam
--      conversa com ON CONFLICT (contato_id) passam a dizer o canal.
--   3. WA_ATENDIMENTO — o PROTOCOLO (ATD-AAAA-NNNNNN). Um por ciclo de
--      atendimento; status ia → aguardando_humano → em_atendimento_humano →
--      concluido. Nasce sozinho na 1ª mensagem recebida (trigger), cada
--      mensagem fica ligada a ele (WA_MENSAGEM.atendimento_id), e as ações da
--      Caixa de Entrada (assumir/devolver ao bot/concluir) sincronizam o status.
--   4. Autorização por número — wa_atd_identificar / wa_atd_consultar (só
--      service_role, chamadas pelo webhook). Fonte: EMPREGADOS.telefone (coluna
--      do ERP, mig 20260930000194) + Organograma Operacional (OPE_ORG_CONTRATO,
--      a fonte do encarregado desde a mig 20261117000100) + rh_ac_ativos()
--      (colaborador → contrato). Toda consulta, autorizada OU negada, fica em
--      WA_ATD_CONSULTA_LOG.
--   5. WA_ATD_REGRA_DADO — categorias de dado; as SENSÍVEIS (salário, saúde/
--      CID, disciplinar, bancário, documentos, endereço, rescisão, denúncia)
--      nunca saem pelo bot: um CHECK impede marcá-las como liberadas.
--   6. WA_ATD_BASE (+ histórico) — procedimentos aprovados pela empresa; a I.A
--      só usa o que está ativo E aprovado. WA_ATD_REVISAO — revisão das
--      respostas automáticas.
--   7. WA_ATD_ACESSO_LOG — quem abriu/assumiu/concluiu/alterou o quê.
--   8. Fila, indicadores, auditoria e retenção/descarte configurável
--      (WA_CANAL.retencao_dias), com pg_cron.
--
-- MENUS (nascem PENDENTES — SIS-2026-0931: liberar em Módulos & Menus ›
-- Novos Módulos depois do merge):
--   whatsapp_atd_fila      /app/whatsapp/atendimento        visualizar | alterar
--   whatsapp_atd_base      /app/whatsapp/atendimento/base   visualizar | alterar | aprovar
--   whatsapp_atd_auditoria (menu fantasma, rota NULL)       visualizar
--   whatsapp_pasta_atendimento_supervisores (pasta, rota NULL) — Caixa de Entrada
--
-- Espelho das regras em TypeScript (testado no Vitest):
--   supabase/functions/_shared/whatsapp-atendimento.ts   (autorização/I.A)
--   src/lib/whatsapp/atendimentoSupervisores.ts          (status/fila/indicadores)
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Canais ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."WA_CANAL" (
  codigo           text PRIMARY KEY,
  nome             text NOT NULL,
  -- phone_number_id da Meta. NULL no 'principal' = secret WHATSAPP_PHONE_NUMBER_ID.
  phone_number_id  text UNIQUE,
  finalidade       text NOT NULL DEFAULT 'geral' CHECK (finalidade IN ('geral', 'atendimento_supervisores')),
  -- Restrito: conversa só aparece para quem tem `menu_codigo` (nem whatsapp_todas basta).
  restrito         boolean NOT NULL DEFAULT false,
  menu_codigo      text,
  pasta_padrao     text REFERENCES public."WA_PASTA"(codigo) ON DELETE SET NULL,
  ativo            boolean NOT NULL DEFAULT true,
  ia_ativa         boolean NOT NULL DEFAULT false,
  provedor         text,                 -- NULL = o de WA_BOT_CONFIG
  modelo           text,                 -- NULL = o de WA_BOT_CONFIG
  max_tokens       integer NOT NULL DEFAULT 600 CHECK (max_tokens BETWEEN 100 AND 4000),
  persona          text,
  aviso_abertura   text,                 -- {protocolo} vira o número do protocolo
  msg_encaminhado  text,
  msg_negado       text,
  -- Atendimento que a I.A resolveu e a pessoa sumiu: conclui sozinho depois de N horas.
  encerrar_ia_apos_horas integer NOT NULL DEFAULT 12 CHECK (encerrar_ia_apos_horas BETWEEN 1 AND 168),
  -- Retenção: NULL = guardar; N = texto das mensagens com mais de N dias é descartado.
  retencao_dias    integer CHECK (retencao_dias IS NULL OR retencao_dias >= 30),
  setores          text[] NOT NULL DEFAULT '{}',   -- para onde a equipe encaminha
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid
);
-- Toda FK com índice (regra M2 do guardião): JOIN e DELETE na tabela
-- referenciada não podem varrer esta inteira.
CREATE INDEX IF NOT EXISTS wa_canal_pasta_padrao_idx ON public."WA_CANAL" (pasta_padrao);

-- Pasta da Caixa de Entrada para o canal novo (mesmo padrão da 20260819000003:
-- pasta + o app_menu que a governa).
INSERT INTO public."WA_PASTA" (codigo, nome, menu_codigo, ordem)
SELECT 'atendimento_supervisores', 'Atendimento Supervisores',
       'whatsapp_pasta_atendimento_supervisores',
       coalesce((SELECT max(ordem) FROM public."WA_PASTA"), 16) + 1
WHERE NOT EXISTS (SELECT 1 FROM public."WA_PASTA" WHERE codigo = 'atendimento_supervisores');

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('whatsapp_pasta_atendimento_supervisores', 'WhatsApp — Pasta Atendimento Supervisores', NULL::text, 30),
    ('whatsapp_atd_fila',      'WhatsApp — Atendimento Supervisores (fila e protocolos)', '/app/whatsapp/atendimento', 6),
    ('whatsapp_atd_base',      'WhatsApp — Atendimento Supervisores (base e regras)',     '/app/whatsapp/atendimento/base', 7),
    ('whatsapp_atd_auditoria', 'WhatsApp — Atendimento Supervisores (auditoria)',         NULL::text, 31)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'whatsapp'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public."WA_CANAL" (codigo, nome, finalidade, restrito, menu_codigo, pasta_padrao, ativo, ia_ativa, setores)
VALUES
  ('principal', 'Número principal (recrutamento e geral)', 'geral', false, NULL, NULL, true, false, '{}'),
  ('supervisores', 'Atendimento corporativo dos supervisores', 'atendimento_supervisores', true,
   'whatsapp_atd_fila', 'atendimento_supervisores',
   -- Nasce DESLIGADO e sem número: liga depois do número corporativo cadastrado
   -- na Meta e do piloto definido (docs/sis-2026-0929-atendimento-whatsapp-ia.md).
   false, false,
   ARRAY['Supervisão', 'RH', 'Departamento Pessoal', 'SST', 'Operacional'])
ON CONFLICT (codigo) DO NOTHING;

DROP TRIGGER IF EXISTS trg_wa_canal_updated ON public."WA_CANAL";
CREATE TRIGGER trg_wa_canal_updated BEFORE UPDATE ON public."WA_CANAL"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Quem pode ver as conversas do canal. Canal não restrito = regra antiga.
CREATE OR REPLACE FUNCTION public.wa_pode_ver_canal(_canal text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."WA_CANAL" k
     WHERE k.codigo = _canal
       AND (NOT k.restrito
            OR (k.menu_codigo IS NOT NULL AND auth.uid() IS NOT NULL
                AND public.has_screen_access(auth.uid(), k.menu_codigo, 'visualizar'::public.app_acao)))
  )
$$;
REVOKE ALL ON FUNCTION public.wa_pode_ver_canal(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_pode_ver_canal(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wa_atd_pode(_acao text DEFAULT 'visualizar', _menu text DEFAULT 'whatsapp_atd_fila')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_screen_access(auth.uid(), _menu, _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.wa_atd_pode(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_pode(text, text) TO authenticated;

ALTER TABLE public."WA_CANAL" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."WA_CANAL" FROM PUBLIC, anon;
GRANT SELECT ON public."WA_CANAL" TO authenticated;
-- Ler: quem usa a Caixa de Entrada (precisa saber de que número responder)
-- ou as telas do atendimento. Gravar: só pela RPC wa_atd_canal_salvar.
DROP POLICY IF EXISTS wa_canal_select ON public."WA_CANAL";
CREATE POLICY wa_canal_select ON public."WA_CANAL" FOR SELECT TO authenticated
  USING ((SELECT public.tem_acesso_menu('whatsapp')) OR (SELECT public.wa_atd_pode('visualizar', 'whatsapp_atd_base'))
         OR (SELECT public.wa_atd_pode('visualizar', 'whatsapp_atd_fila')));

-- ── 2) Conversa por canal ────────────────────────────────────────────────
ALTER TABLE public."WA_CONVERSA"
  ADD COLUMN IF NOT EXISTS canal_codigo text NOT NULL DEFAULT 'principal';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wa_conversa_canal_fk') THEN
    ALTER TABLE public."WA_CONVERSA"
      ADD CONSTRAINT wa_conversa_canal_fk FOREIGN KEY (canal_codigo) REFERENCES public."WA_CANAL"(codigo);
  END IF;
END $$;

-- Troca UNIQUE (contato_id) por UNIQUE (contato_id, canal_codigo). Procura a
-- constraint pelo conteúdo, não pelo nome (o nome foi gerado pelo Postgres).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public."WA_CONVERSA"'::regclass
       AND c.contype = 'u'
       AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'public."WA_CONVERSA"'::regclass AND attname = 'contato_id')]::int2[]
  LOOP
    EXECUTE format('ALTER TABLE public."WA_CONVERSA" DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wa_conversa_contato_canal_key') THEN
    ALTER TABLE public."WA_CONVERSA"
      ADD CONSTRAINT wa_conversa_contato_canal_key UNIQUE (contato_id, canal_codigo);
  END IF;
END $$;
-- A UNIQUE acima começa por contato_id: não serve para filtrar/juntar por canal.
CREATE INDEX IF NOT EXISTS wa_conversa_canal_codigo_idx ON public."WA_CONVERSA" (canal_codigo);

-- As três RPCs que criam conversa — corpo IGUAL ao da 20260906000003, só
-- com o canal 'principal' explícito no SELECT e no ON CONFLICT. Sem isto o
-- ON CONFLICT (contato_id) quebraria (a constraint antiga não existe mais) e
-- o SELECT ... INTO pegaria uma conversa qualquer dos dois canais.
CREATE OR REPLACE FUNCTION public.wa_consultar_telefone(p_telefone text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_d text; v_nac text; v_ddd text; v_tail text;
  v_ct record;
  v_conversa uuid;
  v_pasta text;
  v_msgs bigint := 0;
  v_dentro boolean := false;
BEGIN
  IF NOT public.tem_acesso_menu('whatsapp') THEN
    RAISE EXCEPTION 'sem acesso a Caixa de Entrada do WhatsApp';
  END IF;

  v_d := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  IF length(v_d) < 10 THEN
    RETURN jsonb_build_object('valido', false);
  END IF;

  v_nac  := CASE WHEN left(v_d, 2) = '55' AND length(v_d) IN (12, 13)
                 THEN substr(v_d, 3) ELSE v_d END;
  v_ddd  := left(v_nac, 2);
  v_tail := right(v_nac, 8);

  SELECT id, wa_id, nome, nome_manual, etiquetas, observacao INTO v_ct
    FROM public."WA_CONTATO"
   WHERE wa_id LIKE '55' || v_ddd || '%'
     AND right(wa_id, 8) = v_tail
   ORDER BY (SELECT count(*) FROM public."WA_CONVERSA" cv
               JOIN public."WA_MENSAGEM" m ON m.conversa_id = cv.id
              WHERE cv.contato_id = "WA_CONTATO".id) DESC,
            created_at ASC
   LIMIT 1;

  IF v_ct.id IS NULL THEN
    RETURN jsonb_build_object('valido', true, 'existe', false);
  END IF;

  SELECT id, pasta_codigo INTO v_conversa, v_pasta
    FROM public."WA_CONVERSA" WHERE contato_id = v_ct.id AND canal_codigo = 'principal';
  IF v_conversa IS NOT NULL THEN
    SELECT count(*) INTO v_msgs FROM public."WA_MENSAGEM" WHERE conversa_id = v_conversa;
    SELECT EXISTS (
      SELECT 1 FROM public."WA_MENSAGEM"
       WHERE conversa_id = v_conversa AND direcao = 'entrada'
         AND criada_em > now() - interval '24 hours') INTO v_dentro;
  END IF;

  RETURN jsonb_build_object(
    'valido', true,
    'existe', true,
    'contato_id',    v_ct.id,
    'wa_id',         v_ct.wa_id,
    'nome',          v_ct.nome,
    'nome_manual',   v_ct.nome_manual,
    'etiquetas',     to_jsonb(coalesce(v_ct.etiquetas, '{}'::text[])),
    'observacao',    v_ct.observacao,
    'conversa_id',   v_conversa,
    'pasta_codigo',  v_pasta,
    'pode_ver',      v_conversa IS NULL OR public.wa_pode_ver_pasta(v_pasta),
    'tem_mensagens', v_msgs > 0,
    'dentro_janela', v_dentro
  );
END $$;
REVOKE ALL ON FUNCTION public.wa_consultar_telefone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_consultar_telefone(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_consultar_telefone(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wa_abrir_conversa_por_telefone(
  p_telefone text,
  p_nome     text DEFAULT NULL,
  p_pasta    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_contato  uuid;
  v_conversa uuid;
  v_nova     boolean;
  v_pasta    text;
  v_ct       record;
  v_msgs     bigint;
  v_dentro   boolean;
BEGIN
  IF NOT public.tem_acesso_menu('whatsapp') THEN
    RAISE EXCEPTION 'sem acesso a Caixa de Entrada do WhatsApp';
  END IF;

  IF p_pasta IS NOT NULL AND NOT public.wa_pode_ver_pasta(p_pasta) THEN
    RAISE EXCEPTION 'sem acesso a pasta %', p_pasta;
  END IF;

  v_contato := public.wa_contato_do_telefone(p_telefone);

  SELECT id INTO v_conversa FROM public."WA_CONVERSA" WHERE contato_id = v_contato AND canal_codigo = 'principal';
  v_nova := v_conversa IS NULL;
  IF v_nova THEN
    INSERT INTO public."WA_CONVERSA"(contato_id, pasta_codigo, canal_codigo) VALUES (v_contato, p_pasta, 'principal')
    ON CONFLICT (contato_id, canal_codigo) DO NOTHING;
    SELECT id INTO v_conversa FROM public."WA_CONVERSA" WHERE contato_id = v_contato AND canal_codigo = 'principal';
  END IF;

  SELECT pasta_codigo INTO v_pasta FROM public."WA_CONVERSA" WHERE id = v_conversa;
  IF NOT public.wa_pode_ver_pasta(v_pasta) THEN
    RAISE EXCEPTION 'este numero ja esta em atendimento numa pasta que voce nao acessa';
  END IF;

  IF coalesce(btrim(p_nome), '') <> '' THEN
    UPDATE public."WA_CONTATO" SET nome_manual = btrim(p_nome) WHERE id = v_contato;
  END IF;

  SELECT count(*) INTO v_msgs FROM public."WA_MENSAGEM" WHERE conversa_id = v_conversa;
  SELECT EXISTS (
    SELECT 1 FROM public."WA_MENSAGEM"
     WHERE conversa_id = v_conversa AND direcao = 'entrada'
       AND criada_em > now() - interval '24 hours') INTO v_dentro;

  SELECT wa_id, nome, nome_manual INTO v_ct
    FROM public."WA_CONTATO" WHERE id = v_contato;

  RETURN jsonb_build_object(
    'conversa_id',   v_conversa,
    'contato_id',    v_contato,
    'wa_id',         v_ct.wa_id,
    'nome',          v_ct.nome,
    'nome_manual',   v_ct.nome_manual,
    'pasta_codigo',  v_pasta,
    'conversa_nova', v_nova,
    'tem_mensagens', v_msgs > 0,
    'dentro_janela', v_dentro
  );
END $$;
REVOKE ALL ON FUNCTION public.wa_abrir_conversa_por_telefone(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_abrir_conversa_por_telefone(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_abrir_conversa_por_telefone(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.recrutamento_abrir_conversa(p_candidato_id bigint)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tel      text;
  v_contato  uuid;
  v_conversa uuid;
BEGIN
  SELECT telefone INTO v_tel FROM public."WA_CURRICULOS" WHERE id = p_candidato_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidato % nao encontrado', p_candidato_id;
  END IF;

  v_contato := public.wa_contato_do_telefone(v_tel);

  SELECT id INTO v_conversa FROM public."WA_CONVERSA" WHERE contato_id = v_contato AND canal_codigo = 'principal';
  IF v_conversa IS NULL THEN
    INSERT INTO public."WA_CONVERSA"(contato_id, canal_codigo) VALUES (v_contato, 'principal')
    ON CONFLICT (contato_id, canal_codigo) DO NOTHING;
    SELECT id INTO v_conversa FROM public."WA_CONVERSA" WHERE contato_id = v_contato AND canal_codigo = 'principal';
  END IF;

  RETURN v_conversa;
END $$;
REVOKE ALL ON FUNCTION public.recrutamento_abrir_conversa(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recrutamento_abrir_conversa(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.recrutamento_abrir_conversa(bigint) TO authenticated;

-- RLS da conversa: a expressão da 20261103004100 (InitPlan + pasta por
-- lista) MAIS a trava do canal, também resolvida por lista (2 canais → a
-- função roda 2 vezes por consulta, não uma por linha).
ALTER POLICY wa_conversa_rw ON public."WA_CONVERSA"
  USING (
    (SELECT public.tem_acesso_menu('whatsapp'::text))
    AND (
         (pasta_codigo IS NULL AND (SELECT public.wa_pode_ver_pasta(NULL::text)))
      OR pasta_codigo IN (SELECT p.codigo
                            FROM public."WA_PASTA" p
                           WHERE public.wa_pode_ver_pasta(p.codigo))
    )
    AND canal_codigo IN (SELECT k.codigo FROM public."WA_CANAL" k WHERE public.wa_pode_ver_canal(k.codigo))
  )
  WITH CHECK (
    (SELECT public.tem_acesso_menu('whatsapp'::text))
    AND (
         (pasta_codigo IS NULL AND (SELECT public.wa_pode_ver_pasta(NULL::text)))
      OR pasta_codigo IN (SELECT p.codigo
                            FROM public."WA_PASTA" p
                           WHERE public.wa_pode_ver_pasta(p.codigo))
    )
    AND canal_codigo IN (SELECT k.codigo FROM public."WA_CANAL" k WHERE public.wa_pode_ver_canal(k.codigo))
  );

-- ── 3) Protocolo de atendimento ──────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.wa_atendimento_protocolo_seq;

-- ATD-AAAA-NNNNNN. Ano do horário de Brasília; o número não reinicia no ano
-- (sequência única = nunca dois protocolos iguais, nem na virada).
CREATE OR REPLACE FUNCTION public.wa_atd_novo_protocolo()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public, pg_temp AS $$
  SELECT 'ATD-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY') || '-'
         || lpad(nextval('public.wa_atendimento_protocolo_seq')::text, 6, '0')
$$;
REVOKE ALL ON FUNCTION public.wa_atd_novo_protocolo() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public."WA_ATENDIMENTO" (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo                  text NOT NULL UNIQUE DEFAULT public.wa_atd_novo_protocolo(),
  conversa_id                uuid NOT NULL REFERENCES public."WA_CONVERSA"(id) ON DELETE CASCADE,
  canal_codigo               text NOT NULL REFERENCES public."WA_CANAL"(codigo),
  status                     text NOT NULL DEFAULT 'ia'
                             CHECK (status IN ('ia', 'aguardando_humano', 'em_atendimento_humano', 'concluido')),
  assunto                    text,            -- categoria/assunto principal
  sensivel                   boolean NOT NULL DEFAULT false,
  resumo                     text,            -- resumo para quem assume
  motivo_encaminhamento      text,
  -- Quem escreve, como o cadastro disse NA ABERTURA (a consulta revalida na hora).
  solicitante_empregado_id   bigint,
  solicitante_papel          text,
  contrato_id                uuid,            -- contrato/posto vinculado, quando aplicável
  responsavel_id             uuid REFERENCES auth.users(id),
  setor                      text,
  aberto_em                  timestamptz NOT NULL DEFAULT now(),
  aviso_enviado_em           timestamptz,
  ultima_entrada_em          timestamptz,
  aguardando_desde           timestamptz,
  primeira_resposta_ia_em    timestamptz,
  primeira_resposta_humana_em timestamptz,
  assumido_em                timestamptz,
  assumido_por               uuid REFERENCES auth.users(id),
  concluido_em               timestamptz,
  concluido_por              uuid REFERENCES auth.users(id),
  resolucao                  text,
  resolvido_pela_ia          boolean,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
-- Um atendimento aberto por conversa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_atendimento_aberto
  ON public."WA_ATENDIMENTO"(conversa_id) WHERE status <> 'concluido';
CREATE INDEX IF NOT EXISTS idx_wa_atendimento_status ON public."WA_ATENDIMENTO"(status, aguardando_desde);
CREATE INDEX IF NOT EXISTS idx_wa_atendimento_aberto_em ON public."WA_ATENDIMENTO"(aberto_em DESC);
CREATE INDEX IF NOT EXISTS idx_wa_atendimento_responsavel ON public."WA_ATENDIMENTO"(responsavel_id) WHERE status <> 'concluido';
CREATE INDEX IF NOT EXISTS wa_atendimento_canal_codigo_idx ON public."WA_ATENDIMENTO" (canal_codigo);
CREATE INDEX IF NOT EXISTS wa_atendimento_assumido_por_idx ON public."WA_ATENDIMENTO" (assumido_por);
CREATE INDEX IF NOT EXISTS wa_atendimento_concluido_por_idx ON public."WA_ATENDIMENTO" (concluido_por);

DROP TRIGGER IF EXISTS trg_wa_atendimento_updated ON public."WA_ATENDIMENTO";
CREATE TRIGGER trg_wa_atendimento_updated BEFORE UPDATE ON public."WA_ATENDIMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public."WA_MENSAGEM"
  ADD COLUMN IF NOT EXISTS atendimento_id uuid REFERENCES public."WA_ATENDIMENTO"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wa_mensagem_atendimento
  ON public."WA_MENSAGEM"(atendimento_id, criada_em) WHERE atendimento_id IS NOT NULL;

ALTER TABLE public."WA_ATENDIMENTO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."WA_ATENDIMENTO" FROM PUBLIC, anon;
GRANT SELECT ON public."WA_ATENDIMENTO" TO authenticated;
DROP POLICY IF EXISTS wa_atendimento_select ON public."WA_ATENDIMENTO";
CREATE POLICY wa_atendimento_select ON public."WA_ATENDIMENTO" FOR SELECT TO authenticated
  USING ((SELECT public.wa_atd_pode('visualizar', 'whatsapp_atd_fila')));

-- 3a) Toda mensagem do canal de atendimento entra num protocolo. A primeira
-- mensagem RECEBIDA sem protocolo aberto abre um novo. Fica no banco (e não
-- no webhook) para valer também para o que a Caixa de Entrada grava.
CREATE OR REPLACE FUNCTION public.wa_atd_mensagem_vincular()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_canal  text;
  v_fin    text;
  v_ia     boolean;
  v_ativo  boolean;
  v_bot    boolean;
  v_atd    uuid;
BEGIN
  IF NEW.atendimento_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT c.canal_codigo, k.finalidade, k.ia_ativa, k.ativo, c.bot_ativo
    INTO v_canal, v_fin, v_ia, v_ativo, v_bot
    FROM public."WA_CONVERSA" c
    JOIN public."WA_CANAL" k ON k.codigo = c.canal_codigo
   WHERE c.id = NEW.conversa_id;
  IF v_fin IS DISTINCT FROM 'atendimento_supervisores' THEN RETURN NEW; END IF;

  SELECT a.id INTO v_atd FROM public."WA_ATENDIMENTO" a
   WHERE a.conversa_id = NEW.conversa_id AND a.status <> 'concluido';

  IF v_atd IS NULL AND NEW.direcao = 'entrada' THEN
    INSERT INTO public."WA_ATENDIMENTO" (conversa_id, canal_codigo, status, aguardando_desde, ultima_entrada_em)
    VALUES (NEW.conversa_id, v_canal,
            CASE WHEN v_ativo AND v_ia AND v_bot THEN 'ia' ELSE 'aguardando_humano' END,
            CASE WHEN v_ativo AND v_ia AND v_bot THEN NULL ELSE now() END,
            now())
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_atd;
    IF v_atd IS NULL THEN  -- corrida: outra entrega abriu no mesmo instante
      SELECT a.id INTO v_atd FROM public."WA_ATENDIMENTO" a
       WHERE a.conversa_id = NEW.conversa_id AND a.status <> 'concluido';
    END IF;
  END IF;

  NEW.atendimento_id := v_atd;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_mensagem_vincular() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_wa_atd_mensagem_vincular ON public."WA_MENSAGEM";
CREATE TRIGGER trg_wa_atd_mensagem_vincular
  BEFORE INSERT ON public."WA_MENSAGEM"
  FOR EACH ROW EXECUTE FUNCTION public.wa_atd_mensagem_vincular();

-- 3b) Efeitos da mensagem no protocolo: quem respondeu e quando.
CREATE OR REPLACE FUNCTION public.wa_atd_mensagem_efeitos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.atendimento_id IS NULL THEN RETURN NULL; END IF;
  IF NEW.direcao = 'entrada' THEN
    UPDATE public."WA_ATENDIMENTO" SET ultima_entrada_em = NEW.criada_em
     WHERE id = NEW.atendimento_id AND status <> 'concluido';
  ELSIF NEW.origem = 'bot' THEN
    UPDATE public."WA_ATENDIMENTO"
       SET primeira_resposta_ia_em = coalesce(primeira_resposta_ia_em, NEW.criada_em)
     WHERE id = NEW.atendimento_id;
  ELSIF NEW.origem = 'atendente' THEN
    -- Uma pessoa respondeu: o atendimento é humano a partir daqui.
    UPDATE public."WA_ATENDIMENTO"
       SET primeira_resposta_humana_em = coalesce(primeira_resposta_humana_em, NEW.criada_em),
           status        = CASE WHEN status IN ('ia', 'aguardando_humano') THEN 'em_atendimento_humano' ELSE status END,
           assumido_em   = coalesce(assumido_em, NEW.criada_em),
           assumido_por  = coalesce(assumido_por, NEW.autor_id),
           responsavel_id = coalesce(responsavel_id, NEW.autor_id)
     WHERE id = NEW.atendimento_id AND status <> 'concluido';
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_mensagem_efeitos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_wa_atd_mensagem_efeitos ON public."WA_MENSAGEM";
CREATE TRIGGER trg_wa_atd_mensagem_efeitos
  AFTER INSERT ON public."WA_MENSAGEM"
  FOR EACH ROW EXECUTE FUNCTION public.wa_atd_mensagem_efeitos();

-- 3c) Ações da Caixa de Entrada viram status do protocolo:
--   desligar o bot  → em_atendimento_humano (pessoa) / aguardando_humano (webhook)
--   religar o bot   → ia
--   mover para "Atendimento Concluído" → concluido
CREATE OR REPLACE FUNCTION public.wa_atd_conversa_sincronizar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_fin text;
  v_ia  boolean;
BEGIN
  SELECT k.finalidade, k.ativo AND k.ia_ativa INTO v_fin, v_ia FROM public."WA_CANAL" k WHERE k.codigo = NEW.canal_codigo;
  IF v_fin IS DISTINCT FROM 'atendimento_supervisores' THEN RETURN NULL; END IF;

  IF NEW.pasta_codigo = 'atendimento_concluido' AND OLD.pasta_codigo IS DISTINCT FROM 'atendimento_concluido' THEN
    UPDATE public."WA_ATENDIMENTO" a
       SET status = 'concluido', concluido_em = now(), concluido_por = v_uid,
           resolvido_pela_ia = NOT EXISTS (SELECT 1 FROM public."WA_MENSAGEM" m
                                            WHERE m.atendimento_id = a.id AND m.origem = 'atendente'),
           resolucao = coalesce(a.resolucao,
                         CASE WHEN NEW.concluida_por_contato THEN 'Encerrado pelo próprio contato.'
                              ELSE 'Concluído pela Caixa de Entrada.' END)
     WHERE a.conversa_id = NEW.id AND a.status <> 'concluido';
    RETURN NULL;
  END IF;

  IF NEW.bot_ativo IS DISTINCT FROM OLD.bot_ativo THEN
    IF NEW.bot_ativo THEN
      -- Com a I.A do canal desligada, religar o bot não pode tirar o protocolo
      -- da fila: ninguém responderia e ele ficaria parado em "I.A".
      IF v_ia THEN
        UPDATE public."WA_ATENDIMENTO" SET status = 'ia', aguardando_desde = NULL
         WHERE conversa_id = NEW.id AND status IN ('aguardando_humano', 'em_atendimento_humano');
      END IF;
    ELSIF v_uid IS NOT NULL THEN
      UPDATE public."WA_ATENDIMENTO"
         SET status = 'em_atendimento_humano', assumido_em = coalesce(assumido_em, now()),
             assumido_por = coalesce(assumido_por, v_uid), responsavel_id = coalesce(responsavel_id, v_uid)
       WHERE conversa_id = NEW.id AND status IN ('ia', 'aguardando_humano');
    ELSE
      UPDATE public."WA_ATENDIMENTO" SET status = 'aguardando_humano', aguardando_desde = coalesce(aguardando_desde, now())
       WHERE conversa_id = NEW.id AND status = 'ia';
    END IF;
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_conversa_sincronizar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_wa_atd_conversa_sincronizar ON public."WA_CONVERSA";
CREATE TRIGGER trg_wa_atd_conversa_sincronizar
  AFTER UPDATE OF bot_ativo, pasta_codigo ON public."WA_CONVERSA"
  FOR EACH ROW EXECUTE FUNCTION public.wa_atd_conversa_sincronizar();

-- ── 4) Regras de dados ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."WA_ATD_REGRA_DADO" (
  categoria       text PRIMARY KEY,
  nome            text NOT NULL,
  sensivel        boolean NOT NULL DEFAULT true,
  proprio         boolean NOT NULL DEFAULT false,
  encarregado     boolean NOT NULL DEFAULT false,
  supervisor      boolean NOT NULL DEFAULT false,
  palavras_chave  text[] NOT NULL DEFAULT '{}',
  ordem           integer NOT NULL DEFAULT 0,
  ativo           boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  -- Sensível NUNCA sai pelo bot: nem do próprio, nem com vínculo de gestão.
  CONSTRAINT wa_atd_regra_sensivel_fechada CHECK (NOT sensivel OR (NOT proprio AND NOT encarregado AND NOT supervisor))
);

INSERT INTO public."WA_ATD_REGRA_DADO" (categoria, nome, sensivel, proprio, encarregado, supervisor, palavras_chave, ordem) VALUES
  ('cadastro_basico', 'Cargo, contrato e posto', false, true, true, false, '{}', 1),
  ('escala', 'Escala de trabalho', false, true, true, false, '{}', 2),
  ('admissao', 'Data de admissão', false, true, true, false, '{}', 3),
  ('situacao', 'Situação (trabalhando / férias / afastado, sem o motivo)', false, true, true, false, '{}', 4),
  ('remuneracao', 'Salário, holerite e pagamentos', true, false, false, false,
     ARRAY['salario','salário','holerite','contracheque','contra-cheque','pagamento','adiantamento','vale','bonus','bônus','hora extra','horas extras','desconto'], 10),
  ('saude', 'Atestado, CID, exames e saúde', true, false, false, false,
     ARRAY['atestado','cid','laudo','aso','exame','doenca','doença','afastamento medico','afastamento médico','licenca medica','licença médica','inss','gestante','gravidez'], 11),
  ('disciplinar', 'Advertência, suspensão e medidas disciplinares', true, false, false, false,
     ARRAY['advertencia','advertência','suspensao','suspensão','justa causa','punicao','punição','ocorrencia disciplinar','ocorrência disciplinar'], 12),
  ('bancario', 'Dados bancários e PIX', true, false, false, false,
     ARRAY['conta bancaria','conta bancária','agencia','agência','banco','pix','chave pix'], 13),
  ('documentos', 'Documentos pessoais (CPF, RG, CTPS, PIS)', true, false, false, false,
     ARRAY['cpf','rg','ctps','carteira de trabalho','pis','titulo de eleitor','título de eleitor'], 14),
  ('endereco_contato', 'Endereço e telefone de colaborador', true, false, false, false,
     ARRAY['endereco','endereço','onde mora','telefone dele','telefone dela','numero dele','número dele','numero dela','número dela'], 15),
  ('rescisao', 'Demissão, rescisão e aviso prévio', true, false, false, false,
     ARRAY['demissao','demissão','rescisao','rescisão','aviso previo','aviso prévio','desligamento','acerto'], 16),
  ('denuncia', 'Assédio, denúncia e Canal de Ética', true, false, false, false,
     ARRAY['assedio','assédio','denuncia','denúncia','discriminacao','discriminação','abuso'], 17)
ON CONFLICT (categoria) DO NOTHING;

ALTER TABLE public."WA_ATD_REGRA_DADO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."WA_ATD_REGRA_DADO" FROM PUBLIC, anon;
GRANT SELECT ON public."WA_ATD_REGRA_DADO" TO authenticated;
DROP POLICY IF EXISTS wa_atd_regra_select ON public."WA_ATD_REGRA_DADO";
CREATE POLICY wa_atd_regra_select ON public."WA_ATD_REGRA_DADO" FOR SELECT TO authenticated
  USING ((SELECT public.wa_atd_pode('visualizar', 'whatsapp_atd_base')) OR (SELECT public.wa_atd_pode('visualizar', 'whatsapp_atd_fila')));

-- ── 5) Base de conhecimento aprovada ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."WA_ATD_BASE" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo            text NOT NULL,
  conteudo          text NOT NULL,
  assunto           text,
  area_responsavel  text,
  ativo             boolean NOT NULL DEFAULT true,
  aprovado          boolean NOT NULL DEFAULT false,
  aprovado_por      uuid REFERENCES auth.users(id),
  aprovado_em       timestamptz,
  versao            integer NOT NULL DEFAULT 1,
  criado_por        uuid REFERENCES auth.users(id),
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_por    uuid REFERENCES auth.users(id),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_atd_base_aprovado_por_idx ON public."WA_ATD_BASE" (aprovado_por);
CREATE INDEX IF NOT EXISTS wa_atd_base_criado_por_idx ON public."WA_ATD_BASE" (criado_por);
CREATE INDEX IF NOT EXISTS wa_atd_base_atualizado_por_idx ON public."WA_ATD_BASE" (atualizado_por);

CREATE TABLE IF NOT EXISTS public."WA_ATD_BASE_HIST" (
  id          bigserial PRIMARY KEY,
  base_id     uuid NOT NULL,
  acao        text NOT NULL,          -- criado | alterado | aprovado | desativado | excluido
  versao      integer,
  titulo      text,
  conteudo    text,
  autor_id    uuid,
  criada_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_atd_base_hist ON public."WA_ATD_BASE_HIST"(base_id, criada_em DESC);

ALTER TABLE public."WA_ATD_BASE" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WA_ATD_BASE_HIST" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."WA_ATD_BASE", public."WA_ATD_BASE_HIST" FROM PUBLIC, anon;
GRANT SELECT ON public."WA_ATD_BASE", public."WA_ATD_BASE_HIST" TO authenticated;
DROP POLICY IF EXISTS wa_atd_base_select ON public."WA_ATD_BASE";
CREATE POLICY wa_atd_base_select ON public."WA_ATD_BASE" FOR SELECT TO authenticated
  USING ((SELECT public.wa_atd_pode('visualizar', 'whatsapp_atd_base')));
DROP POLICY IF EXISTS wa_atd_base_hist_select ON public."WA_ATD_BASE_HIST";
CREATE POLICY wa_atd_base_hist_select ON public."WA_ATD_BASE_HIST" FOR SELECT TO authenticated
  USING ((SELECT public.wa_atd_pode('visualizar', 'whatsapp_atd_base')));

-- ── 6) Revisão das respostas, consultas e acessos ────────────────────────
CREATE TABLE IF NOT EXISTS public."WA_ATD_REVISAO" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mensagem_id     uuid NOT NULL UNIQUE REFERENCES public."WA_MENSAGEM"(id) ON DELETE CASCADE,
  atendimento_id  uuid REFERENCES public."WA_ATENDIMENTO"(id) ON DELETE CASCADE,
  avaliacao       text NOT NULL CHECK (avaliacao IN ('correta', 'incompleta', 'incorreta')),
  comentario      text,
  base_id         uuid REFERENCES public."WA_ATD_BASE"(id) ON DELETE SET NULL,
  revisor_id      uuid REFERENCES auth.users(id),
  revisado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_atd_revisao_atendimento_id_idx ON public."WA_ATD_REVISAO" (atendimento_id);
CREATE INDEX IF NOT EXISTS wa_atd_revisao_base_id_idx ON public."WA_ATD_REVISAO" (base_id);
CREATE INDEX IF NOT EXISTS wa_atd_revisao_revisor_id_idx ON public."WA_ATD_REVISAO" (revisor_id);

CREATE TABLE IF NOT EXISTS public."WA_ATD_CONSULTA_LOG" (
  id                        bigserial PRIMARY KEY,
  atendimento_id            uuid REFERENCES public."WA_ATENDIMENTO"(id) ON DELETE SET NULL,
  wa_id                     text,
  solicitante_empregado_id  bigint,
  solicitante_papel         text,
  categoria                 text,
  alvo_termo                text,
  alvo_empregado_id         bigint,
  resultado                 text NOT NULL CHECK (resultado IN ('autorizada', 'negada')),
  motivo                    text NOT NULL,
  criada_em                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_atd_consulta_data ON public."WA_ATD_CONSULTA_LOG"(criada_em DESC);
CREATE INDEX IF NOT EXISTS idx_wa_atd_consulta_atd ON public."WA_ATD_CONSULTA_LOG"(atendimento_id);

CREATE TABLE IF NOT EXISTS public."WA_ATD_ACESSO_LOG" (
  id              bigserial PRIMARY KEY,
  user_id         uuid,
  acao            text NOT NULL,
  atendimento_id  uuid,
  detalhe         jsonb,
  criada_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_atd_acesso_data ON public."WA_ATD_ACESSO_LOG"(criada_em DESC);

ALTER TABLE public."WA_ATD_REVISAO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WA_ATD_CONSULTA_LOG" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WA_ATD_ACESSO_LOG" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."WA_ATD_REVISAO", public."WA_ATD_CONSULTA_LOG", public."WA_ATD_ACESSO_LOG" FROM PUBLIC, anon;
GRANT SELECT ON public."WA_ATD_REVISAO" TO authenticated;
DROP POLICY IF EXISTS wa_atd_revisao_select ON public."WA_ATD_REVISAO";
CREATE POLICY wa_atd_revisao_select ON public."WA_ATD_REVISAO" FOR SELECT TO authenticated
  USING ((SELECT public.wa_atd_pode('visualizar', 'whatsapp_atd_base')));
-- Logs: sem GRANT para authenticated. Leitura só por wa_atd_auditoria().

CREATE OR REPLACE FUNCTION public.wa_atd_log(_acao text, _atendimento uuid, _detalhe jsonb DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public."WA_ATD_ACESSO_LOG" (user_id, acao, atendimento_id, detalhe)
  VALUES (auth.uid(), _acao, _atendimento, _detalhe)
$$;
REVOKE ALL ON FUNCTION public.wa_atd_log(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 7) Autorização por número (service_role — chamado pelo webhook) ──────
-- Chave do telefone: DDD + 8 últimos (espelho de chaveTelefone() no TS).
CREATE OR REPLACE FUNCTION public.wa_atd_chave_telefone(_tel text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  WITH d AS (SELECT regexp_replace(coalesce(_tel, ''), '\D', '', 'g') AS d),
       n AS (SELECT CASE WHEN left(d, 2) = '55' AND length(d) IN (12, 13) THEN substr(d, 3) ELSE d END AS n FROM d)
  SELECT CASE WHEN length(n) >= 10 THEN left(n, 2) || right(n, 8) END FROM n
$$;
REVOKE ALL ON FUNCTION public.wa_atd_chave_telefone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_chave_telefone(text) TO authenticated;

-- Quem é o dono deste número AGORA (espelho de identificarSolicitante()).
CREATE OR REPLACE FUNCTION public.wa_atd_identificar(p_wa_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_chave text := public.wa_atd_chave_telefone(p_wa_id);
  v_ids   bigint[];
  v_id    bigint;
  v_nome  text;
  v_enc   uuid[];
  v_sup   uuid[];
  v_ctr   uuid;
BEGIN
  IF v_chave IS NULL THEN
    RETURN jsonb_build_object('papel', 'desconhecido', 'motivo', 'numero_invalido');
  END IF;

  SELECT array_agg(DISTINCT e."ID"::bigint) INTO v_ids
    FROM public."EMPREGADOS" e
   WHERE public.esp_col_esta_ativo(e."Situação")
     AND public.wa_atd_chave_telefone(e.telefone) = v_chave;

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('papel', 'desconhecido', 'motivo', 'numero_nao_cadastrado');
  END IF;
  IF cardinality(v_ids) > 1 THEN
    RETURN jsonb_build_object('papel', 'divergente', 'motivo', 'numero_em_mais_de_um_cadastro');
  END IF;

  v_id := v_ids[1];
  SELECT e."Nome" INTO v_nome FROM public."EMPREGADOS" e WHERE e."ID" = v_id LIMIT 1;
  SELECT coalesce(array_agg(DISTINCT o.contrato_id ORDER BY o.contrato_id), '{}') INTO v_enc
    FROM public."OPE_ORG_CONTRATO" o WHERE o.encarregado_id = v_id;
  SELECT coalesce(array_agg(DISTINCT o.contrato_id ORDER BY o.contrato_id), '{}') INTO v_sup
    FROM public."OPE_ORG_CONTRATO" o WHERE o.supervisor_id = v_id;
  SELECT a.contrato_id INTO v_ctr FROM public.rh_ac_ativos() a WHERE a.empregado_id = v_id LIMIT 1;

  RETURN jsonb_build_object(
    'papel', CASE WHEN cardinality(v_enc) > 0 THEN 'encarregado'
                  WHEN cardinality(v_sup) > 0 THEN 'supervisor'
                  ELSE 'colaborador' END,
    'empregado_id', v_id,
    'primeiro_nome', split_part(btrim(coalesce(v_nome, '')), ' ', 1),
    'contrato_id', v_ctr,
    'contratos_encarregado', to_jsonb(v_enc),
    'contratos_supervisor', to_jsonb(v_sup),
    'motivo', NULL);
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_identificar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_atd_identificar(text) TO service_role;

-- Consulta de dado de colaborador (espelho de decidirConsulta()). Revalida o
-- número e o vínculo NA HORA, procura o alvo SÓ dentro do universo de quem
-- pergunta (ele + colaboradores dos contratos que gere) e registra tudo.
CREATE OR REPLACE FUNCTION public.wa_atd_consultar(p_atendimento uuid, p_wa_id text, p_categoria text, p_alvo text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ident   jsonb := public.wa_atd_identificar(p_wa_id);
  v_papel   text := v_ident->>'papel';
  v_eu      bigint := nullif(v_ident->>'empregado_id', '')::bigint;
  v_regra   public."WA_ATD_REGRA_DADO";
  v_termo   text := btrim(coalesce(p_alvo, ''));
  v_t       text := lower(regexp_replace(btrim(coalesce(p_alvo, '')), '[^[:alnum:] ]', '', 'g'));
  v_proprio boolean;
  v_alvos   bigint[];
  v_alvo    bigint;
  v_ctr_alvo uuid;
  v_motivo  text;
  v_ok      boolean := false;
  v_dados   jsonb;
  v_e       record;
BEGIN
  v_proprio := v_t IN ('', 'eu', 'meu', 'minha', 'meus', 'minhas', 'proprio', 'propria', 'mim', 'o meu', 'a minha');
  SELECT * INTO v_regra FROM public."WA_ATD_REGRA_DADO" r WHERE r.categoria = lower(coalesce(p_categoria, '')) AND r.ativo;

  IF v_papel = 'desconhecido' OR v_eu IS NULL AND v_papel <> 'divergente' THEN
    v_motivo := 'numero_nao_cadastrado';
  ELSIF v_papel = 'divergente' THEN
    v_motivo := 'cadastro_divergente';
  ELSIF v_regra.categoria IS NULL THEN
    v_motivo := 'categoria_desconhecida';
  ELSIF v_regra.sensivel THEN
    v_motivo := 'categoria_sensivel';
  ELSIF v_proprio THEN
    v_alvo := v_eu;
    IF v_regra.proprio THEN v_ok := true; v_motivo := 'proprio'; ELSE v_motivo := 'funcao_nao_permite'; END IF;
  ELSE
    -- Universo: o próprio + colaboradores ativos dos contratos em que ele é
    -- encarregado ou supervisor. Casa por matrícula exata ou nome contendo o termo.
    -- rh_ac_ativos() lê a EMPREGADOS inteira: UMA chamada, que já traz o
    -- contrato do alvo junto.
    SELECT array_agg(DISTINCT a.empregado_id), (array_agg(a.contrato_id))[1] INTO v_alvos, v_ctr_alvo
      FROM public.rh_ac_ativos() a
     WHERE (a.empregado_id = v_eu
            OR a.contrato_id IN (SELECT (jsonb_array_elements_text(v_ident->'contratos_encarregado'))::uuid
                                 UNION
                                 SELECT (jsonb_array_elements_text(v_ident->'contratos_supervisor'))::uuid))
       AND length(v_t) >= 3
       AND (a.cadastro = regexp_replace(v_termo, '\D', '', 'g')
            OR lower(regexp_replace(coalesce(a.nome, ''), '[^[:alnum:] ]', '', 'g')) LIKE '%' || v_t || '%');

    IF v_alvos IS NULL OR cardinality(v_alvos) = 0 THEN
      v_motivo := 'alvo_nao_encontrado';
    ELSIF cardinality(v_alvos) > 1 THEN
      v_motivo := 'alvo_ambiguo';
    ELSE
      v_alvo := v_alvos[1];
      IF v_alvo = v_eu THEN
        IF v_regra.proprio THEN v_ok := true; v_motivo := 'proprio'; ELSE v_motivo := 'funcao_nao_permite'; END IF;
      ELSIF v_ctr_alvo IS NOT NULL AND v_ident->'contratos_encarregado' ? v_ctr_alvo::text THEN
        IF v_regra.encarregado THEN v_ok := true; v_motivo := 'subordinado'; ELSE v_motivo := 'funcao_nao_permite'; END IF;
      ELSIF v_ctr_alvo IS NOT NULL AND v_ident->'contratos_supervisor' ? v_ctr_alvo::text THEN
        IF v_regra.supervisor THEN v_ok := true; v_motivo := 'supervisionado'; ELSE v_motivo := 'funcao_nao_permite'; END IF;
      ELSE
        v_motivo := 'alvo_nao_encontrado';
      END IF;
    END IF;
  END IF;

  IF v_ok THEN
    SELECT e."Nome" AS nome, e."Título do Cargo" AS cargo, e."Nome Filial" AS contrato,
           e."Nome do Posto" AS posto, e."Escala" AS escala, e."Admissão"::text AS admissao,
           e."Situação" AS situacao
      INTO v_e FROM public."EMPREGADOS" e WHERE e."ID" = v_alvo LIMIT 1;
    -- SÓ os campos da categoria pedida (dado mínimo necessário).
    v_dados := jsonb_build_object('primeiro_nome', split_part(btrim(coalesce(v_e.nome, '')), ' ', 1))
      || CASE v_regra.categoria
           WHEN 'cadastro_basico' THEN jsonb_build_object('cargo', v_e.cargo, 'contrato', v_e.contrato, 'posto', v_e.posto)
           WHEN 'escala'   THEN jsonb_build_object('escala', v_e.escala)
           WHEN 'admissao' THEN jsonb_build_object('admissao', v_e.admissao)
           -- Situação sem o motivo: "Auxílio doença" é dado de saúde.
           WHEN 'situacao' THEN jsonb_build_object('situacao',
                  CASE WHEN v_e.situacao ILIKE '%f_rias%' THEN 'em férias'
                       WHEN v_e.situacao ILIKE 'trabalhando%' THEN 'trabalhando'
                       ELSE 'afastado ou em outra situação — o motivo é tratado com o RH' END)
           ELSE '{}'::jsonb
         END;
  END IF;

  INSERT INTO public."WA_ATD_CONSULTA_LOG"
    (atendimento_id, wa_id, solicitante_empregado_id, solicitante_papel, categoria, alvo_termo, alvo_empregado_id, resultado, motivo)
  VALUES (p_atendimento, p_wa_id, v_eu, v_papel, lower(coalesce(p_categoria, '')), left(v_termo, 120),
          CASE WHEN v_ok THEN v_alvo END, CASE WHEN v_ok THEN 'autorizada' ELSE 'negada' END, v_motivo);

  RETURN jsonb_build_object('autorizada', v_ok, 'motivo', v_motivo, 'proprio', v_ok AND v_alvo = v_eu,
                            'dados', CASE WHEN v_ok THEN v_dados END);
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_consultar(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_atd_consultar(uuid, text, text, text) TO service_role;

-- ── 8) RPCs do webhook (service_role) ────────────────────────────────────
-- Prepara o protocolo aberto: identifica quem escreve, liga ao contrato e ao
-- responsável (supervisor do contrato, pelo Organograma Operacional), devolve
-- a conversa à pasta do canal se ela estava em "Concluído" e RESERVA o envio
-- do aviso de abertura (um UPDATE atômico: duas entregas da Meta não mandam
-- o aviso duas vezes).
CREATE OR REPLACE FUNCTION public.wa_atd_preparar(p_conversa uuid, p_wa_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_atd    public."WA_ATENDIMENTO";
  v_ident  jsonb;
  v_ctr    uuid;
  v_resp   uuid;
  v_aviso  boolean := false;
  v_canal  public."WA_CANAL";
  v_conv   record;
BEGIN
  SELECT * INTO v_atd FROM public."WA_ATENDIMENTO" WHERE conversa_id = p_conversa AND status <> 'concluido';
  IF v_atd.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_canal FROM public."WA_CANAL" WHERE codigo = v_atd.canal_codigo;
  SELECT c.pasta_codigo, c.bot_ativo INTO v_conv FROM public."WA_CONVERSA" c WHERE c.id = p_conversa;

  IF v_atd.solicitante_papel IS NULL THEN
    v_ident := public.wa_atd_identificar(p_wa_id);
    v_ctr := coalesce(nullif(v_ident->>'contrato_id', '')::uuid,
                      nullif(v_ident->'contratos_encarregado'->>0, '')::uuid,
                      nullif(v_ident->'contratos_supervisor'->>0, '')::uuid);
    SELECT e.auth_user_id INTO v_resp
      FROM public."OPE_ORG_CONTRATO" o JOIN public."EMPREGADOS" e ON e."ID" = o.supervisor_id
     WHERE o.contrato_id = v_ctr AND e.auth_user_id IS NOT NULL LIMIT 1;
    UPDATE public."WA_ATENDIMENTO"
       SET solicitante_papel = v_ident->>'papel',
           solicitante_empregado_id = nullif(v_ident->>'empregado_id', '')::bigint,
           contrato_id = v_ctr,
           responsavel_id = coalesce(responsavel_id, v_resp)
     WHERE id = v_atd.id
     RETURNING * INTO v_atd;
  END IF;

  -- Conversa voltando de "Concluído" (ou sem pasta) vai para a fila do canal.
  IF v_canal.pasta_padrao IS NOT NULL AND v_conv.pasta_codigo IS DISTINCT FROM v_canal.pasta_padrao THEN
    UPDATE public."WA_CONVERSA"
       SET pasta_codigo = v_canal.pasta_padrao,
           bot_ativo = CASE WHEN v_atd.status = 'ia' THEN true ELSE bot_ativo END
     WHERE id = p_conversa;
  END IF;

  UPDATE public."WA_ATENDIMENTO" SET aviso_enviado_em = now()
   WHERE id = v_atd.id AND aviso_enviado_em IS NULL;
  v_aviso := FOUND;

  RETURN jsonb_build_object(
    'atendimento_id', v_atd.id, 'protocolo', v_atd.protocolo, 'status', v_atd.status,
    'enviar_aviso', v_aviso,
    'identificacao', coalesce(v_ident, public.wa_atd_identificar(p_wa_id)));
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_preparar(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_atd_preparar(uuid, text) TO service_role;

-- A I.A (ou a regra) passou para humano: fila com resumo e motivo.
CREATE OR REPLACE FUNCTION public.wa_atd_bot_encaminhar(p_atendimento uuid, p_motivo text, p_resumo text,
                                                        p_assunto text DEFAULT NULL, p_sensivel boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_conv uuid;
BEGIN
  UPDATE public."WA_ATENDIMENTO"
     SET status = 'aguardando_humano',
         aguardando_desde = coalesce(aguardando_desde, now()),
         motivo_encaminhamento = left(p_motivo, 200),
         resumo = left(coalesce(nullif(btrim(p_resumo), ''), resumo), 1000),
         assunto = coalesce(assunto, nullif(btrim(p_assunto), '')),
         sensivel = sensivel OR coalesce(p_sensivel, false)
   WHERE id = p_atendimento AND status IN ('ia', 'aguardando_humano')
   RETURNING conversa_id INTO v_conv;
  IF v_conv IS NOT NULL THEN
    UPDATE public."WA_CONVERSA" SET bot_ativo = false WHERE id = v_conv AND bot_ativo;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_bot_encaminhar(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_atd_bot_encaminhar(uuid, text, text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.wa_atd_bot_marcar(p_atendimento uuid, p_assunto text, p_sensivel boolean)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public."WA_ATENDIMENTO"
     SET assunto = coalesce(assunto, nullif(btrim(p_assunto), '')),
         sensivel = sensivel OR coalesce(p_sensivel, false)
   WHERE id = p_atendimento
$$;
REVOKE ALL ON FUNCTION public.wa_atd_bot_marcar(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_atd_bot_marcar(uuid, text, boolean) TO service_role;

-- A pessoa confirmou que estava resolvido ([[RESOLVIDO]]).
CREATE OR REPLACE FUNCTION public.wa_atd_bot_concluir(p_atendimento uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  UPDATE public."WA_ATENDIMENTO"
     SET status = 'concluido', concluido_em = now(), resolvido_pela_ia = true,
         resolucao = coalesce(resolucao, 'Resolvido pela I.A — a pessoa confirmou.')
   WHERE id = p_atendimento AND status = 'ia';
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_bot_concluir(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_atd_bot_concluir(uuid) TO service_role;

-- ── 9) RPCs da equipe ────────────────────────────────────────────────────
-- Fila e protocolos. p_status NULL = todos os abertos.
CREATE OR REPLACE FUNCTION public.wa_atd_fila(p_status text[] DEFAULT NULL, p_de date DEFAULT NULL, p_ate date DEFAULT NULL,
                                              p_busca text DEFAULT NULL, p_limite integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_b text := nullif(btrim(coalesce(p_busca, '')), '');
BEGIN
  IF NOT public.wa_atd_pode('visualizar', 'whatsapp_atd_fila') THEN
    RAISE EXCEPTION 'Sem acesso ao Atendimento dos Supervisores.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY (x->>'ordem')::int, x->>'referencia')
      FROM (
        SELECT jsonb_build_object(
          'id', a.id, 'protocolo', a.protocolo, 'status', a.status, 'assunto', a.assunto, 'sensivel', a.sensivel,
          'resumo', a.resumo, 'motivo', a.motivo_encaminhamento, 'setor', a.setor,
          'solicitante_papel', a.solicitante_papel,
          'solicitante_nome', (SELECT e."Nome" FROM public."EMPREGADOS" e WHERE e."ID" = a.solicitante_empregado_id LIMIT 1),
          'contato_nome', coalesce(nullif(ct.nome_manual, ''), ct.nome),
          'contato_telefone', ct.wa_id,
          'contrato_id', a.contrato_id,
          'contrato_nome', (SELECT c.nome FROM public.contratos c WHERE c.id = a.contrato_id),
          'responsavel_id', a.responsavel_id,
          'responsavel_nome', (SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) FROM public.profiles p WHERE p.id = a.responsavel_id),
          'conversa_id', a.conversa_id,
          'aberto_em', a.aberto_em, 'aguardando_desde', a.aguardando_desde,
          'primeira_resposta_humana_em', a.primeira_resposta_humana_em,
          'ultima_entrada_em', a.ultima_entrada_em,
          'concluido_em', a.concluido_em, 'resolvido_pela_ia', a.resolvido_pela_ia,
          'ordem', CASE a.status WHEN 'aguardando_humano' THEN 0 WHEN 'em_atendimento_humano' THEN 1 WHEN 'ia' THEN 2 ELSE 3 END,
          'referencia', to_char(coalesce(a.aguardando_desde, a.aberto_em), 'YYYYMMDDHH24MISS')
        ) AS x
          FROM public."WA_ATENDIMENTO" a
          JOIN public."WA_CONVERSA" cv ON cv.id = a.conversa_id
          JOIN public."WA_CONTATO" ct ON ct.id = cv.contato_id
         WHERE (p_status IS NULL AND a.status <> 'concluido' OR a.status = ANY (p_status))
           AND (p_de IS NULL OR a.aberto_em >= p_de)
           AND (p_ate IS NULL OR a.aberto_em < p_ate + 1)
           AND (v_b IS NULL OR a.protocolo ILIKE '%' || v_b || '%' OR ct.wa_id LIKE '%' || regexp_replace(v_b, '\D', '', 'g') || '%'
                OR coalesce(ct.nome_manual, ct.nome, '') ILIKE '%' || v_b || '%' OR coalesce(a.assunto, '') ILIKE '%' || v_b || '%')
         ORDER BY a.aberto_em DESC
         LIMIT LEAST(GREATEST(coalesce(p_limite, 200), 1), 1000)
      ) t), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_fila(text[], date, date, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_fila(text[], date, date, text, integer) TO authenticated;

-- Detalhe: protocolo + mensagens + consultas (estas só com auditoria). Registra o acesso.
CREATE OR REPLACE FUNCTION public.wa_atd_detalhe(p_atendimento uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.wa_atd_pode('visualizar', 'whatsapp_atd_fila') THEN
    RAISE EXCEPTION 'Sem acesso ao Atendimento dos Supervisores.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.wa_atd_log('ver_atendimento', p_atendimento);
  SELECT jsonb_build_object(
    'atendimento', to_jsonb(a.*),
    'mensagens', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'direcao', m.direcao, 'origem', m.origem, 'texto', m.texto,
                                          'tipo', m.tipo, 'status', m.status, 'criada_em', m.criada_em,
                                          'autor_nome', (SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) FROM public.profiles p WHERE p.id = m.autor_id))
                       ORDER BY m.criada_em)
        FROM public."WA_MENSAGEM" m WHERE m.atendimento_id = a.id), '[]'::jsonb),
    'consultas', CASE WHEN public.wa_atd_pode('visualizar', 'whatsapp_atd_auditoria') THEN coalesce((
      SELECT jsonb_agg(to_jsonb(l.*) ORDER BY l.criada_em) FROM public."WA_ATD_CONSULTA_LOG" l WHERE l.atendimento_id = a.id), '[]'::jsonb)
      ELSE NULL END,
    'pode_alterar', public.wa_atd_pode('alterar', 'whatsapp_atd_fila'))
    INTO v_out
    FROM public."WA_ATENDIMENTO" a WHERE a.id = p_atendimento;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_detalhe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_detalhe(uuid) TO authenticated;

-- Ações sobre o protocolo: assumir | devolver_ia | encaminhar | concluir.
CREATE OR REPLACE FUNCTION public.wa_atd_acao(p_atendimento uuid, p_acao text, p_responsavel uuid DEFAULT NULL,
                                              p_setor text DEFAULT NULL, p_texto text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_atd public."WA_ATENDIMENTO";
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.wa_atd_pode('alterar', 'whatsapp_atd_fila') THEN
    RAISE EXCEPTION 'Sem permissão para atuar no Atendimento dos Supervisores.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_atd FROM public."WA_ATENDIMENTO" WHERE id = p_atendimento FOR UPDATE;
  IF v_atd.id IS NULL THEN RAISE EXCEPTION 'Atendimento não encontrado.'; END IF;
  IF v_atd.status = 'concluido' THEN RAISE EXCEPTION 'Atendimento já concluído (protocolo %).', v_atd.protocolo; END IF;

  IF p_acao = 'assumir' THEN
    UPDATE public."WA_ATENDIMENTO"
       SET status = 'em_atendimento_humano', responsavel_id = v_uid,
           assumido_em = coalesce(assumido_em, now()), assumido_por = coalesce(assumido_por, v_uid)
     WHERE id = v_atd.id;
    -- Desligar o bot da conversa é o que de fato para a I.A (o webhook olha bot_ativo).
    UPDATE public."WA_CONVERSA" SET bot_ativo = false, atendente_id = v_uid WHERE id = v_atd.conversa_id;
  ELSIF p_acao = 'devolver_ia' THEN
    IF NOT EXISTS (SELECT 1 FROM public."WA_CANAL" k WHERE k.codigo = v_atd.canal_codigo AND k.ativo AND k.ia_ativa) THEN
      RAISE EXCEPTION 'A I.A está desligada neste canal: o atendimento continua com a equipe.';
    END IF;
    UPDATE public."WA_ATENDIMENTO" SET status = 'ia', aguardando_desde = NULL WHERE id = v_atd.id;
    UPDATE public."WA_CONVERSA" SET bot_ativo = true WHERE id = v_atd.conversa_id;
  ELSIF p_acao = 'encaminhar' THEN
    UPDATE public."WA_ATENDIMENTO"
       SET status = 'aguardando_humano', aguardando_desde = now(),
           responsavel_id = p_responsavel, setor = coalesce(nullif(btrim(p_setor), ''), setor),
           motivo_encaminhamento = coalesce(nullif(btrim(p_texto), ''), motivo_encaminhamento)
     WHERE id = v_atd.id;
    UPDATE public."WA_CONVERSA" SET bot_ativo = false WHERE id = v_atd.conversa_id AND bot_ativo;
  ELSIF p_acao = 'concluir' THEN
    -- Mesmo gesto da Caixa de Entrada: a conversa vai para "Atendimento
    -- Concluído" e o bot volta a valer para o próximo protocolo. Vem ANTES
    -- de fechar o protocolo para a linha "Atendimento concluído por …" (mig
    -- 20260819000004) ainda cair dentro dele; o trigger de sincronização
    -- fecha, e o UPDATE abaixo grava a resolução escrita aqui.
    UPDATE public."WA_CONVERSA" SET pasta_codigo = 'atendimento_concluido', bot_ativo = true
     WHERE id = v_atd.conversa_id;
    UPDATE public."WA_ATENDIMENTO"
       SET status = 'concluido', concluido_em = coalesce(concluido_em, now()), concluido_por = v_uid,
           resolucao = nullif(btrim(coalesce(p_texto, '')), ''),
           resolvido_pela_ia = NOT EXISTS (SELECT 1 FROM public."WA_MENSAGEM" m
                                            WHERE m.atendimento_id = v_atd.id AND m.origem = 'atendente')
     WHERE id = v_atd.id;
  ELSE
    RAISE EXCEPTION 'Ação inválida: %', p_acao;
  END IF;

  PERFORM public.wa_atd_log(p_acao, v_atd.id,
    jsonb_build_object('responsavel', p_responsavel, 'setor', p_setor, 'texto', left(coalesce(p_texto, ''), 300)));
  RETURN (SELECT to_jsonb(a.*) FROM public."WA_ATENDIMENTO" a WHERE a.id = v_atd.id);
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_acao(uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_acao(uuid, text, uuid, text, text) TO authenticated;

-- Para quem dá para encaminhar: quem pode atuar na fila.
CREATE OR REPLACE FUNCTION public.wa_atd_responsaveis()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.wa_atd_pode('visualizar', 'whatsapp_atd_fila') THEN
    RAISE EXCEPTION 'Sem acesso.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', coalesce(nullif(btrim(p.display_name), ''), p.email)) ORDER BY coalesce(nullif(btrim(p.display_name), ''), p.email))
      FROM public.profiles p
     WHERE public.has_screen_access(p.id, 'whatsapp_atd_fila', 'alterar'::public.app_acao)), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_responsaveis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_responsaveis() TO authenticated;

-- Indicadores (espelho de calcularIndicadores() no TS).
CREATE OR REPLACE FUNCTION public.wa_atd_indicadores(p_de date DEFAULT NULL, p_ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_de  timestamptz := coalesce(p_de, (now() - interval '30 days')::date);
  v_ate timestamptz := coalesce(p_ate::timestamptz + interval '1 day', now() + interval '1 day');
  v_out jsonb;
BEGIN
  IF NOT public.wa_atd_pode('visualizar', 'whatsapp_atd_fila') THEN
    RAISE EXCEPTION 'Sem acesso ao Atendimento dos Supervisores.' USING ERRCODE = '42501';
  END IF;
  WITH a AS MATERIALIZED (SELECT * FROM public."WA_ATENDIMENTO" WHERE aberto_em >= v_de AND aberto_em < v_ate),
       c AS MATERIALIZED (SELECT * FROM public."WA_ATD_CONSULTA_LOG" WHERE criada_em >= v_de AND criada_em < v_ate)
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM a),
    'por_status', coalesce((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM a GROUP BY status) s), '{}'::jsonb),
    'concluidos', (SELECT count(*) FROM a WHERE status = 'concluido'),
    'resolvidos_ia', (SELECT count(*) FROM a WHERE status = 'concluido' AND resolvido_pela_ia),
    'pct_resolvido_ia', (SELECT CASE WHEN count(*) FILTER (WHERE status = 'concluido') = 0 THEN NULL
                                ELSE round(100.0 * count(*) FILTER (WHERE status = 'concluido' AND resolvido_pela_ia)
                                           / count(*) FILTER (WHERE status = 'concluido'), 1) END FROM a),
    'pendentes', (SELECT count(*) FROM public."WA_ATENDIMENTO" WHERE status IN ('aguardando_humano', 'em_atendimento_humano')),
    'aguardando_humano', (SELECT count(*) FROM public."WA_ATENDIMENTO" WHERE status = 'aguardando_humano'),
    'maior_espera_min', (SELECT round(EXTRACT(epoch FROM now() - min(aguardando_desde)) / 60) FROM public."WA_ATENDIMENTO" WHERE status = 'aguardando_humano'),
    'tempo_resposta_ia_seg', (SELECT round(avg(EXTRACT(epoch FROM primeira_resposta_ia_em - aberto_em))::numeric, 1) FROM a
                                WHERE primeira_resposta_ia_em IS NOT NULL AND primeira_resposta_ia_em >= aberto_em),
    'espera_humano_min', (SELECT round(avg(EXTRACT(epoch FROM primeira_resposta_humana_em - aguardando_desde) / 60)::numeric, 1) FROM a
                            WHERE primeira_resposta_humana_em IS NOT NULL AND aguardando_desde IS NOT NULL
                              AND primeira_resposta_humana_em >= aguardando_desde),
    'duracao_media_min', (SELECT round(avg(EXTRACT(epoch FROM concluido_em - aberto_em) / 60)::numeric, 1) FROM a
                            WHERE concluido_em IS NOT NULL AND concluido_em >= aberto_em),
    'assuntos', coalesce((SELECT jsonb_agg(jsonb_build_object('assunto', assunto, 'total', n) ORDER BY n DESC)
                            FROM (SELECT coalesce(assunto, '(sem assunto)') assunto, count(*) n FROM a GROUP BY 1 ORDER BY 2 DESC LIMIT 15) s), '[]'::jsonb),
    'motivos_encaminhamento', coalesce((SELECT jsonb_agg(jsonb_build_object('motivo', m, 'total', n) ORDER BY n DESC)
                            FROM (SELECT split_part(motivo_encaminhamento, ':', 1) m, count(*) n FROM a
                                   WHERE motivo_encaminhamento IS NOT NULL GROUP BY 1) s), '[]'::jsonb),
    'por_dia', coalesce((SELECT jsonb_agg(jsonb_build_object('dia', d, 'total', n, 'ia', ia) ORDER BY d)
                            FROM (SELECT to_char(aberto_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') d, count(*) n,
                                         count(*) FILTER (WHERE resolvido_pela_ia) ia FROM a GROUP BY 1) s), '[]'::jsonb),
    'consultas_autorizadas', (SELECT count(*) FROM c WHERE resultado = 'autorizada'),
    'consultas_negadas', (SELECT count(*) FROM c WHERE resultado = 'negada'),
    'por_papel', coalesce((SELECT jsonb_object_agg(coalesce(solicitante_papel, '(não identificado)'), n)
                             FROM (SELECT solicitante_papel, count(*) n FROM a GROUP BY 1) s), '{}'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_indicadores(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_indicadores(date, date) TO authenticated;

-- Auditoria: consultas (autorizadas e negadas) e acessos da equipe.
CREATE OR REPLACE FUNCTION public.wa_atd_auditoria(p_de date DEFAULT NULL, p_ate date DEFAULT NULL, p_limite integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_de  timestamptz := coalesce(p_de, (now() - interval '30 days')::date);
  v_ate timestamptz := coalesce(p_ate::timestamptz + interval '1 day', now() + interval '1 day');
  v_lim integer := LEAST(GREATEST(coalesce(p_limite, 500), 1), 5000);
BEGIN
  IF NOT public.wa_atd_pode('visualizar', 'whatsapp_atd_auditoria') THEN
    RAISE EXCEPTION 'Sem acesso à auditoria do atendimento.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.wa_atd_log('ver_auditoria', NULL, jsonb_build_object('de', v_de, 'ate', v_ate));
  RETURN jsonb_build_object(
    'consultas', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'criada_em' DESC) FROM (
        SELECT jsonb_build_object('id', l.id, 'criada_em', l.criada_em, 'protocolo', a.protocolo,
                 'wa_id', l.wa_id, 'papel', l.solicitante_papel,
                 'solicitante', (SELECT e."Nome" FROM public."EMPREGADOS" e WHERE e."ID" = l.solicitante_empregado_id LIMIT 1),
                 'categoria', l.categoria, 'alvo_termo', l.alvo_termo,
                 'alvo', (SELECT e."Nome" FROM public."EMPREGADOS" e WHERE e."ID" = l.alvo_empregado_id LIMIT 1),
                 'resultado', l.resultado, 'motivo', l.motivo) x
          FROM public."WA_ATD_CONSULTA_LOG" l LEFT JOIN public."WA_ATENDIMENTO" a ON a.id = l.atendimento_id
         WHERE l.criada_em >= v_de AND l.criada_em < v_ate
         ORDER BY l.criada_em DESC LIMIT v_lim) t), '[]'::jsonb),
    'acessos', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'criada_em' DESC) FROM (
        SELECT jsonb_build_object('id', g.id, 'criada_em', g.criada_em, 'acao', g.acao, 'protocolo', a.protocolo,
                 'usuario', (SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) FROM public.profiles p WHERE p.id = g.user_id),
                 'detalhe', g.detalhe) x
          FROM public."WA_ATD_ACESSO_LOG" g LEFT JOIN public."WA_ATENDIMENTO" a ON a.id = g.atendimento_id
         WHERE g.criada_em >= v_de AND g.criada_em < v_ate
         ORDER BY g.criada_em DESC LIMIT v_lim) t), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_auditoria(date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_auditoria(date, date, integer) TO authenticated;

-- ── 10) Base, regras e canal (tela Base & Regras) ────────────────────────
-- Salvar procedimento. Quem tem 'aprovar' já salva aprovado; quem só tem
-- 'alterar' salva como pendente — e QUALQUER alteração de texto derruba a
-- aprovação anterior (a I.A não pode usar um texto que ninguém aprovou).
CREATE OR REPLACE FUNCTION public.wa_atd_base_salvar(p_id uuid, p_titulo text, p_conteudo text, p_assunto text,
                                                     p_area text, p_ativo boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id   uuid := p_id;
  v_apr  boolean := public.wa_atd_pode('aprovar', 'whatsapp_atd_base');
  v_old  public."WA_ATD_BASE";
  v_mudou boolean;
BEGIN
  IF NOT public.wa_atd_pode('alterar', 'whatsapp_atd_base') THEN
    RAISE EXCEPTION 'Sem permissão para alterar a base de conhecimento.' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_titulo, '')), '') IS NULL OR nullif(btrim(coalesce(p_conteudo, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o título e o conteúdo do procedimento.';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public."WA_ATD_BASE" (titulo, conteudo, assunto, area_responsavel, ativo, aprovado, aprovado_por, aprovado_em, criado_por, atualizado_por)
    VALUES (btrim(p_titulo), btrim(p_conteudo), nullif(btrim(p_assunto), ''), nullif(btrim(p_area), ''), coalesce(p_ativo, true),
            v_apr, CASE WHEN v_apr THEN auth.uid() END, CASE WHEN v_apr THEN now() END, auth.uid(), auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO public."WA_ATD_BASE_HIST" (base_id, acao, versao, titulo, conteudo, autor_id)
    VALUES (v_id, 'criado', 1, btrim(p_titulo), btrim(p_conteudo), auth.uid());
  ELSE
    SELECT * INTO v_old FROM public."WA_ATD_BASE" WHERE id = v_id FOR UPDATE;
    IF v_old.id IS NULL THEN RAISE EXCEPTION 'Procedimento não encontrado.'; END IF;
    v_mudou := v_old.titulo IS DISTINCT FROM btrim(p_titulo) OR v_old.conteudo IS DISTINCT FROM btrim(p_conteudo);
    UPDATE public."WA_ATD_BASE"
       SET titulo = btrim(p_titulo), conteudo = btrim(p_conteudo),
           assunto = nullif(btrim(p_assunto), ''), area_responsavel = nullif(btrim(p_area), ''),
           ativo = coalesce(p_ativo, true),
           versao = versao + CASE WHEN v_mudou THEN 1 ELSE 0 END,
           aprovado = CASE WHEN v_mudou THEN v_apr ELSE aprovado OR v_apr END,
           aprovado_por = CASE WHEN v_mudou OR (v_apr AND NOT aprovado) THEN CASE WHEN v_apr THEN auth.uid() END ELSE aprovado_por END,
           aprovado_em  = CASE WHEN v_mudou OR (v_apr AND NOT aprovado) THEN CASE WHEN v_apr THEN now() END ELSE aprovado_em END,
           atualizado_por = auth.uid()
     WHERE id = v_id;
    INSERT INTO public."WA_ATD_BASE_HIST" (base_id, acao, versao, titulo, conteudo, autor_id)
    SELECT v_id, CASE WHEN NOT coalesce(p_ativo, true) AND v_old.ativo THEN 'desativado' ELSE 'alterado' END,
           b.versao, b.titulo, b.conteudo, auth.uid()
      FROM public."WA_ATD_BASE" b WHERE b.id = v_id;
  END IF;
  PERFORM public.wa_atd_log('alterar_base', NULL, jsonb_build_object('base_id', v_id));
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_base_salvar(uuid, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_base_salvar(uuid, text, text, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.wa_atd_base_aprovar(p_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.wa_atd_pode('aprovar', 'whatsapp_atd_base') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar procedimentos.' USING ERRCODE = '42501';
  END IF;
  UPDATE public."WA_ATD_BASE" SET aprovado = true, aprovado_por = auth.uid(), aprovado_em = now(), atualizado_por = auth.uid()
   WHERE id = p_id AND NOT aprovado;
  IF FOUND THEN
    INSERT INTO public."WA_ATD_BASE_HIST" (base_id, acao, versao, titulo, conteudo, autor_id)
    SELECT id, 'aprovado', versao, titulo, conteudo, auth.uid() FROM public."WA_ATD_BASE" WHERE id = p_id;
    PERFORM public.wa_atd_log('aprovar_base', NULL, jsonb_build_object('base_id', p_id));
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_base_aprovar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_base_aprovar(uuid) TO authenticated;

-- Respostas automáticas para revisão (com a pergunta que veio antes).
CREATE OR REPLACE FUNCTION public.wa_atd_respostas_ia(p_de date DEFAULT NULL, p_ate date DEFAULT NULL,
                                                      p_so_pendentes boolean DEFAULT true, p_limite integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_de  timestamptz := coalesce(p_de, (now() - interval '30 days')::date);
  v_ate timestamptz := coalesce(p_ate::timestamptz + interval '1 day', now() + interval '1 day');
BEGIN
  IF NOT public.wa_atd_pode('visualizar', 'whatsapp_atd_base') THEN
    RAISE EXCEPTION 'Sem acesso à revisão das respostas.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'criada_em' DESC) FROM (
      SELECT jsonb_build_object(
               'mensagem_id', m.id, 'atendimento_id', a.id, 'protocolo', a.protocolo, 'assunto', a.assunto,
               'resposta', m.texto, 'criada_em', m.criada_em,
               'pergunta', (SELECT q.texto FROM public."WA_MENSAGEM" q
                             WHERE q.atendimento_id = a.id AND q.direcao = 'entrada' AND q.criada_em <= m.criada_em
                             ORDER BY q.criada_em DESC LIMIT 1),
               'avaliacao', r.avaliacao, 'comentario', r.comentario, 'base_id', r.base_id) x
        FROM public."WA_MENSAGEM" m
        JOIN public."WA_ATENDIMENTO" a ON a.id = m.atendimento_id
        LEFT JOIN public."WA_ATD_REVISAO" r ON r.mensagem_id = m.id
       WHERE m.origem = 'bot' AND m.direcao = 'saida'
         AND m.criada_em >= v_de AND m.criada_em < v_ate
         AND (NOT coalesce(p_so_pendentes, true) OR r.id IS NULL)
       ORDER BY m.criada_em DESC
       LIMIT LEAST(GREATEST(coalesce(p_limite, 200), 1), 1000)) t), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_respostas_ia(date, date, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_respostas_ia(date, date, boolean, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.wa_atd_revisar(p_mensagem uuid, p_avaliacao text, p_comentario text DEFAULT NULL, p_base uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_atd uuid;
BEGIN
  IF NOT public.wa_atd_pode('alterar', 'whatsapp_atd_base') THEN
    RAISE EXCEPTION 'Sem permissão para revisar respostas.' USING ERRCODE = '42501';
  END IF;
  SELECT atendimento_id INTO v_atd FROM public."WA_MENSAGEM" WHERE id = p_mensagem AND origem = 'bot';
  IF v_atd IS NULL THEN RAISE EXCEPTION 'Mensagem da I.A não encontrada.'; END IF;
  INSERT INTO public."WA_ATD_REVISAO" (mensagem_id, atendimento_id, avaliacao, comentario, base_id, revisor_id)
  VALUES (p_mensagem, v_atd, p_avaliacao, nullif(btrim(coalesce(p_comentario, '')), ''), p_base, auth.uid())
  ON CONFLICT (mensagem_id) DO UPDATE
     SET avaliacao = EXCLUDED.avaliacao, comentario = EXCLUDED.comentario, base_id = EXCLUDED.base_id,
         revisor_id = EXCLUDED.revisor_id, revisado_em = now();
  PERFORM public.wa_atd_log('revisar_resposta', v_atd, jsonb_build_object('mensagem_id', p_mensagem, 'avaliacao', p_avaliacao));
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_revisar(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_revisar(uuid, text, text, uuid) TO authenticated;

-- Regras de dado. A CHECK da tabela segura o "sensível nunca sai".
CREATE OR REPLACE FUNCTION public.wa_atd_regra_salvar(p_categoria text, p_nome text, p_sensivel boolean, p_proprio boolean,
                                                      p_encarregado boolean, p_supervisor boolean, p_palavras text[], p_ativo boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_cat text := lower(regexp_replace(btrim(coalesce(p_categoria, '')), '[^a-zA-Z0-9_]+', '_', 'g'));
BEGIN
  IF NOT public.wa_atd_pode('aprovar', 'whatsapp_atd_base') THEN
    RAISE EXCEPTION 'Só quem aprova a base altera as regras de dados.' USING ERRCODE = '42501';
  END IF;
  IF v_cat = '' OR nullif(btrim(coalesce(p_nome, '')), '') IS NULL THEN RAISE EXCEPTION 'Informe categoria e nome.'; END IF;
  -- Categoria nova só como sensível: o bot só sabe montar resposta para as
  -- quatro categorias de cadastro semeadas (formatarDadosConsulta).
  IF NOT EXISTS (SELECT 1 FROM public."WA_ATD_REGRA_DADO" WHERE categoria = v_cat) AND NOT coalesce(p_sensivel, true) THEN
    RAISE EXCEPTION 'Categoria nova entra como sensível (o bot não entrega dado dela).';
  END IF;
  INSERT INTO public."WA_ATD_REGRA_DADO" AS r (categoria, nome, sensivel, proprio, encarregado, supervisor, palavras_chave, ativo, updated_by)
  VALUES (v_cat, btrim(p_nome), coalesce(p_sensivel, true),
          coalesce(p_proprio, false) AND NOT coalesce(p_sensivel, true),
          coalesce(p_encarregado, false) AND NOT coalesce(p_sensivel, true),
          coalesce(p_supervisor, false) AND NOT coalesce(p_sensivel, true),
          coalesce(p_palavras, '{}'), coalesce(p_ativo, true), auth.uid())
  ON CONFLICT (categoria) DO UPDATE
     SET nome = EXCLUDED.nome, sensivel = EXCLUDED.sensivel, proprio = EXCLUDED.proprio,
         encarregado = EXCLUDED.encarregado, supervisor = EXCLUDED.supervisor,
         palavras_chave = EXCLUDED.palavras_chave, ativo = EXCLUDED.ativo,
         updated_by = auth.uid(), updated_at = now();
  PERFORM public.wa_atd_log('alterar_regra_dado', NULL, jsonb_build_object('categoria', v_cat, 'sensivel', p_sensivel,
          'proprio', p_proprio, 'encarregado', p_encarregado, 'supervisor', p_supervisor));
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_regra_salvar(text, text, boolean, boolean, boolean, boolean, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_regra_salvar(text, text, boolean, boolean, boolean, boolean, text[], boolean) TO authenticated;

-- Configuração do canal de atendimento (só o 'supervisores' pela tela).
CREATE OR REPLACE FUNCTION public.wa_atd_canal_salvar(p_dados jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_pid text := nullif(btrim(coalesce(p_dados->>'phone_number_id', '')), '');
BEGIN
  IF NOT public.wa_atd_pode('aprovar', 'whatsapp_atd_base') THEN
    RAISE EXCEPTION 'Só quem aprova a base altera a configuração do canal.' USING ERRCODE = '42501';
  END IF;
  IF v_pid IS NOT NULL AND v_pid !~ '^\d{6,30}$' THEN
    RAISE EXCEPTION 'O identificador do número (phone_number_id) da Meta tem só dígitos.';
  END IF;
  UPDATE public."WA_CANAL" SET
    phone_number_id = v_pid,
    ativo           = coalesce((p_dados->>'ativo')::boolean, ativo),
    ia_ativa        = coalesce((p_dados->>'ia_ativa')::boolean, ia_ativa),
    provedor        = nullif(btrim(coalesce(p_dados->>'provedor', '')), ''),
    modelo          = nullif(btrim(coalesce(p_dados->>'modelo', '')), ''),
    persona         = nullif(btrim(coalesce(p_dados->>'persona', '')), ''),
    aviso_abertura  = nullif(btrim(coalesce(p_dados->>'aviso_abertura', '')), ''),
    msg_encaminhado = nullif(btrim(coalesce(p_dados->>'msg_encaminhado', '')), ''),
    msg_negado      = nullif(btrim(coalesce(p_dados->>'msg_negado', '')), ''),
    encerrar_ia_apos_horas = coalesce((p_dados->>'encerrar_ia_apos_horas')::int, encerrar_ia_apos_horas),
    retencao_dias   = CASE WHEN p_dados ? 'retencao_dias' THEN nullif(p_dados->>'retencao_dias', '')::int ELSE retencao_dias END,
    setores         = coalesce(ARRAY(SELECT jsonb_array_elements_text(p_dados->'setores')), setores),
    updated_by      = auth.uid()
  WHERE codigo = 'supervisores';
  PERFORM public.wa_atd_log('alterar_canal', NULL, p_dados - 'persona' - 'aviso_abertura');
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_canal_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_canal_salvar(jsonb) TO authenticated;

-- ── 11) Rotinas: encerrar o que a I.A resolveu e reter/descartar ─────────
-- Atendimento em 'ia' sem mensagem da pessoa há N horas (do canal): a I.A
-- respondeu e a pessoa não voltou — conta como resolvido pela I.A.
CREATE OR REPLACE FUNCTION public.wa_atd_encerrar_inativos()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer;
BEGIN
  UPDATE public."WA_ATENDIMENTO" a
     SET status = 'concluido', concluido_em = now(), resolvido_pela_ia = true,
         resolucao = coalesce(a.resolucao, 'Encerrado automaticamente: a I.A respondeu e não houve nova mensagem.')
    FROM public."WA_CANAL" k
   WHERE k.codigo = a.canal_codigo AND a.status = 'ia' AND k.ativo AND k.ia_ativa
     -- a I.A respondeu de fato: mais mensagens do bot do que só o aviso de abertura
     AND (SELECT count(*) FROM public."WA_MENSAGEM" m WHERE m.atendimento_id = a.id AND m.origem = 'bot')
         > CASE WHEN a.aviso_enviado_em IS NOT NULL THEN 1 ELSE 0 END
     AND a.primeira_resposta_ia_em IS NOT NULL
     AND coalesce(a.ultima_entrada_em, a.aberto_em) < now() - make_interval(hours => k.encerrar_ia_apos_horas);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_encerrar_inativos() FROM PUBLIC, anon, authenticated;

-- Retenção: texto das mensagens (e resumo do protocolo) de canal com
-- retencao_dias, mais antigas que o prazo e de atendimento concluído, é
-- substituído. Ficam data, direção, origem e protocolo — o que os
-- indicadores e a auditoria precisam. O log de consultas não é apagado
-- (é a prova de quem pediu o quê), mas o termo digitado é.
CREATE OR REPLACE FUNCTION public.wa_atd_aplicar_retencao()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer := 0; v_k record; v_x integer;
BEGIN
  FOR v_k IN SELECT codigo, retencao_dias FROM public."WA_CANAL" WHERE retencao_dias IS NOT NULL LOOP
    UPDATE public."WA_MENSAGEM" m
       SET texto = '[conteúdo descartado pela política de retenção]', payload = NULL
      FROM public."WA_ATENDIMENTO" a
     WHERE a.id = m.atendimento_id AND a.canal_codigo = v_k.codigo AND a.status = 'concluido'
       AND m.criada_em < now() - make_interval(days => v_k.retencao_dias)
       AND m.texto IS DISTINCT FROM '[conteúdo descartado pela política de retenção]';
    GET DIAGNOSTICS v_x = ROW_COUNT; v_n := v_n + v_x;
    UPDATE public."WA_ATENDIMENTO" SET resumo = NULL, resolucao = NULL
     WHERE canal_codigo = v_k.codigo AND status = 'concluido'
       AND concluido_em < now() - make_interval(days => v_k.retencao_dias)
       AND (resumo IS NOT NULL OR resolucao IS NOT NULL);
    UPDATE public."WA_ATD_CONSULTA_LOG" l SET alvo_termo = NULL
      FROM public."WA_ATENDIMENTO" a
     WHERE a.id = l.atendimento_id AND a.canal_codigo = v_k.codigo
       AND l.criada_em < now() - make_interval(days => v_k.retencao_dias) AND l.alvo_termo IS NOT NULL;
  END LOOP;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_aplicar_retencao() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente: rotinas do atendimento dos supervisores não agendadas.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wa-atd-encerrar-inativos') THEN
    PERFORM cron.unschedule('wa-atd-encerrar-inativos');
  END IF;
  PERFORM cron.schedule('wa-atd-encerrar-inativos', '17 * * * *', 'SELECT public.wa_atd_encerrar_inativos()');
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wa-atd-retencao') THEN
    PERFORM cron.unschedule('wa-atd-retencao');
  END IF;
  PERFORM cron.schedule('wa-atd-retencao', '40 4 * * *', 'SELECT public.wa_atd_aplicar_retencao()');
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- SELECT cron.unschedule('wa-atd-encerrar-inativos'); SELECT cron.unschedule('wa-atd-retencao');
-- DROP TRIGGER IF EXISTS trg_wa_atd_conversa_sincronizar ON public."WA_CONVERSA";
-- DROP TRIGGER IF EXISTS trg_wa_atd_mensagem_efeitos ON public."WA_MENSAGEM";
-- DROP TRIGGER IF EXISTS trg_wa_atd_mensagem_vincular ON public."WA_MENSAGEM";
-- DROP FUNCTION IF EXISTS public.wa_atd_aplicar_retencao(), public.wa_atd_encerrar_inativos(),
--   public.wa_atd_canal_salvar(jsonb), public.wa_atd_regra_salvar(text, text, boolean, boolean, boolean, boolean, text[], boolean),
--   public.wa_atd_revisar(uuid, text, text, uuid), public.wa_atd_respostas_ia(date, date, boolean, integer),
--   public.wa_atd_base_aprovar(uuid), public.wa_atd_base_salvar(uuid, text, text, text, text, boolean),
--   public.wa_atd_auditoria(date, date, integer), public.wa_atd_indicadores(date, date), public.wa_atd_responsaveis(),
--   public.wa_atd_acao(uuid, text, uuid, text, text), public.wa_atd_detalhe(uuid),
--   public.wa_atd_fila(text[], date, date, text, integer), public.wa_atd_bot_concluir(uuid),
--   public.wa_atd_bot_marcar(uuid, text, boolean), public.wa_atd_bot_encaminhar(uuid, text, text, text, boolean),
--   public.wa_atd_preparar(uuid, text), public.wa_atd_consultar(uuid, text, text, text),
--   public.wa_atd_identificar(text), public.wa_atd_chave_telefone(text), public.wa_atd_log(text, uuid, jsonb),
--   public.wa_atd_conversa_sincronizar(), public.wa_atd_mensagem_efeitos(), public.wa_atd_mensagem_vincular();
-- ALTER TABLE public."WA_MENSAGEM" DROP COLUMN IF EXISTS atendimento_id;
-- DROP TABLE IF EXISTS public."WA_ATD_ACESSO_LOG", public."WA_ATD_CONSULTA_LOG", public."WA_ATD_REVISAO",
--   public."WA_ATD_BASE_HIST", public."WA_ATD_BASE", public."WA_ATD_REGRA_DADO", public."WA_ATENDIMENTO";
-- DROP FUNCTION IF EXISTS public.wa_atd_novo_protocolo(); DROP SEQUENCE IF EXISTS public.wa_atendimento_protocolo_seq;
-- Reaplicar a policy wa_conversa_rw da 20261103004100 e as três RPCs da 20260906000003.
-- DELETE FROM public."WA_CONVERSA" WHERE canal_codigo <> 'principal';  -- (perde as conversas do canal novo)
-- ALTER TABLE public."WA_CONVERSA" DROP CONSTRAINT IF EXISTS wa_conversa_contato_canal_key,
--   DROP CONSTRAINT IF EXISTS wa_conversa_canal_fk, DROP COLUMN IF EXISTS canal_codigo;
-- ALTER TABLE public."WA_CONVERSA" ADD CONSTRAINT "WA_CONVERSA_contato_id_key" UNIQUE (contato_id);
-- DROP FUNCTION IF EXISTS public.wa_atd_pode(text, text), public.wa_pode_ver_canal(text);
-- DROP TABLE IF EXISTS public."WA_CANAL";
-- DELETE FROM public.app_menu WHERE codigo IN ('whatsapp_atd_fila','whatsapp_atd_base','whatsapp_atd_auditoria','whatsapp_pasta_atendimento_supervisores');
-- DELETE FROM public."WA_PASTA" WHERE codigo = 'atendimento_supervisores';
-- NOTIFY pgrst, 'reload schema';
