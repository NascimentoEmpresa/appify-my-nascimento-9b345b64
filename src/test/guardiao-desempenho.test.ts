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
// Migration que mexe em schema precisa do NOTIFY no fim (regra M5, 04/11/2026),
// então os trechos que devem passar limpos levam a linha — como as migrations
// de verdade levam.
const NOTIFY = "\nNOTIFY pgrst, 'reload schema';";

describe("guardião — migration", () => {
  it("M1: função por linha na policy reprova; embrulhada em (SELECT ...) passa", () => {
    expect(regras(SQL, `CREATE POLICY p ON public.t FOR SELECT USING (pode_gerir_avisos(auth.uid(), 'visualizar') OR user_id = auth.uid());`)).toContain("M1");
    expect(regras(SQL, `CREATE POLICY p ON public.t FOR SELECT USING ((SELECT pode_gerir_avisos((SELECT auth.uid()), 'visualizar')) OR user_id = (SELECT auth.uid()));${NOTIFY}`)).toEqual([]);
  });

  it("tirarSelects remove subconsultas aninhadas", () => {
    expect(tirarSelects("x = (SELECT f((SELECT auth.uid()))) AND y")).toBe("x =  __SUB__  AND y");
  });

  it("M2: FK sem índice reprova; com CREATE INDEX passa", () => {
    const tabela = `CREATE TABLE IF NOT EXISTS public."PEDIDO_X" (\n  id uuid PRIMARY KEY,\n  contrato_id uuid REFERENCES public.contratos(id)\n);`;
    expect(regras(SQL, tabela)).toContain("M2");
    expect(regras(SQL, `${tabela}\nCREATE INDEX IF NOT EXISTS pedido_x_contrato_idx ON public."PEDIDO_X" (contrato_id);${NOTIFY}`)).toEqual([]);
  });

  it("M3: SECURITY DEFINER sem search_path reprova", () => {
    expect(regras(SQL, `CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ select 1 $$;`)).toContain("M3");
    expect(regras(SQL, `CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ select 1 $$;${NOTIFY}`)).toEqual([]);
  });

  it("só linha ADICIONADA conta: policy antiga do arquivo não trava", () => {
    const texto = `CREATE POLICY velha ON public.t USING (auth.uid() = user_id);\nSELECT 1;`;
    expect((analisarArquivo(SQL, texto, [2]) as Achado[]).map((a) => a.regra)).toEqual([]);
  });
});

describe("guardião — ALTER POLICY (03/11/2026)", () => {
  it("M1 também vale para ALTER POLICY, que trocava a expressão sem passar pela regra", () => {
    expect(regras(SQL, `ALTER POLICY p ON public.t USING ((SELECT pode_gerir_avisos(auth.uid(), 'visualizar')) OR user_id = auth.uid());`)).toContain("M1");
    expect(regras(SQL, `ALTER POLICY p ON public.t USING ((SELECT pode_gerir_avisos((SELECT auth.uid()), 'visualizar')) OR user_id = (SELECT auth.uid()));${NOTIFY}`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 04/11/2026 — alcance novo (Edge Function e worker) e as regras que pegam
// migration que PARA A FILA, não só a que fica lenta.
// ---------------------------------------------------------------------------
const FN = "supabase/functions/relatorio/index.ts";
const WORKER = "worker/src/alertas.js";

describe("guardião — alcance fora de src/", () => {
  it("Edge Function também responde por lista sem limite e select *", () => {
    expect(regras(FN, `const { data } = await sb.from("EMPREGADOS").select("*");`))
      .toEqual(expect.arrayContaining(["D5", "D6"]));
    expect(regras(FN, `const { data } = await sb.from("EMPREGADOS").select("id").range(0, 99);`)).toEqual([]);
  });

  it("worker também responde por lista sem limite", () => {
    expect(regras(WORKER, `const { data } = await sb.from("notificacoes").select("id, lida");`)).toContain("D5");
  });

  it("W1: temporizador curto no worker reprova; 60 s ou mais passa", () => {
    expect(regras(WORKER, `setInterval(ciclo, 5000);`)).toContain("W1");
    expect(regras(WORKER, `setInterval(ciclo, 60000);`)).toEqual([]);
  });

  it("D2 não se aplica ao worker (ele é poller por natureza) e D1/D4 são só de tela", () => {
    expect(regras(WORKER, `setInterval(() => carregar(sb), 90000);`)).toEqual([]);
    expect(regras(FN, `useQuery({ refetchOnWindowFocus: true })`)).toEqual([]);
  });

  it("D3: Realtime reprova em qualquer um dos três", () => {
    for (const arq of [TS, FN, WORKER]) expect(regras(arq, `sb.channel("x").subscribe()`)).toContain("D3");
  });
});

describe("guardião — credencial no código (deriva do Lovable)", () => {
  it("D8: chave JWT e URL literal no createClient reprovam", () => {
    expect(regras(TS, `const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghij";`)).toContain("D8");
    expect(regras(TS, `export const supabase = createClient("https://api.grpnascimento.com.br", ANON);`)).toContain("D8");
    expect(regras(TS, `export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);`)).toEqual([]);
  });
});

describe("guardião — migration que para a fila", () => {
  it("M4: CREATE OR REPLACE em trigger e em policy reprovam", () => {
    expect(regras(SQL, `CREATE OR REPLACE TRIGGER t BEFORE INSERT ON public.x FOR EACH ROW EXECUTE FUNCTION f();${NOTIFY}`)).toContain("M4");
    expect(regras(SQL, `CREATE OR REPLACE POLICY p ON public.x FOR SELECT USING (true);${NOTIFY}`)).toContain("M4");
    expect(regras(SQL, `DROP TRIGGER IF EXISTS t ON public.x;\nCREATE TRIGGER t BEFORE INSERT ON public.x FOR EACH ROW EXECUTE FUNCTION f();${NOTIFY}`)).not.toContain("M4");
  });

  it("M5: DDL sem NOTIFY pgrst reprova; com NOTIFY passa; migration de dado não precisa", () => {
    expect(regras(SQL, `ALTER TABLE public.x ADD COLUMN y text;`)).toContain("M5");
    expect(regras(SQL, `ALTER TABLE public.x ADD COLUMN y text;${NOTIFY}`)).not.toContain("M5");
    expect(regras(SQL, `INSERT INTO public.app_menu (codigo) VALUES ('x');`)).toEqual([]);
  });

  it("M6: DO que consulta dado e aborta reprova; RAISE NOTICE passa", () => {
    const base = (corpo: string) => `DO $$\nDECLARE n int;\nBEGIN\n  SELECT count(*) INTO n FROM public.profiles;\n  ${corpo}\nEND $$;${NOTIFY}`;
    expect(regras(SQL, base(`IF n = 0 THEN RAISE EXCEPTION 'sem perfis'; END IF;`))).toContain("M6");
    expect(regras(SQL, base(`RAISE NOTICE 'perfis: %', n;`))).not.toContain("M6");
  });
});
