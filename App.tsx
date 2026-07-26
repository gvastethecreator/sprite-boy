import React from "react";
import { ProjectProvider } from "./contexts/ProjectContext";
import { StudioLocalStoresProvider } from "./contexts/StudioStoreContext";
import { CanonicalProjectProvider } from "./contexts/CanonicalProjectContext";
import AppLayout from "./components/layout/AppLayout";
import { StudioControlBridgeProvider } from "./features/control/StudioControlBridgeProvider";

function App() {
  return (
    <StudioLocalStoresProvider>
      <CanonicalProjectProvider>
        <StudioControlBridgeProvider>
          <ProjectProvider>
            <AppLayout />
          </ProjectProvider>
        </StudioControlBridgeProvider>
      </CanonicalProjectProvider>
    </StudioLocalStoresProvider>
  );
}

export default App;
