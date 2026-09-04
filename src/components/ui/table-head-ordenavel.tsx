import { ArrowDown, ArrowUp } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { OrdenacaoTabela } from "@/hooks/useOrdenacaoTabela";

// SIS-2026-0316 (Iury): "podia ser uma setinha indicando qual coluna está
// ativa como filtro, tipo que temos no gerenciador de arquivos do
// Windows" — seta só aparece na coluna ativa (não uma versão apagada nas
// outras), igual ao Explorer.
export function TableHeadOrdenavel<C extends string>({
  coluna,
  ordenacao,
  className,
  children,
}: {
  coluna: C;
  ordenacao: OrdenacaoTabela<C>;
  className?: string;
  children: React.ReactNode;
}) {
  const ativa = ordenacao.coluna === coluna;
  return (
    <TableHead
      className={cn("cursor-pointer select-none hover:text-foreground", className)}
      onClick={() => ordenacao.alternar(coluna)}
      aria-sort={ativa ? (ordenacao.direcao === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {ativa && (ordenacao.direcao === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />)}
      </span>
    </TableHead>
  );
}
