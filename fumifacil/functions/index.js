const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const cors = require('cors')({ origin: true });
const fs = require('fs');
const path = require('path');
const os = require('os');

// Importar utilidades
const { generateInvoicePDF } = require('./utils/pdfGenerator');
const { generateInvoiceXML, validateXML, generateXMLFilename } = require('./utils/xmlGenerator');
const { signXML, verifyXMLSignature, decryptCertificate } = require('./utils/xmlSigner');
const { sendInvoiceToDGII, simulateDGIISubmission, checkInvoiceStatus, simulateStatusCheck } = require('./utils/dgiiApi');

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

    const { invoiceId, testMode = true } = data;

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
    
    // Obtener datos del cliente
    const clientSnapshot = await admin.firestore().collection('clients').doc(invoiceData.clientId).get();
    
    if (!clientSnapshot.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'El cliente especificado no existe.'
      );
    }
    
    const clientData = clientSnapshot.data();
    
    // Obtener datos de la empresa
    const companySnapshot = await admin.firestore().collection('settings').doc('company').get();
    
    if (!companySnapshot.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'No se encontraron datos de la empresa.'
      );
    }
    
    const companyData = companySnapshot.data();
    
    // Generar el XML de la factura
    const xmlString = generateInvoiceXML(invoiceData, companyData, clientData);
    
    // Validar el XML
    const isValid = validateXML(xmlString);
    
    if (!isValid) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'El XML generado no es válido.'
      );
    }
    
    // Obtener el certificado digital
    const certificateSnapshot = await admin.firestore().collection('settings').doc('certificate').get();
    
    if (!certificateSnapshot.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'No se encontró el certificado digital.'
      );
    }
    
    const certificateData = certificateSnapshot.data();
    
    // Desencriptar el certificado
    // En un entorno real, la clave de encriptación debería estar en una variable de entorno
    const encryptionKey = functions.config().certificate?.key || 'default-encryption-key';
    const certificate = decryptCertificate(certificateData.certificate, encryptionKey);
    const privateKey = decryptCertificate(certificateData.privateKey, encryptionKey);
    
    // Firmar el XML
    const signedXml = signXML(xmlString, certificate, privateKey, certificateData.password);
    
    // Guardar el XML firmado en Storage
    const bucket = admin.storage().bucket();
    const xmlFileName = generateXMLFilename(companyData.rnc, invoiceData.invoiceNumber);
    const tempXmlPath = path.join(os.tmpdir(), xmlFileName);
    
    fs.writeFileSync(tempXmlPath, signedXml);
    
    await bucket.upload(tempXmlPath, {
      destination: `invoices/xml/${xmlFileName}`,
      metadata: {
        contentType: 'application/xml'
      }
    });
    
    // Eliminar el archivo temporal
    fs.unlinkSync(tempXmlPath);
    
    // Obtener la URL del XML
    const xmlFile = bucket.file(`invoices/xml/${xmlFileName}`);
    const [xmlUrl] = await xmlFile.getSignedUrl({
      action: 'read',
      expires: '03-01-2500' // Fecha lejana para una URL "permanente"
    });
    
    // En un entorno real, aquí se enviaría el XML a la DGII
    // Para este ejemplo, simulamos la respuesta
    let dgiiResponse;
    
    if (testMode) {
      dgiiResponse = await simulateDGIISubmission(signedXml);
    } else {
      // Aquí iría el código para enviar a la DGII real
      // Obtener credenciales de la DGII
      const dgiiCredentials = {
        username: functions.config().dgii?.username || '',
        password: functions.config().dgii?.password || '',
        rnc: companyData.rnc,
        token: '' // Se obtendría con getAuthToken
      };
      
      dgiiResponse = await sendInvoiceToDGII(signedXml, dgiiCredentials, testMode);
    }
    
    // Actualizar la factura con la información de la DGII
    await admin.firestore().collection('invoices').doc(invoiceId).update({
      status: 'enviada',
      trackId: dgiiResponse.trackId,
      xmlUrl: xmlUrl,
      dgiiSubmissionDate: admin.firestore.FieldValue.serverTimestamp(),
      dgiiResponse: dgiiResponse
    });

    return { 
      success: true, 
      trackId: dgiiResponse.trackId,
      xmlUrl: xmlUrl,
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
    
    const invoiceData = invoiceSnapshot.data();
    
    // Obtener datos del cliente
    const clientSnapshot = await admin.firestore().collection('clients').doc(invoiceData.clientId).get();
    
    if (!clientSnapshot.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'El cliente especificado no existe.'
      );
    }
    
    const clientData = clientSnapshot.data();
    
    // Obtener datos de la empresa
    const companySnapshot = await admin.firestore().collection('settings').doc('company').get();
    const companyData = companySnapshot.exists ? companySnapshot.data() : {};
    
    // Generar el PDF
    const pdfBuffer = await generateInvoicePDF(invoiceData, companyData, clientData);
    
    // Guardar el PDF en Storage
    const bucket = admin.storage().bucket();
    const tempPdfPath = path.join(os.tmpdir(), `invoice_${invoiceId}.pdf`);
    
    fs.writeFileSync(tempPdfPath, pdfBuffer);
    
    await bucket.upload(tempPdfPath, {
      destination: `invoices/${invoiceId}.pdf`,
      metadata: {
        contentType: 'application/pdf'
      }
    });
    
    // Eliminar el archivo temporal
    fs.unlinkSync(tempPdfPath);
    
    // Obtener la URL del PDF
    const pdfFile = bucket.file(`invoices/${invoiceId}.pdf`);
    const [pdfUrl] = await pdfFile.getSignedUrl({
      action: 'read',
      expires: '03-01-2500' // Fecha lejana para una URL "permanente"
    });
    
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

/**
 * Cloud Function para verificar el estado de una factura en la DGII
 * Recibe: invoiceId
 * Consulta el estado de la factura en la DGII y actualiza la información en Firestore
 */
exports.checkInvoiceStatus = functions.https.onCall(async (data, context) => {
  try {
    // Verificar autenticación
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'El usuario debe estar autenticado para verificar el estado de facturas.'
      );
    }

    const { invoiceId, testMode = true } = data;

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
    
    if (!invoiceData.trackId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'La factura no ha sido enviada a la DGII.'
      );
    }
    
    // Obtener datos de la empresa
    const companySnapshot = await admin.firestore().collection('settings').doc('company').get();
    const companyData = companySnapshot.exists ? companySnapshot.data() : {};
    
    // Verificar el estado de la factura
    let statusResponse;
    
    if (testMode) {
      statusResponse = await simulateStatusCheck(invoiceData.trackId);
    } else {
      // Aquí iría el código para consultar a la DGII real
      // Obtener credenciales de la DGII
      const dgiiCredentials = {
        username: functions.config().dgii?.username || '',
        password: functions.config().dgii?.password || '',
        rnc: companyData.rnc,
        token: '' // Se obtendría con getAuthToken
      };
      
      statusResponse = await checkInvoiceStatus(invoiceData.trackId, dgiiCredentials, testMode);
    }
    
    // Actualizar la factura con el estado
    await admin.firestore().collection('invoices').doc(invoiceId).update({
      status: statusResponse.status.toLowerCase(),
      dgiiStatusDate: admin.firestore.FieldValue.serverTimestamp(),
      dgiiStatusResponse: statusResponse
    });
    
    return {
      success: true,
      status: statusResponse.status,
      message: statusResponse.message,
      data: statusResponse
    };
  } catch (error) {
    console.error('Error al verificar estado de factura:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Cloud Function que se ejecuta cuando se crea una nueva factura
 * Genera automáticamente el PDF y envía la factura a la DGII si está configurado
 */
exports.onInvoiceCreated = functions.firestore
  .document('invoices/{invoiceId}')
  .onCreate(async (snapshot, context) => {
    try {
      const invoiceData = snapshot.data();
      const invoiceId = context.params.invoiceId;
      
      // Verificar si la factura está lista para procesamiento automático
      if (invoiceData.status !== 'pendiente' || invoiceData.autoProcess === false) {
        return null;
      }
      
      // Generar el PDF automáticamente
      const generatePdfResult = await exports.generateInvoicePDF({
        invoiceId
      }, { auth: { uid: 'system' } });
      
      console.log('PDF generado automáticamente:', generatePdfResult);
      
      // Verificar si se debe enviar automáticamente a la DGII
      if (invoiceData.autoSendToDGII === true) {
        const sendToDGIIResult = await exports.sendInvoiceToDGII({
          invoiceId,
          testMode: true // Usar modo de prueba por defecto
        }, { auth: { uid: 'system' } });
        
        console.log('Factura enviada automáticamente a la DGII:', sendToDGIIResult);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error en procesamiento automático de factura:', error);
      return { success: false, error: error.message };
    }
  });
