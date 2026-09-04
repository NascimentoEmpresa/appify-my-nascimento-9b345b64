-- =====================================================================
-- ESPAÇO DO COLABORADOR — 435 pessoas sumiam da árvore
--
-- O SINTOMA
--
--   /app/rh/colaboradores mostrava 2.501 ativos; somando os contratos do
--   Espaço do Colaborador dava 2.066. As duas telas leem a MESMA EMPREGADOS,
--   então a diferença não era de fonte — era de contagem, e o erro era meu.
--
-- AS TRÊS CAUSAS, e as duas primeiras somam na mesma direção
--
--   1. PESSOA SEM CONTRATO RESOLVIDO NÃO APARECIA EM LUGAR NENHUM.
--      A contagem agrupava por `esp_col_contrato_id(...)`, que devolve NULL
--      quando nem "Descrição do Local", nem o de-para, nem "Nome Filial"
--      casam com `contratos.nome`. O grupo NULL existia no CTE e morria no
--      `LEFT JOIN contratos` seguinte: nenhum contrato tem id NULL, então
--      aquelas linhas não entravam em nó nenhum.
--
--      Não é caso raro nem sujeira: a própria 20260830000001 mediu que o
--      casamento por filial fecha 94%, e os 6% restantes são grafia
--      divergente entre a folha e o cadastro de contratos. Numa árvore que
--      existe para CHEGAR em qualquer colaborador, sumir com quem não casa é
--      o pior desfecho possível — a pessoa não está errada, ela está
--      invisível, e ninguém descobre isso olhando a tela.
--
--   2. CONTRATO ENCERRADO LEVAVA JUNTO QUEM AINDA ESTÁ NELE.
--      O filtro `status <> 'encerrado'` derrubava o nó inteiro. Quem
--      continua ativo na folha alocado num contrato encerrado sumia com ele.
--      Contrato encerrado sem ninguém é ruído e continua fora; com gente
--      dentro é justamente o que alguém precisa ver — são as pessoas que
--      ainda vão ser realocadas.
--
--   3. A RÉGUA DE "ATIVO" ERA MAIS FROUXA QUE A DO RH (e puxava para cima,
--      escondendo parte do buraco). Aqui era `"Situação" <> 'Demitido'`:
--      igualdade exata, que deixa passar 'Desligado', 'Rescisão',
--      'Aposentadoria' e qualquer variação de caixa. O RH usa
--      /DEMIT|DESLIG|RESCIS|APOSENT/i (ehSaidaDe, em Colaboradores.tsx).
--      Passa a valer a mesma régua, agora escrita UMA vez.
--
-- O QUE AINDA NÃO VAI BATER COM O CARD DO RH, E POR QUÊ
--
--   O card "Ativos no mês" do RH não é quadro atual: é PRESENÇA NO MÊS,
--   calculada por DATA (admitido até o fim do mês; para quem tem situação de
--   saída, afastamento a partir do início do mês). Quem foi desligado no meio
--   do mês conta lá e não conta aqui — de propósito, nas duas telas.
--
--   Por isso a árvore passa a devolver `total_ativos` e `sem_contrato`
--   explícitos: a tela mostra a conta fechando na cara do usuário, em vez de
--   deixar cada um somar os nós à mão e desconfiar do resultado.
-- =====================================================================


-- ── 1. Uma régua só para "está ativo" ────────────────────────────────
--
-- Mesma expressão do `ehSaidaDe` do RH. Vira função para as contagens, a
-- lista e a árvore não poderem divergir: com a condição repetida em três
-- lugares, basta alguém ajustar uma para a soma dos nós parar de bater com
-- o total de novo — que é exatamente o bug que esta migration conserta.
-- Sem `SET search_path` de propósito: a função não toca em tabela nenhuma
-- (só um regex sobre o texto recebido), e uma função com SET não pode ser
-- INLINED pelo planejador — o que a impediria de usar índice quando aparece
-- num WHERE sobre 2.5 mil linhas.
CREATE OR REPLACE FUNCTION public.esp_col_esta_ativo(p_situacao text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT COALESCE(p_situacao, '') !~* '(DEMIT|DESLIG|RESCIS|APOSENT)';
$fn$;

REVOKE ALL ON FUNCTION public.esp_col_esta_ativo(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_esta_ativo(text) TO authenticated;


-- ── 2. A árvore devolve a CONTA, não só os nós ───────────────────────
--
-- Muda a forma do retorno: era um array de contratos, agora é um objeto
--   { contratos: [...], sem_contrato: n, total_ativos: n, encerrados_com_gente: n }
-- para a tela poder mostrar "2.501 ativos · 2.066 em contrato · 435 sem
-- contrato identificado" e o usuário conferir a soma sem calculadora.
--
-- `pessoas AS MATERIALIZED` não é enfeite: `esp_col_contrato_id()` faz até
-- três subconsultas por linha, e sem forçar a materialização o planejador
-- inlinearia o CTE e reexecutaria essa função em cada agregação que o usa.
-- (Materializar com TEMP TABLE seria o reflexo natural e está ERRADO aqui:
-- o PostgREST executa função STABLE em transação READ ONLY, e o CREATE
-- falharia em runtime — não na criação da função, o que é pior.)
CREATE OR REPLACE FUNCTION public.esp_col_arvore()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.esp_col_exige_acesso();

  WITH pessoas AS MATERIALIZED (
    SELECT public.esp_col_contrato_id(e."Descrição do Local", e."Nome Filial") AS contrato_id
      FROM public."EMPREGADOS" e
     WHERE public.esp_col_esta_ativo(e."Situação")
       AND COALESCE(btrim(e."Nome"), '') <> ''
  ),
  totais AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE p.contrato_id IS NULL)::int AS sem
      FROM pessoas p
  ),
  cont_qtd AS (
    SELECT p.contrato_id, count(*)::int AS qtd
      FROM pessoas p
     WHERE p.contrato_id IS NOT NULL
     GROUP BY p.contrato_id
  ),
  posto_vivo AS (
    SELECT DISTINCT ON (pc.contrato_id, public.sup_norm_nome(pc.posto))
           pc.id, pc.contrato_id, btrim(pc.posto) AS posto, pc.servico,
           pc.qt_postos, pc.data_vigencia
      FROM public.planilha_custo pc
     WHERE pc.contrato_id IS NOT NULL
       AND pc.orexec = 'EXECUTADO'
       AND NOT COALESCE(pc.encerrado, false)
       AND pc.data_vigencia IS NOT NULL
       AND COALESCE(btrim(pc.posto), '') <> ''
     ORDER BY pc.contrato_id, public.sup_norm_nome(pc.posto), pc.data_vigencia DESC
  ),
  posto_local AS (
    SELECT l.planilha_custo_id,
           jsonb_agg(jsonb_build_object(
             'id', l.id, 'nome', l.nome, 'municipio', l.municipio, 'uf', l.uf,
             'orcadas', l.qt_pessoas_orcadas, 'executadas', l.qt_pessoas_executadas)
             ORDER BY l.nome) AS itens
      FROM public.planilha_posto_localizacao l
     GROUP BY l.planilha_custo_id
  ),
  postos AS (
    SELECT pv.contrato_id,
           jsonb_agg(jsonb_build_object(
             'id', pv.id, 'nome', pv.posto, 'servico', pv.servico,
             'vagas', pv.qt_postos, 'vigencia', pv.data_vigencia,
             'locais', COALESCE(pl.itens, '[]'::jsonb))
             ORDER BY pv.posto) AS itens,
           count(*)::int                           AS qtd_postos,
           sum(COALESCE(pv.qt_postos, 0))::numeric AS vagas
      FROM posto_vivo pv
      LEFT JOIN posto_local pl ON pl.planilha_custo_id = pv.id
     GROUP BY pv.contrato_id
  ),
  nos AS (
    SELECT c.nome AS ordem,
           COALESCE(cq.qtd, 0) AS qtd,
           COALESCE(c.status, 'ativo') = 'encerrado' AS encerrado,
           jsonb_build_object(
             'id', c.id, 'nome', c.nome, 'cliente', c.cliente, 'status', c.status,
             'encerrado',     COALESCE(c.status, 'ativo') = 'encerrado',
             'colaboradores', COALESCE(cq.qtd, 0),
             'qtd_postos',    COALESCE(pt.qtd_postos, 0),
             'vagas',         COALESCE(pt.vagas, 0),
             'encarregado_designado', (
               SELECT jsonb_build_object('id', r.encarregado_id, 'nome', r.encarregado_nome)
                 FROM public."RH_CONTRATO_ENCARREGADO" r
                WHERE public.sup_norm_nome(r.contrato) = public.sup_norm_nome(c.nome)
                LIMIT 1),
             'postos', COALESCE(pt.itens, '[]'::jsonb)) AS no
      FROM public.contratos c
      LEFT JOIN postos   pt ON pt.contrato_id = c.id
      LEFT JOIN cont_qtd cq ON cq.contrato_id = c.id
     -- Encerrado só some quando não tem NINGUÉM dentro. Com gente, o nó fica
     -- e a tela marca — são pessoas a realocar, não pessoas a esconder.
     WHERE COALESCE(c.status, 'ativo') <> 'encerrado'
        OR COALESCE(cq.qtd, 0) > 0
  ),
  agg AS (
    SELECT COALESCE(jsonb_agg(n.no ORDER BY n.ordem), '[]'::jsonb) AS contratos,
           COALESCE(count(*) FILTER (WHERE n.encerrado AND n.qtd > 0), 0)::int AS encerrados
      FROM nos n
  )
  SELECT jsonb_build_object(
           'contratos',            a.contratos,
           'sem_contrato',         t.sem,
           'total_ativos',         t.total,
           'encerrados_com_gente', a.encerrados)
    INTO v_out
    FROM agg a CROSS JOIN totais t;

  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_arvore() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_arvore() TO authenticated;


-- ── 3. A lista sabe devolver os órfãos ───────────────────────────────
--
-- `p_sem_contrato = true` traz exatamente quem a árvore não conseguiu
-- pendurar em contrato nenhum. Sem isso, o nó "Sem contrato identificado"
-- saberia dizer QUANTOS são e não saberia dizer QUEM são — que é a metade
-- que resolve o problema, porque é ela que deixa o RH corrigir a grafia.
DROP FUNCTION IF EXISTS public.esp_col_colaboradores(uuid, text, int);
CREATE FUNCTION public.esp_col_colaboradores(
  p_contrato_id  uuid    DEFAULT NULL,
  p_busca        text    DEFAULT NULL,
  p_limite       int     DEFAULT 500,
  p_sem_contrato boolean DEFAULT false)
RETURNS TABLE (
  empregado_id bigint,
  matricula    text,
  nome         text,
  cargo        text,
  posto        text,
  local        text,
  filial       text,
  situacao     text,
  admissao     date,
  nivel        text,
  contrato_id  uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_lim    int := least(greatest(COALESCE(p_limite, 500), 1), 3000);
  v_termos text[];
BEGIN
  PERFORM public.esp_col_exige_acesso();

  v_termos := array_remove(string_to_array(public.sup_norm_busca(COALESCE(p_busca, '')), ' '), '');

  RETURN QUERY
  WITH base AS (
    SELECT e."ID"::bigint AS empregado_id,
           nullif(btrim(e."Cadastro"::text), '')  AS matricula,
           e."Nome"                               AS nome,
           e."Título do Cargo"                    AS cargo,
           e."Nome do Posto"                      AS posto,
           e."Descrição do Local"                 AS local,
           e."Nome Filial"                        AS filial,
           e."Situação"                           AS situacao,
           public.rh_data(e."Admissão"::text)     AS admissao,
           btrim(COALESCE(e."LIDER", ''))         AS nivel,
           public.esp_col_contrato_id(e."Descrição do Local", e."Nome Filial") AS contrato_id
      FROM public."EMPREGADOS" e
     WHERE public.esp_col_esta_ativo(e."Situação")
       AND COALESCE(btrim(e."Nome"), '') <> ''
       AND (cardinality(v_termos) = 0 OR NOT EXISTS (
              SELECT 1 FROM unnest(v_termos) t
               WHERE public.sup_norm_busca(e."Nome") NOT LIKE '%' || t || '%'))
  )
  SELECT b.empregado_id, b.matricula, b.nome, b.cargo, b.posto, b.local,
         b.filial, b.situacao, b.admissao, b.nivel, b.contrato_id
    FROM base b
   WHERE CASE
           WHEN p_sem_contrato        THEN b.contrato_id IS NULL
           WHEN p_contrato_id IS NULL THEN true
           ELSE b.contrato_id = p_contrato_id
         END
   ORDER BY b.nome
   LIMIT v_lim;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_colaboradores(uuid, text, int, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_colaboradores(uuid, text, int, boolean) TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ── Conferência: a decomposição exata da diferença ───────────────────
--
-- Rode isto no SQL Editor para ver, com dado real, de onde vinham os 435.
-- `total_ativos` tem que ser igual a em_contrato + sem_contrato.
SELECT count(*)                                                            AS total_ativos,
       count(*) FILTER (WHERE ct IS NOT NULL)                              AS em_contrato,
       count(*) FILTER (WHERE ct IS NULL)                                  AS sem_contrato,
       count(*) FILTER (WHERE ct IS NULL AND COALESCE(btrim(local),'') = '') AS sem_contrato_e_sem_local
  FROM (
    SELECT public.esp_col_contrato_id(e."Descrição do Local", e."Nome Filial") AS ct,
           e."Descrição do Local" AS local
      FROM public."EMPREGADOS" e
     WHERE public.esp_col_esta_ativo(e."Situação")
       AND COALESCE(btrim(e."Nome"), '') <> ''
  ) s;

-- Quais grafias de local/filial não casam com nenhum contrato — é esta lista
-- que o RH usa para corrigir o cadastro (ou que vira linha no de-para).
SELECT COALESCE(nullif(btrim(e."Descrição do Local"), ''), '(sem local)') AS local_no_cadastro,
       COALESCE(nullif(btrim(e."Nome Filial"), ''), '(sem filial)')       AS filial_no_cadastro,
       count(*) AS pessoas
  FROM public."EMPREGADOS" e
 WHERE public.esp_col_esta_ativo(e."Situação")
   AND COALESCE(btrim(e."Nome"), '') <> ''
   AND public.esp_col_contrato_id(e."Descrição do Local", e."Nome Filial") IS NULL
 GROUP BY 1, 2
 ORDER BY pessoas DESC;

-- O quanto a régua de situação sozinha muda a conta (causa 3).
SELECT count(*) FILTER (WHERE COALESCE(e."Situação",'') <> 'Demitido')  AS regua_antiga,
       count(*) FILTER (WHERE public.esp_col_esta_ativo(e."Situação"))  AS regua_nova,
       count(*)                                                         AS todos
  FROM public."EMPREGADOS" e
 WHERE COALESCE(btrim(e."Nome"), '') <> '';


-- =====================================================================
-- ROLLBACK
--   Reexecutar 20260930000052 recria esp_col_arvore e esp_col_colaboradores
--   nas versões anteriores (a assinatura de colaboradores volta a 3 args —
--   derrube a de 4 antes):
--   DROP FUNCTION IF EXISTS public.esp_col_colaboradores(uuid, text, int, boolean);
--   DROP FUNCTION IF EXISTS public.esp_col_esta_ativo(text);
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
