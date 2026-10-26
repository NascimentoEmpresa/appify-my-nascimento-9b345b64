import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, History, Loader2, Pencil, Plus, Search, ShieldAlert, Trash2, UserX } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { nomeDoCpf, useGravarRestricao, useHistoricoRestricao, useRestricoes } from "@/hooks/useCadastroRestritivo";
import {
  ROTULO_ORIGEM, cpfValido, errosRestricao, filtrarRestricoes, formatarCpf, soDigitos, type OrigemRestricao, type Restricao,
} from "@/lib/recrutamento/cadastroRestritivo";

// =====================================================================
// CADASTRO RESTRITIVO (mig 20261025000020, 25/10/2026)
//
// Pedido: "uma lista chamada Cadastro Restritivo onde o recrutamento e/ou o
// jurídico consiga colocar pessoas que tenham restrição para ser
// contratadas; caso uma delas se candidate, a candidatura chega no
// recrutamento com o aviso de que ela está nessa lista. Na lista: nome, CPF
// e motivo da restrição."
//
// A mesma tela em dois lugares — Recrutamento e Seleção
// (/app/rh/recrutamento/cadastro-restritivo) e Jurídico
// (/app/juridico/cadastro-restritivo) — sobre a MESMA lista
// (RECRUTAMENTO_CPF_BLACKLIST), que o Jurídico já alimentava ao restringir
// um candidato na Verificação de Candidatos. `modulo` decide o menu de
// acesso e a origem gravada em quem é incluído por aqui.
// O aviso na candidatura: currículos e cards do kanban do Recrutamento
// ("POSSUI RESTRIÇÕES"), evento no histórico da vaga e notificação à
// responsável (gatilho no banco).
// =====================================================================

const MENU: Record<OrigemRestricao, string> = { recrutamento: "recrutamento_cadastro_restritivo", juridico: "juridico_cadastro_restritivo" };
const fmtData = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

export default function CadastroRestritivo({ modulo }: { modulo: OrigemRestricao }) {
  const { user } = useAuth();
  const lista = useRestricoes();
  const g = useGravarRestricao();
  const podeIncluir = useScreenAccess(MENU[modulo], "incluir").data === true;
  const podeAlterar = useScreenAccess(MENU[modulo], "alterar").data === true;
  const podeExcluir = useScreenAccess(MENU[modulo], "excluir").data === true;
  const autor = (user?.user_metadata?.nome as string | undefined) ?? user?.email ?? null;

  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState<OrigemRestricao | "">("");
  const [editando, setEditando] = useState<{ r: Restricao | null } | null>(null);
  const [removendo, setRemovendo] = useState<Restricao | null>(null);
  const [historico, setHistorico] = useState<Restricao | null>(null);

  const todas = useMemo(() => lista.data ?? [], [lista.data]);
  const visiveis = useMemo(() => filtrarRestricoes(todas, busca, origem), [todas, busca, origem]);
  const contagem = (o: OrigemRestricao) => todas.filter((r) => (r.origem ?? "juridico") === o).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cadastro Restritivo"
        subtitle="CPFs com restrição para contratação. Quando uma dessas pessoas se candidata, a candidatura chega no Recrutamento com o aviso."
        module={modulo === "juridico" ? "Jurídico" : "Recrutamento e Seleção"}
        breadcrumb={["Cadastro Restritivo"]}
        actions={(podeIncluir || podeAlterar) ? <Button onClick={() => setEditando({ r: null })}><Plus className="mr-1.5 h-4 w-4" /> Incluir pessoa</Button> : undefined}
      />

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Lista compartilhada entre <b>Recrutamento e Seleção</b> e <b>Jurídico</b>. Informação restrita: use só para a decisão de contratação.
          Toda inclusão, alteração e retirada fica no histórico com quem fez e quando.</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={origem || "todas"} onValueChange={(v) => setOrigem(v === "todas" ? "" : (v as OrigemRestricao))}>
          <TabsList>
            <TabsTrigger value="todas">Todas ({todas.length})</TabsTrigger>
            <TabsTrigger value="recrutamento">Recrutamento ({contagem("recrutamento")})</TabsTrigger>
            <TabsTrigger value="juridico">Jurídico ({contagem("juridico")})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-full sm:w-80">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar por nome, CPF ou motivo…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      <Card className="overflow-x-auto">
        {lista.isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        ) : lista.error ? (
          <div className="p-6 text-sm text-red-600">{(lista.error as Error).message}</div>
        ) : visiveis.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground"><UserX className="mx-auto mb-2 h-8 w-8 opacity-40" /> Nenhum CPF {busca ? "encontrado" : "na lista"}.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="w-40">CPF</TableHead>
                <TableHead>Motivo da restrição</TableHead>
                <TableHead className="w-32">Origem</TableHead>
                <TableHead className="hidden w-44 lg:table-cell">Incluído</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((r) => (
                <TableRow key={r.cpf_digits}>
                  <TableCell className="font-medium">{r.nome ?? <span className="italic text-muted-foreground">sem nome</span>}</TableCell>
                  <TableCell className="font-mono text-sm">{r.cpf_fmt ?? formatarCpf(r.cpf_digits)}</TableCell>
                  <TableCell className="max-w-md whitespace-pre-wrap text-sm">{r.motivo}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={(r.origem ?? "juridico") === "juridico" ? "border-violet-200 bg-violet-50 text-violet-700" : "border-sky-200 bg-sky-50 text-sky-700"}>
                      {ROTULO_ORIGEM[(r.origem ?? "juridico") as OrigemRestricao]}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    {fmtData(r.criado_em)}{r.criado_por ? <div>{r.criado_por}</div> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Histórico" onClick={() => setHistorico(r)}><History className="h-4 w-4" /></Button>
                      {podeAlterar && <Button variant="ghost" size="icon" className="h-8 w-8" title="Alterar" onClick={() => setEditando({ r })}><Pencil className="h-4 w-4" /></Button>}
                      {podeExcluir && <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700" title="Tirar da lista" onClick={() => setRemovendo(r)}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {editando && (
        <DialogoRestricao r={editando.r} onFechar={() => setEditando(null)} onSalvar={async (f) => {
          await g.salvar.mutateAsync({ ...f, origem: modulo, autor, novo: !editando.r });
          toast.success(editando.r ? "Restrição alterada." : "CPF incluído no Cadastro Restritivo.");
          setEditando(null);
        }} />
      )}
      {removendo && (
        <DialogoRemover r={removendo} onFechar={() => setRemovendo(null)} onConfirmar={async (motivo) => {
          await g.remover.mutateAsync({ cpf: removendo.cpf_digits, motivo });
          toast.success("CPF retirado do Cadastro Restritivo.");
          setRemovendo(null);
        }} />
      )}
      <DialogoHistorico r={historico} onFechar={() => setHistorico(null)} />
    </div>
  );
}

function DialogoRestricao({ r, onFechar, onSalvar }: { r: Restricao | null; onFechar: () => void; onSalvar: (f: { cpf: string; nome: string; motivo: string }) => Promise<void> }) {
  const [f, setF] = useState({ nome: r?.nome ?? "", cpf: r ? formatarCpf(r.cpf_digits) : "", motivo: r?.motivo ?? "" });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const erros = errosRestricao(f);
  const cpfCompleto = soDigitos(f.cpf).length === 11;

  // Nome do currículo/cadastro ao terminar de digitar o CPF (só se o campo estiver vazio).
  useEffect(() => {
    if (r || !cpfCompleto || f.nome.trim()) return;
    let vivo = true;
    nomeDoCpf(f.cpf).then((n) => { if (vivo && n) setF((x) => (x.nome.trim() ? x : { ...x, nome: n })); });
    return () => { vivo = false; };
  }, [f.cpf, cpfCompleto, r]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{r ? "Alterar restrição" : "Incluir no Cadastro Restritivo"}</DialogTitle>
          <DialogDescription>Se essa pessoa se candidatar, a candidatura chega no Recrutamento com o aviso e o motivo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">CPF *</label>
            <Input value={f.cpf} disabled={!!r} inputMode="numeric" placeholder="000.000.000-00" onChange={(e) => setF({ ...f, cpf: formatarCpf(e.target.value) })} />
            {cpfCompleto && !cpfValido(f.cpf) && (
              <p className="mt-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> Os dígitos verificadores não conferem — confira o CPF.</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Nome *</label>
            <Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nome completo" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Motivo da restrição *</label>
            <Textarea rows={4} value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} placeholder="Ex.: processo trabalhista contra a empresa; abandono de posto em 2025…" />
          </div>
          {tentou && erros.length > 0 && <p className="text-sm text-red-600">{erros.join(" ")}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button disabled={salvando} onClick={async () => {
            setTentou(true);
            if (erros.length) return;
            setSalvando(true);
            try { await onSalvar({ cpf: f.cpf, nome: f.nome.trim(), motivo: f.motivo.trim() }); }
            catch (e) { toast.error((e as Error).message); }
            finally { setSalvando(false); }
          }}>{salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{r ? "Salvar" : "Incluir"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoRemover({ r, onFechar, onConfirmar }: { r: Restricao; onFechar: () => void; onConfirmar: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tirar do Cadastro Restritivo</DialogTitle>
          <DialogDescription>{r.nome ?? "—"} · {r.cpf_fmt ?? formatarCpf(r.cpf_digits)} deixa de aparecer como restrito em todas as vagas.</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por que a restrição está sendo retirada (fica no histórico)" />
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button variant="destructive" disabled={!motivo.trim() || salvando} onClick={async () => {
            setSalvando(true);
            try { await onConfirmar(motivo.trim()); } catch (e) { toast.error((e as Error).message); } finally { setSalvando(false); }
          }}>{salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Tirar da lista</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoHistorico({ r, onFechar }: { r: Restricao | null; onFechar: () => void }) {
  const h = useHistoricoRestricao(r?.cpf_digits ?? null);
  const rotulo = { incluido: "Incluído", alterado: "Alterado", removido: "Retirado" } as const;
  return (
    <Dialog open={!!r} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Histórico</DialogTitle>
          <DialogDescription>{r?.nome ?? "—"} · {r ? (r.cpf_fmt ?? formatarCpf(r.cpf_digits)) : ""}</DialogDescription>
        </DialogHeader>
        {h.isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
          : (h.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sem histórico registrado. {r ? <>Na lista desde {fmtData(r.criado_em)}{r.criado_por ? ` (${r.criado_por})` : ""}.</> : null}
            </p>
          ) : (
            <ol className="max-h-[60vh] space-y-2 overflow-y-auto">
              {h.data!.map((e) => (
                <li key={e.id} className="rounded-lg border p-2.5 text-sm">
                  <div className="flex items-center justify-between"><b>{rotulo[e.acao]}</b><span className="text-xs text-muted-foreground">{fmtData(e.em)} · {e.por ?? "—"}</span></div>
                  {e.motivo && <div className="mt-0.5 text-xs"><span className="text-muted-foreground">Motivo:</span> {e.motivo}</div>}
                  {e.observacao && <div className="mt-0.5 text-xs"><span className="text-muted-foreground">Por que saiu:</span> {e.observacao}</div>}
                </li>
              ))}
            </ol>
          )}
      </DialogContent>
    </Dialog>
  );
}
