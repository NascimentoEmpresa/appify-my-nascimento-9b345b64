import { Building2, Crosshair, Layers } from "lucide-react";
import { separarModulos, normalizarLista } from "@/lib/chamados/impactoSistemico";
import { moduloLabel } from "../types";
import { rotuloModuloImpactado } from "../impactados";
import { cn } from "@/lib/utils";

// =====================================================================
// IMPACTO SISTÊMICO — leitura no detalhe do chamado (SIS-2026-0910).
// Mostra separados o módulo DIRETAMENTE AJUSTADO (posição, modulo_sistema)
// e os DEMAIS módulos impactados, mais os setores. Chamado aberto antes do
// formulário (sem impacto informado) mostra só a posição e "não informado".
// =====================================================================

export interface ImpactoSistemicoResumoProps {
  chamado: {
    modulo_sistema: string | null;
    modulo_sistema_outro: string | null;
    modulos_impactados?: string[] | null;
    setores_impactados?: string[] | null;
  };
  className?: string;
}

const Pilula = ({ children, destaque }: { children: React.ReactNode; destaque?: boolean }) => (
  <span className={cn(
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
    destaque ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-muted/50 text-foreground",
  )}>{children}</span>
);

const NaoInformado = () => <span className="text-xs text-muted-foreground">Não informado</span>;

export function ImpactoSistemicoResumo({ chamado, className }: ImpactoSistemicoResumoProps) {
  const { demais } = separarModulos(chamado.modulos_impactados, chamado.modulo_sistema);
  const setores = normalizarLista(chamado.setores_impactados);
  return (
    <div className={cn("space-y-2.5 rounded-lg border border-border p-3", className)}>
      <p className="text-xs font-bold text-foreground">Impacto sistêmico</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Crosshair className="h-3 w-3" /> Módulo diretamente ajustado
          </p>
          {chamado.modulo_sistema ? <Pilula destaque>{moduloLabel(chamado)}</Pilula> : <NaoInformado />}
        </div>
        <div>
          <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Layers className="h-3 w-3" /> Demais módulos impactados
          </p>
          {demais.length
            ? <div className="flex flex-wrap gap-1">{demais.map((m) => <Pilula key={m}>{rotuloModuloImpactado(m)}</Pilula>)}</div>
            : normalizarLista(chamado.modulos_impactados).length
              ? <span className="text-xs text-muted-foreground">Só o módulo ajustado</span>
              : <NaoInformado />}
        </div>
        <div>
          <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Building2 className="h-3 w-3" /> Setores impactados
          </p>
          {setores.length
            ? <div className="flex flex-wrap gap-1">{setores.map((s) => <Pilula key={s}>{s}</Pilula>)}</div>
            : <NaoInformado />}
        </div>
      </div>
    </div>
  );
}
