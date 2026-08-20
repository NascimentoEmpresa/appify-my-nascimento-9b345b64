-- =========================================================================
-- Recrutamento: um colaborador só pode ter UMA vaga de substituição por vez
--
-- Pedido do Pablo (20/08/2026): "o colaborador selecionado pra SUBSTITUIÇÃO
-- não pode ser selecionado mais de uma vez se ele já estiver sido selecionado
-- em alguma solicitação".
--
-- O `nome_substituido` é texto e não serve de chave (homônimo abre duas vagas
-- para pessoas diferentes, e um acento a mais deixa a mesma pessoa passar
-- duas vezes). Por isso entra `substituido_id` — o ID da EMPREGADOS, que a
-- tela já tem em mãos porque a pessoa é ESCOLHIDA na lista, não digitada.
--
-- Vaga Reprovada ou Cancelada não segura ninguém: ela não repõe o posto, e
-- travar o colaborador para sempre por causa de uma vaga recusada só obrigaria
-- o RH a mexer no banco. Nesses dois status a pessoa volta a ficar livre.
-- =========================================================================

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS substituido_id bigint;

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".substituido_id IS
  'ID em EMPREGADOS de quem a vaga repõe. Preenchido SÓ em Substituição: nos outros motivos o colaborador escolhido é apenas o molde de onde vieram cargo/contrato/escala/salário, e gravar o id dele aqui prenderia a pessoa no índice único sem motivo.';

-- Piso de verdade: o banco recusa a segunda vaga viva do mesmo substituído,
-- venha ela de onde vier. NULL não entra em índice único, então as vagas dos
-- outros motivos (e as antigas) não são afetadas.
CREATE UNIQUE INDEX IF NOT EXISTS sistema_recrutamento_substituido_vivo_idx
  ON public."SISTEMA_RECRUTAMENTO" (substituido_id)
  WHERE substituido_id IS NOT NULL
    AND status NOT IN ('Reprovada', 'Cancelada');

-- O índice sozinho estoura um 23505 ilegível na tela. O trigger chega antes e
-- diz QUAL vaga já existe, que é o que a pessoa precisa saber para resolver.
CREATE OR REPLACE FUNCTION public.rec_substituido_unico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_outra bigint;
BEGIN
  IF NEW.substituido_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.status, '') IN ('Reprovada', 'Cancelada') THEN RETURN NEW; END IF;

  SELECT id INTO v_outra
    FROM public."SISTEMA_RECRUTAMENTO"
   WHERE substituido_id = NEW.substituido_id
     AND id IS DISTINCT FROM NEW.id
     AND COALESCE(status, '') NOT IN ('Reprovada', 'Cancelada')
   ORDER BY id
   LIMIT 1;

  IF v_outra IS NOT NULL THEN
    RAISE EXCEPTION
      'Esse colaborador já está na vaga de substituição #%. Só dá para abrir outra depois que aquela for concluída, cancelada ou reprovada.', v_outra;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rec_substituido_unico ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_rec_substituido_unico
  BEFORE INSERT OR UPDATE ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_substituido_unico();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER trg_rec_substituido_unico ON public."SISTEMA_RECRUTAMENTO";
--   DROP FUNCTION public.rec_substituido_unico();
--   DROP INDEX public.sistema_recrutamento_substituido_vivo_idx;
--   ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP COLUMN substituido_id;
-- =========================================================================
