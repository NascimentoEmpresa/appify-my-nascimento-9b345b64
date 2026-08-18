-- =========================================================================
-- RECRUTAMENTO — status da vaga alinhado ao fluxo novo, e a vaga fica no
-- portal /vagas ate a ADMISSAO
--
-- TRES CORRECOES:
--
-- 1) sr_rank_etapa nao acompanhou o fluxo. Ele ainda ranqueava 'EXAME SST'
--    e 'COMPRAS' separados (que viraram 'SST + COMPRAS'), usava 'APROVADOS'
--    no plural enquanto o kanban usa 'APROVADO' no singular, punha
--    DOCUMENTACAO depois de COMPRAS quando ela vem ANTES, e nao conhecia
--    'ADMISSAO'. Etapa desconhecida cai em 0, e com rank 0 o status da vaga
--    voltava para "Vaga aberta" — a vaga parecia nao ter andado.
--
-- 2) A vaga so aparecia no portal publico com status
--    'Vaga aberta - Seleção de Currículos'. Assim que o primeiro candidato
--    saia da triagem, a vaga sumia de /vagas — mesmo ainda precisando de
--    gente, porque candidato desiste e reprova o tempo todo. Passa a ficar
--    visivel durante TODO o processo e so sair quando alguem e efetivado.
--
-- 3) Status novo para a etapa paralela: 'Aguardando SST e Compras'. Os tres
--    antigos ('Encaminhado para SST (ASO)', 'ASO Aprovado - Aguardando
--    Informe de EPIs', 'Aguardando Confirmação Compras') descreviam uma
--    fila que nao existe mais.
--
-- Idempotente.
-- ROLLBACK: definicoes anteriores em 20260618000001 e nas migrations do
--   portal; o status 'Aguardando SST e Compras' volta a ser um dos tres
--   antigos por UPDATE manual.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sr_rank_etapa(p text)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p
    WHEN 'ENTRADA'            THEN 1
    WHEN 'TRIAGEM'            THEN 2
    WHEN 'JURÍDICO'           THEN 3
    WHEN 'ENTREVISTA'         THEN 4
    WHEN 'ENTREVISTA GESTOR'  THEN 5
    WHEN 'APROVADO'           THEN 6
    WHEN 'APROVADOS'          THEN 6   -- nome antigo, ainda gravado em registros
    WHEN 'DOCUMENTAÇÃO'       THEN 7   -- vem ANTES do SST no fluxo real
    WHEN 'SST + COMPRAS'      THEN 8
    WHEN 'EXAME SST'          THEN 8   -- antes da fusao
    WHEN 'COMPRAS'            THEN 8   -- antes da fusao
    WHEN 'ADMISSÃO'           THEN 9
    ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.sr_sync_status_solicitacao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_vaga bigint; v_atual text; v_rank int; v_envadm timestamptz; v_new text;
BEGIN
  v_vaga := COALESCE(NEW.vaga_id, OLD.vaga_id);
  IF v_vaga IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT status INTO v_atual FROM public."SISTEMA_RECRUTAMENTO" WHERE id = v_vaga;
  -- Vaga que nem chegou ao Recrutamento, ou ja encerrada, nao e dirigida
  -- pelo candidato.
  IF v_atual IS NULL OR v_atual IN ('Pendente Operacional','Pendente Recrutamento','Reprovada','Concluída') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- O candidato MAIS ADIANTADO manda no status da vaga. Desistente e
  -- reprovado ficam de fora: eles nao representam o andamento.
  SELECT public.sr_rank_etapa(c.etapa_processo), c.enviado_admissao_em
    INTO v_rank, v_envadm
    FROM public."WA_CURRICULOS" c
   WHERE c.vaga_id = v_vaga
     AND c.etapa_processo IS NOT NULL
     AND c.etapa_processo <> 'Reprovado'
   ORDER BY public.sr_rank_etapa(c.etapa_processo) DESC,
            c.enviado_admissao_em DESC NULLS LAST
   LIMIT 1;

  v_new := CASE
    WHEN v_rank IS NULL OR v_rank <= 2 THEN 'Vaga aberta - Seleção de Currículos'
    WHEN v_rank = 3 THEN 'Em análise jurídica'
    WHEN v_rank = 4 THEN 'Entrevista e Avaliação'
    WHEN v_rank = 5 THEN 'Entrevista com Gestor'
    WHEN v_rank = 6 THEN 'Aprovado - Aguardando SST'
    WHEN v_rank = 7 THEN 'Compras Confirmou - Aguardando Documentação'
    WHEN v_rank = 8 THEN 'Aguardando SST e Compras'
    -- ADMISSAO: so vira 'Contratado' quando alguem foi de fato EFETIVADO.
    -- Estar na coluna nao basta — e o envio a Admissao que fecha a vaga.
    WHEN v_rank = 9 THEN CASE WHEN v_envadm IS NOT NULL THEN 'Contratado' ELSE 'Aguardando SST e Compras' END
    ELSE v_atual END;

  IF v_new IS DISTINCT FROM v_atual THEN
    UPDATE public."SISTEMA_RECRUTAMENTO" SET status = v_new WHERE id = v_vaga;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- ── Portal publico ──────────────────────────────────────────────────────
-- Lista de EXCLUSAO em vez de inclusao: status novo que apareca no fluxo
-- continua visivel sozinho, sem precisar lembrar de vir aqui. Sai do ar
-- quem foi contratado, encerrado, reprovado ou ainda nem foi aprovado.
CREATE OR REPLACE FUNCTION public.portal_vagas_por_cidade(p_cidade text)
RETURNS TABLE(id integer, cargo text, contrato text, cidade text, escala text,
              salario text, beneficios text, quantidade_vagas integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT s."id", s."cargo", s."contrato", s."cidade", s."escala",
         s."salario", s."beneficios", s."quantidade_vagas"
    FROM public."SISTEMA_RECRUTAMENTO" s
   WHERE s."status" NOT IN ('Pendente Operacional','Pendente Recrutamento',
                            'Reprovada','Concluída','Contratado')
     AND btrim(lower(s."cidade")) = btrim(lower(coalesce(p_cidade, '')))
   ORDER BY s."cargo";
$$;

CREATE OR REPLACE FUNCTION public.portal_cidades_com_vagas()
RETURNS TABLE(cidade text, vagas bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT btrim(s."cidade") AS cidade, count(*) AS vagas
    FROM public."SISTEMA_RECRUTAMENTO" s
   WHERE s."status" NOT IN ('Pendente Operacional','Pendente Recrutamento',
                            'Reprovada','Concluída','Contratado')
     AND btrim(coalesce(s."cidade",'')) <> ''
   GROUP BY 1
   ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.portal_vagas_por_cidade(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_cidades_com_vagas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_vagas_por_cidade(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_cidades_com_vagas() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
