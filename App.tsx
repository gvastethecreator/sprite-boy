import React from 'react';
import { ProjectProvider } from './contexts/ProjectContext';
import AppLayout from './components/AppLayout';

function App() {
  return (
    <ProjectProvider>
      <AppLayout />
    </ProjectProvider>
  );
}

export default App;