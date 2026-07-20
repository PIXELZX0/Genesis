import type { GatewayBrowserClient } from "../gateway.ts";
import type { FilesListResult, FilesReadResult, FilesWriteResult } from "../types.ts";

export type FilesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  filesPath: string;
  filesList: FilesListResult | null;
  filesLoading: boolean;
  filesError: string | null;
  filesActive: FilesReadResult | null;
  filesDraft: string;
  filesSaving: boolean;
};

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export async function loadFilesDir(state: FilesState, path: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.filesLoading = true;
  state.filesError = null;
  try {
    const res = await state.client.request<FilesListResult | null>("files.list", { path });
    if (res) {
      state.filesPath = res.path;
      state.filesList = res;
      state.filesActive = null;
      state.filesDraft = "";
    }
  } catch (err) {
    state.filesError = String(err);
  } finally {
    state.filesLoading = false;
  }
}

export async function openFilesFile(state: FilesState, path: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.filesLoading = true;
  state.filesError = null;
  try {
    const res = await state.client.request<FilesReadResult | null>("files.read", { path });
    if (res) {
      state.filesActive = res;
      state.filesDraft = res.content;
    }
  } catch (err) {
    state.filesError = String(err);
  } finally {
    state.filesLoading = false;
  }
}

export async function saveFilesFile(state: FilesState) {
  const active = state.filesActive;
  if (!state.client || !state.connected || !active || state.filesSaving) {
    return;
  }
  state.filesSaving = true;
  state.filesError = null;
  try {
    const res = await state.client.request<FilesWriteResult | null>("files.write", {
      path: active.path,
      content: state.filesDraft,
    });
    if (res) {
      state.filesActive = { ...active, content: state.filesDraft, size: res.size };
    }
  } catch (err) {
    state.filesError = String(err);
  } finally {
    state.filesSaving = false;
  }
}

export async function deleteFilesEntry(state: FilesState, path: string, isDir: boolean) {
  if (!state.client || !state.connected) {
    return;
  }
  state.filesError = null;
  try {
    await state.client.request("files.delete", { path });
  } catch (err) {
    const message = String(err);
    if (isDir && /ENOTEMPTY|EISDIR|not empty|directory/i.test(message)) {
      if (!window.confirm("Directory is not empty. Delete recursively?")) {
        return;
      }
      try {
        await state.client.request("files.delete", { path, recursive: true });
      } catch (err2) {
        state.filesError = String(err2);
        return;
      }
    } else {
      state.filesError = message;
      return;
    }
  }
  await loadFilesDir(state, state.filesPath);
}

export async function renameFilesEntry(state: FilesState, path: string, newPath: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.filesError = null;
  try {
    await state.client.request("files.rename", { path, newPath });
    await loadFilesDir(state, state.filesPath);
  } catch (err) {
    state.filesError = String(err);
  }
}

export async function createFilesDir(state: FilesState, name: string) {
  if (!state.client || !state.connected || !name) {
    return;
  }
  state.filesError = null;
  try {
    await state.client.request("files.mkdir", { path: joinPath(state.filesPath, name) });
    await loadFilesDir(state, state.filesPath);
  } catch (err) {
    state.filesError = String(err);
  }
}

export async function uploadFilesFile(state: FilesState, file: File) {
  if (!state.client || !state.connected) {
    return;
  }
  state.filesError = null;
  try {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    await state.client.request("files.write", {
      path: joinPath(state.filesPath, file.name),
      content: btoa(binary),
      encoding: "base64",
      overwrite: false,
    });
    await loadFilesDir(state, state.filesPath);
  } catch (err) {
    state.filesError = String(err);
  }
}

export async function downloadFilesFile(state: FilesState, path: string, name: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.filesError = null;
  try {
    const res = await state.client.request<FilesReadResult | null>("files.read", {
      path,
      encoding: "base64",
    });
    if (!res) {
      return;
    }
    const binary = atob(res.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const url = URL.createObjectURL(new Blob([bytes]));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    state.filesError = String(err);
  }
}
