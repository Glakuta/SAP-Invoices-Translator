import { PdfGenerator } from './PdfGenerator';
import { SapB1PdfGenerator } from './SapB1PdfGenerator';
import { SapS4PdfGenerator } from './SapS4PdfGenerator';
import { LocalPdfGenerator } from './LocalPdfGenerator';
import { SapPdfConfig } from './PdfGenerator';

export type PdfGeneratorMode = 'local' | 'b1sl' | 's4odata';

export interface PdfGeneratorFactoryConfig {
  mode: PdfGeneratorMode;
  outputDir?: string;
  sapB1?: SapPdfConfig;
  sapS4?: SapPdfConfig;
}

export class PdfGeneratorFactory {
  static create(config: PdfGeneratorFactoryConfig): PdfGenerator {
    switch (config.mode) {
      case 'b1sl': {
        if (!config.sapB1) {
          throw new Error('SAP B1 configuration required for b1sl mode');
        }
        return new SapB1PdfGenerator({
          type: 'B1',
          baseUrl: config.sapB1.baseUrl,
          reportPath: config.sapB1.reportPath,
        });
      }
      case 's4odata': {
        if (!config.sapS4) {
          throw new Error('SAP S/4HANA configuration required for s4odata mode');
        }
        return new SapS4PdfGenerator({
          type: 'S4HANA',
          baseUrl: config.sapS4.baseUrl,
          outputTemplateId: config.sapS4.outputTemplateId,
        });
      }
      case 'local':
      default: {
        return new LocalPdfGenerator(config.outputDir);
      }
    }
  }

  static createFromEnv(): PdfGenerator {
    const mode = (process.env.PDF_GENERATOR_MODE || 'local') as PdfGeneratorMode;

    const baseConfig: PdfGeneratorFactoryConfig = {
      mode,
      outputDir: process.env.PDF_OUTPUT_DIR,
    };

    if (mode === 'b1sl') {
      baseConfig.sapB1 = {
        type: 'B1',
        baseUrl: process.env.SAP_B1_BASE_URL || '',
        reportPath: process.env.SAP_B1_REPORT_PATH,
      };
    } else if (mode === 's4odata') {
      baseConfig.sapS4 = {
        type: 'S4HANA',
        baseUrl: process.env.SAP_S4_BASE_URL || '',
        outputTemplateId: process.env.SAP_S4_OUTPUT_TEMPLATE,
      };
    }

    return this.create(baseConfig);
  }
}