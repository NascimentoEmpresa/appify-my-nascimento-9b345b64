import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import NotasConcluidasTab from "./relatorio-servicos/NotasConcluidasTab";
import RelatorioGeralTab from "./relatorio-servicos/RelatorioGeralTab";
import DashboardRelatorioServicos from "./relatorio-servicos/DashboardRelatorioServicos";

export default function RelatorioServicos() {
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
      <Tabs defaultValue="contrato">
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
