import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createStudioControlBridgeClient,
  type StudioControlBridgeClient,
  type StudioControlBridgeClientSnapshot,
} from "../../core/control/controlBridgeClient";
import {
  createLocalModelServiceClient,
  type LocalModelServiceClient,
} from "../../core/models";
import {
  createStudioControlService,
  type StudioControlService,
} from "../../core/control/controlService";
import { useCanonicalProject } from "../../contexts/CanonicalProjectContext";
import {
  useJobStore,
  useStudioJobRunner,
} from "../../contexts/StudioStoreContext";
import {
  BROWSER_STUDIO_CONTROL_SUPPORTED_COMMANDS,
  createBrowserStudioControlPorts,
} from "./studioControlPorts";

const IDLE_SNAPSHOT: StudioControlBridgeClientSnapshot = Object.freeze({
  status: "idle",
  message: "Control bridge is disconnected.",
  clientId: null,
  activeOperations: 0,
});

interface ActiveConnection {
  readonly client: StudioControlBridgeClient;
  readonly models: LocalModelServiceClient;
  readonly service: StudioControlService;
  readonly unsubscribe: () => void;
}

interface StudioControlBridgeContextValue {
  readonly snapshot: StudioControlBridgeClientSnapshot;
  readonly models: LocalModelServiceClient | null;
  connect(baseUrl: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
}

const StudioControlBridgeContext = createContext<StudioControlBridgeContextValue | null>(null);

export function StudioControlBridgeProvider({ children }: { readonly children: ReactNode }) {
  const canonical = useCanonicalProject();
  const jobs = useJobStore();
  const jobRunner = useStudioJobRunner();
  const [snapshot, setSnapshot] = useState(IDLE_SNAPSHOT);
  const connectionRef = useRef<ActiveConnection | null>(null);
  const dependencies = useMemo(() => ({
    projectStore: canonical.store,
    jobStore: jobs,
    jobRunner,
    navigate: canonical.setActiveWorkspace,
  }), [canonical.setActiveWorkspace, canonical.store, jobRunner, jobs]);

  const disconnect = useCallback(async (): Promise<void> => {
    const connection = connectionRef.current;
    connectionRef.current = null;
    if (!connection) {
      setSnapshot(IDLE_SNAPSHOT);
      return;
    }
    connection.unsubscribe();
    await connection.client.stop();
    connection.service.dispose();
    setSnapshot(IDLE_SNAPSHOT);
  }, []);

  const connect = useCallback(async (baseUrl: string, token: string): Promise<void> => {
    await disconnect();
    let service: StudioControlService | null = null;
    let client: StudioControlBridgeClient;
    let models: LocalModelServiceClient;
    try {
      models = createLocalModelServiceClient({ baseUrl, token });
      service = createStudioControlService({
        ports: createBrowserStudioControlPorts({ ...dependencies, models }),
        supportedCommands: BROWSER_STUDIO_CONTROL_SUPPORTED_COMMANDS,
      });
      client = createStudioControlBridgeClient({ baseUrl, token, service });
    } catch (error) {
      service?.dispose();
      throw error;
    }
    const unsubscribe = client.subscribe(() => setSnapshot(client.getSnapshot()));
    const connection = Object.freeze({ client, models, service, unsubscribe });
    connectionRef.current = connection;
    setSnapshot(client.getSnapshot());
    try {
      await client.start();
      setSnapshot(client.getSnapshot());
    } catch (error) {
      if (connectionRef.current === connection) {
        connection.unsubscribe();
        connectionRef.current = null;
        service.dispose();
      }
      setSnapshot(client.getSnapshot());
      throw error;
    }
  }, [dependencies, disconnect]);

  useEffect(() => {
    if (connectionRef.current) void disconnect();
  }, [dependencies, disconnect]);

  useEffect(() => () => {
    const connection = connectionRef.current;
    connectionRef.current = null;
    if (connection) {
      connection.unsubscribe();
      void connection.client.stop();
      connection.service.dispose();
    }
  }, []);

  const value = useMemo<StudioControlBridgeContextValue>(() => Object.freeze({
    snapshot,
    models: snapshot.status === "connected" ? connectionRef.current?.models ?? null : null,
    connect,
    disconnect,
  }), [connect, disconnect, snapshot]);

  return (
    <StudioControlBridgeContext.Provider value={value}>
      {children}
    </StudioControlBridgeContext.Provider>
  );
}

export function useStudioControlBridge(): StudioControlBridgeContextValue {
  const value = useContext(StudioControlBridgeContext);
  if (!value) throw new Error("Studio control bridge requires its provider.");
  return value;
}
