import { PageHeader } from "@/components/layout/PageHeader";
import { PainelTrocaFuncao } from "@/components/troca-funcao/PainelTrocaFuncao";

export default function TrocaFuncao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Mudança de Função"
        subtitle="Faça a alteração do cargo na Senior e conclua a solicitação."
        module="RH"
        breadcrumb={["Mudança de Função"]}
      />
      <PainelTrocaFuncao etapa="rh" />
    </div>
  );
}
