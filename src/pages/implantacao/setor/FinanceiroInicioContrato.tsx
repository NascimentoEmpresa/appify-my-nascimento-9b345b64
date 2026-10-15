// RESUMO FINANCEIRO DE INÍCIO DE CONTRATO — SIS-2026-0599, tela do mockup
// "Financeiro.png". Só leitura: quem monta a base é a Implantação; o
// Financeiro consulta. Por isso a tela não tem nenhum botão de salvar — os
// únicos do mockup são Imprimir e Exportar.
import { useMemo, useState } from "react";
import { Banknote, Building2, CalendarCheck2, Coins, FileText, Layers, MapPin, ShieldCheck } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SemAcesso } from "@/components/layout/SemAcesso";
import {
  CabecalhoSetor, BotaoExportar, BarraFiltros, FileiraIndicadores, BaseVazia,
} from "@/components/implantacao/SetorShell";
import {
  CartaoIndicador, PainelGrafico, EstadoVazio, CabecalhoTabela, TickCategoria, formatarEixoMoeda,
} from "@/components/suprimentos/dashboard/PainelBase";
import {
  useContratosDaBase, useResumoBase, useFinanceiroBase, brl, num, type LinhaFinanceiro,
} from "@/hooks/useImplantacaoBase";
import { exportarCsv } from "@/lib/implantacao/exportarBase";

const CORES_CIDADE = ["#2f8fea", "#ef8888", "#f5b73d", "#4ec9a5", "#9b8cf5", "#64748b"];

export default function FinanceiroInicioContrato() {
  return (
    <AcessoGate menu="financeiro.inicio_contrato" acao="visualizar" fallback={<SemAcesso />}>
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const [contratoId, setContratoId] = useState<string>("");
  const [cidade, setCidade] = useState("todas");
  const [faixa, setFaixa] = useState("todas");
  const [busca, setBusca] = useState("");

  const { data: contratos = [] } = useContratosDaBase();
  const { data: resumo, isLoading: carregandoResumo } = useResumoBase(contratoId || null);
  const { data: linhas = [], isLoading } = useFinanceiroBase(contratoId || null);

  const cidades = useMemo(
    () => [...new Set(linhas.map((l) => l.cidade).filter(Boolean))] as string[],
    [linhas],
  );

  const filtradas = useMemo(
    () =>
      linhas.filter(
        (l) =>
          (cidade === "todas" || l.cidade === cidade) &&
          (faixa === "todas" || l.faixa_custo === faixa) &&
          (!busca || `${l.posto} ${l.cidade ?? ""}`.toLowerCase().includes(busca.toLowerCase())),
      ),
    [linhas, cidade, faixa, busca],
  );

  const totalMensal = filtradas.reduce((s, l) => s + (l.valor_mensal_postos ?? 0), 0);
  const totalPostos = filtradas.reduce((s, l) => s + l.qt_postos, 0);
  const totalColaboradores = filtradas.reduce((s, l) => s + l.qt_funcionarios, 0);
  const ticketMedio = totalPostos ? totalMensal / totalPostos : 0;
  // Custo por pessoa é o número que não muda quando a planilha do Yuri entra:
  // ela traz o "Nº DE POSTOS" físico (170 no piloto) e o ticket por posto cai,
  // mas o custo por colaborador continua o mesmo.
  const custoPorColaborador = totalColaboradores ? totalMensal / totalColaboradores : 0;

  const topPostos = useMemo(
    () =>
      [...filtradas]
        .sort((a, b) => (b.valor_mensal_postos ?? 0) - (a.valor_mensal_postos ?? 0))
        .slice(0, 5)
        .map((l) => ({ nome: l.posto, valor: l.valor_mensal_postos ?? 0 })),
    [filtradas],
  );

  const porCidade = useMemo(() => {
    const mapa = new Map<string, number>();
    filtradas.forEach((l) => mapa.set(l.cidade ?? "Não informada", (mapa.get(l.cidade ?? "Não informada") ?? 0) + (l.valor_mensal_postos ?? 0)));
    return [...mapa.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
  }, [filtradas]);

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 lg:p-6">
      <CabecalhoSetor
        icone={<Banknote className="h-6 w-6" />}
        titulo="Resumo Financeiro de Início de Contrato"
        subtitulo="Acompanhe a estrutura financeira inicial do contrato, composição por postos, distribuição por cidade e cadastros de apoio para ativação."
        modulo="Financeiro"
        acoes={<BotaoExportar onClick={() => exportarCsv(`financeiro-inicio-contrato`, filtradas as unknown as Record<string, unknown>[])} />}
      />

      <BarraFiltros
        onLimpar={() => { setCidade("todas"); setFaixa("todas"); setBusca(""); }}
        campos={[
          {
            label: "Contrato",
            valor: contratoId,
            placeholder: "Selecione o contrato",
            onChange: setContratoId,
            opcoes: contratos.map((c) => ({ valor: c.id, rotulo: c.nome })),
          },
          {
            label: "Cidade",
            valor: cidade,
            onChange: setCidade,
            opcoes: [{ valor: "todas", rotulo: "Todas" }, ...cidades.map((c) => ({ valor: c, rotulo: c }))],
          },
          {
            label: "Faixa de custo",
            valor: faixa,
            onChange: setFaixa,
            opcoes: [
              { valor: "todas", rotulo: "Todas" },
              { valor: "alta", rotulo: "Alta" },
              { valor: "media", rotulo: "Média" },
              { valor: "baixa", rotulo: "Baixa" },
            ],
          },
        ]}
      />

      {!contratoId || (!isLoading && !linhas.length) ? (
        <BaseVazia contratoEscolhido={!!contratoId} />
      ) : (
        <>
          <FileiraIndicadores>
            {carregandoResumo ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)
            ) : (
              <>
                <CartaoIndicador
                  titulo="Valor Mensal do Contrato"
                  valor={brl(resumo?.valor_mensal)}
                  detalhe={
                    resumo?.valor_mensal_contrato && Math.abs((resumo.valor_mensal ?? 0) - resumo.valor_mensal_contrato) >= 0.01
                      ? `Contratado: ${brl(resumo.valor_mensal_contrato)}`
                      : "Pela Planilha de Custo"
                  }
                  icone={<Coins className="h-5 w-5" />} tom="blue"
                />
                <CartaoIndicador titulo="Quantidade de Postos" valor={num(totalPostos)} icone={<Layers className="h-5 w-5" />} tom="green" />
                <CartaoIndicador titulo="Colaboradores" valor={num(totalColaboradores)} detalhe={`${brl(custoPorColaborador)} por pessoa`} icone={<Building2 className="h-5 w-5" />} tom="amber" />
                <CartaoIndicador titulo="Ticket Médio por Posto" valor={brl(ticketMedio)} icone={<Banknote className="h-5 w-5" />} tom="violet" />
                <CartaoIndicador titulo="Cidades Atendidas" valor={num(resumo?.qt_cidades)} icone={<MapPin className="h-5 w-5" />} tom="slate" />
              </>
            )}
          </FileiraIndicadores>

          <div className="mb-5 grid gap-4 lg:grid-cols-3">
            <PainelGrafico titulo="Top postos por valor mensal" className="lg:col-span-1">
              {topPostos.length ? (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topPostos} layout="vertical" margin={{ left: 20, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={formatarEixoMoeda} />
                      <YAxis type="category" dataKey="nome" width={120} interval={0} tick={<TickCategoria maximo={22} />} />
                      <Tooltip formatter={(v: number) => brl(v)} />
                      <Bar dataKey="valor" name="Valor mensal" fill="#2f8fea" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EstadoVazio texto="Sem postos para exibir." />
              )}
            </PainelGrafico>

            <PainelGrafico titulo="Distribuição do valor por cidade">
              {porCidade.length ? (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={porCidade} dataKey="valor" nameKey="nome" innerRadius={62} outerRadius={95} paddingAngle={2}>
                        {porCidade.map((_, i) => (
                          <Cell key={i} fill={CORES_CIDADE[i % CORES_CIDADE.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => brl(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EstadoVazio texto="Sem cidades informadas." />
              )}
            </PainelGrafico>

            <PainelGrafico titulo="Alertas Financeiros de Implantação">
              <div className="space-y-2.5">
                <Alerta
                  icone={<CalendarCheck2 className="h-4 w-4" />}
                  titulo="Controle de Prazos"
                  detalhe={`${num(resumo?.qt_prazos)} registro(s) cadastrado(s)`}
                  selo={resumo?.qt_prazos ? "Em acompanhamento" : "Sem registros"}
                  ok={!!resumo?.qt_prazos}
                />
                <Alerta
                  icone={<FileText className="h-4 w-4" />}
                  titulo="Documentação"
                  detalhe={`${num(resumo?.qt_documentos)} registro(s) cadastrado(s)`}
                  selo={resumo?.qt_documentos ? "Em acompanhamento" : "Sem registros"}
                  ok={!!resumo?.qt_documentos}
                />
                <Alerta
                  icone={<Building2 className="h-4 w-4" />}
                  titulo="CNPJ contratante"
                  detalhe={resumo?.cnpj_contratante ?? "Não informado na base"}
                  selo={resumo?.cnpj_contratante ? "Informado" : "Pendente"}
                  ok={!!resumo?.cnpj_contratante}
                />
                <Alerta
                  icone={<ShieldCheck className="h-4 w-4" />}
                  titulo="Dados para parametrização"
                  detalhe={resumo?.sincronizado_em ? `Atualizado em ${new Date(resumo.sincronizado_em).toLocaleString("pt-BR")}` : "Base nunca atualizada"}
                  selo={resumo?.sincronizado_em ? "Pronto para implantação" : "Pendente"}
                  ok={!!resumo?.sincronizado_em}
                />
              </div>
            </PainelGrafico>
          </div>

          <Card>
            <CardContent className="p-4">
              <Tabs defaultValue="postos">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <TabsList>
                    <TabsTrigger value="postos">Postos Financeiros</TabsTrigger>
                    <TabsTrigger value="cidade">Composição por Cidade</TabsTrigger>
                  </TabsList>
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar posto, cidade ou descrição..."
                    className="h-9 w-full sm:w-72"
                  />
                </div>

                <TabsContent value="postos">
                  {isLoading ? <Skeleton className="h-48" /> : <TabelaPostos linhas={filtradas} total={totalMensal} />}
                </TabsContent>

                <TabsContent value="cidade">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <CabecalhoTabela>Cidade</CabecalhoTabela>
                          <CabecalhoTabela alinhar="right">Valor Mensal (R$)</CabecalhoTabela>
                          <CabecalhoTabela alinhar="right">Participação %</CabecalhoTabela>
                        </tr>
                      </thead>
                      <tbody>
                        {porCidade.map((c) => (
                          <tr key={c.nome} className="border-b last:border-0">
                            <td className="px-3 py-2">{c.nome}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{brl(c.valor)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {totalMensal ? ((100 * c.valor) / totalMensal).toFixed(2) : "0,00"}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Alerta({ icone, titulo, detalhe, selo, ok }: { icone: React.ReactNode; titulo: string; detalhe: string; selo: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-slate-50/60 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className={ok ? "mt-0.5 text-emerald-600" : "mt-0.5 text-slate-400"}>{icone}</span>
        <div>
          <p className="text-sm font-semibold text-slate-800">{titulo}</p>
          <p className="text-xs text-slate-500">{detalhe}</p>
        </div>
      </div>
      <Badge variant="outline" className={ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"}>
        {selo}
      </Badge>
    </div>
  );
}

function TabelaPostos({ linhas, total }: { linhas: LinhaFinanceiro[]; total: number }) {
  const faixaSelo = { alta: "bg-red-100 text-red-700", media: "bg-amber-100 text-amber-700", baixa: "bg-emerald-100 text-emerald-700" };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <CabecalhoTabela>Posto</CabecalhoTabela>
            <CabecalhoTabela alinhar="right">Custo por Pessoa (R$)</CabecalhoTabela>
            <CabecalhoTabela alinhar="right">Qtde de Postos</CabecalhoTabela>
            <CabecalhoTabela alinhar="right">Colaboradores</CabecalhoTabela>
            <CabecalhoTabela alinhar="right">Valor Mensal dos Postos (R$)</CabecalhoTabela>
            <CabecalhoTabela alinhar="center">Faixa de Custo</CabecalhoTabela>
            <CabecalhoTabela alinhar="right">Participação %</CabecalhoTabela>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={`${l.posto}-${i}`} className="border-b last:border-0 hover:bg-slate-50/60">
              <td className="px-3 py-2 font-medium text-slate-800">{l.posto}</td>
              <td className="px-3 py-2 text-right tabular-nums">{brl(l.valor_posto)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{num(l.qt_postos)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{num(l.qt_funcionarios)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{brl(l.valor_mensal_postos)}</td>
              <td className="px-3 py-2 text-center">
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${faixaSelo[l.faixa_custo]}`}>
                  {l.faixa_custo === "media" ? "Média" : l.faixa_custo === "alta" ? "Alta" : "Baixa"}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{(l.participacao ?? 0).toFixed(2)}%</td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-bold">
            <td className="px-3 py-2">Total Geral</td>
            <td className="px-3 py-2 text-right">—</td>
            <td className="px-3 py-2 text-right tabular-nums">{num(linhas.reduce((s, l) => s + l.qt_postos, 0))}</td>
            <td className="px-3 py-2 text-right tabular-nums">{num(linhas.reduce((s, l) => s + l.qt_funcionarios, 0))}</td>
            <td className="px-3 py-2 text-right tabular-nums">{brl(total)}</td>
            <td className="px-3 py-2 text-center">—</td>
            <td className="px-3 py-2 text-right tabular-nums">100,00%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
