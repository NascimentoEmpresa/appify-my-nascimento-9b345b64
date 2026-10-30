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
import {
  chefeDoNo, lerValorChefe, mesmoChefe, montarArvore, podeSerPar, valorChefe,
  type Arvore, type Chefe, type Grupo, type Item,
} from "@/lib/organograma/arvore";

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
//
// PARES NO MESMO NÍVEL (16/10/2026, mig 20261016000030) — "conectar ambos no
// mesmo nível de hierarquia, o bigode, guiomar e helena" (Pablo). Em
// "Editar", a seção "Mesmo nível" junta pessoas num grupo com nome (lado a
// lado, ligadas por uma barra). Subordinado pode reportar a um dos pares ou
// ao grupo inteiro ("Grupo …" no "Reporta a", ou soltar o card no quadro do
// grupo). A regra de montar a árvore está em src/lib/organograma/arvore.ts.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const MENU = "organograma";

interface No {
  id: string; user_id: string; parent_id: string | null; ordem: number; funcao_manual: string | null;
  nome: string; email: string | null; avatar_url: string | null; cargo: string | null; setor: string | null; ativo: boolean;
  cor: string | null; par_grupo: string | null; do_grupo: boolean;
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
  const nos = useMemo(() => nosQ.data ?? [], [nosQ.data]);

  const [edicao, setEdicao] = useState(false);
  const [busca, setBusca] = useState("");
  const [escala, setEscala] = useState(1);
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  const [adicionar, setAdicionar] = useState<{ parentId: string | null } | null>(null);
  const [editando, setEditando] = useState<No | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvoDrop, setAlvoDrop] = useState<string | null>(null);

  // ── Árvore ──────────────────────────────────────────────────────────
  const arv = useMemo(() => montarArvore(nos), [nos]);
  const { porId, descendentes } = arv;
  // Contagem do botão de recolher: só o que desce daquele card (quem
  // responde ao grupo conta no botão do grupo, não no do par).
  const contar = (l: No[]) => l.reduce((s, f) => s + 1 + descendentes(f.id).size, 0);
  const totalAbaixo = (id: string) => contar(arv.equipeDe(id));
  const totalDoGrupo = (g: Grupo<No>) => contar(arv.equipeDoGrupo(g));
  const alternar = (chave: string) => setRecolhidos((s) => { const x = new Set(s); if (x.has(chave)) x.delete(chave); else x.add(chave); return x; });

  // Busca: acha, abre os ramos até a pessoa e rola até ela.
  const termo = busca.trim().toLowerCase();
  const achados = useMemo(() => (termo.length < 2 ? new Set<string>() : new Set(
    nos.filter((n) => `${n.nome} ${funcaoDe(n)} ${n.setor ?? ""}`.toLowerCase().includes(termo)).map((n) => n.id),
  )), [nos, termo]);
  useEffect(() => {
    if (!achados.size) return;
    const abrir = new Set(recolhidos);
    let mudou = false;
    achados.forEach((id) => arv.caminhoAte(id).forEach((k) => { if (abrir.delete(k)) mudou = true; }));
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
  // Trocar o chefe arrastando tira a pessoa do grupo de pares em que estava
  // (os pares dela ficam; a equipe que respondia ao grupo o banco repassa).
  const mudarChefe = async (id: string, chefe: Chefe) => {
    const { parentId, doGrupo } = chefe;
    if (parentId && (parentId === id || descendentes(id).has(parentId))) {
      toast.error("Essa pessoa não pode reportar a alguém que está abaixo dela."); return;
    }
    const g = parentId && doGrupo ? arv.grupoDe(parentId) : undefined;
    const ordem = g ? arv.equipeDoGrupo(g).length : parentId ? arv.equipeDe(parentId).length : arv.raiz.length;
    const { error } = await sb.from("ORGANOGRAMA_NO")
      .update({ parent_id: parentId, do_grupo: !!g, ordem, par_grupo: null }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    recarregar();
  };
  const mover = async (n: No, d: -1 | 1) => {
    const irmaos = [...arv.irmaosDe(n.id)];
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
  // stopPropagation: o card pode estar dentro do quadro de um grupo — o
  // drop é do card, não do grupo.
  const onDragOver = (e: DragEvent, alvo: string | null) => {
    e.stopPropagation();
    if (!arrastando || arrastando === alvo || (alvo && descendentes(arrastando).has(alvo))) return;
    e.preventDefault(); setAlvoDrop(alvo ?? "__topo");
  };
  const onDrop = (e: DragEvent, alvo: string | null) => {
    e.preventDefault(); e.stopPropagation();
    const id = arrastando; setArrastando(null); setAlvoDrop(null);
    if (!id || id === alvo) return;
    const n = porId.get(id); const chefe = { parentId: alvo, doGrupo: false };
    if (!n || mesmoChefe(arv, n, chefe)) return;
    mudarChefe(id, chefe);
  };
  // Soltar no quadro do grupo = passa a responder ao grupo inteiro.
  const podeSoltarNoGrupo = (g: Grupo<No>, id: string | null) => !!id
    && !g.membros.some((m) => m.id === id || descendentes(id).has(m.id));
  const onDragOverGrupo = (e: DragEvent, g: Grupo<No>) => {
    e.stopPropagation();
    if (!podeSoltarNoGrupo(g, arrastando)) return;
    e.preventDefault(); setAlvoDrop(g.chave);
  };
  const onDropGrupo = (e: DragEvent, g: Grupo<No>) => {
    e.preventDefault(); e.stopPropagation();
    const id = arrastando; setArrastando(null); setAlvoDrop(null);
    if (!id || !podeSoltarNoGrupo(g, id)) return;
    const n = porId.get(id); const chefe = { parentId: g.membros[0].id, doGrupo: true };
    if (!n || mesmoChefe(arv, n, chefe)) return;
    mudarChefe(id, chefe);
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

  // Largura FIXA do painel (02/10/2026): sem ela o galho da árvore encolhia
  // (flex) e os cards da grade de 2 colunas ficavam uns por cima dos outros,
  // com o nome do setor cortado ("S...", "TREINAMEN...").
  const CARD_PAINEL = 236, GAP_PAINEL = 10, PAD_PAINEL = 14;
  const renderPainel = (setor: string, membros: No[], chavePai: string, corPai: string | null) => {
    const contagem = new Map<string, number>();
    membros.forEach((m) => m.cor && contagem.set(m.cor, (contagem.get(m.cor) ?? 0) + 1));
    const corMembros = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const cor = corMembros ?? corPai ?? corDe(setor);
    const Icone = iconeSetor(setor);
    const colunas = membros.length > 4 ? 2 : 1;
    const largura = colunas * CARD_PAINEL + (colunas - 1) * GAP_PAINEL + PAD_PAINEL * 2;
    return (
      <li key={`painel-${chavePai}-${setor}`}>
        <div className="org-painel rounded-2xl border-2 shadow-sm"
             style={{ width: largura, padding: PAD_PAINEL, borderColor: `${cor}40`, background: `linear-gradient(${cor}0d, ${cor}0d), hsl(var(--card))` }}>
          <div className="mb-3 flex items-center gap-2 px-0.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${cor}1f` }}>
              <Icone className="h-[18px] w-[18px]" style={{ color: cor }} />
            </span>
            <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-extrabold uppercase leading-tight tracking-wide" style={{ color: cor }} title={setor}>{setor}</span>
            <span className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ color: cor, background: `${cor}1f` }}>
              {membros.length} {membros.length === 1 ? "pessoa" : "pessoas"}
            </span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${colunas}, ${CARD_PAINEL}px)`, gap: GAP_PAINEL }}>
            {membros.map((m) => (
              <div key={m.id} {...eventosCard(m)} title={[m.nome, funcaoDe(m)].filter(Boolean).join(" · ")}
                className={cn("org-card relative flex min-h-[64px] items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-left shadow-sm transition", estadoCard(m))}>
                <Avatar nome={m.nome} url={m.avatar_url} tamanho={38} />
                {/* Sem a linha do setor aqui: o cabeçalho do painel já diz. */}
                <div className="min-w-0 flex-1 pr-2">
                  <p className="line-clamp-2 text-[11px] font-bold uppercase leading-tight text-foreground">{m.nome}</p>
                  {funcaoDe(m) && <p className="mt-0.5 line-clamp-2 text-[9.5px] font-semibold uppercase leading-tight" style={{ color: m.cor ?? cor }}>{funcaoDe(m)}</p>}
                  {!m.ativo && <p className="text-[10px] font-semibold text-destructive">usuário inativo</p>}
                </div>
                {edicao && podeMontar && <Pencil className="absolute right-1.5 top-1.5 h-3 w-3 text-muted-foreground" />}
              </div>
            ))}
          </div>
        </div>
      </li>
    );
  };

  // Filhos com equipe seguem na árvore; os sem equipe vão para o painel do
  // setor, na posição do primeiro deles (arv.itens); pares viram um grupo.
  const renderItem = (it: Item<No>, chavePai: string, corPai: string | null) =>
    it.tipo === "no" ? renderNo(it.no)
      : it.tipo === "grupo" ? renderGrupo(it.grupo)
      : renderPainel(it.setor, it.membros, chavePai, corPai);

  const renderEquipe = (n: No) => {
    const subs = arv.equipeDe(n.id);
    if (!subs.length || recolhidos.has(n.id)) return null;
    return <ul>{arv.itens(subs).map((it) => renderItem(it, n.id, n.cor))}</ul>;
  };

  const renderNo = (n: No) => (
    <li key={n.id}>
      {renderCartao(n)}
      {renderEquipe(n)}
    </li>
  );

  // Pares no mesmo nível: quadro com o nome do grupo, cards lado a lado
  // ligados por uma barra (CSS .org-par); cada par leva a própria equipe
  // embaixo dele e quem responde ao grupo desce do meio do quadro.
  const renderGrupo = (g: Grupo<No>) => {
    const equipe = arv.equipeDoGrupo(g);
    const recolhido = recolhidos.has(g.chave);
    const total = totalDoGrupo(g);
    return (
      <li key={g.chave}>
        <div data-grupo
          onDragOver={(e) => onDragOverGrupo(e, g)} onDragLeave={() => setAlvoDrop((a) => (a === g.chave ? null : a))} onDrop={(e) => onDropGrupo(e, g)}
          className={cn("org-grupo relative rounded-3xl border-2 border-dashed border-primary/30 bg-primary/[0.03] px-5 pb-5 pt-8 transition",
            equipe.length > 0 && !recolhido && "org-grupo-com-equipe", alvoDrop === g.chave && "border-primary bg-primary/10 ring-4 ring-primary/30")}>
          <span className="absolute left-5 top-2.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-primary/80">
            <Users className="h-3.5 w-3.5" /> {g.nome}
          </span>
          <div className="org-grupo-membros">
            {g.membros.map((m) => (
              <div key={m.id} className="org-par">
                {renderCartao(m)}
                {renderEquipe(m)}
              </div>
            ))}
          </div>
          {equipe.length > 0 && (
            <button type="button" data-card onClick={(e) => { e.stopPropagation(); alternar(g.chave); }}
              title={recolhido ? `Mostrar quem responde ao grupo (${total})` : `Recolher quem responde ao grupo (${total})`}
              className="absolute -bottom-3 left-1/2 z-[2] flex h-6 -translate-x-1/2 items-center gap-0.5 rounded-full border bg-background px-2 text-[10px] font-bold text-muted-foreground shadow-sm hover:text-foreground">
              {recolhido ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />} {total}
            </button>
          )}
        </div>
        {equipe.length > 0 && !recolhido && (
          <ul>{arv.itens(equipe).map((it) => renderItem(it, g.chave, g.membros.find((m) => m.cor)?.cor ?? null))}</ul>
        )}
      </li>
    );
  };

  const renderCartao = (n: No) => {
    const subs = arv.equipeDe(n.id);
    const recolhido = recolhidos.has(n.id);
    return (
        <div {...eventosCard(n)} style={estiloCard(n.cor)}
          title={[n.nome, funcaoDe(n), n.setor].filter(Boolean).join(" · ")}
          className={cn("org-card relative flex min-h-[84px] w-[264px] items-center gap-3 rounded-2xl border-2 bg-card px-4 py-3 text-left shadow-sm transition", estadoCard(n))}>
          <Avatar nome={n.nome} url={n.avatar_url} tamanho={50} />
          <div className="min-w-0 flex-1 pr-2">
            <p className="line-clamp-2 text-[12.5px] font-bold uppercase leading-tight">{n.nome}</p>
            {funcaoDe(n) && <p className="mt-0.5 line-clamp-2 text-[10.5px] font-semibold uppercase leading-tight text-primary" style={n.cor ? { color: n.cor } : undefined}>{funcaoDe(n)}</p>}
            {n.setor && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{n.setor}</p>}
            {!n.ativo && <p className="text-[10px] font-semibold text-destructive">usuário inativo</p>}
          </div>
          {edicao && podeMontar && <Pencil className="absolute right-2 top-2 h-3.5 w-3.5 text-muted-foreground" />}
          {subs.length > 0 && (
            <button type="button" data-card
              onClick={(e) => { e.stopPropagation(); alternar(n.id); }}
              title={recolhido ? `Mostrar a equipe (${totalAbaixo(n.id)})` : `Recolher a equipe (${totalAbaixo(n.id)})`}
              className="absolute -bottom-3 left-1/2 flex h-6 -translate-x-1/2 items-center gap-0.5 rounded-full border bg-background px-2 text-[10px] font-bold text-muted-foreground shadow-sm hover:text-foreground">
              {recolhido ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />} {totalAbaixo(n.id)}
            </button>
          )}
        </div>
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
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setRecolhidos(new Set(arv.recolhiveis()))}>Recolher tudo</Button>
      </div>

      {edicao && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-xs text-primary print:hidden">
          <Pencil className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            Modo de montagem: clique num card para editar (em "Mesmo nível" junte pares lado a lado){podeAlterar ? " · arraste um card sobre outro para mudar quem ele reporta a, ou sobre o quadro de um grupo para responder ao grupo todo" : ""}.
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
            <ul className="org-raiz">{arv.raiz.map((it) => renderItem(it, "topo", null))}</ul>
          </div>
        </div>
      )}

      {adicionar && (
        <AdicionarPessoa
          nos={nos} arv={arv} parentInicial={adicionar.parentId} onFechar={() => setAdicionar(null)}
          onSalvo={() => { setAdicionar(null); recarregar(); }}
        />
      )}
      {editando && (
        <EditarPessoa
          no={editando} nos={nos} arv={arv} descendentes={descendentes(editando.id)}
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

// "Reporta a": uma pessoa, ou um grupo de pares inteiro (valor "grupo:<1º par>").
function SeletorChefe({ nos, arv, valor, onValor, excluir }: {
  nos: No[]; arv: Arvore<No>; valor: Chefe; onValor: (v: Chefe) => void; excluir?: Set<string>;
}) {
  const opcoes = nos.filter((n) => !excluir?.has(n.id)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const grupos = [...new Map(nos.map((n) => [arv.grupoDe(n.id)?.chave, arv.grupoDe(n.id)])).values()]
    .filter((g): g is Grupo<No> => !!g && !g.membros.some((m) => excluir?.has(m.id)));
  return (
    <Select value={valorChefe(valor) ?? SEM_CHEFE} onValueChange={(v) => onValor(lerValorChefe(v === SEM_CHEFE ? null : v))}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={SEM_CHEFE}>Ninguém — fica no topo</SelectItem>
        {grupos.map((g) => (
          <SelectItem key={g.chave} value={valorChefe({ parentId: g.membros[0].id, doGrupo: true })!}>
            Grupo «{g.nome}» — {g.membros.map((m) => m.nome.split(/\s+/)[0]).join(", ")}
          </SelectItem>
        ))}
        {opcoes.map((n) => <SelectItem key={n.id} value={n.id}>{n.nome}{funcaoDe(n) ? ` · ${funcaoDe(n)}` : ""}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function AdicionarPessoa({ nos, arv, parentInicial, onFechar, onSalvo }: {
  nos: No[]; arv: Arvore<No>; parentInicial: string | null; onFechar: () => void; onSalvo: () => void;
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
  const [chefe, setChefe] = useState<Chefe>({ parentId: parentInicial, doGrupo: false });
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
    const g = chefe.parentId && chefe.doGrupo ? arv.grupoDe(chefe.parentId) : undefined;
    const irmaos = g ? arv.equipeDoGrupo(g).length : chefe.parentId ? arv.equipeDe(chefe.parentId).length : arv.raiz.length;
    const { error } = await sb.from("ORGANOGRAMA_NO").insert({
      user_id: escolhido.user_id, parent_id: chefe.parentId, do_grupo: !!g, funcao: funcao.trim() || null, ordem: irmaos,
    });
    setSalvando(false);
    if (error) { toast.error(/duplicate|unique/i.test(error.message) ? "Essa pessoa já está no organograma." : error.message); return; }
    toast.success(`${escolhido.nome} entrou no organograma.`);
    onSalvo();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-lg grid-cols-[minmax(0,1fr)] overflow-y-auto">
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
              <SeletorChefe nos={nos} arv={arv} valor={chefe} onValor={setChefe} />
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

const NOME_GRUPO_PADRAO = "Mesmo nível";

function EditarPessoa({ no, nos, arv, descendentes, podeAlterar, podeExcluir, podeIncluir, onMover, onAdicionarAbaixo, onFechar, onSalvo }: {
  no: No; nos: No[]; arv: Arvore<No>; descendentes: Set<string>; podeAlterar: boolean; podeExcluir: boolean; podeIncluir: boolean;
  onMover: (d: -1 | 1) => void; onAdicionarAbaixo: () => void; onFechar: () => void; onSalvo: () => void;
}) {
  const [chefe, setChefe] = useState<Chefe>(() => chefeDoNo(arv, no));
  const [funcao, setFuncao] = useState(no.funcao_manual ?? "");
  const [cor, setCor] = useState<string | null>(no.cor);
  const [corNaEquipe, setCorNaEquipe] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const excluir = new Set([no.id, ...descendentes]);
  const equipe = descendentes.size;

  // Mesmo nível: pares atuais (grupo ativo) e os escolhidos agora.
  const grupoAtual = arv.grupoDe(no.id);
  const paresAtuais = useMemo(() => new Set((grupoAtual?.membros ?? []).filter((m) => m.id !== no.id).map((m) => m.id)), [grupoAtual, no.id]);
  const [pares, setPares] = useState<Set<string>>(paresAtuais);
  const [nomeGrupo, setNomeGrupo] = useState(grupoAtual?.nome ?? no.par_grupo ?? "");
  const [equipeAoGrupo, setEquipeAoGrupo] = useState(false);
  const [buscaPar, setBuscaPar] = useState("");
  const chefeMudou = !mesmoChefe(arv, no, chefe);
  // Valendo para todos os pares: mantém o parent_id de hoje se o chefe não mudou
  // (quem responde ao grupo pode estar pendurado em outro par que não o 1º).
  const efetivo: Chefe = chefeMudou ? chefe : { parentId: no.parent_id && arv.porId.has(no.parent_id) ? no.parent_id : null, doGrupo: no.do_grupo };
  const candidatos = nos
    .filter((n) => podeSerPar(arv, no.id, n.id, efetivo.parentId))
    .filter((n) => !buscaPar.trim() || `${n.nome} ${funcaoDe(n)}`.toLowerCase().includes(buscaPar.trim().toLowerCase()))
    .sort((a, b) => Number(pares.has(b.id)) - Number(pares.has(a.id))
      || Number((b.parent_id ?? null) === efetivo.parentId) - Number((a.parent_id ?? null) === efetivo.parentId)
      || a.nome.localeCompare(b.nome, "pt-BR"))
    .slice(0, 80);
  const paresValidos = [...pares].filter((id) => podeSerPar(arv, no.id, id, efetivo.parentId));
  const membrosNovos = [no.id, ...paresValidos];
  const equipeDosPares = nos.filter((n) => n.parent_id && membrosNovos.includes(n.parent_id) && !n.do_grupo).length;

  const salvar = async () => {
    setSalvando(true);
    const falhou = (e: { message: string } | null) => { if (!e) return false; setSalvando(false); toast.error(e.message); return true; };
    const nome = paresValidos.length ? (nomeGrupo.trim() || NOME_GRUPO_PADRAO).slice(0, 60) : null;
    const g = efetivo.parentId && efetivo.doGrupo ? arv.grupoDe(efetivo.parentId) : undefined;
    let proximaOrdem = g ? arv.equipeDoGrupo(g).length : efetivo.parentId ? arv.equipeDe(efetivo.parentId).length : arv.raiz.length;
    const patch: Record<string, unknown> = { funcao: funcao.trim() || null, cor, par_grupo: nome };
    if (chefeMudou) Object.assign(patch, { parent_id: efetivo.parentId, do_grupo: efetivo.doGrupo, ordem: proximaOrdem++ });
    if (falhou((await sb.from("ORGANOGRAMA_NO").update(patch).eq("id", no.id)).error)) return;
    // Pares: mesmo chefe (e mesmo do_grupo) que esta pessoa, mesmo nome de grupo.
    for (const id of paresValidos) {
      const p = arv.porId.get(id)!;
      const patchPar: Record<string, unknown> = { par_grupo: nome };
      if (p.parent_id !== efetivo.parentId || p.do_grupo !== efetivo.doGrupo) {
        Object.assign(patchPar, { parent_id: efetivo.parentId, do_grupo: efetivo.doGrupo, ordem: proximaOrdem++ });
      }
      if (falhou((await sb.from("ORGANOGRAMA_NO").update(patchPar).eq("id", id)).error)) return;
    }
    const saiu = [...paresAtuais].filter((id) => !paresValidos.includes(id));
    if (saiu.length && falhou((await sb.from("ORGANOGRAMA_NO").update({ par_grupo: null }).in("id", saiu)).error)) return;
    if (nome && equipeAoGrupo && equipeDosPares
      && falhou((await sb.from("ORGANOGRAMA_NO").update({ do_grupo: true }).in("parent_id", membrosNovos).eq("do_grupo", false)).error)) return;
    if (corNaEquipe && descendentes.size) {
      const { error: e2 } = await sb.from("ORGANOGRAMA_NO").update({ cor }).in("id", [...descendentes]);
      if (falhou(e2)) return;
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

  // grid-cols-[minmax(0,1fr)] (30/10/2026): com a rolagem vertical do Windows
  // (~17 px) a coluna do grid do DialogContent não encolhia, tudo vazava para
  // a direita e o Salvar sumia atrás de uma rolagem horizontal.
  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-xl grid-cols-[minmax(0,1fr)] overflow-y-auto">
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
              <SeletorChefe nos={nos} arv={arv} valor={chefe} onValor={setChefe} excluir={excluir} />
            </div>
            <div className="space-y-1.5 rounded-xl border border-dashed border-primary/30 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold"><Users className="h-3.5 w-3.5 text-primary" /> Mesmo nível <span className="font-normal text-muted-foreground">(pares lado a lado, ligados por uma barra)</span></p>
              <p className="text-[11px] text-muted-foreground">
                Quem você marcar passa a reportar ao mesmo chefe que {no.nome.split(/\s+/)[0]} e fica no mesmo grupo. Desmarque todos para desfazer o grupo.
              </p>
              <Input value={nomeGrupo} onChange={(e) => setNomeGrupo(e.target.value)} maxLength={60} placeholder={`Nome do grupo — ex.: Direção (em branco: ${NOME_GRUPO_PADRAO})`} className="h-8 text-xs" />
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={buscaPar} onChange={(e) => setBuscaPar(e.target.value)} placeholder="Buscar pessoa…" className="h-8 pl-7 text-xs" />
              </div>
              <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border p-1">
                {candidatos.map((n) => (
                  <label key={n.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={pares.has(n.id)}
                      onChange={(e) => setPares((s) => { const x = new Set(s); if (e.target.checked) x.add(n.id); else x.delete(n.id); return x; })} />
                    <Avatar nome={n.nome} url={n.avatar_url} tamanho={22} />
                    <span className="min-w-0 flex-1 truncate"><b>{n.nome}</b>{funcaoDe(n) ? ` · ${funcaoDe(n)}` : ""}</span>
                  </label>
                ))}
                {!candidatos.length && <p className="p-2 text-xs text-muted-foreground">Ninguém encontrado.</p>}
              </div>
              {paresValidos.length > 0 && equipeDosPares > 0 && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={equipeAoGrupo} onChange={(e) => setEquipeAoGrupo(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                  A equipe de quem está no grupo ({equipeDosPares} pessoa(s)) passa a responder ao grupo todo
                </label>
              )}
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
          <div className="ml-auto flex gap-2">
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
.org-arvore ul{position:relative;display:flex;justify-content:center;align-items:flex-start;padding-top:32px;margin:0}
.org-arvore ul.org-raiz{padding-top:0;gap:56px}
.org-arvore li{position:relative;display:flex;flex-direction:column;align-items:center;flex-shrink:0;padding:32px 16px 0;list-style:none}
.org-arvore ul.org-raiz>li{padding-top:0}
.org-arvore li::before,.org-arvore li::after{content:"";position:absolute;top:0;right:50%;width:50%;height:32px;border-top:2px solid hsl(var(--border))}
.org-arvore li::after{right:auto;left:50%;border-left:2px solid hsl(var(--border))}
.org-arvore ul.org-raiz>li::before,.org-arvore ul.org-raiz>li::after{display:none}
.org-arvore li:only-child::before{display:none}
.org-arvore li:only-child::after{border-top:0;border-radius:0}
.org-arvore li:first-child::before,.org-arvore li:last-child::after{border-top:0}
.org-arvore li:last-child::before{border-right:2px solid hsl(var(--border));border-radius:0 10px 0 0}
.org-arvore li:first-child::after{border-radius:10px 0 0 0}
.org-arvore li:only-child::after{border-radius:0}
.org-arvore ul ul::before{content:"";position:absolute;top:0;left:50%;height:32px;border-left:2px solid hsl(var(--border))}
.org-arvore li>ul{padding-top:32px}
.org-grupo-membros{position:relative;display:flex;align-items:flex-start;gap:48px}
.org-par{position:relative;display:flex;flex-direction:column;align-items:center;flex-shrink:0}
.org-par>.org-card{z-index:1}
.org-par::before,.org-par::after{content:"";position:absolute;top:41px;border-top:3px solid hsl(var(--primary)/.45);z-index:0}
.org-par::before{left:50%;right:-24px}
.org-par::after{left:-24px;right:50%}
.org-par:first-child::after,.org-par:last-child::before{display:none}
.org-grupo-com-equipe .org-grupo-membros::after{content:"";position:absolute;left:50%;top:42px;bottom:-22px;border-left:2px solid hsl(var(--border));z-index:0}
@media print{
  body *{visibility:hidden}
  .org-caixa,.org-caixa *{visibility:visible}
  .org-caixa{position:absolute;left:0;top:0;height:auto!important;overflow:visible!important;border:0;background:none!important}
  .org-card{box-shadow:none!important;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;
