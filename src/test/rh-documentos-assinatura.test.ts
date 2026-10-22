import { describe, expect, it } from "vitest";
import {
  TIPOS_NOVO_DOCUMENTO, TIPO_DOCUMENTO, ehImagem, errosSolicitacao, pedeAssinatura, podeAssinar, problemaAssinaturaPessoal,
  rotuloSituacao, termosCienciaPendentes, type FormSolicitacao, type SolicitacaoDocumento,
} from "@/lib/rh/documentosSolicitados";

// RH › Documentos — tipo, assinatura e termo de ciência (mig 20261022000500).

const EU = "u-eu";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

const form = (p: Partial<FormSolicitacao> = {}): FormSolicitacao => ({
  tipo: "assinatura", titulo: "Termo de EPI", descricao: "Assinar", modo: "usuario", contrato: "", destinatario_id: EU, prazo: "", ...p,
});

type Linha = Pick<SolicitacaoDocumento, "id" | "tipo" | "status" | "destinatario_id" | "created_at">;
const linha = (p: Partial<Linha>): Linha => ({ id: 1, tipo: "ciencia", status: "pendente", destinatario_id: EU, created_at: "2026-10-22T10:00:00Z", ...p });

describe("tipo obrigatório na criação", () => {
  it("sem tipo não passa", () => {
    expect(errosSolicitacao(form({ tipo: "" }))).toEqual(["Escolha o tipo: Registro, Assinatura ou Termo de ciência."]);
  });
  it("registro exige arquivo ou imagem; os outros não", () => {
    expect(errosSolicitacao(form({ tipo: "registro" }), 0)).toEqual(["Registro guarda um documento: anexe o arquivo ou a imagem."]);
    expect(errosSolicitacao(form({ tipo: "registro" }), 1)).toEqual([]);
    expect(errosSolicitacao(form({ tipo: "assinatura" }), 0)).toEqual([]);
    expect(errosSolicitacao(form({ tipo: "ciencia" }), 0)).toEqual([]);
  });
  it("oferece só os três tipos novos, cada um com explicação", () => {
    expect(TIPOS_NOVO_DOCUMENTO).toEqual(["registro", "assinatura", "ciencia"]);
    for (const t of TIPOS_NOVO_DOCUMENTO) expect(TIPO_DOCUMENTO[t].explicacao.length).toBeGreaterThan(20);
  });
});

describe("quem assina", () => {
  it("assinatura e ciência pedem assinatura; registro e o fluxo antigo não", () => {
    expect(pedeAssinatura({ tipo: "assinatura" })).toBe(true);
    expect(pedeAssinatura({ tipo: "ciencia" })).toBe(true);
    expect(pedeAssinatura({ tipo: "registro" })).toBe(false);
    expect(pedeAssinatura({ tipo: "anexo" })).toBe(false);
  });
  it("só o destinatário, só pendente", () => {
    expect(podeAssinar(linha({ tipo: "assinatura" }), EU)).toBe(true);
    expect(podeAssinar(linha({ tipo: "assinatura" }), "outro")).toBe(false);
    expect(podeAssinar(linha({ tipo: "assinatura", status: "concluida" }), EU)).toBe(false);
    expect(podeAssinar(linha({ tipo: "registro" }), EU)).toBe(false);
    expect(podeAssinar(linha({}), null)).toBe(false);
  });
});

describe("termo de ciência no login", () => {
  it("só os termos pendentes da própria pessoa, mais antigos primeiro", () => {
    const lista = [
      linha({ id: 3, created_at: "2026-10-22T12:00:00Z" }),
      linha({ id: 1, created_at: "2026-10-20T08:00:00Z" }),
      linha({ id: 4, status: "concluida" }),
      linha({ id: 5, tipo: "assinatura" }),
      linha({ id: 6, destinatario_id: "outro" }),
    ];
    expect(termosCienciaPendentes(lista, EU).map((s) => s.id)).toEqual([1, 3]);
  });
  it("'Assinar depois' tira da fila só nesta sessão", () => {
    const lista = [linha({ id: 1 }), linha({ id: 2, created_at: "2026-10-23T00:00:00Z" })];
    expect(termosCienciaPendentes(lista, EU, [1]).map((s) => s.id)).toEqual([2]);
    expect(termosCienciaPendentes(lista, EU, [1, 2])).toEqual([]);
  });
  it("sem usuário logado, nada", () => expect(termosCienciaPendentes([linha({})], undefined)).toEqual([]));
});

describe("situação mostrada", () => {
  const base = { destinatario_nome: "MARIA SOUZA", contrato_nome: null };
  it("assinatura pendente aguarda a pessoa; concluída vira Assinado", () => {
    expect(rotuloSituacao({ ...base, tipo: "ciencia", status: "pendente" })).toBe("Aguardando assinatura (Maria Souza)");
    expect(rotuloSituacao({ ...base, tipo: "assinatura", status: "concluida" })).toBe("Assinado");
  });
  it("registro concluído é Registrado; o fluxo antigo segue igual", () => {
    expect(rotuloSituacao({ ...base, tipo: "registro", status: "concluida" })).toBe("Registrado");
    expect(rotuloSituacao({ ...base, tipo: "anexo", status: "pendente" })).toBe("Pendente (Maria Souza)");
    expect(rotuloSituacao({ ...base, tipo: "anexo", status: "concluida" })).toBe("Concluída");
  });
});

describe("assinatura (mesma regra do banco)", () => {
  it("desenho precisa ser PNG e caber no limite", () => {
    expect(problemaAssinaturaPessoal({ tipo: "desenho", imagem: PNG })).toBeNull();
    expect(problemaAssinaturaPessoal({ tipo: "desenho", imagem: null })).toBe("Desenhe a assinatura no quadro.");
    expect(problemaAssinaturaPessoal({ tipo: "desenho", imagem: "data:image/jpeg;base64,xx" })).toBe("Desenhe a assinatura no quadro.");
    expect(problemaAssinaturaPessoal({ tipo: "desenho", imagem: PNG + "A".repeat(400_000) }))
      .toBe("A assinatura ficou grande demais — limpe e desenhe de novo.");
  });
  it("texto (a de Treinamentos) precisa de texto, fonte e tamanho válido", () => {
    expect(problemaAssinaturaPessoal({ tipo: "texto", texto: "Maria", fonte: "Great Vibes", tamanho: 1 })).toBeNull();
    expect(problemaAssinaturaPessoal({ tipo: "texto", texto: "M", fonte: "Great Vibes" })).toBe("Escreva a assinatura.");
    expect(problemaAssinaturaPessoal({ tipo: "texto", texto: "Maria", fonte: null })).toBe("Escolha a letra da assinatura.");
    expect(problemaAssinaturaPessoal({ tipo: "texto", texto: "Maria", fonte: "Allura", tamanho: 2 })).toBe("Tamanho da letra fora do permitido.");
  });
  it("sem nada não assina", () => expect(problemaAssinaturaPessoal(null)).toBe("Desenhe a assinatura no quadro."));
});

describe("imagens anexadas", () => {
  it("reconhece pelo tipo e, sem tipo, pela extensão", () => {
    expect(ehImagem({ mime_type: "image/jpeg" })).toBe(true);
    expect(ehImagem({ mime_type: "application/pdf", nome_arquivo: "foto.jpg" })).toBe(false);
    expect(ehImagem({ mime_type: null, nome_arquivo: "Foto.PNG" })).toBe(true);
    expect(ehImagem({ mime_type: null, nome_arquivo: "termo.pdf" })).toBe(false);
  });
});
