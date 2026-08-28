-- =====================================================================
-- REEMBOLSO — corrige o vínculo usuário ↔ empregado.
--
-- BUG. As funções `cs_reembolso_lidera_setor` (20260930000006) e
-- `cs_reembolso_meu_setor` (20260930000010007) foram escritas assim:
--
--     JOIN public.profiles p ON p.empregado_id = e."ID"
--    WHERE p.id = auth.uid()
--
-- e `public.profiles` NÃO TEM a coluna `empregado_id`. O vínculo entre o
-- login e o cadastro da Senior é o inverso: mora em `EMPREGADOS.auth_user_id`
-- (é assim que `meu_empregado()` e o hook useVinculoEmpregado resolvem).
--
-- COMO ISSO PASSOU. A 20260930000006 nunca chegou a rodar no banco — a
-- primeira tentativa de aplicá-la parou exatamente aqui, com
-- "42703: column p.empregado_id does not exist". Como as migrations deste
-- projeto são aplicadas à mão e o merge não executa nada, o erro viajou até a
-- main sem nunca encostar no Postgres. O CI (type-check, testes, build) não
-- olha SQL, e a portaria confere regras de RLS, não schema.
--
-- Por que uma migration nova em vez de corrigir as duas: elas já estão na
-- main, e migration mergeada é append-only (R4). Correção vira migration
-- nova, mesmo quando a original nunca rodou.
--
-- ORDEM DE APLICAÇÃO. A ...0006 cria `cs_reembolso_lidera_setor` como
-- LANGUAGE sql, e o Postgres valida o corpo de função SQL na criação — então
-- ela não passa como está. Ao aplicar a ...0006 pela primeira vez, use o
-- corpo desta migration para essa função. `cs_reembolso_meu_setor` é plpgsql
-- (corpo só é resolvido em execução), então a ...0007 aplica normalmente e
-- esta migration a conserta depois.
-- =====================================================================

-- 1) Quem lidera o setor -------------------------------------------------
-- Segue OBSOLETA desde a ...0007 (o recorte passou a ser
-- cs_reembolso_aprova_setor), mas precisa existir e ser válida: a ...0006 a
-- cria, e função SQL com corpo inválido derruba a migration inteira.
CREATE OR REPLACE FUNCTION public.cs_reembolso_lidera_setor(_setor text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    -- Não lidera setor nenhum → enxerga tudo (perfil central).
    WHEN NOT EXISTS (
      SELECT 1 FROM public."CS_LIDERES_SETOR" l
        JOIN public."EMPREGADOS" e ON e."ID" = l.empregado_id
       WHERE e.auth_user_id = auth.uid()
    ) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public."CS_LIDERES_SETOR" l
        JOIN public."EMPREGADOS" e ON e."ID" = l.empregado_id
       WHERE e.auth_user_id = auth.uid() AND l.setor = _setor
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.cs_reembolso_lidera_setor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_lidera_setor(text) TO authenticated;

COMMENT ON FUNCTION public.cs_reembolso_lidera_setor(text) IS
  'OBSOLETA desde 20260930000007 — o recorte agora é cs_reembolso_aprova_setor.';

-- 2) O setor de quem pede ------------------------------------------------
-- Esta é a que importa: alimenta a trigger que carimba o setor na
-- solicitação, e portanto decide para QUEM ela vai.
CREATE OR REPLACE FUNCTION public.cs_reembolso_meu_setor()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s text; n int;
BEGIN
  -- EMPREGADOS primeiro: é o cadastro oficial da Senior, o que Meu Perfil
  -- mostra. O vínculo é EMPREGADOS.auth_user_id — não existe profiles.empregado_id.
  SELECT e."Setor_ERP" INTO s
    FROM public."EMPREGADOS" e
   WHERE e.auth_user_id = auth.uid()
   LIMIT 1;
  IF public.cs_reembolso_norm_setor(s) IS NOT NULL THEN RETURN s; END IF;

  -- Reserva: o setor do perfil, para quem usa o ERP sem cadastro na Senior.
  -- Com mais de um setor marcado não há como escolher sem chutar — devolve
  -- NULL e a tela pede que a pessoa acerte o cadastro, em vez de mandar a
  -- solicitação para o aprovador errado.
  SELECT count(*) INTO n FROM public.user_setor WHERE user_id = auth.uid();
  IF n = 1 THEN
    SELECT setor INTO s FROM public.user_setor WHERE user_id = auth.uid();
    RETURN s;
  END IF;

  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cs_reembolso_meu_setor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_meu_setor() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Não há para onde voltar: a versão anterior das duas funções referencia
--   uma coluna que não existe. Reverter é recriar o bug.
-- =====================================================================
