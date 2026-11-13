// =====================================================================
// OPERACIONAL › ATIVOS/CONTRATOS — Saneamento de postos (Senior × ERP)
// 13/11/2026, mig 20261115200000.
//
// PEDIDO (chamado da Operação): os postos da Senior foram cadastrados fora
// do padrão e não batem com os do ERP; tem gente ativa "sem vínculo de
// posto"; e a base precisa estar saneada antes de trocar de sistema de
// folha. Este relatório é a lista de trabalho: cada posto da Senior em uso,
// o posto do ERP (Planilha de Custo — a fonte da verdade) a que está ligado,
// e o que falta fazer. A planilha exportada é o de-para para corrigir a
// Senior — e a carga dos postos para a folha nova (aba "Postos do ERP").
//
// Só leitura: ligar posto e mover pessoa continua na própria tela.
// =====================================================================
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Search, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSaneamentoPostos } from "@/hooks/useAtivosContratos";
import {
  ACAO_STATUS, ORDEM_STATUS, ROTULO_STATUS, classificarSaneamento, erpParaExcel, linhasParaExcel, normNome,
  resumirSaneamento, type StatusSaneamento,
} from "@/lib/rh/saneamentoPostos";
import { limparPostoSenior } from "./conferenciaAtivos";

const COR: Record<StatusSaneamento, string> = {
  padronizado: "border-success/30 bg-success/10 text-success",
  nome_diferente: "border-warning/30 bg-warning/10 text-warning",
  varios_erp: "border-warning/30 bg-warning/10 text-warning",
  parcial: "border-destructive/30 bg-destructive/10 text-destructive",
  sem_equivalente: "border-destructive/30 bg-destructive/10 text-destructive",
  sem_posto_senior: "border-destructive/30 bg-destructive/10 text-destructive",
  fora_da_conta: "border-border bg-muted text-muted-foreground",
};

/** Quantas linhas a tela desenha de uma vez (a planilha leva todas). */
const LIMITE_TELA = 300;

export function DialogSaneamentoPostos({ aberto, onClose }: { aberto: boolean; onClose: () => void }) {
  const { data, isLoading, error } = useSaneamentoPostos(aberto);
  const [filtro, setFiltro] = useState<StatusSaneamento | "todos">("todos");
  const [busca, setBusca] = useState("");
  const [exportando, setExportando] = useState(false);

  const linhas = useMemo(() => (data ? classificarSaneamento(data) : []), [data]);
  const resumo = useMemo(() => resumirSaneamento(linhas, data?.erp ?? []), [linhas, data]);

  const visiveis = useMemo(() => {
    const q = normNome(busca);
    return linhas.filter((l) =>
      (filtro === "todos" || l.status === filtro)
      && (!q || normNome(l.contrato).includes(q) || normNome(l.posto_senior).includes(q)
          || normNome(l.codigo).includes(q) || l.postos_erp.some((p) => normNome(p).includes(q))));
  }, [linhas, filtro, busca]);

  const exportar = async () => {
    if (!data) return;
    setExportando(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasParaExcel(linhas)), "Senior x ERP");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(erpParaExcel(data.erp)), "Postos do ERP");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ["SANEAMENTO DE POSTOS — SENIOR × ERP", `gerado em ${new Date(data.gerado_em).toLocaleString("pt-BR")}`],
        [],
        ["Pessoas ativas sem vínculo de posto", resumo.pessoasSemVinculo],
        ["Postos da Senior em uso (contrato × posto)", resumo.postosSenior],
        ["Padronizados", `${resumo.pctPadronizado}%`],
        ["Postos do ERP implantados sem ninguém ligado", resumo.erpSemNinguem],
        [],
        ["SITUAÇÃO", "POSTOS", "PESSOAS", "O QUE FAZER"],
        ...ORDEM_STATUS.map((s) => [ROTULO_STATUS[s], resumo.porStatus[s].postos, resumo.porStatus[s].pessoas, ACAO_STATUS[s]]),
      ]), "Resumo");
      XLSX.writeFile(wb, `saneamento-postos-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      toast.error(`Não deu para exportar: ${(e as Error).message}`);
    } finally {
      setExportando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle>Saneamento de postos — Senior × ERP</DialogTitle>
          <DialogDescription>
            Cada posto da Senior em uso, por contrato, e o posto do ERP (Planilha de Custo) a que está ligado. O ERP é a referência:
            o que estiver diferente deve ser corrigido na Senior — e é esta lista que vai para a folha nova.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-4 w-4 text-warning" /> {(error as Error).message}
          </p>
        ) : isLoading || !data ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-4">
              <Numero valor={resumo.pessoasSemVinculo} rotulo="pessoas ativas sem vínculo de posto" tom={resumo.pessoasSemVinculo ? "text-destructive" : "text-success"} />
              <Numero valor={`${resumo.pctPadronizado}%`} rotulo="dos postos da Senior já padronizados" tom="text-success" />
              <Numero valor={resumo.porStatus.nome_diferente.postos + resumo.porStatus.varios_erp.postos} rotulo="postos a corrigir na Senior (nome ou estrutura)" tom="text-warning" />
              <Numero valor={resumo.erpSemNinguem} rotulo="postos do ERP implantados sem ninguém ligado" tom="text-muted-foreground" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="h-9 pl-8 text-sm" placeholder="Contrato, posto ou código…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant={filtro === "todos" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setFiltro("todos")}>
                  Todos <span className="ml-1.5 text-[10px] opacity-70">{linhas.length}</span>
                </Button>
                {ORDEM_STATUS.filter((s) => resumo.porStatus[s].postos > 0).map((s) => (
                  <Button key={s} size="sm" variant={filtro === s ? "default" : "outline"} className="h-8 text-xs" onClick={() => setFiltro(s)}>
                    {ROTULO_STATUS[s]} <span className="ml-1.5 text-[10px] opacity-70">{resumo.porStatus[s].postos}</span>
                  </Button>
                ))}
              </div>
              <Button size="sm" variant="outline" className="ml-auto h-8 gap-1.5 text-xs" disabled={exportando} onClick={exportar}>
                {exportando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Exportar Excel
              </Button>
            </div>

            {filtro !== "todos" && <p className="text-xs text-muted-foreground"><b>O que fazer:</b> {ACAO_STATUS[filtro]}</p>}

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Contrato</th>
                    <th className="px-3 py-2 font-medium">Posto na Senior</th>
                    <th className="px-3 py-2 text-right font-medium">Pessoas</th>
                    <th className="px-3 py-2 text-right font-medium">Sem vínculo</th>
                    <th className="px-3 py-2 font-medium">Posto no ERP</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.slice(0, LIMITE_TELA).map((l) => (
                    <tr key={`${l.contrato_id}|${l.codigo}|${l.posto_senior}`} className="border-t border-border/60 align-top">
                      <td className="px-3 py-2 text-xs">{l.contrato}</td>
                      <td className="px-3 py-2">
                        <p className="text-xs font-medium" title={l.posto_senior}>{limparPostoSenior(l.posto_senior)}</p>
                        {l.codigo && <p className="text-[11px] text-muted-foreground">{l.codigo}</p>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.pessoas}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${l.sem_posto ? "font-semibold text-destructive" : "text-muted-foreground/50"}`}>{l.sem_posto || "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {l.postos_erp.length ? l.postos_erp.map((p) => <p key={p}>{p}</p>) : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={`whitespace-nowrap text-[10px] font-semibold ${COR[l.status]}`} title={ACAO_STATUS[l.status]}>
                          {ROTULO_STATUS[l.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {!visiveis.length && (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">Nada por aqui.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {visiveis.length > LIMITE_TELA && <>Mostrando {LIMITE_TELA} de {visiveis.length} — a planilha exportada traz todas. </>}
              O posto de cada colaborador vem da Senior sozinho, de 15 em 15 minutos. Gerado em {new Date(data.gerado_em).toLocaleString("pt-BR")}.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Numero({ valor, rotulo, tom }: { valor: React.ReactNode; rotulo: string; tom: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className={`text-xl font-bold leading-none tabular-nums ${tom}`}>{valor}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{rotulo}</p>
    </div>
  );
}
