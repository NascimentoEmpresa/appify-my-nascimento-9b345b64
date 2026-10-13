import { useMemo, type ReactNode } from "react";
import { Download } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { baixarCsv } from "@/lib/efetividade";
import { ETAPA_LABEL, EtapaNf, etapaDaNf, impactoDoContratoPct, resumirPendencias } from "./pendentesNf";

// SIS-2026-0650: layout da aba "NFs Não Emitidas" conforme o mockup do Ruan — KPIs, tabela
// priorizada pelo maior impacto e painel "Resumo do impacto financeiro". Todos os pendentes da
// competência aparecem (o mockup estava cortado). "Etapa atual" vem da Emissão de NF.

export interface PendenteLinha {
  contratoId: string;
  empresaId: string;
  contratoNome: string;
  executavel: number;
  naoEmitido: number;
}

interface Props {
  pendentes: PendenteLinha[];
  // soma do executável de todos os contratos vigentes da competência (calculado, não digitado)
  executavelTotal: number;
  competenciaLabel: string;
  competenciaISO: string;
  nfs: { contrato_id: string; competencia: string; tipo_nota: string; status?: string | null }[];
  empresaNomePorId: Map<string, string>;
  filtros: ReactNode;
  onLimparFiltros: () => void;
}

const ETAPA_CLASSE: Record<EtapaNf, string> = {
  NAO_INICIADA: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-700",
  RASCUNHO: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  ENVIADA: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
};

const pct = (n: number, casas = 2) => `${n.toFixed(casas).replace(".", ",")}%`;

function KpiCard({ label, valor, sub, borda, valorClass }: { label: string; valor: string; sub?: string; borda: string; valorClass?: string }) {
  return (
    <Card className={cn("border-l-4", borda)}>
      <CardContent className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-2xl font-bold", valorClass)}>{valor}</p>
        {sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={sub}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function NfsNaoEmitidasTab({ pendentes, executavelTotal, competenciaLabel, competenciaISO, nfs, empresaNomePorId, filtros, onLimparFiltros }: Props) {
  const linhas = useMemo(() => {
    const etapaPorContrato = new Map<string, { status?: string | null }[]>();
    for (const n of nfs) {
      if (n.tipo_nota !== "N" || n.competencia !== competenciaISO) continue;
      const arr = etapaPorContrato.get(n.contrato_id) ?? [];
      arr.push(n);
      etapaPorContrato.set(n.contrato_id, arr);
    }
    return [...pendentes]
      .sort((a, b) => b.naoEmitido - a.naoEmitido || a.contratoNome.localeCompare(b.contratoNome, "pt-BR"))
      .map((p, i) => ({
        ...p,
        prioridade: i + 1,
        empresaNome: empresaNomePorId.get(p.empresaId) ?? "—",
        etapa: etapaDaNf(etapaPorContrato.get(p.contratoId) ?? []),
        impactoPct: impactoDoContratoPct(p.naoEmitido, executavelTotal),
      }));
  }, [pendentes, nfs, competenciaISO, empresaNomePorId, executavelTotal]);

  const resumo = useMemo(
    () => resumirPendencias(linhas.map((l) => ({ empresaNome: l.empresaNome, contratoNome: l.contratoNome, naoEmitido: l.naoEmitido })), executavelTotal),
    [linhas, executavelTotal],
  );
  const maiorEmpresa = resumo.porEmpresa[0]?.valor ?? 0;
  const donut = [
    { nome: "Não emitido", valor: Math.min(100, resumo.impactoPct), cor: "#ef5350" },
    { nome: "Demais", valor: Math.max(0, 100 - resumo.impactoPct), cor: "#e8ecf4" },
  ];

  function exportarCsv() {
    baixarCsv(`nfs-nao-emitidas-${competenciaISO.slice(0, 7)}.csv`, [
      ["Prioridade", "Empresa", "Contrato", "Etapa atual", "Valor executável", "Valor não emitido", "Impacto no mês (%)"],
      ...linhas.map((l) => [
        l.prioridade,
        l.empresaNome,
        l.contratoNome,
        ETAPA_LABEL[l.etapa],
        l.executavel.toFixed(2).replace(".", ","),
        l.naoEmitido.toFixed(2).replace(".", ","),
        l.impactoPct.toFixed(2).replace(".", ","),
      ]),
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="card-elevated flex flex-wrap items-center gap-2 p-3 text-xs">
        {filtros}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onLimparFiltros}>Limpar filtros</Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-emerald-700 dark:text-emerald-400" onClick={exportarCsv} disabled={linhas.length === 0}>
            <Download className="h-3.5 w-3.5" /> Exportar CSV
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Contratos vigentes em {competenciaLabel} sem nenhuma NF Código N lançada — priorizados pelo maior valor executável.{" "}
        <strong className="text-foreground">Impactos calculados sobre o executável da competência.</strong>
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Contratos sem NF" valor={resumo.qtd.toLocaleString("pt-BR")} sub="Contratos vigentes sem NF Código N" borda="border-l-orange-500" />
        <KpiCard label="Valor não faturado" valor={fmtMoney(resumo.valorNaoFaturado)} sub="Soma dos contratos sem NF" borda="border-l-red-500" valorClass="text-red-600 dark:text-red-400" />
        <KpiCard label="Impacto no mês" valor={pct(resumo.impactoPct)} sub="Sobre o executável total da competência" borda="border-l-amber-500" />
        <KpiCard label="Maior pendência" valor={resumo.maior ? fmtMoney(resumo.maior.valor) : "—"} sub={resumo.maior?.contratoNome} borda="border-l-blue-500" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-xs font-bold uppercase tracking-wide">Contratos ainda não faturados</CardTitle>
            <span className="text-[11px] text-muted-foreground">Ordenados pelo maior impacto financeiro</span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16 text-[11px] uppercase">Prioridade</TableHead>
                    <TableHead className="text-[11px] uppercase">Empresa</TableHead>
                    <TableHead className="text-[11px] uppercase">Contrato</TableHead>
                    <TableHead className="text-[11px] uppercase">Etapa atual</TableHead>
                    <TableHead className="text-right text-[11px] uppercase">Valor executável</TableHead>
                    <TableHead className="text-right text-[11px] uppercase">Valor não emitido</TableHead>
                    <TableHead className="min-w-[120px] text-right text-[11px] uppercase">Impacto no mês</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum contrato pendente — tudo faturado nessa competência.</TableCell>
                    </TableRow>
                  )}
                  {linhas.map((l) => (
                    <TableRow key={l.contratoId}>
                      <TableCell>
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-sky-100 text-xs font-semibold text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">{l.prioridade}</span>
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{l.empresaNome}</TableCell>
                      <TableCell className="text-sm font-semibold">{l.contratoNome}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("whitespace-nowrap border font-normal", ETAPA_CLASSE[l.etapa])}>{ETAPA_LABEL[l.etapa]}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm">{fmtMoney(l.executavel)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm font-semibold text-red-600 dark:text-red-400">{fmtMoney(l.naoEmitido)}</TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs font-semibold">{pct(l.impactoPct)}</span>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded bg-muted">
                          <div className="h-full rounded bg-orange-400" style={{ width: `${Math.min(100, l.impactoPct)}%` }} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader className="pb-2">
            <CardTitle className="text-center text-xs font-bold uppercase tracking-wide">Resumo do impacto financeiro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative mx-auto h-44 w-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut} dataKey="valor" nameKey="nome" cx="50%" cy="50%" innerRadius={58} outerRadius={80} startAngle={90} endAngle={-270} stroke="none">
                    {donut.map((d) => <Cell key={d.nome} fill={d.cor} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold">{pct(resumo.impactoPct, 1)}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Não emitido</span>
              </div>
            </div>

            <dl className="divide-y text-xs">
              <div className="flex items-center justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Executável total da competência (R$)</dt>
                <dd className="font-semibold">{fmtMoney(executavelTotal)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Valor não faturado</dt>
                <dd className="font-semibold">{fmtMoney(resumo.valorNaoFaturado)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Executável fora das pendências</dt>
                <dd className="font-semibold">{fmtMoney(resumo.executavelForaDasPendencias)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Concentração dos 3 maiores</dt>
                <dd className="font-semibold">{pct(resumo.concentracaoTop3Pct, 1)}</dd>
              </div>
            </dl>

            <div className="space-y-2 pt-1">
              <p className="text-center text-[11px] font-bold uppercase tracking-wide">Pendências por empresa</p>
              {resumo.porEmpresa.map((e) => (
                <div key={e.empresa} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">{e.empresa}</span>
                    <span className="font-semibold">{fmtMoney(e.valor)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                    <div className="h-full rounded bg-gradient-to-r from-orange-500 to-amber-400" style={{ width: `${maiorEmpresa > 0 ? (e.valor / maiorEmpresa) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
              {resumo.porEmpresa.length === 0 && <p className="text-center text-xs text-muted-foreground">Sem pendências.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
