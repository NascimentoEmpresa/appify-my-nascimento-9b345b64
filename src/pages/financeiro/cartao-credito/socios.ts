// SIS-2026-0759: o Responsável pelo Cartão é um dos sócios. Casa pelo nome do usuário (sem acento/caixa),
// exigindo todas as palavras de cada regra, para aceitar "HELENA R NASCIMENTO" ou "Helena Nascimento".
const SOCIOS: string[][] = [
  ["senilton"],
  ["carlos", "eduardo", "nascimento"],
  ["guiomar"],
  ["antonio", "vianei"],
  ["helena", "nascimento"],
];

function normalizar(nome: string): string[] {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function ehSocio(nome: string | null | undefined): boolean {
  if (!nome) return false;
  const palavras = normalizar(nome);
  return SOCIOS.some((regra) => regra.every((r) => palavras.includes(r)));
}
