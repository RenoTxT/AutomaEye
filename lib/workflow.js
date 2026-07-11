// Workflow executor — chain semua model, aggregate verdict, save output.

const path = require('path');
const inference = require('./inference');
const selflearning = require('./selflearning');

exports.execute = async (cfg, project, imageDataUrl, arduino, output) => {
    // Strip data URL prefix
    const base64 = imageDataUrl.replace(/^data:image\/[^;]+;base64,/, '');

    if (!project.workflow.steps || project.workflow.steps.length === 0) {
        throw new Error('Workflow kosong. Buat workflow dulu.');
    }

    const start = Date.now();
    const result = {
        timestamp: new Date().toISOString(),
        finalVerdict: 'OK',
        steps: [],
    };

    const stopOnFirstNG = project.workflow.onFirstNG === 'stop_and_report';

    for (const step of project.workflow.steps) {
        const m = project.models.find(x => x.name === step.modelName);
        const sr = {
            stepIndex: step.stepIndex,
            modelName: step.modelName,
            category: step.category,
            verdict: 'ERROR',
            confidence: 0,
        };

        if (!m || !m.trained) {
            sr.verdict = 'ERROR';
            sr.error = `Model ${step.modelName} belum trained atau tidak ada`;
            result.steps.push(sr);
            result.finalVerdict = 'NG';
            if (stopOnFirstNG) break;
            continue;
        }

        const weightsPath = path.join(m.dir, 'weights', 'best.pt');
        try {
            const stepStart = Date.now();
            const r = await inference.inferOnce(cfg, weightsPath, base64, m.classes, {
                confidence: cfg.model.confidence,
                iou: cfg.model.iou,
                imgsz: cfg.model.imgsz,
            });
            sr.inferenceMS = Date.now() - stepStart;
            sr.verdict = r.verdict;
            sr.confidence = r.minConfidence || 0;
            sr.detections = r.detections || [];
        } catch (e) {
            sr.verdict = 'ERROR';
            sr.error = e.message;
        }

        result.steps.push(sr);
        if (sr.verdict === 'NG' || sr.verdict === 'ERROR') {
            result.finalVerdict = 'NG';
            if (stopOnFirstNG) break;
        }
        if (step.continueOn === 'on_ok' && sr.verdict !== 'OK') break;
        if (step.continueOn === 'on_ng' && sr.verdict !== 'NG') break;
    }

    result.totalMS = Date.now() - start;

    // Save output (NG folder + serial signal)
    try {
        const saved = output.record(project, base64, result, cfg);
        result.savedTo = saved.imgPath;
    } catch (e) {
        console.warn('save output failed:', e.message);
    }

    // Kirim sinyal ke Arduino
    try {
        if (result.finalVerdict === 'NG') {
            await arduino.send(cfg.arduino.ng_signal);
        } else if (cfg.arduino.signal_on_ok) {
            await arduino.send(cfg.arduino.ok_signal);
        }
    } catch (e) { /* non-fatal */ }

    // Self-learning: kumpulkan hard sample bila unit ini tergolong "ragu".
    try {
        result.selfLearning = selflearning.collect(cfg, project, base64, result);
    } catch (e) {
        result.selfLearning = { collected: false, reason: e.message };
    }

    return result;
};
