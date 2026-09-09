import { useMemo, useState } from "react";
import { BellRing, Loader2, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useNotificacoes } from "@/hooks/useNotificacoes";
import {
  erroDoFormulario, fmtDataHora, resumoDasRespostas,
  type CienciaNotificacao, type FormNotificacao,
} from "@/lib/notificacoes";

const VAZIO: FormNotificacao = { titulo: "", mensagem: "", publicado: true };

/**
 * Gestão das Notificações — criar, publicar e ver quem respondeu.
 *
 * Fica ao lado de Novidades porque é a mesma pessoa que usa as duas, e a
 * diferença entre elas é o que precisa ficar claro na tela: a novidade se lê
 * se quiser, a notificação PARA a tela até a pessoa responder.
 */
export function NotificacoesPainel() {
  const { notificacoes, historico, podePublicar, salvar, excluir } = useNotificacoes();
  const [form, setForm] = useState<FormNotificacao | null>(null);

  /** Respostas agrupadas por notificação — é o histórico da lista. */
  const porNotificacao = useMemo(() => {
    const mapa = new Map<number, CienciaNotificacao[]>();
    for (const c of historico) {
      const atual = mapa.get(c.notificacao_id) ?? [];
      atual.push(c);
      mapa.set(c.notificacao_id, atual);
    }
    return mapa;
  }, [historico]);

  if (!podePublicar) return null;

  const gravar = async () => {
    if (!form) return;
    const erro = erroDoFormulario(form);
    if (erro) { toast.error(erro); return; }
    try {
      await salvar.mutateAsync(form);
      toast.success(form.id ? "Notificação atualizada." : "Notificação publicada.");
      setForm(null);
    } catch (e) {
      toast.error(`Não deu para salvar: ${e instanceof Error ? e.message : "erro desconhecido"}`);
    }
  };

  const remover = async (id: number, titulo: string) => {
    // O DELETE leva o histórico junto (CASCADE) — por isso a confirmação diz
    // isso, em vez de um "tem certeza?" genérico.
    if (!confirm(`Remover "${titulo}"? O histórico de quem respondeu vai junto.`)) return;
    try {
      await excluir.mutateAsync(id);
      toast.success("Notificação removida.");
    } catch (e) {
      toast.error(`Não deu para remover: ${e instanceof Error ? e.message : "erro desconhecido"}`);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white">
              <BellRing className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold leading-tight">Notificações</h3>
              <p className="text-sm text-muted-foreground">
                Aparecem no centro da tela e só saem depois que a pessoa clicar em
                Concordo ou Discordo. A resposta fica registrada.
              </p>
            </div>
          </div>
          {!form && (
            <Button size="sm" onClick={() => setForm({ ...VAZIO })}>
              <Plus className="mr-1.5 h-4 w-4" /> Nova notificação
            </Button>
          )}
        </div>

        {form && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div>
              <Label htmlFor="notif-titulo">Título</Label>
              <Input
                id="notif-titulo"
                className="mt-1"
                placeholder="Ex.: Nova política de home office"
                value={form.titulo}
                onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="notif-msg">Mensagem</Label>
              <Textarea
                id="notif-msg"
                className="mt-1 min-h-28"
                placeholder="O que a pessoa precisa ler antes de responder."
                value={form.mensagem}
                onChange={(e) => setForm({ ...form, mensagem: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.publicado}
                onChange={(e) => setForm({ ...form, publicado: e.target.checked })}
              />
              Publicar agora — desmarcado, fica como rascunho e não aparece para ninguém
            </label>
            <div className="flex gap-2">
              <Button onClick={gravar} disabled={salvar.isPending}>
                {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
              <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {notificacoes.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma notificação ainda.
            </p>
          )}

          {notificacoes.map((n) => {
            const respostas = porNotificacao.get(n.id) ?? [];
            return (
              <div key={n.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{n.titulo}</span>
                      {!n.publicado && <Badge variant="outline">Rascunho</Badge>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{n.mensagem}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {fmtDataHora(n.publicado_em)}
                      {n.criado_por_nome ? ` · ${n.criado_por_nome}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setForm({
                        id: n.id, titulo: n.titulo, mensagem: n.mensagem, publicado: n.publicado,
                      })}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => remover(n.id, n.titulo)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {/* O HISTÓRICO. É o motivo de a notificação existir: saber que
                    a pessoa leu, o que respondeu e quando. */}
                <div className="mt-2 border-t pt-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> {resumoDasRespostas(respostas)}
                  </p>
                  {respostas.length > 0 && (
                    <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                      {respostas.map((r) => (
                        <li key={r.user_id} className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={r.escolha === "CONCORDO"
                              ? "border-green-300 text-green-700"
                              : "border-amber-300 text-amber-700"}
                          >
                            {r.escolha}
                          </Badge>
                          <span className="font-mono">{r.user_id.slice(0, 8)}</span>
                          <span>{fmtDataHora(r.respondido_em)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
