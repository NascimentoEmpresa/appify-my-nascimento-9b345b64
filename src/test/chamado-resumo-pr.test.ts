import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  limparCorpoPr, limparResumoIa, listaDeTextos, montarMensagemResumo, montarPromptResumo, resumoSemIa, urlsValidas,
  type EntradaResumo,
} from "../../supabase/functions/_shared/chamado-resumo-pr";

const require = createRequire(import.meta.url);
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
};

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
    expect(user.content).toContain("- ajusta total do mês");
    expect(user.content).toContain("Adiciona a coluna.");
    expect(user.content).not.toContain("chamado:auto");
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
