import { invoiceValidationService, ValidationResult } from '../srv/validationService';

describe('InvoiceValidationService', () => {
  describe('validate', () => {
    it('should return invalid for empty invoice data', () => {
      const result: ValidationResult = invoiceValidationService.validate({});
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invoice data is missing or empty.');
    });

    it('should return invalid for null invoice data', () => {
      const result: ValidationResult = invoiceValidationService.validate(null);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invoice data is missing or empty.');
    });

    it('should validate invoice with Polish country as KSEF destination', () => {
      const invoiceData = {
        billToCountry: 'PL',
        docEntry: 123,
        docNum: 456,
        cardCode: 'C001',
        cardName: 'Test Customer',
        currency: 'PLN',
      };
      const result: ValidationResult = invoiceValidationService.validate(invoiceData);
      expect(result.isValid).toBe(true);
      expect(result.destination).toBe('KSEF');
      expect(result.shouldTranslate).toBe(false);
    });

    it('should validate invoice with German country as TRANSLATED_PDF destination', () => {
      const invoiceData = {
        billToCountry: 'DE',
        docEntry: 123,
        docNum: 456,
        cardCode: 'C001',
        cardName: 'Test Customer',
        currency: 'EUR',
      };
      const result: ValidationResult = invoiceValidationService.validate(invoiceData);
      expect(result.isValid).toBe(true);
      expect(result.destination).toBe('TRANSLATED_PDF');
      expect(result.shouldTranslate).toBe(true);
      expect(result.language).toBe('DE');
    });

    it('should validate invoice with US country as TRANSLATED_PDF destination with English', () => {
      const invoiceData = {
        billToCountry: 'US',
        docEntry: 123,
        docNum: 456,
        cardCode: 'C001',
        cardName: 'Test Customer',
        currency: 'USD',
      };
      const result: ValidationResult = invoiceValidationService.validate(invoiceData);
      expect(result.isValid).toBe(true);
      expect(result.destination).toBe('TRANSLATED_PDF');
      expect(result.shouldTranslate).toBe(true);
      expect(result.language).toBe('EN');
    });

    it('should warn when docEntry and docNum are missing', () => {
      const invoiceData = {
        billToCountry: 'US',
        cardCode: 'C001',
        cardName: 'Test Customer',
        currency: 'USD',
      };
      const result: ValidationResult = invoiceValidationService.validate(invoiceData);
      expect(result.warnings).toContain('Invoice document entry or document number (docEntry / docNum) is missing.');
    });

    it('should warn when contractor is missing', () => {
      const invoiceData = {
        billToCountry: 'US',
        docEntry: 123,
        currency: 'USD',
      };
      const result: ValidationResult = invoiceValidationService.validate(invoiceData);
      expect(result.warnings).toContain('Contractor/Business Partner information is missing.');
    });

    it('should validate invoice items', () => {
      const invoiceData = {
        billToCountry: 'US',
        docEntry: 123,
        docNum: 456,
        cardCode: 'C001',
        cardName: 'Test Customer',
        currency: 'USD',
        invoiceItems: [
          { itemCode: 'ITEM1', quantity: 2, unitPrice: 100 },
          { itemCode: 'ITEM2', quantity: 1, unitPrice: 50 },
        ],
      };
      const result: ValidationResult = invoiceValidationService.validate(invoiceData);
      expect(result.isValid).toBe(true);
    });

    it('should error on invalid quantity', () => {
      const invoiceData = {
        billToCountry: 'US',
        docEntry: 123,
        docNum: 456,
        cardCode: 'C001',
        cardName: 'Test Customer',
        currency: 'USD',
        invoiceItems: [
          { itemCode: 'ITEM1', quantity: -1, unitPrice: 100 },
        ],
      };
      const result: ValidationResult = invoiceValidationService.validate(invoiceData);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('invalid quantity'))).toBe(true);
    });

    it('should error on negative unit price', () => {
      const invoiceData = {
        billToCountry: 'US',
        docEntry: 123,
        docNum: 456,
        cardCode: 'C001',
        cardName: 'Test Customer',
        currency: 'USD',
        invoiceItems: [
          { itemCode: 'ITEM1', quantity: 1, unitPrice: -10 },
        ],
      };
      const result: ValidationResult = invoiceValidationService.validate(invoiceData);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('negative unit price'))).toBe(true);
    });

    it('should determine language from invoiceLanguage field', () => {
      const invoiceData = {
        billToCountry: 'US',
        docEntry: 123,
        docNum: 456,
        cardCode: 'C001',
        cardName: 'Test Customer',
        currency: 'USD',
        invoiceLanguage: 'DE',
      };
      const result: ValidationResult = invoiceValidationService.validate(invoiceData);
      expect(result.language).toBe('DE');
    });

    it('should determine language from country for German-speaking countries', () => {
      const invoiceData = {
        billToCountry: 'AT',
        docEntry: 123,
        docNum: 456,
        cardCode: 'C001',
        cardName: 'Test Customer',
        currency: 'EUR',
      };
      const result: ValidationResult = invoiceValidationService.validate(invoiceData);
      expect(result.language).toBe('DE');
    });
  });
});

