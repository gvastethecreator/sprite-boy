import React, { createContext, useContext, ReactNode } from 'react';
import { useProjectController } from '../hooks/useProjectController';

type ProjectControllerType = ReturnType<typeof useProjectController>;

const ProjectContext = createContext<ProjectControllerType | null>(null);

export const ProjectProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const controller = useProjectController();
    return (
        <ProjectContext.Provider value={controller}>
            {children}
        </ProjectContext.Provider>
    );
};

export const useProject = () => {
    const context = useContext(ProjectContext);
    if (!context) {
        throw new Error('useProject must be used within a ProjectProvider');
    }
    return context;
};
