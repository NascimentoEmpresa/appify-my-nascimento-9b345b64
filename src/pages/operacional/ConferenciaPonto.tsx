import { PageHeader } from "@/components/layout/PageHeader";
import { PainelConferenciaPonto } from "@/components/conferencia-ponto/PainelConferenciaPonto";

/**
 * Operacional › Conferência de Ponto — a MESMA tela de /app/rh/conferencia-ponto.
 *
 * Três portas para um sistema só (RH, Operacional, Financeiro), porque o
 * fluxo atravessa os três setores e ninguém deveria trocar de módulo para
 * ver o próprio trabalho. Quem entra por aqui tem o menu
 * `operacional_conferencia_ponto`; o que ele PODE FAZER continua saindo das
 * quatro chaves de ação, não da porta pela qual entrou.
 */
export default function OperacionalConferenciaPonto() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Conferência de Ponto"
        subtitle="Confira o ponto dos seus contratos e aprove — o que você aprovar segue para o RH confirmar."
        module="Operacional"
        breadcrumb={["Conferência de Ponto"]}
      />
      <PainelConferenciaPonto modulo="operacional" />
    </div>
  );
}
