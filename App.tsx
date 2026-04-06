import React from "react";
import { ProjectProvider } from "./contexts/ProjectContext";
import AppLayout from "./components/layout/AppLayout";

function App() {
  return (
    <ProjectProvider>
      <AppLayout />
    </ProjectProvider>
  );
}

export default App;
