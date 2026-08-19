import { PageHeader } from "@/components/layout/PageHeader";
import { PainelDemissoes } from "@/components/demissao/PainelDemissoes";

/**
 * RH — demissões já aprovadas pelo Operacional.
 *
 * Chega tudo pronto (dados do colaborador, motivos, aviso e documentos) e o
 * RH conclui. O que ainda está com o operacional, ou o que ele reprovou, não
 * aparece: para o RH a solicitação só passa a existir depois de aprovada.
 */
export default function RhSolicitacoesDemissao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Solicitações de Demissão"
        subtitle="Pedidos aprovados pelo Operacional, com todos os dados e documentos para concluir o desligamento."
        module="Recursos Humanos"
        breadcrumb={["Solicitações de Demissão"]}
      />
      <PainelDemissoes etapa="rh" />
    </div>
  );
}
