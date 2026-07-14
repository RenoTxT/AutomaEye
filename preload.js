// Preload bridge — expose backend API ke renderer secara aman
// (contextIsolation on, tidak expose Node native langsung).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Config
    getConfig: () => ipcRenderer.invoke('config:get'),
    setConfig: (patch) => ipcRenderer.invoke('config:set', patch),

    // Projects
    listProjects: () => ipcRenderer.invoke('projects:list'),
    createProject: (name, description) => ipcRenderer.invoke('projects:create', { name, description }),
    loadProject: (name) => ipcRenderer.invoke('projects:load', name),
    deleteProject: (name) => ipcRenderer.invoke('projects:delete', name),

    // Models
    createModel: (project, model) => ipcRenderer.invoke('models:create', { project, ...model }),
    updateModel: (project, name, patch) => ipcRenderer.invoke('models:update', { project, name, patch }),
    deleteModel: (project, name) => ipcRenderer.invoke('models:delete', { project, name }),
    listImages: (project, model, split) => ipcRenderer.invoke('models:listImages', { project, model, split }),
    galleryData: (project, model, split) => ipcRenderer.invoke('models:galleryData', { project, model, split }),
    modelStats: (project, model) => ipcRenderer.invoke('models:stats', { project, model }),
    importPtModel: (project, model) => ipcRenderer.invoke('models:importPt', { project, model }),

    // Dataset
    pickImageFiles: () => ipcRenderer.invoke('dataset:pickFiles'),
    uploadImages: (project, model, paths) => ipcRenderer.invoke('dataset:upload', { project, model, paths }),
    deleteImages: (project, model, names) => ipcRenderer.invoke('dataset:deleteImages', { project, model, names }),
    evaluateModel: (project, model, split) => ipcRenderer.invoke('eval:run', { project, model, split }),
    openEvalDir: (dir) => ipcRenderer.invoke('eval:openDir', { dir }),
    onEvalProgress: (cb) => ipcRenderer.on('eval:progress', (_, d) => cb(d)),
    augmentDataset: (project, model, opts) => ipcRenderer.invoke('dataset:augment', { project, model, opts }),
    onAugmentProgress: (cb) => ipcRenderer.on('augment:progress', (_, data) => cb(data)),
    splitDataset: (project, model, ratios) => ipcRenderer.invoke('dataset:split', { project, model, ratios }),
    cleanRebuildDataset: (project, model, ratios) => ipcRenderer.invoke('dataset:cleanRebuild', { project, model, ratios }),

    // Annotation — Label Studio embedded
    startAnnotationServer: () => ipcRenderer.invoke('annotation:startServer'),
    stopAnnotationServer: () => ipcRenderer.invoke('annotation:stopServer'),
    annotationServerStatus: () => ipcRenderer.invoke('annotation:serverStatus'),
    openLabelStudioWindow: (opts) => ipcRenderer.invoke('annotation:openWindow', opts || {}),
    autoSetupLSProject: (project, model) => ipcRenderer.invoke('annotation:autoSetupProject', { project, model }),
    testLSAuth: () => ipcRenderer.invoke('annotation:testAuth'),
    checkExistingLSProject: (project, model) => ipcRenderer.invoke('annotation:checkExisting', { project, model }),
    syncFromLS: (project, model, projectId) => ipcRenderer.invoke('annotation:syncFromLabelStudio', { project, model, projectId }),
    getDatasetDir: (project, model) => ipcRenderer.invoke('annotation:datasetDir', { project, model }),
    openDatasetFolder: (project, model) => ipcRenderer.invoke('dataset:openFolder', { project, model }),
    checkAnnotationTool: () => ipcRenderer.invoke('annotation:check'),

    // Training
    startTraining: (project, model, resume) => ipcRenderer.invoke('training:start', { project, model, resume: !!resume }),
    cancelTraining: () => ipcRenderer.invoke('training:cancel'),
    loadTrainHistory: (project, model) => ipcRenderer.invoke('training:loadHistory', { project, model }),
    onTrainingProgress: (cb) => ipcRenderer.on('training:progress', (_, data) => cb(data)),

    // Sinkronisasi GitHub (Save/Load)
    gitStatus: () => ipcRenderer.invoke('git:status'),
    gitPush: (message) => ipcRenderer.invoke('git:push', { message }),
    gitPull: () => ipcRenderer.invoke('git:pull'),
    gitAutoPullOnce: () => ipcRenderer.invoke('git:autoPullOnce'),
    quitApp: () => ipcRenderer.invoke('app:quit'),

    // Workflow
    saveWorkflow: (project, steps, onFirstNG) => ipcRenderer.invoke('workflow:save', { project, steps, onFirstNG }),

    // Run
    inspect: (project, imageDataUrl, opts) => ipcRenderer.invoke('run:inspect', { project, imageDataUrl, opts }),
    saveAnnotated: (project, imageDataUrl, result) => ipcRenderer.invoke('run:saveAnnotated', { project, imageDataUrl, result }),
    arduinoSignal: (verdict) => ipcRenderer.invoke('arduino:signal', { verdict }),
    arduinoGate: (kind) => ipcRenderer.invoke('arduino:gate', { kind }),
    arduinoStatus: () => ipcRenderer.invoke('arduino:status'),
    arduinoReconnect: () => ipcRenderer.invoke('arduino:reconnect'),

    // Auto-Calibration
    runCalibration: (project, model) => ipcRenderer.invoke('calibration:run', { project, model }),
    onCalibrationProgress: (cb) => ipcRenderer.on('calibration:progress', (_, data) => cb(data)),

    // Self-Learning
    selfLearningStatus: (project, model) => ipcRenderer.invoke('selflearning:status', { project, model }),
    selfLearningArchive: (project, model) => ipcRenderer.invoke('selflearning:archive', { project, model }),

    // NVIDIA
    nvidiaReport: (project, date) => ipcRenderer.invoke('nvidia:report', { project, date }),
    nvidiaAnalyze: (project, date) => ipcRenderer.invoke('nvidia:analyze', { project, date }),
    nvidiaChat: (messages) => ipcRenderer.invoke('nvidia:chat', { messages }),
    openPath: (p) => ipcRenderer.invoke('file:open', p),

    // Navigation
    goTo: (page) => ipcRenderer.invoke('nav:go', page),
});
