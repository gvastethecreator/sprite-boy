import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobCenter } from "../../components/studio/JobCenter";
import {
  createJobRunner,
  createQueuedJob,
  retryJob,
  transitionJob,
  type JobTaskContext,
} from "../../core/processing";
import { createJobStore, type JobStore } from "../../core/stores";

const T0 = "2026-07-15T16:00:00.000Z";
const T1 = "2026-07-15T16:00:01.000Z";
const T2 = "2026-07-15T16:00:02.000Z";
const T3 = "2026-07-15T16:00:03.000Z";

function queued(id: string) {
  return createQueuedJob({
    id,
    requestId: `${id}-request`,
    kind: "test.job-center",
    label: `Process ${id}`,
    createdAt: T0,
    timeoutMs: null,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function failedJob(store: JobStore, id: string) {
  const initial = queued(id);
  store.dispatch({ type: "job.replace", job: initial });
  const running = transitionJob(initial, {
    type: "job.start",
    requestId: initial.requestId,
    at: T1,
  }).job;
  store.dispatch({ type: "job.replace", job: running });
  const failed = transitionJob(running, {
    type: "job.fail",
    requestId: initial.requestId,
    at: T2,
    error: { code: "worker-crash", message: "Worker stopped safely.", retryable: true },
  }).job;
  store.dispatch({ type: "job.replace", job: failed });
  if (failed.status !== "failed") throw new Error("Expected failed job.");
  return failed;
}

describe("JobCenter", () => {
  it("renders a readable empty state and polite aggregate status", () => {
    const store = createJobStore();
    const runner = createJobRunner({ store });
    render(<JobCenter store={store} runner={runner} />);

    expect(screen.getByRole("status", { name: "Job Center summary" }))
      .toHaveTextContent("Job Center is empty");
    expect(screen.getByRole("heading", { name: "No jobs yet" })).toBeInTheDocument();
    expect(screen.getByText("Active").nextElementSibling).toHaveTextContent("0");
    expect(screen.queryByRole("button", { name: /Retry / })).not.toBeInTheDocument();
    runner.dispose();
  });

  it("shows semantic progress and cancels through the shared runner", async () => {
    const store = createJobStore();
    const runner = createJobRunner({ store });
    const output = deferred<string>();
    let context!: JobTaskContext;
    const handle = runner.run(queued("job-active"), (taskContext) => {
      context = taskContext;
      taskContext.reportProgress({ ratio: 0.35, phase: "render", message: "Rendering frame 2" });
      return output.promise;
    });
    render(<JobCenter store={store} runner={runner} />);

    expect(screen.getByRole("status", { name: "Job Center summary" }))
      .toHaveTextContent("1 job active");
    expect(screen.getByRole("status", {
      name: "Process job-active, attempt 1: Running",
    })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Process job-active progress" }))
      .toHaveAttribute("aria-valuenow", "35");
    expect(screen.getByText("Rendering frame 2")).toBeInTheDocument();
    expect(context.signal.aborted).toBe(false);

    fireEvent.click(screen.getByRole("button", {
      name: "Cancel Process job-active, attempt 1",
    }));
    await act(async () => {
      await expect(handle.result).resolves.toMatchObject({ status: "cancelled" });
    });
    expect(context.signal.aborted).toBe(true);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Job Center summary" }))
      .toHaveTextContent("No active jobs. 1 job in history.");
    expect(screen.getByRole("status", {
      name: "Process job-active, attempt 1: Cancelled",
    })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    output.resolve("late");
  });

  it("retries only an unconsumed source and exposes safe details", async () => {
    const store = createJobStore();
    const runner = createJobRunner({ store });
    const failure = failedJob(store, "job-failed");
    const retryAction = vi.fn(async () => true);
    render(<JobCenter store={store} runner={runner} retryJob={retryAction} />);

    const job = screen.getByRole("listitem");
    expect(within(job).getByText("Failed")).toBeInTheDocument();
    fireEvent.click(
      within(job).getByLabelText("Show details for Process job-failed, attempt 1"),
    );
    expect(within(job).getByText("worker-crash")).toBeInTheDocument();
    expect(within(job).getByText("Worker stopped safely.")).toBeInTheDocument();
    fireEvent.click(within(job).getByRole("button", {
      name: "Retry Process job-failed, attempt 1",
    }));
    await waitFor(() => expect(retryAction).toHaveBeenCalledWith(failure));

    const retry = retryJob(failure, {
      id: "job-retry",
      requestId: "job-retry-request",
      createdAt: T3,
    }).retry!;
    act(() => store.dispatch({ type: "job.replace", job: retry }));
    expect(screen.queryByRole("button", {
      name: "Retry Process job-failed, attempt 1",
    }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Cancel Process job-failed, attempt 2",
    }))
      .toBeInTheDocument();
    runner.dispose();
  });

  it("reports retry rejection without exposing thrown details", async () => {
    const store = createJobStore();
    const runner = createJobRunner({ store });
    failedJob(store, "job-retry-rejected");
    const retryAction = vi.fn(async () => {
      throw new Error("private adapter detail");
    });
    render(<JobCenter store={store} runner={runner} retryJob={retryAction} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Retry Process job-retry-rejected, attempt 1",
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not retry Process job-retry-rejected");
    expect(alert).not.toHaveTextContent("private adapter detail");
    runner.dispose();
  });

  it("contains synchronous retry adapter failures and releases the action", async () => {
    const store = createJobStore();
    const runner = createJobRunner({ store });
    failedJob(store, "job-retry-sync-failure");
    const retryAction = vi.fn(() => {
      throw new Error("private synchronous adapter detail");
    });
    render(<JobCenter store={store} runner={runner} retryJob={retryAction} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Retry Process job-retry-sync-failure, attempt 1",
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not retry Process job-retry-sync-failure");
    expect(alert).not.toHaveTextContent("private synchronous adapter detail");
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Retry Process job-retry-sync-failure, attempt 1",
    })).toBeEnabled());
    expect(retryAction).toHaveBeenCalledTimes(1);
    runner.dispose();
  });

  it("disambiguates controls when several jobs need attention", () => {
    const store = createJobStore();
    const runner = createJobRunner({ store });
    failedJob(store, "job-alpha");
    failedJob(store, "job-beta");
    render(<JobCenter store={store} runner={runner} retryJob={() => true} />);

    expect(screen.getByLabelText("Show details for Process job-alpha, attempt 1"))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Show details for Process job-beta, attempt 1"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Retry Process job-alpha, attempt 1",
    }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Retry Process job-beta, attempt 1",
    }))
      .toBeInTheDocument();
    runner.dispose();
  });
});
