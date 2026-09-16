import i18next from 'i18next';
import cds from '@sap/cds';
import path from 'path';
import fs from 'fs';

const logger = cds.log('translationService');

let i18nInitialized = false;

export type SupportedLanguage = 'en' | 'de' | 'pl';

export interface TranslationOptions {
  sourceLanguage?: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  invoiceData?: any;
}

const germanSpeakingCountries = ['DE', 'AT', 'CH', 'LI'];

export function detectTargetLanguage(invoiceData: any): SupportedLanguage {
  const country = invoiceData?.contractor?.country 
    || invoiceData?.billToCountry 
    || invoiceData?.shipToCountry;
  
  if (country && germanSpeakingCountries.includes(country.toUpperCase())) {
    return 'de';
  }
  
  return 'en';
}

async function initializeI18n(): Promise<void> {
  if (i18nInitialized) return;
  
  const localesDir = path.join(__dirname, '..', 'locales');
  
  if (!fs.existsSync(localesDir)) {
    fs.mkdirSync(localesDir, { recursive: true });
  }

  const resources = {
    en: {
      translation: await loadLocale('en', localesDir)
    },
    de: {
      translation: await loadLocale('de', localesDir)
    },
    pl: {
      translation: await loadLocale('pl', localesDir)
    }
  };

  await i18next.init({
    lng: 'en',
    fallbackLng: 'en',
    debug: process.env.NODE_ENV === 'development',
    resources,
    interpolation: {
      escapeValue: false
    }
  });

  i18nInitialized = true;
  logger.info('i18next initialized successfully');
}

async function loadLocale(lang: string, localesDir: string): Promise<Record<string, string>> {
  const filePath = path.join(localesDir, `${lang}.json`);
  
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.warn(`Failed to load locale ${lang}:`, error);
    }
  }
  
  const supportedLang = lang as SupportedLanguage;
  return getDefaultTranslations(supportedLang);
}

function getDefaultTranslations(lang: SupportedLanguage): Record<string, string> {
  const defaults: Record<SupportedLanguage, Record<string, string>> = {
    en: {
      invoice: 'Invoice',
      invoiceNumber: 'Invoice No.',
      invoiceDate: 'Invoice Date',
      dueDate: 'Due Date',
      currency: 'Currency',
      language: 'Language',
      billTo: 'Bill To',
      shipTo: 'Ship To',
      description: 'Description',
      quantity: 'Qty',
      unit: 'Unit',
      unitPrice: 'Unit Price',
      vat: 'VAT',
      total: 'Total',
      subtotal: 'Subtotal',
      notes: 'Notes',
      thankYou: 'Thank you for your business!',
      generatedOn: 'Generated on',
      company: 'Company',
      address: 'Address',
      phone: 'Phone',
      email: 'Email',
      vatId: 'VAT ID',
      vatSum: 'VAT Sum'
    },
    de: {
      invoice: 'Rechnung',
      invoiceNumber: 'Rechnungsnr.',
      invoiceDate: 'Rechnungsdatum',
      dueDate: 'Fälligkeitsdatum',
      currency: 'Währung',
      language: 'Sprache',
      billTo: 'Rechnungsempfänger',
      shipTo: 'Lieferadresse',
      description: 'Beschreibung',
      quantity: 'Menge',
      unit: 'Einheit',
      unitPrice: 'Einzelpreis',
      vat: 'MwSt.',
      total: 'Gesamt',
      subtotal: 'Zwischensumme',
      notes: 'Anmerkungen',
      thankYou: 'Vielen Dank für Ihren Auftrag!',
      generatedOn: 'Erstellt am',
      company: 'Firma',
      address: 'Adresse',
      phone: 'Telefon',
      email: 'E-Mail',
      vatId: 'USt-IdNr.',
      vatSum: 'MwSt.-Summe'
    },
    pl: {
      invoice: 'Faktura',
      invoiceNumber: 'Nr faktury',
      invoiceDate: 'Data faktury',
      dueDate: 'Termin płatności',
      currency: 'Waluta',
      language: 'Język',
      billTo: 'Nabywca',
      shipTo: 'Adres dostawy',
      description: 'Opis',
      quantity: 'Ilość',
      unit: 'Jedn.',
      unitPrice: 'Cena jedn.',
      vat: 'VAT',
      total: 'Suma',
      subtotal: 'Suma częściowa',
      notes: 'Uwagi',
      thankYou: 'Dziękujemy za zakupy!',
      generatedOn: 'Wygenerowano',
      company: 'Firma',
      address: 'Adres',
      phone: 'Telefon',
      email: 'E-mail',
      vatId: 'NIP',
      vatSum: 'Suma VAT'
    }
  };
  
  return defaults[lang] || defaults.en;
}

export async function translateInvoice(
  invoiceData: any,
  targetLanguage?: SupportedLanguage
): Promise<any> {
  await initializeI18n();
  
  const lang = targetLanguage || detectTargetLanguage(invoiceData);
  
  await i18next.changeLanguage(lang);
  
  const t = i18next.t.bind(i18next);
  
  const translatedData = {
    ...invoiceData,
    _translations: {
      invoice: t('invoice'),
      invoiceNumber: t('invoiceNumber'),
      invoiceDate: t('invoiceDate'),
      dueDate: t('dueDate'),
      currency: t('currency'),
      language: t('language'),
      billTo: t('billTo'),
      shipTo: t('shipTo'),
      description: t('description'),
      quantity: t('quantity'),
      unit: t('unit'),
      unitPrice: t('unitPrice'),
      vat: t('vat'),
      total: t('total'),
      subtotal: t('subtotal'),
      notes: t('notes'),
      thankYou: t('thankYou'),
      generatedOn: t('generatedOn'),
      company: t('company'),
      address: t('address'),
      phone: t('phone'),
      email: t('email'),
      vatId: t('vatId'),
      vatSum: t('vatSum')
    },
    _language: lang
  };
  
  logger.info(`Invoice translated to ${lang.toUpperCase()}`, { docEntry: invoiceData.docEntry });
  
  return translatedData;
}

export function getTranslator(language: SupportedLanguage) {
  return i18next.getFixedT(language);
}

export { i18next };