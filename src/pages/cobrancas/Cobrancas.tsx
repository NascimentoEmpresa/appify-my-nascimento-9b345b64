import { PageHeader } from "@/components/layout/PageHeader";
import NotasAbertoTab from "./NotasAbertoTab";

export default function Cobrancas() {
  return (
    <div className="space-y-6">
      <PageHeader
        module="Financeiro"
        breadcrumb={["Controle de Notas", "Cobranças"]}
        title="Cobranças"
        subtitle="Notas em aberto para cobrança."
      />

      <NotasAbertoTab />
    </div>
  );
}
