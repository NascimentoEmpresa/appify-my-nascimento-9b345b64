import { Link } from "react-router-dom";
import { ExternalLink, FileText, Loader2, Siren } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SeloConclusao } from "@/components/sst/FichaAcidente";
import { abrirAnexoAcidente, useAcidentesDoColaborador } from "@/hooks/useAcidentes";
import { ROTULO_TIPO, fmtData } from "@/lib/sst/acidentes";

// =====================================================================
// Aba "Acidentes" da Ficha do Colaborador (SIS-2026-0889). Os acidentes do
// CPF deste cadastro, com a CAT para abrir. Só aparece para quem tem o menu
// Acidentes de Trabalho (sst_acidentes_trabalho): CAT é dado de saúde, e
// ver a ficha não basta para ver a CAT.
// =====================================================================

export function AcidentesDoColaborador({ empregadoId }: { empregadoId: number }) {
  const { data: lista = [], isLoading, error } = useAcidentesDoColaborador(empregadoId, true);
  if (isLoading) {
    return <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</Card>;
  }
  if (error) return <Card className="p-6 text-sm text-destructive">{(error as Error).message}</Card>;
  if (!lista.length) {
    return <Card className="p-6 text-sm text-muted-foreground">Nenhum acidente de trabalho registrado para este colaborador.</Card>;
  }
  return (
    <Card className="divide-y p-0">
      {lista.map((a) => (
        <div key={a.id} className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Siren className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="text-sm font-semibold">Acidente de {fmtData(a.data_acidente)}</span>
            {a.tipo && <Badge variant="outline">{ROTULO_TIPO[a.tipo]}</Badge>}
            <SeloConclusao concluido={a.concluido} />
            <Link to={`/app/sst/acidentes?id=${a.id}`} className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Abrir no controle <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          {a.descricao && <p className="text-sm">{a.descricao}</p>}
          <p className="text-xs text-muted-foreground">
            {[a.contrato_nome,
              a.houve_afastamento ? `Afastamento${a.dias_afastamento != null ? ` de ${a.dias_afastamento} dia(s)` : ""}${a.encaminhado_inss ? " · INSS" : ""}` : "Sem afastamento",
              a.cat_emitida ? `CAT ${a.numero_cat ?? "sem número"}` : a.cat_emitida === false ? "CAT não emitida" : null,
            ].filter(Boolean).join(" · ")}
          </p>
          {a.documentos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {a.documentos.map((d) => (
                <button key={d.id} type="button" onClick={() => abrirAnexoAcidente(d).catch((e) => toast.error((e as Error).message))}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-primary hover:bg-muted">
                  <FileText className="h-3.5 w-3.5" /> {d.categoria === "cat" ? "CAT" : "Anexo"}: {d.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
