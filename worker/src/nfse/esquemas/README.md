Esquemas oficiais da NFS-e nacional, versão 1.01, pacote publicado em 09/02/2026:

https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/nfse-esquemas_xsd-v1-01-20260209.zip

Foram preservados os arquivos originais necessários à validação da DPS.
`documento.js` usa libxml2/WASM sem acesso externo para resolver imports.

O tipo `TSSerieDPS` desse pacote tem o pattern `^0{0,4}\d{1,5}$`. As âncoras
`^` e `$` são caracteres literais em XML Schema 1.0. Para compatibilidade com
libxml2, somente esse pattern é normalizado em memória para
`0{0,4}[0-9]{1,5}`; os arquivos originais permanecem intactos. A série também
é validada integralmente como 1 a 5 algarismos e intervalo 1–49999 antes da
geração e da validação. A normalização não altera o documento transmitido.

A versão efetivamente aceita pelo ambiente municipal de homologação precisa
ser confirmada antes de habilitar a configuração. A existência de versões
mais recentes no ambiente nacional de produção restrita não comprova sua
adoção automática pela API municipal.
