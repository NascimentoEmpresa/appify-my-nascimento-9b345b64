import { PageHeader } from "@/components/layout/PageHeader";
import { PainelAcompanhamento } from "@/components/recrutamento/PainelAcompanhamento";

/**
 * Recrutamento e Seleção › Acompanhar Experiência (25/09/2026, mig 245).
 *
 * Só quem AINDA ESTÁ NO CONTRATO e tem até 90 dias de admissão — a fila de
 * check-ins do período de experiência, com o que está vencendo primeiro.
 */
export default function AcompanharExperiencia() {
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Acompanhar Experiência"
        subtitle="Quem está no contrato há até 90 dias. Registre o check-in de 7, 30, 60 e 90 dias — os atrasados aparecem primeiro."
        module="Recrutamento e Seleção"
        breadcrumb={["Acompanhar Experiência"]}
      />
      <PainelAcompanhamento modo="experiencia" />
    </div>
  );
}
