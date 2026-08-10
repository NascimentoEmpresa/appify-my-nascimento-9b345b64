-- =====================================================================
-- CORRECAO — a RPC do recrutamento nao pode nomear o contato do WhatsApp
--
-- Regra do modulo: o nome do contato vem SO do profile.name que a Meta
-- manda, sem cruzar com EMPREGADOS, profiles ou candidatos. O webhook so
-- grava `nome` quando vem `contacts` no payload, justamente para nao
-- sobrescrever o nome real.
--
-- A recrutamento_abrir_conversa(bigint) furava essa regra: ao criar o
-- contato, copiava WA_CURRICULOS.nome. Resultado real: candidato
-- cadastrado no portal como "TREINAMENTOS" (mesmo CPF de "pablo flores
-- santarem") virou um contato chamado TREINAMENTOS na Caixa de Entrada —
-- conversa de WhatsApp atribuida a uma pessoa que nao e aquela.
--
-- Aqui a funcao passa a inserir so wa_id e telefone. Sem nome, a Caixa
-- mostra o telefone formatado e o proprio webhook preenche o nome certo
-- assim que a pessoa mandar a primeira mensagem.
--
-- Tambem limpa o unico contato contaminado: o que a RPC criou e que nunca
-- trocou mensagem (contato com mensagem tem nome vindo do webhook e nao
-- pode ser tocado).
--
-- Idempotente.
-- ROLLBACK: nao ha o que reverter — voltar seria reintroduzir o bug.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.recrutamento_abrir_conversa(p_candidato_id bigint)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tel       text;
  v_digitos   text;
  v_wa_id     text;
  v_contato   uuid;
  v_conversa  uuid;
BEGIN
  SELECT telefone INTO v_tel
    FROM public."WA_CURRICULOS" WHERE id = p_candidato_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidato % nao encontrado', p_candidato_id;
  END IF;

  v_digitos := regexp_replace(coalesce(v_tel, ''), '\D', '', 'g');
  IF length(v_digitos) < 10 THEN
    RAISE EXCEPTION 'candidato sem telefone valido';
  END IF;
  v_wa_id := CASE WHEN left(v_digitos, 2) = '55' AND length(v_digitos) >= 12
                  THEN v_digitos ELSE '55' || v_digitos END;

  -- Sem `nome`: quem nomeia contato e o webhook, com o profile.name da Meta.
  INSERT INTO public."WA_CONTATO"(wa_id, telefone)
  VALUES (v_wa_id, v_tel)
  ON CONFLICT (wa_id) DO NOTHING;

  SELECT id INTO v_contato FROM public."WA_CONTATO" WHERE wa_id = v_wa_id;

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

-- ── Limpeza do que a versao anterior carimbou ───────────────────────
-- Recorte estreito de proposito: so contato SEM nenhuma mensagem (logo,
-- nunca visto pelo webhook) e cujo nome bate exatamente com o nome de um
-- candidato de mesmo telefone. Contato que ja conversou fica intacto.
UPDATE public."WA_CONTATO" ct
   SET nome = NULL
 WHERE ct.nome IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public."WA_MENSAGEM" m
      JOIN public."WA_CONVERSA" cv ON cv.id = m.conversa_id
     WHERE cv.contato_id = ct.id)
   AND EXISTS (
     SELECT 1 FROM public."WA_CURRICULOS" c
      WHERE c.nome = ct.nome
        AND ct.wa_id = CASE
              WHEN left(regexp_replace(coalesce(c.telefone,''), '\D', '', 'g'), 2) = '55'
               AND length(regexp_replace(coalesce(c.telefone,''), '\D', '', 'g')) >= 12
              THEN regexp_replace(coalesce(c.telefone,''), '\D', '', 'g')
              ELSE '55' || regexp_replace(coalesce(c.telefone,''), '\D', '', 'g') END);

NOTIFY pgrst, 'reload schema';
