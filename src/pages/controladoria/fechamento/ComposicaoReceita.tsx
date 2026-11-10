import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { useSalvarAjusteReceitaExtra } from "./useAjustesAdm";
import type { ItemDetalheClassificacao } from "./regras";

// SIS-2026-0793: detalhamento das Receitas Extras. O chamado pede "todas as entradas" dos administrativos sem dizer quais valores contribuem, então a
// tela avisa disso e deixa a Controladoria ajustar, classificação por classificação, o que conta. O ajuste vale só no Fechamento.
export interface ComposicaoReceitaAberta {
  podeAlterar: boolean;
  /** ajuste manual por classificação: true = sempre conta, false = nunca conta (sem entrada = padrão) */
  ajustes: Map<string, boolean> | undefined;
  /** entradas do período que não contam (de onde se adiciona) */
  foraDaColuna: ItemDetalheClassificacao[];
}

export const AVISO_CRITERIO_RECEITAS =
  "O chamado pede “todas as entradas” dos administrativos, sem dizer quais valores contribuem para esta coluna. Critério adotado: entradas dos contratos ADMINISTRATIVO das empresas e sem contrato, exceto o que não é receita (transferência entre contas, aplicação, resgate, empréstimo, financiamento, recebimento de nota, distribuição) e o que está marcado “Não é custo” na Lucratividade. É ajustável abaixo, classificação por classificação, só no Fechamento.";

export function AvisoCriterioReceitas() {
  return (
    <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{AVISO_CRITERIO_RECEITAS}</span>
    </div>
  );
}

const PADRAO = "_padrao";

// Uma classificação que já conta: seguir o padrão ou tirar. Se o ajuste dela é "sempre conta", mostra isso.
export function SeletorContaReceita({ classificacaoId, composicao }: { classificacaoId: string | null; composicao: ComposicaoReceitaAberta }) {
  const salvar = useSalvarAjusteReceitaExtra();
  const ajuste = classificacaoId ? composicao.ajustes?.get(classificacaoId) : undefined;
  if (!classificacaoId || !composicao.podeAlterar) {
    return <span className="whitespace-nowrap text-xs text-muted-foreground">{ajuste === true ? "Conta (ajustado no Fechamento)" : "Conta (padrão)"}</span>;
  }
  async function escolher(v: string) {
    try {
      await salvar.mutateAsync({ classificacaoId: classificacaoId!, conta: v === PADRAO ? null : false });
      toast.success(v === PADRAO ? "Classificação voltou ao padrão." : "Classificação deixou de contar como receita extra, só no Fechamento.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar o ajuste.");
    }
  }
  return (
    <Select value={PADRAO} onValueChange={(v) => void escolher(v)} disabled={salvar.isPending}>
      <SelectTrigger className="h-7 w-52 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={PADRAO}>{ajuste === true ? "Conta (ajustado: sempre conta)" : "Conta (padrão)"}</SelectItem>
        <SelectItem value="nao">Não conta como receita extra</SelectItem>
      </SelectContent>
    </Select>
  );
}

const LIMITE_FORA = 60;

export function ReceitasForaDaColuna({ composicao }: { composicao: ComposicaoReceitaAberta }) {
  const { podeAlterar, foraDaColuna } = composicao;
  const salvar = useSalvarAjusteReceitaExtra();
  const [busca, setBusca] = useState("");
  // SIS-2026-0836: marca várias classificações e adiciona de uma vez (chave = nome da linha).
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const alternarMarca = (nome: string) => setMarcadas((a) => { const n = new Set(a); if (n.has(nome)) n.delete(nome); else n.add(nome); return n; });
  const filtrada = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return foraDaColuna.filter((i) => !t || i.classificacao.toLowerCase().includes(t));
  }, [foraDaColuna, busca]);

  async function adicionar(item: ItemDetalheClassificacao) {
    try {
      for (const id of item.classificacaoIds) await salvar.mutateAsync({ classificacaoId: id, conta: true });
      toast.success(`${item.classificacao} agora conta como receita extra, só no Fechamento.`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar.");
    }
  }

  async function adicionarMarcadas() {
    const itens = foraDaColuna.filter((i) => marcadas.has(i.classificacao) && i.classificacaoIds.length > 0);
    if (itens.length === 0) return;
    try {
      for (const item of itens) for (const id of item.classificacaoIds) await salvar.mutateAsync({ classificacaoId: id, conta: true });
      toast.success(`${itens.length} ${itens.length === 1 ? "classificação passou" : "classificações passaram"} a contar como receita extra, só no Fechamento.`);
      setMarcadas(new Set());
    } catch (e: unknown) {
      const msg = (e as { message?: unknown } | null)?.message; // erro do Supabase é objeto simples, não Error
      toast.error(typeof msg === "string" && msg ? msg : "Erro ao salvar.");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <h3 className="text-sm font-semibold">Entradas fora desta coluna ({foraDaColuna.length.toLocaleString("pt-BR")})</h3>
        <Input className="h-7 w-48 text-xs" placeholder="Buscar classificação…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Todas as classificações que ainda não contam como receita extra (padrão ou ajuste): as com entrada neste período aparecem com o valor; as demais, sem movimento no período, também podem ser adicionadas (vale em todos os meses).{" "}
        {podeAlterar ? "Use “Adicionar” para trazer uma classificação para a coluna: vale só no Fechamento." : "Quem tem a ação Alterar em “Fechamento: ajustar o Total Desp. Adm” pode adicionar uma classificação."}
      </p>
      <div className="max-h-56 overflow-y-auto rounded-md border">
        <Table className="text-xs tabular-nums">
          <TableBody>
            {filtrada.slice(0, LIMITE_FORA).map((i) => (
              <TableRow key={i.classificacao}>
                {podeAlterar && (
                  <TableCell className="w-px pr-0">
                    {i.classificacaoIds.length > 0 && <Checkbox checked={marcadas.has(i.classificacao)} onCheckedChange={() => alternarMarca(i.classificacao)} aria-label={`Marcar ${i.classificacao}`} />}
                  </TableCell>
                )}
                <TableCell className="break-words">{i.classificacao}<span className="ml-2 text-muted-foreground">{i.lancamentos === 0 ? "sem movimento no período" : `${i.lancamentos} ${i.lancamentos === 1 ? "lançamento" : "lançamentos"}`}</span></TableCell>
                <TableCell className="whitespace-nowrap text-right">{fmtMoney(i.valor)}</TableCell>
                <TableCell className="w-px whitespace-nowrap text-right">
                  {podeAlterar && i.classificacaoIds.length > 0 && (
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={salvar.isPending} onClick={() => void adicionar(i)}>Adicionar</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtrada.length === 0 && <TableRow><TableCell colSpan={3} className="py-4 text-center text-muted-foreground">Nenhuma entrada fora da coluna neste recorte.</TableCell></TableRow>}
            {filtrada.length > LIMITE_FORA && <TableRow><TableCell colSpan={3} className="py-2 text-center text-muted-foreground">Mostrando as {LIMITE_FORA} maiores de {filtrada.length}: use a busca para achar as outras.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {podeAlterar && marcadas.size > 0 && (
        <div className="flex justify-end">
          <Button size="sm" className="h-7 text-xs" disabled={salvar.isPending} onClick={() => void adicionarMarcadas()}>
            Adicionar {marcadas.size} {marcadas.size === 1 ? "marcada" : "marcadas"}
          </Button>
        </div>
      )}
    </div>
  );
}
