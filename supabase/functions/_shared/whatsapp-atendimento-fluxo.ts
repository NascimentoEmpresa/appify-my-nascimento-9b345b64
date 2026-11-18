// Arquivo: supabase/functions/_shared/whatsapp-atendimento-fluxo.ts
//
// SIS-2026-0929 — o que o webhook faz quando a mensagem chega no canal de
// atendimento dos supervisores (WA_CANAL.finalidade = 'atendimento_supervisores').
// O canal principal (recrutamento) continua no processarBot de index.ts,
// intocado.
//
// O FLUXO MORA EM conduzirAtendimento(), que só conversa com o mundo por
// "portas" (PortasAtendimento). O webhook liga as portas no banco e no
// WhatsApp de verdade (processarAtendimento); o simulador de
// WhatsApp › Testes (whatsapp-testar, acao "atendimento") liga em portas que
// NÃO gravam nem enviam nada. Mesma ideia do _shared/whatsapp-bot.ts: se o
// simulador tivesse a própria cópia do fluxo, ele testaria outro bot.
//
// Ordem de cada mensagem recebida:
//   1. preparar — o protocolo já foi aberto pelo trigger do banco ao gravar a
//      mensagem; aqui identifica quem escreve (número × cadastro atual), liga
//      contrato/responsável e reserva o aviso de abertura.
//   2. aviso de abertura (I.A + LGPD + protocolo), uma vez por protocolo.
//   3. Se o protocolo não está com a I.A (pessoa assumiu, aguardando humano,
//      canal/IA desligados, bot da conversa desligado) → não responde nada.
//   4. Regras determinísticas antes do modelo: arquivo/áudio → humano;
//      pedido de pessoa → humano.
//   5. I.A com a base APROVADA. Ela pode pedir [[CONSULTAR]] (o banco decide
//      e a resposta com o dado é montada pelo código), [[HUMANO]] ou
//      [[RESOLVIDO]]. Erro do provedor → humano. Saída com cara de dado
//      sensível → bloqueada e humano.
//
// Na dúvida, SEMPRE passa para humano: é o único erro barato deste fluxo.

import {
  aplicarProtocolo, detectarSensiveis, extrairAcoes, formatarDadosConsulta,
  montarSystemAtendimento, pareceDadoSensivel, pediuHumano, resumoDeterministico,
  AVISO_ABERTURA_PADRAO, MSG_ENCAMINHADO_PADRAO, MSG_MIDIA_PADRAO, MSG_NEGADO_PADRAO,
  REGRAS_PADRAO, type RegraDado,
} from "./whatsapp-atendimento.ts";
import { gerarResposta, type BotConfig, type Msg, type RespostaIA } from "./whatsapp-bot.ts";
import type { CanalInfo } from "./whatsapp-canal.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const AVISO_SEM_IA =
  "Olá! Este é o atendimento corporativo dos supervisores do Grupo Nascimento. Recebemos sua mensagem e uma pessoa da equipe vai te responder por aqui. " +
  "As mensagens ficam registradas no sistema da empresa e são usadas apenas para este atendimento, conforme a LGPD. Seu protocolo é {protocolo}.";

export interface Preparo {
  protocolo: string;
  status: string;                 // status do protocolo ANTES desta mensagem ser tratada
  enviar_aviso: boolean;
  identificacao: { papel: string; primeiro_nome: string | null } | null;
}

export interface ResultadoConsulta {
  autorizada: boolean;
  motivo: string;
  proprio?: boolean;
  dados?: Record<string, unknown> | null;
}

// Tudo que o fluxo precisa do mundo de fora.
export interface PortasAtendimento {
  preparar(): Promise<Preparo | null>;
  botAtivo(): Promise<boolean>;
  historico(): Promise<Array<{ direcao: string; origem: string; texto: string | null }>>;
  regras(): Promise<RegraDado[] | null>;
  base(): Promise<Array<{ titulo: string; conteudo: string; assunto: string | null }>>;
  cfgIA(): Promise<{ provedor?: string | null; modelo?: string | null; max_tokens?: number | null } | null>;
  consultar(categoria: string, alvo: string): Promise<ResultadoConsulta | null>;
  encaminhar(motivo: string, resumo: string, assunto: string | null, sensivel: boolean): Promise<void>;
  marcar(assunto: string, sensivel: boolean): Promise<void>;
  concluir(): Promise<void>;
  enviar(texto: string): Promise<void>;
  gerar?: (cfg: BotConfig, system: string, messages: Msg[]) => Promise<RespostaIA>;
}

// O que aconteceu, passo a passo — o simulador mostra isto ao lado da conversa.
export interface Trilha {
  protocolo: string | null;
  status_final: "ia" | "aguardando_humano" | "em_atendimento_humano" | "concluido" | "sem_protocolo";
  eventos: Array<{ tipo: string; detalhe: string }>;
  system: string | null;
  ia: { provedor: string; modelo: string; ms: number; erro: string | null; bruto: string | null } | null;
}

export async function conduzirAtendimento(
  p: PortasAtendimento,
  args: { msgType: string; texto: string | null; canal: CanalInfo },
): Promise<Trilha> {
  const { msgType, texto, canal } = args;
  const t: Trilha = { protocolo: null, status_final: "sem_protocolo", eventos: [], system: null, ia: null };
  const ev = (tipo: string, detalhe: string) => t.eventos.push({ tipo, detalhe });

  const prep = await p.preparar();
  if (!prep) {
    // Sem protocolo não há como registrar autorização: não responde nada
    // automaticamente. A mensagem já está gravada e aparece na Caixa de Entrada.
    ev("sem_protocolo", "Não foi possível preparar o protocolo: nada é respondido automaticamente.");
    return t;
  }
  t.protocolo = prep.protocolo;
  t.status_final = (prep.status as Trilha["status_final"]) ?? "ia";
  const protocolo = prep.protocolo;
  const comIA = canal.ativo && canal.ia_ativa;
  const papel = prep.identificacao?.papel ?? "desconhecido";
  ev("identificacao", `Número identificado como: ${papel}${prep.identificacao?.primeiro_nome ? ` (${prep.identificacao.primeiro_nome})` : ""}.`);

  if (prep.enviar_aviso) {
    const modelo = comIA ? (canal.aviso_abertura || AVISO_ABERTURA_PADRAO) : AVISO_SEM_IA;
    await p.enviar(aplicarProtocolo(modelo, protocolo));
    ev("aviso", "Aviso de abertura enviado (uma vez por protocolo).");
  }

  if (!comIA) { ev("ia_desligada", "I.A desligada no canal: o protocolo fica com a equipe."); return t; }
  if (prep.status !== "ia") { ev("com_humano", "Protocolo está com a equipe: a I.A não responde."); return t; }
  if (!(await p.botAtivo())) { ev("com_humano", "Bot desligado nesta conversa (alguém assumiu): a I.A não responde."); return t; }

  const msgEncaminhado = aplicarProtocolo(canal.msg_encaminhado || MSG_ENCAMINHADO_PADRAO, protocolo);
  const msgNegado = aplicarProtocolo(canal.msg_negado || MSG_NEGADO_PADRAO, protocolo);
  const mensagens = await p.historico();

  const encaminhar = async (motivo: string, resumo: string, aviso: string, assunto: string | null = null, sensivel = false) => {
    await p.encaminhar(motivo, resumo, assunto, sensivel);
    await p.enviar(aviso);
    t.status_final = "aguardando_humano";
    ev("encaminhado", `Foi para a fila humana (${motivo}). Resumo para a equipe: ${resumo}`);
  };

  // 4a) Arquivo, imagem, áudio: pode ser um atestado. Não passa por I.A.
  const ehTexto = msgType === "text" || msgType === "button" || msgType === "interactive";
  if (!ehTexto || !texto) {
    await encaminhar("midia_recebida", resumoDeterministico(mensagens, "A pessoa enviou arquivo/áudio/imagem"),
      aplicarProtocolo(MSG_MIDIA_PADRAO, protocolo), "arquivo", true);
    return t;
  }

  // 4b) Pediu uma pessoa.
  if (pediuHumano(texto)) {
    await encaminhar("pediu_humano", resumoDeterministico(mensagens, "A pessoa pediu atendimento humano"), msgEncaminhado);
    return t;
  }

  // Regras de dado: do banco; sem resposta, o padrão do código (fechado).
  const regrasDb = await p.regras();
  const regras: RegraDado[] = regrasDb && regrasDb.length ? regrasDb : REGRAS_PADRAO;

  const sensiveis = detectarSensiveis(texto, regras);
  if (sensiveis.length) {
    await p.marcar(sensiveis[0], true);
    ev("sensivel", `Assunto sensível detectado: ${sensiveis.join(", ")}. A I.A é avisada de que não há dado pessoal disso.`);
  }

  const base = await p.base();
  ev("base", `${base.length} procedimento(s) da base no contexto da I.A.`);

  // Provedor/modelo: do canal; vazio = o do bot principal (WA_BOT_CONFIG).
  const botCfg = await p.cfgIA();
  const cfg = {
    provedor: canal.provedor || botCfg?.provedor || "groq",
    modelo: canal.modelo || botCfg?.modelo || "",
    max_tokens: canal.max_tokens || 600,
  } as BotConfig;

  const system = montarSystemAtendimento({
    persona: canal.persona,
    base,
    regras,
    identificacao: { papel: papel as never, primeiro_nome: prep.identificacao?.primeiro_nome ?? null },
    sensiveisDetectados: sensiveis,
    protocolo,
  });
  t.system = system;

  const conversa: Msg[] = mensagens
    .filter((m) => m.texto && (m.direcao === "entrada" || m.origem === "bot" || m.origem === "atendente"))
    .map((m) => ({ role: m.direcao === "entrada" ? "user" : "assistant", content: String(m.texto) }));
  if (!conversa.length || conversa[conversa.length - 1].role !== "user") {
    ev("sem_pergunta", "Nada novo da pessoa para responder.");
    return t;
  }

  const r = await (p.gerar ?? gerarResposta)(cfg, system, conversa);
  t.ia = { provedor: r.provedor, modelo: r.modelo, ms: r.ms, erro: r.erro, bruto: r.texto };
  if (r.erro || !r.texto) {
    console.error(`Erro na IA do atendimento (${r.provedor}/${r.modelo}):`, r.erro);
    await encaminhar("falha_ia", resumoDeterministico(mensagens, "A I.A não conseguiu responder"), msgEncaminhado);
    return t;
  }

  const acoes = extrairAcoes(r.texto);

  // 5a) Pedido de dado: quem decide é o banco; o texto sai daqui.
  if (acoes.consulta) {
    const res = await p.consultar(acoes.consulta.categoria, acoes.consulta.alvo);
    ev("consulta", `A I.A pediu "${acoes.consulta.categoria}" de "${acoes.consulta.alvo || "eu"}": ${res?.autorizada ? "AUTORIZADA" : "NEGADA"} (${res?.motivo ?? "erro"}).`);
    if (!res?.autorizada) {
      // MESMA mensagem para qualquer negativa: não confirma se a pessoa existe.
      await encaminhar(`consulta_negada:${res?.motivo ?? "erro"}`,
        resumoDeterministico(mensagens, `Pedido de informação (${acoes.consulta.categoria}) não autorizado automaticamente`),
        msgNegado, acoes.consulta.categoria);
      return t;
    }
    await p.marcar(acoes.consulta.categoria, false);
    await p.enviar(formatarDadosConsulta(acoes.consulta.categoria, res.dados, !!res.proprio));
    return t;
  }

  // Barreira de saída.
  if (pareceDadoSensivel(acoes.texto)) {
    ev("bloqueado", "A resposta da I.A parecia conter CPF/CID e foi bloqueada.");
    await encaminhar("saida_bloqueada", resumoDeterministico(mensagens, "Resposta da I.A bloqueada (parecia conter dado sensível)"),
      msgEncaminhado, null, true);
    return t;
  }

  if (acoes.humano) {
    await encaminhar("ia_encaminhou",
      acoes.humano.resumo || resumoDeterministico(mensagens, "A I.A encaminhou"),
      acoes.texto || msgEncaminhado);
    return t;
  }

  if (acoes.texto) await p.enviar(acoes.texto);
  if (acoes.resolvido) {
    await p.concluir();
    t.status_final = "concluido";
    ev("resolvido", "A pessoa indicou que era só isso: protocolo concluído como resolvido pela I.A.");
  }
  return t;
}

