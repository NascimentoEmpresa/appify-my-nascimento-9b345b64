/**
 * CSS do cartão de Aniversariantes.
 *
 * String injetada no <head> na primeira montagem, igual ao que Novidades e a
 * própria tela de Início fazem: são regras de uma funcionalidade só, que não
 * têm por que pesar no CSS global do ERP inteiro. `usarEstiloAniversarios()`
 * garante uma única tag mesmo se o cartão for montado em mais de um lugar.
 *
 * O cartão herda `.ini-card` / `.ini-card-hd` / `.ini-card-body` da tela de
 * Início — só o miolo é próprio daqui. É o mesmo caminho do cartão de Minhas
 * Reuniões: cabeçalho igual ao dos vizinhos, sem repetir estilo.
 */
import { useEffect } from "react";

const ID = "aniv-styles";

export const CSS_ANIVERSARIOS = `
/* O cartão divide a fileira de baixo do Início com o Chat da empresa, então
   respira menos que os blocos de largura cheia lá de cima. */
.aniv-body{padding:14px 16px;}

/* ─────────────────────────── pessoa do dia ─────────────────────────── */
.aniv-hoje{display:flex;flex-direction:column;gap:10px;}
.aniv-pessoa{display:flex;gap:11px;padding:11px;border-radius:13px;
  border:1px solid hsl(var(--border));background:hsl(var(--surface));}
/* O aniversariante que está olhando a própria tela ganha o destaque —
   é o único caso em que o cartão fala com uma pessoa só. */
.aniv-pessoa--eu{border-color:hsl(var(--primary) / .45);
  background:linear-gradient(135deg,hsl(var(--primary) / .07),transparent 65%);}

/* ─────────────────── foto + reações por cima dela ──────────────────── */
.aniv-foto{position:relative;flex:none;width:46px;height:46px;}
.aniv-foto img,.aniv-foto .aniv-iniciais{width:46px;height:46px;border-radius:9999px;
  object-fit:cover;display:grid;place-items:center;
  font-size:.82rem;font-weight:800;letter-spacing:-.02em;
  color:hsl(var(--primary));background:hsl(var(--primary) / .12);
  border:2px solid hsl(var(--card));box-shadow:0 4px 14px -6px hsl(218 50% 15% / .45);}
/* Um anel quente marca a foto de quem é do dia — parado e de uma cor só.
   O primeiro desenho era um degradê arco-íris girando; ao lado dos emojis
   das reações a foto virava a coisa mais barulhenta da tela inicial, e o
   cartão é para ser discreto. */
.aniv-foto::before{content:'';position:absolute;inset:-3px;border-radius:9999px;z-index:0;
  background:linear-gradient(135deg,#f59e0b,#fb923c 55%,#f472b6);opacity:.85;}
.aniv-foto > *{position:relative;z-index:1;}
/* As reações recebidas ficam POR CIMA da borda de baixo da foto, empilhadas
   como no WhatsApp — é a "variação" que os colegas deixaram aparecendo na
   foto dela o dia inteiro. Sobem para dentro do círculo de propósito: se
   ficassem penduradas embaixo, encostariam na fila de botões de reagir e as
   duas coisas viravam uma fileira de emoji só. */
.aniv-reacoes-foto{position:absolute;left:50%;bottom:-2px;transform:translateX(-50%);
  z-index:2;display:flex;align-items:center;}
.aniv-reacao-chip{display:inline-flex;align-items:center;gap:2px;height:18px;padding:0 4px;
  margin-left:-5px;border-radius:9999px;font-size:.66rem;line-height:1;
  background:hsl(var(--card));border:1px solid hsl(var(--border));
  box-shadow:0 2px 6px hsl(218 50% 15% / .18);
  animation:aniv-pipoca .34s cubic-bezier(.34,1.56,.64,1) both;}
.aniv-reacao-chip:first-child{margin-left:0;}
.aniv-reacao-chip b{font-size:.64rem;font-weight:800;color:hsl(var(--muted-foreground));}
@keyframes aniv-pipoca{from{opacity:0;transform:scale(.4) translateY(6px)}to{opacity:1;transform:none}}

/* ──────────────────────────── miolo do item ────────────────────────── */
.aniv-corpo{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px;}
.aniv-nome{font-size:.84rem;font-weight:800;color:hsl(var(--foreground));line-height:1.25;}
.aniv-cargo{font-size:.71rem;color:hsl(var(--muted-foreground));line-height:1.35;}
.aniv-parabens{font-size:.72rem;font-weight:700;color:hsl(var(--primary));}

/* ─────────────────────── barra de reações ──────────────────────────── */
.aniv-barra{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:1px;}
.aniv-bt{display:grid;place-items:center;width:27px;height:27px;border-radius:9px;cursor:pointer;
  font-size:.88rem;line-height:1;background:hsl(var(--muted) / .5);
  border:1px solid transparent;
  transition:transform .22s cubic-bezier(.34,1.56,.64,1),background .2s,border-color .2s;}
.aniv-bt:hover{transform:translateY(-2px) scale(1.12);background:hsl(var(--muted));}
.aniv-bt--on{border-color:hsl(var(--primary) / .55);background:hsl(var(--primary) / .12);}
.aniv-bt:disabled{cursor:default;opacity:.6;transform:none;}
.aniv-recado-bt{display:inline-flex;align-items:center;gap:5px;margin-left:auto;
  font-size:.71rem;font-weight:700;color:hsl(var(--primary));
  background:none;border:none;cursor:pointer;padding:4px 2px;transition:color .2s;}
.aniv-recado-bt:hover{color:hsl(var(--primary-hover));text-decoration:underline;}

/* ────────────────────────── caixa do recado ────────────────────────── */
.aniv-forma{display:flex;flex-direction:column;gap:7px;}
.aniv-forma textarea{width:100%;min-height:58px;resize:vertical;font:inherit;font-size:.8rem;
  padding:8px 10px;border-radius:11px;color:hsl(var(--foreground));
  background:hsl(var(--card));border:1px solid hsl(var(--border));
  transition:border-color .2s,box-shadow .2s;}
.aniv-forma textarea:focus{outline:none;border-color:hsl(var(--ring));
  box-shadow:0 0 0 3px hsl(var(--ring) / .18);}
.aniv-forma-pe{display:flex;align-items:center;gap:8px;}
.aniv-contador{font-size:.68rem;color:hsl(var(--muted-foreground));margin-right:auto;}

/* ──────────────────────── recados recebidos ────────────────────────── */
.aniv-recados{display:flex;flex-direction:column;gap:6px;padding-top:2px;}
.aniv-recado{display:flex;gap:6px;font-size:.75rem;line-height:1.4;
  color:hsl(var(--foreground));}
.aniv-recado-emoji{flex:none;font-size:.85rem;line-height:1.4;}
.aniv-recado b{font-weight:700;}
.aniv-recado span{color:hsl(var(--muted-foreground));}

/* ─────────────────────────── próximos dias ─────────────────────────── */
.aniv-titulo{font-size:.63rem;font-weight:700;text-transform:uppercase;letter-spacing:.14em;
  color:hsl(var(--muted-foreground));margin:13px 0 6px;}
.aniv-hoje + .aniv-titulo{margin-top:15px;}
.aniv-breve{display:flex;flex-direction:column;}
.aniv-breve-item{display:flex;align-items:center;gap:9px;padding:5px 2px;font-size:.76rem;
  border-top:1px solid hsl(var(--border));}
.aniv-breve-item:first-child{border-top:none;}
.aniv-breve-data{flex:none;width:42px;font-weight:800;font-variant-numeric:tabular-nums;
  color:hsl(var(--primary));}
.aniv-breve-nome{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  color:hsl(var(--foreground));}
.aniv-breve-quando{flex:none;font-size:.67rem;color:hsl(var(--muted-foreground));}
.aniv-breve-mais{padding:6px 2px 0;font-size:.7rem;color:hsl(var(--muted-foreground));}

@media (max-width:900px){
  .aniv-recado-bt{margin-left:0;}
}
@media (prefers-reduced-motion:reduce){
  .aniv-reacao-chip{animation:none;}
  .aniv-bt:hover{transform:none;}
}
`;

export function usarEstiloAniversarios() {
  useEffect(() => {
    if (document.getElementById(ID)) return;
    const tag = document.createElement("style");
    tag.id = ID;
    tag.textContent = CSS_ANIVERSARIOS;
    document.head.appendChild(tag);
  }, []);
}
