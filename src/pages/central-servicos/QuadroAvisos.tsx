// Arquivo: src/pages/central-servicos/QuadroAvisos.tsx
//
// Central de Serviços › Quadro de Avisos — a tela de gestão do aviso.
//
// O aviso em si já existia (migration 20260930000076): a caixa no centro da
// tela com CONCORDO/DISCORDO, criada por um painel pequeno dentro de
// Novidades. Aqui ele ganha a tela que o pedido pediu — lista com busca,
// filtro e abas, e um formulário com categoria, resumo, validade e as três
// regras de ciência separadas.
//
// AS TRÊS REGRAS, QUE ANTES ERAM UMA SÓ
//   exigir_ciencia   — a pessoa precisa confirmar que leu?
//   bloquear_acesso  — enquanto não responder, fica presa no aviso?
//   permitir_escolha — CONCORDO/DISCORDO, ou só "Estou ciente"?
//
//   Vinham grudadas ("apareceu, tem que responder"), e é justamente a
//   distinção que o pedido trouxe: comunicado de recesso quer ciência sem
//   travar ninguém; mudança de norma trava.
//
// A tabela continua sendo a das notificações, de propósito: "Quadro de
// Avisos" é o nome da TELA. Duas tabelas dariam dois lugares mandando caixa
// na cara das pessoas, e o gate do AppShell teria de escolher um.

import { useMemo, useState } from "react";
import {
  Image as ImageIcon, Loader2, Megaphone, Pencil, Plus, Search, Trash2, Upload, Eye, X,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useNotificacoes } from "@/hooks/useNotificacoes";
import {
  CATEGORIAS, FORM_VAZIO, erroDoFormulario, estaVigente, fmtDataHora, formDoAviso,
  panoramaDe, type CienciaNotificacao, type FormNotificacao, type Notificacao,
} from "@/lib/notificacoes";
import { cn } from "@/lib/utils";

/** Cor da tarja por categoria. Sem cor, a coluna vira uma lista de texto cinza. */
const COR_CATEGORIA: Record<string, string> = {
  Comunicado: "bg-amber-100 text-amber-800",
  Sistemas: "bg-blue-100 text-blue-800",
  Treinamento: "bg-orange-100 text-orange-800",
  Processos: "bg-rose-100 text-rose-800",
  Procedimentos: "bg-violet-100 text-violet-800",
  RH: "bg-emerald-100 text-emerald-800",
};

type Aba = "todos" | "ativos" | "arquivados";

export default function QuadroAvisos() {
  const {
    notificacoes, historico, alvos, setores, pessoas, carregando,
    podeVerQuadro, podeCriar, podeEditar, podeExcluir,
    salvar, excluir, subirAnexo,
  } = useNotificacoes();

  const [aba, setAba] = useState<Aba>("todos");
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("todas");
  const [form, setForm] = useState<FormNotificacao | null>(null);
  const [vendo, setVendo] = useState<Notificacao | null>(null);
  const [apagando, setApagando] = useState<Notificacao | null>(null);
  const [subindo, setSubindo] = useState(false);

  /** Respostas agrupadas por aviso — alimenta a contagem da lista. */
  const porAviso = useMemo(() => {
    const mapa = new Map<number, CienciaNotificacao[]>();
    for (const c of historico) {
      const atual = mapa.get(c.notificacao_id) ?? [];
      atual.push(c);
      mapa.set(c.notificacao_id, atual);
    }
    return mapa;
  }, [historico]);

  /**
   * O público em uma linha: "Todos os colaboradores" ou "RH, Financeiro · 2
   * pessoa(s)".
   *
   * Vale para a lista e para o Visualizar. Sem nenhuma regra o aviso é de
   * todos — restringir é o ato explícito, igual aos Links de BI.
   */
  const publicoDe = (id: number): string => {
    const meus = alvos.filter((a) => a.notificacao_id === id);
    if (!meus.length) return "Todos os colaboradores";
    const st = meus.filter((a) => a.setor).map((a) => a.setor as string);
    const qtdPessoas = meus.filter((a) => a.user_id).length;
    const partes: string[] = [];
    if (st.length) partes.push(st.join(", "));
    if (qtdPessoas) partes.push(qtdPessoas + " pessoa(s)");
    return partes.join(" · ");
  };

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return notificacoes.filter((n) => {
      // "Ativo" é publicado E dentro da validade: um aviso que expirou ontem
      // não está mais ativo, ainda que ninguém o tenha arquivado.
      const ativo = estaVigente(n);
      if (aba === "ativos" && !ativo) return false;
      if (aba === "arquivados" && ativo) return false;
      if (categoria !== "todas" && (n.categoria ?? "") !== categoria) return false;
      if (!termo) return true;
      return [n.titulo, n.resumo ?? "", n.mensagem, n.categoria ?? ""]
        .some((campo) => campo.toLowerCase().includes(termo));
    });
  }, [notificacoes, aba, categoria, busca]);

  if (!podeVerQuadro) {
    return (
      <div>
        <PageHeader
          title="Quadro de Avisos"
          subtitle="Fique por dentro das informações importantes do Grupo Nascimento."
          module="Central de Serviços"
          breadcrumb={["Quadro de Avisos"]}
        />
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Você não tem acesso à gestão do quadro. Peça a liberação em
          Administração › Acesso por Usuário.
        </Card>
      </div>
    );
  }

  const gravar = async () => {
    if (!form) return;
    const erro = erroDoFormulario(form);
    if (erro) { toast.error(erro); return; }
    try {
      await salvar.mutateAsync(form);
      toast.success(form.id ? "Aviso atualizado." : "Aviso publicado.");
      setForm(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para gravar o aviso.");
    }
  };

  /**
   * Sobe a imagem escolhida e guarda a URL no formulário.
   *
   * O arquivo vai para o storage NA HORA, antes de o aviso ser salvo: é o
   * mesmo caminho da capa dos Links de BI, e segurar o File em memória até o
   * SALVAR só adiantaria o problema de um upload que falha depois de a pessoa
   * achar que terminou.
   */
  const escolherImagem = async (arquivo?: File | null) => {
    if (!arquivo || !form) return;
    // O bucket recusa o que passar disto (migration 082), mas a recusa de lá
    // chega como erro técnico; aqui dá para dizer o que houve.
    if (arquivo.size > 5 * 1024 * 1024) {
      toast.error("A imagem passou de 5 MB. Reduza o arquivo e tente de novo.");
      return;
    }
    setSubindo(true);
    try {
      const url = await subirAnexo(arquivo);
      setForm({ ...form, anexo_url: url, anexo_nome: arquivo.name });
      toast.success("Imagem enviada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para enviar a imagem.");
    } finally {
      setSubindo(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!apagando) return;
    try {
      await excluir.mutateAsync(apagando.id);
      toast.success("Aviso excluído.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para excluir.");
    } finally {
      setApagando(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Quadro de Avisos"
        subtitle="Fique por dentro das informações importantes do Grupo Nascimento."
        module="Central de Serviços"
        breadcrumb={["Quadro de Avisos"]}
        actions={
          podeCriar ? (
            <Button onClick={() => setForm({ ...FORM_VAZIO })}>
              <Plus className="mr-2 h-4 w-4" /> Criar aviso
            </Button>
          ) : undefined
        }
      />

      <Card className="p-4">
        <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
          <TabsList>
            <TabsTrigger value="todos">Todos os avisos</TabsTrigger>
            <TabsTrigger value="ativos">Avisos ativos</TabsTrigger>
            <TabsTrigger value="arquivados">Avisos arquivados</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-4 flex flex-wrap gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por título, conteúdo ou categoria..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as categorias</SelectItem>
              {CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aviso</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Data de publicação</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Respostas</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {carregando && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Carregando avisos…
                  </TableCell>
                </TableRow>
              )}

              {!carregando && lista.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    {notificacoes.length === 0
                      ? "Nenhum aviso publicado ainda."
                      : "Nenhum aviso com esses filtros."}
                  </TableCell>
                </TableRow>
              )}

              {lista.map((n) => {
                const ativo = estaVigente(n);
                const p = panoramaDe(porAviso.get(n.id) ?? []);
                return (
                  <TableRow key={n.id}>
                    <TableCell className="max-w-[420px]">
                      <div className="flex gap-3">
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Megaphone className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-foreground">{n.titulo}</div>
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {n.resumo || n.mensagem}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "inline-block rounded-md px-2 py-0.5 text-xs font-semibold",
                        COR_CATEGORIA[n.categoria ?? ""] ?? "bg-slate-100 text-slate-700",
                      )}>
                        {n.categoria ?? "—"}
                      </span>
                      {/* Para quem foi. Fica sob a categoria porque é a mesma
                          pergunta de triagem: "isto era para mim?" */}
                      <div className="mt-1 text-[11px] text-muted-foreground">{publicoDe(n.id)}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      <div>{fmtDataHora(n.publicado_em)}</div>
                      {n.criado_por_nome && (
                        <div className="text-xs text-muted-foreground">por {n.criado_por_nome}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ativo ? "default" : "secondary"}>
                        {ativo ? "Ativo" : n.publicado ? "Expirado" : "Arquivado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {n.exigir_ciencia ? (
                        <span title="Concordaram / discordaram / cientes">
                          {p.responderam} {p.responderam === 1 ? "resposta" : "respostas"}
                          {p.discordaram > 0 && (
                            <span className="ml-1 text-rose-600">· {p.discordaram} discordou</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">sem ciência</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setVendo(n)}>
                          <Eye className="mr-1 h-3.5 w-3.5" /> Visualizar
                        </Button>
                        {podeEditar && (
                          <Button variant="ghost" size="sm" onClick={() => setForm(formDoAviso(n, alvos))}>
                            <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                          </Button>
                        )}
                        {podeExcluir && (
                          <Button
                            variant="ghost" size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setApagando(n)}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {lista.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Exibindo {lista.length} de {notificacoes.length} avisos.
          </p>
        )}
      </Card>

      {/* ── Criar / editar ─────────────────────────────────────────── */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar aviso" : "Criar aviso"}</DialogTitle>
            <DialogDescription>
              Preencha as informações abaixo para publicar um aviso no Grupo Nascimento.
            </DialogDescription>
          </DialogHeader>

          {form && (
            <div className="space-y-4">
              <div>
                <Label>Título do aviso *</Label>
                <Input
                  maxLength={150}
                  placeholder="Ex.: Comunicado sobre o recesso de fim de ano"
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                />
                <p className="mt-1 text-right text-xs text-muted-foreground">{form.titulo.length}/150</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label>Categoria *</Label>
                  <Select value={form.categoria} onValueChange={(v) => setForm({ ...form, categoria: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status *</Label>
                  <Select
                    value={form.publicado ? "ativo" : "arquivado"}
                    onValueChange={(v) => setForm({ ...form, publicado: v === "ativo" })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo">Ativo</SelectItem>
                      <SelectItem value="arquivado">Arquivado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Data de expiração</Label>
                  <Input
                    type="date"
                    value={form.expira_em}
                    onChange={(e) => setForm({ ...form, expira_em: e.target.value })}
                  />
                </div>
              </div>

              {/* ── Exibir para ─────────────────────────────────────────
                  Mesma pergunta e mesma resposta dos Links de BI: sem nada
                  marcado o aviso é de todos, e restringir é o ato explícito.
                  Duas telas que perguntam "quem vê isto?" têm que responder
                  do mesmo jeito, senão quem administra aprende duas regras. */}
              <div className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Exibir para</div>
                    <p className="text-xs text-muted-foreground">
                      Sem setor nem pessoa marcados, o aviso vai para <b>todos</b>.
                    </p>
                  </div>
                  {form.setores.length === 0 && form.usuarios.length === 0 ? (
                    <Badge>Todos os colaboradores</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm({ ...form, setores: [], usuarios: [] })}
                    >
                      Voltar para todos
                    </Button>
                  )}
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Setores</Label>
                    <ScrollArea className="h-36 rounded-md border p-2">
                      {setores.map((st) => (
                        <label key={st} className="flex items-center gap-2 py-1 text-sm">
                          <Checkbox
                            checked={form.setores.includes(st)}
                            onCheckedChange={(v) => setForm({
                              ...form,
                              setores: v === true
                                ? [...form.setores, st]
                                : form.setores.filter((x) => x !== st),
                            })}
                          />
                          {st}
                        </label>
                      ))}
                      {setores.length === 0 && (
                        <p className="p-2 text-xs text-muted-foreground">Nenhum setor cadastrado.</p>
                      )}
                    </ScrollArea>
                  </div>

                  <div>
                    <Label className="text-xs">Pessoas específicas</Label>
                    <ScrollArea className="h-36 rounded-md border p-2">
                      {pessoas.map((ps) => (
                        <label key={ps.id} className="flex items-center gap-2 py-1 text-sm">
                          <Checkbox
                            checked={form.usuarios.includes(ps.id)}
                            onCheckedChange={(v) => setForm({
                              ...form,
                              usuarios: v === true
                                ? [...form.usuarios, ps.id]
                                : form.usuarios.filter((x) => x !== ps.id),
                            })}
                          />
                          <span className="truncate">{ps.nome}</span>
                        </label>
                      ))}
                      {pessoas.length === 0 && (
                        <p className="p-2 text-xs text-muted-foreground">Nenhuma pessoa encontrada.</p>
                      )}
                    </ScrollArea>
                  </div>
                </div>
              </div>

              <div>
                <Label>Resumo curto</Label>
                <Input
                  maxLength={300}
                  placeholder="Uma breve descrição que será exibida na lista de avisos."
                  value={form.resumo}
                  onChange={(e) => setForm({ ...form, resumo: e.target.value })}
                />
                <p className="mt-1 text-right text-xs text-muted-foreground">{form.resumo.length}/300</p>
              </div>

              <div>
                <Label>Conteúdo do aviso *</Label>
                <Textarea
                  rows={7}
                  maxLength={5000}
                  placeholder="Digite aqui o conteúdo completo do aviso..."
                  value={form.mensagem}
                  onChange={(e) => setForm({ ...form, mensagem: e.target.value })}
                />
                <p className="mt-1 text-right text-xs text-muted-foreground">{form.mensagem.length}/5000</p>
              </div>

              {/* ── Imagem ───────────────────────────────────────────────
                  Mesmo desenho da capa dos Links de BI: sobe o arquivo OU
                  cola uma URL. O campo de URL não é sobra — cartaz que já
                  está publicado em outro lugar não precisa de outra cópia. */}
              <div>
                <Label>Imagem do aviso</Label>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <div className="h-16 w-28 shrink-0 overflow-hidden rounded-md border bg-muted">
                    {form.anexo_url ? (
                      <img src={form.anexo_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      disabled={subindo}
                      onChange={(e) => escolherImagem(e.target.files?.[0])}
                    />
                    <span className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                      {subindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      Enviar imagem
                    </span>
                  </label>
                  <Input
                    className="min-w-[200px] flex-1"
                    placeholder="ou cole a URL de uma imagem"
                    value={form.anexo_url}
                    onChange={(e) => setForm({ ...form, anexo_url: e.target.value })}
                  />
                  {form.anexo_url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm({ ...form, anexo_url: "", anexo_nome: "" })}
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> Tirar
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  PNG, JPG, WEBP ou GIF, até 5 MB. Aparece dentro do aviso, acima do texto.
                  {form.anexo_nome ? ` Arquivo atual: ${form.anexo_nome}.` : ""}
                </p>
              </div>

              {/* As três regras. Ficam juntas e nesta ordem porque uma depende
                  da outra: sem ciência não há o que bloquear nem o que escolher. */}
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-sm font-semibold">Confirmação e resposta do colaborador</div>

                <div className="mt-3 flex items-start gap-3">
                  <Switch
                    checked={form.exigir_ciencia}
                    onCheckedChange={(v) => setForm({
                      ...form,
                      exigir_ciencia: v,
                      // Desligar a ciência derruba o bloqueio junto: sem
                      // resposta possível, a pessoa ficaria presa para sempre.
                      bloquear_acesso: v ? form.bloquear_acesso : false,
                    })}
                  />
                  <div>
                    <div className="text-sm font-medium">Exigir ciência do colaborador</div>
                    <p className="text-xs text-muted-foreground">
                      O colaborador deverá confirmar que leu este aviso.
                    </p>
                  </div>
                </div>

                <div className="mt-3 space-y-2 pl-10">
                  <label className={cn("flex items-start gap-2", !form.exigir_ciencia && "opacity-50")}>
                    <Checkbox
                      checked={form.bloquear_acesso}
                      disabled={!form.exigir_ciencia}
                      onCheckedChange={(v) => setForm({ ...form, bloquear_acesso: v === true })}
                    />
                    <span>
                      <span className="text-sm font-medium">Bloquear acesso até responder</span>
                      <p className="text-xs text-muted-foreground">
                        O colaborador só poderá continuar no sistema após responder.
                      </p>
                    </span>
                  </label>

                  <label className={cn("flex items-start gap-2", !form.exigir_ciencia && "opacity-50")}>
                    <Checkbox
                      checked={form.permitir_escolha}
                      disabled={!form.exigir_ciencia}
                      onCheckedChange={(v) => setForm({ ...form, permitir_escolha: v === true })}
                    />
                    <span>
                      <span className="text-sm font-medium">Permitir opções Concordo / Discordo</span>
                      <p className="text-xs text-muted-foreground">
                        Desligado, o aviso pede só um “Estou ciente”.
                      </p>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button onClick={gravar} disabled={salvar.isPending}>
              {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {form?.id ? "Salvar alterações" : "Publicar aviso"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Visualizar ─────────────────────────────────────────────── */}
      <Dialog open={!!vendo} onOpenChange={(o) => !o && setVendo(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{vendo?.titulo}</DialogTitle>
            <DialogDescription>
              {vendo?.categoria} · publicado em {fmtDataHora(vendo?.publicado_em)}
              {vendo?.criado_por_nome ? ` por ${vendo.criado_por_nome}` : ""}
            </DialogDescription>
          </DialogHeader>

          {vendo && (
            <div className="space-y-4">
              {vendo.anexo_url && (
                <img
                  src={vendo.anexo_url}
                  alt={vendo.anexo_nome ?? ""}
                  className="max-h-72 w-full rounded-lg border object-contain"
                />
              )}
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{vendo.mensagem}</p>

              <div className="rounded-lg border p-3 text-sm">
                <div className="mb-2 font-semibold">Regras aplicadas</div>
                <ul className="space-y-1 text-muted-foreground">
                  <li>Exigir ciência: <b>{vendo.exigir_ciencia ? "Sim" : "Não"}</b></li>
                  <li>Bloquear acesso até responder: <b>{vendo.bloquear_acesso ? "Sim" : "Não"}</b></li>
                  <li>Permitir Concordo/Discordo: <b>{vendo.permitir_escolha ? "Sim" : "Não"}</b></li>
                  <li>Expira em: <b>{vendo.expira_em ? fmtDataHora(vendo.expira_em) : "não expira"}</b></li>
                  <li>Exibido para: <b>{publicoDe(vendo.id)}</b></li>
                </ul>
              </div>

              {vendo.exigir_ciencia && (() => {
                const p = panoramaDe(porAviso.get(vendo.id) ?? []);
                return (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { rotulo: "Responderam", valor: p.responderam },
                      { rotulo: "Concordo", valor: p.concordaram },
                      { rotulo: "Discordo", valor: p.discordaram },
                      { rotulo: "Ciente", valor: p.cientes },
                    ].map((c) => (
                      <div key={c.rotulo} className="rounded-lg border p-3 text-center">
                        <div className="text-xl font-bold">{c.valor}</div>
                        <div className="text-xs text-muted-foreground">{c.rotulo}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setVendo(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Excluir ────────────────────────────────────────────────── */}
      <AlertDialog open={!!apagando} onOpenChange={(o) => !o && setApagando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{apagando?.titulo}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O aviso sai do quadro e o registro de quem já respondeu vai junto. Isto não
              tem desfazer — para tirar o aviso da frente das pessoas sem perder o
              histórico, use <b>Arquivado</b> no status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmarExclusao}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
