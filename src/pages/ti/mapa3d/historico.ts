import { useCallback, useRef, useState } from "react";
import type { TiAtivo, TiElemento } from "@/hooks/useTiMapa";

/**
 * Desfazer e refazer do editor do mapa (Ctrl+Z / Ctrl+Y).
 *
 * POR QUE ISTO NÃO É TRIVIAL AQUI
 *   Num editor comum, desfazer é voltar um estado em memória. Aqui cada ação
 *   já foi GRAVADA no banco quando o usuário soltou o mouse — desfazer
 *   significa mandar a operação inversa para o Supabase, não mexer só na tela.
 *
 *   Por isso a pilha guarda o ANTES e o DEPOIS de cada mudança, e não um
 *   snapshot do mapa inteiro: o inverso de "moveu a parede" é "põe a parede de
 *   volta onde estava", e o inverso de "removeu" é "insere de novo, com o
 *   mesmo id" — o id importa, senão o equipamento que estava em cima perde a
 *   referência e o próximo Ctrl+Y duplica a peça.
 *
 * O QUE ENTRA NA PILHA
 *   Só o que o usuário reconhece como uma ação: criar, mover/alterar e
 *   remover. Selecionar, girar a câmera e trocar de andar não entram — Ctrl+Z
 *   que desfaz "eu olhei para o outro lado" é pior do que não ter Ctrl+Z.
 *
 * LIMITE
 *   50 ações. É memória de trabalho de quem está montando uma sala, não
 *   histórico de auditoria — para isso existe TI_ATIVO_EVENTO, no banco.
 */

export type AcaoMapa =
  | { tipo: "criar_elemento"; depois: TiElemento }
  | { tipo: "atualizar_elemento"; antes: TiElemento; depois: TiElemento }
  | { tipo: "remover_elemento"; antes: TiElemento }
  | { tipo: "atualizar_ativo"; antes: TiAtivo; depois: TiAtivo };

/** O que a tela precisa saber fazer para o histórico funcionar. */
export interface Aplicador {
  criarElemento: (el: TiElemento) => void;
  atualizarElemento: (el: TiElemento) => void;
  removerElemento: (id: string) => void;
  atualizarAtivo: (ativo: TiAtivo) => void;
}

const LIMITE = 50;

/**
 * O inverso de uma ação — a regra que faz o Ctrl+Z valer.
 *
 * Função pura e exportada porque é aqui que mora o erro difícil de ver: um
 * inverso trocado só aparece quando alguém desfaz e a peça vai para o lugar
 * errado, e ninguém testa isso clicando.
 */
export function desfazerAcao(acao: AcaoMapa, ap: Aplicador): void {
  switch (acao.tipo) {
    case "criar_elemento":
      ap.removerElemento(acao.depois.id);
      return;
    case "remover_elemento":
      ap.criarElemento(acao.antes);
      return;
    case "atualizar_elemento":
      ap.atualizarElemento(acao.antes);
      return;
    case "atualizar_ativo":
      ap.atualizarAtivo(acao.antes);
      return;
  }
}

/** Refazer é a ação no sentido original. */
export function refazerAcao(acao: AcaoMapa, ap: Aplicador): void {
  switch (acao.tipo) {
    case "criar_elemento":
      ap.criarElemento(acao.depois);
      return;
    case "remover_elemento":
      ap.removerElemento(acao.antes.id);
      return;
    case "atualizar_elemento":
      ap.atualizarElemento(acao.depois);
      return;
    case "atualizar_ativo":
      ap.atualizarAtivo(acao.depois);
      return;
  }
}

/** Descrição curta para o botão e o aviso na tela. */
export function descreverAcao(acao: AcaoMapa): string {
  switch (acao.tipo) {
    case "criar_elemento":
      return "criar peça";
    case "remover_elemento":
      return "remover peça";
    case "atualizar_elemento":
      return "mudar peça";
    case "atualizar_ativo":
      return "mover equipamento";
  }
}

export function useHistoricoMapa(aplicador: Aplicador) {
  const [passado, setPassado] = useState<AcaoMapa[]>([]);
  const [futuro, setFuturo] = useState<AcaoMapa[]>([]);

  // O aplicador muda a cada render (fecha sobre os dados atuais); a ref evita
  // recriar `desfazer`/`refazer` — e, com eles, o listener de teclado — a cada
  // frame de digitação.
  const ref = useRef(aplicador);
  ref.current = aplicador;

  const registrar = useCallback((acao: AcaoMapa) => {
    setPassado((p) => [...p.slice(-(LIMITE - 1)), acao]);
    // Fazer algo novo depois de desfazer descarta o que estava à frente: é o
    // comportamento de todo editor, e manter o futuro daria um Ctrl+Y que
    // refaz uma ação de outra linha do tempo.
    setFuturo([]);
  }, []);

  const desfazer = useCallback(() => {
    setPassado((p) => {
      if (p.length === 0) return p;
      const acao = p[p.length - 1];
      desfazerAcao(acao, ref.current);
      setFuturo((f) => [...f, acao]);
      return p.slice(0, -1);
    });
  }, []);

  const refazer = useCallback(() => {
    setFuturo((f) => {
      if (f.length === 0) return f;
      const acao = f[f.length - 1];
      refazerAcao(acao, ref.current);
      setPassado((p) => [...p, acao]);
      return f.slice(0, -1);
    });
  }, []);

  const limpar = useCallback(() => {
    setPassado([]);
    setFuturo([]);
  }, []);

  return {
    registrar,
    desfazer,
    refazer,
    limpar,
    podeDesfazer: passado.length > 0,
    podeRefazer: futuro.length > 0,
    proximoDesfazer: passado.length ? descreverAcao(passado[passado.length - 1]) : null,
    proximoRefazer: futuro.length ? descreverAcao(futuro[futuro.length - 1]) : null,
  };
}
