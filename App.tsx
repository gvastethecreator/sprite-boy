import React from "react";
import { ProjectProvider } from "./contexts/ProjectContext";
import { StudioLocalStoresProvider } from "./contexts/StudioStoreContext";
import AppLayout from "./components/layout/AppLayout";

function App() {
  return (
    <StudioLocalStoresProvider>
      <ProjectProvider>
        <AppLayout />
      </ProjectProvider>
    </StudioLocalStoresProvider>
  );
}

export default App;
