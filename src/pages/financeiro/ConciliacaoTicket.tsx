import { Fragment, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileUp, Scale, Trash2, Upload, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissoes } from "@/context/PermissoesContext";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { rotuloMes } from "@/pages/controladoria/faturamento/useBaseFaturamento";
import { TituloComFormula } from "@/pages/controladoria/faturamento/Rentabilidade";
import { useErpTicket, useExcluirImportacaoTicket, useImportacoesTicket, useImportarExtratoTicket, useLinhasExtratoTicket, type ImportacaoTicket } from "@/hooks/useConciliacaoTicket";
import {
  categoriaDoExtrato, compararPorMes, extratoDaAba, filtrarErp, FILTRO_ERP_VAZIO, lerCsvTicket, resumirComparativo, resumoOutros, ROTULO_SITUACAO,
  type Aba, type FiltroErp, type LinhaErp, type MesComparado, type ResultadoCsv, type SituacaoMes,
} from "./conciliacao-ticket/regras";

// SIS-2026-0825: Conciliação da Ticket. O extrato da plataforma Ticket (CSV) fica gravado no ERP e é conferido, mês a mês, contra o que o ERP
// pagou com "TICKET" na descrição (Malote, planilha importada e Débito Automático). Duas abas: boletos pagos e créditos adicionados.

export const MENU_CONCILIACAO_TICKET = "conciliacao-ticket";

const fmtData = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const fmtDataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const ultimoDia = (anoMes: string) => { const [a, m] = anoMes.split("-").map(Number); return `${anoMes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`; };

const TOM_SITUACAO: Record<SituacaoMes, string> = {
  confere: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  diferenca: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  so_extrato: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  so_erp: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
};

const TEXTO_ABA: Record<Aba, { titulo: string; extrato: string; descricao: string }> = {
  boletos: {
    titulo: "Boletos pagos", extrato: "Extrato: Pagamento de Boleto (debitado)",
    descricao: "Os \"Pagamento de Boleto\" do extrato da Ticket contra o que o ERP pagou com TICKET na descrição, no mesmo mês.",
  },
  creditos: {
    titulo: "Créditos adicionados", extrato: "Extrato: Tickets adicionados",
    descricao: "Os créditos \"Tickets\" adicionados por colaborador no extrato contra o que o ERP pagou com TICKET na descrição, no mesmo mês. Afine pela classificação (ex.: ADD ASSIDUIDADE) para comparar o mesmo tipo de crédito.",
  },
};

// Infoboxes (i): o que é cada indicador e cada coluna, em linguagem do Financeiro.
const INFO_EXTRATO: Record<Aba, React.ReactNode> = {
  boletos: <span>Soma, em módulo, dos lançamentos <strong>"Pagamento de Boleto"</strong> (debitado) do extrato da Ticket importado, em todos os meses que o extrato cobre. É o que a plataforma registra como boleto pago.</span>,
  creditos: <span>Soma dos créditos <strong>"Tickets"</strong> (adicionado) do extrato importado: um crédito por colaborador, em todos os meses que o extrato cobre. O "CREDIT" avulso do extrato não entra aqui.</span>,
};
const INFO_ERP = (
  <>
    <span className="block">Soma do que o ERP <strong>pagou</strong> (saídas) com <strong>TICKET</strong> na descrição, nos meses que o extrato cobre, pela <strong>data de pagamento</strong>.</span>
    <span className="block">Vem do Malote, das linhas importadas da planilha e do Débito Automático. Despesa rateada entre contratos conta uma vez só (as cotas são somadas). Respeita os filtros abaixo.</span>
  </>
);
const INFO_DIFERENCA = (
  <>
    <span className="block"><strong>ERP − extrato</strong>, somando todos os meses.</span>
    <span className="block">Positivo: o ERP pagou mais do que o extrato mostra. Negativo: o extrato tem mais. Menos de 1 centavo = confere.</span>
  </>
);
const INFO_MESES = <span>Meses que têm extrato <strong>e</strong> ERP e fecham ao centavo. "Sem par" é o mês que só existe de um lado (só no extrato ou só no ERP).</span>;

const INFO_COLUNAS = {
  mes: <span>Mês da data: no extrato, a data da linha; no ERP, a data de pagamento do lançamento.</span>,
  extratoQtd: <span>Quantos lançamentos o extrato da Ticket tem no mês, nesta aba. Os créditos por colaborador contam um a um.</span>,
  extratoValor: <span>Soma, em módulo, dos lançamentos do extrato no mês (boletos debitados ou créditos adicionados, conforme a aba).</span>,
  erpQtd: <span>Quantos lançamentos do ERP com TICKET na descrição foram pagos no mês (uma despesa ou parcela, mesmo rateada, conta uma vez), já com os filtros.</span>,
  erpValor: <span>Soma do valor pago desses lançamentos no mês, já com os filtros de empresa, classificação e texto.</span>,
  diferenca: <span><strong>ERP − extrato</strong> no mês. Positivo: o ERP pagou mais. Negativo: o extrato tem mais. Em verde quando confere.</span>,
  situacao: (
    <>
      <span className="block"><strong>Confere:</strong> os dois lados existem e a diferença é menor que 1 centavo.</span>
      <span className="block"><strong>Diferença:</strong> os dois lados existem, mas os valores não fecham.</span>
      <span className="block"><strong>Só no extrato / Só no ERP:</strong> o mês só tem lançamento de um lado.</span>
    </>
  ),
};

export default function ConciliacaoTicket() {
  return (
    <AcessoGate menu={MENU_CONCILIACAO_TICKET} acao="visualizar" fallback={<div className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela.</div>}>
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const { can } = usePermissoes();
  const podeImportar = can("incluir", undefined, MENU_CONCILIACAO_TICKET);
  const podeExcluir = can("alterar", undefined, MENU_CONCILIACAO_TICKET);

  const [aba, setAba] = useState<Aba>("boletos");
  const [filtroErp, setFiltroErp] = useState<FiltroErp>(FILTRO_ERP_VAZIO);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const { data: importacoes = [] } = useImportacoesTicket();
  const { data: linhasExtrato = [], isLoading: carregandoExtrato, error: erroExtrato } = useLinhasExtratoTicket();

  // O ERP é lido do 1º dia do 1º mês ao último dia do último mês que o extrato cobre.
  const periodo = useMemo(() => {
    if (linhasExtrato.length === 0) return { ini: null as string | null, fim: null as string | null };
    const datas = linhasExtrato.map((l) => l.data).sort();
    return { ini: `${datas[0].slice(0, 7)}-01`, fim: ultimoDia(datas[datas.length - 1].slice(0, 7)) };
  }, [linhasExtrato]);
  const { data: erpTodas = [], isLoading: carregandoErp, error: erroErp } = useErpTicket(periodo.ini, periodo.fim);

  const opcoesEmpresa = useMemo(() => [...new Set(erpTodas.map((l) => l.empresa_nome).filter((x): x is string => !!x))].sort().map((v) => ({ value: v, label: v })), [erpTodas]);
  const opcoesClassificacao = useMemo(() => [...new Set(erpTodas.map((l) => l.classificacao_nome).filter((x): x is string => !!x))].sort().map((v) => ({ value: v, label: v })), [erpTodas]);

  const erp = useMemo(() => filtrarErp(erpTodas, filtroErp), [erpTodas, filtroErp]);
  const extrato = useMemo(() => extratoDaAba(linhasExtrato, aba), [linhasExtrato, aba]);
  const meses = useMemo(() => compararPorMes(extrato, erp), [extrato, erp]);
  const resumo = useMemo(() => resumirComparativo(meses), [meses]);
  const outros = useMemo(() => resumoOutros(linhasExtrato), [linhasExtrato]);
  const semFiltroErp = filtroErp.empresas.length === 0 && filtroErp.classificacoes.length === 0 && !filtroErp.texto.trim();

  const alternar = (mes: string) => setAbertos((p) => { const n = new Set(p); if (n.has(mes)) n.delete(mes); else n.add(mes); return n; });

  return (
    <div className="space-y-4">
      <PageHeader
        module="Financeiro"
        breadcrumb={["Conciliação da Ticket"]}
        title="Conciliação da Ticket"
        subtitle="Confira o extrato da plataforma Ticket com o que o ERP pagou, em valores reais, mês a mês."
        actions={podeImportar ? <ImportarExtrato /> : undefined}
      />

      <Importacoes importacoes={importacoes} podeExcluir={podeExcluir} />

      {carregandoExtrato ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Carregando o extrato...</CardContent></Card>
      ) : erroExtrato ? (
        <Card><CardContent className="space-y-1 py-10 text-center text-sm">
          <p className="font-medium text-red-600">Não foi possível ler o extrato da Ticket.</p>
          <p className="text-xs text-muted-foreground">{(erroExtrato as Error).message}</p>
        </CardContent></Card>
      ) : linhasExtrato.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          Nenhum extrato importado ainda. {podeImportar ? "Baixe o extrato em CSV na plataforma Ticket (\"Baixar extrato em CSV\") e use Importar extrato." : "Peça a quem tem acesso para importar o extrato da Ticket."}
        </CardContent></Card>
      ) : (
        <>
          <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
            <TabsList>
              <TabsTrigger value="boletos">{TEXTO_ABA.boletos.titulo}</TabsTrigger>
              <TabsTrigger value="creditos">{TEXTO_ABA.creditos.titulo}</TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="text-xs text-muted-foreground">{TEXTO_ABA[aba].descricao}</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile label={TEXTO_ABA[aba].extrato} valor={fmtMoney(resumo.extratoTotal)} icon={<FileUp />} cor="sky" info={INFO_EXTRATO[aba]} />
            <KpiTile label="Pago no ERP (TICKET)" valor={carregandoErp ? "Calculando..." : fmtMoney(resumo.erpTotal)} sub={semFiltroErp ? "Todas as empresas e classificações" : "Com os filtros abaixo"} icon={<Wallet />} cor="emerald" info={INFO_ERP} />
            <KpiTile
              label="Diferença (ERP − extrato)" info={INFO_DIFERENCA} valor={carregandoErp ? "—" : fmtMoney(resumo.diferenca)} icon={<Scale />} cor={Math.abs(resumo.diferenca) < 0.01 ? "emerald" : "red"}
              sub={Math.abs(resumo.diferenca) < 0.01 ? "Confere" : resumo.diferenca > 0 ? "O ERP pagou mais" : "O extrato tem mais"}
            />
            <KpiTile label="Meses" valor={`${resumo.mesesQueConferem} confere(m)`} sub={`${resumo.mesesComDiferenca} com diferença ou sem par`} icon={<CheckCircle2 />} cor="slate" info={INFO_MESES} />
          </div>

          <Card>
            <CardContent className="grid grid-cols-1 gap-3 p-3 md:grid-cols-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground"><TituloComFormula alinhar="left" titulo="Empresa (ERP)" formula={<span>Empresa do lançamento no ERP. O extrato da Ticket não diz de que empresa é cada linha: use este filtro para comparar só o que pertence à conta importada. Vazio = todas.</span>} /></p>
                <SearchableMultiSelect value={filtroErp.empresas} onChange={(empresas) => setFiltroErp((f) => ({ ...f, empresas }))} options={opcoesEmpresa} placeholder="Todas" searchPlaceholder="Buscar empresa..." maxBadges={3} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground"><TituloComFormula alinhar="left" titulo="Classificação (ERP)" formula={<span>Classificação do lançamento no ERP (VA, ADD ASSIDUIDADE, CESTA BÁSICA...). Escolha as que correspondem ao tipo de crédito do extrato. Vazio = todas.</span>} /></p>
                <SearchableMultiSelect value={filtroErp.classificacoes} onChange={(classificacoes) => setFiltroErp((f) => ({ ...f, classificacoes }))} options={opcoesClassificacao} placeholder="Todas" searchPlaceholder="Buscar classificação..." maxBadges={3} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground"><TituloComFormula alinhar="left" titulo="A descrição do ERP contém" formula={<span>Filtra pelo texto da descrição do lançamento (sem diferenciar maiúsculas nem acentos). Todos os lançamentos já têm TICKET na descrição; use para afinar, ex.: ASSIDUIDADE ou COMPL.</span>} /></p>
                <div className="flex gap-2">
                  <Input value={filtroErp.texto} onChange={(e) => setFiltroErp((f) => ({ ...f, texto: e.target.value }))} placeholder="Ex.: ASSIDUIDADE, COMPL..." className="h-9" />
                  <Button variant="ghost" size="sm" className="h-9" disabled={semFiltroErp} onClick={() => setFiltroErp(FILTRO_ERP_VAZIO)}>Limpar</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {erroErp && <p className="text-xs text-red-600">Não foi possível ler os pagamentos do ERP: {(erroErp as Error).message}</p>}

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs">
                  <tr>
                    <th className="w-8 px-2 py-2" />
                    <th className="px-2 py-2 font-medium"><TituloComFormula alinhar="left" titulo="Mês" formula={INFO_COLUNAS.mes} /></th>
                    <th className="px-2 py-2 text-right font-medium"><TituloComFormula titulo="Extrato (qtd)" formula={INFO_COLUNAS.extratoQtd} /></th>
                    <th className="px-2 py-2 text-right font-medium"><TituloComFormula titulo="Extrato (R$)" formula={INFO_COLUNAS.extratoValor} /></th>
                    <th className="px-2 py-2 text-right font-medium"><TituloComFormula titulo="ERP (qtd)" formula={INFO_COLUNAS.erpQtd} /></th>
                    <th className="px-2 py-2 text-right font-medium"><TituloComFormula titulo="ERP (R$)" formula={INFO_COLUNAS.erpValor} /></th>
                    <th className="px-2 py-2 text-right font-medium"><TituloComFormula titulo="Diferença" formula={INFO_COLUNAS.diferenca} /></th>
                    <th className="px-2 py-2 font-medium"><TituloComFormula alinhar="left" titulo="Situação" formula={INFO_COLUNAS.situacao} /></th>
                  </tr>
                </thead>
                <tbody>
                  {meses.length === 0 && <tr><td colSpan={8} className="px-2 py-8 text-center text-muted-foreground">Nada para comparar neste filtro.</td></tr>}
                  {meses.map((m) => (
                    <Fragment key={m.mes}>
                      <tr className="cursor-pointer border-t hover:bg-muted/30" onClick={() => alternar(m.mes)}>
                        <td className="px-2 py-2">{abertos.has(m.mes) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                        <td className="px-2 py-2 font-medium">{rotuloMes(m.mes)}</td>
                        <td className="px-2 py-2 text-right">{m.extratoQtd}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">{fmtMoney(m.extratoTotal)}</td>
                        <td className="px-2 py-2 text-right">{m.erpQtd}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">{fmtMoney(m.erpTotal)}</td>
                        <td className={cn("px-2 py-2 text-right font-semibold whitespace-nowrap", m.situacao === "confere" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>{fmtMoney(m.diferenca)}</td>
                        <td className="px-2 py-2"><Badge variant="outline" className={TOM_SITUACAO[m.situacao]}>{ROTULO_SITUACAO[m.situacao]}</Badge></td>
                      </tr>
                      {abertos.has(m.mes) && (
                        <tr className="border-t bg-muted/20">
                          <td colSpan={8} className="p-3"><DetalheMes mes={m} extrato={extrato.filter((e) => e.data.startsWith(m.mes))} erp={erp.filter((l) => l.data_pagamento.startsWith(m.mes))} /></td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {outros.qtd > 0 && (
            <p className="text-xs text-muted-foreground">
              O extrato também tem {outros.qtd} lançamento(s) que não entram em nenhuma aba (ex.: "CREDIT"), somando {fmtMoney(outros.total)}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function DetalheMes({ mes, extrato, erp }: { mes: MesComparado; extrato: { data: string; transacao: string; valor: number }[]; erp: LinhaErp[] }) {
  // O extrato tem dezenas de créditos iguais no mesmo dia: agrupa por dia para a lista ficar legível.
  const porDia = useMemo(() => {
    const m = new Map<string, { qtd: number; total: number; transacao: string }>();
    for (const e of extrato) {
      const x = m.get(e.data) ?? { qtd: 0, total: 0, transacao: e.transacao };
      x.qtd += 1; x.total += e.valor;
      m.set(e.data, x);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [extrato]);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-md border bg-background">
        <p className="flex items-center gap-1 border-b px-3 py-2 text-xs font-semibold">
          <TituloComFormula alinhar="left" titulo={<>Extrato da Ticket — {rotuloMes(mes.mes)} ({mes.extratoQtd} lançamento(s))</>} formula={<span>Lançamentos do extrato importado neste mês, nesta aba. Como há dezenas de créditos iguais no mesmo dia, eles são agrupados por dia (data, tipo, quantidade e total).</span>} />
        </p>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <tbody>
              {porDia.length === 0 && <tr><td className="px-3 py-4 text-center text-muted-foreground">Sem lançamentos no extrato neste mês.</td></tr>}
              {porDia.map(([dia, x]) => (
                <tr key={dia} className="border-t first:border-t-0">
                  <td className="px-3 py-1.5 whitespace-nowrap">{fmtData(dia)}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{x.transacao}{x.qtd > 1 ? ` · ${x.qtd} lançamentos` : ""}</td>
                  <td className="px-3 py-1.5 text-right font-medium whitespace-nowrap">{fmtMoney(x.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-md border bg-background">
        <p className="flex items-center gap-1 border-b px-3 py-2 text-xs font-semibold">
          <TituloComFormula alinhar="left" titulo={<>ERP — pagamentos com TICKET ({mes.erpQtd})</>} formula={<span>Lançamentos do ERP pagos neste mês com TICKET na descrição, já com os filtros. Colunas: data de pagamento, ID (DM do Malote, DA do Débito Automático ou código da planilha), descrição, empresa · classificação e valor pago.</span>} />
        </p>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <tbody>
              {erp.length === 0 && <tr><td className="px-3 py-4 text-center text-muted-foreground">Sem pagamentos no ERP neste mês (com os filtros).</td></tr>}
              {erp.map((l) => (
                <tr key={`${l.despesa_id}-${l.numero_parcela ?? ""}`} className="border-t first:border-t-0">
                  <td className="px-3 py-1.5 whitespace-nowrap">{fmtData(l.data_pagamento)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap font-mono">{l.id_malote}</td>
                  <td className="max-w-[260px] truncate px-2 py-1.5" title={l.descricao}>{l.descricao}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{l.empresa_nome} · {l.classificacao_nome}</td>
                  <td className="px-3 py-1.5 text-right font-medium whitespace-nowrap">{fmtMoney(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Importacoes({ importacoes, podeExcluir }: { importacoes: ImportacaoTicket[]; podeExcluir: boolean }) {
  const excluir = useExcluirImportacaoTicket();
  if (importacoes.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold"><TituloComFormula alinhar="left" titulo="Extratos importados" formula={<span>Os arquivos CSV da Ticket já gravados no ERP: período que cada um cobre, quantas linhas tem e quem importou. Importar um arquivo que cubra o mesmo período substitui as linhas daquelas datas (nada duplica).</span>} /></CardTitle></CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y text-xs">
          {importacoes.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className="font-medium">{i.arquivo_nome}</span>
              <span className="text-muted-foreground">{fmtData(i.periodo_ini)} a {fmtData(i.periodo_fim)} · {i.qtd_linhas} linha(s)</span>
              <span className="text-muted-foreground">Importado em {fmtDataHora(i.importado_em)}{i.importado_por_nome ? ` por ${i.importado_por_nome}` : ""}</span>
              {podeExcluir && (
                <Button
                  variant="ghost" size="sm" className="ml-auto h-7 text-muted-foreground hover:text-destructive" disabled={excluir.isPending}
                  onClick={async () => {
                    if (!window.confirm(`Excluir esta importação (${i.qtd_linhas} linhas)? O extrato desse período deixa de existir no ERP até ser importado de novo.`)) return;
                    try { await excluir.mutateAsync(i.id); toast.success("Importação excluída."); } catch (e) { toast.error((e as Error).message); }
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />Excluir
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ImportarExtrato() {
  const entrada = useRef<HTMLInputElement>(null);
  const importar = useImportarExtratoTicket();
  const [arquivo, setArquivo] = useState<{ nome: string; csv: ResultadoCsv } | null>(null);

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try { setArquivo({ nome: f.name, csv: lerCsvTicket(await f.text()) }); } catch { toast.error("Não foi possível ler o arquivo."); }
  }

  const csv = arquivo?.csv;
  const datas = csv?.linhas.map((l) => l.data).sort() ?? [];
  const creditos = csv?.linhas.filter((l) => categoriaDoExtrato(l) === "credito").reduce((s, l) => s + l.valor, 0) ?? 0;
  const boletos = Math.abs(csv?.linhas.filter((l) => categoriaDoExtrato(l) === "boleto").reduce((s, l) => s + l.valor, 0) ?? 0);

  async function confirmar() {
    if (!arquivo || arquivo.csv.linhas.length === 0) return;
    try {
      const r = await importar.mutateAsync({ arquivo: arquivo.nome, linhas: arquivo.csv.linhas });
      toast.success(`Extrato importado: ${r.inseridas} linha(s)${r.substituidas > 0 ? `, substituindo ${r.substituidas} do mesmo período` : ""}.`);
      setArquivo(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <input ref={entrada} type="file" accept=".csv,text/csv" className="hidden" onChange={aoEscolher} />
      <Button size="sm" onClick={() => entrada.current?.click()}><Upload className="mr-1.5 h-4 w-4" />Importar extrato (CSV)</Button>
      <Dialog open={!!arquivo} onOpenChange={(o) => !o && setArquivo(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar extrato da Ticket</DialogTitle>
            <DialogDescription>{arquivo?.nome}</DialogDescription>
          </DialogHeader>
          {csv && (
            <div className="space-y-2 text-sm">
              <p>{csv.linhas.length} linha(s) lidas{datas.length > 0 && <>, de <strong>{fmtData(datas[0])}</strong> a <strong>{fmtData(datas[datas.length - 1])}</strong></>}.</p>
              <ul className="rounded-md border p-2 text-xs">
                <li className="flex justify-between"><span>Créditos adicionados (Tickets)</span><span className="font-medium">{fmtMoney(creditos)}</span></li>
                <li className="flex justify-between"><span>Pagamento de Boleto (debitado)</span><span className="font-medium">{fmtMoney(boletos)}</span></li>
              </ul>
              <p className="text-xs text-muted-foreground">
                Se já houver extrato importado nesse período, as linhas dessas datas são substituídas pelas deste arquivo (nada fica duplicado).
              </p>
              {csv.erros.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  <p className="flex items-center gap-1 font-medium"><AlertTriangle className="h-3.5 w-3.5" />{csv.erros.length} linha(s) não puderam ser lidas e serão ignoradas:</p>
                  <ul className="mt-1 max-h-24 overflow-auto">
                    {csv.erros.slice(0, 8).map((e) => <li key={e.linha}>Linha {e.linha}: {e.motivo}</li>)}
                    {csv.erros.length > 8 && <li>… e mais {csv.erros.length - 8}.</li>}
                  </ul>
                </div>
              )}
              {csv.linhas.length === 0 && <p className="text-xs text-red-600">Nenhuma linha válida. Confira se o arquivo é o extrato em CSV da Ticket (transação, data, status, valor).</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setArquivo(null)} disabled={importar.isPending}>Cancelar</Button>
            <Button onClick={() => void confirmar()} disabled={importar.isPending || !csv || csv.linhas.length === 0}>{importar.isPending ? "Importando…" : "Importar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
