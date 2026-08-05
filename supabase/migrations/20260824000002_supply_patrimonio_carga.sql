-- =====================================================================
-- PATRIMÔNIO — carga inicial vinda do Painel de Manutenções do legado
--
-- GERADO por scripts/gerar-migration-patrimonio.mjs a partir de
-- painel-manutencoes-05-08-2026.xlsx. NÃO EDITE À MÃO.
--
--   26 itens · 26 equipamento
--   4 sem número de série (entram com identificador nulo)
--
-- ⚠️ ESTE EXPORT É UM RECORTE. Vem do Painel, então traz só o que está PARADO
-- agora. Não vêm os veículos, o maquinário em uso, nem valor e notas de
-- manutenção — o painel não exporta essas colunas.
--
-- IDEMPOTENTE: casa por (empresa, identificador) quando há identificador, e
-- por (empresa, categoria, nome, contrato, posto) quando não há. Rodar de novo
-- com uma planilha maior completa o cadastro em vez de duplicar.
--
-- DE-PARA DE POSTO (confirmado com o dono do produto): a Manutenção escrevia
-- o campus com o número do contrato colado.
--   UFRGS-LITORAL-062 → CAMPUS LITORAL
--   UFRGS-CENTRO-062 → CAMPUS CENTRO
--
-- ROLLBACK: DELETE FROM public.sup_patrimonio WHERE created_by IS NULL
--             AND observacoes = 'Importado do Painel de Manutenções do legado';
-- =====================================================================

DROP TABLE IF EXISTS public.sup_imp_patrimonio;
CREATE TABLE public.sup_imp_patrimonio (
  categoria      text,
  nome           text,
  identificador  text,
  contrato_nome  text,
  posto_nome     text,
  em_manutencao  boolean,
  data_inicio    date,
  data_fim       date
);

INSERT INTO public.sup_imp_patrimonio
  (categoria, nome, identificador, contrato_nome, posto_nome, em_manutencao, data_inicio, data_fim)
VALUES
  ('equipamento', 'BOBCAT S450', 'NUMERO DE SERIE-B1ED11826', 'FURG JARDINAGEM 049 2022', 'FURG RIO GRANDE', true, '2026-06-10'::date, '2026-06-12'::date),
  ('equipamento', 'CARRINHO DE MÃO', NULL, 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', true, '2026-07-14'::date, '2026-07-20'::date),
  ('equipamento', 'CEIFADEIRA', 'T3230425020131947', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', true, '2026-07-31'::date, '2026-08-05'::date),
  ('equipamento', 'CEIFADEIRA', 'T3230425020131735', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', true, '2026-07-31'::date, '2026-08-05'::date),
  ('equipamento', 'CEIFADEIRA STHIL RM 2 R', 'NSERIE - T323025020131723 PATRIMONIO 14507', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', true, '2026-07-31'::date, '2026-08-05'::date),
  ('equipamento', 'CORTADOR DE GRAMA TRACIONADO BUFFALO 6.5 BFGT53 SLR', 'BUFFALO12346', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', true, '2026-06-26'::date, '2026-07-15'::date),
  ('equipamento', 'CORTADOR DE GRAMA TRACIONADO TRAPP MC-600G', 'NUMERO DE SERIE-CG009602124', 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', true, '2026-06-15'::date, '2026-06-19'::date),
  ('equipamento', 'CORTADOR DE GRAMA TRACIONADO TRAPP MC-600G', NULL, 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', true, '2026-06-15'::date, '2026-06-19'::date),
  ('equipamento', 'LAVAJATO STHIL RE 100', 'NUMERO DE SERIE-374471629', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS CENTRO', true, '2026-07-02'::date, '2026-07-07'::date),
  ('equipamento', 'MAQUINA DE CORTAR GRAMA TRAPP', NULL, 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', true, '2026-07-29'::date, '2026-08-06'::date),
  ('equipamento', 'MAQUINA DE LAVAR CONSUL 12 KG', 'NUMERO DE SERIE - CG1176950', 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', true, '2026-06-19'::date, '2026-06-26'::date),
  ('equipamento', 'MAQUINA DE LAVAR CONSUL 12KG', 'NUMERO DE SERIE-CG1161196', 'UFFS - 041.2021', 'UFFS - CHAPECÓ 041 2021', true, '2026-06-22'::date, '2026-06-26'::date),
  ('equipamento', 'MAQUINA DE LAVAR CONSUL 12KG', 'NUMERO DE SERIE - CWH12BBBNACE3153897EQ', 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', true, '2026-06-19'::date, '2026-06-26'::date),
  ('equipamento', 'Maquina Trapp autotracionada', 'P707V-3B 22051067', 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', true, '2026-05-20'::date, '2026-05-27'::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NSERIE-374789796 PATRIMONIO 14519', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', true, '2026-07-31'::date, '2026-08-05'::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NSERIE-374789831 SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', true, '2026-07-31'::date, '2026-08-05'::date),
  ('equipamento', 'Roçadeira FS 220 Sthil', 'NUMERO DE SERIE-368541106', 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', true, '2026-06-18'::date, '2026-06-29'::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-370885275', 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', true, '2026-07-29'::date, '2026-08-05'::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-368541109', 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', true, '2026-07-29'::date, '2026-08-05'::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-367859054', 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', true, '2026-07-29'::date, '2026-08-05'::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NUMERO DE SERIE-41479674003A', 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', true, '2026-07-03'::date, '2026-07-14'::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NSERIE -374789803 PATRIMONIO 14517', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', true, '2026-07-31'::date, '2026-08-05'::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NSERIE-374789840 PATRIMONIO 14521', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', true, '2026-07-31'::date, '2026-08-05'::date),
  ('equipamento', 'SOPRADOR -número de serie 525864609 -', 'ALMOXARIFADO', 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', true, '2026-07-22'::date, '2026-07-30'::date),
  ('equipamento', 'TRATOR CORTADOR DE GRAMA VONDER TGM 175', 'VONDER12353', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', true, '2026-05-20'::date, '2026-06-05'::date),
  ('equipamento', 'TRATOR VONDER TGM 175', NULL, 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', true, '2026-07-29'::date, '2026-07-03'::date);

-- ── Carga ────────────────────────────────────────────────────────────
-- A empresa vem do contrato casado. Item cujo contrato não existir NÃO entra
-- e é apontado na conferência.
INSERT INTO public.sup_patrimonio
  (empresa_id, categoria, nome, identificador, contrato_id, posto_id,
   em_manutencao, data_inicio_manutencao, data_previsao_fim, observacoes)
SELECT c.empresa_id, i.categoria, i.nome, i.identificador, c.id, sp.id,
       i.em_manutencao, i.data_inicio, i.data_fim,
       'Importado do Painel de Manutenções do legado'
  FROM public.sup_imp_patrimonio i
  JOIN public.contratos c
    ON public.sup_norm_nome(c.nome) = public.sup_norm_nome(i.contrato_nome)
  LEFT JOIN public.sup_posto sp
    ON sp.contrato_id = c.id
   AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(i.posto_nome)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.sup_patrimonio p
    WHERE p.empresa_id = c.empresa_id
      AND (
        -- com identificador, ele é a chave
        (i.identificador IS NOT NULL
         AND upper(trim(p.identificador)) = upper(trim(i.identificador)))
        -- sem identificador, cai no conjunto que descreve o bem
        OR (i.identificador IS NULL AND p.identificador IS NULL
            AND p.categoria = i.categoria
            AND upper(trim(p.nome)) = upper(trim(i.nome))
            AND p.contrato_id = c.id
            AND p.posto_id IS NOT DISTINCT FROM sp.id)
      )
 );

-- ── Conferência ──────────────────────────────────────────────────────
-- 1) Itens que não entraram por falta de contrato correspondente.
SELECT DISTINCT i.contrato_nome AS contrato_sem_correspondente
  FROM public.sup_imp_patrimonio i
 WHERE NOT EXISTS (
   SELECT 1 FROM public.contratos c
    WHERE public.sup_norm_nome(c.nome) = public.sup_norm_nome(i.contrato_nome))
 ORDER BY 1;

-- 2) Itens que entraram sem posto (o nome não casou com o catálogo).
SELECT i.nome, i.posto_nome AS posto_do_export_sem_correspondente
  FROM public.sup_imp_patrimonio i
  JOIN public.contratos c ON public.sup_norm_nome(c.nome) = public.sup_norm_nome(i.contrato_nome)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.sup_posto sp
    WHERE sp.contrato_id = c.id
      AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(i.posto_nome))
 ORDER BY 1;

-- 3) O que existe agora.
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE em_manutencao)::int AS em_manutencao,
       count(*) FILTER (WHERE categoria = 'veiculo')::int AS veiculos,
       count(*) FILTER (WHERE categoria = 'equipamento')::int AS equipamentos,
       count(*) FILTER (WHERE posto_id IS NULL)::int AS sem_posto
  FROM public.sup_patrimonio;

DROP TABLE IF EXISTS public.sup_imp_patrimonio;

NOTIFY pgrst, 'reload schema';
