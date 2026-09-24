-- SIS-2026-0470: acesso administrativo individual à Agenda de Reunião.
--
-- O vínculo é uma flag própria, gerenciada em Administração > Módulos & Menus
-- > Central de Serviços > Agenda de Reunião. Não usamos uma ação genérica de
-- app_menu porque perfis de módulo concedem todas as ações automaticamente;
-- isso transformaria usuários já existentes em administradores sem que alguém
-- ligasse a nova flag de forma explícita.

CREATE TABLE IF NOT EXISTS public.reuniao_administrador (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid()
);

ALTER TABLE public.reuniao_administrador ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reuniao_administrador_select ON public.reuniao_administrador;
CREATE POLICY reuniao_administrador_select ON public.reuniao_administrador
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

DROP POLICY IF EXISTS reuniao_administrador_insert ON public.reuniao_administrador;
CREATE POLICY reuniao_administrador_insert ON public.reuniao_administrador
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

DROP POLICY IF EXISTS reuniao_administrador_delete ON public.reuniao_administrador;
CREATE POLICY reuniao_administrador_delete ON public.reuniao_administrador
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'));

CREATE OR REPLACE FUNCTION public.pode_administrar_reunioes()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.reuniao_administrador ra
     WHERE ra.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.pode_administrar_reunioes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pode_administrar_reunioes() TO authenticated;

-- A flag também torna a pessoa uma participante administrativa para que o
-- detalhe e seus dados relacionados sejam legíveis/editáveis pelas policies
-- existentes que centralizam a autorização nesta função.
CREATE OR REPLACE FUNCTION public.tem_interacao_reuniao(p_reuniao_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.pode_administrar_reunioes()
      OR EXISTS (
        SELECT 1 FROM public.reuniao r
         WHERE r.id = p_reuniao_id
           AND (
             auth.uid() = r.criado_por
             OR auth.uid() = r.responsavel_preenchimento_user_id
             OR auth.uid() = r.organizador_user_id
             OR EXISTS (
               SELECT 1 FROM public.reuniao_convidado c
                WHERE c.reuniao_id = r.id AND c.user_id = auth.uid()
             )
           )
      );
$$;

-- A policy de SELECT tem a condição escrita diretamente para evitar a
-- recursão reuniao -> tem_interacao_reuniao -> reuniao que já ocorreu neste
-- módulo (correção original em 20260710000002/20260726000001).
DROP POLICY IF EXISTS reuniao_select ON public.reuniao;
CREATE POLICY reuniao_select ON public.reuniao
  FOR SELECT TO authenticated
  USING (
    public.tem_acesso_menu('central_servicos_reunioes')
    AND (
      public.pode_administrar_reunioes()
      OR auth.uid() = criado_por
      OR auth.uid() = responsavel_preenchimento_user_id
      OR auth.uid() = organizador_user_id
      OR EXISTS (
        SELECT 1 FROM public.reuniao_convidado c
         WHERE c.reuniao_id = reuniao.id AND c.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS reuniao_update ON public.reuniao;
CREATE POLICY reuniao_update ON public.reuniao
  FOR UPDATE TO authenticated
  USING (
    public.tem_acesso_menu('central_servicos_reunioes')
    AND (public.pode_administrar_reunioes() OR auth.uid() IN (criado_por, responsavel_preenchimento_user_id, organizador_user_id))
  )
  WITH CHECK (
    public.tem_acesso_menu('central_servicos_reunioes')
    AND (public.pode_administrar_reunioes() OR auth.uid() IN (criado_por, responsavel_preenchimento_user_id, organizador_user_id))
  );

DROP POLICY IF EXISTS reuniao_delete ON public.reuniao;
CREATE POLICY reuniao_delete ON public.reuniao
  FOR DELETE TO authenticated
  USING (
    public.tem_acesso_menu('central_servicos_reunioes')
    AND (public.pode_administrar_reunioes() OR auth.uid() IN (criado_por, responsavel_preenchimento_user_id, organizador_user_id))
  );

-- O detalhe usa a mesma noção de "gerenciar" para pauta, respostas e
-- participantes. Mantemos as regras de etapa existentes e acrescentamos só o
-- bypass da flag, para não exibir controles que a RLS recusaria em seguida.
DROP POLICY IF EXISTS reuniao_pauta_insert ON public.reuniao_pauta;
CREATE POLICY reuniao_pauta_insert ON public.reuniao_pauta
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_menu('central_servicos_reunioes')
    AND EXISTS (
      SELECT 1 FROM public.reuniao r
       WHERE r.id = reuniao_id AND r.etapa IN ('agendada', 'em_andamento')
         AND (public.pode_administrar_reunioes() OR auth.uid() IN (r.criado_por, r.responsavel_preenchimento_user_id, r.organizador_user_id))
    )
  );

DROP POLICY IF EXISTS reuniao_pauta_update ON public.reuniao_pauta;
CREATE POLICY reuniao_pauta_update ON public.reuniao_pauta
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reuniao r
       WHERE r.id = reuniao_id AND r.etapa IN ('agendada', 'em_andamento')
         AND (public.pode_administrar_reunioes() OR auth.uid() IN (r.criado_por, r.responsavel_preenchimento_user_id, r.organizador_user_id, reuniao_pauta.responsavel_user_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reuniao r
       WHERE r.id = reuniao_id AND r.etapa IN ('agendada', 'em_andamento')
         AND (public.pode_administrar_reunioes() OR auth.uid() IN (r.criado_por, r.responsavel_preenchimento_user_id, r.organizador_user_id, reuniao_pauta.responsavel_user_id))
    )
  );

DROP POLICY IF EXISTS reuniao_pauta_delete ON public.reuniao_pauta;
CREATE POLICY reuniao_pauta_delete ON public.reuniao_pauta
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reuniao r
       WHERE r.id = reuniao_id AND r.etapa IN ('agendada', 'em_andamento')
         AND (public.pode_administrar_reunioes() OR auth.uid() IN (r.criado_por, r.responsavel_preenchimento_user_id, r.organizador_user_id))
    )
  );

DROP POLICY IF EXISTS reuniao_resposta_insert ON public.reuniao_resposta;
CREATE POLICY reuniao_resposta_insert ON public.reuniao_resposta
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_menu('central_servicos_reunioes')
    AND EXISTS (
      SELECT 1 FROM public.reuniao_pauta p JOIN public.reuniao r ON r.id = p.reuniao_id
       WHERE p.id = pauta_id AND r.etapa = 'em_andamento'
         AND (public.pode_administrar_reunioes() OR auth.uid() IN (r.criado_por, r.responsavel_preenchimento_user_id, r.organizador_user_id, p.responsavel_user_id))
    )
  );

DROP POLICY IF EXISTS reuniao_resposta_update ON public.reuniao_resposta;
CREATE POLICY reuniao_resposta_update ON public.reuniao_resposta
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reuniao_pauta p JOIN public.reuniao r ON r.id = p.reuniao_id
       WHERE p.id = pauta_id AND r.etapa = 'em_andamento'
         AND (public.pode_administrar_reunioes() OR auth.uid() IN (r.criado_por, r.responsavel_preenchimento_user_id, r.organizador_user_id, p.responsavel_user_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reuniao_pauta p JOIN public.reuniao r ON r.id = p.reuniao_id
       WHERE p.id = pauta_id AND r.etapa = 'em_andamento'
         AND (public.pode_administrar_reunioes() OR auth.uid() IN (r.criado_por, r.responsavel_preenchimento_user_id, r.organizador_user_id, p.responsavel_user_id))
    )
  );

DROP POLICY IF EXISTS reuniao_convidado_insert ON public.reuniao_convidado;
CREATE POLICY reuniao_convidado_insert ON public.reuniao_convidado
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_menu('central_servicos_reunioes')
    AND EXISTS (
      SELECT 1 FROM public.reuniao r
       WHERE r.id = reuniao_id
         AND (public.pode_administrar_reunioes() OR auth.uid() IN (r.criado_por, r.responsavel_preenchimento_user_id, r.organizador_user_id))
    )
  );

DROP POLICY IF EXISTS reuniao_convidado_delete ON public.reuniao_convidado;
CREATE POLICY reuniao_convidado_delete ON public.reuniao_convidado
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reuniao r
       WHERE r.id = reuniao_id
         AND (public.pode_administrar_reunioes() OR auth.uid() IN (r.criado_por, r.responsavel_preenchimento_user_id, r.organizador_user_id))
    )
  );

DROP POLICY IF EXISTS reuniao_convidado_update ON public.reuniao_convidado;
CREATE POLICY reuniao_convidado_update ON public.reuniao_convidado
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.pode_administrar_reunioes()
    OR EXISTS (
      SELECT 1 FROM public.reuniao r
       WHERE r.id = reuniao_id AND auth.uid() IN (r.criado_por, r.responsavel_preenchimento_user_id, r.organizador_user_id)
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR public.pode_administrar_reunioes()
    OR EXISTS (
      SELECT 1 FROM public.reuniao r
       WHERE r.id = reuniao_id AND auth.uid() IN (r.criado_por, r.responsavel_preenchimento_user_id, r.organizador_user_id)
    )
  );

DROP POLICY IF EXISTS reuniao_comentario_delete ON public.reuniao_comentario;
CREATE POLICY reuniao_comentario_delete ON public.reuniao_comentario
  FOR DELETE TO authenticated
  USING (
    autor_id = auth.uid()
    OR public.pode_administrar_reunioes()
    OR EXISTS (
      SELECT 1 FROM public.reuniao r
       WHERE r.id = reuniao_id
         AND auth.uid() IN (r.criado_por, r.responsavel_preenchimento_user_id, r.organizador_user_id)
    )
  );

-- O trigger também valida transições de etapa; sem este ajuste, a RLS
-- permitiria editar mas cancelar continuaria falhando dentro do trigger.
CREATE OR REPLACE FUNCTION public.checar_transicao_reuniao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.etapa = OLD.etapa THEN
    RETURN NEW;
  END IF;

  IF NOT public.pode_administrar_reunioes()
     AND auth.uid() NOT IN (OLD.criado_por, OLD.responsavel_preenchimento_user_id, OLD.organizador_user_id) THEN
    RAISE EXCEPTION 'Só o criador, o organizador, o responsável pelo preenchimento ou uma pessoa com acesso admin podem mudar a etapa da reunião.';
  END IF;

  IF NEW.etapa = 'cancelada' THEN
    IF OLD.etapa IN ('concluida', 'cancelada') THEN
      RAISE EXCEPTION 'Não é possível cancelar uma reunião %.', OLD.etapa;
    END IF;
    IF NEW.motivo_cancelamento IS NULL OR btrim(NEW.motivo_cancelamento) = '' THEN
      RAISE EXCEPTION 'Motivo do cancelamento é obrigatório.';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.etapa = 'agendada' AND NEW.etapa = 'em_andamento')
    OR (OLD.etapa = 'em_andamento' AND NEW.etapa = 'concluida')
  ) THEN
    RAISE EXCEPTION 'Transição de etapa não permitida: % → %', OLD.etapa, NEW.etapa;
  END IF;

  RETURN NEW;
END;
$$;

-- A transferência é SECURITY DEFINER e faz sua própria autorização, portanto
-- também precisa conhecer a flag (a RLS não participa dessa decisão).
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
  IF NOT public.pode_administrar_reunioes()
     AND NOT COALESCE(v_uid IN (v_origem.criado_por, v_origem.responsavel_preenchimento_user_id, v_origem.organizador_user_id), false) THEN
    RAISE EXCEPTION 'sem_permissao_reuniao_origem' USING ERRCODE = '42501';
  END IF;

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

  IF NOT public.pode_administrar_reunioes()
     AND NOT COALESCE(v_uid IN (v_destino.criado_por, v_destino.responsavel_preenchimento_user_id, v_destino.organizador_user_id), false) THEN
    RAISE EXCEPTION 'sem_permissao_reuniao_destino' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(ordem) + 1, 0) INTO v_ordem
    FROM public.reuniao_pauta WHERE reuniao_id = v_destino.id;

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

-- =========================================================================
-- ROLLBACK
-- Recriar tem_interacao_reuniao, reuniao_select, reuniao_update,
-- reuniao_delete e checar_transicao_reuniao pelas versões imediatamente
-- anteriores; depois executar:
--   DROP FUNCTION IF EXISTS public.pode_administrar_reunioes();
--   DROP TABLE IF EXISTS public.reuniao_administrador;
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
