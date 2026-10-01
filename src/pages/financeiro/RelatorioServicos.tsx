import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import NotasConcluidasTab from "./relatorio-servicos/NotasConcluidasTab";
import RelatorioGeralTab from "./relatorio-servicos/RelatorioGeralTab";
import DashboardRelatorioServicos from "./relatorio-servicos/DashboardRelatorioServicos";

export default function RelatorioServicos() {
  // SIS-2026-0562: clicar numa linha do Controle de Faturamento manda pra
  // cá com ?empresa=&competencia=&contrato= — nesse caso abre direto na
  // aba "Relatório Geral" (a única com esses 3 filtros), não na aba padrão.
  const [searchParams] = useSearchParams();
  const abaInicial = searchParams.has("empresa") || searchParams.has("competencia") || searchParams.has("contrato") ? "geral" : "contrato";

  return (
    <div className="space-y-6">
      <PageHeader
        module="Financeiro"
        breadcrumb={["Controle de Notas", "Relatório de Serviços"]}
        title="Relatório de Serviços"
        subtitle="NFs concluídas na Validação de Notas, organizadas por contrato — registre aqui o pagamento de cada uma."
      />

      {/* SIS-2026-0323 (Ruan/Discord): ajuste de tela com base no HTML de
          referência — 3 visões da mesma tela, igual ao padrão já usado no
          Dashboard do Checklist de Faturamento. */}
      <Tabs defaultValue={abaInicial}>
        <TabsList>
          <TabsTrigger value="contrato">Por Contrato</TabsTrigger>
          <TabsTrigger value="geral">Relatório Geral</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        </TabsList>
        <TabsContent value="contrato" className="mt-4">
          <NotasConcluidasTab />
        </TabsContent>
        <TabsContent value="geral" className="mt-4">
          <RelatorioGeralTab />
        </TabsContent>
        <TabsContent value="dashboard" className="mt-4">
          <DashboardRelatorioServicos />
        </TabsContent>
      </Tabs>
    </div>
  );
}
