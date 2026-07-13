"use strict";

// electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("hermesDesktop", {
  getConnection: (profile) => import_electron.ipcRenderer.invoke("hermes:connection", profile),
  revalidateConnection: () => import_electron.ipcRenderer.invoke("hermes:connection:revalidate"),
  touchBackend: (profile) => import_electron.ipcRenderer.invoke("hermes:backend:touch", profile),
  getGatewayWsUrl: (profile) => import_electron.ipcRenderer.invoke("hermes:gateway:ws-url", profile),
  openSessionWindow: (sessionId, opts) => import_electron.ipcRenderer.invoke("hermes:window:openSession", sessionId, opts),
  openNewSessionWindow: () => import_electron.ipcRenderer.invoke("hermes:window:openNewSession"),
  petOverlay: {
    // Main renderer → main process: window lifecycle + drag. `request` is
    // `{ bounds, screen }`; resolves with the screen bounds it actually used.
    open: (request) => import_electron.ipcRenderer.invoke("hermes:pet-overlay:open", request),
    close: () => import_electron.ipcRenderer.invoke("hermes:pet-overlay:close"),
    setBounds: (bounds) => import_electron.ipcRenderer.send("hermes:pet-overlay:set-bounds", bounds),
    setIgnoreMouse: (ignore) => import_electron.ipcRenderer.send("hermes:pet-overlay:ignore-mouse", ignore),
    // Flip the overlay focusable (and focus it) while the composer needs keys.
    setFocusable: (focusable) => import_electron.ipcRenderer.send("hermes:pet-overlay:set-focusable", focusable),
    // Main renderer → overlay (forwarded by main): push the latest pet state.
    pushState: (payload) => import_electron.ipcRenderer.send("hermes:pet-overlay:state", payload),
    // Overlay → main renderer (forwarded by main): pop back in / composer submit.
    control: (payload) => import_electron.ipcRenderer.send("hermes:pet-overlay:control", payload),
    // Overlay subscribes to state pushes.
    onState: (callback) => {
      const listener = (_event, payload) => callback(payload);
      import_electron.ipcRenderer.on("hermes:pet-overlay:state", listener);
      return () => import_electron.ipcRenderer.removeListener("hermes:pet-overlay:state", listener);
    },
    // Main renderer subscribes to overlay control messages.
    onControl: (callback) => {
      const listener = (_event, payload) => callback(payload);
      import_electron.ipcRenderer.on("hermes:pet-overlay:control", listener);
      return () => import_electron.ipcRenderer.removeListener("hermes:pet-overlay:control", listener);
    }
  },
  getBootProgress: () => import_electron.ipcRenderer.invoke("hermes:boot-progress:get"),
  getConnectionConfig: (profile) => import_electron.ipcRenderer.invoke("hermes:connection-config:get", profile),
  saveConnectionConfig: (payload) => import_electron.ipcRenderer.invoke("hermes:connection-config:save", payload),
  applyConnectionConfig: (payload) => import_electron.ipcRenderer.invoke("hermes:connection-config:apply", payload),
  testConnectionConfig: (payload) => import_electron.ipcRenderer.invoke("hermes:connection-config:test", payload),
  probeConnectionConfig: (remoteUrl) => import_electron.ipcRenderer.invoke("hermes:connection-config:probe", remoteUrl),
  oauthLoginConnectionConfig: (remoteUrl) => import_electron.ipcRenderer.invoke("hermes:connection-config:oauth-login", remoteUrl),
  oauthLogoutConnectionConfig: (remoteUrl) => import_electron.ipcRenderer.invoke("hermes:connection-config:oauth-logout", remoteUrl),
  // Hermes Cloud: one portal login powers discovery + silent per-agent sign-in
  // (cloud-auto-discovery Phase 3).
  cloud: {
    status: () => import_electron.ipcRenderer.invoke("hermes:cloud:status"),
    login: () => import_electron.ipcRenderer.invoke("hermes:cloud:login"),
    logout: () => import_electron.ipcRenderer.invoke("hermes:cloud:logout"),
    discover: (org) => import_electron.ipcRenderer.invoke("hermes:cloud:discover", org),
    agentSignIn: (dashboardUrl) => import_electron.ipcRenderer.invoke("hermes:cloud:agent-sign-in", dashboardUrl)
  },
  profile: {
    get: () => import_electron.ipcRenderer.invoke("hermes:profile:get"),
    set: (name) => import_electron.ipcRenderer.invoke("hermes:profile:set", name)
  },
  api: (request) => import_electron.ipcRenderer.invoke("hermes:api", request),
  notify: (payload) => import_electron.ipcRenderer.invoke("hermes:notify", payload),
  requestMicrophoneAccess: () => import_electron.ipcRenderer.invoke("hermes:requestMicrophoneAccess"),
  readFileDataUrl: (filePath) => import_electron.ipcRenderer.invoke("hermes:readFileDataUrl", filePath),
  readFileText: (filePath) => import_electron.ipcRenderer.invoke("hermes:readFileText", filePath),
  selectPaths: (options) => import_electron.ipcRenderer.invoke("hermes:selectPaths", options),
  writeClipboard: (text) => import_electron.ipcRenderer.invoke("hermes:writeClipboard", text),
  saveImageFromUrl: (url) => import_electron.ipcRenderer.invoke("hermes:saveImageFromUrl", url),
  saveImageBuffer: (data, ext) => import_electron.ipcRenderer.invoke("hermes:saveImageBuffer", { data, ext }),
  saveClipboardImage: () => import_electron.ipcRenderer.invoke("hermes:saveClipboardImage"),
  getPathForFile: (file) => {
    try {
      return import_electron.webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },
  normalizePreviewTarget: (target, baseDir) => import_electron.ipcRenderer.invoke("hermes:normalizePreviewTarget", target, baseDir),
  watchPreviewFile: (url) => import_electron.ipcRenderer.invoke("hermes:watchPreviewFile", url),
  stopPreviewFileWatch: (id) => import_electron.ipcRenderer.invoke("hermes:stopPreviewFileWatch", id),
  setTitleBarTheme: (payload) => import_electron.ipcRenderer.send("hermes:titlebar-theme", payload),
  setNativeTheme: (mode) => import_electron.ipcRenderer.send("hermes:native-theme", mode),
  setTranslucency: (payload) => import_electron.ipcRenderer.send("hermes:translucency", payload),
  setPreviewShortcutActive: (active) => import_electron.ipcRenderer.send("hermes:previewShortcutActive", Boolean(active)),
  openExternal: (url) => import_electron.ipcRenderer.invoke("hermes:openExternal", url),
  openPreviewInBrowser: (url) => import_electron.ipcRenderer.invoke("hermes:openPreviewInBrowser", url),
  fetchLinkTitle: (url) => import_electron.ipcRenderer.invoke("hermes:fetchLinkTitle", url),
  sanitizeWorkspaceCwd: (cwd) => import_electron.ipcRenderer.invoke("hermes:workspace:sanitize", cwd),
  settings: {
    getDefaultProjectDir: () => import_electron.ipcRenderer.invoke("hermes:setting:defaultProjectDir:get"),
    setDefaultProjectDir: (dir) => import_electron.ipcRenderer.invoke("hermes:setting:defaultProjectDir:set", dir),
    pickDefaultProjectDir: () => import_electron.ipcRenderer.invoke("hermes:setting:defaultProjectDir:pick")
  },
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => import_electron.ipcRenderer.invoke("hermes:zoom:get"),
    setPercent: (percent) => import_electron.ipcRenderer.send("hermes:zoom:set-percent", percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: (callback) => {
      const listener = (_event, payload) => callback(payload);
      import_electron.ipcRenderer.on("hermes:zoom:changed", listener);
      return () => import_electron.ipcRenderer.removeListener("hermes:zoom:changed", listener);
    }
  },
  revealLogs: () => import_electron.ipcRenderer.invoke("hermes:logs:reveal"),
  getRecentLogs: () => import_electron.ipcRenderer.invoke("hermes:logs:recent"),
  readDir: (dirPath) => import_electron.ipcRenderer.invoke("hermes:fs:readDir", dirPath),
  gitRoot: (startPath) => import_electron.ipcRenderer.invoke("hermes:fs:gitRoot", startPath),
  revealPath: (targetPath) => import_electron.ipcRenderer.invoke("hermes:fs:reveal", targetPath),
  renamePath: (targetPath, newName) => import_electron.ipcRenderer.invoke("hermes:fs:rename", targetPath, newName),
  writeTextFile: (filePath, content) => import_electron.ipcRenderer.invoke("hermes:fs:writeText", filePath, content),
  trashPath: (targetPath) => import_electron.ipcRenderer.invoke("hermes:fs:trash", targetPath),
  git: {
    worktreeList: (repoPath) => import_electron.ipcRenderer.invoke("hermes:git:worktreeList", repoPath),
    worktreeAdd: (repoPath, options) => import_electron.ipcRenderer.invoke("hermes:git:worktreeAdd", repoPath, options),
    worktreeRemove: (repoPath, worktreePath, options) => import_electron.ipcRenderer.invoke("hermes:git:worktreeRemove", repoPath, worktreePath, options),
    branchSwitch: (repoPath, branch) => import_electron.ipcRenderer.invoke("hermes:git:branchSwitch", repoPath, branch),
    branchList: (repoPath) => import_electron.ipcRenderer.invoke("hermes:git:branchList", repoPath),
    repoStatus: (repoPath) => import_electron.ipcRenderer.invoke("hermes:git:repoStatus", repoPath),
    fileDiff: (repoPath, filePath) => import_electron.ipcRenderer.invoke("hermes:git:fileDiff", repoPath, filePath),
    scanRepos: (roots, options) => import_electron.ipcRenderer.invoke("hermes:git:scanRepos", roots, options),
    review: {
      list: (repoPath, scope, baseRef) => import_electron.ipcRenderer.invoke("hermes:git:review:list", repoPath, scope, baseRef),
      diff: (repoPath, filePath, scope, baseRef, staged) => import_electron.ipcRenderer.invoke("hermes:git:review:diff", repoPath, filePath, scope, baseRef, staged),
      stage: (repoPath, filePath) => import_electron.ipcRenderer.invoke("hermes:git:review:stage", repoPath, filePath),
      unstage: (repoPath, filePath) => import_electron.ipcRenderer.invoke("hermes:git:review:unstage", repoPath, filePath),
      revert: (repoPath, filePath) => import_electron.ipcRenderer.invoke("hermes:git:review:revert", repoPath, filePath),
      revParse: (repoPath, ref) => import_electron.ipcRenderer.invoke("hermes:git:review:revParse", repoPath, ref),
      commit: (repoPath, message, push) => import_electron.ipcRenderer.invoke("hermes:git:review:commit", repoPath, message, push),
      commitContext: (repoPath) => import_electron.ipcRenderer.invoke("hermes:git:review:commitContext", repoPath),
      push: (repoPath) => import_electron.ipcRenderer.invoke("hermes:git:review:push", repoPath),
      shipInfo: (repoPath) => import_electron.ipcRenderer.invoke("hermes:git:review:shipInfo", repoPath),
      createPr: (repoPath) => import_electron.ipcRenderer.invoke("hermes:git:review:createPr", repoPath)
    }
  },
  terminal: {
    dispose: (id) => import_electron.ipcRenderer.invoke("hermes:terminal:dispose", id),
    resize: (id, size) => import_electron.ipcRenderer.invoke("hermes:terminal:resize", id, size),
    start: (options) => import_electron.ipcRenderer.invoke("hermes:terminal:start", options),
    write: (id, data) => import_electron.ipcRenderer.invoke("hermes:terminal:write", id, data),
    onData: (id, callback) => {
      const channel = `hermes:terminal:${id}:data`;
      const listener = (_event, payload) => callback(payload);
      import_electron.ipcRenderer.on(channel, listener);
      return () => import_electron.ipcRenderer.removeListener(channel, listener);
    },
    onExit: (id, callback) => {
      const channel = `hermes:terminal:${id}:exit`;
      const listener = (_event, payload) => callback(payload);
      import_electron.ipcRenderer.on(channel, listener);
      return () => import_electron.ipcRenderer.removeListener(channel, listener);
    }
  },
  onClosePreviewRequested: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on("hermes:close-preview-requested", listener);
    return () => import_electron.ipcRenderer.removeListener("hermes:close-preview-requested", listener);
  },
  onOpenUpdatesRequested: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on("hermes:open-updates", listener);
    return () => import_electron.ipcRenderer.removeListener("hermes:open-updates", listener);
  },
  onDeepLink: (callback) => {
    const listener = (_event, payload) => callback(payload);
    import_electron.ipcRenderer.on("hermes:deep-link", listener);
    return () => import_electron.ipcRenderer.removeListener("hermes:deep-link", listener);
  },
  signalDeepLinkReady: () => import_electron.ipcRenderer.invoke("hermes:deep-link-ready"),
  onWindowStateChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    import_electron.ipcRenderer.on("hermes:window-state-changed", listener);
    return () => import_electron.ipcRenderer.removeListener("hermes:window-state-changed", listener);
  },
  onFocusSession: (callback) => {
    const listener = (_event, sessionId) => callback(sessionId);
    import_electron.ipcRenderer.on("hermes:focus-session", listener);
    return () => import_electron.ipcRenderer.removeListener("hermes:focus-session", listener);
  },
  onNotificationAction: (callback) => {
    const listener = (_event, payload) => callback(payload);
    import_electron.ipcRenderer.on("hermes:notification-action", listener);
    return () => import_electron.ipcRenderer.removeListener("hermes:notification-action", listener);
  },
  onPreviewFileChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    import_electron.ipcRenderer.on("hermes:preview-file-changed", listener);
    return () => import_electron.ipcRenderer.removeListener("hermes:preview-file-changed", listener);
  },
  onBackendExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    import_electron.ipcRenderer.on("hermes:backend-exit", listener);
    return () => import_electron.ipcRenderer.removeListener("hermes:backend-exit", listener);
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on("hermes:connection:applied", listener);
    return () => import_electron.ipcRenderer.removeListener("hermes:connection:applied", listener);
  },
  onPowerResume: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on("hermes:power-resume", listener);
    return () => import_electron.ipcRenderer.removeListener("hermes:power-resume", listener);
  },
  onBootProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    import_electron.ipcRenderer.on("hermes:boot-progress", listener);
    return () => import_electron.ipcRenderer.removeListener("hermes:boot-progress", listener);
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.ts (apps/desktop/electron/bootstrap-runner.ts).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => import_electron.ipcRenderer.invoke("hermes:bootstrap:get"),
  resetBootstrap: () => import_electron.ipcRenderer.invoke("hermes:bootstrap:reset"),
  repairBootstrap: () => import_electron.ipcRenderer.invoke("hermes:bootstrap:repair"),
  cancelBootstrap: () => import_electron.ipcRenderer.invoke("hermes:bootstrap:cancel"),
  onBootstrapEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    import_electron.ipcRenderer.on("hermes:bootstrap:event", listener);
    return () => import_electron.ipcRenderer.removeListener("hermes:bootstrap:event", listener);
  },
  getVersion: () => import_electron.ipcRenderer.invoke("hermes:version"),
  getRemoteDisplayReason: () => import_electron.ipcRenderer.invoke("hermes:get-remote-display-reason"),
  uninstall: {
    summary: () => import_electron.ipcRenderer.invoke("hermes:uninstall:summary"),
    run: (mode) => import_electron.ipcRenderer.invoke("hermes:uninstall:run", { mode })
  },
  updates: {
    check: () => import_electron.ipcRenderer.invoke("hermes:updates:check"),
    apply: (opts) => import_electron.ipcRenderer.invoke("hermes:updates:apply", opts),
    getBranch: () => import_electron.ipcRenderer.invoke("hermes:updates:branch:get"),
    setBranch: (name) => import_electron.ipcRenderer.invoke("hermes:updates:branch:set", name),
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      import_electron.ipcRenderer.on("hermes:updates:progress", listener);
      return () => import_electron.ipcRenderer.removeListener("hermes:updates:progress", listener);
    }
  },
  themes: {
    fetchMarketplace: (id) => import_electron.ipcRenderer.invoke("hermes:vscode-theme:fetch", id),
    searchMarketplace: (query) => import_electron.ipcRenderer.invoke("hermes:vscode-theme:search", query)
  }
});
