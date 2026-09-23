import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Upload, X, Play, RefreshCw, GitMerge, Pencil, Ban, PlusCircle, Save, History, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AcessoGate } from "@/components/auth/AcessoGate";
import {
  parseOFX,
  reconciliar,
  fmtBRL,
  type OFXTransaction,
  type ReconciliacaoResult,
  type LancamentoRow,
} from "@/lib/conciliacaoBancariaEngine";
import { useFluxoCaixaCombinado, useAjustarLinhaFluxoCaixa } from "@/hooks/useFluxoCaixaMalote";
import {
  linhasFluxoParaPlanilhaRow,
  useSalvarConciliacaoFluxoCaixa,
  useConciliacoesFluxoCaixaSalvas,
  useConciliacaoFluxoCaixaDetalhe,
  type ConciliacaoFluxoCaixaLinha,
} from "@/hooks/useConciliacaoFluxoCaixa";
import { useCriarDebito } from "@/hooks/useDebitoAutomatico";
import { useCartaoBancos } from "@/hooks/useMaloteCartaoCredito";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { useFormasPagamento } from "@/hooks/useMaloteFormaPagamento";

// SIS-2026-0492: conciliação automática — o lado "Fluxo" vem direto do
// Fluxo de Caixa interno (useFluxoCaixaCombinado), o lado banco continua
// sendo .OFX subido na hora. Motor de comparação reaproveitado de
// src/lib/conciliacaoBancariaEngine.ts (extraído da tela antiga,
// ConciliacaoBancaria.tsx, que continua existindo pra quem usa planilha
// manual). Divergência resolvida (Ajustar/Criar) faz a linha desaparecer
// ao recalcular — "Ignorar" fica marcada localmente até salvar, porque
// não muda nenhum dado de origem. Só libera "Salvar conciliação" quando
// não sobra nenhuma pendência.
//
// Nome do arquivo é "ConciliacaoAutomaticaFluxoCaixa" (não
// "ConciliacaoFluxoCaixa") de propósito — esse outro nome já existia
// (tela de movimento_bancario/IntegracaoBancaria, achado tarde, quase
// sobrescrito por engano).

type ResolucaoStatus = "ajustado" | "ignorado" | "criado";
interface Resolucao {
  linha: LancamentoRow;
  status: ResolucaoStatus;
  observacao?: string;
}

function isoParaBR(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

// LancamentoRow.dia já vem formatado dd/mm/yyyy pelo motor — pra gravar
// no banco (coluna `date`) precisamos do ISO de volta.
function brParaIso(br: string) {
  const [d, m, y] = br.split("/");
  return `${y}-${m}-${d}`;
}

export default function ConciliacaoAutomaticaFluxoCaixa() {
  const [aba, setAba] = useState<"conciliar" | "historico">("conciliar");

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Conciliação Bancária"
        subtitle="Cruza os lançamentos do Fluxo de Caixa do próprio sistema com extratos OFX e identifica divergências automaticamente"
        module="Financeiro"
        breadcrumb={["Financeiro", "Gestão Financeira", "Conciliação Bancária"]}
      />

      <Tabs value={aba} onValueChange={(v) => setAba(v as "conciliar" | "historico")}>
        <TabsList>
          <TabsTrigger value="conciliar" className="gap-1.5">
            <GitMerge className="h-3.5 w-3.5" /> Conciliar
          </TabsTrigger>
          <TabsTrigger value="historico" className="gap-1.5">
            <History className="h-3.5 w-3.5" /> Conciliações Salvas
          </TabsTrigger>
        </TabsList>
        <TabsContent value="conciliar" className="mt-4">
          <ConciliarTab />
        </TabsContent>
        <TabsContent value="historico" className="mt-4">
          <HistoricoTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Aba Conciliar ────────────────────────────────────────────────────────

function ConciliarTab() {
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [bancoId, setBancoId] = useState("");
  const [ofxFiles, setOfxFiles] = useState<File[]>([]);
  const [ofxTrns, setOfxTrns] = useState<OFXTransaction[] | null>(null);
  const [resultado, setResultado] = useState<ReconciliacaoResult | null>(null);
  const [processando, setProcessando] = useState(false);
  const [resolvidos, setResolvidos] = useState<Record<string, Resolucao>>({});
  const [observacoes, setObservacoes] = useState("");

  const [dialogAjustar, setDialogAjustar] = useState<LancamentoRow | null>(null);
  const [dialogCriar, setDialogCriar] = useState<LancamentoRow | null>(null);
  const [dialogIgnorar, setDialogIgnorar] = useState<LancamentoRow | null>(null);
  const [abaResultado, setAbaResultado] = useState<"resumo" | "divergencias">("resumo");

  const { data: linhasBrutas = [] } = useFluxoCaixaCombinado();
  const { data: bancos = [] } = useCartaoBancos();
  const ajustar = useAjustarLinhaFluxoCaixa();
  const criarDebito = useCriarDebito();
  const salvar = useSalvarConciliacaoFluxoCaixa();

  // Todos os lançamentos do Fluxo no período, independente de banco — usado
  // só pra mostrar a contagem total no card de Período.
  const linhasPeriodo = useMemo(() => {
    return linhasBrutas.filter((l) => {
      if (!l.data_pagamento) return false;
      if (dataDe && l.data_pagamento < dataDe) return false;
      if (dataAte && l.data_pagamento > dataAte) return false;
      return true;
    });
  }, [linhasBrutas, dataDe, dataAte]);

  // Conciliação é sempre de UM banco por vez (pedido do usuário: "o usuário
  // vai fazer sempre por banco") — filtra o lado Fluxo pro banco escolhido
  // antes de comparar com o extrato, senão um lançamento de outro banco com
  // mesmo valor/data podia "casar" por coincidência e mascarar divergência real.
  const linhasPeriodoBanco = useMemo(
    () => linhasPeriodo.filter((l) => l.banco_id === bancoId),
    [linhasPeriodo, bancoId]
  );

  function rodar(trns: OFXTransaction[]) {
    const planRows = linhasFluxoParaPlanilhaRow(linhasPeriodoBanco);
    const res = reconciliar(planRows, trns);
    setResultado(res);
    toast.success(`Conciliação processada — ${res.totalDias} dias, ${res.divergencias} dia(s) com divergência.`);
  }

  async function executar() {
    if (!dataDe || !dataAte) {
      toast.error("Selecione o período (Data De / Data Até).");
      return;
    }
    if (!bancoId) {
      toast.error("Selecione o banco desta conciliação.");
      return;
    }
    if (ofxFiles.length === 0) {
      toast.error("Selecione ao menos um arquivo .OFX.");
      return;
    }
    setProcessando(true);
    try {
      const trns: OFXTransaction[] = [];
      for (const f of ofxFiles) {
        const text = await f.text();
        trns.push(...parseOFX(text, f.name));
      }
      if (!trns.length) throw new Error("Nenhum lançamento encontrado nos extratos OFX.");
      setOfxTrns(trns);
      setResolvidos({});
      rodar(trns);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessando(false);
    }
  }

  function recalcular() {
    if (!ofxTrns) return;
    rodar(ofxTrns);
  }

  function reiniciar() {
    setOfxFiles([]);
    setOfxTrns(null);
    setResultado(null);
    setResolvidos({});
    setObservacoes("");
  }

  const pendentes = useMemo(
    () => (resultado ? resultado.lancamentos.filter((l) => !resolvidos[l.id]) : []),
    [resultado, resolvidos]
  );

  // Resumo por Dia mostra Diferença em R$, mas não diz DE ONDE ela vem — essa
  // contagem por dia serve pra deixar isso explícito: quantos itens existem
  // só no extrato (faltam no Fluxo), só no Fluxo (faltam no extrato) e quantos
  // são valor/tipo divergente entre os dois lados.
  const observacaoPorDia = useMemo(() => {
    const map: Record<string, { soExtrato: number; soFluxo: number; divergente: number }> = {};
    for (const l of resultado?.lancamentos ?? []) {
      const d = map[l.dia] ?? (map[l.dia] = { soExtrato: 0, soFluxo: 0, divergente: 0 });
      if (l.erro === "🚨 FLUXO - NÃO ENCONTRADO") d.soExtrato += 1;
      else if (l.erro === "⚠️ BANCO - NÃO ENCONTRADO") d.soFluxo += 1;
      else d.divergente += 1;
    }
    return map;
  }, [resultado]);

  // Rótulo mais específico pra coluna "Ocorrência" da aba Divergências — o
  // código em `erro` (ex. "🚨 FLUXO - NÃO ENCONTRADO") continua igual (é
  // compartilhado com a tela antiga/motor), só a exibição aqui é mais clara.
  function descreverOcorrencia(l: LancamentoRow): string {
    switch (l.erro) {
      case "🚨 FLUXO - NÃO ENCONTRADO":
        return "🚨 Consta no extrato, sem lançamento no Fluxo";
      case "⚠️ BANCO - NÃO ENCONTRADO":
        return "⚠️ Consta no Fluxo, não caiu no extrato do banco";
      case "🔍 VALOR SIMILAR":
        return "🔍 Mesmo lançamento, valor não bate exatamente";
      case "❌ TIPO DIVERGENTE":
        return "❌ Mesmo valor, entrada/saída não bate";
      default:
        return l.erro;
    }
  }

  function descreverObservacao(dia: string): string {
    const d = observacaoPorDia[dia];
    if (!d) return "—";
    const partes: string[] = [];
    if (d.soExtrato > 0) partes.push(`${d.soExtrato} no extrato, sem par no Fluxo`);
    if (d.soFluxo > 0) partes.push(`${d.soFluxo} no Fluxo, sem par no extrato`);
    if (d.divergente > 0) partes.push(`${d.divergente} com valor/tipo divergente`);
    return partes.length ? partes.join(" · ") : "—";
  }

  async function confirmarAjuste(dados: { dataPagamento?: string; tipo?: "entrada" | "saida"; valor?: number }) {
    if (!dialogAjustar || !dialogAjustar.despesaId || !dialogAjustar.origemFluxo) return;
    try {
      await ajustar.mutateAsync({
        origem: dialogAjustar.origemFluxo,
        despesaId: dialogAjustar.despesaId,
        numeroParcela: dialogAjustar.numeroParcela ?? null,
        dataPagamento: dados.dataPagamento || undefined,
        tipo: dados.tipo || undefined,
        valor: dados.valor ?? undefined,
      });
      setResolvidos((prev) => ({ ...prev, [dialogAjustar.id]: { linha: dialogAjustar, status: "ajustado" } }));
      toast.success("Lançamento ajustado — recalculando...");
      setDialogAjustar(null);
      setTimeout(recalcular, 400); // dá tempo do useFluxoCaixaCombinado refazer o fetch
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao ajustar.");
    }
  }

  async function confirmarCriar(dados: {
    empresaId: string;
    classificacaoId: string;
    descricao: string;
    formaPagamento: string;
    bancoId: string;
  }) {
    if (!dialogCriar) return;
    try {
      await criarDebito.mutateAsync({
        data_pagamento: brParaIso(dialogCriar.dia),
        competencia: brParaIso(dialogCriar.dia).slice(0, 8) + "01",
        tipo: dialogCriar.tipoOFX === "ENTRADA" ? "entrada" : "saida",
        empresa_id: dados.empresaId,
        contrato_id: null,
        classificacao_id: dados.classificacaoId,
        descricao: dados.descricao,
        forma_pagamento: dados.formaPagamento,
        valor: dialogCriar.valor,
        banco_id: dados.bancoId,
        status: "pago",
      });
      setResolvidos((prev) => ({ ...prev, [dialogCriar.id]: { linha: dialogCriar, status: "criado" } }));
      toast.success("Lançamento criado (Débito Automático) — recalculando...");
      setDialogCriar(null);
      setTimeout(recalcular, 400);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao criar lançamento.");
    }
  }

  function confirmarIgnorar(motivo: string) {
    if (!dialogIgnorar) return;
    setResolvidos((prev) => ({ ...prev, [dialogIgnorar.id]: { linha: dialogIgnorar, status: "ignorado", observacao: motivo } }));
    setDialogIgnorar(null);
  }

  async function handleSalvar() {
    if (!resultado || pendentes.length > 0) return;
    try {
      const linhas: SalvarLinhaInput[] = Object.values(resolvidos).map((r) => ({
        dia: brParaIso(r.linha.dia),
        origem: r.linha.tipoOFX && !r.linha.tipoPlanilha ? "extrato" : "fluxo",
        tipo: (r.linha.tipoOFX ?? r.linha.tipoPlanilha) === "ENTRADA" ? "entrada" : "saida",
        valor: r.linha.valor,
        descricao: r.linha.detalhe,
        banco: r.linha.origem,
        status: r.status,
        observacao: r.observacao ?? null,
        despesa_id: r.linha.despesaId ?? null,
        numero_parcela: r.linha.numeroParcela ?? null,
      }));
      const arquivosOfx = ofxFiles;
      const id = await salvar.mutateAsync({ dataInicio: dataDe, dataFim: dataAte, observacoes: observacoes || null, arquivosOfx, linhas });
      toast.success("Conciliação salva.");
      reiniciar();
      void id;
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar conciliação.");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Período e Banco</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-end">
          <div>
            <Label className="text-xs">Data De</Label>
            <Input type="date" className="h-9" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Data Até</Label>
            <Input type="date" className="h-9" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Banco</Label>
            <Select value={bancoId || "_"} onValueChange={(v) => setBancoId(v === "_" ? "" : v)}>
              <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {bancos.filter((b) => b.ativo).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground">
            {bancoId
              ? `${linhasPeriodoBanco.length} de ${linhasPeriodo.length} lançamento(s) do Fluxo de Caixa no período são deste banco.`
              : `${linhasPeriodo.length} lançamento(s) do Fluxo de Caixa no período.`}
          </div>
        </CardContent>
      </Card>

      {!resultado ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <GitMerge className="h-4 w-4 text-purple-500" />
              Extrato Bancário OFX
              {ofxFiles.length > 0 && <Badge variant="secondary">{ofxFiles.length}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg h-24 cursor-pointer transition-colors border-border hover:border-purple-400 hover:bg-muted/40">
              <input
                type="file"
                accept=".ofx,.ofc"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && setOfxFiles((p) => [...p, ...Array.from(e.target.files!)])}
              />
              <Upload className="h-6 w-6 text-muted-foreground mb-1" />
              <p className="text-xs text-muted-foreground">Arraste ou clique — pode subir mais de um arquivo do mesmo banco</p>
            </label>
            {ofxFiles.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {ofxFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-muted/40 rounded px-2 py-1">
                    <span className="truncate text-foreground">{f.name}</span>
                    <button onClick={() => setOfxFiles((p) => p.filter((_, j) => j !== i))}>
                      <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Button
              onClick={executar}
              disabled={processando || !dataDe || !dataAte || !bancoId || ofxFiles.length === 0}
              className="w-full"
            >
              {processando ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              {processando ? "Processando..." : "Iniciar Conciliação"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Dias processados", value: String(resultado.totalDias) },
              { label: "Dias OK", value: String(resultado.diasOk) },
              { label: "Divergências", value: String(resultado.lancamentos.length) },
              { label: "Pendentes", value: String(pendentes.length), ok: pendentes.length === 0 },
            ].map((k) => (
              <Card key={k.label}>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
                  <p className={cn("text-lg font-bold", k.ok === false ? "text-red-600" : k.ok === true ? "text-green-600" : "")}>{k.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-0 pt-4 px-4">
              <div className="flex items-center justify-between gap-4">
                <Tabs value={abaResultado} onValueChange={(v) => setAbaResultado(v as "resumo" | "divergencias")} className="flex-1">
                  <TabsList className="h-9">
                    <TabsTrigger value="resumo" className="text-xs">📊 Resumo por Dia</TabsTrigger>
                    <TabsTrigger value="divergencias" className="text-xs">
                      🔍 Divergências
                      {resultado.lancamentos.length > 0 && (
                        <Badge variant="destructive" className="ml-1.5 h-4 px-1 text-xs">{resultado.lancamentos.length}</Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <Button size="sm" variant="ghost" onClick={reiniciar} className="shrink-0">
                  <RefreshCw className="h-3 w-3 mr-1" /> Nova conciliação
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 pt-2">
              {abaResultado === "resumo" ? (
                <div key="resumo" className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Data</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Fluxo</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Extrato</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Diferença</th>
                        <th className="text-center px-4 py-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Observação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.resumo.map((r, i) => (
                        <tr key={i} className={cn("border-b transition-colors", r.status === "DIVERGENTE" && "bg-red-50 dark:bg-red-950/10")}>
                          <td className="px-4 py-2 font-medium">{r.dia}</td>
                          <td className="px-4 py-2 text-right">{fmtBRL(r.totalPlanilha)}</td>
                          <td className="px-4 py-2 text-right">{fmtBRL(Math.abs(r.totalExtrato))}</td>
                          <td className={cn("px-4 py-2 text-right font-medium", Math.abs(r.diferenca) < 0.005 ? "text-green-600" : "text-red-600")}>
                            {r.diferenca >= 0 ? "+" : ""}{fmtBRL(r.diferenca)}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {r.status === "OK"
                              ? <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">✓ OK</Badge>
                              : <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">Divergente</Badge>}
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{descreverObservacao(r.dia)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : resultado.lancamentos.length === 0 ? (
                <div key="divergencias-vazio" className="py-10 text-center text-muted-foreground text-sm">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  Nenhuma divergência — Fluxo de Caixa e extrato batem 100%.
                </div>
              ) : (
                <div key="divergencias" className="overflow-x-auto max-h-[55vh] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background border-b z-10">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">Data</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Ocorrência</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Banco/Origem</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Empresa</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Detalhe</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Valor</th>
                        <th className="text-center px-4 py-2 font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.lancamentos.map((l) => {
                        const resolucao = resolvidos[l.id];
                        const podeAjustar = !!l.despesaId && !resolucao;
                        const podeCriar = l.erro === "🚨 FLUXO - NÃO ENCONTRADO" && !resolucao;
                        return (
                          <tr key={l.id} className={cn("border-b", resolucao && "opacity-60")}>
                            <td className="px-4 py-2 whitespace-nowrap font-medium">{l.dia}</td>
                            <td className="px-4 py-2">{descreverOcorrencia(l)}</td>
                            <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{l.origem}</td>
                            <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{l.empresaNome ?? "—"}</td>
                            <td className="px-4 py-2 text-muted-foreground max-w-xs truncate">{l.detalhe}</td>
                            <td className="px-4 py-2 text-right font-bold">{fmtBRL(l.valor)}</td>
                            <td className="px-4 py-2 text-center">
                              {resolucao ? (
                                <Badge variant="secondary" className="text-xs">
                                  {resolucao.status === "ajustado" ? "Ajustado" : resolucao.status === "criado" ? "Criado" : "Ignorado"}
                                </Badge>
                              ) : (
                                <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Pendente</Badge>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              {!resolucao && (
                                <div className="flex items-center gap-1 justify-end">
                                  {podeAjustar && (
                                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setDialogAjustar(l)}>
                                      <Pencil className="h-3 w-3 mr-1" /> Ajustar
                                    </Button>
                                  )}
                                  {podeCriar && (
                                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setDialogCriar(l)}>
                                      <PlusCircle className="h-3 w-3 mr-1" /> Criar
                                    </Button>
                                  )}
                                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-muted-foreground" onClick={() => setDialogIgnorar(l)}>
                                    <Ban className="h-3 w-3 mr-1" /> Ignorar
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <AcessoGate
            menu="conciliacao-fluxo-caixa"
            acao="incluir"
            fallback={
              <p className="text-xs text-muted-foreground text-center py-3">
                Você não tem permissão para salvar conciliações — resolva com quem gerencia o acesso.
              </p>
            }
          >
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div>
                  <Label className="text-xs">Observações da conciliação (opcional)</Label>
                  <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value.slice(0, 500))} placeholder="Alguma nota geral sobre este período..." />
                </div>
                <Button onClick={handleSalvar} disabled={pendentes.length > 0 || salvar.isPending} className="w-full gap-1.5">
                  <Save className="h-4 w-4" />
                  {pendentes.length > 0
                    ? `Resolva ${pendentes.length} pendência(s) para salvar`
                    : salvar.isPending
                      ? "Salvando..."
                      : "Salvar conciliação"}
                </Button>
              </CardContent>
            </Card>
          </AcessoGate>
        </div>
      )}

      <DialogAjustar linha={dialogAjustar} onClose={() => setDialogAjustar(null)} onConfirmar={confirmarAjuste} salvando={ajustar.isPending} />
      <DialogCriarLancamento linha={dialogCriar} onClose={() => setDialogCriar(null)} onConfirmar={confirmarCriar} salvando={criarDebito.isPending} />
      <DialogIgnorar linha={dialogIgnorar} onClose={() => setDialogIgnorar(null)} onConfirmar={confirmarIgnorar} />
    </div>
  );
}

interface SalvarLinhaInput {
  dia: string;
  origem: "fluxo" | "extrato";
  tipo: "entrada" | "saida";
  valor: number;
  descricao: string;
  banco: string;
  status: ResolucaoStatus;
  observacao: string | null;
  despesa_id: string | null;
  numero_parcela: number | null;
}

// ── Dialog: Ajustar linha do Fluxo ───────────────────────────────────────

function DialogAjustar({
  linha,
  onClose,
  onConfirmar,
  salvando,
}: {
  linha: LancamentoRow | null;
  onClose: () => void;
  onConfirmar: (dados: { dataPagamento?: string; tipo?: "entrada" | "saida"; valor?: number }) => void;
  salvando: boolean;
}) {
  const [dataPagamento, setDataPagamento] = useState("");
  const [tipo, setTipo] = useState<"entrada" | "saida" | "">("");
  const [valor, setValor] = useState("");

  if (!linha) return null;
  return (
    <Dialog open={!!linha} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm p-5">
        <DialogHeader>
          <DialogTitle>Ajustar lançamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {linha.dia} — {fmtBRL(linha.valor)} — {linha.detalhe}
          </p>
          <p className="text-xs text-muted-foreground">
            Só preencha o campo que precisa corrigir — o resto continua igual ao lançamento original. O ajuste vale só
            no Fluxo de Caixa, sem alterar a despesa/débito original.
          </p>
          <div>
            <Label className="text-xs">Nova Data de Pagamento (opcional)</Label>
            <Input type="date" className="h-9" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Novo Tipo (opcional)</Label>
            <Select value={tipo || "_"} onValueChange={(v) => setTipo(v === "_" ? "" : (v as "entrada" | "saida"))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">—</SelectItem>
                <SelectItem value="entrada">Entrada</SelectItem>
                <SelectItem value="saida">Saída</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Novo Valor (opcional)</Label>
            <Input type="number" step="0.01" className="h-9" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button
            size="sm"
            disabled={salvando || (!dataPagamento && !tipo && !valor)}
            onClick={() =>
              onConfirmar({
                dataPagamento: dataPagamento || undefined,
                tipo: tipo || undefined,
                valor: valor ? Number(valor) : undefined,
              })
            }
          >
            {salvando ? "Salvando..." : "Confirmar ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog: Criar lançamento (Débito Automático) a partir de linha só do banco ──

function DialogCriarLancamento({
  linha,
  onClose,
  onConfirmar,
  salvando,
}: {
  linha: LancamentoRow | null;
  onClose: () => void;
  onConfirmar: (dados: { empresaId: string; classificacaoId: string; descricao: string; formaPagamento: string; bancoId: string }) => void;
  salvando: boolean;
}) {
  const [empresaId, setEmpresaId] = useState("");
  const [classificacaoId, setClassificacaoId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [bancoId, setBancoId] = useState("");

  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: classificacoes = [] } = useClassificacoesOrcamentoAdmin();
  const { data: formasPagamento = [] } = useFormasPagamento();
  const { data: bancos = [] } = useCartaoBancos();

  if (!linha) return null;
  return (
    <Dialog open={!!linha} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm p-5">
        <DialogHeader>
          <DialogTitle>Criar lançamento (Débito Automático)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Encontrado só no extrato — {linha.dia} — {fmtBRL(linha.valor)} — {linha.tipoOFX === "ENTRADA" ? "Entrada" : "Saída"} —{" "}
            {linha.detalhe}
          </p>
          <p className="text-xs text-muted-foreground">
            Cria já como "pago" (o extrato é a prova de que o dinheiro já entrou/saiu) — entra no Débito Automático e no
            Fluxo de Caixa.
          </p>
          <div>
            <Label className="text-xs">Empresa</Label>
            <Select value={empresaId} onValueChange={setEmpresaId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Classificação</Label>
            <Select value={classificacaoId} onValueChange={setClassificacaoId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {classificacoes.filter((c) => c.ativo).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Descrição</Label>
            <Input className="h-9" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder={linha.detalhe.slice(0, 60)} />
          </div>
          <div>
            <Label className="text-xs">Forma de Pagamento</Label>
            <Select value={formaPagamento} onValueChange={setFormaPagamento}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {formasPagamento.filter((f) => f.ativo).map((f) => (
                  <SelectItem key={f.id} value={f.nome}>{f.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Banco</Label>
            <Select value={bancoId} onValueChange={setBancoId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {bancos.filter((b) => b.ativo).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button
            size="sm"
            disabled={salvando || !empresaId || !classificacaoId || !descricao.trim() || !formaPagamento || !bancoId}
            onClick={() => onConfirmar({ empresaId, classificacaoId, descricao: descricao.trim(), formaPagamento, bancoId })}
          >
            {salvando ? "Criando..." : "Criar lançamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog: Ignorar linha ────────────────────────────────────────────────

function DialogIgnorar({ linha, onClose, onConfirmar }: { linha: LancamentoRow | null; onClose: () => void; onConfirmar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState("");
  if (!linha) return null;
  return (
    <Dialog open={!!linha} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm p-5">
        <DialogHeader>
          <DialogTitle>Ignorar divergência</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {linha.dia} — {fmtBRL(linha.valor)} — {linha.detalhe}
          </p>
          <div>
            <Label className="text-xs">Motivo (obrigatório)</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 300))} placeholder="Ex: transferência entre contas próprias, taxa, IOF..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={!motivo.trim()} onClick={() => { onConfirmar(motivo.trim()); setMotivo(""); }}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Aba Histórico ────────────────────────────────────────────────────────

function HistoricoTab() {
  const { data: salvas = [], isLoading } = useConciliacoesFluxoCaixaSalvas();
  const [abrirId, setAbrirId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-10">Carregando...</p>
          ) : salvas.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">Nenhuma conciliação salva ainda.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Período</th>
                  <th className="text-center px-4 py-2 font-medium text-muted-foreground">Divergências</th>
                  <th className="text-center px-4 py-2 font-medium text-muted-foreground">Ajustadas</th>
                  <th className="text-center px-4 py-2 font-medium text-muted-foreground">Criadas</th>
                  <th className="text-center px-4 py-2 font-medium text-muted-foreground">Ignoradas</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Salva em</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {salvas.map((c) => (
                  <tr key={c.id} className="border-b">
                    <td className="px-4 py-2">{isoParaBR(c.data_inicio)} — {isoParaBR(c.data_fim)}</td>
                    <td className="px-4 py-2 text-center">{c.total_linhas}</td>
                    <td className="px-4 py-2 text-center">{c.linhas_ajustadas}</td>
                    <td className="px-4 py-2 text-center">{c.linhas_criadas}</td>
                    <td className="px-4 py-2 text-center">{c.linhas_ignoradas}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{new Date(c.created_at).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setAbrirId(c.id)}>Ver</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <DialogDetalheConciliacao id={abrirId} onClose={() => setAbrirId(null)} />
    </div>
  );
}

function DialogDetalheConciliacao({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data } = useConciliacaoFluxoCaixaDetalhe(id);

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalhe da conciliação</DialogTitle>
        </DialogHeader>
        {data && (
          <div className="space-y-4">
            {data.arquivos.length > 0 && (
              <div>
                <Label className="text-xs">Arquivos OFX originais</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {data.arquivos.map((a) => (
                    <a key={a.id} href={a.url ?? "#"} target="_blank" rel="noreferrer" className="text-xs underline text-blue-600">
                      {a.nome_arquivo}
                    </a>
                  ))}
                </div>
              </div>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-2 py-1.5">Dia</th>
                  <th className="text-left px-2 py-1.5">Origem</th>
                  <th className="text-left px-2 py-1.5">Descrição</th>
                  <th className="text-right px-2 py-1.5">Valor</th>
                  <th className="text-center px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.linhas.map((l: ConciliacaoFluxoCaixaLinha) => (
                  <tr key={l.id} className="border-b">
                    <td className="px-2 py-1.5">{isoParaBR(l.dia)}</td>
                    <td className="px-2 py-1.5">{l.origem === "fluxo" ? "Fluxo" : "Extrato"}</td>
                    <td className="px-2 py-1.5 max-w-xs truncate">{l.descricao}{l.observacao ? ` — ${l.observacao}` : ""}</td>
                    <td className="px-2 py-1.5 text-right">{fmtBRL(l.valor)}</td>
                    <td className="px-2 py-1.5 text-center">
                      <Badge variant="secondary" className="text-xs">{l.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
