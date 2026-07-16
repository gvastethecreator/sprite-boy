import React from "react";
import { ProjectProvider } from "./contexts/ProjectContext";
import { StudioLocalStoresProvider } from "./contexts/StudioStoreContext";
import { CanonicalProjectProvider } from "./contexts/CanonicalProjectContext";
import AppLayout from "./components/layout/AppLayout";

function App() {
  return (
    <StudioLocalStoresProvider>
      <CanonicalProjectProvider>
        <ProjectProvider>
          <AppLayout />
        </ProjectProvider>
      </CanonicalProjectProvider>
    </StudioLocalStoresProvider>
  );
}

export default App;
