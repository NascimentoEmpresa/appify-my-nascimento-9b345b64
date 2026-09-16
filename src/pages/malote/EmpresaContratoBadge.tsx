import { cn } from "@/lib/utils";

// Extraído de Aprovacoes.tsx (SIS-2026-0382) — reaproveitado por
// PagamentoMalote.tsx pra manter a mesma resolução visual de
// Empresa/Contrato (contrato em negrito, empresa embaixo em uppercase),
// com cor determinística por empresa_id.

const EMPRESA_BADGE_PALETTE = [
  "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-400",
  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400",
  "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-400",
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400",
  "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400",
  "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-400",
  "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-400",
  "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-400",
];

function hashEmpresaId(empresaId: string): number {
  let hash = 0;
  for (let i = 0; i < empresaId.length; i++) hash = (hash * 31 + empresaId.charCodeAt(i)) >>> 0;
  return hash;
}

export function corEmpresa(empresaId: string | null | undefined): string {
  if (!empresaId) return "border-border bg-muted/40 text-muted-foreground";
  return EMPRESA_BADGE_PALETTE[hashEmpresaId(empresaId) % EMPRESA_BADGE_PALETTE.length];
}

// Mesmo hash/índice da paleta de badge acima, só que como um "wash" de fundo
// bem sutil — pra pintar telas/modais inteiros (ex. FormDrawer da Planilha de
// Custo) sem competir com o conteúdo. Mantém a mesma cor por empresa em toda
// a UI (badge e fundo sempre caem no mesmo índice da paleta).
const EMPRESA_FUNDO_PALETTE = [
  "bg-sky-50/60 dark:bg-sky-950/10",
  "bg-emerald-50/60 dark:bg-emerald-950/10",
  "bg-violet-50/60 dark:bg-violet-950/10",
  "bg-amber-50/60 dark:bg-amber-950/10",
  "bg-rose-50/60 dark:bg-rose-950/10",
  "bg-teal-50/60 dark:bg-teal-950/10",
  "bg-indigo-50/60 dark:bg-indigo-950/10",
  "bg-orange-50/60 dark:bg-orange-950/10",
];

export function corEmpresaFundo(empresaId: string | null | undefined): string {
  if (!empresaId) return "";
  return EMPRESA_FUNDO_PALETTE[hashEmpresaId(empresaId) % EMPRESA_FUNDO_PALETTE.length];
}

// Contratos "ADMINISTRATIVO - <sigla da empresa>" são um tipo genérico
// repetido por empresa — a sigla já é redundante com o nome da empresa
// exibido embaixo no badge, então resume pra só "ADM".
function nomeContratoResumido(nomeContrato: string): string {
  return /^administrativo\b/i.test(nomeContrato) ? "ADM" : nomeContrato;
}

export function EmpresaContratoBadge({
  nomeEmpresa,
  nomeContrato,
  empresaId,
}: {
  nomeEmpresa?: string;
  nomeContrato?: string;
  empresaId?: string | null;
}) {
  if (!nomeEmpresa && !nomeContrato) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div
      className={cn(
        "inline-flex max-w-[100px] flex-col items-center gap-0.5 rounded-md border px-2 py-1 text-center leading-none",
        corEmpresa(empresaId)
      )}
    >
      {nomeContrato ? (
        <>
          <span className="text-xs font-bold leading-tight">{nomeContratoResumido(nomeContrato)}</span>
          {nomeEmpresa && (
            <span className="text-[9px] font-medium uppercase leading-tight tracking-wide opacity-70">{nomeEmpresa}</span>
          )}
        </>
      ) : (
        <span className="text-xs font-bold leading-tight">{nomeEmpresa}</span>
      )}
    </div>
  );
}
