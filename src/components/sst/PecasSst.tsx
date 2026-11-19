import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Peças comuns das telas de base do SST (SIS-2026-0816): o cartão de
// indicador clicável e a caixa de aviso das importações — as mesmas das
// telas de Acidentes (SIS-2026-0889).

export function Indicador({ valor, titulo, destaque, ativo, onClick, ajuda }: {
  valor: number | string; titulo: string; destaque?: "aviso" | "erro"; ativo?: boolean; onClick?: () => void; ajuda?: string;
}) {
  const classe = cn("rounded-lg border bg-card p-3 text-left",
    destaque === "aviso" && "border-amber-300 bg-amber-50", destaque === "erro" && "border-red-300 bg-red-50",
    ativo && "border-primary ring-2 ring-primary/30", onClick && "transition hover:border-primary");
  const corpo = (
    <>
      <span className="block text-2xl font-bold tabular-nums">{typeof valor === "number" ? valor.toLocaleString("pt-BR") : valor}</span>
      <span className="block text-xs text-muted-foreground">{titulo}</span>
    </>
  );
  return onClick
    ? <button type="button" aria-pressed={ativo} className={classe} onClick={onClick} title={ajuda}>{corpo}</button>
    : <div className={classe} title={ajuda}>{corpo}</div>;
}

const TONS = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
  info: "border-sky-300 bg-sky-50 text-sky-900",
  aviso: "border-amber-300 bg-amber-50 text-amber-900",
  erro: "border-red-300 bg-red-50 text-red-900",
};
export const Caixa = ({ tom, icone, children }: { tom: keyof typeof TONS; icone: ReactNode; children: ReactNode }) => (
  <div className={`flex gap-2 rounded-lg border p-3 text-sm ${TONS[tom]}`}>{icone}<div className="min-w-0">{children}</div></div>
);
