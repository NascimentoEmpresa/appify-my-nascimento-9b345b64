// Estúdio de BI — a lista de painéis.
//
// Quem tem 'visualizar' vê os painéis públicos e os próprios; 'incluir' cria;
// a IA cria um painel inteiro a partir de um texto (botão "Criar com IA").
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useMeuNome } from "@/hooks/useMeuNome";
import { supabase } from "@/integrations/supabase/client";
import { usePaineisBi, useSalvarPainelBi } from "@/hooks/useBiEstudio";
import { BarChart3, Globe, Lock, Plus, Search, Sparkles, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { AssistenteIA } from "./AssistenteIA";
import type { Painel, WidgetRascunho } from "@/lib/bi/estudio";

function fmtData(s: string) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

export default function BiEstudioPaineis() {
  const nav = useNavigate();
  const meuNome = useMeuNome();
  const { data: paineis = [], isLoading } = usePaineisBi();
  const salvar = useSalvarPainelBi();
  const [busca, setBusca] = useState("");
  const [iaAberta, setIaAberta] = useState(false);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? paineis.filter(p => `${p.nome} ${p.descricao ?? ""} ${p.dono_nome ?? ""}`.toLowerCase().includes(q)) : paineis;
  }, [paineis, busca]);

  const criarVazio = async () => {
    try {
      const p = await salvar.mutateAsync({ nome: "Novo painel", descricao: null, publico: false, filtros: [], config: {}, dono_nome: meuNome || null });
      nav(`/app/bi/estudio/${p.id}?editar=1`);
    } catch (e) {
      toast.error("Não consegui criar o painel: " + (e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Estúdio de BI"
        subtitle="Painéis montados aqui dentro: gráficos, KPIs e tabelas a partir de qualquer dado do ERP — escritos à mão ou pedidos por texto para a IA."
        module="BI & Analytics"
        breadcrumb={["Estúdio de BI"]}
        actions={
          <>
            <AcessoGate menu="bi_estudio" acao="executar_ia">
              <Button variant="outline" onClick={() => setIaAberta(true)}>
                <Sparkles className="mr-2 h-4 w-4" /> Criar painel com IA
              </Button>
            </AcessoGate>
            <AcessoGate menu="bi_estudio" acao="incluir">
              <Button onClick={criarVazio} disabled={salvar.isPending}>
                <Plus className="mr-2 h-4 w-4" /> Novo painel
              </Button>
            </AcessoGate>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar painel…" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <span className="text-xs text-muted-foreground">{lista.length} painel{lista.length === 1 ? "" : "is"}</span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <WandSparkles className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhum painel ainda. Crie um vazio e monte os gráficos, ou descreva o painel que você quer e deixe a IA montar.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lista.map(p => <CardPainel key={p.id} painel={p} onAbrir={() => nav(`/app/bi/estudio/${p.id}`)} />)}
        </div>
      )}

      {iaAberta && (
        <CriarPainelComIa onFechar={() => setIaAberta(false)} meuNome={meuNome} />
      )}
    </div>
  );
}

function CardPainel({ painel, onAbrir }: { painel: Painel; onAbrir: () => void }) {
  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onAbrir}>
      <CardContent className="p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><BarChart3 className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{painel.nome}</p>
              <p className="text-xs text-muted-foreground">{painel.dono_nome || "—"} · {fmtData(painel.atualizado_em)}</p>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
            {painel.publico ? <><Globe className="h-3 w-3" /> Público</> : <><Lock className="h-3 w-3" /> Privado</>}
          </Badge>
        </div>
        {painel.descricao && <p className="line-clamp-2 text-xs text-muted-foreground">{painel.descricao}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * "Criar painel com IA": a IA devolve painel + widgets; aqui a gente cria o
 * painel, grava os widgets que rodaram e abre em modo edição.
 */
function CriarPainelComIa({ onFechar, meuNome }: { onFechar: () => void; meuNome: string }) {
  const nav = useNavigate();
  const salvarPainel = useSalvarPainelBi();

  const aplicar = async (widgets: WidgetRascunho[], painel: { nome: string; descricao: string | null; filtros: any[] } | null) => {
    try {
      const p = await salvarPainel.mutateAsync({
        nome: painel?.nome ?? "Painel da IA", descricao: painel?.descricao ?? null, publico: false,
        filtros: painel?.filtros ?? [], config: {}, dono_nome: meuNome || null,
      });
      const sb = supabase as any;
      let ordem = 0;
      for (const w of widgets.filter(w => w.ok !== false)) {
        const { error } = await sb.from("BI_WIDGET").insert({
          painel_id: p.id, titulo: w.titulo, subtitulo: w.subtitulo, tipo: w.tipo, sql: w.sql, config: w.config,
          largura: w.largura, altura: w.altura, ordem: ordem++, criado_por_ia: true,
        });
        if (error) throw error;
      }
      toast.success(`Painel "${p.nome}" criado com ${ordem} gráfico${ordem === 1 ? "" : "s"}.`);
      onFechar();
      nav(`/app/bi/estudio/${p.id}?editar=1`);
    } catch (e) {
      toast.error("Não consegui criar o painel: " + (e as Error).message);
    }
  };

  return (
    <AssistenteIA
      aberto
      onFechar={onFechar}
      modo="painel"
      painelId={null}
      filtros={[]}
      params={{}}
      onAplicar={aplicar}
      salvando={salvarPainel.isPending}
    />
  );
}
