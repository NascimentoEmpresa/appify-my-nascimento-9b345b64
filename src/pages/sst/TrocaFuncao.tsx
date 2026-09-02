import { PageHeader } from "@/components/layout/PageHeader";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";
import { PainelTrocaFuncao } from "@/components/troca-funcao/PainelTrocaFuncao";

export default function TrocaFuncao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Mudança de Função — ASO"
        subtitle="Marque o ASO da mudança de função — ou dispense, quando a função nova não exige exame. Nos dois casos segue para o RH alterar na Senior."
        module="SST"
        breadcrumb={["Mudança de Função — ASO"]}
        actions={<ResumoDeFuncoes fluxo="troca_funcao" />}
      />
      <PainelTrocaFuncao etapa="sst" />
    </div>
  );
}
