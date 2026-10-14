-- Malote: o reforço do GERENTE FINANCEIRO nas despesas de Exceção (aprovar/reprovar/ajustar do Nível 2
-- em diante — SIS-2026-0250) vira uma chave liga/desliga em Configurações, DESLIGADA por padrão.
--
-- A função malote_gerente_financeiro(uuid) é a única porta desse poder: as 3 RPCs de aprovação, o
-- carve-out de SELECT das exceções pendentes e a tela (useSouGerenteFinanceiroMalote) passam por ela.
-- Basta ela devolver false com a chave desligada para o recurso inteiro ficar inativo, sem apagar
-- nada: para voltar, é só marcar a opção em Malote → Configurações → Inclusões de exceções.
-- (O cargo continua sendo o critério de QUEM é o gerente financeiro quando a chave está ligada.)
--
-- Migrations não se auto-aplicam: rodar no SQL Editor (cada comando é leve; pode rodar de uma vez).

ALTER TABLE public.malote_config
  ADD COLUMN IF NOT EXISTS excecao_gerente_financeiro_ativo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.malote_config.excecao_gerente_financeiro_ativo IS
  'Liga o reforço do cargo GERENTE FINANCEIRO nas despesas de exceção (Nível 2 em diante). Padrão: desligado.';

CREATE OR REPLACE FUNCTION public.malote_gerente_financeiro(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT c.excecao_gerente_financeiro_ativo FROM public.malote_config c WHERE c.id), false)
     AND EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = _user_id AND p.cargo ILIKE '%GERENTE FINANCEIRO%'
     );
$$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (volta ao comportamento anterior, sempre ligado pelo cargo):
--   CREATE OR REPLACE FUNCTION public.malote_gerente_financeiro(_user_id uuid) RETURNS boolean
--     LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
--     SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.cargo ILIKE '%GERENTE FINANCEIRO%');
--   $f$;
--   ALTER TABLE public.malote_config DROP COLUMN IF EXISTS excecao_gerente_financeiro_ativo;
--   NOTIFY pgrst, 'reload schema';
