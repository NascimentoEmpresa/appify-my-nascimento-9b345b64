import { useState, useEffect, Dispatch, SetStateAction } from "react";

// SIS-2026-0350 (Cálita): "quando eu seleciono VOLTAR no sistema eu não
// precisasse colocar todos os filtros que já tinha selecionado — seleciono
// empresa, data de pagamento e aguardando pagamento, abro a despesa, faço o
// pagamento, anexo o comprovante, e ao voltar pra tela de pagamentos saem
// todos os filtros". Vale também pra paginação ("volta pra 1"). As telas de
// lista do
// Malote (Aprovações, Meus Itens, Pagamento) guardam filtros/paginação em
// useState puro — ao entrar numa despesa o componente desmonta e, ao voltar,
// remonta zerado. Este hook é um drop-in de useState que espelha o valor num
// "balde" JSON no sessionStorage (uma chave por tela), restaurando na
// montagem. Mesma abordagem já usada em plano-acoes/Lista.tsx.
//
// sessionStorage (não localStorage): o filtro dura enquanto a aba está
// aberta e some ao fechar — o usuário não volta dias depois com um recorte
// "fantasma" que ele não lembra ter posto. Só persiste estado de FILTRO/
// página; estado de UI puro (popover aberto, etc.) continua em useState
// normal.

function lerBalde(chave: string): Record<string, unknown> {
  try {
    const cru = sessionStorage.getItem(chave);
    const obj = cru ? JSON.parse(cru) : {};
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function useEstadoPersistido<T>(
  chave: string,
  campo: string,
  inicial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [valor, setValor] = useState<T>(() => {
    const balde = lerBalde(chave);
    return campo in balde ? (balde[campo] as T) : inicial;
  });

  useEffect(() => {
    const balde = lerBalde(chave);
    balde[campo] = valor;
    try {
      sessionStorage.setItem(chave, JSON.stringify(balde));
    } catch {
      // quota estourada / modo privado — não é motivo pra quebrar a tela
    }
  }, [chave, campo, valor]);

  return [valor, setValor];
}
