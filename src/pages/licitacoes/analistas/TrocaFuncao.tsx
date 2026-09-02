import { PageHeader } from "@/components/layout/PageHeader";
import { PainelTrocaFuncao } from "@/components/troca-funcao/PainelTrocaFuncao";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";

/**
 * Analistas Validações › Mudança de Função — a PRIMEIRA porta do fluxo.
 *
 * O analista vê as duas origens (contrato e escritório): a validação do
 * administrativo saiu do RH em 02/09/2026 e veio para cá junto com a de
 * contrato. Validar aqui manda para a aprovação do Operacional; só depois
 * vai para o SST e, por último, para o RH alterar na Senior.
 */
export default function AnalistasTrocaFuncao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Mudança de Função"
        subtitle="Valide as trocas de função pedidas pelos encarregados. O que você validar segue para a aprovação do Operacional."
        module="Licitações"
        breadcrumb={["Analistas Validações", "Mudança de Função"]}
        actions={<ResumoDeFuncoes fluxo="troca_funcao" />}
      />
      <PainelTrocaFuncao etapa="analista" />
    </div>
  );
}
