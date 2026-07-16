import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  createSourceSession,
  type SourceSelectOptions,
  type SourceSelectionInput,
  type SourceSession,
  type SourceSessionOptions,
  type SourceSessionSnapshot,
} from "./sourceSession";

export interface SliceSourceSessionBinding {
  readonly snapshot: SourceSessionSnapshot;
  readonly select: (
    input: SourceSelectionInput,
    options?: SourceSelectOptions,
  ) => Promise<SourceSessionSnapshot>;
  readonly retry: (options?: SourceSelectOptions) => Promise<SourceSessionSnapshot>;
  readonly reset: () => void;
  readonly getBlob: () => Blob | null;
}

/**
 * React binding for the feature-local source session. Options are captured on
 * mount so a render cannot silently replace the owner of a decoded resource.
 */
export function useSliceSourceSession(
  options: SourceSessionOptions = {},
): SliceSourceSessionBinding {
  const [session] = useState<SourceSession>(() => createSourceSession(options));
  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => session.subscribe(listener), [session]),
    useCallback(() => session.getSnapshot(), [session]),
    useCallback(() => session.getSnapshot(), [session]),
  );

  useEffect(() => () => session.dispose(), [session]);

  const select = useCallback(
    (input: SourceSelectionInput, selectOptions?: SourceSelectOptions) =>
      session.select(input, selectOptions),
    [session],
  );
  const retry = useCallback(
    (selectOptions?: SourceSelectOptions) => session.retry(selectOptions),
    [session],
  );
  const reset = useCallback(() => session.reset(), [session]);
  const getBlob = useCallback(() => session.getBlob(), [session]);

  return useMemo(() => ({
    snapshot,
    select,
    retry,
    reset,
    getBlob,
  }), [getBlob, reset, retry, select, snapshot]);
}
