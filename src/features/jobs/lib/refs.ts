/** "QTS-IFL-4810" for a quotation with a customer code (0147), "QT-26-0031" for an older one, as the quotation PDF prints it. */
export const quotationRef = (number: number, issuedOn: string, code?: string | null): string =>
  code ? `QTS-${code}-${number}` : `QT-${issuedOn.slice(2, 4)}-${String(number).padStart(4, '0')}`
