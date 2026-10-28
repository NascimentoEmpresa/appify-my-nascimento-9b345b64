import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useContratosERP } from "@/hooks/useContratosERP";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { ROTULO_TRATAMENTO, TRATAMENTOS, tratamentoEfetivo, tratamentoPadraoPorNome, type TratamentoContrato } from "./tratamentoContrato";
import { useSalvarTratamentoContrato, useTratamentosContrato } from "./useTratamentosContrato";

const PADRAO = "__padrao";
const LIMITE_LINHAS = 150;

// V1: define como cada contrato conta nos relatórios (Faturamento, Lucratividade e Fechamento): contrato comum, fora das despesas ou investimento.
// Só grava a exceção; "Padrão" volta à regra pelo nome (ESTOQUE…, MOVIMENTAÇÃO FINANCEIRA… e ADMINISTRATIVO… = fora das despesas; INVESTIMENTOS… = investimento).
export function TratamentoContratosDialog({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { data: contratos = [] } = useContratosERP({ todasEmpresas: true });
  const { data: excecoes = new Map<string, TratamentoContrato>() } = useTratamentosContrato();
  const { data: podeAlterar } = useScreenAccess("controladoria-tratamento-contratos", "alterar");
  const salvar = useSalvarTratamentoContrato();
  const [busca, setBusca] = useState("");
  const [soEspeciais, setSoEspeciais] = useState(true);

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (contratos as any[])
      .map((c) => {
        const excecao = excecoes.get(c.id) ?? null;
        return { id: c.id as string, nome: c.nome as string, cliente: (c.cliente ?? "") as string, excecao, efetivo: tratamentoEfetivo(c.nome, excecao), padrao: tratamentoPadraoPorNome(c.nome) };
      })
      .filter((l) => (!soEspeciais || l.efetivo !== "normal" || l.excecao || l.padrao !== "normal") && (!termo || `${l.nome} ${l.cliente}`.toLowerCase().includes(termo)))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [contratos, excecoes, busca, soEspeciais]);

  async function escolher(contratoId: string, v: string) {
    try {
      await salvar.mutateAsync({ contratoId, tratamento: v === PADRAO ? null : (v as TratamentoContrato) });
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar o tratamento.");
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Tratamento dos contratos nos relatórios</DialogTitle>
          <DialogDescription>
            Define como cada contrato conta no Faturamento da Empresa, na Lucratividade de Contratos e no Fechamento da Empresa. <strong>Contrato comum</strong>: o custo entra em
            Despesas e no lucro. <strong>Fora das despesas</strong>: não entra em Despesas nem no lucro. <strong>Investimento</strong>: fora das despesas e do lucro, e o valor aparece
            na coluna Investimentos do Fechamento. "Padrão" usa a regra pelo nome do contrato. A mudança vale para todos os relatórios e meses.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3">
          <Input className="h-8 max-w-xs text-xs" placeholder="Buscar contrato ou cliente" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Label className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={soEspeciais} onCheckedChange={(v) => setSoEspeciais(!!v)} /> Só os com tratamento especial
          </Label>
        </div>

        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
          {linhas.slice(0, LIMITE_LINHAS).map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{l.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {l.excecao ? `Definido: ${ROTULO_TRATAMENTO[l.excecao]}` : `Padrão pelo nome: ${ROTULO_TRATAMENTO[l.padrao]}`}
                  {l.cliente ? ` · ${l.cliente}` : ""}
                </p>
              </div>
              <Select value={l.excecao ?? PADRAO} onValueChange={(v) => void escolher(l.id, v)} disabled={!podeAlterar || salvar.isPending}>
                <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={PADRAO}>Padrão ({ROTULO_TRATAMENTO[l.padrao]})</SelectItem>
                  {TRATAMENTOS.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
          {linhas.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Nenhum contrato encontrado. Desmarque "Só os com tratamento especial" para ver todos.</p>}
          {linhas.length > LIMITE_LINHAS && <p className="text-center text-xs text-muted-foreground">Mostrando {LIMITE_LINHAS} de {linhas.length}. Use a busca para achar o contrato.</p>}
        </div>

        <DialogFooter>
          {!podeAlterar && <span className="mr-auto text-xs text-muted-foreground">Só quem tem a ação Alterar neste item define o tratamento.</span>}
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Botão do cabeçalho das telas que usam a regra. Aparece só para quem pode ver a configuração.
export function BotaoTratamentoContratos() {
  const { data: pode } = useScreenAccess("controladoria-tratamento-contratos", "visualizar");
  const [aberto, setAberto] = useState(false);
  if (!pode) return null;
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5 print:hidden" onClick={() => setAberto(true)}>
        <Settings2 className="h-3.5 w-3.5" /> Tratamento dos contratos
      </Button>
      <TratamentoContratosDialog aberto={aberto} onFechar={() => setAberto(false)} />
    </>
  );
}
