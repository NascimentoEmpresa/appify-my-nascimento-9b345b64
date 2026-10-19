import { createContext, useContext, type ReactNode } from "react";

// =====================================================================
// Camada alta para Dialog/Select/Popover do shadcn (16/10/2026).
//
// Algumas telas abrem janelas próprias com z-index alto — o kanban de
// candidatos do Recrutamento é z 800 (e os diálogos dele, 1100). O Dialog do
// shadcn nasce em z-50: aberto de dentro do kanban, ficava ATRÁS da janela
// e o usuário só via o fundo escurecer ("aparece lá no fundo só uma animação
// diferente e nada acontece" — Pablo, botão Status Compras).
//
// Envolver o componente em <CamadaAlta> sobe tudo o que o shadcn abre dentro
// dele (o contexto atravessa o portal do Radix): diálogo, e as listas de
// Select/Popover POR CIMA do diálogo. Fora dele, nada muda.
// =====================================================================

const Ctx = createContext(false);

export const CAMADA_ALTA = { overlay: "z-[1150]", conteudo: "z-[1151]", flutuante: "z-[1160]" } as const;

export function CamadaAlta({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={true}>{children}</Ctx.Provider>;
}

export const useCamadaAlta = () => useContext(Ctx);
