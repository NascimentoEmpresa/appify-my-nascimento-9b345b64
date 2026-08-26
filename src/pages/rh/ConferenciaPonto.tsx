import { PageHeader } from "@/components/layout/PageHeader";
import { PainelConferenciaPonto } from "@/components/conferencia-ponto/PainelConferenciaPonto";

/**
 * RH › Conferência de Ponto.
 *
 * A mesma tela para os três setores — o que muda é o que cada um PODE fazer,
 * e isso vem das quatro chaves do Acesso por Usuário
 * (`ponto_aprovar_contrato`, `ponto_confirmar_aprovacao`,
 * `ponto_informar_valor`, `ponto_marcar_pago`). Quem só acompanha entra aqui
 * e vê a fila sem botão nenhum.
 */
export default function ConferenciaPonto() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Conferência de Ponto"
        subtitle="O fechamento do ponto de cada contrato, mês a mês: o Operacional aprova, o RH confirma e informa o valor, o Financeiro paga."
        module="Recursos Humanos"
        breadcrumb={["Conferência de Ponto"]}
      />
      <PainelConferenciaPonto modulo="rh" />
    </div>
  );
}
