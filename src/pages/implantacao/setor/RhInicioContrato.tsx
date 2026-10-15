// PLANEJAMENTO DE RH PARA INÍCIO DE CONTRATO — SIS-2026-0599, mockup "RH.png".
// Só leitura, como as outras três setoriais.
import { useMemo, useState } from "react";
import { Users, Layers, Briefcase, Coins, BarChart3, MapPin, Bus, Gift, FileCheck2, Building2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SemAcesso } from "@/components/layout/SemAcesso";
import { CabecalhoSetor, BotaoExportar, BarraFiltros, FileiraIndicadores, BaseVazia } from "@/components/implantacao/SetorShell";
import { CartaoIndicador, PainelGrafico, EstadoVazio, CabecalhoTabela, TickCategoria } from "@/components/suprimentos/dashboard/PainelBase";
import { useContratosDaBase, useResumoBase, useRhBase, brl, num } from "@/hooks/useImplantacaoBase";
import { exportarCsv } from "@/lib/implantacao/exportarBase";

export default function RhInicioContrato() {
  return (
    <AcessoGate menu="rh.inicio_contrato" acao="visualizar" fallback={<SemAcesso />}>
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const [contratoId, setContratoId] = useState("");
  const [escala, setEscala] = useState("todas");
  const [busca, setBusca] = useState("");

  const { data: contratos = [] } = useContratosDaBase();
  const { data: resumo } = useResumoBase(contratoId || null);
  const { data: linhas = [], isLoading } = useRhBase(contratoId || null);

  const escalas = useMemo(() => [...new Set(linhas.map((l) => l.escala).filter(Boolean))] as string[], [linhas]);

  const filtradas = useMemo(
    () =>
      linhas.filter(
        (l) =>
          (escala === "todas" || l.escala === escala) &&
          (!busca || `${l.tipo_servico} ${l.cbo ?? ""} ${l.escala ?? ""}`.toLowerCase().includes(busca.toLowerCase())),
      ),
    [linhas, escala, busca],
  );

  const totalFuncionarios = filtradas.reduce((s, l) => s + l.qt_funcionarios, 0);
  const totalPostos = filtradas.reduce((s, l) => s + l.qt_postos, 0);
  const remuneracaoTotal = filtradas.reduce((s, l) => s + (l.total_remuneracao ?? 0) * l.qt_funcionarios, 0);
  const mediaColaborador = totalFuncionarios ? remuneracaoTotal / totalFuncionarios : 0;

  const agrupar = (campo: "carga_horaria" | "escala") => {
    const mapa = new Map<string, number>();
    filtradas.forEach((l) => {
      const k = l[campo] ?? "Não informada";
      mapa.set(k, (mapa.get(k) ?? 0) + l.qt_funcionarios);
    });
    return [...mapa.entries()]
      .map(([nome, quantidade]) => ({
        nome,
        quantidade,
        rotulo: totalFuncionarios ? `${quantidade} (${((100 * quantidade) / totalFuncionarios).toFixed(1)}%)` : String(quantidade),
      }))
      .sort((a, b) => b.quantidade - a.quantidade);
  };

  const porCarga = useMemo(() => agrupar("carga_horaria"), [filtradas, totalFuncionarios]);
  const porEscala = useMemo(() => agrupar("escala"), [filtradas, totalFuncionarios]);
  const sindicato = filtradas.find((l) => l.sindicato)?.sindicato ?? null;
  const vtMedio = useMemo(() => {
    const com = filtradas.filter((l) => l.vt_dia);
    return com.length ? com.reduce((s, l) => s + (l.vt_dia ?? 0), 0) / com.length : 0;
  }, [filtradas]);

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 lg:p-6">
      <CabecalhoSetor
        icone={<Users className="h-6 w-6" />}
        titulo="Planejamento de RH para Início de Contrato"
        subtitulo="Acompanhe o dimensionamento de pessoas, escalas, cargas horárias e dados-base de admissão para ativação do contrato."
        modulo="RH"
        tom="blue"
        acoes={<BotaoExportar onClick={() => exportarCsv("rh-inicio-contrato", filtradas as unknown as Record<string, unknown>[])} />}
      />

      <BarraFiltros
        onLimpar={() => { setEscala("todas"); setBusca(""); }}
        campos={[
          { label: "Contrato", valor: contratoId, placeholder: "Selecione o contrato", onChange: setContratoId, opcoes: contratos.map((c) => ({ valor: c.id, rotulo: c.nome })) },
          { label: "Escala", valor: escala, onChange: setEscala, opcoes: [{ valor: "todas", rotulo: "Todas" }, ...escalas.map((e) => ({ valor: e, rotulo: e }))] },
        ]}
      />

      {!contratoId || (!isLoading && !linhas.length) ? (
        <BaseVazia contratoEscolhido={!!contratoId} />
      ) : (
        <>
          <FileiraIndicadores>
            <CartaoIndicador titulo="Colaboradores Planejados" valor={num(totalFuncionarios)} icone={<Users className="h-5 w-5" />} tom="blue" />
            <CartaoIndicador titulo="Postos Contratados" valor={num(totalPostos)} icone={<Layers className="h-5 w-5" />} tom="green" />
            <CartaoIndicador titulo="Tipos de Serviço" valor={num(resumo?.qt_tipos_servico)} icone={<Briefcase className="h-5 w-5" />} tom="amber" />
            <CartaoIndicador titulo="Remuneração Estimada" valor={brl(remuneracaoTotal)} icone={<Coins className="h-5 w-5" />} tom="violet" />
            <CartaoIndicador titulo="Média por Colaborador" valor={brl(mediaColaborador)} icone={<BarChart3 className="h-5 w-5" />} tom="slate" />
            <CartaoIndicador titulo="Cidades Atendidas" valor={num(resumo?.qt_cidades)} icone={<MapPin className="h-5 w-5" />} tom="blue" />
          </FileiraIndicadores>

          <div className="mb-5 grid gap-4 lg:grid-cols-3">
            <PainelGrafico titulo="Distribuição por carga horária">
              <GraficoBarras dados={porCarga} vazio="Sem carga horária informada." />
            </PainelGrafico>
            <PainelGrafico titulo="Escalas planejadas">
              <GraficoBarras dados={porEscala} vazio="Sem escala informada." />
            </PainelGrafico>
            <PainelGrafico titulo="Indicadores de benefícios e sindicato">
              <div className="space-y-2.5">
                <Indicador icone={<Building2 className="h-4 w-4" />} titulo="Sindicato base" detalhe={sindicato ?? "Não informado na base"} selo={sindicato ? "Definido" : "Pendente"} ok={!!sindicato} />
                <Indicador icone={<Bus className="h-4 w-4" />} titulo="VT médio por dia" detalhe={vtMedio ? brl(vtMedio) : "Não informado na base"} selo={vtMedio ? "Calculado" : "Pendente"} ok={!!vtMedio} />
                <Indicador icone={<Gift className="h-4 w-4" />} titulo="Prêmio assiduidade" detalhe="Conforme convenção coletiva do sindicato base" selo="Conforme CCT" ok />
                <Indicador icone={<FileCheck2 className="h-4 w-4" />} titulo="Estrutura para admissão" detalhe={`${num(filtradas.length)} tipo(s) de serviço dimensionado(s)`} selo={filtradas.length ? "Pronto para ativação" : "Pendente"} ok={!!filtradas.length} />
              </div>
            </PainelGrafico>
          </div>

          <Card>
            <CardContent className="p-4">
              <Tabs defaultValue="quadro">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <TabsList>
                    <TabsTrigger value="quadro">Quadro de Pessoal</TabsTrigger>
                    <TabsTrigger value="cargas">Cargas Horárias</TabsTrigger>
                    <TabsTrigger value="escalas">Escalas</TabsTrigger>
                  </TabsList>
                  <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar tipo de serviço, CBO, escala..." className="h-9 w-full sm:w-72" />
                </div>

                <TabsContent value="quadro">
                  {isLoading ? (
                    <Skeleton className="h-48" />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr>
                            <CabecalhoTabela>Tipo de Serviço</CabecalhoTabela>
                            <CabecalhoTabela>CBO</CabecalhoTabela>
                            <CabecalhoTabela>Carga Horária</CabecalhoTabela>
                            <CabecalhoTabela>Escala</CabecalhoTabela>
                            <CabecalhoTabela alinhar="right">Salário Base (R$)</CabecalhoTabela>
                            <CabecalhoTabela alinhar="right">Total Remuneração (R$)</CabecalhoTabela>
                            <CabecalhoTabela alinhar="right">Nº de Postos</CabecalhoTabela>
                            <CabecalhoTabela alinhar="right">Nº de Funcionários</CabecalhoTabela>
                          </tr>
                        </thead>
                        <tbody>
                          {filtradas.map((l, i) => (
                            <tr key={`${l.tipo_servico}-${i}`} className="border-b last:border-0 hover:bg-slate-50/60">
                              <td className="px-3 py-2 font-medium text-slate-800">{l.tipo_servico}</td>
                              <td className="px-3 py-2">{l.cbo ?? "—"}</td>
                              <td className="px-3 py-2">{l.carga_horaria ?? "—"}</td>
                              <td className="px-3 py-2">{l.escala ?? "—"}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{l.salario_base ? brl(l.salario_base) : "—"}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{l.total_remuneracao ? brl(l.total_remuneracao) : "—"}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{num(l.qt_postos)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{num(l.qt_funcionarios)}</td>
                            </tr>
                          ))}
                          <tr className="bg-slate-50 font-bold">
                            <td className="px-3 py-2" colSpan={6}>Total Geral</td>
                            <td className="px-3 py-2 text-right tabular-nums">{num(totalPostos)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{num(totalFuncionarios)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="cargas"><TabelaAgrupada dados={porCarga} coluna="Carga horária" /></TabsContent>
                <TabsContent value="escalas"><TabelaAgrupada dados={porEscala} coluna="Escala" /></TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function GraficoBarras({ dados, vazio }: { dados: { nome: string; quantidade: number; rotulo: string }[]; vazio: string }) {
  if (!dados.length) return <EstadoVazio texto={vazio} />;
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} layout="vertical" margin={{ left: 20, right: 60 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="nome" width={120} interval={0} tick={<TickCategoria maximo={22} />} />
          <Tooltip formatter={(v: number) => `${v} colaborador(es)`} />
          <Bar dataKey="quantidade" name="Colaboradores" fill="#2f8fea" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TabelaAgrupada({ dados, coluna }: { dados: { nome: string; quantidade: number; rotulo: string }[]; coluna: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <CabecalhoTabela>{coluna}</CabecalhoTabela>
            <CabecalhoTabela alinhar="right">Colaboradores</CabecalhoTabela>
            <CabecalhoTabela alinhar="right">Participação</CabecalhoTabela>
          </tr>
        </thead>
        <tbody>
          {dados.map((d) => (
            <tr key={d.nome} className="border-b last:border-0">
              <td className="px-3 py-2">{d.nome}</td>
              <td className="px-3 py-2 text-right tabular-nums">{num(d.quantidade)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{d.rotulo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Indicador({ icone, titulo, detalhe, selo, ok }: { icone: React.ReactNode; titulo: string; detalhe: string; selo: string; ok: boolean }) {
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
