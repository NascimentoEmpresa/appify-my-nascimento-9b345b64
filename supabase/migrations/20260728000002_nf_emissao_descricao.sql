-- O campo "observacoes" original era, na prática, a descrição do serviço
-- prestado (o texto que vai impresso na nota — contrato, competência, dados
-- de pagamento, igual ao "Descrição dos serviços" das planilhas legadas).
-- Renomeia pra refletir isso e abre espaço pra um campo de Observações de
-- verdade (anotações internas do analista, separado da descrição impressa).

ALTER TABLE public.nf_emissao RENAME COLUMN observacoes TO descricao;
ALTER TABLE public.nf_emissao ADD COLUMN observacoes text;
