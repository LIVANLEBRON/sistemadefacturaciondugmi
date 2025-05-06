// Configuración de Firebase para FumiFacil
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getAnalytics } from 'firebase/analytics';

// Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyC7PJtV6_MYEfkHZEIp1Pm8fPl7lgrNWF8",
  authDomain: "xdxdxd-ed251.firebaseapp.com",
  projectId: "xdxdxd-ed251",
  storageBucket: "xdxdxd-ed251.firebasestorage.app",
  messagingSenderId: "822100940554",
  appId: "1:822100940554:web:ea49d64b7204a591718cf3",
  measurementId: "G-9HFWV4ZQ5Z"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

// Inicializar servicios
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);
const functions = getFunctions(app);
const analytics = getAnalytics(app);

// Conectar al emulador de funciones en desarrollo
if (import.meta.env.DEV) {
  try {
    connectFunctionsEmulator(functions, 'localhost', 5001);
    console.log('Conectado al emulador de funciones de Firebase');
  } catch (error) {
    console.error('Error al conectar al emulador de funciones:', error);
  }
}

export { db, storage, auth, functions, analytics };
