import { describe, it, expect } from "vitest";
import {
  chaveTelefone, mascararTelefone, identificarSolicitante, decidirConsulta, ehAlvoProprio,
  detectarSensiveis, extrairAcoes, pediuHumano, pareceDadoSensivel, formatarDadosConsulta,
  resumoDeterministico, montarSystemAtendimento, aplicarProtocolo, REGRAS_PADRAO,
  AVISO_ABERTURA_PADRAO, type EmpregadoCadastro, type VinculoContrato, type Identificacao,
} from "../../supabase/functions/_shared/whatsapp-atendimento.ts";

// SIS-2026-0929 — autorização por número no canal dos supervisores.
// Pessoas e números FICTÍCIOS. Espelho de wa_atd_identificar / wa_atd_consultar
// (a migration 20261118130000 foi provada com os mesmos cenários em PGlite).

const ALFA = "contrato-alfa";
const BETA = "contrato-beta";

const EMP: EmpregadoCadastro[] = [
  { id: 1, nome: "ANA TESTE", telefone: "(11) 98888-0001", ativo: true, contrato_id: ALFA },
  { id: 2, nome: "BRUNO TESTE", telefone: "11 97777-0002", ativo: true, contrato_id: ALFA },
  { id: 3, nome: "CARLA TESTE", telefone: "11966660003", ativo: true, contrato_id: BETA },
  { id: 4, nome: "DIEGO TESTE", telefone: "11955550004", ativo: true, contrato_id: null },
  { id: 5, nome: "EVA TESTE", telefone: "11944440005", ativo: true, contrato_id: ALFA },
  { id: 6, nome: "FABIO TESTE", telefone: "11 94444-0005", ativo: true, contrato_id: ALFA }, // mesmo número da EVA
  { id: 7, nome: "GUSTAVO TESTE", telefone: "11933330007", ativo: false, contrato_id: ALFA }, // demitido
];
const ORG: VinculoContrato[] = [
  { contrato_id: ALFA, encarregado_id: 2, supervisor_id: 4 },
  { contrato_id: BETA, encarregado_id: null, supervisor_id: 4 },
];
const id = (wa: string) => identificarSolicitante(wa, EMP, ORG);
const alvo = (empregado_id: number) => {
  const e = EMP.find((x) => x.id === empregado_id)!;
  return { empregado_id, contrato_id: e.contrato_id, ativo: e.ativo };
};

describe("telefone", () => {
  it("casa a forma legada da Meta (sem o 9) com o cadastro (com o 9)", () => {
    expect(chaveTelefone("551188880001")).toBe("1188880001");
    expect(chaveTelefone("5511988880001")).toBe("1188880001");
    expect(chaveTelefone("(11) 98888-0001")).toBe("1188880001");
  });
  it("10/11 dígitos começando com 55 é o DDD de Santa Maria, não o país", () => {
    expect(chaveTelefone("5598880001")).toBe("5598880001");
    expect(chaveTelefone("55998880001")).toBe("5598880001");
  });
  it("número curto não identifica ninguém", () => {
    expect(chaveTelefone("12345")).toBeNull();
    expect(chaveTelefone(null)).toBeNull();
  });
  it("máscara não expõe o número inteiro", () => {
    expect(mascararTelefone("5511988880001")).toBe("5511*****01");
  });
});

describe("identificação de quem escreve", () => {
  it("colaborador pelo número cadastrado", () => {
    const i = id("551188880001");
    expect(i.papel).toBe("colaborador");
    expect(i.empregado_id).toBe(1);
    expect(i.primeiro_nome).toBe("ANA");
    expect(i.contrato_id).toBe(ALFA);
  });
  it("encarregado pelo Organograma Operacional", () => {
    const i = id("5511977770002");
    expect(i.papel).toBe("encarregado");
    expect(i.contratos_encarregado).toEqual([ALFA]);
  });
  it("supervisor pelo Organograma Operacional", () => {
    const i = id("5511955550004");
    expect(i.papel).toBe("supervisor");
    expect(i.contratos_supervisor).toEqual([ALFA, BETA]);
  });
  it("número desconhecido", () => {
    expect(id("5511900000000").papel).toBe("desconhecido");
  });
  it("número em dois cadastros ativos é divergência — não escolhe um", () => {
    const i = id("5511944440005");
    expect(i.papel).toBe("divergente");
    expect(i.empregado_id).toBeNull();
  });
  it("demitido com o número antigo não é ninguém", () => {
    expect(id("5511933330007").papel).toBe("desconhecido");
  });
});

describe("decisão de consulta", () => {
  const dec = (sol: Identificacao, categoria: string, alvos: number[], proprio = false) =>
    decidirConsulta({ solicitante: sol, categoria, regras: REGRAS_PADRAO, alvoProprio: proprio, alvos: alvos.map(alvo) });

  it("colaborador consulta o próprio dado não sensível", () => {
    expect(dec(id("551188880001"), "escala", [], true)).toEqual({ autorizada: true, motivo: "proprio" });
  });
  it("colaborador NÃO consulta outra pessoa", () => {
    expect(dec(id("551188880001"), "escala", [2])).toEqual({ autorizada: false, motivo: "alvo_nao_encontrado" });
  });
  it("encarregado consulta subordinado do contrato dele", () => {
    expect(dec(id("5511977770002"), "cadastro_basico", [1])).toEqual({ autorizada: true, motivo: "subordinado" });
  });
  it("encarregado NÃO consulta colaborador de outro contrato", () => {
    expect(dec(id("5511977770002"), "escala", [3]).autorizada).toBe(false);
  });
  it("supervisor não recebe por padrão (chamado: só o próprio ou o encarregado)", () => {
    expect(dec(id("5511955550004"), "escala", [1])).toEqual({ autorizada: false, motivo: "funcao_nao_permite" });
  });
  it("supervisor recebe se a regra da categoria liberar", () => {
    const regras = REGRAS_PADRAO.map((r) => (r.categoria === "escala" ? { ...r, supervisor: true } : r));
    expect(decidirConsulta({ solicitante: id("5511955550004"), categoria: "escala", regras, alvoProprio: false, alvos: [alvo(1)] }))
      .toEqual({ autorizada: true, motivo: "supervisionado" });
  });
  it.each(["remuneracao", "saude", "disciplinar", "bancario", "documentos", "endereco_contato", "rescisao", "denuncia"])(
    "categoria sensível %s nunca sai — nem do próprio, nem para o encarregado", (cat) => {
      expect(dec(id("551188880001"), cat, [], true)).toEqual({ autorizada: false, motivo: "categoria_sensivel" });
      expect(dec(id("5511977770002"), cat, [1])).toEqual({ autorizada: false, motivo: "categoria_sensivel" });
    });
  it("número desconhecido: negado antes de olhar qualquer coisa", () => {
    expect(dec(id("5511900000000"), "escala", [], true)).toEqual({ autorizada: false, motivo: "numero_nao_cadastrado" });
  });
  it("divergência cadastral: negado", () => {
    expect(dec(id("5511944440005"), "escala", [], true)).toEqual({ autorizada: false, motivo: "cadastro_divergente" });
  });
  it("categoria inventada pela I.A: negado", () => {
    expect(dec(id("551188880001"), "senha_do_portal", [], true).motivo).toBe("categoria_desconhecida");
  });
  it("mais de uma pessoa casou com o termo: não chuta", () => {
    expect(dec(id("5511977770002"), "escala", [1, 5]).motivo).toBe("alvo_ambiguo");
  });
  it("alvo demitido não conta", () => {
    expect(dec(id("5511977770002"), "escala", [7]).motivo).toBe("alvo_nao_encontrado");
  });
  it("sem regras carregadas, nada é liberado (falha fechada)", () => {
    expect(decidirConsulta({ solicitante: id("551188880001"), categoria: "escala", regras: [], alvoProprio: true, alvos: [] }).autorizada).toBe(false);
  });
  it("reconhece pedido do próprio dado", () => {
    expect(ehAlvoProprio("eu")).toBe(true);
    expect(ehAlvoProprio("Minha")).toBe(true);
    expect(ehAlvoProprio("")).toBe(true);
    expect(ehAlvoProprio("Ana")).toBe(false);
  });
});

describe("assuntos sensíveis e pedido de pessoa", () => {
  it("detecta categoria sensível por palavra inteira", () => {
    expect(detectarSensiveis("Quanto vou receber de salário?", REGRAS_PADRAO)).toEqual(["remuneracao"]);
    expect(detectarSensiveis("onde entrego o ATESTADO", REGRAS_PADRAO)).toEqual(["saude"]);
    expect(detectarSensiveis("qual o meu cargo?", REGRAS_PADRAO)).toEqual([]); // "rg" dentro de "cargo" não conta
  });
  it("pedido de atendente é determinístico", () => {
    expect(pediuHumano("quero falar com um atendente")).toBe(true);
    expect(pediuHumano("Falar com o supervisor, por favor")).toBe(true);
    expect(pediuHumano("0")).toBe(true);
    expect(pediuHumano("qual minha escala?")).toBe(false);
    expect(pediuHumano("você é um robô?")).toBe(false); // a I.A responde que é uma I.A
  });
  it("barreira de saída pega CPF e CID", () => {
    expect(pareceDadoSensivel("O CPF dela é 123.456.789-00")).toBe(true);
    expect(pareceDadoSensivel("atestado com CID F32.1")).toBe(true);
    expect(pareceDadoSensivel("Sua escala é 12x36, das 7h às 19h.")).toBe(false);
  });
});

describe("marcas da I.A", () => {
  it("extrai consulta e limpa o texto", () => {
    const a = extrairAcoes("Vou verificar.\n[[CONSULTAR:escala|eu]]");
    expect(a.consulta).toEqual({ categoria: "escala", alvo: "eu" });
    expect(a.texto).toBe("Vou verificar.");
  });
  it("extrai pedido de humano com resumo", () => {
    const a = extrairAcoes("Vou passar para a equipe. [[ HUMANO : quer trocar de escala ]]");
    expect(a.humano).toEqual({ resumo: "quer trocar de escala" });
    expect(a.texto).toBe("Vou passar para a equipe.");
  });
  it("resolvido e marca inventada nunca chegam à pessoa", () => {
    const a = extrairAcoes("Por nada! [[RESOLVIDO]] [[TRANSFERIR:rh]]");
    expect(a.resolvido).toBe(true);
    expect(a.texto).toBe("Por nada!");
  });
  it("texto sem marcas passa intacto", () => {
    expect(extrairAcoes("Olá").texto).toBe("Olá");
  });
});

describe("resposta com o dado autorizado é montada pelo código", () => {
  it("só os campos da categoria", () => {
    expect(formatarDadosConsulta("escala", { primeiro_nome: "ANA", escala: "12x36" }, true))
      .toBe("No seu cadastro, a escala registrada é: 12x36.");
    expect(formatarDadosConsulta("cadastro_basico", { primeiro_nome: "ANA", cargo: "AUX", contrato: "ALFA", posto: null }, false))
      .toBe("No cadastro de ANA: cargo AUX, contrato ALFA, posto não informado no cadastro.");
  });
  it("categoria sem formato conhecido não monta resposta com dado", () => {
    expect(formatarDadosConsulta("remuneracao", { valor: "1000" }, true)).not.toContain("1000");
  });
});

describe("prompt e textos", () => {
  it("prompt não tem dado pessoal: só papel e primeiro nome, e lista as sensíveis", () => {
    const s = montarSystemAtendimento({
      base: [{ titulo: "Atestado", conteudo: "Entregue ao encarregado em 48h.", assunto: "saude" }],
      regras: REGRAS_PADRAO, identificacao: { papel: "colaborador", primeiro_nome: "ANA" },
      sensiveisDetectados: ["saude"], protocolo: "ATD-2026-000001",
    });
    expect(s).toContain("ATD-2026-000001");
    expect(s).toContain("primeiro nome: ANA");
    expect(s).toContain("Salário, holerite e pagamentos");
    expect(s).toContain("Entregue ao encarregado em 48h.");
    expect(s).toContain("[[CONSULTAR:");
  });
  it("sem base aprovada, a I.A é instruída a encaminhar", () => {
    const s = montarSystemAtendimento({ base: [], regras: REGRAS_PADRAO, identificacao: { papel: "desconhecido", primeiro_nome: null }, sensiveisDetectados: [], protocolo: "P" });
    expect(s).toContain("nenhum cadastrado ainda");
    expect(s).toContain("NÃO identificada");
  });
  it("aviso de abertura fala em I.A, LGPD e protocolo", () => {
    const t = aplicarProtocolo(AVISO_ABERTURA_PADRAO, "ATD-2026-000123");
    expect(t).toContain("inteligência artificial");
    expect(t).toContain("LGPD");
    expect(t).toContain("ATD-2026-000123");
  });
  it("resumo determinístico junta as últimas falas da pessoa", () => {
    const r = resumoDeterministico([
      { direcao: "entrada", texto: "oi" }, { direcao: "saida", texto: "olá" },
      { direcao: "entrada", texto: "quero trocar de posto" }, { direcao: "entrada", texto: "[image]" },
    ], "Pediu humano");
    expect(r).toBe('Pediu humano. Últimas mensagens: "oi" / "quero trocar de posto"');
  });
});
