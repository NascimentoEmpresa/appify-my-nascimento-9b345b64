import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  Download,
  Info,
  Loader2,
  PackageX,
  Send,
  ShoppingCart,
  Sparkles,
  Timer,
  TrendingDown,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip as Dica, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { AcessoGate } from "@/components/auth/AcessoGate";
import {
  AZUL_MAGNITUDE,
  CINZA_GRADE,
  CabecalhoTabela,
  CartaoDestaque,
  CartaoIndicador,
  EstadoVazio,
  PainelGrafico,
  SERIES,
  TickCategoria,
  formatarEixoMoeda,
} from "@/components/suprimentos/dashboard/PainelBase";
import {
  useAnaliseEstoqueIA,
  useEstoqueSaudavel,
  useFecharMesEstoque,
  useSalvarPoliticaEstoque,
  useSalvarPremissasEstoque,
  type LinhaPolitica,
  type MsgIaEstoque,
} from "@/hooks/useEstoqueSaudavel";
import { formatarMoeda, formatarNumero } from "@/lib/suprimentos/dashboardComprasEstoque";
import {
  chegaAtrasado,
  classeSituacao,
  coberturaComTransito,
  coberturaDeValor,
  csvDaCompra,
  explicarAlvo,
  explicarCompra,
  formatarDias,
  formatarMeses,
  formatarMoedaCurta,
  motivosDeDesconfianca,
  pesoSituacao,
  recadoDoPainel,
  rotuloClasse,
  rotuloSituacao,
  type EstoqueSaudavelDados,
  type FiltroEstoqueSaudavel,
  type ItemEstoqueSaudavel,
  type SituacaoEstoque,
} from "@/lib/suprimentos/estoqueSaudavel";
import { cn } from "@/lib/utils";

/**
 * Aba "Estoque Saudável" do dashboard de Suprimentos.
 *
 * Responde, nesta ordem, o que o gerente de Supply pediu por áudio
 * (19/10/2026, sem chamado):
 *   1. quanto risco existe de deixar colaborador parado sem uniforme;
 *   2. quanto dinheiro está parado, separando o que sobra do que não gira;
 *   3. quanto comprar de cada coisa para manter o estoque saudável, somado
 *      por família — que é o volume que dá poder de barganha no fornecedor;
 *   4. o que eliminar do estoque e vender;
 *   5. como isso se move mês a mês, para o alvo CAIR quando o quadro cai.
 *
 * A CONTA NÃO É DA IA. Alvo, ponto de pedido e compra sugerida vêm da RPC
 * `sup_estoque_saudavel`, por fórmula de reposição, no banco. A IA (painel
 * roxo) lê esses números e escreve a leitura. Cada linha da tabela tem o
 * botão de explicação justamente para esse número ser defensável numa
 * negociação — foi o que o gerente chamou de "previsibilidade".
 *
 * Empresa vem do filtro da página. CATEGORIA, JANELA e ALMOXARIFADO são
 * locais: a aba abre em Uniformes porque é onde está o problema das pessoas
 * sem fardamento, enquanto o filtro global da página segue como está, para
 * não mexer no que as outras abas mostram.
 */

const SITUACOES_FILTRO: { valor: string; nome: string }[] = [
  { valor: "problema", nome: "Só o que precisa de ação" },
  { valor: "todas", nome: "Todas as situações" },
  { valor: "falta", nome: "Faltando agora" },
  { valor: "repor", nome: "Vai faltar" },
  { valor: "excesso", nome: "Sobrando" },
  { valor: "morto", nome: "Sem giro" },
  { valor: "saudavel", nome: "Saudável" },
  { valor: "fora_do_plano", nome: "Fora do plano" },
];

const SITUACOES_DE_ACAO: SituacaoEstoque[] = ["falta", "repor", "morto", "liquidar", "excesso"];

/** Cor de ESTADO no gráfico de distribuição — casa com os badges da tabela. */
const COR_SITUACAO: Record<string, string> = {
  falta: "#e11d48",
  repor: "#f59e0b",
  saudavel: "#10b981",
  excesso: "#0969da",
  morto: "#94a3b8",
  liquidar: "#8b5cf6",
};

export function EstoqueSaudavel({
  empresaId,
  contratoId,
}: {
  empresaId: string | null;
  contratoId: string | null;
}) {
  const [filtros, setFiltros] = useState<Omit<FiltroEstoqueSaudavel, "contratoId">>({
    janelaMeses: null,
    categoria: "uniforme",
    almoxarifadoId: null,
  });
  const [situacao, setSituacao] = useState("problema");
  const [busca, setBusca] = useState("");
  const [premissasAbertas, setPremissasAbertas] = useState(false);

  const filtroCompleto: FiltroEstoqueSaudavel = { ...filtros, contratoId };
  const { data: dados, isLoading, isFetching, error } = useEstoqueSaudavel(empresaId, filtroCompleto);

  const trocar = <K extends keyof typeof filtros>(campo: K, valor: (typeof filtros)[K]) =>
    setFiltros((atual) => ({ ...atual, [campo]: valor }));

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[132px]" />
          ))}
        </div>
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (error || !dados) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Não foi possível montar o planejamento</AlertTitle>
        <AlertDescription>
          {(error as Error)?.message ?? "Tente de novo em alguns instantes."}
        </AlertDescription>
      </Alert>
    );
  }

  const r = dados.resumo;
  const p = dados.premissas;

  return (
    <div className="space-y-3">
      <FiltrosLocais
        dados={dados}
        filtros={filtros}
        trocar={trocar}
        carregando={isFetching}
        empresaId={empresaId}
        onAbrirPremissas={() => setPremissasAbertas(true)}
      />

      {/* ---- Os quatro números que decidem a semana ---- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CartaoDestaque
          titulo="Risco de parar gente"
          valor={formatarNumero(r.itens_em_falta)}
          icone={<PackageX className="h-7 w-7" />}
          tom={r.itens_em_falta > 0 ? "red" : "green"}
          detalhe={
            r.itens_em_falta > 0
              ? `tamanhos sem nenhuma peça em casa · ${formatarNumero(r.itens_a_repor)} abaixo do ponto de pedido`
              : `nada em falta · ${formatarNumero(r.itens_a_repor)} abaixo do ponto de pedido`
          }
        />
        <CartaoDestaque
          titulo="Dinheiro parado"
          valor={formatarMoedaCurta(r.dinheiro_parado + r.valor_morto)}
          icone={<Banknote className="h-7 w-7" />}
          tom="amber"
          detalhe={`${formatarMoedaCurta(r.dinheiro_parado)} sobrando em item que gira · ${formatarMoedaCurta(r.valor_morto)} sem giro`}
        />
        <CartaoDestaque
          titulo="Comprar para ficar saudável"
          valor={formatarMoedaCurta(r.valor_a_comprar)}
          icone={<ShoppingCart className="h-7 w-7" />}
          tom="blue"
          detalhe={`${formatarNumero(r.unidades_a_comprar)} peças · ${formatarNumero(dados.compra_por_familia.length)} famílias para cotar`}
        />
        <CartaoDestaque
          titulo="Cobertura do estoque"
          valor={formatarDias(r.cobertura_media_dias)}
          icone={<Timer className="h-7 w-7" />}
          tom={
            r.cobertura_media_dias !== null && r.cobertura_media_dias < p.lead_time_dias
              ? "red"
              : "green"
          }
          detalhe={`no consumo de ${formatarNumero(r.demanda_mensal_total, 1)} peças/mês · reposição leva ${p.lead_time_dias} dias`}
        />
      </div>

      <p className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-sm font-semibold text-blue-950">
        {recadoDoPainel(dados)}
      </p>

      <FaixaPremissas dados={dados} onEditar={() => setPremissasAbertas(true)} />

      {dados.alertas.length > 0 && <Alertas alertas={dados.alertas} />}

      <PainelIaEstoque empresaId={empresaId} filtros={filtroCompleto} dados={dados} />

      {/* ---- Gráficos ---- */}
      <div className="grid gap-3 xl:grid-cols-[1.25fr_0.75fr]">
        <PainelGrafico
          titulo="Mês a mês: o que temos, o que consumimos e qual era o alvo"
          subtitulo={
            dados.evolucao.length
              ? "Cada ponto é um fechamento de mês. O alvo cai sozinho quando o quadro do contrato diminui."
              : "Começa no primeiro fechamento mensal."
          }
        >
          {dados.evolucao.length ? (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dados.evolucao}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CINZA_GRADE} />
                  <XAxis dataKey="rotulo" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="saldo"
                    name="Em estoque"
                    stroke={AZUL_MAGNITUDE}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="alvo"
                    name="Alvo saudável"
                    stroke={SERIES.declarado}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="demanda"
                    name="Consumo do mês"
                    stroke={SERIES.saida}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio
              altura={280}
              texto="Ainda não há fechamento mensal gravado. Use “Fechar mês” para começar o histórico."
            />
          )}
        </PainelGrafico>

        <PainelGrafico
          titulo="Situação dos itens"
          subtitulo={`${formatarNumero(r.itens_planejados)} combinações de item e tamanho no plano`}
        >
          <GraficoSituacao dados={dados} />
        </PainelGrafico>
      </div>

      <PainelGrafico
        titulo="Compra sugerida por família — o volume que dá poder de negociação"
        subtitulo="O fornecedor não negocia 14 calças M, negocia a família inteira. Passe o mouse para ver a grade por tamanho."
      >
        {dados.compra_por_familia.length ? (
          <GraficoFamilias familias={dados.compra_por_familia} />
        ) : (
          <EstadoVazio altura={260} texto="Nada a comprar: todos os itens estão no alvo." />
        )}
      </PainelGrafico>

      <TabelaItens
        dados={dados}
        empresaId={empresaId}
        situacao={situacao}
        setSituacao={setSituacao}
        busca={busca}
        setBusca={setBusca}
      />

      {dados.liquidar.length > 0 && <BlocoLiquidar dados={dados} empresaId={empresaId} />}

      <p className="text-right text-[11px] text-slate-400">
        Atualizado em{" "}
        {new Date(dados.atualizado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
      </p>

      <DialogPremissas
        aberto={premissasAbertas}
        fechar={() => setPremissasAbertas(false)}
        dados={dados}
        empresaId={empresaId}
      />
    </div>
  );
}

/* ================================================================== */
/* Filtros                                                            */
/* ================================================================== */

function FiltrosLocais({
  dados,
  filtros,
  trocar,
  carregando,
  empresaId,
  onAbrirPremissas,
}: {
  dados: EstoqueSaudavelDados;
  filtros: Omit<FiltroEstoqueSaudavel, "contratoId">;
  trocar: <K extends keyof Omit<FiltroEstoqueSaudavel, "contratoId">>(
    campo: K,
    valor: Omit<FiltroEstoqueSaudavel, "contratoId">[K],
  ) => void;
  carregando: boolean;
  empresaId: string | null;
  onAbrirPremissas: () => void;
}) {
  const fecharMes = useFecharMesEstoque(empresaId);

  const baixarCsv = () => {
    const csv = csvDaCompra(dados.itens);
    // BOM: sem ele o Excel em português lê o arquivo como Latin-1 e "Calça"
    // vira "Calï¿½a" na primeira coluna.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compra-sugerida-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3 shadow-sm">
      <div className="min-w-[150px]">
        <Label className="mb-1 block text-xs font-semibold text-slate-700">Categoria</Label>
        <Select
          value={filtros.categoria ?? "todas"}
          onValueChange={(v) => trocar("categoria", v === "todas" ? null : v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            {dados.filtros.categorias.map((c) => (
              <SelectItem key={c.valor} value={c.valor}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-[170px]">
        <Label className="mb-1 block text-xs font-semibold text-slate-700">Histórico usado</Label>
        <Select
          value={String(filtros.janelaMeses ?? dados.premissas.janela_meses)}
          onValueChange={(v) => trocar("janelaMeses", Number(v))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[3, 4, 6, 9, 12, 18, 24].map((m) => (
              <SelectItem key={m} value={String(m)}>
                Últimos {m} meses
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-[170px]">
        <Label className="mb-1 block text-xs font-semibold text-slate-700">Almoxarifado</Label>
        <Select
          value={filtros.almoxarifadoId ?? "todos"}
          onValueChange={(v) => trocar("almoxarifadoId", v === "todos" ? null : v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {dados.filtros.almoxarifados.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {carregando && (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> recalculando
          </span>
        )}
        {/* O CSV é a lista que vai para a cotação — sai da empresa. Por isso
            tem grant próprio ('exportar') em vez de seguir quem só vê a aba. */}
        <AcessoGate menu="sup_estoque_saudavel" acao="exportar">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={baixarCsv}>
            <Download className="h-4 w-4" /> Compra em CSV
          </Button>
        </AcessoGate>
        <AcessoGate menu="sup_estoque_saudavel" acao="alterar">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onAbrirPremissas}>
            <Info className="h-4 w-4" /> Premissas
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={fecharMes.isPending}
            onClick={() =>
              fecharMes
                .mutateAsync(null)
                .then((res) =>
                  toast.success(
                    `Mês ${new Date(`${res.competencia}T12:00:00`).toLocaleDateString("pt-BR", {
                      month: "long",
                      year: "numeric",
                    })} fechado: ${formatarNumero(res.linhas)} itens gravados.`,
                  ),
                )
                .catch((e) => toast.error((e as Error).message))
            }
          >
            {fecharMes.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CalendarClock className="h-4 w-4" />
            )}
            Fechar mês
          </Button>
        </AcessoGate>
      </div>
    </div>
  );
}

/**
 * A faixa que mostra a conta por extenso.
 *
 * Não é decoração: sem ela, "alvo 35" é um número que apareceu na tela. Com
 * ela, é "consumo de 30 dias + 10 de reposição, com 95% de garantia" — e o
 * gerente pode discutir a premissa em vez de desconfiar do resultado.
 */
function FaixaPremissas({
  dados,
  onEditar,
}: {
  dados: EstoqueSaudavelDados;
  onEditar: () => void;
}) {
  const p = dados.premissas;
  const inicio = new Date(`${p.janela_inicio}T12:00:00`).toLocaleDateString("pt-BR");
  const cobertura = coberturaDeValor(dados.resumo);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <span className="font-semibold text-slate-700">Como o alvo é calculado:</span>
      <span>
        consumo desde <b>{inicio}</b> ({p.janela_meses} meses)
      </span>
      <span>
        · reposição em <b>{p.lead_time_dias} dias</b>
      </span>
      <span>
        · compra revista a cada <b>{p.ciclo_revisao_dias} dias</b>
      </span>
      <span>
        · garantia de <b>{Math.round(p.nivel_servico * 100)}%</b> de não faltar
      </span>
      <span>
        · sem giro há <b>{p.meses_sem_giro_morto} meses</b> = candidato a liquidação
      </span>
      {cobertura < 100 && (
        <span className="font-semibold text-amber-700">
          · valores cobrem {formatarNumero(cobertura, 1)}% dos itens (o resto está sem preço cadastrado)
        </span>
      )}
      <AcessoGate menu="sup_estoque_saudavel" acao="alterar">
        <button type="button" onClick={onEditar} className="font-semibold text-blue-700 underline">
          mudar premissas
        </button>
      </AcessoGate>
    </div>
  );
}

function Alertas({ alertas }: { alertas: EstoqueSaudavelDados["alertas"] }) {
  const grave = (tipo: string) => tipo === "falta_agora";
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {alertas.map((a) => (
        <Alert
          key={a.tipo}
          className={cn(
            "py-2",
            grave(a.tipo) ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50",
          )}
        >
          <AlertTriangle
            className={cn("h-4 w-4", grave(a.tipo) ? "text-rose-600" : "text-amber-600")}
          />
          <AlertTitle className="text-sm">
            {a.titulo}
            {a.valor > 0 && (
              <Badge variant="outline" className="ml-2 bg-white">
                {formatarNumero(a.valor)}
              </Badge>
            )}
          </AlertTitle>
          {a.detalhe && (
            <AlertDescription className="text-xs text-slate-600">{a.detalhe}</AlertDescription>
          )}
        </Alert>
      ))}
    </div>
  );
}

/* ================================================================== */
/* Gráficos                                                           */
/* ================================================================== */

function GraficoSituacao({ dados }: { dados: EstoqueSaudavelDados }) {
  const r = dados.resumo;
  const linhas = [
    { nome: "Faltando", chave: "falta", itens: r.itens_em_falta },
    { nome: "Vai faltar", chave: "repor", itens: r.itens_a_repor },
    { nome: "Saudável", chave: "saudavel", itens: r.itens_saudaveis },
    { nome: "Sobrando", chave: "excesso", itens: r.itens_em_excesso },
    { nome: "Sem giro", chave: "morto", itens: r.itens_mortos },
  ].filter((l) => l.itens > 0);

  if (!linhas.length) return <EstadoVazio altura={280} texto="Sem itens no plano." />;

  return (
    <div className="h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={linhas} layout="vertical" margin={{ left: 8, right: 36 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CINZA_GRADE} horizontal={false} />
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="nome" width={86} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v: number) => [`${formatarNumero(v)} itens`, "Quantidade"]} />
          <Bar dataKey="itens" name="Itens" radius={[0, 4, 4, 0]}>
            {linhas.map((l) => (
              <Cell key={l.chave} fill={COR_SITUACAO[l.chave] ?? AZUL_MAGNITUDE} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function GraficoFamilias({ familias }: { familias: EstoqueSaudavelDados["compra_por_familia"] }) {
  const dados = familias.slice(0, 10);
  return (
    <div className="space-y-3">
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CINZA_GRADE} />
            <XAxis dataKey="item" interval={0} height={92} tick={<TickCategoria maximo={18} />} />
            <YAxis tickFormatter={formatarEixoMoeda} />
            <Tooltip
              formatter={(valor: number, nome: string) =>
                nome === "Valor da compra"
                  ? [formatarMoeda(valor), nome]
                  : [`${formatarNumero(valor)} peças`, nome]
              }
            />
            <Legend />
            <Bar
              dataKey="valor_comprar"
              name="Valor da compra"
              fill={AZUL_MAGNITUDE}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* A grade por tamanho é o que de fato vai no pedido para a confecção. */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <CabecalhoTabela>Família</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Comprar</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Valor</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Consumo/mês</CabecalhoTabela>
              <CabecalhoTabela>Grade por tamanho</CabecalhoTabela>
            </tr>
          </thead>
          <tbody>
            {dados.map((f) => (
              <tr key={f.base_id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="px-3 py-1.5 font-semibold text-slate-800">
                  {f.item}
                  {f.tamanhos_em_falta > 0 && (
                    <Badge className="ml-2 bg-rose-100 text-rose-700 hover:bg-rose-100">
                      {f.tamanhos_em_falta} em falta
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right font-bold">{formatarNumero(f.comprar)}</td>
                <td className="px-3 py-1.5 text-right">{formatarMoeda(f.valor_comprar)}</td>
                <td className="px-3 py-1.5 text-right text-slate-500">
                  {formatarNumero(f.demanda_mensal, 1)}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {f.grade.map((g) => (
                      <span
                        key={`${f.base_id}-${g.tamanho}`}
                        className="rounded border bg-slate-50 px-1.5 py-0.5 text-[11px]"
                      >
                        <b>{g.tamanho ?? "único"}</b> {formatarNumero(g.comprar)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Tabela principal                                                   */
/* ================================================================== */

function TabelaItens({
  dados,
  empresaId,
  situacao,
  setSituacao,
  busca,
  setBusca,
}: {
  dados: EstoqueSaudavelDados;
  empresaId: string | null;
  situacao: string;
  setSituacao: (v: string) => void;
  busca: string;
  setBusca: (v: string) => void;
}) {
  const salvar = useSalvarPoliticaEstoque(empresaId);
  const [editando, setEditando] = useState<ItemEstoqueSaudavel | null>(null);

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return dados.itens
      .filter((i) => {
        if (situacao === "problema") return SITUACOES_DE_ACAO.includes(i.situacao);
        if (situacao !== "todas" && i.situacao !== situacao) return false;
        return true;
      })
      .filter((i) => !termo || `${i.item} ${i.tamanho ?? ""}`.toLowerCase().includes(termo))
      .sort(
        (a, b) =>
          pesoSituacao(a.situacao) - pesoSituacao(b.situacao) ||
          b.valor_comprar - a.valor_comprar ||
          b.valor_em_estoque - a.valor_em_estoque ||
          a.item.localeCompare(b.item, "pt-BR") ||
          a.ordem - b.ordem,
      );
  }, [dados.itens, situacao, busca]);

  return (
    <PainelGrafico
      titulo="Item por item: quanto ter, quanto tem e quanto comprar"
      subtitulo={`${formatarNumero(linhas.length)} de ${formatarNumero(dados.itens.length)} combinações · clique na lupa de uma linha para ver a conta por extenso`}
      acao={
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar item ou tamanho"
            className="h-9 w-[200px]"
          />
          <Select value={situacao} onValueChange={setSituacao}>
            <SelectTrigger className="h-9 w-[210px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SITUACOES_FILTRO.map((s) => (
                <SelectItem key={s.valor} value={s.valor}>
                  {s.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {!linhas.length ? (
        <EstadoVazio texto="Nenhum item nesta situação." />
      ) : (
        <TooltipProvider delayDuration={200}>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  <CabecalhoTabela>Item</CabecalhoTabela>
                  <CabecalhoTabela>Tam.</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Em casa</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Vindo</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Consumo/mês</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Cobertura</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Pedir em</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Alvo saudável</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Comprar</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Parado R$</CabecalhoTabela>
                  <CabecalhoTabela alinhar="center">Classe</CabecalhoTabela>
                  <CabecalhoTabela>Situação</CabecalhoTabela>
                  <CabecalhoTabela alinhar="center">Conta</CabecalhoTabela>
                </tr>
              </thead>
              <tbody>
                {linhas.map((i) => (
                  <LinhaItem
                    key={`${i.base_id}-${i.tamanho ?? "sem"}`}
                    item={i}
                    premissas={dados.premissas}
                    podeEditar={dados.pode_editar}
                    onEditar={() => setEditando(i)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      )}

      <DialogAprovarAlvo
        item={editando}
        premissas={dados.premissas}
        fechar={() => setEditando(null)}
        salvar={async (linha, aplicarMinimo) => {
          try {
            const res = await salvar.mutateAsync({
              linhas: [linha],
              aplicarMinimoNoEstoque: aplicarMinimo,
            });
            toast.success(
              aplicarMinimo && res.minimos_aplicados > 0
                ? "Alvo aprovado e mínimo levado para o estoque."
                : "Alvo aprovado.",
            );
            setEditando(null);
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
        salvando={salvar.isPending}
      />
    </PainelGrafico>
  );
}

function LinhaItem({
  item,
  premissas,
  podeEditar,
  onEditar,
}: {
  item: ItemEstoqueSaudavel;
  premissas: EstoqueSaudavelDados["premissas"];
  podeEditar: boolean;
  onEditar: () => void;
}) {
  const desconfianca = motivosDeDesconfianca(item);
  const atrasado = chegaAtrasado(item);

  return (
    <tr className="border-b last:border-0 align-middle hover:bg-slate-50">
      <td className="max-w-[240px] truncate px-3 py-1.5 font-semibold text-slate-800" title={item.item}>
        {item.item}
      </td>
      <td className="px-3 py-1.5 font-mono text-[11px]">{item.tamanho ?? "único"}</td>
      <td className="px-3 py-1.5 text-right">{formatarNumero(item.disponivel)}</td>
      <td className="px-3 py-1.5 text-right text-slate-500">
        {item.em_transito > 0 ? formatarNumero(item.em_transito) : "—"}
      </td>
      <td className="px-3 py-1.5 text-right">{formatarNumero(item.demanda_mensal, 1)}</td>
      <td className="px-3 py-1.5 text-right">
        <span className={cn(atrasado && "font-bold text-rose-700")}>
          {formatarDias(item.cobertura_dias)}
        </span>
        {atrasado && (
          <Dica>
            <TooltipTrigger asChild>
              <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-rose-600" />
            </TooltipTrigger>
            <TooltipContent className="max-w-[280px] text-xs">
              Mesmo contando as {formatarNumero(item.em_transito)} peças em trânsito, a cobertura (
              {formatarDias(coberturaComTransito(item))}) é menor que os {item.lead_time_dias} dias de
              reposição. Pedir hoje já chega atrasado.
            </TooltipContent>
          </Dica>
        )}
      </td>
      <td className="px-3 py-1.5 text-right text-slate-500">{formatarNumero(item.minimo)}</td>
      <td className="px-3 py-1.5 text-right font-bold text-blue-900">
        {formatarNumero(item.alvo)}
        {item.alvo_aprovado !== null && (
          <Dica>
            <TooltipTrigger asChild>
              <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-emerald-600" />
            </TooltipTrigger>
            <TooltipContent className="max-w-[280px] text-xs">
              Alvo aprovado por {item.aprovado_por ?? "alguém"}. A conta sugeria{" "}
              {formatarNumero(item.alvo_calculado)}.
            </TooltipContent>
          </Dica>
        )}
      </td>
      <td className="px-3 py-1.5 text-right font-bold">
        {item.comprar > 0 ? formatarNumero(item.comprar) : "—"}
      </td>
      <td className="px-3 py-1.5 text-right">
        {item.valor_excesso > 0 ? (
          <span className="text-amber-700">{formatarMoeda(item.valor_excesso)}</span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-1.5 text-center font-mono text-[11px] text-slate-500">
        {rotuloClasse(item)}
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1">
          <Badge className={cn("hover:bg-inherit", classeSituacao(item.situacao))}>
            {rotuloSituacao(item.situacao)}
          </Badge>
          {desconfianca.length > 0 && (
            <Dica>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 shrink-0 text-amber-600" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[300px] text-xs">
                <ul className="list-disc pl-4">
                  {desconfianca.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </TooltipContent>
            </Dica>
          )}
        </div>
      </td>
      <td className="px-3 py-1.5 text-center">
        <Dica>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={podeEditar ? onEditar : undefined}
              className={cn(
                "rounded p-1 text-slate-500 hover:bg-slate-100",
                !podeEditar && "cursor-default",
              )}
              aria-label="Ver a conta deste item"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[340px] space-y-1 text-xs">
            <p>{explicarAlvo(item, premissas)}</p>
            <p className="font-semibold">{explicarCompra(item)}</p>
            {item.minimo_cadastrado !== item.minimo && (
              <p className="text-amber-200">
                Mínimo cadastrado no estoque hoje: {formatarNumero(item.minimo_cadastrado)} (o cálculo
                pede {formatarNumero(item.minimo)}).
              </p>
            )}
            {podeEditar && <p className="italic">Clique para aprovar um alvo diferente.</p>}
          </TooltipContent>
        </Dica>
      </td>
    </tr>
  );
}

/* ================================================================== */
/* Liquidação                                                         */
/* ================================================================== */

function BlocoLiquidar({
  dados,
  empresaId,
}: {
  dados: EstoqueSaudavelDados;
  empresaId: string | null;
}) {
  const salvar = useSalvarPoliticaEstoque(empresaId);
  const [motivos, setMotivos] = useState<Record<string, string>>({});

  const marcar = async (linha: EstoqueSaudavelDados["liquidar"][number], marcado: boolean) => {
    const chave = `${linha.base_id}-${linha.tamanho ?? "sem"}`;
    try {
      await salvar.mutateAsync({
        linhas: [
          {
            base_id: linha.base_id,
            tamanho: linha.tamanho,
            liquidar: marcado,
            liquidar_motivo: marcado ? (motivos[chave] ?? "Sem giro no período").slice(0, 300) : null,
          },
        ],
      });
      toast.success(marcado ? "Item marcado para liquidação." : "Marca de liquidação removida.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const total = dados.liquidar.reduce((s, l) => s + l.valor_em_estoque, 0);

  return (
    <PainelGrafico
      titulo="Para eliminar do estoque e vender"
      subtitulo={`${formatarNumero(dados.liquidar.length)} itens sem giro há ${dados.premissas.meses_sem_giro_morto} meses ou mais · ${formatarMoeda(total)} em peça parada`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <CabecalhoTabela>Item</CabecalhoTabela>
              <CabecalhoTabela>Tam.</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Em casa</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Valor parado</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Sem giro há</CabecalhoTabela>
              <CabecalhoTabela>Última saída</CabecalhoTabela>
              <CabecalhoTabela>Motivo</CabecalhoTabela>
              <CabecalhoTabela alinhar="center">Liquidar</CabecalhoTabela>
            </tr>
          </thead>
          <tbody>
            {dados.liquidar.map((l) => {
              const chave = `${l.base_id}-${l.tamanho ?? "sem"}`;
              return (
                <tr key={chave} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="max-w-[220px] truncate px-3 py-1.5 font-semibold" title={l.item}>
                    {l.item}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{l.tamanho ?? "único"}</td>
                  <td className="px-3 py-1.5 text-right">{formatarNumero(l.disponivel)}</td>
                  <td className="px-3 py-1.5 text-right font-bold text-amber-700">
                    {l.sem_preco ? "sem preço" : formatarMoeda(l.valor_em_estoque)}
                  </td>
                  <td className="px-3 py-1.5 text-right">{formatarMeses(l.meses_sem_giro)}</td>
                  <td className="px-3 py-1.5 text-slate-500">
                    {l.ultima_saida
                      ? new Date(`${l.ultima_saida}T12:00:00`).toLocaleDateString("pt-BR")
                      : "nunca saiu"}
                  </td>
                  <td className="px-3 py-1.5">
                    {l.ja_marcado ? (
                      <span className="text-slate-600">{l.motivo ?? "—"}</span>
                    ) : (
                      <AcessoGate menu="sup_estoque_saudavel" acao="alterar" fallback={<span>—</span>}>
                        <Input
                          value={motivos[chave] ?? ""}
                          onChange={(e) =>
                            setMotivos((m) => ({ ...m, [chave]: e.target.value }))
                          }
                          placeholder="Por que sai do estoque"
                          className="h-7 w-[180px] text-xs"
                        />
                      </AcessoGate>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <AcessoGate menu="sup_estoque_saudavel" acao="alterar" fallback={<span>—</span>}>
                      <Button
                        size="sm"
                        variant={l.ja_marcado ? "outline" : "default"}
                        className="h-7 gap-1 text-xs"
                        disabled={salvar.isPending}
                        onClick={() => marcar(l, !l.ja_marcado)}
                      >
                        <TrendingDown className="h-3.5 w-3.5" />
                        {l.ja_marcado ? "Desmarcar" : "Marcar"}
                      </Button>
                    </AcessoGate>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PainelGrafico>
  );
}

/* ================================================================== */
/* Diálogos                                                           */
/* ================================================================== */

function DialogAprovarAlvo({
  item,
  premissas,
  fechar,
  salvar,
  salvando,
}: {
  item: ItemEstoqueSaudavel | null;
  premissas: EstoqueSaudavelDados["premissas"];
  fechar: () => void;
  salvar: (linha: LinhaPolitica, aplicarMinimo: boolean) => Promise<void>;
  salvando: boolean;
}) {
  const [alvo, setAlvo] = useState("");
  const [minimo, setMinimo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [aplicarMinimo, setAplicarMinimo] = useState(false);

  // Reinicia os campos a cada item aberto. `key` no Dialog não serve: o
  // componente fica montado entre aberturas.
  const chave = item ? `${item.base_id}-${item.tamanho ?? "sem"}` : null;
  const [ultimaChave, setUltimaChave] = useState<string | null>(null);
  if (chave !== ultimaChave) {
    setUltimaChave(chave);
    setAlvo(item?.alvo_aprovado != null ? String(item.alvo_aprovado) : String(item?.alvo_calculado ?? ""));
    setMinimo(item?.minimo_aprovado != null ? String(item.minimo_aprovado) : String(item?.ponto_pedido ?? ""));
    setObservacao(item?.politica_observacao ?? "");
    setAplicarMinimo(false);
  }

  if (!item) return null;

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && fechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {item.item} {item.tamanho ? `· ${item.tamanho}` : ""}
          </DialogTitle>
          <DialogDescription>
            A conta sugere alvo de {formatarNumero(item.alvo_calculado)} e pedido ao chegar em{" "}
            {formatarNumero(item.ponto_pedido)}. Aprovar um número diferente é registrado com o seu
            nome e com a sugestão original.
          </DialogDescription>
        </DialogHeader>

        <Card className="border-slate-200 bg-slate-50">
          <CardContent className="space-y-1 p-3 text-xs text-slate-600">
            <p>{explicarAlvo(item, premissas)}</p>
            <p className="font-semibold text-slate-800">{explicarCompra(item)}</p>
            {motivosDeDesconfianca(item).map((m) => (
              <p key={m} className="text-amber-700">
                ⚠ {m}
              </p>
            ))}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Alvo saudável aprovado</Label>
            <Input
              type="number"
              min={0}
              value={alvo}
              onChange={(e) => setAlvo(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Pedir quando chegar em</Label>
            <Input
              type="number"
              min={0}
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs">Por quê (fica no histórico)</Label>
          <Input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex.: admissão de 40 pessoas no contrato novo em novembro"
            className="mt-1"
          />
        </div>

        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <input
            type="checkbox"
            checked={aplicarMinimo}
            onChange={(e) => setAplicarMinimo(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Levar o mínimo para o cadastro do estoque. Isso muda o aviso de reposição que o
            almoxarifado vê na tela de Estoque — hoje lá está{" "}
            <b>{formatarNumero(item.minimo_cadastrado)}</b>.
          </span>
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            disabled={salvando}
            onClick={() =>
              salvar(
                {
                  base_id: item.base_id,
                  tamanho: item.tamanho,
                  alvo_aprovado: alvo === "" ? null : Number(alvo),
                  minimo_aprovado: minimo === "" ? null : Number(minimo),
                  observacao: observacao || null,
                  alvo_sugerido: item.alvo_calculado,
                },
                aplicarMinimo,
              )
            }
          >
            {salvando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Aprovar alvo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogPremissas({
  aberto,
  fechar,
  dados,
  empresaId,
}: {
  aberto: boolean;
  fechar: () => void;
  dados: EstoqueSaudavelDados;
  empresaId: string | null;
}) {
  const salvar = useSalvarPremissasEstoque(empresaId);
  const p = dados.premissas;
  const [forma, setForma] = useState({
    lead_time_dias: String(p.lead_time_dias),
    nivel_servico: String(Math.round(p.nivel_servico * 100)),
    ciclo_revisao_dias: String(p.ciclo_revisao_dias),
    janela_meses: String(p.janela_meses),
    meses_sem_giro_morto: String(p.meses_sem_giro_morto),
    tolerancia_excesso: String(Math.round(p.tolerancia_excesso * 100)),
  });

  if (!aberto) return null;

  const campos: { chave: keyof typeof forma; rotulo: string; ajuda: string; sufixo: string }[] = [
    {
      chave: "lead_time_dias",
      rotulo: "Prazo de reposição",
      ajuda: "Do momento em que se decide comprar até a peça estar disponível no almoxarifado.",
      sufixo: "dias",
    },
    {
      chave: "nivel_servico",
      rotulo: "Garantia de não faltar",
      ajuda: "Quanto maior, maior o colchão de segurança — e o estoque. 95% é o padrão.",
      sufixo: "%",
    },
    {
      chave: "ciclo_revisao_dias",
      rotulo: "Intervalo entre compras",
      ajuda: "O estoque precisa atravessar o tempo até a próxima compra, não só o prazo de entrega.",
      sufixo: "dias",
    },
    {
      chave: "janela_meses",
      rotulo: "Histórico considerado",
      ajuda: "Janela curta faz o alvo reagir rápido à troca de quadro; longa deixa o alvo alto por mais tempo.",
      sufixo: "meses",
    },
    {
      chave: "meses_sem_giro_morto",
      rotulo: "Sem giro = liquidar",
      ajuda: "Tempo sem nenhuma saída para o item virar candidato a venda.",
      sufixo: "meses",
    },
    {
      chave: "tolerancia_excesso",
      rotulo: "Folga aceita sobre o alvo",
      ajuda: "Fornecedor vende por caixa ou dúzia — acima desta folga é que passa a contar como dinheiro parado.",
      sufixo: "%",
    },
  ];

  return (
    <Dialog open onOpenChange={(a) => !a && fechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Premissas da conta</DialogTitle>
          <DialogDescription>
            Valem para {dados.categoria ? `a categoria selecionada` : "toda a empresa"}. Mudar aqui
            recalcula todos os alvos e fica registrado no histórico.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {campos.map((c) => (
            <div key={c.chave}>
              <Label className="text-xs font-semibold">
                {c.rotulo} <span className="text-slate-400">({c.sufixo})</span>
              </Label>
              <Input
                type="number"
                value={forma[c.chave]}
                onChange={(e) => setForma((f) => ({ ...f, [c.chave]: e.target.value }))}
                className="mt-1"
              />
              <p className="mt-1 text-[11px] leading-snug text-slate-500">{c.ajuda}</p>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={salvar.isPending}
            onClick={async () => {
              try {
                await salvar.mutateAsync({
                  // Nível de serviço e tolerância são digitados em % e
                  // guardados em fração — o CHECK da tabela recusa 95.
                  payload: {
                    lead_time_dias: Number(forma.lead_time_dias),
                    nivel_servico: Number(forma.nivel_servico) / 100,
                    ciclo_revisao_dias: Number(forma.ciclo_revisao_dias),
                    janela_meses: Number(forma.janela_meses),
                    meses_sem_giro_morto: Number(forma.meses_sem_giro_morto),
                    tolerancia_excesso: Number(forma.tolerancia_excesso) / 100,
                  },
                  tipoItem: dados.categoria,
                });
                toast.success("Premissas atualizadas. Os alvos foram recalculados.");
                fechar();
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            {salvar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Salvar premissas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/* Painel da I.A                                                      */
/* ================================================================== */

/**
 * A IA LÊ o painel; ela não calcula quantidade. O texto de apoio no cabeçalho
 * diz isso ao usuário de propósito: o gerente vai levar esse número para uma
 * negociação de volume, e precisa saber que a quantidade saiu de uma fórmula
 * auditável, não de um modelo de linguagem.
 */
function PainelIaEstoque({
  empresaId,
  filtros,
  dados,
}: {
  empresaId: string | null;
  filtros: FiltroEstoqueSaudavel;
  dados: EstoqueSaudavelDados;
}) {
  const ia = useAnaliseEstoqueIA();
  const [analise, setAnalise] = useState<string | null>(null);
  const [conversa, setConversa] = useState<MsgIaEstoque[]>([]);
  const [pergunta, setPergunta] = useState("");

  if (!empresaId) return null;
  const base = {
    empresaId,
    janelaMeses: filtros.janelaMeses,
    contratoId: filtros.contratoId,
    categoria: filtros.categoria,
    almoxarifadoId: filtros.almoxarifadoId,
  };

  const gerar = async () => {
    try {
      setAnalise(await ia.mutateAsync({ ...base, modo: "analise" }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const perguntar = async () => {
    const q = pergunta.trim();
    if (!q) return;
    setPergunta("");
    const historico = conversa;
    setConversa([...historico, { role: "user", content: q }]);
    try {
      const resposta = await ia.mutateAsync({
        ...base,
        modo: "pergunta",
        pergunta: q,
        historico,
      });
      setConversa((c) => [...c, { role: "assistant", content: resposta }]);
    } catch (e) {
      toast.error((e as Error).message);
      setConversa(historico);
      setPergunta(q);
    }
  };

  return (
    <Card className="border-violet-200 bg-gradient-to-br from-violet-50/70 to-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <BrainCircuit className="h-4 w-4 text-violet-600" /> Leitura com I.A — planejamento de
            estoque
          </p>
          <p className="text-xs text-muted-foreground">
            As quantidades são calculadas pelo sistema, por fórmula de reposição — a I.A lê esses
            números e escreve a análise. Ela não inventa nem arredonda quantidade: o que não está no
            painel, ela diz que não sabe.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5 bg-violet-600 hover:bg-violet-700"
          disabled={ia.isPending}
          onClick={gerar}
        >
          {ia.isPending && !conversa.length ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {analise ? "Gerar de novo" : "Analisar o estoque"}
        </Button>
      </div>

      {analise && (
        <div className="prose prose-sm mt-3 max-w-none rounded-lg border bg-background p-4 prose-headings:mb-1 prose-headings:mt-3 prose-h2:text-base prose-ul:my-1">
          <ReactMarkdown>{analise}</ReactMarkdown>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {conversa.map((m, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[90%] rounded-xl px-3 py-2 text-sm",
              m.role === "user" ? "ml-auto bg-violet-600 text-white" : "border bg-background",
            )}
          >
            {m.role === "assistant" ? (
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
            ) : (
              m.content
            )}
          </div>
        ))}
        {ia.isPending && conversa.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando…
          </p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            perguntar();
          }}
        >
          <Input
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            placeholder={
              dados.resumo.itens_em_falta > 0
                ? "Ex.: o que comprar primeiro para ninguém ficar sem uniforme?"
                : "Ex.: onde vale fechar volume maior com o fornecedor?"
            }
            className="bg-background"
          />
          <Button type="submit" size="icon" disabled={ia.isPending || !pergunta.trim()} title="Perguntar">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </Card>
  );
}
