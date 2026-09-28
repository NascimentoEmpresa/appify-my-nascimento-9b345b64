/**
 * Imagens coladas com Ctrl+V (print da tela, recorte do Windows etc.).
 *
 * Nasceu dentro da conversa do chamado (ChatChamado) e saiu para cá em
 * 28/09/2026, quando o "Abrir chamado" também passou a aceitar Ctrl+V — duas
 * cópias iam divergir na primeira correção.
 *
 * Print colado chega sem nome útil ("image.png", às vezes vazio): ganha um
 * nome com data/hora, e um sufixo quando vêm vários de uma vez — senão dois
 * prints colados no mesmo segundo viravam anexos com o mesmo nome.
 */
export function imagensDoClipboard(dados: Pick<DataTransfer, "items"> | null | undefined, agora = new Date()): File[] {
  const arquivos = Array.from(dados?.items ?? [])
    .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f);

  const carimbo = agora.toISOString().slice(0, 19).replace(/[:T-]/g, "");
  return arquivos.map((f, idx) => {
    if (f.name && f.name !== "image.png") return f;
    const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const sufixo = arquivos.length > 1 ? `-${idx + 1}` : "";
    return new File([f], `print-${carimbo}${sufixo}.${ext}`, { type: f.type });
  });
}
