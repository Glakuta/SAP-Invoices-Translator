import nodemailer from 'nodemailer';
import cds from '@sap/cds';

const logger = cds.log('sendEmail');

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    path: string;
    contentType?: string;
  }>;
  docEntry?: number;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const secure = process.env.SMTP_SECURE === 'true';

    if (!host || !user || !pass) {
      logger.warn('SMTP configuration incomplete, using test account');
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: 'test', pass: 'test' }
      });
    }

    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 30000,
    });

    transporter.verify((error: Error | null) => {
      if (error) {
        logger.error('SMTP connection verification failed:', error);
      } else {
        logger.info('SMTP connection verified successfully');
      }
    });
  }
  return transporter;
}

export async function sendEmail(options: EmailOptions): Promise<EmailSendResult> {
  const correlationId = options.docEntry?.toString() || 'unknown';
  
  try {
    logger.info(`[${correlationId}] Sending email to ${options.to}`);

    if (!options.to || !options.to.includes('@')) {
      throw new Error('Invalid recipient email address');
    }

    const transport = getTransporter();
    
    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@example.com',
      to: options.to,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments?.map(att => ({
        filename: att.filename,
        path: att.path,
        contentType: att.contentType || 'application/pdf'
      }))
    };

    const info = await transport.sendMail(mailOptions);
    
    logger.info(`[${correlationId}] Email sent successfully`, { 
      messageId: info.messageId,
      to: options.to,
      subject: options.subject
    });

    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[${correlationId}] Failed to send email:`, { 
      error: errorMessage, 
      to: options.to,
      stack: error instanceof Error ? error.stack : undefined
    });

    let userFriendlyError = errorMessage;
    if (error instanceof Error) {
      if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
        userFriendlyError = 'Cannot connect to mail server';
      } else if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
        userFriendlyError = 'Mail server connection timeout';
      } else if (error.message.includes('EAUTH') || error.message.includes('authentication')) {
        userFriendlyError = 'Mail server authentication failed';
      } else if (error.message.includes('Invalid recipient') || error.message.includes('Invalid email')) {
        userFriendlyError = 'Invalid recipient email address';
      } else if (error.message.includes('attachment') || error.message.includes('ENOENT')) {
        userFriendlyError = 'Failed to attach PDF file';
      }
    }

    return {
      success: false,
      error: userFriendlyError
    };
  }
}

export async function testEmailConnection(): Promise<EmailSendResult> {
  try {
    const transport = getTransporter();
    await transport.verify();
    return { success: true, messageId: 'connection-verified' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('SMTP connection test failed:', error);
    return { success: false, error: `SMTP connection failed: ${errorMessage}` };
  }
}