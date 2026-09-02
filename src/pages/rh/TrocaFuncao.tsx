import { PageHeader } from "@/components/layout/PageHeader";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";
import { PainelTrocaFuncao } from "@/components/troca-funcao/PainelTrocaFuncao";

export default function TrocaFuncao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Mudança de Função"
        subtitle="Faça a alteração do cargo na Senior e conclua a solicitação. Chega aqui o que o SST já liberou — com ASO marcado ou dispensado."
        module="RH"
        breadcrumb={["Mudança de Função"]}
        actions={<ResumoDeFuncoes fluxo="troca_funcao" />}
      />
      <PainelTrocaFuncao etapa="rh" />
    </div>
  );
}
