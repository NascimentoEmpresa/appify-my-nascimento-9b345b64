/**
 * Feriados nacionais fixos + móveis (calculados a partir da Páscoa, algoritmo
 * de Gauss). Cobre só o que vale pra qualquer empresa no Brasil — feriados
 * estaduais/municipais e pontos facultativos locais continuam sendo
 * cadastro manual, não tem como "puxar" isso de forma genérica.
 */
export interface FeriadoNacional {
  data: string; // YYYY-MM-DD
  tipo: "Feriado" | "Ponto Facultativo";
  descricao: string;
}

function pascoa(ano: number): Date {
  // Algoritmo de Gauss (anonymous Gregorian algorithm / Meeus/Jones/Butcher).
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

function addDias(base: Date, dias: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  return d;
}

function fmt(d: Date): string {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export function feriadosNacionais(ano: number): FeriadoNacional[] {
  const pas = pascoa(ano);

  const fixos: FeriadoNacional[] = [
    { data: `${ano}-01-01`, tipo: "Feriado", descricao: "Confraternização Universal" },
    { data: `${ano}-04-21`, tipo: "Feriado", descricao: "Tiradentes" },
    { data: `${ano}-05-01`, tipo: "Feriado", descricao: "Dia do Trabalhador" },
    { data: `${ano}-09-07`, tipo: "Feriado", descricao: "Independência do Brasil" },
    { data: `${ano}-10-12`, tipo: "Feriado", descricao: "Nossa Senhora Aparecida" },
    { data: `${ano}-11-02`, tipo: "Feriado", descricao: "Finados" },
    { data: `${ano}-11-15`, tipo: "Feriado", descricao: "Proclamação da República" },
    { data: `${ano}-12-25`, tipo: "Feriado", descricao: "Natal" },
  ];

  const moveis: FeriadoNacional[] = [
    { data: fmt(addDias(pas, -47)), tipo: "Ponto Facultativo", descricao: "Carnaval" },
    { data: fmt(addDias(pas, -2)), tipo: "Feriado", descricao: "Sexta-feira Santa" },
    { data: fmt(addDias(pas, 60)), tipo: "Ponto Facultativo", descricao: "Corpus Christi" },
  ];

  return [...fixos, ...moveis].sort((a, b) => a.data.localeCompare(b.data));
}
