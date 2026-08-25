import { PageHeader } from "@/components/layout/PageHeader";
import { PainelTrocaFuncao } from "@/components/troca-funcao/PainelTrocaFuncao";

export default function TrocaFuncao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Mudança de Função — ASO"
        subtitle="Marque o ASO de mudança de função. Depois disso a solicitação segue para o RH alterar na Senior."
        module="SST"
        breadcrumb={["Mudança de Função — ASO"]}
      />
      <PainelTrocaFuncao etapa="sst" />
    </div>
  );
}
