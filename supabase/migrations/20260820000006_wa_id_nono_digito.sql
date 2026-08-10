-- =====================================================================
-- CORRECAO — casar o candidato com o contato certo do WhatsApp (9o digito)
--
-- Celular brasileiro tem 9 digitos desde 2016, mas a Cloud API guarda o
-- wa_id na forma LEGADA, sem o 9: 71 dos 73 contatos deste WABA tem 12
-- digitos (55 + DDD + 8), nao 13.
--
-- A recrutamento_abrir_conversa montava o E.164 completo (55 + DDD + 9
-- digitos = 13) e nao achava ninguem. Efeito medido nos 13 candidatos:
-- a regra antiga nao encontrou NENHUM contato existente; a forma legada
-- encontrou 10. Na pratica o icone de WhatsApp do card criava uma conversa
-- nova e vazia em vez de abrir a conversa real da pessoa — foi o que
-- aconteceu com o Pablo (contato "Pablo Tasuyuki", 37 mensagens, desde
-- 29/07) que virou um contato duplicado sem mensagem nenhuma.
--
-- Nota: biblioteca de telefone (libphonenumber e afins) NAO resolve isto.
-- Elas normalizam para E.164, que e justamente a forma de 13 digitos que
-- falha aqui. O 9o digito do WhatsApp e regra da Meta, nao da numeracao.
--
-- Solucao: casar pelo trecho estavel, que nao muda entre as duas formas —
-- pais + DDD + os 8 ultimos digitos. Achou, usa o contato que existe, seja
-- qual for a forma. Nao achou, cria na forma legada, que e a que o webhook
-- produz — assim a primeira mensagem cai no mesmo registro.
--
-- Idempotente.
-- ROLLBACK: DROP FUNCTION IF EXISTS public.recrutamento_abrir_conversa(bigint);
-- =====================================================================

CREATE OR REPLACE FUNCTION public.recrutamento_abrir_conversa(p_candidato_id bigint)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tel      text;
  v_d        text;   -- so digitos
  v_nac      text;   -- nacional, sem o 55
  v_ddd      text;
  v_tail     text;   -- 8 ultimos digitos: estaveis entre as duas formas
  v_wa_id    text;
  v_contato  uuid;
  v_conversa uuid;
BEGIN
  SELECT telefone INTO v_tel FROM public."WA_CURRICULOS" WHERE id = p_candidato_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidato % nao encontrado', p_candidato_id;
  END IF;

  v_d := regexp_replace(coalesce(v_tel, ''), '\D', '', 'g');
  IF length(v_d) < 10 THEN
    RAISE EXCEPTION 'candidato sem telefone valido';
  END IF;

  -- Tira o 55 so quando ele e mesmo o pais: 12 ou 13 digitos. Numero de
  -- 10/11 digitos comecando com 55 e DDD 55 (Santa Maria/RS), nao pais —
  -- e a regiao do contrato HUSM, entao nao e caso hipotetico.
  v_nac := CASE WHEN left(v_d, 2) = '55' AND length(v_d) IN (12, 13)
                THEN substr(v_d, 3) ELSE v_d END;
  v_ddd  := left(v_nac, 2);
  v_tail := right(v_nac, 8);

  -- 1) Contato que ja existe, em qualquer das duas formas.
  SELECT id, wa_id INTO v_contato, v_wa_id
    FROM public."WA_CONTATO"
   WHERE wa_id LIKE '55' || v_ddd || '%'
     AND right(wa_id, 8) = v_tail
   -- Preferir o que ja conversou: se houver duplicata, a conversa real vence.
   ORDER BY (SELECT count(*) FROM public."WA_CONVERSA" cv
              JOIN public."WA_MENSAGEM" m ON m.conversa_id = cv.id
             WHERE cv.contato_id = "WA_CONTATO".id) DESC,
            created_at ASC
   LIMIT 1;

  -- 2) Nao existe: cria na forma legada (55 + DDD + 8), que e a que o
  --    webhook grava — senao a primeira mensagem abriria outro registro.
  IF v_contato IS NULL THEN
    v_wa_id := '55' || v_ddd || v_tail;
    INSERT INTO public."WA_CONTATO"(wa_id, telefone)
    VALUES (v_wa_id, v_tel)
    ON CONFLICT (wa_id) DO NOTHING;
    SELECT id INTO v_contato FROM public."WA_CONTATO" WHERE wa_id = v_wa_id;
  END IF;

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

-- ── Remove as duplicatas que a versao anterior criou ────────────────
-- Recorte estreito: contato SEM nenhuma mensagem, cuja conversa tambem
-- esta vazia, e que tem um gemeo (mesmo DDD + mesmos 8 finais) COM
-- mensagem. Contato sem gemeo fica — pode ser numero legitimo novo.
WITH duplicado AS (
  SELECT ct.id
    FROM public."WA_CONTATO" ct
   WHERE NOT EXISTS (
           SELECT 1 FROM public."WA_CONVERSA" cv
             JOIN public."WA_MENSAGEM" m ON m.conversa_id = cv.id
            WHERE cv.contato_id = ct.id)
     AND EXISTS (
           SELECT 1 FROM public."WA_CONTATO" g
             JOIN public."WA_CONVERSA" cv2 ON cv2.contato_id = g.id
             JOIN public."WA_MENSAGEM" m2  ON m2.conversa_id = cv2.id
            WHERE g.id <> ct.id
              AND right(g.wa_id, 8) = right(ct.wa_id, 8)
              AND substr(g.wa_id, 3, 2) = substr(ct.wa_id, 3, 2))
)
DELETE FROM public."WA_CONTATO" WHERE id IN (SELECT id FROM duplicado);

NOTIFY pgrst, 'reload schema';
