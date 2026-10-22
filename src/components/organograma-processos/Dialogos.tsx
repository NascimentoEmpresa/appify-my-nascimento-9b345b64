import { useEffect, useState, type ReactNode } from "react";
import { History, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buscarPessoas, useHistoricoEstrutura } from "@/hooks/useEstruturaProcessos";
import { FREQUENCIAS, NIVEIS, equipeDoSetor, type Estrutura, type Membro } from "@/lib/organograma/estruturaProcessos";
import { Avatar, ICONES, IconeSetor, OPCOES_COR, OPCOES_ICONE, cor } from "./visual";
import { cn } from "@/lib/utils";

// =====================================================================
// Diálogos do Cadastro da Estrutura (mig 20261020000060).
// =====================================================================

const Campo = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div><label className="mb-1 block text-xs font-medium text-foreground/80">{rotulo}</label>{children}</div>
);

export function DialogoNovoSetor({ e, aberto, onFechar, onCriar }: {
  e: Estrutura; aberto: boolean; onFechar: () => void;
  onCriar: (d: { nome: string; unidade_id: string | null; icone: string; cor: string }) => Promise<void>;
}) {
  const [f, setF] = useState({ nome: "", unidade_id: "", icone: "building", cor: "blue" });
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) setF({ nome: "", unidade_id: e.unidades.find((u) => u.tipo === "diretoria")?.id ?? "", icone: "building", cor: "blue" }); }, [aberto, e.unidades]);
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Novo setor</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Campo rotulo="Nome *"><Input value={f.nome} onChange={(x) => setF({ ...f, nome: x.target.value })} placeholder="ex.: Faturamento" /></Campo>
          <Campo rotulo="Diretoria">
            <Select value={f.unidade_id || "_"} onValueChange={(v) => setF({ ...f, unidade_id: v === "_" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="_">— Nenhuma —</SelectItem>{e.unidades.filter((u) => u.tipo === "diretoria").map((u) => <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>)}</SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Ícone">
            <div className="flex flex-wrap gap-1.5">{OPCOES_ICONE.map((i) => { const I = ICONES[i]; return (
              <button key={i} onClick={() => setF({ ...f, icone: i })} className={cn("rounded-md border p-1.5", f.icone === i && "border-primary bg-primary/10")}><I className="h-4 w-4" /></button>
            ); })}</div>
          </Campo>
          <Campo rotulo="Cor">
            <div className="flex flex-wrap gap-1.5">{OPCOES_COR.map((c) => (
              <button key={c} onClick={() => setF({ ...f, cor: c })} className={cn("h-6 w-6 rounded-full ring-offset-2", f.cor === c && "ring-2 ring-primary")} style={{ background: cor(c).hex }} />
            ))}</div>
          </Campo>
          <div className="flex items-center gap-2 rounded-lg border p-2"><IconeSetor icone={f.icone} corSetor={f.cor} /> <span className="font-semibold">{f.nome || "Novo setor"}</span></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button disabled={!f.nome.trim() || salvando} onClick={async () => {
            setSalvando(true);
            try { await onCriar({ nome: f.nome.trim(), unidade_id: f.unidade_id || null, icone: f.icone, cor: f.cor }); onFechar(); }
            catch (err) { toast.error((err as Error).message); } finally { setSalvando(false); }
          }}>{salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Criar setor</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DialogoNovoProcesso({ e, setorId, aberto, onFechar, onCriar }: {
  e: Estrutura; setorId: string | null; aberto: boolean; onFechar: () => void;
  onCriar: (d: { nome: string; setor_id: string; frequencia: string | null; responsavel_membro_id: string | null; encadear: boolean }) => Promise<void>;
}) {
  const [f, setF] = useState({ nome: "", setor_id: "", frequencia: "", responsavel: "", encadear: true });
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) setF({ nome: "", setor_id: setorId ?? "", frequencia: "", responsavel: "", encadear: true }); }, [aberto, setorId]);
  const equipe = f.setor_id ? equipeDoSetor(e, f.setor_id) : [];
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Novo processo</DialogTitle><DialogDescription>O código (P-000) é gerado automaticamente.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Campo rotulo="Nome do processo *"><Input value={f.nome} onChange={(x) => setF({ ...f, nome: x.target.value })} placeholder="ex.: Conferir lançamentos" /></Campo>
          <Campo rotulo="Setor *">
            <Select value={f.setor_id || "_"} onValueChange={(v) => setF({ ...f, setor_id: v === "_" ? "" : v, responsavel: "" })}>
              <SelectTrigger><SelectValue placeholder="Setor" /></SelectTrigger>
              <SelectContent><SelectItem value="_">Setor…</SelectItem>{e.setores.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}</SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Responsável">
            <Select value={f.responsavel || "_"} onValueChange={(v) => setF({ ...f, responsavel: v === "_" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="_">— Depois —</SelectItem>{equipe.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome} · {m.cargo}</SelectItem>)}</SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Frequência">
            <Select value={f.frequencia || "_"} onValueChange={(v) => setF({ ...f, frequencia: v === "_" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="_">—</SelectItem>{FREQUENCIAS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
            </Select>
          </Campo>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.encadear} onCheckedChange={(v) => setF({ ...f, encadear: v })} /> Entrar no fim do fluxo do setor</label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button disabled={!f.nome.trim() || !f.setor_id || salvando} onClick={async () => {
            setSalvando(true);
            try {
              await onCriar({ nome: f.nome.trim(), setor_id: f.setor_id, frequencia: f.frequencia || null, responsavel_membro_id: f.responsavel || null, encadear: f.encadear });
              onFechar();
            } catch (err) { toast.error((err as Error).message); } finally { setSalvando(false); }
          }}>{salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Criar processo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PessoaCadastro = Awaited<ReturnType<typeof buscarPessoas>>[number];

/** Pessoa da equipe: digitada ou vinculada ao cadastro (traz nome, cargo e foto). */
export function DialogoMembro({ e, setorId, membro, aberto, onFechar, onSalvar }: {
  e: Estrutura; setorId: string; membro: Membro | null; aberto: boolean; onFechar: () => void;
  onSalvar: (d: Partial<Membro>) => Promise<void>;
}) {
  const vazio = { nome: "", cargo: "", nivel: 3, parent_id: "", responsavel: false, atividades: "", empregado_id: null as number | null, user_id: null as string | null, avatar_url: null as string | null };
  const [f, setF] = useState(vazio);
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<PessoaCadastro[]>([]);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (!aberto) return;
    setBusca(""); setAchados([]);
    setF(membro ? {
      nome: membro.nome, cargo: membro.cargo, nivel: membro.nivel, parent_id: membro.parent_id ?? "", responsavel: membro.responsavel,
      atividades: membro.atividades ?? "", empregado_id: membro.empregado_id, user_id: membro.user_id, avatar_url: membro.avatar_url ?? null,
    } : vazio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, membro]);
  useEffect(() => {
    if (busca.trim().length < 2) { setAchados([]); return; }
    const t = setTimeout(() => buscarPessoas(busca).then(setAchados).catch((err) => toast.error(err.message)), 300);
    return () => clearTimeout(t);
  }, [busca]);
  const chefes = equipeDoSetor(e, setorId).filter((m) => m.id !== membro?.id);
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{membro ? "Editar pessoa da equipe" : "Adicionar pessoa à equipe"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {/* Pessoa real, sempre (mig 20261022000300): nome e foto vêm do
              cadastro; o texto da carga inicial só aparece como pista. */}
          {membro && !membro.empregado_id && !f.empregado_id && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              Pendente de vínculo: estava digitado como <b>{membro.nome}</b>. Escolha a pessoa no cadastro — funções e processos continuam ligados.
            </p>
          )}
          <Campo rotulo="Pessoa (cadastro de colaboradores) *">
            {f.empregado_id ? (
              <div className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                <Avatar nome={f.nome} foto={f.avatar_url} tamanho={26} /> <span className="flex-1">{f.nome} <span className="text-xs text-muted-foreground">· cadastro #{f.empregado_id}{f.user_id ? "" : " · sem login no ERP"}</span></span>
                <button onClick={() => setF({ ...f, empregado_id: null, user_id: null, avatar_url: null })} title="Trocar a pessoa"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Buscar pelo nome…" value={busca} onChange={(x) => setBusca(x.target.value)} autoFocus />
                {achados.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
                    {achados.map((p) => (
                      <button key={p.empregado_id} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => { setF({ ...f, nome: p.nome, cargo: f.cargo || (p.cargo ?? ""), empregado_id: p.empregado_id, user_id: p.user_id, avatar_url: p.avatar_url }); setBusca(""); setAchados([]); }}>
                        <Avatar nome={p.nome} foto={p.avatar_url} tamanho={24} />
                        <span className="min-w-0 flex-1 truncate">{p.nome}<span className="block truncate text-[11px] text-muted-foreground">{p.cargo ?? ""}{p.setor ? ` · ${p.setor}` : ""}</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Campo>
          <Campo rotulo="Cargo no organograma *"><Input value={f.cargo} onChange={(x) => setF({ ...f, cargo: x.target.value })} placeholder="ex.: Analista de DP" /></Campo>
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Nível">
              <Select value={String(f.nivel)} onValueChange={(v) => setF({ ...f, nivel: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NIVEIS.map((n) => <SelectItem key={n.nivel} value={String(n.nivel)}>{n.rotulo}</SelectItem>)}</SelectContent>
              </Select>
            </Campo>
            <Campo rotulo="Responde a">
              <Select value={f.parent_id || "_"} onValueChange={(v) => setF({ ...f, parent_id: v === "_" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="_">— Ninguém no setor —</SelectItem>{chefes.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome} · {m.cargo}</SelectItem>)}</SelectContent>
              </Select>
            </Campo>
          </div>
          <Campo rotulo="Funções / atividades (uma por linha)">
            <Textarea rows={5} value={f.atividades} onChange={(x) => setF({ ...f, atividades: x.target.value })} placeholder={"Conferir os pontos do mês\nEnviar o fechamento ao RH"} />
          </Campo>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.responsavel} onCheckedChange={(v) => setF({ ...f, responsavel: v })} /> Responsável pelo setor</label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button disabled={!f.empregado_id || !f.cargo.trim() || salvando} onClick={async () => {
            setSalvando(true);
            try {
              await onSalvar({
                ...(membro ? { id: membro.id } : { setor_id: setorId }), nome: f.nome.trim(), cargo: f.cargo.trim(), nivel: f.nivel,
                parent_id: f.parent_id || null, responsavel: f.responsavel, atividades: f.atividades.trim() || null,
                empregado_id: f.empregado_id, user_id: f.user_id,
              });
              onFechar();
            } catch (err) { toast.error((err as Error).message); } finally { setSalvando(false); }
          }}>{salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DialogoPublicar({ aberto, onFechar, onPublicar }: { aberto: boolean; onFechar: () => void; onPublicar: (obs: string) => Promise<void> }) {
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) setObs(""); }, [aberto]);
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Publicar estrutura</DialogTitle>
          <DialogDescription>O Organograma Geral passa a mostrar a estrutura como está agora. As publicações anteriores ficam no histórico.</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={obs} onChange={(x) => setObs(x.target.value)} placeholder="O que mudou (opcional)" />
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button disabled={salvando} onClick={async () => { setSalvando(true); try { await onPublicar(obs); onFechar(); } finally { setSalvando(false); } }}>
            {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Publicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DialogoHistorico({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const h = useHistoricoEstrutura(aberto);
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Histórico de publicações</DialogTitle></DialogHeader>
        {h.isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
          : (h.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma publicação ainda. O Organograma Geral mostra o rascunho até a primeira.</p>
          : (
            <ol className="max-h-[60vh] space-y-2 overflow-y-auto">
              {h.data!.map((p) => (
                <li key={p.versao} className="rounded-lg border p-2.5 text-sm">
                  <div className="flex items-center justify-between"><b>Versão {p.versao}</b><span className="text-xs text-muted-foreground">{new Date(p.publicado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span></div>
                  <div className="text-xs text-muted-foreground">{p.publicado_por ?? "—"} · {p.setores} setores · {p.processos} processos · {p.conexoes} conexões</div>
                  {p.observacao && <div className="mt-1 whitespace-pre-wrap text-xs">{p.observacao}</div>}
                </li>
              ))}
            </ol>
          )}
      </DialogContent>
    </Dialog>
  );
}
