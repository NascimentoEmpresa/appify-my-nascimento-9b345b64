import { useMemo, useState } from "react";
import { FileDown, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFluxoCaixaCombinado, type FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";
import { useConciliacaoPlanilhaFluxo } from "@/hooks/useConciliacaoOrigem";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { BarraEquacao, KpisConciliacao, OrigemBadge, Paginacao, ResumoBaseCard, dia, mesAno } from "./conciliacao-origem/componentes";
import { FiltroData, FiltroSelect, opcoesUnicas } from "./conciliacao-origem/filtros";
import {
  conciliar, conferirPlanilha, origemDoFluxo, ROTULO_SITUACAO_PLANILHA, type Leitura, type OrigemBase,
} from "./conciliacao-origem/regras";

// SIS-2026-0658: Conciliação da origem do Fluxo de Caixa — total = o que foi lançado no ERP (Sistema) + o que
// subiu da planilha Excel antiga. Só leitura: usa as mesmas linhas da tela do Fluxo de Caixa.
const PAGE_SIZE = 50;

const ROTULO_ORIGEM: Record<string, string> = {
  malote: "Malote",
  debito_automatico: "Débito automático",
  cartao_fatura: "Cartão (fatura importada)",
  aplicacao_financeira: "Aplicação financeira",
  resgate_aplicacao: "Resgate de aplicação",
  importacao_historica: "Planilha Excel",
};
const rotuloOrigem = (o: string) => ROTULO_ORIGEM[o] ?? o;

// Valor com sinal: entrada soma, saída subtrai.
const valorComSinal = (l: FluxoCaixaMaloteLinha) => (l.tipo === "entrada" ? 1 : -1) * (Number(l.valor) || 0);

const LEITURA: Leitura<FluxoCaixaMaloteLinha> = {
  origem: (l) => origemDoFluxo(l.origem),
  valor: valorComSinal,
  data: (l) => l.data_pagamento,
};

export default function ConciliacaoOrigemFluxoCaixa() {
  const { data: linhas = [], isLoading } = useFluxoCaixaCombinado();
  const { data: planilha } = useConciliacaoPlanilhaFluxo();

  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [bancoId, setBancoId] = useState("");
  const [tipo, setTipo] = useState("");
  const [origem, setOrigem] = useState("");
  const [classificacaoId, setClassificacaoId] = useState("");
  const [forma, setForma] = useState("");
  const [pagina, setPagina] = useState(1);

  const temFiltro = !!(dataDe || dataAte || empresaId || bancoId || tipo || origem || classificacaoId || forma);
  const limpar = () => { setDataDe(""); setDataAte(""); setEmpresaId(""); setBancoId(""); setTipo(""); setOrigem(""); setClassificacaoId(""); setForma(""); setPagina(1); };

  const filtradas = useMemo(
    () => linhas.filter((l) => {
      if (dataDe && (!l.data_pagamento || l.data_pagamento < dataDe)) return false;
      if (dataAte && (!l.data_pagamento || l.data_pagamento > dataAte)) return false;
      if (empresaId && l.empresa_id !== empresaId) return false;
      if (bancoId && l.banco_id !== bancoId) return false;
      if (tipo && l.tipo !== tipo) return false;
      if (origem === "sistema" || origem === "excel") { if (origemDoFluxo(l.origem) !== origem) return false; }
      else if (origem && l.origem !== origem) return false;
      if (classificacaoId && l.classificacao_id !== classificacaoId) return false;
      if (forma && l.forma_pagamento !== forma) return false;
      return true;
    }),
    [linhas, dataDe, dataAte, empresaId, bancoId, tipo, origem, classificacaoId, forma],
  );

  const conc = useMemo(() => conciliar(filtradas, LEITURA), [filtradas]);
  // A conferência da planilha compara com TODAS as linhas Excel da tela (sem filtro), senão a conta não fecha.
  const excelNaTela = useMemo(() => conciliar(linhas, LEITURA).excel.valor, [linhas]);
  const conferencia = useMemo(() => (planilha ? conferirPlanilha(planilha, excelNaTela) : null), [planilha, excelNaTela]);
  const ajustadas = useMemo(() => linhas.filter((l) => l.ajustado && origemDoFluxo(l.origem) === "excel").length, [linhas]);

  const empresas = useMemo(() => opcoesUnicas(linhas, (l) => l.empresa_id, (l) => l.empresa_nome), [linhas]);
  const bancos = useMemo(() => opcoesUnicas(linhas, (l) => l.banco_id, (l) => l.banco_nome), [linhas]);
  const classificacoes = useMemo(() => opcoesUnicas(linhas, (l) => l.classificacao_id, (l) => l.classificacao_nome), [linhas]);
  const formas = useMemo(
    () => Array.from(new Set(linhas.map((l) => l.forma_pagamento).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "pt-BR")).map((f) => ({ value: f, label: f })),
    [linhas],
  );
  const origensDetalhe = useMemo(
    () => Array.from(new Set(linhas.map((l) => l.origem))).sort().map((o) => ({ value: o, label: rotuloOrigem(o) })),
    [linhas],
  );

  const pageRows = filtradas.slice((Math.min(pagina, Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE))) - 1) * PAGE_SIZE, Math.min(pagina, Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE))) * PAGE_SIZE);

  function exportar() {
    if (filtradas.length === 0) { toast.error("Não há lançamentos para exportar com esses filtros."); return; }
    const rotuloBase = (o: OrigemBase) => (o === "sistema" ? "Sistema" : "Excel antigo");
    const detalhe = filtradas.map((l) => ({
      "Origem/Base": rotuloBase(origemDoFluxo(l.origem)),
      "Origem do lançamento": rotuloOrigem(l.origem),
      "Nº": l.id_malote ?? "",
      "Data pagamento": dia(l.data_pagamento),
      Tipo: l.tipo === "entrada" ? "Entrada" : "Saída",
      Classificação: l.classificacao_nome ?? "",
      Descrição: l.descricao ?? "",
      Competência: mesAno(l.competencia),
      Empresa: l.empresa_nome ?? "",
      Contrato: l.contrato_nome ?? "",
      Banco: l.banco_nome ?? "",
      "Forma de pagamento": l.forma_pagamento ?? "",
      Valor: valorComSinal(l),
    }));
    const resumo: (string | number)[][] = [
      ["Conciliação da origem do Fluxo de Caixa", ""],
      ["Gerado em", new Date().toLocaleString("pt-BR")],
      ["Filtros aplicados", temFiltro ? "Sim (ver a tela)" : "Nenhum"],
      ["", ""],
      ["Total do Fluxo de Caixa", conc.total.valor],
      ["Origem Sistema", conc.sistema.valor],
      ["Origem Excel antigo", conc.excel.valor],
      ["Diferença a conciliar", conc.diferenca],
      ["", ""],
      ["Lançamentos (total / sistema / excel)", `${conc.total.qtd} / ${conc.sistema.qtd} / ${conc.excel.qtd}`],
      ["Obs.: valores com sinal (entradas positivas, saídas negativas).", ""],
    ];
    import("xlsx").then((XLSX) => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalhe), "Lançamentos");
      const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
      wsResumo["!cols"] = [{ wch: 44 }, { wch: 28 }];
      XLSX.utils.book_append_sheet(wb, wsResumo, "Conciliação");
      XLSX.writeFile(wb, `Conciliacao_Origem_Fluxo_de_Caixa_${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Conciliação da Origem do Fluxo de Caixa"
        subtitle="Concilie a composição do valor total do Fluxo de Caixa entre o que foi lançado no sistema e a base histórica importada do Excel, com rastreabilidade linha a linha."
        module="Financeiro"
        breadcrumb={["Financeiro", "Gestão Financeira", "Conciliação da Origem do Fluxo de Caixa"]}
        actions={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportar} disabled={isLoading}>
            <FileDown className="h-3.5 w-3.5" /> Exportar Excel
          </Button>
        }
      />

      <KpisConciliacao rotuloTotal="Total do Fluxo de Caixa" total={conc.total.valor} sistema={conc.sistema.valor} excel={conc.excel.valor} diferenca={conc.diferenca} />

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Filtros</h3>
            {temFiltro && <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={limpar}><X className="h-3.5 w-3.5" />Limpar filtros</Button>}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <FiltroData rotulo="Pagamento de" valor={dataDe} onChange={(v) => { setDataDe(v); setPagina(1); }} />
            <FiltroData rotulo="Pagamento até" valor={dataAte} onChange={(v) => { setDataAte(v); setPagina(1); }} />
            <FiltroSelect rotulo="Empresa" valor={empresaId} onChange={(v) => { setEmpresaId(v); setPagina(1); }} opcoes={empresas} />
            <FiltroSelect rotulo="Banco" valor={bancoId} onChange={(v) => { setBancoId(v); setPagina(1); }} opcoes={bancos} />
            <FiltroSelect rotulo="Tipo" valor={tipo} onChange={(v) => { setTipo(v); setPagina(1); }} opcoes={[{ value: "entrada", label: "Entrada" }, { value: "saida", label: "Saída" }]} />
            <FiltroSelect
              rotulo="Origem"
              valor={origem}
              onChange={(v) => { setOrigem(v); setPagina(1); }}
              opcoes={[{ value: "sistema", label: "Sistema (todas)" }, { value: "excel", label: "Excel antigo" }, ...origensDetalhe.filter((o) => o.value !== "importacao_historica")]}
            />
            <FiltroSelect rotulo="Classificação" valor={classificacaoId} onChange={(v) => { setClassificacaoId(v); setPagina(1); }} opcoes={classificacoes} />
            <FiltroSelect rotulo="Forma de pagamento" valor={forma} onChange={(v) => { setForma(v); setPagina(1); }} opcoes={formas} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <ResumoBaseCard titulo="Resumo da base do Sistema" origem="sistema" resumo={conc.sistema} quantidadeRotulo="Quantidade de lançamentos" mostrarEntradasSaidas />
        <ResumoBaseCard titulo="Resumo da base do Excel antigo" origem="excel" resumo={conc.excel} quantidadeRotulo="Quantidade de lançamentos" mostrarEntradasSaidas />
      </div>

      <BarraEquacao rotuloTotal="Total do Fluxo de Caixa" total={conc.total.valor} sistema={conc.sistema.valor} excel={conc.excel.valor} diferenca={conc.diferenca} />

      {conferencia && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div>
              <h3 className="text-sm font-semibold">Conferência da planilha carregada</h3>
              <p className="text-xs text-muted-foreground">
                Tudo o que subiu da planilha = o que está em uso + o que foi ocultado ou excluído. Valores com sinal (entradas − saídas).
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Situação das linhas da planilha</TableHead>
                  <TableHead className="text-right">Linhas</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conferencia.linhas.map((s) => (
                  <TableRow key={s.situacao}>
                    <TableCell>{ROTULO_SITUACAO_PLANILHA[s.situacao] ?? s.situacao}</TableCell>
                    <TableCell className="text-right">{s.qtd.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right">{formatBRL(s.valor)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Total carregado da planilha</TableCell>
                  <TableCell className="text-right">{conferencia.carregada.qtd.toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-right">{formatBRL(conferencia.carregada.valor)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className={Math.abs(conferencia.diferencaComTela) < 0.005 ? "text-xs text-emerald-700 dark:text-emerald-300" : "text-xs text-amber-700 dark:text-amber-300"}>
              {Math.abs(conferencia.diferencaComTela) < 0.005
                ? "O valor em uso da planilha é exatamente o que a tela do Fluxo de Caixa mostra como Excel."
                : `A planilha em uso difere do que o Fluxo mostra como Excel em ${formatBRL(Math.abs(conferencia.diferencaComTela))}${ajustadas > 0 ? ` — ${ajustadas.toLocaleString("pt-BR")} linha(s) da planilha têm valor ajustado no Fluxo.` : "."}`}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h3 className="text-sm font-semibold">Conciliação dos lançamentos</h3>
            <p className="text-xs text-muted-foreground">Cada lançamento do Fluxo de Caixa com a sua origem (respeita os filtros acima).</p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origem/Base</TableHead>
                  <TableHead>Nº</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Classificação</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Banco</TableHead>
                  <TableHead className="text-right">Valor (R$)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
                {!isLoading && pageRows.length === 0 && <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">Nenhum lançamento.</TableCell></TableRow>}
                {pageRows.map((l, i) => (
                  <TableRow key={`${l.despesa_id}-${l.numero_parcela ?? ""}-${l.linha_id ?? i}`}>
                    <TableCell><OrigemBadge origem={origemDoFluxo(l.origem)} detalhe={rotuloOrigem(l.origem)} /></TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{l.id_malote ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{dia(l.data_pagamento)}</TableCell>
                    <TableCell>{l.tipo === "entrada" ? "Entrada" : "Saída"}</TableCell>
                    <TableCell>{l.classificacao_nome ?? "—"}</TableCell>
                    <TableCell className="max-w-[260px] truncate" title={l.descricao ?? ""}>{l.descricao ?? "—"}</TableCell>
                    <TableCell>{mesAno(l.competencia)}</TableCell>
                    <TableCell>{l.empresa_nome ?? "—"}</TableCell>
                    <TableCell>{l.contrato_nome ?? "—"}</TableCell>
                    <TableCell>{l.banco_nome ?? "—"}</TableCell>
                    <TableCell className={`whitespace-nowrap text-right font-medium ${l.tipo === "entrada" ? "text-emerald-600" : "text-red-600"}`}>{formatBRL(valorComSinal(l))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Paginacao pagina={pagina} total={filtradas.length} tamanho={PAGE_SIZE} onChange={setPagina} />
        </CardContent>
      </Card>
    </div>
  );
}
