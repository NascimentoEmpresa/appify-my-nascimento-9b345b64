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
/* Mural de recados (22/09/2026): era uma linha corrida "emoji Nome: texto",
   que embolava quando o recado passava de uma linha. Agora cada recado é um
   balão com o rostinho de quem escreveu — fica claro quem falou o quê. */
.aniv-recados{display:flex;flex-direction:column;gap:7px;padding-top:4px;
  border-top:1px dashed hsl(var(--border));margin-top:2px;}
.aniv-recados-tt{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;
  color:hsl(var(--muted-foreground));padding-top:4px;}
.aniv-recado{display:flex;gap:8px;align-items:flex-start;}
.aniv-recado-av{position:relative;flex:none;width:26px;height:26px;}
.aniv-recado-av img,.aniv-recado-av span.aniv-recado-ini{width:26px;height:26px;border-radius:9999px;
  display:grid;place-items:center;object-fit:cover;font-size:.6rem;font-weight:800;
  color:hsl(var(--primary));background:hsl(var(--primary) / .12);border:1px solid hsl(var(--border));}
.aniv-recado-av .aniv-recado-emoji{position:absolute;right:-4px;bottom:-4px;font-size:.72rem;
  line-height:1;background:hsl(var(--card));border-radius:9999px;padding:1px;
  box-shadow:0 1px 4px hsl(218 50% 15% / .2);}
.aniv-recado-balao{flex:1;min-width:0;background:hsl(var(--muted) / .45);
  border:1px solid hsl(var(--border));border-radius:4px 12px 12px 12px;padding:6px 10px;}
.aniv-recado-autor{font-size:.7rem;font-weight:800;color:hsl(var(--foreground));line-height:1.3;}
.aniv-recado-texto{font-size:.76rem;line-height:1.45;color:hsl(var(--muted-foreground));
  overflow-wrap:anywhere;}

/* ─────────────────────────── próximos dias ─────────────────────────── */
.aniv-titulo{font-size:.63rem;font-weight:700;text-transform:uppercase;letter-spacing:.14em;
  color:hsl(var(--muted-foreground));margin:13px 0 6px;}
.aniv-hoje + .aniv-titulo{margin-top:15px;}
.aniv-breve{display:flex;flex-direction:column;}
/* align-items:flex-start, e não center: o nome agora é o NOME COMPLETO do
   cadastro e quebra em duas linhas num cartão de meia largura. Centralizado,
   a data e o "em N dias" flutuariam no meio da segunda linha. */
.aniv-breve-item{display:flex;align-items:flex-start;gap:9px;padding:6px 2px;font-size:.76rem;
  border-top:1px solid hsl(var(--border));}
.aniv-breve-item:first-child{border-top:none;}
.aniv-breve-data{flex:none;width:42px;font-weight:800;font-variant-numeric:tabular-nums;
  color:hsl(var(--primary));line-height:1.35;}
/* Sem nowrap/ellipsis: cortar "MARIA APARECIDA DA S…" derrota o pedido de
   mostrar o nome completo. Quem tem nome longo ocupa duas linhas. */
.aniv-breve-nome{flex:1;min-width:0;line-height:1.35;overflow-wrap:anywhere;
  color:hsl(var(--foreground));}
.aniv-breve-setor{color:hsl(var(--muted-foreground));}
.aniv-breve-quando{flex:none;font-size:.67rem;line-height:1.5;
  color:hsl(var(--muted-foreground));}
.aniv-breve-mais{padding:6px 2px 0;font-size:.7rem;color:hsl(var(--muted-foreground));}

/* ───────────── festa: confete, emoji subindo, quem reagiu ──────────── */
/* Confete cai UMA vez quando o cartão aparece com aniversariante do dia, e
   de novo a cada reação enviada. Fica preso ao cartão (overflow:hidden) e
   não captura clique. */
.aniv-pessoa{position:relative;}
.aniv-festa{position:absolute;inset:0;pointer-events:none;z-index:3;
  overflow:hidden;border-radius:13px;}
.aniv-confete{position:absolute;top:-12px;width:7px;height:11px;border-radius:2px;opacity:0;
  animation:aniv-cair linear forwards;}
@keyframes aniv-cair{
  0%{opacity:0;transform:translateY(-10px) rotate(0deg);}
  10%{opacity:1;}
  100%{opacity:0;transform:translateY(190px) rotate(540deg);}
}
/* Emoji que sobe da barra de reações, como o "curtir" do Facebook. */
.aniv-sobe{position:absolute;bottom:8px;font-size:1.05rem;opacity:0;
  animation:aniv-subir 1.25s ease-out forwards;}
@keyframes aniv-subir{
  0%{opacity:0;transform:translateY(0) scale(.6);}
  15%{opacity:1;transform:translateY(-10px) scale(1.15);}
  100%{opacity:0;transform:translateY(-92px) scale(.9);}
}
/* Quem reagiu: aparece ao passar o mouse (ou focar) na pilha de reações. */
.aniv-reacao-pilha{position:relative;display:inline-flex;}
.aniv-reacao-pilha:focus{outline:none;}
.aniv-tip{position:absolute;left:0;top:calc(100% + 8px);transform:translateY(3px) scale(.98);
  z-index:9;min-width:132px;max-width:230px;padding:7px 10px;border-radius:10px;
  background:hsl(var(--popover, var(--card)));color:hsl(var(--foreground));
  border:1px solid hsl(var(--border));box-shadow:0 10px 26px -12px hsl(218 50% 15% / .55);
  font-size:.7rem;line-height:1.45;text-align:left;
  opacity:0;visibility:hidden;transition:opacity .15s,transform .15s;}
.aniv-reacao-pilha:hover .aniv-tip,
.aniv-reacao-pilha:focus-within .aniv-tip{opacity:1;visibility:visible;transform:none;}
.aniv-tip b{display:block;font-size:.62rem;text-transform:uppercase;letter-spacing:.1em;
  color:hsl(var(--muted-foreground));margin-bottom:3px;}
.aniv-tip-linha{display:flex;gap:5px;align-items:baseline;}
.aniv-tip-linha span:first-child{flex:none;}

@media (max-width:900px){
  .aniv-recado-bt{margin-left:0;}
}
@media (prefers-reduced-motion:reduce){
  .aniv-reacao-chip{animation:none;}
  .aniv-bt:hover{transform:none;}
  /* Movimento reduzido no sistema (Windows › "Mostrar animações" desligado):
     a festa continua, mas sem nada voando — os papéis e os emojis só
     aparecem e somem no lugar. Esconder tudo deixava o cartão sem a graça
     que o pedido tinha. */
  .aniv-confete{animation:aniv-piscar 1.6s ease-out forwards;}
  .aniv-sobe{animation:aniv-piscar 1.2s ease-out forwards;}
  @keyframes aniv-piscar{0%{opacity:0}25%{opacity:.9}100%{opacity:0}}
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
