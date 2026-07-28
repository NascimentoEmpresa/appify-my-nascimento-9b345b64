import { PageHeader } from "@/components/layout/PageHeader";
import NotasConcluidasTab from "./relatorio-servicos/NotasConcluidasTab";

export default function RelatorioServicos() {
  return (
    <div className="space-y-6">
      <PageHeader
        module="Financeiro"
        breadcrumb={["Controle de Notas", "Relatório de Serviços"]}
        title="Relatório de Serviços"
        subtitle="NFs concluídas na Validação de Notas, organizadas por contrato — registre aqui o pagamento de cada uma."
      />

      <NotasConcluidasTab />
    </div>
  );
}
