-- =========================================================================
-- PATRIMONIO — terceiro motivo de indisponibilidade: "outro", escrito a mao
--
-- Pedido do Eduardo (17/08/2026): "manutencao" e "em contrato" nao cobrem
-- tudo. Um carro pode estar parado por sinistro, documentacao vencida,
-- emprestimo a outra unidade — e hoje quem opera e obrigado a escolher um
-- motivo que nao e o verdadeiro so para conseguir bloquear o veiculo.
--
-- POR QUE O TEXTO LIVRE FICA NUMA COLUNA SEPARADA, E NAO EM `observacoes`
-- `observacoes` e campo de anotacao geral do bem e sobrevive a mudanca de
-- estado. O motivo da indisponibilidade morre junto com ela: quando o bem
-- volta a ficar disponivel, o texto tem que sumir tambem, senao o proximo
-- leitor ve "sinistro" num carro que ja voltou. Por isso coluna propria, com
-- constraint amarrando as duas pontas.
--
-- POR QUE ISSO JA BLOQUEIA O AGENDAMENTO SEM MEXER NO AGENDAMENTO
-- Mesmo motivo registrado na 20260906000006: quem bloqueia e `em_manutencao`,
-- e `motivo_indisponivel` so DIZ o porque. Um motivo novo entra bloqueando
-- por construcao — nao depende de alguem lembrar de somar a condicao em cada
-- tela. Aqui so se ajusta o TEXTO que o Agendamento mostra.
--
-- Idempotente.
-- ROLLBACK:
--   UPDATE public.sup_patrimonio
--      SET em_manutencao = false, motivo_indisponivel = NULL,
--          motivo_detalhe = NULL, data_inicio_manutencao = NULL,
--          data_previsao_fim = NULL
--    WHERE motivo_indisponivel = 'outro';
--   ALTER TABLE public.sup_patrimonio DROP CONSTRAINT IF EXISTS sup_patrimonio_motivo_coerente;
--   ALTER TABLE public.sup_patrimonio ADD  CONSTRAINT sup_patrimonio_motivo_coerente
--     CHECK ((em_manutencao AND motivo_indisponivel IN ('manutencao','contrato'))
--            OR ((NOT em_manutencao) AND motivo_indisponivel IS NULL));
--   ALTER TABLE public.sup_patrimonio DROP COLUMN IF EXISTS motivo_detalhe;
--   (e repor cs_veiculos_frota / cs_veiculo_motivo_indisponivel da 20260906000006)
-- =========================================================================

ALTER TABLE public.sup_patrimonio
  ADD COLUMN IF NOT EXISTS motivo_detalhe text;

COMMENT ON COLUMN public.sup_patrimonio.motivo_indisponivel IS
  'manutencao | contrato | outro. NULL quando disponivel. "contrato" = alocado a um contrato; "outro" = motivo escrito a mao em motivo_detalhe.';
COMMENT ON COLUMN public.sup_patrimonio.motivo_detalhe IS
  'Texto livre do motivo, obrigatorio e exclusivo de motivo_indisponivel = ''outro''. Morre junto com a indisponibilidade.';

-- ── A constraint ─────────────────────────────────────────────────────
-- Tres regras numa so, e as tres importam:
--   1. indisponivel exige um dos tres motivos;
--   2. 'outro' exige texto NAO VAZIO — sem isso a opcao vira um jeito de
--      bloquear o bem sem dizer por que, que e exatamente o problema que ela
--      veio resolver. `btrim(...) <> ''` recusa tambem o espaco em branco;
--   3. os outros motivos exigem texto NULO — dado orfao de um estado que nao
--      existe mais e o mesmo defeito que sup_patrimonio_datas_coerentes evita.
ALTER TABLE public.sup_patrimonio DROP CONSTRAINT IF EXISTS sup_patrimonio_motivo_coerente;
ALTER TABLE public.sup_patrimonio ADD  CONSTRAINT sup_patrimonio_motivo_coerente
  CHECK (
    (
      em_manutencao
      AND motivo_indisponivel IN ('manutencao', 'contrato', 'outro')
      AND (
        (motivo_indisponivel =  'outro' AND motivo_detalhe IS NOT NULL AND btrim(motivo_detalhe) <> '')
        OR
        (motivo_indisponivel <> 'outro' AND motivo_detalhe IS NULL)
      )
    )
    OR ((NOT em_manutencao) AND motivo_indisponivel IS NULL AND motivo_detalhe IS NULL)
  );

-- ── A frota que o Agendamento le ─────────────────────────────────────
-- DROP antes do CREATE: acrescentar coluna ao RETURNS TABLE muda o tipo de
-- retorno e o CREATE OR REPLACE recusa. Mesma manobra da 20260906000006.
DROP FUNCTION IF EXISTS public.cs_veiculos_frota();
CREATE OR REPLACE FUNCTION public.cs_veiculos_frota()
RETURNS TABLE(
  id uuid, empresa_id uuid, nome text, identificador text, lotacao text,
  contrato_nome text, foto_path text, em_manutencao boolean,
  data_inicio_manutencao date, data_previsao_fim date,
  motivo_indisponivel text, motivo_detalhe text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p.id, p.empresa_id, p.nome, p.identificador, p.lotacao, c.nome,
         p.foto_path,
         p.em_manutencao, p.data_inicio_manutencao, p.data_previsao_fim,
         p.motivo_indisponivel, p.motivo_detalhe
    FROM public.sup_patrimonio p
    LEFT JOIN public.contratos c ON c.id = p.contrato_id
   WHERE p.categoria = 'veiculo'
     AND p.ativo
     AND public.tem_acesso_menu('central_servicos_veiculos')
   ORDER BY p.nome;
$$;

REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_frota() TO authenticated;

-- ── A recusa que o usuario le ao tentar agendar ──────────────────────
-- Esta funcao ja bloqueava os tres casos (o gate e `em_manutencao`), mas
-- dizia "em manutencao" para todos. Com um motivo escrito a mao, repetir
-- "manutencao" seria mentir para quem esta tentando agendar.
CREATE OR REPLACE FUNCTION public.cs_veiculo_motivo_indisponivel(
  p_patrimonio_id uuid,
  p_data_inicio   date,
  p_data_fim      date
)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v       record;
  vc      record;
  v_porque text;
BEGIN
  SELECT nome, ativo, em_manutencao, data_inicio_manutencao, data_previsao_fim,
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

  IF v.em_manutencao THEN
    -- Registro antigo pode estar indisponível sem motivo gravado: era
    -- manutenção, o único que existia antes de 17/08/2026.
    v_porque := CASE coalesce(v.motivo_indisponivel, 'manutencao')
                  WHEN 'contrato' THEN 'Veículo alocado a um contrato'
                  WHEN 'outro'    THEN 'Veículo indisponível: ' || v.motivo_detalhe
                  ELSE 'Veículo em manutenção'
                END;

    IF v.data_previsao_fim IS NULL THEN
      RETURN v_porque || ' — liberação por tempo indeterminado.';
    ELSIF p_data_inicio <= v.data_previsao_fim THEN
      RETURN v_porque || ' até ' || to_char(v.data_previsao_fim, 'DD/MM/YYYY')
             || '. Agende a partir de ' || to_char(v.data_previsao_fim + 1, 'DD/MM/YYYY') || '.';
    END IF;
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

-- ── Conferência ──────────────────────────────────────────────────────
SELECT pg_get_constraintdef(oid) AS constraint_atual
  FROM pg_constraint WHERE conname = 'sup_patrimonio_motivo_coerente';

SELECT coalesce(motivo_indisponivel, '(disponível)') AS motivo, count(*)
  FROM public.sup_patrimonio GROUP BY 1 ORDER BY 2 DESC;

NOTIFY pgrst, 'reload schema';