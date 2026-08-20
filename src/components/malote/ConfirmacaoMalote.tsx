import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Tela de conclusão do envio ao Malote.
 *
 * Não é um toast nem um modalzinho: o envio é o fim de uma tarefa e o começo
 * de outra, na mão de outra pessoa. Então a tela para, mostra o que foi feito
 * e pergunta para onde ir. Quem terminou merece um ponto final claro.
 *
 * A animação é encenada, não decorativa: a maleta abre, o feixe acende e o
 * "confere" SAI de dentro dela e cresce até o centro da tela. Depois entram o
 * número da despesa e a trilha (Enviada → Aprovação → Pagamento), que é a
 * informação que a pessoa realmente precisa levar embora.
 *
 * Não fecha sozinha: tela de conclusão que some sozinha obriga a pessoa a
 * correr para ler. Sai pelos botões ou pelo Esc.
 *
 * Tudo em CSS + SVG, sem biblioteca de animação.
 */

const ID_ESTILO = "malote-confirma-styles";

const CSS = `
.mcf{position:fixed;inset:0;z-index:900;background:#fff;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:24px;overflow:auto;animation:mcf-abre .3s ease both;}
@keyframes mcf-abre{from{opacity:0}to{opacity:1}}

/* Luz atrás da cena — dá profundidade sem sujar o branco. */
.mcf::before{content:"";position:absolute;left:50%;top:38%;width:760px;height:760px;
  margin:-380px 0 0 -380px;border-radius:50%;pointer-events:none;
  background:radial-gradient(circle,rgba(15,49,113,.09) 0%,rgba(15,49,113,.04) 42%,transparent 68%);
  animation:mcf-luz 1.1s ease-out .5s both;}
@keyframes mcf-luz{from{opacity:0;transform:scale(.75)}to{opacity:1;transform:none}}

/* ─────────────────────────── o palco ─────────────────────────── */
.mcf-palco{position:relative;width:280px;height:250px;perspective:900px;flex:none;}

/* A maleta sobe e assenta. Fica embaixo, como base da cena. */
.mcf-maleta{position:absolute;left:50%;bottom:8px;width:150px;height:98px;margin-left:-75px;
  animation:mcf-sobe-maleta .7s cubic-bezier(.2,.9,.3,1) both;}
@keyframes mcf-sobe-maleta{
  from{transform:translateY(70px) scale(.86);opacity:0}
  to{transform:none;opacity:1}}

.mcf-corpo{position:absolute;inset:0;border-radius:12px;
  background:linear-gradient(168deg,#20508f 0%,#0f3171 58%,#0b2455 100%);
  box-shadow:0 26px 44px -18px rgba(11,36,85,.55),inset 0 -12px 26px rgba(0,0,0,.22);}
/* Costura clara + fecho dourado: o que faz parecer maleta e não caixa. */
.mcf-corpo::before{content:"";position:absolute;inset:9px;border-radius:8px;
  border:1.5px solid rgba(255,255,255,.13);}
.mcf-corpo::after{content:"";position:absolute;left:50%;top:-6px;width:34px;height:13px;
  margin-left:-17px;border-radius:3px;
  background:linear-gradient(180deg,#ffd489,#f8b34c);
  box-shadow:0 2px 5px rgba(0,0,0,.28);}

/* A tampa abre para trás, revelando o interior. */
.mcf-tampa{position:absolute;left:0;right:0;top:0;height:52px;border-radius:12px 12px 5px 5px;
  background:linear-gradient(168deg,#2b62ad,#164284);transform-origin:top center;
  box-shadow:inset 0 6px 14px rgba(255,255,255,.10);
  animation:mcf-tampa .6s cubic-bezier(.45,0,.15,1) .55s both;}
@keyframes mcf-tampa{from{transform:rotateX(0)}to{transform:rotateX(-125deg)}}
.mcf-alca{position:absolute;left:50%;top:-19px;width:52px;height:24px;margin-left:-26px;
  border:5px solid #2b62ad;border-bottom:none;border-radius:16px 16px 0 0;}

/* Feixe de luz saindo da maleta aberta: é o que "puxa" o olho para cima. */
.mcf-feixe{position:absolute;left:50%;bottom:78px;width:120px;height:150px;margin-left:-60px;
  background:linear-gradient(to top,rgba(34,197,94,.30),rgba(34,197,94,0));
  clip-path:polygon(34% 100%,66% 100%,100% 0,0 0);
  animation:mcf-feixe .8s ease-out .95s both;}
@keyframes mcf-feixe{
  0%{opacity:0;transform:scaleY(.2)}
  55%{opacity:1}
  100%{opacity:.55;transform:scaleY(1)}}

/* O CONFERE: sai de dentro da maleta e cresce até dominar a cena. */
.mcf-selo{position:absolute;left:50%;top:14px;width:118px;height:118px;margin-left:-59px;
  border-radius:50%;display:grid;place-items:center;
  background:linear-gradient(150deg,#2fd36f,#12994c);
  box-shadow:0 22px 46px -10px rgba(18,153,76,.55),inset 0 -6px 16px rgba(0,0,0,.16);
  animation:mcf-selo .85s cubic-bezier(.2,1.25,.3,1) 1.05s both;}
@keyframes mcf-selo{
  0%{opacity:0;transform:translateY(150px) scale(.18)}
  45%{opacity:1}
  100%{opacity:1;transform:translateY(0) scale(1)}}

/* O traço é desenhado — aparecer pronto tira o gesto do "confere". */
.mcf-risco{stroke:#fff;stroke-width:8;stroke-linecap:round;stroke-linejoin:round;fill:none;
  stroke-dasharray:62;stroke-dashoffset:62;
  animation:mcf-risca .42s cubic-bezier(.65,0,.35,1) 1.72s both;}
@keyframes mcf-risca{to{stroke-dashoffset:0}}

/* Dois anéis, com atraso entre eles: eco do impacto, não pisca-pisca. */
.mcf-anel{position:absolute;left:50%;top:14px;width:118px;height:118px;margin-left:-59px;
  border-radius:50%;border:2.5px solid rgba(47,211,111,.55);
  animation:mcf-anel 1.5s cubic-bezier(.2,.7,.3,1) both;}
.mcf-anel--b{animation-delay:2.1s;}
.mcf-anel--a{animation-delay:1.85s;}
@keyframes mcf-anel{
  0%{opacity:.85;transform:scale(1)}
  100%{opacity:0;transform:scale(2.3)}}

/* ─────────────────────────── o texto ─────────────────────────── */
.mcf-tx{text-align:center;max-width:520px;margin-top:6px;}
.mcf-tt{margin:0;font-size:1.75rem;font-weight:800;color:#0b2455;letter-spacing:-.025em;line-height:1.2;
  animation:mcf-sobe-tx .55s cubic-bezier(.16,1,.3,1) 1.85s both;}
.mcf-sb{margin:9px 0 0;font-size:.92rem;color:#64748b;line-height:1.55;
  animation:mcf-sobe-tx .55s cubic-bezier(.16,1,.3,1) 1.98s both;}
@keyframes mcf-sobe-tx{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

/* Número da despesa: o dado que a pessoa anota. */
.mcf-num{display:inline-flex;align-items:center;gap:8px;margin-top:16px;
  padding:8px 16px;border-radius:999px;background:#f1f5f9;border:1px solid #e2e8f0;
  font-size:.82rem;font-weight:800;color:#0b2455;letter-spacing:.04em;
  animation:mcf-sobe-tx .55s cubic-bezier(.16,1,.3,1) 2.08s both;}
.mcf-num b{font-variant-numeric:tabular-nums;}

/* Trilha do processo: onde a despesa está e por onde vai passar. */
.mcf-trilha{display:flex;align-items:center;gap:0;margin-top:26px;flex-wrap:wrap;justify-content:center;
  animation:mcf-sobe-tx .55s cubic-bezier(.16,1,.3,1) 2.2s both;}
.mcf-etapa{display:flex;align-items:center;gap:8px;font-size:.78rem;font-weight:700;color:#94a3b8;}
.mcf-etapa i{width:9px;height:9px;border-radius:50%;background:#cbd5e1;display:block;flex:none;}
.mcf-etapa--ok{color:#12994c;}
.mcf-etapa--ok i{background:#12994c;box-shadow:0 0 0 4px rgba(18,153,76,.16);}
.mcf-liga{width:44px;height:2px;background:#e2e8f0;margin:0 12px;flex:none;}

/* ────────────────────────── os botões ────────────────────────── */
.mcf-acoes{display:flex;gap:10px;margin-top:30px;flex-wrap:wrap;justify-content:center;
  animation:mcf-sobe-tx .55s cubic-bezier(.16,1,.3,1) 2.32s both;}
.mcf-bt{display:inline-flex;align-items:center;gap:8px;cursor:pointer;
  padding:11px 22px;border-radius:11px;font-size:.85rem;font-weight:800;font-family:inherit;
  transition:transform .16s,box-shadow .16s,background .16s;}
.mcf-bt:hover{transform:translateY(-2px);}
.mcf-bt--p{border:none;background:linear-gradient(135deg,#1d4a92,#0f3171);color:#fff;
  box-shadow:0 12px 26px -8px rgba(15,49,113,.6);}
.mcf-bt--p:hover{box-shadow:0 16px 32px -8px rgba(15,49,113,.7);}
.mcf-bt--s{border:1.5px solid #d7dfea;background:#fff;color:#334155;}
.mcf-bt--s:hover{background:#f8fafc;}

@media (max-width:520px){
  .mcf-palco{width:220px;height:210px;}
  .mcf-tt{font-size:1.35rem;}
  .mcf-liga{width:22px;margin:0 7px;}
}

/* Menos movimento: a cena chega pronta. O que não pode é sumir a mensagem. */
@media (prefers-reduced-motion:reduce){
  .mcf,.mcf::before,.mcf-maleta,.mcf-feixe,.mcf-selo,.mcf-risco,.mcf-tt,.mcf-sb,
  .mcf-num,.mcf-trilha,.mcf-acoes{animation:none;opacity:1;transform:none;stroke-dashoffset:0;}
  .mcf-tampa{animation:none;transform:rotateX(-125deg);}
  .mcf-anel{display:none;}
  .mcf-bt:hover{transform:none;}
}
`;

export function ConfirmacaoMalote({
  aberto, titulo = "Despesa enviada ao Malote", subtitulo, numero, onFechar,
}: {
  aberto: boolean;
  titulo?: string;
  /** Explica o que acontece agora. */
  subtitulo?: string;
  /** Nº da despesa (DM-2026-0026). É o dado que a pessoa anota. */
  numero?: string | null;
  onFechar: () => void;
}) {
  const navegar = useNavigate();

  useEffect(() => {
    if (!aberto || document.getElementById(ID_ESTILO)) return;
    const tag = document.createElement("style");
    tag.id = ID_ESTILO;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }, [aberto]);

  // `onFechar` costuma ser recriada a cada render; sem a ref o listener seria
  // trocado toda vez à toa.
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;

  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fecharRef.current(); };
    window.addEventListener("keydown", esc);
    // A tela cobre tudo: rolar o fundo por baixo dela é desorientador.
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = antes;
    };
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div className="mcf" role="status" aria-live="polite">
      <div className="mcf-palco" aria-hidden>
        <div className="mcf-maleta">
          <div className="mcf-corpo" />
          <div className="mcf-tampa"><span className="mcf-alca" /></div>
        </div>
        <div className="mcf-feixe" />
        <span className="mcf-anel mcf-anel--a" />
        <span className="mcf-anel mcf-anel--b" />
        <div className="mcf-selo">
          <svg width="62" height="62" viewBox="0 0 62 62">
            <path className="mcf-risco" d="M15 32 L26 43 L47 19" />
          </svg>
        </div>
      </div>

      <div className="mcf-tx">
        <h2 className="mcf-tt">{titulo}</h2>
        <p className="mcf-sb">{subtitulo ?? "Ela entrou na fila de aprovação. Você acompanha o andamento em Meus Itens."}</p>
        {numero && <span className="mcf-num">Nº da despesa <b>{numero}</b></span>}
      </div>

      <div className="mcf-trilha" aria-hidden>
        <span className="mcf-etapa mcf-etapa--ok"><i />Enviada</span>
        <span className="mcf-liga" />
        <span className="mcf-etapa"><i />Aprovação</span>
        <span className="mcf-liga" />
        <span className="mcf-etapa"><i />Pagamento</span>
      </div>

      <div className="mcf-acoes">
        <button type="button" className="mcf-bt mcf-bt--s" onClick={() => { onFechar(); navegar("/app"); }}>
          Voltar ao menu
        </button>
        <button type="button" className="mcf-bt mcf-bt--p" onClick={() => { onFechar(); navegar("/app/malote/meus-itens"); }}>
          Acompanhar em Meus Itens
        </button>
        <button type="button" className="mcf-bt mcf-bt--s" onClick={onFechar}>
          Continuar aqui
        </button>
      </div>
    </div>
  );
}
