import { useEffect, useRef } from "react";

/**
 * Confirmação de despesa enviada ao Malote.
 *
 * Um toast de canto some antes de a pessoa registrar que deu certo — e neste
 * fluxo dar certo importa: a despesa saiu da mão dela e foi para a fila de
 * aprovação de outra pessoa. Aqui a confirmação toma o centro da tela por
 * dois segundos: a maleta cai, a tampa abre, o "confere" se desenha dentro e
 * as partículas saem.
 *
 * Fecha sozinha, e também no clique ou no Esc — quem já entendeu não precisa
 * esperar a animação terminar.
 *
 * Tudo em CSS/SVG, sem biblioteca: são doze keyframes de uma tela só, e
 * carregar um motor de animação para isso pesaria mais que o efeito.
 */

const DURACAO_MS = 2400;
const ID_ESTILO = "malote-confirma-styles";

const CSS = `
.mcf-ov{position:fixed;inset:0;z-index:900;display:grid;place-items:center;
  background:rgba(8,20,45,.55);backdrop-filter:blur(6px);
  animation:mcf-fundo .28s ease both;cursor:pointer;}
@keyframes mcf-fundo{from{opacity:0}to{opacity:1}}

.mcf-caixa{position:relative;display:flex;flex-direction:column;align-items:center;gap:18px;
  padding:34px 42px;border-radius:22px;background:#fff;
  box-shadow:0 30px 80px rgba(8,20,45,.35);
  animation:mcf-entra .5s cubic-bezier(.22,1.4,.4,1) both;}
@keyframes mcf-entra{from{opacity:0;transform:translateY(26px) scale(.9)}to{opacity:1;transform:none}}

/* Palco da maleta. A perspectiva é o que faz a tampa abrir em 3D. */
.mcf-palco{position:relative;width:132px;height:118px;perspective:520px;}

/* A maleta cai de cima e quica uma vez ao chegar. */
.mcf-maleta{position:absolute;left:50%;top:26px;width:112px;height:78px;margin-left:-56px;
  animation:mcf-cai .62s cubic-bezier(.3,1.5,.5,1) both;}
@keyframes mcf-cai{
  0%{transform:translateY(-120px) rotate(-12deg);opacity:0}
  60%{opacity:1}
  75%{transform:translateY(6px) rotate(2deg)}
  100%{transform:none;opacity:1}}

.mcf-corpo{position:absolute;inset:0;border-radius:12px;
  background:linear-gradient(160deg,#1d4a92,#0f3171);
  box-shadow:inset 0 -10px 22px rgba(0,0,0,.22);}
/* Fecho metálico no meio do corpo. */
.mcf-corpo::after{content:"";position:absolute;left:50%;top:-5px;width:26px;height:10px;
  margin-left:-13px;border-radius:3px;background:#f8b34c;}

/* Tampa: abre girando pelo topo, com um leve atraso depois da queda. */
.mcf-tampa{position:absolute;left:0;right:0;top:-2px;height:40px;border-radius:12px 12px 4px 4px;
  background:linear-gradient(160deg,#2a5aa8,#17407f);transform-origin:top center;
  animation:mcf-abre .55s cubic-bezier(.5,0,.2,1) .55s both;}
@keyframes mcf-abre{from{transform:rotateX(0)}to{transform:rotateX(-118deg)}}
/* Alça, presa à tampa: sobe junto. */
.mcf-alca{position:absolute;left:50%;top:-16px;width:40px;height:20px;margin-left:-20px;
  border:4px solid #2a5aa8;border-bottom:none;border-radius:14px 14px 0 0;}

/* O selo do confere sobe de dentro da maleta depois que a tampa abre. */
.mcf-selo{position:absolute;left:50%;top:16px;width:66px;height:66px;margin-left:-33px;
  border-radius:50%;background:linear-gradient(150deg,#22c55e,#15803d);
  display:grid;place-items:center;box-shadow:0 14px 30px rgba(21,128,61,.45);
  animation:mcf-sobe .6s cubic-bezier(.22,1.5,.4,1) .95s both;}
@keyframes mcf-sobe{
  0%{transform:translateY(34px) scale(.3);opacity:0}
  55%{opacity:1}
  100%{transform:translateY(-14px) scale(1);opacity:1}}

/* O "confere" se DESENHA, não aparece pronto. */
.mcf-risco{stroke:#fff;stroke-width:5.5;stroke-linecap:round;stroke-linejoin:round;fill:none;
  stroke-dasharray:34;stroke-dashoffset:34;
  animation:mcf-risca .34s cubic-bezier(.6,0,.3,1) 1.42s both;}
@keyframes mcf-risca{to{stroke-dashoffset:0}}

/* Anel que sai do selo, uma vez só. */
.mcf-anel{position:absolute;left:50%;top:16px;width:66px;height:66px;margin-left:-33px;
  border-radius:50%;border:3px solid rgba(34,197,94,.65);
  animation:mcf-anel 1s ease-out 1.5s both;}
@keyframes mcf-anel{
  0%{transform:translateY(-14px) scale(1);opacity:.9}
  100%{transform:translateY(-14px) scale(2.1);opacity:0}}

/* Partículas: 8 fagulhas saindo do centro, cada uma no seu ângulo. */
.mcf-fagulha{position:absolute;left:50%;top:36px;width:7px;height:7px;margin-left:-3.5px;
  border-radius:2px;opacity:0;
  animation:mcf-estoura .85s cubic-bezier(.2,.8,.3,1) 1.5s both;}
@keyframes mcf-estoura{
  0%{opacity:1;transform:rotate(var(--a)) translateY(0) scale(.4)}
  70%{opacity:1}
  100%{opacity:0;transform:rotate(var(--a)) translateY(-78px) scale(1) rotate(220deg)}}

.mcf-tx{text-align:center;}
.mcf-tt{margin:0;font-size:1.05rem;font-weight:800;color:#0f172a;letter-spacing:-.01em;
  animation:mcf-texto .45s cubic-bezier(.16,1,.3,1) 1.25s both;}
.mcf-sb{margin:5px 0 0;font-size:.8rem;color:#64748b;
  animation:mcf-texto .45s cubic-bezier(.16,1,.3,1) 1.4s both;}
@keyframes mcf-texto{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

/* Barrinha que mostra quanto falta para fechar sozinha. */
.mcf-barra{width:100%;height:3px;border-radius:3px;background:#eef2f7;overflow:hidden;}
.mcf-barra i{display:block;height:100%;background:#0f3171;transform-origin:left;
  animation:mcf-conta var(--dur) linear both;}
@keyframes mcf-conta{from{transform:scaleX(1)}to{transform:scaleX(0)}}

/* Quem pediu menos movimento recebe a confirmação parada — e VISÍVEL, que é o
   que importa aqui: some a animação, não a mensagem. */
@media (prefers-reduced-motion:reduce){
  .mcf-ov,.mcf-caixa,.mcf-maleta,.mcf-tampa,.mcf-selo,.mcf-risco,.mcf-tt,.mcf-sb,.mcf-barra i{
    animation:none;opacity:1;transform:none;stroke-dashoffset:0;}
  .mcf-tampa{transform:rotateX(-118deg);}
  .mcf-selo{transform:translateY(-14px);}
  .mcf-anel,.mcf-fagulha{display:none;}
}
`;

const CORES_FAGULHA = ["#f8b34c", "#22c55e", "#2563eb", "#f472b6", "#f8b34c", "#22c55e", "#2563eb", "#f472b6"];

export function ConfirmacaoMalote({
  aberto, titulo = "Despesa enviada ao Malote!", subtitulo, onFechar,
}: {
  aberto: boolean;
  titulo?: string;
  subtitulo?: string;
  onFechar: () => void;
}) {
  // O CSS entra uma vez só, na primeira abertura.
  useEffect(() => {
    if (!aberto || document.getElementById(ID_ESTILO)) return;
    const tag = document.createElement("style");
    tag.id = ID_ESTILO;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }, [aberto]);

  // `onFechar` costuma ser recriada a cada render; sem a ref, o timer
  // reiniciaria a cada uma e a confirmação nunca fecharia sozinha.
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;

  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(() => fecharRef.current(), DURACAO_MS);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fecharRef.current(); };
    window.addEventListener("keydown", esc);
    return () => { clearTimeout(t); window.removeEventListener("keydown", esc); };
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div className="mcf-ov" onClick={onFechar} role="status" aria-live="polite">
      <div className="mcf-caixa" onClick={e => e.stopPropagation()}>
        <div className="mcf-palco" aria-hidden>
          <div className="mcf-maleta">
            <div className="mcf-corpo" />
            <div className="mcf-tampa"><span className="mcf-alca" /></div>
          </div>

          <span className="mcf-anel" />
          {CORES_FAGULHA.map((cor, i) => (
            <span key={i} className="mcf-fagulha"
              style={{ background: cor, "--a": `${i * 45}deg` } as React.CSSProperties} />
          ))}

          <div className="mcf-selo">
            <svg width="34" height="34" viewBox="0 0 34 34">
              <path className="mcf-risco" d="M8 17.5 L14.5 24 L26 11" />
            </svg>
          </div>
        </div>

        <div className="mcf-tx">
          <p className="mcf-tt">{titulo}</p>
          <p className="mcf-sb">{subtitulo ?? "Agora ela está na fila de aprovação."}</p>
        </div>

        <div className="mcf-barra">
          <i style={{ "--dur": `${DURACAO_MS}ms` } as React.CSSProperties} />
        </div>
      </div>
    </div>
  );
}
