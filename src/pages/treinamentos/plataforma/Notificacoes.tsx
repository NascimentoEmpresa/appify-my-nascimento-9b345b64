import { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTrnAlcance, useTrnEnviarNotificacao, useTrnNotificacoes, useTrnTags } from "@/hooks/useTreinamentosPlataforma";
import { MENU, type Publico } from "./tipos";
import { PublicoPicker, TrnEstilo, TrnHero, fmtDataHora } from "./ui";

// =====================================================================
// TREINAMENTOS — Comunicação › Notificações personalizadas.
// Título, mensagem, URL, público; mostra ANTES de enviar quantos alunos
// serão alcançados (RPC trn_alcance) e a lista das últimas enviadas com o
// alcance real. Limite de 1 a cada 5 minutos, como no membox (a RPC
// recusa). Entrega no app/portal é a fase 2 — hoje fica registrada por
// aluno em TRN_NOTIFICACAO_ALUNO, pronta para o portal ler.
// =====================================================================

export default function Notificacoes() {
  const { data: enviadas = [] } = useTrnNotificacoes();
  const { data: tags = [] } = useTrnTags();
  const enviar = useTrnEnviarNotificacao();
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [url, setUrl] = useState("");
  const [publico, setPublico] = useState<Publico>("todos");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const { data: alcance } = useTrnAlcance(publico, tagIds);

  const disparar = async () => {
    if (!titulo.trim()) return toast.error("Informe o título.");
    if (!mensagem.trim()) return toast.error("Informe a mensagem.");
    if (publico === "tags" && tagIds.length === 0) return toast.error("Escolha ao menos uma tag.");
    if (!window.confirm(`Enviar "${titulo}" para ${alcance ?? 0} aluno(s)?`)) return;
    try {
      const r = await enviar.mutateAsync({ titulo: titulo.trim(), mensagem: mensagem.trim(), url: url.trim() || null, publico, tagIds });
      toast.success(`Notificação enviada para ${r.alcance} aluno(s).`);
      setTitulo(""); setMensagem(""); setUrl("");
    } catch (e: any) { toast.error(e?.message ?? "Não deu para enviar."); }
  };
  const nomeTags = (ids: { tag_id: string }[]) => ids.map((t) => tags.find((x) => x.id === t.tag_id)?.nome).filter(Boolean).join(", ");

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.notificacoes} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para as notificações.</Card>}>
        <TrnHero eyebrow="Treinamentos › Comunicação" titulo="Notificações personalizadas" texto="Crie notificações para seus alunos. Elas são entregues individualmente, na plataforma e no aplicativo." />
        <div className="trn-lateral">
          <div className="trn-form">
            <div className="grupo">
              <h4>Adicionar informações</h4>
              <div className="grid gap-3">
                <div className="campo"><label>Título da notificação *</label><Input placeholder="Informe um título breve e descritivo" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
                <div className="campo"><label>Mensagem da notificação *</label><Textarea rows={4} placeholder="Informe o conteúdo exibido na notificação" value={mensagem} onChange={(e) => setMensagem(e.target.value)} /></div>
                <div className="campo"><label>URL da notificação (opcional)</label><Input placeholder="Informe a URL destino para uma página externa" value={url} onChange={(e) => setUrl(e.target.value)} /><div className="ajuda">Na plataforma e no app, o aluno é levado direto ao link.</div></div>
              </div>
            </div>
            <div className="grupo">
              <h4>Enviar notificação para *</h4>
              <PublicoPicker publico={publico} tagIds={tagIds} onPublico={setPublico} onTags={setTagIds} verboTodos="Enviar" verboTags="Enviar apenas" />
              <div className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm">Esta notificação será disparada para: <b>{alcance ?? "…"} aluno(s)</b> · Plataforma web · Aplicativo móvel</div>
              <p className="mt-1 text-xs text-muted-foreground">Revise as informações antes de enviar. Limite: uma notificação a cada 5 minutos.</p>
            </div>
            <AcessoGate menu={MENU.notificacoes} acao="incluir" fallback={<p className="text-xs text-muted-foreground">Você pode ver o histórico, mas não tem a ação de enviar.</p>}>
              <div><Button disabled={enviar.isPending} onClick={disparar}><Send className="mr-2 h-4 w-4" /> Enviar notificação</Button></div>
            </AcessoGate>
          </div>

          <div className="space-y-3">
            <div className="trn-card">
              <h3>Últimas notificações enviadas</h3>
              <div className="sub">{enviadas.length ? `${enviadas.length} disparo(s)` : "Nenhuma ainda."}</div>
              <div className="max-h-[520px] space-y-2 overflow-y-auto">
                {enviadas.map((n) => (
                  <div key={n.id} className="rounded-xl border p-3">
                    <b className="block text-sm text-slate-900">{n.titulo}</b>
                    <p className="text-xs text-slate-600">{n.mensagem}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span className="trn-badge" style={{ background: "#f26522", color: "#fff" }}>{n.publico === "todos" ? "Todos os alunos" : nomeTags(n.tags ?? []) || "Tags"}</span>
                      <span>{n.alcance} aluno(s)</span><span>· {fmtDataHora(n.enviada_em)}</span>{n.autor_nome && <span>· {n.autor_nome}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="trn-ajuda"><h4>Limites</h4>As notificações chegam na plataforma e no app. Cuide da frequência para não sobrecarregar os alunos: o envio é limitado a uma a cada 5 minutos.</div>
          </div>
        </div>
      </AcessoGate>
    </div>
  );
}
