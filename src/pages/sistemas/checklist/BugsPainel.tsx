import { useEffect, useMemo, useState } from "react";
import { Bug as IconeBug, ExternalLink, Loader2, Plus, Search, Send, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { useBugs, useEncaminharBug, useExcluirBug, useSalvarBug, type Bug } from "@/hooks/useChecklistModulos";
import {
  SEVERIDADES, STATUS_BUG, bugAberto, rotuloSeveridade, rotuloStatusBug,
  type DadosChecklist, type Severidade, type StatusBug,
} from "@/lib/sistemas/checklistModulos";
import { Etiqueta, fmtDataHora } from "./ui";

// Bugs do Checklist de Módulos: quem tem "incluir" registra; quem tem
// "alterar" faz a triagem (status, responsável, resolução) e o
// ENCAMINHAMENTO INICIAL — "Encaminhar como chamado" abre o chamado de
// sistemas já preenchido (RPC sis_bug_encaminhar) e amarra os dois.

const TODOS = "__todos";
const SEM = "__sem";

export interface NovoBugPadrao { moduloId: string; menuId: string | null }

export function BugsPainel({ dados, moduloId, podeIncluir, podeAlterar, podeExcluir, novoBug, onNovoBugUsado }: {
  dados: DadosChecklist;
  moduloId?: string | null;
  podeIncluir: boolean; podeAlterar: boolean; podeExcluir: boolean;
  /** Abre o cadastro já com módulo/tela (vindo do botão da tela no checklist). */
  novoBug?: NovoBugPadrao | null;
  onNovoBugUsado?: () => void;
}) {
  const q = useBugs();
  const [fStatus, setFStatus] = useState<string>("abertos");
  const [fSev, setFSev] = useState<string>(TODOS);
  const [fModulo, setFModulo] = useState<string>(moduloId ?? TODOS);
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<{ bug: Bug | null; padrao?: NovoBugPadrao } | null>(null);

  useEffect(() => {
    if (novoBug) { setEditando({ bug: null, padrao: novoBug }); onNovoBugUsado?.(); }
  }, [novoBug]); // eslint-disable-line react-hooks/exhaustive-deps

  const nomeModulo = useMemo(() => new Map(dados.modulos.map((m) => [m.id, m.nome])), [dados.modulos]);
  const nomeTela = useMemo(() => new Map(dados.telas.map((t) => [t.id, t.nome])), [dados.telas]);
  const nomeUsuario = useMemo(() => new Map(dados.usuarios.map((u) => [u.id, u.nome])), [dados.usuarios]);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (q.data ?? []).filter((b) =>
      (moduloId ? b.modulo_id === moduloId : fModulo === TODOS || b.modulo_id === fModulo)
      && (fStatus === TODOS || (fStatus === "abertos" ? bugAberto(b.status) : b.status === fStatus))
      && (fSev === TODOS || b.severidade === fSev)
      && (!t || [String(b.id), b.titulo, b.descricao, b.chamado_numero, nomeTela.get(b.menu_id ?? ""), nomeModulo.get(b.modulo_id)]
        .some((x) => String(x ?? "").toLowerCase().includes(t))));
  }, [q.data, moduloId, fModulo, fStatus, fSev, busca, nomeTela, nomeModulo]);

  const contagem = useMemo(() => {
    const base = (q.data ?? []).filter((b) => !moduloId || b.modulo_id === moduloId);
    return { abertos: base.filter((b) => bugAberto(b.status)).length, total: base.length };
  }, [q.data, moduloId]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="abertos">Em aberto ({contagem.abertos})</SelectItem>
            <SelectItem value={TODOS}>Todos os status ({contagem.total})</SelectItem>
            {STATUS_BUG.map((s) => <SelectItem key={s.valor} value={s.valor}>{s.rotulo}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fSev} onValueChange={setFSev}>
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Toda severidade</SelectItem>
            {SEVERIDADES.map((s) => <SelectItem key={s.valor} value={s.valor}>{s.rotulo}</SelectItem>)}
          </SelectContent>
        </Select>
        {!moduloId && (
          <Select value={fModulo} onValueChange={setFModulo}>
            <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={TODOS}>Todos os módulos</SelectItem>
              {dados.modulos.filter((m) => m.ativo).map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 w-56 pl-8" placeholder="Nº, título, tela, chamado…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {podeIncluir && (
          <Button size="sm" className="ml-auto h-9 gap-1.5" onClick={() => setEditando({ bug: null, padrao: moduloId ? { moduloId, menuId: null } : undefined })}>
            <Plus className="h-4 w-4" /> Registrar bug
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando bugs…</p>
      ) : lista.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <IconeBug className="h-9 w-9 text-muted-foreground/40" />
          <p className="font-medium">Nenhum bug neste filtro</p>
          {podeIncluir && <p className="text-sm text-muted-foreground">Achou um problema em alguma tela? Use "Registrar bug".</p>}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/60 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5">Bug</th>
                  {!moduloId && <th className="px-3 py-2.5">Módulo · tela</th>}
                  <th className="px-3 py-2.5">Severidade</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Chamado</th>
                  <th className="px-3 py-2.5">Responsável</th>
                  <th className="px-3 py-2.5">Registrado</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((b) => (
                  <tr key={b.id} onClick={() => setEditando({ bug: b })} className="cursor-pointer border-t border-border transition hover:bg-muted/40">
                    <td className="max-w-[340px] px-3 py-2.5">
                      <p className="font-semibold text-foreground"><span className="mr-1.5 text-xs font-bold text-muted-foreground">#{b.id}</span>{b.titulo}</p>
                      <p className="line-clamp-1 text-xs text-muted-foreground">{b.descricao}</p>
                    </td>
                    {!moduloId && (
                      <td className="px-3 py-2.5 text-xs">
                        <p className="font-medium text-foreground">{nomeModulo.get(b.modulo_id) ?? "—"}</p>
                        <p className="text-muted-foreground">{b.menu_id ? nomeTela.get(b.menu_id) ?? "—" : "Módulo inteiro"}</p>
                      </td>
                    )}
                    <td className="px-3 py-2.5"><Etiqueta tom={SEVERIDADES.find((s) => s.valor === b.severidade)?.tom ?? "neutro"}>{rotuloSeveridade(b.severidade)}</Etiqueta></td>
                    <td className="px-3 py-2.5"><Etiqueta tom={STATUS_BUG.find((s) => s.valor === b.status)?.tom ?? "neutro"}>{rotuloStatusBug(b.status)}</Etiqueta></td>
                    <td className="px-3 py-2.5 text-xs font-semibold">
                      {b.chamado_numero ? (
                        <Link to={`/app/sistemas/chamados/${b.chamado_id}/acompanhar`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-primary hover:underline">
                          {b.chamado_numero} <ExternalLink className="h-3 w-3" />
                        </Link>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{b.responsavel_id ? nomeUsuario.get(b.responsavel_id) ?? "—" : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{b.reportado_por_nome ?? "—"}<br />{fmtDataHora(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editando && (
        <BugDialog bug={editando.bug} padrao={editando.padrao} dados={dados}
          podeAlterar={podeAlterar} podeExcluir={podeExcluir} onFechar={() => setEditando(null)} />
      )}
    </div>
  );
}

function BugDialog({ bug, padrao, dados, podeAlterar, podeExcluir, onFechar }: {
  bug: Bug | null; padrao?: NovoBugPadrao; dados: DadosChecklist;
  podeAlterar: boolean; podeExcluir: boolean; onFechar: () => void;
}) {
  const salvar = useSalvarBug();
  const encaminhar = useEncaminharBug();
  const excluir = useExcluirBug();
  const novo = !bug;
  const editavel = novo || podeAlterar;
  const [f, setF] = useState({
    modulo_id: bug?.modulo_id ?? padrao?.moduloId ?? "",
    menu_id: bug?.menu_id ?? padrao?.menuId ?? null as string | null,
    titulo: bug?.titulo ?? "", descricao: bug?.descricao ?? "", como_reproduzir: bug?.como_reproduzir ?? "",
    severidade: (bug?.severidade ?? "media") as Severidade, status: (bug?.status ?? "aberto") as StatusBug,
    responsavel_id: bug?.responsavel_id ?? null as string | null, resolucao: bug?.resolucao ?? "",
  });
  const mudar = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const telasDoModulo = dados.telas.filter((t) => t.modulo_id === f.modulo_id && t.ativo);
  const ok = !!f.modulo_id && f.titulo.trim().length >= 5 && f.descricao.trim().length >= 10;

  const gravar = async () => {
    if (!ok) return;
    const base = {
      modulo_id: f.modulo_id, menu_id: f.menu_id, titulo: f.titulo.trim(), descricao: f.descricao.trim(),
      como_reproduzir: f.como_reproduzir.trim() || null, severidade: f.severidade,
    };
    const campos = novo ? base : { ...base, status: f.status, responsavel_id: f.responsavel_id, resolucao: f.resolucao.trim() || null };
    await salvar.mutateAsync({ id: bug?.id ?? null, campos });
    onFechar();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><IconeBug className="h-5 w-5 text-red-600" /> {novo ? "Registrar bug" : `Bug #${bug!.id}`}</DialogTitle>
          <DialogDescription>
            {novo ? "Descreva o problema com o máximo de detalhe — o time de sistemas faz a triagem e encaminha." : <>Registrado por {bug!.reportado_por_nome ?? "—"} em {fmtDataHora(bug!.created_at)}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Módulo *</Label>
            <SearchableSelect value={f.modulo_id || null} onChange={(v) => mudar({ modulo_id: v, menu_id: null })} disabled={!editavel}
              options={dados.modulos.filter((m) => m.ativo).map((m) => ({ value: m.id, label: m.nome }))} placeholder="Escolha o módulo" searchPlaceholder="Buscar módulo…" />
          </div>
          <div className="space-y-1.5">
            <Label>Tela</Label>
            <SearchableSelect value={f.menu_id ?? SEM} onChange={(v) => mudar({ menu_id: v === SEM ? null : v })} disabled={!editavel || !f.modulo_id}
              options={[{ value: SEM, label: "Módulo inteiro / não sei" }, ...telasDoModulo.map((t) => ({ value: t.id, label: t.nome, hint: t.rota }))]}
              placeholder="Escolha a tela" searchPlaceholder="Buscar tela…" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Título *</Label>
          <Input value={f.titulo} onChange={(e) => mudar({ titulo: e.target.value })} disabled={!editavel} maxLength={150} placeholder="Ex.: Botão Exportar não baixa a planilha" />
        </div>
        <div className="space-y-1.5">
          <Label>O que acontece *</Label>
          <Textarea rows={3} value={f.descricao} onChange={(e) => mudar({ descricao: e.target.value })} disabled={!editavel}
            placeholder="O que você esperava e o que aconteceu. Mensagem de erro, se apareceu." />
        </div>
        <div className="space-y-1.5">
          <Label>Como reproduzir</Label>
          <Textarea rows={2} value={f.como_reproduzir} onChange={(e) => mudar({ como_reproduzir: e.target.value })} disabled={!editavel}
            placeholder="1. Abrir a tela…  2. Clicar em…" />
        </div>
        <div className="space-y-1.5">
          <Label>Severidade</Label>
          <div className="flex flex-wrap gap-1.5">
            {SEVERIDADES.map((s) => (
              <button key={s.valor} type="button" disabled={!editavel} onClick={() => mudar({ severidade: s.valor })}
                className={cn("rounded-full border px-3 py-1 text-xs font-semibold transition disabled:cursor-default",
                  f.severidade === s.valor ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/30" : "border-border text-muted-foreground hover:text-foreground")}>
                {s.rotulo}
              </button>
            ))}
          </div>
        </div>

        {!novo && podeAlterar && (
          <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground sm:col-span-2">Triagem</p>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={f.status} onValueChange={(v) => mudar({ status: v as StatusBug })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_BUG.map((s) => <SelectItem key={s.valor} value={s.valor}>{s.rotulo}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Responsável</Label>
              <SearchableSelect value={f.responsavel_id ?? SEM} onChange={(v) => mudar({ responsavel_id: v === SEM ? null : v })}
                options={[{ value: SEM, label: "— Ninguém —" }, ...dados.usuarios.map((u) => ({ value: u.id, label: u.nome }))]} placeholder="Escolha" searchPlaceholder="Buscar pessoa…" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Resolução</Label>
              <Textarea rows={2} value={f.resolucao} onChange={(e) => mudar({ resolucao: e.target.value })} placeholder="O que foi feito / por que foi descartado" />
            </div>
          </div>
        )}

        {!novo && bug!.chamado_numero && (
          <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
            Encaminhado como chamado <Link to={`/app/sistemas/chamados/${bug!.chamado_id}/acompanhar`} className="font-bold underline">{bug!.chamado_numero}</Link>.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex gap-2">
            {!novo && podeExcluir && (
              <Button variant="ghost" className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={async () => { if (confirm(`Excluir o bug #${bug!.id}?`)) { await excluir.mutateAsync(bug!.id); onFechar(); } }}>
                <Trash2 className="h-4 w-4" /> Excluir
              </Button>
            )}
            {!novo && podeAlterar && !bug!.chamado_id && bugAberto(bug!.status) && (
              <Button variant="outline" className="gap-1.5" disabled={encaminhar.isPending}
                onClick={async () => {
                  if (!confirm("Abrir um chamado de sistemas com este bug? Ele vai para a fila do time, já preenchido.")) return;
                  await encaminhar.mutateAsync(bug!.id); onFechar();
                }}>
                {encaminhar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Encaminhar como chamado
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar}>{editavel ? "Cancelar" : "Fechar"}</Button>
            {editavel && <Button onClick={gravar} disabled={!ok || salvar.isPending}>{salvar.isPending ? "Salvando…" : novo ? "Registrar" : "Salvar"}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
