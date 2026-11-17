import { Link } from "react-router-dom";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { abrirRelatorio, useIncidentes } from "@/hooks/useIncidentes";
import { dataBr, STATUS_INCIDENTE } from "@/lib/sst/incidentes";

export function IncidentesDoColaborador({ empregadoId }: { empregadoId: number }) {
  const { data: lista = [], isLoading, error } = useIncidentes(empregadoId);
  if (isLoading) return <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando incidentes…</Card>;
  if (error) return <Card className="p-6 text-sm text-destructive">{(error as Error).message}</Card>;
  return <div className="space-y-3">
    <div className="flex justify-end"><Button variant="outline" size="sm" asChild><Link to="/app/sst/incidentes">Abrir controle de incidentes</Link></Button></div>
    {!lista.length ? <Card className="p-6 text-sm text-muted-foreground">Nenhum incidente registrado para este colaborador.</Card>
      : <Card className="divide-y">{lista.map((i) => <div key={i.id} className="space-y-2 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2"><strong>Incidente de {dataBr(i.data_incidente)}</strong>
          <Badge variant="outline">{STATUS_INCIDENTE[i.status]}</Badge>
          <Link className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline" to={`/app/sst/incidentes?id=${i.id}`}>
            Abrir registro <ExternalLink className="h-3 w-3" /></Link></div>
        <p className="text-muted-foreground">{[i.contrato_nome, i.encarregado && `Encarregado: ${i.encarregado}`,
          i.numero_relatorio && `Relatório nº ${i.numero_relatorio}`,
          i.dias_afastamento && `${i.dias_afastamento} dia(s) de afastamento`].filter(Boolean).join(" · ")}</p>
        {i.observacoes && <p>{i.observacoes}</p>}
        {i.arquivo_path && <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline"
          onClick={() => abrirRelatorio(i).catch((e) => toast.error((e as Error).message))}>
          <FileText className="h-4 w-4" /> Relatório assinado: {i.arquivo_nome}</button>}
      </div>)}</Card>}
  </div>;
}
