import { PageHeader } from "@/components/layout/PageHeader";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";
import { PainelTrocaFuncao } from "@/components/troca-funcao/PainelTrocaFuncao";

/**
 * Operacional — fila de aprovação da mudança de função.
 *
 * A mesma tela de /app/rh/troca-funcao-escritorio: contrato e escritório
 * deixaram de ser telas separadas e viraram um filtro. Cada um enxerga a
 * origem que sua permissão libera — aqui, quem tem `operacional_troca_funcao`
 * vê as de contrato; se a pessoa também tiver `escritorio_troca_funcao`, o
 * seletor de origem aparece e ela passa a ver as duas.
 */
export default function TrocaFuncao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Mudança de Função"
        subtitle="Aprove as trocas de função pedidas pelos encarregados. O que você aprovar segue para o SST."
        module="Operacional"
        breadcrumb={["Mudança de Função"]}
        actions={<ResumoDeFuncoes fluxo="troca_funcao" />}
      />
      <PainelTrocaFuncao etapa="aprovacao" />
    </div>
  );
}
