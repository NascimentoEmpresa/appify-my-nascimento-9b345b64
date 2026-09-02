import { PageHeader } from "@/components/layout/PageHeader";
import { PainelDemissoes } from "@/components/demissao/PainelDemissoes";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";

/**
 * Operacional — ACOMPANHAMENTO das demissões pedidas pelos encarregados.
 *
 * A decisão saiu daqui em 02/09/2026: quem aprova é o analista, em
 * Licitações › Analistas Validações. O Operacional não perdeu a tela porque a
 * pergunta que mais chega continua sendo dele — "e a do fulano, andou?". O
 * que ele perdeu foi o botão: a etapa "operacional" do PainelDemissoes não
 * tem status de ação, então o card abre em leitura.
 */
export default function OperacionalSolicitacoesDemissao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Solicitações de Demissão"
        subtitle="Acompanhe os pedidos dos encarregados do começo ao fim. Quem aprova é o analista, em Licitações › Analistas Validações."
        module="Operacional"
        breadcrumb={["Solicitações de Demissão"]}
        actions={<ResumoDeFuncoes fluxo="demissao" />}
      />
      <PainelDemissoes etapa="operacional" />
    </div>
  );
}
