import { PageHeader } from "@/components/layout/PageHeader";
import { PainelTrocaFuncao } from "@/components/troca-funcao/PainelTrocaFuncao";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";

/**
 * Analistas Validações › Mudança de Função — ACOMPANHAMENTO.
 *
 * Entre 02/09 e 16/09/2026 o analista validava tudo antes da aprovação. A
 * pedido do Pablo (16/09/2026) a validação saiu: a solicitação nasce direto
 * na fila de quem decide, e aqui só se acompanha a troca de CONTRATO SIMPLES
 * (sem setor). Nada do administrativo ou com setor aparece nesta tela — isso
 * é da Diretoria › Mudança de Função.
 */
export default function AnalistasTrocaFuncao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Mudança de Função"
        subtitle="Acompanhe as trocas de função dos contratos. Quem aprova é o Operacional; as do administrativo ou com setor vão para a Diretoria."
        module="Licitações"
        breadcrumb={["Analistas Validações", "Mudança de Função"]}
        actions={<ResumoDeFuncoes fluxo="troca_funcao" />}
      />
      <PainelTrocaFuncao etapa="analista" />
    </div>
  );
}
