import { useCallback, useSyncExternalStore } from "react";
import { CODIGO_PADRAO } from "./FiltroCodigoNota";
import type { BaseDespesa } from "./regras";

// SIS-2026-0721: parâmetros de leitura COMPARTILHADOS entre Faturamento da Empresa, Lucratividade de Contratos e Fechamento da Empresa.
// Trocar a base (competência × data de pagamento), o código da nota ou a empresa numa das telas troca nas outras duas: as três ficam no
// mesmo momento de leitura. Guardado no navegador (sobrevive à troca de tela e ao recarregar) e lido por useSyncExternalStore, então até
// duas telas abertas ao mesmo tempo se acompanham. Ano e mês ficam por tela: umas leem o ano inteiro, outra um mês só.
export interface LeituraCompartilhada {
  base: BaseDespesa;
  codigo: string;
  empresaId: string;
}

const CHAVE = "controladoria_leitura_v1";
const PADRAO: LeituraCompartilhada = { base: "competencia", codigo: CODIGO_PADRAO, empresaId: "todos" };

let atual: LeituraCompartilhada | null = null;
const ouvintes = new Set<() => void>();

function ler(): LeituraCompartilhada {
  if (atual) return atual;
  let lido: Partial<LeituraCompartilhada> = {};
  try {
    lido = JSON.parse(localStorage.getItem(CHAVE) ?? "{}") ?? {};
  } catch {
    lido = {};
  }
  atual = {
    base: lido.base === "pagamento" ? "pagamento" : "competencia",
    codigo: typeof lido.codigo === "string" && lido.codigo ? lido.codigo : PADRAO.codigo,
    empresaId: typeof lido.empresaId === "string" && lido.empresaId ? lido.empresaId : PADRAO.empresaId,
  };
  return atual;
}

function gravar(parcial: Partial<LeituraCompartilhada>) {
  atual = { ...ler(), ...parcial };
  try {
    localStorage.setItem(CHAVE, JSON.stringify(atual));
  } catch {
    // navegador sem armazenamento: vale só nesta sessão
  }
  ouvintes.forEach((f) => f());
}

function assinar(f: () => void) {
  ouvintes.add(f);
  const outraAba = (e: StorageEvent) => {
    if (e.key === CHAVE) {
      atual = null;
      f();
    }
  };
  window.addEventListener("storage", outraAba);
  return () => {
    ouvintes.delete(f);
    window.removeEventListener("storage", outraAba);
  };
}

export function useLeituraCompartilhada() {
  const leitura = useSyncExternalStore(assinar, ler, () => PADRAO);
  const setBase = useCallback((base: BaseDespesa) => gravar({ base }), []);
  const setCodigo = useCallback((codigo: string) => gravar({ codigo }), []);
  const setEmpresaId = useCallback((empresaId: string) => gravar({ empresaId }), []);
  return { ...leitura, setBase, setCodigo, setEmpresaId };
}

// Só para teste: volta ao padrão e esquece o que estava guardado.
export function reiniciarLeituraCompartilhada() {
  atual = null;
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // sem armazenamento
  }
  ouvintes.forEach((f) => f());
}
