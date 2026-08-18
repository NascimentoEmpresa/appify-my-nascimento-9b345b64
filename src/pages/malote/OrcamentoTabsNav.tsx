import { useNavigate, useLocation } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ROTA_GERAL = "/app/malote/orcamento-geral";
const ROTA_DETALHE = "/app/malote/detalhe-orcamento";

// Navegação em estilo de abas (SIS-2026-0168) entre Orçamento Geral e
// Detalhe Orçamento — mesmo visual de Tabs já usado em Configuracoes.tsx,
// mas cada "aba" é uma rota de verdade (não troca de conteúdo local), pra
// não perder os filtros na URL do Detalhe Orçamento (usados pelos botões
// "Ver detalhes" contextuais do Orçamento Geral). Clicar em "Detalhe
// Orçamento" por aqui abre a versão geral, sem nenhum filtro pré-marcado —
// é o acesso genérico à tela, complementar aos botões de olho por linha.
export function OrcamentoTabsNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const aba = location.pathname.startsWith(ROTA_DETALHE) ? "detalhe" : "geral";

  return (
    <Tabs value={aba} onValueChange={(v) => navigate(v === "geral" ? ROTA_GERAL : ROTA_DETALHE)}>
      <TabsList>
        <TabsTrigger value="geral">Orçamento Geral</TabsTrigger>
        <TabsTrigger value="detalhe">Detalhe Orçamento</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
