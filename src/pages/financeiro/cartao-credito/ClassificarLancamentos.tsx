import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, CheckCircle2, CreditCard, ListTree, Wallet, X } from "lucide-react";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { useItensParaClassificar, ItemParaClassificar } from "@/hooks/useCartaoFaturaRateio";
import { RateioItemFaturaDialog } from "./RateioItemFaturaDialog";

type FiltroStatus = "" | "pendente" | "classificado";

interface GrupoFatura {
  chave: string;
  cartaoId: string;
  nomeCartao: string;
  competencia: string;
  itens: ItemParaClassificar[];
  pendentes: number;
}

// SIS-2026-0568: tela enxuta pra quem foi autorizado (por cartão, ver
// malote_cartao_credito.usuarios_classificar_ids) a classificar
// Classificação/Contrato dos itens da fatura — sem acesso ao resto do
// módulo Cartão de Crédito (limite, cadastro do cartão, import completo).
// A RLS já resolve quais itens aparecem aqui (useItensParaClassificar).
//
// [SEM-CHAMADO] (pedido do usuário): lista plana de todo item confirmado
// de todo cartão ia virar uma bagunça com o tempo — agrupado por Cartão +
// Competência (accordion, mesmo padrão de OrcamentoContratos.tsx), com
// filtros (Competência/Cartão/Status) e KPIs (mesmo KpiTile já usado em
// CartaoCredito.tsx) pra achar rápido o que falta classificar.
export default function ClassificarLancamentos() {
  const { data: itens = [], isLoading } = useItensParaClassificar();
  const [filtroCompetencia, setFiltroCompetencia] = useState("");
  const [filtroCartaoId, setFiltroCartaoId] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("");
  const [itemClassificar, setItemClassificar] = useState<ItemParaClassificar | null>(null);

  // Opções do filtro de Cartão vêm do dataset INTEIRO (não do filtrado) —
  // mesmo padrão de CartaoCredito.tsx, pra não encolher a lista conforme
  // os outros filtros são aplicados.
  const opcoesCartao = useMemo(() => {
    const porId = new Map<string, string>();
    for (const i of itens) porId.set(i.cartao_id, i.nome_cartao);
    return Array.from(porId.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [itens]);

  function limparFiltros() {
    setFiltroCompetencia("");
    setFiltroCartaoId("");
    setFiltroStatus("");
  }

  const itensFiltrados = useMemo(() => {
    return itens.filter((i) => {
      if (filtroCompetencia && i.competencia?.slice(0, 7) !== filtroCompetencia) return false;
      if (filtroCartaoId && i.cartao_id !== filtroCartaoId) return false;
      if (filtroStatus === "pendente" && i.qtd_rateio !== 0) return false;
      if (filtroStatus === "classificado" && i.qtd_rateio === 0) return false;
      return true;
    });
  }, [itens, filtroCompetencia, filtroCartaoId, filtroStatus]);

  const kpis = useMemo(() => {
    let pendentesQtd = 0;
    let pendentesValor = 0;
    let classificadosQtd = 0;
    const cartoesComPendencia = new Set<string>();
    for (const i of itensFiltrados) {
      if (i.qtd_rateio === 0) {
        pendentesQtd++;
        pendentesValor += Number(i.valor) || 0;
        cartoesComPendencia.add(i.cartao_id);
      } else {
        classificadosQtd++;
      }
    }
    return { pendentesQtd, pendentesValor, classificadosQtd, cartoesComPendencia: cartoesComPendencia.size };
  }, [itensFiltrados]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, GrupoFatura>();
    for (const i of itensFiltrados) {
      const chave = `${i.cartao_id}|${i.competencia}`;
      if (!mapa.has(chave)) {
        mapa.set(chave, { chave, cartaoId: i.cartao_id, nomeCartao: i.nome_cartao, competencia: i.competencia, itens: [], pendentes: 0 });
      }
      const g = mapa.get(chave)!;
      g.itens.push(i);
      if (i.qtd_rateio === 0) g.pendentes++;
    }
    return Array.from(mapa.values()).sort((a, b) => {
      const porCompetencia = (b.competencia ?? "").localeCompare(a.competencia ?? "");
      return porCompetencia !== 0 ? porCompetencia : a.nomeCartao.localeCompare(b.nomeCartao);
    });
  }, [itensFiltrados]);

  function competenciaLabel(competencia: string) {
    return competencia ? new Date(competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" }) : "—";
  }

  return (
    <AcessoGate
      menu="financeiro-cartao-credito-classificar"
      acao="visualizar"
      fallback={<div className="p-6 text-sm text-muted-foreground">Você não tem liberação para esta tela.</div>}
    >
    <div className="space-y-6 p-6">
      <PageHeader
        title="Classificar Lançamentos de Cartão"
        subtitle="Informe a Classificação e o Contrato de cada item da fatura — pode dividir 1 item entre vários."
        module="Financeiro"
        breadcrumb={["Financeiro", "Gestão Financeira", "Cartão de Crédito", "Classificar Lançamentos"]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Itens Pendentes"
          valor={String(kpis.pendentesQtd)}
          icon={<AlertCircle />}
          cor="amber"
          valorClass="text-amber-600 dark:text-amber-400"
        />
        <KpiTile
          label="Valor Pendente"
          valor={formatBRL(kpis.pendentesValor)}
          icon={<Wallet />}
          cor="red"
          valorClass="text-red-600 dark:text-red-400"
        />
        <KpiTile label="Itens Classificados" valor={String(kpis.classificadosQtd)} icon={<CheckCircle2 />} cor="emerald" />
        <KpiTile label="Cartões com Pendência" valor={String(kpis.cartoesComPendencia)} icon={<CreditCard />} cor="sky" />
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Filtros</p>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={limparFiltros}>
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Competência</Label>
              <Input type="month" className="h-8 text-xs" value={filtroCompetencia} onChange={(e) => setFiltroCompetencia(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Cartão</Label>
              <Select value={filtroCartaoId || "todos"} onValueChange={(v) => setFiltroCartaoId(v === "todos" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {opcoesCartao.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filtroStatus || "todos"} onValueChange={(v) => setFiltroStatus(v === "todos" ? "" : (v as FiltroStatus))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="classificado">Classificado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>}
      {!isLoading && grupos.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">Nenhum item encontrado com esse filtro.</p>
      )}
      {!isLoading && grupos.length > 0 && (
        <Accordion type="multiple" className="w-full">
          {grupos.map((g) => (
            <AccordionItem key={g.chave} value={g.chave}>
              <AccordionTrigger className="hover:no-underline">
                <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                  <div className="text-left">
                    <p className="font-medium">{g.nomeCartao}</p>
                    <p className="text-xs text-muted-foreground font-normal">{competenciaLabel(g.competencia)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {g.pendentes > 0 ? (
                      <Badge variant="outline">{g.pendentes} pendente{g.pendentes > 1 ? "s" : ""}</Badge>
                    ) : (
                      <Badge variant="secondary">Tudo classificado</Badge>
                    )}
                    <span className="text-sm font-semibold whitespace-nowrap">{g.itens.length} {g.itens.length === 1 ? "item" : "itens"}</span>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-center">Classificação</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.itens.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="text-sm">
                          {i.data_compra ? new Date(i.data_compra + "T00:00:00").toLocaleDateString("pt-BR") : "—"}
                        </TableCell>
                        <TableCell className="text-sm">{i.descricao}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatBRL(i.valor)}</TableCell>
                        <TableCell className="text-center">
                          {i.qtd_rateio === 0 ? (
                            <Badge variant="outline">Pendente</Badge>
                          ) : i.qtd_rateio === 1 ? (
                            <Badge variant="secondary">Classificado</Badge>
                          ) : (
                            <Badge variant="secondary">Rateado ({i.qtd_rateio})</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" title="Classificar" onClick={() => setItemClassificar(i)}>
                            <ListTree className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      <RateioItemFaturaDialog
        open={!!itemClassificar}
        onClose={() => setItemClassificar(null)}
        itemId={itemClassificar?.id ?? null}
        descricaoItem={itemClassificar?.descricao ?? ""}
        valorItem={Number(itemClassificar?.valor ?? 0)}
      />
    </div>
    </AcessoGate>
  );
}
