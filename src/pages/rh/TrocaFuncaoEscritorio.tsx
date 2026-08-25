import { PageHeader } from "@/components/layout/PageHeader";
import { PainelTrocaFuncao } from "@/components/troca-funcao/PainelTrocaFuncao";

export default function TrocaFuncaoEscritorio() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Mudança de Função — Escritório"
        subtitle="Aprovação das trocas de função do pessoal do escritório. O que você aprovar segue para o SST marcar o ASO."
        module="RH"
        breadcrumb={["Mudança de Função — Escritório"]}
      />
      <PainelTrocaFuncao etapa="escritorio" />
    </div>
  );
}
