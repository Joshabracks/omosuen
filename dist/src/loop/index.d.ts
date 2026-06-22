export { start, stop, pause, resume, isRunning, isPaused, getFrameTime, getFPS, getTargetFPS, } from './manager';
export { queueInit, processInitQueue, isInitializing, clearInitQueue, getInitQueueSize, getInitQueueLength, getInitializingComponent, } from './init';
export { updateScene } from './update';
export { queueDispose, markForDisposal, processDisposeQueue, clearDisposeQueue, getDisposeQueueSize, } from './dispose';
export { renderScene } from './render';
export { pollMessages } from './messaging';
export { pollFlags } from './flags';
//# sourceMappingURL=index.d.ts.map