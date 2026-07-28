-- Campo "Cliente/Órgão" na Capa do Edital — hoje não existe em lugar nenhum
-- do formulário (só cidade/objeto). Necessário para a promoção de uma Capa
-- ganha também criar um registro em public.contratos (cliente é NOT NULL
-- lá), fechando o loop Grade → Capa → public.contratos.
ALTER TABLE public.capa_edital ADD COLUMN IF NOT EXISTS cliente text;
