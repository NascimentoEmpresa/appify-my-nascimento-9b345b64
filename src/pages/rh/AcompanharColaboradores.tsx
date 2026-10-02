import { PageHeader } from "@/components/layout/PageHeader";
import { PainelAcompanhamento } from "@/components/recrutamento/PainelAcompanhamento";

/**
 * Recrutamento e Seleção › Acompanhar Colaboradores (25/09/2026, mig 245).
 *
 * O check-in da planilha CONTRATOS_VIGENTES do RH, dentro do sistema: todo
 * mundo admitido no período (Senior), por contrato, com os marcos de 30,
 * 60 e 90 dias, permanência e saída. Filtra por data de admissão (padrão:
 * últimos 90 dias). Desde 02/10/2026 (mig 285) absorveu a antiga Acompanhar
 * Experiência — virou o filtro "Em experiência" da situação.
 */
export default function AcompanharColaboradores() {
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Acompanhar Colaboradores"
        subtitle="Admitidos no período, por contrato: check-in de 30, 60 e 90 dias, permanência após a experiência e saída. Os check-ins atrasados aparecem primeiro."
        module="Recrutamento e Seleção"
        breadcrumb={["Acompanhar Colaboradores"]}
      />
      <PainelAcompanhamento />
    </div>
  );
}
