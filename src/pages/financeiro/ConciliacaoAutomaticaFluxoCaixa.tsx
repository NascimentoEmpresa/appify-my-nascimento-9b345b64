import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { ehSaldoAnterior, linhasSaldoAnterior } from "@/lib/conciliacaoSaldoAnterior";
import { type ResumoConciliacao } from "@/lib/conciliacaoResumo";
import { periodoDoMes, processarConciliacao, type RateioDeOutraConta } from "@/lib/conciliacaoCalculo";
import { aplicarEmpresaPagadora, mapaEmpresaPagadora } from "@/lib/conciliacaoEmpresaPagadora";
import { DashboardConciliacoes } from "@/pages/financeiro/conciliacao-dashboard/DashboardConciliacoes";
import { conciliacaoSemResumo, useGerarResumoConciliacoes } from "@/hooks/useGerarResumoConciliacao";
import { Upload, X, Play, RefreshCw, GitMerge, Pencil, PlusCircle, Save, History, CheckCircle2, LayoutDashboard, Info, Landmark } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AcessoGate } from "@/components/auth/AcessoGate";
import {
  parseOFX,
  parseSaldoFinalOFX,
  saldoFinalNoDia,
  reconciliar,
  transacoesNoPeriodo,
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
  useSaldosIniciaisConciliacao,
  useSalvarSaldoInicialConciliacao,
  useEmpresasPagadorasConciliacao,
  useSalvarEmpresaPagadora,
  type ConciliacaoFluxoCaixaLinha,
  type ConciliacaoFluxoCaixaSalva,
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
// ao recalcular. Só libera "Salvar conciliação" quando não sobra nenhuma
// pendência. SIS-2026-0713: o "Ignorar" saiu — ignorar fecha a conciliação
// sem fechar a diferença, e o valor continua sem bater (a chefia vê o
// Dashboard "resolvido" e a diferença ainda lá). Toda divergência se resolve
// (Ajustar/Criar) ou se corrige na origem e recalcula. O status "ignorado"
// fica só no tipo para mostrar o que já foi salvo assim.
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
  // SIS-2026-0720: a Auditoria da Controladoria (card 2) abre aqui já no Dashboard, na competência e na empresa dela, com os valores que ela mostra.
  const [searchParams] = useSearchParams();
  const vindoDaAuditoria = useMemo(() => {
    const mes = searchParams.get("mes");
    if (searchParams.get("aba") !== "dashboard" || !mes || !/^\d{4}-\d{2}$/.test(mes)) return null;
    const n = (k: string) => (searchParams.get(k) === null ? null : Number(searchParams.get(k)));
    return { mes, empresaId: searchParams.get("empresa"), fluxoEntradas: n("fe"), fluxoSaidas: n("fs"), extratoEntradas: n("ee"), extratoSaidas: n("es") };
  }, [searchParams]);
  const [aba, setAba] = useState<"conciliar" | "historico" | "dashboard">(vindoDaAuditoria ? "dashboard" : "conciliar");
  // SIS-2026-0713: "Ver detalhes" do dashboard abre o resultado salvo (sem pedir o OFX nem conciliar de novo).
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const { data: salvasDashboard = [] } = useConciliacoesFluxoCaixaSalvas();

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Conciliação Bancária"
        subtitle="Cruza os lançamentos do Fluxo de Caixa do próprio sistema com extratos OFX e identifica divergências automaticamente"
        module="Financeiro"
        breadcrumb={["Financeiro", "Gestão Financeira", "Conciliação Bancária"]}
      />

      <Tabs value={aba} onValueChange={(v) => setAba(v as "conciliar" | "historico" | "dashboard")}>
        <TabsList>
          <TabsTrigger value="conciliar" className="gap-1.5">
            <GitMerge className="h-3.5 w-3.5" /> Conciliar
          </TabsTrigger>
          <TabsTrigger value="historico" className="gap-1.5">
            <History className="h-3.5 w-3.5" /> Conciliações Salvas
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-1.5">
            <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard de Conciliações
          </TabsTrigger>
        </TabsList>
        <TabsContent value="conciliar" className="mt-4">
          <ConciliarTab />
        </TabsContent>
        <TabsContent value="historico" className="mt-4">
          <HistoricoTab />
        </TabsContent>
        <TabsContent value="dashboard" className="mt-4">
          <DashboardConciliacoes onVerDetalhes={setDetalheId} auditoria={vindoDaAuditoria} />
        </TabsContent>
      </Tabs>
      <DialogDetalheConciliacao id={detalheId} conciliacao={salvasDashboard.find((c) => c.id === detalheId) ?? null} onClose={() => setDetalheId(null)} />
    </div>
  );
}

// ── Aba Conciliar ────────────────────────────────────────────────────────

function ConciliarTab() {
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  // Mês da competência: o botão ao lado preenche Data De / Data Até com o primeiro e o último dia dele.
  const [mesCompetencia, setMesCompetencia] = useState("");
  const [bancoId, setBancoId] = useState("");
  // Conciliação é por conta: o extrato OFX é de UMA empresa naquele banco.
  // A pessoa informa quais empresas entram (uma, várias ou todas) — sem isso
  // o lado do Fluxo traz lançamentos de outras empresas do mesmo banco.
  const [empresaIds, setEmpresaIds] = useState<string[]>([]);
  const [todasEmpresas, setTodasEmpresas] = useState(false);
  const [contaExtrato, setContaExtrato] = useState<string | null>(null);
  // O OFX só traz movimentos e o saldo final — o saldo ANTERIOR (abertura)
  // está só no extrato impresso/PDF. Campo opcional pra digitar e conferir.
  // SIS-2026-0713: saldo anterior de JANEIRO informado à mão (fechamento de dezembro), por empresa + banco + ano de início do histórico.
  // Substitui o antigo "saldo anterior do extrato" digitado: aquele virava uma linha da conciliação, e o saldo inicial não é lançamento a conciliar.
  const [baseTxt, setBaseTxt] = useState<string | null>(null);
  // SIS-2026-0713: saldo FINAL do extrato (LEDGERBAL do OFX; dá para corrigir à mão) — o dashboard compara com o saldo do sistema.
  const [saldoFinalTxt, setSaldoFinalTxt] = useState("");
  const [saldoFinalData, setSaldoFinalData] = useState<string | null>(null);
  const [editandoSaldoFinal, setEditandoSaldoFinal] = useState(false);
  const [ofxFiles, setOfxFiles] = useState<File[]>([]);
  const [ofxTrns, setOfxTrns] = useState<OFXTransaction[] | null>(null);
  const [resultado, setResultado] = useState<ReconciliacaoResult | null>(null);
  const [processando, setProcessando] = useState(false);
  const [resolvidos, setResolvidos] = useState<Record<string, Resolucao>>({});
  // SIS-2026-0657: total do extrato dentro do período, guardado ao salvar (a Auditoria da Controladoria lê daqui).
  const [totaisExtrato, setTotaisExtrato] = useState<{ entradas: number; saidas: number } | null>(null);
  // Resumo do que bateu entre Fluxo e extrato (gravado ao salvar; a lista de salvas mostra mesmo sem divergência).
  const [resumo, setResumo] = useState<ResumoConciliacao | null>(null);
  const [rateiosOutraConta, setRateiosOutraConta] = useState<RateioDeOutraConta[]>([]);
  const [observacoes, setObservacoes] = useState("");

  const [dialogAjustar, setDialogAjustar] = useState<LancamentoRow | null>(null);
  const [dialogCriar, setDialogCriar] = useState<LancamentoRow | null>(null);
  const [abaResultado, setAbaResultado] = useState<"resumo" | "divergencias">("resumo");

  const { data: linhasFluxo = [] } = useFluxoCaixaCombinado();
  const { data: bancos = [] } = useCartaoBancos();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: pagadoras = [] } = useEmpresasPagadorasConciliacao();
  const salvarPagadora = useSalvarEmpresaPagadora();
  const [dialogPagadora, setDialogPagadora] = useState<LancamentoRow | null>(null);
  // Despesa rateada entre empresas pertence, na conciliação, à empresa que a pagou (quando marcada em "Quem pagou?"): o extrato dela traz o total.
  const linhasBrutas = useMemo(
    () => aplicarEmpresaPagadora(linhasFluxo, mapaEmpresaPagadora(pagadoras), new Map(empresas.map((e) => [e.id, e.nome]))),
    [linhasFluxo, pagadoras, empresas]
  );
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
  // Também só das empresas escolhidas: o banco é compartilhado pelo grupo, mas
  // o extrato é de uma conta. "Todas" não filtra (inclui lançamento sem empresa).
  const linhasDoBancoTodasEmpresas = useMemo(() => linhasPeriodo.filter((l) => l.banco_id === bancoId), [linhasPeriodo, bancoId]);
  const linhasDoBancoEmpresa = useMemo(
    () => linhasDoBancoTodasEmpresas.filter((l) => todasEmpresas || (!!l.empresa_id && empresaIds.includes(l.empresa_id))),
    [linhasDoBancoTodasEmpresas, todasEmpresas, empresaIds]
  );

  // "SALDO ANTERIOR" (importação histórica, dia 01/01) é o saldo de abertura
  // da conta — no extrato aparece como "SALDO ANT EM 24/12", não como
  // movimento, então nunca tem par no OFX e virava uma divergência falsa
  // (achado da Érica: R$ 270,22 da AGPS/Banrisul). Fica fora da comparação
  // normal (o saldo inicial é só a base do Dashboard, nunca um lançamento a conciliar).
  const linhasPeriodoBanco = useMemo(
    () => linhasDoBancoEmpresa.filter((l) => !ehSaldoAnterior(l)),
    [linhasDoBancoEmpresa]
  );

  // Aceita "270,22", "1.234,56" ou "270.22". Vazio/inválido = não informado.
  const saldoFinalExtrato = useMemo(() => {
    const t = saldoFinalTxt.replace(/R\$|\s/g, "");
    if (!t) return null;
    const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }, [saldoFinalTxt]);
  const empresasEscolhidas = todasEmpresas || empresaIds.length > 0;

  const { data: saldosIniciais = [] } = useSaldosIniciaisConciliacao();
  const salvarBase = useSalvarSaldoInicialConciliacao();
  const baseUmaEmpresa = !todasEmpresas && empresaIds.length === 1 && !!bancoId;
  const basesDoGrupo = baseUmaEmpresa ? saldosIniciais.filter((i) => i.empresa_id === empresaIds[0] && i.banco_id === bancoId) : [];
  // O ano é o de início do histórico: se já existe base, é o dela (não se pede de novo todo janeiro); senão, o do período escolhido.
  const baseAno = basesDoGrupo.length ? Math.min(...basesDoGrupo.map((i) => i.ano)) : Number((dataDe || new Date().toISOString()).slice(0, 4));
  const baseSalva = basesDoGrupo.some((i) => i.ano === baseAno) ? basesDoGrupo.filter((i) => i.ano === baseAno).reduce((t, i) => t + i.valor, 0) : null;

  // trocar de empresa ou banco descarta o que estava sendo digitado para a base anterior
  useEffect(() => setBaseTxt(null), [empresaIds.join(","), bancoId, todasEmpresas]);

  async function gravarBase() {
    if (baseTxt === null) return;
    const t = baseTxt.replace(/R\$|\s/g, "");
    const valor = t ? Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) : null;
    if (valor !== null && !Number.isFinite(valor)) {
      toast.error("Valor inválido para o saldo anterior de janeiro.");
      return;
    }
    try {
      await salvarBase.mutateAsync({ empresaId: empresaIds[0], bancoId, conta: "", ano: baseAno, valor: valor === null ? null : Math.round(valor * 100) / 100 });
      setBaseTxt(null);
      toast.success(valor === null ? "Saldo anterior removido." : "Saldo anterior de janeiro salvo.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar o saldo anterior.");
    }
  }

  function rodar(trns: OFXTransaction[]) {
    // O cálculo mora em lib/conciliacaoCalculo.ts (o mesmo que refaz o resumo das conciliações antigas).
    const { resultado: res, resumo: resumoCalc, totaisExtrato: totais, fora, rateiosDeOutraConta: rateios } = processarConciliacao({
      linhasDoBancoEmpresa,
      linhasDoBancoTodasEmpresas,
      trns,
      dataDe,
      dataAte,
      saldoExtrato: null,
      bancoNome: bancos.find((b) => b.id === bancoId)?.nome ?? "—",
    });
    setResumo(resumoCalc);
    setRateiosOutraConta(rateios);
    setTotaisExtrato(totais);
    setResultado(res);
    toast.success(
      `Conciliação processada — ${res.totalDias} dias, ${res.divergencias} dia(s) com divergência.` +
        (fora > 0 ? ` ${fora} lançamento(s) do extrato fora do período foram desconsiderados.` : "")
    );
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
    if (!empresasEscolhidas) {
      toast.error("Informe a(s) empresa(s) desta conciliação, ou marque \"Todas\".");
      return;
    }
    if (ofxFiles.length === 0) {
      toast.error("Selecione ao menos um arquivo .OFX.");
      return;
    }
    setProcessando(true);
    try {
      const trns: OFXTransaction[] = [];
      const contas = new Set<string>();
      let saldoFinalOfx: { valor: number; data: string | null } | null = null;
      for (const f of ofxFiles) {
        const text = await f.text();
        trns.push(...parseOFX(text, f.name));
        // Vários arquivos: vale o saldo final do que tem a data mais recente.
        const sf = parseSaldoFinalOFX(text);
        if (sf && (!saldoFinalOfx || (sf.data ?? "") >= (saldoFinalOfx.data ?? ""))) saldoFinalOfx = sf;
        // Conta do próprio extrato (BANKID/ACCTID) — só informativa, pra
        // conferir se a empresa escolhida é a dona desse arquivo.
        const bank = /<BANKID>\s*([^\s<]+)/i.exec(text)?.[1];
        const acct = /<ACCTID>\s*([^\s<]+)/i.exec(text)?.[1];
        if (acct) contas.add(bank ? `${bank} / ${acct}` : acct);
      }
      setContaExtrato(contas.size ? Array.from(contas).join(" · ") : null);
      // O saldo é o do ÚLTIMO DIA do período: se o arquivo passa dele, desconta o que se movimentou depois.
      const sfd = saldoFinalOfx as { valor: number; data: string | null } | null;
      setSaldoFinalTxt(sfd ? String(saldoFinalNoDia(sfd, trns, dataAte)).replace(".", ",") : "");
      setSaldoFinalData(sfd ? (sfd.data && sfd.data > dataAte ? dataAte : sfd.data) : null);
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

  const recalcularRef = useRef<() => void>(() => {});
  recalcularRef.current = recalcular;

  function reiniciar() {
    setOfxFiles([]);
    setOfxTrns(null);
    setResultado(null);
    setResolvidos({});
    setObservacoes("");
    setContaExtrato(null);
    setSaldoFinalTxt("");
    setSaldoFinalData(null);
    setEditandoSaldoFinal(false);
    setResumo(null);
    setRateiosOutraConta([]);
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

  async function confirmarPagadora(empresaId: string | null) {
    if (!dialogPagadora || !dialogPagadora.despesaId || !dialogPagadora.origemFluxo) return;
    try {
      await salvarPagadora.mutateAsync({ origem: dialogPagadora.origemFluxo, despesaId: dialogPagadora.despesaId, empresaId });
      const alvo = dialogPagadora;
      setDialogPagadora(null);
      toast.success(empresaId ? "Empresa pagadora marcada — recalculando..." : "Marcação removida — recalculando...");
      // O recálculo precisa ver as linhas já com a pagadora: lê a versão mais nova da função (a deste render ainda tem as linhas antigas).
      setTimeout(() => recalcularRef.current(), 300);
      if (empresaId) setResolvidos((prev) => ({ ...prev, [alvo.id]: { linha: alvo, status: "ajustado", observacao: "Despesa paga por outra empresa" } }));
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar a empresa pagadora.");
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

  async function handleSalvar() {
    if (!resultado || pendentes.length > 0) return;
    try {
      const linhas: SalvarLinhaInput[] = Object.values(resolvidos).map((r) => ({
        dia: brParaIso(r.linha.dia),
        origem: r.linha.tipoOFX && !r.linha.tipoPlanilha ? "extrato" : "fluxo",
        tipo: (r.linha.tipoOFX ?? r.linha.tipoPlanilha) === "ENTRADA" ? "entrada" : "saida",
        valor: r.linha.valor,
        descricao: r.linha.idMalote ? `${r.linha.idMalote} — ${r.linha.descricaoFluxo ?? r.linha.detalhe}` : r.linha.detalhe,
        banco: r.linha.origem,
        status: r.status,
        observacao: r.observacao ?? null,
        despesa_id: r.linha.despesaId ?? null,
        numero_parcela: r.linha.numeroParcela ?? null,
      }));
      const arquivosOfx = ofxFiles;
      const id = await salvar.mutateAsync({
        dataInicio: dataDe, dataFim: dataAte, observacoes: observacoes || null,
        bancoId, todasEmpresas, empresaIds, contaExtrato, arquivosOfx, linhas,
        saldoAnteriorFluxo: null,
        saldoAnteriorExtrato: null,
        saldoFinalExtrato,
        saldoFinalExtratoData: saldoFinalData,
        extratoEntradas: totaisExtrato?.entradas ?? null,
        extratoSaidas: totaisExtrato?.saidas ?? null,
        resumo,
      });
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
          <CardTitle className="text-sm">Período, Banco e Empresa</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-end">
          <div>
            <Label className="text-xs">Competência (mês)</Label>
            <div className="flex gap-1.5">
              <Input type="month" className="h-9 w-40" value={mesCompetencia} onChange={(e) => setMesCompetencia(e.target.value)} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                disabled={!periodoDoMes(mesCompetencia)}
                title="Preenche Data De e Data Até com o primeiro e o último dia do mês escolhido"
                onClick={() => {
                  const p = periodoDoMes(mesCompetencia);
                  if (p) { setDataDe(p.de); setDataAte(p.ate); }
                }}
              >
                Usar o mês
              </Button>
            </div>
          </div>
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
          <div className="min-w-[16rem] flex-1">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs">Empresa(s) desta conciliação *</Label>
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={todasEmpresas}
                  onChange={(e) => { setTodasEmpresas(e.target.checked); if (e.target.checked) setEmpresaIds([]); }}
                />
                Todas as empresas
              </label>
            </div>
            <SearchableMultiSelect
              value={empresaIds}
              onChange={setEmpresaIds}
              options={empresas.map((e) => ({ value: e.id, label: e.nome }))}
              placeholder={todasEmpresas ? "Todas as empresas" : "Selecione uma ou mais empresas…"}
              searchPlaceholder="Buscar empresa…"
              disabled={todasEmpresas}
              maxBadges={3}
            />
          </div>
          {/* Só faz sentido com UMA empresa e UM banco: a base é por empresa, banco e ano de início do histórico. */}
          {baseUmaEmpresa && (
            <AcessoGate menu="conciliacao-fluxo-caixa" acao="alterar">
              <div>
                <Label className="text-xs">Saldo anterior de janeiro/{baseAno} (manual)</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    className="h-9 w-44"
                    inputMode="decimal"
                    placeholder="Fechamento de dezembro"
                    value={baseTxt ?? (baseSalva != null ? String(baseSalva).replace(".", ",") : "")}
                    onChange={(e) => setBaseTxt(e.target.value)}
                  />
                  <Button size="sm" variant="outline" className="h-9" disabled={baseTxt === null || salvarBase.isPending} onClick={() => void gravarBase()}>
                    Salvar
                  </Button>
                  <span title="Fechamento de dezembro do ano anterior = abertura de janeiro. Informe uma vez, no início do histórico: vale como base dos saldos do sistema, não entra como entrada, saída nem lançamento a conciliar e não é somado de novo a cada conciliação. Os meses seguintes partem do fechamento do mês anterior.">
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </span>
                </div>
              </div>
            </AcessoGate>
          )}
          <div className="w-full text-xs text-muted-foreground">
            {bancoId && empresasEscolhidas
              ? `${linhasPeriodoBanco.length} de ${linhasPeriodo.length} lançamento(s) do Fluxo de Caixa no período são deste banco${todasEmpresas ? "" : " e das empresas escolhidas"}.`
              : `${linhasPeriodo.length} lançamento(s) do Fluxo de Caixa no período. Escolha o banco e a(s) empresa(s) para conciliar.`}
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
              disabled={processando || !dataDe || !dataAte || !bancoId || !empresasEscolhidas || ofxFiles.length === 0}
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

          {/* SIS-2026-0713: só existe depois de processar o OFX. É o saldo que o Dashboard compara com o saldo do sistema. */}
          <Card className="border-2 border-purple-300 bg-purple-50/50 dark:bg-purple-950/10">
            <CardContent className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-center">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600">
                  <Landmark className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-purple-700">Saldo final do extrato</p>
                  {editandoSaldoFinal ? (
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        autoFocus
                        className="h-9 w-44 bg-background"
                        inputMode="decimal"
                        placeholder="Ex.: 12.345,67"
                        value={saldoFinalTxt}
                        onChange={(e) => setSaldoFinalTxt(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && setEditandoSaldoFinal(false)}
                      />
                      <Button size="sm" onClick={() => setEditandoSaldoFinal(false)}>OK</Button>
                    </div>
                  ) : saldoFinalExtrato != null ? (
                    <>
                      <p className="text-2xl font-bold leading-tight text-purple-900 dark:text-purple-200">{fmtBRL(saldoFinalExtrato)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {saldoFinalData ? `Saldo em ${isoParaBR(saldoFinalData)} · ` : ""}lido do arquivo OFX
                        <Button variant="link" size="sm" className="ml-1 h-auto p-0 text-[11px]" onClick={() => setEditandoSaldoFinal(true)}>
                          <Pencil className="mr-0.5 h-3 w-3" /> Corrigir
                        </Button>
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-semibold text-muted-foreground">Não informado no arquivo</p>
                      <Button variant="link" size="sm" className="h-auto p-0 text-[11px]" onClick={() => setEditandoSaldoFinal(true)}>
                        <Pencil className="mr-0.5 h-3 w-3" /> Informar
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2 rounded-md border border-purple-200 bg-background/70 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
                <p>
                  É o saldo do extrato no <strong>último dia do período</strong>. Se o arquivo vai além do período, desconta o que se movimentou depois.
                  Ao salvar, o Dashboard de Conciliações compara esse valor com o saldo do sistema do mês (saldo anterior de janeiro + entradas − saídas).
                  Confira com o extrato e corrija se estiver diferente. Sem ele, o mês fica como "pendente de conferência".
                </p>
              </div>
            </CardContent>
          </Card>

          {rateiosOutraConta.length > 0 && (
            <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
              <p className="font-semibold">
                {rateiosOutraConta.length} despesa(s) rateada(s) entre empresas, sem o total neste extrato — provavelmente pagas pela conta de outra empresa
              </p>
              <p className="mt-0.5 text-sky-800/80 dark:text-sky-300/80">
                A conciliação lê o total da despesa, não a fatia. Estas só têm parte das empresas aqui e o total não caiu neste extrato, então não são pendência
                e não travam o salvamento. Para cobrá-las como falta de pagamento, concilie com todas as empresas do rateio juntas (ou "Todas as empresas").
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {rateiosOutraConta.map((r, i) => (
                  <li key={i}>
                    <span className="font-mono">{r.idMalote}</span> · {isoParaBR(r.dia)} · total {fmtBRL(r.total)} (fatia desta conciliação {fmtBRL(r.daEmpresa)}) · {r.empresas.join(" + ")} · {r.descricao}
                  </li>
                ))}
              </ul>
            </div>
          )}

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
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">ID no Fluxo</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Detalhe</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Valor</th>
                        <th className="text-center px-4 py-2 font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.lancamentos.map((l) => {
                        const resolucao = resolvidos[l.id];
                        // SIS-2026-0473: Aplicações Financeiras não passa pelo ajuste
                        // inline daqui — valor_aplicado é imutável por design (RPC
                        // aplicacao_financeira_editar não deixa mudá-lo); correção é
                        // excluir + recadastrar na própria tela de Aplicações.
                        const podeAjustar = !!l.despesaId && l.origemFluxo !== "aplicacao_financeira" && !resolucao;
                        const podeCriar = l.erro === "🚨 FLUXO - NÃO ENCONTRADO" && !resolucao;
                        // Fatia de despesa do Malote que não caiu no extrato desta conta: pode ter sido paga pela conta de outra empresa do rateio.
                        const podePagadora = l.erro === "⚠️ BANCO - NÃO ENCONTRADO" && l.origemFluxo === "malote" && !!l.despesaId && !resolucao;
                        return (
                          <tr key={l.id} className={cn("border-b", resolucao && "opacity-60")}>
                            <td className="px-4 py-2 whitespace-nowrap font-medium">{l.dia}</td>
                            <td className="px-4 py-2">{descreverOcorrencia(l)}</td>
                            <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{l.origem}</td>
                            <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{l.empresaNome ?? "—"}</td>
                            <td className="px-4 py-2 whitespace-nowrap">
                              {l.idMalote ? (
                                <>
                                  <a
                                    href={`/app/financeiro/gestao-financeira/fluxo-caixa?busca=${encodeURIComponent(l.idMalote)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-mono text-blue-600 underline hover:text-blue-800"
                                    title="Abrir este lançamento no Fluxo de Caixa (nova aba)"
                                  >
                                    {l.idMalote}
                                  </a>
                                  {(l.partes ?? 1) > 1 && (
                                    <span className="block text-[10px] text-muted-foreground" title="O rateio é somado numa linha só na conciliação: no Fluxo o valor aparece dividido.">
                                      soma de {l.partes} lançamentos do rateio
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground max-w-xs truncate" title={l.descricaoFluxo ? `${l.descricaoFluxo} — ${l.detalhe}` : l.detalhe}>
                              {l.descricaoFluxo ?? l.detalhe}
                            </td>
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
                                  {podePagadora && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 text-xs px-2"
                                      title="Despesa rateada entre empresas, paga por uma conta só: marque qual empresa pagou"
                                      onClick={() => setDialogPagadora(l)}
                                    >
                                      <Landmark className="h-3 w-3 mr-1" /> Quem pagou?
                                    </Button>
                                  )}
                                  {podeCriar && (
                                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setDialogCriar(l)}>
                                      <PlusCircle className="h-3 w-3 mr-1" /> Criar
                                    </Button>
                                  )}
                                  {!podeAjustar && !podeCriar && (
                                    <span
                                      className="text-[11px] text-muted-foreground"
                                      title={l.origemFluxo === "aplicacao_financeira"
                                        ? "Aplicação financeira não se ajusta aqui: corrija (exclua e recadastre) na tela de Aplicações Financeiras e use Recalcular."
                                        : "Sem ajuste possível aqui: corrija o lançamento na origem e use Recalcular."}
                                    >
                                      Corrigir na origem
                                    </span>
                                  )}
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
      <DialogEmpresaPagadora
        linha={dialogPagadora}
        empresas={empresas}
        atual={dialogPagadora ? pagadoras.find((p) => p.origem === dialogPagadora.origemFluxo && p.despesa_id === dialogPagadora.despesaId && p.numero_parcela == null)?.empresa_pagadora_id ?? "" : ""}
        onClose={() => setDialogPagadora(null)}
        onConfirmar={confirmarPagadora}
        salvando={salvarPagadora.isPending}
      />
      <DialogCriarLancamento linha={dialogCriar} onClose={() => setDialogCriar(null)} onConfirmar={confirmarCriar} salvando={criarDebito.isPending} empresaInicial={!todasEmpresas && empresaIds.length === 1 ? empresaIds[0] : ""} bancoInicial={bancoId} />
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

// ── Dialog: Quem pagou a despesa rateada entre empresas ──────────────────

function DialogEmpresaPagadora({
  linha,
  empresas,
  atual,
  onClose,
  onConfirmar,
  salvando,
}: {
  linha: LancamentoRow | null;
  empresas: { id: string; nome: string }[];
  atual: string;
  onClose: () => void;
  onConfirmar: (empresaId: string | null) => void;
  salvando: boolean;
}) {
  const [empresaId, setEmpresaId] = useState("");
  useEffect(() => setEmpresaId(atual), [linha, atual]);

  if (!linha) return null;
  return (
    <Dialog open={!!linha} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md p-5">
        <DialogHeader>
          <DialogTitle>Quem pagou esta despesa?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {linha.idMalote ? `${linha.idMalote} — ` : ""}{linha.dia} — {fmtBRL(linha.valor)} — {linha.descricaoFluxo ?? linha.detalhe}
          </p>
          <p className="text-xs text-muted-foreground">
            Numa despesa rateada entre empresas, o pagamento sai da conta de UMA delas e o extrato mostra o valor total. Escolha a empresa que
            pagou: na conciliação, a despesa inteira passa a ser dela (o total no extrato dela, nada no das outras). Vale só para a conciliação — o
            Fluxo de Caixa e o rateio continuam como estão.
          </p>
          <div>
            <Label className="text-xs">Empresa que pagou</Label>
            <Select value={empresaId || "_"} onValueChange={(v) => setEmpresaId(v === "_" ? "" : v)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">—</SelectItem>
                {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          {atual && (
            <Button variant="ghost" size="sm" onClick={() => onConfirmar(null)} disabled={salvando}>Remover marcação</Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button size="sm" disabled={salvando || !empresaId || empresaId === atual} onClick={() => onConfirmar(empresaId)}>
            {salvando ? "Salvando..." : "Confirmar"}
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
  empresaInicial = "",
  bancoInicial = "",
}: {
  linha: LancamentoRow | null;
  onClose: () => void;
  onConfirmar: (dados: { empresaId: string; classificacaoId: string; descricao: string; formaPagamento: string; bancoId: string }) => void;
  salvando: boolean;
  // Vêm da conciliação: com uma só empresa escolhida, não faz sentido pedir de novo.
  empresaInicial?: string;
  bancoInicial?: string;
}) {
  const [empresaId, setEmpresaId] = useState(empresaInicial);
  const [classificacaoId, setClassificacaoId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [bancoId, setBancoId] = useState(bancoInicial);

  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: classificacoes = [] } = useClassificacoesOrcamentoAdmin();
  const { data: formasPagamento = [] } = useFormasPagamento();
  const { data: bancos = [] } = useCartaoBancos();

  // O componente fica montado entre uma linha e outra: sugere a empresa e o
  // banco da conciliação toda vez que abre para uma linha nova.
  useEffect(() => {
    if (!linha) return;
    setEmpresaId(empresaInicial);
    setBancoId(bancoInicial);
    // O memo do extrato já vem como descrição (editável). Antes era só placeholder: parecia
    // preenchido, mas o campo estava vazio e o botão ficava bloqueado sem explicação.
    setDescricao(linha.detalhe.slice(0, 60));
  }, [linha?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const faltando = [
    !empresaId && "Empresa",
    !classificacaoId && "Classificação",
    !descricao.trim() && "Descrição",
    !formaPagamento && "Forma de Pagamento",
    !bancoId && "Banco",
  ].filter(Boolean) as string[];

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
        {faltando.length > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">Para criar, preencha: {faltando.join(", ")}.</p>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button
            size="sm"
            disabled={salvando || faltando.length > 0}
            onClick={() => onConfirmar({ empresaId, classificacaoId, descricao: descricao.trim(), formaPagamento, bancoId })}
          >
            {salvando ? "Criando..." : "Criar lançamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Aba Histórico ────────────────────────────────────────────────────────

function HistoricoTab() {
  const { data: salvas = [], isLoading } = useConciliacoesFluxoCaixaSalvas();
  const { data: bancos = [] } = useCartaoBancos();
  const { data: empresas = [] } = useEmpresasGrupo();
  const [abrirId, setAbrirId] = useState<string | null>(null);
  const { data: linhasBrutas = [], isLoading: carregandoFluxo } = useFluxoCaixaCombinado();
  const gerarResumo = useGerarResumoConciliacoes();
  const bancoNome = (id: string) => bancos.find((b) => b.id === id)?.nome ?? "—";
  const semResumo = salvas.filter(conciliacaoSemResumo);

  // Conciliações antigas: refaz o resumo com o .OFX guardado e o Fluxo de hoje (ver hooks/useGerarResumoConciliacao.ts).
  async function gerar(lista: typeof salvas) {
    const r = await gerarResumo.mutateAsync(
      lista.map((c) => ({ conciliacao: c, linhasBrutas, bancoNome: c.banco_id ? bancoNome(c.banco_id) : "—" }))
    );
    if (r.ok > 0) toast.success(`Resumo gerado em ${r.ok} conciliação(ões).`);
    if (r.erros.length > 0) toast.error(r.erros[0] + (r.erros.length > 1 ? ` (e mais ${r.erros.length - 1} erro(s))` : ""));
  }
  const empresaNome = (id: string) => empresas.find((e) => e.id === id)?.nome ?? "—";

  return (
    <div className="space-y-4">
      {semResumo.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
          <span className="flex-1 min-w-[260px] text-muted-foreground">
            {semResumo.length} conciliação(ões) salva(s) antes do resumo de valores conciliados. Dá para gerar o resumo agora: refaz o cálculo com o
            extrato .OFX guardado e o Fluxo de Caixa de hoje do mesmo período, banco e empresas.
          </span>
          <Button size="sm" onClick={() => void gerar(semResumo)} disabled={gerarResumo.isPending || carregandoFluxo}>
            {gerarResumo.isPending ? "Gerando..." : carregandoFluxo ? "Carregando o Fluxo..." : `Gerar resumo das ${semResumo.length} conciliações`}
          </Button>
        </div>
      )}
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
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Banco / Empresa</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Conciliado</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Extrato</th>
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
                    <td className="px-4 py-2 text-xs">
                      <div className="font-medium">{c.banco_id ? bancoNome(c.banco_id) : "—"}</div>
                      <div className="text-muted-foreground" title={c.conta_extrato ?? undefined}>
                        {c.todas_empresas ? "Todas as empresas" : c.empresa_ids.map(empresaNome).join(", ") || "—"}
                      </div>
                      {c.saldo_anterior_extrato != null && c.saldo_anterior_fluxo != null && (
                        <div className={c.saldo_anterior_extrato === c.saldo_anterior_fluxo ? "text-emerald-700" : "text-rose-700"}>
                          Saldo ant.: {c.saldo_anterior_extrato === c.saldo_anterior_fluxo ? "confere" : "diverge"}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-xs whitespace-nowrap">
                      {c.conciliado_entradas != null && c.conciliado_saidas != null ? (
                        <>
                          <div className="text-emerald-700">Entradas {fmtBRL(c.conciliado_entradas)}</div>
                          <div className="text-rose-700">Saídas {fmtBRL(c.conciliado_saidas)}</div>
                          <div className="text-muted-foreground">
                            {c.qtd_conciliadas ?? 0} de {c.qtd_fluxo ?? 0} lançamentos · {c.dias_ok ?? 0}/{c.dias_total ?? 0} dias OK
                          </div>
                        </>
                      ) : <span className="text-muted-foreground" title="Conciliação salva antes do resumo de valores conciliados.">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-xs whitespace-nowrap">
                      {c.extrato_entradas != null && c.extrato_saidas != null ? (
                        <>
                          <div>Entradas {fmtBRL(c.extrato_entradas)}</div>
                          <div>Saídas {fmtBRL(c.extrato_saidas)}</div>
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2 text-center">{c.total_linhas}</td>
                    <td className="px-4 py-2 text-center">{c.linhas_ajustadas}</td>
                    <td className="px-4 py-2 text-center">{c.linhas_criadas}</td>
                    <td className="px-4 py-2 text-center">{c.linhas_ignoradas}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{new Date(c.created_at).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-2 text-right">
                      {conciliacaoSemResumo(c) && (
                        <Button size="sm" variant="outline" className="mr-1" onClick={() => void gerar([c])} disabled={gerarResumo.isPending || carregandoFluxo}>
                          Gerar resumo
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setAbrirId(c.id)}>Ver</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <DialogDetalheConciliacao id={abrirId} conciliacao={salvas.find((c) => c.id === abrirId) ?? null} onClose={() => setAbrirId(null)} />
    </div>
  );
}

function DialogDetalheConciliacao({ id, conciliacao, onClose }: { id: string | null; conciliacao: ConciliacaoFluxoCaixaSalva | null; onClose: () => void }) {
  const { data } = useConciliacaoFluxoCaixaDetalhe(id);
  const { data: bancosDet = [] } = useCartaoBancos();
  const { data: empresasDet = [] } = useEmpresasGrupo();

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalhe da conciliação</DialogTitle>
        </DialogHeader>
        {data && (
          <div className="space-y-4">
            {conciliacao && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {[
                    { rotulo: "Empresa", valor: conciliacao.todas_empresas ? "Todas as empresas" : conciliacao.empresa_ids.map((e) => empresasDet.find((x) => x.id === e)?.nome ?? "—").join(", ") || "—" },
                    { rotulo: "Banco", valor: conciliacao.banco_id ? bancosDet.find((b) => b.id === conciliacao.banco_id)?.nome ?? "—" : "—" },
                    { rotulo: "Conta", valor: conciliacao.conta_extrato ?? "—" },
                    { rotulo: "Período", valor: `${isoParaBR(conciliacao.data_inicio)} a ${isoParaBR(conciliacao.data_fim)}` },
                  ].map((k) => (
                    <div key={k.rotulo} className="rounded-md border p-2">
                      <p className="text-muted-foreground">{k.rotulo}</p>
                      <p className="text-sm font-semibold break-words">{k.valor}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {[
                    { rotulo: "Dias processados", valor: conciliacao.dias_total != null ? String(conciliacao.dias_total) : "—" },
                    { rotulo: "Dias OK", valor: conciliacao.dias_ok != null ? String(conciliacao.dias_ok) : "—" },
                    { rotulo: "Divergências", valor: String(conciliacao.total_linhas) },
                    { rotulo: "Pendentes (ignoradas)", valor: String(conciliacao.linhas_ignoradas) },
                  ].map((k) => (
                    <div key={k.rotulo} className="rounded-md border p-2">
                      <p className="text-muted-foreground">{k.rotulo}</p>
                      <p className="text-sm font-semibold">{k.valor}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {conciliacao && conciliacao.conciliado_entradas != null && conciliacao.conciliado_saidas != null && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {[
                  { rotulo: "Fluxo — entradas", valor: fmtBRL(conciliacao.fluxo_entradas ?? 0) },
                  { rotulo: "Fluxo — saídas", valor: fmtBRL(conciliacao.fluxo_saidas ?? 0) },
                  { rotulo: "Extrato — entradas", valor: conciliacao.extrato_entradas != null ? fmtBRL(conciliacao.extrato_entradas) : "—" },
                  { rotulo: "Extrato — saídas", valor: conciliacao.extrato_saidas != null ? fmtBRL(conciliacao.extrato_saidas) : "—" },
                  { rotulo: "Conciliado — entradas", valor: fmtBRL(conciliacao.conciliado_entradas) },
                  { rotulo: "Conciliado — saídas", valor: fmtBRL(conciliacao.conciliado_saidas) },
                  { rotulo: "Lançamentos conciliados", valor: `${conciliacao.qtd_conciliadas ?? 0} de ${conciliacao.qtd_fluxo ?? 0}` },
                  { rotulo: "Dias OK", valor: `${conciliacao.dias_ok ?? 0} de ${conciliacao.dias_total ?? 0}` },
                ].map((k) => (
                  <div key={k.rotulo} className="rounded-md border p-2">
                    <p className="text-muted-foreground">{k.rotulo}</p>
                    <p className="text-sm font-semibold">{k.valor}</p>
                  </div>
                ))}
              </div>
            )}
            {conciliacao?.resumo_dias && conciliacao.resumo_dias.length > 0 && (
              <div>
                <Label className="text-xs">Resumo por Dia — valor no Fluxo × valor no extrato</Label>
                <table className="mt-1 w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-2 py-1.5">Data</th>
                      <th className="text-right px-2 py-1.5">Fluxo</th>
                      <th className="text-right px-2 py-1.5">Extrato</th>
                      <th className="text-right px-2 py-1.5">Diferença</th>
                      <th className="text-center px-2 py-1.5">Status</th>
                      <th className="text-left px-2 py-1.5">Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conciliacao.resumo_dias.map((d) => (
                      <tr key={d.dia} className={cn("border-b", !d.ok && "bg-red-50 dark:bg-red-950/10")}>
                        <td className="px-2 py-1.5 font-medium whitespace-nowrap">{isoParaBR(d.dia)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtBRL(d.fluxoTotal ?? d.fluxoEntradas + d.fluxoSaidas)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtBRL(d.extratoTotal ?? d.extratoEntradas + d.extratoSaidas)}</td>
                        <td className={cn("px-2 py-1.5 text-right font-medium", Math.abs(d.diferenca ?? 0) < 0.005 ? "text-green-600" : "text-red-600")}>
                          {(d.diferenca ?? 0) >= 0 ? "+" : ""}{fmtBRL(d.diferenca ?? 0)}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {d.ok
                            ? <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">✓ OK</Badge>
                            : <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">Divergente</Badge>}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{d.observacao ?? "—"}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold bg-muted/40">
                      <td className="px-2 py-1.5">Total</td>
                      <td className="px-2 py-1.5 text-right">{fmtBRL(conciliacao.resumo_dias.reduce((s, d) => s + (d.fluxoTotal ?? d.fluxoEntradas + d.fluxoSaidas), 0))}</td>
                      <td className="px-2 py-1.5 text-right">{fmtBRL(conciliacao.resumo_dias.reduce((s, d) => s + (d.extratoTotal ?? d.extratoEntradas + d.extratoSaidas), 0))}</td>
                      <td className="px-2 py-1.5 text-right">{fmtBRL(conciliacao.resumo_dias.reduce((s, d) => s + (d.diferenca ?? 0), 0))}</td>
                      <td className="px-2 py-1.5" />
                      <td className="px-2 py-1.5" />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {data.linhas.length === 0 && (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                Nenhuma divergência: tudo o que estava no Fluxo de Caixa neste período bateu com o extrato.
              </p>
            )}
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
            {data.linhas.length > 0 && (
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
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
