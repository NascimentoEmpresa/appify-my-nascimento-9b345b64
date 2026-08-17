-- =====================================================================
-- WHATSAPP — NOVA CONVERSA pela Caixa de Entrada + ficha do contato
--
-- Ate aqui uma conversa so nascia de dois jeitos: a pessoa mandava
-- mensagem (webhook) ou o recrutador clicava no icone do card do
-- candidato. Quem precisava falar com um numero avulso — fornecedor,
-- colaborador, candidato de fora do portal — abria o WhatsApp no
-- celular, e aquela conversa ficava fora do historico do ERP.
--
-- Esta migration entrega:
--   1) wa_consultar_telefone   — quem e este numero? (nao grava nada)
--   2) wa_abrir_conversa_por_telefone — acha/cria contato + conversa
--   3) WA_CONTATO: nome_manual, etiquetas e observacao
--   4) WA_BOT_CONFIG: o texto/botao da mensagem de abertura
--
-- SOBRE O NOME — a regra do modulo continua de pe: `nome` e o
-- profile.name que a Meta manda no webhook, e nada mais escreve nele
-- (ver 20260820000005, o caso do contato que virou "TREINAMENTOS").
-- O nome digitado pelo atendente vai em `nome_manual`, coluna separada,
-- e tem precedencia na tela. Assim o apelido interno ("Maria — RH do
-- HUSM") nao apaga o nome real, e a chegada do nome real nao apaga o
-- apelido.
--
-- E NAO EXISTE, na Cloud API, endpoint que devolva o nome de um numero
-- que nunca falou com a gente: o profile.name so vem junto da mensagem
-- de ENTRADA. Por isso wa_consultar_telefone devolve o nome quando ja
-- temos o contato, e silencio quando nao temos — quem preenche o resto
-- e o webhook, sozinho, quando a pessoa responder.
--
-- A regra do 9o digito (20260820000006) sai de dentro da RPC do
-- recrutamento e vira funcao propria, usada pelas duas pontas. Era o
-- que o comentario daquela migration ja pedia: "uma implementacao so,
-- no banco".
--
-- Idempotente.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.wa_abrir_conversa_por_telefone(text, text, text);
--   DROP FUNCTION IF EXISTS public.wa_consultar_telefone(text);
--   DROP FUNCTION IF EXISTS public.wa_contato_do_telefone(text);
--   ALTER TABLE public."WA_CONTATO" DROP COLUMN IF EXISTS nome_manual,
--     DROP COLUMN IF EXISTS etiquetas, DROP COLUMN IF EXISTS observacao;
--   ALTER TABLE public."WA_BOT_CONFIG" DROP COLUMN IF EXISTS abertura_texto,
--     DROP COLUMN IF EXISTS abertura_botao, DROP COLUMN IF EXISTS abertura_template,
--     DROP COLUMN IF EXISTS abertura_template_idioma;
--   (a recrutamento_abrir_conversa volta na 20260820000006)
-- =====================================================================

-- 1) Ficha do contato --------------------------------------------------
ALTER TABLE public."WA_CONTATO"
  ADD COLUMN IF NOT EXISTS nome_manual text,
  ADD COLUMN IF NOT EXISTS etiquetas   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS observacao  text;

COMMENT ON COLUMN public."WA_CONTATO".nome  IS 'Nome do WhatsApp (profile.name). SO o webhook escreve aqui.';
COMMENT ON COLUMN public."WA_CONTATO".nome_manual IS 'Nome/apelido definido pelo atendente. Tem precedencia na tela.';
COMMENT ON COLUMN public."WA_CONTATO".etiquetas  IS 'Marcadores livres do atendimento (ex.: Fornecedor, Candidato, Urgente).';

-- Busca por etiqueta sem varrer a tabela.
CREATE INDEX IF NOT EXISTS idx_wa_contato_etiquetas
  ON public."WA_CONTATO" USING gin (etiquetas);

-- 2) Mensagem de abertura ----------------------------------------------
-- Fica no banco, e nao no codigo, porque tres pontas precisam do MESMO
-- texto: a previa na tela, o envio dentro da janela de 24h e o template
-- submetido a Meta. Duas copias e questao de tempo ate divergirem.
--
-- ATENCAO: mudar `abertura_texto` NAO muda o template ja aprovado na
-- Meta — template aprovado e imutavel. Depois de editar aqui, o template
-- precisa ser recriado (com outro nome) e reaprovado, senao o envio
-- FORA da janela de 24h continua saindo com o texto antigo.
ALTER TABLE public."WA_BOT_CONFIG"
  ADD COLUMN IF NOT EXISTS abertura_texto text NOT NULL DEFAULT
    E'Olá, Somos do Grupo Nascimento!\nPrecisamos entrar em contato com você, por gentileza responda essa mensagem automática para que possamos entrar em contato.',
  ADD COLUMN IF NOT EXISTS abertura_botao text NOT NULL DEFAULT 'Olá, Bom dia!',
  ADD COLUMN IF NOT EXISTS abertura_template text NOT NULL DEFAULT 'abertura_contato',
  ADD COLUMN IF NOT EXISTS abertura_template_idioma text NOT NULL DEFAULT 'pt_BR';

-- 3) Contato a partir de um telefone qualquer --------------------------
-- Centraliza a regra do 9o digito (20260820000006): a Cloud API guarda o
-- wa_id na forma LEGADA (55 + DDD + 8 digitos), entao casar pelo E.164
-- completo nao acha ninguem e cria duplicata. O trecho estavel entre as
-- duas formas e pais + DDD + os 8 ultimos.
--
-- Helper interno: sem GRANT para authenticated de proposito. Ele cria
-- contato sem checar permissao — quem checa sao as RPCs abaixo, que o
-- chamam. Rodando dentro delas (SECURITY DEFINER), o EXECUTE e avaliado
-- contra o dono da funcao, entao nao falta permissao nenhuma.
CREATE OR REPLACE FUNCTION public.wa_contato_do_telefone(p_telefone text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_d       text;   -- so digitos
  v_nac     text;   -- nacional, sem o 55 do pais
  v_ddd     text;
  v_tail    text;   -- 8 ultimos: estaveis entre a forma legada e a nova
  v_wa_id   text;
  v_contato uuid;
BEGIN
  v_d := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  IF length(v_d) < 10 THEN
    RAISE EXCEPTION 'telefone invalido: informe DDD + numero';
  END IF;

  -- Tira o 55 so quando ele e mesmo o pais: 12 ou 13 digitos. Numero de
  -- 10/11 digitos comecando com 55 e DDD 55 (Santa Maria/RS) — regiao do
  -- contrato HUSM, entao nao e caso hipotetico.
  v_nac  := CASE WHEN left(v_d, 2) = '55' AND length(v_d) IN (12, 13)
                 THEN substr(v_d, 3) ELSE v_d END;
  v_ddd  := left(v_nac, 2);
  v_tail := right(v_nac, 8);

  SELECT id INTO v_contato
    FROM public."WA_CONTATO"
   WHERE wa_id LIKE '55' || v_ddd || '%'
     AND right(wa_id, 8) = v_tail
   -- Havendo duplicata, a que ja conversou vence.
   ORDER BY (SELECT count(*) FROM public."WA_CONVERSA" cv
               JOIN public."WA_MENSAGEM" m ON m.conversa_id = cv.id
              WHERE cv.contato_id = "WA_CONTATO".id) DESC,
            created_at ASC
   LIMIT 1;

  -- Nao existe: cria na forma legada, que e a que o webhook grava — senao
  -- a primeira resposta da pessoa abriria um segundo registro.
  IF v_contato IS NULL THEN
    v_wa_id := '55' || v_ddd || v_tail;
    INSERT INTO public."WA_CONTATO"(wa_id, telefone)
    VALUES (v_wa_id, p_telefone)
    ON CONFLICT (wa_id) DO NOTHING;
    SELECT id INTO v_contato FROM public."WA_CONTATO" WHERE wa_id = v_wa_id;
  END IF;

  RETURN v_contato;
END $$;

REVOKE ALL ON FUNCTION public.wa_contato_do_telefone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_contato_do_telefone(text) FROM anon;
REVOKE ALL ON FUNCTION public.wa_contato_do_telefone(text) FROM authenticated;

-- 4) Consulta (nao grava nada) -----------------------------------------
-- Alimenta o "quem e este numero?" enquanto o atendente digita. NAO cria
-- contato: numero digitado errado, ou desistencia no meio, nao pode
-- deixar lixo na Caixa de Entrada.
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
    FROM public."WA_CONVERSA" WHERE contato_id = v_ct.id;
  IF v_conversa IS NOT NULL THEN
    SELECT count(*) INTO v_msgs FROM public."WA_MENSAGEM" WHERE conversa_id = v_conversa;
    SELECT EXISTS (
      SELECT 1 FROM public."WA_MENSAGEM"
       WHERE conversa_id = v_conversa AND direcao = 'entrada'
         AND criada_em > now() - interval '24 hours') INTO v_dentro;
  END IF;

  -- `pode_ver`: a conversa pode existir numa pasta fora do acesso de quem
  -- consultou. Avisar aqui evita o atendente preencher tudo, clicar e so
  -- entao descobrir que o numero ja esta com outro setor.
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

-- 5) Abrir a conversa ---------------------------------------------------
-- Idempotente por telefone: chamar duas vezes devolve a MESMA conversa.
-- `dentro_janela` diz se cabe texto livre ou se so passa template — e o
-- que a edge function whatsapp-abertura usa para escolher o caminho.
--
-- p_pasta e a fila onde a conversa NOVA nasce, e nao e detalhe: a RLS so
-- devolve conversa de pasta que a pessoa enxerga, e conversa SEM pasta so
-- aparece para quem tem 'whatsapp_todas' (wa_pode_ver_pasta). Sem escolher
-- a pasta, um atendente de fila criava a conversa e a perdia no mesmo
-- clique — existente no banco, invisivel para ele.
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

  -- SECURITY DEFINER passa por cima da RLS, entao a checagem da pasta tem
  -- que ser explicita: sem isto daria para jogar conversa numa fila alheia.
  IF p_pasta IS NOT NULL AND NOT public.wa_pode_ver_pasta(p_pasta) THEN
    RAISE EXCEPTION 'sem acesso a pasta %', p_pasta;
  END IF;

  v_contato := public.wa_contato_do_telefone(p_telefone);

  SELECT id INTO v_conversa FROM public."WA_CONVERSA" WHERE contato_id = v_contato;
  v_nova := v_conversa IS NULL;
  IF v_nova THEN
    INSERT INTO public."WA_CONVERSA"(contato_id, pasta_codigo) VALUES (v_contato, p_pasta)
    ON CONFLICT (contato_id) DO NOTHING;
    SELECT id INTO v_conversa FROM public."WA_CONVERSA" WHERE contato_id = v_contato;
  END IF;

  -- Conversa que ja existia fica na pasta dela: mover e ato deliberado, que
  -- avisa o contato (whatsapp-mover-pasta). Mas se for uma pasta fora do
  -- acesso de quem chamou, devolver o id seria entregar uma conversa que a
  -- RLS nao deixa abrir — melhor dizer o que houve.
  SELECT pasta_codigo INTO v_pasta FROM public."WA_CONVERSA" WHERE id = v_conversa;
  IF NOT public.wa_pode_ver_pasta(v_pasta) THEN
    RAISE EXCEPTION 'este numero ja esta em atendimento numa pasta que voce nao acessa';
  END IF;

  -- Nome digitado vai para nome_manual — nunca para `nome`. Vazio nao
  -- apaga o que ja estava: quem quer limpar edita na ficha do contato.
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

-- A assinatura antiga (2 argumentos) sairia como sobrecarga e deixaria o
-- PostgREST sem saber qual chamar.
DROP FUNCTION IF EXISTS public.wa_abrir_conversa_por_telefone(text, text);
REVOKE ALL ON FUNCTION public.wa_abrir_conversa_por_telefone(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_abrir_conversa_por_telefone(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_abrir_conversa_por_telefone(text, text, text) TO authenticated;

-- 6) Recrutamento passa a usar o mesmo helper ---------------------------
-- Mesmo comportamento de antes (20260820000006), sem a copia da regra do
-- 9o digito: agora ha um lugar so para corrigir quando a Meta mudar.
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

  -- Sem nome: quem nomeia contato e o webhook, com o profile.name da Meta.
  v_contato := public.wa_contato_do_telefone(v_tel);

  SELECT id INTO v_conversa FROM public."WA_CONVERSA" WHERE contato_id = v_contato;
  IF v_conversa IS NULL THEN
    INSERT INTO public."WA_CONVERSA"(contato_id) VALUES (v_contato)
    ON CONFLICT (contato_id) DO NOTHING;
    SELECT id INTO v_conversa FROM public."WA_CONVERSA" WHERE contato_id = v_contato;
  END IF;

  RETURN v_conversa;
END $$;

REVOKE ALL ON FUNCTION public.recrutamento_abrir_conversa(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recrutamento_abrir_conversa(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.recrutamento_abrir_conversa(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
