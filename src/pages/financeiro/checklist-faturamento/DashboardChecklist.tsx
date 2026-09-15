import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { ListChecks, CheckCircle2, AlertTriangle, Clock3, TrendingUp } from "lucide-react";
import {
  ContratoChecklist, useResumoPendencias, useConfigsChecklist, useEnviosCompetencia,
  calcularPrazoChecklist, situacaoPrazoChecklist,
} from "@/hooks/useChecklistFaturamento";
import { PrazoStatusBadge } from "./PrazoStatusBadge";

// SIS-2026-0343: dashboard agregado do Checklist de Faturamento — pedido
// da Carol/Ruan depois da v1 (SIS-2026-0304) pra poder ver prazo de envio
// e data de envio numa visão geral (pra cobrar quem está atrasado), não só
// dentro do detalhe de cada contrato. Baseado no HTML de referência que o
// Ruan mandou; dado (dia_limite_padrao/baixado_em) já existia, só nunca
// tinha ganhado tela.

interface EmpresaOpcao {
  id: string;
  nome: string;
}

const CORES_DONUT: Record<string, string> = {
  ok: "#21b57a",
  a_conferir: "#f5c154",
  pendente: "#e45c63",
  nao_aplicavel: "#aab3c1",
};

function formatarData(d: Date | null): string {
  if (!d) return "Sem prazo";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function DashboardChecklist({
  contratos,
  empresas,
  competenciaISO,
  onAbrirContrato,
  onIrParaChecklist,
  onVerContratosPendencia,
  onVerDocumentosPendentes,
}: {
  contratos: ContratoChecklist[];
  empresas: EmpresaOpcao[];
  competenciaISO: string;
  onAbrirContrato: (contratoId: string) => void;
  // SIS-2026-0343 (pedido do usuário): KPIs clicáveis, levando pro checklist
  // ou pro modal daquela divergência específica.
  onIrParaChecklist: () => void;
  onVerContratosPendencia: () => void;
  onVerDocumentosPendentes: () => void;
}) {
  const { data: resumo } = useResumoPendencias(competenciaISO);
  const { data: configs } = useConfigsChecklist();
  const { data: envios } = useEnviosCompetencia(competenciaISO);

  const linhas = useMemo(() => {
    return contratos.map((c) => {
      const r = resumo?.get(c.id);
      const totalDocs = r?.total_docs ?? 0;
      const pendentes = r?.pendentes ?? 0;
      const aConferir = r?.aConferir ?? 0;
      const naoAplicavel = r?.naoAplicavel ?? 0;
      const ok = Math.max(0, (r?.ok ?? 0) - aConferir - naoAplicavel);
      const concluidos = ok + naoAplicavel;
      const pct = totalDocs ? Math.round((concluidos / totalDocs) * 100) : 0;
      const diaLimite = configs?.get(c.id) ?? null;
      const prazo = calcularPrazoChecklist(competenciaISO, diaLimite ?? null);
      const envio = envios?.get(c.id) ?? null;
      const situacao = situacaoPrazoChecklist(prazo, envio);
      return {
        contrato: c,
        empresaNome: empresas.find((e) => e.id === c.empresa_id)?.nome ?? "—",
        totalDocs, pendentes, aConferir, naoAplicavel, ok, concluidos, pct, prazo, situacao,
      };
    });
  }, [contratos, resumo, configs, envios, empresas, competenciaISO]);

  const kpis = useMemo(() => {
    const totalDocs = linhas.reduce((a, l) => a + l.totalDocs, 0);
    const concluidos = linhas.reduce((a, l) => a + l.concluidos, 0);
    const pendentes = linhas.reduce((a, l) => a + l.pendentes, 0);
    const comPendencia = linhas.filter((l) => l.pendentes > 0).length;
    return {
      totalContratos: linhas.length,
      totalDocs,
      concluidos,
      pendentes,
      comPendencia,
      progresso: totalDocs ? Math.round((concluidos / totalDocs) * 100) : 0,
    };
  }, [linhas]);

  const donut = useMemo(() => {
    const ok = linhas.reduce((a, l) => a + l.ok, 0);
    const aConferir = linhas.reduce((a, l) => a + l.aConferir, 0);
    const pendente = linhas.reduce((a, l) => a + l.pendentes, 0);
    const naoAplicavel = linhas.reduce((a, l) => a + l.naoAplicavel, 0);
    return [
      { nome: "OK", chave: "ok", valor: ok },
      { nome: "A conferir", chave: "a_conferir", valor: aConferir },
      { nome: "Pendente", chave: "pendente", valor: pendente },
      { nome: "N/A", chave: "nao_aplicavel", valor: naoAplicavel },
    ].filter((d) => d.valor > 0);
  }, [linhas]);

  const porEmpresa = useMemo(() => {
    const mapa = new Map<string, { nome: string; totalDocs: number; concluidos: number }>();
    for (const l of linhas) {
      const atual = mapa.get(l.empresaNome) ?? { nome: l.empresaNome, totalDocs: 0, concluidos: 0 };
      atual.totalDocs += l.totalDocs;
      atual.concluidos += l.concluidos;
      mapa.set(l.empresaNome, atual);
    }
    return Array.from(mapa.values())
      .filter((e) => e.totalDocs > 0)
      .map((e) => ({ ...e, pct: Math.round((e.concluidos / e.totalDocs) * 100) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [linhas]);

  const porPrazo = useMemo(() => {
    const comDocs = linhas.filter((l) => l.totalDocs > 0);
    const mapa = new Map<string, typeof comDocs>();
    for (const l of comDocs) {
      const chave = l.prazo ? l.prazo.toISOString().slice(0, 10) : "sem-prazo";
      const arr = mapa.get(chave) ?? [];
      arr.push(l);
      mapa.set(chave, arr);
    }
    return Array.from(mapa.entries())
      .sort(([a], [b]) => (a === "sem-prazo" ? 1 : b === "sem-prazo" ? -1 : a.localeCompare(b)))
      .map(([chave, arr]) => ({
        chave,
        data: chave === "sem-prazo" ? null : arr[0].prazo,
        contratos: arr.sort((a, b) => b.pendentes - a.pendentes),
      }));
  }, [linhas]);

  const maisPendencias = useMemo(
    () => linhas.filter((l) => l.pendentes > 0).sort((a, b) => b.pendentes - a.pendentes),
    [linhas],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiTile label="Contratos Ativos" valor={String(kpis.totalContratos)} icon={<ListChecks />} cor="slate" onClick={onIrParaChecklist} />
        <KpiTile
          label="Concluídos"
          valor={String(kpis.concluidos)}
          sub={`${kpis.concluidos} de ${kpis.totalDocs} itens totais`}
          icon={<CheckCircle2 />}
          cor="emerald"
          valorClass="text-emerald-600 dark:text-emerald-400"
          onClick={onIrParaChecklist}
        />
        <KpiTile label="Documentos Pendentes" valor={String(kpis.pendentes)} icon={<AlertTriangle />} cor="red" valorClass="text-red-600 dark:text-red-400" onClick={onVerDocumentosPendentes} />
        <KpiTile label="Contratos com Pendência" valor={String(kpis.comPendencia)} icon={<Clock3 />} cor="amber" valorClass="text-amber-600 dark:text-amber-400" onClick={onVerContratosPendencia} />
        <KpiTile label="Progresso Geral" valor={`${kpis.progresso}%`} icon={<TrendingUp />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" onClick={onIrParaChecklist} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Status geral</CardTitle></CardHeader>
          <CardContent className="flex-1">
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={donut} dataKey="valor" nameKey="nome" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2}>
                  {donut.map((d) => <Cell key={d.chave} fill={CORES_DONUT[d.chave]} />)}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [`${v} doc(s)`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-3 mt-2 text-[11px] text-muted-foreground">
              {donut.map((d) => (
                <span key={d.chave} className="inline-flex items-center gap-1.5">
                  <i className="inline-block h-2 w-2 rounded-sm" style={{ background: CORES_DONUT[d.chave] }} />
                  {d.nome} ({d.valor})
                </span>
              ))}
              {donut.length === 0 && <span>Sem documentos vinculados nesta competência.</span>}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Progresso por empresa</CardTitle></CardHeader>
          <CardContent className="flex-1 flex flex-col justify-evenly gap-5">
            {porEmpresa.length === 0 && <p className="text-sm text-muted-foreground text-center">Sem dados nesta competência.</p>}
            {porEmpresa.map((e) => (
              <div key={e.nome} className="grid grid-cols-[100px_1fr_40px] gap-3 items-center">
                <span className="text-xs font-semibold truncate" title={e.nome}>{e.nome}</span>
                <div className="h-6 rounded-md bg-muted overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${e.pct}%` }} />
                </div>
                <span className="text-xs text-right text-muted-foreground font-medium">{e.pct}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Contratos por prazo</CardTitle></CardHeader>
        <CardContent>
          {porPrazo.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Nenhum contrato com documentos vinculados nesta competência.</p>}
          {/* SIS-2026-0343 (pedido do usuário): auto-fit em vez de colunas
              fixas — com poucos grupos de prazo (ex. 2), uma 3ª coluna fixa
              deixava um vão vazio à direita; auto-fit só cria coluna se
              houver card pra ocupar. */}
          <div className="grid gap-3 items-start [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
            {porPrazo.map((grupo) => (
              <div key={grupo.chave} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">{formatarData(grupo.data)}</span>
                  <span className="text-[11px] text-muted-foreground">{grupo.contratos.length} contrato(s)</span>
                </div>
                <div className="space-y-1.5">
                  {grupo.contratos.slice(0, 8).map((l) => (
                    <button
                      key={l.contrato.id}
                      type="button"
                      onClick={() => onAbrirContrato(l.contrato.id)}
                      className="flex w-full items-center justify-between gap-2 text-left text-[11px] hover:underline"
                    >
                      <span className="truncate text-muted-foreground">{l.contrato.nome}</span>
                      {l.pendentes > 0 && <span className="shrink-0 font-semibold text-red-600 dark:text-red-400">{l.pendentes} pend.</span>}
                    </button>
                  ))}
                  {grupo.contratos.length > 8 && (
                    <p className="text-[11px] text-muted-foreground">+{grupo.contratos.length - 8} contrato(s)</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Contratos com mais pendências</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead className="text-center">Pendentes</TableHead>
                  <TableHead>Progresso</TableHead>
                  <TableHead className="text-center">%</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Situação do prazo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {maisPendencias.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum contrato com pendência nesta competência.</TableCell>
                  </TableRow>
                )}
                {maisPendencias.map((l) => (
                  <TableRow key={l.contrato.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onAbrirContrato(l.contrato.id)}>
                    <TableCell className="font-medium text-sm">{l.contrato.nome}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.empresaNome}</TableCell>
                    <TableCell className="text-center text-sm font-semibold text-red-600 dark:text-red-400">{l.pendentes}</TableCell>
                    <TableCell>
                      <div className="h-1.5 w-32 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${l.pct}%` }} />
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-sm">{l.pct}%</TableCell>
                    <TableCell className="text-sm">{formatarData(l.prazo)}</TableCell>
                    <TableCell><PrazoStatusBadge status={l.situacao.status} label={l.situacao.label} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
