import { PageHeader } from "@/components/layout/PageHeader";
import { PainelTrocaFuncao } from "@/components/troca-funcao/PainelTrocaFuncao";

export default function TrocaFuncao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Mudança de Função"
        subtitle="Aprove as trocas de função pedidas pelos encarregados nos contratos. O que você aprovar segue para o SST marcar o ASO."
        module="Operacional"
        breadcrumb={["Mudança de Função"]}
      />
      <PainelTrocaFuncao etapa="operacional" />
    </div>
  );
}
