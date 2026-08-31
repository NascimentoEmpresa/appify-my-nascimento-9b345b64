/**
 * CSS do Chat geral da empresa.
 *
 * Mesma receita de Novidades e Aniversariantes: string injetada no <head> na
 * primeira montagem, uma tag só. O cartão herda `.ini-card` / `.ini-card-hd` /
 * `.ini-card-body` da tela de Início — aqui mora só o miolo.
 */
import { useEffect } from "react";

const ID = "chat-geral-styles";

export const CSS_CHAT_GERAL = `
/* O corpo do chat tem altura FIXA e rolagem própria. Sem isso o cartão
   cresce com a conversa e empurra o resto do Início para fora da tela —
   e, ao lado dos aniversariantes, as duas colunas ficariam desalinhadas
   por motivo nenhum. */
.chat-body{display:flex;flex-direction:column;gap:10px;padding:14px 16px;}
.chat-lista{display:flex;flex-direction:column;gap:9px;height:286px;overflow-y:auto;
  padding-right:6px;scrollbar-width:thin;}
.chat-lista::-webkit-scrollbar{width:6px;}
.chat-lista::-webkit-scrollbar-thumb{background:hsl(var(--border));border-radius:9999px;}

.chat-dia{align-self:center;font-size:.64rem;font-weight:700;letter-spacing:.1em;
  text-transform:uppercase;color:hsl(var(--muted-foreground));
  background:hsl(var(--muted) / .6);border-radius:9999px;padding:2px 10px;margin:2px 0;}

.chat-msg{position:relative;display:flex;gap:8px;}
/* Mensagem seguida do mesmo autor não repete foto nem nome: a conversa fica
   com cara de conversa, e não de lista de crachás. */
.chat-msg--seguida{margin-top:-5px;}
.chat-av{flex:none;width:26px;height:26px;border-radius:9999px;object-fit:cover;
  display:grid;place-items:center;font-size:.6rem;font-weight:800;
  color:hsl(var(--primary));background:hsl(var(--primary) / .12);}
.chat-av--vazio{background:none;}
.chat-msg-corpo{min-width:0;flex:1;}
.chat-msg-topo{display:flex;align-items:baseline;gap:7px;}
.chat-autor{font-size:.76rem;font-weight:700;color:hsl(var(--foreground));
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.chat-autor--eu{color:hsl(var(--primary));}
.chat-hora{flex:none;font-size:.64rem;color:hsl(var(--muted-foreground));
  font-variant-numeric:tabular-nums;}
.chat-texto{font-size:.8rem;line-height:1.45;color:hsl(var(--foreground));
  overflow-wrap:anywhere;white-space:pre-wrap;}

/* O X só aparece no hover da própria mensagem — não vira um mural de lixeiras. */
.chat-apagar{position:absolute;top:0;right:0;display:grid;place-items:center;
  width:20px;height:20px;border-radius:6px;cursor:pointer;
  border:none;background:hsl(var(--card));color:hsl(var(--muted-foreground));
  opacity:0;transition:opacity .18s,color .18s,background .18s;}
.chat-msg:hover .chat-apagar,.chat-apagar:focus-visible{opacity:1;}
.chat-apagar:hover{background:hsl(0 72% 51% / .1);color:hsl(0 72% 45%);}

/* ─────────────────────────── caixa de envio ────────────────────────── */
.chat-envio{display:flex;align-items:flex-end;gap:8px;border-top:1px solid hsl(var(--border));
  padding-top:11px;}
.chat-envio textarea{flex:1;min-width:0;min-height:36px;max-height:96px;resize:none;
  font:inherit;font-size:.8rem;line-height:1.4;padding:8px 11px;border-radius:11px;
  color:hsl(var(--foreground));background:hsl(var(--surface));
  border:1px solid hsl(var(--border));transition:border-color .2s,box-shadow .2s;}
.chat-envio textarea:focus{outline:none;border-color:hsl(var(--ring));
  box-shadow:0 0 0 3px hsl(var(--ring) / .18);}
.chat-enviar{flex:none;display:grid;place-items:center;width:36px;height:36px;
  border-radius:11px;cursor:pointer;border:none;
  background:hsl(var(--primary));color:hsl(var(--primary-foreground));
  transition:background .2s,transform .2s cubic-bezier(.16,1,.3,1),opacity .2s;}
.chat-enviar:hover:not(:disabled){background:hsl(var(--primary-hover));transform:translateY(-1px);}
.chat-enviar:disabled{opacity:.4;cursor:default;}

.chat-vazio{display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:8px;flex:1;color:hsl(var(--muted-foreground));text-align:center;font-size:.8rem;}

@media (prefers-reduced-motion:reduce){
  .chat-enviar:hover:not(:disabled){transform:none;}
}
`;

export function usarEstiloChatGeral() {
  useEffect(() => {
    if (document.getElementById(ID)) return;
    const tag = document.createElement("style");
    tag.id = ID;
    tag.textContent = CSS_CHAT_GERAL;
    document.head.appendChild(tag);
  }, []);
}
