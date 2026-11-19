import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { fmtDate, fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { resumoDescontos, ROTULO_CLASSIFICACAO, TIPOS_DESCONTO, type ClassificacaoDesconto, type LinhaDesconto, type TipoDesconto } from "./totais";

// SIS-2026-0952: detalhamento do KPI "Total de Descontos" do Relatório Geral. Parte das notas já filtradas na tela
// (mesmas do KPI) e tem filtros próprios para estreitar sem mexer nos da tela. Exporta o detalhamento linha a linha para Excel.

const TODOS = "__todos";
const LIMITE_DETALHE = 500;
const rotuloTipo = (t: TipoDesconto) => TIPOS_DESCONTO.find((x) => x.tipo === t)?.rotulo ?? t;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  linhas: LinhaDesconto[];
  nomeContrato: (id: string) => string;
  nomeEmpresa: (id: string) => string;
  competenciaCurta: (c: string) => string;
}

export function DescontosDetalheDialog({ open, onOpenChange, linhas, nomeContrato, nomeEmpresa, competenciaCurta }: Props) {
  const [empresa, setEmpresa] = useState("");
  const [contrato, setContrato] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [emissaoDe, setEmissaoDe] = useState("");
  const [emissaoAte, setEmissaoAte] = useState("");
  const [classificacao, setClassificacao] = useState<ClassificacaoDesconto | "">("");
  const [tipo, setTipo] = useState<TipoDesconto | "">("");

  const empresas = useMemo(() => [...new Set(linhas.map((l) => l.empresaId))].sort((a, b) => nomeEmpresa(a).localeCompare(nomeEmpresa(b))), [linhas, nomeEmpresa]);
  const contratos = useMemo(
    () => [...new Set(linhas.filter((l) => !empresa || l.empresaId === empresa).map((l) => l.contratoId))].sort((a, b) => nomeContrato(a).localeCompare(nomeContrato(b))),
    [linhas, empresa, nomeContrato],
  );
  const competencias = useMemo(() => [...new Set(linhas.map((l) => l.competencia))].sort().reverse(), [linhas]);

  const filtradas = useMemo(
    () => linhas.filter((l) => {
      if (empresa && l.empresaId !== empresa) return false;
      if (contrato && l.contratoId !== contrato) return false;
      if (competencia && l.competencia !== competencia) return false;
      if (emissaoDe && (!l.dataEmissao || l.dataEmissao < emissaoDe)) return false;
      if (emissaoAte && (!l.dataEmissao || l.dataEmissao > emissaoAte)) return false;
      if (classificacao && l.classificacao !== classificacao) return false;
      if (tipo && l.tipo !== tipo) return false;
      return true;
    }),
    [linhas, empresa, contrato, competencia, emissaoDe, emissaoAte, classificacao, tipo],
  );
  const resumo = useMemo(() => resumoDescontos(filtradas), [filtradas]);
  const detalhe = useMemo(
    () => [...filtradas].sort((a, b) => b.competencia.localeCompare(a.competencia) || nomeContrato(a.contratoId).localeCompare(nomeContrato(b.contratoId)) || b.valor - a.valor),
    [filtradas, nomeContrato],
  );

  function limpar() {
    setEmpresa(""); setContrato(""); setCompetencia(""); setEmissaoDe(""); setEmissaoAte(""); setClassificacao(""); setTipo("");
  }

  function exportar() {
    if (detalhe.length === 0) {
      toast.error("Não há descontos para exportar com os filtros atuais.");
      return;
    }
    import("xlsx").then((XLSX) => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalhe.map((l) => ({
        Empresa: nomeEmpresa(l.empresaId),
        Contrato: nomeContrato(l.contratoId),
        Competência: competenciaCurta(l.competencia),
        "Nº NF": l.numeroNf ?? "-",
        "Data emissão": fmtDate(l.dataEmissao),
        "Tipo de desconto": rotuloTipo(l.tipo),
        Classificação: ROTULO_CLASSIFICACAO[l.classificacao],
        Valor: l.valor,
      }))), "Detalhado");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo.porContrato.map((c) => ({
        Empresa: nomeEmpresa(c.empresaId), Contrato: nomeContrato(c.contratoId), Notas: c.notas, "Antes da NF": c.antes, "Após a NF": c.apos, Total: c.total,
      }))), "Por contrato");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
        ...resumo.porTipo.filter((t) => t.total !== 0).map((t) => ({ Tipo: rotuloTipo(t.tipo), "Antes da NF": t.antes, "Após a NF": t.apos, Total: t.total })),
        { Tipo: "Total geral", "Antes da NF": resumo.antes, "Após a NF": resumo.apos, Total: resumo.total },
      ]), "Por tipo");
      XLSX.writeFile(wb, `Relatorio_de_Servicos_Descontos_${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
  }

  const sel = "h-8 text-xs";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Total de descontos</DialogTitle>
          <DialogDescription>
            Faltas, postos não implementados, multas, glosas e outros descontos das notas que estão nos filtros da tela, separados entre antes e
            após a emissão da NF. Desconto de conta vinculada não entra (tem KPI próprio). Notas canceladas ou substituídas não entram.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className="space-y-1">
            <span className="text-muted-foreground">Empresa</span>
            <Select value={empresa || TODOS} onValueChange={(v) => { setEmpresa(v === TODOS ? "" : v); setContrato(""); }}>
              <SelectTrigger className={`${sel} w-44`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todas</SelectItem>
                {empresas.map((e) => <SelectItem key={e} value={e}>{nomeEmpresa(e)}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">Contrato</span>
            <Select value={contrato || TODOS} onValueChange={(v) => setContrato(v === TODOS ? "" : v)}>
              <SelectTrigger className={`${sel} w-56`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos</SelectItem>
                {contratos.map((c) => <SelectItem key={c} value={c}>{nomeContrato(c)}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">Competência</span>
            <Select value={competencia || TODOS} onValueChange={(v) => setCompetencia(v === TODOS ? "" : v)}>
              <SelectTrigger className={`${sel} w-32`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todas</SelectItem>
                {competencias.map((c) => <SelectItem key={c} value={c}>{competenciaCurta(c)}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">Emissão de</span>
            <Input type="date" className={`${sel} w-36`} value={emissaoDe} onChange={(e) => setEmissaoDe(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">até</span>
            <Input type="date" className={`${sel} w-36`} value={emissaoAte} onChange={(e) => setEmissaoAte(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">Classificação</span>
            <Select value={classificacao || TODOS} onValueChange={(v) => setClassificacao(v === TODOS ? "" : (v as ClassificacaoDesconto))}>
              <SelectTrigger className={`${sel} w-32`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todas</SelectItem>
                <SelectItem value="antes">{ROTULO_CLASSIFICACAO.antes}</SelectItem>
                <SelectItem value="apos">{ROTULO_CLASSIFICACAO.apos}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">Tipo</span>
            <Select value={tipo || TODOS} onValueChange={(v) => setTipo(v === TODOS ? "" : (v as TipoDesconto))}>
              <SelectTrigger className={`${sel} w-44`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos</SelectItem>
                {TIPOS_DESCONTO.map((t) => <SelectItem key={t.tipo} value={t.tipo}>{t.rotulo}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <Button variant="outline" size="sm" className="h-8" onClick={limpar}>Limpar</Button>
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={exportar}><FileDown className="h-4 w-4" /> Exportar Excel</Button>
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-auto pr-1">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[["Total de descontos", resumo.total], ["Antes da emissão da NF", resumo.antes], ["Após a emissão da NF", resumo.apos]].map(([rotulo, valor]) => (
              <div key={rotulo as string} className="rounded-lg border p-3">
                <div className="text-xs uppercase text-muted-foreground">{rotulo}</div>
                <div className="text-lg font-semibold tabular-nums">{fmtMoney(valor as number)}</div>
              </div>
            ))}
          </div>

          {filtradas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum desconto nas notas filtradas.</p>
          ) : (
            <>
              <div>
                <h4 className="mb-1 text-sm font-semibold">Por tipo de desconto</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Antes da NF</TableHead>
                      <TableHead className="text-right">Após a NF</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resumo.porTipo.filter((t) => t.total !== 0).map((t) => (
                      <TableRow key={t.tipo}>
                        <TableCell>{rotuloTipo(t.tipo)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(t.antes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(t.apos)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{fmtMoney(t.total)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell>Total geral</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(resumo.antes)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(resumo.apos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(resumo.total)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div>
                <h4 className="mb-1 text-sm font-semibold">Por contrato</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contrato</TableHead>
                      <TableHead className="text-right">Notas</TableHead>
                      <TableHead className="text-right">Antes da NF</TableHead>
                      <TableHead className="text-right">Após a NF</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resumo.porContrato.map((c) => (
                      <TableRow key={c.contratoId}>
                        <TableCell className="font-medium">
                          {nomeContrato(c.contratoId)}
                          <span className="block text-xs font-normal text-muted-foreground">{nomeEmpresa(c.empresaId)}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.notas}</TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">{fmtMoney(c.antes)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">{fmtMoney(c.apos)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap font-semibold tabular-nums">{fmtMoney(c.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div>
                <h4 className="mb-1 text-sm font-semibold">Detalhado ({detalhe.length} lançamentos)</h4>
                {detalhe.length > LIMITE_DETALHE && (
                  <p className="mb-1 text-xs text-muted-foreground">Mostrando os {LIMITE_DETALHE} primeiros; o Excel traz todos.</p>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Contrato</TableHead>
                      <TableHead>Competência</TableHead>
                      <TableHead>Nº NF</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Classificação</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detalhe.slice(0, LIMITE_DETALHE).map((l, i) => (
                      <TableRow key={`${l.nfId}-${l.tipo}-${l.classificacao}-${i}`}>
                        <TableCell className="text-xs">{nomeEmpresa(l.empresaId)}</TableCell>
                        <TableCell className="text-xs">{nomeContrato(l.contratoId)}</TableCell>
                        <TableCell className="text-xs">{competenciaCurta(l.competencia)}</TableCell>
                        <TableCell className="text-xs">{l.numeroNf ?? "-"}</TableCell>
                        <TableCell className="text-xs">{rotuloTipo(l.tipo)}</TableCell>
                        <TableCell className="text-xs">{ROTULO_CLASSIFICACAO[l.classificacao]}</TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">{fmtMoney(l.valor)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
