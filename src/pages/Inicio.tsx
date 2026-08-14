import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAccessibleMenus, matchMenuCode } from "@/hooks/useAccessibleMenus";
import { useModoExterno, ROTAS_EXTERNO } from "@/hooks/useModoExterno";
import { ACESSO_ABERTO_SEM_PERMISSOES, MENUS_SEMPRE_RESTRITOS } from "@/lib/acesso";
import { MinhasReunioesCard } from "@/pages/central-servicos/reunioes/componentes/MinhasReunioesCard";
import fachadaImg from "@/assets/fachada.jpg";
import {
  Gavel, FileSignature, ClipboardCheck, Wallet, Users, ShoppingCart,
  BarChart3, UserSearch, CircleUserRound, Send, Quote, Star, Search,
  LayoutDashboard, Headset, CalendarRange, Car, ClipboardList, BookOpen,
  FolderKanban, Package, Boxes, Receipt, HardHat, Target, Scale, ShieldAlert,
  MessageCircle, Laptop2, Network, CalendarCheck, UserPlus, ArrowRight, ChevronUp,
  Settings2, Check, LayoutGrid,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// =====================================================================
// INÍCIO (/app) — primeira tela de todo mundo, todo dia.
//
// Três regras que valem mais que o enfeite:
//   1. ÍCONE DE SISTEMA, NÃO EMOJI. Emoji é renderizado pela fonte do
//      sistema operacional: o mesmo "📋" fica achatado no Windows, colorido
//      no macOS e quadrado em Linux sem fonte de emoji. Em tela corporativa
//      isso vira ruído. Os ícones vêm do mesmo conjunto do resto do ERP.
//   2. A ANIMAÇÃO É AMBIENTE OU REAGE AO PONTEIRO — nunca por frame do
//      React. São orbes em CSS que derivam devagar, a foto com um zoom
//      lento e entradas escalonadas. A tela fica aberta o dia inteiro em
//      máquina de recepção.
//   3. O QUE APARECE AQUI RESPEITA O ACESSO POR USUÁRIO. O catálogo abaixo
//      passa pelo mesmo filtro do menu lateral (list_accessible_menus):
//      atalho para tela que a pessoa não abre é só frustração.
//
// A foto da fachada entra por `src/assets/fachada.jpg` (1796×876). JPEG e
// não PNG de propósito: é fotografia, e o mesmo quadro em PNG pesava 2,6 MB
// contra 339 KB aqui — 2,3 MB a mais em TODA abertura do ERP, sem diferença
// visível. Trocar o arquivo troca o hero sem mexer em código.
// =====================================================================

/* ------------------------------------------------------------------ */
/* Versículo do dia — gira sozinho pelo dia do ano, então a tela muda   */
/* de manhã sem ninguém publicar nada.                                  */
/* ------------------------------------------------------------------ */
const VERSICULOS = [
  { frase: "Consagre o seu trabalho.",   texto: "Consagre ao Senhor tudo o que você faz, e os seus planos serão bem-sucedidos.", ref: "Provérbios 16:3" },
  { frase: "Tudo posso naquele que me fortalece.", texto: "Posso todas as coisas naquele que me fortalece.", ref: "Filipenses 4:13" },
  { frase: "Faça de todo o coração.",    texto: "Tudo o que fizerem, façam de todo o coração, como para o Senhor, e não para os homens.", ref: "Colossenses 3:23" },
  { frase: "Seja forte e corajoso.",     texto: "Não se apavore nem desanime, pois o Senhor, o seu Deus, estará com você por onde você andar.", ref: "Josué 1:9" },
  { frase: "Entregue o seu caminho.",    texto: "Entregue o seu caminho ao Senhor; confie nele, e ele agirá.", ref: "Salmos 37:5" },
  { frase: "Planeje com sabedoria.",     texto: "Os planos bem elaborados levam à fartura; mas o apressado sempre acaba na pobreza.", ref: "Provérbios 21:5" },
  { frase: "Trabalho feito com esmero.", texto: "Você já observou o homem habilidoso em seu trabalho? Será promovido ao serviço real.", ref: "Provérbios 22:29" },
];

function versiculoDoDia(hoje: Date) {
  const inicio = new Date(hoje.getFullYear(), 0, 0);
  const dia = Math.floor((hoje.getTime() - inicio.getTime()) / 86_400_000);
  return VERSICULOS[dia % VERSICULOS.length];
}

function saudacao(hora: number) {
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

/* ------------------------------------------------------------------ */
/* Catálogo de atalhos. `cor` tinge só o ícone e o realce de hover: o   */
/* cartão continua neutro, senão a grade vira um arco-íris.             */
/* ------------------------------------------------------------------ */
type Atalho = {
  to: string;
  icon: LucideIcon;
  label: string;
  desc: string;
  cor: string;
  grupo: "Central de Serviços" | "Operação" | "Pessoas" | "Governança" | "Meu espaço";
};

const CATALOGO: Atalho[] = [
  // ── Central de Serviços ──
  { to: "/app/central-servicos/chamados",              icon: Headset,        label: "Central de Chamados",      desc: "Abrir e acompanhar chamados",  cor: "#0891b2", grupo: "Central de Serviços" },
  { to: "/app/central-servicos/reunioes",              icon: CalendarRange,  label: "Agendamento de Reuniões",  desc: "Agende e participe",           cor: "#7c3aed", grupo: "Central de Serviços" },
  { to: "/app/central-servicos/veiculos",              icon: Car,            label: "Agendamento de Veículos",  desc: "Reserve veículos da frota",    cor: "#059669", grupo: "Central de Serviços" },
  { to: "/app/central-servicos/formularios",           icon: ClipboardList,  label: "Nascimento Formulários",   desc: "Formulários e respostas",      cor: "#db2777", grupo: "Central de Serviços" },
  { to: "/app/central-servicos/orientacoes-juridicas", icon: BookOpen,       label: "Orientações Jurídicas",    desc: "Consulte orientações",         cor: "#2563eb", grupo: "Central de Serviços" },

  // ── Operação ──
  { to: "/app/editais",                        icon: Gavel,          label: "Licitações",          desc: "Editais e propostas",     cor: "#0f3171", grupo: "Operação" },
  { to: "/app/licitacoes/grade",               icon: FolderKanban,   label: "Grade de Licitações", desc: "Acompanhamento por lote", cor: "#1d4ed8", grupo: "Operação" },
  { to: "/app/contratos/ativos",               icon: FileSignature,  label: "Contratos",           desc: "Vigentes e aditivos",     cor: "#2563eb", grupo: "Operação" },
  { to: "/app/controladoria",                  icon: ClipboardCheck, label: "Controladoria",       desc: "Orçamento e análises",    cor: "#0e7490", grupo: "Operação" },
  { to: "/app/financeiro/contas-pagar",        icon: Wallet,         label: "Financeiro",          desc: "Contas e fluxo de caixa", cor: "#16a34a", grupo: "Operação" },
  { to: "/app/malote/meus-itens",              icon: Package,        label: "Malote",              desc: "Despesas e aprovações",   cor: "#ea580c", grupo: "Operação" },
  { to: "/app/suprimentos/requisicoes",        icon: ShoppingCart,   label: "Suprimentos",         desc: "Requisições e compras",   cor: "#9333ea", grupo: "Operação" },
  { to: "/app/suprimentos/patrimonio",         icon: Boxes,          label: "Patrimônio",          desc: "Bens e manutenções",      cor: "#7c3aed", grupo: "Operação" },
  { to: "/app/contabil/lancamentos",           icon: BookOpen,       label: "Contábil",            desc: "Lançamentos e razão",     cor: "#475569", grupo: "Operação" },
  { to: "/app/fiscal",                         icon: Receipt,        label: "Fiscal & Tributário", desc: "Notas e apuração",        cor: "#0d9488", grupo: "Operação" },

  // ── Pessoas ──
  { to: "/app/rh/colaboradores",     icon: Users,        label: "RH",                desc: "Colaboradores",          cor: "#ea580c", grupo: "Pessoas" },
  { to: "/app/rh/hierarquia",        icon: Network,      label: "Hierarquia",        desc: "Setores e lideranças",   cor: "#f59e0b", grupo: "Pessoas" },
  { to: "/app/rh/ferias",            icon: CalendarCheck,label: "Gestão de Férias",  desc: "Programação e saldos",   cor: "#0ea5e9", grupo: "Pessoas" },
  { to: "/app/rh/recrutamento",      icon: UserSearch,   label: "Recrutamento",      desc: "Vagas e candidatos",     cor: "#db2777", grupo: "Pessoas" },
  { to: "/app/sst/aso",              icon: HardHat,      label: "SST · ASO",         desc: "Saúde e segurança",      cor: "#d97706", grupo: "Pessoas" },

  // ── Governança ──
  { to: "/app/painel-executivo",        icon: LayoutDashboard, label: "Painel Executivo", desc: "Visão consolidada",     cor: "#1e40af", grupo: "Governança" },
  { to: "/app/bi",                      icon: BarChart3,       label: "BI & Analytics",   desc: "Indicadores",           cor: "#0f3171", grupo: "Governança" },
  { to: "/app/plano-acoes",             icon: Target,          label: "Plano de Ações",   desc: "Ações e comitês",       cor: "#dc2626", grupo: "Governança" },
  { to: "/app/juridico/processos",      icon: Scale,           label: "Jurídico",         desc: "Processos e audiências",cor: "#64748b", grupo: "Governança" },
  { to: "/app/comite-etica/denuncias",  icon: ShieldAlert,     label: "Comitê de Ética",  desc: "Denúncias e apuração",  cor: "#b91c1c", grupo: "Governança" },
  { to: "/app/sistemas/solicitacoes-erp", icon: Laptop2,       label: "Sistemas",         desc: "Solicitações do ERP",   cor: "#6366f1", grupo: "Governança" },
  { to: "/app/whatsapp",                icon: MessageCircle,   label: "WhatsApp",         desc: "Atendimento e chatbot", cor: "#22c55e", grupo: "Governança" },

  // ── Meu espaço ──
  { to: "/app/meu-perfil",                       icon: CircleUserRound, label: "Meu Perfil",           desc: "Seus dados e acessos",   cor: "#475569", grupo: "Meu espaço" },
  { to: "/app/encarregados/minhas-solicitacoes", icon: Send,            label: "Minhas Solicitações",  desc: "Acompanhe seus pedidos", cor: "#0891b2", grupo: "Meu espaço" },
  { to: "/app/encarregados/solicitar-vaga",      icon: UserPlus,        label: "Solicitar Vaga",       desc: "Abrir vaga para a equipe", cor: "#db2777", grupo: "Meu espaço" },
  { to: "/app/encarregados/solicitar-ferias",    icon: CalendarRange,   label: "Solicitar Férias",     desc: "Programar afastamento",  cor: "#0ea5e9", grupo: "Meu espaço" },
];

const ORDEM_GRUPOS: Atalho["grupo"][] = ["Central de Serviços", "Operação", "Pessoas", "Governança", "Meu espaço"];

/** Favoritos de quem nunca escolheu: os mesmos atalhos que a tela trazia antes. */
const FAVORITOS_PADRAO = [
  "/app/editais",
  "/app/contratos/ativos",
  "/app/controladoria",
  "/app/financeiro/contas-pagar",
  "/app/rh/colaboradores",
  "/app/suprimentos/requisicoes",
  "/app/bi",
  "/app/rh/recrutamento",
  "/app/meu-perfil",
  "/app/encarregados/minhas-solicitacoes",
];

const chaveFavoritos = (uid?: string) => `gn:inicio:favoritos:${uid ?? "anon"}`;

export default function Inicio() {
  const { user } = useAuth();
  const { data: access } = useAccessibleMenus("visualizar");
  const externo = useModoExterno();
  const [displayName, setDisplayName] = useState("");
  const [gerenciando, setGerenciando] = useState(false);
  const [busca, setBusca] = useState("");
  const refCatalogo = useRef<HTMLElement>(null);

  /**
   * Fecha o catálogo e traz a tela de volta para o card.
   *
   * Sem o scroll, quem fechou lá embaixo caía no meio de "Minhas Reuniões",
   * porque a página encolheu vários milhares de pixels de uma vez — parece
   * que a tela pulou sozinha.
   */
  const fecharCatalogo = useCallback(() => {
    setGerenciando(false);
    setBusca("");
    refCatalogo.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const [favoritos, setFavoritos] = useState<string[] | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("display_name, email").eq("id", user.id).maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || data?.email || user.email || ""));
  }, [user?.id]);

  // Favoritos ficam no navegador de propósito: é preferência de atalho, não
  // dado do ERP — não vale uma tabela, um RLS e uma migration para guardar
  // dez rotas. Some se a pessoa trocar de máquina, e o padrão cobre isso.
  useEffect(() => {
    try {
      const bruto = localStorage.getItem(chaveFavoritos(user?.id));
      const lido = bruto ? JSON.parse(bruto) : null;
      setFavoritos(Array.isArray(lido) ? lido.filter((t) => typeof t === "string") : FAVORITOS_PADRAO);
    } catch {
      setFavoritos(FAVORITOS_PADRAO);
    }
  }, [user?.id]);

  const alternarFavorito = useCallback((to: string) => {
    setFavoritos((atual) => {
      const base = atual ?? FAVORITOS_PADRAO;
      const novo = base.includes(to) ? base.filter((t) => t !== to) : [...base, to];
      try { localStorage.setItem(chaveFavoritos(user?.id), JSON.stringify(novo)); } catch { /* modo privado */ }
      return novo;
    });
  }, [user?.id]);

  // Mesmo filtro do menu lateral: rota sem entrada em app_menu ou sem nada
  // configurado no gerenciamento de acesso segue visível; o resto obedece ao
  // perfil da pessoa. Ver Sidebar.tsx — a regra é intencionalmente idêntica,
  // e vale tanto para a grade de Favoritos quanto para "Gerenciar favoritos":
  // ninguém consegue favoritar uma tela que não tem permissão de abrir.
  const podeVer = useCallback((to: string) => {
    // Encarregado externo primeiro: ele não tem perfil de acesso, então
    // cairia no ramo "menu sem configuração → visível" e enxergaria o ERP
    // inteiro no catálogo.
    if (externo) return ROTAS_EXTERNO.some((r) => to === r || to.startsWith(r + "/"));
    if (ACESSO_ABERTO_SEM_PERMISSOES || !access) return true;
    const code = matchMenuCode(to, access.routes);
    if (!code) return true;
    if (!access.configuredCodes.has(code) && !MENUS_SEMPRE_RESTRITOS.has(code)) return true;
    return access.codes.has(code);
  }, [access, externo]);

  const catalogoVisivel = useMemo(() => CATALOGO.filter((a) => podeVer(a.to)), [podeVer]);

  const meusFavoritos = useMemo(() => {
    const set = new Set(favoritos ?? FAVORITOS_PADRAO);
    return catalogoVisivel.filter((a) => set.has(a.to));
  }, [catalogoVisivel, favoritos]);

  const catalogoFiltrado = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return catalogoVisivel;
    return catalogoVisivel.filter((a) =>
      `${a.label} ${a.desc} ${a.grupo}`.toLowerCase().includes(q));
  }, [catalogoVisivel, busca]);

  const agora = new Date();
  const versiculo = versiculoDoDia(agora);
  const firstName = displayName.split(" ")[0] || "bem-vindo";
  const dataLonga = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  // Reveal no scroll: um observer só, para a página inteira. Sem biblioteca e
  // sem listener de scroll — o navegador avisa quando o bloco entra em cena.
  useEffect(() => {
    const alvos = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!alvos.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      alvos.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const obs = new IntersectionObserver(
      (entradas) => entradas.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); obs.unobserve(e.target); } }),
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    alvos.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [gerenciando, meusFavoritos.length]);

  useEffect(() => {
    const style = document.createElement("style");
    style.id = "inicio-styles";
    style.textContent = CSS_INICIO;
    document.head.appendChild(style);
    return () => { document.getElementById("inicio-styles")?.remove(); };
  }, []);

  const titulo = `${saudacao(agora.getHours())}, ${firstName}!`;

  return (
    <div className="ini-page">

      {/* ═══════════════════════════ Hero ═══════════════════════════ */}
      <header className="ini-hero">
        {/* A foto vem por baixo de um véu escuro: o texto precisa de contraste
            AA sobre ela em qualquer horário. O zoom lento é só respiro — a
            imagem tem resolução de sobra para o hero. */}
        <div className="ini-hero-foto" style={{ backgroundImage: `url(${fachadaImg})` }} aria-hidden />
        <div className="ini-hero-veu" aria-hidden />
        <div className="ini-hero-grade" aria-hidden />
        <span className="ini-orb ini-orb--a" aria-hidden />
        <span className="ini-orb ini-orb--b" aria-hidden />

        <div className="ini-hero-in">
          <p className="ini-hero-data">{dataLonga}</p>
          <Quote className="ini-aspas" size={28} strokeWidth={2.5} aria-hidden />
          <h1 className="ini-hero-title">
            {/* Palavra a palavra: a entrada escalonada dá o mesmo efeito de
                "digitação" sem nenhum timer rodando em JS. */}
            {titulo.split(" ").map((p, i) => (
              <span key={`s${i}`} className="ini-w" style={{ "--i": i } as React.CSSProperties}>{p}&nbsp;</span>
            ))}
            <br />
            {versiculo.frase.split(" ").map((p, i) => (
              <span key={`f${i}`} className="ini-w ini-w--dest" style={{ "--i": i + titulo.split(" ").length } as React.CSSProperties}>{p}&nbsp;</span>
            ))}
          </h1>
          <p className="ini-hero-verse">
            {versiculo.texto} <strong>({versiculo.ref})</strong>
          </p>
        </div>

        <div className="ini-hero-badge">
          <p className="ini-badge-cap">Versículo do dia</p>
          <p className="ini-badge-ref">{versiculo.ref}</p>
        </div>
      </header>

      {/* ═════════════════════════ Favoritos ════════════════════════ */}
      <section className="ini-card" data-reveal ref={refCatalogo}>
        <div className="ini-card-hd">
          <div className="ini-hd-tx">
            <h3><Star className="ini-hd-ic" aria-hidden /> {gerenciando ? "Todos os módulos" : "Favoritos"}</h3>
            <p>{gerenciando
              ? "Marque a estrela dos módulos que você quer no seu Início."
              : "Acesse rapidamente os módulos e submódulos que você mais utiliza."}</p>
          </div>
          <div className="ini-hd-acoes">
            {gerenciando && (
              <label className="ini-busca">
                <Search size={14} aria-hidden />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar módulo…"
                  aria-label="Buscar módulo"
                />
              </label>
            )}
            <button
              type="button"
              className={`ini-btn ${gerenciando ? "ini-btn--ok" : ""}`}
              onClick={() => { setGerenciando((g) => !g); setBusca(""); }}
            >
              {gerenciando ? <Check size={14} aria-hidden /> : <Settings2 size={14} aria-hidden />}
              {gerenciando ? "Concluir" : "Gerenciar favoritos"}
            </button>
          </div>
        </div>

        <div className="ini-card-body">
          {gerenciando ? (
            ORDEM_GRUPOS.map((grupo) => {
              const doGrupo = catalogoFiltrado.filter((a) => a.grupo === grupo);
              if (!doGrupo.length) return null;
              return (
                <div key={grupo} className="ini-grupo">
                  <p className="ini-grupo-tt">{grupo}</p>
                  <div className="ini-qa">
                    {doGrupo.map((a, i) => (
                      <CartaoAtalho
                        key={a.to} atalho={a} indice={i}
                        favorito={(favoritos ?? FAVORITOS_PADRAO).includes(a.to)}
                        modoGerenciar onAlternar={alternarFavorito}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          ) : meusFavoritos.length ? (
            <div className="ini-qa">
              {meusFavoritos.map((a, i) => (
                <CartaoAtalho key={a.to} atalho={a} indice={i} favorito onAlternar={alternarFavorito} />
              ))}
            </div>
          ) : (
            <div className="ini-vazio">
              <LayoutGrid size={22} aria-hidden />
              <p>Você ainda não escolheu nenhum favorito.</p>
              <button type="button" className="ini-btn" onClick={() => setGerenciando(true)}>
                <Settings2 size={14} aria-hidden /> Escolher módulos
              </button>
            </div>
          )}

          {/* O par abrir/fechar mora no MESMO lugar de propósito. O botão
              "Concluir" do cabeçalho continua valendo, mas com a lista
              inteira aberta ele sai da tela — quem rolou até o fim não tinha
              como voltar sem subir a página atrás dele. */}
          <button
            type="button"
            className="ini-ver-todos"
            onClick={() => {
              if (gerenciando) fecharCatalogo();
              else setGerenciando(true);
            }}
          >
            {gerenciando
              ? <><ChevronUp size={14} aria-hidden /> Mostrar menos</>
              : <>Ver todos os módulos <ArrowRight size={14} aria-hidden /></>}
          </button>
        </div>
      </section>

      {/* ══════════════════════ Minhas Reuniões ═════════════════════ */}
      <div data-reveal>
        <MinhasReunioesCard />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cartão de atalho. Fora do modo gerenciar ele É o link; dentro dele a */
/* estrela precisa de um botão próprio, senão marcar favorito navegava. */
/* ------------------------------------------------------------------ */
function CartaoAtalho({
  atalho, indice, favorito, modoGerenciar = false, onAlternar,
}: {
  atalho: Atalho;
  indice: number;
  favorito: boolean;
  modoGerenciar?: boolean;
  onAlternar: (to: string) => void;
}) {
  const estilo = { "--i": indice, "--c": atalho.cor } as React.CSSProperties;
  const miolo = (
    <>
      <span className="ini-qa-ic"><atalho.icon size={20} strokeWidth={2} aria-hidden /></span>
      <span className="ini-qa-tx">
        <b>{atalho.label}</b>
        <span>{atalho.desc}</span>
      </span>
    </>
  );

  return (
    <div className="ini-qa-wrap" style={estilo}>
      {modoGerenciar ? (
        <button
          type="button"
          className={`ini-qa-btn ${favorito ? "ini-qa-btn--fav" : ""}`}
          onClick={() => onAlternar(atalho.to)}
          aria-pressed={favorito}
          title={favorito ? `Tirar ${atalho.label} dos favoritos` : `Colocar ${atalho.label} nos favoritos`}
        >
          {miolo}
        </button>
      ) : (
        <Link to={atalho.to} className="ini-qa-btn">{miolo}</Link>
      )}
      <button
        type="button"
        className={`ini-qa-star ${favorito ? "on" : ""}`}
        onClick={() => onAlternar(atalho.to)}
        aria-label={favorito ? `Tirar ${atalho.label} dos favoritos` : `Colocar ${atalho.label} nos favoritos`}
        title={favorito ? "Nos favoritos" : "Adicionar aos favoritos"}
      >
        <Star size={13} strokeWidth={2.5} fill={favorito ? "currentColor" : "none"} aria-hidden />
      </button>
    </div>
  );
}

/* ================================================================== */
/* CSS da tela. Fica em string e é injetado no <head> ao montar: são    */
/* dezenas de regras de uma página só, que não têm por que pesar no     */
/* bundle de CSS global do ERP inteiro.                                 */
/* ================================================================== */
const CSS_INICIO = `
.ini-page{flex:1;display:flex;flex-direction:column;min-width:0;}

/* ───────────────────────────── hero ───────────────────────────── */
.ini-hero{position:relative;overflow:hidden;border-radius:20px;margin-bottom:22px;
  padding:48px 48px 44px;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;
  min-height:250px;box-shadow:0 18px 44px -18px rgba(8,24,58,.55);
  background:linear-gradient(135deg,#0b1f44 0%,#12356f 55%,#1d4a92 100%);}
/* A foto entra por cima do gradiente com um zoom lento (Ken Burns). Sem
   blur: a imagem é nítida e a fachada tem que aparecer como fachada.
   O enquadramento sobe um pouco (center 42%) para a placa "Nascimento"
   cair na metade direita, que é a parte clara do véu. */
.ini-hero-foto{position:absolute;inset:-4%;background-size:cover;background-position:center 42%;
  opacity:.92;filter:saturate(1.12) contrast(1.06) brightness(1.06);transform-origin:65% 50%;
  animation:ini-ken 34s ease-in-out infinite alternate;}
@keyframes ini-ken{from{transform:scale(1.02) translate3d(0,0,0)}to{transform:scale(1.14) translate3d(-1.5%,-1%,0)}}
/* O véu escurece só o que precisa: forte onde o texto encosta (esquerda),
   quase nada na direita, para a fachada aparecer como fachada. A curva é
   mais fechada que uma rampa linear — cai rápido nos primeiros 45% e depois
   solta, em vez de cinzar a foto inteira. */
.ini-hero-veu{position:absolute;inset:0;
  background:linear-gradient(100deg,rgba(6,18,42,.94) 0%,rgba(8,23,52,.88) 26%,rgba(10,30,66,.66) 46%,rgba(13,44,102,.26) 68%,rgba(15,49,113,.04) 100%),
             linear-gradient(to top,rgba(4,12,30,.5) 0%,transparent 52%);}
/* Malha institucional discreta, no lugar do "vazio" da direita. */
.ini-hero-grade{position:absolute;inset:0;opacity:.1;
  background-image:linear-gradient(rgba(255,255,255,.35) 1px,transparent 1px),
                   linear-gradient(90deg,rgba(255,255,255,.35) 1px,transparent 1px);
  background-size:52px 52px;
  -webkit-mask-image:radial-gradient(ellipse at 88% 18%,#000 0%,transparent 62%);
          mask-image:radial-gradient(ellipse at 88% 18%,#000 0%,transparent 62%);}
.ini-orb{position:absolute;border-radius:9999px;pointer-events:none;filter:blur(52px);}
.ini-orb--a{width:360px;height:360px;top:-140px;right:-60px;
  background:radial-gradient(circle,rgba(249,115,22,.42) 0%,transparent 68%);
  animation:ini-drift 17s ease-in-out infinite;}
.ini-orb--b{width:280px;height:280px;bottom:-140px;left:18%;
  background:radial-gradient(circle,rgba(96,165,250,.30) 0%,transparent 70%);
  animation:ini-drift 23s ease-in-out -6s infinite reverse;}
@keyframes ini-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-26px,28px) scale(1.12)}}
/* Fio de luz atravessando a borda de cima, devagar. */
.ini-hero::after{content:'';position:absolute;inset:0 0 auto 0;height:1px;
  background:linear-gradient(to right,transparent,rgba(249,115,22,.7) 30%,rgba(147,197,253,.8) 58%,transparent);
  animation:ini-sweep 5s ease-in-out infinite;}
@keyframes ini-sweep{0%,100%{opacity:.25;transform:scaleX(.65)}50%{opacity:.95;transform:scaleX(1)}}

.ini-hero-in{position:relative;z-index:1;max-width:660px;}
.ini-hero-data{font-size:.72rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
  color:rgba(191,219,254,.8);margin-bottom:12px;
  animation:ini-up .6s cubic-bezier(.16,1,.3,1) both;}
.ini-aspas{color:#f97316;opacity:.95;margin-bottom:4px;
  animation:ini-up .6s cubic-bezier(.16,1,.3,1) .06s both;}
.ini-hero-title{font-size:2.45rem;font-weight:800;color:#fff;line-height:1.1;letter-spacing:-.03em;}
/* Cada palavra sobe de trás de uma linha invisível. inline-block é o que
   permite transformar a palavra sem quebrar o fluxo do texto. */
.ini-w{display:inline-block;animation:ini-word .7s cubic-bezier(.16,1,.3,1) both;
  animation-delay:calc(120ms + var(--i,0) * 60ms);}
.ini-w--dest{color:#fbbf24;}
@keyframes ini-word{from{opacity:0;transform:translateY(18px) rotate(1.5deg)}to{opacity:1;transform:none}}
.ini-hero-verse{font-size:.9rem;color:rgba(226,232,240,.82);margin-top:12px;font-style:italic;
  line-height:1.65;max-width:52ch;
  animation:ini-up .7s cubic-bezier(.16,1,.3,1) .55s both;}
.ini-hero-verse strong{color:rgba(255,255,255,.95);font-style:normal;}
@keyframes ini-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}

.ini-hero-badge{position:relative;z-index:1;flex-shrink:0;text-align:center;align-self:center;
  background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.22);border-radius:16px;
  padding:18px 24px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  animation:ini-up .7s cubic-bezier(.16,1,.3,1) .3s both;}
.ini-hero-badge::before{content:'';position:absolute;inset:-6px;border-radius:20px;
  border:1px solid rgba(251,191,36,.4);animation:ini-pulse 3.6s ease-out infinite;}
@keyframes ini-pulse{0%{transform:scale(.94);opacity:.85}100%{transform:scale(1.07);opacity:0}}
.ini-badge-cap{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.16em;
  color:rgba(255,255,255,.62);}
.ini-badge-ref{font-size:1.05rem;font-weight:800;color:#fbbf24;margin-top:5px;white-space:nowrap;}

/* ──────────────────────────── cartões ─────────────────────────── */
.ini-card{position:relative;background:hsl(var(--card));border:1px solid hsl(var(--border));
  border-radius:18px;box-shadow:var(--shadow-md);overflow:hidden;margin-bottom:20px;}
/* Fio institucional no topo de cada bloco — amarra a tela ao hero. */
.ini-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(to right,hsl(var(--primary)),hsl(var(--accent)) 45%,transparent 85%);
  opacity:.75;}
.ini-card-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;
  padding:16px 20px;border-bottom:1px solid hsl(var(--border));}
/* Vale para o cabeçalho de qualquer .ini-card — inclusive o de Minhas
   Reuniões, que monta o <h3> sem o wrapper .ini-hd-tx. */
.ini-card-hd h3{font-size:.98rem;font-weight:700;color:hsl(var(--foreground));
  display:flex;align-items:center;gap:10px;}
.ini-hd-tx p{font-size:.76rem;color:hsl(var(--muted-foreground));margin-top:3px;margin-left:36px;}
.ini-hd-ic{box-sizing:content-box;width:16px;height:16px;padding:5px;border-radius:9px;flex-shrink:0;
  color:hsl(var(--primary));background:hsl(var(--primary) / .09);}
.ini-hd-acoes{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.ini-card-body{padding:18px 20px;}

.ini-btn{display:inline-flex;align-items:center;gap:7px;font-size:.78rem;font-weight:600;
  padding:7px 13px;border-radius:10px;cursor:pointer;
  border:1px solid hsl(var(--border));background:hsl(var(--surface));color:hsl(var(--foreground));
  transition:border-color .2s,background .2s,transform .2s cubic-bezier(.16,1,.3,1),box-shadow .2s;}
.ini-btn:hover{border-color:hsl(var(--primary) / .5);background:hsl(var(--primary) / .06);
  transform:translateY(-1px);box-shadow:var(--shadow-sm);}
.ini-btn--ok{background:hsl(var(--primary));border-color:hsl(var(--primary));color:hsl(var(--primary-foreground));}
.ini-btn--ok:hover{background:hsl(var(--primary-hover));color:hsl(var(--primary-foreground));}

.ini-busca{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:10px;
  border:1px solid hsl(var(--border));background:hsl(var(--surface));color:hsl(var(--muted-foreground));
  transition:border-color .2s,box-shadow .2s;}
.ini-busca:focus-within{border-color:hsl(var(--ring));box-shadow:0 0 0 3px hsl(var(--ring) / .18);}
.ini-busca input{border:none;outline:none;background:transparent;font-size:.78rem;width:150px;
  color:hsl(var(--foreground));}

/* Controles que o cartão de Minhas Reuniões usa no próprio cabeçalho. */
.ini-select{font-size:.78rem;font-weight:600;cursor:pointer;padding:6px 10px;border-radius:10px;
  color:hsl(var(--foreground));background:hsl(var(--surface));border:1px solid hsl(var(--border));
  transition:border-color .2s,box-shadow .2s;}
.ini-select:focus{outline:none;border-color:hsl(var(--ring));box-shadow:0 0 0 3px hsl(var(--ring) / .18);}
.ini-link{display:inline-flex;align-items:center;font-size:.8rem;font-weight:700;
  color:hsl(var(--primary));text-decoration:none;transition:color .2s;}
.ini-link:hover{color:hsl(var(--primary-hover));text-decoration:underline;}
.ini-nota{font-size:.83rem;color:hsl(var(--muted-foreground));}

.ini-grupo{margin-bottom:20px;}
.ini-grupo:last-of-type{margin-bottom:0;}
.ini-grupo-tt{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.14em;
  color:hsl(var(--muted-foreground));margin-bottom:10px;}

/* ────────────────────── grade de atalhos ──────────────────────── */
.ini-qa{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:12px;}
.ini-qa-wrap{position:relative;}
.ini-qa-btn{position:relative;overflow:hidden;display:flex;flex-direction:column;gap:10px;width:100%;
  padding:16px 15px;border-radius:15px;border:1px solid hsl(var(--border));background:hsl(var(--surface));
  text-align:left;text-decoration:none;color:hsl(var(--foreground));cursor:pointer;
  box-shadow:0 1px 3px hsl(218 50% 15% / .05);
  transition:transform .24s cubic-bezier(.16,1,.3,1),box-shadow .24s,border-color .24s;
  opacity:0;animation:ini-in .5s cubic-bezier(.16,1,.3,1) forwards;
  animation-delay:calc(var(--i,0) * 40ms);}
@keyframes ini-in{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
.ini-qa-btn:hover{transform:translateY(-4px);border-color:var(--c,hsl(var(--primary)));
  box-shadow:0 16px 30px -12px color-mix(in srgb,var(--c,#0f3171) 55%,transparent);}
.ini-qa-btn:active{transform:translateY(-1px) scale(.99);}
/* Véu na cor do módulo, revelado no hover: dá identidade sem pintar o
   cartão inteiro e sem prejudicar o contraste do texto. */
.ini-qa-btn::before{content:'';position:absolute;inset:0;opacity:0;pointer-events:none;
  background:linear-gradient(145deg,var(--c,#0f3171) 0%,transparent 62%);transition:opacity .24s;}
.ini-qa-btn:hover::before{opacity:.09;}
/* Reflexo diagonal que atravessa o cartão uma vez, no hover. */
.ini-qa-btn::after{content:'';position:absolute;top:0;bottom:0;width:45%;pointer-events:none;
  background:linear-gradient(105deg,transparent,rgba(255,255,255,.55),transparent);
  transform:translateX(-220%) skewX(-14deg);opacity:0;}
.ini-qa-btn:hover::after{opacity:1;animation:ini-brilho .85s cubic-bezier(.16,1,.3,1);}
@keyframes ini-brilho{to{transform:translateX(340%) skewX(-14deg)}}
.ini-qa-ic{position:relative;display:grid;place-items:center;width:42px;height:42px;
  border-radius:12px;color:var(--c,#0f3171);
  /* Cinza primeiro como piso: navegador sem color-mix ignora a linha
     seguinte e o ícone continua sobre um fundo visível, não transparente. */
  background:hsl(var(--muted));
  background:color-mix(in srgb,var(--c,#0f3171) 12%,#fff);
  transition:transform .3s cubic-bezier(.34,1.56,.64,1),box-shadow .3s;}
.ini-qa-btn:hover .ini-qa-ic{transform:scale(1.1) rotate(-6deg);
  box-shadow:0 8px 18px -8px var(--c,#0f3171);}
.ini-qa-tx{position:relative;min-width:0;}
.ini-qa-tx b{display:block;font-size:.85rem;font-weight:700;line-height:1.28;}
.ini-qa-tx span{display:block;font-size:.72rem;color:hsl(var(--muted-foreground));line-height:1.38;margin-top:3px;}
/* No modo gerenciar o cartão marcado ganha a cor do módulo na borda. */
.ini-qa-btn--fav{border-color:color-mix(in srgb,var(--c,#0f3171) 45%,hsl(var(--border)));}
.ini-qa-btn--fav::before{opacity:.05;}

/* Estrela: só aparece de verdade no hover do cartão (ou quando marcada),
   para a grade não virar um mural de estrelas. */
.ini-qa-star{position:absolute;top:9px;right:9px;z-index:2;display:grid;place-items:center;
  width:26px;height:26px;border-radius:9px;cursor:pointer;
  border:1px solid transparent;background:transparent;color:hsl(var(--muted-foreground));
  opacity:0;transform:scale(.8);
  transition:opacity .2s,transform .25s cubic-bezier(.34,1.56,.64,1),color .2s,background .2s;}
.ini-qa-wrap:hover .ini-qa-star,.ini-qa-star:focus-visible{opacity:1;transform:scale(1);}
.ini-qa-star:hover{background:hsl(var(--muted));color:hsl(var(--foreground));}
.ini-qa-star.on{opacity:1;transform:scale(1);color:#f59e0b;}
.ini-qa-star.on:hover{background:hsl(38 95% 50% / .12);color:#d97706;}
.ini-qa-wrap:hover .ini-qa-star.on{animation:ini-estrela .4s cubic-bezier(.34,1.56,.64,1);}
@keyframes ini-estrela{0%{transform:scale(1)}45%{transform:scale(1.3) rotate(14deg)}100%{transform:scale(1)}}

.ini-vazio{display:flex;flex-direction:column;align-items:center;gap:10px;padding:34px 16px;
  color:hsl(var(--muted-foreground));text-align:center;}
.ini-vazio p{font-size:.84rem;}

.ini-ver-todos{display:flex;align-items:center;gap:7px;width:fit-content;margin:18px auto 0;
  font-size:.82rem;font-weight:700;color:hsl(var(--primary));background:none;border:none;cursor:pointer;
  padding:6px 4px;transition:gap .22s cubic-bezier(.16,1,.3,1),color .2s;}
.ini-ver-todos:hover{gap:12px;color:hsl(var(--primary-hover));}

/* ────────────────────── reuniões (cartão herdado) ─────────────── */
.ini-reuniao-lista{display:flex;flex-direction:column;gap:8px;}
.ini-reuniao-item{display:flex;align-items:center;gap:10px;padding:11px 13px;
  border:1px solid hsl(var(--border));border-radius:12px;background:hsl(var(--surface));
  transition:border-color .2s,background .2s,transform .22s cubic-bezier(.16,1,.3,1),box-shadow .22s;}
.ini-reuniao-item:hover{border-color:hsl(var(--primary) / .45);background:hsl(var(--primary) / .04);
  transform:translateX(3px);box-shadow:var(--shadow-sm);}
.ini-reuniao-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;
  text-decoration:none;color:inherit;}
.ini-reuniao-titulo{font-size:.87rem;font-weight:700;color:hsl(var(--foreground));white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;}
.ini-reuniao-meta{font-size:.74rem;color:hsl(var(--muted-foreground));}
.ini-reuniao-badge{flex-shrink:0;font-size:.68rem;font-weight:600;padding:2px 9px;
  border-radius:999px;border:1px solid;}
.ini-reuniao-remover{flex-shrink:0;background:none;border:none;cursor:pointer;
  font-size:.85rem;opacity:.5;padding:2px;transition:opacity .2s,transform .2s;}
.ini-reuniao-remover:hover{opacity:1;transform:scale(1.15);}

/* ─────────────────────── reveal no scroll ─────────────────────── */
[data-reveal]{opacity:0;transform:translateY(22px);
  transition:opacity .6s cubic-bezier(.16,1,.3,1),transform .6s cubic-bezier(.16,1,.3,1);}
[data-reveal].is-in{opacity:1;transform:none;}

@media (max-width:900px){
  .ini-hero{padding:30px 24px;flex-direction:column;align-items:flex-start;min-height:0;}
  .ini-hero-title{font-size:1.75rem;}
  .ini-hero-badge{align-self:stretch;}
  .ini-hd-tx p{margin-left:0;}
  .ini-qa{grid-template-columns:repeat(auto-fill,minmax(148px,1fr));}
}

/* Quem pediu menos movimento no sistema recebe a tela parada. */
@media (prefers-reduced-motion:reduce){
  .ini-orb,.ini-hero::after,.ini-hero-badge::before,.ini-hero-foto{animation:none;}
  .ini-w,.ini-hero-data,.ini-aspas,.ini-hero-verse,.ini-hero-badge{animation:none;opacity:1;transform:none;}
  .ini-qa-btn{opacity:1;animation:none;}
  .ini-qa-btn:hover{transform:none;}
  .ini-qa-btn:hover::after{animation:none;opacity:0;}
  .ini-qa-btn:hover .ini-qa-ic{transform:none;}
  .ini-reuniao-item:hover{transform:none;}
  [data-reveal]{opacity:1;transform:none;transition:none;}
}
`;
