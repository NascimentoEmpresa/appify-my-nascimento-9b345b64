import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { useOscHistorico, type OscHistorico } from "@/hooks/useOscCanaa";
import { CtxOsc } from "./comum";

const TABELA_LABEL: Record<string, string> = {
  OSC_PARCERIA: "Parceria",
  OSC_ANO: "Premissas do ano",
  OSC_RUBRICA: "Rubrica",
  OSC_RUBRICA_CLASSIFICACAO: "De-para",
  OSC_COMPETENCIA: "Competência",
  OSC_PREVISAO: "Custo de referência",
  OSC_PREVISAO_MES: "Previsto do mês",
  OSC_LANCAMENTO: "Lançamento",
  OSC_PAGAMENTO_AJUSTE: "Revisão de pagamento",
  OSC_PROJETO: "Projeto",
};
const ACAO_LABEL: Record<string, string> = { INSERT: "Incluiu", UPDATE: "Alterou", DELETE: "Excluiu" };
const IGNORAR = new Set(["id", "parceria_id", "created_at", "updated_at", "created_by", "updated_by"]);

function resumo(h: OscHistorico) {
  const fmt = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  if (h.acao === "UPDATE" && h.antes && h.depois) {
    return Object.keys(h.depois)
      .filter((k) => !IGNORAR.has(k) && JSON.stringify(h.antes![k]) !== JSON.stringify(h.depois![k]))
      .map((k) => `${k}: ${fmt(h.antes![k])} → ${fmt(h.depois![k])}`)
      .join(" · ");
  }
  const reg = h.depois ?? h.antes ?? {};
  return Object.entries(reg).filter(([k, v]) => !IGNORAR.has(k) && v !== null).map(([k, v]) => `${k}: ${fmt(v)}`).join(" · ");
}

export function HistoricoOsc({ ctx }: { ctx: CtxOsc }) {
  const hist = useOscHistorico(ctx.parceria.id);
  const [tabela, setTabela] = useState("todas");
  const linhas = (hist.data ?? []).filter((h) => tabela === "todas" || h.tabela === tabela);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Trilha de alterações (últimas 500)</span>
          <Select value={tabela} onValueChange={setTabela}>
            <SelectTrigger className="ml-auto h-8 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Tudo</SelectItem>
              {Object.entries(TABELA_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {hist.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <Table className="text-xs">
            <TableHeader><TableRow><TableHead>Quando</TableHead><TableHead>Quem</TableHead><TableHead>O quê</TableHead><TableHead>Detalhe</TableHead></TableRow></TableHeader>
            <TableBody>
              {linhas.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem alterações registradas.</TableCell></TableRow>}
              {linhas.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="whitespace-nowrap">{new Date(h.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="whitespace-nowrap">{h.usuario_nome ?? "sistema"}</TableCell>
                  <TableCell className="whitespace-nowrap">{ACAO_LABEL[h.acao] ?? h.acao} {TABELA_LABEL[h.tabela] ?? h.tabela}</TableCell>
                  <TableCell className="max-w-[640px] break-words text-muted-foreground">{resumo(h)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">A carga inicial da planilha (migration) não aparece aqui; os lançamentos dela levam a referência da célula de origem.</p>
      </CardContent>
    </Card>
  );
}
