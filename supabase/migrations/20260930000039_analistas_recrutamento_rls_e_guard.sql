-- =====================================================================
-- ANALISTAS VALIDAÇÕES — o banco precisa reconhecer o menu novo.
--
-- A 20260930000034 criou `licitacoes_analistas_recrutamento` e moveu a
-- etapa 1 do recrutamento para o analista. Só que no banco quem decide
-- sobre a vaga continuava sendo uma lista de DOIS menus, em dois lugares:
--
--   • a policy `sistema_recrutamento_operacional` (RLS), e
--   • a função `sistema_recrutamento_guard` (trigger de UPDATE).
--
-- Sem esta migration o analista abre a tela, enxerga a fila e o botão
-- Aprovar devolve erro — o pior dos dois mundos, porque a tela promete uma
-- ação que o banco recusa.
--
-- As DUAS listas mudam juntas, de propósito. O comentário dentro do guard
-- já registra por quê: "manter as duas listas iguais é o que impede a RLS
-- liberar e o gatilho recusar, que foi exatamente o defeito corrigido
-- aqui". Mexer em uma só reabriria aquele defeito.
--
-- O menu do Operacional CONTINUA na policy de leitura e sai da de escrita:
-- ele acompanha (a tela dele é somente-leitura desde 02/09/2026), então
-- precisa enxergar, não precisa gravar.
-- =====================================================================

-- 1) RLS: o analista decide, o Operacional só lê ------------------------
DROP POLICY IF EXISTS sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO"
  FOR ALL TO authenticated
  USING (
    (has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar')
     OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'))
    AND ((NOT administrativa)
         OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'))
  )
  WITH CHECK (
    -- Só o analista grava. O Operacional perdeu o botão na tela; aqui ele
    -- perde a permissão de verdade, que é o que vale.
    (has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar')
     OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar'))
    AND ((NOT administrativa)
         OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'))
  );

-- 2) O guard reconhece o analista ---------------------------------------
-- Mesma função da migration que a criou, com a lista `v_gestor` atualizada.
-- Só esse bloco muda; o resto é cópia literal, porque substituir a função
-- inteira é a única forma de alterar um pedaço dela.
CREATE OR REPLACE FUNCTION public.sistema_recrutamento_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gestor  boolean;
  v_dias    integer;
  v_livre   jsonb;
  v_ult     jsonb;
  v_msg     text := 'A vaga precisa de no mínimo 7 dias úteis entre hoje e a data de início prevista.';
BEGIN
  IF btrim(coalesce(NEW.motivo_vaga, '')) = 'Expansão' THEN
    NEW.motivo_vaga := 'Expansão (Aumento de Quadro)';
  END IF;

  IF public.rec_cargo_exige_cnh(NEW.cargo) THEN
    NEW.cnh_obrigatoria := true;
    IF upper(translate(coalesce(NEW.req_obrigatorios, ''),
         'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
         'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
       !~ '(CNH|CARTEIRA DE (MOTORISTA|HABILITA))' THEN
      NEW.req_obrigatorios := btrim(concat(
        'CNH obrigatória (categoria compatível com a função).',
        CASE WHEN btrim(coalesce(NEW.req_obrigatorios, '')) = '' THEN '' ELSE E'\n' || NEW.req_obrigatorios END));
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.cnh_obrigatoria := COALESCE(NEW.cnh_obrigatoria, false);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF public.rec_data_prevista(NEW.data_inicio_prevista) IS NOT NULL THEN
      v_dias := public.dias_uteis_entre(current_date, public.rec_data_prevista(NEW.data_inicio_prevista));
      IF v_dias < 7 THEN
        RAISE EXCEPTION '% A data escolhida tem % dia(s) útil(eis).', v_msg, v_dias;
      END IF;
      NEW.grau_urgencia := public.rec_grau_por_data(NEW.data_inicio_prevista);
    END IF;
    NEW.data_inicio_alteracoes := COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb);
    RETURN NEW;
  END IF;

  -- Quem decide sobre a vaga. São as MESMAS portas que a RLS reconhece
  -- (sistema_recrutamento_gate e sistema_recrutamento_operacional) — manter
  -- as duas listas iguais é o que impede a RLS liberar e o gatilho recusar,
  -- que foi exatamente o defeito corrigido quando esta função nasceu.
  --
  -- 02/09/2026: entrou `licitacoes_analistas_recrutamento` e SAIU
  -- `operacional_recrutamento`. A etapa 1 mudou de dono; o Operacional
  -- acompanha, e acompanhar não escreve.
  v_gestor := has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
           OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir')
           OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar')
           OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar');

  IF NOT v_gestor THEN
    v_livre := to_jsonb(OLD) - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes';
    IF v_livre IS DISTINCT FROM (to_jsonb(NEW) - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes') THEN
      RAISE EXCEPTION 'Depois de criada, você só pode alterar a Data de Início Prevista da vaga. Para mudar qualquer outra informação, fale com o Recrutamento.';
    END IF;
  END IF;

  IF NEW.data_inicio_prevista IS DISTINCT FROM OLD.data_inicio_prevista THEN
    IF public.rec_data_prevista(NEW.data_inicio_prevista) IS NULL THEN
      RAISE EXCEPTION 'Informe a nova data de início prevista.';
    END IF;
    v_dias := public.dias_uteis_entre(current_date, public.rec_data_prevista(NEW.data_inicio_prevista));
    IF v_dias < 7 THEN
      RAISE EXCEPTION '% A data escolhida tem % dia(s) útil(eis).', v_msg, v_dias;
    END IF;
    NEW.grau_urgencia := public.rec_grau_por_data(NEW.data_inicio_prevista);

    IF jsonb_array_length(COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb))
       <> jsonb_array_length(COALESCE(OLD.data_inicio_alteracoes, '[]'::jsonb)) + 1 THEN
      RAISE EXCEPTION 'Toda troca de data precisa de uma justificativa.';
    END IF;
    v_ult := NEW.data_inicio_alteracoes -> (jsonb_array_length(NEW.data_inicio_alteracoes) - 1);
    IF length(btrim(coalesce(v_ult->>'justificativa', ''))) < 10 THEN
      RAISE EXCEPTION 'Escreva a justificativa da troca de data (mínimo 10 caracteres).';
    END IF;
    IF btrim(coalesce(v_ult->>'para', '')) <> btrim(coalesce(NEW.data_inicio_prevista, '')) THEN
      RAISE EXCEPTION 'O histórico da troca de data não bate com a data enviada.';
    END IF;
    NEW.data_inicio_alteracoes := jsonb_set(
      NEW.data_inicio_alteracoes,
      ARRAY[(jsonb_array_length(NEW.data_inicio_alteracoes) - 1)::text],
      v_ult || jsonb_build_object('por', auth.uid(), 'em', now()));
  ELSIF NEW.data_inicio_alteracoes IS DISTINCT FROM OLD.data_inicio_alteracoes AND NOT v_gestor THEN
    RAISE EXCEPTION 'O histórico de datas não pode ser alterado.';
  END IF;

  RETURN NEW;
END $function$;

-- 3) NINGUÉM ganha o menu novo por migration ----------------------------
--
-- A tentação aqui era copiar as permissões de `operacional_recrutamento`
-- para `licitacoes_analistas_recrutamento`, "para a fila não parar". Seria
-- errado por dois motivos, e o registro fica para quem pensar nisso de novo:
--
--   • O pedido foi "são os analistas que aprovam". Copiar as permissões do
--     Operacional daria a decisão exatamente para quem se pediu para tirar
--     dela — a fila andaria, com as pessoas erradas.
--
--   • O README é explícito: acesso é 100% por usuário, concedido em
--     Administração › Acesso por Usuário. Migration que distribui permissão
--     passa por fora do único lugar onde alguém consegue auditar quem tem o
--     quê.
--
-- Então a fila FICA parada de propósito até alguém liberar os três menus
-- (`licitacoes_analistas_recrutamento`, `licitacoes_analistas_troca_funcao`,
-- `licitacoes_analistas_demissao`) para os analistas, com a ação `aprovar`.
-- Fila parada é visível; permissão errada, não.

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- -- Reaplique o bloco 2 da migration que criou sistema_recrutamento_guard,
-- -- trocando `licitacoes_analistas_recrutamento` por `operacional_recrutamento`.
-- DROP POLICY IF EXISTS sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO";
-- CREATE POLICY sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO"
--   FOR ALL TO authenticated
--   USING (has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar')
--          AND ((NOT administrativa) OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar')))
--   WITH CHECK ((has_screen_access(auth.uid(), 'operacional_recrutamento', 'alterar')
--                OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'aprovar'))
--               AND ((NOT administrativa) OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar')));
-- NOTIFY pgrst, 'reload schema';
