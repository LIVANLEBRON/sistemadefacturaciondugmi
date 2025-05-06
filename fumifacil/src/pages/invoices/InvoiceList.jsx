import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Container, 
  Paper, 
  Typography, 
  Box, 
  Button,
  TextField,
  InputAdornment,
  IconButton,
  Chip,
  Tooltip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Alert,
  LinearProgress
} from '@mui/material';
import { DataGrid, esES } from '@mui/x-data-grid';
import { 
  Add as AddIcon,
  Search as SearchIcon,
  Visibility as VisibilityIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  FileDownload as FileDownloadIcon,
  Refresh as RefreshIcon,
  FilterList as FilterListIcon
} from '@mui/icons-material';
import { collection, query, orderBy, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase/firebase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function InvoiceList() {
  const [invoices, setInvoices] = useState([]);
  const [filteredInvoices, setFilteredInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Cargar facturas al montar el componente
  useEffect(() => {
    fetchInvoices();
  }, []);

  // Filtrar facturas cuando cambia el término de búsqueda
  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredInvoices(invoices);
    } else {
      const filtered = invoices.filter(invoice => 
        invoice.client.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.trackId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.status.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredInvoices(filtered);
    }
  }, [searchTerm, invoices]);

  // Función para cargar facturas desde Firestore
  const fetchInvoices = async () => {
    try {
      setLoading(true);
      setError('');
      
      const invoicesQuery = query(
        collection(db, 'invoices'),
        orderBy('date', 'desc')
      );
      
      const querySnapshot = await getDocs(invoicesQuery);
      const invoicesData = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        invoicesData.push({
          id: doc.id,
          ...data,
          date: data.date ? data.date.toDate() : new Date(),
        });
      });
      
      setInvoices(invoicesData);
      setFilteredInvoices(invoicesData);
    } catch (error) {
      console.error('Error al cargar las facturas:', error);
      setError('Error al cargar las facturas. Por favor, intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  // Función para descargar PDF de factura
  const handleDownloadPDF = async (invoiceId, pdfUrl) => {
    try {
      if (!pdfUrl) {
        const pdfRef = ref(storage, `invoices/${invoiceId}.pdf`);
        const url = await getDownloadURL(pdfRef);
        window.open(url, '_blank');
      } else {
        window.open(pdfUrl, '_blank');
      }
    } catch (error) {
      console.error('Error al descargar el PDF:', error);
      setError('Error al descargar el PDF. Por favor, intenta nuevamente.');
    }
  };

  // Función para abrir diálogo de confirmación de eliminación
  const handleDeleteClick = (invoice) => {
    setSelectedInvoice(invoice);
    setDeleteDialogOpen(true);
  };

  // Función para eliminar factura
  const handleDeleteConfirm = async () => {
    if (!selectedInvoice) return;
    
    try {
      setLoading(true);
      await deleteDoc(doc(db, 'invoices', selectedInvoice.id));
      
      // Actualizar lista de facturas
      setInvoices(prevInvoices => 
        prevInvoices.filter(invoice => invoice.id !== selectedInvoice.id)
      );
      
      setDeleteDialogOpen(false);
      setSelectedInvoice(null);
    } catch (error) {
      console.error('Error al eliminar la factura:', error);
      setError('Error al eliminar la factura. Por favor, intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  // Columnas para la tabla de facturas
  const columns = [
    { 
      field: 'date', 
      headerName: 'Fecha', 
      width: 120,
      valueFormatter: (params) => format(params.value, 'dd/MM/yyyy', { locale: es })
    },
    { 
      field: 'trackId', 
      headerName: 'TrackID', 
      width: 150 
    },
    { 
      field: 'client', 
      headerName: 'Cliente', 
      width: 200,
      flex: 1
    },
    { 
      field: 'rnc', 
      headerName: 'RNC/Cédula', 
      width: 150 
    },
    { 
      field: 'amount', 
      headerName: 'Monto', 
      width: 150,
      type: 'number',
      valueFormatter: (params) => `RD$ ${params.value.toLocaleString('es-DO')}`
    },
    { 
      field: 'status', 
      headerName: 'Estado', 
      width: 150,
      renderCell: (params) => {
        let color;
        let label;
        
        switch (params.value) {
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
            label = params.value;
        }
        
        return <Chip label={label} color={color} size="small" />;
      }
    },
    {
      field: 'actions',
      headerName: 'Acciones',
      width: 200,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <Tooltip title="Ver detalles">
            <IconButton 
              size="small" 
              onClick={() => navigate(`/facturas/${params.row.id}`)}
            >
              <VisibilityIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Editar">
            <IconButton 
              size="small" 
              onClick={() => navigate(`/facturas/editar/${params.row.id}`)}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Descargar PDF">
            <IconButton 
              size="small" 
              onClick={() => handleDownloadPDF(params.row.id, params.row.pdfUrl)}
            >
              <FileDownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Eliminar">
            <IconButton 
              size="small" 
              onClick={() => handleDeleteClick(params.row)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )
    }
  ];

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Facturas
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/facturas/nueva')}
        >
          Nueva Factura
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <TextField
            variant="outlined"
            size="small"
            placeholder="Buscar por cliente, TrackID o estado"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ width: '40%' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              )
            }}
          />
          <Box>
            <Tooltip title="Filtros avanzados">
              <IconButton>
                <FilterListIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Actualizar">
              <IconButton onClick={fetchInvoices}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        <div style={{ height: 500, width: '100%' }}>
          {loading && <LinearProgress />}
          <DataGrid
            rows={filteredInvoices}
            columns={columns}
            pageSize={10}
            rowsPerPageOptions={[10, 25, 50]}
            disableSelectionOnClick
            localeText={esES.components.MuiDataGrid.defaultProps.localeText}
            loading={loading}
          />
        </div>
      </Paper>

      {/* Diálogo de confirmación de eliminación */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Confirmar eliminación</DialogTitle>
        <DialogContent>
          <DialogContentText>
            ¿Estás seguro de que deseas eliminar la factura para {selectedInvoice?.client}? Esta acción no se puede deshacer.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancelar</Button>
          <Button onClick={handleDeleteConfirm} color="error" autoFocus>
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
