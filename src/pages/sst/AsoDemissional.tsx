import { PageHeader } from "@/components/layout/PageHeader";
import { PainelDemissoes } from "@/components/demissao/PainelDemissoes";

/**
 * SST — ASO demissional.
 *
 * A última etapa da demissão. Chega aqui o que o RH já tratou; o SST marca
 * data, hora e local do exame — os MESMOS campos do ASO de admissão — e é
 * isso que conclui o desligamento.
 *
 * A tela é a mesma do Operacional e do RH, recortada na etapa "sst" (ver
 * PainelDemissoes): o SST enxerga só o que já passou pelo RH.
 */
export default function AsoDemissional() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="ASO Demissional"
        subtitle="Marque data, hora e local do exame demissional. Marcar o ASO conclui a demissão e o encarregado passa a ver as informações."
        module="SST"
        breadcrumb={["ASO Demissional"]}
      />
      <PainelDemissoes etapa="sst" />
    </div>
  );
}
