import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { executarNoGithub } = require("../src/nfse/github-actions.js");
const { processarFilaNfse } = require("../src/nfse/index.js");
let pasta: string;

beforeEach(() => { pasta = mkdtempSync(join(tmpdir(), "nfse-actions-teste-")); });
afterEach(() => { vi.restoreAllMocks(); rmdirSync(pasta); });

function ambiente() {
  return {
    GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "NascimentoEmpresa/appify-my-nascimento-9b345b64", RUNNER_TEMP: pasta,
    NFSE_SUPABASE_URL: "https://banco.exemplo.invalid", NFSE_SUPABASE_SERVICE_ROLE_KEY: "chave-sintetica",
    NFSE_CERTIFICADO_PFX_B64: Buffer.from("certificado-sintetico").toString("base64"), NFSE_CERTIFICADO_SENHA: "senha-sintetica",
    NFSE_CONFIG_JSON: JSON.stringify({ empresas: [{ cnpj: "11222333000181", serie: 123,
      homologacao_confirmada: true, serie_confirmada: true, algoritmo_assinatura: "sha1",
      url: "https://reformatributaria.cidade360.cloud/NFSe.Api.Teste" }] }),
    NFSE_ACTIONS_CONTINUO: "1", NFSE_ACTIONS_DURACAO_MIN: "7",
  };
}

function dependencias(processar: ReturnType<typeof vi.fn>) {
  let agora = 0;
  return {
    carregarConfiguracao: vi.fn(), criarCliente: vi.fn(() => ({})), processarFilaNfse: processar,
    agora: () => agora, aguardar: vi.fn(async (ms: number) => { agora += ms; }),
  };
}

describe("NFS-e: recuperação do processador automático", () => {
  it("continua após mais de três falhas de infraestrutura e volta a processar quando o banco recupera", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let chamadas = 0;
    const processar = vi.fn(async () => { if (++chamadas <= 4) throw new Error("segredo-interno-que-nao-pode-sair"); });
    const deps = dependencias(processar);
    await executarNoGithub(ambiente(), deps);
    expect(processar).toHaveBeenCalledTimes(7);
    expect(deps.aguardar.mock.calls.every(([ms]) => ms >= 60_000)).toBe(true);
    expect(aviso).toHaveBeenCalledTimes(4);
    expect(log.mock.calls.flat().join(" ")).toMatch(/restabelecido.*4/);
    expect([...aviso.mock.calls, ...log.mock.calls].flat().join(" ")).not.toContain("segredo-interno");
    expect(readdirSync(pasta)).toEqual([]);
  });

  it("mantém as tentativas até o prazo e termina com falha se a infraestrutura continuar indisponível", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const processar = vi.fn(async () => { throw new Error("indisponivel"); });
    await expect(executarNoGithub({ ...ambiente(), NFSE_ACTIONS_DURACAO_MIN: "5" }, dependencias(processar)))
      .rejects.toThrow(/prazo.*infraestrutura/i);
    expect(processar).toHaveBeenCalledTimes(5);
    expect(readdirSync(pasta)).toEqual([]);
  });

  it("preserva diagnóstico seguro da RPC sem expor mensagem, URL ou detalhes retornados pelo banco", async () => {
    const banco = { rpc: vi.fn(async () => ({ data: null, status: 503,
      error: { code: "PGRST002", message: "senha-na-mensagem", details: "https://privado.invalid/segredo" } })) };
    const erro = await processarFilaNfse(banco, { NFSE_HABILITADO: "1" }).catch((e: unknown) => e);
    expect(erro).toMatchObject({ codigo: "FALHA_BANCO", diagnostico: {
      operacao: "nfse_reservar_trabalho", http: 503, codigoBanco: "PGRST002",
    } });
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const processar = vi.fn().mockRejectedValueOnce(erro).mockResolvedValue(undefined);
    await executarNoGithub({ ...ambiente(), NFSE_ACTIONS_DURACAO_MIN: "2" }, dependencias(processar));
    const mensagem = aviso.mock.calls.flat().join(" ");
    expect(mensagem).toContain("FALHA_BANCO"); expect(mensagem).toContain("PGRST002"); expect(mensagem).toContain("503");
    expect(mensagem).not.toMatch(/senha-na-mensagem|privado.invalid|segredo/);
  });
});
