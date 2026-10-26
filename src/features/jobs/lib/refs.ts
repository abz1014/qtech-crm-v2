/** "QT-26-0031": the year of issue and the number, as the quotation PDF prints it. */
export const quotationRef = (number: number, issuedOn: string): string => `QT-${issuedOn.slice(2, 4)}-${String(number).padStart(4, '0')}`
