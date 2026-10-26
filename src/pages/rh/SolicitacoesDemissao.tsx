import { PageHeader } from "@/components/layout/PageHeader";
import { PainelDemissoes } from "@/components/demissao/PainelDemissoes";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";

/**
 * RH — a etapa do RH na demissão: confere e libera para o SST.
 *
 * SST e RH trocaram de lugar em 02/09/2026 (ver o cabeçalho de
 * lib/demissao/solicitacao.ts): antes o RH vinha primeiro e o encarregado
 * chegava a ver "Concluída" com o exame ainda por marcar.
 *
 * Uma tela só desde 21/10/2026: a planilha de rescisão, que era a primeira
 * aba daqui (19/10), virou o módulo Rescisões (kanban). Ficou a lista das
 * solicitações, com o status da rescisão de cada uma.
 */
export default function RhSolicitacoesDemissao() {
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        title="Solicitações de Demissão"
        subtitle="As demissões que chegam ao RH: confira e libere para o SST. O controle da rescisão (kanban, datas, malote e documentação) fica em Rescisões."
        module="Recursos Humanos"
        breadcrumb={["Solicitações de Demissão"]}
        actions={<ResumoDeFuncoes fluxo="demissao" />}
      />
      <PainelDemissoes etapa="rh" />
    </div>
  );
}
