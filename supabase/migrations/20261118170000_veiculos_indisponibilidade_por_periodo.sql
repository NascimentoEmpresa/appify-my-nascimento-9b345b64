-- =====================================================================
-- SIS-2026-0930 — AGENDAMENTO DE VEÍCULOS: INDISPONIBILIDADE É UM PERÍODO
--
-- O pedido: "coloquei os carros em indisponível com data agendada para levar
-- para lavar (...) mas o pessoal não consegue agendar outros dias, fica 100%
-- indisponível. (...) se eu colocar indisponível no dia 13 até o 17, eles têm
-- que ficar indisponíveis somente na data selecionada."
--
-- O DEFEITO
-- O Patrimônio grava a indisponibilidade em três colunas de sup_patrimonio:
-- `em_manutencao` (a chave), `data_inicio_manutencao` e `data_previsao_fim`.
-- Desde a 20260828000001, tanto cs_veiculo_motivo_indisponivel() quanto o
-- trigger cs_veic_checar_agendamento() liam só a chave e o FIM:
--
--     em_manutencao AND (fim IS NULL OR data_pedida <= fim)  → recusa
--
-- A data de início nunca entrou na conta. "Indisponível de 13 a 17" travava
-- o carro em QUALQUER dia até o 17 — inclusive hoje, amanhã e o dia 12 — e
-- a tela (useAgendamentoVeiculos.disponibilidadeDoVeiculo) copiava a mesma
-- leitura, deixando o card cinza e impossível de escolher.
--
-- A REGRA NOVA (a mesma de src/lib/veiculos/indisponibilidade.ts)
--   * o período vai de data_inicio_manutencao a data_previsao_fim, pontas
--     incluídas; ponta vazia é ponta aberta (sem início = desde sempre, sem
--     fim = tempo indeterminado — o comportamento antigo de "sem previsão"
--     continua igual);
--   * um agendamento só é recusado se [data_inicio, data_fim] DELE cruzar
--     esse período. Fora dele, agenda normal;
--   * "indisponível hoje" = hoje dentro do período.
--
-- POR QUE NÃO HÁ UPDATE DE DADOS
-- Os veículos "presos" não têm dado errado: o período que o gestor digitou
-- (13 a 17) está certo e fica exatamente como está. O que estava errado era a
-- LEITURA. Trocada a leitura, os mesmos registros passam a bloquear só os
-- dias do período, sem tocar numa linha de sup_patrimonio — e o histórico
-- (sup_patrimonio_log) e o painel de manutenções continuam vendo o mesmo
-- registro. A conferência no fim lista quem foi liberado.
--
-- O QUE NÃO MUDA
--   * Nada é escrito em sup_patrimonio (decisão 1 da 20260828000001).
--   * Encerrar antes = voltar para "disponível" no Patrimônio (limpa a chave
--     e as datas); estender = mudar a previsão de fim. As duas já funcionavam
--     e agora refletem dia a dia no Agendamento.
--   * Reservas JÁ confirmadas dentro de um período registrado depois NÃO são
--     canceladas por aqui: o modal de manutenção passa a listá-las para o
--     gestor avisar quem reservou. O atalho do trigger para UPDATE que não
--     mexe em veículo/período/turno/status (20261105009200) continua — senão
--     finalizar uma viagem dessas viraria erro.
--   * KM, viagens, checklist e o Dashboard (SIS-2026-0826) não leem estas
--     funções.
--
-- Idempotente.
--
-- ROLLBACK:
--   reaplicar cs_veiculo_motivo_indisponivel() da 20260906000007 e
--   cs_veic_checar_agendamento() da 20261105009200, depois
--   DROP FUNCTION IF EXISTS public.cs_veiculo_texto_indisponibilidade(uuid, date, date);
--   DROP FUNCTION IF EXISTS public.cs_veiculo_periodo_cruza(date, date, date, date);
-- =====================================================================

-- ── 1. Dois períodos se cruzam? ──────────────────────────────────────
-- Pontas incluídas; NULL é ponta aberta. Cada um começa antes de o outro
-- terminar. IMMUTABLE: só depende dos argumentos.
CREATE OR REPLACE FUNCTION public.cs_veiculo_periodo_cruza(
  p_inicio date, p_fim date, q_inicio date, q_fim date
)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(p_inicio, '-infinity'::date) <= coalesce(q_fim,   'infinity'::date)
     AND coalesce(q_inicio, '-infinity'::date) <= coalesce(p_fim,   'infinity'::date);
$$;
REVOKE ALL ON FUNCTION public.cs_veiculo_periodo_cruza(date, date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_periodo_cruza(date, date, date, date) TO authenticated;

-- ── 2. O Patrimônio impede este período? ─────────────────────────────
-- Só a parte do Patrimônio (cadastro, ativo, período de indisponibilidade).
-- O choque com outra reserva fica fora porque o trigger e a tela tratam o
-- turno de jeitos diferentes. Uma função para o texto, usada pelos dois
-- lados: a frase que a tela mostra é a mesma com que o banco recusa.
CREATE OR REPLACE FUNCTION public.cs_veiculo_texto_indisponibilidade(
  p_patrimonio_id uuid,
  p_data_inicio   date,
  p_data_fim      date
)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v        record;
  v_porque text;
  v_quando text;
BEGIN
  SELECT ativo, em_manutencao, data_inicio_manutencao, data_previsao_fim,
         motivo_indisponivel, motivo_detalhe
    INTO v
    FROM public.sup_patrimonio
   WHERE id = p_patrimonio_id AND categoria = 'veiculo';

  IF NOT FOUND THEN
    RETURN 'Veículo não encontrado no cadastro de Patrimônio.';
  END IF;
  IF NOT v.ativo THEN
    RETURN 'Veículo inativo no cadastro de Patrimônio.';
  END IF;

  IF NOT v.em_manutencao
     OR NOT public.cs_veiculo_periodo_cruza(v.data_inicio_manutencao, v.data_previsao_fim,
                                            p_data_inicio, coalesce(p_data_fim, p_data_inicio)) THEN
    RETURN NULL;
  END IF;

  -- Registro antigo pode estar indisponível sem motivo gravado: era
  -- manutenção, o único que existia antes de 17/08/2026.
  v_porque := CASE coalesce(v.motivo_indisponivel, 'manutencao')
                WHEN 'contrato' THEN 'Veículo alocado a um contrato'
                WHEN 'outro'    THEN 'Veículo indisponível (' || coalesce(nullif(btrim(v.motivo_detalhe), ''), 'outro motivo') || ')'
                ELSE 'Veículo em manutenção'
              END;

  v_quando := CASE
    WHEN v.data_inicio_manutencao IS NOT NULL AND v.data_previsao_fim IS NOT NULL THEN
      CASE WHEN v.data_inicio_manutencao = v.data_previsao_fim
           THEN 'em ' || to_char(v.data_inicio_manutencao, 'DD/MM/YYYY')
           ELSE 'de ' || to_char(v.data_inicio_manutencao, 'DD/MM/YYYY')
                || ' a ' || to_char(v.data_previsao_fim, 'DD/MM/YYYY') END
    WHEN v.data_previsao_fim IS NOT NULL THEN 'até ' || to_char(v.data_previsao_fim, 'DD/MM/YYYY')
    WHEN v.data_inicio_manutencao IS NOT NULL THEN
      'a partir de ' || to_char(v.data_inicio_manutencao, 'DD/MM/YYYY') || ', sem previsão de fim'
    ELSE 'por tempo indeterminado'
  END;

  RETURN v_porque || ' ' || v_quando || '.'
         || CASE WHEN v.data_previsao_fim IS NOT NULL
                 THEN ' Escolha uma data fora desse período (livre a partir de '
                      || to_char(v.data_previsao_fim + 1, 'DD/MM/YYYY') || ').'
                 ELSE ' Escolha uma data fora desse período.' END;
END $$;
REVOKE ALL ON FUNCTION public.cs_veiculo_texto_indisponibilidade(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_texto_indisponibilidade(uuid, date, date) TO authenticated;

-- ── 3. A recusa que a tela consulta ──────────────────────────────────
-- Mesma assinatura e mesmo contrato da 20260906000007 (texto do "não", ou
-- NULL quando livre). Só a leitura do Patrimônio mudou.
CREATE OR REPLACE FUNCTION public.cs_veiculo_motivo_indisponivel(
  p_patrimonio_id uuid,
  p_data_inicio   date,
  p_data_fim      date
)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_motivo text;
  vc       record;
BEGIN
  v_motivo := public.cs_veiculo_texto_indisponibilidade(p_patrimonio_id, p_data_inicio, p_data_fim);
  IF v_motivo IS NOT NULL THEN
    RETURN v_motivo;
  END IF;

  SELECT a.numero, a.solicitante_nome, a.data_inicio, a.data_fim, a.turno
    INTO vc
    FROM public.cs_veiculo_agendamento a
   WHERE a.patrimonio_id = p_patrimonio_id
     AND a.status = 'confirmado'
     AND a.data_inicio <= p_data_fim
     AND a.data_fim    >= p_data_inicio
   ORDER BY a.data_inicio
   LIMIT 1;

  IF FOUND THEN
    RETURN 'Já existe a reserva nº ' || vc.numero || ' de '
           || coalesce(vc.solicitante_nome, 'outro colaborador') || ' para '
           || to_char(vc.data_inicio, 'DD/MM/YYYY')
           || CASE WHEN vc.data_fim <> vc.data_inicio
                   THEN ' a ' || to_char(vc.data_fim, 'DD/MM/YYYY') ELSE '' END || '.';
  END IF;

  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cs_veiculo_motivo_indisponivel(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_motivo_indisponivel(uuid, date, date) TO authenticated;

-- ── 4. O trigger que de fato recusa ──────────────────────────────────
-- Cópia da 20261105009200; só o bloco do Patrimônio mudou. A validação no
-- banco é o que segura quem grava direto pelo PostgREST, sem passar pela tela.
CREATE OR REPLACE FUNCTION public.cs_veic_checar_agendamento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_motivo text;
  v_conf   record;
BEGIN
  IF NEW.status <> 'confirmado' THEN
    RETURN NEW;  -- cancelado/concluído não disputa o carro com ninguém
  END IF;

  -- UPDATE que não mexe em veículo, período, turno nem status (finalizar,
  -- KM, "não usei", destino...) não tem o que revalidar (05/11/2026).
  IF TG_OP = 'UPDATE'
     AND NEW.patrimonio_id IS NOT DISTINCT FROM OLD.patrimonio_id
     AND NEW.data_inicio   IS NOT DISTINCT FROM OLD.data_inicio
     AND NEW.data_fim      IS NOT DISTINCT FROM OLD.data_fim
     AND NEW.turno         IS NOT DISTINCT FROM OLD.turno
     AND NEW.status        IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Só na criação (ou quando a data muda): senão o gestor não conseguiria
  -- corrigir o destino de uma viagem que já começou.
  IF (TG_OP = 'INSERT' OR NEW.data_inicio IS DISTINCT FROM OLD.data_inicio)
     AND NEW.data_inicio < CURRENT_DATE THEN
    RAISE EXCEPTION 'Não dá para agendar um veículo para uma data que já passou.';
  END IF;

  -- SIS-2026-0930: só recusa se o período DESTA reserva cruzar o período de
  -- indisponibilidade do Patrimônio (antes: qualquer data até o fim).
  v_motivo := public.cs_veiculo_texto_indisponibilidade(NEW.patrimonio_id, NEW.data_inicio, NEW.data_fim);
  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION '%', v_motivo;
  END IF;

  SELECT a.numero, a.data_inicio, a.data_fim INTO v_conf
    FROM public.cs_veiculo_agendamento a
   WHERE a.patrimonio_id = NEW.patrimonio_id
     AND a.id <> NEW.id
     AND a.status = 'confirmado'
     AND a.data_inicio <= NEW.data_fim
     AND a.data_fim    >= NEW.data_inicio
     AND (a.turno = 'dia_todo' OR NEW.turno = 'dia_todo' OR a.turno = NEW.turno)
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Veículo já reservado nesse período (reserva nº %, de % a %).',
      v_conf.numero, to_char(v_conf.data_inicio, 'DD/MM/YYYY'), to_char(v_conf.data_fim, 'DD/MM/YYYY');
  END IF;

  RETURN NEW;
END $$;

-- O trigger em si (trg_cs_veic_checar) já aponta para esta função desde a
-- 20260828000001; recriá-lo não muda nada, então fica como está.

-- ── 5. Conferência ───────────────────────────────────────────────────
-- Veículos com indisponibilidade registrada e o que muda para cada um hoje.
-- "liberado_hoje" = estava travado pela leitura antiga e agora agenda hoje.
SELECT p.nome,
       p.identificador,
       coalesce(p.motivo_indisponivel, 'manutencao')                    AS motivo,
       p.data_inicio_manutencao                                         AS inicio,
       p.data_previsao_fim                                              AS fim,
       public.cs_veiculo_periodo_cruza(p.data_inicio_manutencao, p.data_previsao_fim,
                                       CURRENT_DATE, CURRENT_DATE)      AS indisponivel_hoje,
       ((p.data_previsao_fim IS NULL OR CURRENT_DATE <= p.data_previsao_fim)
        AND NOT public.cs_veiculo_periodo_cruza(p.data_inicio_manutencao, p.data_previsao_fim,
                                                CURRENT_DATE, CURRENT_DATE)) AS liberado_hoje
  FROM public.sup_patrimonio p
 WHERE p.categoria = 'veiculo' AND p.ativo AND p.em_manutencao
 ORDER BY p.data_inicio_manutencao NULLS FIRST, p.nome;

NOTIFY pgrst, 'reload schema';
