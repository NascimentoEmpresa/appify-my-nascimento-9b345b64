import { useMemo } from "react";
import { Download, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_FLUXO_CAIXA } from "@/pages/controladoria/fechamento/linkFluxo";
import { baixarExcel, type Celula } from "@/pages/financeiro/conciliacao-servicos/exportarExcel";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { conciliacaoMalote, type FiltroGerencial, type FluxoGerencialRpc, type LinhaDetalheNota } from "./regras";

// SIS-2026-0893 (etapa 1): clicar num indicador abre de onde vem o número. Notas: uma linha por nota (a soma da coluna é o KPI) e Excel. Despesas e Malote:
// a composição por classificação, a conciliação do Malote com o total e o atalho para o Fluxo de Caixa no mesmo recorte.
export type IndicadorGerencial = "bruto" | "liquido" | "recebido" | "pendente" | "despesas" | "malote";

const TITULOS: Record<IndicadorGerencial, { titulo: string; como: string }> = {
  bruto: { titulo: "Valor Bruto Já Emitido", como: "Soma do valor bruto das notas do recorte (emissão ou competência, conforme o filtro “Faturamento por”). Cancelada e substituída não entram." },
  liquido: { titulo: "Valor Líquido Faturado", como: "Soma do valor líquido (bruto menos as retenções) das mesmas notas do Valor Bruto." },
  recebido: { titulo: "Valor Efetivamente Recebido", como: "Soma do valor pago das notas com DATA DE PAGAMENTO dentro do período, qualquer que seja a emissão ou a competência da nota." },
  pendente: { titulo: "Valor Pendente de Recebimento", como: "Por nota: líquido − pago − desconto de conta vinculada − descontos pós-emissão (mesma regra do Relatório de Serviços), nas notas do recorte de faturamento." },
  despesas: { titulo: "Despesas Pagas", como: "Saídas já pagas no Fluxo de Caixa no período. Não entram: transferência entre contas, aplicações, cheque especial, empréstimos, saldo anterior e recebimento de nota." },
  malote: { titulo: "Despesas Pagas no Malote", como: "Parte das despesas pagas que veio do Malote. Ela já está DENTRO do total de despesas; não se soma de novo." },
};

const data = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR") : "—");
const mes = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const COLUNA_DO_INDICADOR: Partial<Record<IndicadorGerencial, keyof Pick<LinhaDetalheNota, "bruto" | "liquido" | "pago" | "pendente">>> = {
  bruto: "bruto", liquido: "liquido", recebido: "pago", pendente: "pendente",
};

export function DetalheIndicadorDialog({
  indicador, onClose, notas, recebidas, fluxo, filtro, contratoNome, empresaNome,
}: {
  indicador: IndicadorGerencial | null;
  onClose: () => void;
  /** notas do recorte de faturamento (para bruto, líquido e pendente) */
  notas: LinhaDetalheNota[];
  /** notas com pagamento no período (para o recebido) */
  recebidas: LinhaDetalheNota[];
  fluxo: FluxoGerencialRpc;
  filtro: FiltroGerencial;
  contratoNome: (id: string) => string;
  empresaNome: (id: string) => string;
}) {
  const navigate = useNavigate();
  const ehNota = indicador === "bruto" || indicador === "liquido" || indicador === "recebido" || indicador === "pendente";
  const linhas = useMemo(() => {
    if (!indicador || !ehNota) return [];
    const base = indicador === "recebido" ? recebidas : notas;
    const col = COLUNA_DO_INDICADOR[indicador]!;
    // pendente: só as notas que ainda têm saldo; as demais colunas listam todas as notas do recorte
    return base.filter((l) => (indicador === "pendente" ? l.pendente !== 0 : true) && (indicador === "recebido" ? l.pago > 0 : true)).sort((a, b) => b[col] - a[col]);
  }, [indicador, ehNota, notas, recebidas]);

  if (!indicador) return null;
  const meta = TITULOS[indicador];
  const col = COLUNA_DO_INDICADOR[indicador];
  const totalDaColuna = col ? Math.round(linhas.reduce((s, l) => s + l[col], 0) * 100) / 100 : 0;

  const urlFluxo = () => {
    const q = new URLSearchParams({ tipo: "saida" });
    // despesas enquadradas por competência: o Fluxo de Caixa filtra pelo mesmo mês
    if (filtro.tipoDataDespesa === "competencia") { q.set("competenciaDe", filtro.ini.slice(0, 7)); q.set("competenciaAte", filtro.fim.slice(0, 7)); } else { q.set("de", filtro.ini); q.set("ate", filtro.fim); }
    if (filtro.empresaId) q.set("empresa", filtro.empresaId);
    if (filtro.contratoId) q.set("contrato", filtro.contratoId);
    return `${ROTA_FLUXO_CAIXA}?${q.toString()}`;
  };

  async function exportar() {
    if (!ehNota) return;
    const cab: Celula[] = ["NF", "Empresa", "Contrato", "Competência", "Emissão", "Pagamento", "Bruto", "Líquido", "Pago", "Pendente"];
    const corpo: Celula[][] = linhas.map((l) => [l.numero, empresaNome(l.empresaId), contratoNome(l.contratoId), mes(l.competencia), data(l.emissao), data(l.pagamento), l.bruto, l.liquido, l.pago, l.pendente]);
    await baixarExcel(
      [
        { nome: "Resumo", linhas: [[meta.titulo], ["Período", `${data(filtro.ini)} a ${data(filtro.fim)}`], ["Como é calculado", meta.como], ["Total", totalDaColuna], ["Notas", linhas.length]] },
        { nome: "Notas", linhas: [cab, ...corpo] },
      ],
      `fluxo-gerencial-${indicador}-${filtro.ini}-a-${filtro.fim}.xlsx`,
    );
  }

  const conc = conciliacaoMalote(fluxo.despesas_pagas, fluxo.malote_pago);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{meta.titulo}</DialogTitle>
          <DialogDescription>{meta.como}</DialogDescription>
        </DialogHeader>

        {ehNota ? (
          <>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{linhas.length.toLocaleString("pt-BR")} nota(s) · total <strong>{fmtMoney(totalDaColuna)}</strong></span>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => void exportar()} disabled={linhas.length === 0}><Download className="h-3.5 w-3.5" />Excel</Button>
            </div>
            <div className="max-h-[55vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>NF</TableHead><TableHead>Empresa</TableHead><TableHead>Contrato</TableHead><TableHead>Competência</TableHead><TableHead>Emissão</TableHead><TableHead>Pagamento</TableHead>
                    <TableHead className="text-right">Bruto</TableHead><TableHead className="text-right">Líquido</TableHead><TableHead className="text-right">Pago</TableHead><TableHead className="text-right">Pendente</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.length === 0 && <TableRow><TableCell colSpan={10} className="py-6 text-center text-muted-foreground">Nenhuma nota no recorte.</TableCell></TableRow>}
                  {linhas.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-xs font-medium">{l.numero}</TableCell>
                      <TableCell className="text-xs">{empresaNome(l.empresaId)}</TableCell>
                      <TableCell className="text-xs">{contratoNome(l.contratoId)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{mes(l.competencia)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{data(l.emissao)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{data(l.pagamento)}</TableCell>
                      <TableCell className={`text-right text-xs ${col === "bruto" ? "font-semibold" : ""}`}>{fmtMoney(l.bruto)}</TableCell>
                      <TableCell className={`text-right text-xs ${col === "liquido" ? "font-semibold" : ""}`}>{fmtMoney(l.liquido)}</TableCell>
                      <TableCell className={`text-right text-xs ${col === "pago" ? "font-semibold" : ""}`}>{fmtMoney(l.pago)}</TableCell>
                      <TableCell className={`text-right text-xs ${col === "pendente" ? "font-semibold" : ""}`}>{fmtMoney(l.pendente)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {linhas.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={6} className="text-xs font-semibold">Total</TableCell>
                      <TableCell className="text-right text-xs font-semibold">{fmtMoney(linhas.reduce((s, l) => s + l.bruto, 0))}</TableCell>
                      <TableCell className="text-right text-xs font-semibold">{fmtMoney(linhas.reduce((s, l) => s + l.liquido, 0))}</TableCell>
                      <TableCell className="text-right text-xs font-semibold">{fmtMoney(linhas.reduce((s, l) => s + l.pago, 0))}</TableCell>
                      <TableCell className="text-right text-xs font-semibold">{fmtMoney(linhas.reduce((s, l) => s + l.pendente, 0))}</TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
            {indicador === "recebido" && <p className="text-[11px] text-muted-foreground">Cada nota entra pela data do pagamento. Um pagamento de nota de outro mês aparece aqui no mês em que o dinheiro entrou.</p>}
          </>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Despesas pagas (total)</p><p className="text-lg font-bold">{fmtMoney(fluxo.despesas_pagas)}</p><p className="text-[11px] text-muted-foreground">{fluxo.qtd_despesas.toLocaleString("pt-BR")} lançamento(s)</p></div>
              <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Do Malote</p><p className="text-lg font-bold">{fmtMoney(conc.malote)}</p><p className="text-[11px] text-muted-foreground">{(conc.pctMalote * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do total</p></div>
              <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Demais origens</p><p className="text-lg font-bold">{fmtMoney(conc.demais)}</p><p className="text-[11px] text-muted-foreground">Débito Automático, cartão, planilha importada…</p></div>
            </div>
            <p className={`rounded-md border p-2 text-xs ${conc.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
              {conc.ok
                ? `Conciliado: Malote ${fmtMoney(conc.malote)} + demais origens ${fmtMoney(conc.demais)} = ${fmtMoney(fluxo.despesas_pagas)}. O Malote não é somado duas vezes.`
                : `Atenção: o Malote (${fmtMoney(conc.malote)}) é maior que o total de despesas (${fmtMoney(fluxo.despesas_pagas)}). Pode haver duplicidade; confira no Fluxo de Caixa.`}
            </p>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Composição por classificação</p>
              <Table>
                <TableHeader><TableRow><TableHead>Classificação</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
                <TableBody>
                  {fluxo.composicao.length === 0 && <TableRow><TableCell colSpan={3} className="py-4 text-center text-muted-foreground">Sem despesas pagas no período.</TableCell></TableRow>}
                  {fluxo.composicao.map((c) => (
                    <TableRow key={c.nome}>
                      <TableCell className="text-xs">{c.nome}</TableCell>
                      <TableCell className="text-right text-xs">{fmtMoney(c.valor)}</TableCell>
                      <TableCell className="text-right text-xs">{fluxo.despesas_pagas > 0 ? `${((c.valor / fluxo.despesas_pagas) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button variant="outline" className="gap-1" onClick={() => navigate(urlFluxo())}><ExternalLink className="h-3.5 w-3.5" />Ver os lançamentos no Fluxo de Caixa</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
