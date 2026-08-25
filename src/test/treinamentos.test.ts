import { describe, it, expect } from "vitest";
import {
  embedDeVideo, corrigirProva, temConteudo, recursosDe, validarProva, caminhoNoBucket,
  validarTamanho, LIMITE_UPLOAD_BYTES,
  type PerguntaProva,
} from "@/pages/treinamentos/treinamento/core";

const q = (id: string, correta: number): PerguntaProva => ({
  id, enunciado: `Pergunta ${id}`, opcoes: ["a", "b", "c"], correta,
});

describe("embedDeVideo", () => {
  it("reconhece as formas de link do YouTube", () => {
    const esperado = "https://www.youtube.com/embed/dQw4w9WgXcQ";
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ",
    ]) {
      expect(embedDeVideo(url)).toEqual({ tipo: "youtube", src: esperado });
    }
  });

  it("reconhece Vimeo", () => {
    expect(embedDeVideo("https://vimeo.com/76979871"))
      .toEqual({ tipo: "vimeo", src: "https://player.vimeo.com/video/76979871" });
  });

  it("trata arquivo de vídeo como <video>, não iframe", () => {
    // O erro que isso previne é o quadrado preto: mp4 dentro de iframe não toca.
    expect(embedDeVideo("https://x.com/aula.mp4").tipo).toBe("arquivo");
    expect(embedDeVideo("https://x.com/aula.MP4?token=1").tipo).toBe("arquivo");
  });

  it("não inventa player para link qualquer", () => {
    expect(embedDeVideo("https://intranet/aula").tipo).toBe("desconhecido");
    expect(embedDeVideo("").tipo).toBe("desconhecido");
  });
});

describe("temConteudo", () => {
  it("recusa card só com título e descrição", () => {
    expect(temConteudo({ titulo: "Segurança", descricao: "muito importante" })).toBe(false);
  });

  it("aceita com qualquer uma das três peças", () => {
    expect(temConteudo({ video_url: "https://youtu.be/dQw4w9WgXcQ" })).toBe(true);
    expect(temConteudo({ video_path: "id/video-1.mp4" })).toBe(true);
    expect(temConteudo({ anexo_path: "id/anexo-1.pdf" })).toBe(true);
    expect(temConteudo({ prova: [q("1", 0)] })).toBe(true);
  });

  it("ignora string em branco e prova vazia", () => {
    expect(temConteudo({ video_url: "   ", anexo_path: "", prova: [] })).toBe(false);
  });
});

describe("recursosDe", () => {
  it("conta as questões da prova para o selo", () => {
    const r = recursosDe({ prova: [q("1", 0), q("2", 1)], anexo_path: "x.pdf" });
    expect(r).toEqual({ video: false, anexo: true, prova: true, questoes: 2 });
  });
});

describe("corrigirProva", () => {
  const prova = [q("1", 0), q("2", 1), q("3", 2)];

  it("calcula nota em percentual inteiro", () => {
    const r = corrigirProva(prova, { "1": 0, "2": 1, "3": 0 });
    expect(r.acertos).toBe(2);
    expect(r.total).toBe(3);
    expect(r.nota).toBe(67);            // 66,66… arredondado
    expect(r.porQuestao).toEqual([true, true, false]);
  });

  it("conta questão não respondida como erro", () => {
    // Sem isso dava para pular tudo e passar com 100%.
    const r = corrigirProva(prova, {});
    expect(r.acertos).toBe(0);
    expect(r.aprovado).toBe(false);
  });

  it("respeita a nota mínima do treinamento", () => {
    const respostas = { "1": 0, "2": 1, "3": 0 };   // 67%
    expect(corrigirProva(prova, respostas, 70).aprovado).toBe(false);
    expect(corrigirProva(prova, respostas, 60).aprovado).toBe(true);
    expect(corrigirProva(prova, respostas, 67).aprovado).toBe(true);  // limite exato passa
  });

  it("aprova quando não há prova", () => {
    // Treinamento só com vídeo é concluído por ter sido aberto.
    expect(corrigirProva(null, {}).aprovado).toBe(true);
    expect(corrigirProva([], {}).aprovado).toBe(true);
  });
});

describe("validarProva", () => {
  it("aceita prova bem formada", () => {
    expect(validarProva([q("1", 0)])).toBeNull();
  });

  it("recusa enunciado vazio", () => {
    expect(validarProva([{ ...q("1", 0), enunciado: "  " }])).toMatch(/questão 1.*enunciado/i);
  });

  it("recusa menos de duas alternativas", () => {
    expect(validarProva([{ ...q("1", 0), opcoes: ["só essa", ""] }])).toMatch(/duas alternativas/i);
  });

  it("recusa gabarito fora do intervalo", () => {
    expect(validarProva([{ ...q("1", 9) }])).toMatch(/correta da questão 1/i);
  });

  it("recusa gabarito apontando para alternativa em branco", () => {
    expect(validarProva([{ ...q("1", 2), opcoes: ["a", "b", "  "] }])).toMatch(/em branco/i);
  });

  it("aponta o número certo da questão com problema", () => {
    expect(validarProva([q("1", 0), q("2", 0), { ...q("3", 0), enunciado: "" }]))
      .toMatch(/questão 3/i);
  });
});

describe("caminhoNoBucket", () => {
  it("tira acento e espaço, e prefixa com o id", () => {
    const p = caminhoNoBucket("abc-123", "anexo", "Ação de Segurança.pdf");
    expect(p.startsWith("abc-123/anexo-")).toBe(true);
    expect(p.endsWith("Acao_de_Seguranca.pdf")).toBe(true);
  });
});

describe("validarTamanho", () => {
  const arquivoDe = (mb: number) => ({ size: mb * 1024 * 1024, name: "aula.mp4" }) as File;

  it("aceita arquivo dentro do limite, inclusive no limite exato", () => {
    expect(validarTamanho(arquivoDe(10))).toBeNull();
    expect(validarTamanho(arquivoDe(200))).toBeNull();
  });

  it("recusa acima do limite dizendo o tamanho e a saída", () => {
    // A API devolvia "The object exceeded the maximum allowed size", em
    // inglês e sem dizer qual é o limite.
    const erro = validarTamanho(arquivoDe(240));
    expect(erro).toContain("240,0 MB");
    expect(erro).toContain("200,0 MB");
    expect(erro).toMatch(/YouTube/);
  });

  it("acompanha o menor limite do servidor", () => {
    // 200 MB é o do bucket; o global do projeto está em 1 GB desde
    // 25/08/2026. Quem manda é o menor dos dois.
    expect(LIMITE_UPLOAD_BYTES).toBe(200 * 1024 * 1024);
  });
});
