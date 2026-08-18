import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, X, Clock, CheckCircle2, Wallet, PieChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useContratosERP } from "@/hooks/useContratosERP";
import { useClassificacoesOrcamentoAdmin, usePlanejamentosOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useLigacoesAdministrativoClassificacao } from "@/hooks/useMaloteAdministrativoClassificacaoLink";
import { useOrcamentoContratos } from "@/hooks/useOrcamentoContratos";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { anoMesAtual, fimDoMes, formatBRL } from "@/hooks/usePlanilhaCusto";
import { STATUS_LABEL, STATUS_BADGE_CLASS } from "@/hooks/useMaloteDespesa";
import { getStatusVigencia, fmtMoney, fmtPct, fmtDate, competenciaNoPeriodo } from "./orcamentoUtils";
import { OrcamentoTabsNav } from "./OrcamentoTabsNav";

const MESES = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12",
];

// Mesma técnica visual de KpiTile já usada em FluxoCaixaGestao.tsx.
const KPI_TILE_ICONE: Record<string, string> = {
  sky: "text-sky-300 dark:text-sky-800",
  emerald: "text-emerald-300 dark:text-emerald-800",
  slate: "text-slate-300 dark:text-slate-700",
  violet: "text-violet-300 dark:text-violet-800",
};

function KpiTile({
  label,
  valor,
  icon,
  cor,
  valorClass,
  extra,
}: {
  label: string;
  valor: string;
  icon: React.ReactNode;
  cor: keyof typeof KPI_TILE_ICONE;
  valorClass?: string;
  extra?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="relative overflow-hidden p-4">
        <div
          className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1"
          style={{
            WebkitMaskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
            maskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
          }}
        >
          <span className={cn("[&>svg]:h-16 [&>svg]:w-16", KPI_TILE_ICONE[cor])}>{icon}</span>
        </div>
        <p className="relative z-10 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("relative z-10 text-2xl font-bold mt-1", valorClass)}>{valor}</p>
        {extra && <div className="relative z-10 mt-1">{extra}</div>}
      </CardContent>
    </Card>
  );
}

function BarraUtilizado({ orcado, utilizado }: { orcado: number; utilizado: number }) {
  if (!orcado) return null;
  const pct = (utilizado / orcado) * 100;
  const cor = pct > 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={cn("h-full rounded-full", cor)} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

// SIS-2026-0168 (Anexo 4): tela de detalhe alcançada pelo botão "Ver
// detalhes" de uma linha do Orçamento Geral — mesma origem/regras de
// cálculo daquela tela (ver OrcamentoGeral.tsx), só que focada em 1
// Classificação (+ Contrato, se for do tipo Contrato) por vez, mostrando os
// lançamentos individuais que compõem o Utilizado.
export default function DetalheOrcamento() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const anoInicial = searchParams.get("ano") || anoMesAtual().split("-")[0];
  const mesInicial = searchParams.get("mes") || anoMesAtual().split("-")[1];

  const [anoDraft, setAnoDraft] = useState(anoInicial);
  const [mesDraft, setMesDraft] = useState(mesInicial);
  const [classificacaoDraft, setClassificacaoDraft] = useState(searchParams.get("classificacaoId") || "");
  const [contratoDraft, setContratoDraft] = useState(searchParams.get("contratoId") || "");

  const [filtro, setFiltro] = useState({
    anoMes: `${anoInicial}-${mesInicial}`,
    classificacaoId: searchParams.get("classificacaoId") || "",
    contratoId: searchParams.get("contratoId") || "",
  });

  function aplicarFiltros() {
    setFiltro({ anoMes: `${anoDraft}-${mesDraft}`, classificacaoId: classificacaoDraft, contratoId: contratoDraft });
  }

  function limparFiltros() {
    const atual = anoMesAtual().split("-");
    setAnoDraft(atual[0]);
    setMesDraft(atual[1]);
    setClassificacaoDraft("");
    setContratoDraft("");
    setFiltro({ anoMes: anoMesAtual(), classificacaoId: "", contratoId: "" });
  }

  const { data: empresaId } = useEmpresaId();
  const { data: classificacoes = [] } = useClassificacoesOrcamentoAdmin();
  const { data: contratos = [] } = useContratosERP();
  const { data: orcamentosAdm = [] } = usePlanejamentosOrcamento(empresaId);
  const { data: ligacoesAdm = [] } = useLigacoesAdministrativoClassificacao();
  const { data: gruposContrato = [], isLoading: carregandoContrato } = useOrcamentoContratos(filtro.anoMes);
  const { data: utilizadoLinhas = [], isLoading: carregandoUtilizado } = useUtilizadoOrcamento();

  const referenciaPeriodo = useMemo(() => fimDoMes(filtro.anoMes), [filtro.anoMes]);

  const classificacaoSelecionada = useMemo(
    () => classificacoes.find((c) => c.id === filtro.classificacaoId) ?? null,
    [classificacoes, filtro.classificacaoId]
  );

  const maloteIdPorAdministrativa = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of ligacoesAdm) map.set(l.classificacao_administrativa_id, l.classificacao_malote_id);
    return map;
  }, [ligacoesAdm]);

  // Orçado (mesma regra do OrcamentoGeral.tsx — item 6/7 do plano): pra
  // Classificação do tipo Administrativo, soma planejamento_orcamentario
  // cuja vigência cobre o período; pra tipo Contrato, usa a rubrica já
  // resolvida por período em useOrcamentoContratos. Sem Classificação
  // selecionada mas com Contrato ("ver detalhes gerais do contrato"), soma
  // todas as rubricas ligadas daquele contrato (mesmo total de orcadoTotal
  // no accordion do Orçamento Geral). Sem nenhum dos dois, "—".
  const orcado = useMemo(() => {
    if (!filtro.classificacaoId) {
      if (!filtro.contratoId) return null;
      const grupo = gruposContrato.find((g) => g.contrato.id === filtro.contratoId);
      if (!grupo) return 0;
      return grupo.rubricas.filter((r) => r.classificacaoMaloteId).reduce((s, r) => s + r.valor, 0);
    }
    if (!classificacaoSelecionada) return null;
    if (classificacaoSelecionada.tipo === "contrato") {
      if (!filtro.contratoId) return null;
      const grupo = gruposContrato.find((g) => g.contrato.id === filtro.contratoId);
      if (!grupo) return 0;
      return grupo.rubricas
        .filter((r) => r.classificacaoMaloteId === filtro.classificacaoId)
        .reduce((s, r) => s + r.valor, 0);
    }
    let soma = 0;
    for (const o of orcamentosAdm) {
      if (maloteIdPorAdministrativa.get(o.classificacao_id) !== filtro.classificacaoId) continue;
      if (getStatusVigencia(o.inicio_vigencia, o.fim_vigencia, referenciaPeriodo) !== "na_vigencia") continue;
      soma += Number(o.valor) || 0;
    }
    return soma;
  }, [classificacaoSelecionada, filtro.classificacaoId, filtro.contratoId, gruposContrato, orcamentosAdm, maloteIdPorAdministrativa, referenciaPeriodo]);

  const itens = useMemo(() => {
    return utilizadoLinhas.filter((l) => {
      if (!competenciaNoPeriodo(l.competencia, filtro.anoMes)) return false;
      if (filtro.classificacaoId && l.classificacao_id !== filtro.classificacaoId) return false;
      if (filtro.contratoId && l.contrato_id !== filtro.contratoId) return false;
      return true;
    });
  }, [utilizadoLinhas, filtro]);

  const utilizado = useMemo(() => itens.reduce((s, l) => s + (Number(l.valor) || 0), 0), [itens]);
  const qtdAguardando = useMemo(() => itens.filter((l) => l.status === "aguardando_pagamento").length, [itens]);
  const qtdPaga = useMemo(() => itens.filter((l) => l.status === "despesa_paga").length, [itens]);

  const isLoading = carregandoContrato || carregandoUtilizado;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Detalhe Orçamento"
        subtitle="Acompanhe os pagamentos do malote e o consumo do orçamento por classificação."
        module="Malote"
        breadcrumb={["Malote", "Orçamento Geral", "Detalhe Orçamento"]}
        actions={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar
          </Button>
        }
      />

      <OrcamentoTabsNav />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Filtros</p>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={limparFiltros}>
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-end">
            <div>
              <Label className="text-xs">Ano</Label>
              <Select value={anoDraft} onValueChange={setAnoDraft}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 6 }, (_, i) => String(Number(anoMesAtual().split("-")[0]) - 2 + i)).map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Mês</Label>
              <Select value={mesDraft} onValueChange={setMesDraft}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MESES.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Classificação</Label>
              <Select value={classificacaoDraft || "todas"} onValueChange={(v) => setClassificacaoDraft(v === "todas" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {classificacoes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Contrato</Label>
              <Select value={contratoDraft || "todos"} onValueChange={(v) => setContratoDraft(v === "todos" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {contratos.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="h-9" onClick={aplicarFiltros}>Filtrar</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile label="Aguardando Pagamento" valor={String(qtdAguardando)} icon={<Clock />} cor="sky" />
        <KpiTile label="Despesa Paga" valor={String(qtdPaga)} icon={<CheckCircle2 />} cor="emerald" />
        <KpiTile label="Total Orçamento" valor={orcado != null ? fmtMoney(orcado) : "—"} icon={<Wallet />} cor="slate" />
        <KpiTile
          label="% Utilizado"
          valor={orcado != null ? fmtPct(utilizado, orcado) : "—"}
          icon={<PieChart />}
          cor="violet"
          extra={orcado != null && orcado > 0 ? <BarraUtilizado orcado={orcado} utilizado={utilizado} /> : undefined}
        />
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">Itens Lançados</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Classificação</TableHead>
                  <TableHead>Nome da Despesa</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Forma de Pagamento</TableHead>
                  <TableHead className="text-right">Valor (R$)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Orçamento (R$)</TableHead>
                  <TableHead>% Utilizado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10">Carregando...</TableCell>
                  </TableRow>
                )}
                {!isLoading && itens.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                      Nenhum lançamento encontrado com os filtros atuais.
                    </TableCell>
                  </TableRow>
                )}
                {itens.map((l) => (
                  <TableRow key={l.despesa_id}>
                    <TableCell className="text-sm">{fmtDate(l.data_pagamento)}</TableCell>
                    <TableCell className="text-sm">{l.classificacao_nome ?? "—"}</TableCell>
                    <TableCell className="text-sm">{l.descricao}</TableCell>
                    <TableCell className="text-sm">{l.empresa_nome ?? "—"}</TableCell>
                    <TableCell className="text-sm">{l.contrato_nome ?? "—"}</TableCell>
                    <TableCell className="text-sm">{l.forma_pagamento ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm font-medium">{formatBRL(l.valor)}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE_CLASS[l.status]}>{STATUS_LABEL[l.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">{orcado != null ? fmtMoney(orcado) : "—"}</TableCell>
                    <TableCell className="text-sm">{orcado != null ? fmtPct(utilizado, orcado) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {itens.length > 0 && (
            <p className="text-xs text-muted-foreground pt-1">Mostrando {itens.length} registro{itens.length === 1 ? "" : "s"}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
