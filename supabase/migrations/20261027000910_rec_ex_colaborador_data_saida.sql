-- =========================================================================
-- RECRUTAMENTO: HÁ QUANTO TEMPO O CANDIDATO SAIU DA EMPRESA (27/10/2026)
--
-- PEDIDO (Pablo, chamado Gestão Recrutamento): "Mostrar quanto tempo faz
-- que um candidato saiu da empresa na última vez em que trabalhou, para
-- evitar que seja contratada uma pessoa que já trabalhou a pouco tempo na
-- empresa." Na Gestão Recrutamento e no Banco de Talentos, os dados do
-- candidato mostram a saída; mover para TRIAGEM quem saiu há 90 dias ou
-- menos pede confirmação (a regra dos 90 dias mora na tela —
-- src/lib/recrutamento/exColaborador.ts).
--
-- O QUE MUDA: empregados_por_cpfs (mig 20260619000002) passa a devolver
-- também `afastamento` — a "Data Afastamento" da Senior, já como date pela
-- data_universal (mesmo par Situação = 'Demitido' + Data Afastamento que o
-- turnover usa, mig 20261026000040). A tela decide o que é saída pela
-- Situação; para quem está trabalhando a coluna vem com a data do último
-- afastamento (férias, atestado) ou NULL, e é ignorada.
--
-- Coluna NOVA NO FIM: quem já lê a RPC (Recrutamento, lupa do card)
-- continua igual. Mudar o RETURNS TABLE exige DROP + CREATE — os dois na
-- mesma transação deste arquivo, então não há janela sem a função.
-- Idempotente.
-- =========================================================================

DROP FUNCTION IF EXISTS public.empregados_por_cpfs(text[]);

CREATE FUNCTION public.empregados_por_cpfs(p_cpfs text[])
RETURNS TABLE (
  cpf_match text, id bigint, nome text, cargo text, setor text, perfil text,
  lider text, situacao text, admissao text, empresa text, filial text,
  afastamento date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT regexp_replace(coalesce(e."CPF",''), '\D','','g') AS cpf_match,
         e."ID", e."Nome", e."Título do Cargo", e."Setor_ERP", e."Perfil_ERP",
         e."LIDER", e."Situação", e."Admissão", e."Nome da Empresa", e."Nome Filial",
         public.data_universal(e."Data Afastamento"::text)
  FROM public."EMPREGADOS" e
  WHERE regexp_replace(coalesce(e."CPF",''), '\D','','g') = ANY (
    SELECT regexp_replace(coalesce(x,''), '\D','','g')
    FROM unnest(p_cpfs) AS x
    WHERE coalesce(btrim(x),'') <> ''
  );
$$;
REVOKE ALL ON FUNCTION public.empregados_por_cpfs(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.empregados_por_cpfs(text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.empregados_por_cpfs(text[]);
-- (reaplicar o bloco 3 da mig 20260619000002 — sem a coluna afastamento)
