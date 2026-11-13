import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  limparCorpoPr, limparResumoIa, listaDeTextos, montarMensagemResumo, montarPromptResumo, resumoSemIa, urlsValidas,
  commitsPorPalavras, detalhesValidos, separarRespostaIa, urlsDosEscolhidos,
  type EntradaResumo,
} from "../../supabase/functions/_shared/chamado-resumo-pr";

const require = createRequire(import.meta.url);
type CommitCi = { sha: string; mensagem: string; pais?: number };
const { commitsDoChamado, mensagemLimpa, montarAlteracoes } = require("../../.github/scripts/contexto-resumo-pr.cjs") as {
  commitsDoChamado: (commits: CommitCi[], numero: string) => CommitCi[];
  mensagemLimpa: (m: string) => string;
  montarAlteracoes: (arquivos: { nome: string; patch: string }[], maxTotal?: number, maxPorArquivo?: number) => string;
};
const { urlsDaPr, rotasDoApp } = require("../../.github/scripts/rotas-da-pr.cjs") as {
  urlsDaPr: (app: string, arquivos: string[]) => { caminho: string; url: string }[];
  rotasDoApp: (app: string) => { caminho: string; componentes: string[] }[];
};

const APP = `
import Inicio from "./pages/Inicio";
import Bonificacao from "./pages/sistemas/bonificacao/BonificacaoColetiva";
import AbrirChamado from "./pages/chamados/AbrirChamado";
import ExecutarChamado from "./pages/chamados/ExecutarChamado";
import Lista from "./pages/chamados/Lista";
const Mapa = lazy(() => import("./pages/ti/MapaTi"));
<Routes>
  <Route path="/login" element={<Login />} />
  <Route path="/app" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
    <Route index element={<Inicio />} />
    <Route path="sistemas/bonificacao" element={<AcessoGate menu="x"><Bonificacao /></AcessoGate>} />
    <Route path="central-servicos/chamados/novo" element={<AbrirChamado base="/app/central-servicos/chamados" />} />
    <Route path="sistemas/chamados/:id" element={<ExecutarChamado />} />
    <Route path="sistemas/chamados" element={<Lista />} />
    <Route path="ti/mapa" element={<Mapa />} />
  </Route>
</Routes>`;

describe("Rotas da PR — arquivos alterados → telas", () => {
  it("resolve o aninhamento e as rotas index", () => {
    const r = rotasDoApp(APP);
    expect(r.find((x) => x.componentes.includes("Inicio"))?.caminho).toBe("/app");
    expect(r.find((x) => x.componentes.includes("Bonificacao"))?.caminho).toBe("/app/sistemas/bonificacao");
    expect(r.find((x) => x.componentes.includes("Login"))?.caminho).toBe("/login");
  });

  it("tela do próprio arquivo, componente de apoio de pasta com uma tela, import lazy", () => {
    expect(urlsDaPr(APP, [
      "src/pages/chamados/AbrirChamado.tsx",
      "src/pages/sistemas/bonificacao/componentes/ValorDetalhado.tsx",
      "src/pages/ti/MapaTi.tsx",
    ]).map((u) => u.url)).toEqual([
      "https://app.grpnascimento.com.br/app/central-servicos/chamados/novo",
      "https://app.grpnascimento.com.br/app/sistemas/bonificacao",
      "https://app.grpnascimento.com.br/app/ti/mapa",
    ]);
  });

  it("sem link quando não dá para saber a tela: rota com :id, apoio em pasta de várias telas, fora de src/pages", () => {
    expect(urlsDaPr(APP, [
      "src/pages/chamados/ExecutarChamado.tsx",
      "src/pages/chamados/types.tsx",
      "src/lib/chamados/vinculos.ts",
      "supabase/migrations/x.sql",
      "src/pages/chamados/AbrirChamado.test.tsx",
    ])).toEqual([]);
  });

  it("funciona com o App.tsx de verdade", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(urlsDaPr(app, ["src/pages/sistemas/bonificacao/componentes/ValorDetalhado.tsx"]).map((u) => u.caminho))
      .toEqual(["/app/sistemas/bonificacao"]);
  });
});

const entrada: EntradaResumo = {
  numero: "SIS-2026-0900", assunto: "Relatório de comissões", descricao: "Falta a coluna de valor",
  prTitulo: "SIS-2026-0900: coluna de valor no relatório",
  prCorpo: "<!-- chamado:auto:start -->\n**Chamado:** x\n<!-- chamado:auto:end -->\n\nAdiciona a coluna.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  commits: ["SIS-2026-0900: coluna de valor", "ajusta total do mês"],
  arquivos: ["src/pages/relatorios/Comissoes.tsx"],
  urls: ["https://app.grpnascimento.com.br/app/relatorios/comissoes"],
  alteracoes: "### src/pages/relatorios/Comissoes.tsx\n+  <TableHead>Valor da comissão</TableHead>",
};

// 13/11/2026: o resumo sai no merge, do que a PR mergeada traz (o caso do
// SIS-2026-0854: PR da branch pessoal com commits do Mural + o do chamado).
describe("Contexto do resumo — a PR já mergeada", () => {
  const pr: CommitCi[] = [
    { sha: "a", mensagem: "[SEM-CHAMADO] Mural do Início: botões de mês", pais: 1 },
    { sha: "b", mensagem: "SIS-2026-0854: encerramento de contrato fora do turnover\n\n- pergunta Sim/Não no passo Motivos\n\nCo-Authored-By: Claude <x@y>", pais: 1 },
    { sha: "c", mensagem: "Merge branch 'main' into pablo", pais: 2 },
    { sha: "d", mensagem: "SIS-2026-0900: outro chamado", pais: 1 },
  ];

  it("só os commits deste chamado, sem merge, sem outro chamado, sem [SEM-CHAMADO]", () => {
    expect(commitsDoChamado(pr, "SIS-2026-0854").map((c) => c.sha)).toEqual(["b"]);
    expect(commitsDoChamado(pr, "sis-2026-0900").map((c) => c.sha)).toEqual(["d"]);
  });

  it("sem commit com o número: os que não são de outro chamado; sem nada, todos os simples", () => {
    const semPrefixo: CommitCi[] = [...pr, { sha: "e", mensagem: "ajusta a tela", pais: 1 }];
    expect(commitsDoChamado(semPrefixo, "SIS-2026-0999").map((c) => c.sha)).toEqual(["e"]);
    expect(commitsDoChamado(pr, "SIS-2026-0999").map((c) => c.sha)).toEqual(["a", "b", "d"]);
  });

  it("mensagem inteira, sem a coautoria", () => {
    expect(mensagemLimpa(pr[1].mensagem)).toBe("SIS-2026-0854: encerramento de contrato fora do turnover\n\n- pergunta Sim/Não no passo Motivos");
  });

  it("código alterado: telas primeiro, sem ruído, trechos do mesmo arquivo juntos e com teto", () => {
    const t = montarAlteracoes([
      { nome: "supabase/migrations/2026_x.sql", patch: "+ALTER TABLE x" },
      { nome: "src/integrations/supabase/types.ts", patch: "+tipo" },
      { nome: "package-lock.json", patch: "+lock" },
      { nome: "src/test/x.test.ts", patch: "+teste" },
      { nome: "src/pages/rh/Tela.tsx", patch: "+<Button>Sim</Button>" },
      { nome: "src/pages/rh/Tela.tsx", patch: "+<Button>Não</Button>" },
    ]);
    expect(t.indexOf("### src/pages/rh/Tela.tsx")).toBe(0);
    expect(t).toContain("+<Button>Sim</Button>\n+<Button>Não</Button>");
    expect(t).toContain("### supabase/migrations/2026_x.sql");
    expect(t).not.toMatch(/types\.ts|package-lock|x\.test/);

    const grande = montarAlteracoes([
      { nome: "src/pages/a.tsx", patch: "x".repeat(500) },
      { nome: "src/pages/b.tsx", patch: "y".repeat(500) },
    ], 200, 100);
    expect(grande).toContain("[… cortado]");
    expect(grande).toContain("fora do limite");
  });
});

describe("Resumo da entrega no chat do chamado", () => {
  it("saneia o que vem do CI: listas limitadas e só links do ERP", () => {
    expect(listaDeTextos(["a", "a", " ", 3, null, "b"], 10)).toEqual(["a", "3", "b"]);
    expect(listaDeTextos(Array.from({ length: 20 }, (_, i) => `c${i}`), 5)).toHaveLength(5);
    expect(urlsValidas([
      "https://app.grpnascimento.com.br/app/x",
      "https://evil.com/app/x",
      "https://app.grpnascimento.com.br/app/y\" onclick=",
      "javascript:alert(1)",
    ])).toEqual(["https://app.grpnascimento.com.br/app/x"]);
  });

  it("o prompt leva o pedido, a entrega e os commits, sem o bloco automático da PR", () => {
    const [sys, user] = montarPromptResumo(entrada);
    expect(sys.role).toBe("system");
    expect(user.content).toContain("Falta a coluna de valor");
    expect(user.content).toContain("[2] ajusta total do mês");
    expect(user.content).toContain("Adiciona a coluna.");
    expect(user.content).not.toContain("chamado:auto");
    // O código alterado vai junto, e a regra diz que a prova é ele, não o pedido.
    expect(user.content).toContain("+  <TableHead>Valor da comissão</TableHead>");
    expect(sys.content).toMatch(/não repita o pedido como se tivesse sido entregue/);
    expect(limparCorpoPr(entrada.prCorpo)).toBe("Adiciona a coluna.");
  });

  it("limpa o texto da I.A: sem markdown e sem link inventado", () => {
    const t = limparResumoIa("## Pronto\n**Coluna** nova em https://x.com/a\n* item\n\n\n\nfim");
    expect(t).toBe("Pronto\nColuna nova em \n- item\n\nfim");
  });

  it("sem I.A: título da PR e commits, sem o número do chamado", () => {
    expect(resumoSemIa(entrada)).toBe("Desenvolvimento pronto: coluna de valor no relatório.\n\nO que mudou:\n- coluna de valor\n- ajusta total do mês");
  });

  it("mensagem final: resumo, onde acessar e o que fazer", () => {
    const m = montarMensagemResumo("Coluna nova.", entrada.urls);
    expect(m).toContain("Coluna nova.");
    expect(m).toContain("Onde acessar:\n- https://app.grpnascimento.com.br/app/relatorios/comissoes");
    expect(m).toContain("Confirmar conclusão");
    expect(montarMensagemResumo("x", [])).not.toContain("Onde acessar");
  });
});

describe("Resumo do chamado — só o que o chamado pediu (SIS-2026-0895, 13/11/2026)", () => {
  const URL = "https://app.grpnascimento.com.br";
  // O caso real: chamado da Implantação, PR com commits [SEM-CHAMADO] de TVs e do Monitoramento junto.
  const entrada: EntradaResumo = {
    numero: "SIS-2026-0895",
    assunto: "Ajuste no Implantação dos contratos (Parte 2)",
    descricao: "Fazer com que as informações preenchidas na tela de Implantação de Contratos alimentem os gráficos e resumos. Criar uma página para cada setor.",
    prTitulo: "SIS-2026-0895: Ajuste no Implantação dos contratos (Parte 2)",
    prCorpo: null,
    commits: [
      "[SEM-CHAMADO] Implantação: página do setor no layout do protótipo \"apenas setores\"",
      "[SEM-CHAMADO] TVs: no máximo ~940 consultas por dia para as 13 TVs (era ~23 mil)",
      "[SEM-CHAMADO] Licitações: submódulo \"Resumo dos Contratos\" no menu, com o resumo geral e uma tela por setor",
      "[SEM-CHAMADO] Monitoramento de Chamados: nota da I.A de verdade e ranking pelo volume",
    ],
    arquivos: [],
    urls: [`${URL}/app/sistemas/tvs`, `${URL}/app/licitacoes/implantacao/painel`],
  };
  entrada.detalhes = [
    { mensagem: entrada.commits[0], urls: [`${URL}/app/licitacoes/implantacao/painel`] },
    { mensagem: entrada.commits[1], urls: [`${URL}/app/sistemas/tvs`, `${URL}/tv`] },
    { mensagem: entrada.commits[2], urls: [`${URL}/app/licitacoes/implantacao/painel`] },
    { mensagem: entrada.commits[3], urls: [`${URL}/app/central-servicos/chamados/monitoramento`] },
  ];

  it("a I.A recebe os commits numerados e a regra de ignorar outros assuntos", () => {
    const [sys, user] = montarPromptResumo(entrada);
    expect(sys.content).toContain("COMMITS: ");
    expect(sys.content).toMatch(/ignore os outros por completo/);
    expect(user.content).toContain("[2] [SEM-CHAMADO] TVs:");
  });

  it("a linha COMMITS sai do texto e só as URLs dos commits escolhidos vão ao solicitante", () => {
    const r = separarRespostaIa("COMMITS: 1, 3, 9\nA tela do setor ficou igual ao modelo.\n\nO que mudou:\n- abas", 4);
    expect(r.escolhidos).toEqual([0, 2]);
    expect(r.texto.startsWith("A tela do setor")).toBe(true);
    expect(urlsDosEscolhidos(entrada, r.escolhidos!)).toEqual([`${URL}/app/licitacoes/implantacao/painel`]);
    expect(separarRespostaIa("Sem a linha.", 4).escolhidos).toBeNull();
  });

  it("sem a I.A, escolhe pelas palavras do assunto: nada de TVs nem Monitoramento", () => {
    const idx = commitsPorPalavras(entrada);
    expect(idx).toEqual([0, 2]);
    expect(urlsDosEscolhidos(entrada, idx)).not.toContain(`${URL}/app/sistemas/tvs`);
    expect(resumoSemIa(entrada, idx)).not.toMatch(/TVs|Monitoramento/);
  });

  it("detalhe inválido do CI é descartado; sem detalhe, URLs como antes", () => {
    expect(detalhesValidos([{ mensagem: "x", urls: ["https://evil.com/a", `${URL}/app/a`] }, { urls: [] }, null]))
      .toEqual([{ mensagem: "x", urls: [`${URL}/app/a`] }]);
    expect(urlsDosEscolhidos({ ...entrada, detalhes: undefined }, [0])).toEqual(entrada.urls);
  });
});
