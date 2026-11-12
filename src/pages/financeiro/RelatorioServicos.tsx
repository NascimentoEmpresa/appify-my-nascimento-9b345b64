import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import NotasConcluidasTab from "./relatorio-servicos/NotasConcluidasTab";
import RelatorioGeralTab from "./relatorio-servicos/RelatorioGeralTab";
import DashboardRelatorioServicos from "./relatorio-servicos/DashboardRelatorioServicos";
import ConciliacaoFinanceiraTab, { type FiltroAbrirGeral } from "./relatorio-servicos/ConciliacaoFinanceiraTab";

// SIS-2026-0869: menu fantasma (app_menu.rota = NULL) que libera a aba Conciliação por usuário em Administração > Módulos.
export const MENU_CONCILIACAO_SERVICOS = "relatorio-servicos-conciliacao";

export default function RelatorioServicos() {
  // SIS-2026-0562: clicar numa linha do Controle de Faturamento manda pra
  // cá com ?empresa=&competencia=&contrato= — nesse caso abre direto na
  // aba "Relatório Geral" (a única com esses 3 filtros), não na aba padrão.
  const [searchParams, setSearchParams] = useSearchParams();
  const abaInicial = searchParams.has("empresa") || searchParams.has("competencia") || searchParams.has("contrato") || searchParams.has("codigo") || searchParams.has("status") ? "geral" : "contrato";
  // SIS-2026-0869: aba controlada — a Conciliação leva o usuário ao Relatório Geral já filtrado na NF/contrato que divergiu.
  const [aba, setAba] = useState(abaInicial);
  const { data: temConciliacao = false } = useScreenAccess(MENU_CONCILIACAO_SERVICOS, "visualizar");

  function abrirNoGeral(f: FiltroAbrirGeral) {
    setSearchParams({ empresa: f.empresa, competencia: f.competencia, contrato: f.contrato, codigo: "N" });
    setAba("geral");
  }

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
      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="contrato">Por Contrato</TabsTrigger>
          <TabsTrigger value="geral">Relatório Geral</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          {temConciliacao && <TabsTrigger value="conciliacao">Conciliação</TabsTrigger>}
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
        {temConciliacao && (
          <TabsContent value="conciliacao" className="mt-4">
            <ConciliacaoFinanceiraTab onAbrirNoGeral={abrirNoGeral} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
