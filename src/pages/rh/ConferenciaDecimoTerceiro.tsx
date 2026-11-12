import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { PainelConferenciaDecimo } from "@/components/conferencia-decimo/PainelConferenciaDecimo";
import { MENU } from "@/lib/conferenciaDecimo/conferencia";

/**
 * RH › Conferência de 13º (12/11/2026, mig 20261112220000).
 *
 * Clone da Conferência de Ponto sem Operacional nem encarregados: o RH
 * confere, informa ou importa o valor da Senior e libera; o Financeiro paga
 * (a mesma tela em /app/financeiro/conferencia-decimo-terceiro). O que cada um
 * PODE fazer vem das chaves `decimo_confirmar_conferencia`,
 * `decimo_informar_valor` e `decimo_marcar_pago`.
 */
export default function ConferenciaDecimoTerceiro() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Conferência de 13º"
        subtitle="O 13º de cada contrato, por parcela: o RH confere, informa o valor e libera; o Financeiro paga."
        module="Recursos Humanos"
        breadcrumb={["Conferência de 13º"]}
      />
      <AcessoGate menu={MENU.telaRh} acao="visualizar"
                  fallback={<p className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela.</p>}>
        <PainelConferenciaDecimo modulo="rh" />
      </AcessoGate>
    </div>
  );
}
