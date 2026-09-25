import { PageHeader } from "@/components/layout/PageHeader";
import { PainelAcompanhamento } from "@/components/recrutamento/PainelAcompanhamento";

/**
 * Recrutamento e Seleção › Acompanhar Colaboradores (25/09/2026, mig 245).
 *
 * O check-in da planilha CONTRATOS_VIGENTES do RH, dentro do sistema: todo
 * mundo admitido no período (Senior), por contrato, com os marcos de 7, 30,
 * 60 e 90 dias, permanência e saída. Filtra por data de admissão (padrão:
 * últimos 180 dias). A fila só de quem está na experiência é a tela irmã,
 * Acompanhar Experiência.
 */
export default function AcompanharColaboradores() {
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Acompanhar Colaboradores"
        subtitle="Admitidos no período, por contrato: check-in de 7, 30, 60 e 90 dias, permanência após a experiência e saída."
        module="Recrutamento e Seleção"
        breadcrumb={["Acompanhar Colaboradores"]}
      />
      <PainelAcompanhamento modo="colaboradores" />
    </div>
  );
}
