-- Um item do modelo pode representar mais de um posto somado (ex: UFFS —
-- "Limpeza e Jardinagem" viram 1 item com retenção de 1,20%, "Motorista,
-- Servicos Gerais, Tradutor/Interprete de Libras e Encarregado" viram outro
-- item com 4,80%). A coluna 'posto' (singular) continua existindo pra
-- retrocompatibilidade dos itens de posto unico ja cadastrados; 'postos'
-- (array) e a fonte de verdade quando presente e nao vazia.
ALTER TABLE public.nf_emissao_modelo_item
  ADD COLUMN postos text[];
