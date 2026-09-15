import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarraOrcamentoDupla } from "@/components/orcamento/BarraOrcamento";
import { useOrcamentoContratos, somarOrcadoContratosPorClassificacao } from "@/hooks/useOrcamentoContratos";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { useClassificacaoMaloteVisivel } from "@/hooks/useMaloteAcessoOrcamento";
import { Info } from "lucide-react";

// Views novas, ainda fora do types.ts gerado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/**
 * Quanto do orçamento o Suprimentos já comprometeu.
 *
 * O orçamento já existia no ERP, com barra e tudo — mas alimentado por
 * `v_malote_utilizado_orcamento`, que só conta despesa em `aguardando_pagamento`
 * ou `despesa_paga`. Isso é o FIM do fluxo: o Cassio emitia R$ 50 mil em
 * pedidos numa segunda-feira e o percentual não se mexia até as notas chegarem
 * no financeiro, semanas depois.
 *
 * Aqui os dois números aparecem lado a lado, e são DISJUNTOS de propósito:
 * assim que a despesa entra na fila de pagamento ela sai de "comprometido" e
 * entra em "pago". Somar os dois nunca conta a mesma compra duas vezes — a
 * garantia está no filtro da view, não em cuidado de quem lê a tela.
 */

interface LinhaComprometido {
  pedido_id: string;
  numero_pedido: string;
  classificacao_id: string | null;
  classificacao_nome: string | null;
  contrato_id: string | null;
  competencia: string | null;
  valor: number | null;
}

interface LinhaUtilizado {
  despesa_id: string;
  classificacao_id: string | null;
  classificacao_nome: string | null;
  contrato_id: string | null;
  competencia: string | null;
  valor: number | null;
}

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "2026-08" a partir de hoje, e os 11 meses anteriores. */
function mesesRecentes(): { valor: string; rotulo: string }[] {
  const saida: { valor: string; rotulo: string }[] = [];
  const hoje = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - i, 1));
    const valor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    saida.push({
      valor,
      rotulo: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }),
    });
  }
  return saida;
}

export function PainelOrcamentoCompras() {
  const meses = useMemo(mesesRecentes, []);
  const [mes, setMes] = useState(meses[0].valor);

  const comprometido = useQuery({
    queryKey: ["v_sup_comprometido_orcamento"],
    queryFn: async (): Promise<LinhaComprometido[]> => {
      const { data, error } = await sb.from("v_sup_comprometido_orcamento").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const utilizado = useQuery({
    queryKey: ["v_malote_utilizado_orcamento", "suprimentos"],
    queryFn: async (): Promise<LinhaUtilizado[]> => {
      const { data, error } = await sb.from("v_malote_utilizado_orcamento").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  // SIS-2026-0379 (Iury): o Orçado vem das classificações de cada contrato,
  // resolvido exatamente como o bloco Contratos do Orçamento Geral
  // (/app/malote/orcamento-geral) — rubricas da Planilha de Custo vigentes no
  // mês, ligadas à Classificação do Malote. Antes vinha de
  // v_orcamento_classificacao, que só enxerga o orçamento Administrativo, e a
  // mesma classificação mostrava um Orçado aqui e outro lá.
  const orcamentoContratos = useOrcamentoContratos(mes);
  const { data: classificacoes = [], isLoading: carregandoClassificacoes } = useClassificacoesOrcamentoAdmin();
  const classificacaoVisivel = useClassificacaoMaloteVisivel();

  /** Agrupa por classificação, somando só o que cai no mês escolhido. */
  const linhas = useMemo(() => {
    const mapa = new Map<
      string,
      { nome: string; comprometido: number; pago: number; pedidos: number; orcado: number }
    >();

    // Mesmo recorte por setor do Orçamento Geral (SIS-2026-0265): sem ele,
    // quem não enxerga uma classificação restrita lá veria o Orçado dela aqui.
    const classificacoesPorId = new Map(classificacoes.map((c) => [c.id, c]));
    somarOrcadoContratosPorClassificacao(orcamentoContratos.data).forEach((orcado, classificacaoId) => {
      const classificacao = classificacoesPorId.get(classificacaoId);
      if (!classificacao || !classificacaoVisivel(classificacao)) return;
      mapa.set(classificacaoId, { nome: classificacao.nome, comprometido: 0, pago: 0, pedidos: 0, orcado });
    });

    const chave = (id: string | null, nome: string | null) =>
      id ?? `sem-classificacao:${nome ?? ""}`;

    const noMes = (competencia: string | null) =>
      !competencia ? false : competencia.slice(0, 7) === mes;

    for (const l of comprometido.data ?? []) {
      if (!noMes(l.competencia)) continue;
      const k = chave(l.classificacao_id, l.classificacao_nome);
      const atual = mapa.get(k) ?? {
        nome: l.classificacao_nome ?? "Sem classificação",
        comprometido: 0,
        pago: 0,
        pedidos: 0,
        orcado: 0,
      };
      atual.comprometido += Number(l.valor) || 0;
      atual.pedidos += 1;
      mapa.set(k, atual);
    }

    for (const l of utilizado.data ?? []) {
      if (!noMes(l.competencia)) continue;
      const k = chave(l.classificacao_id, l.classificacao_nome);
      const atual = mapa.get(k) ?? {
        nome: l.classificacao_nome ?? "Sem classificação",
        comprometido: 0,
        pago: 0,
        pedidos: 0,
        orcado: 0,
      };
      atual.pago += Number(l.valor) || 0;
      mapa.set(k, atual);
    }

    return [...mapa.values()].sort(
      (a, b) => b.comprometido + b.pago - (a.comprometido + a.pago),
    );
  }, [comprometido.data, utilizado.data, orcamentoContratos.data, classificacoes, classificacaoVisivel, mes]);

  const totais = useMemo(
    () =>
      linhas.reduce(
        (acc, l) => ({
          comprometido: acc.comprometido + l.comprometido,
          pago: acc.pago + l.pago,
          pedidos: acc.pedidos + l.pedidos,
        }),
        { comprometido: 0, pago: 0, pedidos: 0 },
      ),
    [linhas],
  );

  const carregando =
    comprometido.isLoading || utilizado.isLoading || orcamentoContratos.isLoading || carregandoClassificacoes;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
          <div className="space-y-1">
            <h3 className="font-medium">Orçamento comprometido</h3>
            <p className="text-sm text-muted-foreground">
              {totais.pedidos} pedido(s) emitidos e ainda não pagos, somando{" "}
              <strong>{fmtBRL(totais.comprometido)}</strong> — mais{" "}
              {fmtBRL(totais.pago)} já na fila de pagamento.
            </p>
          </div>
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {meses.map((m) => (
                <SelectItem key={m.valor} value={m.valor}>
                  {m.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Comprometido</strong> é o pedido que já foi para o fornecedor e ainda não virou
          pagamento — a faixa listrada. <strong>Pago</strong> é o que já está na fila do financeiro.
          Os dois nunca contam a mesma compra: quando ela avança, sai de um e entra no outro.
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classificação</TableHead>
                <TableHead className="text-right">Orçado</TableHead>
                <TableHead className="text-right">Comprometido</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-48">Consumo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => {
                const total = l.comprometido + l.pago;
                return (
                  <TableRow key={l.nome}>
                    <TableCell className="font-medium">{l.nome}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {l.orcado ? fmtBRL(l.orcado) : "sem orçamento"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtBRL(l.comprometido)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRL(l.pago)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {fmtBRL(total)}
                    </TableCell>
                    <TableCell>
                      <BarraOrcamentoDupla
                        orcado={l.orcado}
                        pago={l.pago}
                        comprometido={l.comprometido}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}

              {!carregando && linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum pedido nem despesa nesta competência.
                  </TableCell>
                </TableRow>
              )}

              {carregando && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    Carregando…
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
