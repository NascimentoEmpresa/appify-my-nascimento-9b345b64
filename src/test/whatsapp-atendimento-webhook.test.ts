import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { processarAtendimento } from "../../supabase/functions/whatsapp-webhook/atendimento.ts";
import { CANAL_PRINCIPAL, type CanalInfo } from "../../supabase/functions/_shared/whatsapp-canal.ts";

// SIS-2026-0929 — fluxo do canal dos supervisores no webhook, com banco FALSO
// e provedor de I.A FALSO (fetch mockado). Nenhuma chamada real à Meta nem à I.A.

type Rpc = { nome: string; args: any };

function bancoFalso(opts: {
  preparar?: any;
  botAtivo?: boolean;
  historico?: Array<{ direcao: string; origem: string; texto: string }>;
  base?: Array<{ titulo: string; conteudo: string; assunto: string | null }>;
  consulta?: any;
}) {
  const rpcs: Rpc[] = [];
  const tabelas: Record<string, any> = {
    WA_CONVERSA: { bot_ativo: opts.botAtivo ?? true },
    WA_MENSAGEM: (opts.historico ?? []).slice().reverse(), // a função pede desc e inverte
    WA_ATD_REGRA_DADO: null, // força o padrão do código (fechado)
    WA_ATD_BASE: opts.base ?? [],
    WA_BOT_CONFIG: { provedor: "groq", modelo: "modelo-teste", max_tokens: 500 },
  };
  const consulta = (tabela: string) => {
    const dado = tabelas[tabela];
    const q: any = {
      select: () => q, eq: () => q, order: () => q, limit: () => q, is: () => q, neq: () => q,
      maybeSingle: async () => ({ data: Array.isArray(dado) ? dado[0] ?? null : dado, error: null }),
      then: (ok: any, err: any) => Promise.resolve({ data: dado, error: null }).then(ok, err),
    };
    return q;
  };
  const admin = {
    from: (t: string) => consulta(t),
    rpc: async (nome: string, args: any) => {
      rpcs.push({ nome, args });
      if (nome === "wa_atd_preparar") return { data: opts.preparar ?? null, error: null };
      if (nome === "wa_atd_consultar") return { data: opts.consulta ?? { autorizada: false, motivo: "alvo_nao_encontrado" }, error: null };
      return { data: null, error: null };
    },
  };
  return { admin, rpcs };
}

const PREP = (over: any = {}) => ({
  atendimento_id: "atd-1", protocolo: "ATD-2026-000042", status: "ia", enviar_aviso: false,
  identificacao: { papel: "colaborador", primeiro_nome: "ANA" }, ...over,
});
const CANAL: CanalInfo = { ...CANAL_PRINCIPAL, codigo: "supervisores", finalidade: "atendimento_supervisores", ativo: true, ia_ativa: true, phone_number_id: "999" };
const HIST = [{ direcao: "entrada", origem: "contato", texto: "qual minha escala?" }];

// Provedor de I.A falso: devolve `resposta` e guarda o que recebeu.
let pedidosIA: any[] = [];
function iaResponde(resposta: string) {
  pedidosIA = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
    pedidosIA.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: resposta } }] }), { status: 200 });
  }));
}

beforeEach(() => { vi.stubGlobal("Deno", { env: { get: () => "chave-falsa" } }); });
afterEach(() => { vi.unstubAllGlobals(); });

async function rodar(b: ReturnType<typeof bancoFalso>, texto: string | null, msgType = "text", canal = CANAL) {
  const enviadas: string[] = [];
  await processarAtendimento({ admin: b.admin, enviar: async (t) => { enviadas.push(t); } },
    { conversaId: "conv-1", waId: "551188880001", msgType, texto, canal });
  return enviadas;
}

describe("webhook — canal dos supervisores", () => {
  it("manda o aviso de abertura (I.A + LGPD + protocolo) uma vez", async () => {
    iaResponde("Oi! Como posso ajudar?");
    const b = bancoFalso({ preparar: PREP({ enviar_aviso: true }), historico: HIST });
    const env = await rodar(b, "oi");
    expect(env[0]).toContain("inteligência artificial");
    expect(env[0]).toContain("ATD-2026-000042");
  });

  it("com a I.A desligada: só protocolo e aviso, sem chamar a I.A", async () => {
    iaResponde("não deveria");
    const b = bancoFalso({ preparar: PREP({ enviar_aviso: true, status: "aguardando_humano" }), historico: HIST });
    const env = await rodar(b, "oi", "text", { ...CANAL, ia_ativa: false });
    expect(env).toHaveLength(1);
    expect(env[0]).toContain("uma pessoa da equipe vai te responder");
    expect(pedidosIA).toHaveLength(0);
  });

  it("protocolo com humano: a I.A fica quieta", async () => {
    iaResponde("não deveria");
    const b = bancoFalso({ preparar: PREP({ status: "em_atendimento_humano" }), historico: HIST });
    expect(await rodar(b, "oi")).toEqual([]);
    expect(pedidosIA).toHaveLength(0);
  });

  it("bot desligado na conversa (alguém assumiu na Caixa de Entrada): quieta", async () => {
    iaResponde("não deveria");
    const b = bancoFalso({ preparar: PREP(), botAtivo: false, historico: HIST });
    expect(await rodar(b, "oi")).toEqual([]);
  });

  it("arquivo/foto vai para humano sem passar pela I.A", async () => {
    iaResponde("não deveria");
    const b = bancoFalso({ preparar: PREP(), historico: [{ direcao: "entrada", origem: "contato", texto: "[image]" }] });
    const env = await rodar(b, null, "image");
    expect(pedidosIA).toHaveLength(0);
    expect(b.rpcs.find((r) => r.nome === "wa_atd_bot_encaminhar")?.args.p_motivo).toBe("midia_recebida");
    expect(env[0]).toContain("arquivo");
  });

  it("pedido de atendente vai para humano sem passar pela I.A", async () => {
    iaResponde("não deveria");
    const b = bancoFalso({ preparar: PREP(), historico: [{ direcao: "entrada", origem: "contato", texto: "quero falar com um atendente" }] });
    await rodar(b, "quero falar com um atendente");
    expect(pedidosIA).toHaveLength(0);
    expect(b.rpcs.find((r) => r.nome === "wa_atd_bot_encaminhar")?.args.p_motivo).toBe("pediu_humano");
  });

  it("a I.A recebe base aprovada e papel, mas nenhum dado pessoal", async () => {
    iaResponde("Entregue ao encarregado em até 48h. [[RESOLVIDO]]");
    const b = bancoFalso({ preparar: PREP(), historico: HIST, base: [{ titulo: "Atestado", conteudo: "Entregue ao encarregado em até 48h.", assunto: "saude" }] });
    const env = await rodar(b, "onde entrego atestado?");
    const system = pedidosIA[0].messages[0].content as string;
    expect(system).toContain("Entregue ao encarregado em até 48h.");
    expect(system).toContain("primeiro nome: ANA");
    expect(system).not.toContain("551188880001");
    expect(env).toEqual(["Entregue ao encarregado em até 48h."]);
    expect(b.rpcs.some((r) => r.nome === "wa_atd_bot_concluir")).toBe(true);
    expect(b.rpcs.find((r) => r.nome === "wa_atd_bot_marcar")?.args.p_assunto).toBe("saude");
  });

  it("consulta autorizada: a resposta com o dado é montada pelo código", async () => {
    iaResponde("Vou verificar. [[CONSULTAR:escala|eu]]");
    const b = bancoFalso({ preparar: PREP(), historico: HIST, consulta: { autorizada: true, motivo: "proprio", proprio: true, dados: { primeiro_nome: "ANA", escala: "12x36" } } });
    const env = await rodar(b, "qual minha escala?");
    expect(b.rpcs.find((r) => r.nome === "wa_atd_consultar")?.args).toMatchObject({ p_categoria: "escala", p_alvo: "eu", p_wa_id: "551188880001" });
    expect(env).toEqual(["No seu cadastro, a escala registrada é: 12x36."]);
  });

  it("consulta negada: frase neutra (não confirma nada) e fila humana com o motivo", async () => {
    iaResponde("[[CONSULTAR:cadastro_basico|Fulano de Tal]]");
    const b = bancoFalso({ preparar: PREP(), historico: HIST, consulta: { autorizada: false, motivo: "alvo_nao_encontrado" } });
    const env = await rodar(b, "em que contrato o Fulano trabalha?");
    expect(env[0]).toContain("Não consigo passar essa informação por aqui");
    expect(env[0]).not.toContain("Fulano");
    expect(b.rpcs.find((r) => r.nome === "wa_atd_bot_encaminhar")?.args.p_motivo).toBe("consulta_negada:alvo_nao_encontrado");
  });

  it("saída com cara de dado sensível é bloqueada", async () => {
    iaResponde("O CPF dela é 123.456.789-00");
    const b = bancoFalso({ preparar: PREP(), historico: HIST });
    const env = await rodar(b, "me passa o cpf da colega");
    expect(env.join(" ")).not.toContain("123.456.789-00");
    expect(b.rpcs.find((r) => r.nome === "wa_atd_bot_encaminhar")?.args.p_motivo).toBe("saida_bloqueada");
  });

  it("I.A encaminha com resumo", async () => {
    iaResponde("Vou passar para a equipe.\n[[HUMANO:quer trocar de escala na semana que vem]]");
    const b = bancoFalso({ preparar: PREP(), historico: HIST });
    const env = await rodar(b, "quero trocar minha escala");
    expect(env).toEqual(["Vou passar para a equipe."]);
    expect(b.rpcs.find((r) => r.nome === "wa_atd_bot_encaminhar")?.args).toMatchObject({ p_motivo: "ia_encaminhou", p_resumo: "quer trocar de escala na semana que vem" });
  });

  it("erro do provedor: passa para humano em vez de improvisar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "limite" } }), { status: 429 })));
    const b = bancoFalso({ preparar: PREP(), historico: HIST });
    const env = await rodar(b, "oi");
    expect(b.rpcs.find((r) => r.nome === "wa_atd_bot_encaminhar")?.args.p_motivo).toBe("falha_ia");
    expect(env[0]).toContain("Passei seu atendimento");
  });

  it("devolve a trilha do que aconteceu (é o que o simulador mostra)", async () => {
    iaResponde("[[CONSULTAR:cadastro_basico|Fulano de Tal]]");
    const b = bancoFalso({ preparar: PREP({ enviar_aviso: true }), historico: HIST, consulta: { autorizada: false, motivo: "alvo_nao_encontrado" } });
    const t = await processarAtendimento({ admin: b.admin, enviar: async () => {} },
      { conversaId: "conv-1", waId: "551188880001", msgType: "text", texto: "em que contrato o Fulano trabalha?", canal: CANAL });
    expect(t.protocolo).toBe("ATD-2026-000042");
    expect(t.status_final).toBe("aguardando_humano");
    expect(t.eventos.map((e) => e.tipo)).toEqual(expect.arrayContaining(["identificacao", "aviso", "base", "consulta", "encaminhado"]));
    expect(t.system).toContain("ATD-2026-000042");
    expect(t.ia?.bruto).toContain("[[CONSULTAR:");
  });

  it("resolvido: trilha termina em concluído", async () => {
    iaResponde("Por nada! [[RESOLVIDO]]");
    const b = bancoFalso({ preparar: PREP(), historico: HIST });
    const t = await processarAtendimento({ admin: b.admin, enviar: async () => {} },
      { conversaId: "conv-1", waId: "551188880001", msgType: "text", texto: "era só isso", canal: CANAL });
    expect(t.status_final).toBe("concluido");
  });

  it("sem protocolo (falha ao preparar): não responde nada", async () => {
    iaResponde("não deveria");
    const b = bancoFalso({ preparar: null, historico: HIST });
    expect(await rodar(b, "oi")).toEqual([]);
  });
});
