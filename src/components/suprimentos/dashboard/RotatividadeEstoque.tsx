import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Download,
  Info,
  PackageSearch,
  Repeat,
  Ruler,
  Shirt,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AZUL_MAGNITUDE,
  CINZA_GRADE,
  CabecalhoTabela,
  TickCategoria,
  TickCategoriaQuebrado,
  formatarEixoMoeda,
  CartaoDestaque,
  CartaoIndicador,
  EstadoVazio,
  PainelGrafico,
  SERIES,
} from "@/components/suprimentos/dashboard/PainelBase";
import {
  useDashboardRotatividadeEstoque,
  useFornecimentosUniformesColaborador,
  useHistoricoUniformes,
} from "@/hooks/useDashboardRotatividadeEstoque";
import { formatarMoeda, formatarNumero } from "@/lib/suprimentos/dashboardComprasEstoque";
import {
  avisoMovimento,
  classeSituacaoGiro,
  compararGrade,
  coberturaDePreco,
  formatarGap,
  formatarGiro,
  formatarPercentual,
  maiorDesalinhamento,
  rotuloSituacaoGiro,
  situacaoGiro,
  type FornecimentoUniformeColaborador,
  type HistoricoUniformeLinha,
  type RotatividadeEstoqueDados,
} from "@/lib/suprimentos/rotatividadeEstoque";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

/**
 * Aba "Rotatividade do Estoque".
 *
 * Responde, nesta ordem, o que a diretoria pediu: qual item+tamanho mais sai,
 * qual mais entra, qual mais roda dentro do estoque, por contrato, com valor e ao
 * longo do tempo. E fecha com a comparação que só o levantamento de uniformes
 * permite: a grade que a equipe declara vestir contra a que de fato sai.
 *
 * Período, empresa e contrato vêm do filtro da página, compartilhados com as
 * outras abas. A CATEGORIA é local e abre em "Todas" para o saldo disponível
 * bater com Estoque & Etiquetas; o usuário pode restringir depois.
 */

interface Props {
  empresaId: string | null;
  inicio: string;
  fim: string;
  contratoId: string | null;
}

/** Tooltip padrão: marca colorida + nome em tinta de texto, nunca na cor da série. */
function TooltipPadrao({
  active,
  payload,
  label,
  sufixo = "",
}: {
  active?: boolean;
  payload?: { dataKey?: string; name?: string; value?: number; color?: string }[];
  label?: string;
  sufixo?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
      {label && <p className="mb-1 font-semibold text-slate-700">{label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey} className="text-slate-600">
          <span
            className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
            style={{ background: p.color }}
          />
          {p.name}: {formatarNumero(p.value)}
          {sufixo}
        </p>
      ))}
    </div>
  );
}

function TooltipPercentual(props: Parameters<typeof TooltipPadrao>[0]) {
  if (!props.active || !props.payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
      {props.label && <p className="mb-1 font-semibold text-slate-700">{props.label}</p>}
      {props.payload.map((p) => (
        <p key={p.dataKey} className="text-slate-600">
          <span
            className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
            style={{ background: p.color }}
          />
          {p.name}: {formatarPercentual(p.value)}
        </p>
      ))}
    </div>
  );
}

const ICONE_ALERTA: Record<string, typeof AlertTriangle> = {
  grade_sem_declaracao: Ruler,
  declarado_sem_estoque: Users,
  sem_preco: Info,
  catalogo_duplicado: PackageSearch,
};

function BlocoAlertas({ dados }: { dados: RotatividadeEstoqueDados }) {
  if (!dados.alertas.length) return null;
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {dados.alertas.map((alerta) => {
        const Icone = ICONE_ALERTA[alerta.tipo] ?? AlertTriangle;
        return (
          <Alert key={alerta.tipo} className="border-amber-200 bg-amber-50/70">
            <Icone className="h-4 w-4 text-amber-700" />
            <AlertTitle className="text-sm text-amber-900">
              {alerta.titulo}
              {alerta.unidades > 0 && (
                <span className="ml-2 font-mono text-xs font-semibold">
                  {formatarNumero(alerta.unidades)}
                </span>
              )}
            </AlertTitle>
            {alerta.detalhe && (
              <AlertDescription className="text-xs text-amber-800">{alerta.detalhe}</AlertDescription>
            )}
          </Alert>
        );
      })}
    </div>
  );
}

function TabelaPorItemTamanho({ dados }: { dados: RotatividadeEstoqueDados }) {
  const linhas = dados.por_item_tamanho.filter(
    (linha) => linha.pedidas > 0 || linha.saidas > 0 || linha.entradas > 0 || linha.fisico > 0,
  );
  return (
    <PainelGrafico
      titulo="Detalhe por Item e Tamanho"
      subtitulo="Cada linha identifica o código do estoque, a peça e o tamanho. Ficha encerrada permanece visível apenas para conciliar o histórico."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-xs">
          <thead>
            <tr>
              <CabecalhoTabela>Código</CabecalhoTabela>
              <CabecalhoTabela>Item</CabecalhoTabela>
              <CabecalhoTabela>Tamanho</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Pedidas</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Entradas</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Saídas físicas</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Físico</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Reservado</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Disponível</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Giro</CabecalhoTabela>
              <CabecalhoTabela>Rotatividade</CabecalhoTabela>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => {
              const giro = situacaoGiro(linha);
              const historico = linha.cadastro_ativo === false;
              return (
                <tr key={`${linha.codigo ?? linha.item}-${linha.tamanho ?? "sem-tamanho"}`} className={cn("border-b last:border-0 hover:bg-slate-50", historico && "bg-slate-50/80")}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-500">{linha.codigo ?? "—"}</td>
                  <td className="max-w-72 px-3 py-2 font-medium text-blue-950">
                    {linha.item}
                    {historico && <Badge variant="outline" className="ml-2 border-slate-300 text-[10px] text-slate-600">Histórico encerrado</Badge>}
                  </td>
                  <td className="px-3 py-2 font-bold text-blue-950">{linha.tamanho ?? "Sem tamanho"}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatarNumero(linha.pedidas)}</td>
                  <td className="px-3 py-2 text-right">{formatarNumero(linha.entradas)}</td>
                  <td className="px-3 py-2 text-right">{formatarNumero(linha.saidas)}</td>
                  <td className="px-3 py-2 text-right">{formatarNumero(linha.fisico)}</td>
                  <td className="px-3 py-2 text-right text-amber-700">{formatarNumero(linha.reservado)}</td>
                  <td className="px-3 py-2 text-right">{formatarNumero(linha.saldo_disponivel)}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatarGiro(linha.giro)}</td>
                  <td className="px-3 py-2">
                    <Badge className={cn("border-0 text-[10px]", historico ? "bg-slate-200 text-slate-700" : classeSituacaoGiro(giro))}>
                      {historico ? "Histórico" : rotuloSituacaoGiro(giro)}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!linhas.length && <EstadoVazio texto="Nenhum item/tamanho movimentado no período." />}
      </div>
    </PainelGrafico>
  );
}

function TabelaPorPeca({ dados }: { dados: RotatividadeEstoqueDados }) {
  const linhas = dados.por_peca.slice(0, 15);
  return (
    <PainelGrafico
      titulo="Peças que Mais Rodam"
      subtitulo="Top 15 por unidades pedidas, com o tamanho dominante de cada peça."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <CabecalhoTabela>#</CabecalhoTabela>
              <CabecalhoTabela>Código</CabecalhoTabela>
              <CabecalhoTabela>Peça</CabecalhoTabela>
              <CabecalhoTabela alinhar="center">Tamanho top</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Pedidas</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Entradas</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Saídas</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Em estoque</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Giro</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Valor</CabecalhoTabela>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha, i) => (
              <tr key={`${linha.codigo ?? "sem-codigo"}-${linha.peca}`} className="border-b last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-500">{linha.codigo ?? "—"}</td>
                <td className="max-w-64 truncate px-3 py-2 font-medium" title={linha.peca}>
                  {linha.peca}
                </td>
                <td className="px-3 py-2 text-center">
                  {linha.tamanho_top ? (
                    <Badge variant="outline" className="text-[10px] font-bold">
                      {linha.tamanho_top}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-right font-medium">{formatarNumero(linha.pedidas)}</td>
                <td className="px-3 py-2 text-right">{formatarNumero(linha.entradas)}</td>
                <td className="px-3 py-2 text-right">{formatarNumero(linha.saidas)}</td>
                <td className="px-3 py-2 text-right">{formatarNumero(linha.saldo_disponivel)}</td>
                <td className="px-3 py-2 text-right">{formatarGiro(linha.giro)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatarMoeda(linha.valor_pedido)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!linhas.length && <EstadoVazio texto="Nenhuma peça movimentada no período." />}
      </div>
    </PainelGrafico>
  );
}

function rotuloMesHistorico(mes: string): string {
  return new Date(`${mes}T12:00:00`).toLocaleDateString("pt-BR", {
    month: "short",
    year: "numeric",
  });
}

function rotuloDataFornecimento(data: string): string {
  return new Date(`${data}T12:00:00`).toLocaleDateString("pt-BR");
}

function rotuloOrigemDemanda(origem: HistoricoUniformeLinha["origem_demanda"]): string {
  const rotulos: Record<HistoricoUniformeLinha["origem_demanda"], string> = {
    implantacao_aditivo: "Implantação / aditivo",
    substituicao: "Substituição",
    reposicao: "Reposição",
  };
  return rotulos[origem];
}

function TabelaHistoricoUniformes({
  linhas,
  carregando,
  erro,
  inicio,
  fim,
}: {
  linhas: HistoricoUniformeLinha[];
  carregando: boolean;
  erro: Error | null;
  inicio: string;
  fim: string;
}) {
  const linhasVisiveis = linhas.slice(0, 100);
  const exportar = () => {
    const planilha = XLSX.utils.json_to_sheet(linhas.map((linha) => ({
      "Mês": rotuloMesHistorico(linha.mes),
      Origem: rotuloOrigemDemanda(linha.origem_demanda),
      "Tipo de uniforme": linha.tipo_uniforme,
      Tamanho: linha.tamanho ?? "Não informado",
      Solicitados: linha.solicitados,
      Utilizados: linha.utilizados,
    })));
    planilha["!cols"] = [
      { wch: 13 }, { wch: 24 }, { wch: 42 }, { wch: 18 }, { wch: 14 }, { wch: 14 },
    ];
    const arquivo = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(arquivo, planilha, "Histórico uniformes");
    XLSX.writeFile(arquivo, `historico-uniformes-${inicio}-a-${fim}.xlsx`);
  };

  return (
    <PainelGrafico
      titulo="Demanda Mensal por Item, Tamanho e Origem"
      subtitulo="Separe implantação/aditivo, substituição e reposição antes de definir o mínimo e máximo. Solicitado é a demanda registrada; utilizado é a saída física confirmada."
      acao={
        <Button size="sm" variant="outline" onClick={exportar} disabled={!linhas.length || carregando}>
          <Download className="mr-2 h-4 w-4" /> Baixar planilha
        </Button>
      }
    >
      {erro ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar o histórico de uniformes</AlertTitle>
          <AlertDescription>{erro.message}</AlertDescription>
        </Alert>
      ) : carregando ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <CabecalhoTabela>Mês</CabecalhoTabela>
                  <CabecalhoTabela>Origem</CabecalhoTabela>
                  <CabecalhoTabela>Tipo de uniforme</CabecalhoTabela>
                  <CabecalhoTabela>Tamanho</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Solicitados</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Utilizados</CabecalhoTabela>
                </tr>
              </thead>
              <tbody>
                {linhasVisiveis.map((linha) => (
                  <tr
                    key={`${linha.mes}-${linha.tipo_uniforme}-${linha.tamanho ?? "sem-tamanho"}`}
                    className="border-b last:border-0 hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{rotuloMesHistorico(linha.mes)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Badge variant="outline" className="text-[10px] font-medium">
                        {rotuloOrigemDemanda(linha.origem_demanda)}
                      </Badge>
                    </td>
                    <td className="max-w-80 truncate px-3 py-2" title={linha.tipo_uniforme}>{linha.tipo_uniforme}</td>
                    <td className="px-3 py-2">{linha.tamanho ?? "Não informado"}</td>
                    <td className="px-3 py-2 text-right">{formatarNumero(linha.solicitados)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatarNumero(linha.utilizados)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!linhas.length && <EstadoVazio texto="Nenhum uniforme solicitado ou utilizado no período." />}
          </div>
          {linhas.length > linhasVisiveis.length && (
            <p className="mt-3 text-xs text-slate-500">
              Mostrando as {formatarNumero(linhasVisiveis.length)} ocorrências mais recentes de {formatarNumero(linhas.length)}. A planilha contém o histórico completo do período.
            </p>
          )}
        </>
      )}
    </PainelGrafico>
  );
}

function TabelaFornecimentosPorColaborador({
  linhas,
  carregando,
  erro,
  inicio,
  fim,
}: {
  linhas: FornecimentoUniformeColaborador[];
  carregando: boolean;
  erro: Error | null;
  inicio: string;
  fim: string;
}) {
  const linhasVisiveis = linhas.slice(0, 100);
  const porItemTamanho = useMemo(() => {
    const mapa = new Map<string, { rotulo: string; quantidade: number }>();
    for (const linha of linhas) {
      const rotulo = `${linha.tipo_uniforme} · ${linha.tamanho ?? "sem tamanho"}`;
      const atual = mapa.get(rotulo) ?? { rotulo, quantidade: 0 };
      atual.quantidade += linha.quantidade;
      mapa.set(rotulo, atual);
    }
    return [...mapa.values()].sort((a, b) => b.quantidade - a.quantidade).slice(0, 12);
  }, [linhas]);
  const exportar = () => {
    const planilha = XLSX.utils.json_to_sheet(linhas.map((linha) => ({
      "Data do fornecimento": rotuloDataFornecimento(linha.data_fornecimento),
      Colaborador: linha.colaborador,
      Matrícula: linha.matricula ?? "Não informada",
      Contrato: linha.contrato,
      Posto: linha.posto,
      Protocolo: linha.protocolo,
      Uniforme: linha.tipo_uniforme,
      Tamanho: linha.tamanho ?? "Não informado",
      Quantidade: linha.quantidade,
    })));
    planilha["!cols"] = [
      { wch: 20 }, { wch: 34 }, { wch: 16 }, { wch: 36 }, { wch: 28 },
      { wch: 20 }, { wch: 40 }, { wch: 18 }, { wch: 12 },
    ];
    const arquivo = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(arquivo, planilha, "Por colaborador");
    XLSX.writeFile(arquivo, `fornecimentos-uniformes-${inicio}-a-${fim}.xlsx`);
  };

  return (
    <PainelGrafico
      titulo="Fornecimentos de Uniformes por Colaborador"
      subtitulo="Registra somente a saída física do almoxarifado, na data em que a peça foi fornecida. Use o filtro de contrato para analisar o consumo de um posto ao longo das substituições."
      acao={
        <Button size="sm" variant="outline" onClick={exportar} disabled={!linhas.length || carregando}>
          <Download className="mr-2 h-4 w-4" /> Baixar planilha
        </Button>
      }
    >
      {erro ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar os fornecimentos por colaborador</AlertTitle>
          <AlertDescription>{erro.message}</AlertDescription>
        </Alert>
      ) : carregando ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          {porItemTamanho.length > 0 && (
            <div className="mb-4" style={{ height: Math.max(360, porItemTamanho.length * 42) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porItemTamanho} layout="vertical" margin={{ left: 8, right: 38, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CINZA_GRADE} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="rotulo" width={230} tick={<TickCategoriaQuebrado maximoLinha={36} tamanhoFonte={9} />} />
                  <Tooltip content={<TooltipPadrao sufixo=" un. fornecidas" />} cursor={{ fill: "#f1f5f9" }} />
                  <Bar dataKey="quantidade" name="Unidades fornecidas" fill={SERIES.saida} radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="quantidade" position="right" fill="#475569" formatter={(v: number) => formatarNumero(v)} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-xs">
              <thead>
                <tr>
                  <CabecalhoTabela>Data</CabecalhoTabela>
                  <CabecalhoTabela>Colaborador</CabecalhoTabela>
                  <CabecalhoTabela>Matrícula</CabecalhoTabela>
                  <CabecalhoTabela>Contrato / posto</CabecalhoTabela>
                  <CabecalhoTabela>Protocolo</CabecalhoTabela>
                  <CabecalhoTabela>Uniforme</CabecalhoTabela>
                  <CabecalhoTabela>Tamanho</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Quantidade</CabecalhoTabela>
                </tr>
              </thead>
              <tbody>
                {linhasVisiveis.map((linha) => (
                  <tr
                    key={`${linha.data_fornecimento}-${linha.protocolo}-${linha.tipo_uniforme}-${linha.tamanho ?? "sem-tamanho"}`}
                    className="border-b last:border-0 hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{rotuloDataFornecimento(linha.data_fornecimento)}</td>
                    <td className="px-3 py-2">{linha.colaborador}</td>
                    <td className="px-3 py-2">{linha.matricula ?? "Não informada"}</td>
                    <td className="max-w-72 px-3 py-2">
                      <p className="truncate" title={linha.contrato}>{linha.contrato}</p>
                      <p className="truncate text-slate-500" title={linha.posto}>{linha.posto}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{linha.protocolo}</td>
                    <td className="max-w-80 truncate px-3 py-2" title={linha.tipo_uniforme}>{linha.tipo_uniforme}</td>
                    <td className="px-3 py-2">{linha.tamanho ?? "Não informado"}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatarNumero(linha.quantidade)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!linhas.length && <EstadoVazio texto="Nenhum uniforme foi fornecido a colaborador no período." />}
          </div>
          {linhas.length > linhasVisiveis.length && (
            <p className="mt-3 text-xs text-slate-500">
              Mostrando os {formatarNumero(linhasVisiveis.length)} fornecimentos mais recentes de {formatarNumero(linhas.length)}. A planilha contém o histórico completo do período.
            </p>
          )}
        </>
      )}
    </PainelGrafico>
  );
}

function Carregando() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}

export function RotatividadeEstoque({ empresaId, inicio, fim, contratoId }: Props) {
  const [categoria, setCategoria] = useState<string>("");
  const filtros = useMemo(
    () => ({ inicio, fim, contratoId, categoria }),
    [inicio, fim, contratoId, categoria],
  );
  const consulta = useDashboardRotatividadeEstoque(empresaId, filtros);
  const consultaHistorico = useHistoricoUniformes(empresaId, { inicio, fim, contratoId });
  const consultaFornecimentos = useFornecimentosUniformesColaborador(empresaId, { inicio, fim, contratoId });
  const dados = consulta.data;

  const comparativo = useMemo(() => (dados ? compararGrade(dados.por_tamanho) : []), [dados]);
  const desalinhamento = useMemo(() => maiorDesalinhamento(comparativo), [comparativo]);
  const aviso = useMemo(
    () => (dados ? avisoMovimento(dados.periodo.inicio, dados.movimento_desde) : null),
    [dados],
  );

  // O tamanho sozinho mistura peças diferentes (por exemplo, camisa G e
  // jaqueta G). A série principal vem da mesma RPC dos cards e preserva
  // código + item + tamanho, inclusive quando a categoria está em "Todas".
  const porItemTamanho = useMemo(() => {
    return (dados?.por_item_tamanho ?? [])
      .map((linha) => ({
        itemTamanho: `${linha.item} · ${linha.tamanho ?? "sem tamanho"}`,
        solicitados: linha.pedidas,
        utilizados: linha.saidas,
      }))
      .filter((linha) => linha.solicitados > 0 || linha.utilizados > 0)
      .sort((a, b) => b.solicitados - a.solicitados || b.utilizados - a.utilizados)
      .slice(0, 12);
  }, [dados]);

  const giroPorItemTamanho = useMemo(
    () =>
      dados
        ? [...dados.por_item_tamanho]
            .filter((linha) => linha.giro !== null && linha.saidas > 0)
            .map((linha) => ({
              ...linha,
              itemTamanho: `${linha.item} · ${linha.tamanho ?? "sem tamanho"}`,
            }))
            .sort((a, b) => (b.giro ?? 0) - (a.giro ?? 0) || b.saidas - a.saidas)
            .slice(0, 12)
        : [],
    [dados],
  );

  if (consulta.isLoading) return <Carregando />;

  if (consulta.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Não foi possível carregar a rotatividade</AlertTitle>
        <AlertDescription>
          {(consulta.error as Error).message}. Se as migrations de 13/10/2026 (
          <code className="font-mono text-xs">20261013000010</code> a{" "}
          <code className="font-mono text-xs">20261013000012</code>) ainda não foram aplicadas no
          Supabase, aplique-as antes de abrir esta aba.
        </AlertDescription>
      </Alert>
    );
  }

  if (!dados) return null;

  const r = dados.resumo;
  const cobertura = coberturaDePreco(r);
  const nomeCategoria =
    dados.filtros.categorias.find((c) => c.valor === categoria)?.nome ?? "Todas as categorias";

  return (
    <div className="space-y-3">
      {/* Seletor de categoria — local da aba, ver comentário do componente. */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            Categoria analisada
          </label>
          <Select value={categoria || "todas"} onValueChange={(v) => setCategoria(v === "todas" ? "" : v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="uniforme">Uniformes</SelectItem>
              {dados.filtros.categorias
                .filter((c) => c.valor !== "uniforme")
                .map((c) => (
                  <SelectItem key={c.valor} value={c.valor}>
                    {c.nome}
                  </SelectItem>
                ))}
              <SelectItem value="todas">Todas as categorias</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="max-w-xl text-xs text-slate-500">
          Mostrando <span className="font-semibold text-slate-700">{nomeCategoria}</span> de{" "}
          {new Date(`${dados.periodo.inicio}T12:00:00`).toLocaleDateString("pt-BR")} a{" "}
          {new Date(`${dados.periodo.fim}T12:00:00`).toLocaleDateString("pt-BR")} (
          {formatarNumero(dados.periodo.dias)} dias). Período, empresa e contrato vêm do filtro no
          topo da página.
        </p>
      </div>

      {aviso && (
        <Alert className="border-blue-200 bg-blue-50/70">
          <Info className="h-4 w-4 text-blue-700" />
          <AlertTitle className="text-sm text-blue-900">Duas janelas de tempo diferentes</AlertTitle>
          <AlertDescription className="text-xs text-blue-800">{aviso}</AlertDescription>
        </Alert>
      )}

      {/* Números-herói: produto + tamanho, nunca um tamanho solto. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CartaoDestaque
          titulo="Item/tamanho que mais sai"
          valor={r.item_tamanho_mais_sai ? <span className="text-xl leading-tight">{r.item_tamanho_mais_sai.item} · {r.item_tamanho_mais_sai.tamanho ?? "sem tamanho"}</span> : "—"}
          icone={<Shirt className="h-6 w-6" />}
          detalhe={
            r.item_tamanho_mais_sai
              ? <><span className="font-mono">{r.item_tamanho_mais_sai.codigo ?? "sem código"}</span> · {formatarNumero(r.item_tamanho_mais_sai.unidades)} saídas físicas · {formatarNumero(r.item_tamanho_mais_sai.saldo)} disponíveis</>
              : "sem baixa física no período"
          }
        />
        <CartaoDestaque
          titulo="Item/tamanho que mais entra"
          valor={r.item_tamanho_mais_entra ? <span className="text-xl leading-tight">{r.item_tamanho_mais_entra.item} · {r.item_tamanho_mais_entra.tamanho ?? "sem tamanho"}</span> : "—"}
          tom="green"
          icone={<ArrowDownToLine className="h-6 w-6" />}
          detalhe={
            r.item_tamanho_mais_entra
              ? <><span className="font-mono">{r.item_tamanho_mais_entra.codigo ?? "sem código"}</span> · {formatarNumero(r.item_tamanho_mais_entra.unidades)} unidades recebidas</>
              : "nenhuma entrada registrada"
          }
        />
        <CartaoDestaque
          titulo="Item/tamanho de maior giro"
          valor={r.item_tamanho_maior_giro ? <span className="text-xl leading-tight">{r.item_tamanho_maior_giro.item} · {r.item_tamanho_maior_giro.tamanho ?? "sem tamanho"}</span> : "—"}
          tom="amber"
          icone={<Repeat className="h-6 w-6" />}
          detalhe={
            r.item_tamanho_maior_giro
              ? <><span className="font-mono">{r.item_tamanho_maior_giro.codigo ?? "sem código"}</span> · giro {formatarGiro(r.item_tamanho_maior_giro.giro)} = {formatarNumero(r.item_tamanho_maior_giro.saidas)} saídas ÷ {formatarNumero(r.item_tamanho_maior_giro.saldo)} disponíveis</>
              : "nenhum item/tamanho com volume suficiente"
          }
        />
        <CartaoDestaque
          titulo="Peça que mais sai"
          valor={
            <span className="text-2xl leading-tight">{r.peca_mais_sai?.peca ?? "—"}</span>
          }
          tom="red"
          icone={<Boxes className="h-6 w-6" />}
          detalhe={
            r.peca_mais_sai ? <><span className="font-mono">{r.peca_mais_sai.codigo ?? "sem código"}</span> · {formatarNumero(r.peca_mais_sai.unidades)} saídas físicas</> : "—"
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <CartaoIndicador
          titulo="Unidades pedidas"
          valor={formatarNumero(r.unidades_pedidas)}
          icone={<Shirt className="h-6 w-6" />}
          detalhe={`em ${formatarNumero(r.pedidos)} pedidos · ${formatarNumero(
            r.itens_distintos,
          )} peças distintas`}
        />
        <CartaoIndicador
          titulo="Valor movimentado"
          valor={formatarMoeda(r.valor_pedido)}
          tom="violet"
          icone={<TrendingUp className="h-6 w-6" />}
          detalhe={`estimado · ${formatarPercentual(cobertura)} das unidades têm preço cadastrado`}
        />
        <CartaoIndicador
          titulo="Entradas no estoque"
          valor={formatarNumero(r.entradas)}
          tom="green"
          icone={<ArrowDownToLine className="h-6 w-6" />}
          detalhe={`${formatarNumero(r.devolucoes)} devoluções no período`}
        />
        <CartaoIndicador
          titulo="Saídas do estoque"
          valor={formatarNumero(r.saidas)}
          tom="red"
          icone={<ArrowUpFromLine className="h-6 w-6" />}
          detalhe="baixas e remoções confirmadas no almoxarifado"
        />
        <CartaoIndicador
          titulo="Giro do estoque"
          valor={formatarGiro(r.giro)}
          tom="amber"
          icone={<Repeat className="h-6 w-6" />}
          detalhe="saídas ÷ saldo atual, no período"
        />
        <CartaoIndicador
          titulo="Disponível hoje"
          valor={formatarNumero(r.saldo_disponivel)}
          icone={<Boxes className="h-6 w-6" />}
          detalhe={
            `${formatarNumero(r.saldo_fisico)} físicas − ${formatarNumero(r.reservado)} reservadas · ${nomeCategoria}`
          }
        />
      </div>

      <BlocoAlertas dados={dados} />

      <div className="grid gap-3 xl:grid-cols-2">
        {/* MAGNITUDE: hue única, a barra já codifica o valor. */}
        <PainelGrafico
          titulo="Itens e Tamanhos Mais Pedidos"
          subtitulo="Cada barra identifica a peça e o tamanho; não mistura, por exemplo, camisa G com jaqueta G."
        >
          {porItemTamanho.length ? (
            <div style={{ height: Math.max(360, porItemTamanho.length * 42) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porItemTamanho} layout="vertical" margin={{ left: 8, right: 44, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CINZA_GRADE} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} />
                  <YAxis
                    type="category"
                    dataKey="itemTamanho"
                    width={230}
                    tick={<TickCategoriaQuebrado maximoLinha={36} tamanhoFonte={9} />}
                  />
                  <Tooltip content={<TooltipPadrao sufixo=" un." />} cursor={{ fill: "#f1f5f9" }} />
                  <Bar
                    dataKey="solicitados"
                    name="Unidades pedidas"
                    fill={AZUL_MAGNITUDE}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={22}
                  >
                    <LabelList
                      dataKey="solicitados"
                      position="right"
                      className="text-[10px]"
                      fill="#475569"
                      formatter={(v: number) => formatarNumero(v)}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio texto="Nenhum item/tamanho solicitado no período." altura={320} />
          )}
        </PainelGrafico>

        {/* DUAS SÉRIES na mesma unidade (unidades) — um eixo só. */}
        <PainelGrafico
          titulo="Solicitado x Baixa Física por Item e Tamanho"
          subtitulo="Pedido é demanda; utilizado só conta quando há baixa física confirmada no almoxarifado."
        >
          {porItemTamanho.length ? (
            <div style={{ height: Math.max(360, porItemTamanho.length * 42) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porItemTamanho} layout="vertical" margin={{ left: 8, right: 24, top: 4 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CINZA_GRADE} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} />
                  <YAxis
                    type="category"
                    dataKey="itemTamanho"
                    width={230}
                    tick={<TickCategoriaQuebrado maximoLinha={36} tamanhoFonte={9} />}
                  />
                  <Tooltip content={<TooltipPadrao sufixo=" un." />} cursor={{ fill: "#f1f5f9" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="solicitados"
                    name="Solicitados"
                    fill={SERIES.pedido}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                  <Bar
                    dataKey="utilizados"
                    name="Baixas físicas"
                    fill={SERIES.saida}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio
              texto="Nenhuma solicitação ou baixa física no período."
              altura={320}
            />
          )}
        </PainelGrafico>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {/* Giro é razão, não unidade: gráfico próprio, nunca segundo eixo do
            gráfico de volume. */}
        <PainelGrafico
          titulo="Giro por Item e Tamanho"
          subtitulo="Giro = saídas físicas ÷ disponível atual. O código, item e tamanho permanecem juntos."
        >
          {giroPorItemTamanho.length ? (
            <div style={{ height: Math.max(320, giroPorItemTamanho.length * 42) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={giroPorItemTamanho} layout="vertical" margin={{ left: 8, right: 48, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CINZA_GRADE} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#64748b" }} />
                  <YAxis
                    type="category"
                    dataKey="itemTamanho"
                    width={230}
                    tick={<TickCategoriaQuebrado maximoLinha={36} tamanhoFonte={9} />}
                  />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
                          <p className="mb-1 font-semibold text-slate-700">{label}</p>
                          <p className="font-mono text-slate-500">{payload[0].payload.codigo ?? "sem código"}</p>
                          <p className="text-slate-600">
                            Giro: {formatarGiro(payload[0].payload.giro)}
                          </p>
                          <p className="text-slate-600">
                            {formatarNumero(payload[0].payload.saidas)} saíram ·{" "}
                            {formatarNumero(payload[0].payload.saldo_disponivel)} em estoque
                          </p>
                        </div>
                      ) : null
                    }
                    cursor={{ fill: "#f1f5f9" }}
                  />
                  <Bar dataKey="giro" name="Giro" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {giroPorItemTamanho.map((linha) => (
                      // Cor por ESTADO (parado/lento/saudável/acelerado), com o
                      // rótulo do estado na tabela abaixo — nunca cor sozinha.
                      <Cell
                        key={`${linha.codigo ?? linha.item}-${linha.tamanho ?? "sem-tamanho"}`}
                        fill={
                          (linha.giro ?? 0) >= 1
                            ? SERIES.pedido
                            : (linha.giro ?? 0) >= 0.25
                              ? SERIES.entrada
                              : SERIES.declarado
                        }
                      />
                    ))}
                    <LabelList
                      dataKey="giro"
                      position="right"
                      className="text-[10px]"
                      fill="#475569"
                      formatter={(v: number) => formatarGiro(v)}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio texto="Sem saídas no período para calcular giro." altura={300} />
          )}
        </PainelGrafico>

        {/* Dois percentuais — mesma unidade, um eixo. */}
        <PainelGrafico
          titulo="Grade Declarada x Saída Real"
          subtitulo={`Levantamento de ${formatarNumero(
            dados.levantamento_resumo.pessoas,
          )} colaboradores comparado com o que saiu. Em % para as duas escalas se compararem.`}
          acao={
            desalinhamento ? (
              <Badge
                className={cn(
                  "border-0 text-[10px]",
                  Math.abs(desalinhamento.gap) >= 5
                    ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-100 text-emerald-700",
                )}
              >
                Maior desvio: {desalinhamento.tamanho} {formatarGap(desalinhamento.gap)}
              </Badge>
            ) : null
          }
        >
          {comparativo.length ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparativo} margin={{ top: 4 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CINZA_GRADE} />
                  <XAxis
                    dataKey="tamanho"
                    tick={{ fontSize: 11, fontWeight: 600, fill: "#334155" }}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip content={<TooltipPercentual />} cursor={{ fill: "#f1f5f9" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="pct_declarado"
                    name="Declarado pela equipe"
                    fill={SERIES.declarado}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                  <Bar
                    dataKey="pct_saida"
                    name="Saída real"
                    fill={SERIES.pedido}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio
              texto="Sem grade declarada para esta categoria. O levantamento cobre peças de vestuário."
              altura={300}
            />
          )}
        </PainelGrafico>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        {/* Unidades e reais não dividem eixo: duas séries de unidade aqui, o
            valor fica no gráfico ao lado. */}
        <PainelGrafico
          titulo="Movimentação Mês a Mês"
          subtitulo="Unidades pedidas acompanhadas de entrada e saída física."
        >
          {dados.evolucao.length ? (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dados.evolucao} margin={{ top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CINZA_GRADE} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: "#64748b" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} />
                  <Tooltip content={<TooltipPadrao sufixo=" un." />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="pedidas"
                    name="Pedidas"
                    stroke={SERIES.pedido}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="entradas"
                    name="Entradas"
                    stroke={SERIES.entrada}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="saidas"
                    name="Saídas"
                    stroke={SERIES.saida}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio texto="Sem movimentação no período." altura={280} />
          )}
        </PainelGrafico>

        <PainelGrafico titulo="Valor Pedido por Mês" subtitulo="Estimado pelo preço de estoque.">
          {dados.evolucao.length ? (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dados.evolucao} margin={{ top: 4 }}>
                  <defs>
                    <linearGradient id="rotatividadeValor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SERIES.pedido} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={SERIES.pedido} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CINZA_GRADE} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: "#64748b" }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    tickFormatter={formatarEixoMoeda}
                  />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
                          <p className="mb-1 font-semibold text-slate-700">{label}</p>
                          <p className="text-slate-600">
                            Valor pedido: {formatarMoeda(payload[0].value as number)}
                          </p>
                        </div>
                      ) : null
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="valor"
                    name="Valor pedido"
                    stroke={SERIES.pedido}
                    strokeWidth={2}
                    fill="url(#rotatividadeValor)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio texto="Sem valor no período." altura={280} />
          )}
        </PainelGrafico>
      </div>

      <PainelGrafico
        titulo="Rotatividade por Contrato"
        subtitulo="Unidades pedidas por contrato, com o tamanho dominante de cada um."
      >
        {dados.por_contrato.length ? (
          <div className="overflow-x-auto">
            <div className="h-[340px] min-w-[560px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={dados.por_contrato.slice(0, 12)}
                  layout="vertical"
                  margin={{ left: 8, right: 56, top: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CINZA_GRADE} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} />
                  <YAxis
                    type="category"
                    dataKey="contrato"
                    width={210}
                    interval={0}
                    tick={<TickCategoria maximo={32} />}
                  />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
                          <p className="mb-1 max-w-64 font-semibold text-slate-700">{label}</p>
                          <p className="text-slate-600">
                            {formatarNumero(payload[0].payload.unidades)} unidades em{" "}
                            {formatarNumero(payload[0].payload.pedidos)} pedidos
                          </p>
                          <p className="text-slate-600">
                            {formatarMoeda(payload[0].payload.valor)}
                          </p>
                          {payload[0].payload.tamanho_top && (
                            <p className="text-slate-600">
                              Tamanho dominante: {payload[0].payload.tamanho_top}
                            </p>
                          )}
                        </div>
                      ) : null
                    }
                    cursor={{ fill: "#f1f5f9" }}
                  />
                  <Bar
                    dataKey="unidades"
                    name="Unidades pedidas"
                    fill={AZUL_MAGNITUDE}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={20}
                  >
                    <LabelList
                      dataKey="tamanho_top"
                      position="right"
                      className="text-[10px]"
                      fill="#475569"
                      formatter={(v: string) => (v ? `top ${v}` : "")}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <EstadoVazio texto="Nenhum contrato com pedidos no período." altura={340} />
        )}
      </PainelGrafico>

      <TabelaPorItemTamanho dados={dados} />
      <TabelaPorPeca dados={dados} />
      {(categoria === "" || categoria === "uniforme") && (
        <>
          <TabelaHistoricoUniformes
            linhas={consultaHistorico.data ?? []}
            carregando={consultaHistorico.isLoading}
            erro={consultaHistorico.error as Error | null}
            inicio={inicio}
            fim={fim}
          />
          <TabelaFornecimentosPorColaborador
            linhas={consultaFornecimentos.data ?? []}
            carregando={consultaFornecimentos.isLoading}
            erro={consultaFornecimentos.error as Error | null}
            inicio={inicio}
            fim={fim}
          />
        </>
      )}

      <p className="px-1 pb-2 text-xs text-slate-500">
        Grade declarada: {formatarNumero(dados.levantamento_resumo.respostas)} respostas de{" "}
        {formatarNumero(dados.levantamento_resumo.pessoas)} colaboradores em{" "}
        {formatarNumero(dados.levantamento_resumo.contratos)} contratos
        {dados.levantamento_resumo.sem_contrato > 0 &&
          `, ${formatarNumero(dados.levantamento_resumo.sem_contrato)} sem contrato identificado`}
        {dados.levantamento_resumo.ultima_resposta &&
          ` · última resposta em ${new Date(
            `${dados.levantamento_resumo.ultima_resposta}T12:00:00`,
          ).toLocaleDateString("pt-BR")}`}
        . Quem respondeu mais de uma vez conta uma vez, pela resposta mais recente.
      </p>
    </div>
  );
}
