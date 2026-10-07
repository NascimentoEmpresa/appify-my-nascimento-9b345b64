-- =========================================================================
-- RH › Ativos/Contratos — carregar rápido (07/10/2026)
--
-- PEDIDO (Pablo): "tá dando erro no ativos/contratos algumas vezes, e tá
-- demorando demais pra carregar, tem que ficar quase instantâneo". O erro é
-- "canceling statement due to statement timeout" (print do José Ferreira):
-- o rh_ac_painel levava ~5,6 s e o limite do papel authenticated é 8 s —
-- bastava o banco estar um pouco ocupado para estourar.
--
-- CAUSA: rh_ac_ativos (mig 20261005000001) levava 5,4 s dos 5,6 s. Para
-- cada uma das ~2.300 pessoas ativas, quatro subconsultas correlacionadas
-- comparavam rh_norm_contrato(<campo da pessoa>) com cada contrato — a
-- normalização (três regexp) rodava milhares de vezes por pessoa. Ler as
-- pessoas sozinho leva 18 ms.
--
-- CORREÇÃO: normaliza "Nome Filial" e "Descrição do Local" UMA vez por
-- pessoa e casa com contratos/depara por LEFT JOIN (hash). Mesma ordem de
-- preferência do COALESCE antigo: depara pelo nome exato → contrato pelo
-- nome normalizado → depara normalizado → contrato pelo local. Resultado
-- idêntico (conferido linha a linha contra a versão antiga): o depara não
-- tem filial nem nome normalizado apontando para dois contratos, e ct já
-- era um por nome normalizado — os LIMIT 1 nunca escolhiam entre dois.
--
-- rh_ac_painel e rh_ac_pessoas não mudam: leem rh_ac_ativos.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rh_ac_ativos()
 RETURNS TABLE(empregado_id bigint, cadastro text, nome text, cargo text, posto_senior text, situacao text, admissao text, filial text, local text, contrato_id uuid, empresa bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH ct AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(c.nome))
           public.rh_norm_contrato(c.nome) AS nn, c.id
      FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(c.nome),
              (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC
  ),
  dp_nome AS MATERIALIZED (
    SELECT DISTINCT ON (d.filial_nome) d.filial_nome, d.contrato_id
      FROM public.sup_empregado_contrato_depara d
     ORDER BY d.filial_nome, d.contrato_id
  ),
  dp_nn AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(d.filial_nome)) public.rh_norm_contrato(d.filial_nome) AS nn, d.contrato_id
      FROM public.sup_empregado_contrato_depara d
     WHERE public.rh_norm_contrato(d.filial_nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(d.filial_nome), d.contrato_id
  ),
  -- 07/10/2026: normaliza uma vez por pessoa (antes: por pessoa × contrato).
  e AS MATERIALIZED (
    SELECT x.*, public.rh_norm_contrato(x."Nome Filial") AS nn_filial,
           public.rh_norm_contrato(x."Descrição do Local") AS nn_local
      FROM public."EMPREGADOS" x
     WHERE public.esp_col_esta_ativo(x."Situação")
       AND COALESCE(btrim(x."Nome"), '') <> ''
  )
  SELECT e."ID"::bigint,
         e."Cadastro"::text,
         e."Nome",
         e."Título do Cargo",
         btrim(COALESCE(e."Nome do Posto", '')),
         e."Situação",
         e."Admissão"::text,
         e."Nome Filial",
         e."Descrição do Local",
         COALESCE(d1.contrato_id, c1.id, d2.contrato_id, c2.id),
         e."Empresa"::bigint
    FROM e
    LEFT JOIN dp_nome d1 ON d1.filial_nome = e."Nome Filial"
    LEFT JOIN ct c1      ON c1.nn = e.nn_filial
    LEFT JOIN dp_nn d2   ON d2.nn = e.nn_filial
    LEFT JOIN ct c2      ON c2.nn = e.nn_local;
$function$;

REVOKE ALL ON FUNCTION public.rh_ac_ativos() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar rh_ac_ativos da mig 20261005000001 (subconsultas correlacionadas).
