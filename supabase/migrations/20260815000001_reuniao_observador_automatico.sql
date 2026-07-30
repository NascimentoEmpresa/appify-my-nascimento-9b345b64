-- Observador automático em reuniões de Comitê/Gerencial/Diretoria —
-- configurável na tela "Acesso por Usuário" (Central de Serviços > Atas de
-- Reunião), mesmo padrão de CS_FORM_ACESSOS: presença de uma linha = flag
-- ligada pra aquele usuário. Só admin gerencia.
CREATE TABLE IF NOT EXISTS public.reuniao_observador_automatico (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid()
);
ALTER TABLE public.reuniao_observador_automatico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reuniao_observador_automatico_select ON public.reuniao_observador_automatico;
CREATE POLICY reuniao_observador_automatico_select ON public.reuniao_observador_automatico
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS reuniao_observador_automatico_insert ON public.reuniao_observador_automatico;
CREATE POLICY reuniao_observador_automatico_insert ON public.reuniao_observador_automatico
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS reuniao_observador_automatico_delete ON public.reuniao_observador_automatico;
CREATE POLICY reuniao_observador_automatico_delete ON public.reuniao_observador_automatico
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Ao criar uma reunião de Comitê/Gerencial/Diretoria, adiciona automaticamente
-- como observador quem estiver marcado em reuniao_observador_automatico —
-- exceto quem já é criador/organizador/responsável dessa própria reunião.
-- ON CONFLICT DO NOTHING: defensivo, caso a linha já exista por algum motivo.
CREATE OR REPLACE FUNCTION public.adicionar_observadores_automaticos_reuniao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tipo_reuniao IN ('comite', 'gerencial', 'diretoria') THEN
    INSERT INTO public.reuniao_convidado (reuniao_id, user_id, papel)
    SELECT NEW.id, oa.user_id, 'observador'
      FROM public.reuniao_observador_automatico oa
     WHERE oa.user_id NOT IN (NEW.criado_por, NEW.organizador_user_id, NEW.responsavel_preenchimento_user_id)
    ON CONFLICT (reuniao_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reuniao_observadores_automaticos ON public.reuniao;
CREATE TRIGGER trg_reuniao_observadores_automaticos
  AFTER INSERT ON public.reuniao
  FOR EACH ROW EXECUTE FUNCTION public.adicionar_observadores_automaticos_reuniao();
