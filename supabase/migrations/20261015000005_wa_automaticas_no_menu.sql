-- =========================================================================
-- WHATSAPP — as mensagens AUTOMÁTICAS também no "/" do chat (15/10/2026)
--
-- Pablo: "preciso que todas mensagens que são enviadas hoje automáticas,
-- tenham opção de enviar manualmente no chat ao dar o /".
--
-- As automáticas de hoje:
--   · Recrutamento, ao mover o card (RECRUTAMENTO_MENSAGENS): Triagem,
--     Entrevista, Entrevista Gestor, Aprovado — templates recrutamento_*,
--     com {{1}} = primeiro nome e {{2}} = cargo;
--   · Abertura de conversa do robô (WA_BOT_CONFIG.abertura_*): template
--     abertura_contato.
-- Viram mensagens prontas (WA_TEMPLATE) com o MESMO template da Meta — então
-- saem também fora da janela de 24h. Códigos: /auto_triagem, /auto_entrevista,
-- /auto_entrevista_gestor, /auto_aprovado, /auto_abertura.
-- Um gatilho em RECRUTAMENTO_MENSAGENS mantém o "/" igual quando o RH trocar o
-- template ou o texto de uma etapa (o liga/desliga do automático NÃO desliga a
-- versão manual — é justamente para quando o automático está desligado).
--
-- wa_candidato_do_contato(wa_id): o candidato mais recente com aquele telefone
-- (últimos 8 dígitos, o 9 do celular varia) — a tela preenche nome e cargo.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.wa_codigo_automatica(p_etapa text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT 'auto_' || trim(both '_' from regexp_replace(lower(translate(p_etapa,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]+', '_', 'g'));
$fn$;

-- Uma etapa do recrutamento → mensagem pronta.
CREATE OR REPLACE FUNCTION public.wa_automatica_recrutamento_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_rot text[];
BEGIN
  IF nullif(btrim(coalesce(NEW.template_nome, '')), '') IS NULL THEN RETURN NEW; END IF;
  -- Os parâmetros do automático viram as perguntas do formulário.
  SELECT coalesce(array_agg(CASE p WHEN 'primeiro_nome' THEN 'Primeiro nome' WHEN 'cargo' THEN 'Cargo' WHEN 'nome' THEN 'Nome'
                                    ELSE initcap(replace(p, '_', ' ')) END ORDER BY o), '{}')
    INTO v_rot
    FROM jsonb_array_elements_text(coalesce(to_jsonb(NEW.parametros), '[]'::jsonb)) WITH ORDINALITY AS x(p, o);
  BEGIN
    INSERT INTO public."WA_TEMPLATE" (codigo, titulo, texto, variaveis, template_nome, idioma, categoria, ativo, ordem)
    VALUES (public.wa_codigo_automatica(NEW.etapa),
            'Automática — Recrutamento: ' || initcap(lower(NEW.etapa)),
            coalesce(nullif(btrim(NEW.texto_previa), ''), '(texto do template ' || NEW.template_nome || ')'),
            v_rot, btrim(NEW.template_nome), coalesce(nullif(NEW.template_idioma, ''), 'pt_BR'), 'UTILITY', true, 20)
    ON CONFLICT (codigo) DO UPDATE SET
      texto = EXCLUDED.texto, variaveis = EXCLUDED.variaveis,
      template_nome = EXCLUDED.template_nome, idioma = EXCLUDED.idioma;
  EXCEPTION WHEN unique_violation THEN
    -- O template já é de outra mensagem pronta: não duplica, e não trava o salvar do RH.
    NULL;
  END;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_automatica_recrutamento_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_wa_automatica_recrutamento ON public."RECRUTAMENTO_MENSAGENS";
CREATE TRIGGER trg_wa_automatica_recrutamento
  AFTER INSERT OR UPDATE OF template_nome, template_idioma, texto_previa, parametros ON public."RECRUTAMENTO_MENSAGENS"
  FOR EACH ROW EXECUTE FUNCTION public.wa_automatica_recrutamento_sync();

-- Carga das 4 de hoje (dispara o gatilho).
UPDATE public."RECRUTAMENTO_MENSAGENS" SET texto_previa = texto_previa;

-- A abertura de conversa do robô.
INSERT INTO public."WA_TEMPLATE" (codigo, titulo, texto, variaveis, template_nome, idioma, categoria, ativo, ordem, botoes)
SELECT 'auto_abertura', 'Automática — Abertura de conversa (robô)',
       c.abertura_texto, '{}', c.abertura_template, coalesce(nullif(c.abertura_template_idioma, ''), 'pt_BR'), 'UTILITY', true, 20,
       CASE WHEN nullif(btrim(c.abertura_botao), '') IS NOT NULL THEN ARRAY[btrim(c.abertura_botao)] ELSE '{}' END
  FROM public."WA_BOT_CONFIG" c
 WHERE nullif(btrim(c.abertura_template), '') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public."WA_TEMPLATE" t WHERE t.template_nome = c.abertura_template)
 LIMIT 1
ON CONFLICT (codigo) DO NOTHING;

-- O candidato daquele telefone (para o formulário já vir com nome e cargo).
CREATE OR REPLACE FUNCTION public.wa_candidato_do_contato(p_wa_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
  SELECT jsonb_build_object('nome', c.nome, 'cargo', c.cargo, 'etapa', c.etapa_processo, 'candidato_id', c.candidato_id)
    FROM public."VW_RECRUTAMENTO_CANDIDATOS" c
   WHERE length(regexp_replace(coalesce(p_wa_id, ''), '\D', '', 'g')) >= 8
     AND right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8) = right(regexp_replace(p_wa_id, '\D', '', 'g'), 8)
   ORDER BY c.etapa_changed_at DESC NULLS LAST
   LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.wa_candidato_do_contato(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_candidato_do_contato(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_wa_automatica_recrutamento ON public."RECRUTAMENTO_MENSAGENS";
-- DROP FUNCTION IF EXISTS public.wa_automatica_recrutamento_sync(), public.wa_codigo_automatica(text), public.wa_candidato_do_contato(text);
-- DELETE FROM public."WA_TEMPLATE" WHERE codigo LIKE 'auto\_%';
-- NOTIFY pgrst, 'reload schema';
