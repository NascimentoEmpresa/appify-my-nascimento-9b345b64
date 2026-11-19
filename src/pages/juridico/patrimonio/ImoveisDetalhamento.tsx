import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Building2, Coins, Hammer, Layers, TrendingUp, Wrench, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { TituloComFormula } from "@/pages/controladoria/faturamento/Rentabilidade";
import { AssinaturaRegra } from "@/pages/malote/AssinaturaRegra";
import { useLancamentosImoveis } from "@/hooks/useImoveisDetalhamento";
import {
  lancamentosPorImovel, resumoDoImovel, ROTULO_STATUS_IMOVEL, ROTULO_TIPO_GASTO, tipoDoGasto, totaisDosImoveis, type ResumoImovel, type StatusImovel,
} from "./imoveisRegras";

// SIS-2026-0911 — Jurídico › Patrimônios › Imóveis Detalhamento.
// Lê o cadastro de Patrimônios (aquisição = valor do contrato, valor estimado de venda, integrante…) e os gastos do Fluxo de Caixa vinculados a cada imóvel.
// Nenhum valor é digitado aqui: o que muda no lançamento de origem muda nesta tela.
export interface ImovelDetalhe {
  id: number; codigo?: string; tipo: string; descricao: string; classificacao?: string; situacao_pagamento?: string; cidade?: string; localizacao?: string;
  proprietario?: string; integrante_empregado_id?: number | null; empresa_pagadora?: string; matricula?: string; especie_escritura?: string;
  observacoes?: string; proxima_parcela?: string; valor_contrato?: number; valor_estimado?: number;
}

const brl = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const data = (s: string | null | undefined) => (s ? new Date(s.length <= 10 ? s + "T12:00:00" : s).toLocaleDateString("pt-BR") : "—");
const CLASSE_STATUS: Record<StatusImovel, string> = {
  saudavel: "border-emerald-300 bg-emerald-50 text-emerald-800",
  atencao: "border-red-300 bg-red-50 text-red-800",
  sem_estimativa: "border-slate-300 bg-slate-50 text-slate-600",
};

// Textos dos infobox (i): como cada número é formado e DE ONDE VEM. Os mesmos servem para o cartão do topo e para o cabeçalho da coluna.
const Origem = ({ children }: { children: ReactNode }) => <p className="border-t border-border/60 pt-1 text-muted-foreground"><strong>De onde vem:</strong> {children}</p>;
const CADASTRO = (campo: string) => <Origem>Jurídico › Patrimônios, cadastro do imóvel, campo <strong>{campo}</strong> (tabela JUR_PATRIMONIOS).</Origem>;
const FLUXO = <Origem>Fluxo de Caixa (Malote, Débito Automático, lançamentos unificados e importados), só as <strong>saídas já pagas</strong> vinculadas ao imóvel em “Alteração em massa › Vincular a imóvel”. O valor e a data são lidos do lançamento original: corrigiu lá, reflete aqui.</Origem>;
const INFO = {
  situacao: <><p>Situação do imóvel no cadastro (PAGO, PAGANDO, ALUGADO, VENDIDO…).</p>{CADASTRO("Situação")}</>,
  classificacao: <><p>Tipo do bem (casa, apartamento, terreno, cotas…).</p>{CADASTRO("Classificação")}</>,
  descricao: <><p>Nome do patrimônio.</p>{CADASTRO("Descrição")}</>,
  cidade: <><p>Cidade do imóvel.</p>{CADASTRO("Cidade")}</>,
  proprietario: <><p>Quem consta como proprietário.</p>{CADASTRO("Proprietário")}</>,
  integrante: <><p>Integrante do imóvel: a base para direcionar os gastos dele.</p>{CADASTRO("Integrante")}</>,
  aquisicao: <><p>Valor de aquisição do imóvel. Não é digitado de novo aqui.</p>{CADASTRO("Valor do contrato")}</>,
  investimentos: <><p>Saídas vinculadas ao imóvel em contratos de tratamento <strong>Investimento</strong> ou <strong>Obra administrativa</strong> (ex.: “INVESTIMENTOS …”, “OBRAS ADM …”). Capital que preserva ou aumenta o valor do imóvel.</p>{FLUXO}<Origem>A classificação como investimento/obra segue o “Tratamento dos contratos” da Controladoria, a mesma regra das colunas Investimentos e Obras Adm do Fechamento da Empresa.</Origem></>,
  manutencao: <><p>Qualquer outra saída vinculada ao imóvel (água, luz, condomínio, manutenção recorrente…). Fica à parte para análise gerencial: <strong>não é tratada como aumento do valor</strong> do patrimônio.</p>{FLUXO}</>,
  total: <><p>Aquisição + Investimentos/Obras + Despesas de manutenção: quanto já saiu do caixa por este imóvel.</p><Origem>Soma das três colunas anteriores (calculado nesta tela).</Origem></>,
  estimado: <><p>Valor médio estimado para venda. Atualize no cadastro.</p>{CADASTRO("Valor estimado")}</>,
  resultado: <><p>Valor estimado de venda − Valor total aplicado. Fica em branco enquanto o imóvel não tem valor estimado. Negativo = o custo já passou do valor estimado.</p><Origem>Calculado nesta tela a partir do Valor estimado (cadastro) e do Valor total aplicado.</Origem></>,
  status: <><p><strong>Saudável</strong>: resultado potencial ≥ 0. <strong>Custo acima do estimado</strong>: total aplicado maior que o valor estimado. <strong>Sem valor estimado</strong>: falta preencher o valor estimado no cadastro.</p><Origem>Calculado nesta tela a partir do resultado potencial.</Origem></>,
};

const Th = ({ children, info, alinhar = "right" }: { children: ReactNode; info?: ReactNode; alinhar?: "left" | "right" | "center" }) => (
  <TableHead className={alinhar === "right" ? "text-right" : ""}>{info ? <TituloComFormula titulo={children} formula={info} alinhar={alinhar} /> : children}</TableHead>
);

export function ImoveisDetalhamento({ imoveis, nomeIntegrante }: { imoveis: ImovelDetalhe[]; nomeIntegrante: (id: number | null | undefined) => string }) {
  const [ini, setIni] = useState("");
  const [fim, setFim] = useState("");
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const { data: lancamentos = [], isLoading, error } = useLancamentosImoveis(ini, fim);

  const porImovel = useMemo(() => lancamentosPorImovel(lancamentos), [lancamentos]);
  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return imoveis
      .filter((p) => !q || [p.descricao, p.localizacao, p.matricula, p.proprietario, p.cidade, p.codigo].some((x) => (x ?? "").toLowerCase().includes(q)))
      .map((p) => ({ p, resumo: resumoDoImovel(p, porImovel.get(p.id) ?? []) }));
  }, [imoveis, busca, porImovel]);
  const totais = useMemo(() => totaisDosImoveis(linhas.map((l) => l.resumo)), [linhas]);

  const atual = linhas.find((l) => l.p.id === selecionado) ?? null;
  const lancsAtual = atual ? porImovel.get(atual.p.id) ?? [] : [];
  const semVinculo = linhas.filter((l) => l.resumo.qtdLancamentos === 0).length;
  const periodo = ini || fim ? ` de ${ini ? data(ini) : "…"} a ${fim ? data(fim) : "…"}` : "";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <Label className="text-xs">Buscar patrimônio</Label>
            <Input className="h-9" placeholder="Endereço, descrição, matrícula ou proprietário…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Período das despesas — de</Label>
            <Input type="date" className="h-9" value={ini} onChange={(e) => setIni(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">até</Label>
            <Input type="date" className="h-9" value={fim} onChange={(e) => setFim(e.target.value)} />
          </div>
          <Button variant="outline" className="h-9" onClick={() => { setIni(""); setFim(""); setBusca(""); }}>Limpar</Button>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          O período filtra só os gastos do Fluxo de Caixa (pela data de pagamento). O valor de aquisição e o valor estimado de venda vêm do cadastro do patrimônio.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Investimento inicial" valor={brl(totais.aquisicao)} sub="Valor de aquisição dos imóveis" icon={<Building2 />} cor="sky" info={INFO.aquisicao} />
        <KpiTile label="Investimentos / Obras" valor={brl(totais.investimentosObras)} sub="Obras, reformas e melhorias" icon={<Hammer />} cor="slate" info={INFO.investimentos} />
        <KpiTile label="Despesas de manutenção" valor={brl(totais.manutencao)} sub="Manutenção e despesas de uso" icon={<Wrench />} cor="amber" info={INFO.manutencao} />
        <KpiTile label="Valor total aplicado" valor={brl(totais.totalAplicado)} sub="Aquisição + investimentos + despesas" icon={<Layers />} cor="sky" info={INFO.total} />
        <KpiTile label="Valor estimado de venda" valor={brl(totais.valorEstimado)} sub="Valor de mercado estimado" icon={<Coins />} cor="slate" info={INFO.estimado} />
        <KpiTile label="Resultado potencial" valor={brl(totais.resultadoPotencial)} sub="Estimado − total aplicado" icon={<TrendingUp />} cor={totais.resultadoPotencial >= 0 ? "emerald" : "red"} info={INFO.resultado} />
      </div>

      {error && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">Não foi possível carregar os gastos vinculados: {(error as { message?: string }).message ?? "erro desconhecido"}</p>}
      {!isLoading && lancamentos.length === 0 && !error && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          Nenhum gasto do Fluxo de Caixa está vinculado a imóvel{ini || fim ? " neste período" : ""}. No Fluxo de Caixa, ligue o modo “Alteração em massa”, marque os lançamentos e escolha “Vincular a imóvel (Patrimônio)”.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <Th alinhar="left">#</Th><Th alinhar="left" info={INFO.situacao}>Situação</Th><Th alinhar="left" info={INFO.classificacao}>Classificação</Th><Th alinhar="left" info={INFO.descricao}>Descrição</Th><Th alinhar="left" info={INFO.cidade}>Cidade</Th>
                <Th alinhar="left" info={INFO.proprietario}>Proprietário</Th><Th alinhar="left" info={INFO.integrante}>Integrante</Th>
                <Th info={INFO.aquisicao}>Valor inicial (aquisição)</Th><Th info={INFO.investimentos}>Investimentos / Obras</Th>
                <Th info={INFO.manutencao}>Despesas acumuladas</Th><Th info={INFO.total}>Valor total aplicado</Th>
                <Th info={INFO.estimado}>Valor estimado de venda</Th><Th info={INFO.resultado}>Resultado potencial</Th><Th alinhar="left" info={INFO.status}>Status</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={14} className="py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
              {!isLoading && linhas.length === 0 && <TableRow><TableCell colSpan={14} className="py-8 text-center text-muted-foreground">Nenhum imóvel encontrado.</TableCell></TableRow>}
              {linhas.map(({ p, resumo }, i) => (
                <TableRow key={p.id} className="cursor-pointer" title="Clique para ver o detalhamento" onClick={() => setSelecionado(p.id)}>
                  <TableCell className="text-xs">{i + 1}</TableCell>
                  <TableCell className="text-xs">{p.situacao_pagamento ? <Badge variant="outline">{p.situacao_pagamento}</Badge> : "—"}</TableCell>
                  <TableCell className="text-xs font-semibold">{p.classificacao || p.tipo}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-xs" title={p.descricao}>{p.descricao}</TableCell>
                  <TableCell className="text-xs">{p.cidade || "—"}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs" title={p.proprietario}>{p.proprietario || "—"}</TableCell>
                  <TableCell className="text-xs">{nomeIntegrante(p.integrante_empregado_id)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs">{brl(resumo.aquisicao)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs">{brl(resumo.investimentosObras)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs">{brl(resumo.manutencao)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs font-semibold">{brl(resumo.totalAplicado)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs">{brl(resumo.valorEstimado)}</TableCell>
                  <TableCell className={`whitespace-nowrap text-right text-xs font-semibold ${resumo.resultadoPotencial != null && resumo.resultadoPotencial < 0 ? "text-red-600" : "text-emerald-600"}`}>{brl(resumo.resultadoPotencial)}</TableCell>
                  <TableCell><Badge variant="outline" className={`whitespace-nowrap ${CLASSE_STATUS[resumo.status]}`}>{ROTULO_STATUS_IMOVEL[resumo.status]}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {linhas.length} imóvel(is){semVinculo > 0 ? ` · ${semVinculo} sem nenhum gasto vinculado` : ""}. Clique numa linha para abrir o detalhamento do imóvel.
          <AssinaturaRegra chamado="SIS-2026-0911" />
        </p>
      </div>

      <Dialog open={!!atual} onOpenChange={(o) => { if (!o) setSelecionado(null); }}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          {atual && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {atual.p.descricao}
                  {atual.p.situacao_pagamento && <Badge variant="outline">{atual.p.situacao_pagamento}</Badge>}
                  <Badge variant="outline" className={CLASSE_STATUS[atual.resumo.status]}>{ROTULO_STATUS_IMOVEL[atual.resumo.status]}</Badge>
                </DialogTitle>
                <DialogDescription>
                  {atual.p.classificacao || atual.p.tipo}{atual.p.cidade ? ` · ${atual.p.cidade}` : ""}. Gastos do Fluxo de Caixa{periodo || " de todo o período"}.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Dados do patrimônio</p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <Campo rotulo="Endereço" valor={atual.p.localizacao} larga />
                    <Campo rotulo="Proprietário" valor={atual.p.proprietario} />
                    <Campo rotulo="Integrante" valor={nomeIntegrante(atual.p.integrante_empregado_id)} />
                    <Campo rotulo="Empresa que pagará" valor={atual.p.empresa_pagadora} />
                    <Campo rotulo="Matrícula" valor={atual.p.matricula} />
                    <Campo rotulo="Estrutura / documento" valor={atual.p.especie_escritura} />
                    <Campo rotulo="Próxima parcela" valor={atual.p.proxima_parcela ? data(atual.p.proxima_parcela) : undefined} />
                    <Campo rotulo="Observação" valor={atual.p.observacoes} larga />
                  </dl>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold">Composição do valor aplicado</p>
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                    <Linha rotulo="Aquisição" info={INFO.aquisicao} valor={atual.resumo.aquisicao} total={atual.resumo.totalAplicado} />
                    <Linha rotulo="Investimentos / Obras" info={INFO.investimentos} valor={atual.resumo.investimentosObras} total={atual.resumo.totalAplicado} />
                    <Linha rotulo="Despesas de manutenção" info={INFO.manutencao} valor={atual.resumo.manutencao} total={atual.resumo.totalAplicado} />
                    <p className="mt-1 flex justify-between border-t border-border pt-1 font-semibold"><span>Total aplicado</span><span>{brl(atual.resumo.totalAplicado)}</span></p>
                    <p className="flex justify-between pt-1"><span>Valor estimado de venda</span><span>{brl(atual.resumo.valorEstimado)}</span></p>
                    <p className={`flex justify-between font-semibold ${atual.resumo.resultadoPotencial != null && atual.resumo.resultadoPotencial < 0 ? "text-red-600" : "text-emerald-600"}`}><span>Resultado potencial</span><span>{brl(atual.resumo.resultadoPotencial)}</span></p>
                  </div>
                  <Leitura resumo={atual.resumo} />
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">Lançamentos de origem ({lancsAtual.length})</p>
                {lancsAtual.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum gasto do Fluxo de Caixa vinculado a este imóvel{periodo}. Vincule pelo Fluxo de Caixa (Alteração em massa › Vincular a imóvel).</p>
                ) : (
                  <div className="max-h-[320px] overflow-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Pagamento</TableHead><TableHead>Nº</TableHead><TableHead>Descrição</TableHead><TableHead>Contrato</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Valor</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {lancsAtual.map((l) => {
                          const tipo = tipoDoGasto(l);
                          return (
                            <TableRow key={`${l.origem}-${l.despesa_id}-${l.numero_parcela ?? 0}-${l.contrato_id ?? ""}-${l.valor}`}>
                              <TableCell className="whitespace-nowrap text-xs">{data(l.data_pagamento)}</TableCell>
                              <TableCell className="whitespace-nowrap font-mono text-[11px]">
                                {l.id_malote ? <Link className="text-primary hover:underline" to={`/app/financeiro/gestao-financeira/fluxo-caixa?busca=${encodeURIComponent(l.id_malote)}`}>{l.id_malote}</Link> : "—"}
                              </TableCell>
                              <TableCell className="max-w-[220px] truncate text-xs" title={l.descricao ?? ""}>{l.descricao ?? "—"}</TableCell>
                              <TableCell className="max-w-[180px] truncate text-xs" title={l.contrato_nome ?? ""}>{l.contrato_nome ?? "—"}</TableCell>
                              <TableCell className="text-xs"><Badge variant="outline" className={tipo === "investimento_obra" ? "border-sky-300 bg-sky-50 text-sky-800" : "border-amber-300 bg-amber-50 text-amber-800"}>{ROTULO_TIPO_GASTO[tipo]}</Badge></TableCell>
                              <TableCell className="whitespace-nowrap text-right text-xs">{brl(l.valor)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Leitura em palavras do que os números dizem (o “modal descritivo”): quanto é capital, quanto é manutenção e como está contra o valor estimado. */
function Leitura({ resumo }: { resumo: ResumoImovel }) {
  const aplicadoNoBem = resumo.aquisicao + resumo.investimentosObras;
  const pctManut = resumo.totalAplicado > 0 ? (resumo.manutencao / resumo.totalAplicado) * 100 : 0;
  const pct = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return (
    <div className="space-y-1 rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-100">
      <p className="font-semibold">Em resumo</p>
      <p>Foram aplicados <strong>{brl(aplicadoNoBem)}</strong> no patrimônio do imóvel (aquisição + investimentos/obras) e <strong>{brl(resumo.manutencao)}</strong> em manutenção ({pct(pctManut)}% do total aplicado), que não aumenta o valor do bem.</p>
      {resumo.valorEstimado == null ? (
        <p>Sem valor estimado de venda no cadastro: preencha o <strong>Valor estimado</strong> em Patrimônios para comparar o que foi investido com o valor atual do bem.</p>
      ) : resumo.resultadoPotencial != null && resumo.resultadoPotencial >= 0 ? (
        <p>O valor estimado de venda ({brl(resumo.valorEstimado)}) está <strong>{brl(resumo.resultadoPotencial)}</strong> acima do total aplicado.</p>
      ) : (
        <p>O total aplicado já passa o valor estimado de venda ({brl(resumo.valorEstimado)}) em <strong>{brl(Math.abs(resumo.resultadoPotencial ?? 0))}</strong>: vale revisar o valor estimado ou os gastos vinculados.</p>
      )}
      {resumo.qtdLancamentos === 0 && <p>Nenhum gasto do Fluxo de Caixa está vinculado a este imóvel: investimentos e manutenção aparecem zerados até o vínculo ser feito.</p>}
    </div>
  );
}

function Campo({ rotulo, valor, larga }: { rotulo: string; valor?: string | null; larga?: boolean }) {
  return (
    <div className={larga ? "col-span-2" : ""}>
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="font-medium">{valor && String(valor).trim() ? valor : "—"}</dd>
    </div>
  );
}

function Linha({ rotulo, valor, total, info }: { rotulo: string; valor: number; total: number; info: ReactNode }) {
  const pct = total > 0 ? (valor / total) * 100 : 0;
  return (
    <p className="flex justify-between py-0.5">
      <TituloComFormula titulo={rotulo} formula={info} alinhar="left" />
      <span>{brl(valor)} <span className="text-muted-foreground">({pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)</span></span>
    </p>
  );
}
