-- =====================================================================
-- RECRUTAMENTO — deixar a config pronta para submeter na Meta
--
-- 1) Nome de template: a Meta so aceita minusculas, numeros e underscore.
--    Estava gravado "Triagem", "Entrevista Gestor" etc., que o envio
--    recusaria com 132001. Vira triagem, entrevista_gestor...
--    Prefixo recrutamento_ para nao colidir com template de outro assunto
--    na mesma conta (o namespace de template e da WABA inteira).
--
-- 2) Corpo do template nao pode TERMINAR em variavel. O texto da segunda
--    entrevista acabava em "... da vaga de {{2}}." e seria reprovado na
--    revisao. Reescrito para fechar com texto fixo.
--
-- Continuam todas DESLIGADAS: template so vale depois de aprovado pela Meta.
--
-- Idempotente.
-- ROLLBACK: os nomes antigos eram invalidos; nao ha por que voltar.
-- =====================================================================

UPDATE public."RECRUTAMENTO_MENSAGENS" SET template_nome = 'recrutamento_triagem'
 WHERE etapa = 'TRIAGEM';
UPDATE public."RECRUTAMENTO_MENSAGENS" SET template_nome = 'recrutamento_entrevista'
 WHERE etapa = 'ENTREVISTA';
UPDATE public."RECRUTAMENTO_MENSAGENS" SET template_nome = 'recrutamento_entrevista_gestor'
 WHERE etapa = 'ENTREVISTA GESTOR';
UPDATE public."RECRUTAMENTO_MENSAGENS" SET template_nome = 'recrutamento_aprovado'
 WHERE etapa = 'APROVADO';

-- Fecha com texto fixo: "...{{2}}." no fim reprova na revisao da Meta.
UPDATE public."RECRUTAMENTO_MENSAGENS"
   SET texto_previa = 'Ola {{1}}! Voce avancou para a segunda entrevista da vaga de {{2}}, agora com o gestor da area. Em breve entramos em contato para agendar.'
 WHERE etapa = 'ENTREVISTA GESTOR';

-- Trava: nome fora do padrao volta a quebrar o envio la na frente.
DO $$
DECLARE ruins text;
BEGIN
  SELECT string_agg(etapa || '=' || template_nome, ', ') INTO ruins
    FROM public."RECRUTAMENTO_MENSAGENS"
   WHERE template_nome IS NOT NULL AND template_nome !~ '^[a-z0-9_]+$';
  IF ruins IS NOT NULL THEN
    RAISE EXCEPTION 'nome de template invalido para a Meta: %', ruins;
  END IF;

  SELECT string_agg(etapa, ', ') INTO ruins
    FROM public."RECRUTAMENTO_MENSAGENS"
   WHERE texto_previa ~ '\{\{\d+\}\}\s*[.!?]?$';
  IF ruins IS NOT NULL THEN
    RAISE EXCEPTION 'corpo termina em variavel (a Meta reprova): %', ruins;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
