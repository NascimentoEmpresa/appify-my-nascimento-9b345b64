import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Headset, Home, KeyRound, Lock, ShieldAlert, UserCog } from "lucide-react";
import logoCompleto from "@/assets/logo-nascimento-completo.webp";
import bigodinho from "@/assets/bigodinho-sistema.webp";
import { CSS_SISTEMA_INDISPONIVEL } from "./SistemaIndisponivel";

// =====================================================================
// "VOCÊ NÃO TEM ACESSO A ESTA ÁREA" (29/09/2026, pedido do Pablo)
//
// Quem abria uma tela sem permissão às vezes via a tela de "Sistema
// temporariamente indisponível" — e ia achar que o ERP tinha caído. Esta é
// a irmã dela para o caso de PERMISSÃO: mesmo visual (mesmo CSS .si-, o
// personagem, a palavra gigante ao fundo), mas com "403", "Restrito" e o
// que fazer: pedir ao responsável ou acionar o suporte.
//
// Quem usa: RouteGuard (rota sem permissão). Fica no modo "area" — menu e
// topo continuam de pé para a pessoa ir a outra tela.
// =====================================================================

interface Props {
  modo?: "tela" | "area";
  /** Título (padrão: "Você não tem acesso a esta área"). */
  titulo?: string;
  /** Texto abaixo do título. Sem isso, o texto padrão (pedir ao responsável / suporte). */
  children?: ReactNode;
  /** Para onde vai o "Voltar ao início". */
  inicio?: string;
  /** Esconde o "Acionar o suporte" (ex.: acesso externo, que não abre chamado). */
  semSuporte?: boolean;
  /** Tela/rota bloqueada, num bloco recolhido — para o chamado. */
  detalhe?: ReactNode;
}

// Ajustes só desta tela: selo e ponto do status em vermelho-alaranjado
// "cadeado", sem mexer no CSS da tela de queda.
const CSS_EXTRA = `
.sa-raiz .si-selo{background:linear-gradient(145deg,#ff8a7a,#e5484d);box-shadow:0 14px 30px -8px rgba(229,72,77,.75)}
.sa-raiz .si-ponto{background:#ff6b6b}.sa-raiz .si-ponto::after{border-color:#ff6b6b}
`;

export function SemAcesso({
  modo = "area",
  titulo = "Você não tem acesso a esta área",
  children,
  inicio = "/app",
  semSuporte = false,
  detalhe,
}: Props) {
  const nav = useNavigate();
  const raiz = useRef<HTMLDivElement>(null);

  // Mesma profundidade da tela de queda: camadas seguem o mouse.
  useEffect(() => {
    const el = raiz.current;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const mover = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.querySelectorAll<HTMLElement>("[data-prof]").forEach((c) => {
        const p = Number(c.dataset.prof);
        c.style.transform = `translate3d(${(-x * p).toFixed(1)}px, ${(-y * p).toFixed(1)}px, 0)`;
      });
    };
    el.addEventListener("pointermove", mover);
    return () => el.removeEventListener("pointermove", mover);
  }, []);

  // Veio de outra tela do ERP → "Voltar" faz sentido; link aberto direto
  // (histórico vazio) → só o "Voltar ao início".
  const temHistorico = typeof window !== "undefined" && window.history.length > 1;

  return (
    <div ref={raiz} className={`si-raiz sa-raiz ${modo === "tela" ? "si-tela" : "si-area"}`} role="alert">
      <style>{CSS_SISTEMA_INDISPONIVEL + CSS_EXTRA}</style>

      <header className="si-topo">
        <div className="si-marca">
          <img src={logoCompleto} alt="Nascimento — soluções em serviços" />
        </div>
        <div className="si-status"><i className="si-ponto" /><span>Acesso<span className="si-status-resto"> restrito</span></span></div>
      </header>

      <div className="si-codigo" aria-hidden><span>403</span></div>

      <div className="si-palco" aria-hidden>
        <div className="si-camada" data-prof="10"><h2 className="si-palavra">Restrito</h2></div>
        <div className="si-camada" data-prof="46">
          <div className="si-peca si-p1"><KeyRound size={30} strokeWidth={1.8} /></div>
          <div className="si-peca si-p4"><UserCog size={36} strokeWidth={1.7} /></div>
          <i className="si-orbe si-o1" />
        </div>
        <div className="si-camada" data-prof="28">
          <div className="si-peca si-p2"><Lock size={24} strokeWidth={2} /></div>
          <div className="si-peca si-p3"><ShieldAlert size={24} strokeWidth={1.9} /></div>
          <i className="si-orbe si-o2" /><i className="si-orbe si-o3" />
        </div>
        <div className="si-camada si-heroi" data-prof="-18">
          <div className="si-personagem">
            <i className="si-aura" />
            <img src={bigodinho} alt="" draggable={false} />
            <div className="si-selo"><Lock size={24} strokeWidth={2.4} /></div>
            <i className="si-chao" />
          </div>
        </div>
      </div>

      <section className="si-texto">
        <h1 className="si-titulo"><Lock size={30} strokeWidth={2.4} aria-hidden />{titulo}</h1>
        {children ?? (
          <>
            <p>Seu usuário ainda não tem permissão para abrir esta tela.</p>
            <p>Se você precisa dela no seu trabalho, <b>solicite o acesso ao seu responsável</b></p>
            <p>ou <b>acione o suporte</b> do setor de Sistemas.</p>
            <p className="si-obrigado">O sistema está funcionando normalmente — é só uma questão de permissão.</p>
          </>
        )}

        <div className="si-acoes">
          <button type="button" className="si-btn si-btn-p" onClick={() => nav(inicio)}>
            <Home size={17} strokeWidth={2.4} aria-hidden />Voltar ao início
          </button>
          {!semSuporte && (
            <button type="button" className="si-btn si-btn-s" onClick={() => nav("/app/central-servicos/chamados/novo")}>
              <Headset size={17} strokeWidth={2.2} aria-hidden />Acionar o suporte
            </button>
          )}
          {temHistorico && (
            <button type="button" className="si-btn si-btn-s" onClick={() => nav(-1)}>
              <ArrowLeft size={17} strokeWidth={2.2} aria-hidden />Voltar
            </button>
          )}
        </div>
        {detalhe && (
          <details className="si-detalhe">
            <summary>Detalhes (para o pedido de acesso)</summary>
            <pre>{detalhe}</pre>
          </details>
        )}
      </section>

      <footer className="si-rodape">
        <span><ShieldAlert size={13} aria-hidden />Acesso liberado por usuário em Configurações do ERP › Acesso por Usuário</span>
        <span>Grupo Nascimento · Setor de Sistemas</span>
      </footer>
    </div>
  );
}
