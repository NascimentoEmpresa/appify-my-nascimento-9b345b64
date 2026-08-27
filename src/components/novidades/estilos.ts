/**
 * CSS das Novidades do Sistema.
 *
 * String injetada no <head> na primeira montagem, igual ao que a tela de
 * Início faz: são dezenas de regras de uma funcionalidade só, que não têm por
 * que pesar no CSS global do ERP inteiro. `usarEstiloNovidades()` garante uma
 * única tag, mesmo com painel, página e megafone montados ao mesmo tempo.
 */
import { useEffect } from "react";

const ID = "nov-styles";

export const CSS_NOVIDADES = `
/* ─────────────────────────────── cartão ─────────────────────────────── */
.nov-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;
  box-shadow:0 8px 24px rgba(15,23,42,.06);}
.nov-hd{display:flex;align-items:center;gap:10px;padding:16px 18px 12px;}
.nov-hd-ic{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;flex:none;
  background:linear-gradient(135deg,#0f3171,#1d4a92);color:#fff;
  box-shadow:0 6px 16px rgba(15,49,113,.28);}
/* O megafone dá um aceno quando há novidade — uma vez, não em loop: chamar
   atenção é diferente de piscar o dia inteiro numa tela de recepção. */
.nov-hd-ic--vivo{animation:nov-aceno 1.1s cubic-bezier(.36,.07,.19,.97) .3s 2;transform-origin:70% 70%;}
@keyframes nov-aceno{
  0%,60%,100%{transform:rotate(0)}
  10%{transform:rotate(-13deg)}20%{transform:rotate(11deg)}
  30%{transform:rotate(-8deg)}40%{transform:rotate(6deg)}50%{transform:rotate(-3deg)}}
.nov-hd-tx{min-width:0;flex:1;}
.nov-hd-tx h3{margin:0;font-size:.98rem;font-weight:800;color:#0f172a;letter-spacing:-.01em;}
.nov-hd-tx p{margin:2px 0 0;font-size:.76rem;color:#94a3b8;}
.nov-hd-acoes{display:flex;align-items:center;gap:8px;flex:none;}

.nov-link{display:inline-flex;align-items:center;gap:4px;background:none;border:none;cursor:pointer;
  font-size:.76rem;font-weight:700;color:#1d4ed8;padding:4px 6px;border-radius:8px;
  transition:background .18s,transform .18s;}
.nov-link:hover{background:#eff6ff;transform:translateX(2px);}

.nov-btn{display:inline-flex;align-items:center;gap:6px;border:none;cursor:pointer;
  padding:7px 13px;border-radius:10px;font-size:.76rem;font-weight:800;
  background:linear-gradient(135deg,#0f3171,#1d4a92);color:#fff;
  box-shadow:0 6px 16px rgba(15,49,113,.24);
  transition:transform .18s,box-shadow .18s,filter .18s;}
.nov-btn:hover{transform:translateY(-1px);box-shadow:0 10px 22px rgba(15,49,113,.3);filter:brightness(1.06);}
.nov-btn:active{transform:translateY(0);}
.nov-btn--fantasma{background:#fff;color:#475569;border:1px solid #e2e8f0;box-shadow:none;}
.nov-btn--fantasma:hover{background:#f8fafc;box-shadow:none;}
.nov-btn--perigo{background:#fff;color:#dc2626;border:1px solid #fecaca;box-shadow:none;}
.nov-btn--perigo:hover{background:#fef2f2;box-shadow:none;}
.nov-btn:disabled{opacity:.55;cursor:not-allowed;transform:none;filter:none;}

/* ─────────────────────────────── lista ──────────────────────────────── */
.nov-lista{display:flex;flex-direction:column;gap:10px;padding:4px 14px 14px;}
/* O estado BASE é visível e a animação parte do invisível: fill-mode
   "backwards" aplica o quadro inicial durante o atraso escalonado. O inverso
   — base opacity:0 + "forwards" — deixa o item invisível PARA SEMPRE se a
   animação não rodar, e não rodar acontece (extensão que desliga animação,
   impressão, aba em segundo plano). Novidade que ninguém lê não serve. */
.nov-item{position:relative;border:1px solid #e2e8f0;border-radius:13px;padding:12px 14px 12px 16px;
  background:#fff;overflow:hidden;
  animation:nov-entra .5s cubic-bezier(.16,1,.3,1) backwards;
  animation-delay:calc(var(--i,0) * 70ms);
  transition:border-color .2s,box-shadow .2s,transform .2s;}
.nov-item:hover{border-color:#c7d7f0;box-shadow:0 10px 26px rgba(15,23,42,.09);transform:translateY(-2px);}
@keyframes nov-entra{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
/* Faixa da cor do selo na borda esquerda: o tipo se lê antes do texto. */
.nov-item::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;
  background:var(--selo,#0f3171);opacity:.85;}
/* Ainda não lida: um pontinho e um fundo levíssimo. */
.nov-item--nova{background:linear-gradient(90deg,rgba(29,78,216,.05),transparent 60%);}
.nov-item--nova .nov-item-tt::after{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;
  background:#2563eb;margin-left:7px;vertical-align:middle;
  animation:nov-pulsa 2s ease-in-out infinite;}
@keyframes nov-pulsa{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.75)}}

.nov-item-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px;}
.nov-data{font-size:.7rem;color:#94a3b8;font-weight:600;display:inline-flex;align-items:center;gap:4px;}
.nov-selo{font-size:.62rem;font-weight:900;letter-spacing:.05em;padding:2px 8px;border-radius:20px;
  text-transform:uppercase;background:var(--selo-bg,#dcfce7);color:var(--selo,#15803d);}
.nov-rascunho{font-size:.62rem;font-weight:900;letter-spacing:.05em;padding:2px 8px;border-radius:20px;
  text-transform:uppercase;background:#f1f5f9;color:#64748b;}
.nov-item-tt{margin:0;font-size:.85rem;font-weight:800;color:#0f172a;line-height:1.35;}
.nov-item-ds{margin:3px 0 0;font-size:.78rem;color:#64748b;line-height:1.5;white-space:pre-wrap;}
.nov-item-pe{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap;}
.nov-autor{font-size:.68rem;color:#cbd5e1;margin-left:auto;}

.nov-vazio{display:flex;flex-direction:column;align-items:center;gap:8px;padding:34px 20px;text-align:center;
  color:#94a3b8;font-size:.8rem;}
.nov-vazio svg{opacity:.4;}

/* Esqueleto de carregamento — a tela não pula quando os dados chegam. */
.nov-skel{height:74px;border-radius:13px;border:1px solid #eef2f7;
  background:linear-gradient(90deg,#f8fafc 25%,#eef2f7 37%,#f8fafc 63%);
  background-size:400% 100%;animation:nov-brilho 1.3s ease-in-out infinite;}
@keyframes nov-brilho{0%{background-position:100% 50%}100%{background-position:0 50%}}

.nov-rodape{border-top:1px solid #eef2f7;}
.nov-rodape button{width:100%;background:none;border:none;cursor:pointer;padding:12px;
  font-size:.78rem;font-weight:800;color:#0f3171;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  transition:background .18s,gap .18s;}
.nov-rodape button:hover{background:#f8fafc;gap:10px;}

/* ──────────────────────── megafone da barra de topo ─────────────────── */
.nov-bolinha{position:absolute;right:1px;top:1px;display:grid;place-items:center;
  min-width:16px;height:16px;padding:0 4px;border-radius:999px;
  background:#dc2626;color:#fff;font-size:9px;font-weight:900;line-height:1;
  box-shadow:0 0 0 2px #fff;animation:nov-entra-bolinha .35s cubic-bezier(.34,1.56,.64,1);}
@keyframes nov-entra-bolinha{from{transform:scale(0)}to{transform:scale(1)}}
/* Halo que sai da bolinha, chamando o olho sem piscar o número. */
.nov-bolinha::after{content:"";position:absolute;inset:-3px;border-radius:999px;
  border:2px solid rgba(220,38,38,.5);animation:nov-halo 2.2s ease-out infinite;}
@keyframes nov-halo{0%{transform:scale(.7);opacity:.9}70%,100%{transform:scale(1.7);opacity:0}}

.nov-pop{position:absolute;right:0;top:100%;z-index:20;margin-top:8px;width:390px;max-width:88vw;
  overflow:hidden;border-radius:14px;border:1px solid #e2e8f0;background:#fff;
  box-shadow:0 18px 44px rgba(15,23,42,.18);
  transform-origin:top right;animation:nov-abre .22s cubic-bezier(.16,1,.3,1);}
@keyframes nov-abre{from{opacity:0;transform:scale(.96) translateY(-6px)}to{opacity:1;transform:none}}
.nov-pop .nov-lista{max-height:60vh;overflow-y:auto;}

/* ─────────────────────────────── modal ──────────────────────────────── */
.nov-ov{position:fixed;inset:0;z-index:700;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);
  display:flex;align-items:center;justify-content:center;padding:20px;
  animation:nov-fade .18s ease;}
@keyframes nov-fade{from{opacity:0}to{opacity:1}}
.nov-modal{background:#fff;border-radius:18px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;
  padding:22px;box-shadow:0 24px 60px rgba(15,23,42,.28);
  animation:nov-sobe .26s cubic-bezier(.16,1,.3,1);}
@keyframes nov-sobe{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
.nov-fg{margin-bottom:13px;}
/* O :not(.nov-switch) é essencial, não enfeite: esta regra tem
   especificidade 0,1,1 e vencia o .nov-switch (0,1,0), devolvendo
   display:block ao interruptor. Como ele é um <label> dentro de .nov-fg, o
   trilho voltava a ser inline — e width/height não valem em elemento inline
   não substituído, então a pílula virava uma caixa de 0px e a bolinha
   aparecia em cima do texto. */
.nov-fg label:not(.nov-switch){display:block;font-size:.72rem;font-weight:800;color:#475569;margin-bottom:5px;}
.nov-fi{width:100%;border:1px solid #e2e8f0;border-radius:11px;padding:9px 12px;font-size:.83rem;
  font-family:inherit;color:#0f172a;outline:none;background:#fff;
  transition:border-color .18s,box-shadow .18s;}
.nov-fi:focus{border-color:#1d4ed8;box-shadow:0 0 0 3px rgba(29,78,216,.14);}
.nov-fi-dica{margin:4px 0 0;font-size:.68rem;color:#94a3b8;}

/* Seletor de tipo: bem mais legível que um <select> para 4 opções. */
.nov-tipos{display:flex;gap:7px;flex-wrap:wrap;}
.nov-tipo{border:1px solid #e2e8f0;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer;
  font-size:.72rem;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.04em;
  transition:transform .16s,border-color .16s,background .16s,color .16s;}
.nov-tipo:hover{transform:translateY(-1px);}
.nov-tipo--on{background:var(--selo-bg);color:var(--selo);border-color:var(--selo);}

/* Os dois seletores de propósito: o segundo garante o flex mesmo se alguém
   colocar o interruptor dentro de outro contêiner que estilize "label". */
.nov-fg .nov-switch,.nov-switch{display:flex;align-items:center;gap:9px;cursor:pointer;
  user-select:none;position:relative;margin-bottom:0;}
.nov-switch input{position:absolute;opacity:0;pointer-events:none;}
.nov-switch-tr{width:38px;height:21px;border-radius:999px;background:#cbd5e1;position:relative;flex:none;
  transition:background .22s;}
.nov-switch-tr::after{content:"";position:absolute;top:2.5px;left:2.5px;width:16px;height:16px;border-radius:50%;
  background:#fff;box-shadow:0 2px 5px rgba(15,23,42,.25);transition:transform .22s cubic-bezier(.34,1.56,.64,1);}
.nov-switch input:checked + .nov-switch-tr{background:#16a34a;}
.nov-switch input:checked + .nov-switch-tr::after{transform:translateX(17px);}
.nov-switch-tx{font-size:.76rem;font-weight:700;color:#475569;}

.nov-erro{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:10px;
  padding:8px 11px;font-size:.75rem;font-weight:700;margin-bottom:12px;
  animation:nov-treme .3s;}
@keyframes nov-treme{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}

.nov-modal-pe{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;}

/* ─────────────────────────────── página ─────────────────────────────── */
.nov-pagina{max-width:840px;margin:0 auto;}
.nov-filtros{display:flex;gap:7px;flex-wrap:wrap;padding:0 14px 12px;}

@media (max-width:640px){
  .nov-pop{width:min(390px,92vw);}
  .nov-hd{flex-wrap:wrap;}
}

/* ────────────────────── cabeçalho em coluna estreita ────────────────────── */
/* O painel vive em duas larguras muito diferentes: a página /app/novidades,
   que é larga, e a coluna da direita do Início, que tem 340px. O cabeçalho
   era uma linha só — ícone, texto e botões lado a lado — e na coluna estreita
   o texto (flex:1) era espremido pelos botões (flex:none) até "Novidades do
   Sistema" quebrar palavra por palavra e o subtítulo virar cinco linhas.

   É CONTAINER query, não media query: a de cima olha a largura da JANELA, e
   numa tela larga com a coluna estreita ela nunca dispara — que é exatamente
   o caso do Início. Aqui o painel reage ao espaço que ELE tem. */
.nov-card{container-type:inline-size;}

@container (max-width:430px){
  /* Título e subtítulo ficam com a linha inteira; os botões descem para a
     linha de baixo, encostados à direita. */
  .nov-hd{flex-wrap:wrap;align-items:flex-start;}
  .nov-hd-tx{flex:1 1 auto;}
  .nov-hd-acoes{flex:1 0 100%;justify-content:flex-end;}
}

/* Quem pediu menos movimento recebe a tela parada. */
@media (prefers-reduced-motion:reduce){
  .nov-item,.nov-pop,.nov-modal,.nov-ov,.nov-bolinha{animation:none;opacity:1;transform:none;}
  .nov-item::after,.nov-bolinha::after,.nov-hd-ic--vivo,.nov-skel,
  .nov-item--nova .nov-item-tt::after{animation:none;}
  .nov-item:hover,.nov-btn:hover,.nov-tipo:hover{transform:none;}
}
`;

/** Injeta o CSS uma vez só, mesmo com painel, página e megafone montados juntos. */
export function usarEstiloNovidades() {
  useEffect(() => {
    if (document.getElementById(ID)) return;
    const tag = document.createElement("style");
    tag.id = ID;
    tag.textContent = CSS_NOVIDADES;
    document.head.appendChild(tag);
  }, []);
}
