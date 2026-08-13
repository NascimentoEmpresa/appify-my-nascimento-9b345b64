import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Building2, Briefcase } from "lucide-react";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { usePlanejamentosOrcamento, useClassificacoesOrcamentoAdmin, ClassificacaoOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useLigacoesAdministrativoClassificacao } from "@/hooks/useMaloteAdministrativoClassificacaoLink";
import { useOrcamentoContratos } from "@/hooks/useOrcamentoContratos";
import { getStatusVigencia, STATUS_LABEL, STATUS_BADGE_CLASS, StatusVigencia, fmtMoney } from "./orcamentoUtils";
import { LigacaoSectionBanner } from "./LigacaoLicitacaoClassificacao";

type OrigemOrcamento = "administrativo" | "contrato";

interface LinhaAdmGeral {
  classificacaoMalote: ClassificacaoOrcamento;
  detalhes: string;
  valor: number;
  status: StatusVigencia;
}

interface LinhaContratoGeral {
  classificacaoMalote: ClassificacaoOrcamento;
  valor: number;
}

interface ContratoGeralGrupo {
  contratoId: string;
  contratoNome: string;
  contratoCliente: string;
  linhas: LinhaContratoGeral[];
  valorTotal: number;
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

// Orçamento Geral (SIS-2026-0125, ajustado após feedback): alimentado única
// e exclusivamente pela Classificação do Malote — cada linha representa 1
// Classificação Malote, com o valor somado de tudo que está ligado a ela
// (várias rubricas de licitação de um contrato, ou vários lançamentos do
// Orçamento Administrativo). Sem ligação, a Classificação Malote não
// aparece aqui — pra isso existem as telas "puras" (Orçamento
// Administrativo e Orçamento de Contratos), que não dependem de ligação.
export default function OrcamentoGeral() {
  const { data: empresaId } = useEmpresaId();
  const { data: orcamentosAdm = [], isLoading: carregandoAdm } = usePlanejamentosOrcamento(empresaId);
  const { data: gruposContrato, isLoading: carregandoContrato } = useOrcamentoContratos();
  const { data: ligacoesAdm = [] } = useLigacoesAdministrativoClassificacao();
  const { data: classificacoesMalote = [] } = useClassificacoesOrcamentoAdmin();

  const [filtroOrigem, setFiltroOrigem] = useState<"todas" | OrigemOrcamento>("todas");
  const [busca, setBusca] = useState("");
  const [ocultarHistorico, setOcultarHistorico] = useState(true);

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

  const linhasAdm: LinhaAdmGeral[] = useMemo(() => {
    const acumulado = new Map<string, { valor: number; detalhes: Set<string>; status: Set<StatusVigencia> }>();
    for (const o of orcamentosAdm) {
      const status = getStatusVigencia(o.inicio_vigencia, o.fim_vigencia);
      if (ocultarHistorico && status === "historico") continue;
      const maloteId = maloteIdPorAdministrativa.get(o.classificacao_id);
      if (!maloteId) continue;
      const atual = acumulado.get(maloteId) ?? { valor: 0, detalhes: new Set<string>(), status: new Set<StatusVigencia>() };
      atual.valor += Number(o.valor) || 0;
      atual.detalhes.add(o.detalhe);
      atual.status.add(status);
      acumulado.set(maloteId, atual);
    }
    const resultado: LinhaAdmGeral[] = [];
    acumulado.forEach((v, maloteId) => {
      const classificacaoMalote = classificacaoMalotePorId.get(maloteId);
      if (!classificacaoMalote) return;
      const statusFinal = PRIORIDADE_STATUS.find((s) => v.status.has(s)) ?? "historico";
      resultado.push({
        classificacaoMalote,
        detalhes: Array.from(v.detalhes).join(", "),
        valor: v.valor,
        status: statusFinal,
      });
    });
    return resultado;
  }, [orcamentosAdm, maloteIdPorAdministrativa, classificacaoMalotePorId, ocultarHistorico]);

  const gruposContratoGeral: ContratoGeralGrupo[] = useMemo(() => {
    return gruposContrato
      .map((g) => {
        const acumulado = new Map<string, number>();
        for (const r of g.rubricas) {
          if (!r.classificacaoMaloteId) continue;
          acumulado.set(r.classificacaoMaloteId, (acumulado.get(r.classificacaoMaloteId) ?? 0) + r.valor);
        }
        const linhas: LinhaContratoGeral[] = [];
        acumulado.forEach((valor, maloteId) => {
          const classificacaoMalote = classificacaoMalotePorId.get(maloteId);
          if (classificacaoMalote) linhas.push({ classificacaoMalote, valor });
        });
        return {
          contratoId: g.contrato.id,
          contratoNome: g.contrato.nome,
          contratoCliente: g.contrato.cliente,
          linhas,
          valorTotal: linhas.reduce((s, l) => s + l.valor, 0),
        };
      })
      .filter((g) => g.linhas.length > 0);
  }, [gruposContrato, classificacaoMalotePorId]);

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

  const valorTotal = useMemo(() => {
    const totalAdm = mostrarAdm ? linhasAdmFiltradas.reduce((s, l) => s + l.valor, 0) : 0;
    const totalContrato = mostrarContrato ? gruposContratoFiltrados.reduce((s, g) => s + g.valorTotal, 0) : 0;
    return totalAdm + totalContrato;
  }, [mostrarAdm, mostrarContrato, linhasAdmFiltradas, gruposContratoFiltrados]);

  const linhasTotal = (mostrarAdm ? linhasAdmFiltradas.length : 0) + (mostrarContrato ? gruposContratoFiltrados.reduce((s, g) => s + g.linhas.length, 0) : 0);
  const isLoading = carregandoAdm || carregandoContrato;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Orçamento Geral"
        subtitle="Visão por Classificação do Malote, somando tudo que está ligado a ela — Administrativo e Contratos."
        module="Malote"
        breadcrumb={["Malote", "Classificações e Orçamentos", "Orçamento Geral"]}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Linhas de orçamento</CardDescription>
            <CardTitle className="text-3xl">{linhasTotal}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Valor total (orçado Adm. + executado Contratos)</CardDescription>
            <CardTitle className="text-2xl">{fmtMoney(valorTotal)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <p className="text-muted-foreground">
          Só aparecem aqui Classificações do Malote com pelo menos uma ligação cadastrada (Configurações →
          Ligações). Pra ver tudo sem depender de ligação, use Orçamento Administrativo ou Orçamento de Contratos.
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
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      Carregando...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && linhasAdmFiltradas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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
                    <TableCell className="text-right">{fmtMoney(l.valor)}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE_CLASS[l.status]}>{STATUS_LABEL[l.status]}</Badge>
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
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                        <div className="text-left">
                          <p className="font-medium">{g.contratoNome}</p>
                          <p className="text-xs text-muted-foreground font-normal">{g.contratoCliente}</p>
                        </div>
                        <span className="text-sm font-semibold whitespace-nowrap">{fmtMoney(g.valorTotal)}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Classificação Malote</TableHead>
                            <TableHead>Aprovador Solicitação</TableHead>
                            <TableHead>Aprovador 1</TableHead>
                            <TableHead>Aprovador 2</TableHead>
                            <TableHead>Aprovador 3</TableHead>
                            <TableHead className="text-right">Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.linhas.map((l) => (
                            <TableRow key={l.classificacaoMalote.id}>
                              <TableCell className="font-medium">{l.classificacaoMalote.nome}</TableCell>
                              <LinhaAprovadores c={l.classificacaoMalote} />
                              <TableCell className="text-right">{fmtMoney(l.valor)}</TableCell>
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
