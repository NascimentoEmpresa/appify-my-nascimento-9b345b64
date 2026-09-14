import { PageHeader } from "@/components/layout/PageHeader";
import { PainelDemissoes } from "@/components/demissao/PainelDemissoes";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";

/**
 * Analistas Validações › Solicitações de Demissão — ACOMPANHAMENTO.
 *
 * A decisão foi do analista entre 02/09 e 14/09/2026; desde então voltou
 * para o Operacional (Operacional › Solicitações de Demissão). A tela ficou
 * porque a pergunta "e a do fulano, andou?" continua chegando aqui — a
 * etapa "analista" do PainelDemissoes não tem status de ação, então o card
 * abre em leitura.
 */
export default function AnalistasSolicitacoesDemissao() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Solicitações de Demissão"
        subtitle="Acompanhe os pedidos dos encarregados do começo ao fim. Quem aprova é o Operacional, em Operacional › Solicitações de Demissão."
        module="Licitações"
        breadcrumb={["Analistas Validações", "Solicitações de Demissão"]}
        actions={<ResumoDeFuncoes fluxo="demissao" />}
      />
      <PainelDemissoes etapa="analista" />
    </div>
  );
}
