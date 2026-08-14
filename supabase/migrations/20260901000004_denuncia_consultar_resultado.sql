-- =====================================================================
-- CANAL DE DENÚNCIAS — a consulta pública passa a devolver o resultado
--
-- POR QUE
-- A 20260901000003 separou SITUAÇÃO de RESULTADO. Antes, "procedente" era o
-- próprio status, então quem consultava o protocolo via o desfecho de graça.
-- Depois da separação, o status de um caso terminado é só "encerrada" — sem
-- esta função devolver `resultado`, o denunciante PERDERIA a informação que
-- já recebia hoje. Isso não é campo novo para ele: é manter o que existia.
--
-- Continua não devolvendo o relato, nem parecer interno, nem nome de
-- ninguém — só protocolo, andamento, desfecho e o retorno escrito para ele.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.denuncia_consultar(p_protocolo text, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE r record;
BEGIN
  SELECT d.protocolo, d.status, d.resultado, d.created_at, d.updated_at,
         d.tipo_denuncia, d.retorno_denunciante, d.concluido_em, d.senha_hash
    INTO r
    FROM public."CANAL_DENUNCIA" d
   WHERE d.protocolo = btrim(upper(COALESCE(p_protocolo, '')));

  -- Mesma resposta para protocolo inexistente e senha errada: distinguir os
  -- dois casos entregaria de graça quais protocolos existem.
  IF r.protocolo IS NULL OR r.senha_hash <> crypt(COALESCE(p_senha, ''), r.senha_hash) THEN
    RAISE EXCEPTION 'Protocolo ou senha inválidos.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'protocolo',     r.protocolo,
    'status',        r.status,
    'resultado',     r.resultado,
    'tipo_denuncia', r.tipo_denuncia,
    'registrada_em', r.created_at,
    'atualizada_em', r.updated_at,
    'concluida_em',  r.concluido_em,
    'retorno',       r.retorno_denunciante
  );
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_consultar(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_consultar(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: recriar a versão da 20260812000001 (sem 'resultado' no retorno).
