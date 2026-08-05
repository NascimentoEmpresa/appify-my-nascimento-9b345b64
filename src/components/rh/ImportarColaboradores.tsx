import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Upload, FileSpreadsheet, UserPlus, RefreshCw, CheckCircle2, AlertTriangle, X } from "lucide-react";

// =========================================================================
// RH — Colaboradores: importar EMPREGADOS por planilha (export do sistema de
// folha). Regras pedidas:
//   • CPF novo → INSERT de linha nova.
//   • CPF que já existe e está com vínculo ABERTO → atualiza a "Situação".
//   • CPF que já existe, está ABERTO e a planilha diz TRABALHANDO → além da
//     situação, atualiza TODOS os campos cadastrais que a planilha traz.
//     Quem está aberto mas não trabalhando (férias, atestado…) só tem os
//     campos VAZIOS preenchidos - nada que já está no banco é sobrescrito.
//   • MEI não é tocado em hipótese alguma: nem insert, nem update. Vale tanto
//     p/ quem a planilha marca como MEI quanto p/ quem já está como MEI na
//     coluna "TIPO DE CONTRATO" da EMPREGADOS.
//   • Planilha vazia num campo nunca apaga o que já está no banco.
// Casamento por CPF normalizado (só dígitos, 11 casas). A planilha traz o
// mesmo CPF em várias linhas (postos diferentes); consolidamos por CPF
// mantendo a situação "mais ativa" (Trabalhando > Férias > Afastado >
// Aposentadoria > Demitido).
//
// COLUNAS: o export da folha tem ~290 colunas e a EMPREGADOS nasceu dele, então
// os nomes batem quase sempre. Em vez de uma lista fixa (que só trazia 15
// campos e deixava Cadastro, Escala, Posto, Banco… sempre vazios), o mapa é
// montado na hora: lê as colunas reais da EMPREGADOS e casa cada uma com a
// coluna homônima da planilha, com apelido só onde os nomes divergem.
// =========================================================================

// Onde o nome difere entre EMPREGADOS (chave) e a planilha da folha (valor).
// O "_1" das duplicadas veio da carga original: "Situação" na EMPREGADOS é a
// descrição ("Trabalhando") e "Situação_1" é o código numérico.
const ALIAS: Record<string, string> = {
  "Escala": "Descrição (Escala)",
  "Escala_1": "Escala",
  "Situação": "Descrição (Situação)",
  "Situação_1": "Situação",
  "Nome da Empresa": "Nome (Empresa)",
  "Nome Filial": "Apelido (Filial)",
  "Título do Cargo": "Título Reduzido (Cargo)",
  "Titulo C.Custo": "Descrição (C.Custo)",
  "Nome do Posto": "Descrição Reduzida (Posto)",
};

// Colunas que são do ERP (não da folha): a importação nunca escreve nelas.
// Exportado para o teste conseguir travar isso — "Configurações extras (ERP)"
// (Setor_ERP / LIDER / Perfil_ERP) é configuração feita à mão na tela, e uma
// planilha da folha não pode desfazer.
export const COLS_ERP = new Set([
  "ID", "Contrato", "TIPO DE CONTRATO", "LIDER", "Ativo_ERP", "Perfil_ERP", "Setor_ERP",
  "Senha", "chave_secreta", "email", "permissoes_compras", "classificacoes_responsavel",
  "aprovar_cotacao_classif", "permissoes_malote", "auth_user_id", "tipo_acesso",
  "contrato_responsavel_id", "contrato_responsavel", "Nome do Cargo",
]);
// Chave do casamento: entra no insert, nunca num update.
const COLS_CHAVE = new Set(["ID", "CPF"]);

// Recorte usado só quando não dá p/ ler as colunas reais (tabela vazia).
const COLS_FALLBACK = [
  "Nome", "CPF", "Situação", "Título do Cargo", "Cargo", "Admissão", "Data Afastamento",
  "Valor Salário", "Empresa", "Nome da Empresa", "Filial", "Nome Filial", "PIS",
  "C.Custo", "Titulo C.Custo", "Descrição do Local", "Cadastro", "Escala", "Posto",
];

const COL = { cpf: "CPF", nome: "Nome", situ: "Descrição (Situação)" } as const;

// Colunas onde o "tipo de contrato" pode aparecer (varia entre exports; a
// primeira é a da própria EMPREGADOS). Regra: MEI não é tocado.
const COLS_TIPO_CONTRATO = ["TIPO DE CONTRATO", "Descrição (T. Contrato)", "Descrição (Tipo)", "Descrição (Categoria Contribuinte)", "Descrição (Cat. eSocial)", "Descrição (Categoria Sefip)"];
export const ehMEI = (r: any): boolean =>
  COLS_TIPO_CONTRATO.some(c => { const v = r?.[c]; return typeof v === "string" && (/\bMEI\b/i.test(v) || /MICROEMPREEND/i.test(v)); });

// Ranking de "atual" para consolidar múltiplas linhas do mesmo CPF.
const rankSituacao = (s: string): number => {
  const u = (s || "").toUpperCase();
  if (u.startsWith("TRABALH")) return 6;
  if (u.includes("FÉRIAS") || u.includes("FERIAS")) return 5;
  if (u.includes("ATEST") || u.includes("AUXÍLIO") || u.includes("AUXILIO") || u.includes("LICEN") || u.includes("ABONO")) return 4;
  if (u.includes("APOSENT")) return 2;
  if (u.includes("DEMIT") || u.includes("DESLIG") || u.includes("RESCIS")) return 1;
  return 3; // desconhecido → meio-termo
};

// Situação "terminal" = vínculo encerrado. Nunca é reativada: se a pessoa
// reaparecer ativa na planilha, é readmissão (linha nova), não update.
const ehTerminal = (s: string): boolean => {
  const u = (s || "").toUpperCase();
  return u.includes("DEMIT") || u.includes("DESLIG") || u.includes("RESCIS") || u.includes("APOSENT");
};

const soDigitos = (v: any) => String(v ?? "").replace(/\D/g, "");
// Só dígitos (11 casas) — é a chave do casamento, nunca o que vai pro banco.
const normCpf = (v: any) => { const d = soDigitos(v); return d ? d.padStart(11, "0") : ""; };
// Formato oficial do cadastro: XXX.XXX.XXX-XX. A planilha entrega o CPF como
// número (sem pontuação e sem o zero à esquerda); gravar assim desfazia a
// padronização do banco a cada importação.
const fmtCpf = (v: any) => {
  const d = normCpf(v);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
};

// "Trabalhando" (a única situação que dispara atualização cadastral).
const ehTrabalhandoSitu = (s: string): boolean => (s || "").trim().toUpperCase().startsWith("TRABALH");

// Número pt-BR ("1.605,33"), "1605.33" ou número → Number (NaN se não der).
const numDe = (v: any): number => {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/[^\d.,-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s); return isNaN(n) ? NaN : n;
};

// A folha manda data como "DD/MM/AAAA" e usa "00/00/0000" p/ vazio; o Excel
// também pode entregar Date ou o serial numérico. Devolve ISO, null p/ a data
// zerada e undefined quando o valor não é data nenhuma.
const dataDe = (v: any): string | null | undefined => {
  const iso = (d: Date) => {
    const y = d.getUTCFullYear();
    return y < 1900 || y > 2100 ? null : `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };
  if (v instanceof Date) return isNaN(v.getTime()) ? null : iso(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return m[3] === "0000" || m[1] === "00" ? null : `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
};

// Célula da planilha → valor pronto p/ gravar. null = "a planilha não informou"
// (nunca apaga o que está no banco).
const valorPlanilha = (v: any): any => {
  if (v == null) return null;
  const d = dataDe(v);
  if (d !== undefined) return d;         // era data (ou data zerada → null)
  if (typeof v === "number") return v;
  const s = String(v).trim();
  return s === "" ? null : s;
};

// Serial do Excel (data sem formatação) → ISO. Base 1899-12-30 já compensa o
// bug do ano bissexto de 1900.
const serialISO = (v: any): string | null => {
  if (typeof v !== "number" || v <= 0) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y < 1950 || y > 2100 ? null : `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

// Mesmo valor? Compara como número quando os dois lados são numéricos (o banco
// guarda "22" e a planilha manda 22) e como texto no resto.
const mesmoValor = (a: any, b: any): boolean => {
  const sa = String(a ?? "").trim(), sb = String(b ?? "").trim();
  if (sa === "" || sb === "") return sa === sb;
  const na = numDe(sa), nb = numDe(sb);
  if (!isNaN(na) && !isNaN(nb) && /^-?[\d.,]+$/.test(sa) && /^-?[\d.,]+$/.test(sb)) return Math.abs(na - nb) < 0.005;
  return sa.toUpperCase() === sb.toUpperCase();
};

const vazio = (v: any) => v == null || String(v).trim() === "";

// Qual coluna o banco recusou? A mensagem do PostgREST traz o valor ofensivo
// entre aspas ('invalid input syntax for type bigint: "PO-00293"') ou o nome da
// coluna. Serve p/ salvar o resto do registro em vez de perder tudo por um campo.
const colunaCulpada = (msg: string, dados: Record<string, any>): string | null => {
  const porValor = /:\s*"([^"]*)"/.exec(msg) || /=\s*'([^']*)'/.exec(msg);
  if (porValor) {
    const c = Object.keys(dados).find(k => String(dados[k]) === porValor[1]);
    if (c) return c;
  }
  const porNome = /column "([^"]+)"/i.exec(msg);
  return porNome && porNome[1] in dados ? porNome[1] : null;
};

// Mapa EMPREGADOS ← planilha: só colunas que existem dos dois lados e que não
// são do ERP. É o que faz o import trazer Cadastro, Escala, Posto, Banco etc.
type Mapa = { col: string; origem: string };
export const montarMapa = (colsBanco: string[], colsPlanilha: Set<string>): Mapa[] =>
  colsBanco
    .filter(c => !COLS_ERP.has(c) && colsPlanilha.has(ALIAS[c] ?? c))
    .map(c => ({ col: c, origem: ALIAS[c] ?? c }));

type Previa = {
  totalLinhas: number;
  totalCpfs: number;
  inserts: Record<string, any>[];
  novosCpf: number;
  readmissoes: number;
  updates: { id: any; patch: Record<string, any> }[]; // um patch por registro (situação e/ou cadastro)
  totalUpdates: number;                                // registros com qualquer mudança
  totalSituacao: number;                               // registros com mudança de situação
  totalCadastro: number;                               // registros com mudança cadastral
  totalCampos: number;                                 // campos cadastrais alterados (soma)
  semMudanca: number;
  mudaResumo: Record<string, number>;                  // "de → para" (situação) → nº
  cadastroResumo: Record<string, number>;              // coluna → nº de registros alterados
  colunasMapeadas: number;                             // colunas da planilha que casaram com a EMPREGADOS
  ignorados: number;
  mei: number;
};

export default function ImportarColaboradores({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fase, setFase] = useState<"idle" | "lendo" | "previa" | "aplicando" | "fim">("idle");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [prog, setProg] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [erros, setErros] = useState<string[]>([]);   // linhas que o banco recusou (uma a uma)

  const abrir = () => { setOpen(true); setFase("idle"); setPrevia(null); setErro(null); setErros([]); setProg(""); };
  const fechar = () => { if (fase === "aplicando" || fase === "lendo") return; setOpen(false); };

  const escolher = () => fileRef.current?.click();

  // Colunas reais da EMPREGADOS (uma linha basta): é delas que sai o mapa.
  const colunasBanco = async (): Promise<string[]> => {
    const { data, error } = await (supabase as any).from("EMPREGADOS").select("*").limit(1);
    if (error) throw new Error("Falha ao ler EMPREGADOS: " + error.message);
    return data?.length ? Object.keys(data[0]) : [];
  };

  // Cadastro atual, só nas colunas que o import compara — o recorte que a tela
  // de Colaboradores carrega (~20 colunas) não serve p/ comparar campo a campo:
  // sem isso não havia como saber que "Cadastro"/"Escala" estavam vazios.
  const carregarBanco = async (cols: string[]): Promise<any[]> => {
    const sel = cols.map(c => `"${c}"`).join(",");
    let all: any[] = []; const chunk = 1000;
    for (let de = 0; ; de += chunk) {
      setProg(`Lendo cadastro atual… ${all.length.toLocaleString("pt-BR")}`);
      const { data, error } = await (supabase as any).from("EMPREGADOS").select(sel).order("ID", { ascending: true }).range(de, de + chunk - 1);
      if (error) throw new Error("Falha ao ler EMPREGADOS: " + error.message);
      all = all.concat(data || []);
      if (!data || data.length < chunk || de > 200000) break;
    }
    return all;
  };

  const lerArquivo = async (file: File) => {
    setErro(null); setFase("lendo"); setProg("");
    try {
      const XLSX: any = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: null });
      if (!raw.length) throw new Error("A planilha está vazia.");

      // Colunas: as reais da EMPREGADOS × as da planilha (com os apelidos).
      const colsPlanilha = new Set<string>();
      raw.slice(0, 50).forEach(r => Object.keys(r).forEach(k => colsPlanilha.add(k)));
      const colsBanco = await colunasBanco();
      const mapa = montarMapa(colsBanco.length ? colsBanco : COLS_FALLBACK, colsPlanilha);

      // Lê o cadastro atual só nas colunas que interessam (as do mapa + as que
      // decidem o que fazer com cada registro).
      const colsLeitura = [...new Set(["ID", "CPF", "Nome", "Situação", "TIPO DE CONTRATO", ...mapa.map(m => m.col)])]
        .filter(c => colsBanco.includes(c));
      const existentesBanco = colsLeitura.length ? await carregarBanco(colsLeitura) : [];
      setProg("");

      // 1ª passada: CPFs MEI ficam de fora por completo — os que a planilha
      // marca e os que já estão como MEI no cadastro.
      const meiCpfs = new Set<string>();
      for (const r of raw) { if (ehMEI(r)) { const cpf = normCpf(r[COL.cpf]); if (cpf) meiCpfs.add(cpf); } }
      for (const e of existentesBanco) { if (ehMEI(e)) { const cpf = normCpf(e["CPF"]); if (cpf) meiCpfs.add(cpf); } }

      // Consolida a planilha por CPF (situação mais ativa vence). MEI é ignorado.
      const porCpf = new Map<string, { cpf: string; nome: string; situ: string; raw: any }>();
      let ignorados = 0;
      for (const r of raw) {
        const cpf = normCpf(r[COL.cpf]);
        const nome = String(r[COL.nome] ?? "").trim();
        if (!cpf || cpf === "00000000000" || soDigitos(r[COL.cpf]).length > 11 || !nome) { ignorados++; continue; }
        if (meiCpfs.has(cpf)) continue; // MEI: não altera nada
        const situ = String(r[COL.situ] ?? "").trim();
        const ex = porCpf.get(cpf);
        if (!ex || rankSituacao(situ) > rankSituacao(ex.situ)) porCpf.set(cpf, { cpf, nome, situ, raw: r });
      }

      // Índice dos existentes (banco): CPF → linhas (pode haver duplicadas).
      const existByCpf = new Map<string, any[]>();
      for (const e of existentesBanco) {
        const cpf = normCpf(e["CPF"]);
        if (!cpf || cpf === "00000000000" || meiCpfs.has(cpf)) continue;
        const g = existByCpf.get(cpf); if (g) g.push(e); else existByCpf.set(cpf, [e]);
      }

      const inserts: Record<string, any>[] = [];
      const updates: { id: any; patch: Record<string, any> }[] = [];
      const mudaResumo: Record<string, number> = {};
      const cadastroResumo: Record<string, number> = {};
      let semMudanca = 0, novosCpf = 0, readmissoes = 0, totalSituacao = 0, totalCadastro = 0, totalCampos = 0;

      for (const [cpf, c] of porCpf) {
        const existentes = existByCpf.get(cpf);
        if (!existentes) { inserts.push(montarPayload(c, mapa)); novosCpf++; continue; }
        if (!c.situ) { semMudanca++; continue; }

        // Só vínculos ABERTOS (não-demitido) podem ter a situação alterada.
        const abertas = existentes.filter(e => !ehTerminal(String(e["Situação"] ?? "")));

        // Planilha diz que está ativo, mas no banco só há vínculo encerrado
        // (Demitido) → readmissão: entra como linha nova, sem tocar o antigo.
        if (!ehTerminal(c.situ) && abertas.length === 0) {
          inserts.push(montarPayload(c, mapa)); readmissoes++; continue;
        }

        // Trabalhando: o cadastro inteiro acompanha a planilha. Aberto mas em
        // férias/atestado: só preenche buraco, não sobrescreve.
        const trabalhando = ehTrabalhandoSitu(c.situ);
        let mexeu = false;
        for (const e of abertas) {
          const patch: Record<string, any> = {};

          // 1) Situação (sempre que abrir e divergir).
          const atual = String(e["Situação"] ?? "").trim();
          if (atual.toUpperCase() !== c.situ.toUpperCase()) {
            patch["Situação"] = c.situ;
            const k = `${atual || "(vazio)"}  →  ${c.situ}`;
            mudaResumo[k] = (mudaResumo[k] || 0) + 1;
            totalSituacao++;
          }

          // 2) CPF: quando o cadastro tem o mesmo CPF em outro formato (só
          // dígitos, sem o zero à esquerda), é o MESMO valor — aproveita o
          // passe p/ deixar tudo no padrão pontuado.
          const cpfFmt = fmtCpf(cpf);
          if (cpfFmt && String(e["CPF"] ?? "").trim() !== cpfFmt) {
            patch["CPF"] = cpfFmt;
            cadastroResumo["CPF (formato)"] = (cadastroResumo["CPF (formato)"] || 0) + 1;
            totalCampos++;
          }

          // 3) Cadastro. Planilha vazia num campo nunca apaga.
          let mexeuCad = false;
          for (const { col, origem } of mapa) {
            if (COLS_CHAVE.has(col) || col === "Situação" || !(col in e)) continue;
            const novo = valorDe(col, c.raw[origem]);
            if (novo == null || novo === "") continue;
            if (!trabalhando && !vazio(e[col])) continue;   // fora do Trabalhando só completa
            if (mesmoValor(novo, e[col])) continue;
            patch[col] = novo;
            cadastroResumo[col] = (cadastroResumo[col] || 0) + 1;
            totalCampos++;
            mexeuCad = true;
          }
          if (mexeuCad) totalCadastro++;

          if (Object.keys(patch).length) { updates.push({ id: e["ID"], patch }); mexeu = true; }
        }
        if (!mexeu) semMudanca++;
      }

      setPrevia({
        totalLinhas: raw.length,
        totalCpfs: porCpf.size,
        inserts,
        novosCpf,
        readmissoes,
        updates,
        totalUpdates: updates.length,
        totalSituacao,
        totalCadastro,
        totalCampos,
        semMudanca,
        mudaResumo,
        cadastroResumo,
        colunasMapeadas: mapa.length,
        ignorados,
        mei: meiCpfs.size,
      });
      setFase("previa");
    } catch (e: any) {
      setErro(e?.message || String(e)); setFase("idle"); setProg("");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Valor da planilha pronto p/ a coluna. PIS/CPF viram só dígitos; "Admissão"
  // e afins podem vir como serial do Excel quando a célula não tem formato.
  const valorDe = (col: string, bruto: any): any => {
    const v = valorPlanilha(bruto);
    if (v == null) return null;
    if (col === "PIS" || col === "Inscrição INSS") return soDigitos(v) || null;
    if (typeof v === "number" && (col === "Admissão" || col.startsWith("Data ") || col === "Nascimento")) return serialISO(v);
    return v;
  };

  const montarPayload = (c: { cpf: string; nome: string; situ: string; raw: any }, mapa: Mapa[]) => {
    const p: Record<string, any> = { Nome: c.nome, CPF: fmtCpf(c.cpf), Setor_ERP: "PADRAO", Perfil_ERP: "PADRAO" };
    for (const { col, origem } of mapa) {
      if (COLS_CHAVE.has(col) || col === "Nome") continue;
      const v = valorDe(col, c.raw[origem]);
      if (v != null && v !== "") p[col] = v;
    }
    if (c.situ) p["Situação"] = c.situ;
    return p;
  };

  const aplicar = async () => {
    if (!previa) return;
    setFase("aplicando"); setErro(null);
    try {
      // A coluna "ID" da EMPREGADOS não tem auto-incremento: geramos IDs
      // sequenciais a partir do maior ID atual.
      let base = 0;
      if (previa.inserts.length > 0) {
        const { data: mx } = await (supabase as any).from("EMPREGADOS").select("ID").order("ID", { ascending: false }).limit(1);
        base = Number(mx?.[0]?.["ID"]) || 0;
      }

      // Um campo com tipo diferente do esperado não pode derrubar o lote nem o
      // registro inteiro: refaz linha a linha e, se o banco apontar a coluna
      // culpada, grava o resto sem ela (a coluna ignorada é reportada no fim).
      const falhas: string[] = [];
      const ignoradas = new Set<string>();
      const gravarTolerante = async (
        exec: (dados: Record<string, any>) => Promise<{ error: any }>,
        dados: Record<string, any>, rotulo: string,
      ): Promise<boolean> => {
        const atual = { ...dados };
        for (let tent = 0; tent < 8; tent++) {
          const { error } = await exec(atual);
          if (!error) return true;
          const culpada = colunaCulpada(error.message || "", atual);
          if (!culpada || Object.keys(atual).length <= 1) { falhas.push(`${rotulo}: ${error.message}`); return false; }
          delete atual[culpada];
          ignoradas.add(culpada);
        }
        falhas.push(`${rotulo}: não foi possível gravar.`);
        return false;
      };

      let insOk = 0;
      for (let i = 0; i < previa.inserts.length; i += 200) {
        const chunk = previa.inserts.slice(i, i + 200).map((p, j) => ({ ...p, ID: base + i + j + 1 }));
        const { error } = await (supabase as any).from("EMPREGADOS").insert(chunk);
        if (error) {
          for (const linha of chunk) {
            const ok = await gravarTolerante(d => (supabase as any).from("EMPREGADOS").insert([d]), linha,
              `Novo ${linha["Nome"]} (CPF ${linha["CPF"]})`);
            if (ok) insOk++;
          }
        } else insOk += chunk.length;
        setProg(`Inserindo colaboradores novos… ${insOk}/${previa.inserts.length}`);
      }

      // Agrupa registros que compartilham EXATAMENTE o mesmo patch (ex.: vários
      // "Trabalhando → Demitido") para minimizar chamadas; patches únicos
      // (salário individual etc.) caem em grupos de 1.
      const grupos = new Map<string, { patch: Record<string, any>; ids: any[] }>();
      for (const u of previa.updates) {
        const key = JSON.stringify(u.patch);
        const g = grupos.get(key) || { patch: u.patch, ids: [] };
        g.ids.push(u.id); grupos.set(key, g);
      }
      let upOk = 0;
      for (const { patch, ids } of grupos.values()) {
        for (let i = 0; i < ids.length; i += 300) {
          const chunk = ids.slice(i, i + 300);
          const { error } = await (supabase as any).from("EMPREGADOS").update(patch).in("ID", chunk);
          if (error) {
            for (const id of chunk) {
              const ok = await gravarTolerante(d => (supabase as any).from("EMPREGADOS").update(d).eq("ID", id), patch, `ID ${id}`);
              if (ok) upOk++;
            }
          } else upOk += chunk.length;
          setProg(`Atualizando colaboradores… ${upOk}/${previa.totalUpdates}`);
        }
      }

      if (ignoradas.size) falhas.unshift(`Coluna(s) que o banco recusou e ficaram de fora: ${[...ignoradas].join(", ")}`);
      setErros(falhas);
      setProg(`${insOk} novo(s) inserido(s) · ${upOk} colaborador(es) atualizado(s).`);
      setFase("fim");
      onImported();
    } catch (e: any) {
      setErro(e?.message || String(e)); setFase("previa");
    }
  };

  return (
    <>
      <button className="col-btn" onClick={abrir} style={{ background: "#0f3171", color: "#fff", borderColor: "#0f3171", display: "inline-flex", alignItems: "center", gap: 7 }}>
        <Upload size={15} /> Importar Excel
      </button>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) lerArquivo(f); }} />

      {open && (
        <div onClick={ev => { if (ev.target === ev.currentTarget) fechar(); }}
          style={{ position: "fixed", inset: 0, zIndex: 800, background: "rgba(15,23,42,.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 620, maxHeight: "90vh", display: "flex", flexDirection: "column", position: "relative" }}>
            {fase !== "aplicando" && fase !== "lendo" && (
              <button onClick={fechar} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", color: "#94a3b8", cursor: "pointer", zIndex: 1 }}><X size={20} /></button>
            )}
            <div style={{ padding: "20px 22px 12px" }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 9 }}>
                <FileSpreadsheet size={20} color="#0f3171" /> Importar colaboradores
              </div>
              <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>
                Vínculo ativo atualiza a <b>Situação</b>; quem está <b>Trabalhando</b> tem <b>todo o cadastro</b> (salário, cargo, admissão, lotação, escala, posto, banco…) acompanhando a planilha. Em férias/atestado, só os campos <b>vazios</b> são preenchidos. Quem está <b>demitido</b> não é reativado: se voltar ativo na planilha, entra como <b>linha nova</b> (readmissão). <b>MEI não é alterado</b> em nada.
              </div>
            </div>

            <div style={{ padding: "0 22px 4px", overflowY: "auto", flex: 1 }}>
              {erro && (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, marginBottom: 12 }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{erro}</span>
                </div>
              )}

              {fase === "idle" && (
                <button onClick={escolher} style={{ width: "100%", border: "2px dashed #c7d2e5", background: "#f8fbff", borderRadius: 14, padding: "34px 16px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: "#0f3171" }}>
                  <Upload size={30} />
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Selecionar planilha (.xlsx)</div>
                  <div style={{ fontSize: 12, color: "#64748b", textAlign: "center", maxWidth: 400 }}>
                    Use o export do sistema de folha. O casamento é por CPF; a mesma pessoa em vários postos é consolidada em um cadastro.
                  </div>
                </button>
              )}

              {fase === "lendo" && <div style={{ padding: "40px 0", textAlign: "center", color: "#64748b", fontSize: 13.5 }}>Lendo planilha…</div>}

              {(fase === "previa" || fase === "fim") && previa && (
                <>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                    <ResumoCard icon={<UserPlus size={16} />} cor="#15803d" n={previa.inserts.length} label="novos (insert)"
                      sub={previa.readmissoes > 0 ? `${previa.novosCpf} novo(s) + ${previa.readmissoes} readmissão(ões)` : undefined} />
                    <ResumoCard icon={<RefreshCw size={16} />} cor="#2563eb" n={previa.totalUpdates} label="a atualizar"
                      sub={`${previa.totalSituacao} situação · ${previa.totalCadastro} cadastro (${previa.totalCampos} campo(s))`} />
                    <ResumoCard icon={<CheckCircle2 size={16} />} cor="#64748b" n={previa.semMudanca} label="sem mudança" />
                  </div>
                  <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 12 }}>
                    {previa.totalLinhas.toLocaleString("pt-BR")} linha(s) lida(s) · {previa.totalCpfs.toLocaleString("pt-BR")} CPF(s) distinto(s) · {previa.colunasMapeadas} coluna(s) reconhecida(s)
                    {previa.mei > 0 && ` · ${previa.mei} MEI ignorado(s)`}
                    {previa.ignorados > 0 && ` · ${previa.ignorados} sem CPF/nome`}
                  </div>

                  {Object.keys(previa.mudaResumo).length > 0 && (
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", marginBottom: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", padding: "9px 12px", background: "#f8fafc", borderBottom: "1px solid #eef2f7" }}>
                        Mudanças de situação
                      </div>
                      <div style={{ maxHeight: 210, overflowY: "auto" }}>
                        {Object.entries(previa.mudaResumo).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 12px", fontSize: 12.5, borderTop: "1px solid #f1f5f9", color: "#334155" }}>
                            <span>{k}</span><span style={{ fontWeight: 800, color: "#0f172a" }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {Object.keys(previa.cadastroResumo).length > 0 && (
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", marginBottom: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", padding: "9px 12px", background: "#f8fafc", borderBottom: "1px solid #eef2f7" }}>
                        Dados cadastrais a atualizar
                      </div>
                      <div style={{ maxHeight: 210, overflowY: "auto" }}>
                        {Object.entries(previa.cadastroResumo).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 12px", fontSize: 12.5, borderTop: "1px solid #f1f5f9", color: "#334155" }}>
                            <span>{k}</span><span style={{ fontWeight: 800, color: "#0f172a" }}>{v} colaborador(es)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {fase === "fim" && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#ecfdf3", border: "1px solid #86efac", color: "#15803d", borderRadius: 10, padding: "12px 14px", fontSize: 13, fontWeight: 600, margin: "12px 0" }}>
                      <CheckCircle2 size={18} /> {prog || "Importação concluída."}
                    </div>
                  )}

                  {fase === "fim" && erros.length > 0 && (
                    <div style={{ border: "1px solid #fed7aa", background: "#fff7ed", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "#9a3412", textTransform: "uppercase", letterSpacing: ".4px", padding: "9px 12px", borderBottom: "1px solid #fed7aa" }}>
                        {erros.length} registro(s) o banco recusou
                      </div>
                      <div style={{ maxHeight: 160, overflowY: "auto" }}>
                        {erros.slice(0, 50).map((m, i) => (
                          <div key={i} style={{ padding: "7px 12px", fontSize: 11.5, color: "#7c2d12", borderTop: i ? "1px solid #fed7aa" : "none" }}>{m}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {fase === "aplicando" && (
                <div style={{ padding: "34px 0", textAlign: "center" }}>
                  <RefreshCw size={26} color="#0f3171" style={{ animation: "spin 1s linear infinite" }} />
                  <div style={{ fontSize: 13.5, color: "#334155", marginTop: 12, fontWeight: 600 }}>{prog || "Aplicando…"}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Não feche esta janela.</div>
                  <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 22px", borderTop: "1px solid #e2e8f0" }}>
              {fase === "previa" && (
                <>
                  <button className="col-btn" onClick={fechar}>Cancelar</button>
                  <button className="col-btn" onClick={aplicar} disabled={previa != null && previa.inserts.length === 0 && previa.totalUpdates === 0}
                    style={{ background: "#0f3171", color: "#fff", borderColor: "#0f3171", opacity: previa != null && previa.inserts.length === 0 && previa.totalUpdates === 0 ? .5 : 1 }}>
                    Aplicar importação
                  </button>
                </>
              )}
              {fase === "idle" && <button className="col-btn" onClick={fechar}>Fechar</button>}
              {fase === "fim" && <button className="col-btn" onClick={fechar} style={{ background: "#0f3171", color: "#fff", borderColor: "#0f3171" }}>Fechar</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ResumoCard({ icon, cor, n, label, sub }: { icon: any; cor: string; n: number; label: string; sub?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: cor, fontSize: 12, fontWeight: 700 }}>{icon}<span>{label}</span></div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{n.toLocaleString("pt-BR")}</div>
      {sub && <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
