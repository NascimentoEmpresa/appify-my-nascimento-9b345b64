-- =========================================================================
-- CANAL DE ÉTICA — aviso por e-mail a cada nova denúncia
--
-- Pedido de 25/08/2026: assim que uma denúncia é registrada, o Comitê de
-- Ética precisa saber na hora, para iniciar a análise em tempo hábil. Hoje
-- o único aviso é o push do `comite-etica-alertas-tick`, que roda 8h em dia
-- útil — quem registra numa sexta à noite só é visto na segunda.
--
-- O QUE VAI NO E-MAIL: protocolo e data/hora. Só.
-- O módulo inteiro trata aviso como coisa MUDA sobre conteúdo (ver o
-- cabeçalho de comite-etica-alertas-tick: "canal de ética não vaza por
-- push"). E-mail é pior que push nesse quesito — sai do ERP, pode ser
-- encaminhado, fica em servidor que a RLS não alcança. Então assunto,
-- descrição, denunciado, gravidade e o nome de quem denunciou NÃO entram:
-- o protocolo é o bastante para abrir o caso no sistema, onde o acesso é
-- controlado. Decisão confirmada com o Pablo.
--
-- DESTINATÁRIOS EM TABELA, não no código: trocar quem recebe é rotina do
-- Comitê e não pode depender de deploy. Semeada com os dois nomes pedidos.
-- Note que ela é independente de COMITE_ETICA_RESPONSAVEL — receber o aviso
-- não concede acesso nenhum ao procedimento, e as duas pessoas de hoje não
-- estão cadastradas como responsáveis (conferido em 25/08/2026).
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- ── 1) Quem recebe ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA_AVISO_EMAIL" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL,
  email      text NOT NULL UNIQUE,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cd_aviso_email_valido CHECK (position('@' in email) > 1)
);

DROP TRIGGER IF EXISTS trg_cd_aviso_email_updated ON public."CANAL_DENUNCIA_AVISO_EMAIL";
CREATE TRIGGER trg_cd_aviso_email_updated BEFORE UPDATE ON public."CANAL_DENUNCIA_AVISO_EMAIL"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public."CANAL_DENUNCIA_AVISO_EMAIL" (nome, email)
VALUES ('Érica Souza',       'ericasouza.controladoria@haggltda.com.br'),
       ('Otniel S. Moreira', 'licitacao3@haggltda.com.br')
ON CONFLICT (email) DO NOTHING;

-- ── 1b) Config de runtime ────────────────────────────────────────────────
-- Guarda valores que os gatilhos precisam em tempo de execução e que não
-- podem morar no arquivo versionado. Sem GRANT e com RLS sem policy: o
-- cliente não lê nem por PostgREST nem por SQL — só SECURITY DEFINER e
-- service_role. O VALOR é gravado à mão depois de rodar (ver o rodapé).
CREATE TABLE IF NOT EXISTS public.app_config_runtime (
  chave         text PRIMARY KEY,
  valor         text NOT NULL,
  descricao     text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_config_runtime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_config_runtime FROM anon, authenticated;

-- ── 2) O que já foi avisado ──────────────────────────────────────────────
-- UNIQUE por denúncia: o pg_net pode reentregar, e ninguém precisa receber
-- o mesmo aviso duas vezes. Também é o histórico de "avisamos quando?",
-- que numa apuração vale mais do que parece.
CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA_AVISO_LOG" (
  denuncia_id   uuid PRIMARY KEY REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  protocolo     text,
  destinatarios text[],
  enviado_em    timestamptz NOT NULL DEFAULT now(),
  ok            boolean NOT NULL DEFAULT true,
  erro          text
);

-- ── 3) RLS ───────────────────────────────────────────────────────────────
-- Quem administra o Canal de Ética mexe na lista; ninguém mais enxerga (a
-- lista de destinatários já diz quem compõe o comitê).
ALTER TABLE public."CANAL_DENUNCIA_AVISO_EMAIL" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CANAL_DENUNCIA_AVISO_LOG"   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cd_aviso_email_select ON public."CANAL_DENUNCIA_AVISO_EMAIL";
DROP POLICY IF EXISTS cd_aviso_email_write  ON public."CANAL_DENUNCIA_AVISO_EMAIL";
DROP POLICY IF EXISTS cd_aviso_log_select   ON public."CANAL_DENUNCIA_AVISO_LOG";

CREATE POLICY cd_aviso_email_select ON public."CANAL_DENUNCIA_AVISO_EMAIL" FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'comite_etica_configuracao', 'visualizar'::public.app_acao));

CREATE POLICY cd_aviso_email_write ON public."CANAL_DENUNCIA_AVISO_EMAIL" FOR ALL TO authenticated
  USING      (public.can_access(auth.uid(), 'comite_etica_configuracao', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'comite_etica_configuracao', 'alterar'::public.app_acao));

CREATE POLICY cd_aviso_log_select ON public."CANAL_DENUNCIA_AVISO_LOG" FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'comite_etica_configuracao', 'visualizar'::public.app_acao));
-- Escrita do log é só da Edge Function (service role, que ignora RLS).

-- ── 4) O gatilho ─────────────────────────────────────────────────────────
-- AFTER INSERT na denúncia, e não dentro de `denuncia-registrar`, porque o
-- registro pode nascer de mais de um caminho (o formulário público, a
-- importação do Contato Seguro, um INSERT manual numa apuração). O gatilho
-- pega todos; a Edge Function pega só um.
--
-- Falha de rede NÃO pode derrubar o INSERT: perder a denúncia para salvar o
-- aviso seria o pior negócio possível. Por isso o EXCEPTION engole tudo e
-- só deixa um WARNING no log do Postgres.
--
-- A anon key vem da tabela `app_config_runtime` em vez de literal no
-- arquivo. As triggers antigas do projeto embutem a chave no corpo da
-- função, e o SQL vai versionado — mesmo sendo chave pública, não é lugar
-- de credencial. Sem a linha, o aviso não sai, então o caso vira WARNING
-- nomeado em vez de um 401 silencioso lá na ponta.
--
-- Por que tabela e não `current_setting('app.anon_key')`, que seria o
-- caminho natural: o Supabase NEGA `ALTER DATABASE ... SET` e
-- `ALTER ROLE ... SET` para parâmetro customizado — "permission denied to
-- set parameter", nos dois níveis, porque o role da plataforma não é
-- superuser. Conferido em 25/08/2026. A tabela é o substituto: sem GRANT
-- para anon/authenticated e com RLS ligada sem policy, só quem é
-- SECURITY DEFINER (esta função) ou service_role lê.
CREATE OR REPLACE FUNCTION public.canal_denuncia_avisa_comite()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_key text;
BEGIN
  SELECT valor INTO v_key FROM public.app_config_runtime WHERE chave = 'anon_key';
  IF coalesce(v_key, '') = '' THEN
    RAISE WARNING 'aviso do Comitê de Ética NÃO enviado para %: app_config_runtime.anon_key ausente (ver o rodapé da migration 20260925000002)', NEW.id;
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM net.http_post(
      url := 'https://fwmzeaztjxrxxzxzxmgc.supabase.co/functions/v1/comite-etica-nova-denuncia',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', v_key,
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('denuncia_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso do Comitê de Ética não disparou para %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;  -- AFTER trigger: retorno é ignorado
END $$;

DROP TRIGGER IF EXISTS trg_canal_denuncia_avisa_comite ON public."CANAL_DENUNCIA";
CREATE TRIGGER trg_canal_denuncia_avisa_comite AFTER INSERT ON public."CANAL_DENUNCIA"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_avisa_comite();

-- ── 5) Conferência ───────────────────────────────────────────────────────
SELECT nome, email, ativo FROM public."CANAL_DENUNCIA_AVISO_EMAIL" ORDER BY nome;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- DEPOIS DE RODAR
--   1. Guardar a anon key no banco, que é o que o gatilho lê. NÃO escrever
--      o valor neste arquivo — ele é versionado:
--        INSERT INTO public.app_config_runtime (chave, valor, descricao)
--        VALUES ('anon_key', '<anon key do projeto>', 'anon key do projeto')
--        ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor,
--                                          atualizado_em = now();
--      (a anon key é pública — vai no bundle do front de qualquer forma —
--       mas o hábito de não versionar credencial vale para ela também.)
--   2. Configurar os secrets de SMTP no Supabase e publicar a function
--      `comite-etica-nova-denuncia`. Ver o cabeçalho dela.
-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_canal_denuncia_avisa_comite ON public."CANAL_DENUNCIA";
--   DROP FUNCTION IF EXISTS public.canal_denuncia_avisa_comite();
--   DROP TABLE IF EXISTS public."CANAL_DENUNCIA_AVISO_LOG";
--   DROP TABLE IF EXISTS public."CANAL_DENUNCIA_AVISO_EMAIL";
-- =========================================================================
