import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

const pendingValidation = new Map<string, NodeJS.Timeout>();
const lastFilesByDoc = new Map<string, Set<string>>();
const debounceMs = 300;

interface GatocRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface GatocDiagnostic {
  file: string;
  severity: string;
  message: string;
  code?: string;
  range?: GatocRange;
}

interface GatocResponse {
  version: number;
  ok: boolean;
  diagnostics: GatocDiagnostic[];
}

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental
    }
  };
});

documents.onDidOpen((event) => {
  validateNow(event.document);
});

documents.onDidSave((event) => {
  validateNow(event.document);
});

documents.onDidChangeContent((event) => {
  scheduleValidation(event.document);
});

function scheduleValidation(document: TextDocument): void {
  const uri = document.uri;
  const existing = pendingValidation.get(uri);
  if (existing) {
    clearTimeout(existing);
  }
  const handle = setTimeout(() => {
    pendingValidation.delete(uri);
    void validateDocument(document);
  }, debounceMs);
  pendingValidation.set(uri, handle);
}

function validateNow(document: TextDocument): void {
  const uri = document.uri;
  const existing = pendingValidation.get(uri);
  if (existing) {
    clearTimeout(existing);
    pendingValidation.delete(uri);
  }
  void validateDocument(document);
}

async function validateDocument(document: TextDocument): Promise<void> {
  const docPath = uriToPath(document.uri);
  if (!docPath) {
    return;
  }

  let tmpFile: string | null = null;
  try {
    tmpFile = await writeTempFile(docPath, document.getText());
    const response = await runGatoc(tmpFile);
    const diagnosticsByFile = mapDiagnostics(response, tmpFile, docPath);
    const currentFiles = new Set<string>();

    for (const [filePath, diagnostics] of diagnosticsByFile) {
      currentFiles.add(filePath);
      publishDiagnostics(filePath, diagnostics);
    }

    const previousFiles = lastFilesByDoc.get(document.uri);
    if (previousFiles) {
      for (const filePath of previousFiles) {
        if (!currentFiles.has(filePath)) {
          publishDiagnostics(filePath, []);
        }
      }
    }

    lastFilesByDoc.set(document.uri, currentFiles);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const diagnostic: Diagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: DiagnosticSeverity.Error,
      message
    };
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [diagnostic] });
  } finally {
    if (tmpFile) {
      try {
        await fs.unlink(tmpFile);
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}

function mapDiagnostics(response: GatocResponse, tmpFile: string, docPath: string): Map<string, Diagnostic[]> {
  const result = new Map<string, Diagnostic[]>();
  const tmpResolved = path.resolve(tmpFile);
  const docResolved = path.resolve(docPath);
  const diags = response.diagnostics ?? [];

  for (const diag of diags) {
    const resolvedFile = normalizeDiagFile(diag.file, docResolved);
    const targetFile = path.resolve(resolvedFile) === tmpResolved ? docResolved : resolvedFile;
    const list = result.get(targetFile) ?? [];
    list.push(convertDiagnostic(diag));
    result.set(targetFile, list);
  }

  if (!result.has(docResolved)) {
    result.set(docResolved, []);
  }

  return result;
}

function convertDiagnostic(diag: GatocDiagnostic): Diagnostic {
  const range = diag.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  const severity = severityFromString(diag.severity);
  return {
    range,
    severity,
    message: diag.message,
    code: diag.code
  };
}

function severityFromString(value: string): DiagnosticSeverity {
  switch (value) {
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
    case "error":
    default:
      return DiagnosticSeverity.Error;
  }
}

function normalizeDiagFile(file: string, fallback: string): string {
  if (!file || file === "unknown") {
    return fallback;
  }
  if (path.isAbsolute(file)) {
    return file;
  }
  return path.resolve(path.dirname(fallback), file);
}

function publishDiagnostics(filePath: string, diagnostics: Diagnostic[]): void {
  const uri = pathToFileURL(filePath).toString();
  connection.sendDiagnostics({ uri, diagnostics });
}

async function writeTempFile(docPath: string, contents: string): Promise<string> {
  const base = path.basename(docPath, path.extname(docPath));
  const fileName = `.gatolang-lsp-${base}-${process.pid}-${Date.now()}.gw`;
  const preferredDir = path.dirname(docPath);
  const preferredPath = path.join(preferredDir, fileName);

  try {
    await fs.writeFile(preferredPath, contents, "utf8");
    return preferredPath;
  } catch {
    const fallbackPath = path.join(os.tmpdir(), fileName);
    await fs.writeFile(fallbackPath, contents, "utf8");
    return fallbackPath;
  }
}

async function runGatoc(filePath: string): Promise<GatocResponse> {
  const gatocPath = process.env.GATOC_PATH || "gatoc";
  const args = ["--check", "--json-diags", filePath];

  return new Promise((resolve, reject) => {
    const child = spawn(gatocPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`failed to run gatoc: ${err.message}`));
    });

    child.on("close", () => {
      const trimmed = stdout.trim();
      if (!trimmed) {
        const msg = stderr.trim() || "gatoc produced no output";
        reject(new Error(msg));
        return;
      }
      try {
        resolve(JSON.parse(trimmed) as GatocResponse);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reject(new Error(`invalid gatoc JSON: ${message}`));
      }
    });
  });
}

function uriToPath(uri: string): string | null {
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

documents.listen(connection);
connection.listen();
