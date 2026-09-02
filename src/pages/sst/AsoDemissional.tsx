import { PageHeader } from "@/components/layout/PageHeader";
import { PainelDemissoes } from "@/components/demissao/PainelDemissoes";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";

/**
 * SST — ASO demissional.
 *
 * Chega aqui o que o ANALISTA aprovou; o SST marca data, hora e local do
 * exame — os MESMOS campos do ASO de admissão — e manda para o RH confirmar.
 *
 * Deixou de ser a última etapa em 02/09/2026: SST e RH trocaram de lugar, e
 * quem fecha a demissão passou a ser o RH.
 *
 * A tela é a mesma do analista, do Operacional e do RH, recortada na etapa
 * "sst" (ver PainelDemissoes).
 */
export default function AsoDemissional() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="ASO Demissional"
        subtitle="Marque data, hora e local do exame demissional. Depois de marcado, a solicitação segue para o RH confirmar o desligamento."
        module="SST"
        breadcrumb={["ASO Demissional"]}
        actions={<ResumoDeFuncoes fluxo="demissao" />}
      />
      <PainelDemissoes etapa="sst" />
    </div>
  );
}
