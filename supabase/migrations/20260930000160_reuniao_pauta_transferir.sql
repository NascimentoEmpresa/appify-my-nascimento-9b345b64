-- SIS-2026-0373: "movimentar uma pauta para uma próxima reunião já marcada
-- ou até criar uma extraordinária".
--
-- Decisão de produto (com o desenvolvedor): transferir COM RASTRO, não mover.
-- O item de pauta é recriado na reunião de destino e o de origem continua lá,
-- marcado como transferido — a ata e o histórico da reunião original não
-- mudam (o caso típico é justamente a pauta que não deu tempo de tratar numa
-- reunião que já foi encerrada). Respostas, decisões e ações ficam na origem;
-- os anexos são copiados pelo frontend (Storage não é alcançável daqui), pra
-- pauta nova não depender de acesso à reunião antiga — a policy de download
-- (tem_interacao_storage_reunioes) valida pelo primeiro segmento do path, que
-- é o pauta_id de origem.
--
-- Por que RPC e não UPDATE/INSERT direto: reuniao_pauta só aceita escrita com
-- a reunião 'agendada'/'em_andamento' (ver 20260718000001) — a origem pode já
-- estar concluída, e o rastro na origem precisa ser gravado mesmo assim.

-- 1) Rastro da transferência nos dois lados ------------------------------------
-- SET NULL: excluir o item de destino (ou a reunião de destino inteira) desfaz
-- a marca na origem, que volta a aparecer como item normal, transferível de novo.
ALTER TABLE public.reuniao_pauta
  ADD COLUMN IF NOT EXISTS transferida_para_pauta_id uuid REFERENCES public.reuniao_pauta(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transferida_de_pauta_id   uuid REFERENCES public.reuniao_pauta(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reuniao_pauta_transferida_para
  ON public.reuniao_pauta(transferida_para_pauta_id) WHERE transferida_para_pauta_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reuniao_pauta_transferida_de
  ON public.reuniao_pauta(transferida_de_pauta_id) WHERE transferida_de_pauta_id IS NOT NULL;

-- 2) RPC de transferência --------------------------------------------------------
-- Quem pode: quem organiza as DUAS reuniões (criador, organizador ou
-- responsável pela ata) — mesmo trio que já gerencia pauta no frontend
-- (podeGerenciar em ReuniaoDetalhe.tsx). Destino tem que estar 'agendada'.
-- COALESCE(... IN ..., false): com alguma das três colunas NULL e sem match, o
-- IN devolve NULL e o NOT NULL não dispararia o RAISE.
CREATE OR REPLACE FUNCTION public.transferir_pauta_reuniao(
  _pauta_id           uuid,
  _reuniao_destino_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_pauta   public.reuniao_pauta%ROWTYPE;
  v_origem  public.reuniao%ROWTYPE;
  v_destino public.reuniao%ROWTYPE;
  v_ordem   int;
  v_nova_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501';
  END IF;

  IF NOT public.tem_acesso_menu('central_servicos_reunioes') THEN
    RAISE EXCEPTION 'sem_acesso_menu' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pauta FROM public.reuniao_pauta WHERE id = _pauta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pauta_nao_encontrada' USING ERRCODE = '22023';
  END IF;

  IF v_pauta.transferida_para_pauta_id IS NOT NULL THEN
    RAISE EXCEPTION 'pauta_ja_transferida' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_origem FROM public.reuniao WHERE id = v_pauta.reuniao_id;
  IF NOT COALESCE(v_uid IN (v_origem.criado_por, v_origem.responsavel_preenchimento_user_id, v_origem.organizador_user_id), false) THEN
    RAISE EXCEPTION 'sem_permissao_reuniao_origem' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE no destino serializa transferências simultâneas pra mesma
  -- reunião — sem isso, duas poderiam calcular a mesma "ordem".
  SELECT * INTO v_destino FROM public.reuniao WHERE id = _reuniao_destino_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reuniao_destino_nao_encontrada' USING ERRCODE = '22023';
  END IF;

  IF v_destino.id = v_origem.id THEN
    RAISE EXCEPTION 'mesma_reuniao' USING ERRCODE = '22023';
  END IF;

  IF v_destino.etapa <> 'agendada' THEN
    RAISE EXCEPTION 'reuniao_destino_nao_agendada' USING ERRCODE = '22023';
  END IF;

  IF NOT COALESCE(v_uid IN (v_destino.criado_por, v_destino.responsavel_preenchimento_user_id, v_destino.organizador_user_id), false) THEN
    RAISE EXCEPTION 'sem_permissao_reuniao_destino' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(ordem) + 1, 0) INTO v_ordem
    FROM public.reuniao_pauta WHERE reuniao_id = v_destino.id;

  -- Status volta ao default ('nao_iniciada'): no destino o item ainda não foi tratado.
  INSERT INTO public.reuniao_pauta (
    reuniao_id, ordem, titulo_topico, descricao, responsavel_user_id, prazo,
    tempo_previsto_minutos, natureza, transferida_de_pauta_id
  ) VALUES (
    v_destino.id, v_ordem, v_pauta.titulo_topico, v_pauta.descricao, v_pauta.responsavel_user_id, v_pauta.prazo,
    v_pauta.tempo_previsto_minutos, v_pauta.natureza, v_pauta.id
  ) RETURNING id INTO v_nova_id;

  UPDATE public.reuniao_pauta SET transferida_para_pauta_id = v_nova_id WHERE id = v_pauta.id;

  INSERT INTO public.reuniao_log (reuniao_id, user_id, acao, detalhe) VALUES
    (v_origem.id, v_uid, 'pauta_transferida',
     format('Tópico "%s" transferido para a reunião %s (%s)', v_pauta.titulo_topico, v_destino.numero,
            to_char(v_destino.data_hora AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'))),
    (v_destino.id, v_uid, 'pauta_recebida',
     format('Tópico "%s" recebido por transferência da reunião %s', v_pauta.titulo_topico, v_origem.numero));

  RETURN v_nova_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transferir_pauta_reuniao(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transferir_pauta_reuniao(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.transferir_pauta_reuniao(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.transferir_pauta_reuniao(uuid, uuid);
-- DROP INDEX IF EXISTS public.idx_reuniao_pauta_transferida_para;
-- DROP INDEX IF EXISTS public.idx_reuniao_pauta_transferida_de;
-- ALTER TABLE public.reuniao_pauta DROP COLUMN IF EXISTS transferida_para_pauta_id;
-- ALTER TABLE public.reuniao_pauta DROP COLUMN IF EXISTS transferida_de_pauta_id;
-- NOTIFY pgrst, 'reload schema';
