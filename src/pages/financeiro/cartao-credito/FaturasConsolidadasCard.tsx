import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { FileText, Paperclip, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { usePermissoes } from "@/context/PermissoesContext";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import {
  useFaturasConsolidadas,
  useSalvarValorFatura,
  useAnexarBoletoFatura,
  useRemoverBoletoFatura,
  urlBoletoFatura,
  type FaturaConsolidadaLinha,
} from "@/hooks/useCartaoFaturaConsolidada";
import { compararFatura } from "./faturaConsolidada";

// SIS-2026-0632: faturas do cartão com "fatura consolidada no Fluxo" (Sicredi 2719).
// O Fluxo de Caixa mostra 1 linha por fatura no vencimento, com a soma das despesas do
// Malote. Aqui o Financeiro digita o valor REAL da fatura (do boleto), anexa o boleto e
// vê se bate com a soma das despesas.

const fmtData = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
const fmtMes = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });

function LinhaFatura({ f, nomeCartao, podeAlterar }: { f: FaturaConsolidadaLinha; nomeCartao: string; podeAlterar: boolean }) {
  const salvar = useSalvarValorFatura();
  const anexar = useAnexarBoletoFatura();
  const remover = useRemoverBoletoFatura();
  const inputArquivo = useRef<HTMLInputElement>(null);
  const [valor, setValor] = useState(f.valor_informado != null ? String(f.valor_informado) : "");
  const cmp = compararFatura(f.soma, f.valor_informado);
  const alterado = (valor === "" ? null : Number(valor)) !== f.valor_informado;

  async function salvarValor() {
    try {
      await salvar.mutateAsync({ cartaoId: f.cartao_id, faturaMes: f.fatura_mes, valor: valor === "" ? null : Number(valor) });
      toast.success("Valor da fatura salvo.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar o valor da fatura.");
    }
  }

  async function abrirBoleto() {
    if (!f.boleto_path) return;
    try {
      window.open(await urlBoletoFatura(f.boleto_path), "_blank", "noopener");
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível abrir o boleto.");
    }
  }

  async function anexarArquivo(arquivo: File | undefined) {
    if (!arquivo) return;
    try {
      await anexar.mutateAsync({ cartaoId: f.cartao_id, faturaMes: f.fatura_mes, arquivo, caminhoAnterior: f.boleto_path });
      toast.success("Boleto anexado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao anexar o boleto.");
    } finally {
      if (inputArquivo.current) inputArquivo.current.value = "";
    }
  }

  async function removerBoleto() {
    if (!f.boleto_path) return;
    try {
      await remover.mutateAsync({ cartaoId: f.cartao_id, faturaMes: f.fatura_mes, caminho: f.boleto_path });
      toast.success("Boleto removido.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao remover o boleto.");
    }
  }

  return (
    <TableRow>
      <TableCell className="text-sm">{nomeCartao}</TableCell>
      <TableCell className="text-sm whitespace-nowrap">{fmtMes(f.fatura_mes)}</TableCell>
      <TableCell className="text-sm whitespace-nowrap">{fmtData(f.vencimento)}</TableCell>
      <TableCell className="text-sm text-center">{f.despesas}</TableCell>
      <TableCell className="text-right text-sm font-medium whitespace-nowrap">{formatBRL(f.soma)}</TableCell>
      <TableCell className="min-w-[200px]">
        <div className="flex items-center gap-1">
          <CurrencyInput className="h-8" value={valor} onChange={setValor} disabled={!podeAlterar} placeholder="Valor da fatura" />
          {podeAlterar && alterado && (
            <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" title="Salvar valor" onClick={salvarValor} disabled={salvar.isPending}>
              <Check className="h-4 w-4" />
            </Button>
          )}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {cmp.status === "sem_valor" && <Badge variant="outline" className="text-muted-foreground">Informe o valor</Badge>}
        {cmp.status === "confere" && <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Confere</Badge>}
        {cmp.status === "divergente" && (
          <span className="inline-flex flex-col">
            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Divergente</Badge>
            <span className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
              {cmp.diferenca > 0 ? "faltam " : "sobram "}
              {formatBRL(Math.abs(cmp.diferenca))} de despesas
            </span>
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="flex items-center gap-1">
          {f.boleto_path ? (
            <>
              <Button variant="link" size="sm" className="h-auto max-w-[160px] p-0 text-xs" title={f.boleto_nome ?? "Boleto"} onClick={abrirBoleto}>
                <FileText className="mr-1 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{f.boleto_nome ?? "Boleto"}</span>
              </Button>
              {podeAlterar && (
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Remover boleto" onClick={removerBoleto} disabled={remover.isPending}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          ) : podeAlterar ? (
            <>
              <input ref={inputArquivo} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => anexarArquivo(e.target.files?.[0])} />
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => inputArquivo.current?.click()} disabled={anexar.isPending}>
                <Paperclip className="mr-1 h-3.5 w-3.5" /> {anexar.isPending ? "Enviando..." : "Anexar boleto"}
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function FaturasConsolidadasCard({ cartoes }: { cartoes: { id: string; nome_cartao: string }[] }) {
  const { data: faturas = [] } = useFaturasConsolidadas();
  const { can } = usePermissoes();
  const podeAlterar = can("alterar", "financeiro", "financeiro-cartao-credito");
  const nomes = new Map(cartoes.map((c) => [c.id, c.nome_cartao]));

  if (faturas.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Faturas consolidadas no Fluxo de Caixa</CardTitle>
        <p className="text-xs text-muted-foreground">
          Neste cartão as despesas do Malote não aparecem uma a uma no Fluxo: entra uma linha por fatura, no vencimento, com a soma das
          despesas (rateadas por contrato). Informe o valor real da fatura e anexe o boleto para conferir.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cartão</TableHead>
                <TableHead>Fatura</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-center">Despesas</TableHead>
                <TableHead className="text-right">Soma das despesas</TableHead>
                <TableHead>Valor da fatura</TableHead>
                <TableHead>Conferência</TableHead>
                <TableHead>Boleto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {faturas.map((f) => (
                <LinhaFatura key={`${f.chave}-${f.valor_informado ?? ""}-${f.soma}`} f={f} nomeCartao={nomes.get(f.cartao_id) ?? "—"} podeAlterar={podeAlterar} />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
