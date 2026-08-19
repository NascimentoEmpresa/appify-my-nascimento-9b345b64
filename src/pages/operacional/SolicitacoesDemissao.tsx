import { PageHeader } from "@/components/layout/PageHeader";
import { PainelDemissoes } from "@/components/demissao/PainelDemissoes";

/**
 * Operacional — fila das demissões pedidas pelos encarregados.
 *
 * É aqui que a solicitação vira (ou não) trabalho para o RH: aprovar manda
 * adiante, reprovar devolve com o motivo escrito. O operacional continua
 * enxergando as já decididas, porque a pergunta que mais chega é "e a do
 * fulano, andou?".
 */
export default function OperacionalSolicitacoesDemissao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Solicitações de Demissão"
        subtitle="Aprove ou reprove os pedidos dos encarregados. O que você aprovar segue para o RH concluir."
        module="Operacional"
        breadcrumb={["Solicitações de Demissão"]}
      />
      <PainelDemissoes etapa="operacional" />
    </div>
  );
}
