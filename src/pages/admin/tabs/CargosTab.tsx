import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertTriangle, Briefcase, GitMerge, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import { useCargoCatalogo } from "@/components/admin/CargoCampo";
import {
  NIVEIS_CARGO, cargoUsadoPeloMalote, limparNomeCargo, sugerirNivelPorCargo, type NivelCargo,
} from "@/lib/acessoPorSetorCargo";

// "CARGO_CATALOGO" e cargo_juntar são de 10/11/2026 (SIS-2026-0851) — fora do types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const CLASSE_SELECT = "h-8 rounded-md border border-input bg-background px-2 text-xs";

const AVISO_MALOTE =
  "O Malote decide quem é supervisor pelo nome do cargo (contém CONTROLADORIA, DIRETOR, SISTEMAS ou GERENTE FINANCEIRO, ou é PRESIDENTE). Renomear ou juntar este cargo pode mudar quem aprova despesas.";

function mensagemDeErro(e: unknown): string {
  const erro = e as { code?: string; message?: string } | null;
  const code = erro?.code;
  if (code === "23505") return "Já existe um cargo com esse nome.";
  if (code === "23503" || code === "23001") return "Tem gente com esse cargo. Junte-o com outro antes de excluir.";
  return erro?.message ?? "Erro inesperado.";
}

/**
 * Configurações do ERP › Cargos (SIS-2026-0851). Até 10/11/2026 o cargo era
 * digitado à mão em cada usuário — 47 grafias para 161 pessoas. Agora sai
 * desta lista, e cada cargo carrega o NÍVEL que agrupa as pessoas na
 * liberação em massa (Módulos & Menus › Por Setor / Cargo).
 */
export function CargosTab() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const podeGerenciar = can("alterar", undefined, "administracao");
  const { cargos, disponivel, carregando } = useCargoCatalogo();
  const [novoNome, setNovoNome] = useState("");
  const [novoNivel, setNovoNivel] = useState<NivelCargo>("adm");
  const [criando, setCriando] = useState(false);
  const [busca, setBusca] = useState("");

  const contagemQ = useQuery({
    queryKey: ["cargo_contagem"],
    queryFn: async () => {
      const { data, error } = await sb.from("profiles").select("cargo");
      if (error) throw error;
      const m: Record<string, number> = {};
      ((data ?? []) as { cargo: string | null }[]).forEach((r) => { if (r.cargo) m[r.cargo] = (m[r.cargo] ?? 0) + 1; });
      return m;
    },
  });

  const invalidarTudo = () => {
    qc.invalidateQueries({ queryKey: ["cargo_catalogo"] });
    qc.invalidateQueries({ queryKey: ["cargo_contagem"] });
    qc.invalidateQueries({ queryKey: ["admin-profiles"] });
    qc.invalidateQueries({ queryKey: ["acesso-massa-pessoas"] });
  };

  const criar = async () => {
    const nome = limparNomeCargo(novoNome);
    if (!nome) return;
    setCriando(true);
    try {
      const { error } = await sb.from("CARGO_CATALOGO").insert({ nome, nivel: novoNivel });
      if (error) throw error;
      toast({ title: "Cargo criado" });
      setNovoNome("");
      setNovoNivel("adm");
      invalidarTudo();
    } catch (e) {
      toast({ title: "Erro ao criar cargo", description: mensagemDeErro(e), variant: "destructive" });
    } finally {
      setCriando(false);
    }
  };

  const trocarNivel = async (nome: string, nivel: NivelCargo) => {
    const { error } = await sb.from("CARGO_CATALOGO").update({ nivel }).eq("nome", nome);
    if (error) toast({ title: "Erro ao trocar o nível", description: mensagemDeErro(error), variant: "destructive" });
    else { toast({ title: "Nível atualizado" }); invalidarTudo(); }
  };

  const filtrados = useMemo(() => {
    const q = busca.trim().toLocaleUpperCase("pt-BR");
    return q ? cargos.filter((c) => c.nome.includes(q)) : cargos;
  }, [cargos, busca]);

  if (!podeGerenciar) {
    return <section className="card-elevated p-6 text-sm text-muted-foreground">Apenas administradores podem gerenciar cargos.</section>;
  }
  if (!disponivel) {
    return (
      <section className="card-elevated p-6 text-sm text-muted-foreground">
        A lista de cargos ainda não está no banco (migration do SIS-2026-0851 pendente). Assim que ela for aplicada, esta aba passa a funcionar.
      </section>
    );
  }

  return (
    <section className="card-elevated">
      <header className="border-b border-border px-5 py-3.5">
        <h2 className="font-display text-sm font-bold">Cargos</h2>
        <p className="text-xs text-muted-foreground">
          O cargo de cada usuário sai desta lista. O <strong>nível</strong> agrupa as pessoas para liberar acesso em massa
          (Módulos &amp; Menus › Por Setor / Cargo) — sozinho, não libera nada.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-border p-4">
        <Input
          className="min-w-[220px] flex-1"
          value={novoNome}
          onChange={(e) => { setNovoNome(e.target.value); setNovoNivel(sugerirNivelPorCargo(e.target.value)); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); criar(); } }}
          placeholder="Novo cargo (ex.: ANALISTA FINANCEIRO II)"
        />
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={novoNivel} onChange={(e) => setNovoNivel(e.target.value as NivelCargo)} aria-label="Nível do novo cargo">
          {NIVEIS_CARGO.map((n) => <option key={n.codigo} value={n.codigo}>{n.rotulo}</option>)}
        </select>
        <Button onClick={criar} disabled={criando || !limparNomeCargo(novoNome)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Criar cargo
        </Button>
      </div>

      <div className="border-b border-border px-4 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cargo…" className="h-8 pl-8 text-xs" />
        </div>
      </div>

      <div className="divide-y divide-border">
        {carregando && <p className="p-4 text-xs text-muted-foreground">Carregando…</p>}
        {!carregando && filtrados.length === 0 && <p className="p-4 text-xs text-muted-foreground">Nenhum cargo encontrado.</p>}
        {filtrados.map((c) => {
          const qtd = contagemQ.data?.[c.nome] ?? 0;
          const malote = cargoUsadoPeloMalote(c.nome);
          return (
            <div key={c.nome} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.nome}</span>
              {malote && (
                <Badge variant="outline" className="shrink-0 border-warning/50 text-[10px] text-warning" title={AVISO_MALOTE}>usado pelo Malote</Badge>
              )}
              <Badge variant="secondary" className="shrink-0 text-[10px]">{qtd} pessoa(s)</Badge>
              <select className={CLASSE_SELECT} value={c.nivel} onChange={(e) => trocarNivel(c.nome, e.target.value as NivelCargo)} aria-label={`Nível de ${c.nome}`}>
                {NIVEIS_CARGO.map((n) => <option key={n.codigo} value={n.codigo}>{n.rotulo}</option>)}
              </select>
              <div className="flex shrink-0 items-center gap-1">
                <RenomearCargoDialog nome={c.nome} malote={malote} onSaved={invalidarTudo} />
                <JuntarCargoDialog nome={c.nome} qtd={qtd} malote={malote} outros={cargos.map((x) => x.nome).filter((n) => n !== c.nome)} onSaved={invalidarTudo} />
                <ExcluirCargoDialog nome={c.nome} qtd={qtd} onDeleted={invalidarTudo} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RenomearCargoDialog({ nome, malote, onSaved }: { nome: string; malote: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [novoNome, setNovoNome] = useState(nome);
  const [saving, setSaving] = useState(false);

  const salvar = async () => {
    const limpo = limparNomeCargo(novoNome);
    if (!limpo || limpo === nome) { setOpen(false); return; }
    setSaving(true);
    try {
      // ON UPDATE CASCADE em profiles.cargo: as pessoas acompanham o nome novo.
      const { error } = await sb.from("CARGO_CATALOGO").update({ nome: limpo }).eq("nome", nome);
      if (error) throw error;
      toast({ title: "Cargo renomeado" });
      setOpen(false);
      onSaved();
    } catch (e) {
      toast({ title: "Erro ao renomear", description: mensagemDeErro(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setNovoNome(nome); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Renomear"><Pencil className="h-3.5 w-3.5" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Renomear cargo</DialogTitle></DialogHeader>
        <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
        <p className="text-[11px] text-muted-foreground">Atualiza automaticamente todo mundo que tem este cargo.</p>
        {malote && (
          <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px]">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" /> {AVISO_MALOTE}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JuntarCargoDialog({ nome, qtd, malote, outros, onSaved }: {
  nome: string; qtd: number; malote: boolean; outros: string[]; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [destino, setDestino] = useState("");
  const [saving, setSaving] = useState(false);
  const destinoMalote = cargoUsadoPeloMalote(destino);

  const juntar = async () => {
    if (!destino) return;
    setSaving(true);
    try {
      const { data, error } = await sb.rpc("cargo_juntar", { _origem: nome, _destino: destino });
      if (error) throw error;
      toast({ title: "Cargos juntados", description: `${data ?? 0} pessoa(s) passaram para ${destino}.` });
      setOpen(false);
      onSaved();
    } catch (e) {
      toast({ title: "Erro ao juntar", description: mensagemDeErro(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setDestino(""); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Juntar com outro cargo"><GitMerge className="h-3.5 w-3.5" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Juntar “{nome}” com outro cargo</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          As {qtd} pessoa(s) de “{nome}” passam para o cargo escolhido, e “{nome}” sai da lista.
        </p>
        <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">Escolha o cargo que fica…</option>
          {outros.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {(malote || destinoMalote) && (
          <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px]">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" /> {AVISO_MALOTE}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={juntar} disabled={saving || !destino}>{saving ? "Juntando…" : "Juntar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExcluirCargoDialog({ nome, qtd, onDeleted }: { nome: string; qtd: number; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [deletando, setDeletando] = useState(false);

  const excluir = async () => {
    setDeletando(true);
    try {
      const { error } = await sb.from("CARGO_CATALOGO").delete().eq("nome", nome);
      if (error) throw error;
      toast({ title: "Cargo excluído" });
      setOpen(false);
      onDeleted();
    } catch (e) {
      toast({ title: "Erro ao excluir", description: mensagemDeErro(e), variant: "destructive" });
    } finally {
      setDeletando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={qtd > 0} title={qtd > 0 ? "Tem gente com este cargo — junte com outro antes" : "Excluir"}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Excluir o cargo “{nome}”?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Ninguém tem este cargo hoje. Ele só sai da lista.</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={deletando}>Cancelar</Button>
          <Button variant="destructive" onClick={excluir} disabled={deletando}>{deletando ? "Excluindo…" : "Sim, excluir"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
