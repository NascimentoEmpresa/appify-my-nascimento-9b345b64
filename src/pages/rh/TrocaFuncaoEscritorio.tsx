import { PageHeader } from "@/components/layout/PageHeader";
import { PainelTrocaFuncao } from "@/components/troca-funcao/PainelTrocaFuncao";

/**
 * Aprovação da mudança de função — a porta de entrada de quem tem
 * `escritorio_troca_funcao`.
 *
 * A ROTA mantém o nome antigo de propósito: é ela que carrega a permissão de
 * quem já a tinha, e quem só aprova o administrativo não precisa ganhar o
 * menu do Operacional para chegar aqui. A TELA, porém, é a mesma de
 * /app/operacional/troca-funcao desde 25/08/2026 — contrato x escritório
 * virou filtro, decidido pela permissão de quem abre.
 */
export default function TrocaFuncaoEscritorio() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Mudança de Função"
        subtitle="Aprove as trocas de função. O que você aprovar segue para o SST."
        module="RH"
        breadcrumb={["Mudança de Função"]}
      />
      <PainelTrocaFuncao etapa="aprovacao" />
    </div>
  );
}
