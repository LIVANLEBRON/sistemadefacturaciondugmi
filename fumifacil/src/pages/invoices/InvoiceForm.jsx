import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  Container, 
  Paper, 
  Typography, 
  Box, 
  Button,
  TextField,
  Grid,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Alert,
  Stepper,
  Step,
  StepLabel,
  CircularProgress
} from '@mui/material';
import { 
  ArrowBack as ArrowBackIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Send as SendIcon
} from '@mui/icons-material';
import { collection, doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, functions } from '../../firebase/firebase';
import { httpsCallable } from 'firebase/functions';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';

// Componente principal para crear/editar facturas
export default function InvoiceForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditMode = Boolean(id);
  
  // Estado para el formulario
  const [formData, setFormData] = useState({
    client: '',
    rnc: '',
    address: '',
    email: '',
    phone: '',
    items: [{ description: '', quantity: 1, price: 0, tax: 18 }],
    subtotal: 0,
    tax: 0,
    total: 0,
    notes: '',
    paymentMethod: 'efectivo',
    status: 'pendiente'
  });
  
  // Estados adicionales
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeStep, setActiveStep] = useState(0);
  const [pdfUrl, setPdfUrl] = useState('');
  
  // Pasos del proceso de facturación
  const steps = ['Datos del cliente', 'Productos/Servicios', 'Revisión y envío'];

  // Cargar datos de factura existente en modo edición
  useEffect(() => {
    if (isEditMode) {
      const fetchInvoice = async () => {
        try {
          setLoading(true);
          const invoiceDoc = await getDoc(doc(db, 'invoices', id));
          
          if (invoiceDoc.exists()) {
            const invoiceData = invoiceDoc.data();
            setFormData({
              ...invoiceData,
              date: invoiceData.date ? invoiceData.date.toDate() : new Date()
            });
            
            if (invoiceData.pdfUrl) {
              setPdfUrl(invoiceData.pdfUrl);
            }
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
    }
  }, [id, isEditMode, navigate]);

  // Calcular subtotal, impuestos y total cuando cambian los items
  useEffect(() => {
    const calculateTotals = () => {
      const subtotal = formData.items.reduce((sum, item) => 
        sum + (item.quantity * item.price), 0);
      
      const tax = formData.items.reduce((sum, item) => 
        sum + (item.quantity * item.price * (item.tax / 100)), 0);
      
      setFormData(prev => ({
        ...prev,
        subtotal,
        tax,
        total: subtotal + tax
      }));
    };
    
    calculateTotals();
  }, [formData.items]);

  // Manejar cambios en los campos del formulario
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Manejar cambios en los items
  const handleItemChange = (index, field, value) => {
    const updatedItems = [...formData.items];
    updatedItems[index][field] = field === 'quantity' || field === 'price' || field === 'tax' 
      ? parseFloat(value) || 0 
      : value;
    
    setFormData(prev => ({
      ...prev,
      items: updatedItems
    }));
  };

  // Agregar nuevo item
  const handleAddItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { description: '', quantity: 1, price: 0, tax: 18 }]
    }));
  };

  // Eliminar item
  const handleRemoveItem = (index) => {
    if (formData.items.length === 1) {
      return; // Mantener al menos un item
    }
    
    const updatedItems = formData.items.filter((_, i) => i !== index);
    
    setFormData(prev => ({
      ...prev,
      items: updatedItems
    }));
  };

  // Navegar entre pasos
  const handleNext = () => {
    setActiveStep(prev => prev + 1);
  };

  const handleBack = () => {
    setActiveStep(prev => prev - 1);
  };

  // Validar formulario antes de guardar
  const validateForm = () => {
    if (!formData.client.trim()) {
      setError('El nombre del cliente es obligatorio.');
      return false;
    }
    
    if (!formData.rnc.trim()) {
      setError('El RNC/Cédula es obligatorio.');
      return false;
    }
    
    if (formData.items.some(item => !item.description.trim() || item.quantity <= 0 || item.price <= 0)) {
      setError('Todos los productos/servicios deben tener descripción, cantidad y precio válidos.');
      return false;
    }
    
    return true;
  };

  // Guardar factura en Firestore
  const saveInvoice = async (status = 'pendiente') => {
    if (!validateForm()) return;
    
    try {
      setLoading(true);
      setError('');
      
      const invoiceId = isEditMode ? id : uuidv4();
      const trackId = isEditMode && formData.trackId ? formData.trackId : `ECF-${Date.now()}`;
      
      const invoiceData = {
        ...formData,
        status,
        trackId,
        date: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      if (isEditMode) {
        await updateDoc(doc(db, 'invoices', invoiceId), invoiceData);
        setSuccess('Factura actualizada correctamente.');
      } else {
        await setDoc(doc(db, 'invoices', invoiceId), invoiceData);
        setSuccess('Factura guardada correctamente.');
      }
      
      return invoiceId;
    } catch (error) {
      console.error('Error al guardar la factura:', error);
      setError('Error al guardar la factura. Por favor, intenta nuevamente.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Generar PDF de la factura
  const generatePDF = async (invoiceId) => {
    try {
      setLoading(true);
      
      // Llamar a Cloud Function para generar PDF
      const generateInvoicePDF = httpsCallable(functions, 'generateInvoicePDF');
      const result = await generateInvoicePDF({ invoiceId });
      
      if (result.data && result.data.pdfUrl) {
        setPdfUrl(result.data.pdfUrl);
        
        // Actualizar factura con URL del PDF
        await updateDoc(doc(db, 'invoices', invoiceId), {
          pdfUrl: result.data.pdfUrl
        });
        
        return result.data.pdfUrl;
      } else {
        throw new Error('No se pudo generar el PDF');
      }
    } catch (error) {
      console.error('Error al generar el PDF:', error);
      setError('Error al generar el PDF. Por favor, intenta nuevamente.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Enviar factura a la DGII
  const sendToDGII = async (invoiceId) => {
    try {
      setLoading(true);
      
      // Llamar a Cloud Function para enviar a DGII
      const sendInvoiceToDGII = httpsCallable(functions, 'sendInvoiceToDGII');
      const result = await sendInvoiceToDGII({ invoiceId });
      
      if (result.data && result.data.success) {
        // Actualizar estado de la factura
        await updateDoc(doc(db, 'invoices', invoiceId), {
          status: 'enviada',
          dgiiResponse: result.data
        });
        
        setSuccess('Factura enviada correctamente a la DGII.');
        return true;
      } else {
        throw new Error(result.data?.error || 'Error al enviar a DGII');
      }
    } catch (error) {
      console.error('Error al enviar a DGII:', error);
      setError('Error al enviar a DGII. La factura se guardará como pendiente para reintento automático.');
      
      // Actualizar estado para reintento
      await updateDoc(doc(db, 'invoices', invoiceId), {
        status: 'pendiente',
        lastRetryAttempt: serverTimestamp()
      });
      
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Manejar envío del formulario
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      // Paso 1: Guardar factura
      const invoiceId = await saveInvoice('pendiente');
      if (!invoiceId) return;
      
      // Paso 2: Generar PDF
      const pdfUrl = await generatePDF(invoiceId);
      if (!pdfUrl) {
        setError('Se guardó la factura pero no se pudo generar el PDF.');
        return;
      }
      
      // Paso 3: Enviar a DGII si se solicita
      if (activeStep === steps.length - 1) {
        const sent = await sendToDGII(invoiceId);
        if (sent) {
          navigate(`/facturas/${invoiceId}`);
        }
      } else {
        setSuccess('Factura guardada correctamente.');
        if (!isEditMode) {
          navigate(`/facturas/${invoiceId}`);
        }
      }
    } catch (error) {
      console.error('Error en el proceso de facturación:', error);
      setError('Ocurrió un error en el proceso de facturación. Por favor, intenta nuevamente.');
    }
  };

  // Renderizar paso actual
  const renderStep = () => {
    switch (activeStep) {
      case 0:
        return renderClientForm();
      case 1:
        return renderItemsForm();
      case 2:
        return renderReview();
      default:
        return null;
    }
  };

  // Formulario de datos del cliente
  const renderClientForm = () => (
    <Grid container spacing={2}>
      <Grid item xs={12}>
        <Typography variant="h6" gutterBottom>
          Datos del Cliente
        </Typography>
      </Grid>
      <Grid item xs={12} sm={6}>
        <TextField
          required
          fullWidth
          label="Nombre/Razón Social"
          name="client"
          value={formData.client}
          onChange={handleChange}
        />
      </Grid>
      <Grid item xs={12} sm={6}>
        <TextField
          required
          fullWidth
          label="RNC/Cédula"
          name="rnc"
          value={formData.rnc}
          onChange={handleChange}
        />
      </Grid>
      <Grid item xs={12}>
        <TextField
          fullWidth
          label="Dirección"
          name="address"
          value={formData.address}
          onChange={handleChange}
        />
      </Grid>
      <Grid item xs={12} sm={6}>
        <TextField
          fullWidth
          label="Correo Electrónico"
          name="email"
          type="email"
          value={formData.email}
          onChange={handleChange}
        />
      </Grid>
      <Grid item xs={12} sm={6}>
        <TextField
          fullWidth
          label="Teléfono"
          name="phone"
          value={formData.phone}
          onChange={handleChange}
        />
      </Grid>
      <Grid item xs={12}>
        <FormControl fullWidth>
          <InputLabel>Método de Pago</InputLabel>
          <Select
            name="paymentMethod"
            value={formData.paymentMethod}
            onChange={handleChange}
            label="Método de Pago"
          >
            <MenuItem value="efectivo">Efectivo</MenuItem>
            <MenuItem value="tarjeta">Tarjeta de Crédito/Débito</MenuItem>
            <MenuItem value="transferencia">Transferencia Bancaria</MenuItem>
            <MenuItem value="cheque">Cheque</MenuItem>
          </Select>
        </FormControl>
      </Grid>
    </Grid>
  );

  // Formulario de productos/servicios
  const renderItemsForm = () => (
    <Grid container spacing={2}>
      <Grid item xs={12}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" gutterBottom>
            Productos/Servicios
          </Typography>
          <Button 
            startIcon={<AddIcon />} 
            onClick={handleAddItem}
            variant="outlined"
            size="small"
          >
            Agregar
          </Button>
        </Box>
      </Grid>
      
      {formData.items.map((item, index) => (
        <Grid item xs={12} key={index}>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  required
                  fullWidth
                  label="Descripción"
                  value={item.description}
                  onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  required
                  fullWidth
                  label="Cantidad"
                  type="number"
                  InputProps={{ inputProps: { min: 1 } }}
                  value={item.quantity}
                  onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  required
                  fullWidth
                  label="Precio Unitario (RD$)"
                  type="number"
                  InputProps={{ inputProps: { min: 0 } }}
                  value={item.price}
                  onChange={(e) => handleItemChange(index, 'price', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  required
                  fullWidth
                  label="ITBIS (%)"
                  type="number"
                  InputProps={{ inputProps: { min: 0, max: 100 } }}
                  value={item.tax}
                  onChange={(e) => handleItemChange(index, 'tax', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={1} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconButton 
                  color="error" 
                  onClick={() => handleRemoveItem(index)}
                  disabled={formData.items.length === 1}
                >
                  <DeleteIcon />
                </IconButton>
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      ))}
      
      <Grid item xs={12}>
        <Paper sx={{ p: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <Typography variant="subtitle1">
                Subtotal: RD$ {formData.subtotal.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="subtitle1">
                ITBIS: RD$ {formData.tax.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="h6">
                Total: RD$ {formData.total.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
              </Typography>
            </Grid>
          </Grid>
        </Paper>
      </Grid>
      
      <Grid item xs={12}>
        <TextField
          fullWidth
          label="Notas"
          name="notes"
          multiline
          rows={3}
          value={formData.notes}
          onChange={handleChange}
        />
      </Grid>
    </Grid>
  );

  // Revisión final
  const renderReview = () => (
    <Grid container spacing={2}>
      <Grid item xs={12}>
        <Typography variant="h6" gutterBottom>
          Revisión de Factura
        </Typography>
      </Grid>
      
      <Grid item xs={12}>
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            Datos del Cliente
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography variant="body2">
                <strong>Cliente:</strong> {formData.client}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="body2">
                <strong>RNC/Cédula:</strong> {formData.rnc}
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="body2">
                <strong>Dirección:</strong> {formData.address || 'No especificada'}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="body2">
                <strong>Correo:</strong> {formData.email || 'No especificado'}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="body2">
                <strong>Teléfono:</strong> {formData.phone || 'No especificado'}
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="body2">
                <strong>Método de Pago:</strong> {
                  {
                    'efectivo': 'Efectivo',
                    'tarjeta': 'Tarjeta de Crédito/Débito',
                    'transferencia': 'Transferencia Bancaria',
                    'cheque': 'Cheque'
                  }[formData.paymentMethod]
                }
              </Typography>
            </Grid>
          </Grid>
        </Paper>
      </Grid>
      
      <Grid item xs={12}>
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            Productos/Servicios
          </Typography>
          <Grid container spacing={2}>
            {formData.items.map((item, index) => (
              <Grid item xs={12} key={index}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2">
                    {item.description}
                  </Typography>
                  <Typography variant="body2">
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
                <Divider sx={{ my: 1 }} />
              </Grid>
            ))}
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body1">
                  Subtotal
                </Typography>
                <Typography variant="body1">
                  RD$ {formData.subtotal.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body1">
                  ITBIS Total
                </Typography>
                <Typography variant="body1">
                  RD$ {formData.tax.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                </Typography>
              </Box>
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="h6">
                  Total
                </Typography>
                <Typography variant="h6">
                  RD$ {formData.total.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Paper>
      </Grid>
      
      {formData.notes && (
        <Grid item xs={12}>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle1" gutterBottom>
              Notas
            </Typography>
            <Typography variant="body2">
              {formData.notes}
            </Typography>
          </Paper>
        </Grid>
      )}
      
      <Grid item xs={12}>
        <Alert severity="info">
          Al enviar esta factura, se generará un e-CF que será transmitido a la DGII. Asegúrate de que todos los datos sean correctos.
        </Alert>
      </Grid>
    </Grid>
  );

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={() => navigate('/facturas')} sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" component="h1">
          {isEditMode ? 'Editar Factura' : 'Nueva Factura'}
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
        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <form onSubmit={handleSubmit}>
          {renderStep()}
          
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
            <Button
              disabled={activeStep === 0}
              onClick={handleBack}
            >
              Atrás
            </Button>
            <Box>
              {activeStep < steps.length - 1 ? (
                <Button
                  variant="contained"
                  onClick={handleNext}
                >
                  Siguiente
                </Button>
              ) : (
                <>
                  <Button
                    variant="outlined"
                    startIcon={<SaveIcon />}
                    onClick={handleSubmit}
                    sx={{ mr: 1 }}
                    disabled={loading}
                  >
                    Guardar
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<SendIcon />}
                    type="submit"
                    disabled={loading}
                  >
                    {loading ? <CircularProgress size={24} /> : 'Enviar a DGII'}
                  </Button>
                </>
              )}
            </Box>
          </Box>
        </form>
      </Paper>
    </Container>
  );
}
