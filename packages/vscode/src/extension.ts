import * as vscode from "vscode";

function settings() {
  const c = vscode.workspace.getConfiguration("ancient");
  return {
    baseUrl: String(c.get("apiBaseUrl") ?? "http://127.0.0.1:3000/v1").replace(/\/$/, ""),
    apiKey: String(c.get("apiKey") ?? ""),
    model: String(c.get("model") ?? ""),
  };
}

function cwd() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
}

function requireSettings() {
  const s = settings();
  if (!s.apiKey) throw new Error("Set ancient.apiKey before running an ANCIENT task.");
  if (!cwd()) throw new Error("Open a workspace folder first.");
  return s;
}

async function start(task: string): Promise<string> {
  const s = requireSettings();
  const response = await fetch(`${s.baseUrl}/executions`, {
    method: "POST",
    headers: {"content-type":"application/json","authorization":`Bearer ${s.apiKey}`},
    body: JSON.stringify({
      task,
      cwd: cwd(),
      mode: "BUILD",
      ...(s.model ? {model:{modelKind:"builtin",modelId:s.model}} : {}),
      allow: ["read","write","exec"]
    })
  });
  if (!response.ok) throw new Error(`ANCIENT API ${response.status}: ${(await response.text()).slice(0,500)}`);
  const data = await response.json() as {executionId?:string};
  if (!data.executionId) throw new Error("ANCIENT API returned no executionId.");
  return data.executionId;
}

async function stream(id: string, output: vscode.OutputChannel) {
  const s = requireSettings();
  const response = await fetch(`${s.baseUrl}/executions/${encodeURIComponent(id)}/events`, {
    headers: {authorization:`Bearer ${s.apiKey}`,accept:"text/event-stream"}
  });
  if (!response.ok || !response.body) throw new Error(`ANCIENT event stream failed: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frame = (raw:string) => {
    const line = raw.split(/\r?\n/).find(x => x.startsWith("data: "));
    if (!line) return;
    let e:any;
    try { e=JSON.parse(line.slice(6)); } catch { return; }
    const p=e.payload ?? {};
    if(e.type==="text.delta") output.append(String(p.text ?? ""));
    else if(e.type==="capability.requested") output.appendLine(`\n[tool] ${String(p.capability ?? "unknown")}`);
    else if(e.type==="execution.completed") output.appendLine(`\n\n[completed] ${id}`);
    else if(e.type==="execution.failed") output.appendLine(`\n\n[failed] ${JSON.stringify(p.error ?? "execution failed")}`);
    else if(e.type==="execution.cancelled") output.appendLine("\n\n[cancelled]");
  };
  while(true){
    const {value,done}=await reader.read();
    if(done) break;
    buffer += decoder.decode(value,{stream:true});
    const frames=buffer.split(/\r?\n\r?\n/);
    buffer=frames.pop() ?? "";
    for(const f of frames) frame(f);
  }
  if(buffer.trim()) frame(buffer);
}

async function run(task:string, output:vscode.OutputChannel){
  output.show(true);
  output.appendLine(`\n> ${task}\n`);
  const id=await start(task);
  output.appendLine(`[execution ${id}]\n`);
  await stream(id,output);
}

export function activate(context:vscode.ExtensionContext){
  const output=vscode.window.createOutputChannel("ANCIENT");
  context.subscriptions.push(output);

  context.subscriptions.push(vscode.commands.registerCommand("ancient.runTask",async()=>{
    const task=await vscode.window.showInputBox({prompt:"What should ANCIENT change in this repository?"});
    if(!task) return;
    try{await run(task,output);}catch(e){const m=e instanceof Error?e.message:String(e);output.appendLine(`\n[error] ${m}`);vscode.window.showErrorMessage(`ANCIENT: ${m}`);}
  }));

  context.subscriptions.push(vscode.commands.registerCommand("ancient.explainSelection",async()=>{
    const editor=vscode.window.activeTextEditor;
    const selection=editor?.document.getText(editor.selection);
    if(!selection?.trim()){vscode.window.showInformationMessage("Select code first.");return;}
    const task=`Explain the selected code, its control flow, dependencies, failure modes, security risks, and concrete improvements.\n\nSelected code:\n${selection.slice(0,30000)}`;
    try{await run(task,output);}catch(e){vscode.window.showErrorMessage(`ANCIENT: ${e instanceof Error?e.message:String(e)}`);}
  }));

  context.subscriptions.push(vscode.commands.registerCommand("ancient.fixDiagnostics",async()=>{
    const editor=vscode.window.activeTextEditor;
    if(!editor) return;
    const diagnostics=vscode.languages.getDiagnostics(editor.document.uri).filter(d=>d.severity<=vscode.DiagnosticSeverity.Warning).slice(0,50);
    const task=[
      "Fix the current diagnostics in this file. Inspect the repository as needed. Make the smallest correct production-quality changes and run relevant tests/typecheck.",
      `File: ${editor.document.uri.fsPath}`,
      "Diagnostics:",
      ...diagnostics.map(d=>`- ${d.message} (line ${d.range.start.line+1})`),
      "Current file:",
      editor.document.getText().slice(0,30000)
    ].join("\n");
    try{await run(task,output);}catch(e){vscode.window.showErrorMessage(`ANCIENT: ${e instanceof Error?e.message:String(e)}`);}
  }));
}

export function deactivate(){}
