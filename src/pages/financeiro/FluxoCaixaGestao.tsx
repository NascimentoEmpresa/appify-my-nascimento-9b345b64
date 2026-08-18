import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingDown, TrendingUp, Wallet, LineChart, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFluxoCaixaMalote } from "@/hooks/useFluxoCaixaMalote";
import { formatBRL } from "@/hooks/usePlanilhaCusto";

const FORMA_PAGAMENTO_LABEL: Record<string, string> = {
  pix: "Pix",
  ted: "TED",
  boleto: "Boleto",
  cartao: "Cartão",
  dinheiro: "Dinheiro",
};

// Mesma técnica visual do TileDestaque em DespesaVisualizar.tsx (que por
// sua vez reaproveita o KpiCard de PainelExecutivo.tsx): ícone grande com
// máscara em degradê, sangrando pela borda direita do card.
const KPI_TILE_ICONE: Record<string, string> = {
  slate: "text-slate-300 dark:text-slate-700",
  emerald: "text-emerald-300 dark:text-emerald-800",
  red: "text-red-300 dark:text-red-900",
  sky: "text-sky-300 dark:text-sky-800",
};

function KpiTile({
  label,
  valor,
  icon,
  cor,
  valorClass,
}: {
  label: string;
  valor: string;
  icon: React.ReactNode;
  cor: keyof typeof KPI_TILE_ICONE;
  valorClass?: string;
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
      </CardContent>
    </Card>
  );
}

// SIS-2026-0160: início do Fluxo de Caixa. Por enquanto a única fonte de
// dado é o Pagamento Malote (só saída) — os cards de Entradas/Saldo ficam
// zerados até existir outra fonte (recebimentos, saldo bancário real).
export default function FluxoCaixaGestao() {
  const { data: linhas = [], isLoading } = useFluxoCaixaMalote();

  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [classificacaoId, setClassificacaoId] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");

  const empresasDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    linhas.forEach((l) => l.empresa_id && l.empresa_nome && map.set(l.empresa_id, l.empresa_nome));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);

  const contratosDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    linhas.forEach((l) => l.contrato_id && l.contrato_nome && map.set(l.contrato_id, l.contrato_nome));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);

  const classificacoesDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    linhas.forEach((l) => l.classificacao_id && l.classificacao_nome && map.set(l.classificacao_id, l.classificacao_nome));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);

  function limparFiltros() {
    setDataDe("");
    setDataAte("");
    setCompetencia("");
    setEmpresaId("");
    setContratoId("");
    setClassificacaoId("");
    setFormaPagamento("");
  }

  const filtradas = useMemo(() => {
    return linhas.filter((l) => {
      if (dataDe && (!l.data_pagamento || l.data_pagamento < dataDe)) return false;
      if (dataAte && (!l.data_pagamento || l.data_pagamento > dataAte)) return false;
      if (competencia && l.competencia?.slice(0, 7) !== competencia) return false;
      if (empresaId && l.empresa_id !== empresaId) return false;
      if (contratoId && l.contrato_id !== contratoId) return false;
      if (classificacaoId && l.classificacao_id !== classificacaoId) return false;
      if (formaPagamento && l.forma_pagamento !== formaPagamento) return false;
      return true;
    });
  }, [linhas, dataDe, dataAte, competencia, empresaId, contratoId, classificacaoId, formaPagamento]);

  const totalSaidas = useMemo(() => filtradas.reduce((s, l) => s + Number(l.valor), 0), [filtradas]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Fluxo de Caixa"
        subtitle="Acompanhe as entradas e saídas financeiras provenientes do Pagamento Malote."
        module="Financeiro"
        breadcrumb={["Financeiro", "Gestão Financeira", "Fluxo de Caixa"]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile label="Saldo Atual" valor="—" icon={<Wallet />} cor="slate" valorClass="text-muted-foreground" />
        <KpiTile label="Entradas" valor="—" icon={<TrendingUp />} cor="emerald" valorClass="text-muted-foreground" />
        <KpiTile
          label="Saídas (filtro atual)"
          valor={formatBRL(totalSaidas)}
          icon={<TrendingDown />}
          cor="red"
          valorClass="text-red-600 dark:text-red-400"
        />
        <KpiTile label="Saldo Projetado" valor="—" icon={<LineChart />} cor="sky" valorClass="text-muted-foreground" />
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        Saldo Atual, Entradas e Saldo Projetado ainda não têm fonte de dado (só o Pagamento Malote alimenta esta tela
        por enquanto, e ele só gera saída).
      </p>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Filtros</p>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={limparFiltros}>
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <Label className="text-xs">Data de</Label>
              <Input type="date" className="h-8 text-xs" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Data até</Label>
              <Input type="date" className="h-8 text-xs" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Competência</Label>
              <Input type="month" className="h-8 text-xs" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Empresa</Label>
              <Select value={empresaId || "todas"} onValueChange={(v) => setEmpresaId(v === "todas" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {empresasDisponiveis.map(([id, nome]) => (
                    <SelectItem key={id} value={id}>{nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Contrato</Label>
              <Select value={contratoId || "todos"} onValueChange={(v) => setContratoId(v === "todos" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {contratosDisponiveis.map(([id, nome]) => (
                    <SelectItem key={id} value={id}>{nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Classificação</Label>
              <Select value={classificacaoId || "todas"} onValueChange={(v) => setClassificacaoId(v === "todas" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {classificacoesDisponiveis.map(([id, nome]) => (
                    <SelectItem key={id} value={id}>{nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Forma de Pagamento</Label>
              <Select value={formaPagamento || "todas"} onValueChange={(v) => setFormaPagamento(v === "todas" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {Object.entries(FORMA_PAGAMENTO_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold">Movimentações do Fluxo de Caixa</p>
            <p className="text-xs text-muted-foreground">Dados alimentados pelo módulo Pagamento Malote.</p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Data de Pagamento</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Classificação</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Forma de Pagamento</TableHead>
                  <TableHead className="text-right">Valor (R$)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10">Carregando...</TableCell>
                  </TableRow>
                )}
                {!isLoading && filtradas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                      <div className="flex flex-col items-center gap-2">
                        <TrendingDown className="h-8 w-8 text-muted-foreground/50" />
                        Nenhuma movimentação encontrada com os filtros atuais.
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {filtradas.map((l) => (
                  <TableRow key={l.despesa_id}>
                    <TableCell className="font-mono text-xs">{l.id_malote}</TableCell>
                    <TableCell className="text-sm">{l.data_pagamento ? new Date(l.data_pagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell className="text-sm">{l.competencia ? new Date(l.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" }) : "—"}</TableCell>
                    <TableCell>
                      <Badge className="bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300">Saída</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{l.empresa_nome ?? "—"}</TableCell>
                    <TableCell className="text-sm">{l.contrato_nome ?? "—"}</TableCell>
                    <TableCell className="text-sm">{l.classificacao_nome ?? "—"}</TableCell>
                    <TableCell className="text-sm">{l.descricao}</TableCell>
                    <TableCell className="text-sm">{l.forma_pagamento ? FORMA_PAGAMENTO_LABEL[l.forma_pagamento] ?? l.forma_pagamento : "—"}</TableCell>
                    <TableCell className="text-right text-sm font-medium">{formatBRL(l.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {filtradas.length > 0 && (
            <p className="text-xs text-muted-foreground pt-1">Mostrando {filtradas.length} registro{filtradas.length === 1 ? "" : "s"}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
