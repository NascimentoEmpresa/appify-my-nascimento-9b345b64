import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Database, RefreshCw, RotateCcw, ServerCog, ShieldCheck, WifiOff } from "lucide-react";
import logoCompleto from "@/assets/logo-nascimento-completo.webp";
import bigodinho from "@/assets/bigodinho-sistema.webp";
import { CSS_JOGO, JogoInvasores } from "./JogoInvasores";

// =====================================================================
// "SISTEMA TEMPORARIAMENTE INDISPONÍVEL" (23/09/2026)
//
// A tela que aparece quando o banco cai (MonitorDeQueda) ou quando uma tela
// quebra (ErroDeTela). Pedido do Pablo, com o texto dele e o site
// carmed-bay.vercel.app como referência visual: palavra gigante ao fundo,
// um objeto central "flutuando" na frente dela e peças em volta com
// profundidade. Aqui, nas cores do ERP (marinho + laranja do logo) e sem
// emoji — o ⚠️ do texto virou ícone. 24/09: o objeto central é o
// personagem da empresa (o "bigodinho", com a mão na testa) e o topo leva o
// logo completo num cartão branco (o azul do logo some no fundo marinho).
// As duas imagens vieram com fundo branco e foram recortadas (fundo
// transparente, margem aparada) antes de entrar em src/assets.
//
// Tudo é CSS próprio (prefixo .si-) e não depende do tema/Tailwind: se a
// queda for justamente do que monta o resto da interface, esta tela ainda
// aparece inteira. Respeita prefers-reduced-motion.
//
// modo "tela"  → cobre a janela toda (queda do banco, erro fora do AppShell);
// modo "area"  → ocupa só a área de conteúdo (erro numa tela: menu e topo
//                continuam de pé para ir a outra área).
// =====================================================================

interface Props {
  modo?: "tela" | "area";
  /** Contagem até o próximo teste automático (epoch ms). Sem isso, sem relógio. */
  proximaVerificacaoEm?: number | null;
  /** Botão principal ("Tentar agora" / "Tentar de novo"). */
  onTentar?: () => void | Promise<unknown>;
  rotuloTentar?: string;
  /** Detalhes técnicos (erro + rota) num bloco recolhido — para o chamado. */
  detalhe?: ReactNode;
  /** Botões extras (ex.: "Recarregar a página"). */
  extra?: ReactNode;
  /** Joguinho no canto (Invasores) — só na queda, onde a espera é de minutos. */
  jogo?: boolean;
}

const CSS = `
.si-raiz{--si-azul:#0b2a63;--si-azul2:#0f3171;--si-escuro:#061636;--si-laranja:#f26b1d;--si-laranja2:#ff9a4d;
  position:relative;overflow:hidden;isolation:isolate;color:#fff;font-family:Inter,"Plus Jakarta Sans",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  background:radial-gradient(1200px 700px at 78% -10%,#1e4fb3 0%,transparent 60%),radial-gradient(900px 600px at -10% 110%,#12306e 0%,transparent 55%),linear-gradient(160deg,var(--si-azul2) 0%,var(--si-azul) 45%,var(--si-escuro) 100%);
  display:flex;flex-direction:column}
.si-tela{position:fixed;inset:0;z-index:2147483000;min-height:100vh;overflow-x:hidden;overflow-y:auto}
.si-area{min-height:calc(100vh - 140px);border-radius:24px;margin:8px 0}
.si-raiz::after{content:"";position:absolute;inset:0;z-index:-1;opacity:.18;pointer-events:none;
  background-image:radial-gradient(rgba(255,255,255,.35) 1px,transparent 1px);background-size:26px 26px;
  mask-image:radial-gradient(ellipse at 50% 40%,#000 0%,transparent 70%)}
.si-topo{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:26px clamp(20px,4vw,56px);position:relative;z-index:3}
.si-marca{display:flex;align-items:center;padding:9px 16px;border-radius:16px;background:#fff;box-shadow:0 14px 34px -14px rgba(3,10,30,.7),inset 0 -2px 0 rgba(15,49,113,.08)}
.si-marca img{display:block;height:38px;width:auto}
.si-status{display:inline-flex;align-items:center;gap:10px;padding:8px 16px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.3px;
  background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(10px)}
.si-ponto{position:relative;width:9px;height:9px;border-radius:50%;background:var(--si-laranja)}
.si-ponto::after{content:"";position:absolute;inset:-5px;border-radius:50%;border:2px solid var(--si-laranja);animation:si-pulso 1.8s ease-out infinite}
.si-codigo{position:relative;z-index:3;display:flex;justify-content:center;margin:-6px 0 8px;pointer-events:none;user-select:none;animation:si-entra .7s .05s cubic-bezier(.2,.7,.2,1) both}
.si-codigo span{font-size:clamp(46px,6.2vw,92px);font-weight:900;line-height:1;letter-spacing:.06em;padding:0 .1em .08em;
  background:linear-gradient(180deg,var(--si-laranja2) 0%,var(--si-laranja) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 10px 28px rgba(242,107,29,.45))}
.si-area .si-codigo span{font-size:clamp(38px,4.6vw,66px)}
.si-palco{position:relative;flex:1;display:flex;align-items:center;justify-content:center;min-height:clamp(300px,50vh,480px)}
.si-area .si-palco{min-height:clamp(260px,40vh,380px)}
.si-palavra{position:absolute;left:50%;top:50%;transform:translate(-50%,-40.8%);margin:0;padding:.05em .2em .4em;white-space:nowrap;pointer-events:none;user-select:none;
  font-size:clamp(88px,19vw,300px);font-weight:900;letter-spacing:-.055em;line-height:.8;
  background:linear-gradient(180deg,rgba(255,255,255,.96) 4%,rgba(255,255,255,.78) 39%,rgba(255,255,255,.12) 68%,rgba(255,255,255,.04) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.si-area .si-palavra{font-size:clamp(70px,13vw,210px)}
.si-camada{position:absolute;inset:0;transition:transform .5s cubic-bezier(.2,.7,.2,1);will-change:transform}
.si-selo{position:absolute;right:-16px;bottom:-16px;width:54px;height:54px;border-radius:18px;display:grid;place-items:center;
  background:linear-gradient(145deg,var(--si-laranja2),var(--si-laranja));box-shadow:0 14px 30px -8px rgba(242,107,29,.8);color:#fff}
.si-heroi{display:grid;place-items:center}
.si-personagem{position:relative;height:clamp(250px,44vh,430px);aspect-ratio:394/900}
.si-area .si-personagem{height:clamp(220px,34vh,340px)}
.si-personagem img{position:relative;z-index:2;display:block;width:100%;height:100%;object-fit:contain;user-select:none;
  filter:drop-shadow(0 26px 30px rgba(3,10,30,.55)) drop-shadow(0 0 1px rgba(255,255,255,.6));animation:si-flutua 6s ease-in-out infinite}
.si-aura{position:absolute;z-index:1;left:50%;top:44%;width:190%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;
  background:radial-gradient(circle,rgba(255,154,77,.34) 0%,rgba(242,107,29,.12) 34%,transparent 64%)}
.si-chao{position:absolute;z-index:0;left:50%;bottom:-4%;width:120%;height:8%;transform:translateX(-50%);border-radius:50%;
  background:radial-gradient(ellipse,rgba(3,10,30,.55) 0%,transparent 70%);animation:si-sombra 6s ease-in-out infinite}
.si-personagem .si-selo{z-index:3;right:-22%;top:12%;bottom:auto;animation:si-flutua 4.5s ease-in-out infinite -1s}
@keyframes si-sombra{0%,100%{transform:translateX(-50%) scale(1);opacity:.9}50%{transform:translateX(-50%) scale(.82);opacity:.55}}
.si-peca{position:absolute;display:grid;place-items:center;border-radius:22px;color:#fff;
  background:linear-gradient(145deg,rgba(255,255,255,.2),rgba(255,255,255,.04));border:1px solid rgba(255,255,255,.22);
  box-shadow:0 24px 50px -18px rgba(3,10,30,.7);backdrop-filter:blur(10px)}
.si-p1{width:74px;height:74px;left:16%;top:16%;animation:si-flutua 7s ease-in-out infinite -1s}
.si-p2{width:62px;height:62px;right:17%;top:12%;animation:si-flutua 8s ease-in-out infinite -3s;border-radius:50%}
.si-p3{width:56px;height:56px;left:22%;bottom:10%;animation:si-flutua 6.5s ease-in-out infinite -2s;filter:blur(1.2px);opacity:.85}
.si-p4{width:88px;height:88px;right:13%;bottom:8%;animation:si-flutua 9s ease-in-out infinite -4s;border-radius:28px}
.si-orbe{position:absolute;border-radius:50%;filter:blur(2px)}
.si-o1{width:18px;height:18px;left:34%;top:22%;background:var(--si-laranja2);box-shadow:0 0 30px var(--si-laranja);animation:si-flutua 5s ease-in-out infinite}
.si-o2{width:12px;height:12px;right:33%;bottom:24%;background:#8fb4ff;box-shadow:0 0 24px #5a8cff;animation:si-flutua 6s ease-in-out infinite -2s}
.si-o3{width:26px;height:26px;right:28%;top:30%;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.4);filter:blur(3px);animation:si-flutua 8s ease-in-out infinite -5s}
.si-texto{position:relative;z-index:3;max-width:780px;margin:0 auto;padding:0 22px 12px;text-align:center}
.si-titulo{display:block;margin:0 0 14px;text-wrap:balance;font-size:clamp(24px,3.1vw,38px);font-weight:900;letter-spacing:-.02em;line-height:1.12}
.si-titulo svg{display:inline-block;vertical-align:-4px;margin-right:12px;color:var(--si-laranja2)}
.si-texto p{margin:6px 0;font-size:clamp(14px,1.25vw,16.5px);line-height:1.55;color:rgba(255,255,255,.78)}
.si-texto p b{color:#fff}
.si-obrigado{margin-top:14px!important;font-weight:700;color:rgba(255,255,255,.92)!important}
.si-offline{display:inline-flex;align-items:center;gap:8px;margin-top:12px;padding:8px 14px;border-radius:12px;font-size:13px;font-weight:700;background:rgba(242,107,29,.16);border:1px solid rgba(255,154,77,.45)}
.si-acoes{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px;margin:22px 0 6px}
.si-btn{display:inline-flex;align-items:center;gap:9px;height:48px;padding:0 22px;border-radius:14px;font-size:14px;font-weight:800;cursor:pointer;border:none;font-family:inherit;transition:transform .15s ease,box-shadow .2s ease,background .2s ease}
.si-btn:hover{transform:translateY(-2px)}
.si-btn:disabled{opacity:.7;cursor:progress;transform:none}
.si-btn-p{color:#fff;background:linear-gradient(135deg,var(--si-laranja2),var(--si-laranja));box-shadow:0 16px 34px -12px rgba(242,107,29,.9)}
.si-btn-s{color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25)}
.si-btn-s:hover{background:rgba(255,255,255,.16)}
.si-relogio{display:inline-flex;align-items:center;gap:10px;font-size:12.5px;font-weight:700;color:rgba(255,255,255,.7)}
.si-relogio svg{transform:rotate(-90deg)}
.si-detalhe{max-width:640px;margin:14px auto 0;text-align:left}
.si-detalhe summary{cursor:pointer;font-size:12px;font-weight:700;color:rgba(255,255,255,.55);text-align:center;list-style:none}
.si-detalhe summary::-webkit-details-marker{display:none}
.si-detalhe pre{margin:10px 0 0;max-height:180px;overflow:auto;padding:12px 14px;border-radius:12px;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;
  background:rgba(3,10,30,.45);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.85)}
.si-rodape{position:relative;z-index:3;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px 22px;padding:18px 20px 24px;font-size:11.5px;font-weight:600;color:rgba(255,255,255,.5)}
.si-rodape span{display:inline-flex;align-items:center;gap:6px}
@keyframes si-flutua{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-16px) rotate(1.5deg)}}
@keyframes si-gira{to{transform:rotate(360deg)}}
@keyframes si-pulso{0%{transform:scale(.6);opacity:1}100%{transform:scale(1.8);opacity:0}}
@keyframes si-entra{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
.si-raiz .si-texto,.si-raiz .si-palco{animation:si-entra .7s cubic-bezier(.2,.7,.2,1) both}
.si-raiz .si-texto{animation-delay:.12s}
@media (max-width:640px){.si-p1,.si-p4{display:none}.si-topo{padding:16px 18px}.si-marca{padding:7px 11px;border-radius:12px}.si-marca img{height:28px}.si-status{font-size:10.5px;padding:6px 11px;white-space:nowrap}.si-status-resto{display:none}.si-palco{min-height:300px}.si-codigo{margin:-4px 0 10px}.si-personagem{height:min(250px,32vh)}}
@media (prefers-reduced-motion:reduce){.si-raiz *{animation:none!important;transition:none!important}}
`;

/** Segundos até `alvo` (epoch ms), atualizando a cada 250 ms. */
function useSegundosAte(alvo: number | null | undefined) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!alvo) return;
    const t = setInterval(() => setAgora(Date.now()), 250);
    return () => clearInterval(t);
  }, [alvo]);
  return alvo ? Math.max(0, Math.ceil((alvo - agora) / 1000)) : null;
}

export function SistemaIndisponivel({ modo = "tela", proximaVerificacaoEm, onTentar, rotuloTentar = "Tentar agora", detalhe, extra, jogo = false }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const [tentando, setTentando] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const segundos = useSegundosAte(proximaVerificacaoEm);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Profundidade: as camadas acompanham o mouse em velocidades diferentes.
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

  const tentar = async () => {
    if (!onTentar) return;
    setTentando(true);
    try { await onTentar(); } finally { setTentando(false); }
  };

  const total = 15, feito = segundos == null ? 0 : (total - Math.min(total, segundos)) / total;
  const C = 2 * Math.PI * 9;

  return (
    <div ref={raiz} className={`si-raiz ${modo === "tela" ? "si-tela" : "si-area"}`} role="alert" aria-live="assertive">
      <style>{CSS + (jogo ? CSS_JOGO : "")}</style>

      <header className="si-topo">
        <div className="si-marca">
          <img src={logoCompleto} alt="Nascimento — soluções em serviços" />
        </div>
        <div className="si-status"><i className="si-ponto" /><span>Instabilidade<span className="si-status-resto"> em andamento</span></span></div>
      </header>

      {/* "404" acima da cena (pedido de 24/09). No fluxo, não absoluto: assim
          nunca fica atrás da cabeça do personagem, em nenhuma altura de tela. */}
      <div className="si-codigo" aria-hidden><span>404</span></div>

      <div className="si-palco" aria-hidden>
        <div className="si-camada" data-prof="10"><h2 className="si-palavra">Aguarde</h2></div>
        <div className="si-camada" data-prof="46">
          <div className="si-peca si-p1"><Database size={30} strokeWidth={1.8} /></div>
          <div className="si-peca si-p4"><ServerCog size={36} strokeWidth={1.7} /></div>
          <i className="si-orbe si-o1" />
        </div>
        <div className="si-camada" data-prof="28">
          <div className="si-peca si-p2"><RefreshCw size={24} strokeWidth={2} /></div>
          <div className="si-peca si-p3"><ShieldCheck size={24} strokeWidth={1.9} /></div>
          <i className="si-orbe si-o2" /><i className="si-orbe si-o3" />
        </div>
        <div className="si-camada si-heroi" data-prof="-18">
          <div className="si-personagem">
            <i className="si-aura" />
            <img src={bigodinho} alt="" draggable={false} />
            <div className="si-selo"><AlertTriangle size={24} strokeWidth={2.4} /></div>
            <i className="si-chao" />
          </div>
        </div>
      </div>

      <section className="si-texto">
        <h1 className="si-titulo"><AlertTriangle size={30} strokeWidth={2.4} aria-hidden />Sistema temporariamente indisponível</h1>
        <p>O sistema apresentou uma instabilidade no momento.</p>
        <p>O setor de <b>Sistemas</b> já está verificando a situação.</p>
        <p>Aguarde alguns minutos e tente acessar novamente.</p>
        <p className="si-obrigado">Agradecemos pela compreensão.</p>
        {!online && (
          <div className="si-offline"><WifiOff size={16} aria-hidden />Este computador parece estar sem internet — confira a conexão também.</div>
        )}

        <div className="si-acoes">
          {onTentar && (
            <button type="button" className="si-btn si-btn-p" onClick={tentar} disabled={tentando}>
              <RotateCcw size={17} strokeWidth={2.4} aria-hidden style={tentando ? { animation: "si-gira 1s linear infinite" } : undefined} />
              {tentando ? "Verificando…" : rotuloTentar}
            </button>
          )}
          {extra}
        </div>
        {segundos != null && (
          <div className="si-relogio">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
              <circle cx="11" cy="11" r="9" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="2.5" />
              <circle cx="11" cy="11" r="9" fill="none" stroke="#ff9a4d" strokeWidth="2.5" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - feito)} style={{ transition: "stroke-dashoffset .25s linear" }} />
            </svg>
            {segundos > 0 ? `Nova verificação automática em ${segundos}s — a página volta sozinha quando o sistema responder.` : "Verificando…"}
          </div>
        )}
        {detalhe && (
          <details className="si-detalhe">
            <summary>Detalhes técnicos (para o chamado)</summary>
            <pre>{detalhe}</pre>
          </details>
        )}
      </section>

      {/* Caça-Bugs: fechado; abre pela navezinha branca no canto. Só no computador. */}
      {jogo && <JogoInvasores />}

      <footer className="si-rodape">
        <span><RefreshCw size={13} aria-hidden />Verificação automática ligada</span>
        <span>Grupo Nascimento · Setor de Sistemas</span>
      </footer>
    </div>
  );
}
