import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Building2, Briefcase, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { usePlanejamentosOrcamento, useClassificacoesOrcamentoAdmin, ClassificacaoOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useLigacoesAdministrativoClassificacao } from "@/hooks/useMaloteAdministrativoClassificacaoLink";
import { useOrcamentoContratos } from "@/hooks/useOrcamentoContratos";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { anoMesAtual, fimDoMes } from "@/hooks/usePlanilhaCusto";
import { getStatusVigencia, STATUS_LABEL, STATUS_BADGE_CLASS, StatusVigencia, fmtMoney, fmtPct, competenciaNoPeriodo } from "./orcamentoUtils";
import { LigacaoSectionBanner } from "./LigacaoLicitacaoClassificacao";
import { OrcamentoTabsNav } from "./OrcamentoTabsNav";

type OrigemOrcamento = "administrativo" | "contrato";

interface LinhaAdmGeral {
  classificacaoMalote: ClassificacaoOrcamento;
  detalhes: string;
  orcado: number;
  utilizado: number;
  status: StatusVigencia;
}

interface LinhaContratoGeral {
  classificacaoMalote: ClassificacaoOrcamento;
  orcado: number;
  utilizado: number;
}

interface ContratoGeralGrupo {
  contratoId: string;
  contratoNome: string;
  contratoCliente: string;
  linhas: LinhaContratoGeral[];
  orcadoTotal: number;
  utilizadoTotal: number;
}

// Prioridade pra escolher 1 status quando vários lançamentos administrativos
// (com detalhes/vigências diferentes) somam pra mesma Classificação Malote.
const PRIORIDADE_STATUS: StatusVigencia[] = ["na_vigencia", "entrara_em_vigencia", "historico"];

function fmtAprovador(nome: string | null | undefined, limitePct: number | null | undefined) {
  if (!nome) return "—";
  return limitePct != null ? `${nome} — até ${limitePct}%` : nome;
}

function AprovadorCell({ nome, limitePct }: { nome: string | null | undefined; limitePct?: number | null }) {
  if (!nome) return <span className="text-muted-foreground">—</span>;
  const primeiroNome = nome.split(" ")[0];
  const label = limitePct != null ? `${primeiroNome} ${limitePct}%` : primeiroNome;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-2">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{fmtAprovador(nome, limitePct)}</TooltipContent>
    </Tooltip>
  );
}

function LinhaAprovadores({ c }: { c: ClassificacaoOrcamento }) {
  return (
    <>
      <TableCell className="whitespace-nowrap">
        <AprovadorCell nome={c.aprovador_solicitacao_nome} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <AprovadorCell nome={c.aprovador1_nome} limitePct={c.aprovador1_limite_pct} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <AprovadorCell nome={c.aprovador2_nome} limitePct={c.aprovador2_limite_pct} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <AprovadorCell nome={c.aprovador3_nome} limitePct={c.aprovador3_limite_pct} />
      </TableCell>
    </>
  );
}

// Barra de % Utilizado (SIS-2026-0168) — verde até 80%, âmbar até 100%,
// vermelho acima (é permitido ultrapassar 100%, só muda a cor de alerta).
function BarraUtilizado({ orcado, utilizado }: { orcado: number; utilizado: number }) {
  if (!orcado) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = (utilizado / orcado) * 100;
  const cor = pct > 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", cor)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums w-16 text-right">{pct.toFixed(1)}%</span>
    </div>
  );
}

function BotaoVerDetalhes({
  anoMes,
  classificacaoId,
  contratoId,
  label = "Ver detalhes",
}: {
  anoMes: string;
  classificacaoId?: string;
  contratoId?: string;
  label?: string;
}) {
  const navigate = useNavigate();
  const [ano, mes] = anoMes.split("-");
  const params = new URLSearchParams({ ano, mes });
  if (classificacaoId) params.set("classificacaoId", classificacaoId);
  if (contratoId) params.set("contratoId", contratoId);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/app/malote/detalhe-orcamento?${params.toString()}`);
          }}
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Orçamento Geral (SIS-2026-0125, ajustado após SIS-2026-0168): alimentado
// única e exclusivamente pela Classificação do Malote — cada linha
// representa 1 Classificação Malote, comparando Orçado (vigência/orçamento
// que cobre o Ano/Mês selecionado) x Utilizado (lançamentos reais do
// Malote com status Aguardando Pagamento ou Despesa Paga naquele período).
// Sem ligação, a Classificação Malote não aparece aqui — pra isso existem
// as telas "puras" (Orçamento Administrativo e Orçamento de Contratos).
export default function OrcamentoGeral() {
  const { data: empresaId } = useEmpresaId();
  const { data: orcamentosAdm = [], isLoading: carregandoAdm } = usePlanejamentosOrcamento(empresaId);
  const [anoMes, setAnoMes] = useState(anoMesAtual());
  const { data: gruposContrato, isLoading: carregandoContrato } = useOrcamentoContratos(anoMes);
  const { data: ligacoesAdm = [] } = useLigacoesAdministrativoClassificacao();
  const { data: classificacoesMalote = [] } = useClassificacoesOrcamentoAdmin();
  const { data: utilizadoLinhas = [], isLoading: carregandoUtilizado } = useUtilizadoOrcamento();

  const [filtroOrigem, setFiltroOrigem] = useState<"todas" | OrigemOrcamento>("todas");
  const [busca, setBusca] = useState("");
  const [ocultarHistorico, setOcultarHistorico] = useState(true);

  const referenciaPeriodo = useMemo(() => fimDoMes(anoMes), [anoMes]);

  const classificacaoMalotePorId = useMemo(() => {
    const map = new Map<string, ClassificacaoOrcamento>();
    for (const c of classificacoesMalote) map.set(c.id, c);
    return map;
  }, [classificacoesMalote]);

  const maloteIdPorAdministrativa = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of ligacoesAdm) map.set(l.classificacao_administrativa_id, l.classificacao_malote_id);
    return map;
  }, [ligacoesAdm]);

  // Utilizado (SIS-2026-0168): soma dos lançamentos do Malote (Aguardando
  // Pagamento / Despesa Paga) do período selecionado, separado em
  // "sem contrato" (alimenta o bloco Administrativo) e "por contrato"
  // (alimenta o bloco Contratos) — mesma Classificação pode ter lançamentos
  // dos dois tipos, então não dá pra somar tudo junto.
  const { utilizadoAdmPorClassificacao, utilizadoContratoPorChave } = useMemo(() => {
    const adm = new Map<string, number>();
    const contrato = new Map<string, number>();
    for (const l of utilizadoLinhas) {
      if (!l.classificacao_id || !competenciaNoPeriodo(l.competencia, anoMes)) continue;
      const valor = Number(l.valor) || 0;
      if (l.contrato_id) {
        const chave = `${l.classificacao_id}|${l.contrato_id}`;
        contrato.set(chave, (contrato.get(chave) ?? 0) + valor);
      } else {
        adm.set(l.classificacao_id, (adm.get(l.classificacao_id) ?? 0) + valor);
      }
    }
    return { utilizadoAdmPorClassificacao: adm, utilizadoContratoPorChave: contrato };
  }, [utilizadoLinhas, anoMes]);

  const linhasAdm: LinhaAdmGeral[] = useMemo(() => {
    const acumulado = new Map<string, { orcado: number; detalhes: Set<string>; status: Set<StatusVigencia> }>();
    for (const o of orcamentosAdm) {
      // Regra 1 do Anexo 1: a vigência que conta é a que cobre o Ano/Mês
      // selecionado (referenciaPeriodo), não "hoje" — mesmo que hoje ela já
      // esteja Histórico ou ainda "Vai entrar em vigência".
      const cobrePeriodo = getStatusVigencia(o.inicio_vigencia, o.fim_vigencia, referenciaPeriodo) === "na_vigencia";
      if (!cobrePeriodo) continue;
      const maloteId = maloteIdPorAdministrativa.get(o.classificacao_id);
      if (!maloteId) continue;
      // Badge de status exibido continua relativo a hoje (informativo) —
      // separado da resolução do valor, que já é period-aware acima.
      const statusHoje = getStatusVigencia(o.inicio_vigencia, o.fim_vigencia);
      const atual = acumulado.get(maloteId) ?? { orcado: 0, detalhes: new Set<string>(), status: new Set<StatusVigencia>() };
      atual.orcado += Number(o.valor) || 0;
      atual.detalhes.add(o.detalhe);
      atual.status.add(statusHoje);
      acumulado.set(maloteId, atual);
    }
    const resultado: LinhaAdmGeral[] = [];
    acumulado.forEach((v, maloteId) => {
      const classificacaoMalote = classificacaoMalotePorId.get(maloteId);
      if (!classificacaoMalote) return;
      const statusFinal = PRIORIDADE_STATUS.find((s) => v.status.has(s)) ?? "historico";
      if (ocultarHistorico && statusFinal === "historico") return;
      resultado.push({
        classificacaoMalote,
        detalhes: Array.from(v.detalhes).join(", "),
        orcado: v.orcado,
        utilizado: utilizadoAdmPorClassificacao.get(maloteId) ?? 0,
        status: statusFinal,
      });
    });
    return resultado;
  }, [orcamentosAdm, maloteIdPorAdministrativa, classificacaoMalotePorId, referenciaPeriodo, ocultarHistorico, utilizadoAdmPorClassificacao]);

  const gruposContratoGeral: ContratoGeralGrupo[] = useMemo(() => {
    return (gruposContrato ?? [])
      .map((g) => {
        const acumulado = new Map<string, number>();
        for (const r of g.rubricas) {
          if (!r.classificacaoMaloteId) continue;
          acumulado.set(r.classificacaoMaloteId, (acumulado.get(r.classificacaoMaloteId) ?? 0) + r.valor);
        }
        const linhas: LinhaContratoGeral[] = [];
        acumulado.forEach((orcado, maloteId) => {
          const classificacaoMalote = classificacaoMalotePorId.get(maloteId);
          if (!classificacaoMalote) return;
          const chave = `${maloteId}|${g.contrato.id}`;
          linhas.push({ classificacaoMalote, orcado, utilizado: utilizadoContratoPorChave.get(chave) ?? 0 });
        });
        return {
          contratoId: g.contrato.id,
          contratoNome: g.contrato.nome,
          contratoCliente: g.contrato.cliente,
          linhas,
          orcadoTotal: linhas.reduce((s, l) => s + l.orcado, 0),
          utilizadoTotal: linhas.reduce((s, l) => s + l.utilizado, 0),
        };
      })
      .filter((g) => g.linhas.length > 0);
  }, [gruposContrato, classificacaoMalotePorId, utilizadoContratoPorChave]);

  const linhasAdmFiltradas = useMemo(() => {
    if (!busca.trim()) return linhasAdm;
    const alvo = busca.toLowerCase();
    return linhasAdm.filter((l) => l.classificacaoMalote.nome.toLowerCase().includes(alvo) || l.detalhes.toLowerCase().includes(alvo));
  }, [linhasAdm, busca]);

  const gruposContratoFiltrados = useMemo(() => {
    if (!busca.trim()) return gruposContratoGeral;
    const alvo = busca.toLowerCase();
    return gruposContratoGeral.filter(
      (g) =>
        g.contratoNome.toLowerCase().includes(alvo) ||
        g.contratoCliente.toLowerCase().includes(alvo) ||
        g.linhas.some((l) => l.classificacaoMalote.nome.toLowerCase().includes(alvo))
    );
  }, [gruposContratoGeral, busca]);

  const mostrarAdm = filtroOrigem !== "contrato";
  const mostrarContrato = filtroOrigem !== "administrativo";

  const orcadoTotal = useMemo(() => {
    const totalAdm = mostrarAdm ? linhasAdmFiltradas.reduce((s, l) => s + l.orcado, 0) : 0;
    const totalContrato = mostrarContrato ? gruposContratoFiltrados.reduce((s, g) => s + g.orcadoTotal, 0) : 0;
    return totalAdm + totalContrato;
  }, [mostrarAdm, mostrarContrato, linhasAdmFiltradas, gruposContratoFiltrados]);

  const utilizadoTotal = useMemo(() => {
    const totalAdm = mostrarAdm ? linhasAdmFiltradas.reduce((s, l) => s + l.utilizado, 0) : 0;
    const totalContrato = mostrarContrato ? gruposContratoFiltrados.reduce((s, g) => s + g.utilizadoTotal, 0) : 0;
    return totalAdm + totalContrato;
  }, [mostrarAdm, mostrarContrato, linhasAdmFiltradas, gruposContratoFiltrados]);

  const linhasTotal = (mostrarAdm ? linhasAdmFiltradas.length : 0) + (mostrarContrato ? gruposContratoFiltrados.reduce((s, g) => s + g.linhas.length, 0) : 0);
  const isLoading = carregandoAdm || carregandoContrato || carregandoUtilizado;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Orçamento Geral"
        subtitle="Visão por Classificação do Malote — Orçado x Utilizado no Ano/Mês selecionado, somando Administrativo e Contratos."
        module="Malote"
        breadcrumb={["Malote", "Classificações e Orçamentos", "Orçamento Geral"]}
      />

      <OrcamentoTabsNav />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Linhas de orçamento</CardDescription>
            <CardTitle className="text-3xl">{linhasTotal}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Orçado</CardDescription>
            <CardTitle className="text-2xl">{fmtMoney(orcadoTotal)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Utilizado</CardDescription>
            <CardTitle className="text-2xl">{fmtMoney(utilizadoTotal)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>% utilizado</CardDescription>
            <CardTitle className="text-2xl">{fmtPct(utilizadoTotal, orcadoTotal)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <p className="text-muted-foreground">
          Só aparecem aqui Classificações do Malote com pelo menos uma ligação cadastrada (Configurações →
          Ligações). Orçado e Utilizado são resolvidos pelo Ano/Mês selecionado abaixo — pra ver tudo sem depender
          de ligação ou de período, use Orçamento Administrativo ou Orçamento de Contratos.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">Filtros</CardTitle>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <Checkbox checked={ocultarHistorico} onCheckedChange={(c) => setOcultarHistorico(c === true)} />
            Ocultar histórico
          </label>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Ano/Mês</Label>
            <Input type="month" value={anoMes} onChange={(e) => setAnoMes(e.target.value || anoMesAtual())} />
          </div>
          <div>
            <Label className="text-xs">Origem</Label>
            <Select value={filtroOrigem} onValueChange={(v) => setFiltroOrigem(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="administrativo">Administrativo</SelectItem>
                <SelectItem value="contrato">Contrato</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Buscar</Label>
            <Input
              placeholder="Classificação, detalhe ou contrato..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {mostrarAdm && (
        <div>
          <LigacaoSectionBanner
            titulo="Administrativo"
            subtitulo="Classificações do Malote alimentadas pelo Orçamento Administrativo, via ligação."
            icon={<Building2 />}
            cor="blue"
          />
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Classificação Malote</TableHead>
                  <TableHead>Detalhe(s)</TableHead>
                  <TableHead>
                    <span className="inline-flex items-center gap-1">
                      Aprovador Solicitação
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">
                          Aprovador da solicitação, definido na Classificação do Malote correspondente.
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </TableHead>
                  <TableHead>Aprovador 1</TableHead>
                  <TableHead>Aprovador 2</TableHead>
                  <TableHead>Aprovador 3</TableHead>
                  <TableHead className="text-right">Orçado</TableHead>
                  <TableHead className="text-right">Utilizado</TableHead>
                  <TableHead>% Utilizado</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                      Carregando...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && linhasAdmFiltradas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                      Nenhuma Classificação Malote administrativa com ligação e orçamento encontrada.
                    </TableCell>
                  </TableRow>
                )}
                {linhasAdmFiltradas.map((l) => (
                  <TableRow key={l.classificacaoMalote.id}>
                    <TableCell className="font-medium">{l.classificacaoMalote.nome}</TableCell>
                    <TableCell className="max-w-64 truncate" title={l.detalhes}>
                      {l.detalhes}
                    </TableCell>
                    <LinhaAprovadores c={l.classificacaoMalote} />
                    <TableCell className="text-right">{fmtMoney(l.orcado)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(l.utilizado)}</TableCell>
                    <TableCell>
                      <BarraUtilizado orcado={l.orcado} utilizado={l.utilizado} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge className={cn(STATUS_BADGE_CLASS[l.status], "whitespace-nowrap")}>{STATUS_LABEL[l.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      <BotaoVerDetalhes anoMes={anoMes} classificacaoId={l.classificacaoMalote.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </div>
      )}

      {mostrarContrato && (
        <div>
          <LigacaoSectionBanner
            titulo="Contratos"
            subtitulo="Classificações do Malote alimentadas pelas rubricas da Planilha de Custo, via ligação."
            icon={<Briefcase />}
            cor="amber"
          />
        <Card>
          <CardContent className="pt-6">
            {isLoading && <p className="text-center text-muted-foreground py-8">Carregando...</p>}
            {!isLoading && gruposContratoFiltrados.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                Nenhuma Classificação Malote de contrato com ligação e orçamento encontrada.
              </p>
            )}
            {!isLoading && gruposContratoFiltrados.length > 0 && (
              <Accordion type="multiple" className="w-full">
                {gruposContratoFiltrados.map((g) => (
                  <AccordionItem key={g.contratoId} value={g.contratoId}>
                    <div className="flex items-center gap-3 pr-2">
                      <div className="flex-1 min-w-0">
                        <AccordionTrigger className="hover:no-underline w-full">
                          <div className="text-left">
                            <p className="font-medium">{g.contratoNome}</p>
                            <p className="text-xs text-muted-foreground font-normal">{g.contratoCliente}</p>
                          </div>
                        </AccordionTrigger>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <p className="text-sm text-muted-foreground whitespace-nowrap">
                          Orçado <span className="font-semibold text-foreground">{fmtMoney(g.orcadoTotal)}</span> · Utilizado{" "}
                          <span className="font-semibold text-foreground">{fmtMoney(g.utilizadoTotal)}</span>
                        </p>
                        <BarraUtilizado orcado={g.orcadoTotal} utilizado={g.utilizadoTotal} />
                        <BotaoVerDetalhes anoMes={anoMes} contratoId={g.contratoId} label="Ver detalhes gerais do contrato" />
                      </div>
                    </div>
                    <AccordionContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Classificação Malote</TableHead>
                            <TableHead>Aprovador Solicitação</TableHead>
                            <TableHead>Aprovador 1</TableHead>
                            <TableHead>Aprovador 2</TableHead>
                            <TableHead>Aprovador 3</TableHead>
                            <TableHead className="text-right">Orçado</TableHead>
                            <TableHead className="text-right">Utilizado</TableHead>
                            <TableHead>% Utilizado</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.linhas.map((l) => (
                            <TableRow key={l.classificacaoMalote.id}>
                              <TableCell className="font-medium">{l.classificacaoMalote.nome}</TableCell>
                              <LinhaAprovadores c={l.classificacaoMalote} />
                              <TableCell className="text-right">{fmtMoney(l.orcado)}</TableCell>
                              <TableCell className="text-right">{fmtMoney(l.utilizado)}</TableCell>
                              <TableCell>
                                <BarraUtilizado orcado={l.orcado} utilizado={l.utilizado} />
                              </TableCell>
                              <TableCell>
                                <BotaoVerDetalhes anoMes={anoMes} classificacaoId={l.classificacaoMalote.id} contratoId={g.contratoId} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>
        </div>
      )}
    </div>
  );
}
