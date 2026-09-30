import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, ClipboardList, ExternalLink, FileText, Loader2, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// =====================================================================
// ENCARREGADOS › Nascimento Formulários (30/09/2026, mig 276)
//
// "Os encarregados só têm acesso APENAS A ALGUNS FORMULÁRIOS ... ELES SÓ
// PODEM ABRIR OS FORMULÁRIOS e ver as PRÓPRIAS RESPOSTAS, NADA MAIS!" (Pablo)
//
// Aparecem só os formulários publicados que a Central de Serviços liberou
// para o setor ENCARREGADOS (público-alvo do formulário). Duas ações:
// responder (a página pública do formulário, que já exige o login e confere
// o público-alvo no banco) e ver as próprias respostas. Tudo vem de RPC
// SECURITY DEFINER (cs_form_encarregados_*): o encarregado não ganha nenhuma
// capacidade nos formulários em geral — nem lê a tabela de respostas.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

interface FormEnc {
  id: string; titulo: string; descricao: string | null; slug: string; imagem_capa_url: string | null;
  inicia_em: string | null; encerra_em: string | null; aberto: boolean;
  minhas_respostas: number; ultima_resposta: string | null;
}
interface Pergunta { id: string; tipo: string; titulo: string }
interface MinhasRespostas {
  titulo: string; perguntas: Pergunta[];
  respostas: { id: string; enviado_em: string; itens: Record<string, unknown> }[];
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/** Valor de uma resposta em texto legível (lista, pergunta de colegas, anexo…). */
function valorTexto(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) {
    if (!v.length) return "—";
    return v.map((x) => (x && typeof x === "object"
      ? [(x as any).colaborador, (x as any).setor, (x as any).nota != null ? `nota ${(x as any).nota}` : null, (x as any).comentario].filter(Boolean).join(" · ")
      : String(x))).join("; ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function FormulariosEncarregados() {
  const q = useQuery({
    queryKey: ["cs-form-encarregados"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("cs_form_encarregados_lista");
      if (error) throw error;
      return (data ?? []) as FormEnc[];
    },
  });
  const [vendo, setVendo] = useState<FormEnc | null>(null);
  const lista = q.data ?? [];

  return (
    <div>
      <PageHeader
        title="Nascimento Formulários"
        subtitle="Os formulários liberados para os encarregados. Responda e confira as suas respostas."
        module="Encarregados"
        breadcrumb={["Nascimento Formulários"]}
      />

      {q.isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando formulários…</Card>
      ) : q.isError ? (
        <Card className="p-6 text-sm text-destructive">Não deu para carregar os formulários: {(q.error as Error).message}</Card>
      ) : lista.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <ClipboardList className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">Nenhum formulário disponível no momento</p>
          <p className="text-sm text-muted-foreground">Quando a Central de Serviços liberar um formulário para os encarregados, ele aparece aqui.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lista.map((f) => (
            <Card key={f.id} className="flex flex-col overflow-hidden">
              <div className="flex h-28 items-center justify-center bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
                {f.imagem_capa_url
                  ? <img src={f.imagem_capa_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  : <FileText className="h-10 w-10 text-primary/40" />}
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {f.aberto
                      ? <Badge variant="outline" className="border-success/40 bg-success/10 text-[10px] text-success">Aberto</Badge>
                      : <Badge variant="outline" className="text-[10px] text-muted-foreground"><Lock className="mr-1 h-3 w-3" /> Fechado</Badge>}
                    {f.minhas_respostas > 0 && (
                      <Badge variant="outline" className="border-primary/40 bg-primary/5 text-[10px] text-primary">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Respondido {f.minhas_respostas}x
                      </Badge>
                    )}
                  </div>
                  <h3 className="font-semibold leading-tight">{f.titulo}</h3>
                  {f.descricao && <p className="line-clamp-3 text-sm text-muted-foreground">{f.descricao}</p>}
                  {f.encerra_em && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" /> Até {fmt(f.encerra_em)}</p>
                  )}
                </div>
                <div className="mt-auto flex flex-col gap-2 pt-1">
                  <Button asChild disabled={!f.aberto} className="w-full gap-2">
                    {f.aberto
                      ? <a href={`/formularios/${f.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Responder</a>
                      : <span><Lock className="h-4 w-4" /> Fechado para respostas</span>}
                  </Button>
                  <Button variant="outline" className="w-full" disabled={!f.minhas_respostas} onClick={() => setVendo(f)}>
                    Minhas respostas ({f.minhas_respostas})
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {vendo && <MinhasRespostasDialog form={vendo} onFechar={() => setVendo(null)} />}
    </div>
  );
}

function MinhasRespostasDialog({ form, onFechar }: { form: FormEnc; onFechar: () => void }) {
  const q = useQuery({
    queryKey: ["cs-form-encarregados-minhas", form.id],
    queryFn: async () => {
      const { data, error } = await sb.rpc("cs_form_encarregados_minhas_respostas", { _form_id: form.id });
      if (error) throw error;
      return data as MinhasRespostas;
    },
  });
  const perguntas = (q.data?.perguntas ?? []).filter((p) => p.tipo !== "texto_info");

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Minhas respostas</DialogTitle>
          <DialogDescription>{form.titulo}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
        ) : q.isError ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : !q.data?.respostas.length ? (
          <p className="text-sm text-muted-foreground">Você ainda não respondeu este formulário.</p>
        ) : (
          <div className="space-y-4">
            {q.data.respostas.map((r, i) => (
              <div key={r.id} className="rounded-lg border p-3">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">
                  Resposta {q.data!.respostas.length - i} · enviada em {fmt(r.enviado_em)}
                </p>
                <div className="space-y-2">
                  {perguntas.map((p) => (
                    <div key={p.id} className="text-sm">
                      <p className="text-xs font-semibold text-muted-foreground">{p.titulo}</p>
                      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{valorTexto(r.itens?.[p.id])}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
