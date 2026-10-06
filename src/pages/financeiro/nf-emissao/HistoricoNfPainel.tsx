import { useHistoricoNfEmissao, useUsuariosAtivos } from "@/hooks/useNfEmissao";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { cn } from "@/lib/utils";
import {
  FilePlus2, Pencil, Send, CheckCircle2, Ban, CircleDollarSign, Undo2, RefreshCw, SlidersHorizontal, History,
} from "lucide-react";

// Rótulo, ícone e cor por tipo de ação — o usuário bate o olho na linha do tempo
// e entende o que aconteceu sem ler o texto. Ação desconhecida (ou futura) cai
// no padrão e mostra o `detalhe` como sempre mostrou.
const ACOES: Record<string, { rotulo: string; icone: typeof History; cor: string }> = {
  nf_criada: { rotulo: "NF criada", icone: FilePlus2, cor: "text-sky-600 bg-sky-500/10" },
  nf_editada: { rotulo: "NF editada", icone: Pencil, cor: "text-slate-600 bg-slate-500/10" },
  nf_enviada: { rotulo: "Enviada ao Financeiro", icone: Send, cor: "text-indigo-600 bg-indigo-500/10" },
  enviada: { rotulo: "Enviada ao Financeiro", icone: Send, cor: "text-indigo-600 bg-indigo-500/10" },
  nf_concluida: { rotulo: "NF concluída", icone: CheckCircle2, cor: "text-emerald-600 bg-emerald-500/10" },
  concluida: { rotulo: "NF concluída", icone: CheckCircle2, cor: "text-emerald-600 bg-emerald-500/10" },
  nf_cancelada: { rotulo: "NF cancelada", icone: Ban, cor: "text-destructive bg-destructive/10" },
  nf_paga: { rotulo: "Pagamento registrado", icone: CircleDollarSign, cor: "text-emerald-600 bg-emerald-500/10" },
  pagamento_removido: { rotulo: "Pagamento removido", icone: Undo2, cor: "text-amber-600 bg-amber-500/10" },
  reconciliacao_atualizada: { rotulo: "Reconciliação atualizada", icone: RefreshCw, cor: "text-slate-600 bg-slate-500/10" },
  valores_nf_concluida_ajustados: { rotulo: "Valores ajustados após a conclusão", icone: SlidersHorizontal, cor: "text-violet-700 bg-violet-500/10" },
};

interface AntesDepois { antes: number; depois: number }
export interface AjusteValoresDados {
  tipo: "ajuste_valores";
  motivo: string;
  legado_convertido?: boolean;
  itens: {
    identificacao: string;
    campos: { campo: string; antes: number; depois: number }[];
    bruto: AntesDepois;
    inss: AntesDepois;
    liquido: AntesDepois;
  }[];
  totais: { bruto: AntesDepois; inss: AntesDepois; liquido: AntesDepois };
}

function Variacao({ v, invertido }: { v: AntesDepois; invertido?: boolean }) {
  const dif = Math.round((v.depois - v.antes) * 100) / 100;
  if (dif === 0) return <span>{fmtMoney(v.depois)}</span>;
  // Líquido/bruto menores = valor "pior" para quem recebe; INSS maior idem — só cor suave.
  const sobe = dif > 0;
  const ruim = invertido ? sobe : !sobe;
  return (
    <span>
      <span className="text-muted-foreground line-through">{fmtMoney(v.antes)}</span>{" "}
      <span className={cn("font-medium", ruim ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
        {fmtMoney(v.depois)}
      </span>{" "}
      <span className="text-[10px] text-muted-foreground">({sobe ? "+" : "−"}{fmtMoney(Math.abs(dif))})</span>
    </span>
  );
}

function DetalheAjuste({ dados }: { dados: AjusteValoresDados }) {
  return (
    <div className="mt-2 space-y-2">
      <p className="rounded bg-muted/50 px-2 py-1 text-xs">
        <span className="font-medium">Motivo: </span>{dados.motivo}
      </p>
      {dados.legado_convertido && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          Nota importada da planilha: com VA/VT/materiais informados, passou a ser recalculada pelo ERP.
        </p>
      )}
      {dados.itens.map((it, i) => (
        <div key={i} className="overflow-x-auto rounded border">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-1 font-medium" colSpan={3}>{it.identificacao}</th>
              </tr>
            </thead>
            <tbody>
              {it.campos.map((c) => (
                <tr key={c.campo} className="border-t">
                  <td className="px-2 py-1">{c.campo}</td>
                  <td className="px-2 py-1 text-muted-foreground line-through">{fmtMoney(c.antes)}</td>
                  <td className="px-2 py-1 font-medium">{fmtMoney(c.depois)}</td>
                </tr>
              ))}
              <tr className="border-t bg-muted/20">
                <td className="px-2 py-1 text-muted-foreground">Bruto</td>
                <td className="px-2 py-1" colSpan={2}><Variacao v={it.bruto} /></td>
              </tr>
              <tr className="border-t bg-muted/20">
                <td className="px-2 py-1 text-muted-foreground">INSS</td>
                <td className="px-2 py-1" colSpan={2}><Variacao v={it.inss} invertido /></td>
              </tr>
              <tr className="border-t bg-muted/20">
                <td className="px-2 py-1 text-muted-foreground">Líquido</td>
                <td className="px-2 py-1" colSpan={2}><Variacao v={it.liquido} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      <p className="text-xs">
        <span className="font-medium">Total da nota — </span>
        Bruto: <Variacao v={dados.totais.bruto} /> · INSS: <Variacao v={dados.totais.inss} invertido /> · Líquido: <Variacao v={dados.totais.liquido} />
      </p>
    </div>
  );
}

function dataHora(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export function HistoricoNfPainel({ nfEmissaoId }: { nfEmissaoId: string | null | undefined }) {
  const { data: logs = [] } = useHistoricoNfEmissao(nfEmissaoId);
  const { data: usuarios = [] } = useUsuariosAtivos();

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem histórico ainda.</p>;
  }

  return (
    <ol className="relative space-y-3 border-l border-border pl-5">
      {logs.map((l) => {
        const nome = usuarios.find((u) => u.id === l.user_id)?.display_name ?? "Usuário";
        const acao = ACOES[l.acao] ?? { rotulo: "Registro", icone: History, cor: "text-muted-foreground bg-muted" };
        const Icone = acao.icone;
        const dados = (l as any).dados as AjusteValoresDados | null | undefined;
        const ajuste = dados?.tipo === "ajuste_valores" ? dados : null;
        return (
          <li key={l.id} className="relative">
            <span className={cn("absolute -left-[31px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full", acao.cor)}>
              <Icone className="h-3 w-3" />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium">{acao.rotulo}</span>
              <span className="text-xs text-muted-foreground">por {nome} · {dataHora(l.created_at)}</span>
            </div>
            {ajuste ? <DetalheAjuste dados={ajuste} /> : <p className="mt-0.5 text-xs text-muted-foreground">{l.detalhe}</p>}
          </li>
        );
      })}
    </ol>
  );
}
