import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as RMouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BarChart3, Building2, Check, ChevronDown, ChevronUp, FileText, GraduationCap, HardHat, LayoutDashboard, Loader2, Maximize,
  Megaphone, Minus, Monitor, Network, Package, Pencil, Plus, Printer, RefreshCw, Scale, Search, ShieldCheck, Trash2, UserPlus, Users, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  chaveContrato, chefeDoNo, mesmoChefe, montarArvore, podeSerPar, visaoDaArvore,
  type Arvore, type Chefe, type Grupo, type Item,
} from "@/lib/organograma/arvore";
import {
  carregarArvore, carregarPosicao, funcaoDe, moverNaArvore, posicaoFaltando, posicaoVazia, salvarPosicao,
  type DestinoEquipe, type NoPessoa, type PessoaBusca, type PosicaoForm,
} from "@/lib/organograma/pessoas";
import { BuscaPessoa } from "@/components/organograma/BuscaPessoa";
import { PosicaoCampos } from "@/components/organograma/PosicaoCampos";
import { PerfilPessoaDialog } from "@/components/organograma/PerfilPessoaDialog";
import { useScreenAccess } from "@/hooks/useScreenAccess";

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
//
// A EMPRESA TODA (04/11/2026, mig 20261104009000) — "organograma 100% dinâmico,
// alimentado pelo cadastro, de TODA a empresa, não só o escritório" (a dona).
// Todo colaborador ativo está aqui, com ou sem login: o gatilho em EMPREGADOS
// põe e tira. São ~2.500 pessoas, então a tela abre recolhida; o filtro de
// contrato mostra a operação e a linha de comando dela; quem ainda não tem
// superior fica nas Pendências (dá para definir em lote). Fora da montagem,
// clicar no card abre o perfil, com o histórico para quem pode ver.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const MENU = "organograma";
// Acima disto a árvore abre recolhida: desenhar milhares de cards de uma vez trava.
const LIMITE_ABERTA = 150;

type No = NoPessoa;

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

  const podeVerGestao = useScreenAccess("organograma_gestao", "visualizar").data === true;

  const nosQ = useQuery({ queryKey: ["organograma-arvore"], queryFn: carregarArvore, enabled: podeVer });
  const todos = useMemo(() => nosQ.data?.nos ?? [], [nosQ.data]);
  const contratos = useMemo(() => nosQ.data?.contratos ?? [], [nosQ.data]);

  const [edicao, setEdicao] = useState(false);
  const [busca, setBusca] = useState("");
  const [contrato, setContrato] = useState<string | null>(null);
  const [escala, setEscala] = useState(1);
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  const [adicionar, setAdicionar] = useState<{ parentId: string | null } | null>(null);
  const [editando, setEditando] = useState<No | null>(null);
  const [perfilDe, setPerfilDe] = useState<string | null>(null);
  const [verPendencias, setVerPendencias] = useState(false);
  const [moverLider, setMoverLider] = useState<{ no: No; chefe: Chefe } | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvoDrop, setAlvoDrop] = useState<string | null>(null);

  // ── Árvore ──────────────────────────────────────────────────────────
  // `visao` é o desenho (pode ser só um contrato); `geral`, a empresa toda: é
  // nela que se confere ciclo e se escolhe superior, mesmo com filtro ligado.
  const visao = useMemo(() => visaoDaArvore(todos, contrato), [todos, contrato]);
  const nos = visao.visiveis;
  const arv = useMemo(() => montarArvore(nos), [nos]);
  const geral = useMemo(() => montarArvore(todos), [todos]);
  const { porId } = arv;
  const descendentes = geral.descendentes;

  // Abre recolhida se for grande. Só quando muda o que se está vendo: depois
  // disso quem manda é quem clicou.
  const chaveVisao = `${contrato ?? ""}|${nosQ.isSuccess}`;
  useEffect(() => {
    if (!nosQ.isSuccess) return;
    // Num contrato a linha de comando já vem aberta: é para ela que se olha.
    setRecolhidos(nos.length > LIMITE_ABERTA ? new Set(arv.recolhiveis().filter((k) => !visao.linhaDeComando.has(k))) : new Set());
  }, [chaveVisao]); // eslint-disable-line react-hooks/exhaustive-deps
  // Contagem do botão de recolher: só o que desce daquele card (quem
  // responde ao grupo conta no botão do grupo, não no do par).
  const contar = (l: No[]) => l.reduce((s, f) => s + 1 + arv.descendentes(f.id).size, 0);
  const totalAbaixo = (id: string) => contar(arv.equipeDe(id));
  const totalDoGrupo = (g: Grupo<No>) => contar(arv.equipeDoGrupo(g));
  const alternar = (chave: string) => setRecolhidos((s) => { const x = new Set(s); if (x.has(chave)) x.delete(chave); else x.add(chave); return x; });

  // Busca: acha, abre os ramos até a pessoa e rola até ela.
  const termo = busca.trim().toLowerCase();
  const achados = useMemo(() => (termo.length < 2 ? new Set<string>() : new Set(
    nos.filter((n) => `${n.nome} ${funcaoDe(n)} ${n.setor ?? ""} ${n.contrato ?? ""} ${n.posto_nome ?? ""}`.toLowerCase().includes(termo)).map((n) => n.id),
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
  const recarregar = () => { qc.invalidateQueries({ queryKey: ["organograma-arvore"] }); qc.invalidateQueries({ queryKey: ["organograma-busca"] }); };
  // Trocar o chefe arrastando tira a pessoa do grupo de pares em que estava
  // (os pares dela ficam; a equipe que respondia ao grupo o banco repassa).
  // Quem tem equipe direta passa antes pela pergunta "e a equipe?".
  const mudarChefe = async (id: string, chefe: Chefe) => {
    const { parentId, doGrupo } = chefe;
    if (parentId && (parentId === id || descendentes(id).has(parentId))) {
      toast.error("Essa pessoa não pode reportar a alguém que está abaixo dela."); return;
    }
    const n = geral.porId.get(id);
    if (n && geral.equipeDe(id).length) { setMoverLider({ no: n, chefe }); return; }
    try {
      await moverNaArvore({ no: id, parent: parentId, doGrupo, topo: !parentId });
    } catch (e) { toast.error((e as Error).message); return; }
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
    onClick: () => (edicao && podeMontar ? setEditando(n) : setPerfilDe(n.id)),
  });
  const estadoCard = (n: No) => cn(
    "cursor-pointer hover:border-primary/50 hover:shadow-md",
    edicao && podeAlterar && "cursor-grab active:cursor-grabbing",
    achados.has(n.id) && "ring-4 ring-amber-300",
    alvoDrop === n.id && "ring-4 ring-primary/40",
    arrastando === n.id && "opacity-40",
    !n.ativo && "opacity-60",
    visao.linhaDeComando.has(n.id) && "border-dashed bg-muted/60",
    n.superior_pendente && "border-amber-400",
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
            {(n.setor || n.contrato) && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{n.setor || n.contrato}</p>}
            {!n.ativo && <p className="text-[10px] font-semibold text-destructive">usuário inativo</p>}
            {n.superior_pendente && <p className="text-[10px] font-semibold text-amber-700">sem superior definido</p>}
            {visao.linhaDeComando.has(n.id) && <p className="text-[10px] font-semibold text-muted-foreground">linha de comando</p>}
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
        subtitle="A empresa toda, ligada ao cadastro: quem é quem, quem reporta a quem e em qual contrato."
        module="Organograma"
        breadcrumb={["Organograma"]}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            {podeVerGestao && <Button variant="outline" asChild className="gap-1.5"><Link to="/app/organograma/gestao"><LayoutDashboard className="h-4 w-4" /> Dashboard de Gestão</Link></Button>}
            <Button variant="outline" onClick={() => window.print()} className="gap-1.5"><Printer className="h-4 w-4" /> Imprimir</Button>
            {podeMontar && (
              <Button variant={edicao ? "default" : "outline"} onClick={() => setEdicao((v) => !v)} className="gap-1.5">
                <Pencil className="h-4 w-4" /> {edicao ? "Concluir edição" : "Montar organograma"}
              </Button>
            )}
            {podeIncluir && edicao && (
              <Button onClick={() => setAdicionar({ parentId: null })} className="gap-1.5"><UserPlus className="h-4 w-4" /> Posicionar pessoa</Button>
            )}
          </div>
        }
      />

      {visao.semSuperior.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 print:hidden dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1"><b>{visao.semSuperior.length.toLocaleString("pt-BR")}</b> pessoa(s) ainda sem superior imediato{contrato ? " neste contrato" : ""}: o cadastro não deu certeza de quem é o chefe.</span>
          {podeMontar && <Button size="sm" variant="outline" className="bg-background" onClick={() => setVerPendencias(true)}>Definir superior</Button>}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 w-64 pl-8" placeholder="Buscar pessoa, função ou posto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <select aria-label="Contrato" className="h-9 w-72 max-w-full rounded-md border border-input bg-background px-2 text-sm"
          value={contrato ?? ""} onChange={(e) => setContrato(e.target.value || null)}>
          <option value="">Empresa toda</option>
          {contratos.map((c) => <option key={chaveContrato(c.empresa, c.filial)} value={chaveContrato(c.empresa, c.filial)}>{c.nome}</option>)}
        </select>
        {termo.length >= 2 && <span className="text-xs text-muted-foreground">{achados.size} encontrado(s)</span>}
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> {(nos.length - visao.linhaDeComando.size).toLocaleString("pt-BR")} pessoa(s){visao.linhaDeComando.size ? ` + ${visao.linhaDeComando.size} na linha de comando` : ""}
        </span>
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
          <p className="font-medium">{contrato ? "Ninguém deste contrato está na árvore ainda" : "O organograma ainda está vazio"}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {contrato ? "Quem aparece nas pendências acima entra na árvore assim que tiver um superior." : "Comece pela pessoa do topo (a presidência ou a diretoria) e vá adicionando quem reporta a ela."}
          </p>
          {podeIncluir && !contrato && <Button onClick={() => { setEdicao(true); setAdicionar({ parentId: null }); }} className="gap-1.5"><UserPlus className="h-4 w-4" /> Posicionar a primeira pessoa</Button>}
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
          nos={todos} arv={geral} parentInicial={adicionar.parentId} onFechar={() => setAdicionar(null)}
          onSalvo={() => { setAdicionar(null); recarregar(); }}
        />
      )}
      {editando && (
        <EditarPessoa
          no={editando} nos={todos} arv={geral} descendentes={descendentes(editando.id)}
          podeAlterar={podeAlterar} podeExcluir={podeExcluir} podeIncluir={podeIncluir}
          onMover={(d) => mover(editando, d)}
          onAdicionarAbaixo={() => { const id = editando.id; setEditando(null); setAdicionar({ parentId: id }); }}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); recarregar(); }}
        />
      )}
      {perfilDe && geral.porId.get(perfilDe) && (
        <PerfilPessoaDialog no={geral.porId.get(perfilDe)!} onFechar={() => setPerfilDe(null)} onAbrirPessoa={setPerfilDe} />
      )}
      {verPendencias && (
        <PendenciasDialog pendentes={visao.semSuperior} nos={todos} arv={geral} podeRecalcular={podeAlterar}
          onFechar={() => setVerPendencias(false)} onSalvo={recarregar} />
      )}
      {moverLider && (
        <MoverLiderDialog no={moverLider.no} chefe={moverLider.chefe} nos={todos} arv={geral}
          onFechar={() => setMoverLider(null)} onSalvo={() => { setMoverLider(null); recarregar(); }} />
      )}
    </div>
  );
}

// ── Diálogos ───────────────────────────────────────────────────────────

// "Reporta a": uma pessoa, ou um grupo de pares inteiro. Busca em vez de lista:
// com a empresa toda seriam 2.500 opções num menu.
function SeletorChefe({ nos, arv, valor, onValor, excluir, pendente = false, semTopo = false }: {
  nos: No[]; arv: Arvore<No>; valor: Chefe; onValor: (v: Chefe) => void; excluir?: Set<string>; pendente?: boolean; semTopo?: boolean;
}) {
  const [busca, setBusca] = useState("");
  const termo = busca.trim().toLowerCase();
  const atual = valor.parentId ? arv.porId.get(valor.parentId) : undefined;
  const grupoAtual = valor.parentId && valor.doGrupo ? arv.grupoDe(valor.parentId) : undefined;
  const rotulo = grupoAtual ? `Grupo «${grupoAtual.nome}»` : atual ? `${atual.nome}${funcaoDe(atual) ? ` · ${funcaoDe(atual)}` : ""}`
    : valor.topo || !pendente ? "Ninguém — fica no topo" : "Ninguém definido ainda";

  const opcoes = termo.length < 2 ? [] : nos
    .filter((n) => !excluir?.has(n.id) && `${n.nome} ${funcaoDe(n)} ${n.contrato ?? ""}`.toLowerCase().includes(termo))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .slice(0, 30);
  const grupos = termo.length < 2 ? [] : [...new Map(nos.map((n) => [arv.grupoDe(n.id)?.chave, arv.grupoDe(n.id)])).values()]
    .filter((g): g is Grupo<No> => !!g && !g.membros.some((m) => excluir?.has(m.id))
      && `${g.nome} ${g.membros.map((m) => m.nome).join(" ")}`.toLowerCase().includes(termo));
  const escolher = (c: Chefe) => { onValor(c); setBusca(""); };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-sm">
        <span className="min-w-0 flex-1 truncate font-semibold">{rotulo}</span>
        {!semTopo && (valor.parentId || !valor.topo) && (
          <button type="button" className="shrink-0 text-[11px] font-semibold text-primary hover:underline"
            onClick={() => escolher({ parentId: null, doGrupo: false, topo: true })}>Pôr no topo</button>
        )}
      </div>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder="Trocar: busque o superior ou um grupo pelo nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      {termo.length >= 2 && (
        <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border p-1">
          {grupos.map((g) => (
            <button key={g.chave} type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => escolher({ parentId: g.membros[0].id, doGrupo: true })}>
              <b>Grupo «{g.nome}»</b> — {g.membros.map((m) => m.nome.split(/\s+/)[0]).join(", ")}
            </button>
          ))}
          {opcoes.map((n) => (
            <button key={n.id} type="button" className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
              onClick={() => escolher({ parentId: n.id, doGrupo: false })}>
              <span className="block truncate text-sm font-semibold">{n.nome}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{[funcaoDe(n), n.contrato].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
          {!opcoes.length && !grupos.length && <p className="p-2 text-xs text-muted-foreground">Ninguém encontrado.</p>}
        </div>
      )}
    </div>
  );
}

// E a equipe? O que acontece com quem responde direto a um líder que muda.
function CamposEquipe({ no, nos, arv, destino, onDestino, novoLider, onNovoLider, excluir }: {
  no: No; nos: No[]; arv: Arvore<No>; destino: DestinoEquipe; onDestino: (d: DestinoEquipe) => void;
  novoLider: No | null; onNovoLider: (n: No | null) => void; excluir: Set<string>;
}) {
  const diretos = arv.equipeDe(no.id).length;
  const primeiro = no.nome.split(/\s+/)[0];
  const chefeAtual = no.parent_id ? arv.porId.get(no.parent_id)?.nome : null;
  const [busca, setBusca] = useState("");
  const termo = busca.trim().toLowerCase();
  const candidatos = termo.length < 2 ? [] : nos
    .filter((n) => n.id !== no.id && !excluir.has(n.id) && `${n.nome} ${funcaoDe(n)}`.toLowerCase().includes(termo))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).slice(0, 20);
  // Quem assume pode estar na própria equipe: é o caso mais comum.
  const daEquipe = arv.equipeDe(no.id).filter((n) => !termo || n.nome.toLowerCase().includes(termo)).slice(0, 20);

  const Opcao = ({ valor, titulo, sub }: { valor: DestinoEquipe; titulo: string; sub: string }) => (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm hover:bg-muted/60">
      <input type="radio" name="destino-equipe" className="mt-0.5 accent-primary" checked={destino === valor} onChange={() => onDestino(valor)} />
      <span><b>{titulo}</b><span className="block text-xs text-muted-foreground">{sub}</span></span>
    </label>
  );
  return (
    <div className="space-y-1.5 rounded-xl border border-amber-300/70 bg-amber-50/50 p-3 dark:bg-amber-950/20">
      <p className="text-xs font-semibold">{primeiro} tem {diretos} pessoa(s) respondendo direto. O que acontece com elas?</p>
      <Opcao valor="acompanha" titulo="Vão junto" sub={`A equipe continua respondendo a ${primeiro}, na posição nova.`} />
      <Opcao valor="chefe_anterior" titulo={chefeAtual ? `Passam para ${chefeAtual}` : "Sobem para o topo"} sub={`A equipe fica onde está; ${chefeAtual ?? "ninguém"} assume até haver um novo líder.`} />
      <Opcao valor="novo_lider" titulo="Passam para um novo líder" sub={`Quem você escolher assume o lugar de ${primeiro} e a equipe.`} />
      {destino === "novo_lider" && (
        novoLider ? (
          <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate font-semibold">{novoLider.nome}</span>
            <button type="button" title="Trocar" onClick={() => onNovoLider(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <div className="space-y-1">
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar quem assume…" className="h-8 text-xs" />
            <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border bg-background p-1">
              {[...new Map([...daEquipe, ...candidatos].map((n) => [n.id, n])).values()].map((n) => (
                <button key={n.id} type="button" onClick={() => onNovoLider(n)} className="block w-full truncate rounded-md px-2 py-1 text-left text-xs hover:bg-muted">
                  <b>{n.nome}</b>{funcaoDe(n) ? ` · ${funcaoDe(n)}` : ""}
                </button>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function MoverLiderDialog({ no, chefe, nos, arv, onFechar, onSalvo }: {
  no: No; chefe: Chefe; nos: No[]; arv: Arvore<No>; onFechar: () => void; onSalvo: () => void;
}) {
  const [destino, setDestino] = useState<DestinoEquipe>("acompanha");
  const [novoLider, setNovoLider] = useState<No | null>(null);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const para = chefe.parentId ? arv.porId.get(chefe.parentId)?.nome : null;

  const salvar = async () => {
    if (destino === "novo_lider" && !novoLider) { toast.error("Escolha quem assume a equipe."); return; }
    setSalvando(true);
    try {
      await moverNaArvore({ no: no.id, parent: chefe.parentId, doGrupo: chefe.doGrupo, topo: !chefe.parentId, destinoEquipe: destino, novoLider: novoLider?.id, motivo: motivo.trim() || null });
      toast.success("Organograma reorganizado.");
      onSalvo();
    } catch (e) { toast.error((e as Error).message); setSalvando(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-lg grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mudar a posição de {no.nome}</DialogTitle>
          <DialogDescription>Vai passar a reportar a {para ?? "ninguém (topo da empresa)"}.</DialogDescription>
        </DialogHeader>
        <CamposEquipe no={no} nos={nos} arv={arv} destino={destino} onDestino={setDestino} novoLider={novoLider} onNovoLider={setNovoLider} excluir={new Set()} />
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Motivo <span className="font-normal text-muted-foreground">(fica no histórico)</span></p>
          <Input value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: Promovido a coordenador" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Confirmar"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Posicionar alguém pelo nome. Todo colaborador ativo já está na árvore; aqui é
// para definir o superior dele (ou pôr quem só tem login, sem cadastro).
function AdicionarPessoa({ nos, arv, parentInicial, onFechar, onSalvo }: {
  nos: No[]; arv: Arvore<No>; parentInicial: string | null; onFechar: () => void; onSalvo: () => void;
}) {
  const [escolhido, setEscolhido] = useState<PessoaBusca | null>(null);
  const [posicao, setPosicao] = useState<PosicaoForm>(posicaoVazia());
  const [carregando, setCarregando] = useState(false);
  const [chefe, setChefe] = useState<Chefe>({ parentId: parentInicial, doGrupo: false });
  const [salvando, setSalvando] = useState(false);

  const escolher = async (p: PessoaBusca) => {
    setEscolhido(p); setCarregando(true);
    try {
      const atual = await carregarPosicao({ empregado: p.empregado_id, user: p.user_id });
      setPosicao(atual);
      if (!parentInicial && atual.superior) setChefe({ parentId: atual.superior.id, doGrupo: atual.doGrupo });
      if (atual.topo && !parentInicial) setChefe({ parentId: null, doGrupo: false, topo: true });
    } catch (e) { toast.error((e as Error).message); }
    setCarregando(false);
  };
  const excluir = useMemo(() => {
    const id = escolhido?.no_id;
    return id ? new Set([id, ...arv.descendentes(id)]) : new Set<string>();
  }, [escolhido, arv]);

  const salvar = async () => {
    if (!escolhido) { toast.error("Escolha a pessoa."); return; }
    const final: PosicaoForm = { ...posicao, superior: chefe.parentId ? { id: chefe.parentId, nome: "" } : null, doGrupo: chefe.doGrupo, topo: !chefe.parentId && !!chefe.topo };
    const falta = posicaoFaltando(final);
    if (falta) { toast.error(falta); return; }
    setSalvando(true);
    try {
      await salvarPosicao(final, { user: escolhido.user_id });
      toast.success(`${escolhido.nome} está no organograma.`);
      onSalvo();
    } catch (e) { toast.error((e as Error).message); setSalvando(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-lg grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Posicionar pessoa</DialogTitle>
          <DialogDescription>Busque pelo nome: cargo, posto e contrato vêm do cadastro. Você define a quem a pessoa se reporta.</DialogDescription>
        </DialogHeader>

        {!escolhido ? (
          <BuscaPessoa autoFocus placeholder="Buscar colaborador ou usuário pelo nome…" onEscolher={escolher} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border p-3">
              <Avatar nome={escolhido.nome} url={null} tamanho={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{escolhido.nome}</p>
                <p className="truncate text-xs text-muted-foreground">{[escolhido.cargo, escolhido.contrato ?? escolhido.setor].filter(Boolean).join(" · ") || "Usuário sem cadastro de colaborador"}</p>
              </div>
              <Button variant="ghost" size="icon" title="Trocar pessoa" onClick={() => { setEscolhido(null); setPosicao(posicaoVazia()); }}><X className="h-4 w-4" /></Button>
            </div>
            {carregando ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando a posição…</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold">Reporta a (superior imediato)</p>
                  <SeletorChefe nos={nos} arv={arv} valor={chefe} onValor={setChefe} excluir={excluir} pendente />
                </div>
                <PosicaoCampos valor={posicao} onValor={setPosicao} semSuperior titulo="Função, posto e contrato" />
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onFechar}>Cancelar</Button>
              <Button onClick={salvar} disabled={salvando || carregando} className="gap-1.5">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Pendências: quem o sistema não teve certeza de onde pôr. Em lote, porque são
// muitos de uma vez ("os 40 deste contrato respondem a este supervisor").
function PendenciasDialog({ pendentes, nos, arv, podeRecalcular, onFechar, onSalvo }: {
  pendentes: No[]; nos: No[]; arv: Arvore<No>; podeRecalcular: boolean; onFechar: () => void; onSalvo: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [chefe, setChefe] = useState<Chefe>({ parentId: null, doGrupo: false });
  const [salvando, setSalvando] = useState(false);
  const [recalculando, setRecalculando] = useState(false);

  const termo = busca.trim().toLowerCase();
  const filtrados = useMemo(() => pendentes.filter((n) => !termo || `${n.nome} ${funcaoDe(n)} ${n.contrato ?? ""}`.toLowerCase().includes(termo)), [pendentes, termo]);
  const porContrato = useMemo(() => {
    const m = new Map<string, No[]>();
    filtrados.forEach((n) => { const k = n.contrato || "Sem contrato"; m.set(k, [...(m.get(k) ?? []), n]); });
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtrados]);
  const alternar = (ids: string[], ligar: boolean) => setMarcados((s) => {
    const x = new Set(s);
    ids.forEach((i) => (ligar ? x.add(i) : x.delete(i)));
    return x;
  });

  const aplicar = async () => {
    if (!chefe.parentId) { toast.error("Escolha o superior imediato."); return; }
    if (!marcados.size) { toast.error("Marque ao menos uma pessoa."); return; }
    setSalvando(true);
    const { data, error } = await sb.rpc("organograma_definir_superior_lote", { p_nos: [...marcados], p_parent: chefe.parentId });
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${data?.ok ?? 0} pessoa(s) posicionada(s).${data?.falhas ? ` ${data.falhas} ficou(aram) de fora: estão acima desse superior.` : ""}`);
    setMarcados(new Set());
    onSalvo();
  };
  const recalcular = async () => {
    setRecalculando(true);
    const { data, error } = await sb.rpc("organograma_recalcular");
    setRecalculando(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Recalculado: ${(data?.ligados_posto ?? 0) + (data?.ligados_contrato ?? 0)} pessoa(s) ligada(s) sozinha(s). Restam ${data?.pendentes ?? 0}.`);
    onSalvo();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sem superior imediato ({pendentes.length.toLocaleString("pt-BR")})</DialogTitle>
          <DialogDescription>O cadastro não deu certeza do chefe (ex.: dois supervisores no mesmo contrato). Marque as pessoas e escolha a quem elas se reportam.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Reportam a</p>
          <SeletorChefe nos={nos.filter((n) => !n.superior_pendente || arv.equipeDe(n.id).length)} arv={arv} valor={chefe} onValor={setChefe} excluir={marcados} pendente semTopo />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={aplicar} disabled={salvando || !marcados.size || !chefe.parentId}>{salvando ? "Salvando…" : `Definir para ${marcados.size} pessoa(s)`}</Button>
          {podeRecalcular && (
            <Button variant="outline" onClick={recalcular} disabled={recalculando} className="gap-1.5" title="Tenta de novo pela Hierarquia de Postos e pelo responsável do contrato. Não mexe em quem já foi definido.">
              <RefreshCw className={cn("h-4 w-4", recalculando && "animate-spin")} /> Tentar automático de novo
            </Button>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Filtrar por nome, cargo ou contrato…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>

        <div className="space-y-2">
          {porContrato.map(([nome, lista]) => {
            const ids = lista.map((n) => n.id);
            const todosMarcados = ids.every((i) => marcados.has(i));
            return (
              <details key={nome} className="rounded-lg border" open={porContrato.length === 1}>
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={todosMarcados} aria-label={`Marcar todos de ${nome}`}
                    onClick={(e) => e.stopPropagation()} onChange={(e) => alternar(ids, e.target.checked)} />
                  <span className="min-w-0 flex-1 truncate">{nome}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">{lista.length}</span>
                </summary>
                <div className="max-h-64 space-y-0.5 overflow-y-auto border-t p-1">
                  {lista.slice(0, 300).map((n) => (
                    <label key={n.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={marcados.has(n.id)} onChange={(e) => alternar([n.id], e.target.checked)} />
                      <span className="min-w-0 flex-1 truncate"><b>{n.nome}</b>{funcaoDe(n) ? ` · ${funcaoDe(n)}` : ""}</span>
                    </label>
                  ))}
                </div>
              </details>
            );
          })}
          {!porContrato.length && <p className="p-3 text-sm text-muted-foreground">Ninguém com esse filtro.</p>}
        </div>
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
  const [destino, setDestino] = useState<DestinoEquipe>("acompanha");
  const [novoLider, setNovoLider] = useState<No | null>(null);
  const [motivo, setMotivo] = useState("");
  const excluir = new Set([no.id, ...descendentes]);
  const equipe = descendentes.size;
  const equipeDireta = arv.equipeDe(no.id).length;

  // Função, posto e contratos vêm do banco ao abrir: a árvore só traz o resumo.
  const posicaoQ = useQuery({
    queryKey: ["organograma-posicao", no.id],
    queryFn: () => carregarPosicao({ empregado: no.empregado_id, user: no.user_id }),
    enabled: podeAlterar,
    staleTime: 0,
  });
  const [posicao, setPosicao] = useState<PosicaoForm | null>(null);
  useEffect(() => { if (posicaoQ.data) setPosicao({ ...posicaoQ.data, funcao: no.funcao_manual ?? "" }); }, [posicaoQ.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const postoOuContratoMudou = !!posicao && !!posicaoQ.data && (posicao.postoCodigo !== posicaoQ.data.postoCodigo
    || JSON.stringify(posicao.extras.map((c) => [c.empresa, c.filial])) !== JSON.stringify(posicaoQ.data.extras.map((c) => [c.empresa, c.filial])));

  // Mesmo nível: pares atuais (grupo ativo) e os escolhidos agora.
  const grupoAtual = arv.grupoDe(no.id);
  const paresAtuais = useMemo(() => new Set((grupoAtual?.membros ?? []).filter((m) => m.id !== no.id).map((m) => m.id)), [grupoAtual, no.id]);
  const [pares, setPares] = useState<Set<string>>(paresAtuais);
  const [nomeGrupo, setNomeGrupo] = useState(grupoAtual?.nome ?? no.par_grupo ?? "");
  const [equipeAoGrupo, setEquipeAoGrupo] = useState(false);
  const [buscaPar, setBuscaPar] = useState("");
  // Pendente que escolheu "Pôr no topo": o chefe segue vazio, mas é uma decisão.
  const chefeMudou = !mesmoChefe(arv, no, chefe) || (no.superior_pendente && !!chefe.topo);
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
    if (chefeMudou && equipeDireta && destino === "novo_lider" && !novoLider) { toast.error("Escolha quem assume a equipe."); return; }
    setSalvando(true);
    const falhou = (e: { message: string } | null) => { if (!e) return false; setSalvando(false); toast.error(e.message); return true; };
    const nome = paresValidos.length ? (nomeGrupo.trim() || NOME_GRUPO_PADRAO).slice(0, 60) : null;
    // Mudar de chefe passa pelo banco: é lá que a equipe é reorganizada e a
    // pendência cai. Vem antes do par_grupo porque mover desfaz o grupo antigo.
    const moverPara = async (id: string, extra: { destinoEquipe?: DestinoEquipe; novoLider?: string | null; motivo?: string | null } = {}) => {
      try {
        await moverNaArvore({ no: id, parent: efetivo.parentId, doGrupo: efetivo.doGrupo, topo: !efetivo.parentId, ...extra });
        return null;
      } catch (e) { return e as Error; }
    };
    if (chefeMudou && falhou(await moverPara(no.id, { destinoEquipe: equipeDireta ? destino : "acompanha", novoLider: novoLider?.id, motivo: motivo.trim() || null }))) return;
    const patch: Record<string, unknown> = { funcao: funcao.trim() || null, cor, par_grupo: nome };
    if (falhou((await sb.from("ORGANOGRAMA_NO").update(patch).eq("id", no.id)).error)) return;
    // Pares: mesmo chefe (e mesmo do_grupo) que esta pessoa, mesmo nome de grupo.
    for (const id of paresValidos) {
      const p = arv.porId.get(id)!;
      if ((p.parent_id !== efetivo.parentId || p.do_grupo !== efetivo.doGrupo) && falhou(await moverPara(id))) return;
      if (falhou((await sb.from("ORGANOGRAMA_NO").update({ par_grupo: nome }).eq("id", id)).error)) return;
    }
    const saiu = [...paresAtuais].filter((id) => !paresValidos.includes(id));
    if (saiu.length && falhou((await sb.from("ORGANOGRAMA_NO").update({ par_grupo: null }).in("id", saiu)).error)) return;
    if (nome && equipeAoGrupo && equipeDosPares
      && falhou((await sb.from("ORGANOGRAMA_NO").update({ do_grupo: true }).in("parent_id", membrosNovos).eq("do_grupo", false)).error)) return;
    if (corNaEquipe && descendentes.size) {
      const { error: e2 } = await sb.from("ORGANOGRAMA_NO").update({ cor }).in("id", [...descendentes]);
      if (falhou(e2)) return;
    }
    if (postoOuContratoMudou && posicao) {
      try {
        const { error } = await sb.rpc("organograma_salvar_posicao", {
          p_no: no.id, p_posto: posicao.empregadoId ? posicao.postoCodigo ?? "" : null,
          p_contratos: posicao.extras.map((c) => ({ empresa: c.empresa, filial: c.filial })),
        });
        if (falhou(error)) return;
      } catch (e) { if (falhou(e as Error)) return; }
    }
    setSalvando(false);
    toast.success("Organograma atualizado.");
    onSalvo();
  };
  // Colaborador ativo não sai da árvore: perde a posição e volta às pendências.
  const remover = async () => {
    const aviso = no.empregado_id ? `${no.nome} perde a posição e volta para as pendências.` : `${no.nome} sai do organograma.`;
    if (!window.confirm(`${aviso}${equipe ? ` A equipe (${equipe} pessoa(s)) sobe para quem ele(a) reporta.` : ""} Continuar?`)) return;
    const { error } = await sb.rpc("organograma_tirar", { p_no: no.id });
    if (error) { toast.error(error.message); return; }
    toast.success(no.empregado_id ? `${no.nome} voltou para as pendências.` : `${no.nome} saiu do organograma.`);
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
              <SeletorChefe nos={nos} arv={arv} valor={chefe} onValor={setChefe} excluir={excluir} pendente={no.superior_pendente} />
              {no.superior_origem !== "manual" && !no.superior_pendente && no.parent_id && !chefeMudou && (
                <p className="text-[11px] text-amber-700">Sugerido pelo {no.superior_origem === "posto" ? "posto" : "contrato"}; escolha outra pessoa se não for esta.</p>
              )}
            </div>
            {chefeMudou && equipeDireta > 0 && (
              <CamposEquipe no={no} nos={nos} arv={arv} destino={destino} onDestino={setDestino} novoLider={novoLider} onNovoLider={setNovoLider} excluir={new Set()} />
            )}
            {chefeMudou && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold">Motivo da mudança <span className="font-normal text-muted-foreground">(fica no histórico)</span></p>
                <Input value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: Promovido a coordenador" />
              </div>
            )}
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
            {/* Função e "reporta a" têm campos próprios aqui em cima, por causa dos grupos. */}
            {posicao && <PosicaoCampos valor={posicao} onValor={setPosicao} semSuperior semFuncao titulo="Posto e contrato" />}
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
