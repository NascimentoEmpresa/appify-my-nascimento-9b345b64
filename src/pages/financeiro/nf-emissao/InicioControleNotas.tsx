import { Link } from "react-router-dom";
import { ArrowRight, ClipboardCheck, FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { etapasControleNotas } from "./navegacao";

export default function InicioControleNotas() {
  const { data: acesso, isLoading } = useAccessibleMenus();
  const etapas = etapasControleNotas(acesso);
  return <div className="space-y-6 p-6">
    <PageHeader title="Controle de Notas" module="Financeiro" breadcrumb={["Controle de Notas"]}
      subtitle="Escolha a preparação ou a validação das notas fiscais." />
    {isLoading && <p role="status" className="text-sm text-muted-foreground">Carregando suas opções de acesso...</p>}
    <div className="grid gap-4 md:grid-cols-2">
      {etapas.map(etapa => {
        const Icone = etapa.rota.endsWith("/cadastro") ? FileText : ClipboardCheck;
        return <Link key={etapa.rota} to={etapa.rota} aria-label={etapa.titulo}
          className="rounded-xl border bg-card p-5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="mb-3 flex items-center gap-3"><Icone className="h-6 w-6 text-primary" /><h2 className="text-lg font-semibold">{etapa.titulo}</h2><ArrowRight className="ml-auto h-5 w-5" /></div>
          <p className="text-sm text-muted-foreground">{etapa.descricao}</p>
        </Link>;
      })}
    </div>
    {!isLoading && !etapas.length && <p role="status" className="text-sm text-muted-foreground">Seu acesso ainda não inclui as etapas de Emissão de NF ou Validação de Notas. Solicite a liberação no Gerenciamento de Acesso.</p>}
  </div>;
}
