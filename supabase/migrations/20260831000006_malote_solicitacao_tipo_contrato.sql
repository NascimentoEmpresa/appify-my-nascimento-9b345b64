-- SIS-2026-0104 (última hora, Iury): o campo "Tipo" da Solicitação não é
-- Despesa/Compra/Manutenção — é Administrativo/Contrato/Dispensa de
-- cotação. Quando Tipo='contrato', a tela precisa de Empresa (reaproveita
-- empresa_id já existente) + Contrato (coluna nova) pra Suprimentos saber
-- de qual contrato se trata. "Dispensa de cotação" NÃO muda o fluxo de
-- status — ainda vai pro Suprimentos (aguardando_cotacao), só que lá eles
-- veem que esse item não precisa das 3 cotações, só da aprovação deles.

ALTER TABLE public.malote_despesa DROP CONSTRAINT malote_despesa_tipo_check;
ALTER TABLE public.malote_despesa ADD CONSTRAINT malote_despesa_tipo_check CHECK (tipo IS NULL OR tipo IN ('administrativo', 'contrato', 'dispensa_cotacao'));

ALTER TABLE public.malote_despesa ADD COLUMN contrato_id uuid REFERENCES public.contratos(id);

COMMENT ON COLUMN public.malote_despesa.tipo IS 'Categoria da solicitação: Administrativo, Contrato (exige empresa_id + contrato_id) ou Dispensa de cotação (ainda passa pelo Suprimentos, só que sem exigir 3 cotações).';
COMMENT ON COLUMN public.malote_despesa.contrato_id IS 'Só preenchido quando tipo=contrato — de qual contrato a solicitação trata.';

NOTIFY pgrst, 'reload schema';
