/**
 * SIS-2026-0824 — "o que tem, o que entrou, o que saiu" agora com o que está
 * PENDENTE e o que está EM COMPRA, por item.
 *
 * O cabeçalho precisa dizer que as colunas têm duas naturezas diferentes:
 * entrou/saiu são do período filtrado, e disponível/pendente/em compra são
 * posição de agora. Sem esse aviso a leitura mais natural da tabela ("entrou
 * 20 e está pendente 2 no mesmo intervalo") está errada.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, PackageSearch } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  AZUL_MAGNITUDE,
  CabecalhoTabela,
  CINZA_GRADE,
  EstadoVazio,
  PainelGrafico,
  TickCategoria,
} from "./PainelBase";
import {
  formatarMoeda,
  formatarNumero,
  rotuloCategoria,
  type DashboardComprasEstoqueDados,
} from "@/lib/suprimentos/dashboardComprasEstoque";
import {
  agruparPosicaoPorFamilia,
  csvDaPosicaoPorItem,
  rotuloTamanho,
  type FamiliaPosicao,
  type OrdemPosicao,
} from "@/lib/suprimentos/posicaoPorItem";

const POR_PAGINA = 15;

const ORDENS: { valor: OrdemPosicao; rotulo: string }[] = [
  { valor: "pendente_entrega", rotulo: "Mais pendente" },
  { valor: "em_compra", rotulo: "Mais em compra" },
  { valor: "saiu", rotulo: "Mais saiu no período" },
  { valor: "entrou", rotulo: "Mais entrou no período" },
  { valor: "disponivel", rotulo: "Maior disponível" },
  { valor: "item", rotulo: "Nome do item" },
];

const data = (valor: string) => new Date(`${valor}T12:00:00`).toLocaleDateString("pt-BR");

/** Zero vira "—": numa tabela larga, uma coluna de zeros esconde o que importa. */
const qtd = (valor: number | null | undefined) =>
  !valor ? "—" : formatarNumero(valor, Number.isInteger(Number(valor)) ? 0 : 2);

export function PosicaoPorItem({
  dados,
  inicio,
  fim,
}: {
  dados: DashboardComprasEstoqueDados;
  inicio: string;
  fim: string;
}) {
  const [busca, setBusca] = useState("");
  const [soPendencias, setSoPendencias] = useState(true);
  const [ordem, setOrdem] = useState<OrdemPosicao>("pendente_entrega");
  const [pagina, setPagina] = useState(0);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  const linhas = dados.posicao_por_item;
  const familias = useMemo(
    () => agruparPosicaoPorFamilia(linhas ?? [], { busca, soPendencias, ordem }),
    [linhas, busca, soPendencias, ordem],
  );

  const ultimaPagina = Math.max(0, Math.ceil(familias.length / POR_PAGINA) - 1);
  const paginaAtual = Math.min(pagina, ultimaPagina);
  const visiveis = familias.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA);

  const alternar = (baseId: string) =>
    setAbertas((atual) => {
      const proxima = new Set(atual);
      if (proxima.has(baseId)) proxima.delete(baseId);
      else proxima.add(baseId);
      return proxima;
    });

  const exportar = () => {
    const url = URL.createObjectURL(
      new Blob(["﻿" + csvDaPosicaoPorItem(familias)], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `posicao-por-item-${inicio}-a-${fim}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Enquanto o PostgREST serve o schema anterior à migration 20261110000100, a
  // chave não vem. Dizer isso é melhor que uma tabela vazia, que seria lida
  // como "não há pendência nenhuma".
  if (!linhas) {
    return (
      <PainelGrafico titulo="Posição por item — tem, entrou, saiu, pendente e em compra">
        <EstadoVazio
          altura={120}
          texto="Esta visão depende de uma atualização do banco que ainda não está publicada neste ambiente."
        />
      </PainelGrafico>
    );
  }

  const semVinculo = Number(dados.estoque_resumo.quantidade_pendente_sem_vinculo ?? 0);

  return (
    <PainelGrafico
      titulo="Posição por item — tem, entrou, saiu, pendente e em compra"
      subtitulo={`Entrou e saiu no período de ${data(inicio)} a ${data(fim)}. Disponível, reservado, pendente e em compra são a posição de agora, e não mudam com o período.`}
      acao={
        <AcessoGate menu="sup_dashboard_compras_estoque" acao="exportar">
          <Button variant="outline" size="sm" className="gap-1" disabled={!familias.length} onClick={exportar}>
            <Download className="h-4 w-4" /> Exportar
          </Button>
        </AcessoGate>
      }
    >
      <p className="mb-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-950">
        <b>Pendente de entrega</b> é a soma, em todos os pedidos de materiais abertos, do que foi pedido e o
        almoxarifado ainda não entregou — o mesmo número que aparece em Pedidos de Materiais.
        {" "}<b>Em cotação (Malote)</b> é a solicitação de compra que ainda não foi enviada ao fornecedor, e
        {" "}<b>comprado, a receber</b> é o pedido já enviado, descontado o que foi conferido no recebimento.
        {" "}Um item sai da primeira e entra na segunda quando o pedido é emitido, então as duas nunca contam a
        mesma peça.
      </p>
      {semVinculo > 0 && (
        <p className="mb-3 text-xs text-amber-800">
          Há {qtd(semVinculo)} {semVinculo === 1 ? "unidade pendente" : "unidades pendentes"} em linhas de pedido
          escritas como texto livre, sem item do catálogo — elas entram no cartão de pendência, mas não têm linha
          nesta tabela.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="busca-posicao-item" className="text-xs">Buscar item ou código</Label>
          <Input
            id="busca-posicao-item"
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setPagina(0); }}
            placeholder="Ex.: calça sarja, botina, 0000002"
            className="h-8 sm:w-64"
          />
        </div>
        <div>
          <Label htmlFor="ordem-posicao-item" className="text-xs">Ordenar por</Label>
          <select
            id="ordem-posicao-item"
            value={ordem}
            onChange={(e) => { setOrdem(e.target.value as OrdemPosicao); setPagina(0); }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {ORDENS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 py-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={soPendencias}
            onChange={(e) => { setSoPendencias(e.target.checked); setPagina(0); }}
          />
          Só com pendência ou compra em andamento
        </label>
      </div>

      {visiveis.length ? (
        <>
          <GraficoPosicao familias={familias} />
          <div className="overflow-x-auto">
            <table className="w-full text-xs" aria-label="Posição por item e tamanho">
              <thead>
                <tr>
                  <CabecalhoTabela>Item</CabecalhoTabela>
                  <CabecalhoTabela>Código</CabecalhoTabela>
                  <CabecalhoTabela>Tamanho</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Disponível</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Reservado</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Entrou</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Saiu</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Pendente de entrega</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Em cotação</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">A receber</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Valor em estoque</CabecalhoTabela>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((familia) => (
                  <LinhasDaFamilia
                    key={familia.base_id}
                    familia={familia}
                    aberta={abertas.has(familia.base_id)}
                    aoAlternar={() => alternar(familia.base_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {familias.length} {familias.length === 1 ? "item" : "itens"} · página {paginaAtual + 1} de{" "}
              {ultimaPagina + 1} · clique na linha para abrir os tamanhos
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={paginaAtual === 0} onClick={() => setPagina(paginaAtual - 1)}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={paginaAtual === ultimaPagina} onClick={() => setPagina(paginaAtual + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        </>
      ) : (
        <EstadoVazio
          altura={120}
          texto={
            soPendencias
              ? "Nenhum item com pendência de entrega ou compra em andamento."
              : "Nenhum item corresponde à busca."
          }
        />
      )}
    </PainelGrafico>
  );
}

/**
 * As cinco leituras no mesmo gráfico, como o solicitante pediu: quanto tem,
 * quanto entrou, quanto saiu, quanto está pendente e quanto está em compra.
 *
 * Barras agrupadas e não empilhadas de propósito: empilhar somaria naturezas
 * diferentes (fluxo do período com posição de agora) e a altura total não
 * significaria nada. Só as primeiras famílias entram — o gráfico é a leitura
 * rápida, a resposta exata está na tabela abaixo.
 */
function GraficoPosicao({ familias }: { familias: FamiliaPosicao[] }) {
  const dados = familias.slice(0, 8).map((f) => ({
    rotulo: f.item,
    disponivel: f.disponivel,
    entrou: f.entrou,
    saiu: f.saiu,
    pendente_entrega: f.pendente_entrega,
    em_compra: f.aguardando_compra + f.em_transito,
    aguardando_compra: f.aguardando_compra,
    em_transito: f.em_transito,
  }));
  if (!dados.length) return null;

  return (
    <div className="mb-4" style={{ height: Math.max(240, dados.length * 46 + 70) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} layout="vertical" margin={{ left: 12, right: 24, top: 4 }} barGap={1}>
          <CartesianGrid strokeDasharray="3 3" stroke={CINZA_GRADE} horizontal={false} />
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="rotulo" width={150} tick={<TickCategoria maximo={22} />} />
          <Tooltip
            cursor={{ fill: "#f1f5f9" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
                  <p className="mb-1 max-w-72 font-semibold text-slate-700">{label}</p>
                  <p className="text-slate-600">Disponível agora: {qtd(d.disponivel)}</p>
                  <p className="text-emerald-700">Entrou no período: {qtd(d.entrou)}</p>
                  <p className="text-rose-700">Saiu no período: {qtd(d.saiu)}</p>
                  <p className="font-semibold text-amber-800">Pendente de entrega: {qtd(d.pendente_entrega)}</p>
                  <p className="text-violet-700">Em cotação (Malote): {qtd(d.aguardando_compra)}</p>
                  <p className="text-blue-700">Comprado, a receber: {qtd(d.em_transito)}</p>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="disponivel" name="Tem agora" fill={AZUL_MAGNITUDE} radius={[0, 3, 3, 0]} maxBarSize={11} />
          <Bar dataKey="entrou" name="Entrou no período" fill="#10b981" radius={[0, 3, 3, 0]} maxBarSize={11} />
          <Bar dataKey="saiu" name="Saiu no período" fill="#ef4444" radius={[0, 3, 3, 0]} maxBarSize={11} />
          <Bar dataKey="pendente_entrega" name="Pendente de entrega" fill="#f59e0b" radius={[0, 3, 3, 0]} maxBarSize={11} />
          <Bar dataKey="em_compra" name="Em compra" fill="#8b5cf6" radius={[0, 3, 3, 0]} maxBarSize={11} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function LinhasDaFamilia({
  familia,
  aberta,
  aoAlternar,
}: {
  familia: FamiliaPosicao;
  aberta: boolean;
  aoAlternar: () => void;
}) {
  // Item sem tamanho tem uma linha só e nada a abrir — nesse caso o código e o
  // rótulo "Único" vão na própria linha da família, senão o código, que é a
  // identidade do produto, nunca apareceria.
  const unico = familia.tamanhos.length === 1 && familia.tamanhos[0]?.tamanho === null;
  const varios = !unico;
  const Icone = aberta ? ChevronDown : ChevronRight;
  return (
    <>
      <tr
        className={cn("border-b bg-slate-50/60", varios && "cursor-pointer hover:bg-slate-100")}
        onClick={varios ? aoAlternar : undefined}
      >
        <td className="max-w-56 px-3 py-2 font-semibold text-blue-950">
          <span className="flex items-center gap-1">
            {varios ? <Icone className="h-3.5 w-3.5 shrink-0 text-slate-500" /> : <span className="w-3.5" />}
            <span className="min-w-0">
              <span className="block truncate" title={familia.item}>{familia.item}</span>
              <span className="block text-[10px] font-normal text-slate-500">
                {rotuloCategoria(familia.categoria)}
              </span>
            </span>
          </span>
        </td>
        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {unico ? familia.tamanhos[0]?.codigo ?? "—" : "—"}
        </td>
        <td className="px-3 py-2 text-[11px] text-slate-500">
          {unico
            ? "Único"
            : `${familia.tamanhos.length} ${familia.tamanhos.length === 1 ? "tamanho" : "tamanhos"}`}
        </td>
        <td className="px-3 py-2 text-right font-semibold tabular-nums">{qtd(familia.disponivel)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{qtd(familia.reservado)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{qtd(familia.entrou)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-rose-700">{qtd(familia.saiu)}</td>
        <td className="px-3 py-2 text-right font-bold tabular-nums text-amber-800">{qtd(familia.pendente_entrega)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-violet-700">{qtd(familia.aguardando_compra)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-blue-700">{qtd(familia.em_transito)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{formatarMoeda(familia.valor_total)}</td>
      </tr>
      {aberta &&
        varios &&
        familia.tamanhos.map((t) => (
          <tr key={`${familia.base_id}-${t.tamanho ?? "unico"}`} className="border-b last:border-0">
            <td className="px-3 py-1.5 pl-9 text-slate-500">
              <span className="flex items-center gap-1.5">
                <PackageSearch className="h-3 w-3 shrink-0" />
                {rotuloTamanho(t.tamanho)}
              </span>
            </td>
            <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{t.codigo ?? "—"}</td>
            <td className="px-3 py-1.5 text-[11px] text-slate-500">{rotuloTamanho(t.tamanho)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{qtd(t.disponivel)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{qtd(t.reservado)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{qtd(t.entrou)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-rose-700">{qtd(t.saiu)}</td>
            <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-amber-800">{qtd(t.pendente_entrega)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-violet-700">{qtd(t.aguardando_compra)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-blue-700">{qtd(t.em_transito)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{formatarMoeda(t.valor_total)}</td>
          </tr>
        ))}
    </>
  );
}
