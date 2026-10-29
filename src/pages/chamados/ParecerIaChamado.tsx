// =====================================================================
// PARECER DA I.A DO CHAMADO (mig 20261029000900, Edge chamado-parecer-ia)
//
// Três preços médios de mercado (freelancer, software house, equipe
// interna — cada um com valor/hora × horas e a explicação) e a complexidade
// de 1 a 5. O parecer é GERADO uma vez (na abertura do chamado, pela fila)
// e guardado em CHAMADO_SISTEMA_PARECER_IA: abrir a tela só lê de lá.
//
// Falha da I.A aparece NA TELA (status 'erro' + mensagem) — a memória do
// projeto registra que, nas outras I.As, a falha era silenciosa e ninguém
// descobria por quê não havia nada.
// =====================================================================
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { fmtDataHora } from "./types";

export interface PrecoParecerIa {
  perfil: string;
  rotulo: string;
  valor_hora: number;
  horas: number;
  valor: number;
  embasamento: string;
  explicacao: string;
}

export interface ParecerIa {
  chamado_id: string;
  status: "pendente" | "pronto" | "erro";
  precos: PrecoParecerIa[];
  valor_medio: number | null;
  horas_estimadas: number | null;
  complexidade_nivel: number | null;
  complexidade_rotulo: string | null;
  complexidade_justificativa: string | null;
  premissas: string | null;
  provedor: string | null;
  modelo: string | null;
  erro: string | null;
  gerado_em: string | null;
}

export type ResumoParecerIa = Pick<ParecerIa, "chamado_id" | "status" | "valor_medio" | "complexidade_nivel" | "complexidade_rotulo" | "erro">;

export const fmtReais = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// Cor por nível: 1-2 tranquilo, 3 atenção, 4-5 pesado.
const corNivel = (n: number | null | undefined) =>
  n == null ? "border-border bg-muted text-muted-foreground"
  : n <= 2 ? "border-success/30 bg-success/10 text-success"
  : n === 3 ? "border-warning/30 bg-warning/10 text-warning"
  : "border-destructive/30 bg-destructive/10 text-destructive";

export function SeloComplexidade({ nivel, rotulo }: { nivel: number | null | undefined; rotulo?: string | null }) {
  if (nivel == null) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${corNivel(nivel)}`}>
      {nivel}/5{rotulo ? ` · ${rotulo}` : ""}
    </span>
  );
}

async function gerarParecer(chamadoId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("chamado-parecer-ia", { body: { chamado_id: chamadoId } });
  if (error) {
    // A mensagem útil vem no corpo (403 sem permissão, 429 sem tokens).
    const ctx = (error as { context?: Response }).context;
    const corpo = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    throw new Error(corpo?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
}

/** Resumo de TODOS os pareceres que o usuário enxerga (a RLS recorta), para
 *  as listas dos painéis. Só as colunas do selo — o detalhe fica na tela. */
export function useResumosParecerIa(enabled = true) {
  const { data = {} } = useQuery({
    queryKey: ["chamado-parecer-ia", "resumos"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHAMADO_SISTEMA_PARECER_IA")
        .select("chamado_id, status, valor_medio, complexidade_nivel, complexidade_rotulo, erro");
      if (error) throw error;
      const m: Record<string, ResumoParecerIa> = {};
      ((data ?? []) as ResumoParecerIa[]).forEach((p) => { m[p.chamado_id] = p; });
      return m;
    },
  });
  return data;
}

/** Linha curta para as listas: "~R$ 2.400 · 3/5 Média". */
export function ResumoParecerIaLinha({ resumo }: { resumo?: ResumoParecerIa }) {
  if (!resumo) return null;
  if (resumo.status === "pendente") {
    return <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Sparkles className="h-3 w-3" /> parecer da I.A em preparo…</span>;
  }
  if (resumo.status === "erro") {
    return <span className="inline-flex items-center gap-1 text-[10px] text-destructive" title={resumo.erro ?? ""}><AlertTriangle className="h-3 w-3" /> parecer da I.A falhou</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px]" title="Parecer da I.A: valor médio de mercado e complexidade">
      <Sparkles className="h-3 w-3 text-primary" />
      <span className="font-semibold">~{fmtReais(resumo.valor_medio)}</span>
      <SeloComplexidade nivel={resumo.complexidade_nivel} rotulo={resumo.complexidade_rotulo} />
    </span>
  );
}

export function ParecerIaChamado({ chamadoId, podeGerar }: { chamadoId: string; podeGerar: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [gerando, setGerando] = useState(false);
  const [erroBotao, setErroBotao] = useState<string | null>(null);

  const { data: parecer, isLoading, error: erroLeitura } = useQuery({
    queryKey: ["chamado-parecer-ia", chamadoId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHAMADO_SISTEMA_PARECER_IA").select("*").eq("chamado_id", chamadoId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as ParecerIa | null;
    },
    // Enquanto a fila gera, confere de tempos em tempos — sem F5.
    refetchInterval: (q) => ((q.state.data as ParecerIa | null | undefined)?.status === "pendente" ? 8000 : false),
  });

  const gerar = async () => {
    setGerando(true);
    setErroBotao(null);
    try {
      await gerarParecer(chamadoId);
      toast({ title: "Parecer da I.A gerado" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErroBotao(msg);
      toast({ title: "A I.A não gerou o parecer", description: msg, variant: "destructive" });
    } finally {
      setGerando(false);
      qc.invalidateQueries({ queryKey: ["chamado-parecer-ia"] });
    }
  };

  const botao = podeGerar && (
    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={gerar} disabled={gerando}>
      {gerando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      {parecer?.status === "pronto" ? "Gerar de novo" : "Gerar parecer"}
    </Button>
  );

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold"><Sparkles className="h-4 w-4 text-primary" /> Parecer da I.A</p>
        {botao}
      </div>

      {erroLeitura && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          Não foi possível ler o parecer: {(erroLeitura as Error).message}
        </p>
      )}
      {erroBotao && parecer?.status === "pronto" && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          A nova geração falhou — o parecer abaixo é o anterior. Motivo: {erroBotao}
        </p>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : gerando && parecer?.status !== "pronto" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> A I.A está avaliando o chamado…</p>
      ) : !parecer ? (
        <p className="text-xs text-muted-foreground">
          Este chamado ainda não tem parecer.{podeGerar ? " Clique em “Gerar parecer”." : ""}
        </p>
      ) : parecer.status === "pendente" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> A I.A está preparando o parecer — aparece aqui sozinho em instantes.</p>
      ) : parecer.status === "erro" ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">A I.A não conseguiu gerar o parecer.</p>
            <p className="mt-0.5 [overflow-wrap:anywhere]">{parecer.erro || "Erro sem mensagem."}</p>
            {podeGerar && <p className="mt-1 text-muted-foreground">Tente de novo pelo botão acima.</p>}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Valor médio de mercado</p>
              <p className="text-2xl font-bold">{fmtReais(parecer.valor_medio)}</p>
              {parecer.horas_estimadas != null && (
                <p className="text-[11px] text-muted-foreground">~{parecer.horas_estimadas.toLocaleString("pt-BR")} h em média</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Complexidade</p>
              <SeloComplexidade nivel={parecer.complexidade_nivel} rotulo={parecer.complexidade_rotulo} />
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            {(parecer.precos ?? []).map((p) => (
              <div key={p.perfil} className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold">{p.rotulo}</p>
                <p className="mt-1 text-lg font-bold">{fmtReais(p.valor)}</p>
                <p className="text-[11px] font-medium text-muted-foreground">
                  {fmtReais(p.valor_hora)}/h × {Number(p.horas).toLocaleString("pt-BR")} h
                </p>
                {p.explicacao && <p className="mt-1.5 text-[11px] leading-snug">{p.explicacao}</p>}
                {p.embasamento && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{p.embasamento}</p>}
              </div>
            ))}
          </div>

          {parecer.complexidade_justificativa && (
            <div>
              <p className="text-xs font-semibold">Por que essa complexidade</p>
              <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{parecer.complexidade_justificativa}</p>
            </div>
          )}
          {parecer.premissas && (
            <div>
              <p className="text-xs font-semibold">Premissas</p>
              <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{parecer.premissas}</p>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Estimativa automática, não é orçamento. Gerado em {fmtDataHora(parecer.gerado_em)}{parecer.modelo ? ` · ${parecer.modelo}` : ""}.
          </p>
        </>
      )}
    </Card>
  );
}
