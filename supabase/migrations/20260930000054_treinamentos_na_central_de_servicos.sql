-- =====================================================================
-- TREINAMENTOS: segunda porta, na Central de Serviços.
--
-- Pedido do Pablo em 04/09/2026: "duplica o sistema dos encarregados de
-- treinamentos, coloca na Central de Serviços; lá o pessoal que tem
-- permissão de ver o sistema vai ver Treinamentos. Mesma lógica do sistema
-- dos encarregados."
--
-- MESMA TELA, MESMOS TREINAMENTOS, PERMISSÃO PRÓPRIA. É o desenho que o ERP
-- já usa duas vezes:
--
--   • "Chamados de Sistemas" abre em /app/encarregados/chamados E em
--     /app/central-servicos/chamados — mesmo componente, duas rotas, cada
--     uma com seu menu;
--   • "Solicitar Vaga" abre na Gestão de Recrutamento E na Central de
--     Serviços (20260930000049), pelo mesmo motivo: quem é do escritório
--     não precisa do módulo inteiro do outro lado para usar UMA tela.
--
-- Aqui é igual: o treinamento do ERP interessa a quem não é encarregado, e
-- hoje a única porta fica dentro do módulo Encarregados. A tela nova NÃO é
-- uma cópia do código (o componente é o mesmo, `TreinamentosERP.tsx`) nem
-- uma cópia do conteúdo (a tabela é a mesma, `TREINAMENTOS`): o que é novo
-- é só a PORTA e a chave dela.
--
-- POR QUE UM CÓDIGO DE MENU NOVO, e não reaproveitar `treinamentos_erp`:
-- reaproveitar faria a tela aparecer na Central de Serviços para todo mundo
-- que já vê o menu dos Encarregados, e vice-versa — as duas portas abririam
-- e fechariam juntas, sem como liberar uma sem a outra. Com código próprio,
-- quem administra decide porta a porta em Acesso por Usuário.
--
-- GERENCIAR CONTINUA UM SÓ (`treinamentos_gerenciar`). Criar e editar
-- treinamento é a mesma ação, venha de qual porta vier — dois códigos para
-- isso dariam dois catálogos de permissão para o mesmo botão.
--
-- Idempotente.
-- =====================================================================

-- 1) O menu da porta nova ------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('central_servicos_treinamentos', 'Treinamentos', '/app/central-servicos/treinamentos', 75)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Ativo mesmo se a linha já existisse desativada: `can_access` e
-- `list_accessible_menus` devolvem false para menu inativo ANTES de olhar
-- perfil, e nem o Administrador Geral escapa disso.
UPDATE public.app_menu SET ativo = true
 WHERE codigo = 'central_servicos_treinamentos';

-- 2) Quem enxerga treinamento -------------------------------------------
-- `trn_pode_ver()` é o único lugar a mexer, e é de propósito que seja um só:
-- ela governa TANTO o SELECT de "TREINAMENTOS" (a grade de cards) QUANTO a
-- leitura do bucket `treinamentos` (capas, vídeos e anexos, que são
-- privados). Se a permissão da porta nova entrasse só na policy da tabela, a
-- pessoa veria os cards e não abriria nenhum vídeo.
--
-- Só GANHA um OR: ninguém que via antes deixa de ver.
CREATE OR REPLACE FUNCTION public.trn_pode_ver()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.can_access(auth.uid(), 'treinamentos_erp', 'visualizar'::public.app_acao)
      OR public.can_access(auth.uid(), 'central_servicos_treinamentos', 'visualizar'::public.app_acao);
$$;
REVOKE ALL ON FUNCTION public.trn_pode_ver() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_pode_ver() TO authenticated;

-- `TREINAMENTO_CONCLUSAO` não precisa de nada: as policies dela são por
-- `user_id = auth.uid()`, sem menu no meio. Quem alcança a tela por qualquer
-- porta já registra a própria conclusão e a nota da prova.

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- CREATE OR REPLACE FUNCTION public.trn_pode_ver() RETURNS boolean
-- LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
-- AS $$ SELECT public.can_access(auth.uid(),'treinamentos_erp','visualizar'::public.app_acao); $$;
-- DELETE FROM public.app_menu WHERE codigo = 'central_servicos_treinamentos';
-- NOTIFY pgrst, 'reload schema';
-- =====================================================================
