import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ListChecks, CheckCircle2, AlertTriangle, FileWarning, Wallet, TrendingUp, Percent } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { useContratosERP, ContratoERP } from "@/hooks/useContratosERP";
import { usePlanilhaCustos, resolverLinhasPorPeriodo, somarCamposEmLinhas, fimDoMes } from "@/hooks/usePlanilhaCusto";
import { useNfsEmissao } from "@/hooks/useNfEmissao";
import { fmtMoney, foraDoRelatorio, naoContabilizaKpi } from "@/pages/financeiro/nf-emissao/shared";
import { contratoEncerradoNaCompetencia } from "./vigenciaContrato";
import { StatusCelula, excessoDeFaturamento, faltaDeFaturamento, resumirFaturamento, statusCelula } from "./faturamentoStatus";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// SIS-2026-0562 (Iury): "Base de Contratos Vigentes × Relatório de
// Serviços", igual ao protótipo em anexo (Dashboard_Controle_Faturamento_
// Nascimento.html) — só que lendo do nosso banco em vez de planilha
// importada à mão. Lendo o parser de import do próprio HTML (importReport/
// importBase) fica claro que as duas fontes que ele espera JÁ SÃO as
// nossas: "Base de Contratos Vigentes" = planilha_custo (mesmas colunas:
// Empresa/Contrato/Posto/Vigência/Orçado-Executado/Total Posto) e
// "Relatório de Serviços" = nf_emissao (mesmas colunas: Valor contrato
// exec./Valor contábil/Vlr líq./Valor recebido/Desconto de conta
// vinculada, só Código N). Isso confirma as 3 decisões já fechadas com o
// usuário antes deste código:
//   1. Vigência por mês = planilha_custo (por posto), não contratos.vigencia_*.
//   2. "Valor Executável (Base)" de cada contrato/mês = planilha_custo
//      (resolverLinhasPorPeriodo), não o que foi digitado na NF.
//   3. Só nota tipo N conta como lançamento.
// "Executado (Relatório N)" é OUTRA coisa: o que foi digitado em
// nf_emissao.valor_contrato_exec_total — mantido separado do Executável da
// Base de propósito, é exatamente essa divergência que o protótipo existe
// pra mostrar.

const STATUS_INFO: Record<StatusCelula, { label: string; labelCurto: string; className: string; dot: string }> = {
  NOTAS_LANCADAS: { label: "Notas lançadas (Código N)", labelCurto: "Faturado", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400", dot: "#2aa978" },
  FATURADO_PARCIAL: { label: "Faturado parcial (NF abaixo do executável)", labelCurto: "Parcial", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400", dot: "#f59e0b" },
  NENHUM_LANCAMENTO: { label: "Nenhum lançamento", labelCurto: "Sem lançamento", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400", dot: "#d75a54" },
  COMPETENCIA_SEM_DADOS: { label: "Competência ainda sem dado no relatório", labelCurto: "Sem dado no relatório", className: "bg-slate-100 text-slate-500 dark:bg-slate-800/40 dark:text-slate-400", dot: "#94a3b8" },
  SEM_VIGENCIA: { label: "Sem vigência no período ou não está na planilha", labelCurto: "Sem vigência/base", className: "bg-muted text-muted-foreground/70", dot: "#cbd5e1" },
};

const MESES_LABEL = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// nf_emissao.competencia é `date` ("YYYY-MM-DD", sempre dia 01) — a
// competência de referência usada em todo o painel segue esse mesmo
// formato completo, não "YYYY-MM", pra comparar direto sem slice.
function mesId(ano: number, mesIndex1: number): string {
  return `${ano}-${String(mesIndex1).padStart(2, "0")}-01`;
}
function anoDe(competencia: string): number {
  return Number(competencia.slice(0, 4));
}
function labelMes(competencia: string): string {
  const i = Number(competencia.slice(5, 7)) - 1;
  return `${MESES_LABEL[i] ?? "?"}/${competencia.slice(2, 4)}`;
}

interface LinhaFaturamento {
  contrato: ContratoERP;
  executavel: number;
  execRel: number;
  contabil: number;
  liquido: number;
  recebido: number;
  cv: number;
  naoEmitido: number;
  // NF acima do executável — mostrado à parte, NÃO abate o Não Emitido.
  excesso: number;
  status: StatusCelula;
}

export default function ControleFaturamento() {
  const navigate = useNavigate();
  const { data: contratos = [], isLoading: carregandoContratos } = useContratosERP({ todasEmpresas: true });
  const { data: planilha = [], isLoading: carregandoPlanilha } = usePlanilhaCustos({ todasEmpresas: true });
  const { data: nfs = [], isLoading: carregandoNfs } = useNfsEmissao(null, { todasEmpresas: true });
  const { data: empresas = [] } = useEmpresasGrupo();

  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const meses = useMemo(() => Array.from({ length: 12 }, (_, i) => mesId(ano, i + 1)), [ano]);

  const anosDisponiveis = useMemo(() => {
    const anos = new Set<number>([new Date().getFullYear()]);
    for (const r of planilha) if (r.data_vigencia) anos.add(new Date(r.data_vigencia + "T00:00:00").getFullYear());
    for (const n of nfs) if (n.competencia) anos.add(anoDe(n.competencia));
    return Array.from(anos).sort((a, b) => b - a);
  }, [planilha, nfs]);

  // Competência default: mês mais recente com NF Código N nesse ano, senão
  // o mês atual (se o ano selecionado for o corrente), senão janeiro.
  const competenciaDefault = useMemo(() => {
    const doAno = nfs.filter((n) => n.tipo_nota === "N" && anoDe(n.competencia) === ano).map((n) => n.competencia).sort();
    if (doAno.length) return doAno[doAno.length - 1];
    const hoje = new Date();
    return hoje.getFullYear() === ano ? mesId(ano, hoje.getMonth() + 1) : mesId(ano, 1);
  }, [nfs, ano]);
  const [competenciaSel, setCompetenciaSel] = useState<string | null>(null);
  const competencia = competenciaSel && meses.includes(competenciaSel) ? competenciaSel : competenciaDefault;

  const empresaNomePorId = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome])), [empresas]);
  const contratosFiltrados = useMemo(
    () => (filtroEmpresa ? contratos.filter((c) => c.empresa_id === filtroEmpresa) : contratos),
    [contratos, filtroEmpresa]
  );

  const planilhaPorContrato = useMemo(() => {
    const mapa = new Map<string, typeof planilha>();
    for (const r of planilha) {
      if (!r.contrato_id) continue;
      const arr = mapa.get(r.contrato_id) ?? [];
      arr.push(r);
      mapa.set(r.contrato_id, arr);
    }
    return mapa;
  }, [planilha]);

  // Um lançamento por contrato+competência — soma todas as NFs Código N
  // desse mês (pode ter mais de uma nota pro mesmo contrato/competência).
  const nfAggPorContratoCompetencia = useMemo(() => {
    const mapa = new Map<string, { execRel: number; contabil: number; liquido: number; recebido: number; cv: number; count: number }>();
    // Achado real (Ruan): nota Cancelada/Substituída ainda carrega valores
    // da planilha legada, e nota em Rascunho/Enviada (ainda não validada
    // pelo Financeiro) ou Cancelada pelo próprio app não deveriam contar
    // como "lançamento" (célula verde) — processo real só considera lançada
    // a nota já validada (concluida).
    for (const n of nfs) {
      if (n.tipo_nota !== "N" || foraDoRelatorio(n) || naoContabilizaKpi(n)) continue;
      const chave = `${n.contrato_id}|${n.competencia}`;
      const atual = mapa.get(chave) ?? { execRel: 0, contabil: 0, liquido: 0, recebido: 0, cv: 0, count: 0 };
      atual.execRel += n.valor_contrato_exec_total;
      atual.contabil += n.vlr_bruto_total;
      atual.liquido += n.vlr_liquido_total;
      atual.recebido += n.valor_pago ?? 0;
      atual.cv += n.desconto_conta_vinculada;
      atual.count += 1;
      mapa.set(chave, atual);
    }
    return mapa;
  }, [nfs]);
  const competenciasComDadosN = useMemo(() => new Set(nfs.filter((n) => n.tipo_nota === "N").map((n) => n.competencia)), [nfs]);

  function linhaDoContrato(c: ContratoERP, mesAlvo: string): LinhaFaturamento {
    const rowsDoContrato = planilhaPorContrato.get(c.id) ?? [];
    const linhasVigentes = resolverLinhasPorPeriodo(rowsDoContrato, c.id, fimDoMes(mesAlvo));
    const executavel = somarCamposEmLinhas(linhasVigentes, ["total_por_empregado"]);
    const agg = nfAggPorContratoCompetencia.get(`${c.id}|${mesAlvo}`) ?? { execRel: 0, contabil: 0, liquido: 0, recebido: 0, cv: 0, count: 0 };
    // SIS-2026-0605 (Iury): a planilha de um contrato encerrado segue com
    // valor depois do fim (Caxias 162, fim 28/02/2026, aparecia "sem
    // lançamento" de mar a set). Depois da data fim do contrato, competência
    // sem nota lançada é "sem vigência", não pendência. Se houver NF lançada
    // (faturamento final fora do mês), a célula continua como lançada.
    if (agg.count === 0 && contratoEncerradoNaCompetencia(c, mesAlvo)) {
      return { contrato: c, executavel: 0, execRel: 0, contabil: 0, liquido: 0, recebido: 0, cv: 0, naoEmitido: 0, excesso: 0, status: "SEM_VIGENCIA" };
    }
    const naoEmitido = faltaDeFaturamento(executavel, agg.contabil);
    const excesso = excessoDeFaturamento(executavel, agg.contabil);
    const status = statusCelula(executavel, agg.count > 0, competenciasComDadosN.has(mesAlvo), agg.contabil);
    return { contrato: c, executavel, execRel: agg.execRel, contabil: agg.contabil, liquido: agg.liquido, recebido: agg.recebido, cv: agg.cv, naoEmitido, excesso, status };
  }

  function ordenarPorEmpresaContrato(a: { contrato: ContratoERP }, b: { contrato: ContratoERP }) {
    const empA = empresaNomePorId.get(a.contrato.empresa_id) ?? "";
    const empB = empresaNomePorId.get(b.contrato.empresa_id) ?? "";
    return empA.localeCompare(empB, "pt-BR") || a.contrato.nome.localeCompare(b.contrato.nome, "pt-BR");
  }

  // ── Visão Geral / NFs Não Emitidas: 1 linha por contrato, na competência
  // selecionada ────────────────────────────────────────────────────────
  const linhasCompetencia = useMemo(
    () =>
      contratosFiltrados
        .map((c) => linhaDoContrato(c, competencia))
        .filter((l) => l.status !== "SEM_VIGENCIA")
        .sort(ordenarPorEmpresaContrato),
    [contratosFiltrados, competencia, planilhaPorContrato, nfAggPorContratoCompetencia, competenciasComDadosN, empresaNomePorId]
  );

  const kpis = useMemo(() => {
    let liquido = 0, recebido = 0;
    for (const l of linhasCompetencia) {
      liquido += l.liquido;
      recebido += l.recebido;
    }
    // Não Emitido = soma das faltas por contrato (excesso de um contrato não
    // abate a falta de outro) — ver faturamentoStatus.ts.
    const { executavel, contabil, naoEmitido, excesso, lancadas, parciais, pendentes, semDados } = resumirFaturamento(linhasCompetencia);
    return {
      vigentes: linhasCompetencia.length,
      lancadas, parciais, pendentes, semDados,
      executavel, contabil, naoEmitido, excesso, liquido, recebido,
      pctNaoEmitido: executavel ? (naoEmitido / executavel) * 100 : 0,
      pctRecebido: contabil ? (recebido / contabil) * 100 : 0,
    };
  }, [linhasCompetencia]);

  const donutStatus = useMemo(
    () =>
      (["NOTAS_LANCADAS", "FATURADO_PARCIAL", "NENHUM_LANCAMENTO", "COMPETENCIA_SEM_DADOS"] as StatusCelula[])
        .map((s) => ({
          status: s,
          nome: STATUS_INFO[s].labelCurto,
          valor: kpis[s === "NOTAS_LANCADAS" ? "lancadas" : s === "FATURADO_PARCIAL" ? "parciais" : s === "NENHUM_LANCAMENTO" ? "pendentes" : "semDados"],
        }))
        .filter((x) => x.valor > 0),
    [kpis]
  );

  // Evolução: últimas 6 competências com alguma NF Código N (de qualquer
  // contrato, respeitando o filtro de empresa), independente do ano/mês
  // selecionado nos outros filtros.
  const evolucao = useMemo(() => {
    const porComp = new Map<string, { comp: string; contabil: number; liquido: number; recebido: number }>();
    for (const n of nfs) {
      if (n.tipo_nota !== "N" || foraDoRelatorio(n) || naoContabilizaKpi(n)) continue;
      if (filtroEmpresa && n.empresa_id !== filtroEmpresa) continue;
      const atual = porComp.get(n.competencia) ?? { comp: n.competencia, contabil: 0, liquido: 0, recebido: 0 };
      atual.contabil += n.vlr_bruto_total;
      atual.liquido += n.vlr_liquido_total;
      atual.recebido += n.valor_pago ?? 0;
      porComp.set(n.competencia, atual);
    }
    return Array.from(porComp.values())
      .sort((a, b) => a.comp.localeCompare(b.comp))
      .slice(-6)
      .map((x) => ({ ...x, label: labelMes(x.comp) }));
  }, [nfs, filtroEmpresa]);

  // ── Visão Anual: matriz contrato × mês do ano selecionado ────────────
  const [filtroStatusAno, setFiltroStatusAno] = useState<StatusCelula | "todos">("todos");
  const linhasAno = useMemo(
    () =>
      contratosFiltrados
        .map((c) => ({ contrato: c, celulas: meses.map((m) => ({ mes: m, ...linhaDoContrato(c, m) })) }))
        .filter((l) => l.celulas.some((c) => c.status !== "SEM_VIGENCIA"))
        .sort(ordenarPorEmpresaContrato),
    [contratosFiltrados, meses, planilhaPorContrato, nfAggPorContratoCompetencia, competenciasComDadosN, empresaNomePorId]
  );
  const linhasAnoFiltradas = useMemo(() => {
    if (filtroStatusAno === "todos") return linhasAno;
    return linhasAno.filter((l) => l.celulas.find((c) => c.mes === competencia)?.status === filtroStatusAno);
  }, [linhasAno, filtroStatusAno, competencia]);

  // Clicar no card "Divergências": divergências de faturamento por contrato —
  // falta emitir (sem NF ou NF abaixo do executável) E emitido a mais (NF acima
  // do executável), do maior desvio pro menor. Card = falta + excesso.
  const [abrirNaoEmitido, setAbrirNaoEmitido] = useState(false);
  const naoEmitidoDetalhe = useMemo(
    () =>
      linhasCompetencia
        .filter((l) => l.naoEmitido > 0 || l.excesso > 0)
        .sort((a, b) => Math.max(b.naoEmitido, b.excesso) - Math.max(a.naoEmitido, a.excesso)),
    [linhasCompetencia]
  );

  // ── NFs Não Emitidas: só os pendentes da competência selecionada ─────
  const pendentesCompetencia = useMemo(
    () => linhasCompetencia.filter((l) => l.status === "NENHUM_LANCAMENTO").sort((a, b) => b.executavel - a.executavel),
    [linhasCompetencia]
  );

  // SIS-2026-0562 (Iury): clicar na linha leva pro Relatório de Serviços
  // (aba Relatório Geral) já com empresa/competência/contrato filtrados —
  // mesmo recorte que gerou os números daquela linha.
  function abrirNoRelatorioServicos(l: LinhaFaturamento) {
    const params = new URLSearchParams({ empresa: l.contrato.empresa_id, competencia, contrato: l.contrato.id });
    navigate(`/app/financeiro/relatorio-servicos?${params.toString()}`);
  }

  const carregando = carregandoContratos || carregandoPlanilha || carregandoNfs;

  const FiltroEmpresaAno = (
    <>
      <Select value={filtroEmpresa || "__todas"} onValueChange={(v) => setFiltroEmpresa(v === "__todas" ? "" : v)}>
        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Empresa" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__todas">Todas as empresas</SelectItem>
          {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
        <SelectTrigger className="h-8 w-24 text-xs"><SelectValue placeholder="Ano" /></SelectTrigger>
        <SelectContent>
          {anosDisponiveis.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={competencia} onValueChange={setCompetenciaSel}>
        <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Competência" /></SelectTrigger>
        <SelectContent>
          {meses.map((m, i) => <SelectItem key={m} value={m}>{MESES_LABEL[i]}/{ano}</SelectItem>)}
        </SelectContent>
      </Select>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        module="Controladoria"
        breadcrumb={["Controle de Faturamento"]}
        title="Controle de Faturamento"
        subtitle="Base de Contratos Vigentes × Relatório de Serviços — só registros Código N contam como lançamento."
      />

      {carregando ? (
        <p className="text-sm text-muted-foreground py-10 text-center">Carregando...</p>
      ) : (
        <Tabs defaultValue="geral">
          <TabsList>
            <TabsTrigger value="geral">Visão Geral</TabsTrigger>
            <TabsTrigger value="anual">Visão Anual</TabsTrigger>
            <TabsTrigger value="pendentes">NFs Não Emitidas{pendentesCompetencia.length > 0 ? ` (${pendentesCompetencia.length})` : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="geral" className="space-y-4 mt-4">
            <div className="card-elevated p-3 flex items-center gap-2 flex-wrap text-xs">
              {FiltroEmpresaAno}
              <span className="text-muted-foreground ml-auto">Competência N: {competenciasComDadosN.has(competencia) ? "com dados no relatório" : "ainda sem dado no relatório"}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiTile label="Executável (Base)" valor={fmtMoney(kpis.executavel)} icon={<ListChecks />} cor="slate" />
              <KpiTile label="Valor Contábil (Código N)" valor={fmtMoney(kpis.contabil)} icon={<TrendingUp />} cor="sky" />
              <KpiTile label="Divergências" valor={fmtMoney(kpis.naoEmitido + kpis.excesso)} sub={`${fmtMoney(kpis.naoEmitido)} a emitir · ${fmtMoney(kpis.excesso)} emitidos a mais · clique para ver por contrato`} icon={<AlertTriangle />} cor="red" valorClass="text-red-600 dark:text-red-400" onClick={() => setAbrirNaoEmitido(true)} />
              <KpiTile label="Contratos Pendentes" valor={kpis.pendentes.toLocaleString("pt-BR")} sub={`de ${kpis.vigentes} vigentes na competência`} icon={<FileWarning />} cor="amber" valorClass="text-amber-600 dark:text-amber-400" />
              <KpiTile label="Valor Líquido" valor={fmtMoney(kpis.liquido)} icon={<Wallet />} cor="slate" />
              <KpiTile label="Valor Recebido" valor={fmtMoney(kpis.recebido)} icon={<CheckCircle2 />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" />
              <KpiTile label="% Recebido sobre Faturado" valor={`${kpis.pctRecebido.toFixed(1).replace(".", ",")}%`} sub={`${fmtMoney(kpis.recebido)} de ${fmtMoney(kpis.contabil)}`} icon={<Percent />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" />
              <KpiTile label="Contratos Faturados" valor={kpis.lancadas.toLocaleString("pt-BR")} sub={kpis.vigentes ? `${((kpis.lancadas / kpis.vigentes) * 100).toFixed(0)}% dos vigentes${kpis.parciais > 0 ? ` · +${kpis.parciais} parcial(is)` : ""}` : undefined} icon={<CheckCircle2 />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" />
            </div>

            {kpis.executavel > 0 && kpis.naoEmitido > 0 && (
              <Card className="border-amber-300 dark:border-amber-900">
                <CardContent className="p-4 flex items-center gap-3">
                  <AlertTriangle className="h-8 w-8 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">Impacto dos não faturados: {kpis.pctNaoEmitido.toFixed(2).replace(".", ",")}%</p>
                    <p className="text-xs text-muted-foreground">{fmtMoney(kpis.naoEmitido)} de {fmtMoney(kpis.executavel)} do faturamento mensal executável em {labelMes(competencia)}.{kpis.excesso > 0 ? ` Contratos com NF acima do executável somam ${fmtMoney(kpis.excesso)} (não abatidos).` : ""}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="flex flex-col">
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Faturamento por status — {labelMes(competencia)}</CardTitle></CardHeader>
                <CardContent className="flex-1">
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart>
                      <Pie data={donutStatus} dataKey="valor" nameKey="nome" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2}>
                        {donutStatus.map((d) => <Cell key={d.status} fill={STATUS_INFO[d.status].dot} />)}
                      </Pie>
                      <Tooltip formatter={(v: number, n: string) => [`${v} contrato(s)`, n]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-3 mt-2 text-[11px] text-muted-foreground">
                    {donutStatus.map((d) => (
                      <span key={d.status} className="inline-flex items-center gap-1.5">
                        <i className="inline-block h-2 w-2 rounded-sm" style={{ background: STATUS_INFO[d.status].dot }} />
                        {d.nome} ({d.valor})
                      </span>
                    ))}
                    {donutStatus.length === 0 && <span>Sem contratos vigentes nessa competência.</span>}
                  </div>
                  {kpis.vigentes > 0 && (
                    <p className="text-center text-xs text-muted-foreground mt-3 pt-3 border-t">
                      <strong className="text-foreground text-base">{((kpis.lancadas / kpis.vigentes) * 100).toFixed(0)}%</strong> dos contratos vigentes faturados por completo — {kpis.lancadas} em dia, {kpis.parciais} parciais, {kpis.pendentes} pendentes.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="flex flex-col">
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Evolução do faturamento — últimas {evolucao.length} competências</CardTitle></CardHeader>
                <CardContent className="flex-1">
                  {evolucao.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-10">Sem NFs Código N lançadas ainda.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={evolucao} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => fmtMoney(v)} width={90} />
                        <Tooltip formatter={(v: number) => fmtMoney(v)} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="contabil" name="Faturado" stroke="#315f99" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="liquido" name="Valor Líquido" stroke="#6976d9" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="recebido" name="Recebido" stroke="#2aa978" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Detalhamento financeiro dos contratos — {labelMes(competencia)}</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Empresa</TableHead>
                        <TableHead>Contrato</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="text-right">Executável (Base)</TableHead>
                        <TableHead className="text-right">Executado (Relatório N)</TableHead>
                        <TableHead className="text-right">Valor Contábil (Código N)</TableHead>
                        <TableHead className="text-right">Não Emitido</TableHead>
                        <TableHead className="text-right">Valor Líquido</TableHead>
                        <TableHead className="text-right">Valor Recebido</TableHead>
                        <TableHead className="text-right">Conta Vinculada</TableHead>
                        <TableHead className="text-right">% Recebido/Faturado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linhasCompetencia.length === 0 && (
                        <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">Sem contratos vigentes para os filtros selecionados.</TableCell></TableRow>
                      )}
                      {linhasCompetencia.map((l) => (
                        <TableRow
                          key={l.contrato.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => abrirNoRelatorioServicos(l)}
                          title="Ver as notas deste contrato/competência no Relatório de Serviços"
                        >
                          <TableCell className="text-sm">{empresaNomePorId.get(l.contrato.empresa_id) ?? "—"}</TableCell>
                          <TableCell className="text-sm font-medium">{l.contrato.nome}</TableCell>
                          <TableCell className="text-center">
                            <span className={cn("inline-block px-2 py-0.5 rounded text-[11px] font-medium", STATUS_INFO[l.status].className)}>{STATUS_INFO[l.status].labelCurto}</span>
                          </TableCell>
                          <TableCell className="text-right text-sm">{fmtMoney(l.executavel)}</TableCell>
                          <TableCell className="text-right text-sm">{fmtMoney(l.execRel)}</TableCell>
                          <TableCell className="text-right text-sm">{fmtMoney(l.contabil)}</TableCell>
                          <TableCell className={cn("text-right text-sm", l.naoEmitido > 0 && "text-red-600 dark:text-red-400 font-medium")}>{fmtMoney(l.naoEmitido)}</TableCell>
                          <TableCell className="text-right text-sm">{fmtMoney(l.liquido)}</TableCell>
                          <TableCell className="text-right text-sm">{fmtMoney(l.recebido)}</TableCell>
                          <TableCell className="text-right text-sm">{fmtMoney(l.cv)}</TableCell>
                          <TableCell className="text-right text-sm">{l.contabil ? `${((l.recebido / l.contabil) * 100).toFixed(2).replace(".", ",")}%` : "0,00%"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    {linhasCompetencia.length > 0 && (
                      <TableFooter>
                        <TableRow className="font-semibold bg-muted/40">
                          <TableCell colSpan={3}>TOTAL</TableCell>
                          <TableCell className="text-right">{fmtMoney(kpis.executavel)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(linhasCompetencia.reduce((s, l) => s + l.execRel, 0))}</TableCell>
                          <TableCell className="text-right">{fmtMoney(kpis.contabil)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(kpis.naoEmitido)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(kpis.liquido)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(kpis.recebido)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(linhasCompetencia.reduce((s, l) => s + l.cv, 0))}</TableCell>
                          <TableCell className="text-right">{kpis.contabil ? `${kpis.pctRecebido.toFixed(2).replace(".", ",")}%` : "0,00%"}</TableCell>
                        </TableRow>
                      </TableFooter>
                    )}
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="anual" className="space-y-4 mt-4">
            <div className="card-elevated p-3 flex items-center gap-2 flex-wrap text-xs">
              {FiltroEmpresaAno}
              <Select value={filtroStatusAno} onValueChange={(v) => setFiltroStatusAno(v as StatusCelula | "todos")}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Status na competência" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os status</SelectItem>
                  {(Object.keys(STATUS_INFO) as StatusCelula[]).map((s) => <SelectItem key={s} value={s}>{STATUS_INFO[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground ml-auto">Filtro de status usa a competência selecionada acima; a matriz sempre mostra o ano inteiro.</span>
            </div>

            <Card>
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center gap-3 p-3 text-[11px] text-muted-foreground border-b">
                  {(Object.keys(STATUS_INFO) as StatusCelula[]).map((s) => (
                    <span key={s} className="inline-flex items-center gap-1.5">
                      <i className={cn("inline-block h-2.5 w-2.5 rounded-sm", STATUS_INFO[s].className)} />
                      {STATUS_INFO[s].label}
                    </span>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background min-w-[220px]">Contrato</TableHead>
                        {meses.map((m, i) => (
                          <TableHead key={m} className={cn("text-center px-2", m === competencia && "text-primary font-semibold")}>{MESES_LABEL[i]}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linhasAnoFiltradas.length === 0 && (
                        <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">Sem contratos para os filtros selecionados.</TableCell></TableRow>
                      )}
                      {linhasAnoFiltradas.map((l) => (
                        <TableRow key={l.contrato.id}>
                          <TableCell className="sticky left-0 bg-background text-sm">
                            <div className="font-medium truncate max-w-[220px]" title={l.contrato.nome}>{l.contrato.nome}</div>
                            <div className="text-[11px] text-muted-foreground">{empresaNomePorId.get(l.contrato.empresa_id) ?? "—"}</div>
                          </TableCell>
                          {l.celulas.map((c) => (
                            <TableCell key={c.mes} className="p-1 text-center">
                              <div
                                className={cn("h-7 rounded flex items-center justify-center text-[10px] font-medium", STATUS_INFO[c.status].className)}
                                title={`${STATUS_INFO[c.status].label} — executável ${fmtMoney(c.executavel)}`}
                              >
                                {c.executavel > 0 ? fmtMoney(c.executavel).replace("R$", "").trim() : ""}
                              </div>
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pendentes" className="space-y-4 mt-4">
            <div className="card-elevated p-3 flex items-center gap-2 flex-wrap text-xs">
              {FiltroEmpresaAno}
            </div>
            <p className="text-sm text-muted-foreground">Contratos vigentes em {labelMes(competencia)} sem nenhuma NF Código N lançada — priorizados pelo maior valor executável.</p>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Contrato</TableHead>
                      <TableHead className="text-right">Valor Executável (Base)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendentesCompetencia.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Nenhum contrato pendente — tudo faturado nessa competência.</TableCell></TableRow>
                    )}
                    {pendentesCompetencia.map((l) => (
                      <TableRow key={l.contrato.id}>
                        <TableCell className="text-sm">{empresaNomePorId.get(l.contrato.empresa_id) ?? "—"}</TableCell>
                        <TableCell className="text-sm font-medium">{l.contrato.nome}</TableCell>
                        <TableCell className="text-right text-sm font-medium text-red-600 dark:text-red-400">{fmtMoney(l.executavel)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={abrirNaoEmitido} onOpenChange={setAbrirNaoEmitido}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Divergências de faturamento — {labelMes(competencia)}</DialogTitle>
            <DialogDescription>
              Contratos em que o valor contábil lançado (Código N) difere do executável da Base: o que ainda falta emitir e o que foi emitido a mais.
              Clique numa linha para ver as notas.
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-2">Contrato</TableHead>
                <TableHead className="px-2 text-center">Situação</TableHead>
                <TableHead className="px-2 text-right">Executável</TableHead>
                <TableHead className="px-2 text-right">Lançado (N)</TableHead>
                <TableHead className="px-2 text-right">Falta emitir</TableHead>
                <TableHead className="px-2 text-right">Emitido a mais</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {naoEmitidoDetalhe.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma divergência nessa competência.</TableCell></TableRow>
              )}
              {naoEmitidoDetalhe.map((l) => (
                <TableRow key={l.contrato.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setAbrirNaoEmitido(false); abrirNoRelatorioServicos(l); }}>
                  <TableCell className="px-2 py-2">
                    <div className="text-sm font-medium leading-tight">{l.contrato.nome}</div>
                    <div className="text-[11px] text-muted-foreground">{empresaNomePorId.get(l.contrato.empresa_id) ?? "—"}</div>
                  </TableCell>
                  <TableCell className="px-2 py-2 text-center">
                    <span className={cn("inline-block px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap", STATUS_INFO[l.status].className)}>{STATUS_INFO[l.status].labelCurto}</span>
                  </TableCell>
                  <TableCell className="px-2 py-2 text-right text-sm whitespace-nowrap">{fmtMoney(l.executavel)}</TableCell>
                  <TableCell className="px-2 py-2 text-right text-sm whitespace-nowrap">{fmtMoney(l.contabil)}</TableCell>
                  <TableCell className={cn("px-2 py-2 text-right text-sm whitespace-nowrap", l.naoEmitido > 0 && "font-semibold text-red-600 dark:text-red-400")}>{l.naoEmitido > 0 ? fmtMoney(l.naoEmitido) : "—"}</TableCell>
                  <TableCell className={cn("px-2 py-2 text-right text-sm whitespace-nowrap", l.excesso > 0 && "font-semibold text-sky-600 dark:text-sky-400")}>{l.excesso > 0 ? fmtMoney(l.excesso) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {naoEmitidoDetalhe.length > 0 && (
              <TableFooter>
                <TableRow className="font-semibold bg-muted/40">
                  <TableCell colSpan={4} className="px-2">TOTAL ({naoEmitidoDetalhe.length} contrato(s))</TableCell>
                  <TableCell className="px-2 text-right whitespace-nowrap text-red-600 dark:text-red-400">{fmtMoney(kpis.naoEmitido)}</TableCell>
                  <TableCell className="px-2 text-right whitespace-nowrap text-sky-600 dark:text-sky-400">{fmtMoney(kpis.excesso)}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
          {kpis.excesso > 0 && (
            <p className="text-xs text-muted-foreground">
              O excesso emitido a mais não é abatido da falta a emitir (o card soma as duas pontas em valor absoluto). Saldo líquido do mês: {fmtMoney(Math.abs(kpis.excesso - kpis.naoEmitido))}{" "}
              {kpis.excesso - kpis.naoEmitido >= 0 ? "a mais emitido" : "a emitir"}.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
