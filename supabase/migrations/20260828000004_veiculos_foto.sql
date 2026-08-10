-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — a foto do carro no card
--
-- `sup_patrimonio.foto_path` já existe e será preenchida pelo módulo de
-- Patrimônio. Aqui só se LÊ: a coluna entra no retorno da RPC da frota.
--
-- POR QUE UM BUCKET NOVO, E NÃO O `sup-patrimonio`
--
--   O bucket `sup-patrimonio` é privado e guarda as NOTAS FISCAIS de
--   manutenção — a 20260824000001 é explícita: "nota fiscal de manutenção
--   não é documento público". A policy de leitura dele exige
--   can_access('sup_patrimonio'|'sup_manutencao'), que o colaborador comum
--   não tem.
--
--   Para a foto aparecer no card do agendamento haveria duas saídas:
--   liberar leitura naquele bucket (o que exporia as notas fiscais junto —
--   regressão de privacidade), ou dar à foto um lugar próprio. É a segunda.
--   Foto de carro não é documento sigiloso; nota fiscal é. Bucket separado
--   mantém as duas coisas com a visibilidade que cada uma merece.
--
--   ESCREVER continua restrito a quem administra o Patrimônio. Só a LEITURA
--   é aberta, e só das fotos.
--
-- ROLLBACK:
--   DELETE FROM storage.buckets WHERE id = 'sup-veiculo-foto';
--   (e reaplicar a RPC da 20260828000002, sem foto_path)
-- =====================================================================

-- ── 1. Bucket público só de fotos de veículo ─────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('sup-veiculo-foto', 'sup-veiculo-foto', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Leitura: o bucket é público, então o <img> do card funciona para qualquer
-- colaborador, sem signed URL e sem depender de permissão de Patrimônio.
-- Escrita: só quem administra o Patrimônio, que é quem cadastra o bem.
DROP POLICY IF EXISTS sup_veic_foto_insert ON storage.objects;
CREATE POLICY sup_veic_foto_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sup-veiculo-foto'
    AND public.can_access(auth.uid(), 'sup_patrimonio', 'alterar'));

DROP POLICY IF EXISTS sup_veic_foto_update ON storage.objects;
CREATE POLICY sup_veic_foto_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'sup-veiculo-foto'
    AND public.can_access(auth.uid(), 'sup_patrimonio', 'alterar'));

DROP POLICY IF EXISTS sup_veic_foto_delete ON storage.objects;
CREATE POLICY sup_veic_foto_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sup-veiculo-foto'
    AND public.can_access(auth.uid(), 'sup_patrimonio', 'alterar'));

-- ── 2. A RPC passa a devolver a foto ─────────────────────────────────
DROP FUNCTION IF EXISTS public.cs_veiculos_frota();

CREATE OR REPLACE FUNCTION public.cs_veiculos_frota()
RETURNS TABLE (
  id                     uuid,
  empresa_id             uuid,
  nome                   text,
  identificador          text,
  lotacao                text,
  contrato_nome          text,
  foto_path              text,
  em_manutencao          boolean,
  data_inicio_manutencao date,
  data_previsao_fim      date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.empresa_id, p.nome, p.identificador, p.lotacao, c.nome,
         p.foto_path,
         p.em_manutencao, p.data_inicio_manutencao, p.data_previsao_fim
    FROM public.sup_patrimonio p
    LEFT JOIN public.contratos c ON c.id = p.contrato_id
   WHERE p.categoria = 'veiculo'
     AND p.ativo
     AND public.tem_acesso_menu('central_servicos_veiculos')
     AND p.empresa_id IN (
       SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
     )
   ORDER BY p.nome;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_frota() TO authenticated;

NOTIFY pgrst, 'reload schema';
