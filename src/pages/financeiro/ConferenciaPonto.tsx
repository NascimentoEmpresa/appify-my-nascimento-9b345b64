import { PageHeader } from "@/components/layout/PageHeader";
import { PainelConferenciaPonto } from "@/components/conferencia-ponto/PainelConferenciaPonto";

/**
 * Financeiro › Conferência de Ponto — a MESMA tela de /app/rh/conferencia-ponto.
 *
 * A ponta final do fluxo: chega aqui o que o RH liberou, com o valor da
 * folha já informado. Quem entra por esta porta tem o menu
 * `financeiro_conferencia_ponto`; marcar como pago continua dependendo de
 * `ponto_marcar_pago`, que é chave à parte.
 */
export default function FinanceiroConferenciaPonto() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Conferência de Ponto"
        subtitle="Folhas liberadas pelo RH, com valor informado, esperando pagamento."
        module="Financeiro"
        breadcrumb={["Conferência de Ponto"]}
      />
      <PainelConferenciaPonto modulo="financeiro" />
    </div>
  );
}
