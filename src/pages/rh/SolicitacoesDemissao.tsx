import { PageHeader } from "@/components/layout/PageHeader";
import { PainelDemissoes } from "@/components/demissao/PainelDemissoes";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";

/**
 * RH — a ÚLTIMA etapa da demissão.
 *
 * Chega aqui o que o analista aprovou e o SST já marcou o ASO demissional.
 * O RH confirma, e é isso que fecha o desligamento.
 *
 * SST e RH trocaram de lugar em 02/09/2026 (ver o cabeçalho de
 * lib/demissao/solicitacao.ts): antes o RH vinha primeiro e o encarregado
 * chegava a ver "Concluída" com o exame ainda por marcar.
 */
export default function RhSolicitacoesDemissao() {
  return (
    // Mais largo que as outras etapas (19/10/2026): a tabela de rescisões
    // tem as ~20 colunas da planilha do RH.
    <div className="mx-auto max-w-[1700px]">
      <PageHeader
        title="Solicitações de Demissão"
        subtitle="O controle das rescisões, no formato da planilha do RH (homologação, datas, tipo, programadas, malote, documentação e status). A fila do fluxo segue na segunda aba."
        module="Recursos Humanos"
        breadcrumb={["Solicitações de Demissão"]}
        actions={<ResumoDeFuncoes fluxo="demissao" />}
      />
      <PainelDemissoes etapa="rh" />
    </div>
  );
}
