import * as vscode from "vscode";
import * as nodePath from "node:path";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000/v1";
const MAX_RECONNECTS = 3;
const INITIAL_RETRY_DELAY_MS = 1_000;

type ExtensionSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  remoteWorkspaceRoot: string;
};

type ExecutionScope = {
  folder: vscode.WorkspaceFolder;
  cwd: string;
  filePath?: string;
};

function settings(): ExtensionSettings {
  const c = vscode.workspace.getConfiguration("ancient");
  return {
    baseUrl: String(c.get("apiBaseUrl") ?? DEFAULT_API_BASE_URL).replace(/\/$/, ""),
    apiKey: String(c.get("apiKey") ?? ""),
    model: String(c.get("model") ?? ""),
    remoteWorkspaceRoot: String(c.get("remoteWorkspaceRoot") ?? "").replace(/[\\/]+$/, ""),
  };
}

function validateBaseUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("ancient.apiBaseUrl must be a valid absolute URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("ancient.apiBaseUrl must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("ancient.apiBaseUrl cannot contain credentials, query parameters, or fragments.");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol === "http:" && !loopback) {
    throw new Error("Remote ANCIENT APIs require HTTPS; plain HTTP is allowed only for loopback development.");
  }
  return url;
}

function isLoopbackApi(baseUrl: string): boolean {
  const url = validateBaseUrl(baseUrl);
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}

function workspaceFor(resource?: vscode.Uri): vscode.WorkspaceFolder | undefined {
  if (resource) return vscode.workspace.getWorkspaceFolder(resource);
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const activeFolder = vscode.workspace.getWorkspaceFolder(active);
    if (activeFolder) return activeFolder;
  }
  return vscode.workspace.workspaceFolders?.[0];
}

function remotePath(root: string, relativePath: string): string {
  if (!relativePath) return root;
  return root + "/" + relativePath.split(nodePath.sep).join("/");
}

function executionScope(resource?: vscode.Uri): ExecutionScope {
  const s = settings();
  validateBaseUrl(s.baseUrl);
  const folder = workspaceFor(resource);
  if (!folder) throw new Error("Open a workspace folder first.");

  const localRoot = nodePath.resolve(folder.uri.fsPath);
  if (isLoopbackApi(s.baseUrl)) {
    return {
      folder,
      cwd: folder.uri.fsPath,
      ...(resource ? { filePath: resource.fsPath } : {}),
    };
  }

  if (!s.remoteWorkspaceRoot) {
    throw new Error(
      "Remote ANCIENT execution requires ancient.remoteWorkspaceRoot so the server knows where this local workspace is mounted."
    );
  }

  if (resource) {
    const relative = nodePath.relative(localRoot, nodePath.resolve(resource.fsPath));
    const outsideWorkspace =
      nodePath.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + nodePath.sep);
    if (outsideWorkspace) {
      throw new Error("The active file is outside the selected workspace mapping.");
    }
    return { folder, cwd: s.remoteWorkspaceRoot, filePath: remotePath(s.remoteWorkspaceRoot, relative) };
  }

  return { folder, cwd: s.remoteWorkspaceRoot };
}

function requireSettings(resource?: vscode.Uri): ExtensionSettings & { baseUrlUrl: URL; scope: ExecutionScope } {
  const s = settings();
  const baseUrlUrl = validateBaseUrl(s.baseUrl);
  if (!s.apiKey) throw new Error("Set ancient.apiKey before running an ANCIENT task.");
  const scope = executionScope(resource);
  return { ...s, baseUrlUrl, scope };
}

async function start(task: string, resource?: vscode.Uri): Promise<string> {
  const s = requireSettings(resource);
  const response = await fetch(s.baseUrl + "/executions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + s.apiKey,
    },
    body: JSON.stringify({
      task,
      cwd: s.scope.cwd,
      mode: "BUILD",
      ...(s.model ? { model: { modelKind: "builtin", modelId: s.model } } : {}),
      allow: ["read", "write", "exec"],
    }),
  });
  if (!response.ok) {
    throw new Error("ANCIENT API " + response.status + ": " + (await response.text()).slice(0, 500));
  }
  const data = await response.json() as { executionId?: string };
  if (!data.executionId) throw new Error("ANCIENT API returned no executionId.");
  return data.executionId;
}

type ParsedSseEvent = {
  id: number;
  event: any;
};

function parseSseFrame(raw: string): ParsedSseEvent | null {
  let id = 0;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("id:")) {
      const parsed = Number.parseInt(line.slice(3).trim(), 10);
      if (Number.isFinite(parsed)) id = parsed;
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (!data.length) return null;
  try {
    const event = JSON.parse(data.join("\n"));
    if (!event || typeof event !== "object" || typeof event.seq !== "number") return null;
    return { id: id || event.seq, event };
  } catch {
    return null;
  }
}

function isTerminal(type: string): boolean {
  return type === "execution.completed" || type === "execution.failed" || type === "execution.cancelled";
}

async function waitBeforeReconnect(attempt: number): Promise<void> {
  const delay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempt, 5_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function stream(id: string, output: vscode.OutputChannel) {
  const s = requireSettings();
  let lastEventId = 0;
  let terminalSeen = false;

  for (let reconnect = 0; reconnect <= MAX_RECONNECTS; reconnect++) {
    if (terminalSeen) return;

    let response: Response;
    try {
      const headers: Record<string, string> = {
        authorization: "Bearer " + s.apiKey,
        accept: "text/event-stream",
        "cache-control": "no-cache",
      };
      if (lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);

      response = await fetch(
        s.baseUrl + "/executions/" + encodeURIComponent(id) + "/events",
        { headers }
      );
    } catch (error) {
      if (reconnect === MAX_RECONNECTS) {
        throw new Error(
          "ANCIENT event stream failed after " + MAX_RECONNECTS + " reconnect attempts: " +
          (error instanceof Error ? error.message : String(error))
        );
      }
      output.appendLine("[stream interrupted; reconnecting]");
      await waitBeforeReconnect(reconnect);
      continue;
    }

    if (response.status === 401) {
      throw new Error("ANCIENT event stream authentication failed.");
    }
    if (!response.ok || !response.body) {
      throw new Error("ANCIENT event stream failed: " + response.status + " " + (await response.text()).slice(0, 500));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamFailed = false;

    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";

        for (const rawFrame of frames) {
          const parsed = parseSseFrame(rawFrame);
          if (!parsed || parsed.id <= lastEventId) continue;
          lastEventId = parsed.id;

          const e = parsed.event;
          const p = e.payload ?? {};
          if (e.type === "text.delta") output.append(String(p.text ?? ""));
          else if (e.type === "capability.requested") output.appendLine("\n[tool] " + String(p.capability ?? "unknown"));
          else if (e.type === "execution.completed") {
            output.appendLine("\n\n[completed] " + id);
            terminalSeen = true;
          } else if (e.type === "execution.failed") {
            output.appendLine("\n\n[failed] " + JSON.stringify(p.error ?? "execution failed"));
            terminalSeen = true;
          } else if (e.type === "execution.cancelled") {
            output.appendLine("\n\n[cancelled]");
            terminalSeen = true;
          }
        }
        if (terminalSeen) break;
      }

      if (buffer.trim() && !terminalSeen) {
        const parsed = parseSseFrame(buffer);
        if (parsed && parsed.id > lastEventId) {
          lastEventId = parsed.id;
          const e = parsed.event;
          const p = e.payload ?? {};
          if (e.type === "text.delta") output.append(String(p.text ?? ""));
          else if (e.type === "execution.completed") {
            output.appendLine("\n\n[completed] " + id);
            terminalSeen = true;
          } else if (e.type === "execution.failed") {
            output.appendLine("\n\n[failed] " + JSON.stringify(p.error ?? "execution failed"));
            terminalSeen = true;
          } else if (e.type === "execution.cancelled") {
            output.appendLine("\n\n[cancelled]");
            terminalSeen = true;
          }
        }
      }
    } catch {
      streamFailed = true;
    } finally {
      reader.releaseLock();
    }

    if (terminalSeen) return;

    if (reconnect === MAX_RECONNECTS) {
      throw new Error(
        streamFailed
          ? "ANCIENT event stream interrupted and could not be recovered."
          : "ANCIENT event stream ended before a terminal execution event."
      );
    }

    output.appendLine("\n[stream interrupted; reconnecting from event " + String(lastEventId) + "]");
    await waitBeforeReconnect(reconnect);
  }
}

async function run(task: string, output: vscode.OutputChannel, resource?: vscode.Uri) {
  output.show(true);
  output.appendLine("\n> " + task + "\n");
  const id = await start(task, resource);
  output.appendLine("[execution " + id + "]\n");
  await stream(id, output);
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("ANCIENT");
  context.subscriptions.push(output);

  context.subscriptions.push(vscode.commands.registerCommand("ancient.runTask", async () => {
    const task = await vscode.window.showInputBox({ prompt: "What should ANCIENT change in this repository?" });
    if (!task) return;
    try {
      const resource = vscode.window.activeTextEditor?.document.uri;
      await run(task, output, resource);
    } catch (error) {
      const m = error instanceof Error ? error.message : String(error);
      output.appendLine("\n[error] " + m);
      vscode.window.showErrorMessage("ANCIENT: " + m);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("ancient.explainSelection", async () => {
    const editor = vscode.window.activeTextEditor;
    const selection = editor?.document.getText(editor.selection);
    if (!selection?.trim()) {
      vscode.window.showInformationMessage("Select code first.");
      return;
    }
    try {
      const task = "Explain the selected code, its control flow, dependencies, failure modes, security risks, and concrete improvements.\n\nSelected code:\n" +
        selection.slice(0, 30000);
      await run(task, output, editor.document.uri);
    } catch (error) {
      vscode.window.showErrorMessage("ANCIENT: " + (error instanceof Error ? error.message : String(error)));
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("ancient.fixDiagnostics", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    if (editor.document.isDirty) {
      const choice = await vscode.window.showWarningMessage(
        "ANCIENT needs the saved file version because server-side tools operate on the filesystem.",
        "Save",
        "Cancel"
      );
      if (choice !== "Save") return;
      if (!(await editor.document.save())) {
        vscode.window.showErrorMessage("ANCIENT: the current file could not be saved.");
        return;
      }
    }

    const diagnostics = vscode.languages
      .getDiagnostics(editor.document.uri)
      .filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning)
      .slice(0, 50);

    try {
      const scope = executionScope(editor.document.uri);
      const filePath = scope.filePath ?? editor.document.uri.fsPath;
      const task = [
        "Fix the current diagnostics in this file. Inspect the repository as needed. Make the smallest correct production-quality changes and run relevant tests/typecheck.",
        "File: " + filePath,
        "Diagnostics:",
        ...diagnostics.map((d) => "- " + d.message + " (line " + (d.range.start.line + 1) + ")"),
        "Current file:",
        editor.document.getText().slice(0, 30000),
      ].join("\n");
      await run(task, output, editor.document.uri);
    } catch (error) {
      vscode.window.showErrorMessage("ANCIENT: " + (error instanceof Error ? error.message : String(error)));
    }
  }));
}

export function deactivate() {}
