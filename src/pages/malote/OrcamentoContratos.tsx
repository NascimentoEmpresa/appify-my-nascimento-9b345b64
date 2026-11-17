import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Info } from "lucide-react";
import { useOrcamentoContratos } from "@/hooks/useOrcamentoContratos";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { anoMesAtual } from "@/hooks/usePlanilhaCusto";
import { TituloComFormula } from "@/pages/controladoria/faturamento/Rentabilidade";
import { AssinaturaRegra } from "./AssinaturaRegra";
import { fmtMoney } from "./orcamentoUtils";
import { FiltroEmpresaOrcamento, EMPRESA_FILTRO_TODAS, FiltroEmpresaValor } from "./FiltroEmpresaOrcamento";

// Orçamento de Contratos (SIS-2026-0125, ajustado após feedback): espelho
// direto da Planilha de Custo por contrato — não depende de nenhuma
// ligação pra aparecer (assim como o Orçamento Administrativo não depende
// de nada além do seu próprio cadastro). Agrupado por contrato num
// accordion pra não ficar poluído (cada contrato pode ter dezenas de
// rubricas com valor).
export default function OrcamentoContratos() {
  // SIS-2026-0337: useOrcamentoContratos já resolve TODAS as empresas que
  // o usuário acessa (não só a empresa ativa do seletor) — o filtro abaixo
  // (FiltroEmpresaOrcamento) é quem devolve a opção de olhar uma só.
  // SIS-2026-0828: o orçamento é do mês e sai pelo EXECUTADO (faturado nas NFs da competência), não pelo executável da Planilha de Custo.
  // O mês pode vir na URL (?mes=YYYY-MM): é por onde o ADM e Sócios leva até aqui.
  const [params, setParams] = useSearchParams();
  const mesParam = params.get("mes");
  const anoMes = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : anoMesAtual();
  const { data: grupos, isLoading } = useOrcamentoContratos(anoMes);
  const { data: empresasGrupo = [] } = useEmpresasGrupo();
  const empresaNomePorId = useMemo(() => new Map(empresasGrupo.map((e) => [e.id, e.nome])), [empresasGrupo]);
  const [filtroEmpresaId, setFiltroEmpresaId] = useState<FiltroEmpresaValor>(EMPRESA_FILTRO_TODAS);
  const [busca, setBusca] = useState("");

  const gruposDaEmpresa = useMemo(
    () => (filtroEmpresaId === EMPRESA_FILTRO_TODAS ? grupos : grupos.filter((g) => g.contrato.empresa_id === filtroEmpresaId)),
    [grupos, filtroEmpresaId]
  );

  const filtrados = useMemo(() => {
    const base = busca.trim()
      ? gruposDaEmpresa.filter((g) => {
          const alvo = busca.toLowerCase();
          return (
            g.contrato.nome.toLowerCase().includes(alvo) ||
            g.contrato.cliente.toLowerCase().includes(alvo) ||
            g.rubricas.some((r) => r.label.toLowerCase().includes(alvo))
          );
        })
      : gruposDaEmpresa;
    return [...base].sort((a, b) => a.contrato.nome.localeCompare(b.contrato.nome, "pt-BR"));
  }, [gruposDaEmpresa, busca]);

  // KPIs refletem o total de contratos ativos na empresa filtrada (não a
  // busca) — a busca filtra só a lista abaixo. Mantém os cards batendo com
  // "Contratos Ativos" da tela de Contratos e com o breakdown da Planilha
  // de Custo quando "Todas as empresas" está selecionado.
  const valorTotal = useMemo(() => gruposDaEmpresa.reduce((s, g) => s + g.valorTotal, 0), [gruposDaEmpresa]);
  const executavelTotal = useMemo(() => gruposDaEmpresa.reduce((s, g) => s + (g.executavel ?? g.valorTotal), 0), [gruposDaEmpresa]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Orçamento de Contratos"
        subtitle="Valor executado (faturado no mês) por contrato, aberto nas rubricas da Planilha de Custo."
        module="Malote"
        breadcrumb={["Malote", "Classificações e Orçamentos", "Orçamento de Contratos"]}
      />

      <div className="flex justify-end">
        <div>
          <Label className="text-xs"><TituloComFormula alinhar="left" titulo="Ano/Mês" formula={<span>Competência das NFs (executado) e da vigência da planilha (executável). Pode vir na URL: ?mes=AAAA-MM.</span>} /></Label>
          <Input type="month" className="w-44" value={anoMes} onChange={(e) => setParams(e.target.value ? { mes: e.target.value } : {}, { replace: true })} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Contratos ativos</CardDescription>
            <CardTitle className="text-3xl">{gruposDaEmpresa.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription><TituloComFormula alinhar="left" titulo="Valor total executado" formula={<><span className="block">Soma, dos contratos ativos, do orçamento do mês. Cada contrato vale o que <strong>faturou na competência</strong> (Valor contrato exec. das NFs: código N, não canceladas nem substituídas) a partir de <strong>70%</strong> do executável.</span><span className="block">Abaixo disso, ou sem NF, vale o executável (<strong>Previsto</strong>) no mês corrente e nos futuros. Mês passado sem NF = R$ 0.</span><AssinaturaRegra chamado="SIS-2026-0828" /></>} /></CardDescription>
            <CardTitle className="text-2xl">{fmtMoney(valorTotal)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription><TituloComFormula alinhar="left" titulo="Valor executável (Planilha de Custo)" formula={<><span className="block">Total que a Planilha de Custo prevê para o mês (rubricas vigentes no fim do mês × quantidade de postos). É o valor que o orçamento usava antes; fica aqui só para comparar com o executado.</span><AssinaturaRegra chamado="SIS-2026-0828" /></>} /></CardDescription>
            <CardTitle className="text-2xl text-muted-foreground">{fmtMoney(executavelTotal)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <p className="text-muted-foreground">
          O valor de cada contrato é o que ele <b>faturou na competência</b> (Valor contrato exec. das NFs, as mesmas do Controle de Faturamento).
          Cada rubrica mantém a proporção da Planilha de Custo vigente no mês: rubrica × (executado ÷ executável). Enquanto o faturado não chega a 70% do executável (nota parcial ou ainda não emitida), o contrato segue pelo executável (Previsto); mês passado sem nenhuma NF fica em R$ 0.
          Abra um contrato pra ver o detalhamento por rubrica.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">Contratos</CardTitle>
          <div className="flex items-end gap-3">
            <div className="w-48">
              <FiltroEmpresaOrcamento value={filtroEmpresaId} onChange={setFiltroEmpresaId} />
            </div>
            <div className="w-64">
              <Label className="text-xs">Buscar</Label>
              <Input
                placeholder="Contrato, cliente ou rubrica..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-center text-muted-foreground py-8">Carregando...</p>}
          {!isLoading && filtrados.length === 0 && (
            <p className="text-center text-muted-foreground py-8">Nenhum orçamento de contrato encontrado.</p>
          )}
          {!isLoading && filtrados.length > 0 && (
            <Accordion type="multiple" className="w-full">
              {filtrados.map((g) => (
                <AccordionItem key={g.contrato.id} value={g.contrato.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                      <div className="text-left">
                        <p className="font-medium">{g.contrato.nome}</p>
                        <p className="text-xs text-muted-foreground font-normal">
                          <span className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${g.fonte === "faturado" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : g.fonte === "previsto" ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-muted"}`}>
                            {g.fonte === "faturado" ? "Faturado (NFs)" : g.fonte === "previsto" ? "Previsto (planilha)" : "Sem nota"}
                          </span>
                          {g.contrato.cliente}
                          {filtroEmpresaId === EMPRESA_FILTRO_TODAS && ` · ${empresaNomePorId.get(g.contrato.empresa_id) ?? "—"}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="block text-sm font-semibold whitespace-nowrap">{fmtMoney(g.valorTotal)}</span>
                        <span className="block text-[11px] font-normal text-muted-foreground whitespace-nowrap">executável {fmtMoney(g.executavel ?? g.valorTotal)}</span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rubrica</TableHead>
                          <TableHead>Grupo</TableHead>
                          <TableHead className="text-right"><TituloComFormula titulo="Valor Executado" formula={<><span className="block">Rubrica da planilha × (executado ÷ executável do contrato no mês), ou a própria rubrica enquanto o contrato está Previsto. É o orçado que alimenta Orçamento Geral, ADM e Sócios, Pedidos de Compra e a alçada.</span><AssinaturaRegra chamado="SIS-2026-0828" /></>} /></TableHead>
                          <TableHead className="text-right"><TituloComFormula titulo="Executável (planilha)" formula={<span>Valor da rubrica na Planilha de Custo vigente no fim do mês, antes de proporcionar ao faturado.</span>} /></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.rubricas.map((r) => (
                          <TableRow key={r.campo}>
                            <TableCell className="font-medium">
                              {r.label}
                              {r.somaNoTotal === false && (
                                <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground" title="Conta no orçamento da classificação ligada, mas não entra no total do contrato (igual à Planilha de Custo).">
                                  fora do total
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{r.grupo}</TableCell>
                            <TableCell className="text-right">{fmtMoney(r.valor)}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{fmtMoney(r.valorExecutavel ?? r.valor)}</TableCell>
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
  );
}
