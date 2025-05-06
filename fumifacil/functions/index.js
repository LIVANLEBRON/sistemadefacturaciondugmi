const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const cors = require('cors')({ origin: true });
const fs = require('fs');
const path = require('path');
const os = require('os');

admin.initializeApp();

/**
 * Configuración del transporte de correo
 * En producción, deberías usar un servicio de correo como SendGrid, Mailgun, etc.
 * Para desarrollo, puedes usar un servicio SMTP como Gmail o Mailtrap
 */
const mailTransport = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: functions.config().email.user,
    pass: functions.config().email.password
  }
});

/**
 * Cloud Function para enviar facturas por correo electrónico
 * Recibe: invoiceId, recipientEmail, subject, message
 * Descarga el PDF de la factura y lo envía como adjunto
 */
exports.sendInvoiceEmail = functions.https.onCall(async (data, context) => {
  try {
    // Verificar autenticación
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'El usuario debe estar autenticado para enviar correos.'
      );
    }

    const { invoiceId, recipientEmail, subject, message } = data;

    if (!invoiceId || !recipientEmail) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Se requiere ID de factura y correo del destinatario.'
      );
    }

    // Obtener datos de la factura
    const invoiceSnapshot = await admin.firestore().collection('invoices').doc(invoiceId).get();
    
    if (!invoiceSnapshot.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'La factura especificada no existe.'
      );
    }

    const invoiceData = invoiceSnapshot.data();
    
    // Obtener datos de la empresa
    const companySnapshot = await admin.firestore().collection('settings').doc('company').get();
    const companyData = companySnapshot.exists ? companySnapshot.data() : {};

    // Descargar el PDF de la factura desde Storage
    const bucket = admin.storage().bucket();
    const tempFilePath = path.join(os.tmpdir(), `invoice_${invoiceId}.pdf`);
    
    await bucket.file(`invoices/${invoiceId}.pdf`).download({ destination: tempFilePath });

    // Preparar el correo electrónico
    const mailOptions = {
      from: `"${companyData.name || 'Sistema de Facturación'}" <${functions.config().email.user}>`,
      to: recipientEmail,
      subject: subject || `Factura Electrónica #${invoiceData.invoiceNumber || invoiceId}`,
      text: message || `Adjunto encontrará su factura electrónica. Gracias por su preferencia.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
            ${companyData.logoUrl ? `<img src="${companyData.logoUrl}" alt="Logo" style="max-height: 80px; margin-bottom: 15px;">` : ''}
            <h2 style="color: #333;">${companyData.name || 'Sistema de Facturación'}</h2>
          </div>
          <div style="padding: 20px;">
            <p>Estimado cliente,</p>
            <p>${message || 'Adjunto encontrará su factura electrónica. Gracias por su preferencia.'}</p>
            <p>Detalles de la factura:</p>
            <ul>
              <li><strong>Número de factura:</strong> ${invoiceData.invoiceNumber || invoiceId}</li>
              <li><strong>Fecha:</strong> ${invoiceData.date ? new Date(invoiceData.date.toDate()).toLocaleDateString() : new Date().toLocaleDateString()}</li>
              <li><strong>Total:</strong> RD$ ${invoiceData.total ? invoiceData.total.toLocaleString('es-DO', { minimumFractionDigits: 2 }) : '0.00'}</li>
            </ul>
            <p>Para cualquier consulta, no dude en contactarnos.</p>
            <p>Atentamente,</p>
            <p><strong>${companyData.name || 'Sistema de Facturación'}</strong><br>
            ${companyData.address || ''}<br>
            ${companyData.phone || ''}<br>
            ${companyData.email || functions.config().email.user}</p>
          </div>
          <div style="background-color: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #666;">
            <p>Este es un correo electrónico automático. Por favor, no responda a este mensaje.</p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `Factura_${invoiceData.invoiceNumber || invoiceId}.pdf`,
          path: tempFilePath,
          contentType: 'application/pdf'
        }
      ]
    };

    // Enviar el correo
    await mailTransport.sendMail(mailOptions);

    // Limpiar archivos temporales
    fs.unlinkSync(tempFilePath);

    // Actualizar la factura con la información del correo enviado
    await admin.firestore().collection('invoices').doc(invoiceId).update({
      emailSent: true,
      emailSentDate: admin.firestore.FieldValue.serverTimestamp(),
      emailRecipient: recipientEmail
    });

    return { success: true, message: 'Correo enviado correctamente' };
  } catch (error) {
    console.error('Error al enviar correo:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Cloud Function para enviar facturas a la DGII
 * Recibe: invoiceId
 * Genera el XML, lo firma y lo envía a la DGII
 * En un entorno real, aquí se implementaría la integración con la API de la DGII
 */
exports.sendInvoiceToDGII = functions.https.onCall(async (data, context) => {
  try {
    // Verificar autenticación
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'El usuario debe estar autenticado para enviar facturas a la DGII.'
      );
    }

    const { invoiceId } = data;

    if (!invoiceId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Se requiere ID de factura.'
      );
    }

    // Obtener datos de la factura
    const invoiceSnapshot = await admin.firestore().collection('invoices').doc(invoiceId).get();
    
    if (!invoiceSnapshot.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'La factura especificada no existe.'
      );
    }

    const invoiceData = invoiceSnapshot.data();
    
    // En un entorno real, aquí se generaría el XML, se firmaría y se enviaría a la DGII
    // Para este ejemplo, simularemos una respuesta exitosa

    // Generar un TrackID único para la factura
    const trackId = `DGII-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Actualizar la factura con la información de la DGII
    await admin.firestore().collection('invoices').doc(invoiceId).update({
      status: 'enviada',
      trackId: trackId,
      dgiiSubmissionDate: admin.firestore.FieldValue.serverTimestamp(),
      dgiiResponse: {
        success: true,
        trackId: trackId,
        message: 'Factura recibida correctamente por la DGII'
      }
    });

    return { 
      success: true, 
      trackId: trackId,
      message: 'Factura enviada correctamente a la DGII'
    };
  } catch (error) {
    console.error('Error al enviar factura a la DGII:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Cloud Function para generar el PDF de una factura
 * Recibe: invoiceId
 * Genera el PDF y lo guarda en Storage
 */
exports.generateInvoicePDF = functions.https.onCall(async (data, context) => {
  try {
    // Verificar autenticación
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'El usuario debe estar autenticado para generar PDFs.'
      );
    }

    const { invoiceId } = data;

    if (!invoiceId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Se requiere ID de factura.'
      );
    }

    // Obtener datos de la factura
    const invoiceSnapshot = await admin.firestore().collection('invoices').doc(invoiceId).get();
    
    if (!invoiceSnapshot.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'La factura especificada no existe.'
      );
    }

    // En un entorno real, aquí se generaría el PDF utilizando una biblioteca como PDFKit o jsPDF
    // Para este ejemplo, simularemos que se ha generado y guardado correctamente

    // URL simulada del PDF
    const pdfUrl = `https://storage.googleapis.com/${admin.storage().bucket().name}/invoices/${invoiceId}.pdf`;

    // Actualizar la factura con la URL del PDF
    await admin.firestore().collection('invoices').doc(invoiceId).update({
      pdfUrl: pdfUrl,
      pdfGeneratedDate: admin.firestore.FieldValue.serverTimestamp()
    });

    return { 
      success: true, 
      pdfUrl: pdfUrl,
      message: 'PDF generado correctamente'
    };
  } catch (error) {
    console.error('Error al generar PDF:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});
