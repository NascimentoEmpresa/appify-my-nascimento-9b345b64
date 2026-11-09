import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtBRL } from "@/lib/conciliacaoBancariaEngine";
import type { LinhaConferenciaConta } from "@/lib/conciliacaoDashboard";

// SIS-2026-0833: Fluxo × extrato por banco, conta e mês (Dashboard de Conciliações e modal da Auditoria). Linha vermelha = não bate; amarela = banco/mês
// com lançamento no Fluxo e sem conciliação salva.
const traco = "—";
const mesParaBR = (mes: string) => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;

export function TabelaConferenciaPorConta({
  linhas, bancoNome, empresaNome, rotuloConta, onVerDetalhes, altura = 380,
}: {
  linhas: LinhaConferenciaConta[];
  bancoNome: (id: string | null) => string;
  empresaNome: (id: string) => string;
  rotuloConta: (id: string) => string | undefined;
  onVerDetalhes: (conciliacaoId: string) => void;
  altura?: number;
}) {
  const [soComDiferenca, setSoComDiferenca] = useState(true);
  const visiveis = useMemo(
    () => linhas.filter((r) => !soComDiferenca || !r.conciliacaoId || Math.abs(r.difE ?? 0) >= 0.005 || Math.abs(r.difS ?? 0) >= 0.005 || r.extratoE == null),
    [linhas, soComDiferenca],
  );
  const vermelho = (d: number | null) => d != null && Math.abs(d) >= 0.005;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold">Por banco, conta e mês ({visiveis.length} de {linhas.length})</h4>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={soComDiferenca} onChange={(e) => setSoComDiferenca(e.target.checked)} />
          Só o que não bate ou não tem conciliação
        </label>
      </div>
      <div className="overflow-y-auto rounded-md border" style={{ maxHeight: altura }}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="border-b">
              <th className="px-3 py-2 text-left">Banco / conta</th>
              <th className="px-3 py-2 text-left">Empresa</th>
              <th className="px-3 py-2 text-left">Mês</th>
              <th className="px-3 py-2 text-right">Fluxo entradas</th>
              <th className="px-3 py-2 text-right">Extrato entradas</th>
              <th className="px-3 py-2 text-right">Dif. entradas</th>
              <th className="px-3 py-2 text-right">Fluxo saídas</th>
              <th className="px-3 py-2 text-right">Extrato saídas</th>
              <th className="px-3 py-2 text-right">Dif. saídas</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Nada fora do lugar neste filtro.</td></tr>}
            {visiveis.map((r) => (
              <tr key={r.chave} className={cn("border-b", !r.conciliacaoId && "bg-yellow-50/60 dark:bg-yellow-950/10")}>
                <td className="px-3 py-1.5">
                  <div className="font-medium">{bancoNome(r.bancoId)}</div>
                  {r.contaBancoId ? <div className="text-muted-foreground">{rotuloConta(r.contaBancoId) ?? "conta do banco"}</div> : r.contaExtrato ? <div className="text-muted-foreground">{r.contaExtrato}</div> : null}
                </td>
                <td className="px-3 py-1.5">{r.empresaIds.length === 0 ? "Todas" : r.empresaIds.map(empresaNome).join(", ")}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{mesParaBR(r.mes)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtBRL(r.fluxoE)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.extratoE == null ? traco : fmtBRL(r.extratoE)}</td>
                <td className={cn("px-3 py-1.5 text-right tabular-nums", vermelho(r.difE) && "font-semibold text-red-600")}>{r.difE == null ? traco : fmtBRL(r.difE)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtBRL(r.fluxoS)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.extratoS == null ? traco : fmtBRL(r.extratoS)}</td>
                <td className={cn("px-3 py-1.5 text-right tabular-nums", vermelho(r.difS) && "font-semibold text-red-600")}>{r.difS == null ? traco : fmtBRL(r.difS)}</td>
                <td className="px-3 py-1.5 text-right">
                  {r.conciliacaoId
                    ? <Button size="sm" variant="ghost" className="h-7" onClick={() => onVerDetalhes(r.conciliacaoId!)}>Ver detalhes</Button>
                    : <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100">Sem conciliação</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
