-- =========================================================================
-- Canal de Ética: a visão v_canal_denuncia não era legível por ninguém
--
-- O SINTOMA (11/09/2026)
--   DEN-2026-00008 (e a 00007, e a 00006) registradas, e a tela Denúncias
--   mostrando "Nenhuma denúncia recebida ainda" — para o admin, com todas
--   as capacidades.
--
-- A CAUSA
--   Duas decisões da 20260914000002 que se anulam:
--     1. a leitura passou a ser pela visão v_canal_denuncia, criada com
--        `security_invoker = true` "para a RLS da tabela continuar valendo";
--     2. o SELECT em CANAL_DENUNCIA foi REVOGADO de `authenticated`, para
--        ninguém ler a identidade do denunciante direto na tabela.
--   Com security_invoker, a visão roda com os privilégios de QUEM CONSULTA —
--   e quem consulta não tem mais SELECT na tabela. Resultado:
--   "permission denied for table CANAL_DENUNCIA" em todo SELECT na visão,
--   que o useQuery da tela engole e mostra como lista vazia. É o mesmo
--   defeito que a 20260916000001 já tinha achado nas policies das tabelas
--   filhas — só que na própria visão ele ficou.
--
-- A CORREÇÃO
--   A visão passa a rodar como DONA (security_invoker off; a dona é postgres,
--   que ignora RLS) e carrega ela mesma a regra de linha da policy:
--   `WHERE canal_denuncia_visivel(d.empresa_id)` — a MESMA função que a
--   policy canal_denuncia_select usa, então quem vê o quê não muda em nada.
--   `security_barrier` impede que uma função de um WHERE de fora seja
--   avaliada antes desse filtro e enxergue linha que não devia.
--
--   O mascaramento da identidade (comite_etica_sigilo) continua igual: o
--   tem_acesso_menu lê o auth.uid() do JWT de quem consulta, não da dona.
--   O SELECT direto na tabela continua revogado.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

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
-- A regra de linha da policy canal_denuncia_select, repetida aqui porque a
-- dona da visão não passa pela RLS.
WHERE public.canal_denuncia_visivel(d.empresa_id);

COMMENT ON VIEW public.v_canal_denuncia IS
  'Leitura do canal: identidade do denunciante mascarada para quem nao tem comite_etica_sigilo, e so as linhas que canal_denuncia_visivel libera. Roda como dona (authenticated nao le CANAL_DENUNCIA direto) — por isso o WHERE repete a policy.';

REVOKE ALL ON public.v_canal_denuncia FROM anon;
GRANT SELECT ON public.v_canal_denuncia TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência (como um usuário do comitê) ──────────────────────────────
-- SELECT protocolo, status, identidade_restrita FROM public.v_canal_denuncia ORDER BY created_at DESC;

-- =========================================================================
-- ROLLBACK — volta ao estado quebrado (ninguém lê); melhor não.
-- =========================================================================
-- ALTER VIEW public.v_canal_denuncia SET (security_invoker = true, security_barrier = false);
-- (e recriar sem o WHERE, pela 20260914000002)
-- NOTIFY pgrst, 'reload schema';
