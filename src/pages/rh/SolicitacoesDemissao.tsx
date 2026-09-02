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
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Solicitações de Demissão"
        subtitle="Pedidos aprovados pelo analista e com o ASO demissional já marcado pelo SST. Confirme para concluir o desligamento."
        module="Recursos Humanos"
        breadcrumb={["Solicitações de Demissão"]}
        actions={<ResumoDeFuncoes fluxo="demissao" />}
      />
      <PainelDemissoes etapa="rh" />
    </div>
  );
}
