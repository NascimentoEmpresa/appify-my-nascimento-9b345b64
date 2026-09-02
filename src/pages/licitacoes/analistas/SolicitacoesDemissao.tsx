import { PageHeader } from "@/components/layout/PageHeader";
import { PainelDemissoes } from "@/components/demissao/PainelDemissoes";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";

/**
 * Analistas Validações › Solicitações de Demissão — a PRIMEIRA porta.
 *
 * Aprovar manda direto para o SST marcar o ASO demissional; o RH confirma
 * por último. A etapa era do Operacional até 02/09/2026, e a tela dele
 * continua de pé só para acompanhar.
 */
export default function AnalistasSolicitacoesDemissao() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Solicitações de Demissão"
        subtitle="Aprove ou reprove os desligamentos pedidos pelos encarregados. O que você aprovar segue para o SST marcar o ASO demissional."
        module="Licitações"
        breadcrumb={["Analistas Validações", "Solicitações de Demissão"]}
        actions={<ResumoDeFuncoes fluxo="demissao" />}
      />
      <PainelDemissoes etapa="analista" />
    </div>
  );
}
