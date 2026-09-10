// Arquivo: src/pages/bi/LinksBIs.tsx
//
// BI & Analytics › Links dos BIs.
//
// Um catálogo de painéis: card com capa, título, descrição e o botão que abre
// o BI em outra aba. Quem cadastra escolhe quem vê cada card — por setor, por
// pessoa, ou os dois.
//
// O RECORTE ACONTECE NA RLS, NÃO AQUI
//   A lista já chega filtrada (função `bi_link_liberado`). O que este arquivo
//   faz com `acessos` é só EXPLICAR o card — "liberado para RH e Financeiro" —
//   e montar o formulário de quem gere. Refazer o filtro na tela daria dois
//   lugares decidindo a mesma coisa, e o dia em que discordassem, a tela
//   mostraria um card que o banco recusa a abrir.
//
// Favorito é do navegador, como na tela inicial: é preferência de atalho, não
// dado da empresa, e não vale uma tabela.

import { useMemo, useState } from "react";
import {
  BarChart3, ExternalLink, Image as ImageIcon, Loader2, Lock, Pencil,
  Plus, Search, Star, Trash2, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import {
  FORM_BI_VAZIO, erroDoLink, useBiLinks,
  type BiLink, type FormBiLink,
} from "@/hooks/useBiLinks";
import { cn } from "@/lib/utils";

const chaveFavoritos = (uid?: string) => `gn:bi:favoritos:${uid ?? "anon"}`;

function lerFavoritos(uid?: string): string[] {
  try {
    const bruto = localStorage.getItem(chaveFavoritos(uid));
    const lido = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lido) ? lido.filter((x) => typeof x === "string") : [];
  } catch {
    return []; // modo privado, storage bloqueado: favorito não vale um erro
  }
}

export default function LinksBIs() {
  const { user } = useAuth();
  const {
    links, acessos, setores, pessoas, carregando,
    podeVer, podeCriar, podeEditar, podeExcluir,
    salvar, excluir, subirCapa,
  } = useBiLinks();

  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState("todos");
  const [favoritos, setFavoritos] = useState<string[]>(() => lerFavoritos(user?.id));
  const [form, setForm] = useState<FormBiLink | null>(null);
  const [apagando, setApagando] = useState<BiLink | null>(null);
  const [subindo, setSubindo] = useState(false);

  const podeGerir = podeCriar || podeEditar;

  /** Regras por card — alimenta a tarja "quem vê" e o formulário de edição. */
  const regrasPorLink = useMemo(() => {
    const mapa = new Map<string, { setores: string[]; usuarios: string[] }>();
    for (const a of acessos) {
      const atual = mapa.get(a.link_id) ?? { setores: [], usuarios: [] };
      if (a.setor) atual.setores.push(a.setor);
      if (a.user_id) atual.usuarios.push(a.user_id);
      mapa.set(a.link_id, atual);
    }
    return mapa;
  }, [acessos]);

  const grupos = useMemo(() => {
    const s = new Set<string>();
    for (const l of links) if (l.grupo) s.add(l.grupo);
    return [...s].sort();
  }, [links]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtrados = links.filter((l) => {
      if (grupo !== "todos" && (l.grupo ?? "") !== grupo) return false;
      if (!termo) return true;
      return [l.titulo, l.descricao ?? "", l.grupo ?? ""]
        .some((c) => c.toLowerCase().includes(termo));
    });
    // Favorito primeiro: quem marcou uma estrela quer aquele card à mão, não
    // na terceira fileira.
    return filtrados.sort((a, b) => {
      const fa = favoritos.includes(a.id) ? 0 : 1;
      const fb = favoritos.includes(b.id) ? 0 : 1;
      return fa !== fb ? fa - fb : a.ordem - b.ordem || a.titulo.localeCompare(b.titulo);
    });
  }, [links, grupo, busca, favoritos]);

  const alternarFavorito = (id: string) => {
    setFavoritos((atual) => {
      const novo = atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id];
      try { localStorage.setItem(chaveFavoritos(user?.id), JSON.stringify(novo)); } catch { /* modo privado */ }
      return novo;
    });
  };

  const abrirEdicao = (l: BiLink) => {
    const r = regrasPorLink.get(l.id) ?? { setores: [], usuarios: [] };
    setForm({
      id: l.id,
      titulo: l.titulo,
      descricao: l.descricao ?? "",
      url: l.url,
      imagem_url: l.imagem_url ?? "",
      grupo: l.grupo ?? "",
      ativo: l.ativo,
      setores: r.setores,
      usuarios: r.usuarios,
    });
  };

  const gravar = async () => {
    if (!form) return;
    const erro = erroDoLink(form);
    if (erro) { toast.error(erro); return; }
    try {
      await salvar.mutateAsync(form);
      toast.success(form.id ? "BI atualizado." : "BI adicionado.");
      setForm(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para salvar o BI.");
    }
  };

  const escolherCapa = async (arquivo?: File | null) => {
    if (!arquivo || !form) return;
    setSubindo(true);
    try {
      const url = await subirCapa(arquivo);
      setForm({ ...form, imagem_url: url });
      toast.success("Capa enviada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para enviar a capa.");
    } finally {
      setSubindo(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!apagando) return;
    try {
      await excluir.mutateAsync(apagando.id);
      toast.success("BI removido do catálogo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para remover.");
    } finally {
      setApagando(null);
    }
  };

  if (!podeVer && !podeGerir) {
    return (
      <div>
        <PageHeader
          title="Links dos BIs"
          subtitle="Acesse os painéis de Business Intelligence da empresa."
          module="BI & Analytics"
          breadcrumb={["Links dos BIs"]}
        />
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Você ainda não tem acesso a esta tela. Peça a liberação em
          Administração › Acesso por Usuário.
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Links dos BIs"
        subtitle="Acesse os painéis de Business Intelligence da empresa."
        module="BI & Analytics"
        breadcrumb={["Links dos BIs"]}
        actions={
          podeCriar ? (
            <Button onClick={() => setForm({ ...FORM_BI_VAZIO })}>
              <Plus className="mr-2 h-4 w-4" /> Adicionar BI
            </Button>
          ) : undefined
        }
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div>
              <div className="font-semibold text-foreground">BIs disponíveis</div>
              <p className="text-xs text-muted-foreground">
                Clique no card para acessar o painel desejado.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar BI por nome, assunto..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <Select value={grupo} onValueChange={setGrupo}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os grupos</SelectItem>
                {grupos.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {carregando && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Carregando painéis…
          </p>
        )}

        {!carregando && lista.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {links.length === 0
              ? podeCriar
                ? "Nenhum BI cadastrado ainda. Use “Adicionar BI” para criar o primeiro."
                : "Nenhum BI liberado para você por enquanto."
              : "Nenhum BI com esses filtros."}
          </p>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {lista.map((l) => {
            const r = regrasPorLink.get(l.id);
            const restrito = !!r && (r.setores.length > 0 || r.usuarios.length > 0);
            const favorito = favoritos.includes(l.id);
            return (
              <div
                key={l.id}
                className={cn(
                  "flex flex-col overflow-hidden rounded-xl border bg-card transition hover:shadow-md",
                  !l.ativo && "opacity-60",
                )}
              >
                <div className="relative h-28 bg-muted">
                  {l.imagem_url ? (
                    <img src={l.imagem_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-7 w-7" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => alternarFavorito(l.id)}
                    aria-label={favorito ? "Tirar dos favoritos" : "Marcar como favorito"}
                    className="absolute right-2 top-2 rounded-md bg-white/85 p-1 shadow-sm"
                  >
                    <Star className={cn("h-4 w-4", favorito ? "fill-amber-400 text-amber-500" : "text-slate-400")} />
                  </button>
                </div>

                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-foreground">{l.titulo}</div>
                      {l.grupo && (
                        <Badge variant="secondary" className="mt-1 text-[10px]">{l.grupo}</Badge>
                      )}
                    </div>
                    {restrito && (
                      <span
                        className="mt-0.5 text-muted-foreground"
                        title={[
                          r?.setores.length ? `Setores: ${r.setores.join(", ")}` : "",
                          r?.usuarios.length ? `${r.usuarios.length} pessoa(s) específica(s)` : "",
                        ].filter(Boolean).join(" · ")}
                      >
                        <Lock className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>

                  {l.descricao && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{l.descricao}</p>
                  )}

                  <div className="mt-auto space-y-1.5 pt-1">
                    <Button asChild variant="outline" size="sm" className="w-full">
                      {/* noreferrer junto com _blank: sem ele a página do BI
                          recebe window.opener e pode navegar esta aba. */}
                      <a href={l.url} target="_blank" rel="noopener noreferrer">
                        Acessar BI <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                      </a>
                    </Button>

                    {(podeEditar || podeExcluir) && (
                      <div className="flex gap-1">
                        {podeEditar && (
                          <Button variant="ghost" size="sm" className="flex-1 text-xs"
                                  onClick={() => abrirEdicao(l)}>
                            <Pencil className="mr-1 h-3 w-3" /> Editar
                          </Button>
                        )}
                        {podeExcluir && (
                          <Button variant="ghost" size="sm"
                                  className="flex-1 text-xs text-destructive hover:text-destructive"
                                  onClick={() => setApagando(l)}>
                            <Trash2 className="mr-1 h-3 w-3" /> Excluir
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Adicionar / editar ─────────────────────────────────────── */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar BI" : "Adicionar BI"}</DialogTitle>
            <DialogDescription>
              O card aparece na tela para quem tiver acesso ao painel.
            </DialogDescription>
          </DialogHeader>

          {form && (
            <div className="space-y-4">
              <div>
                <Label>Título *</Label>
                <Input
                  placeholder="Ex.: Fluxo de Caixa"
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                />
              </div>

              <div>
                <Label>Descrição</Label>
                <Textarea
                  rows={2}
                  placeholder="Acompanhe entradas e saídas de caixa da empresa."
                  value={form.descricao}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Link do painel *</Label>
                  <Input
                    placeholder="https://app.powerbi.com/..."
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Grupo</Label>
                  <Input
                    placeholder="Financeiro, Operacional, RH..."
                    value={form.grupo}
                    onChange={(e) => setForm({ ...form, grupo: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    É o filtro “Todos os grupos” da tela.
                  </p>
                </div>
              </div>

              <div>
                <Label>Imagem do card</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="h-16 w-28 overflow-hidden rounded-md border bg-muted">
                    {form.imagem_url ? (
                      <img src={form.imagem_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => escolherCapa(e.target.files?.[0])}
                    />
                    <span className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                      {subindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      Enviar imagem
                    </span>
                  </label>
                  <Input
                    className="min-w-[200px] flex-1"
                    placeholder="ou cole a URL de uma imagem"
                    value={form.imagem_url}
                    onChange={(e) => setForm({ ...form, imagem_url: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-lg border p-3">
                <Switch
                  checked={form.ativo}
                  onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                />
                <div>
                  <div className="text-sm font-medium">BI ativo</div>
                  <p className="text-xs text-muted-foreground">
                    Desligado, o card some da tela de todo mundo sem ser apagado.
                  </p>
                </div>
              </div>

              {/* ── Quem vê este BI ────────────────────────────────── */}
              <div className="rounded-lg border p-3">
                <div className="text-sm font-semibold">Quem vê este BI</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Sem nenhum setor ou pessoa marcados, o card aparece para <b>todos</b> que
                  têm acesso à tela. Marcar restringe.
                </p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Setores</Label>
                    <ScrollArea className="h-40 rounded-md border p-2">
                      {setores.map((s) => (
                        <label key={s} className="flex items-center gap-2 py-1 text-sm">
                          <Checkbox
                            checked={form.setores.includes(s)}
                            onCheckedChange={(v) => setForm({
                              ...form,
                              setores: v === true
                                ? [...form.setores, s]
                                : form.setores.filter((x) => x !== s),
                            })}
                          />
                          {s}
                        </label>
                      ))}
                      {setores.length === 0 && (
                        <p className="p-2 text-xs text-muted-foreground">Nenhum setor cadastrado.</p>
                      )}
                    </ScrollArea>
                  </div>

                  <div>
                    <Label className="text-xs">Pessoas específicas</Label>
                    <ScrollArea className="h-40 rounded-md border p-2">
                      {pessoas.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 py-1 text-sm">
                          <Checkbox
                            checked={form.usuarios.includes(p.id)}
                            onCheckedChange={(v) => setForm({
                              ...form,
                              usuarios: v === true
                                ? [...form.usuarios, p.id]
                                : form.usuarios.filter((x) => x !== p.id),
                            })}
                          />
                          <span className="truncate">{p.nome}</span>
                        </label>
                      ))}
                      {pessoas.length === 0 && (
                        <p className="p-2 text-xs text-muted-foreground">Nenhuma pessoa encontrada.</p>
                      )}
                    </ScrollArea>
                  </div>
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  {form.setores.length === 0 && form.usuarios.length === 0
                    ? "Hoje: visível para todos que têm a tela."
                    : `Hoje: ${form.setores.length} setor(es) e ${form.usuarios.length} pessoa(s).`}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button onClick={gravar} disabled={salvar.isPending}>
              {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {form?.id ? "Salvar alterações" : "Adicionar BI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Excluir ────────────────────────────────────────────────── */}
      <AlertDialog open={!!apagando} onOpenChange={(o) => !o && setApagando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover “{apagando?.titulo}” do catálogo?</AlertDialogTitle>
            <AlertDialogDescription>
              O card sai da tela junto com as regras de acesso dele. O painel em si não é
              afetado — só o atalho daqui. Para escondê-lo sem perder o cadastro,
              desligue <b>BI ativo</b> na edição.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmarExclusao}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
