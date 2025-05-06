import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Container, 
  Paper, 
  Typography, 
  Box, 
  Button,
  Grid,
  Divider,
  Chip,
  IconButton,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle
} from '@mui/material';
import { 
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  FileDownload as FileDownloadIcon,
  Send as SendIcon,
  Print as PrintIcon,
  Email as EmailIcon
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage, functions } from '../../firebase/firebase';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import QRCode from 'qrcode.react';

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resendDialogOpen, setResendDialogOpen] = useState(false);
  
  // Cargar datos de la factura
  useEffect(() => {
    const fetchInvoice = async () => {
      try {
        setLoading(true);
        setError('');
        
        const invoiceDoc = await getDoc(doc(db, 'invoices', id));
        
        if (invoiceDoc.exists()) {
          const invoiceData = invoiceDoc.data();
          setInvoice({
            id: invoiceDoc.id,
            ...invoiceData,
            date: invoiceData.date ? invoiceData.date.toDate() : new Date()
          });
        } else {
          setError('No se encontró la factura solicitada.');
          navigate('/facturas');
        }
      } catch (error) {
        console.error('Error al cargar la factura:', error);
        setError('Error al cargar la factura. Por favor, intenta nuevamente.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchInvoice();
  }, [id, navigate]);

  // Función para descargar PDF
  const handleDownloadPDF = async () => {
    try {
      setLoading(true);
      
      if (invoice.pdfUrl) {
        window.open(invoice.pdfUrl, '_blank');
      } else {
        const pdfRef = ref(storage, `invoices/${id}.pdf`);
        const url = await getDownloadURL(pdfRef);
        window.open(url, '_blank');
      }
    } catch (error) {
      console.error('Error al descargar el PDF:', error);
      setError('Error al descargar el PDF. Por favor, intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  // Función para eliminar factura
  const handleDelete = async () => {
    try {
      setLoading(true);
      await deleteDoc(doc(db, 'invoices', id));
      setSuccess('Factura eliminada correctamente.');
      setTimeout(() => {
        navigate('/facturas');
      }, 2000);
    } catch (error) {
      console.error('Error al eliminar la factura:', error);
      setError('Error al eliminar la factura. Por favor, intenta nuevamente.');
    } finally {
      setLoading(false);
      setDeleteDialogOpen(false);
    }
  };

  // Función para reenviar factura a la DGII
  const handleResend = async () => {
    try {
      setLoading(true);
      
      // Llamar a Cloud Function para enviar a DGII
      const sendInvoiceToDGII = httpsCallable(functions, 'sendInvoiceToDGII');
      const result = await sendInvoiceToDGII({ invoiceId: id });
      
      if (result.data && result.data.success) {
        // Actualizar estado de la factura
        await updateDoc(doc(db, 'invoices', id), {
          status: 'enviada',
          dgiiResponse: result.data
        });
        
        // Actualizar datos locales
        setInvoice(prev => ({
          ...prev,
          status: 'enviada',
          dgiiResponse: result.data
        }));
        
        setSuccess('Factura enviada correctamente a la DGII.');
      } else {
        throw new Error(result.data?.error || 'Error al enviar a DGII');
      }
    } catch (error) {
      console.error('Error al enviar a DGII:', error);
      setError('Error al enviar a DGII. La factura se mantendrá como pendiente para reintento automático.');
    } finally {
      setLoading(false);
      setResendDialogOpen(false);
    }
  };

  // Función para enviar factura por correo
  const handleSendEmail = async () => {
    try {
      setLoading(true);
      
      // Llamar a Cloud Function para enviar por correo
      const sendInvoiceByEmail = httpsCallable(functions, 'sendInvoiceByEmail');
      const result = await sendInvoiceByEmail({ 
        invoiceId: id,
        email: invoice.email
      });
      
      if (result.data && result.data.success) {
        setSuccess('Factura enviada por correo correctamente.');
      } else {
        throw new Error(result.data?.error || 'Error al enviar por correo');
      }
    } catch (error) {
      console.error('Error al enviar por correo:', error);
      setError('Error al enviar la factura por correo. Por favor, intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  // Renderizar estado de la factura
  const renderStatus = (status) => {
    let color;
    let label;
    
    switch (status) {
      case 'enviada':
        color = 'success';
        label = 'Enviada';
        break;
      case 'pendiente':
        color = 'warning';
        label = 'Pendiente';
        break;
      case 'anulada':
        color = 'error';
        label = 'Anulada';
        break;
      default:
        color = 'default';
        label = status;
    }
    
    return <Chip label={label} color={color} />;
  };

  if (loading && !invoice) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (!invoice) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Alert severity="error">
          {error || 'No se pudo cargar la factura.'}
        </Alert>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/facturas')}
          sx={{ mt: 2 }}
        >
          Volver a Facturas
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={() => navigate('/facturas')} sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" component="h1">
          Factura #{invoice.trackId}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ mr: 2 }}>
              Estado:
            </Typography>
            {renderStatus(invoice.status)}
          </Box>
          <Box>
            <Button
              startIcon={<EditIcon />}
              onClick={() => navigate(`/facturas/editar/${id}`)}
              sx={{ mr: 1 }}
            >
              Editar
            </Button>
            <Button
              startIcon={<FileDownloadIcon />}
              onClick={handleDownloadPDF}
              sx={{ mr: 1 }}
            >
              Descargar PDF
            </Button>
            <Button
              startIcon={<PrintIcon />}
              onClick={() => window.print()}
              sx={{ mr: 1 }}
            >
              Imprimir
            </Button>
            {invoice.email && (
              <Button
                startIcon={<EmailIcon />}
                onClick={handleSendEmail}
                sx={{ mr: 1 }}
              >
                Enviar por Correo
              </Button>
            )}
            {invoice.status === 'pendiente' && (
              <Button
                variant="contained"
                color="primary"
                startIcon={<SendIcon />}
                onClick={() => setResendDialogOpen(true)}
                sx={{ mr: 1 }}
              >
                Enviar a DGII
              </Button>
            )}
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteDialogOpen(true)}
            >
              Eliminar
            </Button>
          </Box>
        </Box>

        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Datos del Cliente
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="body1">
                      <strong>Cliente:</strong> {invoice.client}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="body1">
                      <strong>RNC/Cédula:</strong> {invoice.rnc}
                    </Typography>
                  </Grid>
                  {invoice.address && (
                    <Grid item xs={12}>
                      <Typography variant="body1">
                        <strong>Dirección:</strong> {invoice.address}
                      </Typography>
                    </Grid>
                  )}
                  {invoice.email && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body1">
                        <strong>Correo:</strong> {invoice.email}
                      </Typography>
                    </Grid>
                  )}
                  {invoice.phone && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body1">
                        <strong>Teléfono:</strong> {invoice.phone}
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Productos/Servicios
                </Typography>
                <Box sx={{ mb: 2 }}>
                  {invoice.items.map((item, index) => (
                    <Box key={index} sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body1">
                          {item.description}
                        </Typography>
                        <Typography variant="body1">
                          {item.quantity} x RD$ {item.price.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          ITBIS ({item.tax}%)
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          RD$ {(item.quantity * item.price * (item.tax / 100)).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        </Typography>
                      </Box>
                      {index < invoice.items.length - 1 && <Divider sx={{ my: 1 }} />}
                    </Box>
                  ))}
                </Box>
                <Divider sx={{ my: 2 }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body1">
                    Subtotal
                  </Typography>
                  <Typography variant="body1">
                    RD$ {invoice.subtotal.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body1">
                    ITBIS Total
                  </Typography>
                  <Typography variant="body1">
                    RD$ {invoice.tax.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                  </Typography>
                </Box>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="h6">
                    Total
                  </Typography>
                  <Typography variant="h6">
                    RD$ {invoice.total.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={4}>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Información de la Factura
                </Typography>
                <Typography variant="body1" sx={{ mb: 1 }}>
                  <strong>Fecha:</strong> {format(invoice.date, 'dd/MM/yyyy', { locale: es })}
                </Typography>
                <Typography variant="body1" sx={{ mb: 1 }}>
                  <strong>TrackID:</strong> {invoice.trackId}
                </Typography>
                <Typography variant="body1" sx={{ mb: 1 }}>
                  <strong>Método de Pago:</strong> {
                    {
                      'efectivo': 'Efectivo',
                      'tarjeta': 'Tarjeta de Crédito/Débito',
                      'transferencia': 'Transferencia Bancaria',
                      'cheque': 'Cheque'
                    }[invoice.paymentMethod]
                  }
                </Typography>
                {invoice.notes && (
                  <Typography variant="body1" sx={{ mb: 1 }}>
                    <strong>Notas:</strong> {invoice.notes}
                  </Typography>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Typography variant="h6" gutterBottom>
                  Código QR
                </Typography>
                <Box sx={{ mb: 2 }}>
                  <QRCode 
                    value={`https://dgii.gov.do/ecf?id=${invoice.trackId}`} 
                    size={200}
                    level="H"
                    includeMargin={true}
                  />
                </Box>
                <Typography variant="body2" color="text.secondary" align="center">
                  Escanea este código para verificar la autenticidad de la factura en el portal de la DGII
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Paper>

      {/* Diálogo de confirmación de eliminación */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Confirmar eliminación</DialogTitle>
        <DialogContent>
          <DialogContentText>
            ¿Estás seguro de que deseas eliminar esta factura? Esta acción no se puede deshacer.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancelar</Button>
          <Button onClick={handleDelete} color="error" autoFocus>
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo de confirmación de reenvío */}
      <Dialog
        open={resendDialogOpen}
        onClose={() => setResendDialogOpen(false)}
      >
        <DialogTitle>Confirmar envío a DGII</DialogTitle>
        <DialogContent>
          <DialogContentText>
            ¿Estás seguro de que deseas enviar esta factura a la DGII? Asegúrate de que todos los datos sean correctos.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResendDialogOpen(false)}>Cancelar</Button>
          <Button onClick={handleResend} color="primary" autoFocus>
            Enviar
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
