import { PageHeader } from "@/components/layout/PageHeader";
import { PainelDemissoes } from "@/components/demissao/PainelDemissoes";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";

/**
 * Operacional › Solicitações de Demissão — a PRIMEIRA porta.
 *
 * Aprovar manda para o RH liberar; o SST agenda o ASO por último. A decisão
 * saiu daqui em 02/09/2026 (foi para o analista) e VOLTOU em 14/09/2026 —
 * os analistas ficaram com a tela só para acompanhar.
 */
export default function OperacionalSolicitacoesDemissao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Solicitações de Demissão"
        subtitle="Aprove ou reprove os desligamentos pedidos pelos encarregados. O que você aprovar segue para o RH liberar e o SST agendar o ASO demissional."
        module="Operacional"
        breadcrumb={["Solicitações de Demissão"]}
        actions={<ResumoDeFuncoes fluxo="demissao" />}
      />
      <PainelDemissoes etapa="operacional" />
    </div>
  );
}
