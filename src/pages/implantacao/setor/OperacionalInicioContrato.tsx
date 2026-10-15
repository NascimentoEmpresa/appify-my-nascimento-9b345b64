// BASE OPERACIONAL DO INÍCIO DE CONTRATO — SIS-2026-0599, mockup
// "Operacional.png". Só leitura.
//
// A fonte dos locais é sup_posto (151 no contrato-piloto: 1ª DP Alvorada,
// Palácio da Polícia...). O endereço vem de planilha_posto_localizacao quando
// existe — no piloto ela está vazia, então a coluna Endereço aparece com "—"
// até alguém importar a planilha do Yuri. Isso é dado faltando no ERP, não
// defeito de tela.
import { useMemo, useState } from "react";
import { Building2, MapPin, Layers, Users, Percent, Trophy, CheckCircle2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SemAcesso } from "@/components/layout/SemAcesso";
import { CabecalhoSetor, BotaoExportar, BarraFiltros, FileiraIndicadores, BaseVazia } from "@/components/implantacao/SetorShell";
import { CartaoIndicador, PainelGrafico, EstadoVazio, CabecalhoTabela, TickCategoria } from "@/components/suprimentos/dashboard/PainelBase";
import { useContratosDaBase, useResumoBase, useOperacionalBase, num } from "@/hooks/useImplantacaoBase";
import { exportarCsv } from "@/lib/implantacao/exportarBase";

export default function OperacionalInicioContrato() {
  return (
    <AcessoGate menu="operacional.inicio_contrato" acao="visualizar" fallback={<SemAcesso />}>
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const [contratoId, setContratoId] = useState("");
  const [cidade, setCidade] = useState("todas");
  const [busca, setBusca] = useState("");

  const { data: contratos = [] } = useContratosDaBase();
  const { data: resumo } = useResumoBase(contratoId || null);
  const { data: linhas = [], isLoading } = useOperacionalBase(contratoId || null);

  const cidades = useMemo(() => [...new Set(linhas.map((l) => l.cidade).filter(Boolean))] as string[], [linhas]);

  const filtradas = useMemo(
    () =>
      linhas.filter(
        (l) =>
          (cidade === "todas" || l.cidade === cidade) &&
          (!busca || `${l.local_nome} ${l.cidade ?? ""} ${l.endereco ?? ""} ${l.posto ?? ""}`.toLowerCase().includes(busca.toLowerCase())),
      ),
    [linhas, cidade, busca],
  );

  const totalPostos = filtradas.reduce((s, l) => s + l.qt_postos, 0);
  const totalFuncionarios = filtradas.reduce((s, l) => s + l.qt_funcionarios, 0);

  const porCidade = useMemo(() => {
    const mapa = new Map<string, number>();
    filtradas.forEach((l) => mapa.set(l.cidade ?? "Não informada", (mapa.get(l.cidade ?? "Não informada") ?? 0) + l.qt_funcionarios));
    return [...mapa.entries()].map(([nome, quantidade]) => ({ nome, quantidade })).sort((a, b) => b.quantidade - a.quantidade).slice(0, 12);
  }, [filtradas]);

  const topLocais = useMemo(
    () =>
      [...filtradas]
        .sort((a, b) => b.qt_funcionarios - a.qt_funcionarios)
        .slice(0, 8)
        .map((l) => ({ nome: l.local_nome, quantidade: l.qt_funcionarios })),
    [filtradas],
  );

  const maiorConcentracao = topLocais[0];
  const pctMaiorCidade = totalFuncionarios && porCidade[0] ? (100 * porCidade[0].quantidade) / totalFuncionarios : 0;

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 lg:p-6">
      <CabecalhoSetor
        icone={<Building2 className="h-6 w-6" />}
        titulo="Base Operacional do Início de Contrato"
        subtitulo="Visualize a distribuição dos postos, locais de trabalho, cidades atendidas e cobertura operacional prevista para o início do contrato."
        modulo="Operacional"
        tom="violet"
        acoes={<BotaoExportar onClick={() => exportarCsv("operacional-inicio-contrato", filtradas as unknown as Record<string, unknown>[])} />}
      />

      <BarraFiltros
        onLimpar={() => { setCidade("todas"); setBusca(""); }}
        campos={[
          { label: "Contrato", valor: contratoId, placeholder: "Selecione o contrato", onChange: setContratoId, opcoes: contratos.map((c) => ({ valor: c.id, rotulo: c.nome })) },
          { label: "Cidade", valor: cidade, onChange: setCidade, opcoes: [{ valor: "todas", rotulo: "Todas" }, ...cidades.map((c) => ({ valor: c, rotulo: c }))] },
        ]}
      />

      {!contratoId || (!isLoading && !linhas.length) ? (
        <BaseVazia contratoEscolhido={!!contratoId} />
      ) : (
        <>
          <FileiraIndicadores>
            <CartaoIndicador titulo="Locais de Trabalho" valor={num(resumo?.qt_locais)} icone={<Building2 className="h-5 w-5" />} tom="blue" />
            <CartaoIndicador titulo="Cidades Atendidas" valor={num(resumo?.qt_cidades)} icone={<MapPin className="h-5 w-5" />} tom="green" />
            <CartaoIndicador titulo="Postos Operacionais" valor={num(totalPostos)} icone={<Layers className="h-5 w-5" />} tom="amber" />
            <CartaoIndicador titulo="Colaboradores Planejados" valor={num(totalFuncionarios)} icone={<Users className="h-5 w-5" />} tom="violet" />
            <CartaoIndicador titulo="% na maior cidade" valor={`${pctMaiorCidade.toFixed(1)}%`} detalhe={porCidade[0]?.nome} icone={<Percent className="h-5 w-5" />} tom="slate" />
            <CartaoIndicador titulo="Maior concentração" valor={maiorConcentracao ? `${maiorConcentracao.nome} — ${maiorConcentracao.quantidade}` : "—"} icone={<Trophy className="h-5 w-5" />} tom="amber" />
          </FileiraIndicadores>

          <div className="mb-5 grid gap-4 lg:grid-cols-3">
            <PainelGrafico titulo="Colaboradores por cidade">
              {porCidade.length ? <Grafico dados={porCidade} rotulo="Colaboradores" /> : <EstadoVazio texto="Sem cidade informada na base." />}
            </PainelGrafico>
            <PainelGrafico titulo="Top locais por quantidade de postos">
              {topLocais.length ? <Grafico dados={topLocais} rotulo="Colaboradores" cor="#4ec9a5" /> : <EstadoVazio texto="Sem locais na base." />}
            </PainelGrafico>
            <PainelGrafico titulo="Cobertura operacional">
              <div className="space-y-3">
                <Bloco icone={<Layers className="h-5 w-5" />} valor={num(totalPostos)} rotulo="postos distribuídos" />
                <Bloco icone={<Users className="h-5 w-5" />} valor={num(totalFuncionarios)} rotulo="colaboradores previstos" />
                <Bloco icone={<MapPin className="h-5 w-5" />} valor={num(resumo?.qt_cidades)} rotulo="cidades cobertas" />
                <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">
                      {filtradas.length ? "Contrato pronto para mobilização" : "Estrutura ainda não planejada"}
                    </p>
                    <p className="text-xs text-emerald-700">
                      {filtradas.length ? "Estrutura operacional planejada e validada." : "Nenhum local na base mestre."}
                    </p>
                  </div>
                </div>
              </div>
            </PainelGrafico>
          </div>

          <Card>
            <CardContent className="p-4">
              <Tabs defaultValue="locais">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <TabsList>
                    <TabsTrigger value="locais">Locais de Trabalho</TabsTrigger>
                    <TabsTrigger value="cidades">Distribuição por Cidade</TabsTrigger>
                  </TabsList>
                  <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar local, cidade, posto ou endereço..." className="h-9 w-full sm:w-80" />
                </div>

                <TabsContent value="locais">
                  {isLoading ? (
                    <Skeleton className="h-48" />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr>
                            <CabecalhoTabela>Local</CabecalhoTabela>
                            <CabecalhoTabela>Cidade</CabecalhoTabela>
                            <CabecalhoTabela>Endereço</CabecalhoTabela>
                            <CabecalhoTabela>Posto</CabecalhoTabela>
                            <CabecalhoTabela alinhar="right">Qtde de Postos</CabecalhoTabela>
                            <CabecalhoTabela alinhar="right">Qtde de Funcionários por Local</CabecalhoTabela>
                          </tr>
                        </thead>
                        <tbody>
                          {filtradas.map((l, i) => (
                            <tr key={`${l.local_nome}-${i}`} className="border-b last:border-0 hover:bg-slate-50/60">
                              <td className="px-3 py-2 font-medium text-slate-800">{l.local_nome}</td>
                              <td className="px-3 py-2">{l.cidade ?? "—"}</td>
                              <td className="px-3 py-2 text-slate-600">{l.endereco ?? "—"}</td>
                              <td className="px-3 py-2">{l.posto ?? "—"}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{num(l.qt_postos)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{num(l.qt_funcionarios)}</td>
                            </tr>
                          ))}
                          <tr className="bg-slate-50 font-bold">
                            <td className="px-3 py-2" colSpan={4}>Total Geral</td>
                            <td className="px-3 py-2 text-right tabular-nums">{num(totalPostos)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{num(totalFuncionarios)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="cidades">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <CabecalhoTabela>Cidade</CabecalhoTabela>
                          <CabecalhoTabela alinhar="right">Colaboradores</CabecalhoTabela>
                          <CabecalhoTabela alinhar="right">Participação</CabecalhoTabela>
                        </tr>
                      </thead>
                      <tbody>
                        {porCidade.map((c) => (
                          <tr key={c.nome} className="border-b last:border-0">
                            <td className="px-3 py-2">{c.nome}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{num(c.quantidade)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {totalFuncionarios ? ((100 * c.quantidade) / totalFuncionarios).toFixed(1) : "0,0"}%
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

function Grafico({ dados, rotulo, cor = "#2f8fea" }: { dados: { nome: string; quantidade: number }[]; rotulo: string; cor?: string }) {
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} layout="vertical" margin={{ left: 20, right: 30 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="nome" width={120} interval={0} tick={<TickCategoria maximo={22} />} />
          <Tooltip />
          <Bar dataKey="quantidade" name={rotulo} fill={cor} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Bloco({ icone, valor, rotulo }: { icone: React.ReactNode; valor: string; rotulo: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-slate-50/60 px-3 py-2.5">
      <span className="text-slate-500">{icone}</span>
      <div>
        <p className="text-lg font-bold leading-none text-slate-900">{valor}</p>
        <p className="mt-1 text-xs text-slate-500">{rotulo}</p>
      </div>
    </div>
  );
}
