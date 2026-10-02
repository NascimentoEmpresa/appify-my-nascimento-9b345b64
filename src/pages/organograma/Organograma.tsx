import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as RMouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, BarChart3, Building2, Check, ChevronDown, ChevronUp, FileText, GraduationCap, HardHat, Loader2, Maximize,
  Megaphone, Minus, Monitor, Network, Package, Pencil, Plus, Printer, Scale, Search, ShieldCheck, Trash2, UserPlus, Users, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// =====================================================================
// ORGANOGRAMA (30/09/2026, mig 20260930000277)
//
// "Montar o organograma com os integrantes que temos como usuários no
// sistema, com foto, nome e função" (Pablo). Um nó por usuário do ERP, com
// quem ele reporta a. Foto (profiles.avatar_url), nome e cargo vêm na
// leitura (RPC organograma_nos) — não são copiados, então trocar a foto no
// perfil ou o cargo na Senior reflete aqui sozinho. A função pode ser escrita
// à mão no nó, quando o cargo oficial não diz o papel no organograma.
//
// Quem monta (incluir/alterar): adiciona pessoa, arrasta um card para cima de
// outro para mudar o chefe, reordena entre irmãos e escreve a função. Tirar
// pessoa (excluir) sobe os subordinados dela para o chefe dela — o banco faz.
// O banco também recusa ciclo (A reporta a B que reporta a A).
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const MENU = "organograma";

interface No {
  id: string; user_id: string; parent_id: string | null; ordem: number; funcao_manual: string | null;
  nome: string; email: string | null; avatar_url: string | null; cargo: string | null; setor: string | null; ativo: boolean;
  cor: string | null;
}
interface Usuario {
  user_id: string; nome: string; email: string | null; avatar_url: string | null; cargo: string | null; setor: string | null; no_organograma: boolean;
}

const funcaoDe = (n: Pick<No, "funcao_manual" | "cargo">) => n.funcao_manual || n.cargo || "";

const CORES = ["#0f3171", "#1d4ed8", "#0e7490", "#047857", "#7c3aed", "#be123c", "#b45309", "#334155"];
const corDe = (s: string) => CORES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % CORES.length];
// Cor do card (mig 20260930000280): opcional, pinta faixa do topo, borda e
// um fundo bem claro. Hex de 6 dígitos — o sufixo de 2 dígitos dá a opacidade.
const PALETA_CARD: { cor: string; nome: string }[] = [
  { cor: "#0f3171", nome: "Azul-marinho" }, { cor: "#2563eb", nome: "Azul" }, { cor: "#0891b2", nome: "Ciano" },
  { cor: "#0d9488", nome: "Verde-água" }, { cor: "#16a34a", nome: "Verde" }, { cor: "#65a30d", nome: "Lima" },
  { cor: "#ca8a04", nome: "Amarelo" }, { cor: "#ea580c", nome: "Laranja" }, { cor: "#dc2626", nome: "Vermelho" },
  { cor: "#db2777", nome: "Rosa" }, { cor: "#9333ea", nome: "Roxo" }, { cor: "#475569", nome: "Cinza" },
];
const estiloCard = (cor: string | null) => cor
  ? { borderColor: `${cor}66`, borderTop: `5px solid ${cor}`, background: `linear-gradient(${cor}14, ${cor}14), hsl(var(--card))` }
  : undefined;

// Ícone do painel de setor: pelo nome (sem acento, minúsculo); senão, um prédio.
const ICONES_SETOR: [RegExp, LucideIcon][] = [
  [/\b(rh|recursos humanos|pessoal|recrut)/, Users], [/financ|tesour|contab|fiscal|controlador/, BarChart3],
  [/licita|contrato/, FileText], [/sistema|\bti\b|tecnologia|informatica/, Monitor], [/\bsst\b|seguranca|saude/, ShieldCheck],
  [/treinamento/, GraduationCap], [/juridic/, Scale], [/suprimento|compra|almox/, Package], [/operac|campo|obra/, HardHat],
  [/marketing|comunica/, Megaphone],
];
const iconeSetor = (setor: string): LucideIcon => {
  const s = setor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return ICONES_SETOR.find(([re]) => re.test(s))?.[1] ?? Building2;
};

const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

function Avatar({ nome, url, tamanho = 56 }: { nome: string; url: string | null; tamanho?: number }) {
  const [erro, setErro] = useState(false);
  if (url && !erro) {
    return <img src={url} alt={nome} onError={() => setErro(true)} className="shrink-0 rounded-full object-cover ring-2 ring-white shadow" style={{ width: tamanho, height: tamanho }} />;
  }
  return (
    <div className="grid shrink-0 place-items-center rounded-full font-bold text-white ring-2 ring-white shadow"
         style={{ width: tamanho, height: tamanho, background: corDe(nome), fontSize: tamanho * 0.36 }}>
      {iniciais(nome)}
    </div>
  );
}

export default function Organograma() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const podeVer = can("visualizar", undefined, MENU);
  const podeIncluir = can("incluir", undefined, MENU) || can("alterar", undefined, MENU);
  const podeAlterar = can("alterar", undefined, MENU);
  const podeExcluir = can("excluir", undefined, MENU);
  const podeMontar = podeIncluir || podeAlterar;

  const nosQ = useQuery({
    queryKey: ["organograma-nos"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("organograma_nos");
      if (error) throw error;
      return (data ?? []) as No[];
    },
  });
  const nos = nosQ.data ?? [];

  const [edicao, setEdicao] = useState(false);
  const [busca, setBusca] = useState("");
  const [escala, setEscala] = useState(1);
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  const [adicionar, setAdicionar] = useState<{ parentId: string | null } | null>(null);
  const [editando, setEditando] = useState<No | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvoDrop, setAlvoDrop] = useState<string | null>(null);

  // ── Árvore ──────────────────────────────────────────────────────────
  const porId = useMemo(() => new Map(nos.map((n) => [n.id, n])), [nos]);
  const filhos = useMemo(() => {
    const m = new Map<string | null, No[]>();
    nos.forEach((n) => {
      const pai = n.parent_id && porId.has(n.parent_id) ? n.parent_id : null;
      m.set(pai, [...(m.get(pai) ?? []), n]);
    });
    m.forEach((l) => l.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR")));
    return m;
  }, [nos, porId]);
  const raizes = filhos.get(null) ?? [];

  const descendentes = (id: string): Set<string> => {
    const out = new Set<string>();
    const pilha = [id];
    while (pilha.length) {
      const atual = pilha.pop()!;
      (filhos.get(atual) ?? []).forEach((f) => { if (!out.has(f.id)) { out.add(f.id); pilha.push(f.id); } });
    }
    return out;
  };
  const totalAbaixo = (id: string) => descendentes(id).size;

  // Busca: acha, abre os ramos até a pessoa e rola até ela.
  const termo = busca.trim().toLowerCase();
  const achados = useMemo(() => (termo.length < 2 ? new Set<string>() : new Set(
    nos.filter((n) => `${n.nome} ${funcaoDe(n)} ${n.setor ?? ""}`.toLowerCase().includes(termo)).map((n) => n.id),
  )), [nos, termo]);
  useEffect(() => {
    if (!achados.size) return;
    const abrir = new Set(recolhidos);
    let mudou = false;
    achados.forEach((id) => {
      let p = porId.get(id)?.parent_id ?? null;
      while (p) { if (abrir.delete(p)) mudou = true; p = porId.get(p)?.parent_id ?? null; }
    });
    if (mudou) setRecolhidos(abrir);
    const primeiro = [...achados][0];
    window.setTimeout(() => document.getElementById(`org-${primeiro}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }), 80);
  }, [achados]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Arrastar a tela (pan) ───────────────────────────────────────────
  const caixaRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const inicioPan = (e: RMouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-card]") || !caixaRef.current) return;
    pan.current = { x: e.clientX, y: e.clientY, sl: caixaRef.current.scrollLeft, st: caixaRef.current.scrollTop };
  };
  const movePan = (e: RMouseEvent) => {
    if (!pan.current || !caixaRef.current) return;
    caixaRef.current.scrollLeft = pan.current.sl - (e.clientX - pan.current.x);
    caixaRef.current.scrollTop = pan.current.st - (e.clientY - pan.current.y);
  };
  const fimPan = () => { pan.current = null; };

  const ajustar = () => {
    const caixa = caixaRef.current; const arvore = caixa?.querySelector<HTMLElement>("[data-arvore]");
    if (!caixa || !arvore) return;
    const larg = arvore.scrollWidth / escala;
    setEscala(Math.max(0.3, Math.min(1.2, (caixa.clientWidth - 40) / larg)));
  };

  // ── Gravações ───────────────────────────────────────────────────────
  const recarregar = () => { qc.invalidateQueries({ queryKey: ["organograma-nos"] }); qc.invalidateQueries({ queryKey: ["organograma-usuarios"] }); };
  const mudarChefe = async (id: string, parentId: string | null) => {
    if (parentId && (parentId === id || descendentes(id).has(parentId))) {
      toast.error("Essa pessoa não pode reportar a alguém que está abaixo dela."); return;
    }
    const ordem = (filhos.get(parentId) ?? []).length;
    const { error } = await sb.from("ORGANOGRAMA_NO").update({ parent_id: parentId, ordem }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    recarregar();
  };
  const mover = async (n: No, d: -1 | 1) => {
    const irmaos = [...(filhos.get(n.parent_id && porId.has(n.parent_id) ? n.parent_id : null) ?? [])];
    const i = irmaos.findIndex((x) => x.id === n.id); const j = i + d;
    if (i < 0 || j < 0 || j >= irmaos.length) return;
    [irmaos[i], irmaos[j]] = [irmaos[j], irmaos[i]];
    const erros = await Promise.all(irmaos.map((x, k) => sb.from("ORGANOGRAMA_NO").update({ ordem: k }).eq("id", x.id)));
    const e = erros.find((r: { error: unknown }) => r.error);
    if (e) toast.error((e.error as Error).message);
    recarregar();
  };

  // ── Arrastar card sobre card (mudar o chefe) ────────────────────────
  const onDragStart = (e: DragEvent, id: string) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); setArrastando(id); };
  const onDragOver = (e: DragEvent, alvo: string | null) => {
    if (!arrastando || arrastando === alvo || (alvo && descendentes(arrastando).has(alvo))) return;
    e.preventDefault(); setAlvoDrop(alvo ?? "__topo");
  };
  const onDrop = (e: DragEvent, alvo: string | null) => {
    e.preventDefault();
    const id = arrastando; setArrastando(null); setAlvoDrop(null);
    if (!id || id === alvo) return;
    const atual = porId.get(id)?.parent_id ?? null;
    if (atual === alvo) return;
    mudarChefe(id, alvo);
  };

  // ── Desenho ─────────────────────────────────────────────────────────
  // Layout de 02/10/2026 (pedido do Pablo, com imagem de referência): quem
  // tem equipe é um card horizontal (foto à esquerda) ligado na árvore; quem
  // NÃO tem ninguém abaixo não abre mais um galho próprio — entra num painel
  // por SETOR debaixo do chefe ("RH · 4 pessoas"), em lista (2 colunas a
  // partir de 5). A árvore fica baixa e larga em vez de descer em escada.
  const eventosCard = (n: No) => ({
    id: `org-${n.id}`, "data-card": true,
    draggable: edicao && podeAlterar,
    onDragStart: (e: DragEvent) => onDragStart(e, n.id),
    onDragEnd: () => { setArrastando(null); setAlvoDrop(null); },
    onDragOver: (e: DragEvent) => onDragOver(e, n.id),
    onDragLeave: () => setAlvoDrop((a) => (a === n.id ? null : a)),
    onDrop: (e: DragEvent) => onDrop(e, n.id),
    onClick: () => edicao && podeMontar && setEditando(n),
  });
  const estadoCard = (n: No) => cn(
    edicao && podeMontar && "cursor-pointer hover:border-primary/50 hover:shadow-md",
    edicao && podeAlterar && "cursor-grab active:cursor-grabbing",
    achados.has(n.id) && "ring-4 ring-amber-300",
    alvoDrop === n.id && "ring-4 ring-primary/40",
    arrastando === n.id && "opacity-40",
    !n.ativo && "opacity-60",
  );

  const renderPainel = (setor: string, membros: No[], pai: No) => {
    const contagem = new Map<string, number>();
    membros.forEach((m) => m.cor && contagem.set(m.cor, (contagem.get(m.cor) ?? 0) + 1));
    const corMembros = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const cor = corMembros ?? pai.cor ?? corDe(setor);
    const Icone = iconeSetor(setor);
    const duasColunas = membros.length > 4;
    return (
      <li key={`painel-${pai.id}-${setor}`}>
        <div className="org-painel rounded-2xl border-2 p-3 shadow-sm" style={{ borderColor: `${cor}40`, background: `linear-gradient(${cor}0d, ${cor}0d), hsl(var(--card))` }}>
          <div className="mb-2.5 flex items-center gap-2 px-1">
            <Icone className="h-5 w-5 shrink-0" style={{ color: cor }} />
            <span className="flex-1 truncate text-sm font-bold" style={{ color: cor }}>{setor}</span>
            <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ color: cor, background: `${cor}1f` }}>
              {membros.length} {membros.length === 1 ? "pessoa" : "pessoas"}
            </span>
          </div>
          <div className={cn("grid gap-2", duasColunas ? "grid-cols-2" : "grid-cols-1")}>
            {membros.map((m) => (
              <div key={m.id} {...eventosCard(m)}
                className={cn("org-card relative flex w-[226px] items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-sm transition", estadoCard(m))}>
                <Avatar nome={m.nome} url={m.avatar_url} tamanho={40} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[11.5px] font-bold uppercase leading-tight">{m.nome}</p>
                  {funcaoDe(m) && <p className="mt-0.5 line-clamp-2 text-[10px] font-semibold uppercase leading-tight" style={{ color: m.cor ?? cor }}>{funcaoDe(m)}</p>}
                  {m.setor && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{m.setor}</p>}
                  {!m.ativo && <p className="text-[10px] font-semibold text-destructive">usuário inativo</p>}
                </div>
                {edicao && podeMontar && <Pencil className="absolute right-2 top-2 h-3 w-3 text-muted-foreground" />}
              </div>
            ))}
          </div>
        </div>
      </li>
    );
  };

  const renderNo = (n: No) => {
    const subs = filhos.get(n.id) ?? [];
    const recolhido = recolhidos.has(n.id);
    // Filhos com equipe seguem na árvore; os sem equipe vão para o painel do
    // setor, na posição do primeiro deles.
    const itens: ({ tipo: "no"; no: No } | { tipo: "painel"; setor: string; membros: No[] })[] = [];
    const paineis = new Map<string, No[]>();
    subs.forEach((f) => {
      if ((filhos.get(f.id) ?? []).length) { itens.push({ tipo: "no", no: f }); return; }
      const setor = f.setor?.trim() || "Sem setor";
      if (!paineis.has(setor)) { const membros: No[] = []; paineis.set(setor, membros); itens.push({ tipo: "painel", setor, membros }); }
      paineis.get(setor)!.push(f);
    });
    return (
      <li key={n.id}>
        <div {...eventosCard(n)} style={estiloCard(n.cor)}
          className={cn("org-card relative flex w-[250px] items-center gap-3 rounded-2xl border-2 bg-card px-4 py-3.5 text-left shadow-sm transition", estadoCard(n))}>
          <Avatar nome={n.nome} url={n.avatar_url} tamanho={52} />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[12.5px] font-bold uppercase leading-tight">{n.nome}</p>
            {funcaoDe(n) && <p className="mt-0.5 line-clamp-2 text-[10.5px] font-semibold uppercase leading-tight text-primary" style={n.cor ? { color: n.cor } : undefined}>{funcaoDe(n)}</p>}
            {n.setor && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{n.setor}</p>}
            {!n.ativo && <p className="text-[10px] font-semibold text-destructive">usuário inativo</p>}
          </div>
          {edicao && podeMontar && <Pencil className="absolute right-2 top-2 h-3.5 w-3.5 text-muted-foreground" />}
          {subs.length > 0 && (
            <button type="button" data-card
              onClick={(e) => { e.stopPropagation(); setRecolhidos((s) => { const x = new Set(s); x.has(n.id) ? x.delete(n.id) : x.add(n.id); return x; }); }}
              title={recolhido ? `Mostrar a equipe (${totalAbaixo(n.id)})` : `Recolher a equipe (${totalAbaixo(n.id)})`}
              className="absolute -bottom-3 left-1/2 flex h-6 -translate-x-1/2 items-center gap-0.5 rounded-full border bg-background px-2 text-[10px] font-bold text-muted-foreground shadow-sm hover:text-foreground">
              {recolhido ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />} {totalAbaixo(n.id)}
            </button>
          )}
        </div>
        {subs.length > 0 && !recolhido && (
          <ul>{itens.map((it) => (it.tipo === "no" ? renderNo(it.no) : renderPainel(it.setor, it.membros, n)))}</ul>
        )}
      </li>
    );
  };

  if (!podeVer) {
    return (
      <div>
        <PageHeader title="Organograma" module="Organograma" breadcrumb={["Organograma"]} />
        <Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para o Organograma. Peça em Administração › Acesso por Usuário.</Card>
      </div>
    );
  }

  return (
    <div className="organograma-pagina">
      <style>{CSS_ORGANOGRAMA}</style>
      <PageHeader
        title="Organograma"
        subtitle="Quem é quem e quem reporta a quem — com foto, nome e função de cada pessoa do ERP."
        module="Organograma"
        breadcrumb={["Organograma"]}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="outline" onClick={() => window.print()} className="gap-1.5"><Printer className="h-4 w-4" /> Imprimir</Button>
            {podeMontar && (
              <Button variant={edicao ? "default" : "outline"} onClick={() => setEdicao((v) => !v)} className="gap-1.5">
                <Pencil className="h-4 w-4" /> {edicao ? "Concluir edição" : "Montar organograma"}
              </Button>
            )}
            {podeIncluir && edicao && (
              <Button onClick={() => setAdicionar({ parentId: null })} className="gap-1.5"><UserPlus className="h-4 w-4" /> Adicionar pessoa</Button>
            )}
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 w-72 pl-8" placeholder="Buscar pessoa, função ou setor…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {termo.length >= 2 && <span className="text-xs text-muted-foreground">{achados.size} encontrado(s)</span>}
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> {nos.length} pessoa(s)</span>
        <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Diminuir" onClick={() => setEscala((s) => Math.max(0.3, +(s - 0.1).toFixed(2)))}><Minus className="h-3.5 w-3.5" /></Button>
          <button type="button" className="w-12 text-center text-xs font-semibold tabular-nums" onClick={() => setEscala(1)} title="Tamanho real">{Math.round(escala * 100)}%</button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Aumentar" onClick={() => setEscala((s) => Math.min(1.6, +(s + 0.1).toFixed(2)))}><Plus className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Caber na tela" onClick={ajustar}><Maximize className="h-3.5 w-3.5" /></Button>
        </div>
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setRecolhidos(new Set())}>Expandir tudo</Button>
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setRecolhidos(new Set(nos.filter((n) => (filhos.get(n.id) ?? []).length).map((n) => n.id)))}>Recolher tudo</Button>
      </div>

      {edicao && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-xs text-primary print:hidden">
          <Pencil className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            Modo de montagem: clique num card para editar{podeAlterar ? " · arraste um card sobre outro para mudar quem ele reporta a" : ""}.
          </span>
          {podeAlterar && (
            <div onDragOver={(e) => onDragOver(e, null)} onDragLeave={() => setAlvoDrop((a) => (a === "__topo" ? null : a))} onDrop={(e) => onDrop(e, null)}
              className={cn("rounded-lg border-2 border-dashed px-3 py-1.5 font-semibold transition", alvoDrop === "__topo" ? "border-primary bg-primary/10" : "border-primary/30")}>
              Solte aqui para ir ao topo
            </div>
          )}
        </div>
      )}

      {nosQ.isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Montando o organograma…</Card>
      ) : nosQ.isError ? (
        <Card className="p-6 text-sm text-destructive">Não deu para carregar o organograma: {(nosQ.error as Error).message}</Card>
      ) : nos.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <Network className="h-12 w-12 text-muted-foreground/40" />
          <p className="font-medium">O organograma ainda está vazio</p>
          <p className="max-w-md text-sm text-muted-foreground">Comece pela pessoa do topo (a presidência ou a diretoria) e vá adicionando quem reporta a ela.</p>
          {podeIncluir && <Button onClick={() => { setEdicao(true); setAdicionar({ parentId: null }); }} className="gap-1.5"><UserPlus className="h-4 w-4" /> Adicionar a primeira pessoa</Button>}
        </Card>
      ) : (
        <div ref={caixaRef} onMouseDown={inicioPan} onMouseMove={movePan} onMouseUp={fimPan} onMouseLeave={fimPan}
             className="org-caixa relative h-[calc(100vh-270px)] min-h-[420px] cursor-grab overflow-auto rounded-2xl border bg-[radial-gradient(circle,_hsl(var(--muted))_1px,_transparent_1px)] [background-size:18px_18px] active:cursor-grabbing">
          <div data-arvore className="org-arvore inline-block min-w-full p-8" style={{ transform: `scale(${escala})`, transformOrigin: "top left" }}>
            <ul className="org-raiz">{raizes.map(renderNo)}</ul>
          </div>
        </div>
      )}

      {adicionar && (
        <AdicionarPessoa
          nos={nos} parentInicial={adicionar.parentId} onFechar={() => setAdicionar(null)}
          onSalvo={() => { setAdicionar(null); recarregar(); }}
        />
      )}
      {editando && (
        <EditarPessoa
          no={editando} nos={nos} descendentes={descendentes(editando.id)}
          podeAlterar={podeAlterar} podeExcluir={podeExcluir} podeIncluir={podeIncluir}
          onMover={(d) => mover(editando, d)}
          onAdicionarAbaixo={() => { const id = editando.id; setEditando(null); setAdicionar({ parentId: id }); }}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); recarregar(); }}
        />
      )}
    </div>
  );
}

// ── Diálogos ───────────────────────────────────────────────────────────

const SEM_CHEFE = "__topo";

function SeletorChefe({ nos, valor, onValor, excluir }: { nos: No[]; valor: string | null; onValor: (v: string | null) => void; excluir?: Set<string> }) {
  const opcoes = nos.filter((n) => !excluir?.has(n.id)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return (
    <Select value={valor ?? SEM_CHEFE} onValueChange={(v) => onValor(v === SEM_CHEFE ? null : v)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={SEM_CHEFE}>Ninguém — fica no topo</SelectItem>
        {opcoes.map((n) => <SelectItem key={n.id} value={n.id}>{n.nome}{funcaoDe(n) ? ` · ${funcaoDe(n)}` : ""}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function AdicionarPessoa({ nos, parentInicial, onFechar, onSalvo }: {
  nos: No[]; parentInicial: string | null; onFechar: () => void; onSalvo: () => void;
}) {
  const usuariosQ = useQuery({
    queryKey: ["organograma-usuarios"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("organograma_usuarios");
      if (error) throw error;
      return (data ?? []) as Usuario[];
    },
  });
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<Usuario | null>(null);
  const [chefe, setChefe] = useState<string | null>(parentInicial);
  const [funcao, setFuncao] = useState("");
  const [salvando, setSalvando] = useState(false);

  const termo = busca.trim().toLowerCase();
  const lista = (usuariosQ.data ?? [])
    .filter((u) => !u.no_organograma)
    .filter((u) => !termo || `${u.nome} ${u.email ?? ""} ${u.cargo ?? ""} ${u.setor ?? ""}`.toLowerCase().includes(termo))
    .slice(0, 60);

  const salvar = async () => {
    if (!escolhido) { toast.error("Escolha a pessoa."); return; }
    setSalvando(true);
    const irmaos = nos.filter((n) => (n.parent_id ?? null) === chefe).length;
    const { error } = await sb.from("ORGANOGRAMA_NO").insert({
      user_id: escolhido.user_id, parent_id: chefe, funcao: funcao.trim() || null, ordem: irmaos,
    });
    setSalvando(false);
    if (error) { toast.error(/duplicate|unique/i.test(error.message) ? "Essa pessoa já está no organograma." : error.message); return; }
    toast.success(`${escolhido.nome} entrou no organograma.`);
    onSalvo();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Adicionar pessoa</DialogTitle>
          <DialogDescription>Escolha um usuário do ERP e a quem ele reporta.</DialogDescription>
        </DialogHeader>

        {!escolhido ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus className="pl-8" placeholder="Buscar por nome, e-mail, cargo ou setor…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border p-1">
              {usuariosQ.isLoading && <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando usuários…</p>}
              {usuariosQ.isError && <p className="p-3 text-sm text-destructive">{(usuariosQ.error as Error).message}</p>}
              {lista.map((u) => (
                <button key={u.user_id} type="button" onClick={() => { setEscolhido(u); setFuncao(""); }}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted">
                  <Avatar nome={u.nome} url={u.avatar_url} tamanho={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{u.nome}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[u.cargo, u.setor].filter(Boolean).join(" · ") || u.email}</span>
                  </span>
                </button>
              ))}
              {!usuariosQ.isLoading && !lista.length && <p className="p-3 text-sm text-muted-foreground">Ninguém encontrado (quem já está no organograma não aparece aqui).</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border p-3">
              <Avatar nome={escolhido.nome} url={escolhido.avatar_url} tamanho={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{escolhido.nome}</p>
                <p className="truncate text-xs text-muted-foreground">{[escolhido.cargo, escolhido.setor].filter(Boolean).join(" · ") || escolhido.email}</p>
              </div>
              <Button variant="ghost" size="icon" title="Trocar pessoa" onClick={() => setEscolhido(null)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold">Reporta a</p>
              <SeletorChefe nos={nos} valor={chefe} onValor={setChefe} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold">Função no organograma <span className="font-normal text-muted-foreground">(opcional)</span></p>
              <Input value={funcao} onChange={(e) => setFuncao(e.target.value)} maxLength={80} placeholder={escolhido.cargo || "Ex.: Diretor Administrativo"} />
              <p className="text-[11px] text-muted-foreground">Em branco, vale o cargo do cadastro{escolhido.cargo ? ` (${escolhido.cargo})` : ""}.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onFechar}>Cancelar</Button>
              <Button onClick={salvar} disabled={salvando} className="gap-1.5">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Adicionar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditarPessoa({ no, nos, descendentes, podeAlterar, podeExcluir, podeIncluir, onMover, onAdicionarAbaixo, onFechar, onSalvo }: {
  no: No; nos: No[]; descendentes: Set<string>; podeAlterar: boolean; podeExcluir: boolean; podeIncluir: boolean;
  onMover: (d: -1 | 1) => void; onAdicionarAbaixo: () => void; onFechar: () => void; onSalvo: () => void;
}) {
  const [chefe, setChefe] = useState<string | null>(no.parent_id);
  const [funcao, setFuncao] = useState(no.funcao_manual ?? "");
  const [cor, setCor] = useState<string | null>(no.cor);
  const [corNaEquipe, setCorNaEquipe] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const excluir = new Set([no.id, ...descendentes]);
  const equipe = descendentes.size;

  const salvar = async () => {
    setSalvando(true);
    const patch: Record<string, unknown> = { funcao: funcao.trim() || null, cor };
    if (chefe !== no.parent_id) {
      patch.parent_id = chefe;
      patch.ordem = nos.filter((n) => (n.parent_id ?? null) === chefe).length;
    }
    const { error } = await sb.from("ORGANOGRAMA_NO").update(patch).eq("id", no.id);
    if (error) { setSalvando(false); toast.error(error.message); return; }
    if (corNaEquipe && descendentes.size) {
      const { error: e2 } = await sb.from("ORGANOGRAMA_NO").update({ cor }).in("id", [...descendentes]);
      if (e2) { setSalvando(false); toast.error(e2.message); return; }
    }
    setSalvando(false);
    toast.success("Organograma atualizado.");
    onSalvo();
  };
  const remover = async () => {
    if (!window.confirm(`Tirar ${no.nome} do organograma?${equipe ? ` A equipe dele(a) (${equipe} pessoa(s)) sobe para quem ele(a) reporta.` : ""}`)) return;
    const { error } = await sb.from("ORGANOGRAMA_NO").delete().eq("id", no.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${no.nome} saiu do organograma.`);
    onSalvo();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar no organograma</DialogTitle>
          <DialogDescription>Foto e nome vêm do perfil do usuário; o cargo, do cadastro.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-xl border p-3">
          <Avatar nome={no.nome} url={no.avatar_url} tamanho={52} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{no.nome}</p>
            <p className="truncate text-xs text-muted-foreground">{[no.cargo, no.setor].filter(Boolean).join(" · ") || no.email}</p>
            {equipe > 0 && <p className="text-xs text-muted-foreground">{equipe} pessoa(s) abaixo</p>}
          </div>
        </div>

        {podeAlterar && (
          <>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold">Reporta a</p>
              <SeletorChefe nos={nos} valor={chefe} onValor={setChefe} excluir={excluir} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold">Função no organograma <span className="font-normal text-muted-foreground">(opcional)</span></p>
              <Input value={funcao} onChange={(e) => setFuncao(e.target.value)} maxLength={80} placeholder={no.cargo || "Ex.: Gerente de RH"} />
              <p className="text-[11px] text-muted-foreground">Em branco, vale o cargo do cadastro{no.cargo ? ` (${no.cargo})` : ""}.</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold">Cor do card</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" title="Sem cor" onClick={() => setCor(null)}
                  className={cn("grid h-7 w-7 place-items-center rounded-full border-2 bg-card text-muted-foreground transition hover:scale-110", cor === null ? "border-foreground" : "border-border")}>
                  <X className="h-3.5 w-3.5" />
                </button>
                {PALETA_CARD.map((p) => (
                  <button key={p.cor} type="button" title={p.nome} onClick={() => setCor(p.cor)}
                    className={cn("grid h-7 w-7 place-items-center rounded-full ring-offset-2 ring-offset-background transition hover:scale-110", cor?.toLowerCase() === p.cor && "ring-2 ring-foreground")}
                    style={{ background: p.cor }}>
                    {cor?.toLowerCase() === p.cor && <Check className="h-3.5 w-3.5 text-white" />}
                  </button>
                ))}
                <label title="Outra cor" className={cn("relative grid h-7 w-7 cursor-pointer place-items-center overflow-hidden rounded-full border-2 border-dashed text-muted-foreground transition hover:scale-110",
                  cor && !PALETA_CARD.some((p) => p.cor === cor.toLowerCase()) ? "border-foreground" : "border-border")}
                  style={cor && !PALETA_CARD.some((p) => p.cor === cor.toLowerCase()) ? { background: cor } : undefined}>
                  <Plus className="h-3.5 w-3.5" />
                  <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={cor ?? "#0f3171"} onChange={(e) => setCor(e.target.value)} />
                </label>
              </div>
              {equipe > 0 && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={corNaEquipe} onChange={(e) => setCorNaEquipe(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                  Aplicar a mesma cor à equipe abaixo ({equipe} pessoa(s))
                </label>
              )}
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold">Posição entre os colegas</p>
              <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => onMover(-1)}><ArrowLeft className="h-3.5 w-3.5" /> Esquerda</Button>
              <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => onMover(1)}>Direita <ArrowRight className="h-3.5 w-3.5" /></Button>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="flex gap-2">
            {podeExcluir && <Button variant="ghost" className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={remover}><Trash2 className="h-4 w-4" /> Tirar do organograma</Button>}
            {podeIncluir && <Button variant="outline" className="gap-1.5" onClick={onAdicionarAbaixo}><UserPlus className="h-4 w-4" /> Adicionar abaixo</Button>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar}>Fechar</Button>
            {podeAlterar && <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Conectores do organograma (árvore de cima para baixo) e impressão.
const CSS_ORGANOGRAMA = `
.org-arvore ul{position:relative;display:flex;justify-content:center;padding-top:28px;margin:0}
.org-arvore ul.org-raiz{padding-top:0;gap:48px}
.org-arvore li{position:relative;display:flex;flex-direction:column;align-items:center;padding:28px 10px 0;list-style:none}
.org-arvore ul.org-raiz>li{padding-top:0}
.org-arvore li::before,.org-arvore li::after{content:"";position:absolute;top:0;right:50%;width:50%;height:28px;border-top:2px solid hsl(var(--border))}
.org-arvore li::after{right:auto;left:50%;border-left:2px solid hsl(var(--border))}
.org-arvore ul.org-raiz>li::before,.org-arvore ul.org-raiz>li::after{display:none}
.org-arvore li:only-child::before{display:none}
.org-arvore li:only-child::after{border-top:0;border-radius:0}
.org-arvore li:first-child::before,.org-arvore li:last-child::after{border-top:0}
.org-arvore li:last-child::before{border-right:2px solid hsl(var(--border));border-radius:0 10px 0 0}
.org-arvore li:first-child::after{border-radius:10px 0 0 0}
.org-arvore li:only-child::after{border-radius:0}
.org-arvore ul ul::before{content:"";position:absolute;top:0;left:50%;height:28px;border-left:2px solid hsl(var(--border))}
.org-arvore li>ul{padding-top:28px}
@media print{
  body *{visibility:hidden}
  .org-caixa,.org-caixa *{visibility:visible}
  .org-caixa{position:absolute;left:0;top:0;height:auto!important;overflow:visible!important;border:0;background:none!important}
  .org-card{box-shadow:none!important;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;
