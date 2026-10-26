// PLANEJAMENTO DE COMPRAS PARA INÍCIO DE CONTRATO — SIS-2026-0599, mockup
// "Compras.png". Só leitura.
//
// O enxoval vem do catálogo vivo (sup_funcao → sup_funcao_item → sup_item),
// não de uma cópia congelada da planilha: quando o Suprimentos trocar o
// modelo da camiseta, esta tela acompanha. A QUANTIDADE é a coluna nova
// sup_funcao_item.quantidade (SIS-2026-0599) — item sem quantidade declarada
// aparece com 0 e selo "Sem quantidade", que é a lista de trabalho do
// comprador, não um erro.
import { useMemo, useState } from "react";
import { ShoppingCart, Shirt, Package, Layers, Boxes, ListChecks, CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
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
import { useContratosDaBase, useComprasBase, num, type LinhaCompras } from "@/hooks/useImplantacaoBase";
import { exportarCsv } from "@/lib/implantacao/exportarBase";

const UNIFORME_EPI = ["uniforme", "epi"];

export default function ComprasInicioContrato() {
  return (
    <AcessoGate menu="suprimentos.inicio_contrato" acao="visualizar" fallback={<SemAcesso />}>
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const [contratoId, setContratoId] = useState("");
  const [cargo, setCargo] = useState("todos");
  const [tipo, setTipo] = useState("todos");
  const [busca, setBusca] = useState("");

  const { data: contratos = [] } = useContratosDaBase();
  const { data: linhas = [], isLoading } = useComprasBase(contratoId || null);

  const cargos = useMemo(() => [...new Set(linhas.map((l) => l.cargo))], [linhas]);
  const tipos = useMemo(() => [...new Set(linhas.map((l) => l.tipo))], [linhas]);

  const filtradas = useMemo(
    () =>
      linhas.filter(
        (l) =>
          (cargo === "todos" || l.cargo === cargo) &&
          (tipo === "todos" || l.tipo === tipo) &&
          (!busca || `${l.descricao} ${l.cargo} ${l.tipo}`.toLowerCase().includes(busca.toLowerCase())),
      ),
    [linhas, cargo, tipo, busca],
  );

  const pecasUniforme = filtradas.filter((l) => UNIFORME_EPI.includes(l.tipo)).reduce((s, l) => s + l.quantidade, 0);
  const itensMaterial = filtradas.filter((l) => !UNIFORME_EPI.includes(l.tipo)).reduce((s, l) => s + l.quantidade, 0);
  const tiposUniforme = new Set(filtradas.filter((l) => UNIFORME_EPI.includes(l.tipo)).map((l) => l.descricao)).size;
  const tiposMaterial = new Set(filtradas.filter((l) => !UNIFORME_EPI.includes(l.tipo)).map((l) => l.descricao)).size;
  const semQuantidade = filtradas.filter((l) => !l.quantidade).length;
  const foraDoCatalogo = filtradas.filter((l) => !l.no_catalogo).length;

  const porCargo = (apenas: (l: LinhaCompras) => boolean) => {
    const mapa = new Map<string, number>();
    filtradas.filter(apenas).forEach((l) => mapa.set(l.cargo, (mapa.get(l.cargo) ?? 0) + l.quantidade));
    return [...mapa.entries()].map(([nome, quantidade]) => ({ nome, quantidade })).sort((a, b) => b.quantidade - a.quantidade).slice(0, 10);
  };

  const uniformesPorCargo = useMemo(() => porCargo((l) => UNIFORME_EPI.includes(l.tipo)), [filtradas]);
  const materiaisPorCargo = useMemo(() => porCargo((l) => !UNIFORME_EPI.includes(l.tipo)), [filtradas]);

  const maisDemandados = useMemo(() => {
    const mapa = new Map<string, number>();
    filtradas.filter((l) => UNIFORME_EPI.includes(l.tipo)).forEach((l) => mapa.set(l.descricao, (mapa.get(l.descricao) ?? 0) + l.quantidade));
    return [...mapa.entries()].map(([nome, quantidade]) => ({ nome, quantidade })).sort((a, b) => b.quantidade - a.quantidade).slice(0, 7);
  }, [filtradas]);

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 lg:p-6">
      <CabecalhoSetor
        icone={<ShoppingCart className="h-6 w-6" />}
        titulo="Planejamento de Compras para Início de Contrato"
        subtitulo="Controle os uniformes, EPI e materiais iniciais necessários para ativação dos postos do contrato."
        modulo="Compras"
        acoes={<BotaoExportar onClick={() => exportarCsv("compras-inicio-contrato", filtradas as unknown as Record<string, unknown>[])} />}
      />

      <BarraFiltros
        onLimpar={() => { setCargo("todos"); setTipo("todos"); setBusca(""); }}
        campos={[
          { label: "Contrato", valor: contratoId, placeholder: "Selecione o contrato", onChange: setContratoId, opcoes: contratos.map((c) => ({ valor: c.id, rotulo: c.nome })) },
          { label: "Cargo", valor: cargo, onChange: setCargo, opcoes: [{ valor: "todos", rotulo: "Todos" }, ...cargos.map((c) => ({ valor: c, rotulo: c }))] },
          { label: "Tipo de Item", valor: tipo, onChange: setTipo, opcoes: [{ valor: "todos", rotulo: "Todos" }, ...tipos.map((t) => ({ valor: t, rotulo: rotuloTipo(t) }))] },
        ]}
      />

      {!contratoId || (!isLoading && !linhas.length) ? (
        <BaseVazia contratoEscolhido={!!contratoId} />
      ) : (
        <>
          <FileiraIndicadores>
            <CartaoIndicador titulo="Peças de Uniforme" valor={num(pecasUniforme)} icone={<Shirt className="h-5 w-5" />} tom="blue" />
            <CartaoIndicador titulo="Itens de Material" valor={num(itensMaterial)} icone={<Package className="h-5 w-5" />} tom="green" />
            <CartaoIndicador titulo="Tipos de Uniforme" valor={num(tiposUniforme)} icone={<Layers className="h-5 w-5" />} tom="amber" />
            <CartaoIndicador titulo="Tipos de Materiais" valor={num(tiposMaterial)} icone={<Boxes className="h-5 w-5" />} tom="violet" />
            <CartaoIndicador titulo="Cargos Atendidos" valor={num(cargos.length)} icone={<ListChecks className="h-5 w-5" />} tom="slate" />
            <CartaoIndicador titulo="Total de Itens Iniciais" valor={num(pecasUniforme + itensMaterial)} icone={<ShoppingCart className="h-5 w-5" />} tom="green" />
          </FileiraIndicadores>

          <div className="mb-5 grid gap-4 lg:grid-cols-3">
            <PainelGrafico titulo="Uniformes por cargo">
              {uniformesPorCargo.length ? <Grafico dados={uniformesPorCargo} rotulo="Peças" /> : <EstadoVazio texto="Sem uniformes na base." />}
            </PainelGrafico>
            <PainelGrafico titulo="Materiais por cargo">
              {materiaisPorCargo.length ? <Grafico dados={materiaisPorCargo} rotulo="Itens" cor="#f0883e" /> : <EstadoVazio texto="Sem materiais na base." />}
            </PainelGrafico>
            <PainelGrafico titulo="Itens críticos de mobilização">
              <div className="space-y-2.5">
                <Critico
                  ok={!semQuantidade}
                  titulo="Quantidades declaradas"
                  detalhe={semQuantidade ? `${semQuantidade} item(ns) sem quantidade no catálogo` : "Todos os itens têm quantidade"}
                  selo={semQuantidade ? "Em andamento" : "Concluído"}
                />
                <Critico
                  ok={!foraDoCatalogo}
                  titulo="Itens no catálogo"
                  detalhe={foraDoCatalogo ? `${foraDoCatalogo} item(ns) ainda sem par no catálogo` : "Todos os itens vieram do catálogo"}
                  selo={foraDoCatalogo ? "Em andamento" : "Concluído"}
                />
                <Critico ok={!!tiposUniforme} titulo="EPI básico dimensionado" detalhe={`${num(tiposUniforme)} tipo(s) de uniforme e EPI`} selo={tiposUniforme ? "Concluído" : "Pendente"} />
                <Critico ok={!!filtradas.length} titulo="Compra inicial pronta para programação" detalhe={`${num(filtradas.length)} linha(s) de planejamento`} selo={filtradas.length ? "Em andamento" : "Pendente"} />
              </div>
            </PainelGrafico>
          </div>

          <Card>
            <CardContent className="p-4">
              <Tabs defaultValue="uniformes">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <TabsList>
                    <TabsTrigger value="uniformes">Uniformes e EPI's</TabsTrigger>
                    <TabsTrigger value="materiais">Materiais</TabsTrigger>
                    <TabsTrigger value="resumo">Resumo por Cargo</TabsTrigger>
                    <TabsTrigger value="mais">Mais demandados</TabsTrigger>
                  </TabsList>
                  <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item, cargo, categoria..." className="h-9 w-full sm:w-72" />
                </div>

                <TabsContent value="uniformes">
                  {isLoading ? <Skeleton className="h-48" /> : <TabelaItens linhas={filtradas.filter((l) => UNIFORME_EPI.includes(l.tipo))} />}
                </TabsContent>
                <TabsContent value="materiais">
                  <TabelaItens linhas={filtradas.filter((l) => !UNIFORME_EPI.includes(l.tipo))} />
                </TabsContent>
                <TabsContent value="resumo">
                  <TabelaResumo dados={porCargo(() => true)} />
                </TabsContent>
                <TabsContent value="mais">
                  <TabelaResumo dados={maisDemandados} coluna="Item" />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

const rotuloTipo = (t: string) =>
  ({ uniforme: "Uniforme", epi: "EPI", material: "Material", equipamento: "Equipamento", insumo: "Insumo" })[t] ?? t;

function TabelaItens({ linhas }: { linhas: LinhaCompras[] }) {
  if (!linhas.length) return <EstadoVazio texto="Nenhum item nesta aba." altura={160} />;
  const prioridadeSelo = { alta: "bg-red-100 text-red-700", media: "bg-amber-100 text-amber-700", baixa: "bg-emerald-100 text-emerald-700" };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <CabecalhoTabela>Cargo</CabecalhoTabela>
            <CabecalhoTabela>Tipo de Item</CabecalhoTabela>
            <CabecalhoTabela>Categoria</CabecalhoTabela>
            <CabecalhoTabela alinhar="right">Quantidade</CabecalhoTabela>
            <CabecalhoTabela alinhar="center">Prioridade</CabecalhoTabela>
            <CabecalhoTabela alinhar="center">Status</CabecalhoTabela>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={`${l.cargo}-${l.descricao}-${i}`} className="border-b last:border-0 hover:bg-slate-50/60">
              <td className="px-3 py-2 font-medium text-slate-800">{l.cargo}</td>
              <td className="px-3 py-2">
                {l.descricao}
                {!l.no_catalogo && (
                  <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-[10px] text-amber-700">
                    fora do catálogo
                  </Badge>
                )}
              </td>
              <td className="px-3 py-2">{l.categoria ?? rotuloTipo(l.tipo)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {l.quantidade ? num(l.quantidade) : <span className="text-amber-600">sem quantidade</span>}
              </td>
              <td className="px-3 py-2 text-center">
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${prioridadeSelo[l.prioridade]}`}>
                  {l.prioridade === "media" ? "Média" : l.prioridade === "alta" ? "Alta" : "Baixa"}
                </span>
              </td>
              <td className="px-3 py-2 text-center">
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  {l.status === "planejado" ? "Planejado" : l.status}
                </span>
              </td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-bold">
            <td className="px-3 py-2" colSpan={3}>Total Geral</td>
            <td className="px-3 py-2 text-right tabular-nums">{num(linhas.reduce((s, l) => s + l.quantidade, 0))}</td>
            <td className="px-3 py-2 text-center" colSpan={2}>{num(linhas.length)} linha(s)</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TabelaResumo({ dados, coluna = "Cargo" }: { dados: { nome: string; quantidade: number }[]; coluna?: string }) {
  if (!dados.length) return <EstadoVazio texto="Sem dados." altura={160} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <CabecalhoTabela>{coluna}</CabecalhoTabela>
            <CabecalhoTabela alinhar="right">Quantidade</CabecalhoTabela>
          </tr>
        </thead>
        <tbody>
          {dados.map((d) => (
            <tr key={d.nome} className="border-b last:border-0">
              <td className="px-3 py-2">{d.nome}</td>
              <td className="px-3 py-2 text-right tabular-nums">{num(d.quantidade)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

function Critico({ ok, titulo, detalhe, selo }: { ok: boolean; titulo: string; detalhe: string; selo: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-slate-50/60 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : selo === "Pendente" ? <TriangleAlert className="mt-0.5 h-4 w-4 text-amber-500" /> : <CircleDashed className="mt-0.5 h-4 w-4 text-slate-400" />}
        <div>
          <p className="text-sm font-semibold text-slate-800">{titulo}</p>
          <p className="text-xs text-slate-500">{detalhe}</p>
        </div>
      </div>
      <Badge variant="outline" className={ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
        {selo}
      </Badge>
    </div>
  );
}
