export type TargetLanguage = 'DE' | 'EN';
export type InvoiceDestination = 'KSEF' | 'TRANSLATED_PDF';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  language: TargetLanguage;
  destination: InvoiceDestination;
  shouldTranslate: boolean;
  country?: string;
}

export class InvoiceValidationService {
  private static readonly GERMAN_SPEAKING_COUNTRIES = new Set(['DE', 'AT', 'CH', 'LI', 'LU']);

  public validate(invoiceData: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!invoiceData || typeof invoiceData !== 'object' || Object.keys(invoiceData).length === 0) {
      return {
        isValid: false,
        errors: ['Invoice data is missing or empty.'],
        warnings: [],
        language: 'EN',
        destination: 'TRANSLATED_PDF',
        shouldTranslate: true,
      };
    }

    const country = this.extractCountry(invoiceData);
    if (!country) {
      errors.push('Country information is required in invoice data (e.g., billToCountry, contractor.country, shipToCountry).');
    }

    const docEntry = invoiceData.docEntry ?? invoiceData.DocEntry;
    const docNum = invoiceData.docNum ?? invoiceData.DocNum;
    if (docEntry === undefined && docNum === undefined) {
      warnings.push('Invoice document entry or document number (docEntry / docNum) is missing.');
    }

    const contractor = invoiceData.contractor ?? invoiceData.BusinessPartner;
    if (!contractor && !invoiceData.cardCode && !invoiceData.CardCode) {
      warnings.push('Contractor/Business Partner information is missing.');
    }

    const currency = this.extractCurrency(invoiceData);
    if (!currency) {
      warnings.push('Currency information is missing.');
    }

    const items = invoiceData.invoiceItems ?? invoiceData.InvoiceItems ?? invoiceData.items ?? invoiceData.DocumentLines;
    if (Array.isArray(items)) {
      if (items.length === 0) {
        warnings.push('Invoice contains no line items.');
      } else {
        items.forEach((item, index) => {
          if (item.quantity !== undefined && item.quantity <= 0) {
            errors.push(`Item at line ${index + 1} has an invalid quantity (${item.quantity}).`);
          }
          if (item.unitPrice !== undefined && item.unitPrice < 0) {
            errors.push(`Item at line ${index + 1} has a negative unit price.`);
          }
        });
      }
    }


    const normalizedCountry = country ? country.toUpperCase().trim() : '';
    const isPoland = normalizedCountry === 'PL';
    const destination: InvoiceDestination = isPoland ? 'KSEF' : 'TRANSLATED_PDF';
    const shouldTranslate = !isPoland;

  
    const language = this.determineLanguage(invoiceData, normalizedCountry);

    const isValid = errors.length === 0;

    return {
      isValid,
      errors,
      warnings,
      language,
      destination,
      shouldTranslate,
      country: normalizedCountry || undefined,
    };
  }

  private extractCountry(data: any): string | null {
    const rawCountry =
      data.billToCountry ||
      data.contractor?.country ||
      data.shipToCountry ||
      data.country ||
      data.Header?.Country ||
      data.Country;

    return typeof rawCountry === 'string' && rawCountry.trim() ? rawCountry.trim() : null;
  }

  private extractCurrency(data: any): string | null {
    const currency = typeof data.currency === 'object' ? data.currency?.code : data.currency;
    const finalCurrency = currency || data.DocCurrency || data.Currency;
    return typeof finalCurrency === 'string' && finalCurrency.trim() ? finalCurrency.trim() : null;
  }

  private determineLanguage(data: any, country: string): TargetLanguage {
    const rawLang =
      (typeof data.invoiceLanguage === 'object' ? data.invoiceLanguage?.code : data.invoiceLanguage) ||
      data.language ||
      data.Language ||
      data.DocLanguage ||
      data.Header?.Language;

    if (typeof rawLang === 'string') {
      const normalizedLang = rawLang.toUpperCase().trim();
      if (normalizedLang === 'DE' || normalizedLang === 'GERMAN' || normalizedLang === 'DEUTSCH') {
        return 'DE';
      }
      if (normalizedLang === 'EN' || normalizedLang === 'ENGLISH') {
        return 'EN';
      }
    }

    if (InvoiceValidationService.GERMAN_SPEAKING_COUNTRIES.has(country)) {
      return 'DE';
    }

    return 'EN';
  }
}

export const invoiceValidationService = new InvoiceValidationService();
