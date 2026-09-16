import { PageHeader } from "@/components/layout/PageHeader";
import { PainelDemissoes } from "@/components/demissao/PainelDemissoes";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";

/**
 * Diretoria › Solicitações de Demissão (16/09/2026).
 *
 * A MESMA tela do Operacional, na etapa "diretoria": só as demissões do
 * escritório administrativo ou com setor — e, com setor, só as dos setores
 * marcados pra quem abriu em Administração › Acesso por Usuário (a mesma
 * configuração da Mudança de Função). Aprovar manda pro RH, como no
 * Operacional. Menu: diretoria_solicitacoes_demissao.
 */
export default function DiretoriaSolicitacoesDemissao() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Solicitações de Demissão"
        subtitle="Aprove as demissões do administrativo e das que têm setor — só dos setores liberados pra você em Acesso por Usuário. O que você aprovar segue para o RH."
        module="Diretoria"
        breadcrumb={["Solicitações de Demissão"]}
        actions={<ResumoDeFuncoes fluxo="demissao" />}
      />
      <PainelDemissoes etapa="diretoria" />
    </div>
  );
}
