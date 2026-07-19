import { spawn, ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { forceRemoveContainer } from "./sandbox.js";

export type JobStatus = "running" | "exited" | "killed" | "error";

export interface Job {
  id: string;
  name: string;
  command: string;
  args: string[];
  status: JobStatus;
  exitCode: number | null;
  startedAt: number;
  proc: ChildProcess;
  logLines: string[];
  // ROS-specific bookkeeping so restart_ros_node can find and relaunch a
  // node that was started through this manager.
  rosNodeName?: string;
  // Sandboxed jobs run as an attached `docker run`; killing the client does
  // not reliably kill the container (a PID-1 bash ignores SIGINT - observed
  // live), so stop() also removes the container by name.
  containerName?: string;
}

const MAX_LOG_LINES = 2000;

/**
 * Tracks background processes started on behalf of the LLM. This exists
 * because MCP tool calls are request/response - launching `ros2 launch`
 * or a Gazebo sim directly in a tool handler would hang the call forever.
 * Instead we spawn, detach into this registry, and hand back a job_id
 * immediately. The LLM polls read_job_logs / list_background_jobs.
 */
class JobManager {
  private jobs = new Map<string, Job>();

  start(
    command: string,
    args: string[],
    name: string,
    rosNodeName?: string,
    containerName?: string
  ): Job {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    const job: Job = {
      id: randomUUID().slice(0, 8),
      name,
      command,
      args,
      status: "running",
      exitCode: null,
      startedAt: Date.now(),
      proc,
      logLines: [],
      rosNodeName,
      containerName,
    };

    const appendLog = (chunk: Buffer) => {
      const lines = chunk.toString("utf8").split("\n").filter(Boolean);
      job.logLines.push(...lines);
      if (job.logLines.length > MAX_LOG_LINES) {
        job.logLines.splice(0, job.logLines.length - MAX_LOG_LINES);
      }
    };

    proc.stdout?.on("data", appendLog);
    proc.stderr?.on("data", appendLog);

    proc.on("exit", (code) => {
      job.status = code === 0 ? "exited" : "error";
      job.exitCode = code;
    });

    proc.on("error", (err) => {
      job.status = "error";
      job.logLines.push(`[job-manager] spawn error: ${err.message}`);
    });

    this.jobs.set(job.id, job);
    return job;
  }

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  findByRosNodeName(nodeName: string): Job | undefined {
    for (const job of this.jobs.values()) {
      if (job.rosNodeName === nodeName && job.status === "running") return job;
    }
    return undefined;
  }

  list(): Job[] {
    return [...this.jobs.values()];
  }

  tailLogs(jobId: string, tailLines: number): string[] {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`No job with id ${jobId}`);
    return job.logLines.slice(-tailLines);
  }

  async stop(jobId: string, signal: NodeJS.Signals = "SIGINT", graceMs = 5000): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`No job with id ${jobId}`);
    if (job.status !== "running") return;

    job.proc.kill(signal);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (job.status === "running") {
          job.proc.kill("SIGKILL");
          job.status = "killed";
        }
        resolve();
      }, graceMs);
      job.proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    // Sandboxed job: make sure the container is actually gone, not just the
    // docker-run client. Harmless no-op when SIGINT already worked (--rm).
    if (job.containerName) forceRemoveContainer(job.containerName);
    // A stop WE initiated isn't an error, whatever exit code the client died
    // with (a signalled docker-run client reports non-zero). Fresh lookup:
    // the exit handler mutates status behind TS's narrowing.
    const j = this.jobs.get(jobId);
    if (j && j.status === "error") j.status = "killed";
  }
}

export const jobManager = new JobManager();
