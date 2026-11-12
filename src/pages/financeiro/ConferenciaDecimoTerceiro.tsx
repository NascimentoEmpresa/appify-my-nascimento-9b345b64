import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { PainelConferenciaDecimo } from "@/components/conferencia-decimo/PainelConferenciaDecimo";
import { MENU } from "@/lib/conferenciaDecimo/conferencia";

/**
 * Financeiro › Conferência de 13º — a MESMA tela de
 * /app/rh/conferencia-decimo-terceiro. Chega aqui o que o RH liberou, com o
 * valor; pagar, devolver ao RH e marcar problema dependem de
 * `decimo_marcar_pago`.
 */
export default function FinanceiroConferenciaDecimoTerceiro() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Conferência de 13º"
        subtitle="13º liberado pelo RH, com valor informado, esperando pagamento."
        module="Financeiro"
        breadcrumb={["Conferência de 13º"]}
      />
      <AcessoGate menu={MENU.telaFinanceiro} acao="visualizar"
                  fallback={<p className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela.</p>}>
        <PainelConferenciaDecimo modulo="financeiro" />
      </AcessoGate>
    </div>
  );
}
