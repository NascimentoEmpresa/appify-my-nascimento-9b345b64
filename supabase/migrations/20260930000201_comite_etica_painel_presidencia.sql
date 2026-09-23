-- =========================================================================
-- COMITÊ DE ÉTICA — Painel da Presidência (/app/comite-etica/presidencia)
--
-- PEDIDO (22/09/2026)
--   A diretora (Helena) precisa de uma tela própria, dentro do Comitê de
--   Ética, com as denúncias que já passaram pela apuração e dependem dela:
--     aguardando_presidencia · aguardando_cumprimento · concluida ·
--     arquivada · reaberta
--   Ali ela registra o parecer (decisão) da Presidência e muda a situação
--   da denúncia, para o processo seguir no submódulo Denúncias.
--
-- POR QUE NÃO BASTA LIBERAR O MENU "DENÚNCIAS" PARA ELA
--   `canal_denuncia_visivel` exige `central_servicos_canal_denuncias`, que
--   abre a fila INTEIRA — triagem e apuração em andamento inclusive — e a
--   ficha com todos os campos da apuração editáveis. Decidir não é apurar
--   (mesmo raciocínio da 20260914000002 ao separar `comite_etica_presidencia`).
--
-- O QUE ESTA MIGRATION FAZ (tudo ADITIVO — nada do comitê muda)
--   1. Menu `comite_etica_presidencia_painel` com rota. Nasce FECHADO:
--      has_screen_access nega sem regra (deny-by-default); liberar em
--      Acesso por Usuário.
--   2. Funções de alcance da Presidência: o mesmo recorte por empresa de
--      `canal_denuncia_visivel`, mas só nas 5 situações acima.
--   3. Visão v_canal_denuncia: o WHERE passa a aceitar também o alcance da
--      Presidência. Colunas idênticas às da 20260930000094.
--   4. Policies PERMISSIVAS novas (somam às do comitê via OR): ler e
--      atualizar a denúncia; ler histórico, providências, anexos e arquivos.
--      Sem INSERT/DELETE nas filhas — a Presidência lê o procedimento, não
--      o escreve.
--   5. Trava de campos: quem entra SÓ pelo painel altera apenas situação,
--      justificativa, data de conclusão e a decisão. A decisão continua
--      exigindo `comite_etica_presidencia` (canal_denuncia_guard).
--
-- PARA A HELENA USAR: liberar em Acesso por Usuário
--   · "Presidência" (comite_etica_presidencia_painel)           — a tela
--   · "Pode registrar a decisão da Presidência"                 — gravar parecer
--   · "Vê denúncias de todas as empresas" (comite_etica_todas_empresas),
--     ou vínculo com as empresas — o recorte é o mesmo do comitê.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1. Menu ──────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'comite_etica_presidencia_painel', 'Presidência', '/app/comite-etica/presidencia', 29, true
  FROM public.app_modulo m WHERE m.codigo = 'comite_etica'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2. Alcance da Presidência ────────────────────────────────────────
-- A lista de situações mora numa função só: a visão, as policies e a trava
-- precisam concordar letra por letra (espelho: SITUACOES_PRESIDENCIA em
-- src/pages/comite-etica/vocabulario.ts).
CREATE OR REPLACE FUNCTION public.canal_denuncia_situacao_presidencia(_status text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT _status IN ('aguardando_presidencia', 'aguardando_cumprimento',
                     'concluida', 'arquivada', 'reaberta');
$$;

-- Mesmo recorte por empresa de canal_denuncia_visivel, trocando a porta
-- (o menu do painel no lugar do menu do canal). Sem situação: é o que vale
-- no WITH CHECK, para a Presidência poder devolver o caso ao comitê.
CREATE OR REPLACE FUNCTION public.canal_denuncia_presidencia_alcanca(_empresa_opcao uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('comite_etica_presidencia_painel')
     AND (
       public.tem_acesso_menu('comite_etica_todas_empresas')
       OR EXISTS (
         SELECT 1
           FROM public."CANAL_DENUNCIA_EMPRESA" ce
          WHERE ce.id = _empresa_opcao
            AND ce.empresa_id IS NOT NULL
            AND public.user_pode_atuar_empresa(auth.uid(), ce.empresa_id)
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.canal_denuncia_presidencia_ve(_empresa_opcao uuid, _status text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.canal_denuncia_situacao_presidencia(_status)
     AND public.canal_denuncia_presidencia_alcanca(_empresa_opcao);
$$;

-- Para as filhas e o storage. DEFINER pelo mesmo motivo de
-- canal_denuncia_visivel_por_id: authenticated não lê CANAL_DENUNCIA.
CREATE OR REPLACE FUNCTION public.canal_denuncia_presidencia_ve_por_id(_denuncia uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CANAL_DENUNCIA" d
     WHERE d.id = _denuncia
       AND public.canal_denuncia_presidencia_ve(d.empresa_id, d.status)
  );
$$;

CREATE OR REPLACE FUNCTION public.canal_denuncia_presidencia_ve_por_caminho(_nome text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  BEGIN
    v_id := split_part(COALESCE(_nome, ''), '/', 1)::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;   -- caminho que não começa por uuid não é do canal
  END;
  RETURN public.canal_denuncia_presidencia_ve_por_id(v_id);
END $$;

COMMENT ON FUNCTION public.canal_denuncia_presidencia_ve(uuid, text) IS
  'Painel da Presidencia: ve a denuncia quem tem comite_etica_presidencia_painel, no mesmo recorte de empresa do comite, so nas situacoes pos-apuracao.';

REVOKE ALL ON FUNCTION public.canal_denuncia_situacao_presidencia(text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.canal_denuncia_presidencia_alcanca(uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.canal_denuncia_presidencia_ve(uuid, text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.canal_denuncia_presidencia_ve_por_id(uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.canal_denuncia_presidencia_ve_por_caminho(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_situacao_presidencia(text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_presidencia_alcanca(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_presidencia_ve(uuid, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_presidencia_ve_por_id(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_presidencia_ve_por_caminho(text) TO authenticated;

-- ── 3. Visão ─────────────────────────────────────────────────────────
-- Colunas copiadas da 20260930000094 sem mudança (CREATE OR REPLACE VIEW
-- exige a mesma lista, na mesma ordem). Só o WHERE ganha o OR.
CREATE OR REPLACE VIEW public.v_canal_denuncia
WITH (security_invoker = false, security_barrier = true) AS
SELECT
  d.id, d.protocolo, d.identificado, d.anonimo,
  CASE WHEN public.tem_acesso_menu('comite_etica_sigilo') THEN d.nome_completo  END AS nome_completo,
  CASE WHEN public.tem_acesso_menu('comite_etica_sigilo') THEN d.cpf            END AS cpf,
  CASE WHEN public.tem_acesso_menu('comite_etica_sigilo') THEN d.email          END AS email,
  CASE WHEN public.tem_acesso_menu('comite_etica_sigilo') THEN d.data_nascimento END AS data_nascimento,
  CASE WHEN public.tem_acesso_menu('comite_etica_sigilo') THEN d.telefone_fixo  END AS telefone_fixo,
  CASE WHEN public.tem_acesso_menu('comite_etica_sigilo') THEN d.celular        END AS celular,
  (d.identificado AND NOT public.tem_acesso_menu('comite_etica_sigilo')) AS identidade_restrita,

  d.empresa_id, d.empresa_nome, d.contrato_informado, d.contrato_situacao,
  d.relacao, d.tipo_denuncia, d.local_ocorrencia, d.como_soube,
  d.ocorrencia_data, d.ocorrencia_hora, d.ocorrencia_frequencia,
  d.risco_imediato, d.risco_imediato_detalhe, d.retaliacao, d.retaliacao_detalhe,
  d.denunciado_informado, d.denunciado_funcao,
  d.lideranca_ciente, d.lideranca_envolvida, d.lideranca_ocultou,
  d.lideranca_ciente_quem, d.lideranca_envolvida_quem, d.lideranca_ocultou_quem,
  d.titulo, d.resumo, d.descricao, d.testemunhas, d.evidencias,
  d.valor_financeiro, d.sugestao,

  d.origem, d.tipo_classificado, d.gravidade, d.sigilo,
  d.denunciado_nome, d.denunciado_empregado_id, d.lider_nome, d.lider_empregado_id,
  d.diretoria, d.contrato, d.setor, d.unidade, d.cidade,
  d.apuracao_responsavel, d.apuracao_responsavel_id,
  d.apuracao_inicio, d.apuracao_fim, d.primeira_providencia_em,
  d.pendencia_atual, d.evidencias_analise,
  d.resultado, d.medidas, d.medida_principal, d.recomendacao,
  d.houve_recurso, d.recurso_resultado, d.recurso_data,
  d.causa_raiz, d.causa_raiz_detalhe, d.acoes_preventivas, d.acoes_corretivas,
  d.sla_dias_override,
  d.status, d.justificativa_mudanca, d.parecer_interno, d.retorno_denunciante,

  d.decisao_final, d.decisao_em, d.decisao_fundamentacao,
  d.decisao_sobre_parecer, d.decisao_medidas, d.decisao_por_nome,

  d.concluido_em, d.ultima_movimentacao_em, d.created_at, d.updated_at
FROM public."CANAL_DENUNCIA" d
-- A regra de linha das policies, repetida porque a dona da visão não passa
-- pela RLS: o comitê (canal) OU a Presidência (painel, situações pós-apuração).
WHERE public.canal_denuncia_visivel(d.empresa_id)
   OR public.canal_denuncia_presidencia_ve(d.empresa_id, d.status);

REVOKE ALL ON public.v_canal_denuncia FROM anon;
GRANT SELECT ON public.v_canal_denuncia TO authenticated;

-- ── 4. Policies aditivas ─────────────────────────────────────────────
-- As policies novas leem `status`; sem SELECT na coluna o UPDATE morre antes
-- da RLS (mesmo tropeço da 20260930000107). Situação não é identidade.
GRANT SELECT (status) ON public."CANAL_DENUNCIA" TO authenticated;

DROP POLICY IF EXISTS canal_denuncia_presidencia_select ON public."CANAL_DENUNCIA";
CREATE POLICY canal_denuncia_presidencia_select ON public."CANAL_DENUNCIA"
  FOR SELECT TO authenticated
  USING (public.canal_denuncia_presidencia_ve(empresa_id, status));

-- USING com situação (só mexe no que está na fila dela); WITH CHECK sem
-- situação: devolver ao comitê ("Em apuração", "Parecer em elaboração")
-- tira o caso do painel, e isso é o seguimento, não uma violação.
DROP POLICY IF EXISTS canal_denuncia_presidencia_update ON public."CANAL_DENUNCIA";
CREATE POLICY canal_denuncia_presidencia_update ON public."CANAL_DENUNCIA"
  FOR UPDATE TO authenticated
  USING (public.canal_denuncia_presidencia_ve(empresa_id, status))
  WITH CHECK (public.canal_denuncia_presidencia_alcanca(empresa_id));

DROP POLICY IF EXISTS canal_evento_presidencia_select ON public."CANAL_DENUNCIA_EVENTO";
CREATE POLICY canal_evento_presidencia_select ON public."CANAL_DENUNCIA_EVENTO"
  FOR SELECT TO authenticated
  USING (public.canal_denuncia_presidencia_ve_por_id(denuncia_id));

DROP POLICY IF EXISTS canal_prov_presidencia_select ON public."CANAL_DENUNCIA_PROVIDENCIA";
CREATE POLICY canal_prov_presidencia_select ON public."CANAL_DENUNCIA_PROVIDENCIA"
  FOR SELECT TO authenticated
  USING (public.canal_denuncia_presidencia_ve_por_id(denuncia_id));

-- Anexo sigiloso continua exigindo comite_etica_sigilo, como no comitê.
DROP POLICY IF EXISTS canal_anexo_presidencia_select ON public."CANAL_DENUNCIA_ANEXO";
CREATE POLICY canal_anexo_presidencia_select ON public."CANAL_DENUNCIA_ANEXO"
  FOR SELECT TO authenticated
  USING ((NOT sensivel OR public.tem_acesso_menu('comite_etica_sigilo'))
         AND public.canal_denuncia_presidencia_ve_por_id(denuncia_id));

DROP POLICY IF EXISTS "denuncia evid presidencia select" ON storage.objects;
CREATE POLICY "denuncia evid presidencia select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'denuncia-evidencias'
         AND public.canal_denuncia_presidencia_ve_por_caminho(name));

-- ── 5. Trava de campos de quem entra só pelo painel ──────────────────
-- A policy de UPDATE é por LINHA; sem isto, quem tem só o painel poderia
-- reescrever gravidade, resultado ou parecer do comitê pela API.
--
-- O nome começa com "trg_canal_denuncia_p…" de propósito: gatilhos BEFORE
-- do mesmo evento rodam em ordem alfabética, então este roda DEPOIS de
-- trg_canal_denuncia_guard (que carimba decisao_em/por e updated_at) e de
-- trg_canal_denuncia_movimentou — por isso esses carimbos estão entre os
-- permitidos.
CREATE OR REPLACE FUNCTION public.canal_denuncia_presidencia_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_permitidos text[] := ARRAY[
    'status', 'justificativa_mudanca', 'concluido_em',
    'decisao_final', 'decisao_em', 'decisao_fundamentacao',
    'decisao_sobre_parecer', 'decisao_medidas',
    'decisao_por_user_id', 'decisao_por_nome',
    'updated_at', 'ultima_movimentacao_em'
  ];
BEGIN
  -- Sem usuário (tick, service role) ou membro do comitê: nada muda.
  IF auth.uid() IS NULL OR public.canal_denuncia_visivel(OLD.empresa_id) THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_permitidos) IS DISTINCT FROM (to_jsonb(OLD) - v_permitidos) THEN
    RAISE EXCEPTION 'Pelo painel da Presidência só se altera a situação e a decisão. Os demais campos são do Comitê.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_canal_denuncia_presidencia_guard ON public."CANAL_DENUNCIA";
CREATE TRIGGER trg_canal_denuncia_presidencia_guard
  BEFORE UPDATE ON public."CANAL_DENUNCIA"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_presidencia_guard();

NOTIFY pgrst, 'reload schema';

-- ── Conferência (logado como a Presidência) ──────────────────────────
-- SELECT protocolo, status FROM public.v_canal_denuncia ORDER BY created_at DESC;
--   → só as 5 situações; quem tem também o menu do canal vê todas.

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_canal_denuncia_presidencia_guard ON public."CANAL_DENUNCIA";
-- DROP FUNCTION IF EXISTS public.canal_denuncia_presidencia_guard();
-- DROP POLICY IF EXISTS "denuncia evid presidencia select" ON storage.objects;
-- DROP POLICY IF EXISTS canal_anexo_presidencia_select ON public."CANAL_DENUNCIA_ANEXO";
-- DROP POLICY IF EXISTS canal_prov_presidencia_select ON public."CANAL_DENUNCIA_PROVIDENCIA";
-- DROP POLICY IF EXISTS canal_evento_presidencia_select ON public."CANAL_DENUNCIA_EVENTO";
-- DROP POLICY IF EXISTS canal_denuncia_presidencia_update ON public."CANAL_DENUNCIA";
-- DROP POLICY IF EXISTS canal_denuncia_presidencia_select ON public."CANAL_DENUNCIA";
-- REVOKE SELECT (status) ON public."CANAL_DENUNCIA" FROM authenticated;
-- Recriar v_canal_denuncia pela 20260930000094 (WHERE só com canal_denuncia_visivel).
-- DROP FUNCTION IF EXISTS public.canal_denuncia_presidencia_ve_por_caminho(text);
-- DROP FUNCTION IF EXISTS public.canal_denuncia_presidencia_ve_por_id(uuid);
-- DROP FUNCTION IF EXISTS public.canal_denuncia_presidencia_ve(uuid, text);
-- DROP FUNCTION IF EXISTS public.canal_denuncia_presidencia_alcanca(uuid);
-- DROP FUNCTION IF EXISTS public.canal_denuncia_situacao_presidencia(text);
-- UPDATE public.app_menu SET ativo = false WHERE codigo = 'comite_etica_presidencia_painel';
-- NOTIFY pgrst, 'reload schema';
