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
import { useFluxoCaixaMalote } from "@/hooks/useFluxoCaixaMalote";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useTiposFormaPagamento } from "@/hooks/useMaloteFormaPagamento";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { BancoBadge } from "@/components/financeiro/BancoBadge";
import { urlLogoCartao } from "@/hooks/useMaloteCartaoCredito";

// SIS-2026-0160: início do Fluxo de Caixa. Por enquanto a única fonte de
// dado é o Pagamento Malote (só saída) — os cards de Entradas/Saldo ficam
// zerados até existir outra fonte (recebimentos, saldo bancário real).
export default function FluxoCaixaGestao() {
  const { data: linhas = [], isLoading } = useFluxoCaixaMalote();
  // SIS-2026-0221: "Forma de pagamento" vem do catálogo cadastrável em
  // Configurações do Malote → Formas de Pagamento, não mais de um enum fixo.
  const { data: tiposFormaPagamento = [] } = useTiposFormaPagamento();
  const tiposFormaPagamentoAtivos = useMemo(() => tiposFormaPagamento.filter((t) => t.ativo), [tiposFormaPagamento]);

  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [classificacaoId, setClassificacaoId] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  // SIS-2026-0307: "após o pagamento alimentamos o fluxo de caixa" (usuário)
  // — Banco entra aqui, não em Pagamento Malote/Meus Itens.
  const [bancoId, setBancoId] = useState("");

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

  // SIS-2026-0307: mesmo padrão dos filtros acima — deriva direto das
  // linhas já carregadas (a view já entrega banco_nome pronto), sem
  // depender de outro hook nem da RLS de malote_cartao_banco pra esta tela.
  const bancosDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    linhas.forEach((l) => l.banco_id && l.banco_nome && map.set(l.banco_id, l.banco_nome));
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
    setBancoId("");
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
      if (bancoId && l.banco_id !== bancoId) return false;
      return true;
    });
  }, [linhas, dataDe, dataAte, competencia, empresaId, contratoId, classificacaoId, formaPagamento, bancoId]);

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
                  {tiposFormaPagamentoAtivos.map((t) => (
                    <SelectItem key={t.nome} value={t.nome}>{t.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Banco</Label>
              <Select value={bancoId || "todos"} onValueChange={(v) => setBancoId(v === "todos" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {bancosDisponiveis.map(([id, nome]) => (
                    <SelectItem key={id} value={id}>{nome}</SelectItem>
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
                  <TableHead>Banco</TableHead>
                  <TableHead className="text-right">Valor (R$)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-10">Carregando...</TableCell>
                  </TableRow>
                )}
                {!isLoading && filtradas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-10">
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
                    <TableCell className="text-sm">{l.forma_pagamento ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {l.banco_nome ? <BancoBadge nome={l.banco_nome} logoUrl={urlLogoCartao(l.banco_logo_path)} /> : "—"}
                    </TableCell>
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
