import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { useClassificacoesAdministrativo } from "@/hooks/useMaloteClassificacaoAdministrativo";
import { useLigacoesAdministrativoClassificacao } from "@/hooks/useMaloteAdministrativoClassificacaoLink";
import { useLigacoesClassificacaoMalote } from "@/hooks/useMaloteClassificacaoMaloteLink";
import { classificacaoCanonica, mapaClassificacaoVinculada } from "@/hooks/useMaloteClassificacaoMaloteLink";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { useOrcamentoContratos, type OrcamentoContratoGrupo } from "@/hooks/useOrcamentoContratos";
import { useUtilizadoOrcamento, type UtilizadoOrcamentoLinha } from "@/hooks/useUtilizadoOrcamento";
import { useLinhasOrcamentoAdmSocios, useSalvarOrcamentoAdmSocios } from "@/hooks/useOrcamentoAdmSocios";
import { anoMesAtual } from "@/hooks/usePlanilhaCusto";
import { fmtDate, fmtMoney } from "./orcamentoUtils";
import {
  orcadoPorEmpresa, percentualUtilizado, saldoDaOrigemPorEmpresa, utilizadoPorEmpresa, validarDistribuicao,
  type LinhaOrcamento, type ModoOrcamento, type TipoOrcamento,
} from "./orcamento-adm-socios/regras";

// SIS-2026-0702: novo Orçamento Administrativo / Orçamento Sócios, em paralelo ao Orçamento Administrativo atual (que continua valendo em
// produção). Duas abas com a mesma lógica e dados independentes. Origem = classificações do Orçamento Geral - Contratos; valor orçado =
// saldo remanescente da origem no mês × percentual (ou valor manual); utilizado = Malote nos contratos ADMINISTRATIVO da aba.

const TEXTO_ABA: Record<TipoOrcamento, { titulo: string; centro: string; exemplo: string }> = {
  administrativo: { titulo: "Orçamento Administrativo", centro: "ADMINISTRATIVO + EMPRESA", exemplo: "ADMINISTRATIVO NH" },
  socios: { titulo: "Orçamento Sócios", centro: "ADMINISTRATIVO SÓCIOS - + SÓCIO", exemplo: "ADMINISTRATIVO SÓCIOS - GUIOMAR" },
};

const novaLinha = (classificacaoAdministrativaId: string): LinhaOrcamento => ({
  classificacaoAdministrativaId, descricao: "", modo: "percentual", percentual: 0, origemIds: [], valorManual: 0, distribuicao: {},
});

interface DadosComuns {
  anoMes: string;
  empresas: { id: string; nome: string }[];
  grupos: OrcamentoContratoGrupo[];
  utilizado: UtilizadoOrcamentoLinha[];
  opcoesOrigem: { value: string; label: string }[];
  maloteIdPorAdministrativa: Map<string, string>;
}

function AbaOrcamento({ tipo, dados, visivel }: { tipo: TipoOrcamento; dados: DadosComuns; visivel: boolean }) {
  const texto = TEXTO_ABA[tipo];
  const { data: salvas, isLoading } = useLinhasOrcamentoAdmSocios(tipo);
  const { data: catalogo = [] } = useClassificacoesAdministrativo();
  const salvar = useSalvarOrcamentoAdmSocios(tipo);
  const [linhas, setLinhas] = useState<LinhaOrcamento[]>([]);
  const [sujo, setSujo] = useState(false);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");

  // Todas as Classificações Administrativo ativas entram no orçamento (Iury): o que já foi salvo mantém a configuração, as demais entram
  // zeradas (sem origem, descrição nem %) para serem preenchidas. Classificação nova no catálogo aparece aqui sozinha.
  useEffect(() => {
    if (!salvas || sujo || catalogo.length === 0) return;
    const porId = new Map(salvas.map((l) => [l.classificacaoAdministrativaId, l]));
    setLinhas(catalogo.map((c) => porId.get(c.id) ?? novaLinha(c.id)));
  }, [salvas, catalogo, sujo]);

  const nomes = useMemo(() => new Map(catalogo.map((c) => [c.id, c.nome])), [catalogo]);
  const empresaIds = useMemo(() => dados.empresas.map((e) => e.id), [dados.empresas]);

  const calculo = useMemo(() => linhas.map((l) => {
    const saldo = saldoDaOrigemPorEmpresa(dados.grupos, dados.utilizado, l.origemIds, dados.anoMes);
    const orcado = orcadoPorEmpresa(l, saldo, empresaIds);
    const gasto = utilizadoPorEmpresa(dados.utilizado, dados.maloteIdPorAdministrativa.get(l.classificacaoAdministrativaId), tipo, dados.anoMes);
    const totalOrcado = [...orcado.values()].reduce((s, v) => s + v, 0);
    const totalUtilizado = [...gasto.values()].reduce((s, v) => s + v.valor, 0);
    return { linha: l, saldo, orcado, gasto, totalOrcado, totalUtilizado };
  }), [linhas, dados, empresaIds, tipo]);

  const filtradas = calculo.filter((c) => !busca.trim() || `${nomes.get(c.linha.classificacaoAdministrativaId) ?? ""} ${c.linha.descricao}`.toLowerCase().includes(busca.toLowerCase()));
  const totalOrcado = calculo.reduce((s, c) => s + c.totalOrcado, 0);
  const totalUtilizado = calculo.reduce((s, c) => s + c.totalUtilizado, 0);
  const totalPercentual = linhas.filter((l) => l.modo === "percentual").reduce((s, l) => s + l.percentual, 0);
  const problemas = useMemo(() => validarDistribuicao(linhas, nomes), [linhas, nomes]);

  function alterar(id: string, mudanca: Partial<LinhaOrcamento>) {
    setSujo(true);
    setLinhas((atual) => atual.map((l) => (l.classificacaoAdministrativaId === id ? { ...l, ...mudanca } : l)));
  }
  function alternar(id: string) {
    setAbertas((a) => { const n = new Set(a); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function ajustarPara100(l: LinhaOrcamento) {
    const soma = empresaIds.reduce((s, id) => s + (l.distribuicao[id] ?? 0), 0);
    const base = soma > 0 ? empresaIds.map((id) => Math.round(((l.distribuicao[id] ?? 0) / soma) * 10000) / 100) : empresaIds.map(() => Math.round(10000 / empresaIds.length) / 100);
    const resto = Math.round((100 - base.slice(0, -1).reduce((s, v) => s + v, 0)) * 100) / 100;
    base[base.length - 1] = resto;
    alterar(l.classificacaoAdministrativaId, { distribuicao: Object.fromEntries(empresaIds.map((id, i) => [id, base[i]])) });
  }
  async function salvarTudo() {
    if (problemas.length > 0) { toast.error(problemas[0].mensagem); return; }
    try {
      await salvar.mutateAsync(linhas);
      setSujo(false);
      toast.success(`${texto.titulo} salvo.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar.");
    }
  }

  return (
    <div className={visivel ? "space-y-4" : "hidden"}>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card><CardHeader className="pb-2"><CardDescription>Total do orçamento no mês</CardDescription><CardTitle className="text-2xl">{fmtMoney(totalOrcado)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Classificações definidas</CardDescription><CardTitle className="text-3xl">{linhas.length}</CardTitle></CardHeader></Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Percentual distribuído</CardDescription>
            <CardTitle className={`text-2xl ${Math.abs(totalPercentual - 100) < 0.001 || totalPercentual === 0 ? "" : "text-destructive"}`}>{totalPercentual.toFixed(2).replace(".", ",")}%</CardTitle>
          </CardHeader>
        </Card>
        <Card><CardHeader className="pb-2"><CardDescription>Valor utilizado no mês</CardDescription><CardTitle className="text-2xl">{fmtMoney(totalUtilizado)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Saldo disponível</CardDescription><CardTitle className="text-2xl">{fmtMoney(totalOrcado - totalUtilizado)}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">Lista de Classificações do Orçamento</CardTitle>
          <div className="flex items-center gap-2">
            <Input className="w-56" placeholder="Classificação ou descrição..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            <Button onClick={salvarTudo} disabled={!sujo || salvar.isPending}>{salvar.isPending ? "Salvando..." : "Salvar distribuição"}</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Usar quando o centro de custo for <b>{texto.centro}</b> (ex.: {texto.exemplo}). As classificações de origem vêm do Orçamento Geral - Contratos;
            o valor orçado é o percentual sobre o <b>saldo remanescente</b> da origem no mês e muda sozinho conforme o contrato é usado.
          </p>
          {problemas.length > 0 && (
            <ul className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 space-y-0.5">
              {problemas.map((p, i) => <li key={i}>{p.mensagem}</li>)}
            </ul>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Classificação</TableHead>
                  <TableHead className="min-w-[220px]">Origem do orçamento</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>% do orçamento</TableHead>
                  <TableHead className="text-right">Valor orçado</TableHead>
                  <TableHead className="text-right">Valor utilizado</TableHead>
                  <TableHead className="text-right">% utilizado</TableHead>
                  <TableHead className="text-right">Saldo disponível</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>}
                {!isLoading && filtradas.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Nenhuma classificação encontrada.</TableCell></TableRow>}
                {filtradas.map(({ linha: l, saldo, orcado, gasto, totalOrcado: to, totalUtilizado: tu }) => {
                  const id = l.classificacaoAdministrativaId;
                  const aberta = abertas.has(id);
                  const semLigacao = !dados.maloteIdPorAdministrativa.get(id);
                  const somaDistribuicao = empresaIds.reduce((s, e) => s + (l.distribuicao[e] ?? 0), 0);
                  return (
                    <Fragment key={id}>
                      <TableRow>
                        <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => alternar(id)}>{aberta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</Button></TableCell>
                        <TableCell className="font-medium">
                          {nomes.get(id) ?? "—"}
                          {semLigacao && <span className="block text-[10px] font-normal text-amber-700" title="Sem ligação com uma Classificação do Malote (Configurações → Ligações): o utilizado não consegue ser apurado.">sem ligação — utilizado não apurado</span>}
                        </TableCell>
                        <TableCell className="space-y-1">
                          <Select value={l.modo} onValueChange={(v) => alterar(id, { modo: v as ModoOrcamento })}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="percentual">Classificações de origem</SelectItem>
                              <SelectItem value="manual">Definir manualmente</SelectItem>
                            </SelectContent>
                          </Select>
                          {l.modo === "percentual" && (
                            <SearchableMultiSelect value={l.origemIds} onChange={(v) => alterar(id, { origemIds: v })} options={dados.opcoesOrigem} placeholder="Selecionar origem(ns)..." searchPlaceholder="Buscar classificação..." maxBadges={2} />
                          )}
                        </TableCell>
                        <TableCell>
                          <Input className="h-8 min-w-[160px]" value={l.descricao} onChange={(e) => alterar(id, { descricao: e.target.value })} placeholder="Descrição" />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {l.modo === "manual" ? <span className="text-xs text-muted-foreground">Não se aplica</span> : (
                            <span className="inline-flex items-center gap-1">
                              <Input className="h-8 w-20" type="number" min={0} max={100} step="0.01" value={l.percentual} onChange={(e) => alterar(id, { percentual: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })} /> %
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {l.modo === "manual" ? (
                            <span className="inline-flex items-center gap-1">R$ <Input className="h-8 w-32" type="number" min={0} step="0.01" value={l.valorManual} onChange={(e) => alterar(id, { valorManual: Math.max(0, parseFloat(e.target.value) || 0) })} /></span>
                          ) : fmtMoney(to)}
                        </TableCell>
                        <TableCell className="text-right">{fmtMoney(tu)}</TableCell>
                        <TableCell className="text-right">{percentualUtilizado(tu, to).toFixed(2).replace(".", ",")}%</TableCell>
                        <TableCell className="text-right">{fmtMoney(to - tu)}</TableCell>
                        <TableCell />
                      </TableRow>
                      {aberta && (
                        <TableRow className="bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={9}>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Empresa</TableHead>
                                  <TableHead>{l.modo === "manual" ? "Distribuição do total (%)" : "Saldo da origem no mês"}</TableHead>
                                  <TableHead className="text-right">Valor orçado para esta classificação</TableHead>
                                  <TableHead className="text-right">Valor utilizado</TableHead>
                                  <TableHead className="text-right">% utilizado</TableHead>
                                  <TableHead>Última movimentação</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {dados.empresas.map((e) => {
                                  const o = orcado.get(e.id) ?? 0;
                                  const g = gasto.get(e.id);
                                  return (
                                    <TableRow key={e.id}>
                                      <TableCell>{e.nome}</TableCell>
                                      <TableCell>
                                        {l.modo === "manual" ? (
                                          <span className="inline-flex items-center gap-1"><Input className="h-8 w-20" type="number" min={0} max={100} step="0.01" value={l.distribuicao[e.id] ?? 0} onChange={(ev) => alterar(id, { distribuicao: { ...l.distribuicao, [e.id]: Math.max(0, Math.min(100, parseFloat(ev.target.value) || 0)) } })} /> %</span>
                                        ) : fmtMoney(saldo.get(e.id) ?? 0)}
                                      </TableCell>
                                      <TableCell className="text-right">{fmtMoney(o)}</TableCell>
                                      <TableCell className="text-right">{fmtMoney(g?.valor ?? 0)}</TableCell>
                                      <TableCell className="text-right">{percentualUtilizado(g?.valor ?? 0, o).toFixed(2).replace(".", ",")}%</TableCell>
                                      <TableCell>{g?.ultima ? fmtDate(g.ultima.slice(0, 10)) : "—"}</TableCell>
                                    </TableRow>
                                  );
                                })}
                                <TableRow className="font-semibold">
                                  <TableCell>Total da classificação</TableCell>
                                  <TableCell>{l.modo === "manual" ? `${somaDistribuicao.toFixed(2).replace(".", ",")}%` : "—"}</TableCell>
                                  <TableCell className="text-right">{fmtMoney(to)}</TableCell>
                                  <TableCell className="text-right">{fmtMoney(tu)}</TableCell>
                                  <TableCell className="text-right">{percentualUtilizado(tu, to).toFixed(2).replace(".", ",")}%</TableCell>
                                  <TableCell />
                                </TableRow>
                              </TableBody>
                            </Table>
                            {l.modo === "manual" && (
                              <div className="flex items-center justify-end gap-3 pt-2 text-xs">
                                <span className={Math.abs(somaDistribuicao - 100) < 0.001 ? "text-emerald-700" : "text-destructive"}>
                                  Distribuído: {somaDistribuicao.toFixed(2).replace(".", ",")}% {Math.abs(somaDistribuicao - 100) < 0.001 ? "· confere com o valor orçado" : "· ajuste para totalizar 100%"}
                                </span>
                                <Button size="sm" variant="outline" onClick={() => ajustarPara100(l)}>Ajustar para 100%</Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                {filtradas.length > 0 && (
                  <TableRow className="font-semibold bg-muted/40">
                    <TableCell /><TableCell>Total</TableCell><TableCell /><TableCell />
                    <TableCell>{totalPercentual.toFixed(2).replace(".", ",")}%</TableCell>
                    <TableCell className="text-right">{fmtMoney(totalOrcado)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(totalUtilizado)}</TableCell>
                    <TableCell className="text-right">{percentualUtilizado(totalUtilizado, totalOrcado).toFixed(2).replace(".", ",")}%</TableCell>
                    <TableCell className="text-right">{fmtMoney(totalOrcado - totalUtilizado)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function OrcamentoAdmSocios() {
  const [aba, setAba] = useState<TipoOrcamento>("administrativo");
  const [anoMes, setAnoMes] = useState(anoMesAtual());
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: grupos = [] } = useOrcamentoContratos(anoMes);
  const { data: utilizado = [] } = useUtilizadoOrcamento();
  const { data: ligacoesAdm = [] } = useLigacoesAdministrativoClassificacao();
  const { data: ligacoesMalote = [] } = useLigacoesClassificacaoMalote();
  const { data: classificacoesMalote = [] } = useClassificacoesOrcamentoAdmin();

  const dados: DadosComuns = useMemo(() => {
    const nomePorId = new Map(classificacoesMalote.map((c) => [c.id, c.nome]));
    const vinculo = mapaClassificacaoVinculada(ligacoesMalote);
    // origem = classificações do Malote que têm orçado em algum contrato (as do Orçamento Geral - Contratos)
    const ids = new Set<string>();
    for (const g of grupos) for (const r of g.rubricas) if (r.classificacaoMaloteId && r.valor > 0) ids.add(r.classificacaoMaloteId);
    const opcoesOrigem = [...ids].map((id) => ({ value: id, label: nomePorId.get(id) ?? id })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    const maloteIdPorAdministrativa = new Map<string, string>();
    for (const l of ligacoesAdm) maloteIdPorAdministrativa.set(l.classificacao_administrativa_id, classificacaoCanonica(vinculo, l.classificacao_malote_id) ?? l.classificacao_malote_id);
    return { anoMes, empresas, grupos, utilizado, opcoesOrigem, maloteIdPorAdministrativa };
  }, [anoMes, empresas, grupos, utilizado, ligacoesAdm, ligacoesMalote, classificacoesMalote]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Orçamento ADM e Sócios (novo)"
        subtitle="Nova versão em desenvolvimento, em paralelo ao Orçamento Administrativo atual — que continua valendo em produção."
        module="Malote"
        breadcrumb={["Malote", "Classificações e Orçamentos", "Orçamento ADM e Sócios (novo)"]}
      />

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <p className="text-muted-foreground">
          As abas Orçamento Administrativo e Orçamento Sócios usam as mesmas classificações, mas os dados de cada uma são independentes. Origem, saldo e
          utilizado são calculados para o Ano/Mês escolhido; só a configuração (origem, percentual, valor manual) é gravada.
        </p>
      </div>

      <div className="flex items-end justify-between flex-wrap gap-3">
        <Tabs value={aba} onValueChange={(v) => setAba(v as TipoOrcamento)}>
          <TabsList>
            <TabsTrigger value="administrativo">Orçamento Administrativo</TabsTrigger>
            <TabsTrigger value="socios">Orçamento Sócios</TabsTrigger>
          </TabsList>
        </Tabs>
        <div>
          <Label className="text-xs">Ano/Mês</Label>
          <Input type="month" className="w-44" value={anoMes} onChange={(e) => setAnoMes(e.target.value || anoMesAtual())} />
        </div>
      </div>

      <AbaOrcamento tipo="administrativo" dados={dados} visivel={aba === "administrativo"} />
      <AbaOrcamento tipo="socios" dados={dados} visivel={aba === "socios"} />
    </div>
  );
}
