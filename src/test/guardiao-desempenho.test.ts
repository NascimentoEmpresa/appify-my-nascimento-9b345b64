// O guardião do CI (item 13, 03/11/2026): cada regra reprova o padrão que
// derrubou a produção e aprova a forma certa. Se uma regra mudar, estes
// testes dizem se ela ainda pega o caso real.
import { describe, expect, it } from "vitest";
import { analisarArquivo, tirarSelects } from "../../.github/scripts/guardiao-desempenho.mjs";

type Achado = { regra: string; linha: number; liberado: string | null };
const tudo = (texto: string) => texto.split("\n").map((_, i) => i + 1);
const regras = (arquivo: string, texto: string): string[] =>
  (analisarArquivo(arquivo, texto, tudo(texto)) as Achado[]).filter((a) => !a.liberado).map((a) => a.regra);
const TS = "src/pages/x/Tela.tsx";

describe("guardião — frontend", () => {
  it("D1: refetchInterval reprova; refetchInterval: false passa", () => {
    expect(regras(TS, `useQuery({ queryKey: ["a"], refetchInterval: 8000 })`)).toContain("D1");
    expect(regras(TS, `useQuery({ queryKey: ["a"], refetchInterval: false })`)).not.toContain("D1");
  });

  it("D2: setInterval que busca dado reprova; relógio passa", () => {
    expect(regras(TS, `const t = setInterval(carregar, 8000);`)).toContain("D2");
    expect(regras(TS, `const t = setInterval(() => setAgora(new Date()), 1000);`)).not.toContain("D2");
  });

  it("D3/D4: Realtime e refetchOnWindowFocus: true reprovam", () => {
    expect(regras(TS, `sb.channel("x").on("postgres_changes", {}, f)`)).toContain("D3");
    expect(regras(TS, `useQuery({ refetchOnWindowFocus: true })`)).toContain("D4");
  });

  it("D5/D6: lista em tabela grande sem limite reprova; com .range() passa; leitura por id passa", () => {
    expect(regras(TS, `const { data } = await supabase.from("planilha_custo").select("*").order("created_at");`)).toEqual(expect.arrayContaining(["D5", "D6"]));
    expect(regras(TS, `const { data } = await supabase.from("planilha_custo").select("id, contrato").range(0, 49);`)).toEqual([]);
    expect(regras(TS, `const { data } = await supabase.from("malote_despesa").select("*").eq("id", id).maybeSingle();`)).toEqual([]);
  });

  it("D5: escrita em tabela grande não é lista", () => {
    expect(regras(TS, `await supabase.from("notificacoes").update({ lida: true }).eq("user_id", u);`)).toEqual([]);
  });

  it("D5: tabela pequena fica fora", () => {
    expect(regras(TS, `const { data } = await supabase.from("empresas").select("*");`)).toEqual([]);
  });

  it("D7: Promise.all de uma requisição por item reprova", () => {
    expect(regras(TS, `await Promise.all(\n  lotes.map((l) =>\n    supabase.from("WA_CONTATO").select("id").in("id", l)))`)).toContain("D7");
  });

  it("comentário não conta e a válvula libera com motivo", () => {
    expect(regras(TS, `// refetchInterval: 8000 era assim`)).toEqual([]);
    expect(regras(TS, `// guardiao-ok: painel de TV de parede, decidido pelo Eduardo em 03/11\nuseQuery({ refetchInterval: 600000 })`)).toEqual([]);
    expect(regras(TS, `// guardiao-ok: curto\nuseQuery({ refetchInterval: 600000 })`)).toContain("D1");
  });

  it("arquivo de teste não é analisado", () => {
    expect(regras("src/test/a.test.ts", `useQuery({ refetchInterval: 1 })`)).toEqual([]);
  });
});

const SQL = "supabase/migrations/20990101000000_x.sql";
describe("guardião — migration", () => {
  it("M1: função por linha na policy reprova; embrulhada em (SELECT ...) passa", () => {
    expect(regras(SQL, `CREATE POLICY p ON public.t FOR SELECT USING (pode_gerir_avisos(auth.uid(), 'visualizar') OR user_id = auth.uid());`)).toContain("M1");
    expect(regras(SQL, `CREATE POLICY p ON public.t FOR SELECT USING ((SELECT pode_gerir_avisos((SELECT auth.uid()), 'visualizar')) OR user_id = (SELECT auth.uid()));`)).toEqual([]);
  });

  it("tirarSelects remove subconsultas aninhadas", () => {
    expect(tirarSelects("x = (SELECT f((SELECT auth.uid()))) AND y")).toBe("x =  __SUB__  AND y");
  });

  it("M2: FK sem índice reprova; com CREATE INDEX passa", () => {
    const tabela = `CREATE TABLE IF NOT EXISTS public."PEDIDO_X" (\n  id uuid PRIMARY KEY,\n  contrato_id uuid REFERENCES public.contratos(id)\n);`;
    expect(regras(SQL, tabela)).toContain("M2");
    expect(regras(SQL, `${tabela}\nCREATE INDEX IF NOT EXISTS pedido_x_contrato_idx ON public."PEDIDO_X" (contrato_id);`)).toEqual([]);
  });

  it("M3: SECURITY DEFINER sem search_path reprova", () => {
    expect(regras(SQL, `CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ select 1 $$;`)).toContain("M3");
    expect(regras(SQL, `CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ select 1 $$;`)).toEqual([]);
  });

  it("só linha ADICIONADA conta: policy antiga do arquivo não trava", () => {
    const texto = `CREATE POLICY velha ON public.t USING (auth.uid() = user_id);\nSELECT 1;`;
    expect((analisarArquivo(SQL, texto, [2]) as Achado[]).map((a) => a.regra)).toEqual([]);
  });
});

describe("guardião — ALTER POLICY (03/11/2026)", () => {
  it("M1 também vale para ALTER POLICY, que trocava a expressão sem passar pela regra", () => {
    expect(regras(SQL, `ALTER POLICY p ON public.t USING ((SELECT pode_gerir_avisos(auth.uid(), 'visualizar')) OR user_id = auth.uid());`)).toContain("M1");
    expect(regras(SQL, `ALTER POLICY p ON public.t USING ((SELECT pode_gerir_avisos((SELECT auth.uid()), 'visualizar')) OR user_id = (SELECT auth.uid()));`)).toEqual([]);
  });
});
