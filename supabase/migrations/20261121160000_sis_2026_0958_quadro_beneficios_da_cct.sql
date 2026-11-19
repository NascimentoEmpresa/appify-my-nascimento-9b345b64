-- =========================================================================
-- SIS-2026-0958 — Benefícios da CCT na abertura de vagas pela LICITAÇÃO
-- (19/11/2026)
--
-- PEDIDO: em Licitações › Contratos › Editar contrato, seção 7 "Quadro de
-- Postos e Vagas" (as vagas dos aditivos), os BENEFÍCIOS de cada posto têm
-- de vir da CCT vinculada ao posto/contrato, na vigência atual, como estão no
-- cadastro da CCT (valor e unidade: "R$ 27,15 / dia"). Só quando o posto tem
-- algum benefício na Planilha de Custo — fora o VT, que fica para outro
-- chamado (decretos municipais). Sem CCT/vínculo: aviso na tela.
-- Continuação do SIS-2026-0884 (mig 20261117120000) e do SIS-2026-0933.
--
-- O QUE MUDA AQUI: só lic_quadro_remuneracao_do_contrato, que ganha
--   • beneficios_planilha jsonb — {"Aux. Alimentação": 27.15, ...}: os
--     benefícios do bloco "4 — Benefícios Mensais e Diários" da planilha com
--     valor > 0, SEM o Transporte (VT), sem as duas deduções do Malote (não
--     somam no posto) e sem "Deduções". É o que responde "o posto tem
--     benefício na planilha?" e o que a tela mostra quando não tem CCT;
--   • sindicato / servico do posto (para a tela dizer qual sindicato procurou);
--   • referencia com a CCT AUTOMÁTICA PELO SINDICATO (regra do SIS-2026-0933,
--     src/lib/licitacoes/cctPorSindicato.ts) quando o resolvedor do banco
--     (lic_referencia_do_posto_interno: contrato > vínculo manual do posto)
--     devolve 'sem_vinculo'. Mesma chave de nome e mesmo desempate da
--     Planilha de Custo, mas com a data de HOJE no lugar da data de vigência
--     do posto: a vaga abre hoje, então vale a CCT vigente hoje.
--
-- O QUE NÃO MUDA (de propósito): lic_referencia_do_posto_interno, o retrato
-- da vaga (rec_beneficios_congelar) e a Solicitação de Vaga do Operacional /
-- encarregados — o chamado pede só as vagas abertas pela Licitação.
--
-- O retorno muda de forma: CREATE OR REPLACE não aceita → DROP antes.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- Chave do nome do sindicato — espelho de chaveSindicato() em
-- src/lib/licitacoes/cctPorSindicato.ts: sem acento, maiúsculo, espaços
-- repetidos colapsados e sem espaço em volta de "/" e "-".
CREATE OR REPLACE FUNCTION public.lic_chave_sindicato(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT btrim(regexp_replace(regexp_replace(upper(translate(coalesce(p, ''),
           'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
           'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
           '\s+', ' ', 'g'), '\s*([/-])\s*', '\1', 'g'));
$fn$;
REVOKE ALL ON FUNCTION public.lic_chave_sindicato(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lic_chave_sindicato(text) TO authenticated;

-- CCT automática do posto pelo sindicato, no formato de
-- lic_referencia_do_posto_interno (origem 'sindicato'), ou NULL.
-- Desempate (igual a cctAutomaticaDoPosto): cobre a data > período mais
-- próximo; mesmo contrato > sem contrato > outro contrato; categoria igual ao
-- serviço do posto; vigência mais recente; completa antes de pendente;
-- atualizada por último. Decreto municipal não entra.
CREATE OR REPLACE FUNCTION public.lic_cct_por_sindicato_interno(
  p_contrato_id uuid, p_posto text, p_sindicato text, p_servico text, p_data date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_chave text := public.lic_chave_sindicato(p_sindicato);
  v_serv  text := public.lic_chave_sindicato(p_servico);
  c       record;
BEGIN
  IF v_chave = '' THEN
    RETURN NULL;
  END IF;

  SELECT cc.*,
         CASE WHEN p_data IS NULL THEN 0
              WHEN cc.vigencia_inicio IS NOT NULL AND p_data < cc.vigencia_inicio THEN cc.vigencia_inicio - p_data
              WHEN cc.vigencia_fim    IS NOT NULL AND p_data > cc.vigencia_fim    THEN p_data - cc.vigencia_fim
              ELSE 0 END AS distancia
    INTO c
    FROM public."LIC_CONVENCAO_COLETIVA" cc
   WHERE cc.tipo = 'cct'
     AND public.lic_chave_sindicato(cc.sindicato) = v_chave
   ORDER BY distancia,
            CASE WHEN cc.contrato_id IS NOT NULL AND cc.contrato_id = p_contrato_id THEN 0
                 WHEN cc.contrato_id IS NULL THEN 1 ELSE 2 END,
            CASE WHEN v_serv <> '' AND public.lic_chave_sindicato(cc.categoria_profissional) = v_serv THEN 0 ELSE 1 END,
            cc.vigencia_inicio DESC NULLS LAST,
            CASE WHEN cc.situacao = 'completo' THEN 0 ELSE 1 END,
            cc.updated_at DESC NULLS LAST
   LIMIT 1;

  IF c.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'status', 'vinculado',
    'origem', 'sindicato',
    'fora_da_vigencia', c.distancia > 0,
    'contrato_id', p_contrato_id,
    'posto', btrim(p_posto),
    'principal_id', c.id,
    'regras', '{}'::jsonb,
    'referencias', jsonb_build_array(jsonb_build_object(
      'id', c.id, 'versao', c.versao, 'identificacao', c.identificacao,
      'categoria_profissional', c.categoria_profissional, 'sindicato', c.sindicato,
      'municipio', c.municipio, 'vigencia_inicio', c.vigencia_inicio, 'vigencia_fim', c.vigencia_fim,
      'cct_arquivo_path', c.cct_arquivo_path, 'decreto_numero', c.decreto_numero,
      'decreto_arquivo_path', c.decreto_arquivo_path, 'beneficios', c.beneficios,
      'contrato_nome', (SELECT ct.nome FROM public.contratos ct WHERE ct.id = c.contrato_id),
      'situacao', c.situacao)));
END $fn$;
REVOKE ALL ON FUNCTION public.lic_cct_por_sindicato_interno(uuid, text, text, text, date) FROM PUBLIC, anon, authenticated;

-- ── lic_quadro_remuneracao_do_contrato ──────────────────────────────────
-- Corpo igual ao da 20261117120000 (gate, casamento de contrato e de posto),
-- mais as três saídas novas.
DROP FUNCTION IF EXISTS public.lic_quadro_remuneracao_do_contrato(uuid);
CREATE FUNCTION public.lic_quadro_remuneracao_do_contrato(p_contrato_id uuid)
RETURNS TABLE(
  posto text, planilha_custo_id uuid, vigencia date,
  salario numeric, insalubridade numeric, periculosidade numeric,
  lideranca numeric, adicional_noturno_reduzido numeric, adicional_noturno numeric,
  adicional_extra numeric, dsr numeric,
  vt numeric, va numeric, vr numeric, lanche numeric, cesta_basica numeric, assistencia_medica numeric,
  referencia jsonb,
  sindicato text, servico text, beneficios_planilha jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  v_empresa  uuid;
  v_contrato text;
BEGIN
  IF NOT (public.can_access(auth.uid(), 'contrato_quadro_postos', 'visualizar')
          OR public.can_access(auth.uid(), 'contrato_quadro_postos', 'incluir')
          OR public.can_access(auth.uid(), 'contrato_quadro_postos', 'alterar')
          OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT c.empresa_id, c.nome INTO v_empresa, v_contrato
    FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_empresa IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH linhas AS (
    SELECT DISTINCT ON (public.sup_norm_nome(pc.posto)) pc.*
      FROM public.planilha_custo pc
     WHERE btrim(coalesce(pc.posto, '')) <> ''
       AND coalesce(pc.encerrado, false) = false
       AND (pc.contrato_id = p_contrato_id
            OR (pc.contrato_id IS NULL
                AND pc.empresa_id = v_empresa
                AND public.sup_norm_nome(pc.contrato) = public.sup_norm_nome(v_contrato)))
     ORDER BY public.sup_norm_nome(pc.posto), pc.data_vigencia DESC NULLS LAST, pc.created_at DESC NULLS LAST
  ),
  com_ref AS (
    SELECT l.*, public.lic_referencia_do_posto_interno(p_contrato_id, btrim(l.posto)) AS ref
      FROM linhas l
  )
  SELECT btrim(l.posto), l.id, l.data_vigencia,
         l.salario, l.insalubridade, l.periculosidade,
         l.lideranca, l.adicional_noturno_reduzido, l.adicional_noturno,
         l.adicional_extra, l.dsr,
         l.transporte, l.aux_alimentacao, l.aux_refeicao, l.aux_lanche, l.cesta_basica, l.assistencia_medica,
         CASE WHEN l.ref->>'status' = 'sem_vinculo'
              THEN coalesce(public.lic_cct_por_sindicato_interno(p_contrato_id, l.posto, l.sindicato, l.servico, CURRENT_DATE), l.ref)
              ELSE l.ref END,
         btrim(l.sindicato), btrim(l.servico),
         -- Rótulos = os da Planilha de Custo (bloco 4). Transporte (VT) fica
         -- de fora: o VT é outro chamado (decreto municipal).
         coalesce((SELECT jsonb_object_agg(b.rotulo, round(b.valor, 2))
                     FROM (VALUES
                       ('Aux. Alimentação', l.aux_alimentacao), ('Aux. Refeição', l.aux_refeicao),
                       ('Aux. Lanche', l.aux_lanche), ('Ben. Sócio Familiar', l.beneficio_familiar),
                       ('Seguro de Vida', l.seguro_vida), ('Abono Indeniz.', l.abono_indenizatorio),
                       ('Aux. Educação', l.aux_educacao), ('Cesta Básica', l.cesta_basica),
                       ('Assist. Médica', l.assistencia_medica), ('Hospedagem', l.hospedagem),
                       ('Médico/Odontológico', l.odontologico), ('Manut./Capacit. Prof.', l.manutencao_profissional),
                       ('Café', l.cafe), ('Almoço', l.almoco), ('Janta', l.janta), ('Ceia', l.ceia),
                       ('Aux. Funeral', l.funeral), ('Assiduidade', l.assiduidade),
                       ('Ben. Trabalhador', l.beneficio_trabalhador), ('Assist. Patronal', l.patronal),
                       ('Fundo Assistencial', l.fundo_assistencial), ('Fundo Profissional', l.fundo_profissional),
                       ('Natalidade', l.natalidade),
                       (coalesce(nullif(btrim(l.outros_1_descricao), ''), 'Outros 1'), l.outros_1),
                       (coalesce(nullif(btrim(l.outros_2_descricao), ''), 'Outros 2'), l.outros_2),
                       (coalesce(nullif(btrim(l.outros_3_descricao), ''), 'Outros 3'), l.outros_3)
                     ) AS b(rotulo, valor)
                    WHERE coalesce(b.valor, 0) > 0), '{}'::jsonb)
    FROM com_ref l
   ORDER BY btrim(l.posto);
END $fn$;
REVOKE ALL ON FUNCTION public.lic_quadro_remuneracao_do_contrato(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lic_quadro_remuneracao_do_contrato(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   Reaplicar lic_quadro_remuneracao_do_contrato da 20261117120000 (com
--   DROP FUNCTION antes: o retorno muda). Depois:
--   DROP FUNCTION IF EXISTS public.lic_cct_por_sindicato_interno(uuid, text, text, text, date);
--   DROP FUNCTION IF EXISTS public.lic_chave_sindicato(text);
--   NOTIFY pgrst, 'reload schema';
