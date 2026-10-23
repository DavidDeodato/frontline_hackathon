import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AppBoundary } from './design-system/Components.jsx';
import './styles.css';
createRoot(document.getElementById('root')).render(<AppBoundary><App /></AppBoundary>);
